# R27 Production Parity Sweep — verdict sheet

- Base: https://webflix-steel.vercel.app
- Captured: 2026-09-24T08:13:04Z
- Viewport: 1440x900, dark + light
- Composites: 4

## Side-by-side pairs (corpus left / production right)

- `vs-home.light.png` — HOME (light) vs the captured YouTube feed
- `vs-search.light.png` — SEARCH (light) vs the captured YouTube search
- `vs-search.dark.png` — SEARCH (dark) vs the captured YouTube search
- `vs-watch.light.png` — WATCH (light) vs the captured YouTube watch layout

## Token eyeball points (no corpus screenshot — checked vs the sheet)

- shorts: 9:16 stage, 48px action rail, 16/500 title
- library/settings: the token anatomy (cards/rows/panels/pills)
- shell: topbar 56 / rail 240-72 / chip 32 r8; scrollbar 16/8
- player chrome: #f03 scrub, 40px pills r20, ~3s idle fade

## The player clarification (R28)

The R27 sweep's `watch` row captured `/watch` — WebFlix's long-form BROWSE surface.
R28's one-click retarget moved video watching to `/player?id=...` (cards link
directly; `/item` is the kebab's Details deep-action). The real watch comparison:

- `vs-player.light.png` — corpus WATCH (light) vs production PLAYER (light)
- `prod-player.dark.png` / `prod-player.light.png` — the player surface both themes
  (boot = OS-follow light in the capture browser, per B's theme seam; toggled dark verified)
- VLM verdicts: home ACCEPTABLE / search.dark ACCEPTABLE / player ACCEPTABLE
  (C's in-lane VLM cross-check: "YouTube-like layout CONFIRMED")
