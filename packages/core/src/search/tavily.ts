/**
 * Tavily search provider (docs/PIPELINE.md Stage 9, docs/DECISIONS.md D-017).
 *
 * Implements public web search via Tavily's HTTP search API directly without
 * an external SDK dependency. Accepts injectable fetchImpl for deterministic offline testing.
 */
import type { SearchProvider, SearchQuery, SearchSnippet } from './types.js';
import { NoopSearchProvider } from './types.js';
import { sanitizeResearchText } from '../retrieval/sanitize.js';

export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com';
export const TAVILY_DEFAULT_TIMEOUT_MS = 5000;
export const TAVILY_DEFAULT_MAX_RESULTS = 5;
export const TAVILY_MAX_SNIPPET_CHARS = 1000;

export interface TavilySearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxResults?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Read Tavily configuration from an environment map. Core never touches process.env directly.
 */
export function tavilyOptionsFromEnv(
  env: Record<string, string | undefined>,
): TavilySearchProviderOptions | null {
  const apiKey = env['TAVILY_API_KEY'];
  if (apiKey === undefined || apiKey.trim() === '') return null;
  const options: TavilySearchProviderOptions = { apiKey: apiKey.trim() };
  const baseUrl = env['TAVILY_BASE_URL'];
  if (baseUrl !== undefined && baseUrl.trim() !== '') options.baseUrl = baseUrl.trim();
  const timeout = Number(env['TAVILY_TIMEOUT_MS']);
  if (Number.isInteger(timeout) && timeout > 0) options.timeoutMs = timeout;
  const maxResults = Number(env['TAVILY_MAX_RESULTS']);
  if (Number.isInteger(maxResults) && maxResults > 0)
    options.maxResults = Math.min(maxResults, 5);
  return options;
}

/**
 * Provider factory:
 * - evaluator/mock mode -> NoopSearchProvider
 * - missing TAVILY_API_KEY -> NoopSearchProvider
 * - TAVILY_API_KEY present -> TavilySearchProvider
 */
export function createSearchProvider(
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): SearchProvider {
  if (env['LLM_PROVIDER'] === 'mock') {
    return new NoopSearchProvider();
  }
  const opts = tavilyOptionsFromEnv(env);
  if (!opts) {
    return new NoopSearchProvider();
  }
  return new TavilySearchProvider({
    ...opts,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

function sanitizeQueryText(raw: string, maxChars: number): string {
  if (!raw) return '';
  const strippedHtml = raw.replace(/<[^>]*>/g, ' ');
  const strippedControls = strippedHtml.replace(/[\x00-\x1F\x7F]/g, ' ');
  return strippedControls.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function sanitizeSnippetText(raw: string, maxChars: number): string {
  if (!raw) return '';
  // Strip HTML tags
  const strippedHtml = raw.replace(/<[^>]*>/g, ' ');
  // Neutralize prompt-injection patterns and strip control characters
  const { text: sanitized } = sanitizeResearchText(strippedHtml);
  // Collapse whitespace
  const collapsed = sanitized.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, maxChars);
}

function isValidHttpUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResults: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TavilySearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? TAVILY_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? TAVILY_DEFAULT_TIMEOUT_MS;
    this.maxResults = Math.min(
      Math.max(options.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS, 1),
      5,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(
    query: SearchQuery,
    signal?: AbortSignal,
  ): Promise<SearchSnippet[] | null> {
    const cleanCompany = sanitizeQueryText(query.company, 100);
    const cleanRole = sanitizeQueryText(query.role, 100);
    const queryParts = [
      cleanCompany,
      cleanRole,
      'interview questions experience discussion',
    ].filter(Boolean);

    if (queryParts.length === 0) {
      return null;
    }

    const searchQuery = queryParts.join(' ').slice(0, 300);

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    if (this.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error(`Tavily search timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    }

    const onExternalAbort = () => {
      controller.abort(signal?.reason || new Error('Aborted by caller'));
    };

    if (signal) {
      if (signal.aborted) {
        if (timeoutId) clearTimeout(timeoutId);
        return null;
      }
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: searchQuery,
          search_depth: 'basic',
          include_answer: false,
          max_results: this.maxResults,
          topic: 'general',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Non-2xx status (401, 403, 429, 500, etc.) degrades gracefully to null
        return null;
      }

      const data = (await res.json()) as { results?: unknown };
      if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
        return null;
      }

      const snippets: SearchSnippet[] = [];

      for (const item of data.results) {
        if (!item || typeof item !== 'object') continue;

        const record = item as Record<string, unknown>;
        const rawUrl = typeof record.url === 'string' ? record.url.trim() : '';

        if (!isValidHttpUrl(rawUrl)) {
          // Disallow javascript:, file:, data:, or invalid protocols
          continue;
        }

        // Validate score if present: reject if malformed non-number
        if (record.score !== undefined && typeof record.score !== 'number') {
          continue;
        }

        const rawTitle = typeof record.title === 'string' ? record.title : '';
        const rawContent =
          typeof record.content === 'string'
            ? record.content
            : typeof record.snippet === 'string'
              ? record.snippet
              : '';

        const title = sanitizeSnippetText(rawTitle, 200);
        const snippet = sanitizeSnippetText(rawContent, TAVILY_MAX_SNIPPET_CHARS);

        if (!title && !snippet) {
          continue;
        }

        snippets.push({
          title: title || rawUrl,
          url: rawUrl,
          snippet,
        });

        if (snippets.length >= this.maxResults) {
          break;
        }
      }

      return snippets.length > 0 ? snippets : null;
    } catch {
      // Bounded degradation: timeouts, network aborts, JSON errors return null
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
