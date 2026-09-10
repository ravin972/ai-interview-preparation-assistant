/**
 * Numeric policy for the deterministic core, in one place so the schema, the
 * schedule builder and the invariant checker cannot drift apart.
 */
import type { QuestionCategory } from './schema/kit.js';

/** docs/DECISIONS.md D-023: days is an integer in this range, never clamped. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

/** docs/DECISIONS.md D-011: a planned day is bounded, and always an integer. */
export const DAY_MIN_MINUTES = 30;
export const DAY_MAX_MINUTES = 180;

/** Study minutes budgeted per question, by difficulty. */
export function minutesForDifficulty(difficulty: number): number {
  switch (difficulty) {
    case 1:
      return 10;
    case 2:
      return 15;
    case 3:
      return 20;
    default:
      throw new RangeError(`difficulty must be 1, 2 or 3, received ${difficulty}`);
  }
}

/**
 * Ordering weight per category. Technical and system-design work benefits most
 * from being met early, so they outrank behavioural preparation; company-fit
 * questions need no rehearsal runway and sort last.
 */
export const CATEGORY_WEIGHT: Readonly<Record<QuestionCategory, number>> = {
  technical: 2,
  'system-design': 2,
  behavioural: 1,
  'company-fit': 0,
};

/** Tie-break order when a day's questions are split evenly across categories. */
export const CATEGORY_PRECEDENCE: readonly QuestionCategory[] = [
  'technical',
  'system-design',
  'behavioural',
  'company-fit',
];

export const CATEGORY_LABEL: Readonly<Record<QuestionCategory, string>> = {
  technical: 'Technical depth',
  'system-design': 'System design',
  behavioural: 'Behavioural and collaboration',
  'company-fit': 'Company fit',
};

/** How many earlier questions a surplus review day re-lists. */
export const REVIEW_WINDOW = 3;

/** docs/PIPELINE.md section 5: at most three generation passes. */
export const MAX_COVERAGE_PASSES = 3;
