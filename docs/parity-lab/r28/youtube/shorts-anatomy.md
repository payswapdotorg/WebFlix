# Shorts anatomy — the R28 sheet

Captured 2026-09-23T23:0x–23:5xZ from live youtube.com by Worker A (1440×900, logged-out). **Environmental truth**: the `/shorts/<id>` vertical feed is playability-gated in this sandbox (player shell + "Play" CTA render; `streamingData` stripped; no media) — DOM shell + shorts CARD anatomy are [rendered]; the interactive rail/counts are **CORPUS-PENDING** (cite `docs/parity-lab/r28/lead-captures/README.md` @ 0755a38). Raw: shorts probes, captures `10/11/48`.

## The vertical feed (`/shorts/<id>`) [rendered shell]
- `ytd-reel-video-renderer` mounts (1 per feed slot); player container `#shorts-player` present on hydrated loads (absent on the degraded second landing — flaky gate signature).
- Mounted controls in the shell: **Play button** (CTA), "Show cards" ×2 (cards UI), **Close**, **More**, Playlist, Watch later buttons, 2 × navigation-button mounts.
- Video element mounts with empty src (gated).

## Shorts cards (grid surface — channel Shorts tab) [rendered]
- `ytm-shorts-lockup-view-model`: card **208×387**, thumbnail **208×311** (9:16-ish), ~**4px gutters**, 5–6 columns across the 1152 content width at 1440.
- Title below the thumb ("Lofi Teacher is here, Jade is back…"); **no duration badge**; 45 items in the initial grid.
- Click → `/shorts/<id>` route [documented].

## Action rail + engagement (the production grammar) [documented]/[css] — CORPUS-PENDING for pixels
- Right-side vertical rail: like / dislike / **comments-count** / share / more (kebab) + audio toggle at the player's bottom-right; counts render under the icons; title + @channel + Subscribe pill inline bottom-left over the video. Reel-specific composer opens comments as a bottom engagement panel [documented].
- Navigation: ArrowUp/ArrowDown + wheel + rail arrows page the feed [documented].

## What B can build today from this sheet
1. Shorts grid cards (208×311, tight 4px gutters, title, no badge).
2. The `/shorts/<id>` route shell with the vertical player container.
3. Rail/audio/counts from the [documented] grammar with a CORPUS-PENDING flag for measured pixels in the next healthy window.
