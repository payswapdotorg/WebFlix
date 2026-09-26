# R32 — GUARDS BATTERY (every gate's output, on the final lane tree)

Lane: `wfx/r32/shorts-rail` (base: `main @ c3640cf` — the R32 G4-corpus
merge, clean). Subject: the ONE corpus-pending surface — the shorts action
rail (G4-CORPUS.md 20260926-093102, the fourth-gap corpus, now captured
live). §G3 (the home resume bar) NOT built.

Command sequence (the task's gates, in order):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | install | `bun install --frozen-lockfile` | PASS (618 packages; the frozen lockfile intact — no changes) |
| 2 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS: 5200/1/0** — the R31 floor 5188/1/0 + exactly the 12 new R32 tests; zero regressions |
| 3 | lint | `bun run lint` + the scoped lane-files run | LANE-CLEAN (repo 115 problems (32 errors, 83 warnings) — byte-identical to the base at `main @ c3640cf` [the R31 final count: docs + empty commits since — no code]; the lane's 5 changed+new files scoped: 0 errors, 0 warnings) |
| 4 | typecheck | `bun run typecheck` (root + journeys) + `tsc --noEmit -p apps/web/tsconfig.json` | PASS (root + journeys + app: zero diagnostics) |
| 5 | contract-check | `bun run contract-check` | PASS ("contract-check: OK — 12 frozen blocks in sync, 7 extension types present.") |
| 6 | lane-check | `bun run lane-check` | PASS ("lane-check: OK — 942 files, no cross-lane private imports.") |
| 7 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS (19 pass / 0 fail, 366 expect() calls — CONFORMANT, the R29/R30-A gate unchanged; the lane's CSS changes are additive to the shorts block + the replaced pre-corpus actions class) |
| 8 | build | `NODE_OPTIONS=--max-old-space-size=2048 bun run --filter '@wfx/app-web' build` | PASS ("Exited with code 0" — every route compiles incl. `/shorts`) |
| 9 | browser-verify | agent-browser @1440×900 + @390×844 against `WFX_DEV_FIXTURES=1 next dev -p 3101` | **PASS — the golden paths proven live** (see `browser-verification.md`; the dev server boots here, the R31 window class) |

## Stage notes

### 2. battery — PASS: 5200/1/0 (the floor + exactly the 12 new)
The final-tree run: **5200 pass / 1 skip / 0 fail — 5201 tests across 297
files [227.90s]** (run TWICE on the lane: once mid-lane [223.07s] and once
on the final tree after the lint/type fixes — identical counts).
- The base floor: the R31 record's 5188/1/0 (the battery the R31 lane
  left at its merge; the corpus commits since touched docs only).
- The honest skip unchanged: the R11 webtorrent native-prebuilt
  environment skip (the pre-existing 1).
- The +12: `apps/web/tests/shorts-rail-parity.test.ts` —
  - the rail's captured grammar (the column, the Share text form, the
    count-slot law: exactly ONE count slot, never a fabricated "176K");
  - the typed absences (like/save no control in the real boot — the
    capabilities: [] truth; comments/remix no control at all + the typed
    absence attribute);
  - the like/save-capable synthetic card (the frozen tree's gate: the
    icon-only cells, the a11y verbatim, the aria-pressed toggle form);
  - the actionStates seam's laws (optimistic + receipt-truth + rollback —
    the exported reducer driven directly);
  - the real /api/actions receipt vocabulary (the dispatch the fireAction
    performs);
  - the channel row's identity (the sources-model displayName — never a
    fabricated @handle) + the idle pill;
  - the Subscribe round trip through the REAL seam (the pill's exact
    /api/library body → the payload re-read → SUBSCRIBED; cleanup);
  - the reload-durability law (a fresh process's payload still answers
    subscribed — the stored source-identity join);
  - the 5th-element avatar (the monogram law + NO link);
  - the title truth + the pinned controls (the nav + the R24-W2 row);
  - the two stylesheet-grammar tests (the 48px column / 78px pitch / 48×48
    buttons / 24×24 avatar / the 78×32 pill class / the clear-screen rule
    extension).
- Every pre-existing suite green (the scoped re-run of the eight
  changed-surface suites — shorts-parity, subscribe-reload-durability,
  subscriptions-feed, account-chrome, adapter-surfaces, adapter-api-routes,
  up-next-queue, playlist-family — 95/95 before the full runs).

### 3. lint — LANE-CLEAN; repo 115 = the base, byte-identical
The first lane run showed 116 (one new `no-console` warning in the probe's
final `console.log`) — the R31 lesson reproduced verbatim; fixed in-lane
(the probe's own "the facts file IS the output" law) before the final run:
repo 115 problems, byte-identical to the base. The lane's 5 files
(ShortsFeed.tsx, ShortsSubscribeRow.tsx, host/shorts.ts,
shorts-rail-parity.test.ts, r32-rail-probe.ts) linted scoped: **0 errors,
0 warnings** (globals.css carries no lintable rules).

### 4. typecheck — three configs, zero diagnostics
`bun run typecheck` (root tsconfig + journeys) PASS; the app config
(`tsc --noEmit -p apps/web/tsconfig.json`) PASS. The lane's noUncheckedIndexedAccess
guards (the repo's throw-guard pattern) landed in the test + the probe.

### 6. lane-check — 942 files (939 + the lane's 3 new .ts files)
No cross-lane private imports; the lane's imports ride the public entries
(`@wfx/experience`) + the app's own `@/` aliases.

### 7. parity-conformance — 19/19, the gate unchanged
The harness's token/geometry surface is untouched by the lane (the rail
classes are additive custom classes; the replaced `.wfx-shortcard__actions`
was not an asserted selector — the run proves it).

### 9. browser-verify — the golden paths, LIVE
See `browser-verification.md` (the rail's measured live geometry, the
subscribe round trip + its durable reload, the per-card truth across
swipes, the share event POST, the clear-screen law, the mobile 44px law,
zero page errors) + the four PNG captures.
