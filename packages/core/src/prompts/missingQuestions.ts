/**
 * Prompt and schema for Stage 14: Targeted question generation for uncovered requirements.
 */
import type { Requirement } from '../schema/kit.js';
import {
  GENERATE_QUESTIONS_SYSTEM,
  questionCandidateSchema,
  questionsResponseSchema,
  type QuestionsResponse,
} from './questions.js';

export const GENERATE_MISSING_QUESTIONS_TASK = 'generate-missing-questions';

export { questionCandidateSchema, questionsResponseSchema, type QuestionsResponse };

export const GENERATE_MISSING_QUESTIONS_SYSTEM = GENERATE_QUESTIONS_SYSTEM;

export function buildMissingQuestionsUser(params: {
  uncoveredRequirements: readonly Requirement[];
  passNumber: number;
}): string {
  return [
    `Coverage Pass ${params.passNumber}: The following MUST-HAVE requirements currently lack interview questions:`,
    '',
    ...params.uncoveredRequirements.map(
      (r) => `[${r.id}] (${r.priority}, ${r.kind}) ${r.text}`,
    ),
    '',
    'Generate targeted interview questions specifically designed to test these uncovered requirements.',
    'Every question generated MUST reference at least one of the above requirement IDs in its requirement_ids array.',
  ].join('\n');
}
