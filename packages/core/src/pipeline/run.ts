/**
 * 16-stage interview-kit pipeline orchestrator (docs/PIPELINE.md).
 *
 * Single shared implementation used by tools/evaluate and apps/api.
 * Framework-independent: performs no database I/O and imports no HTTP framework.
 */
import { validateDays } from '../schedule/schedule.js';
import { buildSchedule } from '../schedule/schedule.js';
import { IdAllocator } from '../ids/allocator.js';
import { computeCoverage, stripUnknownRequirementIds } from '../coverage/coverage.js';
import { runCoverageLoop } from '../coverage/secondPass.js';
import { templateQuestion } from '../coverage/fallback.js';
import { InvalidJobDescriptionError } from '../errors.js';
import { normalizeJd } from '../extract/normalize.js';
import { detectSections } from '../extract/sections.js';
import { extractRequirements } from '../extract/extract.js';
import { generateStructured } from '../llm/router.js';
import { createMockAdapter } from '../llm/mock.js';
import type { LlmAdapter } from '../llm/types.js';
import {
  COMPANY_BRIEF_SYSTEM,
  COMPANY_BRIEF_TASK,
  buildCompanyBriefUser,
  companyBriefResponseSchema,
} from '../prompts/brief.js';
import {
  GENERATE_QUESTIONS_SYSTEM,
  GENERATE_QUESTIONS_TASK,
  buildGenerateQuestionsUser,
  questionsResponseSchema,
} from '../prompts/questions.js';
import {
  GENERATE_FLASHCARDS_SYSTEM,
  GENERATE_FLASHCARDS_TASK,
  buildGenerateFlashcardsUser,
  flashcardsResponseSchema,
} from '../prompts/flashcards.js';
import {
  GENERATE_MISSING_QUESTIONS_SYSTEM,
  GENERATE_MISSING_QUESTIONS_TASK,
  buildMissingQuestionsUser,
} from '../prompts/missingQuestions.js';
import { Fetcher, DEFAULT_USER_AGENT } from '../retrieval/fetch.js';
import {
  fetchRobots,
  isAllowedByRobots,
  ALLOW_ALL,
  type RobotsRules,
} from '../retrieval/robots.js';
import { extractPage, MAX_PAGE_TEXT_CHARS } from '../retrieval/extractText.js';
import { rankLinks, type DiscoveredLink, type RankedLink } from '../retrieval/rank.js';
import { sanitizeResearchText } from '../retrieval/sanitize.js';
import { SsrfPolicy } from '../retrieval/ssrf.js';
import type {
  PageResult,
  ResearchGap,
  ResearchResult,
  SourceType,
} from '../retrieval/types.js';
import { canonicalKit } from '../schema/canonical.js';
import { assertValidKit } from '../schema/invariants.js';
import type {
  CompanyBrief,
  Flashcard,
  Kit,
  Question,
  QuestionCategory,
  Requirement,
} from '../schema/kit.js';
import {
  NoopSearchProvider,
  type SearchProvider,
  type SearchSnippet,
} from '../search/types.js';
import { Deadline, type DeadlineOptions } from './budget.js';
import {
  InMemoryCheckpointStore,
  NoopProgressSink,
  type CheckpointStore,
  type ProgressSink,
  type StageRecord,
} from './checkpoints.js';
import { extractRoleAndCompany } from './roleExtract.js';

export const MIN_LINK_SCORE = 1;
export const DEFAULT_MAX_PAGES = 5;

export interface PipelineInput {
  jd: string;
  company_url: string;
  days: number;
}

