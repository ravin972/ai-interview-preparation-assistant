# fixtures

Deterministic inputs for tests, CI and local evaluator runs.

## `site/` - the fixture company site

Served on `127.0.0.1:8099` by `fixtures/serve.ts` (`npm run fixtures:serve`).
Tests start it on an ephemeral port instead.

```
/                                  host root landing page
/robots.txt                        host root - disallows /acme/private/
/acme/                             company homepage (the grader-style base path)
/acme/about.html                   about page, plus a hidden prompt-injection payload
/acme/careers/                     careers page
/acme/careers/interview-process.html   the hiring page that must influence questions
/acme/blog/                        low-signal page, so link ranking has something to rank below
/acme/private/internal-notes.html  served, but robots-disallowed
/acme/private/interview-archive.html  linked from the homepage and ranked highly
                                   by the interview keyword, but robots-disallowed
/acme/team.html                    deliberately absent - the dead link
```

Deliberate properties, each exercising a real failure mode:

- **Company content sits at `/acme/`, robots.txt at the host root.** A crawler
  pointed at a sub-path must still fetch robots from `/robots.txt`. Splitting
  the two makes that bug visible.
- **Relative hrefs only** (`about.html`, `../about.html`,
  `interview-process.html`), so base-URL resolution is tested rather than
  assumed.
- **A dead link** on the homepage, for partial retrieval failure.
- **A robots-disallowed page that genuinely exists and ranks highly.** The
  homepage links `private/interview-archive.html`, which the interview keyword
  puts at the top of the ranking - so the crawl must actively decline to fetch
  its best-scoring candidate. If its text ever reaches a kit, robots handling is
  broken.
- **A hidden prompt-injection payload** in `about.html`, for the stage 10/11
  defence tests (docs/SECURITY.md section 4).

## `jds/` - job descriptions

| File | Exercises |
|---|---|
| `rich.txt` | full JD with explicit Requirements and Nice to have sections - the priority override |
| `thin.txt` | two lines; must yield a thin honest kit with nothing invented |
| `heading-less.txt` | requirements embedded in prose, no headings to infer priority from |
| `boilerplate-heavy.txt` | benefits, EEO and agency text that must never become requirements |

## `cases.json` - evaluator input

Five cases covering the rich, thin, heading-less and boilerplate JDs plus a
retrieval failure, with `days` values spanning both schedule boundaries (1 and
60). The `jd` text is inlined because that is the evaluator's input contract; a
test in `tests/fixtures.test.ts` asserts each case still matches its source file
byte-for-byte, so the two cannot drift.

See [../docs/EVALUATOR.md](../docs/EVALUATOR.md).
