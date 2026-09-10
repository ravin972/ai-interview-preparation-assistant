import { describe, expect, it } from 'vitest';
import { DAY_MAX_MINUTES, DAY_MIN_MINUTES } from '../src/constants.js';
import { InvalidDaysError, ScheduleInvariantError } from '../src/errors.js';
import { buildSchedule, orderQuestions, validateDays } from '../src/schedule/schedule.js';
import { scheduleSchema, type Question, type Requirement } from '../src/schema/kit.js';
import { makeQuestion, makeRequirement } from './helpers/kit-fixtures.js';

const must = (id: string, text = `Requirement ${id}`): Requirement =>
  makeRequirement({ id, text, priority: 'must' });
const nice = (id: string, text = `Nice ${id}`): Requirement =>
  makeRequirement({ id, text, priority: 'nice' });

/** n requirements, all must-have, each with exactly one question. */
function scenario(n: number): { requirements: Requirement[]; questions: Question[] } {
  const requirements = Array.from({ length: n }, (_, i) => must(`r${i + 1}`));
  const questions = requirements.map((r, i) =>
    makeQuestion({
      id: `q${i + 1}`,
      requirement_ids: [r.id],
      difficulty: ((i % 3) + 1) as 1 | 2 | 3,
    }),
  );
  return { requirements, questions };
}

describe('validateDays', () => {
  it.each([1, 2, 5, 30, 59, 60])('accepts %s', (days) => {
    expect(validateDays(days)).toBe(days);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['above the maximum', 61],
    ['far above the maximum', 90],
    ['a decimal', 2.5],
    ['a numeric string', '5'],
    ['a non-numeric string', 'five'],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an object', {}],
    ['an array', [5]],
  ])('rejects %s', (_label, value) => {
    expect(() => validateDays(value)).toThrow(InvalidDaysError);
  });

  it('rejects rather than clamps a value above the maximum', () => {
    // D-023: the supplied value must be used or refused, never quietly changed.
    expect(() => validateDays(90)).toThrow(/never clamped/);
    try {
      validateDays(90);
    } catch (error) {
      expect((error as InvalidDaysError).received).toBe(90);
    }
  });

  it('names the offending value in the message', () => {
    expect(() => validateDays('5')).toThrow(/the string "5"/);
  });
});

describe('buildSchedule - invariants hold for every horizon', () => {
  it.each([1, 2, 3, 5, 7, 30, 59, 60])(
    'produces exactly %s day(s) with all postconditions satisfied',
    (days) => {
      const { requirements, questions } = scenario(12);
      const schedule = buildSchedule({ days, questions, requirements });

      expect(schedule.days_available).toBe(days);
      expect(schedule.days).toHaveLength(days);
      expect(schedule.days.map((d) => d.day)).toEqual(
        Array.from({ length: days }, (_, i) => i + 1),
      );

      const questionIds = new Set(questions.map((q) => q.id));
      for (const day of schedule.days) {
        expect(Number.isInteger(day.minutes)).toBe(true);
        expect(day.minutes).toBeGreaterThanOrEqual(DAY_MIN_MINUTES);
        expect(day.minutes).toBeLessThanOrEqual(DAY_MAX_MINUTES);
        expect(day.focus.length).toBeGreaterThan(0);
        for (const id of day.question_ids) expect(questionIds.has(id)).toBe(true);
      }

      const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
      const coveredRequirements = new Set(
        questions.filter((q) => scheduled.has(q.id)).flatMap((q) => q.requirement_ids),
      );
      for (const requirement of requirements) {
        if (requirement.priority === 'must') {
          expect(coveredRequirements.has(requirement.id)).toBe(true);
        }
      }

      expect(scheduleSchema.safeParse(schedule).success).toBe(true);
    },
  );

  it('rejects an invalid day count before allocating anything', () => {
    const { requirements, questions } = scenario(3);
    expect(() => buildSchedule({ days: 61, questions, requirements })).toThrow(
      InvalidDaysError,
    );
  });
});

