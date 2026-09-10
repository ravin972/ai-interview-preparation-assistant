/** Errors raised by the deterministic core. All carry machine-readable detail. */

export interface KitIssue {
  /** Dotted path into the kit, e.g. "schedule.days[3].question_ids[0]". */
  path: string;
  code: string;
  message: string;
}

export class KitValidationError extends Error {
  readonly issues: readonly KitIssue[];

  constructor(issues: readonly KitIssue[]) {
    const summary = issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ');
    const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : '';
    super(`Kit failed validation - ${issues.length} issue(s): ${summary}${more}`);
    this.name = 'KitValidationError';
    this.issues = issues;
  }
}

/**
 * Raised when `days` is not an integer in 1..60 (docs/DECISIONS.md D-023).
 * The value is never clamped or coerced - it is rejected.
 */
export class InvalidDaysError extends Error {
  readonly received: unknown;

  constructor(received: unknown, reason: string) {
    super(
      `Invalid days value: ${reason}. Expected an integer from 1 to 60 inclusive, received ${describe(received)}.`,
    );
    this.name = 'InvalidDaysError';
    this.received = received;
  }
}

/**
 * Raised when the schedule builder produces output that breaks one of its own
 * postconditions. This is always a bug in the allocator, never bad user input.
 */
export class ScheduleInvariantError extends Error {
  readonly issues: readonly KitIssue[];

  constructor(issues: readonly KitIssue[]) {
    super(`Schedule postcondition violated: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'ScheduleInvariantError';
    this.issues = issues;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (typeof value === 'number') return String(value);
  return `${typeof value} ${JSON.stringify(value)}`;
}

/** Raised when the supplied job description is empty or whitespace only. */
export class InvalidJobDescriptionError extends Error {
  readonly received: unknown;

  constructor(reason: string, received: unknown) {
    super(`Invalid job description: ${reason}`);
    this.name = 'InvalidJobDescriptionError';
    this.received = received;
  }
}
