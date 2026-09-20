# WebFlix Golden Journey Run — Evidence Summary

- commit: `21c267f00872241df1136b322cf44be978b5d48a`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:02:21.781Z → 2026-09-20T17:05:20.533Z

**6 passed · 1 failed · 0 not-run (listed with procedures) · 7 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J28 | Provider credential expiry/recovery | PASS | 22 | 3 |
| J29 | Network loss / playback recovery | PASS | 19 | 3 |
| J30 | Unsupported capability honesty | PASS | 12 | 3 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | **FAIL** | 9 | 0 |
| J32 | Source-neutral identity: same item, multiple realizations | PASS | 9 | 3 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | PASS | 62 | 9 |
| J34 | Capability discoverability from normal product surfaces | PASS | 42 | 3 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J34** (local-only): R21-F: the twelve-task discoverability walk is encoded over the deterministic web-fixture boot (the same product surfaces, the same controls — fresh Home state, normal product paths only). The PRODUCTION parity sweep (J35) is the lead's journey against the live deployment.
  - procedure: LEAD (J35): run the same discoverability sweep against the production deployment and verify the R02/R03/R05/R06/R09/R14/R20 truths on the live surface.
- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.
- **J33** (local-only): The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.
  - procedure: LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.

## Failures

- **J31 Cross-platform Web/Desktop parity (web-side anchors)**: harness/browser failure: agent-browser command failed (1): screenshot /home/z/webflix/evidence/r16-chunks/j28-j34/j31-cross-platform-parity.png
✗ CDP command timed out: Page.captureScreenshot
