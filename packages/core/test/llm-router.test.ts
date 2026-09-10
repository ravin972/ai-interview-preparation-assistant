import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockAdapter, step } from '../src/llm/mock.js';
import { MAX_ATTEMPTS_PER_ADAPTER, generateStructured } from '../src/llm/router.js';
import { LlmStructuredError } from '../src/llm/types.js';

const schema = z.object({ answer: z.string(), score: z.number() });
const valid = { answer: 'yes', score: 1 };
const wrongShape = { answer: 'yes', score: 'not-a-number' };

/** Never actually waits; records the backoff the router asked for. */
function fakeSleep() {
  const waited: number[] = [];
  return {
    waited,
    sleep: async (ms: number) => {
      waited.push(ms);
    },
  };
}

const run = (
  adapters: Parameters<typeof generateStructured>[0]['adapters'],
  sleep = fakeSleep().sleep,
) =>
  generateStructured({
    task: 'unit-test',
    system: 'system prompt',
    user: 'user prompt',
    schema,
    adapters,
    sleep,
  });

describe('router - successful shapes', () => {
  it('accepts a clean JSON response on the first attempt', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.json(valid)] });
    const result = await run([gemini]);

    expect(result.value).toEqual(valid);
    expect(result.provider).toBe('gemini');
    expect(result.repaired).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(gemini.callCount).toBe(1);
  });

  it('accepts fenced JSON without spending a repair attempt', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.fenced(valid)] });
    const result = await run([gemini]);

    expect(result.value).toEqual(valid);
    expect(result.repaired).toBe(false);
    expect(gemini.callCount).toBe(1);
    expect(result.attempts[0]?.reason).toContain('fenced');
  });

  it('accepts JSON preceded by prose', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.proseThenJson('Here is the JSON:', valid, 'Hope that helps!')],
    });
    const result = await run([gemini]);

    expect(result.value).toEqual(valid);
    expect(gemini.callCount).toBe(1);
    expect(result.attempts[0]?.reason).toContain('embedded');
  });
});

describe('router - repair', () => {
  it('repairs malformed JSON and succeeds on the second attempt', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.malformed(), step.json(valid)],
    });
    const result = await run([gemini]);

    expect(result.value).toEqual(valid);
    expect(result.repaired).toBe(true);
    expect(gemini.callCount).toBe(2);
    expect(result.attempts.map((a) => a.outcome)).toEqual(['unparseable', 'ok']);
  });

  it('repairs schema-invalid JSON and succeeds on the second attempt', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.json(wrongShape), step.json(valid)],
    });
    const result = await run([gemini]);

    expect(result.repaired).toBe(true);
    expect(result.attempts.map((a) => a.outcome)).toEqual(['schema-invalid', 'ok']);
  });

  it('sends a repair prompt naming the reason and demanding bare JSON', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.json(wrongShape), step.json(valid)],
    });
    await run([gemini]);

    const repair = gemini.calls[1]?.user ?? '';
    expect(repair).toContain('REPAIR REQUEST');
    expect(repair).toContain('score');
    expect(repair).toContain('user prompt');
    expect(repair).toMatch(/ONLY the corrected JSON/i);
  });

  it('attempts repair exactly once, then moves to the next provider', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.malformed(), step.malformed(), step.json(valid)],
    });
    const groq = createMockAdapter({ name: 'groq', script: [step.json(valid)] });
    const result = await run([gemini, groq]);

    expect(gemini.callCount).toBe(MAX_ATTEMPTS_PER_ADAPTER);
    expect(result.provider).toBe('groq');
    expect(result.repaired).toBe(false);
  });
});

