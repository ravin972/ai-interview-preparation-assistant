import { describe, expect, it } from 'vitest';
import { canonicalKit } from '../src/schema/canonical.js';
import { questionSchema, kitSchema } from '../src/schema/kit.js';
import {
  APPENDIX_A_TEMPLATE,
  makeKit,
  makeQuestion,
  makeRequirement,
} from './helpers/kit-fixtures.js';

/**
 * Structural fingerprint: key names only, recursively, leaves erased.
 *
 * Arrays reduce to the shape of their first object element, or to [] when they
 * hold primitives - a list of strings has no keys to compare, so ['a'] and []
 * are the same shape. Only arrays of objects carry structure worth checking.
 */
function keyShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    const firstObject = value.find((item) => item !== null && typeof item === 'object');
    return firstObject === undefined ? [] : [keyShape(firstObject)];
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = keyShape(source[key]);
    return out;
  }
  return null;
}

describe('canonical projection', () => {
  it('matches the Appendix A key shape exactly', () => {
    const kit = makeKit({
      schedule: {
        days_available: 5,
        days: [{ day: 1, focus: 'Technical depth', question_ids: ['q1'], minutes: 60 }],
      },
    });
    expect(keyShape(canonicalKit(kit))).toEqual(keyShape(APPENDIX_A_TEMPLATE));
  });

  it('preserves Appendix A top-level key order', () => {
    expect(Object.keys(canonicalKit(makeKit()))).toEqual(
      Object.keys(APPENDIX_A_TEMPLATE),
    );
  });

  it.each([
    ['origin', 'generated'],
    ['edited', true],
    ['pinned', true],
    ['fingerprint', '9f2c1d4e7a03b5c8'],
    ['tombstones', []],
    ['checkpoint', {}],
  ])('strips builder metadata %s from questions', (key, value) => {
    const annotated = makeKit();
    Object.assign(annotated.questions[0]!, { [key]: value });
    Object.assign(annotated as object, { [key]: value });

    const projected = canonicalKit(annotated);
    expect(Object.keys(projected)).not.toContain(key);
    expect(Object.keys(projected.questions[0]!)).not.toContain(key);
  });

  it('strips metadata from flashcards, requirements and schedule days', () => {
    const annotated = makeKit();
    Object.assign(annotated.flashcards[0]!, { pinned: true });
    Object.assign(annotated.role.requirements[0]!, { evidence_quote: 'React' });
    Object.assign(annotated.schedule.days[0]!, { generatedAt: 'now' });

    const projected = canonicalKit(annotated);
    expect(Object.keys(projected.flashcards[0]!)).toEqual([
      'id',
      'front',
      'back',
      'requirement_ids',
    ]);
    expect(Object.keys(projected.role.requirements[0]!)).toEqual([
      'id',
      'text',
      'kind',
      'priority',
    ]);
    expect(Object.keys(projected.schedule.days[0]!)).toEqual([
      'day',
      'focus',
      'question_ids',
      'minutes',
    ]);
  });

  it('a projected kit passes strict schema parsing', () => {
    expect(kitSchema.safeParse(canonicalKit(makeKit())).success).toBe(true);
  });

  it('copies arrays so later mutation cannot reach the projection', () => {
    const kit = makeKit();
    const projected = canonicalKit(kit);
    kit.source.pages_used.push('https://leak.example');
    expect(projected.source.pages_used).toHaveLength(1);
  });

  it('is deterministic and idempotent', () => {
    const kit = makeKit();
    expect(canonicalKit(kit)).toEqual(canonicalKit(kit));
    expect(canonicalKit(canonicalKit(kit))).toEqual(canonicalKit(kit));
  });
});

describe('question category / requirement_ids rule (D-022)', () => {
  it.each(['technical', 'behavioural', 'system-design'] as const)(
    'a %s question with no requirement_ids is rejected',
    (category) => {
      const result = questionSchema.safeParse(
        makeQuestion({ category, requirement_ids: [] }),
      );
      expect(result.success).toBe(false);
    },
  );

  it('a company-fit question with no requirement_ids is accepted', () => {
    const result = questionSchema.safeParse(
      makeQuestion({ category: 'company-fit', requirement_ids: [] }),
    );
    expect(result.success).toBe(true);
  });

  it('a company-fit question may still cite a requirement', () => {
    const result = questionSchema.safeParse(
      makeQuestion({ category: 'company-fit', requirement_ids: ['r1'] }),
    );
    expect(result.success).toBe(true);
  });
});

describe('schema field constraints', () => {
  it.each([0, 4, 2.5, -1])('rejects difficulty %s', (difficulty) => {
    expect(questionSchema.safeParse(makeQuestion({ difficulty })).success).toBe(false);
  });

  it.each([1, 2, 3])('accepts difficulty %s', (difficulty) => {
    expect(questionSchema.safeParse(makeQuestion({ difficulty })).success).toBe(true);
  });

  it('rejects unknown keys anywhere in the kit', () => {
    const kit = makeKit();
    Object.assign(kit as object, { pinned: true });
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it.each(['r0', 'R1', 'req1', '1'])('rejects malformed requirement id %s', (id) => {
    const kit = makeKit({ requirements: [makeRequirement({ id })] });
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it('rejects a non-integer minutes value', () => {
    const kit = makeKit();
    kit.schedule.days[0]!.minutes = 42.5;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });

  it.each([0, 61])('rejects days_available of %s', (days) => {
    const kit = makeKit();
    kit.schedule.days_available = days;
    expect(kitSchema.safeParse(kit).success).toBe(false);
  });
});
