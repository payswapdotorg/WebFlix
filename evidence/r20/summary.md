# WebFlix Golden Journey Run — Evidence Summary

- commit: `648b8e695c7dbebd11c30ca12bc13cc744c530da`
- branch: `wfx/r20/byof-web`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-19T21:49:04.197Z → 2026-09-19T21:52:54.784Z

**33 passed · 0 failed · 0 not-run (listed with procedures) · 33 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | PASS | 18 | 3 |
| J02 | Home discovery / hero / rows / intent entry | PASS | 13 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | PASS | 6 | 3 |
| J06 | Item detail / availability / realization choice | PASS | 11 | 3 |
| J07 | Official embed playback | PASS | 13 | 3 |
| J08 | Contained Browser playback | PASS | 10 | 3 |
| J09 | External playback fallback / return context | PASS | 13 | 3 |
| J10 | Like/save/action synchronization truth | PASS | 9 | 3 |
| J11 | Library / watchlist / history | PASS | 11 | 3 |
| J12 | Cross-device resume | PASS | 6 | 3 |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 |
| J14 | Source connect / reauthorize / disconnect | PASS | 11 | 3 |
| J15 | Recommendation feedback controls | PASS | 6 | 3 |
| J16 | Anti-tunnel / exploration after a single watched topic | PASS | 4 | 3 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | PASS | 6 | 3 |
| J18 | Attention modes: mindful / balanced / immersive / custom | PASS | 4 | 3 |
| J19 | WebFlix model / BYOM / local model policy | PASS | 5 | 3 |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | PASS | 9 | 3 |
| J21 | Authorized torrent acquisition (web limited-status surface) | PASS | 14 | 3 |
| J22 | Torrent metadata and file selection (web limited-status surface) | PASS | 7 | 3 |
| J23 | Torrent playback before full completion (web status surface) | PASS | 15 | 3 |
| J24 | Torrent background completion (web status surface) | PASS | 18 | 3 |
| J25 | Torrent interruption / restart / resume (web status surface) | PASS | 19 | 3 |
| J26 | Verified local asset appears in Library (web status/read surface) | PASS | 8 | 3 |
| J27 | Native local media playback (web constrained truth) | PASS | 6 | 3 |
| J28 | Provider credential expiry/recovery | PASS | 22 | 3 |
| J29 | Network loss / playback recovery | PASS | 19 | 3 |
| J30 | Unsupported capability honesty | PASS | 12 | 3 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | PASS | 9 | 3 |
| J32 | Source-neutral identity: same item, multiple realizations | PASS | 9 | 3 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | PASS | 62 | 9 |

## Explicit limitations (never silent skips)

- **J28** (local-only): The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J09** (configuration-limit): The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.
  - procedure: LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode="external" handoff + the return-context link under evidence/<run>/.
- **J12** (configuration-limit): Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).
  - procedure: LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).
- **J14** (local-only): The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.
  - procedure: LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.
- **J15** (local-only): The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.
- **J16** (local-only): Profile-LEVEL anti-tunnel (a concentrated watch history not permanently dominating the profile) is R05's service-side recommendation policy; the web fixtures session has no persistent profile. The feed-level exploration mechanics (kept runway, multi-item composition) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + a concentrated watch history through /experience/history, then verify the recommendation composition retains exploration (the R05 policy tests' scenario) with captured evidence.
- **J17** (local-only): The explicit intent VOCABULARY (learn/happier/surprise/tonight/friend-taste) is the service-side intent submission (apps/api /experience/intents — session-scoped by design). The web session's query-intent mechanics (state/retain/replace, no preference corruption) are encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + submit each intent kind through /experience/intents, verify the session-scoped composition and the untouched long-term policy, and capture the affected feed surfaces.
- **J18** (local-only): SWITCHING attention modes (mindful=3-swipe / immersive=none / custom) is the service-side policy submission (apps/api /experience/policy). The web session boots the balanced default; its observable threshold behavior (no re-rank below 5, re-rank at 5) is encoded.
  - procedure: LOCAL-ONLY: the service-mode boot + set each attention mode through /experience/policy, then drive the short feed and capture the mode-specific re-rank behavior (mindful fires at 3 swipes; immersive does not auto re-rank).
- **J19** (local-only): The WebFlix-model / BYOM / local-model policy with privacy/cost/fallback constraints is R06's service surface (apps/api /experience/model-policy, /model-providers, BYOM bindings). The web adapter renders the typed honest-absent state (encoded — never placeholder controls).
  - procedure: LOCAL-ONLY: the service-mode boot + exercise the model-policy/provider routes (BYOM key binding, local-model policy, privacy constraints), capturing the policy surfaces.
- **J20** (local-only): The AI transformation operations with explicit progress/result states (transcription, subtitles, translation, dubbing, commentary) are the service-side transforms surface (apps/api /experience/transforms). The web renders the typed honest absence with the vocabulary named (encoded).
  - procedure: LOCAL-ONLY: the service-mode boot + start each transformation operation through /experience/transforms, capture the explicit in-progress and completed states.
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
- **J31** (configuration-limit): The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.
  - procedure: LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.
- **J05** (known-defect): FOUND BY THIS HARNESS (reported for an apps/web fix — outside R16's allowed paths): opening /search with NO query throws a typed RuntimeError (invalid-input: empty query) before the empty-query state can render — apps/web/src/app/search/page.tsx calls loadSearchView unguarded. The SearchSurface's data-wfx-search-state="empty-query" branch is currently unreachable. The encoded J05 asserts the reachable states (results/no-results/intent retention) and does NOT encode the crash as pass.
  - procedure: FIX (apps/web lane): guard the empty query in the search page (render the empty-query state without calling the runtime), then re-run `bun run journeys:web` — J05's limitation entry can be removed and the empty-query state added to the encoded assertions.
- **J33** (local-only): The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.
  - procedure: LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.
