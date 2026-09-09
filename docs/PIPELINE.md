# Research and generation pipeline

The kit is **not** produced by one LLM prompt. It is produced by 16 ordered
stages with explicit inputs, outputs, determinism classification and
degradation behaviour. Every stage writes a row into `jobs.stages`, so the
sequence is inspectable after the fact, not only while the SSE stream is open.

## 1. Stage table

Kind: `det` = deterministic application code, `llm` = model call,
`net` = network I/O, `io` = persistence (performed outside core).

| # | Stage | Kind | Input | Output | On failure |
|---|---|---|---|---|---|
| 1 | Normalize + segment JD | det | raw JD text | normalized text, section map, `jd_chars` | cannot fail; an empty JD is rejected at input validation |
| 2 | Extract requirements | llm + det | normalized text, section map | `requirements[]` with stable ids | **critical** - the case fails with a stated reason |
| 3 | Validate company URL | det | company_url | parsed URL, SSRF verdict | gap `invalid_url`; pipeline continues JD-only |
| 4 | Fetch homepage | net | validated URL | HTML, final URL after redirects | gap `homepage_unreachable`; stages 5-8 skipped |
| 5 | Crawl / discover links | net + det | homepage HTML, base URL | absolute candidate links | partial results accepted |
| 6 | Rank links | det | candidate links | scored, ordered links | cannot fail |
| 7 | Identify about/hiring/interview pages | det + llm | ranked links | labelled page set | heuristic-only labelling if the LLM tiebreak fails |
| 8 | Fetch selected pages | net | labelled links (max `CRAWL_MAX_PAGES`) | sanitized page text, `pages_used[]` | per-page skip, logged; never fatal |
| 9 | Search public interview discussion | net | company + role | external snippets | gap `no_public_discussion` - the expected offline outcome |
| 10 | Generate company brief | llm | homepage + about text | `company_brief` | degrade to page title + meta description + gap |
| 11 | Generate questions (pass 1) | llm | requirements, brief, hiring page, snippets | `questions[]` | repair, then fallback provider, then **critical** |
| 12 | Generate flashcards | llm | requirements, questions | `flashcards[]` | degrade: derive deterministically from questions |
| 13 | Deterministic coverage check | det | requirements, questions | `uncovered_requirement_ids` | cannot fail |
| 14 | Generate missing questions | llm | uncovered requirements only | additional `questions[]` | degrade to a deterministic template question |
| 15 | Coverage recheck + build schedule | det | questions, requirements, days | `coverage`, `schedule` | **critical** - a failure here is a bug, not a runtime condition |
| 16 | Final validation + persist | det + io | full kit | validated kit | **critical**; persistence happens in the caller, not in core |

## 2. Sequencing guarantees

```
  JD text ---> [1 normalize] ---> [2 extract] ---> requirements r1..rn
                                        |
  company_url -> [3 validate] -> [4 homepage] -> [5 crawl] -> [6 rank] -> [7 identify]
                                        |                                      |
                                        +--------- HARD GATE ------------------+
             no page counts as "useful" until the homepage has been fetched
             and its links ranked; a discovered hiring/interview page is
             injected as labelled context into stages 10, 11 and 14
                                        |
                                 [8 fetch pages] --> [9 public search]
                                        |
                          [10 brief]  [11 questions]  [12 flashcards]
                                        |
                       [13 coverage] --uncovered must-have?--> [14 second pass]
                                        |                              |
                                        +<-----------------------------+
                                        |   (max 3 passes, see section 5)
                            [15 recheck + schedule] --> [16 validate] --> persist
```

Two properties a reviewer can verify directly:

- **Link ranking is deterministic code** (stage 6), scoring URL path and anchor
  text against a keyword set (`about, careers, jobs, hiring, interview,
  culture, values, team, engineering`) with penalties for depth, off-domain
  hosts and asset extensions. Crawled content therefore never steers control
  flow, which is simultaneously the correct LLM-boundary answer and a
  prompt-injection defence.
- **`source.pages_used` and `company_brief.sources` come from the fetcher's own
  log**, never from model output. The model cannot fabricate a citation.

## 3. Determinism boundary

| Decision | Owner |
|---|---|
| Requirement extraction, brief, questions, flashcards, page-label tiebreak | LLM |
| Requirement / question / flashcard IDs | code |
| must vs nice priority (final say) | code - see section 4, guard (c) |
| Coverage comparison | code |
| Schedule allocation and day count | code |
| Integer minute calculation | code |
| Kit schema and cross-reference invariants | code |
| Which links to fetch | code |
| Whether a requirement is supported by the JD | code |
| Practice ordering and weak-spot scoring | code |

## 4. Stage 2 in detail - requirement extraction (20 rubric points)

The highest-weighted automated category, and the one that receives the most
engineering effort per hour.

