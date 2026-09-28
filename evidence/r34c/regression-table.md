# R34-C — The Regression Table (vs the R23 acceptance record)

**The R23 record of comparison** (docs/work-items/index.md, accepted
2026-09-21): the web one-run of record **38/38 / 596 assertions** on the
fixtures boot @ the journeys manifest `8d6a528`, tree `main @ 7ee847c`
(pre-R24). The R23 production sweep (evidence/r23/production-sweep.md)
verified the production surfaces manually (a sweep, not the journey runner).

**Today's evidence:** the fixtures boot of the CURRENT tree (@ 09d0205,
post-R33) answers **11/38** (J03, J04, J11, J13, J14, J15, J16, J18, J19,
J33, J38); production answers **4/38** (J03, J13, J18, J19).

## The delta decomposition (every journey, R23 → now)

Legend: R23 = the fixtures-boot record. LOCAL = today's fixtures boot
(current tree). PROD = today's production run. Mover = the wave that changed
the journey's verdict, from the git-bisect evidence in adjudication-table.md.

| J | R23 | LOCAL | PROD | Mover (evidence) | Regression class |
|---|---|---|---|---|---|
| J01 | pass | fail | fail | R29-B rail grammar (`b852d97`/`01dc579`) + R30-B (`eb52685`) + R31/R33-B binding (`7661a17`) — nav 12→13 | journey-grammar drift (stale-grammar) |
| J02 | pass | fail | fail | R28-B `1d32ed8` (hero removed from Home) | stale-grammar |
| J03 | pass | pass | pass | — | NO regression |
| J04 | pass | pass | fail (page-size binding only) | production catalog truth (24-card page); R33-A did NOT regress it (local 13 assertions green) | stale-grammar (prod binding) |
| J05 | pass | fail | fail | R28-B `1d32ed8` (/item→/player links) | stale-grammar |
| J06 | pass | fail | fail | R28-B (/item demotion) + catalog | stale-grammar |
| J07 | pass | fail | fail | R28-B + catalog | stale-grammar |
| J08 | pass | fail | fail | R28-B + catalog | stale-grammar |
| J09 | pass | fail | fail | R24-W2 `078dd70`/R28-B player composition + catalog | stale-grammar |
| J10 | pass | fail | fail | R28-B (ActionButtons → item surface) + catalog | stale-grammar |
| J11 | pass | pass | fail | shared persistent production identity state (environmental) | environmental |
| J12 | pass | fail | fail | R28-B + catalog | stale-grammar |
| J13 | pass | pass | pass | — | NO regression |
| J14 | pass | pass | fail | fixtures-source binding (production sources honestly `[]`) | stale-grammar (prod binding) |
| J15 | pass | pass | fail | service-mode note wording vs fixtures wording | stale-grammar (prod binding) |
| J16 | pass | pass | fail | same as J15 | stale-grammar (prod binding) |
| J17 | pass | fail | fail | R28-B (hero) + catalog | stale-grammar |
| J18 | pass | pass | pass | — | NO regression |
| J19 | pass | pass | pass | — | NO regression |
| J20 | pass | fail | fail | R24-W2/R28-B (streamed AI-tray composition) + catalog | stale-grammar |
| J21 | pass | fail | fail | R28-B era acquisition mount-path + catalog | stale-grammar |
| J22 | pass | fail | fail | same | stale-grammar |
| J23 | pass | fail | fail | same (advance control surface) | stale-grammar |
| J24 | pass | fail | fail | cascade of J23 | stale-grammar |
| J25 | pass | fail | fail | same + catalog | stale-grammar |
| J26 | pass | fail | fail | cascade (J23/J24) + no fixture seed on prod | stale-grammar |
| J27 | pass | fail | fail | acquisition mount-path + catalog | stale-grammar |
| J28 | pass | fail | fail | R28-B + catalog | stale-grammar |
| J29 | pass | fail | fail | acquisition control surface + catalog | stale-grammar |
| J30 | pass | fail | fail | R28-B (typed-absent notes → item surface) | stale-grammar |
| J31 | pass | fail | fail | R28-B (player-first links) + catalog | stale-grammar |
| J32 | pass | fail | fail | R28-B (player-first links) | stale-grammar |
| J33 | pass | pass | fail | fixtures-only dev drive-reset route (production has none by design) | stale-grammar (prod binding) |
| J34 | pass | fail | fail | R28-B (home lost the SourceStrip mount) | stale-grammar |
| J36 | pass | fail | fail | R28-B (feed modes → Settings) + prod BYOF config | stale-grammar |
| J37 | pass | fail | fail | R29-B (masthead/session menu) + catalog | stale-grammar |
| J38 | pass | pass | fail | fixtures torrent-catalog item (production has none — R23 sweep verified the honest state) | stale-grammar (prod binding) |
| J39 | pass | fail | fail | the production semantic transport's honest typed-unavailable state (the standing R23 revalidation target; R23-H law: never approximated) | environmental |

## The regression verdict

**No real product regression.** The R23→now verdict deltas decompose
ENTIRELY into:

1. **Journey-grammar drift** (26 journeys — the §A set of
   adjudication-table.md: failing on the current tree's own fixtures boot): the
   operator-directed product evolution between R23 and R31 — predominantly
   **R28-B `1d32ed8`** (the
   home/item/player restructure: hero removal, one-click play, /item
   demotion, action affordances moving to the item surface) and the
   **R29-B/R30-B shell waves** (masthead chrome, rail grammar) — moved the
   product surfaces out from under journey specs that have not been
   re-encoded since. The product is correct per the corpus law of its era
   (every wave carries its own battery + parity + browser-verification
   evidence); the journeys are the stale side. **None of the deltas is
   attributable to R31, R32, or R33-A/B/C** — the named recent waves: their
   touched surfaces (shorts stage, shell rail entries, card channel slots)
   are covered by green evidence in THIS run (J04 local pass; J03/J13/J18/J19
   production passes; no journey binds the R33-B href remap or the R33-C
   channel-slot display name).
2. **Production-only stale bindings** (6 journeys: J04, J14, J15, J16, J33,
   J38 — the §B set; the catalog-count aspect inside J05's row is already
   counted in the drift group above): fixtures-catalog/page-size/wording/
   dev-route bindings
   that cannot hold against the real production catalog + service-mode
   config — the corresponding production truths were verified green by the
   R23 production sweep and remain standing.
3. **Environmental blocks** (2 journeys: J11 shared-state, J39 semantic
   transport) — see environmental-blocks.md.

**Tally: 26 + 6 + 2 = 34 non-pass verdicts** (the per-row table above is the
 count of record; mechanically cross-checked in `run/consolidated-manifest.json`).

**The battery confirms the no-code-change truth:** `bun test --parallel=1`
answers **5256/1/0** on this lane — IDENTICAL to main @ 09d0205.
