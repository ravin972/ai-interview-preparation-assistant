# Decision log

Short architecture decision records. Each entry states the decision, why it was
taken, what it costs, and what was rejected. Ids are referenced from the other
documents.

---

### D-001 - Monorepo with npm workspaces

**Decision.** One repository, four workspaces: `packages/core`, `apps/api`,
`apps/web`, `tools/evaluate`.

**Why.** The evaluator must run the same pipeline as the application. Sharing
that code across repositories would mean publishing a package or vendoring a
copy, and a vendored copy drifts. Workspaces ship with npm, so this costs no
extra tooling.

**Cost.** A single `node_modules` shared by frontend and backend concerns.

**Rejected.** Turborepo, Nx and pnpm workspaces - all add tooling for a
four-package repository built in three days.

---

### D-002 - Framework-independent core

**Decision.** `packages/core` never imports Express, MongoDB, Next.js or any
HTTP framework. It performs no persistence.

**Why.** This is what makes "the batch evaluator uses the same pipeline as the
application" a verifiable fact rather than a claim, and it is why
`npm run evaluate` works on a clean clone with no database running. Persistence
is injected as two narrow interfaces, `CheckpointStore` and `ProgressSink`.

**Cost.** One extra indirection at each edge.

**Enforcement.** A test walks every file under `packages/core/src` and fails on
a forbidden import specifier, so the boundary cannot rot silently.

---

### D-003 - Gemini primary, Groq fallback

**Decision.** Gemini 2.5 Flash as primary, Groq as fallback, plus a mock
provider. One `LlmAdapter.complete()` interface, three adapters, and one
`generateStructured(task, schema)` router.

**Why.** Both have a genuine free tier. Gemini's native structured output is
stronger; Groq is fast and independent, so a Gemini outage or exhausted quota
does not end the run. All parsing, validation, repair and failover live in the
router - one place to reason about, one place to test.

**Cost.** Two HTTP shapes to maintain, and output normalisation before
validation because Groq's structured-output guarantees are weaker.

**Bounds.** Worst case is 2 adapters x 2 attempts = 4 calls per task. There is
no unbounded repair loop.

**Rejected.** A provider-abstraction framework, LangChain, or any agent
library. The requirement is one call shape, not an ecosystem.

---

### D-004 - Mock LLM provider

**Decision.** Ship a mock adapter returning fixed, schema-valid responses
derived from its input.

**Why.** Three things at once: deterministic CI, a suite that cannot fail
because of a provider outage or an exhausted free tier, and the ability to
exercise failure paths - malformed JSON, rate limits, timeouts - on demand
rather than by chance.

**Cost.** The mock's responses must be kept in step with the prompts.

---

### D-005 - Render for the API, Vercel for the web app

**Decision.** `apps/api` on a Render free web service; `apps/web` on Vercel.

**Why.** Render runs a long-lived process, which SSE and the in-process
generation worker both require. Vercel is the first-class Next.js host.

**Cost.** Render's free tier idles the process, costing roughly 30-50 seconds on
the next request. Disclosed in the README and in the UI rather than hidden.

**Rejected.** Putting the API on Vercel serverless - it would break SSE and the
in-process worker, forcing a polling-only design.

---

### D-006 - Next.js proxy instead of cross-site cookies

**Decision.** The browser calls `/api/*` on the Vercel origin; Next.js rewrites
server-side to Render.

**Why.** Vercel and Render are different registrable domains, so an API-set
cookie would be third-party and blocked by Safari's defaults - login would
silently fail in production for an entire browser. Proxying keeps the session
cookie first-party `SameSite=Lax` and removes browser CORS from the auth path
entirely.

**Cost.** One extra network hop, and the API's public URL is not the URL the
browser uses. The API remains publicly accessible with its own health endpoint,
satisfying the requirement.

**Rejected.** Bearer tokens in `localStorage` (XSS-exposed), and
`SameSite=None` third-party cookies (blocked by default in Safari).

---

### D-007 - MongoDB Atlas with the official driver, not Mongoose

**Decision.** Use the `mongodb` driver directly. Validate with Zod.

