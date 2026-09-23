# Home anatomy — the R28 sheet

Captured 2026-09-23T23:0x–23:5xZ from live youtube.com by Worker A (1440×900, logged-out, light + dark). **Environmental truth first**: the sandbox session (cold, no watch signals, datacenter context) is served the **empty-visitor home variant** — shell renders (masthead, rail, "Try searching to get started / Start watching videos to help us build a feed of videos you'll love.") with zero grid items. Card/chip/shelf anatomy below is therefore measured on the **same component families on live sibling surfaces** (channel Videos grid for the lockup card, search header for the chip bar, channel Shorts tab for the shorts card) — every row cites its surface. Raw: `raw/channel-*.grid/lockup.json`, chips probes, captures `00/38/48`.

## Shell [rendered]
- **NO hero banner, NO feed-config section** — masthead → chip bar → grid immediately (confirmed on every populated sibling surface; home shell itself carries no banner either).
- Masthead 56px: hamburger (Guide), logo 129×56 region, search box + mic (mic 40×40 r100 bg rgba(0,0,0,0.05)), **Settings gear**, **Sign in pill** (40h r20 1px border). Logged-out masthead has NO create/notifications cluster (create/bell are logged-in chrome — CORPUS-PENDING, cite lead-captures README: avatar rightmost + notifications-count-in-title observed in the healthy window).
- Rail (guide) 240px: item rows 40h r10, text 14/400/20; sections: Home, Shorts, Subscriptions, You, History → Explore (Music, Movies, Live) → "More from YouTube" (Try Premium, YouTube Music, YouTube Kids) → footer links (About Press Copyright Contact us Creators Advertise Developers Terms) + location chip (e.g. "HK"). Sign-in promo bar ("Sign in to like videos, comment, and subscribe. Sign in") in the rail when collapsed-to-icon rail is not present — promo renders in the open guide.

## Chip bar [rendered — on the search-header sibling; same #chip-bar/chip-shape system]
- Container `#chip-bar` (transparent, ~50h, directly under masthead), left+right scroll arrows render on overflow.
- Chip: `div.ytChipShapeChip` — **h32, r8, pad 0 12px, 14/500**; active `#0f0f0f` bg / `#f1f1f1` text (light) inverted in dark; inactive `rgba(0,0,0,0.05)` / `rgba(255,255,255,0.1)`.
- Home's own chip set (All, Music, Gaming, …) — CORPUS-PENDING pixel capture (empty home variant); grammar identical per [css].

## The card grid [rendered — channel Videos grid, current `yt-lockup-view-model` production markup]
- Grid: **3 columns at 1440 on channel surface** (home grid is 4 columns @≥1300 per [rendered-by-lead-R27] — home and channel grids differ in density), card **347×~251**, gutter **16px**, row pitch ~306.
- Card = `yt-lockup-view-model`: thumbnail (`yt-thumbnail-view-model`) **r12, 16:9** (347×195), duration badge bottom-right **8px inset**: `badge-shape` — text 12/500 `#fff` on **`rgba(0,0,0,0.6)`**, r4, pad 1px 4px, plus icon slot for CC/etc badges.
- Title: `a.ytLockupMetadataViewModelTitle` → **16px/500 `#0f0f0f`**, 2-line clamp family (h3 wrapper resets to 11.7px/700 — B must style the anchor, not the h3).
- Metadata row (channel-surface variant): `yt-content-metadata-view-model` MediumText — **10px/400 `#606060`** ("160K views • 2 days ago"). Home-family variant carries 12px #606060 + channel row (avatar 36 + name) per [rendered-by-lead-R27].
- **3-dot menu**: "More actions" 40×40 → **Add to queue, Save to playlist, Download, Share** (measured open; report/feedback family below fold).
- Card hover: **no scale/transform** — the preview singleton + menu button are the hover behaviors (hover-preview.md).

## Shorts shelf [rendered — channel Shorts tab grid; the shelf-on-home uses the same card]
- `ytm-shorts-lockup-view-model`: **208×387 card, 208×311 (9:16-ish) thumb**, ~4px gutters, 5–6 columns in the 1152 content width; title below thumb; no duration badge (shorts).

## Infinite scroll [documented]
- Grid loads ~30 items then appends pages on scroll-to-bottom (continuation pipeline); the sandbox home variant had no feed to scroll — pagination grammar corroborated by channel grid (30 initial items) [rendered].

## Honest gaps
- Home-populated capture (4-col grid, home chips set, shelf interleaving, infinite scroll on home) — CORPUS-PENDING: the sandbox receives the empty variant and the operator's logged-in tab degraded at the same gate (~23:15Z; cite `docs/parity-lab/r28/lead-captures/README.md` @ 0755a38).
