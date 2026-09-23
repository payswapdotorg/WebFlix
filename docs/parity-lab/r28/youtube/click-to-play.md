# Click-to-play — the R28 sheet (the operator's complaint #2: "you have to click 3 times before a video plays")

Captured 2026-09-23T23:0x–23:4xZ from live youtube.com by Worker A (agent-browser, headless Chromium 153, 1440×900, logged-out, en-US). Provenance tags as per house rules. Raw evidence: mutation-timeline transcript (inline), `evidence/r28-observer/captures/20-watch-softnav-state.light.png`, `40-watch-hydrated.light.png`.

## YouTube's law, measured: ONE click from any card to the watch route [rendered]
Instrumented run (search results page, trusted click on result title `a#video-title`):

| Timeline point | Measured value | Notes |
| --- | --- | --- |
| Click issued (trusted mouse click) | t=0 (bash wall-clock: 23:0x:xx.325) | `date +%s%3N` before/after |
| Soft-navigation to `/watch?v=…` begins | ≤ ~1.2s (SPA route change, `navType: navigate`, JS context survived — no document reload) | URL pattern `/watch?v=<11-char id>` (+ `&pp=` personalization-param family on organic links) |
| Watch layout shell mounted (`ytd-watch-flexy`, `#columns`, `ytd-comments`, `#movie_player`) | ~1.2s | mutation events: `watch-active-metadata`, `#panels.panels-transitioning` at 1196ms |
| Video element `video.html5-main-video` present | immediately after player mount | `video:true` from first post-nav poll |
| Player box geometry settled | 996×560 at (16,68) | matches R27 lead value exactly |
| Comments section hydrated (3rd attempt) | ≤ 9s — "85 Comments", 20 threads | flaky in gated env (see below) |

- **No intermediate page, no confirmation, no quality dialog**: card click → SPA route → player. ONE gesture.
- Playback start itself: in this sandbox **the playability layer is gated** ("Sign in to confirm you're not a bot" error screen renders at ~1.2s when the session is classified; `streamingData` stripped — no frames decode). Time-to-first-moving-frame, sound-on/off, and autoplay-attributes are therefore **[documented] + [rendered-by-lead-R27]** below, with the DOM-level path [rendered] as above.

## Playback start behavior [documented] / [rendered-by-lead-R27]
- Watch pages **autoplay immediately** after the click-through (no second gesture) — the player mounts with `autoplay` intent; muted-autoplay where browser policy requires, sound follows the user's gesture.
- Feed hover previews are muted ("Tap to unmute" measured [rendered]); the click-through watch starts **with sound** when the initiating gesture allows it [documented].
- Player chrome: **reveal-then-auto-hide** — controls visible on mount/idle-cursor, auto-hide after ~3s idle (R27 Motion row: control reveal 2–3s idle); mouse move re-reveals. The chrome bottom bar mounts hidden in the gated state (`display:none` measured [rendered]) — the reveal machinery is player-state-driven.

## Repeat from other surfaces [rendered]
| Entry surface | Path to playing video | Clicks |
| --- | --- | --- |
| Search results | click title/thumbnail → `/watch?v=…` SPA route | **1** |
| Channel Videos grid (lockup cards) | click `a.ytLockupMetadataViewModelTitle` → `/watch?v=…` SPA route (measured: URL flips to /watch, player + comments mount) | **1** |
| Home feed | same card grammar (empty-variant served to sandbox — not directly hoverable) | 1 [documented] |
| Direct URL load of /watch | **302 → google.com/sorry** (bot interstitial) — a direct URL load is NOT the user path; organic in-app clicks use the SPA/XHR pipeline which is not URL-gated | environmental |
| Shorts | `/shorts/<id>` route, vertical feed, autoplay on scroll-into-view | n/a (shorts sheet) |

## The player the click lands on [rendered, gated-state inventory]
- Player container `#movie_player` at (16,68) **996×560** in the standard two-column watch layout (16px page margins; matches R27).
- Mounted chrome elements (gated state, all present in DOM): large **Play button — aria-label `Play (k)`** (keyboard hint ships in the label), `ytp-unmute` popup, `ytp-cards-button` ("Show cards"), **`ytp-overflow-button` "More"** (overflow panel pattern), **`ytp-copylink-button` "Copy link"**, `ytp-playlist-menu-button`, share-panel-close / overflow-panel-close / playlist-menu-close buttons (panel system), `ytp-gradient-bottom`, `.ytp-progress-bar` (present, height 100% of its 3px-ish track container), `.ytp-time-display` ("0:00 / 0:00").
- Gated overlay state: large Play + "Sign in to confirm you're not a bot" screen (when classification trips) or empty-chrome (when only stream data is stripped).

## What B must build for parity (the operator's #2)
1. **One click, zero confirmations**: card → SPA route → autoplaying player. No 3-click path (WebFlix divergence class: multi-gesture-to-play is the complaint).
2. Autoplay with sound on click-through; hover previews muted; chrome reveal + ~3s auto-hide.
3. `/watch?v=<id>` URL shape; soft navigation (no full reload between surfaces).
