# R28-C BASELINE OBSERVATION — WebFlix as it renders on the recon lane base

**Base:** `origin/main @ 3304b65` (the R27 lead's production sweep commit)
**Boot:** `apps/web` · `WFX_DEV_FIXTURES=1` · `next dev -p 3101` (Turbopack)
**Instrument:** agent-browser @ 1440×900, Chromium
**Dark theme unless noted.** All captures in `evidence/r28-recon/baseline/`.
Re-measured (not trusted from B's or the lead's claims) — C's own observation.

---

## 1. Fonts — declared but NOT loaded (operator complaint: "the theme and fonts used are not the same")

- `getComputedStyle(document.body).fontFamily` → `Roboto, Arial, Helvetica, sans-serif`
- `document.fonts` (the loaded FontFaceSet) → `["__nextjs-Geist", "__nextjs-Geist Mono", "__nextjs-Geist", "__nextjs-Geist Mono"]`
  → **Roboto is declared in the CSS stack but there is NO @font-face / no next/font / no <link> that loads it.**
  Rendering falls through to Arial/Helvetica (OS fallback). The page therefore
  does not render Roboto's metrics/glyphs; YouTube renders Roboto (served).
- Confirms the lead's recon (production @ 3304b65): "fonts declared-but-not-loaded
  (document.fonts EMPTY of Roboto; OS fallback rendering)".
- Evidence: `evidence/r28-recon/baseline/home.dark.png` + the eval transcript in
  `NOTES.md` (this file, section transcripts).

## 2. Click-count trace to play (operator complaint: "you have to click 3 times before a video plays")

Trace @1440×900, dark, from home:

| step | action | result |
|---|---|---|
| 1 | click feed card `Neon Rain` | → `/item?id=wfxitm_25F5...&connector=fake-source&ref=...&title=...&type=short&duration=45000` — an **interstitial** (no `<video>`, no `<iframe>`) |
| 2 | click `Play` link on /item | → `/player?id=...` — player chrome renders (`iframe` "Embedded playback: Neon Rain") |
| 3 | player still shows a **`Play (k)` button** — media not started (fixture provider `https://fixture.invalid/embed/fake:short-1` is network-blocked in dev-fixture boot) |

**YouTube truth:** hover a thumbnail → 1 click → watch page opens with the media
autoplaying. WebFlix = card → interstitial → Play (+ a Play control) = **3 user
actions to reach a started play attempt, and the interstitial step is pure
friction YouTube does not have.** Even discounting the fixture-provider network
block, the structural cost is 3 surfaces where YouTube has 1.
Evidence: `item-interstitial.png`, `player-step3.png`.

## 3. Hover preview (operator complaint: "hovering over thumbnails doesn't display gifs")

- Dwell test on a `.wfx-card` (grid card, 288×238): mouse moved to card center,
  held 3.6 s total (way past YouTube's ~500 ms dwell threshold).
- Result: `document.querySelectorAll('video').length` → **0 before AND after**;
  no animated preview element; no gif; `img[src*=gif]` → 0.
- `.wfx-cardpreview` elements exist in the DOM but are **empty scaffolding**
  (0 children each — no media child ever mounts).
- Card thumb anatomy: `span.wfx-card__thumb` with
  `background:linear-gradient(135deg, hsl(344 42% 24%), hsl(30 48% 11%))` +
  initials text ("NR") — a **CSS gradient placeholder, not artwork, not previewable**.
- Evidence: `hover-dwell-1.6s.png` (+ post-dwell eval).

## 4. Comments (operator complaint: "there's no comments")

- `/watch` (browse): `document.querySelectorAll('[class*=comment],[data-wfx-comment]')` → **0**;
  body text contains no "comment" string.
- `/player` (playback page): snapshot has **no comments region** (no heading, no
  list, no composer). The surfaces that exist: player controls, title,
  playlist/save/watched/skip actions, "Where to watch", "Recommendation feedback",
  "Realtime translation", "Up next", "Queue", "More to explore".
- `/item` interstitial: no comments either.
- Corpus watch-geometry.md carries the comments anatomy (20px/400 heading + list).
- Evidence: player/watch snapshots; `NOTES.md` transcripts.

## 5. Share (operator complaint: "sharing doesn't work the same")

- The share control is a `<details class="wfx-share">` popup (NOT a modal),
  opened by `summary[data-wfx-share-toggle]`.
- Contents: exactly **ONE button** — "Copy WebFlix link" — plus the raw path text
  `/item?id=wfxitm_...&connector=fake-source&ref=fake%3Ashort-1&title=Neon+Rain&type=short&duration=45000`
  (all internal query params exposed, relative URL, no short-link form).
- **No** embed option, **no** "start at" timestamp, **no** social share targets,
  **no** share-sheet anatomy (YouTube's share modal: row of social targets +
  copy + embed + start-at checkbox).
- The share control lives ONLY on the /item interstitial — the player page has
  no share control at all (YouTube's watch page has share in the action row).
- Evidence: `share-popup.png`.

## 6. Theme / background (operator complaints: "the theme and fonts used are not the same" / "the background color is different")

- Tokens: dark body `rgb(15,15,15)` = `#0f0f0f` ✓ token-correct (corpus: dark app bg `#0f0f0f`);
  light body `rgb(255,255,255)` = `#ffffff` ✓ token-correct (corpus: light `#ffffff`).
- **BUT the perceived field differs** — pixel survey (3px grid, both 1440×900):
  - WebFlix dark home: `#0f0f0f` 26% · `#272727` 21% · `#282828` 6% · `#212121`–`#292929` ~17%
    → **~47% of the field is elevated gray** (hero panel, gradient placeholder
    thumbs, chips, panels).
  - YouTube dark corpus capture (`yt-search-dark-1440.png`): `#0f0f0f` 64%,
    elevated grays <5%.
  → The operator reads "background is different" because WebFlix's first screen is
  a wall of #272727-class surfaces where YouTube's is a mostly-#0f0f0f field
  filled with colorful artwork.
- Default theme: WebFlix boots **dark**; corpus home captures are light-mode
  logged-out YouTube (both themes exist on both products; token parity holds,
  field composition does not).
- Evidence: `home.dark.png`, `home.light.png`, `item.light.png`, pixel survey in NOTES.

## 7. Home structure (lead's recon: "home = 1184px hero + 'What your feed shows' config above the grid")

- Measured locally: hero region `section[aria-label^="Featured: Neon Rain"]` →
  **1200×775** (fills the first screen; grid starts below ~1084px).
  Lead's production measure: 1184px wide — same object, production margins.
- Above the grid, in order: feed-config radios **"For you / Following / Your
  imported feed / Blend"** + "Manage feeds in Settings" link + "Personalize ·
  Balanced" text, then chips All/short/movie/series, then the hero, then the grid.
- **YouTube home anatomy: chips row immediately, then the thumbnail grid — no
  hero, no feed-config panel, no per-source status line.**
- Feed cards: 288×238 at 1440 (YouTube grid cards ~360×202 at this viewport with
  the 240 rail; 288 is the 4-col-at-1300 token applied… actual YT at 1440/rail-open
  renders 4 columns of ~282-296px — card size is near-parity; the hero + config
  stack above is the divergence).
- Evidence: `home.full.png`, `home.dark.png`.

## 8. Chrome / masthead / rail

- Topbar height **56px** ✓ (corpus: 56).
- Search pill 512×40 (corpus: 40px height ✓; YouTube pill is wider — A's R28
  sheet to confirm the exact px).
- Masthead right cluster: "Add a feed" (BYOF) + theme toggle + "Signed out" avatar.
  **No mic, no create-video, no notifications bell** (3 divergences carried from R27 #3/#4).
- Rail: Home · Shorts · Watch · Library · You(heading) · History · Offline · History(dup) · Settings
  → **duplicate "History" still present** (R27 #8, cosmetic, still open).
- `dev fixtures` badge present (honest; dev-only).
- Search pill 512px — pending A's sheet for the canonical measure.

## 9. Watch/player geometry (R27 follow-ups re-measured)

- `.wfx-player__layout` grid: `724px 412px` (rail open @1440) ✓ R27 divergence #13 unchanged;
  `gap: 16px` ✓ (the R27 drift fix holds on main).
- `.wfx-player` padding: **`24px 24px 48px`** — corpus documents 16px @1440 →
  **R27 divergence #14 (.wfx-player padding) still OPEN** (lead-owned follow-up, unfixed on main).

## 10. Shorts

- Stage present with fixture content ("Neon Rain", "1 / 3", speed menu, swipe hints).
- Captured `shorts.dark.png` for the matrix row pending A's shorts sheet.

## 11. Corpus-coverage note for the matrix

- The R27 corpus home screenshots are **light-mode logged-out empty states**
  ("Try searching to get started") — they do NOT document YouTube's dark
  subscribed feed, hover preview, comments anatomy, or share modal. Worker A's
  R28 FEATURE-INVENTORY (lane `wfx/r28/corpus`) is the missing truth; matrix rows
  citing YouTube behavior will cite A's sheets as they land and are marked
  `corpus: PENDING-A` until then.

## Transcripts (the raw evals behind the rows)

- fonts: `document.fonts` → Geist×4 only; body fontFamily `Roboto, Arial, Helvetica, sans-serif`.
- click trace: `/` → click `Neon Rain (short, 45s)` link → url `/item?id=...` (no video/iframe) →
  click `Play` → url `/player?id=...` (iframe `https://fixture.invalid/embed/fake:short-1`, `Play (k)` button).
- hover: `mouse move 384 487` (card center) → wait 1.6s + 2s → `videos: 0`,
  `wfx-cardpreview` ×11 all 0 children, `img[src*=gif]: 0`.
- comments: `/watch` `[class*=comment]` → 0; `/player` snapshot — no comments region.
- share: `details.wfx-share` open=true → body text `Share / Copy WebFlix link / <raw path>`; 1 button.
- bg: dark `rgb(15,15,15)` / light `rgb(255,255,255)`; pixel survey §6.
- hero: 1200×775 @1440 local (lead: 1184 production).
- player geometry: cols `724px 412px`, gap `16px`, padding `24px 24px 48px`.
