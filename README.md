# AI Interview Preparation Kit

Turn a job description and a company URL into a researched, editable interview
preparation kit: a company brief, a role breakdown with stable requirement ids,
categorised questions, flashcards, and a deterministic day-by-day study
schedule sized to the time you actually have.

Built for the Trao Full-Stack Engineering Assessment.

> **Status: architecture checkpoint.** This commit contains documentation and
> the workspace skeleton only. No application code has been written yet.
> Implementation begins at Phase 0 (see [Implementation plan](#implementation-plan)).

---

## What it does

A user pastes a job description, gives a company URL, and says how many days
they have. The system then:

1. extracts **atomic, evidence-backed requirements** from the job description;
2. researches the company by crawling its site and locating about, careers and
   hiring pages;
3. generates a company brief, categorised questions and flashcards;
4. runs a **deterministic coverage check** and generates questions for anything
   a must-have requirement still lacks;
5. builds a **deterministic study schedule** containing exactly the requested
   number of days;
6. lets the user edit, reorder, pin, delete and regenerate any section without
   losing their own work;
7. supports flashcard practice with confidence tracking, and reports which
   requirements they are weakest on.

Two principles run through the whole design:

- **The LLM does semantic work only.** Coverage comparison, schedule
  allocation, id assignment, integer minutes and schema validation are
  application code. See [docs/PIPELINE.md](docs/PIPELINE.md) section 3.
- **Missing research is recorded, not invented.** A two-line job description
  produces a thin, honest kit. A site that cannot be reached produces a
  documented gap, not a fabricated brief.

---

## Architecture summary

```
  Browser
    |  same-origin /api/*  (session cookie stays first-party)
    v
  apps/web     Next.js + Tailwind        -> Vercel
    |  server-side rewrite
    v
  apps/api     Node + Express            -> Render
    |     \
    |      \--- MongoDB Atlas   (users, sessions, kits, jobs, cardStats)
    v
  packages/core    runPipeline() + all domain logic
    ^              no Express, no MongoDB, no persistence
    |
  tools/evaluate   npm run evaluate  (no DB, no auth, no server)
```

`packages/core` is the source of truth for requirement extraction, retrieval,
research sequencing, LLM orchestration, coverage, scheduling,
merge/regeneration, schema validation and pipeline execution. Both the API and
the batch evaluator call the same `runPipeline()`. Persistence lives outside
core, which is why the evaluator runs on a clean clone with no database.

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Planned stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + Tailwind CSS | deployed on Vercel |
| Backend | Node 22 + Express | deployed on Render; long-lived process for SSE |
| Database | MongoDB Atlas, official `mongodb` driver | Zod is the single schema source, so no Mongoose - D-007 |
| Language | TypeScript, strict | in every workspace |
| Validation | Zod | every LLM output and the full kit structure |
| Retrieval | `undici` + `cheerio` + `robots-parser` | static HTML only - D-020 |
| Auth | `scrypt` from `node:crypto` | no native build to fail on a free tier - D-018 |
| Tests | Vitest | plus an offline evaluator run in CI |
| CI | GitHub Actions | typecheck, tests, offline evaluator |

No deviation from the assessment's preferred stack. The two choices that differ
from a default setup - the raw MongoDB driver rather than Mongoose, and no SDK
for the LLM providers - are recorded with their reasoning in
[docs/DECISIONS.md](docs/DECISIONS.md).

---

## LLM providers

| Role | Provider | Model |
|---|---|---|
| Primary | Google Gemini | `gemini-2.5-flash` |
| Fallback | Groq | set via `GROQ_MODEL` |
| Test / CI | built-in mock | deterministic, offline |

The abstraction is deliberately small: one `LlmAdapter.complete()` interface,
three adapters, and one `generateStructured(task, schema)` router that owns all
parsing, validation, repair and failover.

```
Gemini -> parse -> Zod validate -> ok
             |            |
             |            +-- invalid -> one repair attempt
             |
             +-- 429 / 5xx / timeout -> bounded backoff -> Groq
```

Worst case is bounded at 2 adapters x 2 attempts per task. There are no
infinite repair loops, and every final output is Zod-validated.

---

## Batch evaluator

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Runs the same `runPipeline()` as the application. No MongoDB, no auth, no
server. Each case is isolated, so one failure never aborts the run. For a fully
offline, deterministic run:

```bash
LLM_PROVIDER=mock npm run evaluate -- --input fixtures/cases.json --output kits.json
```

Contract, input and output shapes, and the localhost fixture strategy:
[docs/EVALUATOR.md](docs/EVALUATOR.md).

---

## Setup

> Placeholder - completed in Phase 0, once the workspaces carry real
> dependencies. The intended flow:

```bash
git clone <repo> && cd "AI Interview Preparation Assistant"
npm install
cp .env.example .env          # then fill in the values
npm test                      # unit tests + offline evaluator
npm run evaluate -- --input fixtures/cases.json --output kits.json
```

Every environment variable is documented in [`.env.example`](.env.example).
Credentials are read from the environment only - never from a config file or a
command-line argument.

**Requirements:** Node 22+, npm 10+, and a MongoDB connection string for the
web application (the evaluator needs neither).

---

## Deployment targets

| Component | Target | Notes |
|---|---|---|
| `apps/web` | Vercel | proxies `/api/*` to the API so cookies stay first-party |
| `apps/api` | Render (free web service) | long-lived process; idles after inactivity, so expect a 30-50s cold start |
| Database | MongoDB Atlas M0 | free tier |
| CI | GitHub Actions | typecheck + tests + offline evaluator on every push |

Because Render restarts the process on deploy and after idling, generation job
state is durable in MongoDB with a lease, a heartbeat and per-stage
checkpoints. SSE is the live progress mechanism but never the source of truth,
so a restart mid-generation resumes rather than stranding the kit. See
[docs/STATE_MODEL.md](docs/STATE_MODEL.md).

---

## Documentation

| Document | Covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | system diagram, package boundaries, persistence boundary, deployment |
| [docs/PIPELINE.md](docs/PIPELINE.md) | all 16 stages, determinism boundary, extraction, coverage, schedule, failure matrix |
| [docs/STATE_MODEL.md](docs/STATE_MODEL.md) | kit states, job lease and checkpoints, item metadata, regeneration rules, concurrency |
| [docs/SECURITY.md](docs/SECURITY.md) | SSRF threat model, crawler citizenship, prompt injection, auth, authorization, secrets |
| [docs/EVALUATOR.md](docs/EVALUATOR.md) | the batch command contract, offline mode, failure isolation, fixtures |
| [docs/RUBRIC_MAP.md](docs/RUBRIC_MAP.md) | every rubric item mapped to module, test, UI evidence and acceptance criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 21 decision records with costs and rejected alternatives |

---

## Implementation plan

Roughly 23 focused engineering hours across three days, with a fourth day held
as buffer. Effort is allocated in proportion to the rubric weights, not to how
interesting the work is.

**Day 1 - the automated 55 points (~8h)**

| Phase | Work |
|---|---|
| 0 | toolchain, Vitest, CI, fixture site and fixture JDs |
| 1 | kit schema, invariants, id allocator, **coverage**, **schedule** + tests |
| 2 | LLM adapters and router, **requirement extraction and its guards** + tests |

**Day 2 - pipeline, evaluator, API (~8h)**

| Phase | Work |
|---|---|
| 3 | retrieval: SSRF, robots, fetch, crawl, rank, extract, sanitize + security tests |
| 4 | 16-stage orchestrator, checkpoints, **`npm run evaluate`** + offline CI run |
| 5 | MongoDB, auth, kits, job lease and sweeper, SSE, merge engine, practice, reports |

**Day 3 - the human 45 points (~7h)**

| Phase | Work |
|---|---|
| 6 | UI: auth, kit list, create and batch, live progress, builder, practice, weak spots |
| 7 | deploy, README completion, walkthrough video, commit hygiene |

Phase 4 is the milestone that matters most: after it, the automated half of the
rubric is provable even if day 3 runs short.

---

## Known limitations

Stated up front rather than left for a reviewer to discover:

- **JavaScript-only sites** yield a thin company brief and a recorded research
  gap. The crawler reads static HTML and does not run a headless browser
  (D-020).
- **A paraphrased deleted item can return.** Deletion tombstones match on a
  normalized text fingerprint, so an exact or near-exact regeneration is
  blocked but a genuine rewording is not (D-015).
- **Public interview discussion needs a search API key.** We do not scrape
  search-engine result pages, because the assessment requires respecting site
  terms. Without a key, stage 9 records an honest gap (D-017).
- **Render free-tier cold start** adds roughly 30-50 seconds to the first
  request after idling.
- **Single API instance assumed.** The job lease is written to be correct under
  concurrent claims, but horizontal scaling is untested.
# ai-interview-preparation-assistant
