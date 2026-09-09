# Batch evaluator

The mandatory automated entry point. Everything in the AUTOMATED half of the
rubric (55 points) is graded through this command, so it is treated as a
first-class deliverable rather than a wrapper added at the end.

## 1. Exact command

```
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Optional flags, all with safe defaults:

| Flag | Default | Purpose |
|---|---|---|
| `--concurrency <n>` | `2` | cases processed in parallel |
| `--case-timeout <ms>` | `150000` | per-case wall-clock ceiling |
| `--verbose` | off | per-stage progress to stderr |

## 2. Input shape

```json
[
  {
    "id": "case-01",
    "jd": "We are hiring a Senior Frontend Engineer...",
    "company_url": "http://localhost:8099/acme/",
    "days": 5
  }
]
```

Each case is validated before it runs. `days` must be an integer in `1..60`;
`jd` must be a non-empty string; `company_url` must parse. A case that fails
validation is recorded as an error and does not consume pipeline budget.

## 3. Output shape

```json
{
  "version": "1.0",
  "generated_at": "2026-09-09T12:00:00.000Z",
  "kits": [
    { "id": "case-01", "status": "ok",    "kit": {},   "error": null },
    { "id": "case-02", "status": "error", "kit": null, "error": "homepage_unreachable: ..." }
  ]
}
```

- `kits` preserves **input order**, regardless of the order in which
  concurrent cases finish.
- `status` is `ok` or `error`. On `ok`, `kit` is the exact Appendix A structure
  and `error` is `null`. On `error`, `kit` is `null` and `error` carries a
  human-readable reason.
- `generated_at` is ISO-8601 UTC.

## 4. Clean-clone requirement

From a fresh `git clone`, the command must work after `npm install` and a
populated `.env`. Specifically it requires:

- **No MongoDB.** The evaluator supplies an in-memory `CheckpointStore`, so
  nothing touches a database. This is precisely why `packages/core` performs no
  persistence (ARCHITECTURE.md section 4).
- **No authentication and no running server.** The CLI calls `runPipeline()`
  directly.
- **No build step.** The CLI runs the TypeScript entry point directly.
- **Credentials from environment variables only** - never from a config file or
  a command-line argument, so keys stay out of shell history. `.env.example`
  documents every variable.

CI runs this command on every push against the committed fixtures, so the
clean-clone path is exercised continuously rather than checked once before
submission.

## 5. Offline deterministic mode

```
LLM_PROVIDER=mock npm run evaluate -- --input fixtures/cases.json --output kits.json
```

The mock provider returns fixed, schema-valid responses derived from its input,
so a run is fully offline, network-free and reproducible. This is what CI uses.
It buys three things at once: deterministic assertions on pipeline behaviour, a
suite that cannot fail because of a provider outage or an exhausted free tier,
and a way to exercise failure paths - malformed JSON, rate limits, timeouts -
on demand rather than by chance.

## 6. Same-pipeline requirement

The CLI contains **no pipeline logic**. It parses arguments, reads the case
file, iterates with bounded concurrency, and writes the report. The work is done
by the same `runPipeline()` exported from `@kit/core` that `apps/api` calls.

This is enforced, not merely intended: a test imports the pipeline entry point
through the API's import path and through the CLI's import path and asserts
they are the same function reference. A second test scans `tools/evaluate` for
generation or scheduling logic that belongs in core.

## 7. Failure isolation

Each case runs inside its own `try`/`catch` and its own deadline. A failure -
invalid URL, unreachable host, invalid model JSON, exhausted retries, timeout -
is captured into that case's `error` field and the run continues. One failing
case can never abort the remaining cases.

The process exits `0` whenever the report was written successfully, even if
some cases failed, because the report itself carries the per-case status. A
non-zero exit is reserved for conditions that prevent a report existing at all:
an unreadable input file, malformed input JSON, or an unwritable output path.

## 8. Local fixture strategy

Evaluator fixtures are served from `localhost`, which the production SSRF
policy blocks by design. The exception is structural:

- `tools/evaluate` constructs `SsrfPolicy.fromEnv()`, which defaults to strict
  and relaxes only for `host:port` pairs listed in `EVAL_ALLOW_PRIVATE_HOSTS`.
- `apps/api` constructs `SsrfPolicy.STRICT` and has no code path that can
  construct anything else, so setting that variable in production cannot weaken
  the deployed API.

Full reasoning in [SECURITY.md](./SECURITY.md), "The evaluator exception".

Relative URLs inside fixture pages are resolved against the case's
`company_url`, so a case pointing at `http://localhost:8099/acme/` correctly
discovers `about.html`, `careers/` and the interview-process page through
relative hrefs.

The committed fixture site (`fixtures/site/`) deliberately includes a dead link
and a `robots.txt` disallow rule, so partial-retrieval failure and robots
compliance are exercised on every CI run rather than only in a hand-written
unit test.

## 9. Performance budget

The specification allows 15 minutes for 5 cases including retries. With
`--concurrency 2` and a 150-second per-case deadline, expected wall-clock time
is roughly 5-7 minutes against live providers, and well under a minute with
`LLM_PROVIDER=mock`.

The per-case deadline is a hard ceiling rather than a target. As the budget is
consumed the pipeline sheds optional stages first - public-discussion search
(stage 9) and the second coverage pass (stage 14) - both of which degrade to an
honestly recorded gap or a deterministic template question rather than to a
broken kit.
