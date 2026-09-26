# R30-B — GUARDS BATTERY (recorded as each stage completed)

Lane: `wfx/r30/b` (base: `main @ f1bdba6` merged with
`origin/wfx/r30/lead-captures @ b77873b` — the evidence/docs lane, clean).
Subject: the account-chrome family — the corpus-pending surfaces brought from
honest-absence to corpus-bound parity (CORPUS.md §1–§4, §6, §8, §9; the four
README gaps kept pending).

Command sequence (the task's gates, in order):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | install | `bun install --frozen-lockfile` | PASS (618 packages; the frozen lockfile intact — no changes) |
| 2 | lint | `bun run lint` | LANE-CLEAN (repo exit 1 = the pre-existing main debt, byte-identical; the lane's files 0 errors / 0 warnings) |
| 3 | typecheck | `bun run typecheck` (+ the app-level `tsc -p apps/web/tsconfig.json`) | PASS (root + journeys + app: zero diagnostics) |
| 4 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS: 5165/1/0** (the 5142/1/0 floor + exactly the 23 new R30-B tests; zero regressions) |
| 5 | contract-check | `bun run contract-check` | PASS ("contract-check: OK — 12 frozen blocks in sync, 7 extension types present.") |
| 6 | lane-check | `bun run lane-check` | PASS ("lane-check: OK — 932 files, no cross-lane private imports.") |
| 7 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS (19 pass / 0 fail, 366 expect() calls — CONFORMANT, the R29/R30-A gate unchanged) |
| 8 | build | `NODE_OPTIONS=--max-old-space-size=2048 bun run --filter '@wfx/app-web' build` | PASS ("Compiled successfully … Exited with code 0" — every route incl. the seam's surfaces; the brief's literal `bun run build --filter web` resolves to this same invocation, as the R30-A guards record) |

## Stage notes

### 2. lint — LANE-CLEAN; repo exit 1 = the pre-existing main debt (not this lane)
`bun run lint` → "115 problems (32 errors, 83 warnings)" — byte-identical to the
main baseline (the r28-recon/r29-recon evidence debt the R29-C round already
escalated to the lead; this lane touches none of those files). The lane's own
changed+new files (24 source/test/probe files), linted scoped: **0 errors, 0
warnings** — lane verdict PASS with the pre-existing debt recorded, unchanged
from base. (The first lint run showed +2 unused-prop errors in AccountMenu.tsx —
fixed in-lane before the final run above.)

### 4. battery — PASS: 5165/1/0
`nice -n 19 ionice -c3 bun test --parallel=1` → **5165 pass / 1 skip / 0 fail —
5166 tests across 294 files [223.67s]**; zero `(fail)` lines in the log.
- The floor's honest skip unchanged: the R11 webtorrent native-prebuilt
  environment skip (the pre-existing 1).
- The +23: `apps/web/tests/account-chrome.test.ts` (15 — §1's two grammar layers
  incl. the captured 167/"9+"/"(167)" pairs; §2's honest-empty panel; §3's
  14-row grammar + the absence note + the locale mapping; §4's stored-truth rail
  flow through the REAL subscribe seam; the signed-in cluster + the signed-out
  byte-identical control) + `apps/web/tests/playlist-family.test.ts` (8 — §6's
  resume-bar from the stored truth; §8's header grammar + the pills; §9's
  unavailable notice + the real-type chips; the queue-seed round trip + the
  shuffle's exact-set law).
- Every pre-existing suite green at its R30-A counts (the AppShell-rendering
  subset — acquisition/adapter/discovery/subscribe-reload/shorts-parity —
  re-verified at 80/80 before the full run).

### 7. parity-conformance — PASS (stays CONFORMANT)
19/19 — the parity suite stays CONFORMANT, exactly the R29/R30-A gate. The lane's
CSS additions are additive (the new account-chrome + playlist-family blocks; the
corpus 204x40 guide-entry box on the labeled/drawer rail forms — the
parity-pinned `--wfx-rail-w-wide: 240px` var and every other pinned token
unchanged).

### 8. build — PASS
The full Next.js 16 (Turbopack) production build: every route compiles incl. the
seam's surfaces (`/`, `/library`, `/settings`, `/search`, `/watch`, `/shorts`,
`/player`, `/item`, `/offline`). Two app-level typecheck catches were fixed
in-lane, each invisible to the ROOT typecheck (the app tsconfig's
exactOptionalPropertyTypes): the AccountMenuPanel call passing the removed
`profiles`/`activeProfileId` props, and (caught on the re-entry re-verification)
the SSR probe's `identityEmail: string | undefined` — fixed with the repo's
conditional-spread pattern. The re-run exited 0; the re-entry verification
re-ran EVERY gate on the final tree (all green, below).

## RE-ENTRY RE-VERIFICATION (the stall recovery — every gate re-run on the final tree)

The turn stalled after the first full pass; the re-entry re-ran every gate on the
final lane head (after the probe fix): typecheck PASS (root + journeys + the
app-level `tsc -p apps/web/tsconfig.json`), battery **5165/1/0** (5166 tests
across 294 files [225.18s], zero `(fail)` lines), parity-conformance 19/19,
contract-check 12 blocks, lane-check 932 files, lint lane-clean (repo 115
problems byte-identical to main; the lane's files 0/0 incl. the probe), the two
new suites 23/23, build exit 0. The re-verification CAUGHT one real residual
(the probe's exactOptionalPropertyTypes violation — the app-level typecheck the
build runs) — fixed and re-proven; the captures regenerated
(`probe-facts.json` + `captures/` reflect the final tree).

## BATTERY VERDICT — ALL GATES GREEN

install PASS · lint LANE-CLEAN (the pre-existing main debt byte-identical, not
this lane) · typecheck PASS (root + journeys + app) · **battery 5165/1/0 (the
5142/1/0 floor exceeded by exactly the 23 new tests; zero regressions)** ·
contract-check PASS (12 blocks) · lane-check PASS (932 files) ·
parity-conformance 19/19 CONFORMANT · build PASS.

(The browser-level capture is BLOCKED in this sandbox — the dev server is
OOM-killed at compile, the same memory-ceiling class the R30-A lead recorded for
the boot-B probe; the per-surface proofs are the 23 tests + the SSR composition
captures in `captures/` — see DIVERGENCES.md row 20.)

## PUSH (post-gates) — BLOCKED by the sandbox's credentials, honestly

`git push -u origin wfx/r30/b` → "fatal: could not read Username for
'https://github.com': No such device or address" — this sandbox carries NO GitHub
credentials (no token, no credential helper, no ssh binary, no gh CLI; the clone
succeeded because the repository is public). The lane head IS committed locally
with the full lane message (all gates green on exactly that tree); the push is a
credentials act the lead performs on re-entry. Every other lane deliverable is
complete and recorded in this folder.
