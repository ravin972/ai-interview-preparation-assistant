import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_REQUIREMENTS,
  applyGuards,
  type RequirementCandidate,
} from '../src/extract/guards.js';
import { normalizeJd } from '../src/extract/normalize.js';
import { detectSections } from '../src/extract/sections.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJd = (name: string) =>
  fs.readFileSync(path.join(REPO, 'fixtures', 'jds', `${name}.txt`), 'utf8');

const rich = normalizeJd(readJd('rich'));
const richSections = detectSections(rich.text);

const guard = (candidates: RequirementCandidate[], maxRequirements?: number) =>
  applyGuards(
    candidates,
    rich.text,
    richSections,
    maxRequirements === undefined ? {} : { maxRequirements },
  );

const candidate = (over: Partial<RequirementCandidate> = {}): RequirementCandidate => ({
  text: 'Deep expertise with React and TypeScript in production systems',
  kind: 'technical',
  priority: 'must',
  evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
  ...over,
});

const reasons = (result: ReturnType<typeof guard>) => result.dropped.map((d) => d.reason);

describe('guard (a) - evidence must appear in the job description', () => {
  it('keeps a requirement whose quote is verbatim from the JD', () => {
    const result = guard([candidate()]);
    expect(result.requirements).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops a hallucinated requirement that was never in the JD', () => {
    const result = guard([
      candidate({
        text: 'Five years of Kubernetes cluster administration',
        evidence_quote: 'Five years of Kubernetes cluster administration required.',
      }),
    ]);
    expect(result.requirements).toHaveLength(0);
    expect(reasons(result)).toEqual(['evidence_not_found']);
  });

  it('drops a requirement whose quote paraphrases rather than quotes', () => {
    const result = guard([
      candidate({ evidence_quote: 'The company wants someone very good at React' }),
    ]);
    expect(reasons(result)).toEqual(['evidence_not_found']);
  });

  it('drops a requirement with an empty quote', () => {
    expect(reasons(guard([candidate({ evidence_quote: '   ' })]))).toEqual([
      'evidence_not_found',
    ]);
  });

  it('accepts a quote that differs only in whitespace and case', () => {
    const result = guard([
      candidate({
        evidence_quote: 'deep   expertise with REACT and TypeScript\nin production',
      }),
    ]);
    expect(result.requirements).toHaveLength(1);
  });

  it('names the offending quote in the drop detail', () => {
    const result = guard([
      candidate({ evidence_quote: 'Kubernetes at planetary scale' }),
    ]);
    expect(result.dropped[0]?.detail).toContain('Kubernetes');
  });
});

describe('guard (b) - content overlap with the job description', () => {
  it('drops a requirement whose wording is not grounded in the JD', () => {
    // The quote is real, but the requirement text invents unrelated technology.
    const result = guard([
      candidate({
        text: 'Kubernetes Istio service mesh administration and Terraform modules',
        evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
      }),
    ]);
    expect(reasons(result)).toEqual(['low_overlap']);
  });

  it('keeps a requirement that rewords the JD without inventing terms', () => {
    const result = guard([
      candidate({
        text: 'React and TypeScript expertise in production',
        evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
      }),
    ]);
    expect(result.requirements).toHaveLength(1);
  });

  it('drops an empty requirement text', () => {
    expect(reasons(guard([candidate({ text: '  ' })]))).toEqual(['empty_text']);
  });
});

describe('guard (c) - the source section decides priority', () => {
  it('demotes a model-declared must that was quoted from nice-to-have', () => {
    const result = guard([
      candidate({
        text: 'Experience with WebGL or canvas-based visualisation',
        priority: 'must',
        evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
      }),
    ]);
    expect(result.requirements[0]?.priority).toBe('nice');
    expect(result.priorityOverrides[0]).toMatchObject({ from: 'must', to: 'nice' });
  });

  it('promotes a model-declared nice that was quoted from requirements', () => {
    const result = guard([candidate({ priority: 'nice' })]);
    expect(result.requirements[0]?.priority).toBe('must');
    expect(result.priorityOverrides[0]).toMatchObject({ from: 'nice', to: 'must' });
  });

  it('records no override when the model already agrees with the section', () => {
    expect(guard([candidate({ priority: 'must' })]).priorityOverrides).toHaveLength(0);
  });
});

