/**
 * Cross-reference invariants - the checks a schema alone cannot express.
 *
 * Zod proves each object is individually well formed. These rules prove the
 * kit is internally consistent: ids are unique, every reference resolves, the
 * schedule matches the requested horizon, and no must-have requirement has
 * been quietly dropped.
 */
import { KitValidationError, type KitIssue } from '../errors.js';
import { DAY_MAX_MINUTES, DAY_MIN_MINUTES } from '../constants.js';
import { kitSchema, type Kit } from './kit.js';

export interface ValidateOptions {
  /** When supplied, the schedule must match this exact day count. */
  requestedDays?: number;
}

export type ValidationResult =
  | { ok: true; kit: Kit; issues: readonly [] }
  | { ok: false; issues: readonly KitIssue[] };

/** Structural (Zod) issues, mapped into our own issue shape. */
function structuralIssues(input: unknown): { kit?: Kit; issues: KitIssue[] } {
  const parsed = kitSchema.safeParse(input);
  if (parsed.success) return { kit: parsed.data, issues: [] };
  return {
    issues: parsed.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      code: `schema.${issue.code}`,
      message: issue.message,
    })),
  };
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? String(segment) : `.${String(segment)}`;
  }
  return out === '' ? '(root)' : out;
}

/**
 * Checks that need the whole kit in view. Assumes `kit` already parsed
 * cleanly, so it can rely on field types.
 */
export function checkKitInvariants(kit: Kit, options: ValidateOptions = {}): KitIssue[] {
  const issues: KitIssue[] = [];
  const add = (path: string, code: string, message: string) =>
    issues.push({ path, code, message });

  const requirementIds = new Set<string>();
  for (const [index, requirement] of kit.role.requirements.entries()) {
    if (requirementIds.has(requirement.id)) {
      add(
        `role.requirements[${index}].id`,
        'duplicate_id',
        `requirement id ${requirement.id} appears more than once`,
      );
    }
    requirementIds.add(requirement.id);
  }

  const questionIds = new Set<string>();
  for (const [index, question] of kit.questions.entries()) {
    if (questionIds.has(question.id)) {
      add(
        `questions[${index}].id`,
        'duplicate_id',
        `question id ${question.id} appears more than once`,
      );
    }
    questionIds.add(question.id);

    for (const [refIndex, ref] of question.requirement_ids.entries()) {
      if (!requirementIds.has(ref)) {
        add(
          `questions[${index}].requirement_ids[${refIndex}]`,
          'unknown_requirement_ref',
          `question ${question.id} references requirement ${ref}, which does not exist`,
        );
      }
    }
  }

  const flashcardIds = new Set<string>();
  for (const [index, flashcard] of kit.flashcards.entries()) {
    if (flashcardIds.has(flashcard.id)) {
      add(
        `flashcards[${index}].id`,
        'duplicate_id',
        `flashcard id ${flashcard.id} appears more than once`,
      );
    }
    flashcardIds.add(flashcard.id);

    for (const [refIndex, ref] of flashcard.requirement_ids.entries()) {
      if (!requirementIds.has(ref)) {
        add(
          `flashcards[${index}].requirement_ids[${refIndex}]`,
          'unknown_requirement_ref',
          `flashcard ${flashcard.id} references requirement ${ref}, which does not exist`,
        );
      }
    }
  }

  // --- schedule ----------------------------------------------------------
  const { schedule } = kit;

  if (schedule.days.length !== schedule.days_available) {
    add(
      'schedule.days',
      'schedule_day_count',
      `schedule has ${schedule.days.length} day(s) but days_available is ${schedule.days_available}`,
    );
  }

  if (
    options.requestedDays !== undefined &&
    schedule.days_available !== options.requestedDays
  ) {
    add(
      'schedule.days_available',
      'days_mismatch',
      `days_available is ${schedule.days_available} but ${options.requestedDays} day(s) were requested`,
    );
  }

  const scheduledQuestionIds = new Set<string>();
  for (const [index, day] of schedule.days.entries()) {
    if (day.day !== index + 1) {
      add(
        `schedule.days[${index}].day`,
        'schedule_day_numbering',
        `expected day ${index + 1}, found ${day.day}`,
      );
    }
    if (day.minutes < DAY_MIN_MINUTES || day.minutes > DAY_MAX_MINUTES) {
      add(
        `schedule.days[${index}].minutes`,
        'minutes_out_of_bounds',
        `minutes ${day.minutes} is outside the documented range ${DAY_MIN_MINUTES}-${DAY_MAX_MINUTES}`,
      );
    }
    for (const [refIndex, ref] of day.question_ids.entries()) {
      if (!questionIds.has(ref)) {
        add(
          `schedule.days[${index}].question_ids[${refIndex}]`,
          'unknown_question_ref',
          `day ${day.day} references question ${ref}, which does not exist`,
        );
      }
      scheduledQuestionIds.add(ref);
    }
  }

  // Every must-have requirement must be reachable from the schedule.
  const questionsById = new Map(kit.questions.map((q) => [q.id, q]));
  const scheduledRequirementIds = new Set<string>();
  for (const id of scheduledQuestionIds) {
    for (const ref of questionsById.get(id)?.requirement_ids ?? []) {
      scheduledRequirementIds.add(ref);
    }
  }
  for (const [index, requirement] of kit.role.requirements.entries()) {
    if (requirement.priority === 'must' && !scheduledRequirementIds.has(requirement.id)) {
      add(
        `role.requirements[${index}]`,
        'must_requirement_not_scheduled',
        `must-have requirement ${requirement.id} does not appear anywhere in the schedule`,
      );
    }
  }

  // --- coverage ----------------------------------------------------------
  const mustIds = new Set(
    kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id),
  );
  for (const [index, id] of kit.coverage.uncovered_requirement_ids.entries()) {
    if (!requirementIds.has(id)) {
      add(
        `coverage.uncovered_requirement_ids[${index}]`,
        'unknown_requirement_ref',
        `coverage references requirement ${id}, which does not exist`,
      );
    }
    if (mustIds.has(id)) {
      add(
        `coverage.uncovered_requirement_ids[${index}]`,
        'uncovered_contains_must',
        `must-have requirement ${id} is reported as uncovered; a final kit must not knowingly leave one uncovered`,
      );
    }
  }

  return issues;
}

/** Parse and cross-check. Never throws. */
export function validateKit(
  input: unknown,
  options: ValidateOptions = {},
): ValidationResult {
  const structural = structuralIssues(input);
  if (structural.kit === undefined) {
    return { ok: false, issues: structural.issues };
  }
  const issues = checkKitInvariants(structural.kit, options);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, kit: structural.kit, issues: [] };
}

/** Parse and cross-check, throwing KitValidationError on any issue. */
export function assertValidKit(input: unknown, options: ValidateOptions = {}): Kit {
  const result = validateKit(input, options);
  if (!result.ok) throw new KitValidationError(result.issues);
  return result.kit;
}
