import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../../../fixtures/serve.js';
import { crawlCompanySite } from '../src/retrieval/crawl.js';
import { Fetcher, type HttpRequestOptions } from '../src/retrieval/fetch.js';
import { extractPage } from '../src/retrieval/extractText.js';
import { SsrfPolicy } from '../src/retrieval/ssrf.js';
import type { ResearchResult } from '../src/retrieval/types.js';

let site: FixtureSite;
let policy: SsrfPolicy;
let base: string;

beforeAll(async () => {
  site = await startFixtureSite({ port: 0 });
  base = `${site.origin}/acme/`;
  // The evaluator fixture exception, scoped to exactly this host and port.
  policy = SsrfPolicy.fromEnv({ EVAL_ALLOW_PRIVATE_HOSTS: `127.0.0.1:${site.port}` });
});
afterAll(async () => {
  await site.close();
});

const crawl = (overrides = {}): Promise<ResearchResult> =>
  crawlCompanySite({
    companyUrl: base,
    policy,
    sleep: async () => undefined,
    ...overrides,
  });

describe('crawl - the homepage gate', () => {
  it('fetches the homepage first, before any discovered page', async () => {
    const requested: string[] = [];
    const fetcher = new Fetcher({
      policy,
      requestImpl: async (url: string, options: HttpRequestOptions) => {
        requested.push(url);
        const { request } = await import('undici');
        return request(url, options);
      },
    });
    await crawl({ fetcher });

    // robots.txt is the only thing allowed to precede it.
    expect(requested[0]).toBe(`${site.origin}/robots.txt`);
    expect(requested[1]).toBe(base);
  });

  it('produces a usable homepage with a title and text', async () => {
    const result = await crawl();
    expect(result.homepage?.retrievalStatus).toBe('success');
    expect(result.homepage?.title).toContain('Acme Robotics');
    expect(result.homepage?.text).toContain('autonomous mobile robots');
    expect(result.homepage?.sourceType).toBe('homepage');
  });
});

