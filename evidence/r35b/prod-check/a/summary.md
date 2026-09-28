# WebFlix Golden Journey Run — Evidence Summary

- commit: `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
- branch: `wfx/r35b/journeys`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-28T13:25:00.336Z → 2026-09-28T13:26:13.949Z

**4 passed · 0 failed · 0 not-run (listed with procedures) · 4 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J14 | Source connect / reauthorize / disconnect | PASS | 10 | 3 |
| J15 | Recommendation feedback controls | PASS | 6 | 3 |
| J16 | Anti-tunnel / exploration after a single watched topic | PASS | 4 | 3 |

## Explicit limitations (never silent skips)

- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
- **J15** (local-only): The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.
- **J16** (local-only): Profile-LEVEL anti-tunnel (a concentrated watch history not permanently dominating the profile) is R05's service-side recommendation policy; the web fixtures session has no persistent profile. The feed-level exploration mechanics (kept runway, multi-item composition) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + a concentrated watch history through /experience/history, then verify the recommendation composition retains exploration (the R05 policy tests' scenario) with captured evidence.
