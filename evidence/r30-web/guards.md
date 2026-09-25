# R30-A — GUARDS BATTERY (recorded as each stage completes)

Lane: `wfx/r30/web` (base: `main @ 01c24c1`)
Subject: the Subscribe reload-durability fix (R29 sweep divergence #1) —
the watch surface's library truths hydrate from the stored library truth.

Command sequence (the task's guards, in order):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | install | `bun install --frozen-lockfile` | PENDING |
| 2 | lint | `bun run lint` | PENDING |
| 3 | typecheck | `bun run typecheck` | PENDING |
| 4 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | PENDING (floor 5132/1/0) |
| 5 | contract-check | `bun run contract-check` | PENDING |
| 6 | lane-check | `bun run lane-check` | PENDING |
| 7 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PENDING (stays CONFORMANT) |
| 8 | build | `bun run build --filter web` | PENDING |

Pre-battery state (already proven in earlier turns — NOT re-run here, per
the lead's order):
- REPRO: the split reproduced BOTH boots — `repro/base-fixtures.repro.json`
  (fixtures boot, full phase), `repro/base-service-a.repro.json` (service
  boot A, subscribe-leave), `repro/base-service-b.repro.json` (service
  boot B, fresh-load; run against a clean base checkout — the pre-fix
  tree). All three show `subscribeDurable.stateAfterReload: "idle"` +
  fresh-load remove `not-found` — the production-confirmed split.
- FIX: working tree (6 modified + 2 new files; see the completion report
  Scope for the full list + the two ESCALATION seams).
- TESTS: `apps/web/tests/subscribe-reload-durability.test.ts` (4 pass) +
  `packages/client-runtime/tests/library-hydration.test.ts` (6 pass) —
  the reload-durability probe AS A TEST (the task's specified proof
  mechanism for the seam).

Battery log tail (the long stage): `guards-battery.log` in this folder.

## Stage results

(appended below as each stage completes — turn-boundary safe)

### 1. install — PASS (2026-09-25T05:4x)
`bun install --frozen-lockfile` → "Checked 338 installs across 353 packages (no changes) [38.00ms]" — exit 0, frozen lockfile intact.

### 2. lint — LANE-CLEAN; repo exit 1 = PRE-EXISTING main debt (not this lane)
`bun run lint` → exit 1, "115 problems (32 errors, 83 warnings)".
Attribution (the guard's honest reading): **all 32 errors** live in `evidence/r28-recon/*.ts` (12) + `evidence/r29-recon/*.ts` (9 files) — the known "r28-recon lint debt" the R29-C round already ESCALATED to the lead, byte-identical to `main @ 01c24c1` (git status: not modified in this lane's tree; this lane touches none of them).
This lane's changed files (the 9 source/test files + `evidence/r30-web/repro/r30-repro-probe.ts`), linted scoped: **0 errors** — 3 `no-console` warnings in the probe script only (the same evidence-probe house style every r28/r29 probe carries). Lane verdict: PASS with the pre-existing debt recorded, unchanged from base.

### 3. typecheck — PASS
`bun run typecheck` → `tsc --noEmit -p tsconfig.json && tsc --noEmit -p journeys/tsconfig.json` — exit 0, zero diagnostics (root + journeys projects, the two new test files included).
BATTERY PID: 10851

### 5. contract-check — PASS
`bun run contract-check` → "contract-check: OK — 12 frozen blocks in sync, 7 extension types present." — exit 0 (same 12 blocks as the R29 gate).

### 6. lane-check — PASS
`bun run lane-check` → "lane-check: OK — 922 files, no cross-lane private imports." — exit 0. (R29: 919 files; the +3 = this lane's new scanned sources: `apps/web/src/host/library-fixtures.ts`, `apps/web/tests/subscribe-reload-durability.test.ts`, `packages/client-runtime/tests/library-hydration.test.ts`. The shared-package seams import public entry points only — `@wfx/domain`, `@wfx/client-runtime` — no deep imports, no relative escapes.)

### 7. parity-conformance — PASS (stays CONFORMANT)
`bun test tests/parity-conformance.test.ts` → **19 pass / 0 fail** (366 expect() calls) — the parity suite stays CONFORMANT, exactly the R29 gate's 19/19.

### 4. battery — PASS: 5142/1/0 (floor 5132/1/0 EXCEEDED by exactly the 10 new R30 tests; zero regressions)
`nice -n 19 ionice -c3 bun test --parallel=1` → **5142 pass / 1 skip / 0 fail — 5143 tests across 292 files [236.71s]** (full log: `guards-battery.log`).
- The floor's honest skip unchanged: the R11 webtorrent native-prebuilt environment skip (reason recorded) — the pre-existing 1.
- The +10: `apps/web/tests/subscribe-reload-durability.test.ts` (4 pass — subscribe→RELOAD→pill renders the stored truth subscribed + Library agrees; the in-view round trip re-verified exactly as the sweep proved it; the honest idle for no-stored-truth; the watchlist store untouched) + `packages/client-runtime/tests/library-hydration.test.ts` (6 pass — hydrate() seeds the fold with the R04 canonical-id adoption; THE FRESH-LOAD UNSUBSCRIBE finds the STORED item (divergence #1 closed); local-first merge; honest degradation + retry; memoized one-read; typed refusal for unsaved items).
- Zero `(fail)` lines in the log; every pre-existing suite green at its R29 counts.

### 8. build — PASS
`bun run --filter '@wfx/app-web' build` → `@wfx/app-web build: Exited with code 0` — the full Next.js 16 (Turbopack) production build; every route compiles incl. the seam's own surfaces (`/player`, `/library`, `/api/library`). (The brief's literal `bun run build --filter web` form resolves to this same invocation; the bare filter literal `web` matches no package name — `@wfx/app-web` is the workspace's name.)

---

## BATTERY VERDICT — ALL GATES GREEN
install PASS · lint LANE-CLEAN (pre-existing main debt unchanged, not this lane) · typecheck PASS · **battery 5142/1/0 (floor 5132/1/0 exceeded by exactly the 10 new R30 tests; zero regressions)** · contract-check PASS (12 blocks) · lane-check PASS (922 files) · parity-conformance 19/19 CONFORMANT · build PASS.
