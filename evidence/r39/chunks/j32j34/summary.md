# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:32:10.771Z → 2026-10-02T10:33:12.808Z

**3 passed · 0 failed · 0 not-run (listed with procedures) · 3 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J32 | Source-neutral identity: same item, multiple realizations | PASS | 11 | 3 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | PASS | 64 | 10 |
| J34 | Capability discoverability from normal product surfaces | PASS | 44 | 3 |

## Explicit limitations (never silent skips)

- **J34** (local-only): R21-F: the twelve-task discoverability walk is encoded over the deterministic web-fixture boot (the same product surfaces, the same controls — fresh Home state, normal product paths only). The PRODUCTION parity sweep (J35) is the lead's journey against the live deployment.
  - procedure: LEAD (J35): run the same discoverability sweep against the production deployment and verify the R02/R03/R05/R06/R09/R14/R20 truths on the live surface.
- **J33** (local-only): The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.
  - procedure: LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.
