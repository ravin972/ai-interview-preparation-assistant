/**
 * JD normalisation (docs/PIPELINE.md section 4, step 1).
 *
 * Users paste job descriptions from anywhere: a careers page with markup, a
 * PDF with odd bullet glyphs, Windows line endings. Normalisation gives the
 * section detector and the evidence guards one predictable shape to work on.
 *
 * `originalChars` is measured on the untouched input and is the sole source of
 * `source.jd_chars`. Normalisation must never change the reported size of what
 * the user supplied.
 */

/** Processing cap. Beyond this the tail is dropped and `truncated` is set. */
export const JD_MAX_CHARS = 24_000;

/** Below this, a JD is thin and the kit stays thin. No top-up. */
export const THIN_JD_CHARS = 400;

const BULLET_GLYPHS = '•‣▪●·⁃∙–—*+';
const LEADING_BULLET = new RegExp(`^[ \t]*[${BULLET_GLYPHS}][ \t]+`);
const LEADING_DASH = /^[ \t]*-[ \t]+/;

const HTML_HINT = /<\s*(p|div|br|li|ul|ol|h[1-6]|span|html|body|table|section)\b/i;

const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '-',
  '&ndash;': '-',
  '&bull;': '-',
};

export interface NormalizedJd {
  /** Exactly what the caller supplied. */
  original: string;
  /** Length of the ORIGINAL text - the value that becomes source.jd_chars. */
  originalChars: number;
  /** Normalised, capped text used for extraction and evidence matching. */
  text: string;
  truncated: boolean;
  looksLikeHtml: boolean;
}

function decodeEntities(input: string): string {
  let out = input;
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(replacement);
  }
  return out;
}

function stripHtml(input: string): string {
  return decodeEntities(
    input
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

function normalizeLine(line: string): string {
  const bulleted = line.replace(LEADING_BULLET, '- ').replace(LEADING_DASH, '- ');
  return bulleted.replace(/[ \t]+/g, ' ').trimEnd();
}

export function normalizeJd(raw: string): NormalizedJd {
  const originalChars = raw.length;
  const unixEndings = raw.replace(/\r\n?/g, '\n');
  const looksLikeHtml = HTML_HINT.test(unixEndings);

  const stripped = looksLikeHtml ? stripHtml(unixEndings) : unixEndings;
  const lines = stripped.split('\n').map(normalizeLine);
  const collapsed = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const truncated = collapsed.length > JD_MAX_CHARS;
  let text = collapsed;
  if (truncated) {
    const cut = collapsed.slice(0, JD_MAX_CHARS);
    const lastBreak = cut.lastIndexOf(' ');
    text = (lastBreak > JD_MAX_CHARS * 0.9 ? cut.slice(0, lastBreak) : cut).trimEnd();
  }

  return { original: raw, originalChars, text, truncated, looksLikeHtml };
}

/**
 * Whitespace- and case-insensitive form used for evidence matching, so a model
 * that re-wraps a quote still counts as citing it.
 */
export function matchable(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isThinJd(normalized: NormalizedJd, requirementCount: number): boolean {
  return normalized.originalChars < THIN_JD_CHARS || requirementCount < 3;
}
