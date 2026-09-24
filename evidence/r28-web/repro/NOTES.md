# R28-B repro — the operator's 7 complaints, reproduced on the lane's own dev server

Boot: `apps/web` service mode (`WFX_API_BASE=https://webflix-api.vercel.app`), port 3000,
viewport 1440×900, dark default. Session `wfxrepro` (agent-browser, Chromium).

| # | Operator complaint | Repro evidence | Confirmed |
| --- | --- | --- | --- |
| 1 | "you have to click 3 times before a video plays" | `02-click1-lands-item-interstitial.png` (click 1: card → `/item`), `03-click2-lands-player.png` (click 2: Play → `/player`), `04-click3-player-state-after-wait.png` + eval (iframe src `https://www.youtube-nocookie.com/embed/3uyGhtARP4M?enablejsapi=1` — **no `autoplay` param**, so click 3 happens INSIDE the YouTube iframe) | YES — 3 clicks |
| 2 | "hovering over thumbnails doesn't display gifs" (inline previews) | `05-hover-dwell-2s-no-video-preview.png` + eval: `videosInCard: 0`, no preview mount — zero inline media on dwell | YES — absent |
| 3 | "the theme and fonts used are not the same" | eval on `/`: `document.fonts` contains ONLY Next's internal Geist faces (unloaded); declared stack `Roboto, Arial, Helvetica, sans-serif` resolves to the OS fallback | YES — zero Roboto woff2 loaded |
| 4 | "the background color is different" | `01-home-hero-and-config-above-grid.png`: body `#0f0f0f` is token-correct; elevated/hairline/masthead surfaces surveyed against the live corpus in the R28 measurement notes (see `docs/parity-lab/r28/web-notes/color-survey.md`) | PARTIAL — body correct, surfaces drift (survey quantifies) |
| 5 | home leads with hero + config, not chips+grid | `01-home-hero-and-config-above-grid.png`: feed-mode radios (For you/Following/Your imported feed/Blend), "Manage feeds in Settings", "Connect a source", "Bring your feed", then a `Featured:` HERO region — all ABOVE the chip bar and card rows | YES |
| 6 | "there's no comments" | `06-player-page-no-comments-section.png` + eval: `commentNodes: 0` on the player surface | YES — absent (R27 recorded it as an honest omission; operator has overridden) |
| 7 | "sharing doesn't work the same" | `07-share-is-a-details-popover.png`: share is a small `<details>` popover ("Copy WebFlix link" / device share), NOT the YouTube share modal (link field + Copy, Start-at checkbox, target row, Embed/Copy-link bottom row) | YES — different anatomy |

## The click-count trace (the primary functional complaint)

```
home card  →(click 1)→  /item  (action bar: Play / Like / Save / Watchlist / playlist /
                                    queue / share / Where-to-watch "Play this way"…)
           →(click 2)→  /player (YouTube embed WITHOUT autoplay)
           →(click 3)→  playback starts (the click lands inside youtube's own iframe player)
```

YouTube: ONE click on a card → watch surface → playback starts immediately (the click is
the user gesture). The target state for R28-B: card click → `/player?...` with an
autoplaying embed (muted-autoplay fallback + unmute affordance when the browser blocks
unmuted autoplay), `/item` demoted to the card's quiet action row (Details).
