# R31 — PARTIAL RESULTS (the re-entry ledger)

Lane: `wfx/r31/gaps` (base: `main @ 54e0e4f` — the R31 gap-corpus merge).
Task: the two corpus-pending surfaces — §G1 the theme-picker submenu, §G2 the
subscriptions-feed grid (GAP-CORPUS.md,
docs/parity-lab/r30/gap-captures/20260926-052954/). The two still-pending gaps
(home resume bar, shorts action rail) are NOT built.

## Status: COMPLETE — all gates green on the final tree; the push is the only remaining step

## What is DONE (the full record)

1. **STEP ZERO** — repo cloned, main @ 54e0e4f checked out, branch
   `wfx/r31/gaps` created. GAP-CORPUS.md read fully + the two prior corpus
   docs + the seams surveyed.
2. **Corpus re-verification** — both JPGs VLM-read; the check-in-box
   observation recorded (DIVERGENCES.md row 1: the binding corpus finding
   followed; the fresh VLM + pixel read of the raw jpg reads a bare
   checkmark).
3. **§G1 SHIPPED** — theme-picker-grammar.ts (NEW, the pure laws) + Icon.tsx
   (+checkBox) + AccountMenu.tsx (the row activation, the appearance page,
   AppearancePickerPanel, writeThemeState) + globals.css (the picker block) +
   the two honest call-site updates (account-chrome.test.ts,
   r30-account-chrome-probe.ts).
4. **§G2 SHIPPED** — app/feed/subscriptions/page.tsx + loading.tsx (NEW, the
   presentation route) + SubscriptionsFeedSurface.tsx (NEW) + routing.ts (the
   presentation-route list) + RailSubscriptions.tsx (the heading link — the
   taxonomy join) + globals.css (the subsfeed grid block).
5. **TESTS** — 23 new (gap-theme-picker 14 + subscriptions-feed 9), all green;
   the pre-existing suites green (the seven changed-surface suites 99/99 in
   the scoped re-run).
6. **PROBE** — r31-gap-probe.ts: 8 SSR captures + probe-facts.json.
7. **BROWSER-LEVEL VERIFICATION** (LIVE — the R30-B BLK row does not
   reproduce here): the §G1 golden path (menu → row → picker at the measured
   300×40/40px pitch → the Dark write-through {theme/stored/meta} → the
   back-arrow label update → the device write {stored:null + the live OS
   preference}) + the §G2 golden path (the real Subscribe pill → the feed's
   empty state → the cold-boot UNLINKED card (the Library's own law, verified
   side by side) → the connector-read join → the LINKED card's player
   click-through) + the responsive law (1 col @390px) + zero page errors.
   browser-verification.md + captures/browser-*.png.
8. **GATES (all on the final tree — guards.md carries every output)**:
   - install: 618 packages, frozen lockfile ✓
   - lint: repo 115 = base byte-identical; the lane's files scoped 0/0 ✓
   - typecheck: root + journeys + app ✓
   - battery: **5188/1/0** (296 files) — the base floor **5165/1/0**
     (294 files, directly re-measured on the isolated base worktree
     /home/z/webflix-base) + exactly the 23 new; zero regressions ✓
   - contract-check: OK (12 frozen blocks) ✓
   - lane-check: OK (939 files) ✓
   - parity-conformance: 19/19 ✓
   - build --filter web: exit 0, `ƒ /feed/subscriptions` compiled ✓
9. **EVIDENCE** — evidence/r31/: INDEX.md (the corpus-citation table),
   DIVERGENCES.md (13 rows incl. the two PEND gaps), guards.md,
   browser-verification.md, partial-results.md (this file), captures/ (8 SSR
   HTML + 4 browser PNGs) + probe-facts.json.

## What REMAINS

- The commit + push of `wfx/r31/gaps` (the full message; the gates output
  already pasted in guards.md) + the completion report to the lead.

## Notes for re-entry (if the push stalls)

- The lane tree: `/home/z/webflix` (branch `wfx/r31/gaps`, all changes in the
  working tree, uncommitted until the push step).
- The isolated base worktree `/home/z/webflix-base` (at 54e0e4f) exists for
  the floor comparison; it can be removed after the push
  (`git worktree remove /home/z/webflix-base` from the lane tree).
- The R30-B probe re-ran clean on the final tree (its captures restored
  frozen — the R30-B round's own record).
