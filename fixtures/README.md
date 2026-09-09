# fixtures

Deterministic inputs for tests, CI and local evaluator runs.

- `site/` - a small static "Acme" company site (home, about, careers, an
  interview-process page, plus deliberate dead links and a robots.txt) served
  on `localhost:8099` to mirror the evaluator's local host. Exercises the
  homepage gate, relative-link resolution, link ranking, hiring-page discovery
  and partial retrieval failure.
- `jds/` - job descriptions covering the requirement-extraction cases: rich,
  thin/two-line, heading-less, and benefits/EEO-boilerplate-heavy.

Populated in Phase 0. See [../docs/EVALUATOR.md](../docs/EVALUATOR.md).
