/**
 * Depth-1 company-site crawl (docs/PIPELINE.md stages 4-8).
 *
 * Not a general-purpose crawler. It answers one question - what can this
 * company's own site tell us about the role and the interview - inside strict
 * page, size and time budgets.
 *
 * The homepage is a HARD GATE: no page is treated as useful until the homepage
 * has been fetched and its links ranked. Every other page is optional, and a
 * failure is recorded rather than propagated.
 */
import { Fetcher, type FetcherOptions } from './fetch.js';
import { fetchRobots, isAllowedByRobots, ALLOW_ALL, type RobotsRules } from './robots.js';
import { extractPage, MAX_PAGE_TEXT_CHARS } from './extractText.js';
import { rankLinks, type DiscoveredLink, type RankedLink } from './rank.js';
import { sanitizeResearchText } from './sanitize.js';
import type { SsrfPolicy } from './ssrf.js';
import type { PageResult, ResearchGap, ResearchResult, SourceType } from './types.js';

export const DEFAULT_MAX_PAGES = 5;
export const DEFAULT_CRAWL_BUDGET_MS = 45_000;
/** Links scoring at or below this are not worth a fetch. */
export const MIN_LINK_SCORE = 1;

export interface CrawlOptions {
  companyUrl: string;
  policy: SsrfPolicy;
  /** Supply one to inject a stub; otherwise built from the policy. */
  fetcher?: Fetcher;
  fetcherOptions?: Partial<Omit<FetcherOptions, 'policy'>>;
  userAgent?: string;
  maxPages?: number;
  budgetMs?: number;
  maxTextChars?: number;
  /** Injectable clocks keep budget tests instant and deterministic. */
  monotonic?: () => number;
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

function emptyPage(
  url: string,
  sourceType: SourceType,
  status: PageResult['retrievalStatus'],
  detail: string | null,
  fetchedAt: string,
): PageResult {
  return {
    url,
    finalUrl: url,
    title: '',
    status: null,
    contentType: null,
    fetchedAt,
    text: '',
    sourceType,
    retrievalStatus: status,
    detail,
    bytes: 0,
    injectionFlags: [],
  };
}

interface FetchedPage {
  page: PageResult;
  links: DiscoveredLink[];
}

async function fetchPage(
  fetcher: Fetcher,
  url: string,
  sourceType: SourceType,
  maxTextChars: number,
): Promise<FetchedPage> {
  const outcome = await fetcher.fetch(url);
  if (outcome.status !== 'success') {
    return {
      page: {
        ...emptyPage(url, sourceType, outcome.status, outcome.detail, outcome.fetchedAt),
        finalUrl: outcome.finalUrl,
        status: outcome.httpStatus,
        contentType: outcome.contentType,
        bytes: outcome.bytes,
      },
      links: [],
    };
  }

  const extracted = extractPage(outcome.body, outcome.finalUrl, {
    maxChars: maxTextChars,
  });
  const sanitized = sanitizeResearchText(extracted.text);

  return {
    page: {
      url,
      finalUrl: outcome.finalUrl,
      title: extracted.title,
      status: outcome.httpStatus,
      contentType: outcome.contentType,
      fetchedAt: outcome.fetchedAt,
      text: sanitized.text,
      sourceType,
      retrievalStatus: 'success',
      detail: null,
      bytes: outcome.bytes,
      injectionFlags: sanitized.flags,
    },
    links: extracted.links,
  };
}

function robotsAllows(rules: RobotsRules, url: string): boolean {
  try {
    return isAllowedByRobots(rules, new URL(url).pathname);
  } catch {
    return true;
  }
}

export async function crawlCompanySite(options: CrawlOptions): Promise<ResearchResult> {
  const clock = options.clock ?? (() => new Date());
  const monotonic = options.monotonic ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const budgetMs = options.budgetMs ?? DEFAULT_CRAWL_BUDGET_MS;
  const maxTextChars = options.maxTextChars ?? MAX_PAGE_TEXT_CHARS;

  const fetcher =
    options.fetcher ?? new Fetcher({ policy: options.policy, ...options.fetcherOptions });
  const userAgent = options.userAgent ?? fetcher.userAgent;

  const startedAt = clock().toISOString();
  const deadline = monotonic() + budgetMs;
  const gaps: ResearchGap[] = [];
  const robotsBlocked: string[] = [];
  const pages: PageResult[] = [];
  let budgetExhausted = false;

  const finish = (homepage: PageResult | null): ResearchResult => {
    const used = [homepage, ...pages].filter(
      (page): page is PageResult => page !== null && page.retrievalStatus === 'success',
    );
    return {
      requestedUrl: options.companyUrl,
      homepage,
      pages,
      pagesUsed: used.map((page) => page.finalUrl),
      gaps,
      robotsBlocked,
      injectionFlags: used.flatMap((page) =>
        page.injectionFlags.map((flag) => ({
          url: page.finalUrl,
          pattern: flag.pattern,
        })),
      ),
      budgetExhausted,
      startedAt,
      finishedAt: clock().toISOString(),
    };
  };

  // Stage 3: the FULL SSRF verdict, including DNS. Syntax alone would let a
  // loopback literal through to be rejected later as a vague fetch failure,
  // which reports the wrong gap and wastes a robots.txt round trip.
  const syntax = await options.policy.checkDestination(options.companyUrl);
  if (!syntax.allowed) {
    gaps.push('invalid_url');
    // Keep the reason: "blocked_hostname" and "protocol_not_allowed" are very
    // different problems for a user staring at a failed kit.
    return finish(
      emptyPage(
        options.companyUrl,
        'homepage',
        'blocked',
        `${syntax.reason}: ${syntax.detail}`,
        clock().toISOString(),
      ),
    );
  }
  const baseUrl = syntax.url.toString();

  // robots.txt comes from the HOST ROOT, never the supplied path.
  const robots = await fetchRobots(fetcher, baseUrl, userAgent);
  if (robots.unavailable) gaps.push('robots_unavailable');
  const rules: RobotsRules = robots.fetched
    ? robots
    : { ...ALLOW_ALL, status: robots.status };

  // Stage 4: the homepage gate.
  let homepage: PageResult;
  let homepageLinks: DiscoveredLink[] = [];
  if (!robotsAllows(rules, baseUrl)) {
    robotsBlocked.push(baseUrl);
    homepage = emptyPage(
      baseUrl,
      'homepage',
      'robots_disallowed',
      'robots.txt disallows this path',
      clock().toISOString(),
    );
  } else {
    const fetched = await fetchPage(fetcher, baseUrl, 'homepage', maxTextChars);
    homepage = fetched.page;
    homepageLinks = fetched.links;
  }

  if (homepage.retrievalStatus !== 'success') {
    gaps.push('homepage_unreachable');
    return finish(homepage);
  }

  // Stages 5 and 6: discover and rank. Depth 1 - only homepage links.
  const ranked: RankedLink[] = rankLinks(homepageLinks, baseUrl).filter(
    (link) => link.url !== baseUrl && link.score >= MIN_LINK_SCORE,
  );

  // Stages 7 and 8: fetch the best candidates within every budget.
  const budgetForPages = Math.max(0, maxPages - 1);
  for (const link of ranked) {
    if (pages.length >= budgetForPages) break;
    if (monotonic() >= deadline) {
      budgetExhausted = true;
      gaps.push('budget_exhausted');
      break;
    }
    if (!robotsAllows(rules, link.url)) {
      robotsBlocked.push(link.url);
      continue;
    }
    if (rules.crawlDelayMs > 0) await sleep(rules.crawlDelayMs);

    const fetched = await fetchPage(fetcher, link.url, link.sourceType, maxTextChars);
    pages.push(fetched.page);
  }

  // Honest gaps: absence is recorded, never invented around.
  const usable = [homepage, ...pages].filter(
    (page) => page.retrievalStatus === 'success',
  );
  const types = new Set(usable.map((page) => page.sourceType));
  if (!types.has('about')) gaps.push('no_about_page');
  if (!types.has('careers') && !types.has('interview')) gaps.push('no_hiring_page');

  return finish(homepage);
}

/** Convenience for callers that only want the type of a URL. */
export { classifyLink, normalizeUrl } from './rank.js';
