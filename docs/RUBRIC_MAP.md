# Rubric map

The authoritative Trao rubric, mapped to the module that earns each item, the
test that proves it, the UI evidence a human reviewer can see, and the
acceptance criteria we hold ourselves to.

| Half | Item | Points |
|---|---|---|
| Automated | Requirement extraction | 20 |
| Automated | Coverage + schedule | 15 |
| Automated | Research + sequencing | 10 |
| Automated | Robustness | 10 |
| Human | Builder / edit / reorder / regeneration | 15 |
| Human | Interaction design | 10 |
| Human | Code quality + README | 10 |
| Human | Practice mode + creativity | 10 |
| | **Total** | **100** |

Effort is allocated in proportion to these weights, not in proportion to how
interesting the work is. Requirement extraction alone is worth more than the
entire research and sequencing category, and is therefore scheduled first, on
day 1.

---

## AUTOMATED - 55 points

### Requirement extraction - 20 points

**Modules:** `core/extract/normalize.ts`, `core/extract/sections.ts`,
`core/extract/guards.ts`, `core/extract/extract.ts`, `core/prompts/extract.ts`,
`core/ids/allocator.ts`

**Tests** (`core/extract/__tests__`), one per required behaviour:

| Test | Asserts |
|---|---|
| `hallucinated-requirement` | mock returns a requirement absent from the JD; the evidence guard drops it |
| `evidence-mismatch` | `evidence_quote` is not present verbatim in the JD; item dropped |
| `token-overlap` | a paraphrase below the 60% content-token threshold is dropped |
| `wrong-priority` | mock marks a nice-to-have item `must`; the section override forces `nice` |
| `duplicate-requirement` | two near-identical items merge via Jaccard >= 0.85 |
| `boilerplate` | benefits / EEO / salary lines never become requirements |
| `thin-jd` | a two-line JD yields a thin kit plus a `thin_jd` gap, with nothing invented |
| `stable-ids` | ids are `r1..rn` in document order, assigned only after filtering |

**UI evidence:** each requirement in the role panel shows its `must`/`nice`
badge, its kind, and the JD span it was extracted from. The thin-JD case shows
an explicit "the job description was too short to extract more" notice rather
than a padded list.

**Acceptance:** no requirement can exist without a verbatim JD span backing it;
priority is decided by application code whenever the source section is
unambiguous; ids are stable and monotonic for the kit's lifetime; a thin JD
produces a thin kit.

### Coverage + schedule - 15 points

**Modules:** `core/coverage/coverage.ts`, `core/coverage/secondPass.ts`,
`core/schedule/schedule.ts`

**Tests:**

| Test | Asserts |
|---|---|
| `missing-must-have` | a must-have with no question appears in `uncovered_requirement_ids` |
| `second-pass` | pass 2 targets only uncovered requirements and reduces the set |
| `no-progress-stop` | when pass 2 adds nothing, the loop stops instead of looping |
| `final-fallback` | a still-uncovered must-have receives a deterministic template question |
| `passes-recorded` | `coverage.passes` equals the passes actually executed |
| `schedule-1-day` | 1 day, many questions: exactly one day, minutes clamped to 180 |
| `schedule-2-days` | front-loading - day 1 outscores day 2 |
| `schedule-many-days` | 30 days; exact day count; no empty day |
| `schedule-60-days` | 60 days with 12 questions; spaced-review days fill the tail |
| `schedule-invalid-days` | `0`, `61`, `2.5`, `"5"` and `NaN` are all rejected before generation |
| `schedule-must-haves` | every must-have requirement appears somewhere in the schedule |
| `schedule-integer-minutes` | every `minutes` value is an integer within `[30, 180]` |
| `schedule-refs` | every `question_id` resolves to an existing question |

**UI evidence:** the schedule view shows a day count matching the requested
value, per-day minutes, and a coverage banner listing any remaining
nice-to-have gaps.

**Acceptance:** a final kit never knowingly contains an uncovered must-have;
the schedule contains exactly the requested number of days; every invariant in
PIPELINE.md section 6 holds and is asserted in code, not only in tests.

### Research + sequencing - 10 points

**Modules:** `core/retrieval/*`, `core/search/*`, `core/pipeline/stages.ts`,
`core/pipeline/run.ts`

**Tests:**

| Test | Asserts |
|---|---|
| `homepage-gate` | no page is treated as useful before the homepage is fetched and ranked |
| `relative-links` | relative hrefs resolve against the case `company_url` |
| `link-ranking` | careers / about / interview pages outrank blog and asset links |
| `hiring-page-discovery` | a discovered hiring page reaches the question-generation context |
| `partial-retrieval-failure` | one dead link fails neither the crawl nor the kit |
| `stage-order` | all 16 stages execute in order and are recorded in `jobs.stages` |
| `pages-used-provenance` | `pages_used` comes from the fetcher log, not from model output |

**UI evidence:** the generation view streams all 16 named stages live; the
finished kit shows a sources panel listing the pages actually fetched, and an
honest list of research gaps.

