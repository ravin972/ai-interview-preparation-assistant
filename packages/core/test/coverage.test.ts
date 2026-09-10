import { describe, expect, it, vi } from 'vitest';
import {
  computeCoverage,
  isCovered,
  stripUnknownRequirementIds,
} from '../src/coverage/coverage.js';
import { templateQuestion, templateQuestionDraft } from '../src/coverage/fallback.js';
import { planSecondPass, runCoverageLoop } from '../src/coverage/secondPass.js';
import { IdAllocator } from '../src/ids/allocator.js';
import {
  questionSchema,
  type QuestionDraft,
  type Requirement,
} from '../src/schema/kit.js';
import { makeQuestion, makeRequirement } from './helpers/kit-fixtures.js';

const must = (id: string, text = `Requirement ${id}`): Requirement =>
  makeRequirement({ id, text, priority: 'must' });
const nice = (id: string, text = `Nice ${id}`): Requirement =>
  makeRequirement({ id, text, priority: 'nice' });

/** A generator that answers each targeted requirement with one draft. */
const coveringGenerator =
  () =>
  (uncovered: readonly Requirement[]): QuestionDraft[] =>
    uncovered.map((requirement) => ({
      requirement_ids: [requirement.id],
      category: 'technical',
      prompt: `Tell me about ${requirement.text}`,
      answer_outline: '',
      difficulty: 2,
    }));

/** A generator that returns questions which cover nothing new. */
const uselessGenerator = () => (): QuestionDraft[] => [
  {
    requirement_ids: [],
    category: 'company-fit',
    prompt: 'Why do you want to work here?',
    answer_outline: '',
    difficulty: 1,
  },
];

describe('computeCoverage', () => {
  it('reports everything covered when each requirement has a question', () => {
    const requirements = [must('r1'), nice('r2')];
    const questions = [
      makeQuestion({ id: 'q1', requirement_ids: ['r1'] }),
      makeQuestion({ id: 'q2', requirement_ids: ['r2'] }),
    ];
    expect(computeCoverage(requirements, questions)).toEqual({
      covered: ['r1', 'r2'],
      uncoveredMust: [],
      uncoveredNice: [],
    });
  });

  it('separates uncovered must-haves from uncovered nice-to-haves', () => {
    const requirements = [must('r1'), must('r2'), nice('r3')];
    const questions = [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })];
    expect(computeCoverage(requirements, questions)).toEqual({
      covered: ['r1'],
      uncoveredMust: ['r2'],
      uncoveredNice: ['r3'],
    });
  });

  it('reports multiple uncovered must-haves in requirement order', () => {
    const requirements = [must('r1'), must('r2'), must('r3')];
    const questions = [makeQuestion({ id: 'q1', requirement_ids: ['r2'] })];
    expect(computeCoverage(requirements, questions).uncoveredMust).toEqual(['r1', 'r3']);
  });

  it('counts a requirement covered when any question cites it', () => {
    const questions = [makeQuestion({ id: 'q1', requirement_ids: ['r1', 'r2'] })];
    expect(isCovered('r2', questions)).toBe(true);
    expect(isCovered('r3', questions)).toBe(false);
  });
});

describe('stripUnknownRequirementIds', () => {
  it('drops references to requirements that do not exist', () => {
    const requirements = [must('r1')];
    const stripped = stripUnknownRequirementIds(
      [makeQuestion({ requirement_ids: ['r1', 'r99'] })],
      requirements,
    );
    expect(stripped[0]!.requirement_ids).toEqual(['r1']);
  });

  it('does not mutate the input', () => {
    const original = makeQuestion({ requirement_ids: ['r1', 'r99'] });
    stripUnknownRequirementIds([original], [must('r1')]);
    expect(original.requirement_ids).toEqual(['r1', 'r99']);
  });

  it('a hallucinated id cannot make a requirement look covered', () => {
    const requirements = [must('r1')];
    const questions = stripUnknownRequirementIds(
      [makeQuestion({ id: 'q1', requirement_ids: ['r404'] })],
      requirements,
    );
    expect(computeCoverage(requirements, questions).uncoveredMust).toEqual(['r1']);
  });
});

