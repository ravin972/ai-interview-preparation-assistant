/**
 * Prompt and schema for Stage 12: Flashcard generation.
 */
import { z } from 'zod';
import type { Question, Requirement } from '../schema/kit.js';

export const GENERATE_FLASHCARDS_TASK = 'generate-flashcards';

export const flashcardCandidateSchema = z.object({
  front: z.string().min(1),
  back: z.string().default(''),
  requirement_ids: z.array(z.string()),
});

export const flashcardsResponseSchema = z.object({
  flashcards: z.array(flashcardCandidateSchema),
});

export type FlashcardsResponse = z.infer<typeof flashcardsResponseSchema>;

export const GENERATE_FLASHCARDS_SYSTEM = [
  'You are an expert interview coach specialized in active recall and spaced repetition.',
  'Generate a set of high-impact flashcards based on the role requirements and interview questions.',
  '',
  'Rules:',
  '1. Each flashcard must have:',
  '   - "front": a clear question, concept, or scenario testing quick recall or mental model.',
  '   - "back": a concise, accurate bullet-pointed or 2-3 sentence answer/explanation.',
  '   - "requirement_ids": an array of existing requirement IDs (e.g. ["r1"]) that this card relates to.',
  '2. Respond with ONLY a valid JSON object matching: {"flashcards": [...]}',
].join('\n');

export function buildGenerateFlashcardsUser(params: {
  requirements: readonly Requirement[];
  questions: readonly Question[];
}): string {
  const parts: string[] = [
    'Requirements:',
    ...params.requirements.map((r) => `[${r.id}] (${r.priority}, ${r.kind}) ${r.text}`),
    '',
    'Sample Questions Prepared:',
    ...params.questions.slice(0, 10).map((q) => `[${q.id}] (${q.category}) ${q.prompt}`),
    '',
    'Generate flashcards to help the candidate practice and drill these concepts efficiently.',
  ];
  return parts.join('\n');
}
