/**
 * Canonical projection - reduce anything kit-shaped to exactly Appendix A.
 *
 * Builder state (origin, edited, pinned, fingerprints, tombstones,
 * checkpoints) lives beside the kit, never inside it (docs/DECISIONS.md D-008).
 * This function is the single export boundary: it picks known fields
 * explicitly, so an unknown field cannot leak no matter what the caller holds.
 * Fields are written in Appendix A order, so serialised output matches too.
 */
import type {
  CompanyBrief,
  Coverage,
  Flashcard,
  Kit,
  KitSource,
  Question,
  Requirement,
  Role,
  Schedule,
  ScheduleDay,
} from './kit.js';

/** Appendix A key order, used by the projection and asserted by tests. */
export const CANONICAL_KIT_KEYS = [
  'source',
  'company_brief',
  'role',
  'questions',
  'flashcards',
  'schedule',
  'coverage',
] as const;

export const CANONICAL_KEYS = {
  kit: CANONICAL_KIT_KEYS,
  source: [
    'company',
    'company_url',
    'role',
    'location',
    'jd_chars',
    'researched_at',
    'pages_used',
  ],
  company_brief: ['summary', 'what_they_do', 'sources'],
  role: ['title', 'seniority', 'responsibilities', 'requirements'],
  requirement: ['id', 'text', 'kind', 'priority'],
  question: [
    'id',
    'requirement_ids',
    'category',
    'prompt',
    'answer_outline',
    'difficulty',
  ],
  flashcard: ['id', 'front', 'back', 'requirement_ids'],
  schedule: ['days_available', 'days'],
  schedule_day: ['day', 'focus', 'question_ids', 'minutes'],
  coverage: ['uncovered_requirement_ids', 'passes'],
} as const;

function canonicalSource(source: KitSource): KitSource {
  return {
    company: source.company,
    company_url: source.company_url,
    role: source.role,
    location: source.location,
    jd_chars: source.jd_chars,
    researched_at: source.researched_at,
    pages_used: [...source.pages_used],
  };
}

function canonicalBrief(brief: CompanyBrief): CompanyBrief {
  return {
    summary: brief.summary,
    what_they_do: brief.what_they_do,
    sources: [...brief.sources],
  };
}

function canonicalRequirement(requirement: Requirement): Requirement {
  return {
    id: requirement.id,
    text: requirement.text,
    kind: requirement.kind,
    priority: requirement.priority,
  };
}

function canonicalRole(role: Role): Role {
  return {
    title: role.title,
    seniority: role.seniority,
    responsibilities: [...role.responsibilities],
    requirements: role.requirements.map(canonicalRequirement),
  };
}

export function canonicalQuestion(question: Question): Question {
  return {
    id: question.id,
    requirement_ids: [...question.requirement_ids],
    category: question.category,
    prompt: question.prompt,
    answer_outline: question.answer_outline,
    difficulty: question.difficulty,
  };
}

export function canonicalFlashcard(flashcard: Flashcard): Flashcard {
  return {
    id: flashcard.id,
    front: flashcard.front,
    back: flashcard.back,
    requirement_ids: [...flashcard.requirement_ids],
  };
}

function canonicalScheduleDay(day: ScheduleDay): ScheduleDay {
  return {
    day: day.day,
    focus: day.focus,
    question_ids: [...day.question_ids],
    minutes: day.minutes,
  };
}

function canonicalSchedule(schedule: Schedule): Schedule {
  return {
    days_available: schedule.days_available,
    days: schedule.days.map(canonicalScheduleDay),
  };
}

function canonicalCoverage(coverage: Coverage): Coverage {
  return {
    uncovered_requirement_ids: [...coverage.uncovered_requirement_ids],
    passes: coverage.passes,
  };
}

/**
 * Project to the exact Appendix A shape. Accepts a kit carrying extra
 * properties (TypeScript permits that for non-literal arguments) and drops
 * every one of them.
 */
export function canonicalKit(kit: Kit): Kit {
  return {
    source: canonicalSource(kit.source),
    company_brief: canonicalBrief(kit.company_brief),
    role: canonicalRole(kit.role),
    questions: kit.questions.map(canonicalQuestion),
    flashcards: kit.flashcards.map(canonicalFlashcard),
    schedule: canonicalSchedule(kit.schedule),
    coverage: canonicalCoverage(kit.coverage),
  };
}
