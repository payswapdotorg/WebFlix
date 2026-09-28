# WebFlix Golden Journey Run — Evidence Summary

- commit: `09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b`
- branch: `wfx/r34c/accept-regression`
- environment: web-fixtures @ https://webflix-steel.vercel.app
- window: 2026-09-27T20:55:04.093Z → 2026-09-27T20:56:20.416Z

**2 passed · 3 failed · 0 not-run (listed with procedures) · 5 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J16 | Anti-tunnel / exploration after a single watched topic | **FAIL** | 2 | 2 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | **FAIL** | 3 | 2 |
| J18 | Attention modes: mindful / balanced / immersive / custom | PASS | 4 | 3 |
| J19 | WebFlix model / BYOM / local model policy | PASS | 11 | 3 |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | **FAIL** | 7 | 2 |

## Explicit limitations (never silent skips)

- **J16** (local-only): Profile-LEVEL anti-tunnel (a concentrated watch history not permanently dominating the profile) is R05's service-side recommendation policy; the web fixtures session has no persistent profile. The feed-level exploration mechanics (kept runway, multi-item composition) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + a concentrated watch history through /experience/history, then verify the recommendation composition retains exploration (the R05 policy tests' scenario) with captured evidence.
- **J17** (local-only): The explicit intent VOCABULARY (learn/happier/surprise/tonight/friend-taste) is the service-side intent submission (apps/api /experience/intents — session-scoped by design). The web session's query-intent mechanics (state/retain/replace, no preference corruption) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + submit each intent kind through /experience/intents, verify the session-scoped composition and the untouched long-term policy, and capture the affected feed surfaces.
- **J18** (local-only): SWITCHING attention modes (mindful=3-swipe / immersive=none / custom) is the service-side policy submission (apps/api /experience/policy). The web session boots the balanced default; its observable threshold behavior (no re-rank below 5, re-rank at 5) is encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + set each attention mode through /experience/policy, then drive the short feed and capture the mode-specific re-rank behavior (mindful fires at 3 swipes; immersive does not auto re-rank).
- **J19** (local-only): R21-B/R21-C: the web transport implements the R06 reads (model-policy, model-providers, BYOM, transforms) and the Model & AI section renders the REAL provider registry + per-task policy truth over them (the fixtures persona answers the service shapes). The real service-backed policy WRITES and BYOM key bindings run against the configured service (apps/api /experience/model-policy, /model-providers, BYOM routes) — the fixtures boot exercises the shapes deterministically.
  - procedure: LOCAL-ONLY: the service-mode boot + exercise the model-policy/provider routes (BYOM key binding, local-model policy, privacy constraints), capturing the policy surfaces.
- **J20** (local-only): R21-E: the AI ACTION TRAY is the web surface of the completed transforms transport (the R21-B/R21-C model-controls seam — the fixtures persona answers the service shapes deterministically): the five frozen actions, the model-class truth, the named preconditions, and the typed queued/cancelled operation states are encoded. The full pipeline's running→succeeded transitions (real progress + result payloads) are the service-side fabric (apps/api /experience/transforms).
  - procedure: LOCAL-ONLY: the service-mode boot + start each transformation operation through the tray (or /experience/transforms), capture the explicit running and completed states with results.

## Failures

- **J16 Anti-tunnel / exploration after a single watched topic**: journey assertion failed: the re-rank after concentrated engagement keeps the feed's runway (anti-tunnel: the plan never collapses to the watched topic)
  expected: a kept-runway composition note
  observed: applied 16 replacement(s); 8 slot(s) kept
- **J17 Explicit intent: learn / happier / surprise / tonight / friend taste**: journey assertion failed: a new intent composes a fresh answer (the intent is replaceable, never sticky in this session)
  expected: a fresh result set for 'harbor'
  observed: 0 result cards
- **J20 AI subtitles / translation / transcription / dubbing / commentary**: journey assertion failed: the home feed offers the card "Asteroid Drift"
  expected: an aria-labeled card link for "Asteroid Drift"
  observed: no matching card
