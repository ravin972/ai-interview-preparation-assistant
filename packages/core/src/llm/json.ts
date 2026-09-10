/**
 * Tolerant JSON extraction.
 *
 * Models wrap JSON in code fences, prefix it with "Here is the JSON:", or
 * append a closing remark. None of that is a failure worth burning a repair
 * attempt on, so the router recovers the payload first and only calls it
 * unparseable when no balanced JSON value can be found at all.
 */

export type JsonExtraction =
  | { ok: true; value: unknown; source: 'direct' | 'fenced' | 'embedded' }
  | { ok: false; reason: string };

const FENCE_PATTERN = /```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```/g;

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Scan for the first balanced { } or [ ] run, respecting string literals and
 * escapes so a brace inside a quoted value cannot end the scan early.
 */
function findBalanced(text: string): string | null {
  const start = (() => {
    const brace = text.indexOf('{');
    const bracket = text.indexOf('[');
    if (brace === -1) return bracket;
    if (bracket === -1) return brace;
    return Math.min(brace, bracket);
  })();
  if (start === -1) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJson(raw: string): JsonExtraction {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'model returned an empty response' };

  const direct = tryParse(trimmed);
  if (direct.ok) return { ok: true, value: direct.value, source: 'direct' };

  // Fenced blocks, in order, so ```json wins over a later stray fence.
  for (const match of trimmed.matchAll(FENCE_PATTERN)) {
    const body = match[1];
    if (body === undefined) continue;
    const parsed = tryParse(body.trim());
    if (parsed.ok) return { ok: true, value: parsed.value, source: 'fenced' };
  }

  // Prose around a JSON value.
  const balanced = findBalanced(trimmed);
  if (balanced !== null) {
    const parsed = tryParse(balanced);
    if (parsed.ok) return { ok: true, value: parsed.value, source: 'embedded' };
  }

  return {
    ok: false,
    reason: 'response contained no parseable JSON value',
  };
}
