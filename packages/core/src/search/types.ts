/**
 * Search provider abstraction (docs/PIPELINE.md Stage 9, docs/DECISIONS.md D-017).
 *
 * For this assessment: no SERP scraping, no search-engine HTML scraping.
 * A real provider would query an API (such as Tavily). When unconfigured or
 * absent, it returns null and the pipeline records an honest `no_public_discussion` gap.
 */

export interface SearchSnippet {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchQuery {
  company: string;
  role: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: SearchQuery, signal?: AbortSignal): Promise<SearchSnippet[] | null>;
}

export class NoopSearchProvider implements SearchProvider {
  readonly name = 'noop';
  async search(): Promise<SearchSnippet[] | null> {
    return null;
  }
}
