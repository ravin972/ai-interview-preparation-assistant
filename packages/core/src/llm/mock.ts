/**
 * Scriptable mock adapter.
 *
 * Built before the real providers so every failure path - fences, prose,
 * malformed JSON, schema violations, rate limits, timeouts, outages - is
 * reproducible offline and on demand rather than by chance. The default test
 * suite never touches the network (docs/DECISIONS.md D-004).
 */
import {
  LlmPermanentError,
  LlmTransientError,
  type LlmAdapter,
  type LlmCompletionRequest,
  type LlmProviderName,
} from './types.js';

export type MockStep =
  /** Return this text verbatim. */
  | { kind: 'text'; text: string }
  /** Return JSON.stringify(value). */
  | { kind: 'json'; value: unknown }
  /** Return the value inside a fenced code block. */
  | { kind: 'fenced'; value: unknown; language?: string }
  /** Return prose, then the JSON value, then optional trailing prose. */
  | { kind: 'prose-then-json'; prose: string; value: unknown; trailing?: string }
  /** Return text that is not parseable JSON. */
  | { kind: 'malformed' }
  | { kind: 'rate-limit' }
  | { kind: 'server-error' }
  | { kind: 'timeout' }
  | { kind: 'network-error' }
  | { kind: 'permanent-error'; status?: number; message?: string };

export const step = {
  text: (text: string): MockStep => ({ kind: 'text', text }),
  json: (value: unknown): MockStep => ({ kind: 'json', value }),
  fenced: (value: unknown, language = 'json'): MockStep => ({
    kind: 'fenced',
    value,
    language,
  }),
  proseThenJson: (prose: string, value: unknown, trailing?: string): MockStep =>
    trailing === undefined
      ? { kind: 'prose-then-json', prose, value }
      : { kind: 'prose-then-json', prose, value, trailing },
  malformed: (): MockStep => ({ kind: 'malformed' }),
  rateLimit: (): MockStep => ({ kind: 'rate-limit' }),
  serverError: (): MockStep => ({ kind: 'server-error' }),
  timeout: (): MockStep => ({ kind: 'timeout' }),
  networkError: (): MockStep => ({ kind: 'network-error' }),
  permanent: (status = 401, message = 'invalid API key'): MockStep => ({
    kind: 'permanent-error',
    status,
    message,
  }),
} as const;

export interface MockAdapterOptions {
  name?: LlmProviderName;
  /** Consumed in order, one per complete() call. */
  script?: MockStep[];
  /** Alternative to a script: decide per request. Used by the offline pipeline. */
  respond?: (request: LlmCompletionRequest, callIndex: number) => MockStep;
  /** What happens once the script is exhausted. Default: repeat the last step. */
  onExhausted?: 'repeat-last' | 'throw';
}

function render(current: MockStep, provider: LlmProviderName): string {
  switch (current.kind) {
    case 'text':
      return current.text;
    case 'json':
      return JSON.stringify(current.value);
    case 'fenced':
      return [
        '```' + (current.language ?? 'json'),
        JSON.stringify(current.value, null, 2),
        '```',
      ].join('\n');
    case 'prose-then-json':
      return [
        current.prose,
        JSON.stringify(current.value, null, 2),
        current.trailing ?? '',
      ]
        .join('\n')
        .trimEnd();
    case 'malformed':
      return 'Certainly! Here is the JSON: {"requirements": [{"text": "unterminated"';
    case 'rate-limit':
      throw new LlmTransientError(provider, 'rate_limit', 'rate limit exceeded', 429);
    case 'server-error':
      throw new LlmTransientError(provider, 'server', 'upstream server error', 503);
    case 'timeout':
      throw new LlmTransientError(provider, 'timeout', 'request timed out');
    case 'network-error':
      throw new LlmTransientError(provider, 'network', 'connection reset');
    case 'permanent-error':
      throw new LlmPermanentError(
        provider,
        current.message ?? 'permanent failure',
        current.status,
      );
  }
}

