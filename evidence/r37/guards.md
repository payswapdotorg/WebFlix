# R37 — GUARDS BATTERY (recorded as each gate completes)

Lane: `wfx/r37/live` (base: `main @ 37effa325c5060e14afda7e07db5b7eb61e45d9e` —
the R36 + R35b merge head) — the live surfaces: the live designation, the
/live browse, the watch live mode + current live chat over the WS seam,
and chat replay on archived live VODs (J45, J46).

## The baseline (recorded BEFORE any edit, at the base commit)

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 0 | install | `bun install` | OK — "618 packages installed" (no lockfile change; no dependencies added this lane — the zero-deps law) |
| 1 | battery (baseline) | `nice -n 19 ionice -c3 bun test --parallel=1` | **BASELINE: 5296 pass / 1 skip / 0 fail** — 5297 tests, 33850 expect() calls, 305 files, 230.10s (the task's stated floor exactly; the 1 skip = the R11 webtorrent platform issue of record) |
| 2 | typecheck (baseline) | `bun run typecheck` | PASS — exit 0, zero diagnostics (root + journeys) |
| 3 | contract-check (baseline) | `bun run contract-check` | PASS — "OK — 12 frozen blocks in sync, 7 extension types present." |
| 4 | lane-check (baseline) | `bun run lane-check` | PASS — "OK — 962 files, no cross-lane private imports." |
| 5 | lint (baseline) | `bun run lint` | exit 1 — the SAME pre-existing r28/r29-recon evidence-script debt every lane records (see evidence/r36/guards.md step 3, the identical convention); NONE of this lane's files appear in the output. The lane gate is `bunx eslint` over the lane's own files (below). |

The battery floor this lane must clear: **5296 pass + this lane's tests,
zero new failures.**

## The lane-head gates (all recorded at the working head that became the
commit below; every command run fresh after the last source edit)

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 6 | battery (lane head) | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS — 5353 pass / 1 skip / 0 fail** — 5354 tests, 34014 expect() calls, 309 files, 241.88s. The delta over the base: **+57 lane tests** (exactly this lane's 30 connector tests + 27 livechat tests), +164 expect() calls, +4 files, ZERO regressions (the 1 skip = the R11 webtorrent platform issue of record). NOTE — the first lane-head battery run recorded 5352/1/1: the 1 fail was the journey CATALOG GUARD (`journeys/report.test.ts` — "the encoded set is J01–J34 + J36–J41 + J43–J44 (42 journeys)") whose count the additive J45/J46 registration changes; the guard was updated ADDITIVELY per the R36 lane's own precedent (its merge diff touched exactly report.test.ts + web/index.ts + the new journey file for the same J44 registration), then the FULL battery re-ran green (5353/1/0) |
| 7 | lint (lane-clean) | `bunx eslint <all 18 lane-touched TS/TSX files>` | PASS — 0 errors, 0 warnings (apps/web/src/app/live/·components/live/·components/watch/LiveWatchSurface.tsx·ChatReplay.tsx·host/livechat/·app/watch/page.tsx·instrumentation.ts, packages/connectors/src/live/ + the two tests, byof-fixtures.ts, journeys/web/j45·j46 + index.ts + report.test.ts) |
| 8 | typecheck | `bun run typecheck` | PASS — exit 0, zero diagnostics (root + journeys) |
| 9 | contract-check | `bun run contract-check` | PASS — "OK — 12 frozen blocks in sync, 7 extension types present." (the live vocabulary rides the extension types' `metadata` bag — no frozen contract touched) |
| 10 | lane-check | `bun run lane-check` | PASS — "OK — 983 files, no cross-lane private imports." (962 at base; the +21 = this lane's new sources) |
| 11 | J45 (the lane's journey) | `bun journeys/runner.ts --filter J45 --evidence-dir evidence/r37/journeys-j45` | **PASS — 30 assertions, 3 artifacts** (the first run failed at "the verified-creator badge renders" — the badge's first scripted entry arrives at the 6s timeline offset and the journey asserted before it; the fix is the journey's own bounded wait for the deterministic timeline, then the fresh run passed) |
| 12 | J46 (the lane's journey) | `bun journeys/runner.ts --filter J46 --evidence-dir evidence/r37/journeys-j46` | **PASS — 21 assertions, 3 artifacts** |
| 13 | affected journeys (lane) | `--filter J01,J02,J03,J04,J05,J06,J11,J37,J40,J43,J44` (boot 1) + the J40/J43/J44 SOLO boots | Boot 1: **J01 (19) / J02 (12) / J03 (6 — the watch browse's byte-compatibility proof) / J04 (13) / J05 (7) / J06 (13) / J11 (11) / J37 (17) ALL PASS**; J40/J43/J44 hit the DOCUMENTED environmental ceiling mid-boot (the R35b-merge OOM kill of the dev render server — evidence/r35b-merge-journeys/merge-verification.md, the same kernel anon-rss OOM class; J40 first degraded on a wait timeout, J43/J44 answered ERR_CONNECTION_REFUSED against the dead server). The SOLO re-runs (one boot each): **J44 PASS — 57 assertions** (the R36 composability proof: the channel page + the /live rail's channel slots coexist); **J40 FAIL — 7 assertions; J43 FAIL — 2 assertions** — both re-run SOLO on an ISOLATED BASE WORKTREE with the IDENTICAL filters: J40 FAIL — 7 assertions, J43 FAIL — 2 assertions, **failure reasons byte-identical** (J40: "the item hub renders … [data-wfx-surface='item'] absent"; J43: "the one obvious primary play action … [data-wfx-item-play] absent" — the R35b-documented pre-existing stale-grammar class, verified AT BASE, untouched by this lane) |
| 14 | lane tests vs main | the lane's 4 new test FILES run on an isolated `37effa3` worktree | FAIL on main — all four "Cannot find module" (the lane's modules do not exist there), **0 pass** — the lane-test law proven (the R36 step-11 convention) |
| 15 | `git diff <base> --stat` | `git diff 37effa325c5060e14afda7e07db5b7eb61e45d9e --stat` | ONLY the owned surface (see the inventory in run-manifests.md): `app/watch/page.tsx` (+53/-3, the param-gated additive branch), `byof-fixtures.ts` (+220, the appended delimited R37 section), `instrumentation.ts` (+14, the appended boot call), `docs/validation/webflix-golden-journeys.md` (+39, the one dated section), `journeys/report.test.ts` (+6/-1, the catalog guard's additive registration — the R36 precedent), `journeys/web/index.ts` (+13, the additive imports/entries), `packages/connectors/src/index.ts` (+5, the one export line) + the NEW trees: `app/live/**`, `components/live/**`, `components/watch/LiveWatchSurface.tsx` + `ChatReplay.tsx`, `host/livechat/**`, `packages/connectors/src/live/**` + the two tests, `journeys/web/j45-live-watch-chat.ts` + `j46-chat-replay-scrub.ts`, `evidence/r37/**`. NOTE: the diff target is the FIXED BASE SHA (the task's §1 base); the upstream `main` ref moved PAST the base during the run (the wave-claim ledger commits 78c6a5d/2ae1c13 — coordination docs only, zero product code) — this lane incorporates NOTHING from them (the no-pull law) |

## The battery counts, side by side

| Run | pass | skip | fail | expect() | files |
|---|---:|---:|---:|---:|---:|
| BASE `main @ 37effa3` | 5296 | 1 | 0 | 33850 | 305 |
| LANE `wfx/r37/live` (the shipping head) | **5353** | **1** | **0** | 34014 | 309 |
| delta | **+57** | 0 | 0 | +164 | +4 |

(+2 more view-model tests landed after the full-battery run — the final
count at the commit is 5356 tests / 5355 pass / 1 skip / 0 fail / 34018
expect() / 310 files; the +59 lane tests total: 30 connector + 27
livechat + 2 view-model. The battery was re-run green at the final head
— battery-summary.txt, exit 0.)

## The honest environmental record

- The J43/J44 boot-1 failures were the documented kernel OOM ceiling
  (the R35b-merge verification's own class), NOT product failures — the
  solo re-runs prove the real verdicts (J44 PASS 57).
- The J40/J43 FAILs are the pre-existing stale-grammar base failures of
  record (byte-identical at base, solo boots, both sides).
- The dev boot on this lane adds the livechat bridge (port 3104) beside
  the realtime bridge (3102) + the dev provider (3103) — no port
  collisions; the bridge is env-gated (`WFX_DEV_FIXTURES=1`) and a
  build pass never starts servers (NEXT_PHASE — the boot law).
