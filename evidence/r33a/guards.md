# R33-A — GUARDS BATTERY (recorded as each gate completes)

Lane: `wfx/r33a/shorts-player` (base: `main @ 178873a`)
Subject: the shorts media stage — REAL, PLAYING, full-bleed vertical video
on the shorts surface (the operator's #1: "the shorts are still bad").

Command sequence (the task's gates, in order, on the lane head):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 0 | install | `bun install --frozen-lockfile` | PASS — "618 packages installed" (no changes to the lockfile) |
| 1 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS — 5219 pass / 1 skip / 0 fail** (the 5200/1/0 floor + exactly this lane's 19, ZERO regressions; 33532 expect() calls, 298 files, 227.92s; the 1 skip = the R11 webtorrent honest env skip) |
| 2 | lint (lane-clean) | `bunx eslint <the lane's files>` | PASS — 0 errors, 0 warnings on the lane's changed files (repo-wide pre-existing debt attributed below) |
| 3 | typecheck | `bun run typecheck` (root + journeys) | PASS — exit 0, zero diagnostics |
| 4 | contract-check | `bun run contract-check` | PASS — "contract-check: OK — 12 frozen blocks in sync, 7 extension types present." |
| 5 | lane-check | `bun run lane-check` | PASS — "lane-check: OK — 946 files, no cross-lane private imports." (R32: 944 files; the +2 = this lane's new sources: `components/shorts/ShortsMediaStage.tsx` + `components/shorts/shorts-stage-client.ts` — the route + test + host edits live in already-scanned trees) |
| 6 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS — **19 pass / 0 fail** (366 expect() calls) — the parity suite stays CONFORMANT, exactly the R32 gate's 19/19 |
| 7 | build | `bun run --filter '@wfx/app-web' build` | PASS — Next.js production build exit 0 (all routes compiled; `/shorts` dynamic; the lane's note: the task's literal form `bun run build --filter '@wfx/app-web'` answers "Script not found" in this bun version — the working equivalent form is the filter-first form, recorded here) |
| 8 | browser-verified live | the stage playing a real embed end-to-end | **PASS** — browser-verification.md: the real nocookie embed staged full-bleed with the exact presentation law (service boot), the provider's channel LIVE (its own initialDelivery), the unmute + m-key round trips through the documented channel (provider-reported evidence advancing the visible truth), the session law's full round trip through the live routes (mint → play command → watch-state fold, all ok), the prefetch law (exactly 2 resolve reads + exactly 1 live iframe; the swipe re-stages from the warm cache), the R32 rail byte-identical over the stage, the mobile 44px law, the fixtures boot's honest unbound state, the clear-screen law (the stage stays). The provider's own bot-gate blocked the MEDIA in this egress (the VLM-read "Sign in to confirm you're not a bot" — the R28-B corpus's recorded environmental truth); the surface kept the honest phase throughout (unstarted, never fabricated) — recorded in full |

The battery log (the long stage): `guards-battery.log` in this folder.
**The final-head re-proof**: the battery was re-run VERBATIM on the final
lane head `2c356b5` (the evidence-only commits after `f017cf5` change no
code): `guards-battery-final.log` — **5219 pass / 1 skip / 0 fail**
(33532 expect() calls, 298 files, 221.54s) — identical.

## Stage results

(appended below as each stage completes — turn-boundary safe)

### 2. lint — LANE-CLEAN; repo exit 1 = PRE-EXISTING main debt (not this lane)

`bun run lint` → exit 1, "115 problems (32 errors, 83 warnings)" — the
SAME count the R30-B guards recorded at their base (`115 problems (32
errors, 83 warnings)` — the known "r28-recon lint debt" the R29-C round
escalated to the lead). Attribution re-proven here: every one of the 32
errors lives in `evidence/r28-recon/*.ts` + `evidence/r29-recon/*.ts`
(the probe scripts' `no-explicit-any` findings); NONE of this lane's
files appear anywhere in the output (the scoped run over the lane's six
files answers 0 problems). Lane verdict: PASS with the pre-existing debt
recorded, unchanged from base.

### 3. typecheck — PASS (pre-verified during the build)

`bun run typecheck` → `tsc --noEmit -p tsconfig.json && tsc
--noEmit -p journeys/tsconfig.json` → exit 0, zero diagnostics (the lane's
new files included through the root project's `apps/*/src` + `apps/*/tests`
includes — the repo's own typecheck convention covers the app).

(The remaining stages append below as they complete.)

---

## THE REQUIRE-CHANGES FIX ROUND (the lead's review @ 1610d44 — the
pinned-controls collision; re-run on the fix head)

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | battery (serial) | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS — 5221 pass / 1 skip / 0 fail** (the 5200/1/0 floor + the lane's now-21 — the 19 + the 2 new pinned-controls collision tests — ZERO regressions; 33549 expect() calls, 298 files, 228.48s; the 1 skip = the R11 webtorrent honest env skip) — `guards-battery-fix.log` |
| 2 | lint (lane-clean) | `bunx eslint <the lane's files>` | PASS — 0 errors, 0 warnings (the fix round touched `globals.css` + `shorts-media-stage.test.ts`; the lane's source set re-linted clean) |
| 3 | typecheck | `bun run typecheck` | PASS — exit 0, zero diagnostics (root + journeys) |
| 4 | contract-check | `bun run contract-check` | PASS — "contract-check: OK — 12 frozen blocks in sync, 7 extension types present." |
| 5 | lane-check | `bun run lane-check` | PASS — "lane-check: OK — 946 files, no cross-lane private imports." (unchanged count: the fix round adds no files) |
| 6 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS — **19 pass / 0 fail** (366 expect() calls) — CONFORMANT |
| 7 | build | `bun run --filter '@wfx/app-web' build` | PASS — Next.js production build exit 0 |
| 8 | browser-verified live (the fix's own bar) | the settled service-boot feed: elementFromPoint + the REAL click round trips | **PASS** — browser-verification.md §11: every elementFromPoint probe across the pill's rect resolves to THE PILL (before: every probe covered by the chips band + the controls row + the source chip); the REAL coordinate click at (745,86) → the provider's own mutedDelivery muted=false → the pill retired; the chips still function on both honest paths (the typed refusal + the ok→reload); the mobile 44px form clear; the VLM-read before/after pair |

The fix round's changed files: `apps/web/src/app/globals.css` (the
pinned-controls law: the three rows' top offsets, desktop + mobile, + the
pill's pointer-events re-arm — CSS only, zero markup changes) +
`apps/web/tests/shorts-media-stage.test.ts` (the collision-law regression
describe, 2 new tests).