describe('crawl - discovery and ranking', () => {
  it('discovers the interview, careers and about pages from a sub-path base', async () => {
    const result = await crawl();
    const types = result.pages
      .filter((p) => p.retrievalStatus === 'success')
      .map((p) => p.sourceType);
    expect(types).toContain('interview');
    expect(types).toContain('careers');
    expect(types).toContain('about');
  });

  it('resolves relative links against the company sub-path, not the origin', async () => {
    const result = await crawl();
    for (const page of result.pages) {
      expect(page.url.startsWith(`${site.origin}/acme/`)).toBe(true);
    }
  });

  it('fetches the interview page ahead of the about page', async () => {
    const result = await crawl();
    const order = result.pages.map((p) => p.sourceType);
    expect(order.indexOf('interview')).toBeLessThan(order.indexOf('about'));
  });

  it('never leaves the site', async () => {
    const result = await crawl();
    for (const url of result.pagesUsed) expect(url.startsWith(site.origin)).toBe(true);
  });

  it('fetches each URL at most once, though the homepage links some twice', async () => {
    const result = await crawl();
    const urls = result.pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('stays at depth 1 - every fetched page was linked from the homepage', async () => {
    const result = await crawl();
    const homepageLinks = new Set(
      extractPage(await (await fetch(base)).text(), base).links.map((l) => l.url),
    );
    for (const page of result.pages) expect(homepageLinks.has(page.url)).toBe(true);
  });

  it('is deterministic across runs', async () => {
    const first = await crawl();
    const second = await crawl();
    expect(second.pages.map((p) => p.url)).toEqual(first.pages.map((p) => p.url));
    expect(second.gaps).toEqual(first.gaps);
  });
});

describe('crawl - budgets', () => {
  it('respects the page budget, counting the homepage', async () => {
    const result = await crawl({ maxPages: 2 });
    expect(result.pages).toHaveLength(1);
  });

  it('fetches nothing beyond the homepage when the budget is 1', async () => {
    expect((await crawl({ maxPages: 1 })).pages).toHaveLength(0);
  });

  it('stops and records a gap when the time budget is spent', async () => {
    let now = 0;
    const result = await crawl({
      // The clock jumps past the deadline after the homepage.
      monotonic: () => (now += 10_000),
      budgetMs: 5_000,
    });
    expect(result.budgetExhausted).toBe(true);
    expect(result.gaps).toContain('budget_exhausted');
  });

  it('caps extracted text at the supplied budget', async () => {
    const result = await crawl({ maxTextChars: 200 });
    expect(result.homepage?.text.length ?? 0).toBeLessThanOrEqual(210);
  });
});

describe('crawl - robots and safety', () => {
  it('records a robots-disallowed link as blocked and never fetches it', async () => {
    const result = await crawl();
    expect(result.robotsBlocked.some((u) => u.includes('/acme/private/'))).toBe(true);
    for (const page of result.pages) expect(page.url).not.toContain('/acme/private/');
  });

  it('never surfaces text from a robots-disallowed page', async () => {
    const result = await crawl();
    const allText = [
      result.homepage?.text ?? '',
      ...result.pages.map((p) => p.text),
    ].join(' ');
    expect(allText).not.toContain('robots handling is broken');
  });

  it('surfaces injection flags with the page that carried them', async () => {
    const result = await crawl();
    const flagged = result.injectionFlags.filter((f) => f.url.includes('about.html'));
    expect(flagged.map((f) => f.pattern)).toContain('ignore_previous_instructions');
  });

  it('strips the injection text from the retained research', async () => {
    const result = await crawl();
    const about = result.pages.find((p) => p.sourceType === 'about');
    expect(about?.text).not.toMatch(/ignore all previous instructions/i);
    expect(about?.text).toContain('Founded in 2016');
  });

  it('refuses the fixture under the production policy', async () => {
    const result = await crawlCompanySite({
      companyUrl: base,
      policy: SsrfPolicy.strict(),
      sleep: async () => undefined,
    });
    expect(result.gaps).toContain('invalid_url');
    expect(result.pagesUsed).toEqual([]);
  });
});

/** A canned site, so degradation can be tested without contriving a server. */
function stubSite(
  pages: Record<string, { status?: number; html?: string; type?: string }>,
) {
  const requestImpl = async (url: string) => {
    const pathname = new URL(url).pathname;
    const page = pages[pathname];
    const status = page?.status ?? (page === undefined ? 404 : 200);
    const html = page?.html ?? '';
    return {
      statusCode: status,
      headers: { 'content-type': page?.type ?? 'text/html' },
      body: (async function* () {
        yield new TextEncoder().encode(html);
      })(),
    };
  };
  return new Fetcher({
    policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
    requestImpl,
  });
}

const HOME = 'https://acme.example/';

describe('crawl - graceful degradation', () => {
  it('keeps the pages that worked when one fails', async () => {
    const fetcher = stubSite({
      '/robots.txt': { html: 'User-agent: *', type: 'text/plain' },
      '/': {
        html: [
          '<a href="/careers/">Careers</a>',
          '<a href="/about.html">About us</a>',
          '<a href="/careers/interview-process.html">Interview process</a>',
        ].join(''),
      },
      '/careers/': { status: 500 },
      '/about.html': { html: '<p>Founded in 2016.</p>' },
      '/careers/interview-process.html': { html: '<p>Four stages.</p>' },
    });

    const result = await crawlCompanySite({
      companyUrl: HOME,
      policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
      fetcher,
      sleep: async () => undefined,
    });

    const byType = new Map(result.pages.map((p) => [p.sourceType, p.retrievalStatus]));
    expect(byType.get('interview')).toBe('success');
    expect(byType.get('about')).toBe('success');
    // The failure is recorded, not swallowed, and not fatal.
    expect(byType.get('careers')).toBe('server_error');
    expect(result.pagesUsed).toHaveLength(3);
  });

  it('records no_hiring_page when neither careers nor interview exists', async () => {
    const fetcher = stubSite({
      '/robots.txt': { status: 404, type: 'text/plain' },
      '/': { html: '<a href="/about.html">About us</a>' },
      '/about.html': { html: '<p>Founded in 2016.</p>' },
    });
    const result = await crawlCompanySite({
      companyUrl: HOME,
      policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
      fetcher,
      sleep: async () => undefined,
    });

    expect(result.gaps).toContain('no_hiring_page');
    expect(result.gaps).not.toContain('no_about_page');
    expect(result.homepage?.retrievalStatus).toBe('success');
  });

  it('records no_about_page when the site has no about page', async () => {
    const fetcher = stubSite({
      '/robots.txt': { status: 404, type: 'text/plain' },
      '/': { html: '<a href="/careers/">Careers</a>' },
      '/careers/': { html: '<p>We are hiring.</p>' },
    });
    const result = await crawlCompanySite({
      companyUrl: HOME,
      policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
      fetcher,
      sleep: async () => undefined,
    });

    expect(result.gaps).toContain('no_about_page');
    expect(result.gaps).not.toContain('no_hiring_page');
  });

  it('records robots_unavailable but still crawls', async () => {
    const fetcher = stubSite({
      '/robots.txt': { status: 503, type: 'text/plain' },
      '/': { html: '<a href="/about.html">About</a>' },
      '/about.html': { html: '<p>About us.</p>' },
    });
    const result = await crawlCompanySite({
      companyUrl: HOME,
      policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
      fetcher,
      sleep: async () => undefined,
    });

    expect(result.gaps).toContain('robots_unavailable');
    expect(result.homepage?.retrievalStatus).toBe('success');
  });

  it('stops cleanly when the homepage cannot be retrieved', async () => {
    const fetcher = stubSite({ '/robots.txt': { status: 404, type: 'text/plain' } });
    const result = await crawlCompanySite({
      companyUrl: HOME,
      policy: SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] }),
      fetcher,
      sleep: async () => undefined,
    });

    expect(result.gaps).toContain('homepage_unreachable');
    expect(result.homepage?.retrievalStatus).toBe('not_found');
    expect(result.pages).toEqual([]);
    expect(result.pagesUsed).toEqual([]);
  });

  it.each([
    ['an unparseable URL', 'not a url'],
    ['a non-http protocol', 'ftp://acme.example/'],
    ['a loopback address', 'http://127.0.0.1/'],
  ])('fails the stage cleanly for %s, keeping the reason', async (_label, companyUrl) => {
    const result = await crawlCompanySite({
      companyUrl,
      policy: SsrfPolicy.strict(),
      sleep: async () => undefined,
    });

    expect(result.gaps).toContain('invalid_url');
    expect(result.homepage?.retrievalStatus).toBe('blocked');
    expect(result.homepage?.detail).toBeTruthy();
    expect(result.pagesUsed).toEqual([]);
  });

  it('never claims to have searched public discussion - that is a later stage', async () => {
    // Stage 9 lives outside the crawler; the gap vocabulary reserves the name.
    const result = await crawl();
    expect(result.gaps).not.toContain('no_public_discussion');
  });
});
