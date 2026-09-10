import { describe, expect, it } from 'vitest';
import { IdAllocator, parseId } from '../src/ids/allocator.js';

describe('parseId', () => {
  it.each([
    ['r1', 'r', 1],
    ['q12', 'q', 12],
    ['f307', 'f', 307],
  ])('parses %s', (id, prefix, n) => {
    expect(parseId(id)).toEqual({ prefix, n });
  });

  it.each(['r0', 'r01', 'x1', 'r', '1', 'r1.5', 'R1', '', 'q-1'])('rejects %s', (id) => {
    expect(parseId(id)).toBeNull();
  });
});

describe('IdAllocator', () => {
  it('issues r1, q1, f1 from a fresh allocator', () => {
    const ids = new IdAllocator();
    expect(ids.nextRequirement()).toBe('r1');
    expect(ids.nextQuestion()).toBe('q1');
    expect(ids.nextFlashcard()).toBe('f1');
  });

  it('increments each prefix independently', () => {
    const ids = new IdAllocator();
    expect([ids.next('q'), ids.next('q'), ids.next('r'), ids.next('q')]).toEqual([
      'q1',
      'q2',
      'r1',
      'q3',
    ]);
  });

  it('never reuses an id after the item is deleted', () => {
    const ids = new IdAllocator();
    const issued = [1, 2, 3, 4, 5].map(() => ids.nextQuestion());
    expect(issued).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);

    // The caller deletes q3. The counter is unaffected by deletion.
    const survivors = issued.filter((id) => id !== 'q3');
    const afterDelete = ids.nextQuestion();

    expect(afterDelete).toBe('q6');
    expect(survivors).not.toContain(afterDelete);
    expect(issued).not.toContain(afterDelete);
  });

  it('reports counters that can be persisted and rehydrated', () => {
    const first = new IdAllocator();
    first.nextQuestion();
    first.nextQuestion();
    first.nextRequirement();

    const rehydrated = new IdAllocator(first.counters());
    expect(rehydrated.nextQuestion()).toBe('q3');
    expect(rehydrated.nextRequirement()).toBe('r2');
    expect(rehydrated.nextFlashcard()).toBe('f1');
  });

  it('counters() returns a copy, so callers cannot mutate internal state', () => {
    const ids = new IdAllocator();
    const snapshot = ids.counters();
    snapshot.q = 999;
    expect(ids.nextQuestion()).toBe('q1');
  });

  it('rebuilds above the highest id seen, so regeneration cannot reissue', () => {
    const ids = IdAllocator.fromIds(['q1', 'q7', 'q3', 'r2', 'f11', 'not-an-id']);
    expect(ids.nextQuestion()).toBe('q8');
    expect(ids.nextRequirement()).toBe('r3');
    expect(ids.nextFlashcard()).toBe('f12');
  });

  it('rebuilds to zero from an empty or unusable id list', () => {
    const ids = IdAllocator.fromIds(['bogus', '']);
    expect(ids.nextQuestion()).toBe('q1');
  });

  it('ignores negative or fractional seed counters', () => {
    const ids = new IdAllocator({ q: -5, r: 2.9 });
    expect(ids.nextQuestion()).toBe('q1');
    expect(ids.nextRequirement()).toBe('r3');
  });

  it('is deterministic: the same call sequence yields the same ids', () => {
    const run = () => {
      const ids = new IdAllocator({ q: 4 });
      return [ids.next('q'), ids.next('f'), ids.next('q')];
    };
    expect(run()).toEqual(run());
  });
});
