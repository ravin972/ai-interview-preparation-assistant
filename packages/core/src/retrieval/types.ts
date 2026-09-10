/**
 * Research result model.
 *
 * Every fetch produces one of these, successful or not. Nothing is discarded
 * because a sibling page failed: a page that could not be retrieved is
 * recorded with an explicit retrievalStatus so the pipeline can report an
 * honest gap instead of a silent absence (docs/PIPELINE.md section 8).
 */

export type RetrievalStatus =
  | 'success'
  | 'blocked'
  | 'robots_disallowed'
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'unsupported_content'
  | 'too_large'
  | 'redirect_error'
  | 'network_error';

/** What a page appears to be, decided by deterministic ranking - never by a model. */
export type SourceType =
  'homepage' | 'about' | 'careers' | 'interview' | 'engineering' | 'culture' | 'other';

export interface InjectionFlag {
  pattern: string;
  excerpt: string;
}

export interface PageResult {
  /** The URL we asked for. */
  url: string;
  /** Where we ended up after redirects. Equal to url when there were none. */
  finalUrl: string;
  title: string;
  status: number | null;
  contentType: string | null;
  fetchedAt: string;
  /** Sanitized, extracted, budget-capped visible text. Empty unless success. */
  text: string;
  sourceType: SourceType;
  retrievalStatus: RetrievalStatus;
  detail: string | null;
  bytes: number;
  injectionFlags: InjectionFlag[];
}

export const RETRIEVAL_OK: RetrievalStatus = 'success';

export function isUsable(page: PageResult): boolean {
  return page.retrievalStatus === 'success' && page.text.trim() !== '';
}

/** Named, machine-readable research gaps. Recorded, never invented around. */
export type ResearchGap =
  | 'invalid_url'
  | 'homepage_unreachable'
  | 'no_about_page'
  | 'no_hiring_page'
  | 'no_public_discussion'
  | 'robots_unavailable'
  | 'budget_exhausted';

export interface ResearchResult {
  /** The company URL as supplied. */
  requestedUrl: string;
  /** Homepage result, always present - carrying the reason when it failed. */
  homepage: PageResult | null;
  /** Every additional page attempted, in fetch order. */
  pages: PageResult[];
  /** URLs the fetcher actually retrieved successfully - the provenance record. */
  pagesUsed: string[];
  gaps: ResearchGap[];
  robotsBlocked: string[];
  injectionFlags: { url: string; pattern: string }[];
  budgetExhausted: boolean;
  startedAt: string;
  finishedAt: string;
}

export function usablePages(result: ResearchResult): PageResult[] {
  const all =
    result.homepage === null ? result.pages : [result.homepage, ...result.pages];
  return all.filter(isUsable);
}

export function findPageByType(
  result: ResearchResult,
  sourceType: SourceType,
): PageResult | null {
  return usablePages(result).find((page) => page.sourceType === sourceType) ?? null;
}
