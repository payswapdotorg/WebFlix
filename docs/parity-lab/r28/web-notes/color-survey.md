# R28 corpus sheet — COLOR SURVEY (self-measured, Worker A's lane ABSENT → CORPUS-PENDING)

Live youtube.com, headless Chromium, 1440×900, 2026-09-24. Dark forced via PREF
`f6=400`; light = cleared cookies (fresh signed-out profile).

## Theme default logic (MEASURED — answers the brief's question)

- Fresh signed-out profile, `prefers-color-scheme: dark` emulated: youtube.com renders
  **LIGHT** (`html` bg `#ffffff`). The signed-out default does NOT follow the system
  scheme in this measurement; dark is carried by the PREF cookie (`f6=400`).
- WebFlix keeps the R27 corpus law (server-rendered dark default + explicit light
  override + toggle) — recorded as a DIVERGENCE-class decision pending the lead's
  default-theme ruling, since the lead's production recon also observed dark default.

## Dark theme (measured)

| Surface | Value |
| --- | --- |
| html canvas | `#0f0f0f` |
| search title text | `#f1f1f1` |
| search meta text | `#aaaaaa` |
| masthead | 56px tall, transparent over the `#0f0f0f` canvas |
| chip container | height **32px**, radius **8px** |
| chip ACTIVE (dark) | bg `#f1f1f1`, ink `#0f0f0f` |
| chip INACTIVE (dark) | bg `rgba(255,255,255,0.1)` (the R27 `--wfx-bg-hover` token), ink `#f1f1f1` |
| comments count | `#f1f1f1`; author `#f1f1f1`; time/meta `#aaaaaa`; body `#f1f1f1` |

## Light theme (measured, fresh profile)

| Surface | Value |
| --- | --- |
| html canvas | `#ffffff` |
| search title text | `#0f0f0f` |
| search meta text | `#606060` (rgb(96,96,96)) |
| chip ACTIVE (light) | bg `#0f0f0f`, ink `#f1f1f1` |

These all agree with the R27 `PARITY_TOKENS` contract values — the contract is
re-confirmed live. The operator's "background color is different" therefore resolves to
(1) the un-loaded font making every surface read differently, and (2) the per-surface
drift survey below (elevated/hairline/masthead surfaces to verify against the app).

## The watch shell (VLM-verified against `reference/screenshots/yt-watch-1440.png`)

- Player black, ~65-70% page width; title → channel row (avatar / name / verified /
  subscribers / Subscribe pill) with the action row RIGHT-ALIGNED on the same band:
  **Like/Dislike segmented pill (icon + count | icon)**, **Share**, **Save**,
  **"…" overflow circle**.
- Comments header: bold count ("5,175 Comments") + **Sort by** menu with icon.
- Right: related-videos rail of compact cards.
