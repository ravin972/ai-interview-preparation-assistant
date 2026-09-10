/**
 * Deterministic guards over model-proposed requirements
 * (docs/PIPELINE.md section 4, step 4 - the 20-point rubric line).
 *
 * The model proposes; application code disposes. A requirement that cannot
 * point at a verbatim span of the job description does not exist, and the
 * section a quote came from outranks the model's own priority judgement.
 */
import {
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  type Requirement,
  type RequirementKind,
  type RequirementPriority,
} from '../schema/kit.js';
import { sectionAtIndex, type Section, type SectionKind } from './sections.js';

/** docs/PIPELINE.md section 4, guard (g). */
export const MAX_REQUIREMENTS = 24;
/** Guard (b): share of a requirement's content tokens that must appear in the JD. */
export const MIN_TOKEN_OVERLAP = 0.6;
/** Guard (d): Jaccard similarity at or above which two requirements merge. */
export const DUPLICATE_JACCARD = 0.85;

export interface RequirementCandidate {
  text: string;
  kind: string;
  priority: string;
  evidence_quote: string;
}

export type GuardDropReason =
  | 'empty_text'
  | 'evidence_not_found'
  | 'low_overlap'
  | 'boilerplate'
  | 'duplicate'
  | 'cap_exceeded';

export interface GuardDrop {
  candidate: RequirementCandidate;
  reason: GuardDropReason;
  detail: string;
}

export interface PriorityOverride {
  text: string;
  from: string;
  to: RequirementPriority;
  section: SectionKind;
}

export interface GuardResult {
  requirements: Requirement[];
  dropped: GuardDrop[];
  priorityOverrides: PriorityOverride[];
}

export interface GuardOptions {
  maxRequirements?: number;
  /** Defaults to a fresh r1..rn sequence. Pass a kit allocator when regenerating. */
  allocateId?: () => string;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'you',
  'your',
  'our',
  'are',
  'have',
  'has',
  'will',
  'that',
  'this',
  'from',
  'into',
  'able',
  'must',
  'should',
  'would',
  'can',
  'not',
  'work',
  'working',
  'role',
  'team',
  'teams',
  'strong',
  'good',
  'great',
  'years',
  'year',
  'experience',
  'experienced',
  'using',
  'use',
  'used',
  'well',
  'plus',
]);

const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /\bequal opportunit/i,
  /\bdiscriminat/i,
  /\bannual leave\b/i,
  /\bbank holidays?\b/i,
  /\bpension\b/i,
  /\b(medical|dental|health) insurance\b/i,
  /\blife assurance\b/i,
  /\bcycle to work\b/i,
  /\bseason ticket\b/i,
  /\bparental leave\b/i,
  /\bemployee assistance\b/i,
  /\blearning (and development )?budget\b/i,
  /\bfree snacks\b/i,
  /\b(company )?offsite\b/i,
  /\bteam socials\b/i,
  /\bvisa sponsorship\b/i,
  /\bright to work\b/i,
  /\brecruitment agenc/i,
  /\bunsolicited cvs?\b/i,
  /\bcompetitive salary\b/i,
  /\bsalary\b/i,
  /\bholiday\b/i,
];

/** Sections whose content is never a job requirement. */
const BOILERPLATE_SECTIONS: ReadonlySet<SectionKind> = new Set<SectionKind>([
  'benefits',
  'eeo',
]);

function contentTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function overlapWithJd(candidate: ReadonlySet<string>, jd: ReadonlySet<string>): number {
  if (candidate.size === 0) return 0;
  let shared = 0;
  for (const token of candidate) if (jd.has(token)) shared += 1;
  return shared / candidate.size;
}

/**
 * Lowercase, whitespace-collapsed copy plus an index map back into the source,
 * so a quote can be matched loosely while still yielding a real offset for
 * section lookup.
 */
function compactWithMap(text: string): { compact: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    const isSpace = char === ' ' || char === '\n' || char === '\t' || char === '\r';
    if (isSpace) {
      if (lastWasSpace || chars.length === 0) continue;
      chars.push(' ');
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    chars.push(char.toLowerCase());
    map.push(i);
    lastWasSpace = false;
  }
  return { compact: chars.join(''), map };
}

function compact(text: string): string {
  return compactWithMap(text).compact;
}

function coerceKind(kind: string): RequirementKind {
  const lowered = kind.trim().toLowerCase();
  const match = REQUIREMENT_KINDS.find((k) => k === lowered);
  return match ?? 'technical';
}

function coercePriority(priority: string): RequirementPriority {
  const lowered = priority.trim().toLowerCase();
  const match = REQUIREMENT_PRIORITIES.find((p) => p === lowered);
  // Unrecognised priority defaults to the conservative option; a section
  // override can still promote it to must.
  return match ?? 'nice';
}

interface Surviving {
  candidate: RequirementCandidate;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  tokens: Set<string>;
  /** Offset of the evidence quote in the normalised JD - the document order. */
  evidenceIndex: number;
  order: number;
}

