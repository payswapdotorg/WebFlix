# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T20:54:19.997Z → 2026-09-27T20:55:00.179Z

**1 passed · 4 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J11 | Library / watchlist / history | **FAIL** | 5 | 2 |
| J12 | Cross-device resume | **FAIL** | 1 | 2 |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 |
| J14 | Source connect / reauthorize / disconnect | **FAIL** | 2 | 2 |
| J15 | Recommendation feedback controls | **FAIL** | 6 | 2 |

## Explicit limitations (never silent skips)

- **J12** (configuration-limit): Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).
  - procedure: LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).
- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
- **J15** (local-only): The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.

## Failures

- **J11 Library / watchlist / history**: journey assertion failed: the watchlist is honestly empty on a fresh session (typed empty state, never fabricated saves)
  expected: the typed watchlist empty state
  observed: entries present or no empty state
- **J12 Cross-device resume**: journey assertion failed: the search surface offers the item
  expected: an item link
  observed: <absent>
- **J14 Source connect / reauthorize / disconnect**: journey assertion failed: the source card renders (the runtime's own sources read)
  expected: [data-wfx-source='fake-source'] present in the DOM
  observed: 0 matching element(s)
- **J15 Recommendation feedback controls**: journey assertion failed: the re-rank note names the composition decision (typed reasons — never a silent swap)
  expected: a note naming the replacement semantics
  observed: applied 16 replacement(s); 8 slot(s) kept
