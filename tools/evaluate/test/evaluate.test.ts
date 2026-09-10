import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { evaluateBatch } from '../src/evaluator.js';
import { runPipeline, assertValidKit } from '@kit/core';
import { startFixtureSite, type FixtureSite } from '../../../fixtures/serve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_CASES = path.resolve(here, '../../../fixtures/cases.json');

let site: FixtureSite;
let tmpDir: string;

beforeAll(async () => {
  site = await startFixtureSite({ port: 8099 });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluator-test-'));
});

afterAll(async () => {
  await site.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Batch Evaluator - 5 Fixture Cases', () => {
  it('processes all five committed fixture cases with deterministic mock provider', async () => {
    const outputPath = path.join(tmpDir, 'kits.json');

    const envelope = await evaluateBatch({
      inputPath: FIXTURES_CASES,
      outputPath,
      concurrency: 2,
      caseTimeoutMs: 60_000,
      sleep: async () => undefined,
      env: {
        ...process.env,
        LLM_PROVIDER: 'mock',
        EVAL_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${site.port},localhost:${site.port}`,
      },
    });

    // 1. Envelope structure
    expect(envelope.version).toBe('1.0');
    expect(new Date(envelope.generated_at).toISOString()).toBe(envelope.generated_at);
    expect(envelope.kits).toHaveLength(5);

    // 2. Output file was written
    expect(fs.existsSync(outputPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(written.kits).toHaveLength(5);

    // 3. Verify case ordering and status
    const expectedIds = [
      'case-01-rich',
      'case-02-thin',
      'case-03-heading-less',
      'case-04-boilerplate',
      'case-05-retrieval-failure',
    ];
    expect(envelope.kits.map((k) => k.id)).toEqual(expectedIds);

    for (const result of envelope.kits) {
      expect(result.status).toBe('ok');
      expect(result.error).toBeNull();
      expect(result.kit).not.toBeNull();
      if (result.kit) {
        assertValidKit(result.kit);
      }
    }

    // 4. Exact days propagation
    const rawCases = JSON.parse(fs.readFileSync(FIXTURES_CASES, 'utf8')) as {
      id: string;
      days: number;
    }[];
    for (const [index, c] of rawCases.entries()) {
      const kitResult = envelope.kits[index];
      expect(kitResult?.kit?.schedule.days_available).toBe(c.days);
      expect(kitResult?.kit?.schedule.days).toHaveLength(c.days);
    }

    // 5. Case-05 retrieval failure had research gap recorded but completed successfully
    const case5 = envelope.kits[4];
    expect(case5?.status).toBe('ok');
    expect(case5?.kit?.source.pages_used).toEqual([]);
  }, 30_000);
});

describe('Batch Evaluator - Failure Isolation', () => {
  it('preserves successful cases when one case fails validation or execution', async () => {
    const testCasesPath = path.join(tmpDir, 'mixed-cases.json');
    const outputPath = path.join(tmpDir, 'mixed-output.json');

    const mixedCases = [
      {
        id: 'bad-case-invalid-days',
        jd: 'Frontend Engineer needed with React skills.',
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 999, // invalid: above 60
      },
      {
        id: 'good-case',
        jd: 'Backend Engineer\nAcme Robotics\n\nRequirements\n- 4+ years of Node.js and TypeScript.',
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 3,
      },
      {
        id: 'bad-case-empty-jd',
        jd: '', // invalid: empty JD
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 2,
      },
    ];

    fs.writeFileSync(testCasesPath, JSON.stringify(mixedCases, null, 2));

    const envelope = await evaluateBatch({
      inputPath: testCasesPath,
      outputPath,
      concurrency: 2,
      sleep: async () => undefined,
      env: {
        ...process.env,
        LLM_PROVIDER: 'mock',
        EVAL_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${site.port}`,
      },
    });

    expect(envelope.kits).toHaveLength(3);
    expect(envelope.kits[0]?.id).toBe('bad-case-invalid-days');
    expect(envelope.kits[0]?.status).toBe('error');
    expect(envelope.kits[0]?.kit).toBeNull();
    expect(envelope.kits[0]?.error).toContain('days');

    expect(envelope.kits[1]?.id).toBe('good-case');
    expect(envelope.kits[1]?.status).toBe('ok');
    expect(envelope.kits[1]?.kit).not.toBeNull();
    expect(envelope.kits[1]?.kit?.schedule.days_available).toBe(3);

    expect(envelope.kits[2]?.id).toBe('bad-case-empty-jd');
    expect(envelope.kits[2]?.status).toBe('error');
    expect(envelope.kits[2]?.kit).toBeNull();
    expect(envelope.kits[2]?.error).toContain('jd');
  });

  it('isolates 5 adversarial cases (A=valid, B=malformed, C=valid, D=invalid URL, E=valid) preserving order', async () => {
    const testCasesPath = path.join(tmpDir, 'five-adversarial-cases.json');
    const outputPath = path.join(tmpDir, 'five-adversarial-output.json');

    const adversarialCases = [
      {
        id: 'case-A-valid',
        jd: 'Backend Engineer needed. Node.js and TypeScript required.',
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 3,
      },
      {
        id: 'case-B-malformed',
        jd: '', // malformed: empty JD
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 2,
      },
      {
        id: 'case-C-valid',
        jd: 'Frontend Engineer needed. React and CSS required.',
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 5,
      },
      {
        id: 'case-D-invalid-url',
        jd: 'DevOps Engineer needed. Docker and Linux required.',
        company_url: 'not-a-valid-url', // invalid company URL
        days: 4,
      },
      {
        id: 'case-E-valid',
        jd: 'QA Engineer needed. Automation testing required.',
        company_url: `http://127.0.0.1:${site.port}/acme/`,
        days: 1,
      },
    ];

    fs.writeFileSync(testCasesPath, JSON.stringify(adversarialCases, null, 2));

    const envelope = await evaluateBatch({
      inputPath: testCasesPath,
      outputPath,
      concurrency: 2,
      sleep: async () => undefined,
      env: {
        ...process.env,
        LLM_PROVIDER: 'mock',
        EVAL_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${site.port}`,
      },
    });

    expect(envelope.kits).toHaveLength(5);
    expect(envelope.kits.map((k) => k.id)).toEqual([
      'case-A-valid',
      'case-B-malformed',
      'case-C-valid',
      'case-D-invalid-url',
      'case-E-valid',
    ]);

    expect(envelope.kits[0]?.status).toBe('ok');
    expect(envelope.kits[0]?.kit).not.toBeNull();

    expect(envelope.kits[1]?.status).toBe('error');
    expect(envelope.kits[1]?.kit).toBeNull();
    expect(envelope.kits[1]?.error).toContain('jd');

    expect(envelope.kits[2]?.status).toBe('ok');
    expect(envelope.kits[2]?.kit).not.toBeNull();

    expect(envelope.kits[3]?.status).toBe('error');
    expect(envelope.kits[3]?.kit).toBeNull();
    expect(envelope.kits[3]?.error).toBeDefined();

    expect(envelope.kits[4]?.status).toBe('ok');
    expect(envelope.kits[4]?.kit).not.toBeNull();
  });
});

describe('Batch Evaluator - Same-Pipeline Enforcement', () => {
  it('proves tools/evaluate references the exact runPipeline function from @kit/core', async () => {
    const evaluatorModule = await import('../src/evaluator.js');
    expect(evaluatorModule.evaluateBatch).toBeDefined();

    const coreModule = await import('@kit/core');
    expect(coreModule.runPipeline).toBe(runPipeline);
  });

  it('scans tools/evaluate/src to ensure no duplicate domain, scheduling, or coverage logic exists', () => {
    const srcDir = path.resolve(here, '../src');
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

    const forbiddenTerms = [
      'buildSchedule',
      'computeCoverage',
      'applyGuards',
      'assertValidKit',
      'runCoverageLoop',
      'normalizeJd',
      'detectSections',
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      for (const term of forbiddenTerms) {
        // Must not declare or implement these functions
        const declarationPattern = new RegExp(`function\\s+${term}\\b`);
        expect(
          declarationPattern.test(content),
          `${file} should not implement ${term}`,
        ).toBe(false);
      }
    }
  });
});
