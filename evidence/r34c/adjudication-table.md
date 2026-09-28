# R34-C — The Adjudication Table (every non-pass, honestly classified)

The law: every verdict cites its run artifact (the chunk manifest + the
failure captures); a failure is a failure; classifications are evidence-based.

**Classification key:**
- **REGRESSION** — worked at the R23 record, fails now, moved by a code wave.
- **ENVIRONMENTAL** — the provider/network/shared-state truth blocks the check; the product behaves correctly.
- **STALE-GRAMMAR** — the journey spec binds a grammar/catalog/config that the product truth has since superseded (the J01 precedent, D5's ruling); the product surface is correct per the operator-directed corpus.
- **HONEST-DIVERGENCE** — the product truth changed by recorded law.

Wave shorthands: R28-B `1d32ed8` (HOME RESTRUCTURE — hero moved to Settings,
ONE-CLICK PLAY card→player, /item demoted to Details deep action); R29-B
`01dc579`/`b852d97` (masthead chrome + rail grammar); R30-B `eb52685`
(account-chrome family, Playlists row); R31/R33-B `7661a17` (feed +
Subscriptions entry remap); R24-W2 `078dd70` (player chrome/composition,
startup-law reorder); R33-A `09d0205` (shorts media stage).

---

## The four PASS verdicts (production)

| J | Evidence |
|---|---|
| J03 | `run/chunk-01/manifest.json` — 6 assertions green (watch browse rows/cards/channel truth on the live surface) |
| J13 | `run/chunk-03/manifest.json` — 5 assertions green (account/profile/identity lifecycle on production) |
| J18 | `run/chunk-04/manifest.json` — 4 assertions green (attention-mode threshold behavior) |
| J19 | `run/chunk-04/manifest.json` — 11 assertions green (Model & AI policy surfaces on production) |

---

## The 34 non-pass verdicts

### A. Tree-level stale-grammar (fails on production AND on the current tree's own fixtures boot — the spec pre-dates the product evolution; NOT an R31/R32/R33 regression)

| J | First-failing assertion (prod / local) | Root cause (evidence) | Wave | Class |
|---|---|---|---|---|
| J01 | nav `a` count 13 vs 12 (both) | The corpus rail grammar evolved: R29-B's rail (History `b852d97`/`01dc579`), R30-B's Playlists row (`eb52685`), R31 feed + R33-B D6 Subscriptions binding (`7661a17`) — current DOM: desktop rail 9 links + mobile bar 4 = 13 (prod HTML parsed; `run/chunk-01/j01-failure.png`). The journey binds the pre-R27/R29 6×2 set. | R29-B→R33-B (multi-wave rail evolution) | STALE-GRAMMAR |
| J02 | `data-wfx-hero="start"` attribute absent (both) | R28-B `1d32ed8`: "HOME RESTRUCTURE — chip bar + rows immediately; hero + feed config moved to Settings→General". `data-wfx-hero` has ZERO occurrences in the current tree (`grep -rln data-wfx-hero apps/web/src` → empty) and zero in the production home HTML. | R28-B | STALE-GRAMMAR |
| J05 | prod: 19 rain cards vs 3 expected; local: 0/3 cards link `/item` | (a) catalog-bound count — the production catalog carries 19 real rain titles, the fixtures catalog 3; (b) R28-B one-click play: cards link `/player…` not `/item…` (prod HTML + local manifest). | R28-B + catalog truth | STALE-GRAMMAR |
| J06 | prod: "Asteroid Drift" card absent; local: `[data-wfx-surface='item']` 0 | Fixtures scripted-acquisition item absent on production (catalog-bound); on the tree, R28-B's /item demotion changed the detail-surface path the journey drives. | R28-B + catalog | STALE-GRAMMAR |
| J07 | prod: Harbor Lights search absent; local: play href absent on detail | Fixtures catalog item; the detail→play decision path changed with R28-B's one-click restructure. | R28-B + catalog | STALE-GRAMMAR |
| J08 | prod: browser-realized item absent; local: play href absent | Same class as J07. | R28-B + catalog | STALE-GRAMMAR |
| J09 | prod: multi-realization item absent; local: `[data-wfx-precedence-trace]` 0 | Fixtures item; the player's fallback-decision trace grammar moved with the R24-W2/R28-B player composition (enrichments ride after the media path). | R24-W2/R28-B + catalog | STALE-GRAMMAR |
| J10 | prod: the item absent; local: typed-absent markers not on player | Fixtures item; `ActionButtons` (which renders `data-wfx-action-absent`) is mounted ONLY on `ItemDetailSurface` in the current tree (`grep -rln ActionButtons`) — the player's like/save affordances moved with R28-B's player restructure. | R28-B + catalog | STALE-GRAMMAR |
| J12 | prod: the item absent; local: play href absent | Same as J07/J12's class (catalog + /item→/player). | R28-B + catalog | STALE-GRAMMAR |
| J17 | prod: 'harbor' → 0 results; local: hero absent | Prod: fixtures catalog item; local: the R28-B hero (see J02). | R28-B + catalog | STALE-GRAMMAR |
| J20 | prod: "Asteroid Drift" absent; local: `[data-wfx-ai-tray-surface='player']` 0 | Catalog-bound on prod; on the tree the player's AI tray renders as a STREAMED enrichment section (`PlayerSurface.tsx` `AiTraySection`) whose model renders empty in the journey's driven path — the R24-W2 startup-law reorder + R28-B player composition. | R24-W2/R28-B + catalog | STALE-GRAMMAR |
| J21 | prod: scripted acquisition item absent; local: provenance line `<none>` | Catalog-bound on prod; the acquisition panel's diagnostics vocabulary changed with the item-surface demotion era (AcquisitionPanel now mounted on `ItemDetailSurface`/`TorrentPlaybackStage`). | R28-B era + catalog | STALE-GRAMMAR |
| J22 | preparing state `<none>` (both) | The scripted acquisition's state grammar changed (same mount-path root cause as J21). | R28-B era + catalog | STALE-GRAMMAR |
| J23 | harness: `[data-wfx-acquisition-action='advance']` element not found (both) | The acquisition ADVANCE control no longer renders in the journey's driven surface (AcquisitionActions mounts inside AcquisitionPanel/TorrentPlaybackStage — the driven path changed). | R28-B era | STALE-GRAMMAR |
| J24 | same as J23 (both) | Cascade of J23's root cause. | R28-B era | STALE-GRAMMAR |
| J25 | prod: interrupted-acquisition item absent; local: `data-wfx-acquisition-state="failed"` attr absent | Catalog-bound on prod; the failed-state grammar changed on the tree (same mount-path root cause). | R28-B era + catalog | STALE-GRAMMAR |
| J26 | prod: 0 offline entries vs 2; local: 1 vs 2 | Prod: no fixture acquisition seed exists; local: the J24-earned copy never landed (J23/J24 cascade — the seed's verified Harbor Lights renders alone). | cascade (R28-B era) | STALE-GRAMMAR |
| J27 | prod: unscripted item absent; local: `[data-wfx-acquisition-none]` 0 | Catalog-bound on prod; the no-session panel grammar moved with the acquisition mount-path change. | R28-B era + catalog | STALE-GRAMMAR |
| J28 | prod: the item absent; local: player link absent on item | Catalog + the /item play-decision path change (R28-B). | R28-B + catalog | STALE-GRAMMAR |
| J29 | prod: network-loss item absent; local: harness — `[data-wfx-acquisition-action='acquire']` not found | Catalog-bound on prod; the acquire control's surface moved on the tree (same acquisition mount-path root cause). | R28-B era + catalog | STALE-GRAMMAR |
| J30 | typed absent notes not on player (both) | `ActionButtons`/`data-wfx-action-absent` now mount on the ITEM surface only (component-mount grep) — the player's capability-honesty grammar moved with R28-B's restructure. | R28-B | STALE-GRAMMAR |
| J31 | prod: canonical item link absent; local: detail identity absent | The search card now links `/player` (id-first in the player href); the journey's `/item?id=` anchor grammar changed with R28-B. | R28-B + catalog | STALE-GRAMMAR |
| J32 | `/item?id=wfxitm_…` link absent (both) | R28-B one-click play: cards link `/player…` (the canonical identity rides the player URL's id param). | R28-B | STALE-GRAMMAR |
| J34 | `[data-wfx-source-connect-cta]` 0 (both) | `SourceStrip` (the CTA's component) is mounted ONLY on `DiscoveryHeader` (watch/shorts surfaces), not Home — the R28-B home restructure removed the home mount the journey binds. | R28-B | STALE-GRAMMAR |
| J36 | prod: byof source card 0; local: `[data-wfx-feed-mode-option]` 0 | Prod: no fixture BYOF source (the production BYOF requires real provider credentials — the service-mode procedure); local: R28-B moved feed config to Settings→General (`FeedModeControl` mounts on `SettingsSurface`/`DiscoveryHeader`). | R28-B + config | STALE-GRAMMAR |
| J37 | prod: public title search absent; local: `[data-wfx-session-label]` absent | Prod: the fixtures "public title" absent in the real catalog; local: the session-label/menu grammar moved with R29-B's masthead chrome (`AppShell.tsx` history: `01dc579`, `eb52685`). | R29-B + catalog | STALE-GRAMMAR |

### B. Production-only stale bindings (passes on the current tree's fixtures boot; the production failure is a fixtures-catalog / service-mode config binding — the product truth was verified green by the R23 production sweep and stands)

| J | First-failing assertion (prod only — local PASSES) | Root cause (evidence) | Class |
|---|---|---|---|
| J04 | position "1 / 24" vs "1 / 3" | The journey hardcodes the FIXTURES shorts page size (3); the production page composes 24 real cards. The position-pill grammar itself works ("1 / 24" renders — `run/chunk-01/j04-failure.png` + snapshot). Local: 13 assertions PASS on the R33-A-changed surface — **the shorts media stage did NOT regress the journey**. | STALE-GRAMMAR (fixture page-size binding) |
| J14 | `[data-wfx-source='fake-source']` card absent | The fixtures' fake-source card cannot exist on production: the anonymous sources read answers the honest `{"authenticated":false,"sources":[]}` envelope (probed live). The production source-chooser surface was verified green by the R23 production sweep (7 markers, evidence/r23/production-sweep.md). | STALE-GRAMMAR (fixtures-source binding) |
| J15 | note "applied 16 replacement(s); 8 slot(s) kept" fails the `includes("replaced"/"runway"/"re-rank")` predicate | The service-mode composition note uses different wording than the fixtures boot's note (which passes locally — 6 assertions green). The production note DOES name the replacement semantics; the predicate binds the fixtures wording. First-production-run discovery (the suite has no prior production record — the R23 38/38 was the fixtures boot). | STALE-GRAMMAR (service-vs-fixtures wording) |
| J16 | note lacks "runway" (same note as J15) | Same root cause as J15 (the predicate requires "runway"; the service note says "slot(s) kept"). Local passes (4 assertions). | STALE-GRAMMAR (same) |
| J33 | "the BYOF drive state resets to pristine" — the journey's own dev-reset POST fails | The journey's determinism pre-step POSTs to a fixtures-mode dev drive route that production honestly does not serve (the service-mode BYOF requires real provider credentials — the documented local-only procedure). Local: the FULL J33 flow passes (62 assertions — the R20 composition is intact on the tree). | STALE-GRAMMAR (fixtures-only dev route) |
| J38 | peer-copy title search absent | The fixtures catalog carries the scripted torrent-realized item; the production catalog carries no torrent realization — the R23 production sweep verified the honest where-to-watch grouping + the Desktop-next-step state live (evidence/r23/production-sweep.md). Local: 42 assertions PASS. | STALE-GRAMMAR (fixtures torrent-catalog binding) |

### C. Environmental blocks (see environmental-blocks.md for the full evidence)

| J | Block | Class |
|---|---|---|
| J11 | The production anonymous identity's library carries a durable Saved entry (probed live: `GET /experience/library` with `x-wfx-user-id: wfx-anonymous` → 1 Saved entry, "1 HOUR Rainy Day in Airport", addedAt 2026-09-27T20:50:50Z). The runner's fresh-state resets operate on LOCAL fixture files and have NO effect on the shared persistent production store; the "honestly empty on a fresh session" grammar cannot hold there. The product itself is CORRECT (it renders the stored truth — 11 assertions PASS on the local fresh-state boot). | ENVIRONMENTAL |
| J39 | The production semantic-search transport answers its honest typed-unavailable state (the R23-H law: "never approximated"); the journey's meaning-search finds nothing on production. This is the STANDING R23 revalidation item (docs/work-items/index.md: "Current revalidation target: J39 semantic/moment search"). The fixtures double serves the deterministic search (local run reaches the session-label assertion). | ENVIRONMENTAL (the standing R23 revalidation lane) |

---

## The explicit no-regression findings (the acceptance-critical negatives)

1. **No R31/R32/R33-A/B/C regression found.** Every failing verdict's root
   cause predates R31 (predominantly R28-B `1d32ed8` and the R29-B/R30-B
   shell waves) or is a catalog/config/environmental binding. The R33 waves'
   own touched surfaces are covered by green evidence: J04 (the R33-A shorts
   surface) passes locally; J03/J13/J18/J19 pass on production itself; the
   R33-B rail binding and the R33-C channel-slot seam broke no journey
   assertion (no journey binds the nav href set or the channel-slot display
   name — J02's later "no source branding in title line" assertion would
   still pass behind the chip law).
2. **Zero verdict flakes**: 34/34 non-pass verdicts reproduced on the
   re-run sweep — 33/34 with the identical first-failing assertion;
   **J36's re-run is the one recorded failure-mode divergence** (an earlier
   browser-harness wait timeout — `[data-wfx-session-signed-in]` at 25s —
   instead of the run-of-record BYOF assertion; the FAIL verdict is stable
   either way, and the run-of-record failure remains the adjudicated basis;
   mechanically verified in `run/consolidated-manifest.json`). The R27-era
   flaky list — J02/J11/J25/J33/J39/J43 flaky, J01/J36 stale — is superseded
   on the current tree by this run's stable verdicts; the flakiness was the
   pre-R28 fixtures-boot non-determinism.
3. **No HONEST-DIVERGENCE verdict needed**: no product behavior changed by a
   law between the R23 record and now in a way the journey suite separately
   encodes (the corpus-directed grammar changes are recorded from the
   journey side as stale-grammar — the same facts, honestly labeled).

## What each finding needs (recorded, NOT applied — outside this lane)

- **A journey-spec update work item** (the J01-precedent procedure, D5's
  ruling): re-encode the 32 stale-grammar journeys (26 tree-level §A + 6
  production-only §B) against the current
  corpus-bound grammar (the R28-B card/player/one-click forms, the R29-B
  masthead/rail grammar, catalog-neutral selectors for the production run,
  the service-mode note wording) — journeys/*.ts updates are outside this
  lane's file scope.
- **An environmental retry window / state reset** for J11 (a clean anonymous
  identity or a catalog-neutral watchlist assertion).
- **The standing R23 revalidation lane** for J39 (the live semantic
  transport) — already tracked as the R23 revalidation target.
