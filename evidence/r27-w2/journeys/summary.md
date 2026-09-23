# WebFlix Golden Journey Run — Evidence Summary

- commit: `9b078225371115410d4f8f956527ecbb474183f8`
- branch: `wfx/r27/web`
- environment: web-fixtures @ http://localhost:3101 (CI configuration)
- window: 2026-09-23T19:05:10.802Z → 2026-09-23T19:13:03.766Z

**33 passed · 8 failed · 0 not-run (listed with procedures) · 41 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | **FAIL** | 6 | 3 |
| J02 | Home discovery / hero / rows / intent entry | **FAIL** | 4 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | PASS | 7 | 3 |
| J06 | Item detail / availability / realization choice | PASS | 11 | 3 |
| J07 | Official embed playback | PASS | 13 | 3 |
| J08 | Contained Browser playback | PASS | 10 | 3 |
| J09 | External playback fallback / return context | PASS | 13 | 3 |
| J10 | Like/save/action synchronization truth | PASS | 9 | 3 |
| J11 | Library / watchlist / history | **FAIL** | 6 | 3 |
| J12 | Cross-device resume | PASS | 6 | 3 |
| J13 | Account/profile/identity lifecycle | PASS | 5 | 3 |
| J14 | Source connect / reauthorize / disconnect | PASS | 11 | 3 |
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
| J25 | Torrent interruption / restart / resume (web status surface) | **FAIL** | 9 | 3 |
| J26 | Verified local asset appears in Library (web status/read surface) | PASS | 8 | 3 |
| J27 | Native local media playback (web constrained truth) | PASS | 6 | 3 |
| J28 | Provider credential expiry/recovery | PASS | 22 | 3 |
| J29 | Network loss / playback recovery | PASS | 19 | 3 |
| J30 | Unsupported capability honesty | PASS | 12 | 3 |
| J31 | Cross-platform Web/Desktop parity (web-side anchors) | PASS | 9 | 3 |
| J32 | Source-neutral identity: same item, multiple realizations | PASS | 9 | 3 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | **FAIL** | 35 | 5 |
| J34 | Capability discoverability from normal product surfaces | PASS | 42 | 3 |
| J36 | Major user journey completion / no dead-end discovery | **FAIL** | 41 | 3 |
| J37 | Anonymous public viewing without WebFlix login | PASS | 18 | 3 |
| J38 | First-class torrent playback (web: browser-capable + honest fallbacks) | PASS | 42 | 3 |
| J39 | Multimodal media intelligence / semantic moment discovery | **FAIL** | 22 | 3 |
| J40 | YouTube viewer parity | PASS | 39 | 3 |
| J41 | YouTube-equivalent playback startup | PASS | 46 | 3 |
| J43 | Realtime translation | **FAIL** | 8 | 3 |

## Explicit limitations (never silent skips)