export function defaultTaskResponder(
  request: LlmCompletionRequest,
  _callIndex = 0,
): MockStep {
  const task = request.task;
  const user = request.user;
  const system = request.system.toLowerCase();

  if (
    task === 'extract-requirements' ||
    system.includes('atomic requirements') ||
    user.includes('Job description:')
  ) {
    return mockExtractRequirements(user);
  }

  if (
    task === 'company-brief' ||
    system.includes('company brief') ||
    user.includes('Company research pages:')
  ) {
    return mockCompanyBrief(user);
  }

  if (
    task === 'generate-missing-questions' ||
    user.includes('Coverage Pass') ||
    user.includes('MUST-HAVE requirements currently lack')
  ) {
    return mockGenerateMissingQuestions(user);
  }

  if (
    task === 'generate-flashcards' ||
    system.includes('flashcard') ||
    user.includes('Sample Questions Prepared:')
  ) {
    return mockGenerateFlashcards(user);
  }

  if (
    task === 'generate-questions' ||
    system.includes('interview questions') ||
    user.includes('Requirements to test:')
  ) {
    return mockGenerateQuestions(user);
  }

  return step.json({});
}

function mockExtractRequirements(user: string): MockStep {
  const lines = user
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const candidates: {
    text: string;
    kind: string;
    priority: string;
    evidence_quote: string;
  }[] = [];

  let inNiceSection = false;
  let inBoilerplateSection = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes('nice to have') ||
      lower.includes('preferred') ||
      lower.includes('bonus')
    ) {
      inNiceSection = true;
      inBoilerplateSection = false;
      continue;
    }
    if (
      lower.includes('requirements') ||
      lower.includes('what you will do') ||
      lower.includes('about the role')
    ) {
      inNiceSection = false;
      inBoilerplateSection = false;
      continue;
    }
    if (
      lower.includes('benefits') ||
      lower.includes('what we offer') ||
      lower.includes('commitment to diversity') ||
      lower.includes('right to work') ||
      lower.includes('recruitment agencies')
    ) {
      inBoilerplateSection = true;
      continue;
    }
    if (inBoilerplateSection) continue;

    const bulletMatch = /^[-*•]\s+(.*)$/.exec(line);
    if (bulletMatch && bulletMatch[1]) {
      const rawText = bulletMatch[1].trim();
      if (rawText.length > 5) {
        let kind = 'technical';
        const lowerRaw = rawText.toLowerCase();
        if (
          lowerRaw.includes('mentor') ||
          lowerRaw.includes('communication') ||
          lowerRaw.includes('lead')
        ) {
          kind = 'behavioural';
        } else if (
          lowerRaw.includes('robotics') ||
          lowerRaw.includes('logistics') ||
          lowerRaw.includes('industrial')
        ) {
          kind = 'domain';
        }
        const priority = inNiceSection ? 'nice' : 'must';
        candidates.push({
          text: rawText,
          kind,
          priority,
          evidence_quote: rawText,
        });
      }
    }
  }

  // If no bullets found (e.g. heading-less or short JD), split text into sentences
  if (candidates.length === 0) {
    const sentences = user
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10 && !s.startsWith('---') && !s.includes('JSON'));

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (
        lower.includes('experience') ||
        lower.includes('building') ||
        lower.includes('designing') ||
        lower.includes('tuning') ||
        lower.includes('distributed systems') ||
        lower.includes('tests') ||
        lower.includes('kubernetes') ||
        lower.includes('mentoring') ||
        lower.includes('docker') ||
        lower.includes('python') ||
        lower.includes('react')
      ) {
        let kind = 'technical';
        if (lower.includes('mentor') || lower.includes('communication')) {
          kind = 'behavioural';
        } else if (lower.includes('robotics') || lower.includes('distributed systems')) {
          kind = 'domain';
        }

        const priority =
          lower.includes('useful') ||
          lower.includes('dealbreaker') ||
          lower.includes('love it')
            ? 'nice'
            : 'must';

        candidates.push({
          text: sentence.replace(/\.$/, ''),
          kind,
          priority,
          evidence_quote: sentence,
        });
      }
    }
  }

  if (candidates.length === 0) {
    const firstNonEmpty =
      lines.find((l) => l.length > 10 && !l.includes('JSON') && !l.startsWith('---')) ??
      'General engineering requirements';
    candidates.push({
      text: firstNonEmpty,
      kind: 'technical',
      priority: 'must',
      evidence_quote: firstNonEmpty,
    });
  }

  return step.json({ requirements: candidates.slice(0, 24) });
}

