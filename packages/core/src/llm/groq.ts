/**
 * Groq adapter - thin HTTP against the OpenAI-compatible endpoint, no SDK.
 *
 * Fallback provider. Its structured-output guarantees are weaker than
 * Gemini's, which is exactly why parsing, validation and repair live in the
 * router rather than here.
 */
import {
  classifyHttpFailure,
  classifyThrownFailure,
  LlmTransientError,
  type LlmAdapter,
  type LlmCompletionRequest,
} from './types.js';

/** Verified against console.groq.com/docs/models on 2026-09-10. */
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com';
export const GROQ_DEFAULT_TIMEOUT_MS = 30_000;

export interface GroqAdapterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function groqOptionsFromEnv(
  env: Record<string, string | undefined>,
): GroqAdapterOptions | null {
  const apiKey = env['GROQ_API_KEY'];
  if (apiKey === undefined || apiKey === '') return null;
  const options: GroqAdapterOptions = { apiKey };
  const model = env['GROQ_MODEL'];
  if (model !== undefined && model !== '') options.model = model;
  const timeout = Number(env['LLM_TIMEOUT_MS']);
  if (Number.isInteger(timeout) && timeout > 0) options.timeoutMs = timeout;
  return options;
}

interface GroqResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
}

export function createGroqAdapter(options: GroqAdapterOptions): LlmAdapter {
  const model = options.model ?? GROQ_DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? GROQ_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? GROQ_DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: 'groq',
    async complete(request: LlmCompletionRequest): Promise<string> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        // Asks for JSON. The router still validates - this only reduces noise.
        response_format: { type: 'json_object' },
      };
      if (request.maxOutputTokens !== undefined) {
        body['max_completion_tokens'] = request.maxOutputTokens;
      }
      if (request.temperature !== undefined) body['temperature'] = request.temperature;

      const signals = [AbortSignal.timeout(timeoutMs)];
      if (request.signal !== undefined) signals.push(request.signal);

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/openai/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });
      } catch (error) {
        throw classifyThrownFailure('groq', error, request.signal?.aborted === true);
      }

      if (!response.ok) {
        throw classifyHttpFailure('groq', response.status, await safeText(response));
      }

      const data = (await response.json()) as GroqResponse;
      const text = data.choices?.[0]?.message?.content ?? '';
      if (text.trim() === '') {
        throw new LlmTransientError('groq', 'server', 'response contained no content');
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