```
1  normalize    strip pasted HTML, unify bullet glyphs and whitespace,
                cap at 24k chars. jd_chars is measured on the ORIGINAL text.

2  segment      deterministic heading detection into:
                responsibilities | requirements/must-have |
                nice-to-have/preferred/bonus | about | benefits/EEO

3  llm          return atomic requirements - one testable claim each:
                { text, kind, priority, evidence_quote }
                evidence_quote is REQUIRED and must be verbatim from the JD.

4  deterministic guards - this is where the points actually are:
   a  evidence_quote must occur in the normalized JD           else DROP
   b  at least 60% of the requirement's content tokens
      appear in the JD                                         else DROP
   c  if the evidence span falls inside a nice-to-have section,
      force priority = nice; mirror for an explicit must or
      required section. Application code overrides the model.
   d  dedupe: fingerprint equality OR token Jaccard >= 0.85 -> merge
   e  coerce enums: kind in {technical, behavioural, domain},
                    priority in {must, nice}
   f  drop benefits / EEO / salary / perks boilerplate by denylist
   g  cap at 24 requirements, musts retained first
   h  assign r1..rn in document order AFTER filtering -> stable, monotonic

5  thin JD      jd_chars < 400, or fewer than 3 surviving requirements
                -> record gap thin_jd and STOP. No top-up, no enrichment
                from general knowledge. A thin JD yields a thin kit.
```

Guard (a) is the strongest anti-hallucination mechanism available at this
cost: a requirement that cannot point at a verbatim span of the job
description does not exist. Guard (c) is the clearest demonstration of the
LLM boundary the specification demands.

## 5. Stages 13-15 in detail - the coverage loop

```
covered(r)  =  there exists a question q with r.id in q.requirement_ids
               (after requirement_ids not present in the kit are stripped)

uncovered   =  { r.id : r.priority = must AND NOT covered(r) }

pass 1  generate questions across all requirements            (stage 11)
pass 2  generate ONLY for uncovered requirements; the prompt  (stage 14)
        carries just those requirement texts
pass 3  permitted only if pass 2 strictly reduced |uncovered|

STOP when   uncovered is empty
       OR   3 passes reached
       OR   no progress between passes
       OR   the pipeline budget deadline is reached

FINAL GUARANTEE  any must-have still uncovered receives a deterministic
                 template question built ONLY from that requirement's own
                 text. Nothing is invented; coverage stays honest.

kit.coverage.passes                    = passes actually executed
kit.coverage.uncovered_requirement_ids = remaining nice-to-have gaps only
```

The template fallback is a deliberate, documented decision: the specification
states a final kit must not knowingly contain uncovered must-have
requirements, and a provider outage must not silently drop one. Recorded as
D-010 in [DECISIONS.md](./DECISIONS.md).

## 6. Stage 15 in detail - deterministic schedule

```
MINUTES_BY_DIFFICULTY = { 1: 10, 2: 15, 3: 20 }
DAY_MIN = 30    DAY_MAX = 180

precondition:  Number.isInteger(days) AND 1 <= days <= 60
               otherwise KitValidationError, before any generation begins

score(q) = 10 * (number of must-have requirements q covers)
         +  3 * q.difficulty
         +  categoryWeight(q.category)
sort descending, tie-break by numeric id ascending
        -> a total, reproducible order

n >= days :  split the sorted list into `days` contiguous chunks, larger
             chunks first, so the hardest and highest-priority material
             lands on day 1 by construction
n <  days :  the first n days take one question each; surplus days re-list
             a rotating window of the top-scoring questions as spaced
             review, so no day is ever empty

minutes(d) = clamp(sum of MINUTES_BY_DIFFICULTY, DAY_MIN, DAY_MAX) -> integer
focus(d)   = dominant category + leading requirement keywords, built in code
```

Asserted in code and covered by tests:

- `schedule.days.length === schedule.days_available === requested days`
- day numbers are exactly `1..days`, in order
- every `question_id` resolves to a question that exists in the kit
- every must-have requirement appears somewhere in the schedule
- every `minutes` value is an integer within `[30, 180]`

Edge behaviour. `days = 1` with 40 questions puts all 40 on day 1 with
`minutes` clamped to 180 and a `focus` labelled as a compressed plan; the
clamp is a documented product decision, because a person cannot study for nine
hours. `days = 60` with 12 questions gives 12 study days plus 48 spaced-review
days. `0`, `61`, `2.5` and `"5"` are rejected before generation starts, in the
API and in the evaluator alike.

## 7. Budget and checkpoints

A `Deadline` object is threaded through every stage. Stages 9 and 14 are the
first to be skipped when the budget runs short, because both degrade to an
honestly recorded gap rather than to a broken kit.

Checkpointed after completion: stage 2 (requirements), stage 6 (ranked links),
stage 8 (page texts, truncated to 20k chars each), stage 11 (pass-1 questions)
and stage 12 (flashcards). A restarted process resumes at
`lastCompletedStage + 1` without re-crawling or re-paying for model calls. See
[STATE_MODEL.md](./STATE_MODEL.md).

## 8. Failure matrix

| Condition | Behaviour |
|---|---|
| Invalid URL, 404, timeout, non-HTML content type | gap recorded; kit still generated from the JD |
| No about or hiring page discovered | gap recorded; brief built from the homepage alone |
| No public interview discussion | gap recorded - expected, not a failure |
| robots.txt disallows a path | page skipped and listed in `research.robotsBlocked` |
| Thin or two-line JD | thin honest kit; the overlap guard blocks invented requirements |
| Invalid or truncated LLM JSON | one schema-aware repair, then the fallback provider |
| 429 / 5xx from a provider | bounded backoff, then the fallback provider |
| Duplicate JD + URL for the same user | 409 with the existing kit id and an explicit "create anyway" |
| days = 1 / 60 / invalid | see section 6 |
| Process restart mid-generation | lease expires, sweeper resumes from the last checkpoint |
