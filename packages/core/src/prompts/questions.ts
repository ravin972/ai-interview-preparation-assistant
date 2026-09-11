/**
 * Prompt and schema for Stage 11: Question generation (pass 1).
 */
import { z } from 'zod';
import type { Requirement } from '../schema/kit.js';
import { UNTRUSTED_OPEN, UNTRUSTED_CLOSE } from '../retrieval/sanitize.js';

export const GENERATE_QUESTIONS_TASK = 'generate-questions';

export const questionCandidateSchema = z.object({
  requirement_ids: z.array(z.string()),
  category: z.string(),
  prompt: z.string().min(1),
  answer_outline: z.string().default(''),
  difficulty: z.number().int().min(1).max(3),
});

export const questionsResponseSchema = z.object({
  questions: z.array(questionCandidateSchema),
});

export type QuestionsResponse = z.infer<typeof questionsResponseSchema>;

export const GENERATE_QUESTIONS_SYSTEM = [
  'You are an expert technical interviewer and interview preparation coach.',
  'Generate a set of high-yield interview questions tailored to the given role requirements and company context.',
  '',
  'Rules:',
  '1. Each question must have:',
  '   - "requirement_ids": an array of existing requirement IDs (e.g. ["r1", "r2"]) that the question directly tests.',
  '   - "category": one of "technical", "behavioural", "system-design", "company-fit".',
  '   - "prompt": the actual interview question text.',
  '   - "answer_outline": a bullet-pointed or concise outline of what a strong answer should cover.',
  '   - "difficulty": integer from 1 (fundamental/warmup) to 3 (complex/advanced).',
  '2. Categorization rules:',
  '   - "technical", "behavioural", and "system-design" questions MUST reference at least one requirement id.',
  '   - "company-fit" questions may have an empty requirement_ids array if based on company context.',
  '3. Prioritise covering all must-have requirements.',
  '4. Respond with ONLY a valid JSON object matching: {"questions": [...]}',
].join('\n');

export function buildGenerateQuestionsUser(params: {
  roleTitle?: string;
  requirements: readonly Requirement[];
  brief?: { summary: string; what_they_do: string };
  hiringContext?: string;
  snippets?: readonly { title: string; snippet: string }[];
}): string {
  const parts: string[] = [];

  if (params.roleTitle) {
    parts.push(`Target Role: ${params.roleTitle}`);
  }

  if (params.brief) {
    parts.push(
      'Company Context:',
      `Summary: ${params.brief.summary}`,
      `What they do: ${params.brief.what_they_do}`,
      '',
    );
  }

  parts.push(
    'Requirements to test:',
    ...params.requirements.map((r) => `[${r.id}] (${r.priority}, ${r.kind}) ${r.text}`),
    '',
  );

  if (params.hiringContext) {
    parts.push(
      'Hiring and Interview Process Context:',
      UNTRUSTED_OPEN,
      params.hiringContext.slice(0, 4000),
      UNTRUSTED_CLOSE,
      '',
    );
  }

  if (params.snippets && params.snippets.length > 0) {
    parts.push(
      'Public Discussion Snippets (untrusted external data):',
      UNTRUSTED_OPEN,
      ...params.snippets.map((s) => `- ${s.title}: ${s.snippet}`),
      UNTRUSTED_CLOSE,
      '',
    );
  }

  parts.push('Generate comprehensive interview questions covering these requirements.');
  return parts.join('\n');
}
