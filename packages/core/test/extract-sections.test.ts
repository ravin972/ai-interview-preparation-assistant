import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeJd } from '../src/extract/normalize.js';
import {
  classifyHeading,
  detectSections,
  sectionAtIndex,
} from '../src/extract/sections.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJd = (name: string) =>
  fs.readFileSync(path.join(REPO, 'fixtures', 'jds', `${name}.txt`), 'utf8');

describe('classifyHeading', () => {
  it.each([
    ['Requirements', 'requirements'],
    ['Required skills', 'requirements'],
    ['Must have', 'requirements'],
    ['Qualifications', 'requirements'],
    ["What you'll need", 'requirements'],
    ['Who you are', 'requirements'],
    ['Nice to have', 'nice-to-have'],
    ['Nice-to-have', 'nice-to-have'],
    ['Preferred qualifications', 'nice-to-have'],
    ['Bonus points', 'nice-to-have'],
    ['Desirable', 'nice-to-have'],
    ['Responsibilities', 'responsibilities'],
    ['What you will do', 'responsibilities'],
    ['About the role', 'responsibilities'],
    ['About us', 'about'],
    ['Who we are', 'about'],
    ['Benefits', 'benefits'],
    ['What we offer', 'benefits'],
    ['Why join Acme Robotics?', 'benefits'],
    ['Equal opportunity', 'eeo'],
    ['Our commitment to diversity and inclusion', 'eeo'],
    ['Right to work', 'eeo'],
    ['Recruitment agencies', 'eeo'],
  ])('classifies %s as %s', (line, kind) => {
    expect(classifyHeading(line)).toBe(kind);
  });

  it('resolves "Preferred qualifications" to nice-to-have, not requirements', () => {
    // Both keywords are present; nice-to-have must win or every preferred
    // skill would be promoted to a hard requirement.
    expect(classifyHeading('Preferred qualifications')).toBe('nice-to-have');
  });

  it.each([
    ['a bullet', '- Requirements gathering with stakeholders'],
    ['a sentence', 'We have a few requirements for this role.'],
    ['a long line', 'Requirements '.repeat(12)],
    ['an empty line', ''],
    ['unrelated text', 'Acme Robotics'],
  ])('does not treat %s as a heading', (_label, line) => {
    expect(classifyHeading(line)).toBeNull();
  });

  it('tolerates trailing punctuation and markdown markers', () => {
    expect(classifyHeading('## Requirements:')).toBe('requirements');
  });
});

describe('detectSections - rich fixture', () => {
  const normalized = normalizeJd(readJd('rich'));
  const sections = detectSections(normalized.text);
  const kinds = sections.map((s) => s.kind);

  it('finds the four sections that matter for priority', () => {
    expect(kinds).toContain('responsibilities');
    expect(kinds).toContain('requirements');
    expect(kinds).toContain('nice-to-have');
    expect(kinds).toContain('benefits');
  });

  it('orders sections by position and covers the whole document', () => {
    for (const [index, section] of sections.entries()) {
      expect(section.start).toBeLessThan(section.end);
      if (index > 0)
        expect(section.start).toBeGreaterThanOrEqual(sections[index - 1]!.end);
    }
    expect(sections.at(-1)?.end).toBe(normalized.text.length);
  });

  it('places a must-have line inside the requirements section', () => {
    const index = normalized.text.indexOf('5+ years of professional frontend');
    expect(sectionAtIndex(sections, index)?.kind).toBe('requirements');
  });

  it('places a nice-to-have line inside the nice-to-have section', () => {
    const index = normalized.text.indexOf('Experience with WebGL');
    expect(sectionAtIndex(sections, index)?.kind).toBe('nice-to-have');
  });

  it('places benefits text inside the benefits section', () => {
    const index = normalized.text.indexOf('28 days holiday');
    expect(sectionAtIndex(sections, index)?.kind).toBe('benefits');
  });

  it('places the EEO paragraph outside any requirements section', () => {
    const index = normalized.text.indexOf('equal opportunity employer');
    const kind = sectionAtIndex(sections, index)?.kind;
    expect(kind).not.toBe('requirements');
    expect(kind).not.toBe('nice-to-have');
  });
});

describe('detectSections - other fixtures', () => {
  it('finds no requirement or nice-to-have headings in the heading-less JD', () => {
    const normalized = normalizeJd(readJd('heading-less'));
    const kinds = detectSections(normalized.text).map((s) => s.kind);
    expect(kinds).not.toContain('requirements');
    expect(kinds).not.toContain('nice-to-have');
  });

  it('finds the benefits and EEO sections in the boilerplate-heavy JD', () => {
    const normalized = normalizeJd(readJd('boilerplate-heavy'));
    const kinds = detectSections(normalized.text).map((s) => s.kind);
    expect(kinds).toContain('benefits');
    expect(kinds).toContain('eeo');
  });

  it('returns a single preamble section for a JD with no headings at all', () => {
    const sections = detectSections(
      'Frontend developer needed. React experience required.',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe('other');
    expect(sections[0]?.heading).toBeNull();
  });

  it('is deterministic', () => {
    const text = normalizeJd(readJd('rich')).text;
    expect(detectSections(text)).toEqual(detectSections(text));
  });
});
