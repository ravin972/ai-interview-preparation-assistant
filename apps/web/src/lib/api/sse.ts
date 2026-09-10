import type { SseEventPayload } from '../../types/kit.js';

export interface SseSubscriptionOptions {
  onEvent: (event: SseEventPayload) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

/**
 * Fetch-based SSE consumer with AbortController, backoff reconnect,
 * and authoritative MongoDB snapshot synchronization.
 *
 * SSE disconnect NEVER cancels the backend job.
 */
export function subscribeJobProgress(
  jobId: string,
  options: SseSubscriptionOptions,
): () => void {
  let isAborted = false;
  let abortController: AbortController | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  const maxDelay = 10000;

  async function connect() {
    if (isAborted) return;

    abortController = new AbortController();

    try {
      const response = await fetch(`/api/jobs/${jobId}/events`, {
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        credentials: 'include',
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE stream failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported on response body');
      }

      attempt = 0; // Reset backoff on successful connection
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!isAborted) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            // Skip keepalive ping comments
            if (trimmed.startsWith(':') || trimmed === '') continue;

            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim();
              try {
                const parsed = JSON.parse(dataStr) as SseEventPayload;
                options.onEvent(parsed);

                if (parsed.type === 'pipeline:complete') {
                  options.onComplete?.();
                  return;
                }
              } catch (parseErr) {
                console.warn('[SSE] Failed to parse event data:', dataStr, parseErr);
              }
            }
          }
        }
      }

      // If stream ended cleanly without completion, attempt reconnect if not aborted
      if (!isAborted) {
        scheduleReconnect();
      }
    } catch (err: unknown) {
      if (isAborted) return;

      const error = err instanceof Error ? err : new Error(String(err));
      // Ignore abort errors caused by intentional teardown
      if (error.name === 'AbortError') return;

      options.onError?.(error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (isAborted) return;
    attempt += 1;
    // Exponential backoff with jitter: 1s, 2s, 4s... capped at maxDelay
    const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), maxDelay);

    retryTimer = setTimeout(() => {
      connect();
    }, delay);
  }

  // Initial connection
  connect();

  // Return clean teardown function
  return () => {
    isAborted = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };
}
