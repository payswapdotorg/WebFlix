# Fonts — the R28 sheet (the operator's complaint: "the fonts used are not the same")

Captured 2026-09-23T23:0x–23:4xZ from live youtube.com by Worker A (1440×900, logged-out, en-US; light + dark passes — font stacks are theme-independent). Provenance: **[rendered]** = live computed styles · **[css]** = youtube.com's own served CSS. Raw: `raw/search-light.core.json`, `raw/search-dark.core.json`, `raw/channel-dark.core.json`, font census transcript, `raw/search-light.cssmined.json`.

## The headline truth — the lead's R27 note is stale in TWO ways
1. The custom family is now declared as **"YouTube Sans"** (not "Google Sans"). The stylesheet link loads: `https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=YouTube+Sans:wght@300..900&display=swap` [css].
2. On the logged-out surfaces measured, **YouTube Sans is declared but NEVER loaded** — every `document.fonts` YouTube Sans face (variable 300–900, 129 subset declarations) reports `status: unloaded`; zero YouTube Sans woff2 bytes hit the network. **All rendered text resolves to Roboto.** [rendered]

## What actually loads [rendered]
| Face | Declarations in `document.fonts` | Loaded? |
| --- | --- | --- |
| Roboto 300/400/500/700 normal | 9 subsets each | **400, 500, 700 loaded** (3 woff2 subsets each — latin + subsets in use) |
| Roboto 300/400/500/700 italic | 9 subsets each | unloaded |
| **YouTube Sans 300–900 (variable)** | 129 subset declarations | **unloaded (0 faces)** |
| Roboto Mono 400 | 6 subsets | unloaded |
- woff2 sources actually fetched (light + dark identical): `fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMawCUBGEe.woff2`, `…AMaxKUBGEe.woff2`, `…AMa3yUBA.woff2` (3 files, v51) [rendered].
- NOTE for Worker B: **YouTube Sans is Google-internal-licensed — WebFlix must NOT ship it.** Roboto (OFL) is the honest stand-in and is what YouTube itself renders on these surfaces today.

## Per-role computed typography [rendered]
| Role | Selector / element | font-family | size / weight | line-height | color (light / dark) |
| --- | --- | --- | --- | --- | --- |
| Root / body | `html`, `body` | `Roboto, Arial, sans-serif` | **10px base** (html; role sizes are component-set) 400 | normal | — |
| App surface text | `ytd-app` | Roboto, Arial, sans-serif | (inherits) | — | #0f0f0f / #f1f1f1 |
| Search result title | `ytd-video-renderer a#video-title` | Roboto, Arial, sans-serif | **18px / 400** | 26px | rgb(15,15,15) / rgb(241,241,241) |
| Search result meta (views/age) | `#metadata-line` | Roboto, Arial, sans-serif | **12px / 400** | 18px | #606060 / #aaaaaa |
| Search channel name | `ytd-channel-name a` | Roboto, Arial, sans-serif | 12px / 400 | — | #606060 / #aaa |
| Search description snippet | `.metadata-snippet-container` | Roboto, Arial, sans-serif | 12px / 400 | 18px, clamp 2 | rgb(15,15,15) |
| **Card title (current lockup card)** | `a.ytLockupMetadataViewModelTitle > span.ytAttributedStringHost` | Roboto, Arial, sans-serif | **16px / 500** | (component) | #0f0f0f |
| Card metadata (channel-grid variant) | `yt-content-metadata-view-model` (MediumText) | Roboto, Arial, sans-serif | **10px / 400** | normal | #606060 |
| Duration pill text | `.ytBadgeShapeText` (badge-shape) | Roboto, Arial, sans-serif | **12px / 500** | — | #fff |
| Chips (search bar / all chips) | `.ytChipShapeChip` | Roboto, Arial, sans-serif | **14px / 500** | — | per state (colors sheet) |
| Rail (guide) item text | `ytd-guide-entry-renderer .yt-formatted-string` | Roboto, Arial, sans-serif | **14px / 400** | 20px | — |
| Buttons (masthead/action family) | `.ytSpecButtonShapeNextButtonTextContent` | Roboto, Arial, sans-serif | **14px / 500** | — | — |
| Sign-in pill | masthead `ytd-button-renderer` | Roboto, Arial, sans-serif | 14px / 500 | — | #065fd4 / #3ea6ff |
| Channel tabs (idle / selected) | `yt-tab-group-shape` rows | Roboto, Arial, sans-serif | **14px / 500 idle · 16px / 500 selected** | — | #606060 idle · #0f0f0f selected |
| Watch title (h1) | `h1.ytd-watch-metadata` | Roboto, Arial, sans-serif | 20px / 700, lh 28 [rendered-by-lead-R27] (empty in gated session) | 28px | #0f0f0f / #f1f1f1 |
| Comments header count | `ytd-comments-header-renderer #count` | Roboto, Arial, sans-serif | **15px / 700** | normal | rgb(0,0,0) / (dark not measured) |
| Comment author | `#author-text` | Roboto, Arial, sans-serif | **12px / 500** | 18px | #0f0f0f |
| Comment time-ago | `.published-time-text` | Roboto, Arial, sans-serif | **12px / 400** | 18px | #606060 |
| Comment body | `#content-text` | Roboto, Arial, sans-serif | **14px / 400** | 20px | #0f0f0f |
| Reply button | `#reply-button-end` | Roboto, Arial, sans-serif | **12px / 500** | 18px | #606060 |
| Share dialog link field | `ytd-unified-share-panel-renderer input` | Roboto, Arial, sans-serif | **14px / 400** | — | #0f0f0f |
| Filters dialog options | `tp-yt-paper-dialog` (search filters) | Roboto, Arial, sans-serif | 14px family | — | — |

## Font census result (the "which roles resolve to what" answer) [rendered]
A census over ~4,000 visible text elements across masthead, chips, search results, rail and dialogs returned **8 distinct stacks — every one `Roboto, Arial, sans-serif`** (plus one `Roboto, Noto, sans-serif` inside `tp-yt-paper-item` guide rows). **Zero roles resolve to YouTube Sans or Arial-first on logged-out surfaces.** The `document.fonts` inventory and woff2 network log corroborate.

## Parity prescription for B
- Ship **Roboto 400/500/700 (+300 if needed) via gstatic-style subsetting**, `font-family: "Roboto", Arial, sans-serif` at every role above — sizes/weights per the table.
- html root `font-size: 10px` (YouTube's rem base) with role-level component sizes.
- Do NOT ship YouTube Sans (licensing); the corpus records its presence for truth, not for copying.
