# YouTube design tokens — the parity sheet (R27 contract)

Captured 2026-09-23 from live youtube.com by the lead. Provenance tags:
**[rendered]** = measured live DOM computed styles · **[css]** = youtube.com's
own served CSS · **[documented]** = the known YouTube design system, to be
implemented to this sheet. Dark values are the DEFAULT product theme (YouTube's
dark); light values are the second supported theme.

## Canvas & surfaces

| Token | Dark | Light | Provenance |
| --- | --- | --- | --- |
| app background | `#0f0f0f` | `#ffffff` | [rendered] `ytd-app` bg; [css] skeleton `html[dark] #grid-container-skeleton{background-color:#0f0f0f}` |
| raised surface (chips row, description panel, menus) | `#272727` | `#f2f2f2` | [documented] + [rendered] chip row |
| hover surface | `rgba(255,255,255,0.1)` | `rgba(0,0,0,0.05)` | [documented] + [rendered] action button bg (light `rgba(0,0,0,0.05)`) |
| divider / border | `rgba(255,255,255,0.2)` (hairline `hsla(0,100%,100%,.08)`) | `rgba(0,0,0,0.1)` | [css] skeleton dark border; [documented] |
| primary text | `#f1f1f1` | `#0f0f0f` | [rendered] title color both themes |
| secondary text | `#aaaaaa` | `#606060` | [rendered] meta color both themes |
| tertiary/disabled text | `#717171` | `#909090` | [documented] |
| link / interactive accent | `#3ea6ff` | `#065fd4` | [documented] |
| brand/progress red | `#f03` (progress bar, logo red) | same | [documented] |
| snackbar/toast surface | `#f1f1f1` bg / `#0f0f0f` text (inverted, light theme) | `#0f0f0f` bg / `#f1f1f1` text | [documented] |

## Typography (Roboto, Arial, sans-serif — the exact stack)

| Role | Size / weight / line-height | Color context | Provenance |
| --- | --- | --- | --- |
| body base | 14px / 400 / 20px | primary text | [rendered] desc 14/20; [documented] |
| page/watch title (h1) | 20px / 700 / 28px | `#f1f1f1` / `#0f0f0f` | [rendered] watch h1 |
| card title (feed) | 16px / 500 / 22px, 2-line clamp | primary | [documented] |
| search result title | 18px / 400 / 26px, 2-line clamp | primary | [rendered] |
| channel/creator row | 14px / 400 (hover: primary) | secondary | [documented] |
| meta line (views · date) | 12px / 400 | secondary (`#aaa`/`#606060`) | [rendered] |
| description snippet | 12px / 400 / 18px, 2-line clamp | secondary | [rendered] |
| duration pill | 12px / 500, `#fff` on `rgba(0,0,0,0.8)`, radius 4px, padding 3px 4px | — | [rendered] |
| badge text (e.g. CC/subtitles) | 12px / 500, secondary color, 1px border `rgba(...)` pill | — | [rendered] badge styles |
| button label | 14px / 500 | — | [rendered] action button 14/500 |
| section heading (e.g. comments) | 20px / 400 | primary | [documented] |
| chip label | 14px / 500 | primary on chip surface | [documented] chip h=32px |
| rail nav label | 14px / 400 (active: 500?) | primary | [documented] |

Font stack (exact, [rendered]): `"Roboto", "Arial", sans-serif`. Self-host or
system-fallback per the repo's no-new-runtime-deps law: `Roboto, Arial,
Helvetica, sans-serif` with the system fallback chain — the parity target is
Roboto rendering where available.

## Geometry

| Element | Value | Provenance |
| --- | --- | --- |
| topbar height | 56px | [rendered] masthead rect |
| left rail width (labeled, ≥1280px) | 240px | [rendered] guide rect |
| rail icon-only (792–1279px) | 72px | [documented] |
| bottom nav (mobile <792px) | 48px + safe-area | [documented] |
| chip bar height | 32px chips, row padding ~12px | [rendered] chip h=32 |
| home grid card | 16:9 thumbnail, radius 12px (2025 YouTube rounded cards), gap 16px×16px (4 cols ≥1300px, 3 ≥1000px, 2 ≥600px, 1 <600px) | [documented] + [css] era |
| search result card | 360×202px thumbnail left, 16px gap, meta column right | [rendered] (360/202 thumb srcs) |
| watch layout @1440 | primary 1012px (x=16) + secondary 412px (x=1028), page margin 16px→24px@≥1600 | [rendered] measured |
| watch player | 996×560 within primary (16:9 + 12px control bar) | [rendered] measured |
| related compact card | 168×94px thumbnail, 4px gap, meta right | [documented] |
| action buttons (watch) | 40px height, pill radius 20px, segmented like/dislike | [rendered] (20px 0 0 20px segmented) |
| channel avatar (watch) | 40×40 | [rendered] |
| scrollbar | 16px track width, 8px thumb radius, thumb `hsl(0,0%,67%)`/dark, 4px transparent border, 56px min thumb height | [css] skeleton |
| skeleton text shells | 20px height, radius 8px (light `hsl(0,0%,89%)` / dark `hsl(0,0%,16%)`) | [css] skeleton |

## Motion & states

| Interaction | Value | Provenance |
| --- | --- | --- |
| default transition | 120–200ms ease (hover bg, chips, buttons) | [documented] |
| card hover | thumbnail preview/progress disclosure after ~500ms dwell; title color holds | [documented] |
| control reveal (player) | controls fade on 2–3s idle; reveal on mousemove | [documented] |
| red progress bar | `#f03` fill, white scrubber dot 12px, hover expands to 4–5px bar | [documented] |
| focus ring | 2px outline `#3ea6ff`-family on keyboard focus | [documented] |
| toast/snackbar | bottom-left, `#f1f1f1`/`#0f0f0f` inverted pill, ~4s auto-dismiss | [documented] |

## Player chrome anatomy (OPERATE reference)

Left→right in the control bar: play/pause (· next/up-next when queued), volume
(hover slider), time `0:00 / 7:45`, spacer, cc/captions toggle, settings gear
(popup menu: speed, quality, etc.), miniplayer, theater, fullscreen. Hover:
scrub preview; double-click fullscreens; double-tap zones ±10s on touch.
Keyboard: `space`/`k` play-pause · `j`/`l` ∓10s · `←`/`→` ∓5s · `↑`/`↓`
volume · `f` fullscreen · `t` theater · `m` mute · `c` captions · `0–9`
seek-to-percent. Menu: YouTube's settings popup anatomy (two-level menu with
back arrow). [documented] — implement to this sheet; WebFlix's honest
capability rows (Translate, Transcript, AI, Where to watch) live in the
settings popup / overflow, progressively disclosed, capability-truth-gated.