export interface PipelineOptions extends DeadlineOptions {
  adapters?: readonly LlmAdapter[];
  policy?: SsrfPolicy;
  fetcher?: Fetcher;
  searchProvider?: SearchProvider;
  checkpointStore?: CheckpointStore;
  progressSink?: ProgressSink;
  jobId?: string;
  maxPages?: number;
  maxTextChars?: number;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export interface PipelineResult {
  kit: Kit;
  stages: StageRecord[];
  research: ResearchResult;
  gaps: string[];
}

function emptyPageResult(
  url: string,
  sourceType: SourceType,
  status: PageResult['retrievalStatus'],
  detail: string | null,
  fetchedAt: string,
): PageResult {
  return {
    url,
    finalUrl: url,
    title: '',
    status: null,
    contentType: null,
    fetchedAt,
    text: '',
    sourceType,
    retrievalStatus: status,
    detail,
    bytes: 0,
    injectionFlags: [],
  };
}

const VALID_RESEARCH_GAPS = new Set<ResearchGap>([
  'invalid_url',
  'homepage_unreachable',
  'no_about_page',
  'no_hiring_page',
  'no_public_discussion',
  'robots_unavailable',
  'budget_exhausted',
]);

export async function runPipeline(
  input: PipelineInput,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  // Pre-flight input validation (docs/PIPELINE.md sections 1, 6)
  if (typeof input.jd !== 'string' || input.jd.trim() === '') {
    throw new InvalidJobDescriptionError('job description text was empty', input.jd);
  }
  const days = validateDays(input.days);

  try {
    new URL(input.company_url);
  } catch {
    throw new Error(`invalid company URL: ${input.company_url}`);
  }

  const deadline = new Deadline({
    ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
    ...(options.monotonic !== undefined ? { monotonic: options.monotonic } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  });

  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const progressSink = options.progressSink ?? new NoopProgressSink();
  const checkpointStore = options.checkpointStore ?? new InMemoryCheckpointStore();
  const jobId = options.jobId ?? `job-${Math.random().toString(36).slice(2, 10)}`;
  const existingCheckpoint = await checkpointStore.load(jobId);
  const adapters =
    options.adapters && options.adapters.length > 0
      ? options.adapters
      : [createMockAdapter()];
  const policy = options.policy ?? SsrfPolicy.strict();
  const fetcher = options.fetcher ?? new Fetcher({ policy });
  const searchProvider = options.searchProvider ?? new NoopSearchProvider();
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxTextChars = options.maxTextChars ?? MAX_PAGE_TEXT_CHARS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const idAllocator = new IdAllocator();
  const stages: StageRecord[] = [];
  const gaps: string[] = [];
  const pagesUsed: string[] = [];

  const recordStage = async (
    stageNum: number,
    name: string,
    execute: () => Promise<{
      status?: StageRecord['status'];
      detail?: string;
      provider?: string;
      error?: string;
    } | void>,
  ): Promise<void> => {
    const startedAt = deadline.nowDate().toISOString();
    const startMono = deadline.monotonicNow();

    progressSink.emit({
      type: 'stage:start',
      stage: stageNum,
      name,
      timestamp: startedAt,
    });

    const record: StageRecord = {
      stage: stageNum,
      name,
      status: 'running',
      startedAt,
      retryCount: 0,
    };

    try {
      const result = await execute();
      const finishedAt = deadline.nowDate().toISOString();
      const durationMs = deadline.monotonicNow() - startMono;

      record.status = result?.status ?? 'completed';
      record.finishedAt = finishedAt;
      record.durationMs = durationMs;
      if (result?.detail) record.detail = result.detail;
      if (result?.provider) record.provider = result.provider;

      stages.push(record);
      progressSink.emit({
        type: 'stage:complete',
        stage: stageNum,
        name,
        record,
      });
    } catch (err) {
      const finishedAt = deadline.nowDate().toISOString();
      const durationMs = deadline.monotonicNow() - startMono;
      const errorMsg = err instanceof Error ? err.message : String(err);

      record.status = 'failed';
      record.finishedAt = finishedAt;
      record.durationMs = durationMs;
      record.error = errorMsg;

      stages.push(record);
      progressSink.emit({
        type: 'stage:fail',
        stage: stageNum,
        name,
        error: errorMsg,
        record,
      });
      throw err;
    }
  };

  // --- STAGE 1: Normalize and segment JD (det) -------------------------------
  let normalizedJd = normalizeJd(input.jd);
  let sections = detectSections(normalizedJd.text);
  const jdChars = normalizedJd.originalChars;
  const roleInfo = extractRoleAndCompany(normalizedJd.text, input.company_url, sections);

  await recordStage(1, 'normalize-jd', async () => {
    normalizedJd = normalizeJd(input.jd);
    sections = detectSections(normalizedJd.text);
    if (normalizedJd.truncated) gaps.push('jd_truncated');
    return {
      detail: `normalized ${jdChars} chars into ${sections.length} sections`,
    };
  });

  // --- STAGE 2: Extract requirements (llm + det) -----------------------------
  let requirements: Requirement[] = [];

  await recordStage(2, 'extract-requirements', async () => {
    if (
      existingCheckpoint?.data?.requirements &&
      Array.isArray(existingCheckpoint.data.requirements)
    ) {
      requirements = existingCheckpoint.data.requirements as Requirement[];
      for (const r of requirements) {
        idAllocator.observe(r.id);
      }
      if (Array.isArray(existingCheckpoint.data.gaps)) {
        for (const g of existingCheckpoint.data.gaps as string[]) {
          if (!gaps.includes(g)) gaps.push(g);
        }
      }
      return {
        detail: `resumed ${requirements.length} atomic requirements from checkpoint`,
      };
    }

    const extracted = await extractRequirements({
      jd: normalizedJd.text,
      adapters,
      allocateId: () => idAllocator.nextRequirement(),
      sleep,
    });

    requirements = extracted.requirements;
    for (const g of extracted.gaps) {
      if (!gaps.includes(g)) gaps.push(g);
    }

    await checkpointStore.save(jobId, 2, {
      requirements,
      gaps,
    });

    return {
      provider: extracted.llm.provider,
      detail: `extracted ${requirements.length} atomic requirements (${extracted.dropped.length} dropped)`,
    };
  });

  // --- STAGE 3: Validate company URL (det) -----------------------------------
  let baseUrl: string | null = null;
  let urlAllowed = false;

  await recordStage(3, 'validate-url', async () => {
    const decision = await policy.checkDestination(input.company_url);
    if (!decision.allowed) {
      gaps.push('invalid_url');
      return {
        status: 'degraded',
        detail: `blocked: ${decision.reason} (${decision.detail})`,
      };
    }
    urlAllowed = true;
    baseUrl = decision.url.toString();
    return { detail: `valid URL: ${baseUrl}` };
  });

  // --- STAGE 4: Fetch homepage (net) ----------------------------------------
  let homepage: PageResult | null = null;
  let homepageLinks: DiscoveredLink[] = [];
  const robotsBlocked: string[] = [];
  let robotsRules: RobotsRules = ALLOW_ALL;

  await recordStage(4, 'fetch-homepage', async () => {
    if (!urlAllowed || !baseUrl) {
      gaps.push('homepage_unreachable');
      return { status: 'skipped', detail: 'URL validation failed upstream' };
    }

    const robots = await fetchRobots(fetcher, baseUrl, userAgent);
    if (robots.unavailable) gaps.push('robots_unavailable');
    robotsRules = robots.fetched ? robots : { ...ALLOW_ALL, status: robots.status };

    if (!isAllowedByRobots(robotsRules, baseUrl)) {
      robotsBlocked.push(baseUrl);
      homepage = emptyPageResult(
        baseUrl,
        'homepage',
        'robots_disallowed',
        'robots.txt disallows this path',
        deadline.nowDate().toISOString(),
      );
      gaps.push('homepage_unreachable');
      return { status: 'degraded', detail: 'homepage disallowed by robots.txt' };
    }

    const outcome = await fetcher.fetch(baseUrl);
    if (outcome.status !== 'success') {
      homepage = emptyPageResult(
        baseUrl,
        'homepage',
        outcome.status,
        outcome.detail,
        outcome.fetchedAt,
      );
      gaps.push('homepage_unreachable');
      return { status: 'degraded', detail: `fetch failed: ${outcome.status}` };
    }

    const extracted = extractPage(outcome.body, outcome.finalUrl);
    const sanitized = sanitizeResearchText(extracted.text);

    homepage = {
      url: baseUrl,
      finalUrl: outcome.finalUrl,
      title: extracted.title,
      status: outcome.httpStatus,
      contentType: outcome.contentType,
      fetchedAt: outcome.fetchedAt,
      text: sanitized.text.slice(0, maxTextChars),
      sourceType: 'homepage',
      retrievalStatus: 'success',
      detail: null,
      bytes: outcome.bytes,
      injectionFlags: sanitized.flags,
    };
    homepageLinks = extracted.links;
    pagesUsed.push(outcome.finalUrl);

    return { detail: `retrieved homepage: ${outcome.finalUrl} (${outcome.bytes} bytes)` };
  });

  // --- STAGE 5: Crawl / discover links (net + det) --------------------------
  await recordStage(5, 'crawl-links', async () => {
    if (!homepage || homepage.retrievalStatus !== 'success') {
      return { status: 'skipped', detail: 'skipped due to homepage failure' };
    }
    return { detail: `discovered ${homepageLinks.length} links on homepage` };
  });

  // --- STAGE 6: Rank links (det) --------------------------------------------
  let rankedLinks: RankedLink[] = [];

  await recordStage(6, 'rank-links', async () => {
    if (
      existingCheckpoint?.data?.rankedLinks &&
      Array.isArray(existingCheckpoint.data.rankedLinks)
    ) {
      rankedLinks = existingCheckpoint.data.rankedLinks as RankedLink[];
      return { detail: `resumed ${rankedLinks.length} candidate links from checkpoint` };
    }
    if (!homepage || homepage.retrievalStatus !== 'success' || !baseUrl) {
      return { status: 'skipped', detail: 'skipped due to homepage failure' };
    }
    rankedLinks = rankLinks(homepageLinks, baseUrl).filter(
      (link) => link.url !== baseUrl && link.score >= MIN_LINK_SCORE,
    );
    await checkpointStore.save(jobId, 6, { rankedLinks });
    return { detail: `ranked ${rankedLinks.length} candidate links` };
  });

  // --- STAGE 7: Identify about/hiring/interview pages (det) ------------------
  let selectedLinks: RankedLink[] = [];

  await recordStage(7, 'identify-pages', async () => {
    if (rankedLinks.length === 0) {
      return { status: 'skipped', detail: 'no candidate links to identify' };
    }
    selectedLinks = rankedLinks.slice(0, Math.max(0, maxPages - 1));
    const typesFound = [...new Set(selectedLinks.map((l) => l.sourceType))];
    return {
      detail: `selected ${selectedLinks.length} pages across types: [${typesFound.join(', ')}]`,
    };
  });

  // --- STAGE 8: Fetch selected pages (net) -----------------------------------
  const retrievedPages: PageResult[] = [];

  await recordStage(8, 'fetch-pages', async () => {
    if (existingCheckpoint?.data?.pages && Array.isArray(existingCheckpoint.data.pages)) {
      for (const p of existingCheckpoint.data.pages as PageResult[]) {
        retrievedPages.push(p);
      }
      if (Array.isArray(existingCheckpoint.data.pagesUsed)) {
        for (const u of existingCheckpoint.data.pagesUsed as string[]) {
          if (!pagesUsed.includes(u)) pagesUsed.push(u);
        }
      }
      if (Array.isArray(existingCheckpoint.data.gaps)) {
        for (const g of existingCheckpoint.data.gaps as string[]) {
          if (!gaps.includes(g)) gaps.push(g);
        }
      }
      return {
        detail: `resumed ${retrievedPages.length} pages from checkpoint`,
      };
    }

    if (selectedLinks.length === 0) {
      if (homepage?.retrievalStatus === 'success') {
        gaps.push('no_about_page');
        gaps.push('no_hiring_page');
      }
      return { status: 'skipped', detail: 'no selected links to fetch' };
    }

    for (const link of selectedLinks) {
      if (deadline.isExpired()) {
        gaps.push('budget_exhausted');
        break;
      }
      if (!isAllowedByRobots(robotsRules, link.url)) {
        robotsBlocked.push(link.url);
        continue;
      }
      if (robotsRules.crawlDelayMs > 0) {
        await sleep(robotsRules.crawlDelayMs);
      }

      const outcome = await fetcher.fetch(link.url);
      if (outcome.status === 'success') {
        const extracted = extractPage(outcome.body, outcome.finalUrl);
        const sanitized = sanitizeResearchText(extracted.text);
        const page: PageResult = {
          url: link.url,
          finalUrl: outcome.finalUrl,
          title: extracted.title,
          status: outcome.httpStatus,
          contentType: outcome.contentType,
          fetchedAt: outcome.fetchedAt,
          text: sanitized.text.slice(0, maxTextChars),
          sourceType: link.sourceType,
          retrievalStatus: 'success',
          detail: null,
          bytes: outcome.bytes,
          injectionFlags: sanitized.flags,
        };
        retrievedPages.push(page);
        pagesUsed.push(outcome.finalUrl);
      } else {
        retrievedPages.push(
          emptyPageResult(
            link.url,
            link.sourceType,
            outcome.status,
            outcome.detail,
            outcome.fetchedAt,
          ),
        );
      }
    }

    const usable = retrievedPages.filter((p) => p.retrievalStatus === 'success');
    const types = new Set(usable.map((p) => p.sourceType));
    if (!types.has('about')) gaps.push('no_about_page');
    if (!types.has('careers') && !types.has('interview')) gaps.push('no_hiring_page');

    await checkpointStore.save(jobId, 8, {
      pages: retrievedPages,
      pagesUsed,
      gaps,
    });

    return {
      detail: `retrieved ${usable.length} of ${selectedLinks.length} selected pages`,
    };
  });

  const allPages: PageResult[] = homepage
    ? [homepage, ...retrievedPages]
    : [...retrievedPages];
  const usablePages = allPages.filter((p) => p.retrievalStatus === 'success');

  const researchGaps: ResearchGap[] = gaps.filter((g): g is ResearchGap =>
    VALID_RESEARCH_GAPS.has(g as ResearchGap),
  );

  const researchResult: ResearchResult = {
    requestedUrl: input.company_url,
    homepage,
    pages: retrievedPages,
    pagesUsed: [...pagesUsed],
    gaps: researchGaps,
    robotsBlocked,
    injectionFlags: allPages.flatMap((p) =>
      p.injectionFlags.map((flag) => ({ url: p.finalUrl, pattern: flag.pattern })),
    ),
    budgetExhausted: deadline.isExpired(),
    startedAt: stages[0]?.startedAt ?? deadline.nowDate().toISOString(),
    finishedAt: deadline.nowDate().toISOString(),
  };

  // --- STAGE 9: Search public interview discussion (net) ---------------------
  let searchSnippets: SearchSnippet[] = [];

  await recordStage(9, 'search-public', async () => {
    // Budget degradation: if budget is tight (< 5000 ms), degrade Stage 9 immediately
    if (deadline.remainingMs() < 5000) {
      gaps.push('no_public_discussion');
      return {
        status: 'degraded',
        detail: 'budget exhausted; degraded to no_public_discussion gap',
      };
    }

    try {
      const results = await searchProvider.search({
        company: roleInfo.company,
        role: roleInfo.role,
      });

      if (results && results.length > 0) {
        searchSnippets = results;
        return { detail: `found ${results.length} public discussion snippets` };
      }
    } catch {
      // Safe no-op on failure
    }

    gaps.push('no_public_discussion');
    return {
      status: 'degraded',
      detail: 'no public interview discussion available (recorded gap)',
    };
  });

  // --- STAGE 10: Generate company brief (llm) --------------------------------
  let companyBrief: CompanyBrief = {
    summary: `${roleInfo.company} operates in software engineering and technology solutions.`,
    what_they_do: `${roleInfo.company} builds and maintains digital products and software services.`,
    sources: [...pagesUsed],
  };

  await recordStage(10, 'company-brief', async () => {
    const researchTexts = usablePages.map((p) => ({
      url: p.finalUrl,
      title: p.title || p.sourceType,
      text: p.text,
    }));

    if (researchTexts.length > 0) {
      try {
        const generated = await generateStructured({
          task: COMPANY_BRIEF_TASK,
          system: COMPANY_BRIEF_SYSTEM,
          user: buildCompanyBriefUser({
            companyName: roleInfo.company,
            pageTexts: researchTexts,
          }),
          schema: companyBriefResponseSchema,
          adapters,
          sleep,
        });

        companyBrief = {
          summary: generated.value.summary,
          what_they_do: generated.value.what_they_do,
          sources: [...pagesUsed],
        };

        return {
          provider: generated.provider,
          detail: 'generated company brief from retrieved research pages',
        };
      } catch {
        gaps.push('thin_brief');
      }
    } else {
      gaps.push('no_company_research');
    }

    // Degrade gracefully if no research pages or LLM failed
    companyBrief = {
      summary: `${roleInfo.company} is hiring for the ${roleInfo.role} position.`,
      what_they_do: `${roleInfo.company} operates technology solutions and software infrastructure.`,
      sources: [...pagesUsed],
    };

    return {
      status: 'degraded',
      detail: 'degraded to concise default brief due to missing research or model error',
    };
  });

  // --- STAGE 11: Generate questions (pass 1) (llm) ---------------------------
  let questions: Question[] = [];

  await recordStage(11, 'generate-questions', async () => {
    if (
      existingCheckpoint?.data?.questions &&
      Array.isArray(existingCheckpoint.data.questions)
    ) {
      questions = existingCheckpoint.data.questions as Question[];
      for (const q of questions) {
        idAllocator.observe(q.id);
      }
      return {
        detail: `resumed ${questions.length} initial questions from checkpoint`,
      };
    }

    const hiringPage = usablePages.find(
      (p) => p.sourceType === 'interview' || p.sourceType === 'careers',
    );
    const hiringContext = hiringPage ? hiringPage.text.slice(0, 3000) : undefined;

    const generated = await generateStructured({
      task: GENERATE_QUESTIONS_TASK,
      system: GENERATE_QUESTIONS_SYSTEM,
      user: buildGenerateQuestionsUser({
        roleTitle: roleInfo.role,
        requirements,
        brief: companyBrief,
        ...(hiringContext !== undefined ? { hiringContext } : {}),
        snippets: searchSnippets,
      }),
      schema: questionsResponseSchema,
      adapters,
      sleep,
    });

    const validReqIds = new Set(requirements.map((r) => r.id));
    const accepted: Question[] = [];

    for (const draft of generated.value.questions) {
      let category: QuestionCategory = 'technical';
      if (
        draft.category === 'behavioural' ||
        draft.category === 'system-design' ||
        draft.category === 'company-fit' ||
        draft.category === 'technical'
      ) {
        category = draft.category;
      }

      const reqIds = draft.requirement_ids.filter((id: string) => validReqIds.has(id));

      if (category !== 'company-fit' && reqIds.length === 0) {
        if (requirements.length > 0 && requirements[0] !== undefined) {
          reqIds.push(requirements[0].id);
        } else {
          continue;
        }
      }

      accepted.push({
        id: idAllocator.nextQuestion(),
        requirement_ids: reqIds,
        category,
        prompt: draft.prompt,
        answer_outline: draft.answer_outline ?? '',
        difficulty: draft.difficulty as 1 | 2 | 3,
      });
    }

    questions = accepted;
    await checkpointStore.save(jobId, 11, { questions });

    return {
      provider: generated.provider,
      detail: `generated ${questions.length} initial questions`,
    };
  });

  // --- STAGE 12: Generate flashcards (llm) -----------------------------------
  let flashcards: Flashcard[] = [];

  await recordStage(12, 'generate-flashcards', async () => {
    if (
      existingCheckpoint?.data?.flashcards &&
      Array.isArray(existingCheckpoint.data.flashcards)
    ) {
      flashcards = existingCheckpoint.data.flashcards as Flashcard[];
      for (const f of flashcards) {
        idAllocator.observe(f.id);
      }
      return {
        detail: `resumed ${flashcards.length} flashcards from checkpoint`,
      };
    }

    const validReqIds = new Set(requirements.map((r) => r.id));

    try {
      const generated = await generateStructured({
        task: GENERATE_FLASHCARDS_TASK,
        system: GENERATE_FLASHCARDS_SYSTEM,
        user: buildGenerateFlashcardsUser({
          requirements,
          questions,
        }),
        schema: flashcardsResponseSchema,
        adapters,
        sleep,
      });

      for (const draft of generated.value.flashcards) {
        const reqIds = draft.requirement_ids.filter((id: string) => validReqIds.has(id));
        flashcards.push({
          id: idAllocator.nextFlashcard(),
          front: draft.front,
          back: draft.back ?? '',
          requirement_ids:
            reqIds.length > 0 ? reqIds : requirements[0] ? [requirements[0].id] : [],
        });
      }

      await checkpointStore.save(jobId, 12, { flashcards });

      return {
        provider: generated.provider,
        detail: `generated ${flashcards.length} flashcards`,
      };
    } catch {
      // Degrade deterministically from requirements & questions
      flashcards = requirements.map((req) => ({
        id: idAllocator.nextFlashcard(),
        front: `Key principles: ${req.text}`,
        back: `Core concepts, trade-offs, and practical verification for ${req.kind} skills.`,
        requirement_ids: [req.id],
      }));

      await checkpointStore.save(jobId, 12, { flashcards });

      return {
        status: 'degraded',
        detail: `degraded: created ${flashcards.length} deterministic flashcards from requirements`,
      };
    }
  });

  // --- STAGE 13: Deterministic coverage check (det) --------------------------
  let uncoveredMust: string[] = [];

  await recordStage(13, 'check-coverage', async () => {
    const report = computeCoverage(requirements, questions);
    uncoveredMust = report.uncoveredMust;
    return {
      detail: `must-have coverage: ${report.covered.length} covered (${uncoveredMust.length} must-haves uncovered)`,
    };
  });

  // --- STAGE 14: Generate missing questions (llm) ---------------------------
  let actualPasses = 1;

  await recordStage(14, 'missing-questions', async () => {
    if (uncoveredMust.length === 0) {
      return {
        status: 'skipped',
        detail: 'all must-have requirements are already covered',
      };
    }

    const uncoveredTargets = requirements.filter((r) => uncoveredMust.includes(r.id));
    const validReqIds = new Set(requirements.map((r) => r.id));

    // Degradation check: if deadline is near (< 5000 ms), degrade to deterministic templates
    if (deadline.remainingMs() < 5000) {
      for (const req of uncoveredTargets) {
        const fallback = templateQuestion(req, idAllocator.nextQuestion());
        questions.push(fallback);
      }
      return {
        status: 'degraded',
        detail: `deadline near; attached ${uncoveredTargets.length} deterministic template questions`,
      };
    }

    actualPasses += 1;
    try {
      const generated = await generateStructured({
        task: GENERATE_MISSING_QUESTIONS_TASK,
        system: GENERATE_MISSING_QUESTIONS_SYSTEM,
        user: buildMissingQuestionsUser({
          uncoveredRequirements: uncoveredTargets,
          passNumber: actualPasses,
        }),
        schema: questionsResponseSchema,
        adapters,
        sleep,
      });

      let added = 0;
      for (const draft of generated.value.questions) {
        const reqIds = draft.requirement_ids.filter((id: string) => validReqIds.has(id));
        if (reqIds.length === 0) continue;

        questions.push({
          id: idAllocator.nextQuestion(),
          requirement_ids: reqIds,
          category: (draft.category as QuestionCategory) || 'technical',
          prompt: draft.prompt,
          answer_outline: draft.answer_outline ?? '',
          difficulty: (draft.difficulty as 1 | 2 | 3) || 2,
        });
        added += 1;
      }

      return {
        provider: generated.provider,
        detail: `pass 2 generated ${added} targeted questions for ${uncoveredTargets.length} requirements`,
      };
    } catch {
      // Degrade to template questions
      for (const req of uncoveredTargets) {
        const fallback = templateQuestion(req, idAllocator.nextQuestion());
        questions.push(fallback);
      }
      return {
        status: 'degraded',
        detail: `second pass LLM failed; attached ${uncoveredTargets.length} deterministic template questions`,
      };
    }
  });

  // --- STAGE 15: Coverage recheck + build schedule (det) --------------------
  let schedule: Kit['schedule'];
  let coverage: Kit['coverage'];

  await recordStage(15, 'build-schedule', async () => {
    // Run coverage loop final fallback to guarantee 0 uncovered must-haves
    const coverageLoop = await runCoverageLoop({
      requirements,
      questions,
      generate: () => [],
      allocateQuestionId: () => idAllocator.nextQuestion(),
      maxPasses: actualPasses,
    });

    questions = coverageLoop.questions;
    const finalReport = computeCoverage(requirements, questions);

    schedule = buildSchedule({
      days,
      questions,
      requirements,
    });

    coverage = {
      uncovered_requirement_ids: finalReport.uncoveredNice,
      passes: actualPasses,
    };

    return {
      detail: `built schedule for ${days} days with ${schedule.days.length} day plans; final passes: ${actualPasses}`,
    };
  });

  // --- STAGE 16: Final validation + canonical projection (det + io) ----------
  let canonical: Kit;

  await recordStage(16, 'validate-kit', async () => {
    const rawKit: Kit = {
      source: {
        company: roleInfo.company,
        company_url: input.company_url,
        role: roleInfo.role,
        location: roleInfo.location,
        jd_chars: jdChars,
        researched_at: deadline.nowDate().toISOString(),
        pages_used: [...pagesUsed],
      },
      company_brief: {
        summary: companyBrief.summary,
        what_they_do: companyBrief.what_they_do,
        sources: [...companyBrief.sources],
      },
      role: {
        title: roleInfo.role,
        seniority: roleInfo.seniority,
        responsibilities: roleInfo.responsibilities,
        requirements,
      },
      questions,
      flashcards,
      schedule: schedule!,
      coverage: coverage!,
    };

    canonical = canonicalKit(rawKit);
    assertValidKit(canonical, { requestedDays: days });

    return {
      detail:
        'kit validated against Appendix A schema and all cross-reference invariants',
    };
  });

  progressSink.emit({
    type: 'pipeline:complete',
    durationMs: deadline.elapsedMs(),
  });

  return {
    kit: canonical!,
    stages,
    research: researchResult,
    gaps,
  };
}
