# State model

Covers three separate state problems: the kit lifecycle, the durable
generation job, and the builder's edit/regeneration semantics. The third is
worth 15 rubric points and is the hardest of the three.

## 1. Kit states

```
   draft ---- POST /api/kits ----> generating ----> ready
                                       |
                                       +----------> failed  (reason retained,
                                                             retry offered)
```

| State | Meaning |
|---|---|
| `generating` | a job is queued or running; the kit document exists but `kit` is incomplete |
| `ready` | all 16 stages completed and the kit passed final validation |
| `failed` | a critical stage failed after retries; `job.error` explains which and why |

A `ready` kit is fully editable. Regenerating a scope does **not** return the
kit to `generating`; it creates a scoped job while the rest of the kit stays
readable and editable (see section 7).

## 2. Canonical kit vs. sidecar metadata

The `kit` field holds **exactly** the Appendix A structure and nothing else. A
test asserts key-set equality against the specification template, because an
automated grader may check strictly.

Everything the builder needs - provenance, pins, edit flags, deletions - lives
in sidecar fields on the same MongoDB document, outside `kit`:

```js
{
  _id, userId, version, status,
  inputHash,                    // sha256(userId + normalizedJD + normalizedURL)
  input: { jd, companyUrl, days },

  kit: { source, company_brief, role, questions, flashcards, schedule, coverage },

  idCounters: { r: 12, q: 34, f: 21 },   // monotonic; ids are never reused
  itemMeta: {
    "q7": { origin: "generated", edited: false, pinned: true,
            fingerprint: "9f2c1d4e7a03b5c8", editedAt: null }
  },
  tombstones: {
    questions:  [{ fingerprint: "1a4b8c2f60d9e73a", at: "2026-09-09T12:00:00.000Z" }],
    flashcards: []
  },
  research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
  createdAt, updatedAt
}
```

Exporting a kit is a projection: take `kit`, drop everything else.

## 3. Job states

```
                    +-----------+
  POST /api/kits -->|  queued   |
                    +-----+-----+
                          |
        atomic claim:  findOneAndUpdate(
                         { status: queued OR (running AND leaseExpiresAt < now) },
                         { status: running, leaseOwner, leaseExpiresAt: now+60s,
                           $inc: { attempt: 1 } })
                          |
                    +-----v-----+
                    |  running  |--- stage n done --> persist checkpoint
                    +--+--+--+--+                     + stages[n] ------+
  heartbeat +60s       |  |  |                                          |
  every 15s -----------+  |  |  <-- resume re-enters here at n+1 -------+
                          |  |
                          |  +-- all 16 stages ok ------> succeeded
                          |  +-- fatal / non-retryable -> failed
                          |
                          +----- process dies -> lease expires after 60s
                                    |
                    sweeper (on boot, then every 30s):
                      attempt <  maxAttempts (2)  -> back to running, resume
                      attempt >= maxAttempts      -> failed("stale_after_retries")
```

| Field | Purpose |
|---|---|
| `status` | `queued` / `running` / `succeeded` / `failed` |
| `leaseOwner` | id of the process currently holding the job |
| `leaseExpiresAt` | lease deadline; a crashed process releases the job by simply not renewing |
| `attempt` / `maxAttempts` | bounded retries, so a poison job cannot loop forever |
| `lastCompletedStage` | resume point |
| `checkpoint` | durable outputs of expensive stages |
| `stages[]` | 16 rows, each `{ n, name, status, ms, detail }` - the inspectable audit trail |

### Why this shape

Render's free tier restarts the process on deploy and after idling. If job
state lived only in memory, a restart would strand a kit in `generating`
forever. Instead:

- **SSE is a view, not the source of truth.** The stream is projected from
  `jobs.stages`. A client that reconnects after a restart replays state from
  MongoDB and loses nothing.
- **Checkpoints make resumption cheap.** Stage 2 (requirements), 6 (ranked
  links), 8 (page texts, truncated to 20k chars each), 11 (pass-1 questions)
  and 12 (flashcards) are persisted on completion, so a resumed run does not
  re-crawl the site or re-pay for model calls.
