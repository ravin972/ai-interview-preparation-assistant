/**
 * The coverage loop (docs/PIPELINE.md section 5).
 *
 * Control flow is deterministic and lives here; only the generation of new
 * questions is injected, so this module is fully testable without a model.
 *
 *   pass 1  the questions handed in (generated upstream, stage 11)
 *   pass 2  generate for uncovered must-haves only (stage 14)
 *   pass 3  permitted only if pass 2 strictly reduced the uncovered set
 *
 * Stops on: all covered | max passes | no progress | deadline.
 * Anything still uncovered afterwards receives a deterministic template
 * question, so a final kit never knowingly leaves a must-have uncovered.
 */
import { MAX_COVERAGE_PASSES } from '../constants.js';
import type { Question, QuestionDraft, Requirement } from '../schema/kit.js';
import { computeCoverage, stripUnknownRequirementIds } from './coverage.js';
import { templateQuestion } from './fallback.js';

export type CoverageStopReason =
  | 'all-covered'
  | 'max-passes'
  | 'no-progress'
  | 'deadline';

export type GenerateForUncovered = (
  uncovered: readonly Requirement[],
  pass: number,
) => QuestionDraft[] | Promise<QuestionDraft[]>;

export interface CoverageLoopOptions {
  requirements: readonly Requirement[];
  /** Pass-1 questions. Already carry ids. */
  questions: readonly Question[];
  generate: GenerateForUncovered;
  /** Issues ids for accepted drafts. Generators never invent ids. */
  allocateQuestionId: () => string;
  maxPasses?: number;
  /** Return true once the pipeline budget is spent. */
  isDeadlineReached?: () => boolean;
}

export interface CoveragePassRecord {
  pass: number;
  uncoveredBefore: string[];
  uncoveredAfter: string[];
  added: number;
}

export interface CoverageLoopResult {
  questions: Question[];
  /** Generation passes actually executed. The fallback is not a pass. */
  passes: number;
  /** Remaining gaps. Only nice-to-haves can appear here. */
  uncovered_requirement_ids: string[];
  /** Ids of questions produced by the deterministic fallback. */
  fallbackQuestionIds: string[];
  stopReason: CoverageStopReason;
  history: CoveragePassRecord[];
}

/** The must-have requirements a second pass should target, in kit order. */
export function planSecondPass(
  requirements: readonly Requirement[],
  questions: readonly Question[],
): Requirement[] {
  const { uncoveredMust } = computeCoverage(requirements, questions);
  const uncovered = new Set(uncoveredMust);
  return requirements.filter((r) => uncovered.has(r.id));
}

/**
 * Accept drafts that can actually help: references are filtered to known
 * requirements first, and a draft left citing nothing is dropped unless it is
 * a company-fit question, which is allowed to cite nothing (D-022).
 */
function acceptDrafts(
  drafts: readonly QuestionDraft[],
  requirements: readonly Requirement[],
  allocateQuestionId: () => string,
): Question[] {
  const stripped = stripUnknownRequirementIds(drafts, requirements);
  const accepted: Question[] = [];
  for (const draft of stripped) {
    if (draft.requirement_ids.length === 0 && draft.category !== 'company-fit') continue;
    accepted.push({ id: allocateQuestionId(), ...draft });
  }
  return accepted;
}

export async function runCoverageLoop(
  options: CoverageLoopOptions,
): Promise<CoverageLoopResult> {
  const {
    requirements,
    generate,
    allocateQuestionId,
    maxPasses = MAX_COVERAGE_PASSES,
    isDeadlineReached,
  } = options;

  const history: CoveragePassRecord[] = [];
  let questions = stripUnknownRequirementIds(options.questions, requirements);
  let passes = 1;
  let uncovered = computeCoverage(requirements, questions).uncoveredMust;
  let stopReason: CoverageStopReason = uncovered.length === 0 ? 'all-covered' : 'max-passes';

  while (uncovered.length > 0 && passes < maxPasses) {
    if (isDeadlineReached?.() === true) {
      stopReason = 'deadline';
      break;
    }

    const targets = requirements.filter((r) => uncovered.includes(r.id));
    const drafts = await generate(targets, passes + 1);
    const accepted = acceptDrafts(drafts, requirements, allocateQuestionId);

    passes += 1;
    questions = [...questions, ...accepted];
    const next = computeCoverage(requirements, questions).uncoveredMust;

    history.push({
      pass: passes,
      uncoveredBefore: [...uncovered],
      uncoveredAfter: [...next],
      added: accepted.length,
    });

    const madeProgress = next.length < uncovered.length;
    uncovered = next;

    if (uncovered.length === 0) {
      stopReason = 'all-covered';
      break;
    }
    if (!madeProgress) {
      stopReason = 'no-progress';
      break;
    }
    stopReason = 'max-passes';
  }

  // Deterministic backstop. Never skipped, whatever the stop reason was.
  const fallbackQuestionIds: string[] = [];
  if (uncovered.length > 0) {
    const stillUncovered = new Set(uncovered);
    for (const requirement of requirements) {
      if (!stillUncovered.has(requirement.id)) continue;
      const question = templateQuestion(requirement, allocateQuestionId());
      questions = [...questions, question];
      fallbackQuestionIds.push(question.id);
    }
  }

  const finalCoverage = computeCoverage(requirements, questions);
  return {
    questions,
    passes,
    uncovered_requirement_ids: finalCoverage.uncoveredNice,
    fallbackQuestionIds,
    stopReason,
    history,
  };
}
