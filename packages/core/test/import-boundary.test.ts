/**
 * Enforces docs/DECISIONS.md D-002: packages/core stays framework-independent.
 *
 * Two halves. The first proves the scanner itself detects violations (so the
 * repository scan below is never vacuously green). The second scans the real
 * packages/core/src tree.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  escapesPackage,
  extractModuleSpecifiers,
  isForbiddenPackage,
  listTsFiles,
  scanPackage,
} from './helpers/import-scan';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(here, '..');

describe('module specifier extraction', () => {
  it('finds every import form core might use', () => {
    const source = [
      "import express from 'express';",
      "import type { Db } from 'mongodb';",
      "import './side-effect.js';",
      "export { thing } from './thing.js';",
      "const mod = await import('next/navigation');",
      "const legacy = require('react-dom');",
    ].join('\n');

    expect(extractModuleSpecifiers(source).sort()).toEqual(
      [
        './side-effect.js',
        './thing.js',
        'express',
        'mongodb',
        'next/navigation',
        'react-dom',
      ].sort(),
    );
  });
});

describe('forbidden package detection', () => {
  it.each([
    'express',
    'mongodb',
    'mongoose',
    'next',
    'next/navigation',
    'react',
    'react-dom/client',
    '@kit/api',
  ])('rejects %s', (spec) => {
    expect(isForbiddenPackage(spec)).toBe(true);
  });

  it.each([
    'node:crypto',
    'node:dns/promises',
    'zod',
    'undici',
    'cheerio',
    'robots-parser',
    './schema/kit.js',
  ])('allows %s', (spec) => {
    expect(isForbiddenPackage(spec)).toBe(false);
  });
});

describe('relative escape detection', () => {
  const file = path.join(CORE_ROOT, 'src', 'pipeline', 'run.ts');

  it('flags a relative import that leaves the package', () => {
    expect(escapesPackage(file, '../../../apps/api/src/db.js', CORE_ROOT)).toBe(true);
  });

  it('allows a relative import that stays inside the package', () => {
    expect(escapesPackage(file, '../schedule/schedule.js', CORE_ROOT)).toBe(false);
  });
});

describe('scanner end-to-end', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-boundary-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('detects violations in a synthetic package', () => {
    fs.mkdirSync(path.join(tmp, 'src', 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'clean.ts'),
      "import { z } from 'zod';\nexport const ok = z;\n",
    );
    fs.writeFileSync(
      path.join(tmp, 'src', 'nested', 'dirty.ts'),
      "import express from 'express';\nimport db from '../../../outside/db.js';\nexport { express, db };\n",
    );

    const violations = scanPackage(tmp);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.reason).sort()).toEqual([
      'escapes-package',
      'forbidden-package',
    ]);
  });

  it('finds no violations in packages/core/src', () => {
    const violations = scanPackage(CORE_ROOT);
    const rendered = violations
      .map((v) => `${path.relative(CORE_ROOT, v.file)} -> ${v.specifier} (${v.reason})`)
      .join('\n');
    expect(rendered).toBe('');
  });

  it('actually scanned the core source tree', () => {
    // Guards against the scan passing simply because it found nothing.
    const scanned = listTsFiles(path.join(CORE_ROOT, 'src'));
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.some((f) => f.endsWith('schedule.ts'))).toBe(true);
  });

  it('core source imports only permitted specifiers', () => {
    const specifiers = new Set<string>();
    for (const file of listTsFiles(path.join(CORE_ROOT, 'src'))) {
      for (const spec of extractModuleSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) specifiers.add(spec);
      }
    }
    // The entire external surface of the framework-independent core. This list
    // is meant to grow rarely and deliberately: zod for schemas (Phase 1),
    // undici and cheerio for retrieval (Phase 3), and two node builtins the
    // SSRF policy needs. Nothing here is a framework or a database driver.
    expect([...specifiers].sort()).toEqual([
      'cheerio',
      'node:dns/promises',
      'node:net',
      'undici',
      'zod',
    ]);
  });

  it('core imports no framework, database or browser package', () => {
    for (const file of listTsFiles(path.join(CORE_ROOT, 'src'))) {
      for (const spec of extractModuleSpecifiers(fs.readFileSync(file, 'utf8'))) {
        expect(isForbiddenPackage(spec), `${file} imports ${spec}`).toBe(false);
      }
    }
  });
});