describe('buildSchedule - allocation shape', () => {
  it('puts every question on day 1 when only one day is available', () => {
    const { requirements, questions } = scenario(40);
    const schedule = buildSchedule({ days: 1, questions, requirements });

    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0]!.question_ids).toHaveLength(40);
    // A person cannot study for nine hours; the clamp is deliberate (D-011).
    expect(schedule.days[0]!.minutes).toBe(DAY_MAX_MINUTES);
  });

  it('front-loads the harder, higher-priority material', () => {
    const requirements = [must('r1'), nice('r2')];
    const questions = [
      makeQuestion({
        id: 'q1',
        requirement_ids: ['r2'],
        difficulty: 1,
        category: 'company-fit',
      }),
      makeQuestion({ id: 'q2', requirement_ids: ['r1'], difficulty: 3 }),
    ];
    const schedule = buildSchedule({ days: 2, questions, requirements });

    expect(schedule.days[0]!.question_ids).toEqual(['q2']);
    expect(schedule.days[1]!.question_ids).toEqual(['q1']);
  });

  it('gives the larger chunks to the earliest days', () => {
    const { requirements, questions } = scenario(10);
    const schedule = buildSchedule({ days: 4, questions, requirements });
    const sizes = schedule.days.map((d) => d.question_ids.length);

    expect(sizes).toEqual([3, 3, 2, 2]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('schedules each question exactly once when questions outnumber days', () => {
    const { requirements, questions } = scenario(25);
    const schedule = buildSchedule({ days: 5, questions, requirements });
    const scheduled = schedule.days.flatMap((d) => d.question_ids);

    expect(scheduled).toHaveLength(25);
    expect(new Set(scheduled).size).toBe(25);
  });

  it('never leaves a day empty when there are fewer questions than days', () => {
    const { requirements, questions } = scenario(4);
    const schedule = buildSchedule({ days: 60, questions, requirements });

    expect(schedule.days).toHaveLength(60);
    for (const day of schedule.days) {
      expect(day.question_ids.length).toBeGreaterThan(0);
    }
  });

  it('uses surplus days for spaced review, one new question per day first', () => {
    const { requirements, questions } = scenario(3);
    const schedule = buildSchedule({ days: 7, questions, requirements });

    expect(schedule.days.slice(0, 3).map((d) => d.question_ids.length)).toEqual([
      1, 1, 1,
    ]);
    for (const day of schedule.days.slice(3)) {
      expect(day.question_ids.length).toBe(3);
      expect(day.focus.startsWith('Review')).toBe(true);
    }
  });

  it('marks only surplus days as review days', () => {
    const { requirements, questions } = scenario(5);
    const schedule = buildSchedule({ days: 5, questions, requirements });
    expect(schedule.days.every((d) => !d.focus.startsWith('Review'))).toBe(true);
  });

  it('produces days with a real focus label drawn from the requirements', () => {
    const requirements = [must('r1', 'Deep expertise with React and TypeScript')];
    const questions = [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })];
    const schedule = buildSchedule({ days: 1, questions, requirements });

    expect(schedule.days[0]!.focus).toContain('Technical depth');
    expect(schedule.days[0]!.focus).toContain('Deep expertise with React');
  });

  it('handles a kit with no questions by planning orientation days', () => {
    const schedule = buildSchedule({
      days: 3,
      questions: [],
      requirements: [nice('r1')],
    });

    expect(schedule.days).toHaveLength(3);
    for (const day of schedule.days) {
      expect(day.question_ids).toEqual([]);
      expect(day.minutes).toBe(DAY_MIN_MINUTES);
      expect(day.focus).toBe('Orientation and self-review');
    }
  });

  it('refuses to produce a schedule that omits a must-have requirement', () => {
    // Coverage guarantees this never happens upstream; if it does, it is a bug.
    expect(() =>
      buildSchedule({ days: 2, questions: [], requirements: [must('r1')] }),
    ).toThrow(ScheduleInvariantError);
  });
});

describe('orderQuestions', () => {
  const requirements = [must('r1'), nice('r2')];

  it('ranks must-have coverage above difficulty', () => {
    const easyMust = makeQuestion({ id: 'q1', requirement_ids: ['r1'], difficulty: 1 });
    const hardNice = makeQuestion({ id: 'q2', requirement_ids: ['r2'], difficulty: 3 });
    expect(orderQuestions([hardNice, easyMust], requirements).map((q) => q.id)).toEqual([
      'q1',
      'q2',
    ]);
  });

  it('ranks difficulty above category weight', () => {
    const hard = makeQuestion({
      id: 'q1',
      requirement_ids: ['r2'],
      difficulty: 3,
      category: 'behavioural',
    });
    const easy = makeQuestion({
      id: 'q2',
      requirement_ids: ['r2'],
      difficulty: 1,
      category: 'technical',
    });
    expect(orderQuestions([easy, hard], requirements).map((q) => q.id)).toEqual([
      'q1',
      'q2',
    ]);
  });

  it('breaks exact ties by ascending numeric id, not string order', () => {
    const questions = [2, 10, 1].map((n) =>
      makeQuestion({ id: `q${n}`, requirement_ids: ['r1'], difficulty: 2 }),
    );
    expect(orderQuestions(questions, requirements).map((q) => q.id)).toEqual([
      'q1',
      'q2',
      'q10',
    ]);
  });

  it('does not mutate the input array', () => {
    const questions = [
      makeQuestion({ id: 'q1', requirement_ids: ['r2'], difficulty: 1 }),
      makeQuestion({ id: 'q2', requirement_ids: ['r1'], difficulty: 3 }),
    ];
    orderQuestions(questions, requirements);
    expect(questions.map((q) => q.id)).toEqual(['q1', 'q2']);
  });
});

describe('buildSchedule - determinism', () => {
  it('returns identical output for identical input', () => {
    const { requirements, questions } = scenario(17);
    const first = buildSchedule({ days: 6, questions, requirements });
    const second = buildSchedule({ days: 6, questions, requirements });
    expect(first).toEqual(second);
  });

  it('is unaffected by the order questions are supplied in', () => {
    const { requirements, questions } = scenario(9);
    const forwards = buildSchedule({ days: 4, questions, requirements });
    const backwards = buildSchedule({
      days: 4,
      questions: [...questions].reverse(),
      requirements,
    });
    expect(forwards).toEqual(backwards);
  });
});