describe('guards (e) - enum coercion', () => {
  it.each([
    ['soft-skill', 'technical'],
    ['TECHNICAL', 'technical'],
    ['behavioural', 'behavioural'],
    ['domain', 'domain'],
    ['', 'technical'],
  ])('coerces kind %s to %s', (kind, expected) => {
    expect(guard([candidate({ kind })]).requirements[0]?.kind).toBe(expected);
  });

  it('coerces an unrecognised priority conservatively before the section override', () => {
    const result = guard([
      candidate({
        text: 'Experience with WebGL or canvas-based visualisation',
        priority: 'critical',
        evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
      }),
    ]);
    expect(result.requirements[0]?.priority).toBe('nice');
  });
});

describe('guard (d) - duplicates merge', () => {
  it('merges two identical requirements', () => {
    const result = guard([candidate(), candidate()]);
    expect(result.requirements).toHaveLength(1);
    expect(reasons(result)).toEqual(['duplicate']);
  });

  it('merges near-identical requirements that differ only in wording order', () => {
    const result = guard([
      candidate({
        text: 'Deep expertise with React and TypeScript in production systems',
      }),
      candidate({ text: 'production systems React TypeScript deep expertise' }),
    ]);
    expect(result.requirements).toHaveLength(1);
  });

  it('keeps the earliest occurrence and reports what it merged into', () => {
    const result = guard([
      candidate({
        text: 'Deep expertise with React and TypeScript in production systems',
      }),
      candidate({
        text: 'Deep expertise with React and TypeScript in production systems.',
      }),
    ]);
    expect(result.requirements[0]?.text).toBe(
      'Deep expertise with React and TypeScript in production systems',
    );
    expect(result.dropped[0]?.detail).toContain('merged into');
  });

  it('a merged pair keeps the stronger priority', () => {
    const text = 'Deep expertise with React and TypeScript in production systems';
    const result = guard([
      // Same requirement quoted twice: once from nice-to-have, once from the
      // hard requirements section. The merged survivor must be a must-have.
      candidate({
        text,
        priority: 'nice',
        evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
      }),
      candidate({
        text,
        priority: 'nice',
        evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
      }),
    ]);
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]?.priority).toBe('must');
  });

  it('does not merge requirements that fall below the similarity threshold', () => {
    // 0.8 Jaccard - close, but deliberately not close enough to merge.
    const result = guard([
      candidate({
        text: 'Experience with WebGL or canvas-based visualisation',
        evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
      }),
      candidate({
        text: 'Experience with WebGL or canvas visualisation',
        evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
      }),
    ]);
    expect(result.requirements).toHaveLength(2);
  });

  it('does not merge genuinely different requirements', () => {
    const result = guard([
      candidate(),
      candidate({
        text: 'Strong understanding of browser rendering performance and profiling',
        evidence_quote:
          'Strong understanding of browser rendering performance and profiling.',
      }),
    ]);
    expect(result.requirements).toHaveLength(2);
  });
});

