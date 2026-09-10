/**
 * Deterministic section detection (docs/PIPELINE.md section 4, step 2).
 *
 * The section a requirement was quoted from is stronger evidence of must vs
 * nice than the model's own judgement, so priority is decided here in code and
 * the model's answer is overridden. This is the clearest demonstration of the
 * LLM boundary the specification asks for.
 */

export type SectionKind =
  | 'about'
  | 'responsibilities'
  | 'requirements'
  | 'nice-to-have'
  | 'benefits'
  | 'eeo'
  | 'other';

export interface Section {
  kind: SectionKind;
  /** The heading line that opened this section, or null for the preamble. */
  heading: string | null;
  /** Character offsets into the normalised text. */
  start: number;
  end: number;
  text: string;
}

/**
 * Ordered: the first matching group wins. nice-to-have is tested before
 * requirements so "Preferred qualifications" is not read as a hard requirement.
 */
const HEADING_RULES: readonly { kind: SectionKind; patterns: readonly RegExp[] }[] = [
  {
    kind: 'nice-to-have',
    patterns: [
      /\bnice[ -]to[ -]have\b/,
      /\bpreferred\b/,
      /\bdesirable\b/,
      /\bbonus\b/,
      /\bgood to have\b/,
      /\badvantageous\b/,
      /\bplus(es)?\b/,
      /\bwould be great\b/,
    ],
  },
  {
    kind: 'benefits',
    patterns: [
      /\bbenefits\b/,
      /\bwhat we offer\b/,
      /\bperks\b/,
      /\bcompensation\b/,
      /\bsalary\b/,
      /\bpackage\b/,
      /\bwhy join\b/,
      /\bwhy work\b/,
    ],
  },
  {
    kind: 'eeo',
    patterns: [
      /\bequal opportunit/,
      /\bdiversity\b/,
      /\binclusion\b/,
      /\beeo\b/,
      /\bright to work\b/,
      /\bvisa\b/,
      /\brecruitment agenc/,
      /\bagencies\b/,
      /\bprivacy\b/,
    ],
  },
  {
    kind: 'requirements',
    patterns: [
      /\brequirements?\b/,
      /\brequired\b/,
      /\bmust[ -]have\b/,
      /\bqualifications\b/,
      /\bwhat you.{0,3}ll need\b/,
      /\bwhat we.{0,3}re looking for\b/,
      /\bwho you are\b/,
      /\bskills\b/,
      /\bessential\b/,
      /\byou will bring\b/,
    ],
  },
  {
    kind: 'responsibilities',
    patterns: [
      /\bresponsibilities\b/,
      /\bwhat you will do\b/,
      /\bwhat you.{0,3}ll do\b/,
      /\bthe role\b/,
      /\babout the role\b/,
      /\bday[ -]to[ -]day\b/,
      /\byour impact\b/,
      /\bin this role\b/,
    ],
  },
  {
    kind: 'about',
    patterns: [
      /\babout us\b/,
      /\babout the company\b/,
      /\bwho we are\b/,
      /\bour mission\b/,
    ],
  },
];

const MAX_HEADING_CHARS = 80;

/** A heading is a short, non-bulleted line that names a known section. */
export function classifyHeading(line: string): SectionKind | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.length > MAX_HEADING_CHARS) return null;
  if (trimmed.startsWith('- ')) return null;

  const probe = trimmed
    .toLowerCase()
    .replace(/[:*#]+$/, '')
    .trim();
  // A heading names a section; a sentence describes one.
  if (probe.endsWith('.') || probe.split(' ').length > 8) return null;

  for (const rule of HEADING_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(probe))) return rule.kind;
  }
  return null;
}

export function detectSections(normalized: string): Section[] {
  const sections: Section[] = [];
  const lines = normalized.split('\n');

  let cursor = 0;
  let current: { kind: SectionKind; heading: string | null; start: number } = {
    kind: 'other',
    heading: null,
    start: 0,
  };

  const close = (end: number): void => {
    if (end <= current.start && sections.length > 0) return;
    sections.push({
      kind: current.kind,
      heading: current.heading,
      start: current.start,
      end,
      text: normalized.slice(current.start, end),
    });
  };

  for (const line of lines) {
    const lineStart = cursor;
    cursor += line.length + 1;

    const kind = classifyHeading(line);
    if (kind === null) continue;

    close(lineStart);
    current = { kind, heading: line.trim(), start: lineStart };
  }
  close(normalized.length);

  return sections;
}

export function sectionAtIndex(
  sections: readonly Section[],
  index: number,
): Section | null {
  for (const section of sections) {
    if (index >= section.start && index < section.end) return section;
  }
  return null;
}
