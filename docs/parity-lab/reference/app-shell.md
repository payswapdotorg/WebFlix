# YouTube app-shell anatomy — captured + documented (R27 contract)

Captured 2026-09-23 from live youtube.com (headless 1440×900). Structure
[rendered] from the live DOM; fine detail values [documented] to this sheet.

## Topbar (masthead) — 56px, fixed, app-bg, bottom hairline divider

```
┌──────────────────────────────────────────────────────────────────────┐
│ [≡] [WebFlix→YT-style wordmark]      [ ┌──────────────┐ ] [mic]  … [avatar] │
│  guide   wordmark left-block          │ search pill    │  40px       right │
│  btn    (left cluster, 16px pad)      │ 566→720px     │  circle     cluster│
└──────────────────────────────────────────────────────────────────────┘
```

- Left cluster: hamburger "Guide" button (24px icon, 40px target), wordmark
  (WebFlix keeps ITS OWN wordmark — honest-identity law), region label.
- Center cluster (centered in the viewport): search pill — 40px height,
  radius 40px (full), 1px border (secondary), bg app/raised, input 16px/400
  primary, magnifier button 40px right cap (raised bg, radius right-half);
  mic button — 40px circle, raised bg, same 1px border. Focus: 1px blue
  (#3ea6ff-family) ring + suggestion dropdown (raised surface, radius 12px,
  shadow, 12px items with history/magnifier glyphs).
- Right cluster: create (+ / camera), notifications (bell, badge dot),
  avatar 32px circle (or "Sign in" pill button: raised bg, 14px/500,
  "Sign in" + avatar glyph). WebFlix maps: create → the honest acquisition
  flows it actually has (BYOF), bell → omit if no transport (DIVERGENCES),
  avatar → the honest account/settings entry.

## Left rail (guide) — 240px labeled (≥1280px), 72px icon-only (792–1279px)

Sections in order [rendered]:
1. Primary group: **Home · Shorts · Subscriptions · You** (You = library
   entry with the section's items: History, Playlists, Your videos, Watch
   later, Liked videos…)
2. Divider (hairline).
3. **Explore** heading (h3 14px/500 uppercase? — YouTube uses 14px/500
   title case): Music · Movies · Live · Gaming · News · Sport · Courses ·
   Fashion
4. Divider. **More from YouTube** heading: Premium · Music · Kids
5. Divider. Footer links row: About · Press · Copyright · Contact ·
   Creators · Advertise · Developers + © line.

Item anatomy: 48px height row, 24px icon + 14px/400 label, radius 10px
hover `rgba(255,255,255,0.1)`/dark, active item: raised bg
(`#272727`/`#f2f2f2`) + weight 500. Icon-only rail: 74px-wide tiles, 14px
label under 24px icon, vertical. WebFlix mapping: Home · Shorts ·
Subscriptions→(honest: the surfaces that exist — Library, History,
Settings; record any unmapped YouTube destination in DIVERGENCES).

## Bottom nav (mobile <792px) — 48px + safe-area, app-bg, top hairline

4 fixed items: Home · Shorts · (+ center? current YouTube: Home · Shorts ·
Subscriptions · You), 24px icon + 10px/500 label, active = primary white vs
secondary.

## Home feed — chip bar + responsive grid

- Chip bar: sticky under topbar (56+48px), horizontal scroll, 12px gap:
  `All` (active: raised bg `#f1f1f1`-on-dark `#f1f1f1` bg with `#0f0f0f`
  text — INVERTED active chip) then topic chips 32px height, radius 8px,
  `rgba(255,255,255,0.1)` bg dark. Left/right fade masks when scrollable.
- Grid: 4 cols ≥1300px / 3 ≥1000px / 2 ≥600px / 1 <600px; gap 16px×16px
  (4px vertical between thumb and text block).
- Card anatomy (feed): 16:9 thumbnail radius 12px; duration pill
  bottom-right; progress bar (watched: red 2px→4px bottom edge); title
  16px/500/22px 2-line clamp; channel row 14px/400 secondary (hover
  primary); meta line 12px/400 secondary "views · age"; badge (CC) under
  title; hover after ~500ms dwell → preview disclosure (WebFlix: honest
  hover = the capability-gated preview card that exists).
- Shorts shelf: a row of tall 9:16 cards (radius 12px, title 16px/500
  2-line, meta 14px) inserted between grid rows.
- Skeleton while loading: thumbnail shell + 2 text shells (title 20px h +
  meta 20px h, radius 8px → the skeleton CSS captured).

## Search page

Header: chip bar (Filters pill right-aligned: raised pill, 14px/500) then
result rows per `search-card-grammar.json`. Left 360×202 thumb; right
column: 18px/400/26px 2-line title, channel + verified, meta
`viewCountText · publishedTimeText` 12px secondary, snippet 12px 2-line,
badges. Channel results: avatar 160px? — no: circle avatar + name +
meta + Subscribe-style button, full row.

## Shorts surface

Full-viewport-height (100dvh) dark stage, centered 9:16 player (max-height
100dvh − 96px chrome), right action rail: like · dislike · comments→(honest:
omit if no transport) · share · more, 48px targets, counts 12px/500 under
each; bottom-left: channel row + title 16px/500 + meta; up/down nav arrows
right edge (desktop). [documented] to this sheet.

## Library / You page

Profile header (avatar 80px, name 24px/400, "View channel >" chevron pill),
history row (horizontal scroll of 24-min-watched cards), playlists as
2-col shelf lists (16px/400 title + n videos), grid sections with
"Recent" + sort/menus (24px icon buttons). [documented].
