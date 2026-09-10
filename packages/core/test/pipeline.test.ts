import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  runPipeline,
  createMockAdapter,
  defaultTaskResponder,
  step,
  SsrfPolicy,
  Fetcher,
  assertValidKit,
  canonicalKit,
  CANONICAL_KIT_KEYS,
  type Kit,
} from '../src/index.js';
import { startFixtureSite, type FixtureSite } from '../../../fixtures/serve.js';

let site: FixtureSite;
let fixturePolicy: SsrfPolicy;

beforeAll(async () => {
  site = await startFixtureSite({ port: 0 });
  fixturePolicy = SsrfPolicy.fromEnv({
    EVAL_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${site.port},localhost:${site.port}`,
  });
});

afterAll(async () => {
  await site.close();
});

const RICH_JD = `
Senior Frontend Engineer
Acme Robotics - Bristol (hybrid, 2 days on site)

About the role
We are looking for a Senior Frontend Engineer to join the Fleet Console team.
You will own the operator-facing interface that warehouse staff use to monitor
and control several thousand robots in real time.

What you will do
- Build and maintain the operator console used in live warehouse environments.
- Work with designers to turn complex telemetry into calm, legible interfaces.
- Own your services in production and take part in a shared on-call rota.
- Mentor two mid-level engineers and review their work.

Requirements
- 5+ years of professional frontend engineering experience.
- Deep expertise with React and TypeScript in production systems.
- Strong understanding of browser rendering performance and profiling.
- Experience with real-time data in the browser, such as WebSockets or SSE.

Nice to have
- Experience with WebGL or canvas-based visualisation.
- Familiarity with robotics, logistics or industrial control systems.
`;

const THIN_JD = `
Frontend developer needed. React experience required.
Send your CV to jobs@example.com.
`;

describe('Pipeline - Happy path', () => {
  it('executes all 16 stages offline with mock provider and produces an Appendix A compliant kit', async () => {
    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: `${site.origin}/acme/`,
        days: 5,
      },
      {
        policy: fixturePolicy,
        adapters: [createMockAdapter()],
        sleep: async () => undefined,
      },
    );

    // 1. Kit is valid and canonical
    expect(result.kit).toBeDefined();
    expect(Object.keys(result.kit).sort()).toEqual([...CANONICAL_KIT_KEYS].sort());
    assertValidKit(result.kit, { requestedDays: 5 });

    // 2. Source metadata
    expect(result.kit.source.company_url).toBe(`${site.origin}/acme/`);
    expect(result.kit.source.jd_chars).toBe(RICH_JD.length);
    expect(result.kit.source.pages_used.length).toBeGreaterThan(0);
    expect(new Date(result.kit.source.researched_at).toISOString()).toBe(
      result.kit.source.researched_at,
    );

    // 3. Brief
    expect(result.kit.company_brief.summary.length).toBeGreaterThan(10);
    expect(result.kit.company_brief.what_they_do.length).toBeGreaterThan(10);
    expect(result.kit.company_brief.sources).toEqual(result.kit.source.pages_used);

    // 4. Role
    expect(result.kit.role.requirements.length).toBeGreaterThanOrEqual(3);
    expect(result.kit.role.title).toContain('Frontend Engineer');

    // 5. Questions & Schedule
    expect(result.kit.questions.length).toBeGreaterThanOrEqual(3);
    expect(result.kit.schedule.days_available).toBe(5);
    expect(result.kit.schedule.days).toHaveLength(5);
    for (const [index, day] of result.kit.schedule.days.entries()) {
      expect(day.day).toBe(index + 1);
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBeGreaterThanOrEqual(30);
      expect(day.minutes).toBeLessThanOrEqual(180);
      expect(day.question_ids.length).toBeGreaterThan(0);
    }

    // 6. Stages inspection
    expect(result.stages).toHaveLength(16);
    expect(result.stages.map((s) => s.stage)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const completedOrDegraded = result.stages.every(
      (s) =>
        s.status === 'completed' || s.status === 'degraded' || s.status === 'skipped',
    );
    expect(completedOrDegraded).toBe(true);
  }, 30_000);
});

describe('Pipeline - Thin JD', () => {
  it('records thin_jd gap and produces an honest thin kit without hallucinated requirements', async () => {
    const result = await runPipeline(
      {
        jd: THIN_JD,
        company_url: `${site.origin}/acme/`,
        days: 1,
      },
      {
        policy: fixturePolicy,
        adapters: [createMockAdapter()],
        sleep: async () => undefined,
      },
    );

    expect(result.gaps).toContain('thin_jd');
    expect(result.kit.role.requirements.length).toBeLessThan(3);
    expect(result.kit.schedule.days_available).toBe(1);
    expect(result.kit.schedule.days).toHaveLength(1);
    assertValidKit(result.kit, { requestedDays: 1 });
  });
});

describe('Pipeline - Retrieval partial failure', () => {
  it('handles 404 homepage by recording homepage_unreachable gap and continuing JD-only', async () => {
    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: `${site.origin}/acme/non-existent-page/`,
        days: 3,
      },
      {
        policy: fixturePolicy,
        adapters: [createMockAdapter()],
        sleep: async () => undefined,
      },
    );

    expect(result.gaps).toContain('homepage_unreachable');
    expect(result.research.homepage?.retrievalStatus).toBe('not_found');
    // Kit should still be successfully generated from JD
    expect(result.kit).toBeDefined();
    expect(result.kit.role.requirements.length).toBeGreaterThan(0);
    assertValidKit(result.kit, { requestedDays: 3 });
  });

  it('handles invalid URL by recording invalid_url gap and continuing JD-only', async () => {
    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: 'http://10.255.255.1/internal/',
        days: 2,
      },
      {
        policy: fixturePolicy, // strict on 10.x
        adapters: [createMockAdapter()],
        sleep: async () => undefined,
      },
    );

    expect(result.gaps).toContain('invalid_url');
    expect(result.kit).toBeDefined();
    assertValidKit(result.kit, { requestedDays: 2 });
  });
});

describe('Pipeline - Public search degradation', () => {
  it('records no_public_discussion gap when no search provider is configured', async () => {
    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: `${site.origin}/acme/`,
        days: 4,
      },
      {
        policy: fixturePolicy,
        adapters: [createMockAdapter()],
        sleep: async () => undefined,
      },
    );

    expect(result.gaps).toContain('no_public_discussion');
    const stage9 = result.stages.find((s) => s.stage === 9);
    expect(stage9?.status).toBe('degraded');
  });
});

describe('Pipeline - LLM failure & repair', () => {
  it('successfully repairs malformed LLM output during extraction', async () => {
    const validExtract = {
      requirements: [
        {
          text: '5+ years of professional frontend engineering experience.',
          kind: 'technical',
          priority: 'must',
          evidence_quote: '5+ years of professional frontend engineering experience.',
        },
        {
          text: 'Deep expertise with React and TypeScript in production systems.',
          kind: 'technical',
          priority: 'must',
          evidence_quote:
            'Deep expertise with React and TypeScript in production systems.',
        },
      ],
    };

    // First attempt returns malformed text; repair attempt returns valid JSON
    let attempts = 0;
    const adapter = createMockAdapter({
      respond: (req, callIndex) => {
        if (req.task === 'extract-requirements') {
          attempts += 1;
          if (attempts === 1) return step.malformed();
          return step.json(validExtract);
        }
        return defaultTaskResponder(req, callIndex);
      },
    });

    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: `${site.origin}/acme/`,
        days: 2,
      },
      {
        policy: fixturePolicy,
        adapters: [adapter],
        sleep: async () => undefined,
      },
    );

    expect(result.kit).toBeDefined();
    expect(result.kit.role.requirements.length).toBe(2);
    assertValidKit(result.kit, { requestedDays: 2 });
  });

  it('fails over to fallback adapter if primary adapter throws a transient error', async () => {
    const validExtract = {
      requirements: [
        {
          text: '5+ years of professional frontend engineering experience.',
          kind: 'technical',
          priority: 'must',
          evidence_quote: '5+ years of professional frontend engineering experience.',
        },
      ],
    };

    let primaryCalled = false;
    const primary = createMockAdapter({
      name: 'gemini',
      respond: (req, callIndex) => {
        if (req.task === 'extract-requirements' && !primaryCalled) {
          primaryCalled = true;
          return step.rateLimit();
        }
        return defaultTaskResponder(req, callIndex);
      },
    });

    const fallback = createMockAdapter({
      name: 'groq',
      respond: (req, callIndex) => {
        if (req.task === 'extract-requirements') {
          return step.json(validExtract);
        }
        return defaultTaskResponder(req, callIndex);
      },
    });

    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: `${site.origin}/acme/`,
        days: 1,
      },
      {
        policy: fixturePolicy,
        adapters: [primary, fallback],
        sleep: async () => undefined,
      },
    );

    expect(result.kit).toBeDefined();
    expect(result.stages.find((s) => s.stage === 2)?.provider).toBe('groq');
  });
});

describe('Pipeline - Coverage loop and deterministic fallback', () => {
  it('guarantees zero uncovered must-haves through deterministic fallback template questions', async () => {
    // Pass 1 questions do NOT cover requirement r2
    const questionsPass1 = {
      questions: [
        {
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'How do you structure React applications?',
          answer_outline: 'State management and components.',
          difficulty: 2,
        },
      ],
    };

    // Second pass also returns empty, triggering template fallback
    const adapter = createMockAdapter({
      respond: (req, callIndex) => {
        if (req.task === 'extract-requirements') {
          return step.json({
            requirements: [
              {
                text: '5+ years of professional frontend engineering experience.',
                kind: 'technical',
                priority: 'must',
                evidence_quote:
                  '5+ years of professional frontend engineering experience.',
              },
              {
                text: 'Deep expertise with React and TypeScript in production systems.',
                kind: 'technical',
                priority: 'must',
                evidence_quote:
                  'Deep expertise with React and TypeScript in production systems.',
              },
            ],
          });
        }
        if (req.task === 'generate-questions') {
          return step.json(questionsPass1);
        }
        if (req.task === 'generate-missing-questions') {
          return step.json({ questions: [] });
        }
        return defaultTaskResponder(req, callIndex);
      },
    });

    const result = await runPipeline(
      {
        jd: RICH_JD,
        company_url: `${site.origin}/acme/`,
        days: 3,
      },
      {
        policy: fixturePolicy,
        adapters: [adapter],
        sleep: async () => undefined,
      },
    );

    expect(result.kit).toBeDefined();
    // Coverage must have 0 uncovered must-haves
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([]);
    // The fallback template question was added
    expect(
      result.kit.questions.some((q) =>
        q.prompt.includes('Deep expertise with React and TypeScript'),
      ),
    ).toBe(true);
    assertValidKit(result.kit, { requestedDays: 3 });
  });
});
