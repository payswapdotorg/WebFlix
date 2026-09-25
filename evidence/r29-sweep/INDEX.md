# R29 Production Sweep — verdict sheet (operator acceptance evidence)

- Base: https://webflix-steel.vercel.app (production, auto-deployed from `main @ 1a3b594`)
- Swept: 2026-09-25T03:44Z → 04:07Z (all probes + captures)
- Viewport: 1440x900 · light (the default boot) + dark (flipped via the R29 gear's
  Appearance subpage — dogfooding the merged seam; flip verified live mid-capture:
  `data-theme=dark` + `wfx-theme=dark` + `meta #0f0f0f` together)
- Lane: `wfx/r29/sweep` (evidence-only; no app code changed)
- Probes (b-probe house style): `probes/liveness.json` · `probes/search.json` ·
  `probes/watch.json` · `probes/masthead-keyboard.json` · `probes/home.json` ·
  `probes/vlm-verdicts.json` (+ `probes/captures.log`, raw VLM runs in `vlm/`)

## Liveness + served-CSS markers (THE MERGE PROOF)

- `/` → **HTTP 200** (Vercel, 731.8 KB served HTML; x-vercel-id `hkg1::iad1::…`)
- Served immutable CSS (`/_next/static/immutable/chunks/3wd59hi6fq0df.css`, 93.2 KB):
  - **`--wfx-pill-bg:#0009`** — BOTH theme blocks — **the b10e0aa ruling (0.8 → 0.6) is LIVE**;
    no `--wfx-pill-bg:#000c` anywhere
  - **All NINE canonical tokens declared** (both theme blocks, D16/F4): `--wfx-border-hairline`
    (`#ffffff14`/`#eee`), `--wfx-pill-bg`, `--wfx-pill-fg` (`#fff`), `--wfx-scrollbar-thumb`
    (`#ababab`/`#c2c2c2`), `--wfx-toast-bg` (`#f1f1f1`/`#0f0f0f`), `--wfx-toast-fg`
    (`#0f0f0f`/`#f1f1f1`), `--wfx-chrome-scrim` (`#000000bd`), `--wfx-chrome-fg` (`#fff`),
    `--wfx-stage-black` (`#000`) — every value equals the contract's literals
  - **Shorts-shelf geometry LIVE**: `.wfx-row__scroller--shorts` →
    `grid-auto-columns:208px; grid-auto-flow:column; gap:4px; grid-template-columns:none`
  - The two residual `#000c` literals are exactly the matrix's recorded out-of-scope pair
    (`.wfx-player__unmute` + `.wfx-hoverpreview__unmute:hover`)
- Served-HTML theme seam (O6-meta): `<meta name="theme-color" content="#0f0f0f"
  data-wfx-theme-color="true"/>` + the inline seam script, meta before `<body>`

## DOM re-probes of the R29 headline set (production, 1440x900)

