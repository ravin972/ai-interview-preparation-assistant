import { describe, expect, it } from 'vitest';
import {
  Fetcher,
  type FetcherOptions,
  type HttpRequestOptions,
  type HttpResponse,
} from '../src/retrieval/fetch.js';
import { SsrfPolicy } from '../src/retrieval/ssrf.js';

const policy = () => SsrfPolicy.strict({ resolve: async () => ['93.184.216.34'] });

interface Stub {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Emit this many 1 KiB chunks lazily, to test the size cap. */
  chunks?: number;
  throws?: Error;
}

function makeResponse(stub: Stub): HttpResponse {
  const chunkCount = stub.chunks ?? 0;
  async function* stream(): AsyncGenerator<Uint8Array> {
    if (chunkCount > 0) {
      // Emitted lazily, so an aborted read genuinely stops producing data.
      for (let i = 0; i < chunkCount; i += 1) yield new Uint8Array(1024);
      return;
    }
    yield new TextEncoder().encode(stub.body ?? '');
  }
  return {
    statusCode: stub.status ?? 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...stub.headers },
    body: stream(),
  };
}

/** Serve a scripted sequence of responses, recording every request. */
function stubRequests(script: Stub[]) {
  const calls: { url: string; options: HttpRequestOptions }[] = [];
  let index = 0;
  const requestImpl = async (url: string, options: HttpRequestOptions) => {
    calls.push({ url, options });
    const stub = script[Math.min(index, script.length - 1)] ?? {};
    index += 1;
    if (stub.throws !== undefined) throw stub.throws;
    return makeResponse(stub);
  };
  return { calls, requestImpl };
}

const fetcherFor = (script: Stub[], overrides: Partial<FetcherOptions> = {}) => {
  const { calls, requestImpl } = stubRequests(script);
  return { calls, fetcher: new Fetcher({ policy: policy(), requestImpl, ...overrides }) };
};