- **J36** (configuration-limit): The R22-G encoding runs the full J36 completion walk over the deterministic fixtures boot: the register round trip uses the scripted dev persona (the loud dev badge — the REAL /api/auth/register transport's email-taken/validation round trips are service-mode, proven at the contract level by packages/client-runtime/tests/account-creation.test.ts); the source chooser's connected truth and the BYOF import ride the fixture connectors (the REAL provider OAuth dance is J14/J28's service-side procedure); the Shorts like/save typed absence is the fixture source's own capability truth (the hydration law is asserted as capability-truth, not blanket presence).
  - procedure: LEAD (the production sweep): deploy the integrated tree, run this journey with --base-url against the deployed service-mode boot (real register transport, a real connectable connector, a source that declares like/save), and capture the evidence under evidence/r22/ — the J35 production-parity sweep covers the same deployment.
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
- **J19** (local-only): R21-B/R21-C: the web transport implements the R06 reads (model-policy, model-providers, BYOM, transforms) and the Model & AI section renders the REAL provider registry + per-task policy truth over them (the fixtures persona answers the service shapes). The real service-backed policy WRITES and BYOM key bindings run against the configured service (apps/api /experience/model-policy, /model-providers, BYOM routes) — the fixtures boot exercises the shapes deterministically.
  - procedure: LOCAL-ONLY: the service-mode boot + exercise the model-policy/provider routes (BYOM key binding, local-model policy, privacy constraints), capturing the policy surfaces.
- **J20** (local-only): R21-E: the AI ACTION TRAY is the web surface of the completed transforms transport (the R21-B/R21-C model-controls seam — the fixtures persona answers the service shapes deterministically): the five frozen actions, the model-class truth, the named preconditions, and the typed queued/cancelled operation states are encoded. The full pipeline's running→succeeded transitions (real progress + result payloads) are the service-side fabric (apps/api /experience/transforms).
  - procedure: LOCAL-ONLY: the service-mode boot + start each transformation operation through the tray (or /experience/transforms), capture the explicit running and completed states with results.
- **J34** (local-only): R21-F: the twelve-task discoverability walk is encoded over the deterministic web-fixture boot (the same product surfaces, the same controls — fresh Home state, normal product paths only). The PRODUCTION parity sweep (J35) is the lead's journey against the live deployment.
  - procedure: LEAD (J35): run the same discoverability sweep against the production deployment and verify the R02/R03/R05/R06/R09/R14/R20 truths on the live surface.
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
- **J38** (configuration-limit): The R23-W2 web encoding drives the FIRST-CLASS peer-copy surfaces end to end over the fixtures' scripted acquisition feed (the same protocol-free facts through the REAL acquisition store the J21-J26 chain validates), the honest Desktop next step for ordinary swarms, and the adapter/WebRTC environment truth behind progressive disclosure. A REAL WebRTC swarm — live hybrid peers streaming bytes into the browser video element through the R23-D adapter — requires a reachable swarm the sandbox does not have; the adapter binding (webtorrent@3.0.21 browser build, lazy-loaded) is the real code path for that environment.
  - procedure: LOCAL-ONLY (the WebRTC-capable scenario): serve a .torrent whose swarm includes WebRTC-capable peers (a WebTorrent hybrid client seeding legally-owned content) over a reachable wss tracker, register the authorized copy on the source, open its player, and capture the live streaming + the verified-asset landing under evidence/<run>/; the Desktop native path is Worker 3's J38 procedure.
- **J33** (local-only): The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.
  - procedure: LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.
- **J41** (configuration-limit): The R24-W2 web encoding measures the REAL startup path over the fixtures boot (the complete assertable marker set — the click-bridged trace origin, the streamed shell's parse, the phase declaration, the first frame at the contained-surface boundary, the seek/control pairs, the realization-switch pair — plus the MEASURED startup architecture laws: the first frame preceding every enrichment mount, the evidence-anchored position, the retained raw observations). The YouTube COMPARATIVE baseline is honestly out of scope in this configuration: the fixture catalog's content is WebFlix-internal (no identical public YouTube content — the same-content law answers samePublicContentOnYouTube=false), and this sandbox has no route to the public YouTube product. The FRESH-SESSION cold/warm cache battery (a brand-new browser per cold pass, the same browser for the warm pass) is the benchmark harness's own record under evidence/r24-w2/benchmark/ — the journey's session is shared with J01-J40 (its passes are warm by construction, which the journey never claims otherwise).
  - procedure: LEAD (the comparative protocol — the plan's lead-owned 'comparative performance test protocol'): select real public content available on BOTH systems, run the same browser/device/network profile over cold and warm cache passes on WebFlix AND YouTube, record the same metric set (the shared telemetry contract's marker pairs), evaluate the frozen R24-E thresholds (p50 +150ms / p75 +300ms / p95 +750ms TTFF deltas, startup failure +0.5pp, first-60s rebuffer +0.25pp), and attach the traces + the evaluation record under evidence/r24-lab/. The WebFlix-internal benchmark record (evidence/r24-w2/benchmark/) is the standing measurement of this lane's startup architecture laws.
- **J43** (configuration-limit): The R25-W2 encoding drives the FULL J43 walk over the fixtures boot's REAL realtime composition: the browser WebSocket → the WebFlix bridge (ws on 3102, started by the dev boot's instrumentation) → the provider session seam (the frozen R25-A domain port) with the deterministic dev provider double behind it (a REAL second WebSocket hop on 3103 — the scripted bilingual media scripts, the real PCM16 translated-speech chunks, the scripted provider drop + the scripted client network blip). The TRANSPORT, the reconnect/resume machinery, the continuity, the cost-policy verdicts (the shared Model-Fabric policy engine), and the R25-L instrumentation are all the real production wiring of this configuration. The provider-side LATENCY figures are the dev double's MODELED profile (the plan's frozen research numbers — the ~2.3s reported lag), honestly recorded as such in the metrics (the provider-reported figure rides alongside the measured one); the LIVE Qwen endpoint's end-to-end latency/cost benchmark — real credentials, real audio, the production Vercel WebSocket deployment — is the lead's R25-L procedure, and the bridge's service-mode deployment (the Vercel function transport) is the lead's R25 deployment verification.
  - procedure: LEAD (the live-provider benchmark): provision the provider credentials server-side (never in the client), register the realtime adapter through Model Fabric, deploy the bridge on the WebSocket-capable function transport, run the same J43 walk + the r25 web latency harness (apps/web/scripts/r25-web-latency.ts --base-url) against the deployed service, and record the measured R25-L numbers (first source/translation deltas, first speech chunk, stable segment, reconnect, drift) with the live provider's provenance under evidence/r25-lab/.
- **J40** (configuration-limit): The R24-W2 encoding walks the viewer-parity flow end to end over the fixtures boot: the walk's own watchlist/playlist/queue WRITES answer their typed success at the CONTROLS (the 'Saved' status, the queue-add's outcome state, the write routes' dev-boot bridge resolving the item through the runtime's own search seam), but the cross-PAGE read of those writes (the Library page listing them) is kept apart by the dev boot's per-route module graphs — the same documented doctrine the J12 limitation records for the watch-state fold (the single-bundle production boot shares one runtime instance: the writes are visible there). The Library assertions therefore carry the fresh session's HONEST states (the typed empty states — J11's own law) plus the sections' presence (the pairing laws).
  - procedure: LEAD (the production parity sweep — the J35-class run): deploy the integrated tree (the single-bundle production build), drive the same J40 walk against the deployed boot, and capture the Library showing the walk's own watchlist/playlist writes under evidence/<run>/ (the production runtime is one instance: the writes cross pages).

## Failures

- **J01 First launch / profile selection / onboarding**: journey assertion failed: the primary navigation names the "Search" surface in BOTH landmarks
  expected: 2 nav links labeled "Search"
  observed: 0 links
- **J02 Home discovery / hero / rows / intent entry**: journey assertion failed: Continue Watching is honestly absent on a fresh session (no fabricated resume entries)
  expected: [data-wfx-row='continue'] matches exactly 0
  observed: 1 matching element(s)
- **J11 Library / watchlist / history**: journey assertion failed: the history is honestly empty on a fresh session (typed empty state, never fabricated history)
  expected: the typed history empty state
  observed: entries present or no empty state
- **J25 Torrent interruption / restart / resume (web status surface)**: harness/browser failure: agent-browser command failed (-1): pollTextContains "Finding the details for this title." in [data-wfx-acquisition-detail]
timed out after 30000ms; last observed: The download source had a problem. You can try again.
- **J33 Bring Your Own Feed: import, preview, confirm, sync, provenance**: journey assertion failed: the WebFlix history stays untouched by the import
  expected: text of [data-wfx-library-history] contains "No watch history yet"
  observed: "History

wfxitm_0SGFAY4SD8PWR253NJ0623WB4J

Source unknown in this session

In progress at 45s"
- **J36 Major user journey completion / no dead-end discovery**: journey assertion failed: the bound-provider list renders after the bind (configure → verified state)
  expected: [data-wfx-byom-bound-list] present in the DOM
  observed: 0 matching element(s)
- **J39 Multimodal media intelligence / semantic moment discovery**: journey assertion failed: the honest gap: no low-latency live route is registered (never a fake live lane)
  expected: [data-wfx-live-captions-state="no-route"] present in the DOM
  observed: 0 matching element(s)
- **J43 Realtime translation**: harness/browser failure: agent-browser command failed (1): click [data-wfx-translate-target='es']
✗ Element '[data-wfx-translate-target='es']' is covered by <input.wfx-search__input> at its click point, so the input would land on that element instead. Dismiss or interact with the covering element first (it is often a dialog, banner, or sticky header).
