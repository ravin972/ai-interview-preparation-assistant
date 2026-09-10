import type { Db } from 'mongodb';
import type { Checkpoint, CheckpointStore } from '@kit/core';
import type { JobDoc } from '../db/types.js';

export class MongoCheckpointStore implements CheckpointStore {
  constructor(private readonly db: Db) {}

  async load(jobId: string): Promise<Checkpoint | null> {
    const job = await this.db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    if (!job || !job.checkpoint) {
      return null;
    }
    return {
      jobId: job.checkpoint.jobId,
      lastCompletedStage: job.checkpoint.lastCompletedStage,
      updatedAt: job.checkpoint.updatedAt,
      data: { ...(job.checkpoint.data ?? {}) },
    };
  }

  async save(
    jobId: string,
    stage: number,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.load(jobId);
    const now = new Date().toISOString();

    const mergedData = {
      ...(existing?.data ?? {}),
      ...patch,
    };

    const checkpoint: Checkpoint = {
      jobId,
      lastCompletedStage: stage,
      updatedAt: now,
      data: mergedData,
    };

    await this.db.collection<JobDoc>('jobs').updateOne(
      { _id: jobId },
      {
        $set: {
          checkpoint,
          lastCompletedStage: stage,
          updatedAt: new Date(),
        },
      },
    );
  }
}
