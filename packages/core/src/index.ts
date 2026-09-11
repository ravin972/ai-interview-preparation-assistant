/**
 * @kit/core - framework-independent domain logic.
 *
 * Nothing here imports Express, MongoDB, Next.js or any HTTP framework, and
 * nothing here performs persistence (docs/DECISIONS.md D-002). This is the
 * single entry point shared by apps/api and tools/evaluate.
 */

export {
  CATEGORY_LABEL,
  CATEGORY_PRECEDENCE,
  CATEGORY_WEIGHT,
  DAY_MAX_MINUTES,
  DAY_MIN_MINUTES,
  MAX_COVERAGE_PASSES,
  MAX_DAYS,
  MIN_DAYS,
  REVIEW_WINDOW,
  minutesForDifficulty,
} from './constants.js';

export {
  InvalidDaysError,
  KitValidationError,
  ScheduleInvariantError,
  type KitIssue,
} from './errors.js';

export {
  ID_PATTERN,
  ID_PREFIXES,
  IdAllocator,
  parseId,
  type IdCounters,
  type IdPrefix,
} from './ids/allocator.js';

export {
  CATEGORIES_REQUIRING_REQUIREMENT,
  QUESTION_CATEGORIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  coverageSchema,
  flashcardSchema,
  kitSchema,
  questionSchema,
  requirementSchema,
  roleSchema,
  scheduleDaySchema,
  scheduleSchema,
  sourceSchema,
  type CompanyBrief,
  type Coverage,
  type Flashcard,
  type FlashcardDraft,
  type Kit,
  type KitSource,
  type Question,
  type QuestionCategory,
  type QuestionDraft,
  type Requirement,
  type RequirementKind,
  type RequirementPriority,
  type Role,
  type Schedule,
  type ScheduleDay,
} from './schema/kit.js';

export {
  CANONICAL_KEYS,
  CANONICAL_KIT_KEYS,
  canonicalFlashcard,
  canonicalKit,
  canonicalQuestion,
} from './schema/canonical.js';

export {
  assertValidKit,
  checkKitInvariants,
  validateKit,
  type ValidateOptions,
  type ValidationResult,
} from './schema/invariants.js';

export {
  computeCoverage,
  isCovered,
  stripUnknownRequirementIds,
  type CoverageReport,
} from './coverage/coverage.js';

export { templateQuestion, templateQuestionDraft } from './coverage/fallback.js';

export {
  planSecondPass,
  runCoverageLoop,
  type CoverageLoopOptions,
  type CoverageLoopResult,
  type CoveragePassRecord,
  type CoverageStopReason,
  type GenerateForUncovered,
} from './coverage/secondPass.js';

export {
  buildSchedule,
  orderQuestions,
  scoreQuestion,
  validateDays,
  type BuildScheduleInput,
} from './schedule/schedule.js';

// --- LLM layer ---------------------------------------------------------------

export {
  LlmPermanentError,
  LlmStructuredError,
  LlmTransientError,
  classifyHttpFailure,
  classifyThrownFailure,
  type LlmAdapter,
  type LlmAttempt,
  type LlmAttemptOutcome,
  type LlmCompletionRequest,
  type LlmProviderName,
  type LlmTransientKind,
} from './llm/types.js';

export { extractJson, type JsonExtraction } from './llm/json.js';

export {
  MockLlmAdapter,
  createMockAdapter,
  defaultTaskResponder,
  step,
  type MockAdapterOptions,
  type MockStep,
} from './llm/mock.js';

export {
  DEFAULT_BACKOFF_MS,
  MAX_ATTEMPTS_PER_ADAPTER,
  generateStructured,
  type GenerateStructuredOptions,
  type GenerateStructuredResult,
} from './llm/router.js';

export {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  createGeminiAdapter,
  geminiOptionsFromEnv,
  type GeminiAdapterOptions,
} from './llm/gemini.js';

export {
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  createGroqAdapter,
  groqOptionsFromEnv,
  type GroqAdapterOptions,
} from './llm/groq.js';

// --- Requirement extraction --------------------------------------------------

export { InvalidJobDescriptionError } from './errors.js';

export {
  JD_MAX_CHARS,
  THIN_JD_CHARS,
  isThinJd,
  matchable,
  normalizeJd,
  type NormalizedJd,
} from './extract/normalize.js';

