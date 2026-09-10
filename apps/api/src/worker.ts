import { connectDb, closeDb } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';
import { JobWorker } from './jobs/jobWorker.js';
import { startJobSweeper } from './jobs/jobSweeper.js';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS) || 2000;

export async function runWorker(): Promise<void> {
  console.log('[Worker] Bootstrapping standalone durable job worker...');
  try {
    const { db } = await connectDb();
    await ensureIndexes(db);

    const stopSweeper = startJobSweeper(db);
    const worker = new JobWorker(db);

    console.log(`[Worker] Started worker instance: ${worker.workerId}`);
    let isRunning = true;

    const shutdown = async (signal: string) => {
      console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
      isRunning = false;
      stopSweeper();
      await closeDb();
      console.log('[Worker] Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Continuous polling loop: claims queued jobs or resumes stale leases
    while (isRunning) {
      try {
        const processed = await worker.processJob();
        if (!processed) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (err) {
        console.error('[Worker] Error in job processing loop:', err);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  } catch (err) {
    console.error('[Worker] Fatal bootstrap failure:', err);
    process.exit(1);
  }
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  runWorker();
}
