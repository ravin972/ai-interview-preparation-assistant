/**
 * Deterministic coverage (docs/PIPELINE.md section 5).
 *
 * A requirement is covered when at least one question references its id. This
 * is a set difference computed in application code - the model is never asked
 * whether coverage exists.
 */
import type { Question, Requirement } from '../schema/kit.js';

export interface CoverageReport {
  /** Ids of every requirement referenced by at least one question. */
  covered: string[];
  /** must-have requirements with no question. These block a final kit. */
  uncoveredMust: string[];
  /** nice-to-have gaps. These are reported honestly, not closed. */
  uncoveredNice: string[];
}

export interface ReferencesRequirements {
  requirement_ids: string[];
}

/**
 * Drop references to requirements that do not exist. A model hallucinating
 * "r99" must not be able to distort the coverage arithmetic, so references are
 * filtered before anything is counted.
 */
export function stripUnknownRequirementIds<T extends ReferencesRequirements>(
  items: readonly T[],
  requirements: readonly Requirement[],
): T[] {
  const known = new Set(requirements.map((r) => r.id));
  return items.map((item) => {
    const kept = item.requirement_ids.filter((id) => known.has(id));
    if (kept.length === item.requirement_ids.length) return { ...item };
    return { ...item, requirement_ids: kept };
  });
}

export function isCovered(
  requirementId: string,
  questions: readonly Question[],
): boolean {
  return questions.some((q) => q.requirement_ids.includes(requirementId));
}

/**
 * Coverage over the requirement list, in requirement document order so the
 * output is stable across runs.
 */
export function computeCoverage(
  requirements: readonly Requirement[],
  questions: readonly Question[],
): CoverageReport {
  const referenced = new Set<string>();
  for (const question of questions) {
    for (const id of question.requirement_ids) referenced.add(id);
  }

  const covered: string[] = [];
  const uncoveredMust: string[] = [];
  const uncoveredNice: string[] = [];

  for (const requirement of requirements) {
    if (referenced.has(requirement.id)) {
      covered.push(requirement.id);
    } else if (requirement.priority === 'must') {
      uncoveredMust.push(requirement.id);
    } else {
      uncoveredNice.push(requirement.id);
    }
  }

  return { covered, uncoveredMust, uncoveredNice };
}
