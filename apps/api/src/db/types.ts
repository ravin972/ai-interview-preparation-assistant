import type { ObjectId } from 'mongodb';
import type { Checkpoint, Kit, StageRecord } from '@kit/core';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ItemMeta {
  origin: 'generated' | 'manual';
  edited: boolean;
  pinned: boolean;
  fingerprint: string;
  editedAt: string | null;
}

export interface Tombstone {
  fingerprint: string;
  at: string;
}

export interface KitDoc {
  _id: string;
  userId: string;
  status: 'generating' | 'ready' | 'failed';
  version: number;
  inputHash: string;
  input: {
    jd: string;
    company_url: string;
    days: number;
  };
  kit?: Kit;
  idCounters: {
    r: number;
    q: number;
    f: number;
  };
  itemMeta: Record<string, ItemMeta>;
  tombstones: {
    questions: Tombstone[];
    flashcards: Tombstone[];
  };
  research: {
    pagesUsed: string[];
    gaps: string[];
    robotsBlocked: string[];
    injectionFlags: string[];
  };
  regeneratingScope?: string | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobDoc {
  _id: string;
  userId: string;
  kitId: string;
  type: 'generate_kit' | 'regenerate_scope';
  scope?: string;
  status: JobStatus;
  currentStage: number;
  lastCompletedStage: number;
  stages: StageRecord[];
  checkpoint?: Checkpoint;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  attempt: number;
  maxAttempts: number;
  progress: number;
  error: string | null;
  gaps: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CardStatDoc {
  _id: ObjectId;
  userId: string;
  kitId: string;
  cardId: string;
  attempts: number;
  lastConfidence: 'low' | 'medium' | 'high';
  confidenceScore: number; // 0..1 EWMA
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
