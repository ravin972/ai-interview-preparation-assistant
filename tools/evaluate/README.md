# @kit/evaluate

The mandatory batch entry point:

```
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Runs the identical `runPipeline()` used by the API. No MongoDB, no auth, no
server. Each case is isolated so one failure never aborts the run. Set
`LLM_PROVIDER=mock` for a deterministic offline run.

Full contract: [../../docs/EVALUATOR.md](../../docs/EVALUATOR.md).
