/**
 * The kit schema - Appendix A, exactly.
 *
 * Every object is strict, so an unknown key is a validation failure rather
 * than something that silently rides along into the exported kit. That is what
 * stops builder metadata (origin, edited, pinned, fingerprints) leaking into a
 * graded artefact - see docs/DECISIONS.md D-008.
 */
import { z } from 'zod';

import { MAX_DAYS, MIN_DAYS } from '../constants.js';

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'] as const;
export const REQUIREMENT_PRIORITIES = ['must', 'nice'] as const;
export const QUESTION_CATEGORIES = [
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
] as const;

/**
 * Categories that must cite at least one requirement. company-fit is the sole
 * exception: those questions come from the company brief, not the job
 * description, so forcing a citation would mean inventing a requirement
 * (docs/DECISIONS.md D-022, forbidden by D-012).
 */
export const CATEGORIES_REQUIRING_REQUIREMENT = QUESTION_CATEGORIES.filter(
  (c) => c !== 'company-fit',
);

const requirementId = z.string().regex(/^r[1-9][0-9]*$/, 'must look like r1, r2, ...');
const questionId = z.string().regex(/^q[1-9][0-9]*$/, 'must look like q1, q2, ...');
const flashcardId = z.string().regex(/^f[1-9][0-9]*$/, 'must look like f1, f2, ...');

export const requirementSchema = z.strictObject({
  id: requirementId,
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(REQUIREMENT_PRIORITIES),
});

export const questionSchema = z
  .strictObject({
    id: questionId,
    requirement_ids: z.array(requirementId),
    category: z.enum(QUESTION_CATEGORIES),
    prompt: z.string().min(1),
    answer_outline: z.string(),
    difficulty: z.int().min(1).max(3),
  })
  .superRefine((question, ctx) => {
    if (question.category === 'company-fit') return;
    if (question.requirement_ids.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['requirement_ids'],
        message: `a ${question.category} question must reference at least one requirement; only company-fit questions may reference none`,
      });
    }
  });

export const flashcardSchema = z.strictObject({
  id: flashcardId,
  front: z.string().min(1),
  back: z.string(),
  requirement_ids: z.array(requirementId),
});

export const scheduleDaySchema = z.strictObject({
  day: z.int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(questionId),
  minutes: z.int(),
});

export const scheduleSchema = z.strictObject({
  days_available: z.int().min(MIN_DAYS).max(MAX_DAYS),
  days: z.array(scheduleDaySchema),
});

export const coverageSchema = z.strictObject({
  uncovered_requirement_ids: z.array(requirementId),
  passes: z.int().min(1),
});

export const sourceSchema = z.strictObject({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.int().min(0),
  researched_at: z.iso.datetime({ offset: true }),
  pages_used: z.array(z.string()),
});

export const companyBriefSchema = z.strictObject({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

export const roleSchema = z.strictObject({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

export const kitSchema = z.strictObject({
  source: sourceSchema,
  company_brief: companyBriefSchema,
  role: roleSchema,
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: scheduleSchema,
  coverage: coverageSchema,
});

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type KitSource = z.infer<typeof sourceSchema>;
export type CompanyBrief = z.infer<typeof companyBriefSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Kit = z.infer<typeof kitSchema>;

/** A question before an id has been issued. Generators never invent ids. */
export type QuestionDraft = Omit<Question, 'id'>;
export type FlashcardDraft = Omit<Flashcard, 'id'>;
