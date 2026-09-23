# YouTube watch-page geometry — measured live (R27 contract)

Captured 2026-09-23, live youtube.com watch shell at 1440×900 (the media was
bot-gated; the layout skeleton is complete and authoritative). All values
[rendered].

## The two-column layout @1440

```
┌──────────────────────────────────────────────┬───────────────────┐
│ PRIMARY  x=16  w=1012                        │ SECONDARY x=1028  │
│ ┌──────────────────────────────────────────┐ │ w=412 (related)   │
│ │ PLAYER  x=16 y=68  996×560 (16:9+chrome) │ │                   │
│ └──────────────────────────────────────────┘ │ related chips row │
│ below: y=640 w=996                           │ compact cards:    │
│ ┌ h1 title ────────────────────────────┐    │  168×94 thumb +   │
│ │ 20px/700/28px Roboto                 │    │  meta column      │
│ └───────────────────────────────────────┘    │                   │
│ ┌ owner row ──────────┐ ┌ actions row ────┐  │                   │
│ │ x=16 w=274 h=42     │ │ x=322 w=690 h=42│  │                   │
│ │ avatar 40×40 + name │ │ pill buttons 40h│  │                   │
│ └─────────────────────┘ └─────────────────┘  │                   │
│ ┌ description panel ──────────────────── ┐   │                   │
│ │ 14px/20px, rounded-12 surface panel,   │   │                   │
│ │ expandable ("...more")                 │   │                   │
│ └────────────────────────────────────────┘   │                   │
│ ┌ comments section ──────────────────────┐   │                   │
└──────────────────────────────────────────────┴───────────────────┘
  gap between columns: 16px (x=1028 - (16+996))
```

- Page margin: 16px at 1440 (24px at ≥1600).
- Primary width = viewport − 412 (secondary) − 16 (gap) − 16 (margin) = 1012.
- Player: 996×560 inside primary; video area 16:9 with 12px control bar.
- Title block: full primary width, y directly below player (y=640), 28px tall.
- Owner row LEFT (w≈274, avatar 40×40, channel name + sub-count style meta),
  actions row RIGHT (w≈690, right-aligned pill buttons 40px height,
  radius 20px; like/dislike segmented `20px 0 0 20px` + `0 20px 20px 0`,
  bg `rgba(0,0,0,0.05)` light / `rgba(255,255,255,0.1)` dark, label 14px/500).
- Description panel: below owner/actions, 14px/20px, surface bg
  (`#272727` dark / `#f2f2f2` light), radius 12px, padded, collapsed
  2-line + "…more" expander.
- Comments: 20px/400 section heading, list below (WebFlix divergence: no
  comment transport — honest omission per the lab laws; record in DIVERGENCES).
- Related sidebar: compact cards — 168×94 thumbnail, 4px gap, right column:
  title (2-line clamp, primary color), channel (secondary), meta (12px
  secondary). Chips row above (All, From <channel>, Related…).

## Responsive behavior [documented]

- ≥1600px: margins 24px, secondary 412px fixed.
- 1016–1279px (player mid): primary shrinks with viewport, secondary 412px →
  drops below at ≤1015px (single column, related becomes full-width grid).
- ≤1000px: full-bleed player, single column, owner/actions stack.

## The player stage

- 16:9 stage, radius 12px (2025 YouTube rounded player), black letterbox.
- Chrome: gradient scrims top/bottom on hover-idle reveal; bottom control bar
  48–49px: red progress `#f03` (hover: expands, 12px white scrubber dot),
  play/pause, next, volume + hover slider, time `cur / dur`, spacer,
  captions, settings gear (two-level popup menu, back-arrow navigation),
  miniplayer, theater, fullscreen. Controls fade after ~3s idle.
- Watch-page skeleton while loading: text-shell bars 20px height, radius 8px
  (light `hsl(0,0%,89%)` / dark `hsl(0,0%,16%)`), see `yt-watch-skeleton.css`.
