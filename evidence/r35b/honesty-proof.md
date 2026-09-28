# R35b — The Honesty Proof (M5)

**The law under test:** a re-encoded spec must still FAIL if its contract
regresses (the re-encode changed the BINDING, never the teeth). For each
of the three representative classes, the product's grammar element was
REGRESSED on a throwaway scratch worktree (a product-code mutation that
simulates exactly the stale-grammar return the re-encode guards against
— never on the lane; `git diff main --stat` proves the lane carries ZERO
product bytes), and both specs ran against it:

- the **re-encoded** spec (the lane's) — must FAIL on the regressed
  grammar (the teeth), and PASS on the current tree (the M4 record);
- the **pre-existing** spec (the base `acff71b8b363` encoding) — must
  PASS on the regressed grammar wherever that grammar IS the base
  spec's own binding (the proof the re-encode tracked the product's
  real evolution, not a relaxation), and FAIL on the current tree (the
  M1/R34-C record).

The scratch worktrees were destroyed after the proofs (`git worktree
remove --force`; the mutations exist nowhere in the delivered tree).

## 1. The R28-B class — J06 (the one-click card grammar)

**The mutation** (scratch tree, `apps/web/src/components/cards/ItemCard.tsx`):
the card's `playHref` was reverted from the R28-B one-click
`playerHref(…)` to the pre-R28-B `itemDetailHref(…)` — the simulated
regression: "the cards stop linking the player; the detail page is the
primary link again".

| Run | Tree | Verdict | The exact assertion |
|---|---|---|---|
| Re-encoded J06 | regressed (cards → `/item`) | **FAIL** | `the home card's primary link is the one-click play path (the R28-B grammar)` — expected `an id-first /player href`, observed `/item?id=wfxitm_…&title=Asteroid+Drift…` (1 assertion in, fail-fast) |
| Base J06 | regressed (cards → `/item`) | **PASS** | the base encoding navigated the card's `/item` href onto the item surface and every detail assertion held (the old binding) |
| Base J06 | current (un-regressed) | **FAIL** | the M1 record: `[data-wfx-surface='item']` 0 — the card landed on `/player` (the R34-C adjudication's own local column) |
| Re-encoded J06 | current | **PASS** | the M4 full-suite record (evidence/r35b/run/manifest.json, J06) |

The re-encoded spec binds the CURRENT one-click grammar and fails the
moment it regresses — teeth preserved, assertion-for-assertion (the
item-surface assertions beyond the first are identical to the base
encoding's; the path to them is what the re-encode tracked).

## 2. The R29-B/rail class — J01 (the shell navigation grammar)

**The mutation** (scratch tree, `apps/web/src/components/shell/AppShell.tsx`
+ `apps/web/src/components/home/HomeSurface.tsx`): the rail and bottom nav
were reverted to the pre-R29/J01-era 6×2 set (Home · Watch · Shorts ·
Search · Library · Settings, twice — the You-group links and the rail
sign-in promo removed) and the pre-R28-B home hero was restored above the
chip bar — the simulated regression: "the shell returns to the J01-era
navigation and the hero returns to Home".

| Run | Tree | Verdict | The exact assertion |
|---|---|---|---|
| Re-encoded J01 | regressed (6×2 nav + hero) | **FAIL** | `the navigation landmarks expose the current rail grammar (desktop rail 9 + mobile bar 4)` — expected `nav a matches exactly 13`, observed `12 matching element(s)` (2 assertions in, fail-fast; the Subscriptions/You-group/chip-bar assertions behind it would fail in turn) |
| Base J01 | regressed (6×2 nav + hero) | **PASS** | the base encoding's 12-link/6-label × 2 + hero expectations all held (the old binding) |
| Base J01 | current | **FAIL** | the M1 record: `nav a` 13 vs 12 (the R34-C adjudication's own local column) |
| Re-encoded J01 | current | **PASS** | the M4 full-suite record |

## 3. The production-only class — J04 (the position-pill grammar)

**The mutation** (scratch tree, `apps/web/src/components/shorts/ShortsFeed.tsx`):
the position pill's `{position}` was replaced with the hardcoded fixture
page size `{"1 / 3"}` — the simulated regression: "the pill stops
reporting the composed page's own position and freezes at the fixture
count" (exactly the stale binding the R34-C production sweep caught:
"1 / 3" expected vs the real "1 / 24").

| Run | Surface | Verdict | The exact assertion |
|---|---|---|---|
| Re-encoded J04 | regressed (the frozen "1 / 3" pill) | **FAIL** | `a forward skip advances the feed position (the pill's N advances within the same page)` — expected `position 1 → 2`, observed `1 / 3` (9 assertions in, fail-fast — the initial well-formed-pill check passed, the ADVANCE caught the freeze) |
| Re-encoded J04 | the regressed tree, mutation reverted | **PASS** | the same scratch tree after `git checkout` of the mutation (the control run — the fail was the mutation's, never a flake) |
| Base J04 | the fixtures boot (current) | **PASS** | the base encoding's "1 / 3" binding held on the fixtures boot (the R34-C §B record: J04's local pass) |
| Base J04 | LIVE PRODUCTION | **FAIL** | the R34-C record (run/chunk-01/manifest.json): `textEquals "[data-wfx-shorts-position]" "1 / 3"` — observed `"1 / 24"` (the fixture page-size binding cannot hold on the real catalog) |
| Re-encoded J04 | LIVE PRODUCTION | **PASS** | the M3 live verification (evidence/r35b/prod-check/): the pill-grammar assertions held on `https://webflix-steel.vercel.app` ("1 / 24" → next "2 / 24" → back "1 / 24") |

The re-encoded spec holds on BOTH boots (the fixtures 3-card page and
the production 24-card page — the grammar, not the count) and fails the
moment the pill stops tracking the surface's own truth.

## The conclusion

Each re-encoded spec: (a) asserts the same user-visible intent the
original tracked (the same surfaces, the same state laws — the paths and
bindings tracked the grammar's own evolution), (b) binds the CURRENT
grammar element (cited at each changed assertion), and (c) FAILS when
that contract regresses — proven by the exact mutations and failing
assertions above. Nothing was relaxed, deleted, or wrapped in try/catch;
no journey's check strength was weakened.
