# R35b — The Guards (the lane's gate record)

**Lane:** `wfx/r35b/journeys` · **Base:** `acff71b8b363ba6f85ab7a3e9b08ca7ba3e5a419`
(main, R35-A) · the R35b 32-spec journey re-encode.

## 1. The baseline (the battery of record, BEFORE any edit)

Run at the base commit, this sandbox, `bun install --frozen-lockfile`
(bun 1.3.14 — the CI-pinned version):

| Gate | Result |
|---|---|
| `bun run test` | **5265 tests / 5264 pass / 1 skip / 0 fail · 33700 expect() calls · 304 files · 188s** — identical totals to the record's 5265/33700; the single non-pass is the same R11 webtorrent platform issue of record ("webtorrent native prebuilt unavailable in this environment" — the node-datachannel prebuilt is absent here), which bun 1.3.14 reports as `skip` (the `it.skipIf(webtorrentAvailable)` form) rather than the record's `fail`. Same test, same root cause, honestly recorded. |
| `bun run typecheck` | clean (exit 0) |
| `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present |
| `bun run lane-check` | OK — 955 files, no cross-lane private imports |
| `bun run lint` | 33 errors / 83 warnings — PRE-EXISTING at base, byte-identical in count to the final lane state (see §3); every error sits OUTSIDE this lane's owned surface (evidence/r28-recon, r29-recon, r29-sweep, r30-web, apps/web/tests — the recorded repo lint debt; the merge record's own note "repo 115/32 = the pre-existing r28/r29-recon debt" agrees) |

**The floor:** no NEW failures; pass count ≥ the baseline's 5264 (the
record's 5265 pass + 1 fail-of-record = the same 5265-test total with
the same single webtorrent platform non-pass; this environment's skip
form is recorded verbatim above).

## 2. The final lane gates (after the re-encode)

| Gate | Result | vs the floor |
|---|---|---|
| `bun run test` | **5265 tests / 5264 pass / 1 skip / 0 fail · 33700 expect() calls · 304 files** (evidence/r35b/battery-test-summary.txt) | IDENTICAL totals — zero new failures, zero lost tests, the same single webtorrent platform non-pass |
| `bun run typecheck` | clean (exit 0) — root + journeys projects | green |
| `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present | green |
| `bun run lane-check` | OK — 955 files, no cross-lane private imports | green |
| `bun run lint` | 33 errors / 83 warnings — the same pre-existing files as base (r28-recon ×7, r29-recon ×6, r29-sweep ×6, r30-web ×1, apps/web/tests ×1 — plus the no-console warnings across the repo's evidence scripts); `bunx eslint journeys/web/` → **0 problems** (the lane is lint-clean, adds zero) | no new lint problems from the lane |
| `bun journeys/runner.ts` (the full fixtures boot, evidence/r35b/run/) | **38 pass / 3 fail / 0 not-run / 41 encoded journeys · 623 assertions · 6m36s** (2026-09-28T13:27:42Z → 13:34:18Z) | see §4 — the 3 fails are the untouched J40/J41/J43 |

The six production-neutral re-encodes were verified on BOTH boots:

| Journey | fixtures boot | LIVE PRODUCTION (`--base-url https://webflix-steel.vercel.app`) |
|---|---|---|
| J04 | PASS (evidence/r35b/run/) | **PASS** (evidence/r35b/prod-check/a/) |
| J14 | PASS | **PASS** (prod-check/a) |
| J15 | PASS | **PASS** (prod-check/a) |
| J16 | PASS | **PASS** (prod-check/a) |
| J33 | PASS | **PASS** (prod-check/b) |
| J38 | PASS | **PASS** (prod-check/b2) |

## 3. The lint debt (byte-identical to base)

`bun run lint` at base: 33 errors. `bun run lint` at the lane head: 33
errors — the same 15 files (all outside the lane: the r28/r29-recon
sweep scripts' `any` usage, one unused var in
apps/web/tests/r35-c2-session-intent-reflection.test.ts). The lane's own
files (`journeys/web/j*.ts`) lint with ZERO problems. The task's §4 gate
names typecheck/contract-check/lane-check (all green above); the lint
debt is the recorded repo state this lane inherited and did not touch.

## 4. The packet divergence (recorded honestly, never silently skipped)

The task packet lists the "green set" as J03/J13/J18/J19 **and
J40/J41/J43**. The first four are green on the current tree (this run
and the R34-C record agree). **J40/J41/J43 are NOT green at the base
commit** — proven on an isolated base worktree (`git worktree add …
acff71b8b363`, `bun install --frozen-lockfile`, `bun journeys/runner.ts
--filter J40,J41,J43`):

```
FAIL  J40 YouTube viewer parity          — "the item hub renders (the canonical identity surface)" [data-wfx-surface='item'] 0
FAIL  J41 YouTube-equivalent playback startup — "Deep Field Diary: the one obvious primary play action renders" [data-wfx-item-play] 0
FAIL  J43 Realtime translation           — "Deep Field Diary: the one obvious primary play action renders" [data-wfx-item-play] 0
```

0 passed / 3 failed — the identical first-failing assertions the lane's
full run records. These three are the same R28-B stale-grammar class
(their card-path navigation lands on `/player`; their item-surface reads
find nothing), they were **outside the R34-C sweep's scope** (which
covered J01–J39 — verified over the chunk manifests: J40/J41/J43 appear
in none), and they are **explicitly NOT this lane's owned surface**
("the green set J03/J13/J18/J19 and J40/J41/J43 are NOT yours; never
touch them"). The lane therefore leaves them untouched: the full-suite
run's 3 failures are byte-identically the base's failures (the base
worktree proof above), the lane's `git diff main --stat` contains zero
bytes of J40/J41/J43/J03/J13/J18/J19, and the 41-journey manifest
records their honest failures. **A journey-suite update work item for
J40/J41/J43 (the same J01-precedent re-encode class, outside this lane's
file scope) is the recorded follow-up** — recorded here, NOT applied.

## 5. The lane's file scope (the §4 no-product-code gate)

`git diff main --stat` = `journeys/web/j*.ts` (the 32 §3 specs only) +
`docs/validation/webflix-golden-journeys.md` (one dated additive
section) + `evidence/r35b/**` (this directory). ZERO product bytes
(apps/packages/scripts), ZERO harness-lib bytes (journeys/lib/**,
journeys/runner.ts), ZERO desktop bytes, and ZERO bytes in the untouched
journeys (J03 J13 J18 J19 J40 J41 J43) — verified before the commit.

## 6. The honesty proof

evidence/r35b/honesty-proof.md — the three representative classes (J06
R28-B, J01 R29-B/rail, J04 production-only): each re-encoded spec FAILED
under the exact simulated grammar regression (the mutation + the exact
failing assertion recorded), each base spec PASSED on that same
regressed grammar (where that grammar is the base's own binding), and
the current-tree matrix completes the proof. The scratch worktrees were
destroyed; the mutations exist nowhere in the delivered tree.
