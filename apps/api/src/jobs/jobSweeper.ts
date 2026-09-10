import type { Db } from 'mongodb';
import type { JobDoc, KitDoc } from '../db/types.js';
import { JobWorker, DEFAULT_MAX_ATTEMPTS } from './jobWorker.js';

export const SWEEPER_INTERVAL_MS = 30000; // 30s

export async function sweepStaleJobs(
  db: Db,
): Promise<{ recovered: number; failed: number }> {
  const now = new Date();
  let recovered = 0;
  let failed = 0;

  const staleJobs = await db
    .collection<JobDoc>('jobs')
    .find({
      status: 'running',
      leaseExpiresAt: { $lt: now },
    })
    .toArray();

  for (const job of staleJobs) {
    if (job.attempt >= DEFAULT_MAX_ATTEMPTS) {
      // Poison job exceeded max attempts
      await db.collection<JobDoc>('jobs').updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            error: 'stale_after_retries',
            updatedAt: now,
          },
        },
      );

      await db.collection<KitDoc>('kits').updateOne(
        { _id: job.kitId },
        {
          $set: {
            status: 'failed',
            error: 'stale_after_retries',
            updatedAt: now,
          },
        },
      );
      failed += 1;
    } else {
      // Reclaim and resume from checkpoint
      const worker = new JobWorker(db, `sweeper-${process.pid}`);
      const claimed = await worker.claimJob(job._id);
      if (claimed) {
        // Execute in background
        worker.executeJob(claimed).catch((err) => {
          const isClosed =
            err instanceof Error &&
            (err.name === 'MongoClientClosedError' ||
              err.name === 'MongoPoolClosedError' ||
              err.message.includes('Topology is closed') ||
              err.message.includes('closed connection pool') ||
              err.message.includes('ended') ||
              err.message.includes('client was closed'));
          if (!isClosed) {
            console.error(`[Sweeper] Failed to resume job ${job._id}:`, err);
          }
        });
        recovered += 1;
      }
    }
  }

  return { recovered, failed };
}

export function startJobSweeper(
  db: Db,
  intervalMs: number = SWEEPER_INTERVAL_MS,
): () => void {
  // Run sweep on boot
  sweepStaleJobs(db).catch((err) => {
    console.error('[Sweeper] Initial boot sweep failed:', err);
  });

  const timer = setInterval(() => {
    sweepStaleJobs(db).catch((err) => {
      console.error('[Sweeper] Periodic sweep failed:', err);
    });
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }

  return () => {
    clearInterval(timer);
  };
}
