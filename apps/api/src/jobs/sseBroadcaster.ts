import type { JobStatus } from '../db/types.js';

export interface SseBroadcastEvent {
  type: string;
  jobId: string;
  stage?: number | undefined;
  stageName?: string | undefined;
  progress?: number | undefined;
  status: JobStatus;
  timestamp: string;
  detail?: string | undefined;
  error?: string | undefined;
  gaps?: string[] | undefined;
}

export type SseListener = (payload: string) => void;

export class SseBroadcaster {
  private readonly listeners = new Map<string, Set<SseListener>>();

  subscribe(jobId: string, listener: SseListener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);

    return () => {
      const currentSet = this.listeners.get(jobId);
      if (currentSet) {
        currentSet.delete(listener);
        if (currentSet.size === 0) {
          this.listeners.delete(jobId);
        }
      }
    };
  }

  broadcast(jobId: string, event: SseBroadcastEvent): void {
    const set = this.listeners.get(jobId);
    if (!set || set.size === 0) return;

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // Individual listener failure should not break broadcasting to others
      }
    }
  }

  getSubscriberCount(jobId: string): number {
    return this.listeners.get(jobId)?.size ?? 0;
  }
}

export const globalSseBroadcaster = new SseBroadcaster();
