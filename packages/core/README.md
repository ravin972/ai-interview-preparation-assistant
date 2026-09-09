# @kit/core

Framework-independent business logic. This package is the source of truth for
requirement extraction, retrieval, research sequencing, LLM orchestration,
coverage, scheduling, merge/regeneration, schema validation and pipeline
execution.

**Hard boundary:** this package must never import Express, MongoDB, Next.js or
any HTTP framework. Persistence and transport live outside it. A test in
Phase 1 asserts this by scanning imports.

Both `apps/api` and `tools/evaluate` call the same `runPipeline()` exported
from here. See [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
