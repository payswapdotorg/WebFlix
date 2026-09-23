# R28-observer evidence bundle — Worker A (THE OBSERVER)

Lane: `wfx/r28/corpus` · Captured 2026-09-23T22:57–00:0xZ from live youtube.com
(agent-browser, headless Chromium 153 — UA `HeadlessChrome/153.0.0.0`, viewport 1440×900,
logged-out session, `hl=en&gl=US`, egress geo HK, dpr 1, UTC).

## Environmental record (binding for every capture)
- **Playability gate**: `ytInitialPlayerResponse` served with `streamingData` stripped; watch-page data hydration flaky (comments hydrated on 1 of 3 soft-nav landings); `/watch` direct URL loads 302 → google.com/sorry. Shell/search/channel/filters/comments render normally. Identical gate hit the operator's logged-in tab lead-side at ~23:15Z (`docs/parity-lab/r28/lead-captures/README.md` @ 0755a38).
- Login injection attempt (sanctioned): cookies set → server cleared the 1P auth chain on first contact; login did not carry; logged-out truth recorded per the brief.
- Theme passes: light (default) + dark via Settings ▸ Appearance ▸ Dark theme; **restored to Light** after capture.

## captures/ (all @1440×900)
| File | Surface / state |
| --- | --- |
| 00-home-shell-state.light.png | home shell, empty-visitor variant (light) |
| 10/11-shorts-*.light.png | /shorts shell + post-Play-attempt state |
| 20-watch-softnav-state.light.png | watch soft-nav landing (shell state) |
| 30-search-results.light.png / 39-search-results.dark.png | search results, both themes |
| 31-search-filters-panel.light.png | Filters dialog open |
| 32-search-hover-preview-during.light.png | **hover preview mounted during dwell** |
| 33-channel-card-hover.light.png | channel-grid card hover |
| 34/35-card-menu*.light.png | card 3-dot menu open |
| 36-settings-menu.light.png / 37-settings-appearance-dark.png | Settings menu + Appearance submenu (theme flip) |
| 38-channel-videos.dark.png | channel rich grid, dark |
| 40-watch-hydrated.light.png / 41-watch-comments.light.png (--full) | **hydrated watch + comments section** |
| 42-comment-composer-expanded.light.png | composer interaction state |
| 43-player-chrome-revealed.light.png / 44-player-overflow-panel.light.png | player chrome gated-state |
| 45-comment-replies-expanded.light.png | replies expander attempt (continuation gated) |
| 46-share-sheet-open.light.png / 47-share-startat-copied.light.png | **share sheet open + post-Copy state** |
| 48-channel-shorts-grid.light.png | shorts grid cards |

## raw/ (machine-readable dumps — every value also cited in the sheets)
`search-light|search-dark.core.json` (fonts inventory, woff2 URLs, masthead, rail, theme state) ·
`search-light|search-dark.search.json` (result rows, badges, clamps) ·
`search-light.cssmined.json` (served-CSS mining incl. hashed custom-prop discovery) ·
`channel-lofigirl|channel-dark.{core,grid,lockup}.json` (rich-grid + lockup card anatomy) ·
`watch-light.{watch,comments}.json` (watch layout + comments battery) ·
`hover-search-result2.during.json` (hover timeline).

## tools/ (reproducible measurement scripts — rerun on any healthy window)
`dump-core.sh` · `dump-search.sh` · `dump-grid.sh` · `dump-lockup.sh` · `dump-watch.sh` ·
`dump-css-miner.sh` · `hover-measure.sh` — all agent-browser eval based; per-sheet selectors cited inline.

## Session provenance
- Base: main @ 3304b65; branch `wfx/r28/corpus` (this lane).
- The operator's session cookies were handled per the lab's hygiene law: injected once for youtube.com only, never logged/committed, cleared from the browser after the attempt; no account writes were performed at any point (read-only navigation/menus/hovers; playback never reached playable state).