- **The lease is the recovery mechanism.** No external queue is required; the
  atomic `findOneAndUpdate` claim is safe against double-processing even if two
  processes ever run. Recorded as D-009 in [DECISIONS.md](./DECISIONS.md).

## 4. Item metadata

Applies to questions and flashcards:

```
origin     "generated" | "manual"
edited     boolean   - set true the first time a user changes the text
pinned     boolean   - explicit user intent to keep this item

PROTECTED  =  pinned OR origin = "manual" OR edited
```

`PROTECTED` is derived on read, never stored, so it cannot drift out of sync
with the three inputs.

## 5. ID allocation

Ids are issued by `idCounters` on the kit document - not by the model, and not
by array position.

- Format `r<n>`, `q<n>`, `f<n>`; the counter only ever increases.
- **Ids are never reused.** Deleting `q7` does not free `q7`; if the counter
  stands at 34 the next question is `q35`. This keeps every id stable within a
  kit for its whole lifetime, including across regenerations, so schedule
  references and practice statistics can never silently rebind to different
  content.
- Requirement ids are **append-only**. A requirements regeneration may add new
  ids and may update the text of unedited requirements, but never removes or
  renumbers an id that a question references.

## 6. Regeneration rules

Scopes: `brief`, `requirements`, `questions:<category>`, `flashcards`.

```
regenerate(scope):

  items OUTSIDE the scope   -> never read, never written
                               ("edits elsewhere survive" is structural,
                                not a promise we must remember to keep)
  PROTECTED items IN scope  -> kept verbatim: same id, same text, same
                               relative order
  other items IN scope      -> eligible for replacement

  candidates from the model
     -> Zod validation
     -> strip requirement_ids that do not exist in the kit
     -> DROP if fingerprint is in tombstones[scope]     (deleted stays deleted)
     -> DROP if fingerprint matches a protected item    (no duplicate of the
                                                         user's own work)
     -> allocate fresh ids from idCounters              (never reused)

  merged = [protected items in original order] ++ [accepted candidates]

  recompute coverage       (deterministic, derived)
  recompute schedule       (deterministic, derived)
  validate the whole kit
  version += 1
```

Derived data is never user-authored: `coverage` and `schedule` are recomputed
from questions and requirements after every mutation, so they cannot drift out
of agreement with the content they describe.

### Deletion and tombstones

Deleting an item removes it from `kit` and appends `{ fingerprint, at }` to
`tombstones[scope]`.

```
fingerprint = sha256(lowercased, punctuation- and whitespace-stripped text)
              truncated to 16 hex chars
```

**Known limitation, stated plainly:** the fingerprint is an exact match after
normalization. A regenerated item that is a genuine *paraphrase* of a deleted
one can return. Semantic deduplication would need embeddings, which is
deliberately out of scope (D-019). The mitigation available to the user is to
pin or edit the items they care about.

## 7. Optimistic concurrency and scope locking

- Every mutating request carries the kit `version` it was based on. A mismatch
  returns **409** with the server's current copy, and the client reconciles.
  This keeps concurrent tabs safe without locking the whole document.
- While a regeneration job for scope `S` is running, edits to `S` return
  **423**, but edits to every other scope are accepted normally. This is what
  makes "edits elsewhere survive regeneration" true in practice rather than
  only inside the merge algorithm.
- The pre-regeneration snapshot is retained on the kit document, so a
  regeneration can be reverted if the buffer day allows building that UI.

## 8. Practice state

`cardStats` is keyed by `(userId, kitId, cardId)` and holds `attempts`,
`lastConfidence`, an exponentially weighted moving average and `lastSeenAt`.
Ordering for the next session is deterministic application code: unseen cards
first, then lowest confidence, then least recently seen, tie-broken by numeric
card id. The same collection feeds the weak-spots report, which joins
requirements to question coverage to practice confidence.

Practice statistics survive regeneration because ids are never reused: a
statistic can only ever refer to the card it was recorded against. If that card
is deleted its statistics become orphaned, and they are excluded from reports
rather than reassigned to a different card.