describe('planSecondPass', () => {
  it('targets only uncovered must-haves, in kit order', () => {
    const requirements = [must('r1'), nice('r2'), must('r3'), must('r4')];
    const questions = [makeQuestion({ id: 'q1', requirement_ids: ['r3'] })];
    expect(planSecondPass(requirements, questions).map((r) => r.id)).toEqual([
      'r1',
      'r4',
    ]);
  });

  it('returns nothing when every must-have is covered', () => {
    const requirements = [must('r1'), nice('r2')];
    const questions = [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })];
    expect(planSecondPass(requirements, questions)).toEqual([]);
  });
});

describe('templateQuestion fallback', () => {
  const requirement = must('r1', '5+ years with React and TypeScript.');

  it('derives text from the requirement alone', () => {
    const draft = templateQuestionDraft(requirement);
    expect(draft.prompt).toContain('5+ years with React and TypeScript');
    expect(draft.requirement_ids).toEqual(['r1']);
  });

  it('trims trailing sentence punctuation so the prompt reads correctly', () => {
    expect(templateQuestionDraft(requirement).prompt).not.toContain('TypeScript..');
  });

  it('maps requirement kind to a question category', () => {
    expect(templateQuestionDraft(makeRequirement({ kind: 'technical' })).category).toBe(
      'technical',
    );
    expect(templateQuestionDraft(makeRequirement({ kind: 'domain' })).category).toBe(
      'technical',
    );
    expect(templateQuestionDraft(makeRequirement({ kind: 'behavioural' })).category).toBe(
      'behavioural',
    );
  });

  it('produces a schema-valid question', () => {
    expect(questionSchema.safeParse(templateQuestion(requirement, 'q7')).success).toBe(
      true,
    );
  });

  it('is deterministic', () => {
    expect(templateQuestion(requirement, 'q7')).toEqual(
      templateQuestion(requirement, 'q7'),
    );
  });
});

