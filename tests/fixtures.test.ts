/**
 * Fixture integrity. These fixtures are the substrate for the Phase 2-4
 * extraction, retrieval and evaluator tests, so a silent drift here would
 * quietly weaken everything downstream.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../fixtures/serve';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJd = (name: string) =>
  fs.readFileSync(path.join(REPO, 'fixtures', 'jds', `${name}.txt`), 'utf8');

interface EvaluatorCase {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

const cases: EvaluatorCase[] = JSON.parse(
  fs.readFileSync(path.join(REPO, 'fixtures', 'cases.json'), 'utf8'),
);

describe('fixtures/cases.json', () => {
  it('is a non-empty array with unique ids', () => {
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('matches the evaluator input contract on every case', () => {
    for (const c of cases) {
      expect(typeof c.id, c.id).toBe('string');
      expect(c.jd.length, c.id).toBeGreaterThan(0);
      expect(() => new URL(c.company_url), c.id).not.toThrow();
      expect(Number.isInteger(c.days), c.id).toBe(true);
      expect(c.days, c.id).toBeGreaterThanOrEqual(1);
      expect(c.days, c.id).toBeLessThanOrEqual(60);
    }
  });

  it('exercises both schedule boundaries', () => {
    const days = cases.map((c) => c.days);
    expect(days).toContain(1);
    expect(days).toContain(60);
  });

  it.each([
    ['case-01-rich', 'rich'],
    ['case-02-thin', 'thin'],
    ['case-03-heading-less', 'heading-less'],
    ['case-04-boilerplate', 'boilerplate-heavy'],
    ['case-05-retrieval-failure', 'rich'],
  ])('%s carries the exact text of fixtures/jds/%s.txt', (id, jd) => {
    const found = cases.find((c) => c.id === id);
    expect(found, `case ${id} missing`).toBeDefined();
    expect(found?.jd).toBe(readJd(jd));
  });

  it('includes a case whose company_url cannot be retrieved', () => {
    expect(cases.some((c) => c.company_url.includes('does-not-exist'))).toBe(true);
  });
});

describe('fixtures/jds', () => {
  it('thin JD is genuinely thin and rich JD is not', () => {
    expect(readJd('thin').length).toBeLessThan(400);
    expect(readJd('rich').length).toBeGreaterThan(1000);
  });

  it('rich JD has explicit must and nice sections for the priority override', () => {
    const rich = readJd('rich');
    expect(rich).toMatch(/^Requirements$/m);
    expect(rich).toMatch(/^Nice to have$/m);
  });

  it('heading-less JD really has no section headings', () => {
    const text = readJd('heading-less');
    expect(text).not.toMatch(/^Requirements$/m);
    expect(text).not.toMatch(/^Nice to have$/m);
  });

  it('boilerplate JD contains benefits and EEO text that must never be requirements', () => {
    const text = readJd('boilerplate-heavy');
    expect(text).toMatch(/equal opportunity employer/i);
    expect(text).toMatch(/annual leave/i);
  });
});

describe('fixtures/site served over HTTP', () => {
  let site: FixtureSite;
  beforeAll(async () => {
    site = await startFixtureSite({ port: 0 });
  });
  afterAll(async () => {
    await site.close();
  });

  const get = (p: string) => fetch(`${site.origin}${p}`);

  it.each([
    ['/', 'Fixture host root'],
    ['/acme/', 'Acme Robotics'],
    ['/acme/about.html', 'Founded in 2016'],
    ['/acme/careers/', 'Senior Frontend Engineer'],
    ['/acme/careers/interview-process.html', 'Practical exercise'],
    ['/acme/blog/', 'Engineering blog'],
  ])('serves %s', async (p, needle) => {
    const res = await get(p);
    expect(res.status, p).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain(needle);
  });

  it('the company homepage advertises a link that is genuinely dead', async () => {
    const html = await (await get('/acme/')).text();
    expect(html).toContain('href="team.html"');
    expect((await get('/acme/team.html')).status).toBe(404);
  });

  it('serves the company site from a sub-path, as a grader-supplied URL would', async () => {
    // The evaluator's example company_url is a sub-path, not a host root, and
    // relative hrefs must resolve against it rather than against the origin.
    const html = await (await get('/acme/careers/')).text();
    expect(html).toContain('href="interview-process.html"');
    expect(html).toContain('href="../about.html"');

    const base = `${site.origin}/acme/careers/`;
    expect(new URL('interview-process.html', base).pathname).toBe(
      '/acme/careers/interview-process.html',
    );
    expect(new URL('../about.html', base).pathname).toBe('/acme/about.html');
    expect((await get('/acme/careers/interview-process.html')).status).toBe(200);
    expect((await get('/acme/about.html')).status).toBe(200);
  });

  it('serves robots.txt from the host root, not the company sub-path', async () => {
    // robots.txt is always host-rooted. A crawler pointed at /acme/ must still
    // look here, so the fixture deliberately splits the two locations.
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Disallow: /acme/private/');
    expect(body).toContain('Crawl-delay:');
    expect((await get('/acme/robots.txt')).status).toBe(404);
  });

  it('the robots-disallowed page exists, so compliance is observable', async () => {
    const res = await get('/acme/private/internal-notes.html');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('must never fetch this page');
  });

  it('carries a prompt-injection payload for the stage 10/11 defence tests', async () => {
    const html = await (await get('/acme/about.html')).text();
    expect(html).toContain('Ignore all previous instructions');
  });

  it('refuses to serve files outside the fixture root', async () => {
    const res = await fetch(`${site.origin}/../package.json`);
    expect(res.status).not.toBe(200);
  });
});
