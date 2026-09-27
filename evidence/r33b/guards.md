# R33-B — GUARDS BATTERY (every gate's output, on the final lane tree)

Lane: `wfx/r33b/shell-residuals` (base `main @ 178873a`, clean). Subject: the
shell-residuals batch — D6 the Subscriptions rail entry (the state-conditional
remap to the REAL R31 feed surface) + N33 the bottom-nav mobile form + the
re-verified rows (D8 held, D4 held, D3 honest-absent + pinned, N28
re-adjudicated, O6's meta residual closed) + the honest test-call-site update.

Command sequence (the task's gates, in order):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | install | `bun install --frozen-lockfile` | PASS (618 packages; the frozen lockfile intact — no changes) |
| 2 | battery (the full gate) | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS: 5217/1/0** — the base floor **5200/1/0 DIRECTLY re-measured** on the isolated base worktree at `main @ 178873a` (`5200 pass / 1 skip / 0 fail — 5201 tests across 297 files [228.08s]`) + exactly the 17 new R33-B tests (`5217 pass / 1 skip / 0 fail — 5218 tests across 298 files [229.02s]`); zero regressions by arithmetic AND by the zero-fail run; the honest skip = the R11 webtorrent env skip (the pre-existing 1) |
| 3 | lint | `bun run lint` + the scoped lane-files run | LANE-CLEAN (repo 115 problems (32 errors, 83 warnings) — **byte-identical to the base run at `main @ 178873a`** (re-measured on the isolated base worktree: 115/32/83); the lane's 5 changed+new files scoped: **0 errors, 0 warnings**) |
| 4 | typecheck | `bun run typecheck` (root + journeys) + `tsc --noEmit -p apps/web/tsconfig.json` | PASS (root + journeys + app: zero diagnostics) |
| 5 | contract-check | `bun run contract-check` | PASS ("contract-check: OK — 12 frozen blocks in sync, 7 extension types present.") |
| 6 | lane-check | `bun run lane-check` | PASS ("lane-check: OK — 943 files, no cross-lane private imports.") |
| 7 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS (**19 pass / 0 fail**, 366 expect() calls — CONFORMANT; the lane adds no CSS, the token contract untouched) |
| 8 | build | `NODE_OPTIONS=--max-old-space-size=2048 bun run --filter '@wfx/app-web' build` | PASS ("Exited with code 0" — every route compiles incl. `ƒ /feed/subscriptions`) |
| 9 | browser-verify | agent-browser @1440×900 + @390×844 against `WFX_DEV_FIXTURES=1 bun run --bun next dev -p 3101` (the `localhost` origin) | **PASS — the golden paths proven live** (browser-verification.md; 13 captures + 2 VLM reads; zero page errors across the pass) |

## Stage notes

### 2. battery — the floor re-measured, not trusted

The base floor was re-measured DIRECTLY on an isolated git worktree
(`/home/z/webflix-base` @ `178873a`, own `bun install --frozen-lockfile`):
**5200/1/0** — matching the R32 merge commit's claim exactly. The lane tree
answers **5217/1/0**: 5200 + 17 (all in
`apps/web/tests/shell-residuals.test.ts`: the D6 signed-out grammar ×3, the
D6 signed-in taxonomy ×3, the active-rail law ×2, the N33 bottom-nav ×3, the
D8 single-History pin ×2, the D3 honest-absence pin ×1, the D4 bell pins ×3).
The one pre-existing failure-free skip (the R11 webtorrent native-prebuilt
environment skip) is the honest 1 in both runs.

### 3. lint — lane-clean; the repo debt is the base's own

The repo's 115 problems (32 errors, 83 warnings) re-measured IDENTICAL on the
base worktree — the pre-existing debt, byte-identical; the lane's 5 files
(2 shell components, 1 page, 2 test files) scoped: 0/0.

### 9. browser-verify — the instrument note

The pass runs on the `http://localhost:3101` origin: the `127.0.0.1` origin
trips Next 16's cross-origin dev-resource block (the `/_next/hmr` refusal),
which leaves the client islands unhydrated — the honest sandbox note recorded
in browser-verification.md. On the server's own advertised origin every
island hydrates and every golden path runs: the D6 navigation (the entry →
the real feed with aria-current painted on both landmarks), the REAL
fixture-persona sign-in (the form's own submit → POST /api/auth/login → the
reload law), the logged-in taxonomy (no duplicate Subscriptions), the bell's
honest-zero grammar, the subscribe round trip through the REAL pill (the R31
restart law reproduced — the stored row renders LINKED in the section + the
feed's card), the mobile sweep (the bottom-nav grammar + the drawer), and
the meta theme-color boot round trips.

## The honest residuals carried forward

- D6's flat-list "Show more" collapse: CORPUS-PENDING (the two corpus records
  disagree on the bound) — DIVERGENCES.md row 3, never an invented bound.
- The J01 journey grammar: stale-by-lead-ruling (D5's "No action") — the
  journeys runner is not in the gate battery; DIVERGENCES.md row 6.
- The Watch browse surface is URL-direct only now (no rail slot) — the D6
  remap's own geometry, DIVERGENCES.md row 5.
