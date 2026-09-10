/**
 * 16-stage pipeline definitions (docs/PIPELINE.md section 1).
 *
 * Ordered stages with explicit kinds, inputs, outputs, and degradation paths.
 */

export type StageKind = 'det' | 'llm' | 'net' | 'io';

export interface StageDefinition {
  number: number;
  id: string;
  name: string;
  kind: StageKind;
  critical: boolean;
  degradable: boolean;
  checkpointKey?: string;
  supportsResume?: boolean;
}

export const PIPELINE_STAGES: readonly StageDefinition[] = [
  {
    number: 1,
    id: 'normalize-jd',
    name: 'Normalize and segment job description',
    kind: 'det',
    critical: true,
    degradable: false,
  },
  {
    number: 2,
    id: 'extract-requirements',
    name: 'Extract atomic evidence-backed requirements',
    kind: 'llm',
    critical: true,
    degradable: false,
    checkpointKey: 'requirements',
    supportsResume: true,
  },
  {
    number: 3,
    id: 'validate-url',
    name: 'Validate company URL with SSRF destination check',
    kind: 'det',
    critical: false,
    degradable: true,
  },
  {
    number: 4,
    id: 'fetch-homepage',
    name: 'Fetch company homepage (hard gate)',
    kind: 'net',
    critical: false,
    degradable: true,
  },
  {
    number: 5,
    id: 'crawl-links',
    name: 'Discover candidate links from homepage',
    kind: 'det',
    critical: false,
    degradable: true,
  },
  {
    number: 6,
    id: 'rank-links',
    name: 'Deterministically rank discovered links',
    kind: 'det',
    critical: false,
    degradable: false,
    checkpointKey: 'rankedLinks',
    supportsResume: true,
  },
  {
    number: 7,
    id: 'identify-pages',
    name: 'Identify about, careers, and hiring pages',
    kind: 'det',
    critical: false,
    degradable: false,
  },
  {
    number: 8,
    id: 'fetch-pages',
    name: 'Fetch selected research pages within crawl budget',
    kind: 'net',
    critical: false,
    degradable: true,
    checkpointKey: 'pages',
    supportsResume: true,
  },
  {
    number: 9,
    id: 'search-public',
    name: 'Search public interview discussions',
    kind: 'net',
    critical: false,
    degradable: true,
  },
  {
    number: 10,
    id: 'company-brief',
    name: 'Generate company brief',
    kind: 'llm',
    critical: false,
    degradable: true,
  },
  {
    number: 11,
    id: 'generate-questions',
    name: 'Generate interview questions (pass 1)',
    kind: 'llm',
    critical: true,
    degradable: false,
    checkpointKey: 'questions',
    supportsResume: true,
  },
  {
    number: 12,
    id: 'generate-flashcards',
    name: 'Generate flashcards for active recall practice',
    kind: 'llm',
    critical: false,
    degradable: true,
    checkpointKey: 'flashcards',
    supportsResume: true,
  },
  {
    number: 13,
    id: 'check-coverage',
    name: 'Run deterministic requirement coverage check',
    kind: 'det',
    critical: false,
    degradable: false,
  },
  {
    number: 14,
    id: 'missing-questions',
    name: 'Generate targeted questions for uncovered must-haves',
    kind: 'llm',
    critical: false,
    degradable: true,
  },
  {
    number: 15,
    id: 'build-schedule',
    name: 'Coverage recheck and deterministic schedule build',
    kind: 'det',
    critical: true,
    degradable: false,
  },
  {
    number: 16,
    id: 'validate-kit',
    name: 'Final invariant validation and canonical projection',
    kind: 'det',
    critical: true,
    degradable: false,
  },
];

export function getStageDefinition(stageNumber: number): StageDefinition | undefined {
  return PIPELINE_STAGES.find((s) => s.number === stageNumber);
}
