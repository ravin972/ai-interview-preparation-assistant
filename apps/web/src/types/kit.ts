export type RequirementKind = 'technical' | 'behavioural' | 'domain';
export type RequirementPriority = 'must' | 'nice';
export type QuestionCategory =
  'technical' | 'behavioural' | 'system-design' | 'company-fit';
export type QuestionDifficulty = 1 | 2 | 3;
export type ItemOrigin = 'generated' | 'manual';
export type KitStatus = 'generating' | 'ready' | 'failed';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StageStatus = 'started' | 'completed' | 'degraded' | 'skipped' | 'failed';
export type PracticeConfidence = 'low' | 'medium' | 'high';
export type ReadinessStatus = 'unprepared' | 'needs_practice' | 'ready';

export interface UserDto {
  id: string;
  email: string;
}

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  evidence_quote?: string | undefined;
}

export interface Question {
  id: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  prompt: string;
  answer_outline: string;
  requirement_ids: string[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
}

export interface ScheduleDay {
  day: number;
  focus: string;
  minutes: number;
  question_ids: string[];
}

export interface Schedule {
  days_available: number;
  days: ScheduleDay[];
}

export interface Coverage {
  uncovered_requirement_ids: string[];
  passes: number;
}

export interface CompanyBrief {
  company_name: string;
  summary: string;
  mission_or_focus: string;
  tech_stack_hints: string[];
  hiring_signals: string[];
  culture_notes: string[];
  sources: string[];
}

export interface KitSource {
  jd_chars: number;
  company_url: string;
  company: string;
  role: string;
  researched_at: string;
  pages_used: string[];
}

export interface Role {
  title: string;
  seniority: string;
  overview: string;
  responsibilities: string[];
  requirements: Requirement[];
}

export interface CanonicalKit {
  source: KitSource;
  company_brief: CompanyBrief;
  role: Role;
  questions: Question[];
  flashcards: Flashcard[];
  schedule: Schedule;
  coverage: Coverage;
}

export interface ItemMeta {
  origin: ItemOrigin;
  edited: boolean;
  pinned: boolean;
  fingerprint: string;
  editedAt: string | null;
}

export interface Tombstone {
  fingerprint: string;
  at: string;
}

export interface ResearchPageUsed {
  url: string;
  title: string;
  status: number;
  chars: number;
}

export interface ResearchGap {
  stage: string;
  reason: string;
}

export interface KitResearch {
  pagesUsed: ResearchPageUsed[];
  gaps: ResearchGap[];
  robotsBlocked: string[];
  injectionFlags: string[];
}

export interface KitSummaryDto {
  id: string;
  status: KitStatus;
  role: { title: string; seniority: string } | null;
  company: string | null;
  days: number;
  createdAt: string;
  updatedAt: string;
}

export interface KitDetailDto {
  id: string;
  status: KitStatus;
  version: number;
  input: {
    jd: string;
    company_url: string;
    days: number;
  };
  kit: CanonicalKit | null;
  itemMeta: Record<string, ItemMeta>;
  tombstones: {
    questions: Tombstone[];
    flashcards: Tombstone[];
  };
  research: KitResearch;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageRecord {
  n: number;
  name: string;
  status: StageStatus;
  ms: number;
  detail?: string | undefined;
}

export interface JobDto {
  id: string;
  kitId: string;
  status: JobStatus;
  currentStage: number;
  lastCompletedStage: number;
  progress: number;
  stages: StageRecord[];
  error: string | null;
  gaps: ResearchGap[];
  attempt: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardStatDto {
  userId: string;
  kitId: string;
  cardId: string;
  attempts: number;
  lastConfidence: PracticeConfidence;
  confidenceScore: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeSessionDto {
  cards: Flashcard[];
  stats: Record<string, CardStatDto>;
  summary: {
    total: number;
    covered: number;
    uncovered: number;
  };
}

export interface WeakSpotDto {
  requirementId: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  questionCount: number;
  flashcardCount: number;
  practicedCardCount: number;
  confidenceScore: number;
  readinessScore: number;
  status: ReadinessStatus;
  mustHaveRisk: boolean;
}

export interface SseEventPayload {
  type: string;
  jobId: string;
  stage?: number;
  stageName?: string;
  progress?: number;
  status?: JobStatus;
  timestamp?: string;
  detail?: string;
  error?: string;
  stages?: StageRecord[];
  currentStage?: number;
  lastCompletedStage?: number;
  gaps?: ResearchGap[];
}