describe('fetcher - successful retrieval', () => {
  it('returns body, status, content type and final URL', async () => {
    const { fetcher } = fetcherFor([{ body: '<html><body>hi</body></html>' }]);
    const outcome = await fetcher.fetch('https://example.com/about');

    expect(outcome.status).toBe('success');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body).toContain('hi');
    expect(outcome.contentType).toContain('text/html');
    expect(outcome.finalUrl).toBe('https://example.com/about');
    expect(outcome.bytes).toBeGreaterThan(0);
    expect(outcome.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('issues a GET with an identifying User-Agent and no client redirects', async () => {
    const { calls, fetcher } = fetcherFor([{ body: 'ok' }]);
    await fetcher.fetch('https://example.com/');

    expect(calls[0]?.options.method).toBe('GET');
    expect(calls[0]?.options.headers['user-agent']).toContain('ai-interview-prep-kit');
    expect(calls[0]?.options.maxRedirections).toBe(0);
  });

  it('accepts text/plain and xhtml', async () => {
    for (const type of ['text/plain', 'application/xhtml+xml']) {
      const { fetcher } = fetcherFor([{ body: 'x', headers: { 'content-type': type } }]);
      expect((await fetcher.fetch('https://example.com/')).status).toBe('success');
    }
  });
});

describe('fetcher - HTTP failures', () => {
  it.each([
    [404, 'not_found'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],
  ])('maps HTTP %s to %s', async (status, expected) => {
    const { fetcher } = fetcherFor([{ status }]);
    const outcome = await fetcher.fetch('https://example.com/');
    expect(outcome.status).toBe(expected);
    expect(outcome.httpStatus).toBe(status);
    expect(outcome.body).toBe('');
  });

  it('reports a timeout distinctly from a network error', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'TimeoutError';
    const { fetcher } = fetcherFor([{ throws: timeoutError }]);
    expect((await fetcher.fetch('https://example.com/')).status).toBe('timeout');

    const { fetcher: broken } = fetcherFor([{ throws: new TypeError('ECONNREFUSED') }]);
    expect((await broken.fetch('https://example.com/')).status).toBe('network_error');
  });
});

describe('fetcher - content guards', () => {
  it.each(['application/pdf', 'image/png', 'application/octet-stream'])(
    'rejects content-type %s',
    async (type) => {
      const { fetcher } = fetcherFor([{ headers: { 'content-type': type }, body: 'x' }]);
      const outcome = await fetcher.fetch('https://example.com/file');
      expect(outcome.status).toBe('unsupported_content');
      expect(outcome.detail).toContain(type);
    },
  );

  it('rejects a response with no content-type at all', async () => {
    const { fetcher } = fetcherFor([{ headers: { 'content-type': '' }, body: 'x' }]);
    expect((await fetcher.fetch('https://example.com/')).status).toBe(
      'unsupported_content',
    );
  });

  it('aborts an oversized body instead of buffering it', async () => {
    const { fetcher } = fetcherFor([{ chunks: 100 }], { maxBytes: 10 * 1024 });
    const outcome = await fetcher.fetch('https://example.com/huge');

    expect(outcome.status).toBe('too_large');
    expect(outcome.body).toBe('');
    // Stopped early: it never read all 100 KiB.
    expect(outcome.bytes).toBeLessThan(100 * 1024);
  });

  it('accepts a body that sits just under the cap', async () => {
    const { fetcher } = fetcherFor([{ chunks: 9 }], { maxBytes: 10 * 1024 });
    expect((await fetcher.fetch('https://example.com/')).status).toBe('success');
  });
});

describe('fetcher - redirects', () => {
  const redirect = (location: string, status = 302): Stub => ({
    status,
    headers: { location, 'content-type': 'text/html' },
  });

  it('follows a redirect and reports the final URL', async () => {
    const { calls, fetcher } = fetcherFor([
      redirect('https://example.com/final'),
      { body: 'arrived' },
    ]);
    const outcome = await fetcher.fetch('https://example.com/start');

    expect(outcome.status).toBe('success');
    expect(outcome.body).toContain('arrived');
    expect(outcome.finalUrl).toBe('https://example.com/final');
    expect(outcome.redirects).toEqual(['https://example.com/final']);
    expect(calls).toHaveLength(2);
  });

  it('resolves a relative Location against the current URL', async () => {
    const { calls, fetcher } = fetcherFor([redirect('/careers/'), { body: 'jobs' }]);
    await fetcher.fetch('https://example.com/about/index.html');
    expect(calls[1]?.url).toBe('https://example.com/careers/');
  });

  it.each([301, 302, 303, 307, 308])('follows a %s redirect', async (status) => {
    const { fetcher } = fetcherFor([
      redirect('https://example.com/final', status),
      { body: 'ok' },
    ]);
    expect((await fetcher.fetch('https://example.com/')).status).toBe('success');
  });

  it('detects a redirect loop rather than spinning', async () => {
    const { fetcher } = fetcherFor([
      redirect('https://example.com/b'),
      redirect('https://example.com/a'),
      redirect('https://example.com/b'),
    ]);
    const outcome = await fetcher.fetch('https://example.com/a');

    expect(outcome.status).toBe('redirect_error');
    expect(outcome.detail).toContain('loop');
  });

  it('stops after the third redirect', async () => {
    const { calls, fetcher } = fetcherFor([
      redirect('https://example.com/1'),
      redirect('https://example.com/2'),
      redirect('https://example.com/3'),
      redirect('https://example.com/4'),
      { body: 'never reached' },
    ]);
    const outcome = await fetcher.fetch('https://example.com/0');

    expect(outcome.status).toBe('redirect_error');
    expect(outcome.detail).toContain('3 redirects');
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it('re-validates every hop, so a redirect cannot reach a private address', async () => {
    const { calls, fetcher } = fetcherFor([
      redirect('http://169.254.169.254/latest/meta-data/'),
      { body: 'SHOULD NEVER BE FETCHED' },
    ]);
    const outcome = await fetcher.fetch('https://example.com/start');

    expect(outcome.status).toBe('blocked');
    expect(outcome.detail).toContain('blocked_address');
    // The second request was never issued.
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['loopback', 'http://127.0.0.1/'],
    ['private', 'http://192.168.1.1/'],
    ['file protocol', 'file:///etc/passwd'],
  ])('blocks a redirect to %s', async (_label, location) => {
    const { fetcher } = fetcherFor([redirect(location), { body: 'nope' }]);
    expect((await fetcher.fetch('https://example.com/')).status).toBe('blocked');
  });

  it('reports an unparseable Location instead of crashing', async () => {
    const { fetcher } = fetcherFor([redirect('http://[bad')]);
    const outcome = await fetcher.fetch('https://example.com/');
    expect(outcome.status).toBe('redirect_error');
  });
});

describe('fetcher - policy enforcement on the first hop', () => {
  it.each([
    ['a blocked host', 'http://127.0.0.1/'],
    ['credentials', 'http://user:pass@example.com/'],
    ['a non-http protocol', 'file:///etc/passwd'],
  ])('refuses to issue a request for %s', async (_label, url) => {
    const { calls, fetcher } = fetcherFor([{ body: 'unreachable' }]);
    const outcome = await fetcher.fetch(url);

    expect(outcome.status).toBe('blocked');
    expect(calls).toHaveLength(0);
  });
});
