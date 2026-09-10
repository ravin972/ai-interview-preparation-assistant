/**
 * Deterministic study schedule (docs/PIPELINE.md section 6).
 *
 * A pure function of (days, questions, requirements). The model has no say in
 * allocation, day count or minutes. Same input, same output, always.
 */
import {
  CATEGORY_LABEL,
  CATEGORY_PRECEDENCE,
  CATEGORY_WEIGHT,
  DAY_MAX_MINUTES,
  DAY_MIN_MINUTES,
  MAX_DAYS,
  MIN_DAYS,
  REVIEW_WINDOW,
  minutesForDifficulty,
} from '../constants.js';
import { InvalidDaysError, ScheduleInvariantError, type KitIssue } from '../errors.js';
import type {
  Question,
  QuestionCategory,
  Requirement,
  Schedule,
  ScheduleDay,
} from '../schema/kit.js';

export interface BuildScheduleInput {
  /** Unvalidated on purpose - validateDays owns the contract. */
  days: unknown;
  questions: readonly Question[];
  requirements: readonly Requirement[];
}

/**
 * docs/DECISIONS.md D-023. An integer from 1 to 60 inclusive. Everything else
 * is rejected: no clamping, no coercion, no silent repair.
 */
export function validateDays(value: unknown): number {
  if (value === undefined) throw new InvalidDaysError(value, 'value is missing');
  if (value === null) throw new InvalidDaysError(value, 'value is null');
  if (typeof value !== 'number') {
    throw new InvalidDaysError(value, `expected a number, received ${typeof value}`);
  }
  if (!Number.isFinite(value)) throw new InvalidDaysError(value, 'value is not finite');
  if (!Number.isInteger(value))
    throw new InvalidDaysError(value, 'value is not an integer');
  if (value < MIN_DAYS) {
    throw new InvalidDaysError(value, `below the minimum of ${MIN_DAYS}`);
  }
  if (value > MAX_DAYS) {
    throw new InvalidDaysError(
      value,
      `above the maximum of ${MAX_DAYS}; out-of-range values are rejected, never clamped`,
    );
  }
  return value;
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is out of bounds (length ${items.length})`);
  }
  return value;
}

function numericSuffix(id: string): number {
  const parsed = Number(id.slice(1));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/**
 * Higher scores are studied earlier. Must-have coverage dominates, difficulty
 * breaks that tie, and category weight breaks the remainder.
 */
export function scoreQuestion(question: Question, mustIds: ReadonlySet<string>): number {
  let mustCount = 0;
  for (const id of question.requirement_ids) {
    if (mustIds.has(id)) mustCount += 1;
  }
  return 10 * mustCount + 3 * question.difficulty + CATEGORY_WEIGHT[question.category];
}

/** A total, reproducible order: score descending, then id ascending. */
export function orderQuestions(
  questions: readonly Question[],
  requirements: readonly Requirement[],
): Question[] {
  const mustIds = new Set(
    requirements.filter((r) => r.priority === 'must').map((r) => r.id),
  );
  return [...questions].sort((a, b) => {
    const delta = scoreQuestion(b, mustIds) - scoreQuestion(a, mustIds);
    if (delta !== 0) return delta;
    return numericSuffix(a.id) - numericSuffix(b.id);
  });
}

function dominantCategory(questions: readonly Question[]): QuestionCategory {
  const counts = new Map<QuestionCategory, number>();
  for (const question of questions) {
    counts.set(question.category, (counts.get(question.category) ?? 0) + 1);
  }
  let best = at(CATEGORY_PRECEDENCE, 0);
  let bestCount = -1;
  // Precedence order plus a strict comparison makes ties resolve to the
  // earliest listed category, which keeps focus text stable across runs.
  for (const category of CATEGORY_PRECEDENCE) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function truncateWords(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[.;:,]+$/, '')}...`;
}

function focusFor(
  dayQuestions: readonly Question[],
  requirementsById: ReadonlyMap<string, Requirement>,
  isReviewDay: boolean,
): string {
  if (dayQuestions.length === 0) return 'Orientation and self-review';

  const label = CATEGORY_LABEL[dominantCategory(dayQuestions)];
  const referenced: Requirement[] = [];
  const seen = new Set<string>();
  for (const question of dayQuestions) {
    for (const id of question.requirement_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const requirement = requirementsById.get(id);
      if (requirement !== undefined) referenced.push(requirement);
    }
  }

  const lead = referenced.find((r) => r.priority === 'must') ?? referenced[0];
  const base = lead === undefined ? label : `${label}: ${truncateWords(lead.text, 48)}`;
  return isReviewDay ? `Review - ${base}` : base;
}

