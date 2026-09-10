import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_PAGE_TEXT_CHARS, extractPage } from '../src/retrieval/extractText.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = (rel: string) =>
  fs.readFileSync(path.join(REPO, 'fixtures', 'site', 'acme', rel), 'utf8');

const PAGE_URL = 'http://127.0.0.1:8099/acme/index.html';

describe('extractPage - visible text', () => {
  const page = extractPage(fixture('index.html'), PAGE_URL);

  it('extracts the title', () => {
    expect(page.title).toBe('Acme Robotics - Warehouse automation');
  });

  it('extracts meaningful prose', () => {
    expect(page.text).toContain('autonomous mobile robots');
    expect(page.text).toContain('fleet-management');
  });

  it('includes the meta description, which often carries the elevator pitch', () => {
    expect(page.text).toContain('Acme Robotics builds autonomous mobile robots');
  });

  it('separates block elements rather than running words together', () => {
    expect(page.text).not.toMatch(/RoboticsAcme/);
  });
});

describe('extractPage - noise removal', () => {
  const html = [
    '<html><head><title>T</title>',
    '<style>.a{color:red}</style>',
    '<script>window.secret = "leak"; alert(1)</script>',
    '</head><body>',
    '<nav><a href="/careers/">Careers</a><span>NAVNOISE</span></nav>',
    '<main><p>Real content here.</p></main>',
    '<noscript>NOSCRIPTNOISE</noscript>',
    '<footer>FOOTERNOISE</footer>',
    '</body></html>',
  ].join('');
  const page = extractPage(html, PAGE_URL);

  it.each(['leak', 'alert(1)', 'color:red', 'NAVNOISE', 'FOOTERNOISE', 'NOSCRIPTNOISE'])(
    'removes %s',
    (needle) => {
      expect(page.text).not.toContain(needle);
    },
  );

  it('keeps the real content', () => {
    expect(page.text).toContain('Real content here.');
  });

  it('still collects links from the navigation it discarded', () => {
    // The careers link almost always lives in the nav we just threw away.
    expect(page.links.map((l) => l.url)).toContain('http://127.0.0.1:8099/careers/');
  });
});

describe('extractPage - links', () => {
  const page = extractPage(fixture('index.html'), PAGE_URL);

  it('resolves relative hrefs against the page URL', () => {
    const urls = page.links.map((l) => l.url);
    expect(urls).toContain('http://127.0.0.1:8099/acme/about.html');
    expect(urls).toContain('http://127.0.0.1:8099/acme/careers/');
  });

  it('captures anchor text for ranking', () => {
    const about = page.links.find((l) => l.url.endsWith('about.html'));
    expect(about?.anchorText).toBe('About us');
  });

  it('resolves ../ correctly from a nested page', () => {
    const careers = extractPage(
      fixture('careers/index.html'),
      'http://127.0.0.1:8099/acme/careers/',
    );
    expect(careers.links.map((l) => l.url)).toContain(
      'http://127.0.0.1:8099/acme/about.html',
    );
  });

  it.each(['mailto:jobs@example.com', 'tel:+441234', 'javascript:void(0)', '#top'])(
    'skips the non-navigable href %s',
    (href) => {
      const page2 = extractPage(`<a href="${href}">x</a>`, PAGE_URL);
      expect(page2.links).toHaveLength(0);
    },
  );
});

describe('extractPage - size budget', () => {
  it('caps text at the documented budget and flags truncation', () => {
    const long = `<html><body><p>${'word '.repeat(MAX_PAGE_TEXT_CHARS)}</p></body></html>`;
    const page = extractPage(long, PAGE_URL);

    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(MAX_PAGE_TEXT_CHARS + 3);
  });

  it('respects a caller-supplied cap', () => {
    const page = extractPage('<p>abcdefghijklmnop</p>', PAGE_URL, { maxChars: 8 });
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(11);
  });

  it('does not flag short pages as truncated', () => {
    expect(extractPage('<p>short</p>', PAGE_URL).truncated).toBe(false);
  });
});

describe('extractPage - robustness', () => {
  it('handles empty and malformed HTML without throwing', () => {
    expect(() => extractPage('', PAGE_URL)).not.toThrow();
    expect(() => extractPage('<div><p>unclosed', PAGE_URL)).not.toThrow();
    expect(extractPage('<div><p>unclosed', PAGE_URL).text).toContain('unclosed');
  });

  it('is deterministic', () => {
    const html = fixture('about.html');
    expect(extractPage(html, PAGE_URL)).toEqual(extractPage(html, PAGE_URL));
  });
});
