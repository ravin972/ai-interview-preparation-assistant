/**
 * OPT-IN provider smoke test. Skipped unless LLM_SMOKE=1.
 *
 * `npm test` must stay offline and deterministic, so this never runs in CI or
 * by default. Run it by hand when you want to confirm a real key and model id
 * still work:
 *
 *   LLM_SMOKE=1 GEMINI_API_KEY=... npx vitest run packages/core/test/llm-smoke.test.ts
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGeminiAdapter, geminiOptionsFromEnv } from '../src/llm/gemini.js';
import { createGroqAdapter, groqOptionsFromEnv } from '../src/llm/groq.js';
import { generateStructured } from '../src/llm/router.js';
import { EXTRACT_TASK, extractionResponseSchema } from '../src/extract/extract.js';
import {
  EXTRACT_REQUIREMENTS_JSON_SCHEMA,
  EXTRACT_REQUIREMENTS_SYSTEM,
  buildExtractRequirementsUser,
} from '../src/prompts/extract.js';
import type { LlmAdapter } from '../src/llm/types.js';

const enabled = process.env['LLM_SMOKE'] === '1';
const env = process.env as Record<string, string | undefined>;

const schema = z.object({ capital: z.string() });
const ask = (adapters: LlmAdapter[]) =>
  generateStructured({
    task: 'smoke',
    system: 'Answer with JSON only.',
    user: 'What is the capital of France? Reply as {"capital":"..."}',
    schema,
    adapters,
    maxOutputTokens: 64,
  });

describe.skipIf(!enabled)('provider smoke tests (opt-in)', () => {
  it('reaches Gemini with the configured model', async () => {
    const options = geminiOptionsFromEnv(env);
    expect(options, 'GEMINI_API_KEY is not set').not.toBeNull();
    const result = await ask([createGeminiAdapter(options!)]);
    expect(result.value.capital.toLowerCase()).toContain('paris');
  }, 60_000);

  it('accepts our real responseSchema and returns a schema-valid extraction', async () => {
    // The risky path: Gemini's responseSchema takes only a restricted OpenAPI
    // subset, so this proves the exact structured-output request format we
    // send in production is accepted, end to end through the router.
    const options = geminiOptionsFromEnv(env);
    expect(options, 'GEMINI_API_KEY is not set').not.toBeNull();

    const jd = [
      'Senior Frontend Engineer',
      'Requirements',
      '- 5+ years of professional frontend engineering experience.',
      '- Deep expertise with React and TypeScript in production systems.',
      'Nice to have',
      '- Experience with WebGL.',
    ].join('\n');

    const result = await generateStructured({
      task: EXTRACT_TASK,
      system: EXTRACT_REQUIREMENTS_SYSTEM,
      user: buildExtractRequirementsUser(jd),
      schema: extractionResponseSchema,
      jsonSchema: EXTRACT_REQUIREMENTS_JSON_SCHEMA,
      adapters: [createGeminiAdapter(options!)],
      maxOutputTokens: 2048,
    });

    expect(result.provider).toBe('gemini');
    expect(result.value.requirements.length).toBeGreaterThan(0);
    for (const candidate of result.value.requirements) {
      expect(candidate.text.length).toBeGreaterThan(0);
      expect(candidate.evidence_quote.length).toBeGreaterThan(0);
    }
    process.stdout.write(
      `[smoke] gemini returned ${result.value.requirements.length} candidates, repaired=${result.repaired}` +
        ' + NL + ',
    );
  }, 90_000);

  it('reaches Groq with the configured model', async () => {
    const options = groqOptionsFromEnv(env);
    expect(options, 'GROQ_API_KEY is not set').not.toBeNull();
    const result = await ask([createGroqAdapter(options!)]);
    expect(result.value.capital.toLowerCase()).toContain('paris');
  }, 60_000);
});

describe('smoke test guard', () => {
  it('is disabled unless explicitly opted in', () => {
    // Guards against this file quietly becoming a network dependency of `npm test`.
    if (process.env['LLM_SMOKE'] !== '1') expect(enabled).toBe(false);
  });
});