describe('router - provider failover', () => {
  it.each([
    ['a 429 rate limit', step.rateLimit()],
    ['a 5xx server error', step.serverError()],
    ['a timeout', step.timeout()],
    ['a network error', step.networkError()],
  ])('fails over to the fallback after %s', async (_label, failure) => {
    const gemini = createMockAdapter({ name: 'gemini', script: [failure] });
    const groq = createMockAdapter({ name: 'groq', script: [step.json(valid)] });
    const result = await run([gemini, groq]);

    expect(result.value).toEqual(valid);
    expect(result.provider).toBe('groq');
    // A throwing provider gets no repair attempt - repair cannot fix an outage.
    expect(gemini.callCount).toBe(1);
    expect(result.attempts[0]).toMatchObject({
      provider: 'gemini',
      outcome: 'transient',
    });
  });

  it('waits a bounded backoff before switching providers', async () => {
    const clock = fakeSleep();
    const gemini = createMockAdapter({ name: 'gemini', script: [step.rateLimit()] });
    const groq = createMockAdapter({ name: 'groq', script: [step.json(valid)] });
    await run([gemini, groq], clock.sleep);

    expect(clock.waited).toHaveLength(1);
    expect(clock.waited[0]).toBeGreaterThan(0);
  });

  it('does not retry a permanent error on the same provider', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.permanent(401)] });
    const groq = createMockAdapter({ name: 'groq', script: [step.json(valid)] });
    const result = await run([gemini, groq]);

    expect(gemini.callCount).toBe(1);
    expect(result.provider).toBe('groq');
    expect(result.attempts[0]).toMatchObject({ outcome: 'permanent' });
  });

  it('falls back when the primary exhausts its repair attempt', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.json(wrongShape), step.json(wrongShape)],
    });
    const groq = createMockAdapter({ name: 'groq', script: [step.json(valid)] });
    const result = await run([gemini, groq]);

    expect(gemini.callCount).toBe(2);
    expect(result.provider).toBe('groq');
  });

  it('surfaces a Groq failure when Gemini already failed', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.rateLimit()] });
    const groq = createMockAdapter({ name: 'groq', script: [step.serverError()] });

    await expect(run([gemini, groq])).rejects.toBeInstanceOf(LlmStructuredError);
  });
});

describe('router - exhaustion', () => {
  const bothFail = () => ({
    gemini: createMockAdapter({
      name: 'gemini',
      script: [step.malformed(), step.malformed()],
    }),
    groq: createMockAdapter({
      name: 'groq',
      script: [step.malformed(), step.malformed()],
    }),
  });

  it('throws a structured error carrying task, provider, reason and attempts', async () => {
    const { gemini, groq } = bothFail();
    try {
      await run([gemini, groq]);
      expect.unreachable('expected the router to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmStructuredError);
      const structured = error as LlmStructuredError;
      expect(structured.task).toBe('unit-test');
      expect(structured.provider).toBe('groq');
      expect(structured.reason).toContain('unparseable');
      expect(structured.providersTried).toEqual(['gemini', 'groq']);
      expect(structured.attempts).toHaveLength(4);
      expect(structured.message).toContain('unit-test');
    }
  });

  it('never exceeds two adapters times two attempts', async () => {
    const { gemini, groq } = bothFail();
    await run([gemini, groq]).catch(() => undefined);

    expect(gemini.callCount).toBe(MAX_ATTEMPTS_PER_ADAPTER);
    expect(groq.callCount).toBe(MAX_ATTEMPTS_PER_ADAPTER);
    expect(gemini.callCount + groq.callCount).toBe(4);
  });

  it('does not hide a failure behind a fallback value', async () => {
    const { gemini, groq } = bothFail();
    await expect(run([gemini, groq])).rejects.toThrow(/Structured generation failed/);
  });

  it('throws immediately when no adapters are supplied', async () => {
    await expect(run([])).rejects.toBeInstanceOf(LlmStructuredError);
  });

  it('records every attempt in order across both providers', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.rateLimit()] });
    const groq = createMockAdapter({
      name: 'groq',
      script: [step.json(wrongShape), step.malformed()],
    });
    const attempts = await run([gemini, groq])
      .then(() => [])
      .catch((error: LlmStructuredError) => error.attempts);

    expect(attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual([
      'gemini:transient',
      'groq:schema-invalid',
      'groq:unparseable',
    ]);
  });

  it('is deterministic across identical runs', async () => {
    const build = () =>
      run([
        createMockAdapter({
          name: 'gemini',
          script: [step.json(wrongShape), step.json(valid)],
        }),
      ]);
    const first = await build();
    const second = await build();
    expect(first.value).toEqual(second.value);
    expect(first.attempts).toEqual(second.attempts);
  });
});

describe('router - request shaping', () => {
  it('passes system prompt, json schema and signal through to the adapter', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.json(valid)] });
    const controller = new AbortController();
    await generateStructured({
      task: 'unit-test',
      system: 'be terse',
      user: 'go',
      schema,
      adapters: [gemini],
      jsonSchema: { type: 'object' },
      maxOutputTokens: 512,
      temperature: 0,
      signal: controller.signal,
      sleep: async () => undefined,
    });

    expect(gemini.calls[0]).toMatchObject({
      system: 'be terse',
      user: 'go',
      jsonSchema: { type: 'object' },
      maxOutputTokens: 512,
      temperature: 0,
    });
    expect(gemini.calls[0]?.signal).toBe(controller.signal);
  });
});
