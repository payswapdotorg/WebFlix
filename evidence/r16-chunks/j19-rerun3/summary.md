# WebFlix Golden Journey Run — Evidence Summary

- commit: `21c267f00872241df1136b322cf44be978b5d48a`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:00:54.735Z → 2026-09-20T17:01:30.375Z

**1 passed · 0 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J19 | WebFlix model / BYOM / local model policy | PASS | 11 | 3 |

## Explicit limitations (never silent skips)

- **J19** (local-only): R21-B/R21-C: the web transport implements the R06 reads (model-policy, model-providers, BYOM, transforms) and the Model & AI section renders the REAL provider registry + per-task policy truth over them (the fixtures persona answers the service shapes). The real service-backed policy WRITES and BYOM key bindings run against the configured service (apps/api /experience/model-policy, /model-providers, BYOM routes) — the fixtures boot exercises the shapes deterministically.
  - procedure: LOCAL-ONLY: the service-mode boot + exercise the model-policy/provider routes (BYOM key binding, local-model policy, privacy constraints), capturing the policy surfaces.