function mockCompanyBrief(user: string): MockStep {
  let summary =
    'A forward-thinking engineering organisation delivering scalable and reliable software platforms.';
  let whatTheyDo =
    'The company designs, develops, and operates mission-critical applications and modern infrastructure systems.';

  const lower = user.toLowerCase();
  if (lower.includes('robotics') || lower.includes('acme')) {
    summary =
      'Acme Robotics designs and operates autonomous mobile robots and real-time fleet management platforms for modern automated warehouses.';
    whatTheyDo =
      'The company builds industrial warehouse robotics, low-latency telemetry interfaces, and distributed coordination systems to optimize supply chain fulfillment.';
  }

  return step.json({
    summary,
    what_they_do: whatTheyDo,
  });
}

function mockGenerateQuestions(user: string): MockStep {
  const reqMatches = [...user.matchAll(/\[(r[1-9][0-9]*)\]\s*\(([^)]+)\)\s*([^\n]+)/g)];
  const questions: {
    requirement_ids: string[];
    category: string;
    prompt: string;
    answer_outline: string;
    difficulty: number;
  }[] = [];

  const mustReqs = reqMatches.filter((m) => m[2]?.includes('must'));
  const niceReqs = reqMatches.filter((m) => m[2]?.includes('nice'));

  // If there are >= 3 must-haves, leave the last one uncovered in pass 1
  // to exercise coverage check (Stage 13) and missing-questions second pass (Stage 14)
  const mustsToCover = mustReqs.length > 2 ? mustReqs.slice(0, -1) : mustReqs;

  for (let i = 0; i < mustsToCover.length; i++) {
    const match = mustsToCover[i];
    if (!match) continue;
    const rId = match[1] ?? `r${i + 1}`;
    const meta = match[2] ?? '';
    const text = match[3] ?? '';
    let category = 'technical';
    if (meta.includes('behavioural')) category = 'behavioural';
    else if (i % 3 === 2) category = 'system-design';

    questions.push({
      requirement_ids: [rId],
      category,
      prompt: `In a production environment, how do you approach: ${text.trim().slice(0, 80)}?`,
      answer_outline:
        '1. Architecture & fundamentals.\n2. Trade-offs, failure modes & edge cases.\n3. Automated testing and observability.',
      difficulty: (i % 3) + 1,
    });
  }

  for (let i = 0; i < niceReqs.length; i++) {
    const match = niceReqs[i];
    if (!match) continue;
    const rId = match[1] ?? `r${i + 1}`;
    const text = match[3] ?? '';
    questions.push({
      requirement_ids: [rId],
      category: 'technical',
      prompt: `What has been your experience working with ${text.trim().slice(0, 80)}?`,
      answer_outline: 'Practical hands-on examples and lessons learned.',
      difficulty: 2,
    });
  }

  // Add a company-fit question with empty requirement_ids (permitted under D-022)
  questions.push({
    requirement_ids: [],
    category: 'company-fit',
    prompt:
      'What excites you about our technical domain, mission, and operating environment?',
    answer_outline:
      'Alignment with company mission, interest in domain challenges, and collaboration values.',
    difficulty: 1,
  });

  return step.json({ questions });
}

