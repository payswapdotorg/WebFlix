# Hover preview — the R28 sheet (the operator's complaint #1: "hovering over thumbnails doesn't display gifs")

Captured 2026-09-23T23:0x–23:5xZ from live youtube.com by Worker A (agent-browser, headless Chromium 153, 1440×900, logged-out, en-US, egress geo HK, light theme). Provenance tags: **[rendered]** = measured live DOM/computed styles · **[documented]** = established YouTube behavior not fully exercisable in this environment · **[rendered-by-lead-R27]** = R27 corpus value (docs/parity-lab/reference/). Raw evidence: `evidence/r28-observer/raw/hover-search-result2.during.json`, captures `32-search-hover-preview-during.light.png`, `33-channel-card-hover.light.png`.

## Environmental truth (binding context for every value below)
- The sandbox session is **bot-gated at the playability layer**: `ytInitialPlayerResponse` arrives with **`streamingData` stripped** (shorts page verified: `playerResp:true, streamingData:false`). The preview **player mounts and runs its state machine**, but no media frames decode. DOM-level truth below is [rendered]; frame-level behavior is [documented].
- Same gate independently confirmed lead-side on the operator's logged-in tab at ~23:15Z (see `docs/parity-lab/r28/lead-captures/README.md` @ 0755a38).

## The dwell threshold — what the timeline shows [rendered]
Instrumented hover: mouse moved onto a search result thumbnail (result 2, "lofi hip hop radio - beats to study/relax to", thumb 500×281), MutationObserver + 100ms sampler running from `t0` = hover start:

| Event | ms after hover start | Evidence |
| --- | --- | --- |
| `ytd-video-preview` singleton inserted (with `a#media-container-link`) | **~147ms** | mutation event `[147,"A#media-container-link…ytd-video-preview"]` |
| `video.video-stream.html5-main-video` inserted inside preview | **~193ms** | mutation event `[193,"VIDEO#.video-stream.html5-main-video"]` |
| `div#inline-preview-player.html5-video-player.ytp-hide-controls.ytp-exp-bottom-control-flexbox` mounted | **~193ms** | mutation event, same tick |
| Preview visible & stable (sampler confirms every 100ms through 1.7s+) | 201ms → 1700ms+ | samples array |

- **Threshold ≈ 150–200ms** from pointer-over to preview mount — NOT the ~500ms the R27 sheet carried ([rendered-by-lead-R27] Motion row: "hover preview after ~500ms dwell"). B should use **~150ms dwell → preview mount** as the current measured truth; the R27 value is superseded on this surface.
- Polling cadence note: threshold resolved at observer granularity (events fired at 147/169/193ms), consistent with a ~150ms internal timer, not 500ms.

## What renders [rendered]
- **A singleton overlay, not a per-card inline `<video>`**: exactly ONE `ytd-video-preview` element exists per page; it is repositioned/reused per hovered card. `position:absolute; left:0; top:0` with transform-free placement, `display:flex`, z-index auto (stacking via DOM order).
- **Preview grows beyond the card**: preview box measured **524×305** at (252,690) for a 500×281 thumbnail — i.e. **+24px outward (~12px per side)**: the preview "pops" larger than the card it previews. `pointer-events:none` on the hidden state.
- **The preview player**: `#inline-preview-player` with classes `html5-video-player ytp-hide-controls ytp-exp-bottom-control-flexbox` — **controls hidden** variant of the standard player, flexbox bottom control experiment flag on.
- **Overlay chrome present in the preview player** [rendered, gated-state text]: "Tap to unmute", "2x" (speed pill), "Info", "Shopping" — i.e. the production preview normally autoplays **muted** (hence "Tap to unmute") with a **2x speed affordance**; a **progress bar** component (`#progress`-family) is part of the preview player markup.
- **Preview video element**: `video.html5-main-video` mounted with `src` empty in this gated session (`readyState 0`, paused). In the gated state the card's **static thumbnail remains visible** beneath/behind the preview chrome — the preview never "blanks" the card.
- **Card itself does NOT transform** [rendered]: thumbnail `transform: none`, `opacity: 1`, `border-radius: 12px` unchanged on hover; title color unchanged (`rgb(15,15,15)` before == after on search — matches R27's search-card-grammar note "hover is subtle"). **No card scale/expand effect exists on current production** — the expansion belongs to the preview popup, not the card.

## Un-hover behavior [rendered]
- Moving the pointer off the card → the singleton **fades out via opacity transition** (`transition: all`; hidden state measured `opacity: 0`, `visibility: visible`, `display: flex`, `pointer-events: none`). **The element is NOT removed from the DOM** — it persists as the reuse singleton. B should implement hide-with-fade + reuse, not unmount.
- In the gated session the element lingers mounted (teardown animation tied to player state machine); with playable media the fade completes in [documented] ~200–400ms (R27 default-transition band 120–200ms; not measurable here).

## Where previews appear [rendered + documented]
| Surface | Preview | Evidence |
| --- | --- | --- |
| Search results rows | YES — singleton mounts on thumb hover | measured (result 2) |
| Channel Videos grid (lockup cards) | YES — singleton present on card hover | measured (`33-channel-card-hover.light.png`, `previewPresent:true`) |
| Home feed cards | same singleton system [documented] — home feed served the empty "Try searching to get started" variant to the sandbox session (no cards to hover); the singleton + inline-preview-player are page-level components | environmental note |
| LIVE rows | thumbnail overlay shows **LIVE badge** instead of duration pill [rendered]; preview mount behavior same family [documented] | badge row on lofi live results |
| Shorts cards | Shorts shelf/grid cards do not use the video preview singleton (different engagement model) [documented] | no singleton on shorts grid hover |
| Already-watched | progress bar overlay component exists in card markup (`ytd-thumbnail-overlay-resume-playback-renderer` family) [css]; watch-state variants not exercisable logged-out | CORPUS-PENDING (login surfaces) |

## What B must build for parity (the operator's #1)
1. Dwell ~150ms → mount preview singleton (reuse one element; reposition per card).
2. Preview = popped copy of the thumb (+12px/side), inline muted-autoplay video of the content, hidden-chrome player with "Tap to unmute", 2x pill, progress bar, "Info" affordances.
3. Un-hover → opacity fade-out, element retained for reuse.
4. No card-scale hover effect; title color unchanged.
