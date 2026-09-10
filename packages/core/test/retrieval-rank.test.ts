import { describe, expect, it } from 'vitest';
import {
  classifyLink,
  isSameSite,
  normalizeUrl,
  rankLinks,
  scoreLink,
} from '../src/retrieval/rank.js';

const BASE = 'https://acme.example/';
const link = (url: string, anchorText = '') => ({ url, anchorText });

describe('normalizeUrl', () => {
  it('resolves relative URLs against the page they were found on', () => {
    expect(normalizeUrl('about.html', 'https://acme.example/company/')).toBe(
      'https://acme.example/company/about.html',
    );
    expect(normalizeUrl('../about.html', 'https://acme.example/careers/')).toBe(
      'https://acme.example/about.html',
    );
    expect(normalizeUrl('/careers/', 'https://acme.example/deep/page.html')).toBe(
      'https://acme.example/careers/',
    );
  });

  it('drops the fragment so one page is not fetched twice', () => {
    expect(normalizeUrl('https://acme.example/about#team')).toBe(
      'https://acme.example/about',
    );
  });

  it('drops a default port and lowercases the host', () => {
    expect(normalizeUrl('https://ACME.example:443/x')).toBe('https://acme.example/x');
    expect(normalizeUrl('http://ACME.example:80/x')).toBe('http://acme.example/x');
  });

  it('returns null for input it cannot parse', () => {
    expect(normalizeUrl('http://[bad')).toBeNull();
  });
});

describe('isSameSite', () => {
  it.each([
    ['same hostname (https)', 'https://acme.example/careers', true],
    ['same hostname (http)', 'http://acme.example/careers', true],
    ['legitimate subdomain (blog)', 'https://blog.acme.example/', true],
    ['legitimate subdomain (careers)', 'https://careers.acme.example/jobs', true],
    ['legitimate subdomain (engineering)', 'https://engineering.acme.example/', true],
    ['nested legitimate subdomain', 'https://deep.sub.acme.example/', true],
    ['evil suffix matching company name', 'https://evilacme.example/', false],
    ['arbitrary suffix match', 'https://notacme.example/', false],
    [
      'base hostname as subdomain of evil domain',
      'https://acme.example.evil.com/',
      false,
    ],
    ['completely different domain', 'https://example.com/', false],
  ])('%s: %s -> %s', (_label, url, expected) => {
    expect(isSameSite(url, BASE)).toBe(expected);
  });
});

describe('classifyLink', () => {
  it.each([
    ['https://acme.example/careers/interview-process.html', 'interview'],
    ['https://acme.example/hiring-process', 'interview'],
    ['https://acme.example/careers/', 'careers'],
    ['https://acme.example/jobs', 'careers'],
    ['https://acme.example/about.html', 'about'],
    ['https://acme.example/who-we-are', 'about'],
    ['https://acme.example/engineering', 'engineering'],
    ['https://acme.example/culture', 'culture'],
    ['https://acme.example/blog/', 'other'],
    ['https://acme.example/pricing', 'other'],
  ])('%s -> %s', (url, expected) => {
    expect(classifyLink(url)).toBe(expected);
  });

  it('uses anchor text when the path is uninformative', () => {
    expect(classifyLink('https://acme.example/p/42', 'Our interview process')).toBe(
      'interview',
    );
    expect(classifyLink('https://acme.example/p/9', 'Join us')).toBe('careers');
  });
});

describe('rankLinks', () => {
  const links = [
    link('https://acme.example/blog/', 'Blog'),
    link('careers/', 'Careers'),
    link('about.html', 'About us'),
    link('careers/interview-process.html', 'Our interview process'),
    link('https://external.example/partners', 'Partners'),
    link('assets/brochure.pdf', 'Download brochure'),
  ];

  it('ranks interview above careers above about, and blog below all', () => {
    const ranked = rankLinks(links, BASE).map((r) => r.sourceType);
    expect(ranked[0]).toBe('interview');
    expect(ranked[1]).toBe('careers');
    expect(ranked[2]).toBe('about');
  });

  it('discovers the interview, careers and about pages', () => {
    const types = new Set(rankLinks(links, BASE).map((r) => r.sourceType));
    expect(types).toContain('interview');
    expect(types).toContain('careers');
    expect(types).toContain('about');
  });

  it('drops off-site links', () => {
    expect(rankLinks(links, BASE).some((r) => r.url.includes('external.example'))).toBe(
      false,
    );
  });

  it('scores assets below zero so they are never fetched', () => {
    expect(scoreLink('https://acme.example/assets/brochure.pdf')).toBeLessThan(0);
    expect(scoreLink('https://acme.example/logo.png')).toBeLessThan(0);
  });

  it('penalises depth and query strings', () => {
    expect(scoreLink('https://acme.example/careers/')).toBeGreaterThan(
      scoreLink('https://acme.example/a/b/c/careers/'),
    );
    expect(scoreLink('https://acme.example/careers/')).toBeGreaterThan(
      scoreLink('https://acme.example/careers/?page=2'),
    );
  });

  it('deduplicates links that normalise to the same URL', () => {
    const ranked = rankLinks(
      [
        link('careers/'),
        link('careers/#openings'),
        link('https://acme.example/careers/'),
      ],
      BASE,
    );
    expect(ranked.filter((r) => r.url.endsWith('/careers/'))).toHaveLength(1);
  });

  it('is deterministic, breaking ties on the URL string', () => {
    const shuffled = [...links].reverse();
    expect(rankLinks(links, BASE).map((r) => r.url)).toEqual(
      rankLinks(shuffled, BASE).map((r) => r.url),
    );
  });
});
