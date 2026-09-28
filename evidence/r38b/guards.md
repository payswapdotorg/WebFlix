# R38-B — The guards record (the baseline + the lane gates)

**Lane:** `wfx/r38b/studio` · **Base:** `37effa325c5060e14afda7e07db5b7eb61e45d9e`
(main — R36 + R35b merges) · **Worker environment:** the R38-B sandbox.

## 1. The baseline battery of record (run at the exact base, pristine tree)

The packet's expectation: **5297 tests / 5296 pass / 1 skip / 0 fail** (the 1
skip is the pre-existing R11 webtorrent platform issue of record).

The measured baseline (this sandbox, `bun run test` at base):

```
Ran 5297 tests across 305 files. [189.14s]
 5296 pass
 1 skip
 0 fail
 33850 expect() calls
1 tests skipped:
(skip) R11 — the webtorrent evaluation skip honesty > webtorrent native
        prebuilt unavailable in this environment (reason recorded)
```

**EXACT MATCH with the packet's floor: 5297 / 5296 / 1 / 0.** The regression
floor for this lane: no NEW failures and pass count ≥ 5296 + the lane tests.

## 2. The other base gates

| Gate | Base result |
|---|---|
| `bun run typecheck` | clean (both tsconfigs) |
| `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present |
| `bun run lane-check` | OK — 962 files, no cross-lane private imports |
| `bun run lint` | **pre-existing RED outside this lane — see §3** |

## 3. The pre-existing lint state at base (recorded honestly, not this lane's)

`bun run lint` at the pristine base commit reports **33 errors / 85
warnings** (full log: `evidence/r38b/baseline-lint.log`). Every error is in
a file OUTSIDE this lane's owned surface, and every one is pre-existing at
the base commit (the tree is byte-identical to `37effa3` apart from this
lane's additions):

- `evidence/r28-recon/*.ts`, `evidence/r29-recon/*.ts`, `evidence/r29-sweep/*.ts`,
  `evidence/r30-web/repro/*.ts` — historical probe scripts carrying
  `no-explicit-any`/`no-unused-vars` errors (committed by earlier lanes'
  evidence artifacts).
- `apps/api/tests/local-dev/*.ts` (3 files), `apps/desktop/scripts/r27-capture-harness.ts`,
  `packages/torrent-engine/tests/fixtures/generate.ts` — `no-explicit-any`/
  `no-unused-vars`.
- `apps/web/tests/r35-c2-session-intent-reflection.test.ts:129` — one
  `no-unused-vars` error (the R35 merge's own file).
- The warnings are `no-console` statements across apps/api hosts/evidence
  scripts (83–85 depending on the run's count line).

Reading of the record: the merged lanes' gates of record at this base (the
R35b and R36 merge commits) list **battery + typecheck + contract-check +
lane-check** and describe lint as *lane-clean* (scoped to the lane's own
files) — never full-repo lint green. The R28/R29-era evidence probes are
what carry the errors. **This lane's lint obligation (matching that
convention): every file this lane adds or touches lints CLEAN, and the
error/warning counts outside the lane are unchanged from the base list
above** (re-proven at the lane head in §5).

## 4. The journey baseline (affected set)

J45/J46 (R37's live lane) are NOT present at this base — the newest
journeys are J43 (R25-W2) and J44 (R36). The affected set for this lane is
therefore **J01–J44** per the packet's rule. The known pre-existing journey
state at base (the R35b record): the suite ran 38 pass / 3 pre-existing
base fails (J40, J41, J43 — the recorded stale-grammar honest remaining
gap, evidence/r35b/guards.md §4). This lane re-ran the affected journeys
and compares verdicts base-vs-lane (§6) — the floor is NO NEW failures and
J44 (the channel surface this lane composes with) green at the lane head.

## 5. The lane-head gates (re-proven at the lane head)

| Gate | Lane-head result |
|---|---|
| `bun run test` (the battery) | **5359 tests / 5358 pass / 1 skip / 0 fail / 34101 expect() calls across 311 files** — the base floor + EXACTLY this lane's 62 lane tests (13 domain-graph + 49 studio-store), zero regressions |
| `bun run typecheck` | clean (both tsconfigs) |
| `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present |
| `bun run lane-check` | OK — 993 files, no cross-lane private imports |
| Scoped lint (every file this lane adds/touches) | **0 problems** (eslint over apps/web/src/app/studio, apps/web/src/components/studio, apps/web/src/host/studio-store, packages/domain/src/graph, journeys/web/j48-studio-edit-customize.ts) |
| Full-repo `bun run lint` | 33 errors — **the error set is BYTE-IDENTICAL to the base list (§3)**, diff-verified (`diff` of the sorted error lines: identical). The pre-existing failures are outside this lane and unchanged. |
| `git status` | clean at the commit (everything committed on `wfx/r38b/studio`) |

Battery arithmetic: base 5297/5296/1/0 (305 files) + this lane's 62
tests (packages/domain/src/graph/channel-profile.test.ts — 13;
apps/web/src/host/studio-store/*.test.ts — 49) = 5359/5358/1/0 (311
files). The 1 skip is the unchanged pre-existing R11 webtorrent
platform issue.

## 6. The lane-head battery + journey comparison (the gate of record)

- **J48 (the lane's journey): PASS — 71 assertions, 9 artifacts**
  (journeys/final-run/ — the manifest, the screenshots, the snapshot,
  the narration; reproduced on the final fresh boot).
- **The affected set (J01–J44): 39 PASS · 3 pre-existing base fails
  (J40/J41/J43 — byte-identical to the recorded base failures) · 1
  environmental block (J36 — the kernel OOM, proven base-identical on
  an isolated base worktree) · 0 NEW FAILURES.** The full verdict
  table + the procedure: journeys-affected/summary.md.
- **J44 (the R36 surface this lane composes with): PASS — 57
  assertions** (reproduced twice; the artifact run:
  journeys-affected/j44/).

## 7. The environmental record (this box's ceiling — the R25-W2/R35b class)

The single-run full journey battery exceeds this sandbox's memory
ceiling: the fixtures dev server is kernel-OOM-killed at ~2.3GB RSS
(box total 4.16GB, co-resident with the preview stack). The first
sweep attempt died after 5 journeys (J11–J15 PASS, then
ERR_CONNECTION_REFUSED — the kernel log confirms the kill). The sweep
therefore ran as order-preserving chunks with the browser pool cleaned
between (journeys-affected/summary.md documents the procedure and the
logs). J36 — the heaviest journey — is un-runnable to completion on
this box AT BASE TOO (proven on an isolated base worktree, byte-class
identical). This is the same environmental class the R35b merge record
documents for the Lead's own sandbox — recorded here honestly, never
silently, never as a product failure.

