import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InvalidJobDescriptionError } from '../src/errors.js';
import { extractRequirements } from '../src/extract/extract.js';
import { createMockAdapter, step } from '../src/llm/mock.js';
import { LlmStructuredError } from '../src/llm/types.js';
import { requirementSchema } from '../src/schema/kit.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJd = (name: string) =>
  fs.readFileSync(path.join(REPO, 'fixtures', 'jds', `${name}.txt`), 'utf8');

interface Candidate {
  text: string;
  kind: string;
  priority: string;
  evidence_quote: string;
}

const respond = (requirements: Candidate[]) =>
  createMockAdapter({ name: 'gemini', script: [step.json({ requirements })] });

const extract = (jd: string, requirements: Candidate[], extra = {}) =>
  extractRequirements({
    jd,
    adapters: [respond(requirements)],
    sleep: async () => undefined,
    ...extra,
  });

/** Candidates a competent model would return for the rich fixture. */
const RICH_CANDIDATES: Candidate[] = [
  {
    text: '5+ years of professional frontend engineering experience',
    kind: 'technical',
    priority: 'must',
    evidence_quote: '5+ years of professional frontend engineering experience.',
  },
  {
    text: 'Deep expertise with React and TypeScript in production systems',
    kind: 'technical',
    priority: 'must',
    evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
  },
  {
    text: 'Strong understanding of browser rendering performance and profiling',
    kind: 'technical',
    priority: 'must',
    evidence_quote:
      'Strong understanding of browser rendering performance and profiling.',
  },
  {
    text: 'Clear written communication',
    kind: 'behavioural',
    priority: 'must',
    evidence_quote: 'Clear written communication - we are a documentation-heavy company.',
  },
  {
    text: 'Experience with WebGL or canvas-based visualisation',
    kind: 'technical',
    priority: 'nice',
    evidence_quote: 'Experience with WebGL or canvas-based visualisation.',
  },
  {
    text: 'Familiarity with robotics, logistics or industrial control systems',
    kind: 'domain',
    priority: 'nice',
    evidence_quote: 'Familiarity with robotics, logistics or industrial control systems.',
  },
];

describe('extractRequirements - rich fixture', () => {
  it('extracts grounded requirements with stable ids in document order', async () => {
    const result = await extract(readJd('rich'), RICH_CANDIDATES);

    expect(result.requirements.length).toBe(RICH_CANDIDATES.length);
    expect(result.requirements.map((r) => r.id)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
    ]);
    for (const requirement of result.requirements) {
      expect(requirementSchema.safeParse(requirement).success).toBe(true);
    }
  });

  it('classifies must and nice from the source section', async () => {
    const result = await extract(readJd('rich'), RICH_CANDIDATES);
    const byText = new Map(result.requirements.map((r) => [r.text, r.priority]));

    expect(byText.get('5+ years of professional frontend engineering experience')).toBe(
      'must',
    );
    expect(byText.get('Experience with WebGL or canvas-based visualisation')).toBe(
      'nice',
    );
    expect(
      byText.get('Familiarity with robotics, logistics or industrial control systems'),
    ).toBe('nice');
  });

  it('is not thin and records no gaps', async () => {
    const result = await extract(readJd('rich'), RICH_CANDIDATES);
    expect(result.thin).toBe(false);
    expect(result.gaps).toEqual([]);
  });

  it('reports jd_chars as the original character count', async () => {
    const jd = readJd('rich');
    const result = await extract(jd, RICH_CANDIDATES);
    expect(result.jdChars).toBe(jd.length);
  });

  it('overrides a model that mislabels a nice-to-have as a must', async () => {
    const misjudged = RICH_CANDIDATES.map((c) =>
      c.text.startsWith('Experience with WebGL') ? { ...c, priority: 'must' } : c,
    );
    const result = await extract(readJd('rich'), misjudged);

    const webgl = result.requirements.find((r) =>
      r.text.startsWith('Experience with WebGL'),
    );
    expect(webgl?.priority).toBe('nice');
    expect(result.priorityOverrides).toHaveLength(1);
  });

  it('drops a hallucinated requirement without touching the rest', async () => {
    const withHallucination = [
      ...RICH_CANDIDATES,
      {
        text: 'Kubernetes cluster administration at scale',
        kind: 'technical',
        priority: 'must',
        evidence_quote: 'Kubernetes cluster administration at scale is essential.',
      },
    ];
    const result = await extract(readJd('rich'), withHallucination);

    expect(result.requirements).toHaveLength(RICH_CANDIDATES.length);
    expect(result.requirements.some((r) => r.text.includes('Kubernetes'))).toBe(false);
    expect(result.dropped.map((d) => d.reason)).toEqual(['evidence_not_found']);
  });
});

