# R29 PRODUCTION SWEEP — the divergences ledger

Every gap found while sweeping the merged set on **https://webflix-steel.vercel.app**
(production, main @ 1a3b594). Classes: `PAR` = parity · `COS` = cosmetic ·
`HD` = honest-divergence. A silent pass is worse than a loud fail; every verdict
cites evidence. **No REGRESSIONS vs the matrix's VERIFIED claims were found** —
none of the 21 verified rows is missing or broken on production.

1. **[PAR · LOUD] The Subscribe reload-durability split is LIVE on the production
   boot** (divergence 7's class, now production-confirmed). Subscribe → the REAL
   `/api/library` write → the Library page renders the Subscriptions list with the
   item (`probes/watch.json → subscribeClick/librarySubscriptions`), but a FRESH
   watch-page load renders the pill `idle` (`subscribeDurable.stateAfterReload:
   "idle"`), so a reload never carries the subscribed state, and an unsubscribe
   via `POST /api/library {op:"remove"}` returns `not-found` on a fresh load
   ("not in the local watchlist" — the client runtime's per-load map is empty).
   **This is NOT a regression**: C's own service-boot evidence at d92f5ff recorded
   the identical `idle` after reload (`evidence/r29-recon/b-d92f5ff-service-s1.s1probe.json
   → subscribeDurable`). The sweep RESOLVES the lead's open question (escalation:
   "a production-boot verification or a dev-graph unification would close it"):
   **the production boot does not close it either** — the split is in the app's
   read path (the watch page's SSR/client library read vs the API's stored truth),
   not the boot environment. The full subscribe→unsubscribe round-trip WAS proven
   live in a single view (`probes/watch.json → subscribeRoundTripCleanup`), and the
   session library was left clean.

2. **[HD] The honest chip set: 3 chips vs the corpus's ~10 + the sponsored row.**
   Production search carries exactly All/Videos/Shorts — the types the real sources
   carry — plus the corpus's sponsored row is honestly absent
   (`probes/search.json → chips.unbackedChips: []`). This is N23's VERIFIED
   honest-divergence class (only filters with a real truth behind them), not a
   defect. The VLM composite notes overstated this as "lacks the chips" — corrected
   by the DOM probe + the close-up crop (chips present: All active, Videos, Shorts,
   Filters button at right).

3. **[COS] The corpus home capture is an empty-state artifact.** `yt-home-1440.png`
   is a signed-out YouTube home showing "Try searching to get started" (no card
   grid), so `vs-home.light.png` compares an empty corpus against production's
   populated "For you" grid. The VLM verdict (DIVERGENT) records the composite as
   seen; the divergence is the corpus's, not production's. The supplementary
   `vs-home-loggedin.light.png` (the R28 lead's logged-in corpus) gives the
   populated-feed comparison: the corpus's subscriptions feed uses mixed rows and
   varied card sizes where WebFlix's real feed is a uniform 4-column grid — the
   honest feed-shape divergence.

4. **[COS] The action row is a content-sum — fresh-state widths measured.**
   Fresh browser state (no prior like): split pill **97×40** (icon-only like
   button 48×40), row **331×40**; with the count rendered (B's measured state):
   111×40 / 345×40. All are content-sums of honest content (Download honestly
   absent — the corpus 690 label-sum can never be reached without fabricating a
   Download control). Extends the matrix's divergence 1 with the production
   fresh-state numbers.

5. **[COS] The filters dialog height 308 vs the corpus 518** — the honest
   2-real-groups + absence-note content-sum (5 groups would fabricate 3). Width
   696 / r12 / shadow byte-exact. Reproduced on production (matrix divergence 2).

6. **[HD] The provider placeholder is the honest play state.** The provider's
   stream never loads in this environment; the player surfaces render the
   provider's own notice inside the stage, the chrome's play-state display stays
   `buffering`, and no playing state is ever fabricated (matrix divergence 6/10's
   class). The command paths still round-trip (every key POST 200 with exact
   deltas).

7. **[COS] `vs-player.dark.png` is theme-mismatched by construction** — no DARK
   watch corpus capture exists (yt-watch-1440.png is light), so the dark composite
   necessarily compares a light corpus against the dark production pane. The VLM's
   DIVERGENT note is that theme difference; the dark pane's geometry independently
   measures byte-exact (`probes/watch.json → watchRouteGeometry`).

8. **[HD] The rail taxonomy honest absences, production-confirmed.** Subscriptions /
   You-groups / Explore / More-from-YT / footer-links / location carry no real
   backing on this host and are probe-confirmed absent on production
   (`probes/home.json → rail.explore/moreFromYT/footer/locationChip: false`) —
   B's HOLD ledger's CORPUS-PENDING set, unchanged by the merge (matrix
   divergence 5).

9. **[HD] N29's home-card channel slot remains the connector-id truth** — home
   cards read "From wfx-experience-service" (the sources model carries no
   channel-name field; the never-fabricate law). The OPEN row's status is
   unchanged on production. (The WATCH-surface resolution remains verified —
   `probes/watch.json → channelRow.name: "wfx-experience-service"` at 16/500.)

10. **[HD] The mic is honestly absent on production** — no mic control in the
    masthead, and an instrumented click attempt produced `getUserMediaCalls: 0`
    (no speech transport ever invoked). Matches the OPEN row D3/N1 exactly: no
    decorative mic shipped, none claimed.

## Regressions

**NONE.** Every VERIFIED row of the R29 matrix (21/24) was reproduced live on
production with byte-exact geometry/anatomy/tokens wherever the corpus pins values,
interaction-level proofs for every wiring claim, and the honesty gates re-exercised.
The 3 OPEN rows remain honestly open, unchanged.