describe('guard (f) - boilerplate never becomes a requirement', () => {
  const boilerplate = normalizeJd(readJd('boilerplate-heavy'));
  const boilerplateSections = detectSections(boilerplate.text);

  it.each([
    ['annual leave', '28 days annual leave plus all UK bank holidays'],
    ['pension', 'Company pension with 6 percent employer contribution'],
    ['insurance', 'Private medical and dental insurance for you and your dependants'],
    ['EEO', 'All qualified applicants will receive consideration for employment'],
    ['right to work', 'Applicants must have the right to work in the United Kingdom.'],
    ['agencies', 'We do not accept unsolicited CVs from recruitment agencies.'],
  ])('drops %s text quoted from the boilerplate JD', (_label, quote) => {
    const result = applyGuards(
      [candidate({ text: quote, evidence_quote: quote })],
      boilerplate.text,
      boilerplateSections,
    );
    expect(result.requirements).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe('boilerplate');
  });

  it('keeps the genuine requirement buried in the same boilerplate JD', () => {
    const result = applyGuards(
      [
        candidate({
          text: '3+ years with Docker and Kubernetes',
          evidence_quote: 'Requires 3+ years with Docker and',
        }),
      ],
      boilerplate.text,
      boilerplateSections,
    );
    expect(result.requirements).toHaveLength(1);
  });

  it('drops benefits text even when quoted from a non-benefits section', () => {
    const result = guard([
      candidate({
        text: '28 days holiday plus bank holidays',
        evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
      }),
    ]);
    expect(result.dropped[0]?.reason).toBe('boilerplate');
  });
});

describe('guards (g, h) - cap and identifiers', () => {
  // Two-letter suffixes: single digits are dropped by tokenisation, which
  // would make every variant an exact duplicate of the others.
  const suffix = (index: number) =>
    String.fromCharCode(97 + Math.floor(index / 26)) +
    String.fromCharCode(97 + (index % 26));

  const many = (count: number): RequirementCandidate[] =>
    Array.from({ length: count }, (_, index) =>
      candidate({
        // Distinct enough to survive deduplication, all grounded in the JD.
        text: `React TypeScript rendering performance profiling variant ${suffix(index)}`,
        evidence_quote:
          'Strong understanding of browser rendering performance and profiling.',
      }),
    );

  it('caps the requirement list at the documented maximum', () => {
    const result = guard(many(MAX_REQUIREMENTS + 6));
    expect(result.requirements).toHaveLength(MAX_REQUIREMENTS);
    expect(reasons(result).filter((r) => r === 'cap_exceeded')).toHaveLength(6);
  });

  it('keeps must-haves ahead of nice-to-haves when capping', () => {
    const nice = Array.from({ length: 4 }, (_, index) =>
      candidate({
        text: `WebGL canvas-based visualisation variant ${suffix(index)}`,
        priority: 'nice',
        evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
      }),
    );
    const result = applyGuards([...nice, ...many(4)], rich.text, richSections, {
      maxRequirements: 4,
    });

    expect(result.requirements).toHaveLength(4);
    expect(result.requirements.every((r) => r.priority === 'must')).toBe(true);
  });

  it('assigns r1..rn only after filtering, in document order', () => {
    const later = candidate({
      text: 'Demonstrable experience writing automated tests for UI code',
      evidence_quote: 'Demonstrable experience writing automated tests for UI code.',
    });
    const earlier = candidate({
      text: '5+ years of professional frontend engineering experience',
      evidence_quote: '5+ years of professional frontend engineering experience.',
    });
    const hallucinated = candidate({
      text: 'Kubernetes cluster administration',
      evidence_quote: 'Kubernetes cluster administration is essential.',
    });

    // Supplied out of order, with a doomed candidate in the middle.
    const result = guard([later, hallucinated, earlier]);

    expect(result.requirements.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(result.requirements[0]?.text).toContain('5+ years');
    expect(result.requirements[1]?.text).toContain('automated tests');
  });

  it('never issues an id to a dropped candidate', () => {
    const result = guard([
      candidate({ text: 'Kubernetes', evidence_quote: 'Kubernetes everywhere.' }),
      candidate(),
    ]);
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]?.id).toBe('r1');
  });

  it('accepts an injected allocator so regeneration can continue a sequence', () => {
    let next = 40;
    const withAllocator = applyGuards([candidate()], rich.text, richSections, {
      allocateId: () => `r${(next += 1)}`,
    });
    expect(guard([candidate()]).requirements[0]?.id).toBe('r1');
    expect(withAllocator.requirements[0]?.id).toBe('r41');
  });

  it('is deterministic across repeated runs', () => {
    const candidates = [candidate(), ...many(3)];
    expect(guard(candidates)).toEqual(guard(candidates));
  });
});
