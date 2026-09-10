import crypto from 'node:crypto';
import type { Db, Filter } from 'mongodb';
import {
  assertValidKit,
  canonicalKit,
  runPipeline,
  type LlmAdapter,
  createMockAdapter,
  createGeminiAdapter,
  createGroqAdapter,
  geminiOptionsFromEnv,
  groqOptionsFromEnv,
  SsrfPolicy,
} from '@kit/core';
import type { JobDoc, KitDoc, ItemMeta } from '../db/types.js';
import { MongoCheckpointStore } from './mongoCheckpointStore.js';
import { JobProgressSink } from './jobProgressSink.js';
import { globalSseBroadcaster } from './sseBroadcaster.js';

export const LEASE_DURATION_MS = 60000; // 60s
export const HEARTBEAT_INTERVAL_MS = 15000; // 15s
export const DEFAULT_MAX_ATTEMPTS = 2;

export function computeItemFingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export class JobWorker {
  readonly workerId: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    workerId?: string,
    private readonly adapters?: readonly LlmAdapter[],
  ) {
    this.workerId =
      workerId ?? `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Atomically claim an eligible job using a single findOneAndUpdate().
   * Eligible: status === 'queued' OR (status === 'running' AND leaseExpiresAt < now)
   */
  async claimJob(jobId?: string): Promise<JobDoc | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

    const filter: Filter<JobDoc> = {
      ...(jobId ? { _id: jobId } : {}),
      $or: [{ status: 'queued' }, { status: 'running', leaseExpiresAt: { $lt: now } }],
      attempt: { $lt: DEFAULT_MAX_ATTEMPTS },
    };

    const update = {
      $set: {
        status: 'running' as const,
        leaseOwner: this.workerId,
        leaseExpiresAt,
        heartbeatAt: now,
        updatedAt: now,
      },
      $inc: { attempt: 1 },
    };

    const result = await this.db
      .collection<JobDoc>('jobs')
      .findOneAndUpdate(filter, update, { returnDocument: 'after' });

    return result ?? null;
  }

  /**
   * Start heartbeat loop renewing lease every HEARTBEAT_INTERVAL_MS
   */
  private startHeartbeat(jobId: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
        await this.db.collection<JobDoc>('jobs').updateOne(
          { _id: jobId, leaseOwner: this.workerId, status: 'running' },
          {
            $set: {
              leaseExpiresAt,
              heartbeatAt: now,
              updatedAt: now,
            },
          },
        );
      } catch (err) {
        console.error(
          `[JobWorker ${this.workerId}] Heartbeat failed for job ${jobId}:`,
          err,
        );
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Run the claimed job through core.runPipeline() with checkpoint recovery
   */
  async executeJob(job: JobDoc): Promise<void> {
    this.startHeartbeat(job._id);

    const checkpointStore = new MongoCheckpointStore(this.db);
    const progressSink = new JobProgressSink(this.db, job._id, globalSseBroadcaster);

    try {
      const kitDoc = await this.db.collection<KitDoc>('kits').findOne({ _id: job.kitId });
      if (!kitDoc) {
        throw new Error(`Orphaned job: Kit ${job.kitId} not found`);
      }

      // Build adapters
      let activeAdapters: readonly LlmAdapter[];
      if (this.adapters && this.adapters.length > 0) {
        activeAdapters = this.adapters;
      } else {
        const provider = process.env.LLM_PROVIDER || 'mock';
        if (provider === 'mock') {
          activeAdapters = [createMockAdapter()];
        } else {
          const list: LlmAdapter[] = [];
          const geminiOpts = geminiOptionsFromEnv(process.env);
          if (geminiOpts) {
            list.push(createGeminiAdapter(geminiOpts));
          }
          const groqOpts = groqOptionsFromEnv(process.env);
          if (groqOpts) {
            list.push(createGroqAdapter(groqOpts));
          }
          activeAdapters = list.length > 0 ? list : [createMockAdapter()];
        }
      }

      // Policy is strict by construction in the API (docs/DECISIONS.md D-016)
      const policy = SsrfPolicy.strict();

      const pipelineResult = await runPipeline(
        {
          jd: kitDoc.input.jd,
          company_url: kitDoc.input.company_url,
          days: kitDoc.input.days,
        },
        {
          adapters: activeAdapters,
          policy,
          checkpointStore,
          progressSink,
          jobId: job._id,
        },
      );

      // Flush any queued progress events before finalizing kit and job status
      await progressSink.flush();

      // Validate Appendix A invariants
      assertValidKit(pipelineResult.kit);
      const canonical = canonicalKit(pipelineResult.kit);

      // Build sidecar item metadata
      const itemMeta: Record<string, ItemMeta> = {};
      for (const q of canonical.questions) {
        itemMeta[q.id] = {
          origin: 'generated',
          edited: false,
          pinned: false,
          fingerprint: computeItemFingerprint(q.prompt),
          editedAt: null,
        };
      }
      for (const f of canonical.flashcards) {
        itemMeta[f.id] = {
          origin: 'generated',
          edited: false,
          pinned: false,
          fingerprint: computeItemFingerprint(f.front + f.back),
          editedAt: null,
        };
      }

      const now = new Date();

      // 1. Verify lease ownership is still valid before committing final results
      const currentJob = await this.db.collection<JobDoc>('jobs').findOne({
        _id: job._id,
        leaseOwner: this.workerId,
      });
      if (!currentJob || !currentJob.leaseExpiresAt || currentJob.leaseExpiresAt < now) {
        console.warn(
          `[JobWorker ${this.workerId}] Job ${job._id} completion aborted: lease owner mismatch or lease expired`,
        );
        return;
      }

      // 2. Persist completed kit so it is ready before job is marked completed
      await this.db.collection<KitDoc>('kits').updateOne(
        { _id: job.kitId },
        {
          $set: {
            status: 'ready',
            kit: canonical,
            itemMeta,
            research: {
              pagesUsed: pipelineResult.research.pagesUsed,
              gaps: pipelineResult.gaps,
              robotsBlocked: pipelineResult.research.robotsBlocked,
              injectionFlags: pipelineResult.research.injectionFlags.map(
                (f) => f.pattern,
              ),
            },
            updatedAt: now,
          },
        },
      );

      // 3. Persist completed job strictly verifying lease ownership (F04)
      const jobCompleteResult = await this.db.collection<JobDoc>('jobs').updateOne(
        { _id: job._id, leaseOwner: this.workerId },
        {
          $set: {
            status: 'completed',
            currentStage: 16,
            lastCompletedStage: 16,
            progress: 100,
            gaps: pipelineResult.gaps,
            updatedAt: now,
          },
        },
      );

      // If lease was lost to another worker, do not finalize
      if (jobCompleteResult.matchedCount === 0) {
        console.warn(
          `[JobWorker ${this.workerId}] Job ${job._id} completion aborted: lease owner mismatch or lease expired`,
        );
        return;
      }

      globalSseBroadcaster.broadcast(job._id, {
        type: 'pipeline:complete',
        jobId: job._id,
        status: 'completed',
        progress: 100,
        timestamp: now.toISOString(),
      });
    } catch (err) {
      const isClosed =
        err instanceof Error &&
        (err.name === 'MongoClientClosedError' ||
          err.name === 'MongoPoolClosedError' ||
          err.message.includes('Topology is closed') ||
          err.message.includes('closed connection pool') ||
          err.message.includes('ended') ||
          err.message.includes('client was closed'));
      if (isClosed) {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[JobWorker ${this.workerId}] Job ${job._id} execution failed:`,
        errorMsg,
      );

      const now = new Date();

      // Mark job failed strictly verifying lease ownership (F04)
      const jobFailResult = await this.db.collection<JobDoc>('jobs').updateOne(
        { _id: job._id, leaseOwner: this.workerId },
        {
          $set: {
            status: 'failed',
            error: errorMsg,
            updatedAt: now,
          },
        },
      );

      if (jobFailResult.matchedCount === 0) {
        console.warn(
          `[JobWorker ${this.workerId}] Job ${job._id} failure aborted: lease owner mismatch or lease expired`,
        );
        return;
      }

      // Mark kit failed only if this worker held the lease
      await this.db.collection<KitDoc>('kits').updateOne(
        { _id: job.kitId },
        {
          $set: {
            status: 'failed',
            error: errorMsg,
            updatedAt: now,
          },
        },
      );

      globalSseBroadcaster.broadcast(job._id, {
        type: 'pipeline:fail',
        jobId: job._id,
        status: 'failed',
        error: errorMsg,
        timestamp: now.toISOString(),
      });
    } finally {
      this.stopHeartbeat();
    }
  }

  /**
   * Helper to claim and execute a specific job or any eligible job.
   */
  async processJob(jobId?: string): Promise<boolean> {
    const job = await this.claimJob(jobId);
    if (!job) return false;
    await this.executeJob(job);
    return true;
  }
}
