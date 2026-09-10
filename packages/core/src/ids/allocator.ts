/**
 * Stable, monotonic identifiers (docs/DECISIONS.md D-013).
 *
 * Ids are issued by application code, never by a model and never derived from
 * array position. A counter only ever increases, so deleting q7 does not free
 * q7 - the next question is q8. That is what keeps schedule references and
 * practice statistics from silently rebinding to different content after a
 * regeneration.
 */

export type IdPrefix = 'r' | 'q' | 'f';

export interface IdCounters {
  r: number;
  q: number;
  f: number;
}

export const ID_PREFIXES: readonly IdPrefix[] = ['r', 'q', 'f'];

/** r1, q12, f3 - a prefix followed by a positive integer with no leading zero. */
export const ID_PATTERN = /^([rqf])([1-9][0-9]*)$/;

export function parseId(id: string): { prefix: IdPrefix; n: number } | null {
  const match = ID_PATTERN.exec(id);
  if (match === null) return null;
  const prefix = match[1] as IdPrefix;
  const n = Number(match[2]);
  return { prefix, n };
}

export class IdAllocator {
  #counters: IdCounters;

  constructor(counters: Partial<IdCounters> = {}) {
    this.#counters = {
      r: Math.max(0, Math.trunc(counters.r ?? 0)),
      q: Math.max(0, Math.trunc(counters.q ?? 0)),
      f: Math.max(0, Math.trunc(counters.f ?? 0)),
    };
  }

  /** Issue the next id for a prefix. Never returns a previously issued id. */
  next(prefix: IdPrefix): string {
    const value = this.#counters[prefix] + 1;
    this.#counters[prefix] = value;
    return `${prefix}${value}`;
  }

  nextRequirement(): string {
    return this.next('r');
  }

  nextQuestion(): string {
    return this.next('q');
  }

  nextFlashcard(): string {
    return this.next('f');
  }

  observe(id: string): void {
    const parsed = parseId(id);
    if (parsed && parsed.n > this.#counters[parsed.prefix]) {
      this.#counters[parsed.prefix] = parsed.n;
    }
  }

  /** Current high-water marks, safe to persist and rehydrate from. */
  counters(): IdCounters {
    return { ...this.#counters };
  }

  /**
   * Rebuild an allocator whose counters sit at or above every id supplied.
   * Used when loading a stored kit so regeneration cannot reissue an old id.
   */
  static fromIds(ids: Iterable<string>): IdAllocator {
    const counters: IdCounters = { r: 0, q: 0, f: 0 };
    for (const id of ids) {
      const parsed = parseId(id);
      if (parsed === null) continue;
      if (parsed.n > counters[parsed.prefix]) counters[parsed.prefix] = parsed.n;
    }
    return new IdAllocator(counters);
  }
}
