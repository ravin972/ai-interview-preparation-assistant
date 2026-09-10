/**
 * Gemini adapter - thin HTTP, no SDK (docs/DECISIONS.md D-003).
 *
 * Sends a prompt, returns raw text. No JSON parsing, no validation, no repair:
 * that is the router's job. `fetchImpl` is injectable so the request shape and
 * failure mapping can be tested without a network call or an API key.
 */
import {
  classifyHttpFailure,
  classifyThrownFailure,
  LlmPermanentError,
  LlmTransientError,
  type LlmAdapter,
  type LlmCompletionRequest,
} from './types.js';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_DEFAULT_TIMEOUT_MS = 30_000;

export interface GeminiAdapterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Read configuration from an environment map. The caller supplies the map -
 * core never reaches for process.env itself, which keeps it pure and testable.
 * Returns null when no key is configured, so the caller can fall back.
 */
export function geminiOptionsFromEnv(
  env: Record<string, string | undefined>,
): GeminiAdapterOptions | null {
  const apiKey = env['GEMINI_API_KEY'];
  if (apiKey === undefined || apiKey === '') return null;
  const options: GeminiAdapterOptions = { apiKey };
  const model = env['GEMINI_MODEL'];
  if (model !== undefined && model !== '') options.model = model;
  const timeout = Number(env['LLM_TIMEOUT_MS']);
  if (Number.isInteger(timeout) && timeout > 0) options.timeoutMs = timeout;
  return options;
}

interface GeminiPart {
  text?: string;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export function createGeminiAdapter(options: GeminiAdapterOptions): LlmAdapter {
  const model = options.model ?? GEMINI_DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'gemini',
    async complete(request: LlmCompletionRequest): Promise<string> {
      const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
      };
      if (request.jsonSchema !== undefined) {
        generationConfig['responseSchema'] = request.jsonSchema;
      }
      if (request.maxOutputTokens !== undefined) {
        generationConfig['maxOutputTokens'] = request.maxOutputTokens;
      }
      if (request.temperature !== undefined) {
        generationConfig['temperature'] = request.temperature;
      }

      const body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig,
      };

      const signals = [AbortSignal.timeout(timeoutMs)];
      if (request.signal !== undefined) signals.push(request.signal);

      let response: Response;
      try {
        response = await doFetch(
          `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              // Header rather than query string, so the key stays out of logs.
              'x-goog-api-key': options.apiKey,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.any(signals),
          },
        );
      } catch (error) {
        throw classifyThrownFailure('gemini', error, request.signal?.aborted === true);
      }

      if (!response.ok) {
        throw classifyHttpFailure('gemini', response.status, await safeText(response));
      }

      const data = (await response.json()) as GeminiResponse;
      const blockReason = data.promptFeedback?.blockReason;
      if (blockReason !== undefined) {
        throw new LlmPermanentError('gemini', `prompt blocked: ${blockReason}`);
      }

      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      if (text.trim() === '') {
        throw new LlmTransientError('gemini', 'server', 'response contained no text');
      }
      return text;
    },
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}
