# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T21:02:46.636Z → 2026-09-27T21:03:24.461Z

**0 passed · 4 failed · 0 not-run (listed with procedures) · 4 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J32 | Source-neutral identity: same item, multiple realizations | **FAIL** | 1 | 2 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | **FAIL** | 1 | 2 |
| J34 | Capability discoverability from normal product surfaces | **FAIL** | 3 | 2 |
| J36 | Major user journey completion / no dead-end discovery | **FAIL** | 7 | 2 |

## Explicit limitations (never silent skips)

- **J36** (configuration-limit): The R22-G encoding runs the full J36 completion walk over the deterministic fixtures boot: the register round trip uses the scripted dev persona (the loud dev badge — the REAL /api/auth/register transport's email-taken/validation round trips are service-mode, proven at the contract level by packages/client-runtime/tests/account-creation.test.ts); the source chooser's connected truth and the BYOF import ride the fixture connectors (the REAL provider OAuth dance is J14/J28's service-side procedure); the Shorts like/save typed absence is the fixture source's own capability truth (the hydration law is asserted as capability-truth, not blanket presence).
  - procedure: LEAD (the production sweep): deploy the integrated tree, run this journey with --base-url against the deployed service-mode boot (real register transport, a real connectable connector, a source that declares like/save), and capture the evidence under evidence/r22/ — the J35 production-parity sweep covers the same deployment.
- **J34** (local-only): R21-F: the twelve-task discoverability walk is encoded over the deterministic web-fixture boot (the same product surfaces, the same controls — fresh Home state, normal product paths only). The PRODUCTION parity sweep (J35) is the lead's journey against the live deployment.
  - procedure: LEAD (J35): run the same discoverability sweep against the production deployment and verify the R02/R03/R05/R06/R09/R14/R20 truths on the live surface.
- **J33** (local-only): The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.
  - procedure: LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.

## Failures

- **J32 Source-neutral identity: same item, multiple realizations**: journey assertion failed: the search card links the CANONICAL identity (id-first, not source-first)
  expected: an /item?id=wfxitm_… link
  observed: <absent>
- **J33 Bring Your Own Feed: import, preview, confirm, sync, provenance**: journey assertion failed: the BYOF drive state resets to pristine before the journey (determinism)
  expected: HTTP 200 from the dev-reset drive
  observed: HTTP 400
- **J34 Capability discoverability from normal product surfaces**: journey assertion failed: Home offers the source-connection CTA in context (task 2: connect a source)
  expected: [data-wfx-source-connect-cta] present in the DOM
  observed: 0 matching element(s)
- **J36 Major user journey completion / no dead-end discovery**: harness/browser failure: agent-browser command failed (-1): wait [data-wfx-session-signed-in]
✗ Wait timed out after 25000ms

proc: timed out after 20000ms
