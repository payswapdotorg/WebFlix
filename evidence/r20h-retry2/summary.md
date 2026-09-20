# WebFlix Golden Journey Run — Evidence Summary

- commit: `9fe628d62d2045534db9003adadb9ca80f8430dc`
- branch: `HEAD`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T00:29:08.065Z → 2026-09-20T00:30:46.422Z

**2 passed · 1 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J11 | Library / watchlist / history | **FAIL** | 0 | 0 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | PASS | 6 | 3 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | PASS | 62 | 9 |

## Explicit limitations (never silent skips)

- **J17** (local-only): The explicit intent VOCABULARY (learn/happier/surprise/tonight/friend-taste) is the service-side intent submission (apps/api /experience/intents — session-scoped by design). The web session's query-intent mechanics (state/retain/replace, no preference corruption) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + submit each intent kind through /experience/intents, verify the session-scoped composition and the untouched long-term policy, and capture the affected feed surfaces.
- **J33** (local-only): The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.
  - procedure: LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.

## Failures

- **J11 Library / watchlist / history**: harness/browser failure: agent-browser command failed (-1): snapshot -i
✗ CDP command timed out: DOM.enable

proc: timed out after 30000ms
