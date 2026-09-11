/**
 * Deterministic template question (docs/DECISIONS.md D-010).
 *
 * Used only when a must-have requirement survives the coverage loop uncovered,
 * for example because the provider failed during the second pass. The text is
 * derived ONLY from the requirement's own wording - no company facts, no job
 * description, nothing invented.
 */
import type { Question, QuestionCategory, QuestionDraft, Requirement } from '../schema/kit.js';

/** Trailing sentence punctuation reads badly mid-prompt; nothing else changes. */
function subjectOf(requirement: Requirement): string {
  return requirement.text.trim().replace(/[.;:,]+$/, '');
}

function categoryFor(requirement: Requirement): QuestionCategory {
  // Domain expertise is assessed the same way technical depth is; only
  // behavioural requirements map to the behavioural category.
  return requirement.kind === 'behavioural' ? 'behavioural' : 'technical';
}

export function templateQuestionDraft(requirement: Requirement): QuestionDraft {
  const subject = subjectOf(requirement);
  return {
    requirement_ids: [requirement.id],
    category: categoryFor(requirement),
    prompt: `Walk me through your hands-on experience with ${subject}. Give a specific example and be concrete about what you personally did.`,
    answer_outline: `Cover, in order: the situation where ${subject} applied; the actions you took yourself; the outcome and how you measured it; and what you would do differently now.`,
    difficulty: requirement.priority === 'must' ? 2 : 1,
  };
}

export function templateQuestion(requirement: Requirement, id: string): Question {
  return { id, ...templateQuestionDraft(requirement) };
}
