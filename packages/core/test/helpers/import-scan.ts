/**
 * Import-boundary scanner for packages/core (see docs/DECISIONS.md D-002).
 *
 * packages/core must stay framework-independent so that apps/api and
 * tools/evaluate can provably run the same runPipeline(). This helper is test
 * infrastructure, not production code: it extracts module specifiers from a
 * source file and reports the ones that would break that boundary.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Bare package names packages/core must never depend on. */
export const FORBIDDEN_PACKAGES: readonly string[] = [
  // HTTP / server frameworks
  'express',
  'koa',
  'fastify',
  // persistence
  'mongodb',
  'mongoose',
  'connect-mongo',
  // browser / UI only
  'next',
  'react',
  'react-dom',
  // sibling workspaces (core sits below them, never above)
  '@kit/api',
  '@kit/web',
  '@kit/evaluate',
];

const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bimport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractModuleSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec) found.add(spec);
    }
  }
  return [...found];
}

/** Reduce a specifier to its bare package name: next/navigation -> next. */
export function barePackageName(spec: string): string {
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? spec;
}

export function isForbiddenPackage(spec: string): boolean {
  if (spec.startsWith('.') || spec.startsWith('/')) return false;
  return FORBIDDEN_PACKAGES.includes(barePackageName(spec));
}

/** True when a relative import reaches outside the package root. */
export function escapesPackage(
  fromFile: string,
  spec: string,
  packageRoot: string,
): boolean {
  if (!spec.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const rel = path.relative(path.resolve(packageRoot), resolved);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

export interface Violation {
  file: string;
  specifier: string;
  reason: 'forbidden-package' | 'escapes-package';
}

export function listTsFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

export function scanPackage(packageRoot: string, sourceDir = 'src'): Violation[] {
  const violations: Violation[] = [];
  for (const file of listTsFiles(path.join(packageRoot, sourceDir))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of extractModuleSpecifiers(source)) {
      if (isForbiddenPackage(specifier)) {
        violations.push({ file, specifier, reason: 'forbidden-package' });
      } else if (escapesPackage(file, specifier, packageRoot)) {
        violations.push({ file, specifier, reason: 'escapes-package' });
      }
    }
  }
  return violations;
}
