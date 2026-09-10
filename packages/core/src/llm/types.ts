/**
 * The LLM abstraction, deliberately small (docs/DECISIONS.md D-003).
 *
 * An adapter does exactly one thing: send a prompt and return the model's raw
 * text. It performs no JSON parsing, no schema validation, no repair and no
 * business logic - all of that belongs to the router, so there is one place to
 * reason about failure rather than one per provider.
 */

export type LlmProviderName = 'gemini' | 'groq' | 'mock';

export interface LlmCompletionRequest {
  task?: string;
  system: string;
  user: string;
  /**
   * Provider-native output constraint, when the provider supports one. Purely
   * an optimisation: the router validates every response regardless.
   */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmAdapter {
  readonly name: LlmProviderName;
  /** Returns the model's raw text. Throws LlmTransientError or LlmPermanentError. */
  complete(request: LlmCompletionRequest): Promise<string>;
}

export type LlmTransientKind = 'rate_limit' | 'server' | 'timeout' | 'network';

/** Worth retrying, and worth failing over to another provider. */
export class LlmTransientError extends Error {
  readonly provider: LlmProviderName;
  readonly kind: LlmTransientKind;
  readonly status: number | undefined;

  constructor(
    provider: LlmProviderName,
    kind: LlmTransientKind,
    message: string,
    status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'LlmTransientError';
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

/** Not worth retrying on this provider: bad key, bad request, quota exhausted. */
export class LlmPermanentError extends Error {
  readonly provider: LlmProviderName;
  readonly status: number | undefined;

  constructor(provider: LlmProviderName, message: string, status?: number) {
    super(`${provider}: ${message}`);
    this.name = 'LlmPermanentError';
    this.provider = provider;
    this.status = status;
  }
}

export type LlmAttemptOutcome =
  'ok' | 'transient' | 'permanent' | 'unparseable' | 'schema-invalid';

export interface LlmAttempt {
  provider: LlmProviderName;
  /** 1 = first try, 2 = the single repair attempt. */
  attempt: number;
  outcome: LlmAttemptOutcome;
  reason: string;
}

/** Raised when every provider and every attempt has been exhausted. */
export class LlmStructuredError extends Error {
  readonly task: string;
  readonly provider: LlmProviderName | undefined;
  readonly reason: string;
  readonly attempts: readonly LlmAttempt[];
  readonly providersTried: readonly LlmProviderName[];

  constructor(task: string, attempts: readonly LlmAttempt[]) {
    const last = attempts.at(-1);
    const reason =
      last === undefined
        ? 'no adapters were supplied'
        : `${last.outcome}: ${last.reason}`;
    const providersTried = [...new Set(attempts.map((a) => a.provider))];
    super(
      `Structured generation failed for task "${task}" after ${attempts.length} attempt(s) across [${providersTried.join(', ') || 'none'}] - ${reason}`,
    );
    this.name = 'LlmStructuredError';
    this.task = task;
    this.provider = last?.provider;
    this.reason = reason;
    this.attempts = attempts;
    this.providersTried = providersTried;
  }
}

/**
 * Shared HTTP failure classification, so both adapters agree on what is worth
 * failing over and what is not. Lives here rather than in a seventh module
 * because it is purely about which error type to raise.
 *
 * 429 and 5xx are transient (retry elsewhere); 408 is a server-side timeout;
 * everything else in 4xx is a caller problem that another provider will not fix.
 */
export function classifyHttpFailure(
  provider: LlmProviderName,
  status: number,
  detail: string,
): LlmTransientError | LlmPermanentError {
  if (status === 429) {
    return new LlmTransientError(
      provider,
      'rate_limit',
      `rate limited: ${detail}`,
      status,
    );
  }
  if (status === 408) {
    return new LlmTransientError(
      provider,
      'timeout',
      `upstream timeout: ${detail}`,
      status,
    );
  }
  if (status >= 500) {
    return new LlmTransientError(provider, 'server', `server error: ${detail}`, status);
  }
  return new LlmPermanentError(
    provider,
    `request rejected (${status}): ${detail}`,
    status,
  );
}

/** Map a thrown fetch/abort failure onto our transient taxonomy. */
export function classifyThrownFailure(
  provider: LlmProviderName,
  error: unknown,
  callerAborted: boolean,
): LlmTransientError {
  if (callerAborted) {
    return new LlmTransientError(provider, 'timeout', 'aborted by caller');
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new LlmTransientError(provider, 'timeout', 'request timed out');
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmTransientError(provider, 'network', message);
}
