import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { runPipeline, createMockAdapter, SsrfPolicy, Deadline } from '../src/index.js';
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

const SAMPLE_JD = `
Senior Frontend Engineer
Acme Robotics - Bristol

Requirements
- 5+ years of professional frontend engineering experience.
- Deep expertise with React and TypeScript in production systems.
- Strong understanding of browser rendering performance.
`;

describe('Pipeline Budget & Deadline', () => {
  it('Deadline tracks elapsed time and detects expiration', () => {
    let fakeTime = 1000;
    const deadline = new Deadline({
      budgetMs: 5000,
      monotonic: () => fakeTime,
    });

    expect(deadline.remainingMs()).toBe(5000);
    expect(deadline.isExpired()).toBe(false);
    expect(deadline.hasRemaining(3000)).toBe(true);

    fakeTime += 3000;
    expect(deadline.remainingMs()).toBe(2000);
    expect(deadline.hasRemaining(3000)).toBe(false);

    fakeTime += 3000;
    expect(deadline.isExpired()).toBe(true);
    expect(deadline.remainingMs()).toBe(0);
  });

  it('degrades optional stage 9 when remaining budget is tight', async () => {
    let fakeTime = 1000;
    const result = await runPipeline(
      {
        jd: SAMPLE_JD,
        company_url: `${site.origin}/acme/`,
        days: 3,
      },
      {
        policy: fixturePolicy,
        adapters: [createMockAdapter()],
        budgetMs: 10_000,
        monotonic: () => {
          // Advance time significantly so remaining is < 5000ms by stage 9
          fakeTime += 1000;
          return fakeTime;
        },
      },
    );

    expect(result.kit).toBeDefined();
    // Stage 9 should degrade to recorded gap
    expect(result.gaps).toContain('no_public_discussion');
    const stage9 = result.stages.find((s) => s.stage === 9);
    expect(stage9?.status).toBe('degraded');
  });

  it('records stage durations accurately in stages audit trail', async () => {
    const result = await runPipeline(
      {
        jd: SAMPLE_JD,
        company_url: `${site.origin}/acme/`,
        days: 2,
      },
      {
        policy: fixturePolicy,
        adapters: [createMockAdapter()],
      },
    );

    expect(result.stages).toHaveLength(16);
    for (const stage of result.stages) {
      expect(stage.durationMs).toBeDefined();
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
      expect(stage.startedAt).toBeDefined();
      expect(stage.finishedAt).toBeDefined();
    }
  });
});
