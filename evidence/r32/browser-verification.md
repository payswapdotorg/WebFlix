# R32 — BROWSER-LEVEL VERIFICATION (the golden paths, LIVE)

Sandbox window: the R31 class (the dev server boots here — unlike the
R30-B OOM record). Server: `WFX_DEV_FIXTURES=1 NODE_OPTIONS=--max-old-space-size=1536
next dev -p 3101` (the app's own dev script). Browser: agent-browser
(Playwright), 1440×900 desktop + 390×844 mobile. Zero page errors on
every surface visited (`agent-browser errors` clean at every check; the
console carries only the dev-mode HMR lines).

## 1. THE RAIL'S LIVE GEOMETRY (browser-01-shorts-rail.png, 1440×900)

The DOM-measured rects (the eval, verbatim):

| Element | Measured | The captured grammar |
|---|---|---|
| the rail column | x=994 y=752 **w=48** | the 48px-wide vertical column hugging the player's right edge ✓ |
| the share button | x=994 y=752 **48×48** | the 48×48 buttons ✓ |
| the count slot | the **"Share"** text | the captured Share text form (no count) ✓ |
| the avatar | x=1006 y=860 **24×24**, SPAN, **"F"** | the monogram law (the rail subscriptions' 24×24 pattern, the channel identity's own first mark), NO link ✓ |
| the channel name | "Fake Source (TEST FIXTURE — never production)" | the sources-model identity (the N29 truth — never a fabricated @handle) ✓ |
| the subscribe pill | **91×32** (min-width 78 + the label), idle | the 78×32-class pill ✓ |
| the typed absences | like=false comments=false remix=false; `data-wfx-shortrail-absent="comments remix"` | the honest-rail law ✓ |

The VLM read of the capture (glm-5v-turbo) agrees: "a single visible
round button [share icon] with the text label 'Share'… below it a small
circular avatar with a red letter 'F'… the channel name 'Fake Source
(TEST FIXTURE — never production)'… a bright red pill-shaped button with
the white text 'Subscribe'… **no count labels visible**" (the count-slot
law, confirmed visually). [The VLM's title misread ("Noam R…") is
recorded in DIVERGENCES.md #13 — the DOM truth carries "Neon Rain".]

## 2. THE SUBSCRIBE GOLDEN PATH (browser-02-subscribed.png)

- **Click "Subscribe to Fake Source (TEST FIXTURE — never production)"** →
  `POST /api/library` 200 → the pill renders **subscribed /
  aria-pressed="true" / "Subscribed"** + the honest status note
  ("Subscribed — saved to your Subscriptions list in Library.").
- **RELOAD** → the pill still renders **subscribed** — the boot payload's
  dual-law read (the stored source identity — the durable cross-load key —
  + the hydrated local fold) answers across the fresh page load.
- **Click "Unsubscribe from …"** → the remove write → **idle /
  aria-pressed="false"** + the note ("Unsubscribed — removed from your
  Subscriptions list.").
- **Re-subscribe → unsubscribe** (the cleanup round trip, the store left
  clean; browser-05-idle-clean.png: the idle state after the cleanup
  reload).

## 3. THE PER-CARD TRUTH ACROSS SWIPES (the session record)

- **Next** (the real queue navigation button) → position "2 / 3", the card
  "Midnight Scoop", the channel row re-renders for the new card — and the
  pill renders **idle** (honest: only "Neon Rain" is subscribed).
- **Back** → position "1 / 3" → the pill renders **subscribed** again
  (the session subscribed-record answers for the first card — the
  swipe-away-and-back law).

## 4. THE SHARE EVENT (the event-only control)

Click "Share 'Neon Rain' (emits the share engagement event)" → exactly
**one** `POST /api/events` (the resource-timing count: 0 → 1) — the
frozen share event through the real sink route.

## 5. THE CLEAR-SCREEN LAW (the pinned control's extension)

The R24-W2 toggle (the pinned parity row) → `data-wfx-shorts-clearscreen="true"`:
the rail's computed display **none** (with the overlay's none — the
distraction-free presentation covers the joined surface;
browser-03-clearscreen.png) → toggle back → the rail returns (flex).

## 6. THE MOBILE LAW (browser-04-mobile-390.png, 390×844)

The rail renders at **w=48** at the card's right edge; the rail's bottom
(728) sits CLEAR of the swipe hint's top (754) — the 44px touch law
(the established mobile offset, preserved in the G4 block).

## Captures

- `browser-01-shorts-rail.png` — the fixture-boot rail (1440×900)
- `browser-02-subscribed.png` — the subscribed state (the live round trip)
- `browser-03-clearscreen.png` — the clear-screen state (the rail hidden)
- `browser-04-mobile-390.png` — the mobile placement (390×844)
- `browser-05-idle-clean.png` — the idle state after the cleanup (the
  store left clean)
