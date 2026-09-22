# R26-W2 — the real-catalog production-parity journey (corrective verification)

**Lane head at run:** `aae8b1f` + this corrective commit (see `git log` for the exact SHA of the evidence commit).
**Environment:** LOCAL production-parity boot — the Experience API (`apps/api`, `next dev -p 3102`) over a real
seeded Postgres catalog (57 real, publicly embeddable YouTube videos, migrated + seeded from
`apps/api/src/host/seed.ts`), and the web app in SERVICE mode (`WFX_API_BASE=http://localhost:3102`,
`next dev -p 3101`). No `WFX_DEV_FIXTURES`. No synthetic provider. No test fixture.
**Browser:** Chromium (headed and headless passes; viewport 1440×900).
**Determinism notes:** anonymous viewer (no WebFlix account); the DB is the real migration set
(0001–0013) + the real seed; the provider embeds load from the real `youtube-nocookie.com`.

## THE JOURNEY (Home → Search → Card → Item → Play → provider control channel → return)

| # | Step | Observed (production-parity) | Evidence |
|---|------|------------------------------|----------|
| 1 | **Home** (`/`) | The REAL catalog renders: **76 cards** across "For you" / "Trending on your sources" / "Shorts" rows + the content-led hero. **A real defect was found and fixed here** (see below): the real catalog's emoji-leading titles (🌧️/🔴/⚡) crashed hydration through `placeholderMonogram`'s `charAt(0)` lone-surrogate output — the page rendered EMPTY (fixture titles are ASCII, so the battery never saw it). | `01-home-real-catalog.png` |
| 2 | **Search** (`/search?q=rainy%20day%20lofi`) | The reproduced production gap is FIXED: the whole phrase answers zero through the real transport, the tokenized recovery merges the per-token REAL hits → **9 results**, first hit = "1 HOUR Rainy Day in Airport ✈️ \| Cozy Lofi…" (exactly the packet's named target), with the honest disclosure: "No title contains the whole phrase 'rainy day lofi' — these matches contain the words 'rainy', 'day', 'lofi' in any order." | `02-search-phrase-recovery.png` |
| 3 | **Card → Item** (`/item?...ref=oH_pVgW5fEw`… also DYFDc0dpc5g) | The real video's detail page: canonical title, type, duration, the obvious primary **Play** action, Like/Save truth, Watchlist/playlist/queue, **Where to watch** as two natural "Play this way" choices, recommendation feedback, related content (real catalog items). | `03-item-real-video.png` |
| 4 | **Player** (`/player?...`) | The streamed shell renders the REAL provider embed (`https://www.youtube-nocookie.com/embed/DYFDc0dpc5g?enablejsapi=1`) with the provider's control channel **LIVE** (verified by the chrome's volume cluster rendering — it renders only on provider-answered evidence). The chrome renders the familiar grammar: Play/Pause, Seek slider, Volume + Mute, settings cluster (Speed/Quality/Translate/Autoplay), Fullscreen, keyboard sheet, captions; the honest phase is "buffering" pre-evidence. The provider's own `initialDelivery` reports `duration: 2886` — the provider-reported duration matching the catalog row. | `04-player-embed-control-bound.png` |
| 5 | **Play (the chrome's button)** | The command reaches the provider's real player: the provider's own broadcast answers `playerState: -1 → 3 (buffering)` (real command execution, provider-reported), then honestly reverts on the provider's error (below). The session command rides `/api/playback` with the client-carried intent (below). No fabricated "playing" — the evidence law holds. | `05-player-after-play-command.png` |
| 6 | **First frame** | **BLOCKED BY THE PROVIDER IN THIS ENVIRONMENT — honest classification: genuine provider unavailability (bot mitigation).** The provider's own QoE telemetry (captured in the browser network log) reports: `error=…auth…r.Sign_in_to_confirm_you_re_not_a_bot` — YouTube refuses the media stream to this verification environment's datacenter IP. **Decisive control:** clicking the provider's OWN in-frame play button (direct in-frame user activation) fails the SAME way (`-1 → 3 → -1` + the same bot error) — even the provider's own controls cannot start media here. WebFlix's chrome commands achieve exactly what the provider's own UI achieves; the phase machine advances only on the provider's own "playing" broadcast (verified live through the state-3 evidence fold). The first-frame observation must be completed from a consumer network (the lead's production verification). |
| 7 | **Return** | Home/Watch/Search all render the real catalog after the player journey (Watch: 57 cards; nav intact). |

## THE PRODUCTION ROOT-CAUSE FIX — the cold-invocation dichotomy (reproduced locally)

The dev-boot bridge file (`$TMPDIR/wfx-dev-playback-bridge.json`) is the only cross-module channel in
dev; deleting it reproduces the production invocation split exactly (the route's module knows neither
the session nor the bridge):

```
$ rm /tmp/wfx-dev-playback-bridge.json        # the cold-invocation simulation

$ POST /api/playback {"sessionId":"wfxpses_COLDINVOCATION1","command":"pause",
                      "intent":{"itemId":"wfxitm_3BD0...","externalRef":"DYFDc0dpc5g",
                                "connectorId":"wfx-experience-service"}}
→ {"ok":true,"state":{"sessionId":"wfxpses_7RZ5...","itemId":"wfxitm_3BD0...","mode":"embed",
                      "phase":"paused","positionMs":0,"bufferedMs":0}}

$ POST /api/playback {"sessionId":"wfxpses_COLDINVOCATION2","command":"pause"}   # no intent
→ {"ok":false,"kind":"not-found","detail":"no playback session 'wfxpses_COLDINVOCATION2' on this host"}
```

