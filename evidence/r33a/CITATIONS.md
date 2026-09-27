# R33-A — THE CORPUS-CITATION TABLE (every element cites its datum)

THE LAW: never build from memory. Every element of the shorts media stage
cites its corpus line (the captured grammar) or the WebFlix-real machinery
it reuses (the frozen laws' own files). Where WebFlix's real model has no
analogous datum, the divergence ledger (DIVERGENCES.md) carries the honest
row — never fabricated parity.

## The corpus (the captured grammar)

| # | The element | The citation |
|---|---|---|
| 1 | The player IS the surface — vertical, full-bleed, autoplaying | G4-CORPUS.md "THE PLAYER": "Vertical 716×716, autoplaying (readyState 4, paused false, blob src)"; "THE WINDOW": "THIS window's shorts player went LIVE" |
| 2 | The muted-autoplay truth (the unmute affordance's cause) | G4-CORPUS.md "THE PLAYER" (autoplaying) + the R28-B corpus (hover-preview.md: "muted autoplay through the same presentation law the player stage uses") — WebFlix's own established law, embed-presentation.ts's `autoplay=1&mute=1` pair |
| 3 | The top chrome's inventory (pause k / mute m / CC / more / fullscreen f) | g4-rail-extras.json `chrome[]`: "Pause (k)" @366 · "Mute (m)" @422 · "Subtitles/CC turned on" @906 · "More actions" @954 · "Enter Full Screen (f)" @1002 (48×48 each, y=80) + G4-CORPUS.md "THE TOP PLAYER CHROME (auto-hiding)" |
| 4 | The k / m key grammar | The watch surface's own corpus-bound grammar (PlayerChrome.tsx "THE KEYBOARD GRAMMAR": " " / "k" → togglePlay, "m" → toggleMute, the INPUT/TEXTAREA/SELECT/contentEditable guard) — the task's chrome law names it ("the watch surface's k/m bindings where the channel answers") |
| 5 | The rail hugging the stage's right edge | G4-CORPUS.md "THE ACTION RAIL": "Container: 48×360 at x=1078… the column hugs the player's right edge" — the R32 rail's own anchor law (right: 0.5rem), pinned byte-identical |
| 6 | The channel row bottom-left over the stage | G4-CORPUS.md "THE CHANNEL ROW (bottom-left)": the @handle slot + the Subscribe pill + the title — the R32 channel row, pinned byte-identical |
| 7 | The 56×56 prev/next arrows | G4-CORPUS.md "THE NAVIGATION ARROWS": "56×56 at the right edge (x=1359)" — the R32 divergence row 7 law (the existing real queue navigation stands; no rebuild) |
| 8 | The vertical feed's anatomy | docs/parity-lab/r28/youtube/shorts-anatomy.md: "ytd-reel-video-renderer mounts (1 per feed slot); player container #shorts-player"; "Navigation: ArrowUp/ArrowDown + wheel + rail arrows page the feed [documented]" — the frozen presenter's own wiring (pinned) |
| 9 | The tap behavior (tap ⇒ pause/play) | G4-CORPUS.md "THE PLAYER" (the captured player's own tap truth) — delivered by the provider's own in-frame tap; the resulting state broadcast advances WebFlix's truth (divergence row 7) |
| 10 | The mobile 44px touch law | The established WebFlix family law (globals.css's own header: "Every interactive element keeps a visible focus ring… and a >=44px touch target — the WebFlix accessibility law") |

## The WebFlix-real machinery the stage reuses (never reinvented)

| # | The machinery | The citation (the frozen file) |
|---|---|---|
| 11 | The resolve seam + its per-item cache | `app/api/preview/route.ts` (R28-B: the frozen `serverPort.resolve` path, the first embed realization, the per-boot FIFO cache) + `hover-preview-client.ts`'s `previewTruth` (the client-side per-item cache law) |
| 12 | The shared presentation law | `components/player/embed-presentation.ts` (the nocookie host substitution, `enablejsapi=1`, `autoplay=1&mute=1`, `providerFamilyOf`, `CONTROL_BOUND_SANDBOX` / `OPAQUE_ORIGIN_SANDBOX`) — mounted VERBATIM |
| 13 | The containment law | `components/player/EmbedStage.tsx` (R26-W2: the control-bound family on `www.youtube-nocookie.com` with `allow-same-origin` — the empirically verified iframe-security restriction; every other provider keeps the opaque-origin posture) |
| 14 | The provider's documented control channel | `embed-session-client.ts` (the widget postMessage protocol: `listening` handshake, `infoDelivery`/`initialDelivery`/`onStateChange`, the 3s honest timeout re-armed on the frame's load, the source-check, the command forms playVideo/pauseVideo/mute/unMute) + `hover-preview-client.ts`'s scoped binding (the non-watch surface's own pattern) |
| 15 | The evidence law (R26-W2) | `embed-session-client.ts` "THE EVIDENCE LAW (frozen)": "WebFlix's phase becomes 'playing' ONLY when the provider's own broadcast says the player is playing" — the stage's folds advance only on provider-reported fields |
| 16 | The unmute affordance's form + words | `EmbedStage.tsx`'s unmute button ("Sound off — tap to unmute", evidence-gated on `embedControl.muted === true`) + `.wfx-player__unmute` (globals.css R28-B: "Rendered only while the provider REPORTS muted=true (evidence-gated, never assumed)") |
| 17 | The session seam | `host/view-models.ts`'s player media path (resolvePlayback → controller.prepare() → `recordPlaybackSession`) + `host/playback-bridge.ts` (the bridge intent + the client-carried intent law) + `app/api/playback/route.ts` (the command transport) — folded into `host/shorts.ts`'s `resolveShortsPlaybackSession` + the thin `app/api/shorts-session/route.ts` |
| 18 | The watch-state fold vocabulary | `app/api/events/route.ts` (the CLOSED vocabulary: progress/complete/skip with `playbackSessionId` + `positionMs`; "start" is the runtime's own — rejected client-side) + `embed-session-client.ts`'s reportProgress (the 5s throttle + complete-on-ended + the final fold at unbind) |
| 19 | The watch surface's command order | `PlayerChrome.tsx`'s issue(): "dispatch the command to the provider's own player FIRST… then record the session command through /api/playback" — the stage's k binding follows the same order |
| 20 | The anonymous-playback boundary | R23's law (`packages/client-runtime` — `authorizePlaybackStart`: anonymous + public realization ⇒ playback-may-start; `forbidsAnonymousLoginRedirect`) — the stage mints sessions for anonymous viewers exactly as the player page does |
| 21 | The pinned feed presenter | `packages/experience/src/short/*` (the frozen presenter, the element tree, the replacement plan) + `ShortsFeed.tsx`'s R32 join — the stage joins as the card's first child; the presenter/rail/keys/re-rank stay byte-identical |

## What the corpus does NOT carry (recorded, never fabricated)

- The unmute pill's size/position for the shorts player (the corpus's
  chrome record carries mute, not an unmute pill) → the watch surface's
  own family form + WebFlix's placement (divergence row 15).
- The embed-form chrome's geometry (the captured chrome belongs to the
  provider's own /shorts/<id> player, not an embed frame) → the
  provider's own in-frame controls are the mapping (divergence rows 3–6).
- A shorts-player watermark datum → the card's pinned monogram stays
  (divergence row 10).

## The REQUIRE-CHANGES fix round (the lead's review @ 1610d44 — the
pinned-controls collision law; every element cites its datum)

| # | The element | The citation |
|---|---|---|
| F1 | The top-chrome zone is the player's own (the rows' clearance law) | G4-CORPUS.md "THE TOP PLAYER CHROME (auto-hiding — the DOM record, y=80, 48×48 each)" + g4-rail-extras.json's pitch record (Pause (k) @366 → Mute (m) @422 — the 56px origin-to-origin pitch = the 48px control + its 8px gap) — the pinned rows clear the zone by the corpus's own measures (divergence row 16) |
| F2 | The pill's click-layer re-arm (`pointer-events: auto`) | globals.css's own stage law (`.wfx-shortstage__frame { pointer-events: auto }` — "The frame re-arms pointer events: the provider's own controls are this surface's chrome") — the unmute pill is the stage's other interactive child; it re-arms the same way (the defect's second half, divergence row 16) |
| F3 | The pill's untouched top-left anchor | G4-CORPUS.md's chrome anchor grammar (the corpus's own y=80 = the player's top − 12; the captured controls' x=366 ≈ the player's left edge + 4) — WebFlix's 12px/12px card inset, the approved form (divergence row 15), byte-identical through the fix |