describe('runCoverageLoop', () => {
  const newAllocator = () => {
    const ids = new IdAllocator({ q: 10 });
    return () => ids.nextQuestion();
  };

  it('stops at pass 1 when everything is already covered', async () => {
    const requirements = [must('r1')];
    const generate = vi.fn(coveringGenerator());
    const result = await runCoverageLoop({
      requirements,
      questions: [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })],
      generate,
      allocateQuestionId: newAllocator(),
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.passes).toBe(1);
    expect(result.stopReason).toBe('all-covered');
    expect(result.fallbackQuestionIds).toEqual([]);
  });

  it('runs a second pass that closes the gap', async () => {
    const requirements = [must('r1'), must('r2')];
    const generate = vi.fn(coveringGenerator());
    const result = await runCoverageLoop({
      requirements,
      questions: [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })],
      generate,
      allocateQuestionId: newAllocator(),
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0].map((r) => r.id)).toEqual(['r2']);
    expect(result.passes).toBe(2);
    expect(result.stopReason).toBe('all-covered');
    expect(computeCoverage(requirements, result.questions).uncoveredMust).toEqual([]);
  });

  it('targets only the uncovered requirements on the second pass', async () => {
    const requirements = [must('r1'), must('r2'), nice('r3')];
    const generate = vi.fn(coveringGenerator());
    await runCoverageLoop({
      requirements,
      questions: [makeQuestion({ id: 'q1', requirement_ids: ['r2'] })],
      generate,
      allocateQuestionId: newAllocator(),
    });
    expect(generate.mock.calls[0]![0].map((r) => r.id)).toEqual(['r1']);
  });

  it('stops on no progress rather than burning the third pass', async () => {
    const requirements = [must('r1'), must('r2')];
    const generate = vi.fn(uselessGenerator());
    const result = await runCoverageLoop({
      requirements,
      questions: [],
      generate,
      allocateQuestionId: newAllocator(),
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.passes).toBe(2);
    expect(result.stopReason).toBe('no-progress');
  });

  it('allows a third pass when the second made progress', async () => {
    const requirements = [must('r1'), must('r2'), must('r3')];
    let call = 0;
    const generate = vi.fn((uncovered: readonly Requirement[]): QuestionDraft[] => {
      call += 1;
      // Close exactly one requirement per pass, so each pass makes strict progress.
      const target = uncovered[0];
      if (target === undefined) return [];
      return [
        {
          requirement_ids: [target.id],
          category: 'technical',
          prompt: `Pass ${call} question about ${target.text}`,
          answer_outline: '',
          difficulty: 2,
        },
      ];
    });

    const result = await runCoverageLoop({
      requirements,
      questions: [],
      generate,
      allocateQuestionId: newAllocator(),
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.passes).toBe(3);
    // Three passes is the ceiling, so the last gap is closed by the fallback.
    expect(result.fallbackQuestionIds).toHaveLength(1);
    expect(computeCoverage(requirements, result.questions).uncoveredMust).toEqual([]);
  });

  it('closes every remaining must-have with a deterministic template question', async () => {
    const requirements = [
      must('r1', 'Deep React expertise'),
      must('r2', 'Rust on the backend'),
    ];
    const result = await runCoverageLoop({
      requirements,
      questions: [],
      generate: uselessGenerator(),
      allocateQuestionId: newAllocator(),
    });

    expect(result.fallbackQuestionIds).toHaveLength(2);
    const fallbacks = result.questions.filter((q) =>
      result.fallbackQuestionIds.includes(q.id),
    );
    expect(fallbacks.map((q) => q.requirement_ids)).toEqual([['r1'], ['r2']]);
    expect(fallbacks[0]!.prompt).toContain('Deep React expertise');
    expect(computeCoverage(requirements, result.questions).uncoveredMust).toEqual([]);
  });

  it('reports only nice-to-have gaps as uncovered', async () => {
    const requirements = [must('r1'), nice('r2'), nice('r3')];
    const result = await runCoverageLoop({
      requirements,
      questions: [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })],
      generate: coveringGenerator(),
      allocateQuestionId: newAllocator(),
    });
    expect(result.uncovered_requirement_ids).toEqual(['r2', 'r3']);
  });

  it('stops when the deadline is reached, and still closes must-haves', async () => {
    const requirements = [must('r1'), must('r2')];
    const generate = vi.fn(coveringGenerator());
    const result = await runCoverageLoop({
      requirements,
      questions: [],
      generate,
      allocateQuestionId: newAllocator(),
      isDeadlineReached: () => true,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('deadline');
    expect(result.fallbackQuestionIds).toHaveLength(2);
    expect(computeCoverage(requirements, result.questions).uncoveredMust).toEqual([]);
  });

  it('assigns ids itself, so a generator cannot invent or collide with one', async () => {
    const requirements = [must('r1'), must('r2')];
    const result = await runCoverageLoop({
      requirements,
      questions: [makeQuestion({ id: 'q10', requirement_ids: ['r1'] })],
      generate: () => [
        {
          requirement_ids: ['r2'],
          category: 'technical',
          prompt: 'Generated without an id',
          answer_outline: '',
          difficulty: 3,
        },
      ],
      allocateQuestionId: newAllocator(),
    });

    const ids = result.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('q11');
  });

  it('strips hallucinated references and drops drafts left citing nothing', async () => {
    const requirements = [must('r1')];
    const result = await runCoverageLoop({
      requirements,
      questions: [],
      generate: () => [
        {
          requirement_ids: ['r404'],
          category: 'technical',
          prompt: 'Cites a requirement that does not exist',
          answer_outline: '',
          difficulty: 2,
        },
        {
          requirement_ids: ['r404'],
          category: 'company-fit',
          prompt: 'Company-fit questions may cite nothing',
          answer_outline: '',
          difficulty: 1,
        },
      ],
      allocateQuestionId: newAllocator(),
    });

    const prompts = result.questions.map((q) => q.prompt);
    expect(prompts).not.toContain('Cites a requirement that does not exist');
    expect(prompts).toContain('Company-fit questions may cite nothing');
    expect(result.questions.every((q) => !q.requirement_ids.includes('r404'))).toBe(true);
  });

  it('records a history entry per generation pass', async () => {
    const requirements = [must('r1'), must('r2')];
    const result = await runCoverageLoop({
      requirements,
      questions: [],
      generate: coveringGenerator(),
      allocateQuestionId: newAllocator(),
    });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({
      pass: 2,
      uncoveredBefore: ['r1', 'r2'],
      uncoveredAfter: [],
      added: 2,
    });
  });

  it('produces identical output when run twice on the same input', async () => {
    const requirements = [must('r1'), must('r2'), nice('r3')];
    const run = () =>
      runCoverageLoop({
        requirements,
        questions: [makeQuestion({ id: 'q1', requirement_ids: ['r1'] })],
        generate: uselessGenerator(),
        allocateQuestionId: newAllocator(),
      });
    expect(await run()).toEqual(await run());
  });
});
