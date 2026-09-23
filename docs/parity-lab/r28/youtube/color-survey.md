# Color survey — the R28 sheet (the operator's complaint: "the background color is different")

Captured 2026-09-23T23:0x–23:5xZ from live youtube.com by Worker A (1440×900, logged-out, en-US, **light AND dark passes** — dark via the Settings ▸ Appearance ▸ "Dark theme" path, restored to Light after capture). Provenance: **[rendered]** computed styles live · **[rendered-by-lead-R27]** R27 corpus · **[documented]** established behavior. Raw: `raw/search-light.core.json`, `raw/search-dark.core.json`, `raw/channel-dark.core.json`, chips probes, capture pairs (30/39, 38, 00).

## Theme system [rendered]
- **Logged-out default = LIGHT** (fresh session: `html` bg `rgb(255,255,255)`, no `dark` attribute).
- Theme switch: masthead **Settings (gear) → "Appearance: Light" → submenu rows "Dark theme" / "Light theme"** (logged-out surface; no "Use device theme" row rendered logged-out in this build). `prefers-color-scheme: dark` emulation is **ignored** logged-out; `PREF f6=<80|400|800|8>` cookie variants **do not** switch theme logged-out (all four tested → stayed light).
- Mechanism: the `dark` boolean **attribute on `<html>`** (`html[dark]`) — themes are attribute-scoped, not media-query-scoped.
- Account-bound theme default (operator account): **CORPUS-PENDING** — cite `docs/parity-lab/r28/lead-captures/README.md` @ 0755a38.

## Core surfaces palette
| Surface | Light | Dark | Provenance |
| --- | --- | --- | --- |
| App background (`ytd-app` / `html`) | `#ffffff` | `#0f0f0f` | [rendered] both passes |
| Primary text (titles, body) | `#0f0f0f` | `#f1f1f1` | [rendered] |
| Secondary text (meta, time-ago, idle tabs) | `#606060` | `#aaaaaa` | [rendered] |
| Masthead | transparent over app bg, height 56px, no border-bottom | same | [rendered] |
| Rail (guide drawer) width 240px; item pill radius 10px, text 14/400 | — | — | [rendered] |
| Sign-in pill | text `#065fd4`, border `1px solid rgba(0,0,0,0.2)`, transparent bg, radius 20px, h40 | text `#3ea6ff`, border `1px solid rgba(255,255,255,0.2)` | [rendered] |
| Mic button | `rgba(0,0,0,0.05)`, 40×40, radius 100px | (dark pair not captured — use R27 hover token) | [rendered] / [rendered-by-lead-R27] |
| Duration pill (thumbnail badge) | `rgba(0,0,0,0.6)` bg, `#fff` text | same (theme-independent overlay) | [rendered] — **R27 carried 0.8 alpha; current build = 0.6** |
| LIVE badge (thumbnail) | same badge-shape family (red-variant text per [rendered-by-lead-R27]) | same | [rendered] family / [documented] red variant |
| Search thumbnail | `a#thumbnail` radius **12px**, transparent bg | same | [rendered] |
| Card thumbnail (lockup) | radius **12px** | same | [rendered] |
| Dialogs (filters panel, share sheet) | bg `#ffffff`, radius **12px**, shadow `rgba(0,0,0,0.15) 0 0 24px 12px` | dark dialog bg **not captured** (dialogs opened in light pass) — R27 raised-surface token `#282727`-family | [rendered] / [rendered-by-lead-R27] |
| Card 3-dot menu popup | iron-dropdown popup (light) | dark pair not captured — R27 menu bg `#282828`-family | [rendered] / [rendered-by-lead-R27] |
| Raised/elevated surfaces (cards-adjacent, R27 reference) | `#f2f2f2` | `#272727` | [rendered-by-lead-R27] (R28 sandbox could not render the home shelf surfaces to re-verify; CORPUS-PENDING re-capture) |
| Hairlines/borders (button borders measured) | `rgba(0,0,0,0.2)` | `rgba(255,255,255,0.2)` | [rendered] |
| Hover overlay (chips/buttons family) | `rgba(0,0,0,0.05)` (inactive chip bg) | `rgba(255,255,255,0.1)` | [rendered] |

## Chips (the feed-filter / chip-cloud family) [rendered, both themes]
| State | Light | Dark |
| --- | --- | --- |
| Chip shape | `div.ytChipShapeChip` — h **32px**, radius **8px**, padding `0 12px`, 14px/500 | same geometry |
| Active/selected | bg **`#0f0f0f`**, text **`#f1f1f1`** | bg **`#f1f1f1`**, text **`#0f0f0f`** (inverted) |
| Inactive | bg **`rgba(0,0,0,0.05)`**, text `#0f0f0f` | bg **`rgba(255,255,255,0.1)`**, text `#f1f1f1` |
| Chip bar container | `#chip-bar` — transparent bg, h 50 (search placement y≈59), **left+right scroll arrows render when overflowing** | same |

## Structural color facts [rendered]
- `body` itself is `rgba(0,0,0,0)` — the app background is carried by `ytd-app` (and `html` behind it). B should paint the app shell, not body-only.
- YouTube's served CSS now **hashes its custom property names** (`--tffc2fd3a644f6275`-style); the legacy `--yt-spec-*` semantic tokens are vestigial (one indirection rule found: `--yt-spec-text-primary: var(--tffc2fd3a644f6275)`). **B must not copy var NAMES — only resolved values** (this table).
- Player chrome surfaces (`.ytp-*` gradient bottom, control bar) are overlay-scoped (dark overlays on video) — theme-independent [rendered] (gradient-bottom present) + [rendered-by-lead-R27] for chrome specifics.

## Honest gaps
- Dark-theme dialog/menu raised surfaces: rendered only in the light pass (dialog re-open in dark was not re-captured before the session budget closed) — R27 raised-surface tokens cited; flagged for the next healthy window.
- Scrollbar styling: not re-captured this round (R27: 16/8/4/56 spec) — [rendered-by-lead-R27].
- Operator account default theme: CORPUS-PENDING (lead-captures README).
