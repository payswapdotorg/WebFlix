# R33-A — BROWSER-LEVEL VERIFICATION (the golden paths, LIVE)

Two boots, both live-verified with agent-browser (Playwright; 1440×900
desktop + 390×844 mobile). Zero page errors on every surface visited
(`agent-browser errors` clean at every check; the console carries only the
dev-mode HMR lines).

- **THE SERVICE BOOT** (the REAL playing machinery): `WFX_API_BASE=
  https://webflix-api.vercel.app next dev -p 3101` — the deployed
  Experience API (the same backend the production deployment serves),
  so the shorts feed composes REAL catalog items and the resolve answers
  the providers' REAL embed URLs.
- **THE FIXTURES BOOT** (the honest unbound truth): `WFX_DEV_FIXTURES=1
  next dev -p 3102` — the fixture catalog's embeds at `fixture.invalid`
  (a non-provider host).

## 1. THE REAL EMBED, STAGED FULL-BLEED (browser-01, 1440×900)

The service boot's first card ("1 HOUR Rainy Day in Airport ✈️ …",
position **1 / 24**):

| Truth | Measured |
|---|---|
| the stage state | `data-wfx-shortstage-state="staged"` — the resolve answered previewable |
| the frame src | `https://www.youtube-nocookie.com/embed/3uyGhtARP4M?enablejsapi=1&autoplay=1&mute=1` — **the shared presentation law VERBATIM** (the nocookie privacy host + the provider's own jsapi switch + the muted-autoplay pair) |
| the provider family | `data-wfx-shortstage-provider="youtube"` → the CONTROL_BOUND sandbox posture |
| the channel | `data-wfx-shortstage-live="true"` — **the provider ANSWERED the listening handshake** (its own `initialDelivery` arrived: `data-wfx-shortstage-muted="true"`) |
| the unmute affordance | rendered, 205×36 at the card's top-left (642,68 = card 630,56 + 12,12), the watch surface's words verbatim: **"Sound off — tap to unmute"** |
| the full-bleed geometry | the frame rect **= the card rect exactly** (420×844 @630,56) — the player IS the surface |
| the R32 rail over the stage | **48px wide @ x=994** — the card's right edge minus its own 0.5rem anchor (1050−8−48) — the R32 anchor law holding OVER the joined stage |
| the channel row | present over the stage (bottom-left, the R32 row) + the subscribe pill |

## 2. THE UNMUTE ROUND TRIP — REAL PROVIDER EVIDENCE (browser-03a/03b)

**Click "Sound off — tap to unmute"** → the command went out through the
provider's documented channel (`unMute`) → **the provider answered with
its own `mutedDelivery: muted=false`** → the evidence store advanced →
`data-wfx-shortstage-muted="false"` and the pill retired (evidence-gated:
it renders only while the provider reports muted). The two distinct
captures (VLM-verified, glm-5v-turbo): *"in the first image, there is a
pill-shaped button at the top-left of the vertical video reading 'Sound
off — tap to unmute'… in the second image, that pill-shaped button is
gone (absent)"* — the round trip's before/after visual truth. The **m
key** (the watch surface's grammar) round-tripped the same way in
reverse: a dispatched keydown "m" → `mute` through the channel → the
provider answered `muted=true` → the pill re-rendered. [NOTE:
`agent-browser press k/m` after a click inside the provider's
cross-origin frame did not reach the parent window (the focus lived in
the frame — keyboard events do not bubble out of a cross-origin iframe);
the dispatched events prove the bindings. Recorded as the environmental
note.]

## 3. THE PROVIDER'S OWN GATE — THE HONEST PHASE TRUTH (browser-02)

The provider's own frame renders its bot-gate in this egress — the VLM
read of the capture (glm-5v-turbo): *"Sign in to confirm you're not a
bot / This helps protect our community / Sign in"* — the provider's own
playability gate for this datacenter egress (the same environmental
truth the R28-B corpus recorded for the hover preview + the player
page in this sandbox class). The stage keeps the HONEST truth
throughout: `data-wfx-shortstage-phase="unstarted"` (the provider
reports unstarted; the surface never fabricates playing), the channel
stays live, the controls answer. The tap into the frame (the provider's
own tap carrier) is gated by the provider itself — no pause state
exists to observe in this window; the corpus's tap law's carrier is
proven by construction (the frame stays clickable — no WebFlix overlay
covers it) + the channel round trips above.

## 4. THE SESSION LAW'S ROUND TRIP — THE LIVE ROUTES (the exact transports the stage drives)

Driven from the page (the same `fetch` transports `mintShortsStageSession`
/ `recordShortsStageCommand` / `reportShortsStageWatchState` use):

1. `POST /api/shorts-session {itemId, connectorId, externalRef}` →
   **`{ok: true, sessionId: "wfxpses_75WWWQQMJBTKJ38Q986PAXNQX1"}`** —
   the runtime's own session id, minted through the same seam the watch
   surface's media path uses.
2. `POST /api/playback {sessionId, command: "play", intent}` →
   **`{ok: true, state: {phase: "buffering", positionMs: 0}}`** — the
   runtime's controller executed the command (buffering — the honest
   phase awaiting evidence).
3. `POST /api/events {type: "progress", payload: {playbackSessionId,
   positionMs: 4200}}` → **`{ok: true}`** — the watch-state fold landed
   (resume truth coherent across surfaces).

THE HONEST STAGE NOTE: the stage itself minted NO session during the
window — the provider's gate kept its reported phase "unstarted", and
the session mints only at the first provider-reported PLAYING evidence
(the evidence law holding honestly: a gated non-play records nothing).
The network log proves the discipline: exactly the two `/api/preview`
resolves (below) and zero `/api/shorts-session` calls from the stage.

## 5. THE PREFETCH LAW + THE SWIPE (browser-04)

The network log at the first card: **exactly TWO `/api/preview` reads**
— the current card's (`ref=3uyGhtARP4M`) and the next card's
(`ref=oYZqn5zPzK4`, the resolve-only prefetch warm). The DOM at rest:

- the current card: `data-wfx-shorts-media="stage"` + the live iframe;
- the next card: `data-wfx-shorts-media="prefetch"` +
  `data-wfx-shortstage-prefetch="true"` + **NO iframe**;
- **iframes in the whole feed: exactly 1** (the singleton discipline).

**Click Next** (the real queue navigation — the pinned presenter) →
position **2 / 24**, the new card ("3 Countries With Incredible Natural
Beau…") staged **instantly from the warm cache**
(`youtube-nocookie.com/embed/oYZqn5zPzK4?enablejsapi=1&autoplay=1&mute=1`,
`live: true` — the new frame's own handshake answered), the old stage
unmounted — **still exactly 1 iframe**. **Click Back** → position
**1 / 24**, the first card re-staged (the bounded back-swipe law, the
pinned presenter intact).

## 6. THE R32 RAIL + CHANNEL ROW — BYTE-IDENTICAL ON THE JOINED SURFACE

The live service surface's rail grammar (the R32 suite's own assertions,
DOM-verified): `data-wfx-shortrail-absent="comments remix"` (the typed
absences) · the share button + its captured **"Share"** text label ·
exactly **1** count slot (the count-slot law — never a fabricated
count) · the monogram avatar "W" (the sources model's own first mark) ·
the channel name = the sources model's display name
("wfx-experience-service") · the subscribe pill bound to the real seam
(the boot payload's stored truth answered subscribed in this window —
the R32 dual-law read). Like renders no control (the source declares no
capability — the frozen tree's law).

## 7. THE MOBILE LAW (browser-05, 390×844)

- The unmute pill: **height 44px** (205×44) — the touch-target law on
  the mobile form (the watch surface's 36px family measure scaling to
  the established 44px law under the 791px breakpoint).
- The rail: **48px at x=334/right=382** — the card's right edge (390)
  minus its own 0.5rem anchor — the R32 anchor law at mobile.
- The stage: the frame **= the card exactly** (390×740) — full-bleed at
  the mobile scale.
- The pill renders the family words over the stage.

## 8. THE FIXTURES BOOT — THE HONEST UNBOUND STAGE (browser-06)

The fixture boot's feed (3 cards: Neon Rain / Midnight Scoop / Rain
Check — every card staged, `position 1/3 → 2/3 → 3/3`):

- the stage: `staged` + `frameSrc="https://fixture.invalid/embed/
  fake:short-1"` — the fixture realization VERBATIM (the family check
  answers "unknown" → no provider params added, the opaque-origin
  posture);
- **`data-wfx-shortstage-live="false"`** after the honest 3s timeout —
  no provider answered (fixture.invalid serves no player): the honest
  unbound state, disclosed, never simulated (divergence row 13's live
  proof). No unmute renders (no provider mute report — evidence-gated).

## 9. THE CLEAR-SCREEN LAW (browser-07)

The pinned R24-W2 toggle → `data-wfx-shorts-clearscreen="true"`:
- the overlay: `display: none` ✓ (the pinned extension);
- the rail: `display: none` ✓;
- **the stage: `display: block`, visible** ✓ — the media stays (the
  distraction-free presentation covers the joined surface; the stage IS
  the media — divergence row 11's law, verified live).
Toggle back → the chrome returns (browser-08: the fixture card with the
rail + channel row over the stage).

## 10. THE HONEST FALLBACK — THE VERIFICATION TRUTH

No realization-less card existed in either boot's live feed to capture:
the service feed's **all 24** cards answered `previewable: true` (the
scan probe — every card's resolve checked), and the fixture feed's 3/3
cards carry fixture embeds. The unavailable form is therefore proven at
the LANE-TEST level (the real `/api/preview` route's honest no-embed
answer for the fixture's browser-only item `fake:video-2` + the pure
unavailable fold + the SSR marker path rendering no iframe), with the
live window's every-card-embeds truth recorded here — never a fabricated
capture.

## Captures

- `browser-01-service-staged.png` — the real nocookie embed staged full-bleed (1440×900, service boot, the muted pill present)
- `browser-02-provider-gate.png` — the provider's own bot-gate inside the frame (the VLM-read environmental truth)
- `browser-03a-muted.png` — the muted state (the pill present — VLM-verified)
- `browser-03b-unmuted.png` — after the unmute round trip (the provider reported muted=false; the pill retired — VLM-verified)
- `browser-04-swipe-staged.png` — the second card staged from the warm prefetch cache (position 2/24)
- `browser-05-mobile-390.png` — the mobile form (the 44px unmute + the rail's anchor + full-bleed)
- `browser-06-fixture-unbound.png` — the fixtures boot's honest unbound stage (staged, live=false)
- `browser-07-clearscreen-stage-visible.png` — clear-screen: the chrome hidden, the stage visible
- `browser-08-fixture-rail-over-stage.png` — the R32 rail + channel row over the joined stage (the fixture card, chrome restored)
