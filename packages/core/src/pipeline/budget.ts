/**
 * Pipeline deadline and execution budget (docs/PIPELINE.md section 7).
 *
 * A Deadline object is threaded through the pipeline to track remaining wall-clock
 * budget, record stage execution times, and enforce bounded execution.
 * Stages 9 (public search) and 14 (coverage second pass) are the first eligible
 * for degradation when the remaining budget is tight.
 */

export interface DeadlineOptions {
  /** Overall pipeline budget in milliseconds. Default: 150,000 ms. */
  budgetMs?: number;
  /** Injectable monotonic clock returning milliseconds (default: Date.now). */
  monotonic?: () => number;
  /** Injectable date clock returning Date (default: new Date). */
  clock?: () => Date;
}

export class Deadline {
  readonly budgetMs: number;
  readonly startedAt: number;
  readonly #monotonic: () => number;
  readonly #clock: () => Date;

  constructor(options: DeadlineOptions = {}) {
    this.budgetMs = options.budgetMs ?? 150_000;
    this.#monotonic = options.monotonic ?? (() => Date.now());
    this.#clock = options.clock ?? (() => new Date());
    this.startedAt = this.#monotonic();
  }

  get deadline(): number {
    return this.startedAt + this.budgetMs;
  }

  remainingMs(): number {
    return Math.max(0, this.deadline - this.#monotonic());
  }

  isExpired(): boolean {
    return this.remainingMs() <= 0;
  }

  hasRemaining(neededMs: number): boolean {
    return this.remainingMs() >= neededMs;
  }

  elapsedMs(): number {
    return this.#monotonic() - this.startedAt;
  }

  nowDate(): Date {
    return this.#clock();
  }

  monotonicNow(): number {
    return this.#monotonic();
  }
}