function mockGenerateMissingQuestions(user: string): MockStep {
  const reqMatches = [...user.matchAll(/\[(r[1-9][0-9]*)\]\s*\(([^)]+)\)\s*([^\n]+)/g)];
  const questions: {
    requirement_ids: string[];
    category: string;
    prompt: string;
    answer_outline: string;
    difficulty: number;
  }[] = [];

  for (let i = 0; i < reqMatches.length; i++) {
    const match = reqMatches[i];
    if (!match) continue;
    const rId = match[1] ?? `r${i + 1}`;
    const meta = match[2] ?? '';
    const text = match[3] ?? '';
    const category = meta.includes('behavioural') ? 'behavioural' : 'technical';
    questions.push({
      requirement_ids: [rId],
      category,
      prompt: `Deep dive: Can you describe your hands-on experience and problem-solving methodology regarding ${text.trim().slice(0, 80)}?`,
      answer_outline:
        'Detailed step-by-step breakdown, technical challenges overcome, and verification strategy.',
      difficulty: 2,
    });
  }

  return step.json({ questions });
}

function mockGenerateFlashcards(user: string): MockStep {
  const reqMatches = [...user.matchAll(/\[(r[1-9][0-9]*)\]\s*\(([^)]+)\)\s*([^\n]+)/g)];
  const flashcards: {
    front: string;
    back: string;
    requirement_ids: string[];
  }[] = [];

  for (let i = 0; i < reqMatches.length; i++) {
    const match = reqMatches[i];
    if (!match) continue;
    const rId = match[1] ?? `r${i + 1}`;
    const text = match[3] ?? '';
    flashcards.push({
      front: `Key principles and patterns for: ${text.trim().slice(0, 80)}`,
      back: 'Fundamental definitions, architectural trade-offs, and critical gotchas to avoid.',
      requirement_ids: [rId],
    });
  }

  if (flashcards.length === 0) {
    flashcards.push({
      front: 'Core system design principles',
      back: 'Modularity, observability, idempotency, and graceful degradation.',
      requirement_ids: ['r1'],
    });
  }

  return step.json({ flashcards });
}

export class MockLlmAdapter implements LlmAdapter {
  readonly name: LlmProviderName;
  /** Every request received, in order. Assert against this in tests. */
  readonly calls: LlmCompletionRequest[] = [];

  readonly #script: MockStep[];
  readonly #respond: MockAdapterOptions['respond'];
  readonly #onExhausted: 'repeat-last' | 'throw';
  #index = 0;

  constructor(options: MockAdapterOptions = {}) {
    this.name = options.name ?? 'mock';
    this.#script = options.script ?? [];
    this.#respond = options.respond;
    this.#onExhausted = options.onExhausted ?? 'repeat-last';
  }

  get callCount(): number {
    return this.calls.length;
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    const callIndex = this.calls.length;
    this.calls.push(request);

    if (request.signal?.aborted === true) {
      return Promise.reject(
        new LlmTransientError(this.name, 'timeout', 'request aborted before dispatch'),
      );
    }

    const current = this.#nextStep(request, callIndex);
    if (current === null) {
      return Promise.reject(
        new Error(`${this.name}: mock script exhausted after ${callIndex} call(s)`),
      );
    }

    try {
      return Promise.resolve(render(current, this.name));
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  #nextStep(request: LlmCompletionRequest, callIndex: number): MockStep | null {
    if (this.#respond !== undefined) return this.#respond(request, callIndex);
    if (this.#script.length > 0) {
      const next = this.#script[this.#index];
      if (next !== undefined) {
        this.#index += 1;
        return next;
      }
      if (this.#onExhausted === 'throw') return null;
      return this.#script.at(-1) ?? null;
    }
    return defaultTaskResponder(request, callIndex);
  }
}

export function createMockAdapter(options: MockAdapterOptions = {}): MockLlmAdapter {
  return new MockLlmAdapter(options);
}
