# Search anatomy — the R28 sheet

Captured 2026-09-23T23:1x–23:5xZ from live youtube.com results for "lofi hip hop radio" by Worker A (1440×900, logged-out, **light + dark passes**). Fully hydrated surface. Provenance: **[rendered]**. Raw: `raw/search-{light,dark}.search.json`, filters probes, captures `30/31/39`.

## Results row [rendered]
| Part | Measured value |
| --- | --- |
| Row | `ytd-video-renderer`, **1152w × ~281h** at x=264 (rail 240 + 16 margin + 8 pad) |
| Thumbnail | **500×281** (16:9, `large` size variant at 1440) — `a#thumbnail` **radius 12px**; img object-fit cover |
| Duration badge | `badge-shape` bottom-right — **12/500 `#fff` on `rgba(0,0,0,0.6)`, r4, pad 1px 4px** ("2:50:41" measured) |
| LIVE row | red LIVE badge variant instead of duration ("LIVE" badge text measured on lofi rows; meta shows "11K watching") |
| Title | `a#video-title` — **18px / 400, lh 26**, `#0f0f0f`/`#f1f1f1`, **clamp 2** (maxHeight 52px) |
| Meta line | **12px / 400**, `#606060`/`#aaa` — "698K • 1y ago" (new split-span grammar: views and age as separate spans) |
| Channel row | avatar **24×24** + name 12/400 `#606060`/`#aaa` + verified badge slot |
| Description snippet | `.metadata-snippet-container` — 12px/400 lh18, clamp 2, `#0f0f0f` |
| Row extras | 3-dot "More" menu on the right; hover → **preview singleton** after ~150ms (hover-preview.md), title color unchanged on hover |
| Channel/playlist result types | interleaved (`ytd-channel-renderer`, `ytd-playlist-renderer` families) [documented] |

**Drift note for C:** R27 recorded search thumbs 360×202 — current production at 1440 serves the **500×281** large variant. Reconciler should update the contract's search-thumb geometry.

## Chips row [rendered]
- `#chip-bar` under `ytd-search-header-renderer` at y≈59 — chips measured for this query: **All (active), Shorts, Unwatched, Watched, Videos, Recently uploaded, Live** — search chips are query-contextual.
- Chip anatomy: h32, r8, 0 12px, 14/500; active `#0f0f0f`/`#f1f1f1` (light) inverted dark; inactive `rgba(0,0,0,0.05)`/`rgba(255,255,255,0.1)`; scroll arrows on overflow.

## Filters [rendered]
- **Filters button** in the header row → panel `tp-yt-paper-dialog` **696×518**, bg `#fff`, r12, shadow `rgba(0,0,0,0.15) 0 0 24px 12px`, title "Search filters".
- Groups (all options measured): **TYPE** Videos, Shorts, Channels, Playlists, Movies · **DURATION** Under 3 minutes, 3–20 minutes, Over 20 minutes · **UPLOAD DATE** Today, This week, This month, This year · **FEATURES** Live, 4K, HD, Subtitles/CC, Creative Commons, 360°, VR180, 3D, HDR, Location, Purchased · **PRIORITIZE** Relevance, Popularity.

## Results count + pagination [rendered]/[documented]
- 19 `ytd-video-renderer` initially; infinite scroll continuation below (same pipeline as feed pagination).

## What B must build
Search results page: 1152px rows, 500×281 r12 thumb-left/text-right rows, 18/400 clamped titles, 12px meta split-spans, contextual chips bar, Filters dialog with the five groups above.