**Acceptance:** the pipeline is genuinely sequential and inspectable after the
fact; a hiring page measurably changes the generated questions; missing
research is recorded as a gap rather than fabricated or treated as a failure.

### Robustness - 10 points

**Modules:** `core/llm/router.ts`, `core/retrieval/ssrf.ts`,
`core/retrieval/robots.ts`, `api/worker/*`, `tools/evaluate/cli.ts`

**Tests:**

| Test | Asserts |
|---|---|
| `invalid-json` | malformed model output triggers exactly one repair attempt |
| `rate-limit` | a 429 backs off and then fails over to Groq |
| `provider-fallback` | a Gemini hard failure still completes the task on the fallback |
| `no-infinite-repair` | the worst case is bounded at 2 adapters x 2 attempts |
| `llm-timeout` | a hung provider aborts on `LLM_TIMEOUT_MS` |
| `unreachable-site` | connection refused yields a gap, not a failed case |
| `robots-disallow` | a disallowed path is skipped and recorded |
| `ssrf-blocked-ranges` | every private, loopback, link-local and reserved range is rejected |
| `ssrf-redirect-to-private` | a public URL redirecting to a private address is rejected |
| `ssrf-dns-rebinding` | a lookup returning a private address at connect time is rejected |
| `ssrf-oversized-response` | the body aborts at `FETCH_MAX_BYTES` |
| `ssrf-policy-isolation` | no module reachable from the API constructs a non-strict policy |
| `stale-job-recovery` | an expired lease is reclaimed and resumes at `lastCompletedStage + 1` |
| `batch-failure-isolation` | one failing case does not abort the other four |

**UI evidence:** clear failure states carrying the actual reason and a retry
action; research gaps shown honestly rather than hidden.

**Acceptance:** no failure mode in PIPELINE.md section 8 can crash the process,
strand a kit in `generating`, or abort a batch run.

---

## HUMAN - 45 points

### Builder / edit / reorder / regeneration - 15 points

**Modules:** `core/merge/merge.ts`, `core/merge/fingerprint.ts`,
`api/routes/items.ts`, `apps/web` builder components

**Tests:**

| Test | Asserts |
|---|---|
| `edit-marks-protected` | editing sets `edited`, and the item becomes protected |
| `manual-item-survives` | a hand-written question survives regeneration of its category |
| `pin-survives` | both the pinned state and the pinned item survive regeneration |
| `delete-stays-deleted` | a tombstoned item is dropped from regenerated candidates |
| `regenerate-scope-isolation` | items outside the scope are byte-identical afterwards |
| `id-never-reused` | deleting `q7` never yields a new `q7` |
| `derived-recomputed` | coverage and schedule are recomputed after every mutation |
| `optimistic-concurrency` | a stale `version` returns 409 with the server copy |
| `scope-lock` | edits to a regenerating scope return 423; other scopes still accept edits |

**UI evidence:** inline editing with immediate local feedback; keyboard-first
reordering (move up/down, move to category) so reordering is accessible without
a pointer; add and delete; a pin control with visible state; a per-section
regenerate action that reports what was kept and what was replaced.

**Acceptance:** every clause of STATE_MODEL.md section 6 holds; the paraphrase
limitation is documented rather than quietly hoped away.

### Interaction design - 10 points

**Modules:** `apps/web` - layout, components, state boundaries

**Evidence:** loading, empty, error and partial-failure states for every view;
responsive desktop and mobile layouts; full keyboard navigation with visible
focus; long-running generation communicated through live per-stage progress
rather than an indeterminate spinner; regeneration surfaced as a scoped,
recoverable action.

**Acceptance:** every list has an empty state, every async view has a loading
and an error state, and every interactive control is reachable and operable
from the keyboard.

### Code quality + README - 10 points

**Evidence:** strict TypeScript with no `any` escape hatches in core; the
`packages/core` import boundary enforced by a test rather than by convention;
one clear responsibility per module; meaningful commit history; CI running
typecheck, tests and the offline evaluator on every push; and this
documentation set, written before the code rather than reconstructed after it.

**Acceptance:** a reader can identify the module owning any given behaviour
from the docs alone; the README explains setup, architecture, the state model,
deliberate trade-offs and known limitations without overselling.

### Practice mode + creativity - 10 points

**Modules:** `api/routes/practice.ts`, `api/routes/report.ts`, plus the
ordering and scoring functions in `core`

**Tests:**

| Test | Asserts |
|---|---|
| `practice-ordering` | unseen first, then lowest confidence, then least recent, deterministic tie-break |
| `covered-uncovered` | covered and uncovered card counts are correct |
| `weak-spots-join` | requirement strength combines coverage with practice confidence |
| `orphaned-stats` | statistics for a deleted card are excluded, never reassigned |

**UI evidence:** one card at a time, reveal, three-level confidence capture, and
a session summary showing covered versus uncovered; plus the **Weak Spots**
report joining requirements to question coverage to practice confidence, so a
user can see which requirement they are least prepared for and jump straight to
its questions.

**Acceptance:** the next session demonstrably prioritises weaker cards; the
weak-spots report is a deterministic join over data the product already holds,
not a cosmetic addition.
