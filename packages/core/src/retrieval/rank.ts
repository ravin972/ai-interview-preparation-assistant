/**
 * Deterministic link ranking (docs/PIPELINE.md section 2).
 *
 * Stage 6 is application code, not a model call. Two reasons, and both matter:
 * it is the LLM-boundary answer the specification asks for, and it means
 * crawled page content can never steer which pages we fetch next - a page
 * cannot talk us into following its links.
 */
import type { SourceType } from './types.js';

export interface DiscoveredLink {
  url: string;
  anchorText: string;
}

export interface RankedLink extends DiscoveredLink {
  score: number;
  sourceType: SourceType;
}

/** Higher is better. Interview material is the most valuable thing on a site. */
const TYPE_RULES: readonly {
  type: SourceType;
  score: number;
  keywords: readonly string[];
}[] = [
  {
    type: 'interview',
    score: 100,
    keywords: [
      'interview',
      'interview-process',
      'hiring-process',
      'our-process',
      'what-to-expect',
    ],
  },
  {
    type: 'careers',
    score: 70,
    keywords: [
      'careers',
      'career',
      'jobs',
      'job',
      'hiring',
      'vacancies',
      'join-us',
      'work-with-us',
      'openings',
      'opportunities',
    ],
  },
  {
    type: 'about',
    score: 60,
    keywords: ['about', 'about-us', 'company', 'who-we-are', 'our-story', 'mission'],
  },
  {
    type: 'engineering',
    score: 40,
    keywords: ['engineering', 'developers', 'tech-blog', 'engineering-blog', 'techblog'],
  },
  {
    type: 'culture',
    score: 30,
    keywords: ['culture', 'values', 'life-at', 'our-people', 'team'],
  },
];

const ASSET_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.zip',
  '.gz',
  '.mp4',
  '.mp3',
  '.css',
  '.js',
  '.json',
  '.xml',
  '.rss',
];

/** Strip the fragment and normalise case so the same page is not fetched twice. */
export function normalizeUrl(input: string | URL, base?: string | URL): string | null {
  try {
    const url = base === undefined ? new URL(input) : new URL(String(input), base);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = '';
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Same-site matching: exact hostname match OR legitimate subdomains.
 *
 * A base hostname can include its legitimate subdomains (e.g. careers.company.com
 * for company.com), but arbitrary suffix matches (e.g. evilcompany.com or
 * company.com.evil.com) are rejected.
 */
export function isSameSite(candidate: string | URL, base: string | URL): boolean {
  try {
    const candidateHost = new URL(String(candidate)).hostname.toLowerCase();
    const baseHost = new URL(String(base)).hostname.toLowerCase();
    return candidateHost === baseHost || candidateHost.endsWith('.' + baseHost);
  } catch {
    return false;
  }
}

function haystack(url: string, anchorText: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname} ${anchorText}`.toLowerCase().replace(/[_\s]+/g, '-');
  } catch {
    return anchorText.toLowerCase();
  }
}

export function classifyLink(url: string, anchorText = ''): SourceType {
  const text = haystack(url, anchorText);
  for (const rule of TYPE_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule.type;
  }
  return 'other';
}

export function scoreLink(url: string, anchorText = ''): number {
  const text = haystack(url, anchorText);
  let score = 0;

  for (const rule of TYPE_RULES) {
    const hits = rule.keywords.filter((keyword) => text.includes(keyword)).length;
    if (hits > 0) {
      score = Math.max(score, rule.score + (hits - 1) * 5);
    }
  }

  let pathname = '';
  let query = '';
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname.toLowerCase();
    query = parsed.search;
  } catch {
    return score;
  }

  // Assets carry no research value and cost a fetch.
  if (ASSET_EXTENSIONS.some((extension) => pathname.endsWith(extension))) return -100;

  const depth = pathname.split('/').filter((segment) => segment !== '').length;
  score -= Math.max(0, depth - 1) * 4;
  if (query !== '') score -= 5;

  return score;
}

/**
 * Rank same-site candidates. Ties break on the URL string, so the ordering is
 * total and reproducible across runs.
 */
export function rankLinks(
  links: readonly DiscoveredLink[],
  baseUrl: string,
): RankedLink[] {
  const seen = new Set<string>();
  const ranked: RankedLink[] = [];

  for (const link of links) {
    const normalized = normalizeUrl(link.url, baseUrl);
    if (normalized === null) continue;
    if (!isSameSite(normalized, baseUrl)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ranked.push({
      url: normalized,
      anchorText: link.anchorText.trim(),
      score: scoreLink(normalized, link.anchorText),
      sourceType: classifyLink(normalized, link.anchorText),
    });
  }

  return ranked.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}
