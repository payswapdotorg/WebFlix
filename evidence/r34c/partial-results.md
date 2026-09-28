# R34-C Partial Results (the re-entry ledger — FINAL)

Lane: `wfx/r34c/accept-regression` from `main @ 09d0205` (post-R33 tree).
Scope: the full J01–J39 web journey suite against LIVE PRODUCTION
(https://webflix-steel.vercel.app) — the R24 corrective-acceptance evidence.

## Status: COMPLETE (the pack is written; see README.md for the map)

## The executed path (the re-entry trail)

- [x] Step 0: clone, branch, harness survey, persona survey, R23 record read.
- [x] Step 0.4: production serves the merged tree (the R33-A shortstage SSR
      attributes + the CSS re-arm rules at asset `2wf36gbc8dgj4.css`
      sha256 `9be6abf6…`; home content live; API healthy; the R33-C-era
      /sources HTML answer NO LONGER reproduces — the typed envelope answers).
- [x] The smoke (J02, labeled `smoke/`): FAIL at the hero assertion — the
      pre-adjudication hint that became the R28-B root cause.
- [x] The full production sweep: 8 chunks (the sandbox reaps background
      processes at tool-call boundaries — proven; recorded below), 38
      journeys, catalog order, the J21→J26 chain whole.
      **4 PASS / 34 FAIL** (artifacts: `run/chunk-01..08/`).
- [x] The flaky-check re-runs: every non-pass re-run — **34/34
      verdict-identical (zero verdict flakes); 33/34 failure-mode identical;
      J36's re-run failed at an earlier browser-harness wait timeout with the
      FAIL verdict unchanged** (artifacts: `rerun/chunk-01..08/`; mechanically
      verified in `run/consolidated-manifest.json`).
- [x] The local fixtures baseline (adjudication support, labeled): the
      current tree in its own R23-record configuration — **11 PASS / 27 FAIL**
      (artifacts: `local-baseline/full..full5/`).
- [x] The adjudication: per-journey classification with evidence cites +
      wave attribution via git bisects (`adjudication-table.md`):
      **32 STALE-GRAMMAR (26 tree-level §A + 6 production-only §B)** /
      2 ENVIRONMENTAL / **0 REGRESSION** (none
      attributable to R31/R32/R33-A/B/C; the movers are predominantly
      R28-B `1d32ed8` + the R29-B/R30-B shell waves + production
      catalog/config bindings).
- [x] The regression table vs the R23 record (`regression-table.md`).
- [x] The environmental-block table (`environmental-blocks.md`).
- [x] The acceptance summary (`acceptance-summary.md`).
- [x] The battery gate: **5256/1/0 — IDENTICAL to main** (`guards.md`).
- [x] The evidence pack + relay (README.md, this file, the thin bundle,
      RELAY-MANIFEST.txt).

## The post-completion verification pass (this lane's closing audit)

The lane's completion audit re-verified the pack against the artifacts and
found + fixed two record defects (evidence-file edits only — no product
code, same lane scope):

1. **The stale-grammar prose count drift**: the per-row tables
   (adjudication-table.md §A+§B, regression-table.md) carry **32**
   stale-grammar rows (26 tree-level + 6 production-only), but the prose in
   README/acceptance-summary/adjudication-footer/partial-results said "30".
   Corrected everywhere to 32 (26 + 6 = 32; 32 + 2 environmental = 34 ✓).
2. **The J36 re-run failure-mode divergence**: the suite-report claimed
   "34/34 reproduced identically (the same first-failing assertion in every
   case)"; the mechanical consolidation proved J36's re-run failed at an
   earlier browser-harness wait timeout (`[data-wfx-session-signed-in]`,
   25s) rather than the run-of-record BYOF assertion — the FAIL verdict is
   stable, but the failure mode differs. Recorded honestly in every doc +
   the consolidated manifest.

- [x] The MECHANICAL consolidation added: `run/consolidated-manifest.json`
      (generator `run/consolidate-manifests.py` — deterministic, re-runnable;
      checks: totals match every chunk manifest's own summary, the re-run
      covers exactly the non-pass set, 34/34 verdict-stable / 33 mode-identical
      / [J36] recorded, catalog order, the frozen production target).
- [x] The battery gate RE-RUN first-hand on the final lane head: **5256/1/0**
      (see guards.md — both runs recorded).

## The sandbox constraint (recorded for the next lane)

Backgrounded processes are REAPED at each tool-call boundary (proven: a
nohup+setsid `sleep 240` died between two consecutive calls; the first
backgrounded runner attempt left a 0-byte log and no process). Long suites
must run as sequential foreground chunks under the tool timeout — the
R28/R29 waves' doctrine, followed here (8 chunks × ≤6 journeys).