The client-carried intent re-resolves the SAME session through the SAME frozen resolve path on an
invocation that knows nothing else — the production `not-found … on this host` forever-loop is dead.
The honest typed not-found is preserved for an unknown session with no intent. The app's own chrome
commands were re-issued with the bridge still deleted (clean command status — the intent path carried
them).

## REAL DEFECTS FOUND AND FIXED THIS RUN (the fixture battery was green through all of them)

1. **The real-catalog hydration crash** (`placeholderMonogram`, `apps/web/src/components/ui/format.ts`):
   `charAt(0)` on an emoji-leading title produced a lone surrogate; the server's HTML encoded it as
   U+FFFD while the client's hydration kept the raw surrogate → the whole home page died on the REAL
   catalog (empty body). Fixed with code-point extraction (`firstCodePointOf`) + regression tests
   (`apps/web/tests/display-helpers.test.ts`, 8 tests: no lone surrogates, no U+FFFD, server/client
   parity, ASCII behavior unchanged). The same fix applied to the torrent stage's leading glyph.
2. **The provider control channel was dead under the frozen opaque-origin sandbox** (classified: an
   **iframe-security restriction**): reproduced with an A/B/C/D sandbox matrix — the provider's
   documented embed API NEVER answers the listening handshake without `allow-same-origin` (0 messages),
   and answers fully with it (`initialDelivery` with the provider's whole command interface). The
   provider's own widget API (`www-widgetapi.js`) itself uses `allow-same-origin` in its sandbox token
   set. The lawful combination implemented: control-bound YouTube embeds load from the provider's own
   **privacy-enhanced embed host** (`www.youtube-nocookie.com` — a separate origin and cookie jar, so
   the viewer's `youtube.com` identity stays invisible to the player) with
   `sandbox="allow-scripts allow-same-origin …"`; non-control embeds keep the opaque-origin sandbox
   VERBATIM; the BROWSER rung's contained surface (`platform/browser-host.ts`) keeps its frozen
   opaque-origin law VERBATIM (this refinement is the EMBED rung's alone).
3. **The handshake timeout could settle before the provider's frame even loaded** (a slow cold load
   permanently killed a channel that would have answered): the timeout now re-arms on the frame's
   `load` event.
4. **The `getServerSnapshot` infinite-loop warning**: `idleEmbedControlSnapshot()` built a fresh object
   per call (React requires a cached reference) — now a cached module constant (the same law
   `realtime-session-client.ts` already kept).
5. **The protocol message form now matches the provider's own widget API exactly** (every message
   stamped `id` + `channel:"widget"` — decoded from `www-widgetapi.js`'s `sendMessage`).

## Capability truth (service mode, live host report at GET /api/capabilities)

- `semantic-search` / `moment-retrieval` / `multimodal-intelligence`: **not-served** honestly (the
  API-side intelligence route is the lead-owned named dependency), with the honest next action
  ("Search by title and the AI action tray still work") — the search surface renders the honest
  unavailable semantic section below content-first results.
- `realization-availability`: **served** through the live Experience API.
- `realtime-bridge`: **not-served** honestly on this boot (no WebSocket bridge) with the honest next
  action.
- `artwork`: **not-served** honestly for the seeded catalog (the rows carry no `thumbnailUrl` —
  Worker 1's named production transport carriage; the typed placeholder fallback renders, never a
  fabricated image; the ArtworkImage presentation binds the contract and renders real artwork
  wherever it flows).

## The honest failure ledger (every failure met, named)

| Failure | Class | Disposition |
|---|---|---|
| Production `not-found: no playback session … on this host` | player state bug (module-memory session store across invocations) | FIXED (stateless command mapping + client-carried intent) — dichotomy proof above |
| Real-catalog home page empty | browser runtime problem (lone-surrogate hydration mismatch) | FIXED (code-point-safe monogram) + regression tests |
| Provider control API silent under opaque sandbox | iframe-security restriction | FIXED (privacy-host + `allow-same-origin` for the control-bound embed rung; browser rung law untouched) |
| `playVideo` executes, media never streams | **genuine provider unavailability** (bot mitigation: "Sign in to confirm you're not a bot", provider-reported, IP-scoped) | Honest state preserved (phase stays evidence-backed "buffering"); equal behavior for the provider's own in-frame controls; first-frame completion deferred to a consumer-network production verification |
| Cold-pool PGlite search degradation under a 9-way concurrent burst | verification-environment tooling (local PGlite wire server concurrency limit) | Mitigated by pool warming; production uses Neon (the lead's dossier confirmed production home renders) |

## Limitations (explicit)

- First-frame/seek/pause-resume **media evidence** could not be observed in this environment (the
  provider refuses media to the datacenter IP). The full command/evidence chain up to the media
  stream IS proven on the provider's own channel: handshake → `initialDelivery` (provider-reported
  duration) → `onReady` → `mute`/`playVideo` execution (provider-reported state transitions) →
  honest phase machine.
- Real thumbnails render only where the connector projects `thumbnailUrl` (the YouTube connector's
  search path); the seeded catalog carries none, so the honest typed fallback renders locally
  (Worker 1's named carriage dependency — escalated, not mine to change).
