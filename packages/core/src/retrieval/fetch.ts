/**
 * Guarded fetcher (docs/SECURITY.md section 2).
 *
 * GET only. Redirects are followed manually so that every hop is re-validated
 * against the SSRF policy - letting the HTTP client follow them would hand an
 * attacker a redirect straight past the check. The body is streamed and
 * aborted at the size cap rather than buffered first.
 */
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { SsrfPolicy } from './ssrf.js';
import type { RetrievalStatus } from './types.js';

export const DEFAULT_USER_AGENT = 'ai-interview-prep-kit/0.1 (+research bot)';
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_CONTENT_TYPES: readonly string[] = [
  'text/html',
  'text/plain',
  'application/xhtml+xml',
];

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array> & {
    destroy?: (error?: Error) => void;
    /** undici exposes dump() to discard a body safely. */
    dump?: () => Promise<unknown>;
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
}

/**
 * Discard a response body we are not going to read.
 *
 * Calling destroy() on an undici BodyReadable emits an 'error' event; with no
 * listener attached that becomes an unhandled error and takes the process
 * down. Attach a listener first, and prefer undici's own dump().
 */
async function discardBody(body: HttpResponse['body']): Promise<void> {
  try {
    body.on?.('error', () => undefined);
    if (typeof body.dump === 'function') {
      await body.dump();
      return;
    }
    body.destroy?.();
  } catch {
    // Discarding a body must never be the reason a fetch fails.
  }
}

export interface HttpRequestOptions {
  method: 'GET';
  headers: Record<string, string>;
  signal?: AbortSignal;
  dispatcher?: Dispatcher;
  maxRedirections?: number;
}

/** Injectable so tests exercise every branch without a network. */
export type RequestImpl = (
  url: string,
  options: HttpRequestOptions,
) => Promise<HttpResponse>;

export interface FetcherOptions {
  policy: SsrfPolicy;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedContentTypes?: readonly string[];
  requestImpl?: RequestImpl;
  dispatcher?: Dispatcher;
  now?: () => Date;
}

export interface FetchOutcome {
  status: RetrievalStatus;
  httpStatus: number | null;
  requestedUrl: string;
  finalUrl: string;
  contentType: string | null;
  /** Populated only when status is success. */
  body: string;
  bytes: number;
  detail: string | null;
  redirects: string[];
  fetchedAt: string;
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (raw === undefined) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function classifyHttpStatus(status: number): RetrievalStatus | null {
  if (status >= 200 && status < 300) return null;
  if (status === 404) return 'not_found';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'network_error';
}

function contentTypeAllowed(
  contentType: string | null,
  allowed: readonly string[],
): boolean {
  if (contentType === null) return false;
  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return allowed.includes(essence);
}

export class Fetcher {
  readonly #policy: SsrfPolicy;
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #maxRedirects: number;
  readonly #allowedContentTypes: readonly string[];
  readonly #request: RequestImpl;
  readonly #dispatcher: Dispatcher | undefined;
  readonly #now: () => Date;

  constructor(options: FetcherOptions) {
    this.#policy = options.policy;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.#allowedContentTypes = options.allowedContentTypes ?? DEFAULT_CONTENT_TYPES;
    this.#request = options.requestImpl ?? ((url, opts) => undiciRequest(url, opts));
    // The default dispatcher carries the rebinding-safe connect hook.
    this.#dispatcher = options.dispatcher ?? options.policy.createDispatcher();
    this.#now = options.now ?? (() => new Date());
  }

  get userAgent(): string {
    return this.#userAgent;
  }

  async fetch(rawUrl: string): Promise<FetchOutcome> {
    const fetchedAt = this.#now().toISOString();
    const fail = (
      status: RetrievalStatus,
      finalUrl: string,
      detail: string | null,
      redirects: string[],
    ): FetchOutcome => ({
      status,
      httpStatus: null,
      requestedUrl: rawUrl,
      finalUrl,
      contentType: null,
      body: '',
      bytes: 0,
      detail,
      redirects,
      fetchedAt,
    });

    const redirects: string[] = [];
    const seen = new Set<string>();
    let currentUrl = rawUrl;

    for (let hop = 0; hop <= this.#maxRedirects; hop += 1) {
      // Every hop, not just the first. A redirect must not bypass the policy.
      const decision = await this.#policy.checkDestination(currentUrl);
      if (!decision.allowed) {
        return fail(
          'blocked',
          currentUrl,
          `${decision.reason}: ${decision.detail}`,
          redirects,
        );
      }
      const target = decision.url.toString();
      if (seen.has(target)) {
        return fail('redirect_error', target, 'redirect loop detected', redirects);
      }
      seen.add(target);

      let response: HttpResponse;
      const timeout = AbortSignal.timeout(this.#timeoutMs);
      try {
        response = await this.#request(target, {
          method: 'GET',
          headers: {
            'user-agent': this.#userAgent,
            accept: 'text/html,text/plain;q=0.9',
          },
          signal: timeout,
          ...(this.#dispatcher === undefined ? {} : { dispatcher: this.#dispatcher }),
          maxRedirections: 0,
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        const status: RetrievalStatus =
          timeout.aborted || name === 'TimeoutError' || name === 'AbortError'
            ? 'timeout'
            : 'network_error';
        return fail(
          status,
          target,
          error instanceof Error ? error.message : String(error),
          redirects,
        );
      }

      const location = headerValue(response.headers, 'location');
      if (response.statusCode >= 300 && response.statusCode < 400 && location !== null) {
        await discardBody(response.body);
        if (hop === this.#maxRedirects) {
          return fail(
            'redirect_error',
            target,
            `exceeded ${this.#maxRedirects} redirects`,
            redirects,
          );
        }
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          return fail(
            'redirect_error',
            target,
            `invalid redirect target ${location}`,
            redirects,
          );
        }
        redirects.push(next);
        currentUrl = next;
        continue;
      }

      const httpStatus = response.statusCode;
      const failure = classifyHttpStatus(httpStatus);
      if (failure !== null) {
        await discardBody(response.body);
        return { ...fail(failure, target, `HTTP ${httpStatus}`, redirects), httpStatus };
      }

      const contentType = headerValue(response.headers, 'content-type');
      if (!contentTypeAllowed(contentType, this.#allowedContentTypes)) {
        await discardBody(response.body);
        return {
          ...fail(
            'unsupported_content',
            target,
            `content-type ${contentType ?? 'absent'}`,
            redirects,
          ),
          httpStatus,
          contentType,
        };
      }

      const read = await this.#readCapped(response);
      if (read.tooLarge) {
        return {
          ...fail(
            'too_large',
            target,
            `body exceeded ${this.#maxBytes} bytes`,
            redirects,
          ),
          httpStatus,
          contentType,
          bytes: read.bytes,
        };
      }

      return {
        status: 'success',
        httpStatus,
        requestedUrl: rawUrl,
        finalUrl: target,
        contentType,
        body: read.text,
        bytes: read.bytes,
        detail: null,
        redirects,
        fetchedAt,
      };
    }

    return fail(
      'redirect_error',
      currentUrl,
      `exceeded ${this.#maxRedirects} redirects`,
      redirects,
    );
  }

  /** Stream and abort past the cap - never buffer an unbounded response. */
  async #readCapped(
    response: HttpResponse,
  ): Promise<{ text: string; bytes: number; tooLarge: boolean }> {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > this.#maxBytes) {
        await discardBody(response.body);
        return { text: '', bytes, tooLarge: true };
      }
      chunks.push(chunk);
    }
    return { text: Buffer.concat(chunks).toString('utf8'), bytes, tooLarge: false };
  }
}
