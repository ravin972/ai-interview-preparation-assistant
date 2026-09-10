/**
 * HTML to text extraction (docs/PIPELINE.md stage 8).
 *
 * Two jobs from one parse: the links the crawler will rank, and the visible
 * text the brief and question prompts will read. Links are collected before
 * navigation chrome is discarded, because the careers link usually lives in
 * exactly the nav we are about to throw away.
 */
import * as cheerio from 'cheerio';
import type { DiscoveredLink } from './rank.js';

/** Matches the checkpoint budget in docs/STATE_MODEL.md. */
export const MAX_PAGE_TEXT_CHARS = 20_000;

/** Removed before reading text: no content value, high noise. */
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'object',
  'embed',
  'form',
  'nav',
  'footer',
  '[role="navigation"]',
  '[aria-hidden="true"]',
];

const SKIPPED_SCHEMES = ['mailto:', 'tel:', 'javascript:', 'data:', 'sms:'];

export interface ExtractedPage {
  title: string;
  text: string;
  links: DiscoveredLink[];
  truncated: boolean;
}

export interface ExtractOptions {
  maxChars?: number;
}

function collapse(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPage(
  html: string,
  pageUrl: string,
  options: ExtractOptions = {},
): ExtractedPage {
  const maxChars = options.maxChars ?? MAX_PAGE_TEXT_CHARS;
  const $ = cheerio.load(html);

  // Links first - navigation is removed below, and that is where they live.
  const links: DiscoveredLink[] = [];
  $('a[href]').each((_index, element) => {
    const href = ($(element).attr('href') ?? '').trim();
    if (href === '' || href.startsWith('#')) return;
    if (SKIPPED_SCHEMES.some((scheme) => href.toLowerCase().startsWith(scheme))) return;
    let resolved: string;
    try {
      resolved = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    links.push({
      url: resolved,
      anchorText: $(element).text().replace(/\s+/g, ' ').trim(),
    });
  });

  const title = ($('title').first().text() || $('h1').first().text() || '')
    .replace(/\s+/g, ' ')
    .trim();

  const description = ($('meta[name="description"]').attr('content') ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const selector of NOISE_SELECTORS) $(selector).remove();

  // Block-level elements become line breaks so headings do not run into prose.
  $('br').replaceWith('\n');
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article').each(
    (_index, element) => {
      $(element).append('\n');
    },
  );

  const body = collapse($('body').text() || $.root().text());
  const combined = collapse(
    [title, description, body].filter((part) => part !== '').join('\n\n'),
  );

  const truncated = combined.length > maxChars;
  const text = truncated ? `${combined.slice(0, maxChars).trimEnd()}...` : combined;

  return { title, text, links, truncated };
}
