# G4 CORPUS 20260926-093102 — the shorts action rail (the fourth gap — CAPTURED LIVE)

THE WINDOW: the VPN-off native-IP window (the responder fired the ladder at
09:31:02Z on the fresh healthy load). Unlike the three prior records
(g4-shorts.json 20260926-0523/0529/0456: video readyState 0, shell + Play
CTA only — the risk-engine gate), THIS window's shorts player went LIVE:
**readyState 4, playing (paused: false), a blob src** — the media gate
lifted. The full action rail rendered and is captured below. Evidence: this
directory (g4-shorts.json the ladder record + g4-rail-full.json the rail's
outerHTML slice + g4-rail-extras.json the counts/subscribe/arrows/chrome
geometry + g4-short-live.png the VLM-verified screenshot, /tmp/g4-vlm.json
mirrored below).

## THE PLAYER
- Vertical 716×716, autoplaying (readyState 4, paused false, blob src)
- The URL form: youtube.com/shorts/<id> (this capture: /shorts/yCV6CGOeKb4)

## THE ACTION RAIL (the right vertical column — REEL-ACTION-BAR-VIEW-MODEL)
- Container: 48×360 at x=1078, y=420 (1440×900 viewport) — the column hugs
  the player's right edge
- Exactly 4 action buttons, top-to-bottom, each 48×48, at a 78px vertical
  pitch (y=420/498/576/654):
  1. **LIKE** — aria: "like this video along with 176 thousand other
     people"; the count label under the icon: **"176K"**
  2. **COMMENTS** — aria: "View 512 comments"; the count label: **"512"**
  3. **SHARE** — aria: "Share"; the label renders as the **"Share" text**
     (no count)
  4. **REMIX** — aria: "Remix this Short along with 12 other remixes"; the
     count label: **"12"**
- **THE CHANNEL AVATAR**: the column's 5th element, BELOW remix — a small
  circular channel avatar (VLM: "a small circular profile picture of a
  cat") that links to the channel
- The count labels render under each icon (the ~48px-wide column carries
  icon + centered count)

## THE CHANNEL ROW (bottom-left)
- **@handle** channel identity: "@JackieMcReY"
- **THE SUBSCRIBE PILL**: aria "Subscribe to @JackieMcReY.", text
  **"Subscribe"**, 78×32 at (511, 704) — the pill form (not the watch
  page's larger subscribe-style primary)
- **THE TITLE + HASHTAGS**: the h1 "We're sharing, right?" + the hashtag
  row "#marvel #edit #shorts"

## THE NAVIGATION ARROWS
- **Previous video** + **Next video**: 56×56 at the right edge (x=1359,
  y≈442-450) — the vertical queue navigation

## THE TOP PLAYER CHROME (auto-hiding — the DOM record, y=80, 48×48 each)
- **Pause (k)** @366 · **Mute (m)** @422 · **Subtitles/CC turned on** @906 ·
  **More actions** @954 · **Enter Full Screen (f)** @1002
- (The hidden variants in the DOM: "Full screen (f)", "Subtitles/closed
  captions unavailable", a second "Mute (m)" — the state-dependent forms)

## THE BINDING LAWS FOR THE BUILD (§G4)
- The rail's buttons bind to REAL WebFlix capabilities only, per the
  honest-divergence law: the like → WebFlix's like-style pill seam; the
  subscribe → the REAL subscribe seam (the same the watch page + rail +
  feed use); the title → the item's own; the avatar → the monogram law.
- Where YouTube carries a capability WebFlix truthfully lacks (comments —
  WebFlix has no comments surface; remix — no analog), the surface renders
  the honest absence (omit or the honest empty state) + a divergence-ledger
  row. NEVER a dead imitation (the frozen law).
- The counts bind only to real WebFlix data; where no datum exists, the
  count renders absent (never a fabricated "176K").
- The two gaps' sibling law: §G3 (the home resume bar) stays PENDING —
  this window's home again rendered 30 cards with ZERO progress bars +
  no continue-watching shelf (g3-home-progress.json, the second consistent
  account-state-absent record) — nothing to bind; never build from memory.

## THE VLM RECORD (g4-short-live.png, 2026-09-26 09:3xZ)
"1) Vertical video playing in the center. 2) Right-side action column
top-to-bottom: Like (Heart) 176K · Comment (Speech Bubble) 512 · Share
(Curved Arrow) 'Share' text · Remix (Mixed Arrows) 12 · Channel Avatar (a
small circular profile picture of a cat). 3) Bottom-left: '@JackieMcReY'
followed by a white 'Subscribe' button; the title 'We're sharing, right?
#marvel #edit #shorts'. 4) Top overlay controls: none visible in this
frame (auto-hidden — the DOM record carries them)."
