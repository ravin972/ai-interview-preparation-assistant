/**
 * Checkpoints, Progress Sink, and Stage Observability (docs/PIPELINE.md section 7, docs/ARCHITECTURE.md section 4).
 *
 * Framework-independent interfaces. In-memory implementations for Phase 4;
 * MongoDB implementations belong to apps/api in Phase 5.
 */

export interface StageRecord {
  stage: number;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'degraded' | 'skipped';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  retryCount: number;
  provider?: string;
  detail?: string;
  error?: string;
}

export type StageEvent =
  | { type: 'stage:start'; stage: number; name: string; timestamp: string }
  | { type: 'stage:complete'; stage: number; name: string; record: StageRecord }
  | {
      type: 'stage:degraded';
      stage: number;
      name: string;
      reason: string;
      record: StageRecord;
    }
  | {
      type: 'stage:skip';
      stage: number;
      name: string;
      reason: string;
      record: StageRecord;
    }
  | {
      type: 'stage:fail';
      stage: number;
      name: string;
      error: string;
      record: StageRecord;
    }
  | { type: 'pipeline:complete'; durationMs: number };

export interface ProgressSink {
  emit(event: StageEvent): void;
}

export class InMemoryProgressSink implements ProgressSink {
  readonly events: StageEvent[] = [];

  emit(event: StageEvent): void {
    this.events.push(event);
  }
}

export class NoopProgressSink implements ProgressSink {
  emit(_event: StageEvent): void {
    // no-op
  }
}

export interface Checkpoint {
  jobId: string;
  lastCompletedStage: number;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface CheckpointStore {
  load(jobId: string): Promise<Checkpoint | null>;
  save(jobId: string, stage: number, patch: Record<string, unknown>): Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  readonly #store = new Map<string, Checkpoint>();

  async load(jobId: string): Promise<Checkpoint | null> {
    const cp = this.#store.get(jobId);
    if (!cp) return null;
    return {
      ...cp,
      data: { ...cp.data },
    };
  }

  async save(
    jobId: string,
    stage: number,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const existing = this.#store.get(jobId);
    const updated: Checkpoint = {
      jobId,
      lastCompletedStage: stage,
      updatedAt: new Date().toISOString(),
      data: {
        ...(existing?.data ?? {}),
        ...patch,
      },
    };
    this.#store.set(jobId, updated);
  }
}