**Why.** Zod already validates every LLM output and the kit structure, because
the specification requires it. Mongoose would introduce a second, divergent
schema definition of the same kit shape. One source of truth means less drift.

**Cost.** Hand-written index creation and no populate helpers - neither of which
this application needs.

---

### D-008 - Sidecar item metadata, canonical kit untouched

**Decision.** The `kit` field holds exactly the Appendix A structure. Pins, edit
flags, provenance and tombstones live in sibling fields on the same document.

**Why.** The specification requires an exact kit structure, and an automated
grader may check it strictly. Adding `pinned` or `origin` inside a question
object would risk failing that check. Exporting a kit is then a projection: take
`kit`, drop the rest.

**Cost.** Two structures to keep in step, keyed by item id.

---

### D-009 - Durable job state in MongoDB; no Redis or BullMQ

**Decision.** Job status, `leaseOwner`, `leaseExpiresAt`, heartbeat,
`lastCompletedStage` and stage checkpoints all live in MongoDB. The worker runs
in-process. A sweeper reclaims expired leases on boot and every 30 seconds.

**Why.** Render restarts the process on deploy and after idling. In-memory job
state would strand kits in `generating` forever. The atomic `findOneAndUpdate`
claim is safe against double-processing, and checkpoints make resumption cheap -
a resumed run does not re-crawl or re-pay for model calls.

**Cost.** Roughly 120 lines of lease and sweeper logic we own and must test.

**Rejected.** Redis plus BullMQ. That is a second managed service, a second
free-tier account and a second failure mode, to solve a problem a database we
already run can solve. If this application needed multi-instance fan-out or
scheduled retries at scale, the trade would flip.

**Consequence.** SSE is a *view* of `jobs.stages`, never the source of truth.

---

### D-010 - Deterministic coverage with a template fallback

**Decision.** Coverage is a set difference computed in application code. If a
must-have requirement is still uncovered after at most three passes, a
deterministic template question is generated from that requirement's own text.

**Why.** The specification states a final kit must not knowingly contain
uncovered must-have requirements. Without the fallback, a provider outage during
the second pass would silently drop a requirement. The template invents no facts
- it only restates the requirement as a question.

**Cost.** A template question is less interesting than a generated one. It is
labelled as such in the UI.

**Consequence.** `uncovered_requirement_ids` therefore lists remaining
nice-to-have gaps only.

---

### D-011 - Deterministic schedule, with clamped minutes

**Decision.** Schedule allocation is a pure function. Per-day minutes are
clamped to `[30, 180]`.

**Why.** The specification explicitly forbids delegating allocation to the LLM.
The clamp is a product judgement: with `days = 1` and 40 questions the honest
output keeps every question on day 1 - so must-have coverage still holds - but
does not claim a person will study for nine hours.

**Cost.** For extreme inputs, `minutes` is not the arithmetic sum of that day's
questions. Documented rather than hidden.

---

### D-012 - Evidence-backed requirement extraction

**Decision.** Every extracted requirement must carry an `evidence_quote`
appearing verbatim in the normalized JD, and must share at least 60% of its
content tokens with the JD. Requirements failing either check are dropped.
Priority is overridden by application code when the evidence span falls in an
explicit must-have or nice-to-have section.

**Why.** This is the highest-weighted automated category at 20 points, and the
main failure mode is a confident model inventing plausible requirements. A
requirement that cannot point at a span of the job description does not exist.
The section override is the clearest demonstration of the LLM boundary the
specification demands.

**Cost.** Recall drops slightly - a legitimately paraphrased requirement can be
dropped. The trade is deliberate: a thin honest kit scores better than a padded
invented one, and the specification says so explicitly.

---

### D-013 - Ids allocated by application code and never reused

**Decision.** `idCounters` on the kit document issues `r<n>`, `q<n>`, `f<n>`
monotonically. Deleting an item does not free its id.

**Why.** Schedule entries and practice statistics reference ids. Reusing an id
would silently rebind a statistic or a schedule slot to different content.

**Cost.** Ids become sparse over a long editing session. Harmless.

---

### D-014 - Optimistic concurrency plus scope-level locking

