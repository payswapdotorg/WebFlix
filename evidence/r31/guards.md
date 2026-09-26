# R31 — GUARDS BATTERY (every gate's output, on the final lane tree)

Lane: `wfx/r31/gaps` (base: `main @ 54e0e4f` — the R31 gap-corpus merge, clean).
Subject: the gap wave — §G1 the theme-picker submenu (behind the account menu's
Appearance row) + §G2 the subscriptions-feed grid (the LibraryEngine seam's stored
truth at the corpus URL). The two still-pending gaps (home resume bar, shorts
action rail) NOT built.

Command sequence (the task's gates, in order):

| # | Stage | Command | Result |
|---|-------|---------|--------|
| 1 | install | `bun install --frozen-lockfile` | PASS (618 packages; the frozen lockfile intact — no changes) |
| 2 | lint | `bun run lint` + the scoped lane-files run | LANE-CLEAN (repo 115 problems (32 errors, 83 warnings) — byte-identical to the base run at `main @ 54e0e4f`; the lane's 13 changed+new files scoped: 0 errors, 0 warnings) |
| 3 | typecheck | `bun run typecheck` (root + journeys) + `tsc --noEmit -p apps/web/tsconfig.json` | PASS (root + journeys + app: zero diagnostics) |
| 4 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS: 5188/1/0** — the base floor 5165/1/0 (directly re-measured on the isolated base worktree: `5165 pass / 1 skip / 0 fail — 5166 tests across 294 files [226.28s]`) + exactly the 23 new R31 tests; zero regressions |
| 5 | contract-check | `bun run contract-check` | PASS ("contract-check: OK — 12 frozen blocks in sync, 7 extension types present.") |
| 6 | lane-check | `bun run lane-check` | PASS ("lane-check: OK — 939 files, no cross-lane private imports.") |
| 7 | parity-conformance | `bun test tests/parity-conformance.test.ts` | PASS (19 pass / 0 fail, 366 expect() calls — CONFORMANT, the R29/R30-A gate unchanged; the lane's CSS additions are additive) |
| 8 | build | `NODE_OPTIONS=--max-old-space-size=2048 bun run --filter '@wfx/app-web' build` | PASS ("✓ Compiled successfully in 7.3s … Exited with code 0" — every route compiles incl. the new `ƒ /feed/subscriptions`) |
| 9 | browser-verify | agent-browser @1440×900 against `WFX_DEV_FIXTURES=1 next dev -p 3101` | **PASS — the golden paths proven live** (see `browser-verification.md`; UNLIKE the R30-B sandbox, the dev server boots here) |

## Stage notes

### 2. lint — LANE-CLEAN; repo 115 = the base, byte-identical
The first lane run showed 116 (one new `no-console` warning in the R31 probe's
final `console.log`) — fixed in-lane (the R30-B probe's own `Bun.write` pattern)
before the final run: repo 115 problems, byte-identical to the base run. The
lane's 13 changed+new files (AccountMenu.tsx, Icon.tsx, RailSubscriptions.tsx,
theme-picker-grammar.ts, SubscriptionsFeedSurface.tsx, feed/subscriptions/page.tsx
+ loading.tsx, routing.ts, globals.css [no lintable rules], the two new test
files, the new probe, + the two honestly-updated call sites
account-chrome.test.ts / r30-account-chrome-probe.ts), linted scoped: **0 errors,
0 warnings**.

### 4. battery — PASS: 5188/1/0 (the floor + exactly the 23 new)
The final-tree run: **5188 pass / 1 skip / 0 fail — 5189 tests across 296 files
[227.40s]**; zero `(fail)` lines.
- The base floor, DIRECTLY re-measured (not trusted from the R30-B claim) on an
  isolated worktree at `main @ 54e0e4f`: **5165 pass / 1 skip / 0 fail — 5166
  tests across 294 files [226.28s]**. 5165 + 23 = 5188 ✓ — zero regressions by
  arithmetic AND by the zero-fail run.
- The honest skip unchanged: the R11 webtorrent native-prebuilt environment skip
  (the pre-existing 1).
- The +23: `apps/web/tests/gap-theme-picker.test.ts` (14 — §G1: the grammar
  module's captured option set + the stored-truth read/write laws incl. the
  device write's null + the round trip + the state labels + the device
  derivation; the picker panel's header/back-arrow-icon/subtext/3-rows-in-order/
  check-in-box-selected-state/persisted-states; the root row's activation join +
  the language row's unchanged state form) + `apps/web/tests/subscriptions-feed.test.ts`
  (9 — §G2: the stored-truth flow through the REAL subscribe seam; the card
  grammar + the rail-rows' route law; the multi-card grid with the
  no-fabricated-meta guards; the UNLINKED law; the empty state; the
  presentation-route law + the deep-link sync; the rail heading seam + the
  signed-out control).
- Every pre-existing suite green (the scoped re-run of the seven
  changed-surface suites — account-chrome, playlist-family,
  subscribe-reload-durability, adapter-surfaces, shorts-parity,
  discovery-surface, surface-routing — 99/99 before the full runs).

### 7. parity-conformance — PASS (stays CONFORMANT)
19/19 — the parity suite stays CONFORMANT, exactly the R29/R30-A gate. The
lane's CSS additions are additive (the picker block + the subsfeed grid block +
the rail heading-link style; the parity-pinned tokens untouched).

### 8. build — PASS
The full Next.js 16 (Turbopack) production build: every route compiles incl.
the seam's new route (`ƒ /feed/subscriptions` — Dynamic, server-rendered on
demand, exactly the force-dynamic feed-surface law).

### 9. browser-verify — PASS (the R30-B BLK row does NOT reproduce here)
This sandbox's dev server boots cleanly (HTTP 200; the R30-B record's
OOM-kill class does not reproduce), so the browser-level golden paths were
proven live with agent-browser @1440×900 — the full report:
`browser-verification.md` (§G1: the menu → the Appearance row → the picker's
captured grammar at the measured 300×40/40px-pitch geometry → the Dark
write-through (dataset + storage + meta) → the back-arrow label update → the
device write's stored-choice removal + the live OS-preference application;
§G2: the real Subscribe pill write → the feed's honest empty state → the
cold-boot UNLINKED card (the Library's own law) → the connector-read join →
the LINKED card's player click-through; zero page errors; the 390px
single-column responsive law). The evidence screenshots: `captures/browser-*.png`.

---

## THE FIX WAVE (the §G1 marker adjudication — gates re-run on the fix tree)

The lead's REQUIRE-CHANGES review (08:07Z) adjudicated ledger row 1: the
capture is the contract — the captured DOM's selected-row icon carries a
SINGLE check path ("M19.793 5.793 8.5 17.086l-4.293-4.293a1 1 0 10-1.414
1.414L8.5 19.914 21.207 7.207a1 1 0 10-1.414-1.414Z"), no rect anywhere
in the 83KB picker HTML; the "check-in-box" corpus prose was the
capture-time over-interpretation. The fix: the bare `check` glyph ships,
the lane-new `checkBox` icon removed, the tests flipped, the corpus
erratum written, the ledger row resolved, the probe regenerated.

| # | Stage | Command | Result |
|---|-------|---------|--------|
| F1 | scoped suites | `bun test apps/web/tests/gap-theme-picker.test.ts apps/web/tests/subscriptions-feed.test.ts` | PASS — 23/0/0, 104 expects (the flipped marker grammar: check path PRESENT, `<rect>` ABSENT, `<circle>` NEVER) |
| F2 | typecheck | `bun run typecheck` + `tsc --noEmit -p apps/web/tsconfig.json` | PASS (root + journeys + app: zero diagnostics) |
| F3 | scoped lint | `bunx eslint` on the fix's 5 lintable files | 0 errors / 0 warnings |
| F4 | battery | `nice -n 19 ionice -c3 bun test --parallel=1` | **PASS: 5188/1/0** — 5189 tests, 296 files [226.51s]; 33384 expects (+3: the flipped assertions); zero regressions |
| F5 | build | `NODE_OPTIONS=--max-old-space-size=2048 bun run --filter '@wfx/app-web' build` | PASS — "✓ Compiled successfully in 3.8s", `ƒ /feed/subscriptions`, exit 0 |
| F6 | probe regen | `WFX_DEV_FIXTURES=1 bun apps/web/scripts/r31-gap-probe.ts` | PASS — 8 captures + probe-facts.json regenerated from ONE run: 02/03 now carry the bare check (check path present, zero `<rect>`); 04/06/07 refresh the fixture transport's per-run item IDs/hues (same 3 subscribed items, same card grammar — the fixture identity law); 00/01/05 byte-stable |

The pre-fix gate records above stand as the history of the first tree;
this section is the fix tree's own record. The browser PNGs
(`captures/browser-*.png`) are pre-fix records — superseded on the marker
question only (ledger row 1); every other proof they carry (geometry,
write-throughs, the §G2 golden paths) is unchanged by the glyph swap.