describe('extractRequirements - thin fixture', () => {
  const THIN_CANDIDATES: Candidate[] = [
    {
      text: 'React experience',
      kind: 'technical',
      priority: 'must',
      evidence_quote: 'React experience required.',
    },
  ];

  it('stays thin and records the gap honestly', async () => {
    const result = await extract(readJd('thin'), THIN_CANDIDATES);

    expect(result.requirements).toHaveLength(1);
    expect(result.thin).toBe(true);
    expect(result.gaps).toContain('thin_jd');
  });

  it('does not top up from general knowledge', async () => {
    // Even if the model volunteers plausible extras, they are not in the JD.
    const padded: Candidate[] = [
      ...THIN_CANDIDATES,
      {
        text: 'Experience with Redux and state management libraries',
        kind: 'technical',
        priority: 'must',
        evidence_quote: 'Experience with Redux and state management libraries.',
      },
      {
        text: 'Familiarity with CSS-in-JS solutions',
        kind: 'technical',
        priority: 'nice',
        evidence_quote: 'Familiarity with CSS-in-JS solutions.',
      },
    ];
    const result = await extract(readJd('thin'), padded);

    expect(result.requirements).toHaveLength(1);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped.every((d) => d.reason === 'evidence_not_found')).toBe(true);
  });

  it('reports the original length for a two-line job description', async () => {
    const jd = readJd('thin');
    expect((await extract(jd, THIN_CANDIDATES)).jdChars).toBe(jd.length);
  });
});

describe('extractRequirements - heading-less fixture', () => {
  const CANDIDATES: Candidate[] = [
    {
      text: 'At least four years building production backend systems',
      kind: 'technical',
      priority: 'must',
      evidence_quote: 'at least four years building production backend systems',
    },
    {
      text: 'Designing and shipping HTTP APIs in Node.js and TypeScript',
      kind: 'technical',
      priority: 'must',
      evidence_quote: 'designing and shipping HTTP APIs in Node.js and TypeScript',
    },
    {
      text: 'Tuning PostgreSQL queries under load',
      kind: 'technical',
      priority: 'must',
      evidence_quote: 'tuning PostgreSQL queries that have started to creak under load',
    },
    {
      text: 'Worked with Kubernetes before',
      kind: 'technical',
      priority: 'nice',
      evidence_quote:
        'It would be genuinely useful if you had worked with Kubernetes before',
    },
  ];

  it('keeps the model priority when no section can override it', async () => {
    const result = await extract(readJd('heading-less'), CANDIDATES);

    expect(result.requirements).toHaveLength(4);
    expect(result.priorityOverrides).toHaveLength(0);
    expect(result.requirements.filter((r) => r.priority === 'must')).toHaveLength(3);
    expect(result.requirements.filter((r) => r.priority === 'nice')).toHaveLength(1);
  });

  it('finds no requirements or nice-to-have sections to lean on', async () => {
    const result = await extract(readJd('heading-less'), CANDIDATES);
    const kinds = result.sections.map((s) => s.kind);
    expect(kinds).not.toContain('requirements');
    expect(kinds).not.toContain('nice-to-have');
  });
});

describe('extractRequirements - boilerplate-heavy fixture', () => {
  const CANDIDATES: Candidate[] = [
    {
      text: '3+ years with Docker and Kubernetes',
      kind: 'technical',
      priority: 'must',
      evidence_quote: 'Requires 3+ years with Docker and',
    },
    {
      text: 'Strong Python scripting ability',
      kind: 'technical',
      priority: 'must',
      evidence_quote: 'strong Python scripting ability',
    },
    {
      text: '28 days annual leave plus all UK bank holidays',
      kind: 'domain',
      priority: 'nice',
      evidence_quote: '28 days annual leave plus all UK bank holidays',
    },
    {
      text: 'Company pension with 6 percent employer contribution',
      kind: 'domain',
      priority: 'nice',
      evidence_quote: 'Company pension with 6 percent employer contribution',
    },
    {
      text: 'Applicants must have the right to work in the United Kingdom',
      kind: 'domain',
      priority: 'must',
      evidence_quote: 'Applicants must have the right to work in the United Kingdom.',
    },
  ];

  it('keeps the genuine requirements and strips every piece of boilerplate', async () => {
    const result = await extract(readJd('boilerplate-heavy'), CANDIDATES);

    expect(result.requirements.map((r) => r.text)).toEqual([
      '3+ years with Docker and Kubernetes',
      'Strong Python scripting ability',
    ]);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      'boilerplate',
      'boilerplate',
      'boilerplate',
    ]);
  });

  it('is thin, because only two honest requirements survive', async () => {
    const result = await extract(readJd('boilerplate-heavy'), CANDIDATES);
    expect(result.thin).toBe(true);
    expect(result.gaps).toContain('thin_jd');
  });
});

