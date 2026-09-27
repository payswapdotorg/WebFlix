# R33-C partial results (the re-entry ledger — FINAL STATE, all work complete)

Branch: wfx/r33c/content-residuals from main @ 178873a.
Status: ALL ROWS CLOSED/ADJUDICATED, ALL GATES GREEN, COMMITTED — ready for transport.

## DONE (the full arc)
- [x] STEP ZERO: clone, branch, matrix + corpus survey (the prior session's worklog).
- [x] Row re-verification against the CURRENT tree: D14/D13/D11/N19/N3 already
  closed by R29-B/R30 (measured proof re-taken on this lane head — never re-shipped);
  N29 card-scope + the O6 raised-gray residual were the REAL open rows.
- [x] BEFORE pixel survey: fixture light 1.9% / dark 2.1% / service 1.8% (empty feed).
- [x] N29 BUILT: sourceNamesOf (the R32 seam) + sourceNames on HomeView/
  WatchBrowseView/SearchView; ItemCard's sourceName prop; Row/ContinueRow/
  SearchSurface/WatchBrowseSurface threading; the search avatar monogram from the
  resolved name. Verified live on all three surfaces (fixtures) + the honest
  fallback (empty map -> connector id, SSR test) + the service environmental truth.
- [x] Raised-gray BOUND: 7 corpus-cited bindings (4 hovers -> --wfx-bg-hover
  [color-survey row 29]; 2 avatars + card actionbtn -> --wfx-bg-raised [row 27]).
  AFTER pixel survey: light 2.1% / dark 2.4% — toward 4.1% from below, real
  surfaces only. The 7.7% over-share measured GONE; the under-share adjudicated
  as the surface-count truth (DIVERGENCES row 4).
- [x] Measured re-verification: D14 @1440+@1600 EXACT; D13 guide-collapsed EXACT +
  guide-open overlay measured (the honest delta); D11 round-trip (subscribe ->
  reload -> subscribed); N19 badge grammar EXACT; N3 row/thumb EXACT.
- [x] Fresh sweep: home/search/watch measured (chips, titles, metas, shorts shelf,
  upnext, desc panel, actions pill, kebab) — NO new visible residual.
- [x] Lane tests: apps/web/tests/r33c-content-residuals.test.ts (17 tests).
- [x] GATES ALL GREEN:
  - battery (serial, foreground): **5217/1/0** — 5218 tests, 298 files, 227.22s
    (the R32 floor 5200/1/0 + 17, zero regressions; the honest 1 = the R11 skip).
  - lint: lane files 0/0; repo baseline 115/32/83 (byte-identical to the R32 record).
  - typecheck: root + journeys + apps/web — zero diagnostics.
  - contract-check: OK (12 frozen blocks, 7 extension types).
  - lane-check: OK (943 files).
  - parity-conformance: 19/19.
  - build --filter '@wfx/app-web': exit 0.
  - browser-verified live: every row measured (browser-verification.md).
- [x] Evidence pack: INDEX.md (the closure table), guards.md, DIVERGENCES.md
  (10 rows), browser-verification.md, measured-facts.json, captures/ (13 PNG),
  partial-results.md (this file).

## Environment lessons (for the next session on this box)
- Next 16 allows ONE dev server per project directory (the .next/dev lock): the
  service-mode and fixtures-mode servers cannot run side-by-side on the same dir;
  the lane swapped 3101 service -> fixtures after the AFTER service capture.
- The battery MUST run in the FOREGROUND of a tool call (backgrounded runs were
  killed silently by the sandbox ~2-3min in, three times, even setsid'd); the
  serial foreground run completes in 227.22s inside a 600s tool timeout.
- The current WFX_API_BASE deployment serves the web app's HTML at the Experience
  API paths -> the service boot's honest empty feed (recorded, never fabricated).

## REMAINING
- [ ] TRANSPORT ONLY: relay evidence/r33c/ + the thin bundle + RELAY-MANIFEST.txt
  into the workspace root, then the completion report. (git push is honestly
  impossible here — no GitHub credentials, the R31/R32 lesson.)
