# Architecture

Status: **locked**. Changes require a corresponding entry in
[DECISIONS.md](./DECISIONS.md).

## 1. System diagram

```
  Browser
    |
    |  HTTPS, same-origin /api/*  (session cookie is first-party)
    v
+---------------------------------------------------------------+
|  apps/web        Next.js + Tailwind          (Vercel)          |
|  - renders kits, builder, practice, reports                    |
|  - next.config rewrite: /api/:path*  ->  API_PROXY_TARGET      |
+-------------------------------+-------------------------------+
                                |  server-to-server
                                v
+---------------------------------------------------------------+
|  apps/api        Node + Express              (Render)          |
|  - auth / sessions          - kit + item routes                |
|  - job routes + SSE         - in-process generation worker     |
|  - the ONLY package that talks to MongoDB                      |
+------------------+----------------------+---------------------+
                   |                      |
        calls      |                      |  reads/writes
                   v                      v
+------------------------------+   +---------------------------+
|  packages/core               |   |  MongoDB Atlas            |
|  runPipeline() and all       |   |  users, sessions, kits,   |
|  domain logic.               |   |  jobs, cardStats          |
|  No Express. No MongoDB.     |   +---------------------------+
+------------------^-----------+
                   |  same import, same function
+------------------+--------------------------------------------+
|  tools/evaluate   CLI:  npm run evaluate -- --input --output   |
|  no DB, no auth, no server                                     |
+---------------------------------------------------------------+
```

## 2. Package boundaries

| Package | May import | Must never import |
|---|---|---|
| `packages/core` | zod, undici, cheerio, robots-parser, node stdlib | express, mongodb, next, react |
| `apps/api` | express, mongodb, `@kit/core` | next, react |
| `apps/web` | next, react, tailwind | mongodb, express, `@kit/core` internals |
| `tools/evaluate` | `@kit/core`, node stdlib | express, mongodb |

The `packages/core` rule is the load-bearing one. It is what makes "the batch
command uses the same pipeline as the application" a verifiable fact rather
than a claim. Phase 1 adds a test that walks every file under
`packages/core/src` and fails on a forbidden import specifier, so the boundary
cannot rot silently.

`apps/web` never imports `@kit/core` directly. It consumes the API's JSON. The
kit's TypeScript types are the only thing shared conceptually, and they are
re-declared or generated at the web boundary rather than pulled in through a
build-time dependency on server code.

## 3. Responsibility split

**`packages/core` owns** JD normalization and segmentation; requirement
extraction and its deterministic guards; URL validation and the SSRF policy
object; fetching, crawling, link ranking and text extraction; the search
adapter; LLM adapters, the router and structured generation; company brief,
question and flashcard generation; deterministic coverage; deterministic
scheduling; the merge/regeneration engine; the Zod kit schema and its
cross-reference invariants; the 16-stage pipeline orchestrator, its budget and
its checkpoint interface.

**`apps/api` owns** HTTP, authentication and sessions, authorization, request
validation, MongoDB reads and writes, the job lease/heartbeat/sweeper, SSE
transport, and the practice and weak-spots endpoints.

**`tools/evaluate` owns** argument parsing, reading the case file, iterating
cases with bounded concurrency and per-case isolation, and writing the report.
It contains no pipeline logic of its own.

**`apps/web` owns** all presentation and local editing state.

## 4. Persistence boundary

`runPipeline()` accepts inputs and returns a kit plus research metadata. It
performs no database I/O. Persistence is injected as two narrow interfaces:

```
CheckpointStore { load(jobId): Promise<Checkpoint>, save(jobId, stage, patch): Promise<void> }
ProgressSink    { emit(event: StageEvent): void }
```

`apps/api` supplies a MongoDB-backed `CheckpointStore` and an SSE-fanout
`ProgressSink`. `tools/evaluate` supplies an in-memory store and a stdout
sink. Same pipeline, different edges. This is also why `npm run evaluate`
works on a clean clone with no MongoDB running at all.

Stage 16 in [PIPELINE.md](./PIPELINE.md) is named "final validation +
persistence outside core" for exactly this reason: core validates, the caller
persists.

## 5. Request and job flow

```
POST /api/kits           -> validate input, dedupe on inputHash,
                            insert kit(status=generating) + job(status=queued)
                         -> 202 { kitId, jobId }
worker (in-process)      -> atomically claim job, run stages 1..16,
                            checkpoint after each expensive stage,
                            heartbeat every 15s
GET /api/jobs/:id/events -> SSE stream projected from the job document
GET /api/kits/:id        -> the kit; always queried as { _id, userId }
```

SSE is a *view* of `jobs.stages`, never the source of truth. A client that
reconnects after a Render restart replays state from MongoDB. See
[STATE_MODEL.md](./STATE_MODEL.md).

## 6. Deployment architecture

| Component | Host | Why |
|---|---|---|
| `apps/web` | Vercel | first-class Next.js target |
| `apps/api` | Render (free web service) | long-lived process; serverless would break SSE and the in-process worker |
| Database | MongoDB Atlas M0 | free tier, managed |
| CI | GitHub Actions | typecheck + tests + offline evaluator run |

**Cookie topology.** Vercel and Render are different registrable domains, so a
cookie set by the API on the browser would be third-party and blocked by
Safari's default settings. Rather than move sessions into `localStorage`
(XSS-exposed), the browser calls `/api/*` on the Vercel origin and Next.js
rewrites server-side to Render. The cookie is therefore first-party
`SameSite=Lax`, and the browser never performs a cross-origin request, so CORS
is not part of the auth path. The API keeps its own public URL and health
endpoint, satisfying the "publicly accessible backend" requirement.

**Cold start.** Render's free tier idles the process after inactivity, costing
roughly 30-50s on the next request. This is disclosed in the README and
surfaced in the UI rather than hidden, and it is a direct reason job state is
durable rather than in-memory.

## 7. Known architectural limitations

- Static HTML crawling only. Sites that render content exclusively through
  client-side JavaScript will yield a thin company brief and an honest
  research gap. No headless browser (see [DECISIONS.md](./DECISIONS.md) D-020).
- Single API instance assumed. The job lease is written to be correct under
  concurrent claims, but horizontal scaling is untested.
- Crawl depth is 1 from the homepage, capped at `CRAWL_MAX_PAGES`.
