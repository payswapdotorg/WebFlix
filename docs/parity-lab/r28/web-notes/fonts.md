# R28 corpus sheet — FONTS (self-measured, Worker A's `wfx/r28/corpus` lane ABSENT → CORPUS-PENDING)

Measured live youtube.com search results page (headless Chromium, dark theme forced via
PREF `f6=400`, viewport 1440×900, 2026-09-24 UTC) + the R27 corpus tokens.

## The loaded faces (document.fonts, measured)

- `document.fonts.size`: **177** FontFaces declared.
- Families declared: **Roboto**, **YouTube Sans**, **Roboto Mono**.
- Faces actually reaching `loaded` status on a hydrated results page:
  **Roboto 400 normal ×3** (latin + sibling subsets), **Roboto 500 normal ×3**,
  **Roboto 700 normal ×3**. No italic face loaded on the search surface.
- Declared stacks (measured computed style):
  - `document.documentElement` / `body`: `"Roboto, Arial, sans-serif"`.

## The ladder (per-role, measured on live surfaces; R27 contract `PARITY_TYPE_SCALE` agrees)

| Role | size/weight/line-height | color (dark) | clamp |
| --- | --- | --- | --- |
| search result title | 18px / 400 / 26px | #f1f1f1 | 2 |
| search result meta | 12px / 400 | #aaaaaa | — |
| search result channel | 12px / 400 | #aaaaaa | — |
| comment author | 12px / 500 | #f1f1f1 | — |
| comment time | 12px / 400 | #aaaaaa | — |
| comment body | 14px / 400 / 20px | #f1f1f1 | — |
| comment vote count | 12px / 400 | #aaaaaa | — |
| comment Reply label | 12px / 500 | — | — |
| comments count header | 15px / 700 | — | — |
| chip label | 14px / 500 | — | — |

## The WebFlix implementation decision (the honest frame)

- **YouTube Sans is proprietary** (YouTube's own brand face — used for the wordmark and
  select headlines). WebFlix ships **Roboto** — YouTube's own primary fallback —
  self-hosted (400/500/700, woff2, `font-display: swap`) so the declared stack actually
  renders in Roboto instead of the OS fallback. The YouTube Sans delta is recorded in
  DIVERGENCES.
- Self-hosted files land in `apps/web/public/fonts/roboto-{400,500,700}.woff2` (latin
  subset, from fonts.gstatic.com's own woff2 responses).
