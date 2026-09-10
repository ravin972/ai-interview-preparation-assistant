/**
 * Structured generation router (docs/DECISIONS.md D-003).
 *
 * Owns everything the adapters deliberately do not: JSON extraction, schema
 * validation, exactly one repair attempt, bounded backoff and provider
 * failover. One place to reason about failure, one place to test it.
 *
 *   adapter attempt
 *     -> transient error? bounded backoff, move to the next provider
 *     -> parse JSON -> Zod validate
 *          valid   -> return
 *          invalid -> one repair attempt -> valid ? return : next provider
 *
 * Hard ceiling: adapters.length x MAX_ATTEMPTS_PER_ADAPTER completions.
 */
import type { ZodType } from 'zod';
import { extractJson } from './json.js';
import {
  LlmPermanentError,
  LlmStructuredError,
  LlmTransientError,
  type LlmAdapter,
  type LlmAttempt,
  type LlmCompletionRequest,
  type LlmProviderName,
} from './types.js';

/** One first attempt plus one repair. Never more. */
export const MAX_ATTEMPTS_PER_ADAPTER = 2;
export const DEFAULT_BACKOFF_MS: readonly number[] = [250, 1000];
const MAX_ECHOED_RESPONSE_CHARS = 1200;

export interface GenerateStructuredOptions<T> {
  /** Names the caller, e.g. "extract-requirements". Appears in errors. */
  task: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  /** Tried in order. The first is primary; the rest are fallbacks. */
  adapters: readonly LlmAdapter[];
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  backoffMs?: readonly number[];
  /** Injectable so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GenerateStructuredResult<T> {
  value: T;
  provider: LlmProviderName;
  /** True when the usable response came from the repair attempt. */
  repaired: boolean;
  attempts: readonly LlmAttempt[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function describeIssues(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
}

function buildRepairPrompt(user: string, reason: string, raw: string): string {
  return [
    user,
    '',
    '--- REPAIR REQUEST ---',
    'Your previous response could not be used.',
    `Reason: ${reason}`,
    'Your previous response was:',
    raw.slice(0, MAX_ECHOED_RESPONSE_CHARS),
    '',
    'Reply with ONLY the corrected JSON value. No prose, no commentary, no code fences.',
  ].join('\n');
}

export async function generateStructured<T>(
  options: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<T>> {
  const { task, system, user, schema, adapters } = options;
  const sleep = options.sleep ?? defaultSleep;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const attempts: LlmAttempt[] = [];

  for (const [adapterIndex, adapter] of adapters.entries()) {
    let repairPrompt: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ADAPTER; attempt += 1) {
      const isRepair = attempt > 1;
      if (isRepair && repairPrompt === null) break;

      const request: LlmCompletionRequest = {
        task,
        system,
        user: isRepair && repairPrompt !== null ? repairPrompt : user,
      };
      if (options.jsonSchema !== undefined) request.jsonSchema = options.jsonSchema;
      if (options.maxOutputTokens !== undefined) {
        request.maxOutputTokens = options.maxOutputTokens;
      }
      if (options.temperature !== undefined) request.temperature = options.temperature;
      if (options.signal !== undefined) request.signal = options.signal;

      let raw: string;
      try {
        raw = await adapter.complete(request);
      } catch (error) {
        if (error instanceof LlmTransientError) {
          attempts.push({
            provider: adapter.name,
            attempt,
            outcome: 'transient',
            reason: `${error.kind}: ${error.message}`,
          });
          let delay = backoffMs[Math.min(adapterIndex, backoffMs.length - 1)] ?? 0;
          if (error.kind === 'rate_limit') {
            const match = error.message.match(/try again in ([0-9]+(\.[0-9]+)?)s/i);
            if (match && match[1]) {
              const suggestedSec = parseFloat(match[1]);
              delay = Math.max(
                delay,
                Math.min(Math.ceil(suggestedSec * 1000) + 500, 10000),
              );
            } else {
              delay = Math.max(delay, 2000);
            }
          }
          if (delay > 0) await sleep(delay);
        } else if (error instanceof LlmPermanentError) {
          attempts.push({
            provider: adapter.name,
            attempt,
            outcome: 'permanent',
            reason: error.message,
          });
        } else {
          attempts.push({
            provider: adapter.name,
            attempt,
            outcome: 'permanent',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        break; // a throwing provider does not get a repair attempt
      }

      const extracted = extractJson(raw);
      if (!extracted.ok) {
        attempts.push({
          provider: adapter.name,
          attempt,
          outcome: 'unparseable',
          reason: extracted.reason,
        });
        if (isRepair) break;
        repairPrompt = buildRepairPrompt(user, extracted.reason, raw);
        continue;
      }

      const parsed = schema.safeParse(extracted.value);
      if (parsed.success) {
        attempts.push({
          provider: adapter.name,
          attempt,
          outcome: 'ok',
          reason: `parsed from ${extracted.source}`,
        });
        return {
          value: parsed.data,
          provider: adapter.name,
          repaired: isRepair,
          attempts,
        };
      }

      const reason = describeIssues(parsed.error);
      attempts.push({
        provider: adapter.name,
        attempt,
        outcome: 'schema-invalid',
        reason,
      });
      if (isRepair) break;
      repairPrompt = buildRepairPrompt(user, reason, raw);
    }
  }

  throw new LlmStructuredError(task, attempts);
}
