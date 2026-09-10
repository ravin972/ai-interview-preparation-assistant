import { describe, expect, it } from 'vitest';
import { KitValidationError } from '../src/errors.js';
import { assertValidKit, validateKit } from '../src/schema/invariants.js';
import { buildSchedule } from '../src/schedule/schedule.js';
import {
  makeKit,
  makeQuestion,
  makeQuestionsFor,
  makeRequirement,
  makeRequirements,
} from './helpers/kit-fixtures.js';

const codes = (input: unknown, options = {}) => {
  const result = validateKit(input, options);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
};

describe('validateKit - happy path', () => {
  it('accepts a well-formed kit', () => {
    const result = validateKit(makeKit());
    expect(result.ok).toBe(true);
  });

  it('accepts a realistic kit whose schedule came from the builder', () => {
    const requirements = makeRequirements(6);
    const questions = makeQuestionsFor(requirements);
    const kit = makeKit({
      requirements,
      questions,
      flashcards: [],
      schedule: buildSchedule({ days: 4, questions, requirements }),
      coverage: { uncovered_requirement_ids: [], passes: 2 },
    });
    expect(validateKit(kit, { requestedDays: 4 }).ok).toBe(true);
  });
});

describe('validateKit - reference integrity', () => {
  it('flags a question referencing a requirement that does not exist', () => {
    const kit = makeKit({ questions: [makeQuestion({ requirement_ids: ['r9'] })] });
    expect(codes(kit)).toContain('unknown_requirement_ref');
  });

  it('flags a flashcard referencing a requirement that does not exist', () => {
    const kit = makeKit();
    kit.flashcards = [{ id: 'f1', front: 'x', back: 'y', requirement_ids: ['r42'] }];
    expect(codes(kit)).toContain('unknown_requirement_ref');
  });

  it('flags a schedule day referencing a question that does not exist', () => {
    const kit = makeKit();
    kit.schedule.days[0]!.question_ids = ['q99'];
    expect(codes(kit)).toContain('unknown_question_ref');
  });

  it('flags duplicate requirement, question and flashcard ids', () => {
    const duplicateRequirements = makeKit({
      requirements: [makeRequirement(), makeRequirement()],
    });
    expect(codes(duplicateRequirements)).toContain('duplicate_id');

    const duplicateQuestions = makeKit({
      questions: [makeQuestion(), makeQuestion({ prompt: 'Different text' })],
    });
    expect(codes(duplicateQuestions)).toContain('duplicate_id');

    const duplicateFlashcards = makeKit();
    duplicateFlashcards.flashcards = [
      { id: 'f1', front: 'a', back: 'b', requirement_ids: [] },
      { id: 'f1', front: 'c', back: 'd', requirement_ids: [] },
    ];
    expect(codes(duplicateFlashcards)).toContain('duplicate_id');
  });
});

describe('validateKit - schedule invariants', () => {
  it('flags days.length disagreeing with days_available', () => {
    const kit = makeKit();
    kit.schedule.days_available = 3;
    expect(codes(kit)).toContain('schedule_day_count');
  });

  it('flags day numbering that is not 1..N in order', () => {
    const requirements = [makeRequirement()];
    const questions = [makeQuestion()];
    const kit = makeKit({
      requirements,
      questions,
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: 'a', question_ids: ['q1'], minutes: 60 },
          { day: 3, focus: 'b', question_ids: ['q1'], minutes: 60 },
        ],
      },
    });
    expect(codes(kit)).toContain('schedule_day_numbering');
  });

  it.each([29, 181])('flags minutes of %s as out of the documented bounds', (minutes) => {
    const kit = makeKit();
    kit.schedule.days[0]!.minutes = minutes;
    expect(codes(kit)).toContain('minutes_out_of_bounds');
  });

  it('flags a must-have requirement that never appears in the schedule', () => {
    const requirements = [
      makeRequirement({ id: 'r1', priority: 'must' }),
      makeRequirement({ id: 'r2', text: 'Second', priority: 'must' }),
    ];
    const questions = [
      makeQuestion({ id: 'q1', requirement_ids: ['r1'] }),
      makeQuestion({ id: 'q2', requirement_ids: ['r2'] }),
    ];
    const kit = makeKit({
      requirements,
      questions,
      // q2 exists but is never scheduled, so r2 is unreachable from the plan.
      schedule: {
        days_available: 1,
        days: [{ day: 1, focus: 'a', question_ids: ['q1'], minutes: 60 }],
      },
    });
    expect(codes(kit)).toContain('must_requirement_not_scheduled');
  });

  it('flags a mismatch against the requested day count', () => {
    expect(codes(makeKit(), { requestedDays: 7 })).toContain('days_mismatch');
  });
});

describe('validateKit - coverage invariants', () => {
  it('flags a must-have listed as uncovered', () => {
    const kit = makeKit({ coverage: { uncovered_requirement_ids: ['r1'], passes: 2 } });
    expect(codes(kit)).toContain('uncovered_contains_must');
  });

  it('accepts a nice-to-have listed as uncovered', () => {
    const requirements = [
      makeRequirement({ id: 'r1', priority: 'must' }),
      makeRequirement({ id: 'r2', text: 'WebGL exposure', priority: 'nice' }),
    ];
    const kit = makeKit({
      requirements,
      coverage: { uncovered_requirement_ids: ['r2'], passes: 2 },
    });
    expect(validateKit(kit).ok).toBe(true);
  });

  it('flags coverage referencing a requirement that does not exist', () => {
    const kit = makeKit({ coverage: { uncovered_requirement_ids: ['r77'], passes: 1 } });
    expect(codes(kit)).toContain('unknown_requirement_ref');
  });
});

describe('assertValidKit', () => {
  it('returns the parsed kit when valid', () => {
    expect(assertValidKit(makeKit()).role.requirements).toHaveLength(1);
  });

  it('throws KitValidationError carrying every issue', () => {
    const kit = makeKit({ questions: [makeQuestion({ requirement_ids: ['r9'] })] });
    try {
      assertValidKit(kit);
      expect.unreachable('expected assertValidKit to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(KitValidationError);
      const issues = (error as KitValidationError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]!.path).toMatch(/questions\[0\]/);
    }
  });

  it('reports structural failures without attempting cross-reference checks', () => {
    const result = validateKit({ not: 'a kit' });
    expect(result.ok).toBe(false);
    expect(codes({ not: 'a kit' }).every((code) => code.startsWith('schema.'))).toBe(
      true,
    );
  });
});
