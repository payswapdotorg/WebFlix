# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:28:25.665Z → 2026-10-02T10:29:02.413Z

**5 passed · 0 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J11 | Library / watchlist / history | PASS | 11 | 3 |
| J12 | Cross-device resume | PASS | 5 | 3 |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 |
| J14 | Source connect / reauthorize / disconnect | PASS | 15 | 3 |
| J15 | Recommendation feedback controls | PASS | 6 | 3 |

## Explicit limitations (never silent skips)

- **J12** (configuration-limit): Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).
  - procedure: LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).
- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
- **J15** (local-only): The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.