export {
  classifyHeading,
  detectSections,
  sectionAtIndex,
  type Section,
  type SectionKind,
} from './extract/sections.js';

export {
  DUPLICATE_JACCARD,
  MAX_REQUIREMENTS,
  MIN_TOKEN_OVERLAP,
  applyGuards,
  type GuardDrop,
  type GuardDropReason,
  type GuardOptions,
  type GuardResult,
  type PriorityOverride,
  type RequirementCandidate,
} from './extract/guards.js';

export {
  EXTRACT_TASK,
  extractRequirements,
  extractionResponseSchema,
  requirementCandidateSchema,
  type ExtractRequirementsOptions,
  type ExtractRequirementsResult,
  type ExtractionResponse,
} from './extract/extract.js';

export {
  EXTRACT_REQUIREMENTS_JSON_SCHEMA,
  EXTRACT_REQUIREMENTS_SYSTEM,
  buildExtractRequirementsUser,
} from './prompts/extract.js';

// --- Retrieval ---------------------------------------------------------------

export {
  BLOCKED_IPV4_CIDRS,
  BLOCKED_IPV6_CIDRS,
  inIpv4Cidr,
  inIpv6Cidr,
  ipv4ToInt,
  ipv6ToBytes,
  unwrapIpv4Mapped,
} from './retrieval/ip.js';

export {
  SsrfPolicy,
  type DnsResolver,
  type SsrfDecision,
  type SsrfPolicyOptions,
  type SsrfRejection,
} from './retrieval/ssrf.js';

export {
  DEFAULT_CONTENT_TYPES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  Fetcher,
  type FetchOutcome,
  type FetcherOptions,
  type HttpResponse,
  type RequestImpl,
} from './retrieval/fetch.js';

export {
  ALLOW_ALL,
  MAX_CRAWL_DELAY_MS,
  fetchRobots,
  isAllowedByRobots,
  parseRobots,
  robotsUrlFor,
  type RobotsRules,
} from './retrieval/robots.js';

export {
  MAX_PAGE_TEXT_CHARS,
  extractPage,
  type ExtractedPage,
} from './retrieval/extractText.js';

export {
  classifyLink,
  isSameSite,
  normalizeUrl,
  rankLinks,
  scoreLink,
  type DiscoveredLink,
  type RankedLink,
} from './retrieval/rank.js';

export {
  UNTRUSTED_CLOSE,
  UNTRUSTED_CONTENT_NOTICE,
  UNTRUSTED_OPEN,
  sanitizeResearchText,
  wrapUntrusted,
  type InjectionMatch,
  type SanitizeResult,
} from './retrieval/sanitize.js';

export {
  DEFAULT_CRAWL_BUDGET_MS,
  DEFAULT_MAX_PAGES,
  MIN_LINK_SCORE,
  crawlCompanySite,
  type CrawlOptions,
} from './retrieval/crawl.js';

export {
  findPageByType,
  isUsable,
  usablePages,
  type InjectionFlag,
  type PageResult,
  type ResearchGap,
  type ResearchResult,
  type RetrievalStatus,
  type SourceType,
} from './retrieval/types.js';

// --- Search Abstraction (Stage 9) --------------------------------------------

export {
  NoopSearchProvider,
  type SearchProvider,
  type SearchQuery,
  type SearchSnippet,
} from './search/types.js';

export {
  TavilySearchProvider,
  createSearchProvider,
  tavilyOptionsFromEnv,
  type TavilySearchProviderOptions,
} from './search/tavily.js';

// --- Pipeline Orchestration (Phase 4) ----------------------------------------

export { Deadline, type DeadlineOptions } from './pipeline/budget.js';

export {
  InMemoryCheckpointStore,
  InMemoryProgressSink,
  NoopProgressSink,
  type Checkpoint,
  type CheckpointStore,
  type ProgressSink,
  type StageEvent,
  type StageRecord,
} from './pipeline/checkpoints.js';

export {
  PIPELINE_STAGES,
  getStageDefinition,
  type StageDefinition,
  type StageKind,
} from './pipeline/stages.js';

export {
  DEFAULT_MAX_PAGES as PIPELINE_DEFAULT_MAX_PAGES,
  runPipeline,
  type PipelineInput,
  type PipelineOptions,
  type PipelineResult,
} from './pipeline/run.js';
