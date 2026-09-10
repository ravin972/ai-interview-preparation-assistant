import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  JD_MAX_CHARS,
  THIN_JD_CHARS,
  isThinJd,
  matchable,
  normalizeJd,
} from '../src/extract/normalize.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJd = (name: string) =>
  fs.readFileSync(path.join(REPO, 'fixtures', 'jds', `${name}.txt`), 'utf8');

describe('normalizeJd - original input is never lost', () => {
  it('reports the ORIGINAL character count, not the normalised one', () => {
    const html = '<p>We need   <b>React</b> experience.</p>';
    const result = normalizeJd(html);

    expect(result.originalChars).toBe(html.length);
    expect(result.original).toBe(html);
    // Normalisation shortened the text; jd_chars must still describe the input.
    expect(result.text.length).toBeLessThan(result.originalChars);
  });

  it('preserves the original verbatim even when truncating', () => {
    const long = `${'word '.repeat(JD_MAX_CHARS)}end`;
    const result = normalizeJd(long);

    expect(result.original).toBe(long);
    expect(result.originalChars).toBe(long.length);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(JD_MAX_CHARS);
  });

  it('does not flag short input as truncated', () => {
    expect(normalizeJd('Short JD').truncated).toBe(false);
  });
});

describe('normalizeJd - line endings and whitespace', () => {
  it.each([
    ['CRLF', 'a\r\nb'],
    ['CR', 'a\rb'],
    ['LF', 'a\nb'],
  ])('normalises %s line endings', (_label, input) => {
    expect(normalizeJd(input).text).toBe('a\nb');
  });

  it('collapses runs of spaces and tabs', () => {
    expect(normalizeJd('React    and\t\tTypeScript').text).toBe('React and TypeScript');
  });

  it('trims trailing whitespace per line', () => {
    expect(normalizeJd('one   \ntwo   ').text).toBe('one\ntwo');
  });

  it('collapses three or more blank lines into a paragraph break', () => {
    expect(normalizeJd('a\n\n\n\n\nb').text).toBe('a\n\nb');
  });
});

describe('normalizeJd - bullets', () => {
  it.each([
    ['bullet', '• React'],
    ['triangular bullet', '‣ React'],
    ['black square', '▪ React'],
    ['middle dot', '· React'],
    ['en dash', '– React'],
    ['em dash', '— React'],
    ['asterisk', '* React'],
    ['plus', '+ React'],
    ['hyphen', '-   React'],
  ])('normalises a %s bullet to "- "', (_label, line) => {
    expect(normalizeJd(line).text).toBe('- React');
  });

  it('leaves a hyphen inside a sentence alone', () => {
    expect(normalizeJd('Full-stack engineer').text).toBe('Full-stack engineer');
  });
});

describe('normalizeJd - pasted HTML', () => {
  const html = [
    '<div><h2>Requirements</h2>',
    '<ul><li>5+ years with React</li><li>Strong TypeScript</li></ul>',
    '<p>Nice&nbsp;to have: WebGL &amp; canvas</p>',
    '<script>alert("x")</script><style>.a{color:red}</style>',
    '<!-- internal note -->',
    '</div>',
  ].join('\n');

  it('detects HTML and strips tags', () => {
    const result = normalizeJd(html);
    expect(result.looksLikeHtml).toBe(true);
    expect(result.text).not.toContain('<');
    expect(result.text).toContain('Requirements');
  });

  it('turns list items into bullets', () => {
    expect(normalizeJd(html).text).toContain('- 5+ years with React');
  });

  it('removes script, style and comment content entirely', () => {
    const text = normalizeJd(html).text;
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('internal note');
  });

  it('decodes the common entities', () => {
    const text = normalizeJd(html).text;
    expect(text).toContain('Nice to have: WebGL & canvas');
  });

  it('leaves plain text untouched by the HTML path', () => {
    const plain = readJd('rich');
    const result = normalizeJd(plain);
    expect(result.looksLikeHtml).toBe(false);
    expect(result.text).toContain('Senior Frontend Engineer');
  });
});

describe('matchable', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(matchable('  React   AND\nTypeScript ')).toBe('react and typescript');
  });
});

describe('isThinJd', () => {
  it('treats a short job description as thin regardless of yield', () => {
    expect(isThinJd(normalizeJd(readJd('thin')), 10)).toBe(true);
  });

  it('treats a long job description with too few requirements as thin', () => {
    expect(isThinJd(normalizeJd(readJd('rich')), 2)).toBe(true);
  });

  it('treats a long job description with a real yield as not thin', () => {
    expect(isThinJd(normalizeJd(readJd('rich')), 8)).toBe(false);
  });

  it('uses the documented threshold', () => {
    expect(normalizeJd(readJd('thin')).originalChars).toBeLessThan(THIN_JD_CHARS);
    expect(normalizeJd(readJd('rich')).originalChars).toBeGreaterThan(THIN_JD_CHARS);
  });
});

describe('normalizeJd - determinism', () => {
  it('produces identical output for identical input', () => {
    const jd = readJd('boilerplate-heavy');
    expect(normalizeJd(jd)).toEqual(normalizeJd(jd));
  });
});