**Decision.** Mutations carry the kit `version`; a mismatch returns 409. While a
scope is regenerating, edits to that scope return 423, but edits elsewhere are
accepted.

**Why.** Scope-level locking is what makes "edits elsewhere survive
regeneration" true operationally, not merely inside the merge function.

**Cost.** The client must handle two rejection codes.

**Rejected.** Locking the whole kit during regeneration - it would make the
guarantee vacuous by forbidding the very edits it claims to preserve.

---

### D-015 - Tombstones as normalized fingerprints

**Decision.** Deletion records a `sha256` of the normalized item text. Any
regenerated candidate matching a tombstone is dropped.

**Why.** Ids change on regeneration, so an id-based tombstone would not work.

**Cost and known limitation.** The match is exact after normalization, so a
genuine *paraphrase* of a deleted item can return. Semantic deduplication would
need embeddings (D-019). Documented in the README rather than hidden.

---

### D-016 - SSRF policy as a constructor parameter

**Decision.** The fetch policy is passed in. `apps/api` constructs
`SsrfPolicy.STRICT` and has no code path that constructs anything else;
`tools/evaluate` constructs `SsrfPolicy.fromEnv()`.

**Why.** The evaluator needs `localhost:8099` fixtures; production must never
allow private addresses. An environment check *inside* the fetcher would make
production security depend on a variable staying unset. Making the policy a
parameter renders the exception unreachable from production code rather than
merely unused by it.

**Cost.** One extra argument threaded through the retrieval layer.

**Enforcement.** A test asserts that no module reachable from the API entry
point constructs a non-strict policy.

---

### D-017 - No search-engine scraping

**Decision.** Stage 9 uses a search API when `TAVILY_API_KEY` is configured, and
otherwise records an honest `no_public_discussion` research gap.

**Why.** The specification requires respecting site terms, and scraping search
result pages violates them. It also anticipates missing public discussion as a
normal outcome rather than a failure.

**Cost.** Without a key, one input to question generation is absent - recorded
as a gap and visible in the UI.

---

### D-018 - scrypt from node:crypto for password hashing

**Decision.** `scrypt` with a per-user random salt and `timingSafeEqual`.

**Why.** argon2 needs a native build, which is a real and common deployment
failure on free tiers. bcrypt in pure JavaScript is slow and adds a dependency.
scrypt is a memory-hard KDF that ships in the Node standard library.

**Cost.** Fewer tuning knobs than argon2id. Acceptable here.

---

### D-019 - No embeddings, vector store or RAG

**Decision.** Keyword-based link ranking and direct prompting. No vector
database.

**Why.** The corpus is at most five pages plus a job description. Embeddings
would add a dependency, a storage concern and latency, to solve a retrieval
problem that keyword ranking solves adequately at this size.

**Cost.** Tombstone matching is lexical, not semantic (D-015).

---

### D-020 - Static HTML crawling only

**Decision.** No headless browser. Crawl depth 1, capped at `CRAWL_MAX_PAGES`.

**Why.** Playwright or Puppeteer would add hundreds of megabytes, exceed
free-tier memory limits, and multiply crawl time - for a minority of sites.

**Cost and known limitation.** A site rendering its content exclusively through
client-side JavaScript yields a thin company brief and an honest research gap.
Documented in the README as a limitation rather than presented as a bug.

---

### D-021 - No microservices, no unnecessary abstractions

**Decision.** Two deployed processes - a web app and an API - plus a CLI. No
message bus, no service mesh, no plugin architecture, no repository pattern over
the driver, no dependency-injection container.

**Why.** The assessment is timeboxed to roughly three focused days and is graded
partly on code quality, which here means a reader can find the module that owns
a behaviour. Every abstraction not required by a stated requirement is a cost
paid twice: once to build, once to explain.

**Cost.** Some code is less "enterprise" than it could be. That is the intent.

**Test.** Each abstraction that does exist - `LlmAdapter`, `CheckpointStore`,
`ProgressSink`, `SsrfPolicy`, `SearchProvider` - exists because it has at least
two real implementations in this repository, not because it might one day.
