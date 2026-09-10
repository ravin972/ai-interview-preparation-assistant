import type { Db } from 'mongodb';
import type { ProgressSink, StageEvent } from '@kit/core';
import type { JobDoc } from '../db/types.js';
import { globalSseBroadcaster, SseBroadcaster } from './sseBroadcaster.js';

export class JobProgressSink implements ProgressSink {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly jobId: string,
    private readonly broadcaster: SseBroadcaster = globalSseBroadcaster,
  ) {}

  emit(event: StageEvent): void {
    this.queue = this.queue
      .then(() => this.handleEvent(event))
      .catch((err) => {
        const isClosed =
          err instanceof Error &&
          (err.name === 'MongoClientClosedError' ||
            err.name === 'MongoPoolClosedError' ||
            err.message.includes('Topology is closed') ||
            err.message.includes('closed connection pool') ||
            err.message.includes('ended') ||
            err.message.includes('client was closed'));
        if (!isClosed) {
          console.error(
            `[JobProgressSink] Error handling event for job ${this.jobId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private async handleEvent(event: StageEvent): Promise<void> {
    const now = new Date().toISOString();
    const jobs = this.db.collection<JobDoc>('jobs');

    if (event.type === 'stage:start') {
      const progress = Math.round(((event.stage - 1) / 16) * 100);

      await jobs.updateOne(
        { _id: this.jobId, status: 'running' },
        {
          $set: {
            currentStage: event.stage,
            progress,
            updatedAt: new Date(),
          },
        },
      );

      this.broadcaster.broadcast(this.jobId, {
        type: 'stage:start',
        jobId: this.jobId,
        stage: event.stage,
        stageName: event.name,
        progress,
        status: 'running',
        timestamp: event.timestamp || now,
      });
      return;
    }

    if (
      event.type === 'stage:complete' ||
      event.type === 'stage:degraded' ||
      event.type === 'stage:skip'
    ) {
      const progress = Math.round((event.stage / 16) * 100);

      await jobs.updateOne(
        { _id: this.jobId, status: 'running' },
        {
          $set: {
            currentStage: event.stage,
            lastCompletedStage: event.stage,
            progress,
            updatedAt: new Date(),
          },
          $push: {
            stages: event.record,
          },
        },
      );

      this.broadcaster.broadcast(this.jobId, {
        type: event.type,
        jobId: this.jobId,
        stage: event.stage,
        stageName: event.name,
        progress,
        status: 'running',
        timestamp: event.record.finishedAt || now,
        detail: event.record.detail,
      });
      return;
    }

    if (event.type === 'stage:fail') {
      await jobs.updateOne(
        { _id: this.jobId, status: 'running' },
        {
          $set: {
            currentStage: event.stage,
            updatedAt: new Date(),
          },
          $push: {
            stages: event.record,
          },
        },
      );

      this.broadcaster.broadcast(this.jobId, {
        type: 'stage:fail',
        jobId: this.jobId,
        stage: event.stage,
        stageName: event.name,
        status: 'running',
        timestamp: event.record.finishedAt || now,
        error: event.error,
      });
      return;
    }

    if (event.type === 'pipeline:complete') {
      this.broadcaster.broadcast(this.jobId, {
        type: 'pipeline:complete',
        jobId: this.jobId,
        progress: 100,
        status: 'completed',
        timestamp: now,
      });
    }
  }
}
