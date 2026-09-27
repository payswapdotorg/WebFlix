# R33-C — GUARDS BATTERY (every gate's output, on the final lane tree)

Lane: `wfx/r33c/content-residuals` (base: `main @ 178873a`, clean). Subject: the
content-surface residual rows (the matrix's D11/D13/D14/N19/N29/N3 + the O6
raised-gray residual) — the rows still open on the current tree BUILT (N29's
card scope + the raised-gray bindings); the already-closed rows re-verified
with fresh measured proof (never re-shipped).

Command sequence (the task's gates, in order):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS: 5217/1/0** — `5217 pass / 1 skip / 0 fail — 5218 tests across 298 files [227.22s]`; the R32 floor 5200/1/0 + exactly the 17 new R33-C tests (297+1 files); zero regressions |
| 2 | lint | `bun run lint` + the scoped lane-files run | LANE-CLEAN (the lane's 7 changed+new files scoped: 0 errors, 0 warnings; the repo baseline 115 problems (32 errors, 83 warnings) — byte-identical to the R32 record) |
| 3 | typecheck | `bun run typecheck` (root + journeys) + `tsc --noEmit -p apps/web/tsconfig.json` | PASS (root + journeys + app: zero diagnostics) |
| 4 | contract-check | `bun run contract-check` | PASS ("contract-check: OK — 12 frozen blocks in sync, 7 extension types present.") |
| 5 | lane-check | `bun run lane-check` | PASS ("lane-check: OK — 943 files, no cross-lane private imports.") |
| 6 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS (19 pass / 0 fail — CONFORMANT, the R29/R30-A gate unchanged) |
| 7 | build | `NODE_OPTIONS=--max-old-space-size=2048 bun run --filter '@wfx/app-web' build` | PASS ("Exited with code 0" — every route compiles incl. /shorts + /watch) |
| 8 | browser-verify | agent-browser @1440×900 (+ the 1600×900 D14 breakpoint) against `WFX_DEV_FIXTURES=1 next dev -p 3101` | **PASS — every row measured live at its captured viewport; the CTA round-trip; the badge grammar; the pixel surveys** (see `browser-verification.md` + `measured-facts.json`) |

## Stage notes

### 1. battery — PASS: 5217/1/0 (the floor + exactly the 17 new)
- The base floor: the R32 record's 5200/1/0 (the battery the R32 merge left;
  `178873a` touched docs/deploy triggers only — the code identical).
- The honest skip unchanged: the R11 webtorrent native-prebuilt environment
  skip (the pre-existing 1; the serial form is the reproducible gate).
- The +17: `apps/web/tests/r33c-content-residuals.test.ts` —
  - N29's identity laws: the sourceNames map carries the sources model's
    own displayName; home/search/watch-browse surfaces render it in every
    channel slot; the honest fallback (the empty map keeps the connector
    id); the empty-query empty map; the shorts-shelf no-channel-row
    byte-law;
  - the raised-gray corpus bindings: the tokens' captured values; the four
    hover surfaces bound to `--wfx-bg-hover` (row 29); the two avatars +
    the card action row bound to `--wfx-bg-raised` (row 27); the
    off-corpus family gone from the bound rules;
  - D14's CSS contracts: the 16px base, the 24px @≥1600, the flush-right
    two-column band, the full-bleed band;
  - N19's pill grammar + N3's 500×281 thumb contract (the stylesheet
    guards over the R29-B closures).

### 2. lint — LANE-CLEAN
The scoped run over the lane's 7 changed+new files (`view-models.ts`, `ItemCard.tsx`,
`HomeSurface.tsx`, `SearchSurface.tsx`, `WatchBrowseSurface.tsx`, the test file,
`globals.css`): 0 errors, 0 warnings. The repo-wide baseline: 115 problems
(32 errors, 83 warnings) — byte-identical to the R32 record's baseline
(main moved docs-only since; the code tree unchanged by others).

### 8. browser-verify — the row-by-row measured proof
See `browser-verification.md` (the golden paths) + `measured-facts.json`
(the numbers). The D14 row was measured at BOTH captured breakpoints
(1440 + 1600); the D13 row measured guide-collapsed (the spec state) +
guide-open (the overlay law); the D11 round-trip re-run (subscribe →
reload → subscribed); the N19 badge + N3 row measured EXACT; the N29
displayName verified on all three surfaces; the raised-gray computed
values verified in both themes (#f2f2f2 light / #272727 dark EXACT); the
pixel surveys before/after (the matrix's own methodology).
