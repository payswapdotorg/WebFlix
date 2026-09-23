# R27-W2 TOKEN-MAPPING — the corpus sheet → the web's active property

The machine-readable contract is `packages/platform-contracts/src/parity-tokens.ts`
(W1's canonical encoding, merged on main @ 9ca9320). The web surface is
`apps/web/src/app/globals.css`. The conformance harness
(`tests/parity-conformance.test.ts`) parsed both and verdicted the web
**CONFORMANT**: every required token is ACTIVE at the corpus value in both
themes; every structural anatomy check passes.

This file maps every row of the corpus sheet (`docs/parity-lab/reference/design-tokens.md`
+ the measured geometry of `watch-geometry.md` + the skeleton CSS) to the
active custom property (or literal value) the web surface carries, with the
provenance tag the contract attaches.

## Status legend

- **ACTIVE** — the web declares the canonical `--wfx-*` custom property at the
  corpus value in both `:root` (dark, the default) and `html[data-theme="light"]`.
  The harness asserts this STRICT.
- **LITERAL** — surface-scoped token the web renders with a literal value
  (the harness REPORTS, never fails — the web's anatomy is correct, the custom
  property is the follow-up convergence).
- **GEOMETRY** — a CSS-derivable structural value the harness asserts at the
  selector + media where the anatomy lives.

---

## 1. Canvas & surfaces (design-tokens.md §Canvas & surfaces)

| Sheet row | Dark | Light | Web's active property | Provenance | Status |
| --- | --- | --- | --- | --- | --- |
| app background | `#0f0f0f` | `#ffffff` | `--wfx-bg` (`:root` + light seam) | [rendered]+[css] | ACTIVE |
| raised surface (chips row, description panel, menus) | `#272727` | `#f2f2f2` | `--wfx-bg-raised` (`:root` + light) | [documented]+[rendered] | ACTIVE |
| hover surface | `rgba(255,255,255,0.1)` | `rgba(0,0,0,0.05)` | `--wfx-bg-hover` (`:root` + light) | [documented]+[rendered] | ACTIVE |
| divider / border | `rgba(255,255,255,0.2)` | `rgba(0,0,0,0.1)` | `--wfx-border` (`:root` + light) | [css]+[documented] | ACTIVE |
| hairline (skeleton light-border-bottom) | `hsla(0,100%,100%,.08)` | `hsl(0,0%,93.3%)` | rendered literally (the skeleton chrome) | [css] | LITERAL |
| primary text | `#f1f1f1` | `#0f0f0f` | `--wfx-text` (`:root` + light) | [rendered] | ACTIVE |
| secondary text | `#aaaaaa` | `#606060` | `--wfx-text-dim` (`:root` + light) | [rendered] | ACTIVE |
| tertiary/disabled text | `#717171` | `#909090` | `--wfx-text-faint` (`:root` + light) | [documented] | ACTIVE |
| link / interactive accent | `#3ea6ff` | `#065fd4` | `--wfx-link` (`:root` + light) | [documented] | ACTIVE |
| focus ring (the link family) | `#3ea6ff` | `#065fd4` | `--wfx-focus` (`:root` + light) | [documented] | ACTIVE |
| brand/progress red | `#f03` | `#f03` | `--wfx-accent` (`:root` + light) | [documented] | ACTIVE |
| snackbar/toast surface | `#f1f1f1` / `#0f0f0f` text (inverted) | `#0f0f0f` / `#f1f1f1` text | rendered literally (the toast block) | [documented] | LITERAL |

### Composite surfaces the sheet's other sections pin

| Sheet row | Dark | Light | Web's active property | Provenance | Status |
| --- | --- | --- | --- | --- | --- |
| subscribe-style CTA surface | `#f1f1f1` | `#0f0f0f` | `--wfx-cta-bg` (`:root` + light) | [documented] | ACTIVE |
| subscribe-style CTA ink | `#0f0f0f` | `#ffffff` | `--wfx-cta-fg` (`:root` + light) | [documented] | ACTIVE |
| duration-pill surface | `rgba(0,0,0,0.8)` | `rgba(0,0,0,0.8)` | rendered literally (`.wfx-badge` bg) | [rendered] | LITERAL |
| duration-pill ink | `#fff` | `#fff` | rendered literally (`.wfx-badge` color) | [rendered] | LITERAL |
| scrollbar thumb | `hsl(0,0%,67%)` | `hsl(0,0%,76%)` | rendered literally (`body::-webkit-scrollbar-thumb`) | [css]+[documented] | LITERAL |
| skeleton text-shell bg | `hsl(0,0%,16%)` | `hsl(0,0%,89%)` | `--wfx-skeleton` (`:root` + light) | [css] | ACTIVE |
| player-chrome scrim | `linear-gradient(to top, rgba(0,0,0,0.74), transparent)` | same | rendered literally (`.wfx-chrome` bg) | [documented] | LITERAL |
| player-chrome ink | `#fff` | `#fff` | rendered literally (`.wfx-chrome` color) | [documented] | LITERAL |
| player stage black | `#000` | `#000` | rendered literally (`.wfx-player__stagewrap` bg) | [rendered] | LITERAL |

The web additionally carries the in-surface derivative `--wfx-border-strong`
(`#303030` dark / `#cccccc` light), `--wfx-accent-strong` / `--wfx-accent-soft`
/ `--wfx-accent-border` (the red family's stronger / soft / border tints) —
the surface's own extensions of the canonical palette, all derived from the
corpus red `#f03` and the divider family. These are not separate canonical
tokens (the contract carries 22; the web declares 13 + its own derivatives).

---

## 2. Typography (design-tokens.md §Typography — the Roboto stack)

Font stack (exact, [rendered]): `--wfx-font` = `"Roboto", "Arial", sans-serif`
(the system-fallback chain; the parity target is Roboto where available).

| Role | Size / weight / line-height | Color context | Web's selector | Provenance | Status |
| --- | --- | --- | --- | --- | --- |
| body base | 14px / 400 / 20px | `--wfx-text` | `body` | [rendered]+[documented] | GEOMETRY |
| page/watch title (h1) | 20px / 700 / 28px | `--wfx-text` | `.wfx-player__title` | [rendered] | GEOMETRY |
| card title (feed) | 16px / 500 / 22px, 2-line clamp | `--wfx-text` | `.wfx-card__title` (harness-asserted: 16px/500/22px) | [documented] | GEOMETRY |
| search result title | 18px / 400 / 26px, 2-line clamp | `--wfx-text` | `.wfx-result__title` (measured live: 18px/400/26px) | [rendered] | GEOMETRY |
| channel/creator row | 14px / 400 | `--wfx-text-dim` | `.wfx-card__channel` | [documented] | GEOMETRY |
| meta line (views · date) | 12px / 400 | `--wfx-text-dim` | `.wfx-card__meta` | [rendered] | GEOMETRY |
| description snippet | 12px / 400 / 18px, 2-line clamp | `--wfx-text-dim` | `.wfx-result__metainfo`, `.wfx-desc__body` | [rendered] | GEOMETRY |
| duration pill | 12px / 500, `#fff` on `rgba(0,0,0,0.8)`, radius 4px, pad 3px 4px | — | `.wfx-badge` (harness: padding 3px 4px, radius 4px var-resolved) | [rendered] | GEOMETRY |
| badge text (CC/subtitles) | 12px / 500, secondary, 1px border pill | — | `.wfx-badge` (the type + duration variants) | [rendered] | GEOMETRY |
| button label | 14px / 500 | — | `.wfx-btn`, `.wfx-pill` | [rendered] | GEOMETRY |
| section heading (comments) | 20px / 400 | `--wfx-text` | `.wfx-watch h2` (honest empty — see DIVERGENCES) | [documented] | GEOMETRY |
| chip label | 14px / 500, primary on chip surface | — | `.wfx-chip` (harness: height 32px, radius 8px) | [documented] | GEOMETRY |
| rail nav label | 14px / 400 (active: 500) | `--wfx-text` | `.wfx-navlink` | [documented] | GEOMETRY |

---

## 3. Geometry (design-tokens.md §Geometry + watch-geometry.md)

| Element | Corpus value | Web's selector + media | Provenance | Status |
| --- | --- | --- | --- | --- |
| topbar height | 56px | `:root --wfx-topbar-h` (56px) + `.wfx-topbar height` | [rendered] | GEOMETRY (harness-asserted) |
| left rail width (labeled, ≥1280) | 240px | `:root --wfx-rail-w-wide` (240px) + `.wfx-rail` | [rendered] | GEOMETRY |
| rail icon-only (792–1279) | 72px | `:root --wfx-rail-w` (72px) + `.wfx-rail @media 792px` | [documented] | GEOMETRY |
| bottom nav (mobile <792) | 48px + safe-area | `:root --wfx-bottomnav-h` (48px) + `.wfx-bottomnav` | [documented] | GEOMETRY |
| chip bar | 32px chips, ~12px row padding | `.wfx-chip height: 32px`, `border-radius: 8px` | [rendered] | GEOMETRY (harness-asserted) |
| home grid card | 16:9 thumb, radius 12px, gap 16×16, 4/3/2/1 cols @1300/1000/600/<600 | `.wfx-row__scroller` (harness: grid-template-columns repeat(1/2/3/4) at the breakpoints; gap 16px column) + `.wfx-card__thumb aspect-ratio 16/9, border-radius 12px var-resolved` | [documented]+[css] | GEOMETRY (harness-asserted) |
| search result card | 360×202 thumb, 16px gap, meta column | `.wfx-result__thumb` (measured live: 360×202) + `.wfx-result__title` (measured live: 18px/400/26px) | [rendered] | GEOMETRY |
| watch layout @1440 | primary 1012 + secondary 412, margin 16px→24px@≥1600, **column gap 16px** | `.wfx-player__layout` (harness: `grid-template-columns` contains `412px` @1016px; `gap` column-component `16px` @1016px — **THE DRIFT FIX**) | [rendered] | GEOMETRY (harness-asserted) |
| watch player | 996×560 within primary (16:9 + 12px control bar) | `.wfx-player__stagewrap` (aspect-ratio 16/9, radius 12px var-resolved) | [rendered] | GEOMETRY |
| related compact card | 168×94 thumb, 4px gap, meta right | `.wfx-rcard` (168×94 + 4px) | [documented] | GEOMETRY (desktop-asserted; web renders the anatomy) |
| action buttons (watch) | 40px height, pill radius 20px, segmented like/dislike | `.wfx-pill` (40px / 20px) | [rendered] | GEOMETRY (desktop-asserted) |
| channel avatar (watch) | 40×40 | `.wfx-watch__avatar` / `.wfx-owner__avatar` (40×40) | [rendered] | GEOMETRY (desktop-asserted) |
| scrollbar | 16px track, 8px thumb radius, 4px transparent border, 56px min thumb | `body::-webkit-scrollbar` (16px) + `::-webkit-scrollbar-thumb` (8px radius, 4px border, 56px min-height) | [css] | GEOMETRY (harness-asserted) |
| skeleton text shells | 20px height, radius 8px (light `hsl(0,0%,89%)` / dark `hsl(0,0%,16%)`) | `.wfx-skeleton-card__line` (20px height, 8px radius var-resolved) + `.wfx-skeleton-card__thumb` (16:9) | [css] | GEOMETRY (harness-asserted) |

### The watch geometry — the measured @1440 anatomy (the drift-fix region)

The corpus (`watch-geometry.md`) measures the watch shell at 1440×900:
- **Page margin: 16px @1440** (24px only ≥1600).
- **Primary column: 1012px** (x=16) — `viewport(1440) − secondary(412) − gap(16) = 1012` (the no-rail, guide-collapsed measurement).
- **Secondary column: 412px** (x=1028).
- **Column gap: 16px** — `x=1028 − (16+996) = 16` (the player is 996 inside the 1012 primary; the 16px residual IS the column gap).
- **Player: 996×560** (16:9 + 12px control bar).
- **Title block: y=640** (12px below the player bottom), 20px/700/28px.

The web renders this with the rail open (240px) at 1440, so the content
narrows: measured live, `.wfx-player__layout` = `724px 412px` with `gap: 16px`
(the secondary is the corpus 412px; the primary flexes with the remaining
content width after the 240px rail + page margins; the **gap is the corpus
16px** — the harness-flagged drift, now fixed).

---

## 4. Motion & states (design-tokens.md §Motion & states)

| Interaction | Corpus value | Web's active rule | Provenance | Status |
| --- | --- | --- | --- | --- |
| default transition | 120–200ms ease (150ms pinned) | `:root --wfx-transition: 150ms ease` (harness-asserted) + the surface's `transition: var(--wfx-transition)` consumers | [documented] | ACTIVE + GEOMETRY |
| card hover | ~500ms dwell before preview disclosure; title color holds | the `.wfx-card` hover (the capability-gated preview card) | [documented] | GEOMETRY |
| control reveal (player) | fade on ~3s idle; reveal on mousemove | `.wfx-chrome[data-wfx-chrome-idle="true"]` (opacity 0, pointer-events none) — measured live: idle=true after 4s ✓ | [documented] | GEOMETRY |
| red progress bar | `#f03` fill, 12px white scrubber dot, hover expands to 4–5px | `.wfx-chrome__scrub` (`--wfx-accent` fill, 12px dot, 3→5px hover) | [documented] | GEOMETRY |
| focus ring | 2px outline `#3ea6ff`-family on keyboard focus | `:focus-visible { outline: 2px solid var(--wfx-focus) }` | [documented] | GEOMETRY |
| toast/snackbar | bottom-left, inverted pill, ~4s auto-dismiss | the toast surface (literal; the auto-dismiss seam) | [documented] | LITERAL |

---

## 5. The player-chrome OPERATE grammar (design-tokens.md §Player chrome anatomy)

Left→right in the control bar (the corpus's order, verified live):

| # | Control | Availability | Web's render | Provenance |
| --- | --- | --- | --- | --- |
| 1 | play/pause | always (`· next when queued`) | `.wfx-chrome` "Play (k)" — measured live ✓ | [documented] |
| 2 | next/up-next | `when-queued` (the session queue head) | renders only when a queue exists (the 22ca21b wiring) | [documented] |
| 3 | volume + hover slider | always | `.wfx-chrome` volume + hover slider | [documented] |
| 4 | time `cur / dur` | always | in-bar time readout | [documented] |
| 5 | spacer | always | the flex spacer | [documented] |
| 6 | cc/captions | `capability-gated` | renders only when a captions transport exists | [documented] |
| 7 | settings gear (two-level popup) | always | the settings popup (speed/quality + WebFlix capability rows: Translate/Transcript/AI/Provenance/Where-to-watch) | [documented] |
| 8 | miniplayer | always | the miniplayer button | [documented] |
| 9 | theater | always | "Theater view (t)" — measured live: `t` toggles `wfx-player--theater` ✓ | [documented] |
| 10 | fullscreen | always | "Fullscreen (f)" — measured live ✓ | [documented] |

Keyboard map (verified live): `space`/`k` play-pause · `j`/`l` ∓10s · `←`/`→`
∓5s · `↑`/`↓` volume · `f` fullscreen · `t` theater (verified: toggles ON then
OFF) · `m` mute · `c` captions · `0–9` seek-to-percent. The two-level settings
menu carries the back-arrow navigation; the WebFlix capability rows live in
the popup, progressively disclosed, capability-truth-gated.

---

## The conformance verdict (the harness's truth)

```
R27 parity conformance:status
contract: PRESENT — @wfx/platform-contracts/parity-tokens (22 tokens, provenance preserved)
[web] Web (apps/web/src/app/globals.css) — STATUS: CONFORMANT (contract-present + surface-conformant)
  all corpus token + structural checks pass (dark + light).
  surface-scoped (informational, not failed): hairline, pill-surface, pill-ink,
  scrollbar-thumb, toast-surface, toast-ink, chrome-scrim, chrome-ink, stage-black
  not declared as custom properties on this surface
wave state: BOTH surfaces conformant.
```

The 9 surface-scoped tokens the web renders literally (the follow-up
convergence — adopting the canonical `--wfx-*` names for them is the W1
charter's informational note, not a conformance defect). The 13 core tokens
the web declares as ACTIVE custom properties are the corpus core; the geometry
and motion are asserted at the selectors where the anatomy lives. The drift
fix (the watch column gap 24px → 16px) is the one defect W1's harness flagged;
it is now closed and the web wave-state is CONFORMANT.