| surface | claim (matrix row) | production measurement | verdict |
|---|---|---|---|
| SEARCH row (N3) | 1152×281 · thumb 500×281 r12 · title 18/400/26 clamp-2 · meta 12/400/18 `rgb(96,96,96)` · avatar 24×24 | **every value byte-exact** (`probes/search.json → rowAnatomy`) | **VERIFIED** |
| FILTERS dialog (N23) | 696px · r12 · shadow `rgba(0,0,0,0.15) 0 0 24px 12px` · "Search filters" · TYPE + DURATION wired · unbacked groups honestly absent + named | **696×308 (the honest 2-group content-sum) · r12 · shadow byte-exact** · groups TYPE/DURATION as real link-options · absence note names upload dates/feature flags/popularity · X closes | **VERIFIED** |
| URL state (N23) | `?q=the` 17 · `type=video` 7 · `type=short` 10 · `type=bogus` 17 (invalid ignored) · durations 1 / 0+honest-empty / 6 · wiring click-through | **17 / 7 / 10 / 17 · 1 / "Nothing matches this filter" / 6** · invalid ignored · Videos click → `?q=the&type=video` → 7 "(filtered)" · no-matches state keeps its own distinct truth | **VERIFIED** |
| WATCH action row (N9-a) | split pill r20 h40 segmented + divider · Share + Save + kebab · Download honestly absent | fresh-state: split pill **97×40 r20** (icon-only like) · divider ✓ · Share + Save + kebab ✓ · **Download: null** | **VERIFIED** (fresh-state widths; with-count 111×40 was B's measured state — the pill is a content-sum, see DIVERGENCES #4) |
| Reactions gate (N9-a-h) | like → "1" + store; toggle-off; dislike → NO count anywhere; mutual exclusion | **all four reproduced exactly** (`wfx-reactions-v1` store read at each step) | **VERIFIED** |
| Channel row (N9-b) | avatar 40 r50% · name 16/500 · sub-count honestly absent · Subscribe 95×36 r18 `rgb(255,0,51)` · REAL library write | **all byte-exact** · click → `subscribed` + "saved to your Subscriptions list" → **Library renders the Subscriptions list with the item** → full unsubscribe round-trip verified + session cleaned | **VERIFIED** (reload-durability split = DIVERGENCES #1) |
| Description (N9-c) | 2-line clamp + "...more" BUTTON · inline expand · "Show less" | clamp 2 · 14/400 · "...more" button → expands INLINE (no dialog: `anyDialogOpened:false`, 68→112px) → "Show less" → re-collapses | **VERIFIED** |
| Related column (N22) | compact 168×95 · title 14/500 clamp-2 · 4px pitch · autoplay paper-switch at the head | 168×95 · 14/500/2 · **pitch 4px** · switch role=switch + knob, BEFORE the list · **real policy write** (`/api/queue` autoplay true→false→reverted) | **VERIFIED** |
| WATCH geometry (N21/D14) | stagewrap 996×560 @(16,68) · secondary 412 @x1028 · rail closed · padding `12px 0 48px 16px` | **byte-exact** (`layoutCols 996px 412px`, gap 16, secondary flush-right δ=0, rail `display:none`, shell guide hidden; home rail renders 240px on non-watch) | **VERIFIED** |
| Sign-in pill (N12) | 40h r20 `rgb(6,95,212)` 14/500 border 1px rgba(0,0,0,0.2) → real identity path | **101×40 · r20 · bg/font/border byte-exact** · person mark · href `/settings?section=general` | **VERIFIED** |
| Gear menu (N24) | Your data/Appearance/Shortcuts/Settings real · 5 unbacked rows honestly named-absent | 300×270 paper r12 corpus-shadow · 4 real rows (2 hrefs + 2 live subpages) · **all FIVE unbacked names in the menu's own absence note** · R28 ThemeToggle retired (probe: absent) | **VERIFIED** |
| Theme seam (N24/O6-meta) | Appearance flips data-theme + wfx-theme + theme-color meta together | Light: `light`/`#ffffff`/white body · Dark: `dark`/`#0f0f0f`/`rgb(15,15,15)` — both branches + boot follows stored theme | **VERIFIED** |
| Keyboard (N25-a) | m/↑/↓ label+volume flips · f fullscreen · t/i/? modes · k/space/j/l/←/→/0–9 POST 200 exact deltas · c gated | **all reproduced**: m→Unmute+0 · ↑→1/↓→0.9 · f→`fullscreenElement=wfx-player__stagewrap` · k/space→`play` · j→0 · l→+10000 · ←→−5000(clamp 0) · →→+5000 · 5→17000 (50%×34s item) — every POST **200** · `?` sheet opens (full row set) · captions control honestly absent | **VERIFIED** |
| Theater (N25-b) | t → 1296×729 @(72,68) viewport-centered; second t reverts | **byte-exact**: 996×560 @(16,68) → **1296×729 @(72,68)** gutters 72/72 + theaterClass + `layoutCols 1424px` → reverts | **VERIFIED** |
| Miniplayer (N25-c) | dock bottom-right 400×262 · persists across / and /search · ~3s position seam · expand/replace/suppression/close | dock **400×262 @16/16** (head 36 + compact iframe 398×224 `miniplayer=1`) · persists on / AND /search · **position seam LIVE** (override 777 → rewritten with the real position) · expand → full player, no double dock · same-item suppression · different-item replace (entry cleared) · close clears both · compact doc: no shell, `Expand (i)`, no theater | **VERIFIED** |
| Duration badge (N19) | 12/500 #fff on rgba(0,0,0,0.6) · r4 · pad 1px 4px · 8px inset · m:ss/h:mm:ss · type badge gone | **every value byte-exact** ("48:06", "10:03:49" measured) · typeBadges: **[]** · search variant "2:30:27" @8/8 inside the 500×281 thumb — B's exact live measure reproduced · the shorts shelf carries no badge | **VERIFIED** |
| Shorts shelf (N20) | 208×311 thumbs · all widths 208 · 4px gutters · 6 cols · uniform "208px" tracks · zeroWidthCards=0 · title below only | **all reproduced**: 24 cards, zeroWidthCards **0**, gutters 4,4,4,4 · columns 6 · computedTrackWidths `["208px"]` · titleBelow true · no channel row | **VERIFIED** |
| Rail (D8/N4 + N13) | History ×1 → `/library?section=history` · 40h r10 14/400/20 inactive · promo byte-exact | History **×1** with the href · inactive "Shorts" 40h r10 **14/400/20** (active Home 14/500 = the active-pill grammar) · rail 240 · promo "Sign in to like videos, comment, and subscribe." + 97×36 r20 `rgb(6,95,212)` · Explore/More-from-YT/footer/location honestly absent | **VERIFIED** |
| Kebab writes (N9-a) | kebab rows real (Add-to-queue → the session queue) | rows: Add to queue / Save / Mark as watched / Stop and record skip / Details · Add-to-queue → `data-wfx-queue-added` + **GET /api/queue carries the item** | **VERIFIED** |
| Mic (D3/N1 — OPEN row, context) | honestly absent, no transport | **micControl: false · getUserMediaCalls: 0** (instrumented click attempt) | honest-absence confirmed |

**Scoreboard: every VERIFIED row of the R29 matrix reproduced LIVE on production.
No regressions found.** The 3 OPEN rows remain honestly open (raised-gray census —
instrument-bound, un-claimed; N29 home-card channel slot — the connector-id truth;
mic — honestly absent, no transport).

## Captures (1440x900, both themes)

`home.light/dark` · `search.light` (**the FILTERS DIALOG OPEN** — visually verified:
title "Search filters", TYPE All/Videos/Shorts + DURATION Any/Under 3/3–20/Over 20) ·
`search.dark` (plain) · `search-results.light` (plain — for the composite) ·
`player.light/dark` (/player watch) · `shorts.light/dark` (the tabs bar "For you /
Following / Your imported feed / Blend" renders on the pill-surface container —
VLM-suspected as an overlay, resolved as the shorts chip tabs, no defect) ·
`library.light/dark` · `settings.light/dark`.

## Side-by-side composites (corpus left / production right; r28-sweep format 2880×934)

- `vs-home.light.png` — yt-home-1440.png | home.light.png
- `vs-home-loggedin.light.png` — the R28 lead's logged-in home corpus | home.light.png (supplementary)
- `vs-search.light.png` — yt-search-1440.png | search-results.light.png
- `vs-search.dark.png` — yt-search-dark-1440.png | search.dark.png
- `vs-player.light.png` — yt-watch-1440.png | player.light.png
- `vs-player.dark.png` — yt-watch-1440.png | player.dark.png (theme-mismatch by construction: no dark watch corpus exists)

## VLM verdicts (per composite — verdict + note; `probes/vlm-verdicts.json` + raw runs in `vlm/`)

- `vs-home.light` — **DIVERGENT**: the corpus capture is a signed-out EMPTY-state home
  ("Try searching to get started"); production renders its real populated feed. Corpus
  artifact (COS) — the shell grammar is the comparable surface. (The R28 sweep's VLM had
  called its equivalent ACCEPTABLE — recorded as-run here.)
- `vs-home-loggedin.light` — **DIVERGENT**: corpus's mixed-row subscriptions feed vs
  WebFlix's uniform 4-column grid — the honest feed-shape divergence (COS/HD).
- `vs-search.light` — **DIVERGENT** (with instrument correction): the note claims missing
  chips — **the chips ARE present** (DOM probe + close-up: All/Videos/Shorts + Filters);
  the real divergence is the honest 3-chip set vs the corpus's ~10 + the sponsored row
  (N23's verified honest-divergence class, HD).
- `vs-search.dark` — **DIVERGENT**: same class as vs-search.light (HD).
- `vs-player.light` — **ACCEPTABLE**: the watch layout grammar (masthead, split-pane
  player/related, action row) mirrors the corpus; the "logo in the player area" is the
  provider's honest placeholder.
- `vs-player.dark` — **DIVERGENT** by construction (light corpus vs dark production pane,
  no dark watch corpus); the dark pane's geometry still measures byte-exact.

**VLM census: 1 ACCEPTABLE / 5 DIVERGENT — every DIVERGENT is a known honest-divergence
class (corpus artifact · honest chip set · provider placeholder · theme-mismatch by
construction), none a production regression.**

## Token eyeball points (checked vs the sheet, no corpus screenshot)

- shorts: the 208×311 shelf thumbs + the tabs bar on the pill-surface family (captures)
- library/settings: the token anatomy renders on both themes (captures; the subscribe
  round-trip proved the Library list live)
- shell: topbar 56 / rail 240 (40h r10 items) / chips; scrollbar via `--wfx-scrollbar-thumb`
- player chrome: the #f03 Subscribe family, 40px pills r20, the evidence-gated play state

## The honest close

The merged R29 set is **LIVE on production**: the 0.6 pill ruling (`#0009`), the nine
canonical tokens, the byte-exact search/watch/home geometry set, the wired filters
dialog, the gear + theme seam, the theater/miniplayer modes, and the honesty gates
(reactions local-truth, subscribe real-write, duration-conditional badge, no fabricated
counts). The divergences ledger (`DIVERGENCES.md`) records 10 entries — the loud one is
the subscribe reload-durability split (divergence 7's class, now confirmed LIVE on the
production boot, exactly as C's own service evidence recorded it).
