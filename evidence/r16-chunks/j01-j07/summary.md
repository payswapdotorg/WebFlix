# WebFlix Golden Journey Run — Evidence Summary

- commit: `b4cf97be8fae95f92d7aa0c64a9e275425b0b530`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:29:27.500Z → 2026-09-20T17:29:48.416Z

**0 passed · 7 failed · 0 not-run (listed with procedures) · 7 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | **FAIL** | 0 | 0 |
| J02 | Home discovery / hero / rows / intent entry | **FAIL** | 0 | 2 |
| J03 | Long-form Watch browsing | **FAIL** | 0 | 2 |
| J04 | Shorts vertical discovery | **FAIL** | 0 | 2 |
| J05 | Unified search | **FAIL** | 0 | 2 |
| J06 | Item detail / availability / realization choice | **FAIL** | 0 | 2 |
| J07 | Official embed playback | **FAIL** | 0 | 2 |

## Explicit limitations (never silent skips)

- **J05** (known-defect): FOUND BY THIS HARNESS (reported for an apps/web fix — outside R16's allowed paths): opening /search with NO query throws a typed RuntimeError (invalid-input: empty query) before the empty-query state can render — apps/web/src/app/search/page.tsx calls loadSearchView unguarded. The SearchSurface's data-wfx-search-state="empty-query" branch is currently unreachable. The encoded J05 asserts the reachable states (results/no-results/intent retention) and does NOT encode the crash as pass.
  - procedure: FIX (apps/web lane): guard the empty query in the search page (render the empty-query state without calling the runtime), then re-run `bun run journeys:web` — J05's limitation entry can be removed and the empty-query state added to the encoded assertions.

## Failures

- **J01 First launch / profile selection / onboarding**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J02 Home discovery / hero / rows / intent entry**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J03 Long-form Watch browsing**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/watch
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J04 Shorts vertical discovery**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/shorts
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J05 Unified search**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/search?q=rain
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J06 Item detail / availability / realization choice**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J07 Official embed playback**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/search?q=Harbor
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
