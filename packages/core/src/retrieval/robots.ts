/**
 * robots.txt handling (docs/SECURITY.md section 3).
 *
 * robots.txt always lives at the HOST ROOT. A company URL of
 * http://host:8099/acme/ must still consult http://host:8099/robots.txt - the
 * committed fixture splits the two deliberately so this cannot regress.
 */
import type { Fetcher } from './fetch.js';
import type { RetrievalStatus } from './types.js';

/** A hostile robots.txt must not be able to stall the pipeline. */
export const MAX_CRAWL_DELAY_MS = 2_000;
export const DEFAULT_CRAWL_DELAY_MS = 0;

export interface RobotsRules {
  /** True when robots.txt was retrieved and parsed. */
  fetched: boolean;
  status: RetrievalStatus;
  crawlDelayMs: number;
  allow: string[];
  disallow: string[];
  /** True when retrieval failed in a way worth reporting as a research gap. */
  unavailable: boolean;
}

export const ALLOW_ALL: RobotsRules = {
  fetched: false,
  status: 'success',
  crawlDelayMs: DEFAULT_CRAWL_DELAY_MS,
  allow: [],
  disallow: [],
  unavailable: false,
};

/** robots.txt for any URL on a host, always at the host root. */
export function robotsUrlFor(siteUrl: string | URL): string {
  return new URL('/robots.txt', siteUrl).toString();
}

interface Group {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

/**
 * Parse robots.txt and collapse it to the rules that apply to `userAgent`.
 * A group naming our agent wins outright; otherwise the wildcard group applies.
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (current === null || !lastLineWasAgent) {
        current = { agents: [], allow: [], disallow: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (current === null) continue;

    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
    else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    }
  }

  const agent = userAgent.toLowerCase();
  const named = groups.find((group) =>
    group.agents.some((candidate) => candidate !== '*' && agent.includes(candidate)),
  );
  const wildcard = groups.find((group) => group.agents.includes('*'));
  const chosen = named ?? wildcard;

  if (chosen === undefined) return { ...ALLOW_ALL, fetched: true };

  const delaySeconds = chosen.crawlDelaySeconds ?? 0;
  return {
    fetched: true,
    status: 'success',
    // Capped: a robots.txt asking for an hour between requests cannot stall us.
    crawlDelayMs: Math.min(Math.round(delaySeconds * 1000), MAX_CRAWL_DELAY_MS),
    allow: chosen.allow.filter((rule) => rule !== ''),
    disallow: chosen.disallow.filter((rule) => rule !== ''),
    unavailable: false,
  };
}

/** Robots path matching, including the * and $ wildcards. */
function matches(rule: string, pathname: string): number {
  const anchored = rule.endsWith('$');
  const pattern = anchored ? rule.slice(0, -1) : rule;
  const segments = pattern.split('*');

  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment === '') continue;
    const found =
      index === 0
        ? pathname.startsWith(segment)
          ? 0
          : -1
        : pathname.indexOf(segment, cursor);
    if (found === -1) return -1;
    cursor = found + segment.length;
  }
  if (anchored && cursor !== pathname.length) return -1;
  return pattern.length;
}

/**
 * Longest matching rule wins; Allow beats Disallow at equal length. That is
 * the behaviour every major crawler implements.
 */
export function isAllowedByRobots(rules: RobotsRules, target: string | URL): boolean {
  let pathname: string;
  if (typeof target === 'string') {
    if (target.startsWith('/')) {
      pathname = target;
    } else {
      try {
        pathname = new URL(target).pathname;
      } catch {
        pathname = target;
      }
    }
  } else {
    pathname = target.pathname;
  }

  let bestAllow = -1;
  let bestDisallow = -1;
  for (const rule of rules.allow)
    bestAllow = Math.max(bestAllow, matches(rule, pathname));
  for (const rule of rules.disallow)
    bestDisallow = Math.max(bestDisallow, matches(rule, pathname));
  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}

/**
 * Retrieve and parse robots.txt for a site.
 *
 * A 404 means the site simply has no robots.txt, which permits crawling. Any
 * other failure permits crawling too, but is reported so the pipeline can
 * record an honest `robots_unavailable` gap rather than pretending it checked.
 */
export async function fetchRobots(
  fetcher: Fetcher,
  siteUrl: string,
  userAgent: string,
): Promise<RobotsRules> {
  const outcome = await fetcher.fetch(robotsUrlFor(siteUrl));
  if (outcome.status === 'success') return parseRobots(outcome.body, userAgent);
  if (outcome.status === 'not_found') {
    return { ...ALLOW_ALL, status: 'not_found' };
  }
  return { ...ALLOW_ALL, status: outcome.status, unavailable: true };
}
