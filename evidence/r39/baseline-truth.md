# WFX-DEPLOY-W3 — the baseline truth (recorded before any lane change)

The §1/§2 baseline numbers, recorded verbatim at the branch point (main @ `fbbef9b`
+ the work-order commit `75a7e42` — no product/journey code changed by this lane yet).

## The gates at baseline

| Gate | Command | Result |
|---|---|---|
| typecheck | `bun run typecheck` | CLEAN (root + journeys) |
| lint | `bun run lint` | **116 problems (33 errors / 83 warnings) — pre-existing RED outside this lane** (the frozen list: the historical evidence-probe files r28-recon/r29-recon/… + one r35 test file; the r38b lane's `evidence/r38b/baseline-lint.log` records the same class at 33 errors/85 warnings — the warning-count drift is the eslint/file set, the error set is the same frozen list) |
| battery | `bun run test` | **5418 ran / 5417 pass / 1 skip / 0 fail**, 34,269 expect() calls, 316 files — EXACT match with the R38-B merge-head record (5418/5417/1/0) |
| contract-check | `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present |
| lane-check | `bun run lane-check` | OK — 1014 files, no cross-lane private imports |
| journeys:list | `bun run journeys:list` | 45 encoded journeys + 23 explicitly-listed not-run/reach-limit entries |

## The baseline journey sweep (the chunked procedure, pre-strengthening)

45 encoded journeys → **41 PASS · 4 FAIL**, all four failures byte-identical to the
standing base failures of record:

| Journey | Baseline result | The standing record it matches |
|---|---|---|
| J01–J35, J37–J39, J44–J46, J48 | **PASS ×41** (J44 57 · J45 30 · J46 21 · J48 71 assertions) | the r35b/r38b records |
| J40 | **FAIL at 7 assertions** — "the item hub renders (the canonical identity surface)" | `evidence/r35b/run/manifest.json` (byte-identical first failure) |
| J41 | **FAIL at 2 assertions** — "Deep Field Diary: the one obvious primary play action renders" | same record (byte-identical) |
| J43 | **FAIL at 2 assertions** — the same J41-class failure | same record (byte-identical) |
| J36 | **FAIL at 45 assertions** — the §11 `wait [data-wfx-session-signed-out]` timeout (the navigation-unsafe reload-wait race; deterministic across two runs) | the r38b env-block class ("40/45+ passing per run", base-identical per that lane's isolated-worktree proof) |

Baseline truth recorded 2026-10-02 (UTC) on this 4.16GB box. The four failures are the
R28-B stale-grammar class (J40/J41/J43 — the journeys' navigation predated the one-click
card grammar) + the reload-wait race (J36) — all four are FIXED by this lane's strengthening
(see `../summary.md`): the strengthened suite answers **46/46 PASS**.
