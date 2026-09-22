# WebFlix Golden Journey Run — Evidence Summary

- commit: `d178a79ff627c6e4600a960486257ccbc7b9c35b`
- branch: `wfx/r26/web`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-22T17:21:07.878Z → 2026-09-22T17:23:31.621Z

**14 passed · 0 failed · 0 not-run (listed with procedures) · 14 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J15 | Recommendation feedback controls | PASS | 6 | 3 |
| J16 | Anti-tunnel / exploration after a single watched topic | PASS | 4 | 3 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | PASS | 6 | 3 |
| J18 | Attention modes: mindful / balanced / immersive / custom | PASS | 4 | 3 |
| J19 | WebFlix model / BYOM / local model policy | PASS | 11 | 3 |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | PASS | 18 | 3 |
| J21 | Authorized torrent acquisition (web limited-status surface) | PASS | 14 | 3 |
| J22 | Torrent metadata and file selection (web limited-status surface) | PASS | 7 | 3 |
| J23 | Torrent playback before full completion (web status surface) | PASS | 15 | 3 |
| J24 | Torrent background completion (web status surface) | PASS | 18 | 3 |
| J25 | Torrent interruption / restart / resume (web status surface) | PASS | 19 | 3 |
| J26 | Verified local asset appears in Library (web status/read surface) | PASS | 8 | 3 |
| J27 | Native local media playback (web constrained truth) | PASS | 6 | 3 |
| J28 | Provider credential expiry/recovery | PASS | 22 | 3 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J15** (local-only): The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.
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
- **J21** (desktop-procedure): The native ACQUISITION protocol path (real magnet/.torrent ingestion through the torrent engine) is the Desktop native-media lane. The web journey encodes the limited-status lifecycle UX over the deterministic scripted feed (the R14 surface); the native protocol path is the Desktop equivalent procedure.
  - procedure: DESKTOP (journeys/desktop/README.md): run the Desktop app with the native-media engine against an authorized source, drive the real acquisition lifecycle, and capture per-state screenshots + the same manifest format via agent-browser attached to the desktop webview (or the platform's instrumentation).
- **J23** (desktop-procedure): Native playback-before-completion (real verified-range streaming from an in-progress torrent session) is the Desktop path. The web encodes the honest status sequence (buffering → playing with runway → deadline-risk demotion).
  - procedure: DESKTOP (journeys/desktop/README.md): start an authorized acquisition, begin playback before completion, and capture the buffering/playing/rebuffer states with the real scheduler evidence.
- **J24** (desktop-procedure): Native background completion with real integrity verification is the Desktop path. The web encodes the completing/verifying/ready-offline status sequence and the earned-verdict grammar.
  - procedure: DESKTOP (journeys/desktop/README.md): let the acquisition complete in the background (app unfocused), capture the verification and Ready-offline states, and the Library exposure.
- **J25** (desktop-procedure): Native interruption/restart with persistent session recovery (crash-safe journals, piece-map reuse) is the Desktop path. The web encodes the recoverable-failure/retry/resuming-status grammar.
  - procedure: DESKTOP (journeys/desktop/README.md): interrupt an in-progress acquisition (kill the engine), restart the app, capture the resumed-not-fresh evidence (retained progress, no false completion), then complete it.
- **J27** (desktop-procedure): Native local media playback (the local range gateway + verified asset replay) is the Desktop path. The web encodes the constrained capability truth (settings table + the desktop-elsewhere note).
  - procedure: DESKTOP (journeys/desktop/README.md): play a verified offline asset from the Library through the native media engine, capture the playback + replay states.