export function applyGuards(
  candidates: readonly RequirementCandidate[],
  normalizedText: string,
  sections: readonly Section[],
  options: GuardOptions = {},
): GuardResult {
  const maxRequirements = options.maxRequirements ?? MAX_REQUIREMENTS;
  const dropped: GuardDrop[] = [];
  const priorityOverrides: PriorityOverride[] = [];
  const drop = (
    candidate: RequirementCandidate,
    reason: GuardDropReason,
    detail: string,
  ) => dropped.push({ candidate, reason, detail });

  const { compact: haystack, map } = compactWithMap(normalizedText);
  const jdTokens = contentTokens(normalizedText);

  const survivors: Surviving[] = [];

  candidates.forEach((candidate, order) => {
    const text = candidate.text.trim();
    if (text === '') {
      drop(candidate, 'empty_text', 'requirement text was empty');
      return;
    }

    // (a) The evidence must actually appear in the job description.
    const needle = compact(candidate.evidence_quote);
    if (needle === '') {
      drop(candidate, 'evidence_not_found', 'evidence_quote was empty');
      return;
    }
    const compactIndex = haystack.indexOf(needle);
    if (compactIndex === -1) {
      drop(
        candidate,
        'evidence_not_found',
        `evidence_quote does not appear in the job description: "${candidate.evidence_quote.slice(0, 80)}"`,
      );
      return;
    }
    const evidenceIndex = map[compactIndex] ?? 0;

    // (b) The requirement's own wording must be grounded in the JD too.
    const tokens = contentTokens(text);
    const overlap = overlapWithJd(tokens, jdTokens);
    if (overlap < MIN_TOKEN_OVERLAP) {
      drop(
        candidate,
        'low_overlap',
        `only ${Math.round(overlap * 100)}% of content tokens appear in the job description`,
      );
      return;
    }

    // (f) Benefits, EEO and agency boilerplate are never requirements.
    const section = sectionAtIndex(sections, evidenceIndex);
    const sectionKind: SectionKind = section?.kind ?? 'other';
    if (BOILERPLATE_SECTIONS.has(sectionKind)) {
      drop(candidate, 'boilerplate', `evidence sits in a "${sectionKind}" section`);
      return;
    }
    const boilerplateHit = BOILERPLATE_PATTERNS.find((pattern) => pattern.test(text));
    if (boilerplateHit !== undefined) {
      drop(
        candidate,
        'boilerplate',
        `matched boilerplate pattern ${String(boilerplateHit)}`,
      );
      return;
    }

    // (e) Coerce enums, then (c) let the source section have the final say.
    const kind = coerceKind(candidate.kind);
    let priority = coercePriority(candidate.priority);
    if (sectionKind === 'nice-to-have' && priority !== 'nice') {
      priorityOverrides.push({
        text,
        from: candidate.priority,
        to: 'nice',
        section: sectionKind,
      });
      priority = 'nice';
    } else if (sectionKind === 'requirements' && priority !== 'must') {
      priorityOverrides.push({
        text,
        from: candidate.priority,
        to: 'must',
        section: sectionKind,
      });
      priority = 'must';
    }

    survivors.push({ candidate, text, kind, priority, tokens, evidenceIndex, order });
  });

  // (d) Merge near-identical requirements, keeping the earliest occurrence.
  const deduped: Surviving[] = [];
  for (const survivor of survivors) {
    const twin = deduped.find(
      (kept) =>
        compact(kept.text) === compact(survivor.text) ||
        jaccard(kept.tokens, survivor.tokens) >= DUPLICATE_JACCARD,
    );
    if (twin === undefined) {
      deduped.push(survivor);
      continue;
    }
    // A merged pair keeps the stronger priority: must always wins.
    if (survivor.priority === 'must' && twin.priority === 'nice') twin.priority = 'must';
    drop(survivor.candidate, 'duplicate', `merged into "${twin.text.slice(0, 60)}"`);
  }

  // (g) Cap, keeping must-haves ahead of nice-to-haves.
  let kept = deduped;
  if (deduped.length > maxRequirements) {
    const byPriority = [...deduped].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'must' ? -1 : 1;
      return a.order - b.order;
    });
    kept = byPriority.slice(0, maxRequirements);
    for (const overflow of byPriority.slice(maxRequirements)) {
      drop(
        overflow.candidate,
        'cap_exceeded',
        `exceeded the maximum of ${maxRequirements} requirements`,
      );
    }
  }

  // (h) Ids are assigned last, in document order.
  let counter = 0;
  const allocateId = options.allocateId ?? (() => `r${(counter += 1)}`);
  const requirements = [...kept]
    .sort((a, b) => a.evidenceIndex - b.evidenceIndex || a.order - b.order)
    .map((survivor) => ({
      id: allocateId(),
      text: survivor.text,
      kind: survivor.kind,
      priority: survivor.priority,
    }));

  return { requirements, dropped, priorityOverrides };
}
