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

## 11. THE LEAD'S REQUIRE-CHANGES FIX — THE PINNED-CONTROLS COLLISION
(fix-01..fix-05 + probes/fix-before|after-elementfrompoint.json; the lane
head moved past the approved `1610d44` by exactly this fix)

**THE DEFECT, REPRODUCED LIVE BEFORE THE FIX**
(`probes/fix-before-elementfrompoint.json`): the settled service-boot feed
(WFX_API_BASE=webflix-api.vercel.app, 1440×900, the discovery chips
present — the state the lead's user-level pass probed), the unmute pill at
(642,68) 205×36 was covered across its ENTIRE rect — the "Blend" chip +
the discovery band (z=6) over its left fifth, the R24-W2 controls row +
its source chip (z=12) over the rest; elementFromPoint at the pill's
center resolved to `SPAN.wfx-capchip` ("From wfx-experience-service"),
and the sweep resolved to the chips/controls at every probe point. The
pill is trapped inside the card's frozen z=2 stacking context (the
current/next swipe layering), so no z-index can win it back, and raising
the card would steal the chips' clicks.

**THE ROOT CAUSES (two — the second found in the fix's live re-probe):**
(1) the three pinned rows (the discovery band / the position pill / the
controls row) anchored the same top band over the full-bleed card at
z=6/z=4/z=12; (2) the stage root is `pointer-events: none` (the inert
marker forms never block the card) and the pill INHERITED it — computed
`pointer-events: none`, so a real user could never click it even where
uncovered (the previous session's automated click bypassed hit-testing;
the lead's user-level pass exposed exactly this class of gap).

**THE FIX (the corpus's own law — G4-CORPUS.md's top-chrome band is the
player's):** (1) every pinned row sits BELOW the chrome zone — the corpus
chrome height (48px) + its own 8px inter-control gap (the 56px origin
pitch, Pause @366 → Mute @422) = the 3.5rem desktop offset; the mobile
form clears the 44px touch-target zone (the 3.25rem offset; the band
keeps its below-the-position-pill law at 2.75rem + 3.25rem); (2) the pill
re-arms `pointer-events: auto` — the frame's own re-arming law. The
pill's anchor is UNTOUCHED (12px/12px, the corpus's top-left); the
chips/controls keep their pinned form and every click. The regression
lives in the lane suite (shorts-media-stage.test.ts's pinned-controls
collision describe — the anchor, the clearance computed from the
stylesheet's own numbers, desktop + mobile, + the click-layer re-arm;
the lane's count 19 → 21).

**THE VERIFICATION (all real-coordinate, hit-tested clicks):**

- **elementFromPoint across the pill's rect** (a 15-point sweep,
  `probes/fix-after-elementfrompoint.json`): **every probe resolves to
  THE PILL**; the center (745,86) resolves to the pill; the chrome-zone
  clearance = 20px (the rows' band top 124 − the pill's bottom 104); the
  pill's computed `pointer-events: auto`.
- **THE UNMUTE ROUND TRIP, REAL**: a coordinate-based mouse click at
  (745,86) — the hit-tested path a real user's click takes — → `unMute`
  through the documented channel → **the provider answered its own
  `mutedDelivery: muted=false`** → `data-wfx-shortstage-muted="false"` +
  the pill retired (evidence-gated) — `fix-04-after-unmute-roundtrip-pill-retired.png`.
- **THE CHIPS STILL FUNCTION, both honest paths**: a real coordinate
  click on "Following" → `POST /api/feed-mode` → the deployed API's
  honest TYPED REFUSAL ("the Following mode needs someone you follow
  first" + the "Bring your feed" recovery — the R21-D
  discoverable-not-hidden law; the anonymous service state carries only
  for-you as available); a real coordinate click on "For you"
  (available) → POST ok → **the honest reload** (the no-optimism law:
  the server's next read) — the mode-switch transport proven on both
  its honest paths. All four chips render at their shifted band (y=130).
- **MOBILE (390×844, fix-05)**: the pill 205×44 (the touch law), the
  center resolves to the pill, every row clear (the controls 124, the
  position 120, the band 152 — the wrapped chips at 158/210); the one
  non-pill sweep probe is the pill's own inline SVG icon (a child of the
  button — its click bubbles to the pill's own target).
- **THE VLM READ** of the before/after pair (glm-5v-turbo): "In image 1
  the chips visibly cover and obscure the right portion of the unmute
  pill… in image 2 the unmute pill is completely free of overlap, fully
  visible, intact, and clearly looks clickable at the card's top-left
  corner."

### The fix round's captures

- `fix-01-before-chips-and-controls-cover-pill.png` — the defect (the
  settled feed, the chips + the controls row over the pill's band)
- `fix-03-after-pill-owns-chrome-zone.png` — the settled state: the pill
  owns the chrome zone, the chips + position + controls in their own
  band below (VLM-verified with fix-01). [An intermediate
  rows-shift-only capture was taken and removed: byte-identical to
  fix-03 pixel-for-pixel — the pointer-events re-arm changes hit-testing
  truth (the probes), not a rendered pixel; the lane's own
  byte-identical-capture discipline.]
- `fix-04-after-unmute-roundtrip-pill-retired.png` — after the REAL
  coordinate click: the provider reported muted=false, the pill retired
- `fix-05-mobile-390-rows-clear-chrome-zone.png` — the mobile form (the
  44px pill clear; the rows in their shifted band)
- `probes/fix-before-elementfrompoint.json` +
  `probes/fix-after-elementfrompoint.json` — the elementFromPoint probe
  truth (before: every probe covered by the chips band + the controls
  row + the source chip; after: every probe resolves to the pill)