/**
 * Split the ordered questions across exactly `days` buckets.
 *
 * When there are at least as many questions as days, the list is cut into
 * contiguous chunks with the larger chunks first, so the highest-scoring
 * material lands on day 1 by construction. When questions are scarce, each
 * gets its own day and the surplus days re-list a rotating window of earlier
 * questions as spaced review - so a day is never empty unless the kit has no
 * questions at all.
 */
function allocate(ordered: readonly Question[], days: number): Question[][] {
  const buckets: Question[][] = [];
  const n = ordered.length;

  if (n === 0) {
    for (let day = 0; day < days; day += 1) buckets.push([]);
    return buckets;
  }

  if (n >= days) {
    const base = Math.floor(n / days);
    const remainder = n % days;
    let cursor = 0;
    for (let day = 0; day < days; day += 1) {
      const size = base + (day < remainder ? 1 : 0);
      buckets.push(ordered.slice(cursor, cursor + size));
      cursor += size;
    }
    return buckets;
  }

  for (let day = 0; day < n; day += 1) buckets.push([at(ordered, day)]);

  const window = Math.min(REVIEW_WINDOW, n);
  for (let k = 0; buckets.length < days; k += 1) {
    const start = (k * window) % n;
    const bucket: Question[] = [];
    for (let offset = 0; offset < window; offset += 1) {
      bucket.push(at(ordered, (start + offset) % n));
    }
    buckets.push(bucket);
  }
  return buckets;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertPostconditions(
  schedule: Schedule,
  requestedDays: number,
  questions: readonly Question[],
  requirements: readonly Requirement[],
): void {
  const issues: KitIssue[] = [];
  const add = (path: string, code: string, message: string) =>
    issues.push({ path, code, message });

  if (schedule.days.length !== requestedDays) {
    add(
      'schedule.days',
      'schedule_day_count',
      `produced ${schedule.days.length} day(s) for a ${requestedDays}-day request`,
    );
  }
  if (schedule.days_available !== requestedDays) {
    add(
      'schedule.days_available',
      'days_mismatch',
      `days_available is ${schedule.days_available} for a ${requestedDays}-day request`,
    );
  }

  const questionIds = new Set(questions.map((q) => q.id));
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const scheduledRequirements = new Set<string>();

  for (const [index, day] of schedule.days.entries()) {
    if (day.day !== index + 1) {
      add(
        `schedule.days[${index}].day`,
        'schedule_day_numbering',
        `expected day ${index + 1}, produced ${day.day}`,
      );
    }
    if (!Number.isInteger(day.minutes)) {
      add(
        `schedule.days[${index}].minutes`,
        'minutes_not_integer',
        `minutes ${day.minutes} is not an integer`,
      );
    }
    if (day.minutes < DAY_MIN_MINUTES || day.minutes > DAY_MAX_MINUTES) {
      add(
        `schedule.days[${index}].minutes`,
        'minutes_out_of_bounds',
        `minutes ${day.minutes} is outside ${DAY_MIN_MINUTES}-${DAY_MAX_MINUTES}`,
      );
    }
    for (const id of day.question_ids) {
      if (!questionIds.has(id)) {
        add(
          `schedule.days[${index}].question_ids`,
          'unknown_question_ref',
          `day ${day.day} references question ${id}, which does not exist`,
        );
        continue;
      }
      for (const ref of questionsById.get(id)?.requirement_ids ?? []) {
        scheduledRequirements.add(ref);
      }
    }
  }

  for (const requirement of requirements) {
    if (requirement.priority === 'must' && !scheduledRequirements.has(requirement.id)) {
      add(
        'schedule',
        'must_requirement_not_scheduled',
        `must-have requirement ${requirement.id} does not appear anywhere in the schedule`,
      );
    }
  }

  if (issues.length > 0) throw new ScheduleInvariantError(issues);
}

export function buildSchedule(input: BuildScheduleInput): Schedule {
  const days = validateDays(input.days);
  const requirementsById = new Map(input.requirements.map((r) => [r.id, r]));
  const ordered = orderQuestions(input.questions, input.requirements);
  const buckets = allocate(ordered, days);
  // Days beyond this index exist only because questions ran out.
  const firstReviewDayIndex = ordered.length < days ? ordered.length : days;

  const scheduleDays: ScheduleDay[] = buckets.map((bucket, index) => {
    const rawMinutes = bucket.reduce(
      (total, question) => total + minutesForDifficulty(question.difficulty),
      0,
    );
    return {
      day: index + 1,
      focus: focusFor(bucket, requirementsById, index >= firstReviewDayIndex),
      question_ids: bucket.map((question) => question.id),
      minutes: clamp(rawMinutes, DAY_MIN_MINUTES, DAY_MAX_MINUTES),
    };
  });

  const schedule: Schedule = { days_available: days, days: scheduleDays };
  assertPostconditions(schedule, days, input.questions, input.requirements);
  return schedule;
}