describe('extractRequirements - input handling', () => {
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   \n\t  '],
  ])('rejects %s', async (_label, jd) => {
    await expect(extract(jd, RICH_CANDIDATES)).rejects.toBeInstanceOf(
      InvalidJobDescriptionError,
    );
  });

  it('accepts pasted HTML and still reports the original character count', async () => {
    const html = [
      '<div><h2>Requirements</h2><ul>',
      '<li>Deep expertise with React and TypeScript in production systems.</li>',
      '</ul></div>',
    ].join('');
    const result = await extract(html, [
      {
        text: 'Deep expertise with React and TypeScript in production systems',
        kind: 'technical',
        priority: 'must',
        evidence_quote: 'Deep expertise with React and TypeScript in production systems.',
      },
    ]);

    expect(result.normalized.looksLikeHtml).toBe(true);
    expect(result.jdChars).toBe(html.length);
    expect(result.jdChars).toBeGreaterThan(result.normalized.text.length);
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]?.priority).toBe('must');
  });
});

describe('extractRequirements - prompt discipline', () => {
  it('wraps the job description as untrusted data and never asks for ids', async () => {
    const adapter = respond(RICH_CANDIDATES);
    await extractRequirements({
      jd: readJd('rich'),
      adapters: [adapter],
      sleep: async () => undefined,
    });

    const call = adapter.calls[0]!;
    expect(call.user).toContain('<job_description>');
    expect(call.user).toContain('</job_description>');
    expect(call.system).toMatch(/untrusted data/i);
    expect(call.system).toMatch(/ignore them/i);
    expect(call.system).toMatch(/do NOT assign ids/i);
    expect(call.system).toMatch(/verbatim/i);
  });

  it('sends the normalised text, not the raw paste', async () => {
    const adapter = respond([]);
    await extractRequirements({
      jd: '<p>React   experience</p>',
      adapters: [adapter],
      sleep: async () => undefined,
    });
    expect(adapter.calls[0]?.user).toContain('React experience');
    expect(adapter.calls[0]?.user).not.toContain('<p>');
  });
});

describe('extractRequirements - provider behaviour', () => {
  it('recovers through the router repair path', async () => {
    const gemini = createMockAdapter({
      name: 'gemini',
      script: [step.malformed(), step.json({ requirements: RICH_CANDIDATES })],
    });
    const result = await extractRequirements({
      jd: readJd('rich'),
      adapters: [gemini],
      sleep: async () => undefined,
    });

    expect(result.llm.repaired).toBe(true);
    expect(result.requirements).toHaveLength(RICH_CANDIDATES.length);
  });

  it('falls back to the second provider when the first is rate limited', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.rateLimit()] });
    const groq = createMockAdapter({
      name: 'groq',
      script: [step.json({ requirements: RICH_CANDIDATES })],
    });
    const result = await extractRequirements({
      jd: readJd('rich'),
      adapters: [gemini, groq],
      sleep: async () => undefined,
    });

    expect(result.llm.provider).toBe('groq');
    expect(result.requirements).toHaveLength(RICH_CANDIDATES.length);
  });

  it('surfaces a structured error when every provider fails', async () => {
    const gemini = createMockAdapter({ name: 'gemini', script: [step.malformed()] });
    const groq = createMockAdapter({ name: 'groq', script: [step.malformed()] });

    await expect(
      extractRequirements({
        jd: readJd('rich'),
        adapters: [gemini, groq],
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(LlmStructuredError);
  });

  it('handles a model that returns an empty requirement list', async () => {
    const result = await extract(readJd('rich'), []);
    expect(result.requirements).toEqual([]);
    expect(result.thin).toBe(true);
  });
});

describe('extractRequirements - determinism', () => {
  it('produces identical requirements across repeated runs', async () => {
    const first = await extract(readJd('rich'), RICH_CANDIDATES);
    const second = await extract(readJd('rich'), RICH_CANDIDATES);
    expect(first.requirements).toEqual(second.requirements);
    expect(first.dropped).toEqual(second.dropped);
  });

  it('is unaffected by the order the model returns candidates in', async () => {
    const forwards = await extract(readJd('rich'), RICH_CANDIDATES);
    const backwards = await extract(readJd('rich'), [...RICH_CANDIDATES].reverse());
    expect(backwards.requirements.map((r) => r.text)).toEqual(
      forwards.requirements.map((r) => r.text),
    );
  });
});
