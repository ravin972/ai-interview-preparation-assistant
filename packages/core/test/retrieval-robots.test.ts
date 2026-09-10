import { describe, expect, it } from 'vitest';
import {
  MAX_CRAWL_DELAY_MS,
  fetchRobots,
  isAllowedByRobots,
  parseRobots,
  robotsUrlFor,
} from '../src/retrieval/robots.js';
import { Fetcher } from '../src/retrieval/fetch.js';
import { SsrfPolicy } from '../src/retrieval/ssrf.js';

const UA = 'ai-interview-prep-kit/0.1';

const ACME_ROBOTS = [
  'User-agent: *',
  'Disallow: /acme/private/',
  'Disallow: /acme/careers/apply',
  'Crawl-delay: 1',
  '',
  'Sitemap: http://127.0.0.1:8099/sitemap.xml',
].join('\n');

describe('robotsUrlFor - always the host root', () => {
  it.each([
    ['http://host:8099/acme/', 'http://host:8099/robots.txt'],
    [
      'http://host:8099/acme/careers/interview-process.html',
      'http://host:8099/robots.txt',
    ],
    ['https://example.com/', 'https://example.com/robots.txt'],
    ['https://example.com/deep/nested/path', 'https://example.com/robots.txt'],
  ])('%s resolves to %s', (input, expected) => {
    expect(robotsUrlFor(input)).toBe(expected);
  });

  it('never looks under the supplied company path', () => {
    // The whole point of the /acme/ fixture: content is at a sub-path, robots
    // is at the host root, and a crawler must not conflate the two.
    expect(robotsUrlFor('http://host:8099/acme/')).not.toContain('/acme/');
  });
});

describe('parseRobots', () => {
  it('parses the fixture rules for the wildcard agent', () => {
    const rules = parseRobots(ACME_ROBOTS, UA);
    expect(rules.fetched).toBe(true);
    expect(rules.disallow).toEqual(['/acme/private/', '/acme/careers/apply']);
    expect(rules.crawlDelayMs).toBe(1000);
  });

  it('prefers a group naming our agent over the wildcard group', () => {
    const rules = parseRobots(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: ai-interview-prep-kit',
        'Disallow: /admin/',
      ].join('\n'),
      UA,
    );
    expect(rules.disallow).toEqual(['/admin/']);
    expect(isAllowedByRobots(rules, '/acme/')).toBe(true);
  });

  it('groups consecutive user-agent lines together', () => {
    const rules = parseRobots(
      ['User-agent: googlebot', 'User-agent: *', 'Disallow: /secret/'].join('\n'),
      UA,
    );
    expect(rules.disallow).toEqual(['/secret/']);
  });

  it('ignores comments and blank lines', () => {
    const rules = parseRobots(
      ['# a comment', 'User-agent: *', '', 'Disallow: /x/ # trailing note'].join('\n'),
      UA,
    );
    expect(rules.disallow).toEqual(['/x/']);
  });

  it('treats an empty Disallow as permitting everything', () => {
    const rules = parseRobots(['User-agent: *', 'Disallow:'].join('\n'), UA);
    expect(rules.disallow).toEqual([]);
    expect(isAllowedByRobots(rules, '/anything')).toBe(true);
  });

  it('caps a hostile crawl-delay', () => {
    const rules = parseRobots(['User-agent: *', 'Crawl-delay: 3600'].join('\n'), UA);
    expect(rules.crawlDelayMs).toBe(MAX_CRAWL_DELAY_MS);
  });

  it('ignores a non-numeric crawl-delay', () => {
    expect(
      parseRobots(['User-agent: *', 'Crawl-delay: soon'].join('\n'), UA).crawlDelayMs,
    ).toBe(0);
  });

  it('permits everything when robots.txt is empty', () => {
    expect(isAllowedByRobots(parseRobots('', UA), '/acme/')).toBe(true);
  });
});

describe('isAllowedByRobots', () => {
  const rules = parseRobots(ACME_ROBOTS, UA);

  it.each([
    ['/acme/', true],
    ['/acme/about.html', true],
    ['/acme/careers/', true],
    ['/acme/careers/interview-process.html', true],
    ['/acme/private/', false],
    ['/acme/private/internal-notes.html', false],
    ['/acme/private/interview-archive.html', false],
    ['/acme/careers/apply', false],
    ['/acme/careers/apply/form', false],
  ])('%s -> allowed=%s', (pathname, allowed) => {
    expect(isAllowedByRobots(rules, pathname)).toBe(allowed);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const override = parseRobots(
      ['User-agent: *', 'Disallow: /docs/', 'Allow: /docs/public/'].join('\n'),
      UA,
    );
    expect(isAllowedByRobots(override, '/docs/secret')).toBe(false);
    expect(isAllowedByRobots(override, '/docs/public/guide')).toBe(true);
  });

  it('supports the * and $ wildcards', () => {
    const wild = parseRobots(
      ['User-agent: *', 'Disallow: /*.pdf$', 'Disallow: /a/*/private'].join('\n'),
      UA,
    );
    expect(isAllowedByRobots(wild, '/reports/annual.pdf')).toBe(false);
    expect(isAllowedByRobots(wild, '/reports/annual.pdf.html')).toBe(true);
    expect(isAllowedByRobots(wild, '/a/b/private')).toBe(false);
  });

  it('correctly handles full URLs by extracting pathname', () => {
    const rules = parseRobots(ACME_ROBOTS, UA);
    expect(
      isAllowedByRobots(
        rules,
        'http://127.0.0.1:8099/acme/private/interview-archive.html',
      ),
    ).toBe(false);
    expect(
      isAllowedByRobots(
        rules,
        'http://127.0.0.1:8099/acme/careers/interview-process.html',
      ),
    ).toBe(true);
  });
});

describe('fetchRobots - retrieval outcomes', () => {
  const fetcherWith = (stub: { status?: number; body?: string; type?: string }) => {
    const requestImpl = async () => ({
      statusCode: stub.status ?? 200,
      headers: { 'content-type': stub.type ?? 'text/plain' },
      body: (async function* () {
        yield new TextEncoder().encode(stub.body ?? '');
      })(),
    });
    return new Fetcher({
      policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
      requestImpl,
    });
  };

  it('parses a retrieved robots.txt', async () => {
    const rules = await fetchRobots(
      fetcherWith({ body: ACME_ROBOTS }),
      'https://example.com/x/',
      UA,
    );
    expect(rules.fetched).toBe(true);
    expect(rules.disallow).toContain('/acme/private/');
  });

  it('treats a 404 as "no robots.txt", which permits crawling', async () => {
    const rules = await fetchRobots(
      fetcherWith({ status: 404 }),
      'https://example.com/',
      UA,
    );
    expect(rules.unavailable).toBe(false);
    expect(isAllowedByRobots(rules, '/anything')).toBe(true);
  });

  it.each([500, 429])(
    'reports HTTP %s as unavailable so a gap is recorded',
    async (status) => {
      const rules = await fetchRobots(
        fetcherWith({ status }),
        'https://example.com/',
        UA,
      );
      expect(rules.unavailable).toBe(true);
      // Still permits crawling - refusing to research a site because its
      // robots.txt is flaky would be worse, and the gap is reported honestly.
      expect(isAllowedByRobots(rules, '/anything')).toBe(true);
    },
  );
});
