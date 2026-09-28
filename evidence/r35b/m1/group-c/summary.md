# WebFlix Golden Journey Run — Evidence Summary

- commit: `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
- branch: `wfx/r35b/journeys`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T12:35:37.063Z → 2026-09-28T12:36:22.603Z

**3 passed · 2 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J14 | Source connect / reauthorize / disconnect | PASS | 11 | 3 |
| J15 | Recommendation feedback controls | PASS | 6 | 3 |
| J16 | Anti-tunnel / exploration after a single watched topic | PASS | 4 | 3 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | **FAIL** | 5 | 3 |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | **FAIL** | 17 | 3 |

## Explicit limitations (never silent skips)

- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
- **J15** (local-only): The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.
- **J16** (local-only): Profile-LEVEL anti-tunnel (a concentrated watch history not permanently dominating the profile) is R05's service-side recommendation policy; the web fixtures session has no persistent profile. The feed-level exploration mechanics (kept runway, multi-item composition) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + a concentrated watch history through /experience/history, then verify the recommendation composition retains exploration (the R05 policy tests' scenario) with captured evidence.
- **J17** (local-only): The explicit intent VOCABULARY (learn/happier/surprise/tonight/friend-taste) is the service-side intent submission (apps/api /experience/intents — session-scoped by design). The web session's query-intent mechanics (state/retain/replace, no preference corruption) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + submit each intent kind through /experience/intents, verify the session-scoped composition and the untouched long-term policy, and capture the affected feed surfaces.
- **J20** (local-only): R21-E: the AI ACTION TRAY is the web surface of the completed transforms transport (the R21-B/R21-C model-controls seam — the fixtures persona answers the service shapes deterministically): the five frozen actions, the model-class truth, the named preconditions, and the typed queued/cancelled operation states are encoded. The full pipeline's running→succeeded transitions (real progress + result payloads) are the service-side fabric (apps/api /experience/transforms).
  - procedure: LOCAL-ONLY: the service-mode boot + start each transformation operation through the tray (or /experience/transforms), capture the explicit running and completed states with results.

## Failures

- **J17 Explicit intent: learn / happier / surprise / tonight / friend taste**: journey assertion failed: the home composition renders after the session intents (no corrupted feed)
  expected: [data-wfx-hero] present in the DOM
  observed: 0 matching element(s)
- **J20 AI subtitles / translation / transcription / dubbing / commentary**: journey assertion failed: the player carries the same AI action tray (transforming what is playing — the primary discovery surface)
  expected: [data-wfx-ai-tray-surface='player'] present in the DOM
  observed: 0 matching element(s)
