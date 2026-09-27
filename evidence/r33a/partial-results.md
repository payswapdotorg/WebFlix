# R33-A — PARTIAL RESULTS (the re-entry record)

Lane: `wfx/r33a/shorts-player` from `main @ 178873a`. The operator's #1:
"the shorts are still bad" — the shorts surface is the placeholder-art card
stack with NO media element (the R32 divergence ledger row 8). This lane
closes that gap with the REAL machinery.

## DONE

### 0. Boot + survey (COMPLETE)

- Cloned the repo, checked out `main @ 178873a` (the battery floor 5200/1/0),
  created `wfx/r33a/shorts-player`. HEAD = 178873a (deploy retrigger R33).
- SURVEYED (read fully, cited in the code):
  - `components/shorts/ShortsFeed.tsx` (1113 lines) — the feed stack: the
    frozen presenter wiring (swipe/touch/keys/buttons → ONE presenter), the
    R32 rail join (`renderElements`'s `case "card"` — the article with
    placeholder-art background + monogram + overlay [channel row + title +
    meta + badge] + the `wfx-shortrail` for the current card), the
    `RenderContext` seam (`onAction`/`actionStates`/`art`/`monogram`/
    `channel`/`subscribe`), the session realization index
    (`realizationIndexRef` — boot page + every fresh re-rank page), the
    R24-W2 parity controls (speed/clear-screen/feedback/source chip), the
    re-rank loop, the skip/share event seams.
  - `app/shorts/page.tsx` + `host/shorts.ts` — the boot payload (page/policy/
    identity/seedQuery/prefetchAhead/sourceNames/subscriptions) over
    `runtime.shorts({query: SHORTS_SEED_QUERY})`; the projection carries
    `capabilities: []` + `availability: "unknown"` (honest).
  - `components/player/EmbedStage.tsx` — the containment law (the
    control-bound YouTube family on `www.youtube-nocookie.com` +
    `CONTROL_BOUND_SANDBOX`; every other provider keeps
    `OPAQUE_ORIGIN_SANDBOX`), the unmute affordance ("Sound off — tap to
    unmute", evidence-gated on provider-reported `muted === true`).
  - `embed-presentation.ts` — the SHARED presentation law
    (`providerFamilyOf` + `presentationSrcOf`: the nocookie host
    substitution + `enablejsapi=1` + `autoplay=1&mute=1` — the muted
    autoplay pair).
  - `embed-session-client.ts` — the provider state broadcast (the listening
    handshake, 3s honest timeout re-armed on frame load, the widget
    postMessage protocol, `infoDelivery`/`initialDelivery`/`onStateChange`
    evidence, the 5s-throttled progress folds + complete-on-ended through
    POST /api/events with `playbackSessionId`, the final fold at unbind).
  - `PlayerChrome.tsx` + `PlayerSurface.tsx` — how the watch surface binds
    chrome to the provider channel (issue(): provider command FIRST, then
    the /api/playback record with the client-carried intent; the k/m
    keyboard grammar with the typing guard; the evidence store overriding
    the visible phase only when `live`).
  - `HoverPreviewLayer.tsx` + `hover-preview-client.ts` — the R28-B pattern
    (the non-watch surface staging the real provider embed: the dwell-gated
    resolve through `GET /api/preview` with the per-item client cache, the
    scoped provider channel binding with `setMuted`/`setRate`, the
    singleton discipline, the preview-never-writes-watch-state law).
  - `app/api/preview/route.ts` — the resolve seam (`serverPort.resolve(ref)`
    → the first embed realization the web platform can contain; the honest
    no-previewable-media reason; the per-boot FIFO cache).
  - `host/playback-bridge.ts` + `app/api/playback/route.ts` +
    `host/view-models.ts` (the player shell's media path) — the SESSION
    SEAM: `resolvePlayback` → `controller.prepare()` →
    `recordPlaybackSession` (the bridge intent) server-side; the chrome
    POSTs `/api/playback {sessionId, command, intent}` (provider command
    first, runtime record second); watch-state folds POST `/api/events`
    (the closed progress/complete/skip vocabulary with playbackSessionId;
    "start" is the runtime's own — rejected client-side).
  - `WatchStateReporter.tsx` — the explicit report controls (complete/skip).
  - The corpus: `docs/parity-lab/r30/gap-captures/20260926-093102/
    G4-CORPUS.md` (THE PLAYER: "Vertical 716×716, autoplaying (readyState
    4, paused false, blob src)"; the top chrome: pause k / mute m / CC /
    more / fullscreen f, auto-hiding; the 56×56 prev/next arrows; the rail
    grammar) + `g4-rail-extras.json` (the chrome rects) +
    `docs/parity-lab/r28/youtube/shorts-anatomy.md` (the vertical feed
    anatomy) + the R32 divergence ledger (rows 7 + 8).
  - The test patterns: `apps/web/tests/shorts-rail-parity.test.ts` (the R32
    lane tests — bootHost/renderFeed conventions), `shorts-parity.test.ts`
    (the R24-W2 pinned controls), `tests/parity-conformance.test.ts` (19/19).
  - The fixture corpus: `packages/experience/src/fixtures.ts` — the fixture
    shorts (fake:short-1 "Neon Rain", fake:short-2 "Midnight Scoop",
    fake:short-3 "Rain Check") each carry an `embed` realization at
    `https://fixture.invalid/embed/fake:short-N` (not a real provider host —
    `providerFamilyOf` answers "unknown" → the opaque-origin sandbox + no
    control channel; the honest unbound state, live-verifiable).
  - The deployed Experience API is reachable from this sandbox
    (`https://webflix-api.vercel.app` — resolve answers REAL YouTube embed
    realizations for real refs) → the live browser verification can boot
    the dev server in SERVICE mode against it (the R30-B service-boot
    pattern) for a REAL playing embed.

### 1. THE DESIGN (FROZEN before code — the laws' projection)

- **THE STAGE** (`components/shorts/ShortsMediaStage.tsx` + its client
  `shorts-stage-client.ts`, both NEW): per current card, resolve the item's
  playable realization at view time through THE SAME seam the hover preview
  uses (`GET /api/preview?connectorId=&ref=`, per-item client cache); when
  available, mount the real provider embed full-bleed in the card via the
  shared presentation law VERBATIM (`presentationSrcOf` — nocookie host +
  enablejsapi + autoplay + mute; `CONTROL_BOUND_SANDBOX` for the YouTube
  family, `OPAQUE_ORIGIN_SANDBOX` otherwise; `referrerPolicy`; the
  `allow` list). The stage joins as the CARD'S FIRST CHILD (DOM-order
  stacking under the monogram/overlay/rail — ZERO changes to the existing
  card chrome's CSS).
- **THE HONEST FALLBACK**: resolving renders only a typed marker (no
  spinner, no fake); unavailable (no embed realization / resolve failure)
  renders the typed-absence marker
  (`data-wfx-shortstage-state="unavailable"` + the honest reason) — the
  card keeps the placeholder-art + title form UNCHANGED.
- **THE PREFETCH LAW**: only the CURRENT card mounts an embed (one live
  embed — the hover preview's singleton discipline); the NEXT card (the
  view's own prefetch peek) RESOLVES ONLY (the cache warms; the mount
  happens when it becomes current). Never the whole stack.
- **THE EVIDENCE LAW**: the stage's own scoped provider-channel binding
  (the hover-preview pattern + play/pause commands); phase/muted/duration/
  position advance ONLY on provider-reported evidence; a provider that
  never answers settles `live=false` after the 3s honest timeout (the
  honest unbound state, disclosed on the root's data attributes).
- **THE CHROME**: the corpus's chrome maps to the PROVIDER'S OWN embed
  controls (reachable — NO click layer over the frame) + the watch
  surface's k/m bindings (the same grammar + typing guard, driving the
  provider channel; k also records through /api/playback — the watch
  surface's issue() order) + the unmute affordance (EmbedStage's exact
  pattern + words). CC/more/fullscreen-f: the provider's own in-frame
  controls; no WebFlix-side analog built (typed divergence rows).
- **THE TAP**: the corpus's tap behavior is the PROVIDER'S OWN in-frame
  tap (the provider's player receives it — its own channel; the resulting
  state broadcasts back through the documented channel and advances our
  visible truth). A WebFlix click layer would block the provider's own
  controls (the chrome law's mapping) — not built; recorded as the
  divergence note.
- **THE SESSION** (the root's demand): `host/shorts.ts` (MY file) gains
  `resolveShortsPlaybackSession` — the SAME seam the watch surface's media
  path uses (`serverPort.resolve` → the embed realization →
  `runtime.resolvePlayback` → `controller.prepare()` →
  `recordPlaybackSession`); a NEW thin route `app/api/shorts-session/
  route.ts` (ESCALATION — the minimal server seam) exposes it. At the
  first provider-reported PLAYING evidence the stage mints the session,
  then issues the runtime play command through `POST /api/playback
  {sessionId, command: "play", intent}` (the client-carried intent path —
  the watch surface's own transport), and folds provider-reported progress
  (5s throttle) + complete + the final position at unmount through
  `POST /api/events` (the closed vocabulary, playbackSessionId-bound) —
  resume truth + watch state stay coherent across surfaces.
- **THE JOIN in ShortsFeed.tsx** (the seam law): `RenderContext` grows
  `stage` (the current card's stage input | null) + `stageNext` (the next
  card's resolve-only input | null); the card case renders the stage as the
  article's first child; NOTHING else about the card/tree/rail/keys/re-rank
  changes (the R32 + R24-W2 suites must stay green byte-identical).
- **CSS** (ESCALATION — globals.css, the app's single stylesheet, the R32
  precedent): the `wfx-shortstage` block (full-bleed absolute inset 0, the
  iframe fill, the unmute pill family form, the mobile 44px law) — the
  pinned chrome's rules untouched; the clear-screen law leaves the stage
  visible (it hides overlay chrome only — the stage is the media).
- **TESTS** (NEW `apps/web/tests/shorts-media-stage.test.ts`): the SSR
  join (the resolving marker + the pinned R32/R24-W2 markup byte-identical),
  the resolve seam (the fixture short answers previewable + the real URL),
  the honest fallback (the pure state machine settles unavailable + no
  iframe), the evidence folds (provider infoDelivery shapes advance
  phase/muted only on provider-reported fields), the session seam (the
  host function resolves + records through the bridge — `bridgedIntentOf`
  answers), the prefetch law (the projection mounts the embed only for the
  active card), the k/m key-command derivation (the typing guard).

## NEXT (exact steps)

1. Write `shorts-stage-client.ts` + `ShortsMediaStage.tsx` + the
   ShortsFeed join + `host/shorts.ts`'s session function + the
   `/api/shorts-session` route + the globals.css block.
2. Write the lane tests; run the targeted suites
   (`bun test apps/web/tests/shorts-media-stage.test.ts apps/web/tests/
   shorts-rail-parity.test.ts apps/web/tests/shorts-parity.test.ts`).
3. Gates in order: battery (serial), lint (lane-clean), typecheck,
   contract-check, lane-check, parity-conformance 19/19,
   `bun run build --filter '@wfx/app-web'`.
4. Browser verification (captures to evidence/r33a/): service-mode dev boot
   (`WFX_API_BASE=https://webflix-api.vercel.app`) — the real embed playing
   (muted autoplay → unmute → tap-pause), the fallback form, the R32 rail
   byte-identical, swipe driving the one presenter, mobile 44px; plus the
   fixture-boot capture of the honest unbound stage.
5. The evidence pack: the citation table, guards.md, DIVERGENCES.md,
   browser-verification.md; then the transport relay (bundle + manifest).
