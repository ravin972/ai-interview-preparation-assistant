import { describe, expect, it } from 'vitest';
import {
  GEMINI_DEFAULT_MODEL,
  createGeminiAdapter,
  geminiOptionsFromEnv,
} from '../src/llm/gemini.js';
import {
  GROQ_DEFAULT_MODEL,
  createGroqAdapter,
  groqOptionsFromEnv,
} from '../src/llm/groq.js';
import { LlmPermanentError, LlmTransientError } from '../src/llm/types.js';

interface Captured {
  url: string;
  init: RequestInit;
}

/** Records the request and replies with a canned response. No network. */
function stubFetch(response: Response | (() => never)): {
  captured: Captured[];
  fetchImpl: typeof fetch;
} {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    if (typeof response === 'function') response();
    return response;
  }) as unknown as typeof fetch;
  return { captured, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const geminiOk = (text: string) =>
  json({ candidates: [{ content: { parts: [{ text }] } }] });
const groqOk = (content: string) => json({ choices: [{ message: { content } }] });

const request = { system: 'be terse', user: 'extract requirements' };

describe('model configuration', () => {
  it('defaults to the approved model ids', () => {
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-2.5-flash');
    expect(GROQ_DEFAULT_MODEL).toBe('openai/gpt-oss-120b');
    // Guards against reintroducing the retired Groq model.
    expect(GROQ_DEFAULT_MODEL).not.toBe('llama-3.3-70b-versatile');
  });

  it('reads Gemini configuration from an environment map', () => {
    expect(geminiOptionsFromEnv({})).toBeNull();
    expect(geminiOptionsFromEnv({ GEMINI_API_KEY: '' })).toBeNull();
    expect(
      geminiOptionsFromEnv({
        GEMINI_API_KEY: 'k',
        GEMINI_MODEL: 'gemini-custom',
        LLM_TIMEOUT_MS: '9000',
      }),
    ).toEqual({ apiKey: 'k', model: 'gemini-custom', timeoutMs: 9000 });
  });

  it('reads Groq configuration from an environment map', () => {
    expect(groqOptionsFromEnv({})).toBeNull();
    expect(
      groqOptionsFromEnv({ GROQ_API_KEY: 'k', GROQ_MODEL: 'openai/gpt-oss-120b' }),
    ).toEqual({ apiKey: 'k', model: 'openai/gpt-oss-120b' });
  });

  it('ignores a non-numeric timeout rather than sending NaN', () => {
    expect(geminiOptionsFromEnv({ GEMINI_API_KEY: 'k', LLM_TIMEOUT_MS: 'soon' })).toEqual(
      {
        apiKey: 'k',
      },
    );
  });
});

describe('gemini adapter', () => {
  it('sends the documented request shape and returns raw text', async () => {
    const { captured, fetchImpl } = stubFetch(geminiOk('{"ok":true}'));
    const adapter = createGeminiAdapter({
      apiKey: 'secret',
      fetchImpl,
      baseUrl: 'https://x.test',
    });

    const text = await adapter.complete({ ...request, jsonSchema: { type: 'object' } });

    expect(text).toBe('{"ok":true}');
    const call = captured[0]!;
    expect(call.url).toBe(
      'https://x.test/v1beta/models/gemini-2.5-flash:generateContent',
    );
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('secret');
    // The key must not travel in the URL, where it would land in logs.
    expect(call.url).not.toContain('secret');

    const body = JSON.parse(String(call.init.body)) as Record<string, never>;
    expect(body).toMatchObject({
      systemInstruction: { parts: [{ text: 'be terse' }] },
      contents: [{ role: 'user', parts: [{ text: 'extract requirements' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'object' },
      },
    });
  });

  it('joins multi-part responses', async () => {
    const { fetchImpl } = stubFetch(
      json({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }),
    );
    const adapter = createGeminiAdapter({ apiKey: 'k', fetchImpl });
    expect(await adapter.complete(request)).toBe('{"a":1}');
  });

  it('uses a configured model', async () => {
    const { captured, fetchImpl } = stubFetch(geminiOk('{}'));
    const adapter = createGeminiAdapter({
      apiKey: 'k',
      model: 'gemini-custom',
      fetchImpl,
    });
    await adapter.complete(request);
    expect(captured[0]?.url).toContain('gemini-custom');
  });

  it.each([
    [429, 'rate_limit'],
    [408, 'timeout'],
    [500, 'server'],
    [503, 'server'],
  ])('maps HTTP %s to a transient %s failure', async (status, kind) => {
    const { fetchImpl } = stubFetch(json({ error: { message: 'nope' } }, status));
    const adapter = createGeminiAdapter({ apiKey: 'k', fetchImpl });

    await expect(adapter.complete(request)).rejects.toMatchObject({
      name: 'LlmTransientError',
      kind,
      status,
    });
  });

  it.each([400, 401, 403])('maps HTTP %s to a permanent failure', async (status) => {
    const { fetchImpl } = stubFetch(json({ error: { message: 'bad' } }, status));
    const adapter = createGeminiAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(LlmPermanentError);
  });

  it('treats a blocked prompt as permanent', async () => {
    const { fetchImpl } = stubFetch(json({ promptFeedback: { blockReason: 'SAFETY' } }));
    const adapter = createGeminiAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(LlmPermanentError);
  });

  it('treats an empty candidate as transient, so the fallback gets a turn', async () => {
    const { fetchImpl } = stubFetch(json({ candidates: [] }));
    const adapter = createGeminiAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('maps a thrown network failure to a transient error', async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const adapter = createGeminiAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.complete(request)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('groq adapter', () => {
  it('sends the OpenAI-compatible request shape and returns raw text', async () => {
    const { captured, fetchImpl } = stubFetch(groqOk('{"ok":true}'));
    const adapter = createGroqAdapter({
      apiKey: 'secret',
      fetchImpl,
      baseUrl: 'https://g.test',
    });

    const text = await adapter.complete({
      ...request,
      maxOutputTokens: 256,
      temperature: 0,
    });

    expect(text).toBe('{"ok":true}');
    const call = captured[0]!;
    expect(call.url).toBe('https://g.test/openai/v1/chat/completions');
    expect((call.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer secret',
    );

    const body = JSON.parse(String(call.init.body)) as Record<string, never>;
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'extract requirements' },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 256,
      temperature: 0,
    });
  });

  it.each([
    [429, 'rate_limit'],
    [500, 'server'],
  ])('maps HTTP %s to a transient %s failure', async (status, kind) => {
    const { fetchImpl } = stubFetch(json({ error: { message: 'nope' } }, status));
    const adapter = createGroqAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.complete(request)).rejects.toMatchObject({ kind, status });
  });

  it('treats empty content as transient', async () => {
    const { fetchImpl } = stubFetch(json({ choices: [{ message: { content: '' } }] }));
    const adapter = createGroqAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(LlmTransientError);
  });
});
