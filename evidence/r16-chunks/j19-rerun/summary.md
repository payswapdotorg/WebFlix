# WebFlix Golden Journey Run — Evidence Summary

- commit: `f467a8ba29f08d5212dcf31646c88552403ce9ad`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T16:56:01.111Z → 2026-09-20T16:56:37.921Z

**0 passed · 1 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J19 | WebFlix model / BYOM / local model policy | **FAIL** | 8 | 3 |

## Explicit limitations (never silent skips)

- **J19** (local-only): R21-B/R21-C: the web transport implements the R06 reads (model-policy, model-providers, BYOM, transforms) and the Model & AI section renders the REAL provider registry + per-task policy truth over them (the fixtures persona answers the service shapes). The real service-backed policy WRITES and BYOM key bindings run against the configured service (apps/api /experience/model-policy, /model-providers, BYOM routes) — the fixtures boot exercises the shapes deterministically.
  - procedure: LOCAL-ONLY: the service-mode boot + exercise the model-policy/provider routes (BYOM key binding, local-model policy, privacy constraints), capturing the policy surfaces.

## Failures

- **J19 WebFlix model / BYOM / local model policy**: journey assertion failed: the add-provider form renders (discover → configure is a real control, never a hidden API)
  expected: [data-wfx-byom-add-form] present in the DOM
  observed: 0 matching element(s)
