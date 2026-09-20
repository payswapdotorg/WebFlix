# WebFlix Golden Journey Run — Evidence Summary

- commit: `b4cf97be8fae95f92d7aa0c64a9e275425b0b530`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:31:18.153Z → 2026-09-20T17:32:03.752Z

**7 passed · 0 failed · 0 not-run (listed with procedures) · 7 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | PASS | 18 | 3 |
| J02 | Home discovery / hero / rows / intent entry | PASS | 13 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | PASS | 6 | 3 |
| J06 | Item detail / availability / realization choice | PASS | 11 | 3 |
| J07 | Official embed playback | PASS | 13 | 3 |

## Explicit limitations (never silent skips)

- **J05** (known-defect): FOUND BY THIS HARNESS (reported for an apps/web fix — outside R16's allowed paths): opening /search with NO query throws a typed RuntimeError (invalid-input: empty query) before the empty-query state can render — apps/web/src/app/search/page.tsx calls loadSearchView unguarded. The SearchSurface's data-wfx-search-state="empty-query" branch is currently unreachable. The encoded J05 asserts the reachable states (results/no-results/intent retention) and does NOT encode the crash as pass.
  - procedure: FIX (apps/web lane): guard the empty query in the search page (render the empty-query state without calling the runtime), then re-run `bun run journeys:web` — J05's limitation entry can be removed and the empty-query state added to the encoded assertions.
