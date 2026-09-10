/**
 * Core batch evaluator runner (docs/EVALUATOR.md).
 *
 * Runs the SAME runPipeline() exported from @kit/core.
 * Contains NO pipeline logic, no database, no auth, no express.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  runPipeline,
  createMockAdapter,
  createGeminiAdapter,
  createGroqAdapter,
  geminiOptionsFromEnv,
  groqOptionsFromEnv,
  SsrfPolicy,
  type Kit,
  type LlmAdapter,
  type PipelineResult,
} from '@kit/core';

export interface EvaluatorCase {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

export interface EvaluatorKitResult {
  id: string;
  status: 'ok' | 'error';
  kit: Kit | null;
  error: string | null;
}

export interface EvaluatorOutputEnvelope {
  version: '1.0';
  generated_at: string;
  kits: EvaluatorKitResult[];
}

export interface EvaluateOptions {
  inputPath: string;
  outputPath: string;
  concurrency?: number;
  caseTimeoutMs?: number;
  verbose?: boolean;
  env?: Record<string, string | undefined>;
  adapters?: readonly LlmAdapter[];
  policy?: SsrfPolicy;
  sleep?: (ms: number) => Promise<void>;
}

export function selectAdapters(
  env: Record<string, string | undefined> = process.env,
): LlmAdapter[] {
  const provider = env.LLM_PROVIDER ?? 'mock';
  if (provider === 'mock') {
    return [createMockAdapter()];
  }

  const adapters: LlmAdapter[] = [];
  const geminiOpts = geminiOptionsFromEnv(env);
  if (geminiOpts) adapters.push(createGeminiAdapter(geminiOpts));
  const groqOpts = groqOptionsFromEnv(env);
  if (groqOpts) adapters.push(createGroqAdapter(groqOpts));

  if (adapters.length === 0) {
    return [createMockAdapter()];
  }
  return adapters;
}

export async function evaluateBatch(
  options: EvaluateOptions,
): Promise<EvaluatorOutputEnvelope> {
  const {
    inputPath,
    outputPath,
    concurrency = 2,
    caseTimeoutMs = 150_000,
    verbose = false,
    env = process.env,
  } = options;

  // 1. Read and parse input cases
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`input file not found: ${resolvedInput}`);
  }

  let rawCases: unknown;
  try {
    rawCases = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  } catch (err) {
    throw new Error(
      `failed to parse input JSON from ${resolvedInput}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(rawCases)) {
    throw new Error(
      `expected input to be an array of cases, received ${typeof rawCases}`,
    );
  }

  const cases = rawCases as Partial<EvaluatorCase>[];
  const results: EvaluatorKitResult[] = new Array(cases.length);

  // Auto-start fixture site if running against local fixture port 8099 and not already listening
  let fixtureSite: { close: () => Promise<void> } | null = null;
  const needsFixtureSite = cases.some(
    (c) =>
      typeof c.company_url === 'string' &&
      (c.company_url.includes(':8099') ||
        c.company_url.includes('localhost:8099') ||
        c.company_url.includes('127.0.0.1:8099')),
  );

  if (needsFixtureSite) {
    try {
      const { startFixtureSite } = await import('../../../fixtures/serve.js');
      fixtureSite = await startFixtureSite({ port: 8099 });
    } catch {
      // Port 8099 already bound or unavailable; reuse existing server
    }
  }

  // 2. Setup SSRF policy allowing fixture host
  const allowPrivate = env.EVAL_ALLOW_PRIVATE_HOSTS ?? 'localhost:8099,127.0.0.1:8099';
  const policy =
    options.policy ??
    SsrfPolicy.fromEnv({
      ...env,
      EVAL_ALLOW_PRIVATE_HOSTS: allowPrivate,
    });

  const adapters = options.adapters ?? selectAdapters(env);

  // 3. Process cases with bounded concurrency and per-case isolation
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < cases.length) {
      const index = nextIndex++;
      const item = cases[index];
      if (!item) continue;

      const caseId = typeof item.id === 'string' ? item.id : `case-${index + 1}`;

      // Validate case input shape
      if (typeof item.jd !== 'string' || item.jd.trim() === '') {
        results[index] = {
          id: caseId,
          status: 'error',
          kit: null,
          error: 'validation_error: jd must be a non-empty string',
        };
        continue;
      }

      if (typeof item.company_url !== 'string' || item.company_url.trim() === '') {
        results[index] = {
          id: caseId,
          status: 'error',
          kit: null,
          error: 'validation_error: company_url must be a string',
        };
        continue;
      }

      if (
        typeof item.days !== 'number' ||
        !Number.isInteger(item.days) ||
        item.days < 1 ||
        item.days > 60
      ) {
        results[index] = {
          id: caseId,
          status: 'error',
          kit: null,
          error: `validation_error: days must be an integer between 1 and 60; received ${item.days}`,
        };
        continue;
      }

      if (verbose) {
        process.stderr.write(
          `[evaluator] starting case ${caseId} (${item.days} days)...\n`,
        );
      }

      try {
        const pipelineResult: PipelineResult = await runPipeline(
          {
            jd: item.jd,
            company_url: item.company_url,
            days: item.days,
          },
          {
            adapters,
            policy,
            budgetMs: caseTimeoutMs,
            jobId: `eval-${caseId}`,
            ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
          },
        );

        results[index] = {
          id: caseId,
          status: 'ok',
          kit: pipelineResult.kit,
          error: null,
        };

        if (verbose) {
          process.stderr.write(`[evaluator] completed case ${caseId}: ok\n`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results[index] = {
          id: caseId,
          status: 'error',
          kit: null,
          error: errorMsg,
        };

        if (verbose) {
          process.stderr.write(`[evaluator] failed case ${caseId}: ${errorMsg}\n`);
        }
      }
    }
  }

  try {
    const workerCount = Math.max(1, Math.min(concurrency, cases.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    if (fixtureSite) {
      await fixtureSite.close();
    }
  }

  const envelope: EvaluatorOutputEnvelope = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    kits: results,
  };

  // 4. Write output JSON atomically or cleanly
  const resolvedOutput = path.resolve(outputPath);
  const outDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(resolvedOutput, JSON.stringify(envelope, null, 2), 'utf8');

  return envelope;
}
