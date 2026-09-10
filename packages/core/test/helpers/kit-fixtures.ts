/**
 * Shared test fixtures.
 *
 * APPENDIX_A_TEMPLATE is transcribed verbatim from the assessment brief. It is
 * deliberately written out by hand rather than derived from our schema, so a
 * key-shape test compares our output against the specification rather than
 * against ourselves.
 */
import type { Kit, Question, Requirement } from '../../src/schema/kit.js';

export const APPENDIX_A_TEMPLATE = {
  source: {
    company: '',
    company_url: '',
    role: '',
    location: '',
    jd_chars: 0,
    researched_at: '',
    pages_used: [],
  },
  company_brief: {
    summary: '',
    what_they_do: '',
    sources: [],
  },
  role: {
    title: '',
    seniority: '',
    responsibilities: [],
    requirements: [{ id: 'r1', text: '', kind: 'technical', priority: 'must' }],
  },
  questions: [
    {
      id: 'q1',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: '',
      answer_outline: '',
      difficulty: 2,
    },
  ],
  flashcards: [{ id: 'f1', front: '', back: '', requirement_ids: ['r1'] }],
  schedule: {
    days_available: 5,
    days: [{ day: 1, focus: '', question_ids: [], minutes: 60 }],
  },
  coverage: { uncovered_requirement_ids: [], passes: 2 },
} as const;

export const ISO_NOW = '2026-09-10T12:00:00.000Z';

export function makeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'r1',
    text: 'React and TypeScript in production systems',
    kind: 'technical',
    priority: 'must',
    ...overrides,
  };
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    requirement_ids: ['r1'],
    category: 'technical',
    prompt: 'How have you used React in production?',
    answer_outline: 'Context, actions, outcome.',
    difficulty: 2,
    ...overrides,
  };
}

/** Build `count` requirements r1..rN, alternating priority unless forced. */
export function makeRequirements(
  count: number,
  priority?: Requirement['priority'],
): Requirement[] {
  return Array.from({ length: count }, (_, index) =>
    makeRequirement({
      id: `r${index + 1}`,
      text: `Requirement number ${index + 1}`,
      priority: priority ?? (index % 2 === 0 ? 'must' : 'nice'),
    }),
  );
}

/** One question per requirement, q1..qN, so coverage is complete. */
export function makeQuestionsFor(
  requirements: readonly Requirement[],
  overrides: Partial<Question> = {},
): Question[] {
  return requirements.map((requirement, index) =>
    makeQuestion({
      id: `q${index + 1}`,
      requirement_ids: [requirement.id],
      difficulty: ((index % 3) + 1) as 1 | 2 | 3,
      ...overrides,
    }),
  );
}

export interface MakeKitOptions {
  requirements?: Requirement[];
  questions?: Question[];
  flashcards?: Kit['flashcards'];
  schedule?: Kit['schedule'];
  coverage?: Kit['coverage'];
  source?: Partial<Kit['source']>;
}

/**
 * A minimal, valid kit. Individual fields can be overridden to construct the
 * specific invalid shapes the invariant tests need.
 */
export function makeKit(options: MakeKitOptions = {}): Kit {
  const requirements = options.requirements ?? [makeRequirement()];
  const questions = options.questions ?? [makeQuestion()];
  return {
    source: {
      company: 'Acme Robotics',
      company_url: 'https://acme.example',
      role: 'Senior Frontend Engineer',
      location: 'Bristol',
      jd_chars: 1778,
      researched_at: ISO_NOW,
      pages_used: ['https://acme.example/'],
      ...options.source,
    },
    company_brief: {
      summary: 'Warehouse automation company.',
      what_they_do: 'Builds autonomous mobile robots and fleet software.',
      sources: ['https://acme.example/about.html'],
    },
    role: {
      title: 'Senior Frontend Engineer',
      seniority: 'senior',
      responsibilities: ['Own the operator console'],
      requirements,
    },
    questions,
    flashcards: options.flashcards ?? [
      { id: 'f1', front: 'React', back: 'A UI library.', requirement_ids: ['r1'] },
    ],
    schedule: options.schedule ?? {
      days_available: 1,
      days: [
        {
          day: 1,
          focus: 'Technical depth',
          question_ids: questions.map((q) => q.id),
          minutes: 60,
        },
      ],
    },
    coverage: options.coverage ?? { uncovered_requirement_ids: [], passes: 2 },
  };
}
