# R37 merge-head verification — 2026-09-28 23:2xZ (lead-A/ali10 console, the replay2 lineage)

Merge: `2dc3da2` — `wfx/r37/live @ 5b578a0` → `main @ 4c1316c` (merge-base 37effa3; main's delta
was ledger-docs-only, zero product code — the no-pull law respected by the lane).

## Gates at the merge head (fresh runs on the merged tree, this console)

| gate | command | result |
|---|---|---|
| typecheck | `bun run typecheck` | CLEAN (root + journeys) |
| contract-check | `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present |
| lane-check | `bun run lane-check` | OK — 983 files, no cross-lane private imports |
| battery | `bun test --parallel=2` | **5356 ran / 5355 pass / 1 skip / 0 fail**, 34019 expect() calls, 310 files, 198.77s — EXACT match to the lane-head report (+59 lane tests vs the 5297/5296/1/0 r35b floor, zero regressions) |
| J45 (live watch + live chat) | `bun journeys/runner.ts --filter J45 --evidence-dir evidence/r37-merge/journeys-j45` | **PASS — 30 assertions, 3 artifacts** |
| J46 (chat replay scrub) | `bun journeys/runner.ts --filter J46 --evidence-dir evidence/r37-merge/journeys-j46` | **PASS — 21 assertions, 3 artifacts** |

Journey artifacts: `evidence/r37-merge/journeys-j45/`, `evidence/r37-merge/journeys-j46/`
(manifests + the runner's own per-step records).

## Provenance

- Lane: worker chat `c2a2c46b` (the 18:02Z re-dispatch under ali10), completed 19:37:56Z;
  relay-harvested 90/90 sha256 EXACT → `/home/z/webflix-harvest/r37`; bundle base 37effa3.
- Clean-room review (Task 53, this console): all gates green at 5b578a0 — recorded in
  `evidence/r37/guards.md` (lane head) and this file (merge head).
- Merge authority: ledger `fbc859c` (lead-STEEL, 20:35Z): "the one true R37 — MERGE IT,
  the hold is released"; the lead-B lapse clause (~23:30Z) was also upon us.
- Wind-down context: ledger `4c1316c` — webflix-1.0 superseded by the operator's
  webflix-2.0 directive (21:54Z); in-flight lanes finish normally, nothing new dispatched.

Honesty notes: the merge-head battery ran on this console's fresh `bun install` (618 packages,
typescript@5.9.3). The earlier `bun x tsc` TS5090 noise was a wrong-tsc-version artifact, not a
repo defect — the repo's own toolchain via `bun run typecheck` is clean. No gate numbers were
transcribed from the worker's report without a fresh re-run at this head.
