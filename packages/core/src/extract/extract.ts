/**
 * Requirement extraction, end to end (docs/PIPELINE.md section 4).
 *
 *   JD -> normalize -> segment -> LLM candidates -> deterministic guards
 *      -> stable ids -> validated requirements
 *
 * The model contributes semantics only. Evidence verification, priority,
 * deduplication, boilerplate removal, the cap and every identifier are decided
 * by application code.
 */
import { z } from 'zod';
import { InvalidJobDescriptionError } from '../errors.js';
import { generateStructured } from '../llm/router.js';
import type { LlmAdapter, LlmAttempt, LlmProviderName } from '../llm/types.js';
import {
  EXTRACT_REQUIREMENTS_JSON_SCHEMA,
  EXTRACT_REQUIREMENTS_SYSTEM,
  buildExtractRequirementsUser,
} from '../prompts/extract.js';
import type { Requirement } from '../schema/kit.js';
import {
  applyGuards,
  type GuardDrop,
  type PriorityOverride,
  type RequirementCandidate,
} from './guards.js';
import { isThinJd, normalizeJd, type NormalizedJd } from './normalize.js';
import { detectSections, type Section } from './sections.js';

export const EXTRACT_TASK = 'extract-requirements';

/**
 * kind and priority are plain strings here on purpose. A strict enum would let
 * one bad value invalidate an entire batch of otherwise usable candidates; the
 * guards coerce instead, and the section override has the final say anyway.
 */
export const requirementCandidateSchema = z.object({
  text: z.string().min(1),
  kind: z.string(),
  priority: z.string(),
  evidence_quote: z.string().min(1),
});

export const extractionResponseSchema = z.object({
  requirements: z.array(requirementCandidateSchema),
});

export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;

export interface ExtractRequirementsOptions {
  jd: string;
  adapters: readonly LlmAdapter[];
  maxRequirements?: number;
  allocateId?: () => string;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export interface ExtractRequirementsResult {
  requirements: Requirement[];
  /** Character count of the ORIGINAL job description - becomes source.jd_chars. */
  jdChars: number;
  normalized: NormalizedJd;
  sections: Section[];
  candidates: RequirementCandidate[];
  dropped: GuardDrop[];
  priorityOverrides: PriorityOverride[];
  /** Honest record of what could not be established, e.g. thin_jd. */
  gaps: string[];
  thin: boolean;
  llm: {
    provider: LlmProviderName;
    repaired: boolean;
    attempts: readonly LlmAttempt[];
  };
}

export async function extractRequirements(
  options: ExtractRequirementsOptions,
): Promise<ExtractRequirementsResult> {
  if (typeof options.jd !== 'string' || options.jd.trim() === '') {
    throw new InvalidJobDescriptionError('text was empty', options.jd);
  }

  const normalized = normalizeJd(options.jd);
  const sections = detectSections(normalized.text);

  const generated = await generateStructured({
    task: EXTRACT_TASK,
    system: EXTRACT_REQUIREMENTS_SYSTEM,
    user: buildExtractRequirementsUser(normalized.text),
    schema: extractionResponseSchema,
    jsonSchema: EXTRACT_REQUIREMENTS_JSON_SCHEMA,
    adapters: options.adapters,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
  });

  const candidates = generated.value.requirements;
  const guarded = applyGuards(candidates, normalized.text, sections, {
    ...(options.maxRequirements !== undefined
      ? { maxRequirements: options.maxRequirements }
      : {}),
    ...(options.allocateId !== undefined ? { allocateId: options.allocateId } : {}),
  });

  const gaps: string[] = [];
  const thin = isThinJd(normalized, guarded.requirements.length);
  // A thin job description yields a thin kit. Nothing is topped up from
  // general knowledge - the gap is recorded instead (docs/DECISIONS.md D-012).
  if (thin) gaps.push('thin_jd');
  if (normalized.truncated) gaps.push('jd_truncated');

  return {
    requirements: guarded.requirements,
    jdChars: normalized.originalChars,
    normalized,
    sections,
    candidates,
    dropped: guarded.dropped,
    priorityOverrides: guarded.priorityOverrides,
    gaps,
    thin,
    llm: {
      provider: generated.provider,
      repaired: generated.repaired,
      attempts: generated.attempts,
    },
  };
}
