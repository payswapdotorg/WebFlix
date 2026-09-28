# R36 lane worklog — creator channels end-to-end

Lane: `wfx/r36/channels` · Base: `main @ 8937bb8` · Repo: /home/z/webflix-r36 (clone of payswapdotorg/webflix)

## Survey notes (step zero — the seams this lane builds on)

- The survey rows: 17 (channel pages — the #1 gap), 18 (search channel results), 10 (subscribe from
  watch — landed; the channel page composes it), 19 (bell — the per-channel preference record).
- The R33-C sourceNames law: `sourceNamesOf(host)` in `apps/web/src/host/view-models.ts`
  (connectorId → displayName, connector-id fallback, never a fabricated name). The monogram avatar
  law: first mark of the honest name (ChannelRow, result avatar, rail subs).
- The subscription machinery: `SUBSCRIPTIONS_LIST = "Subscriptions"` frozen name
  (`apps/web/src/components/player/subscription-list.ts`); the pill writes POST /api/library
  (op save/remove, itemId + listName); the Library's Playlists section + the rail subs + the
  /feed/subscriptions grid all read the SAME fold (R30-A hydrate seam). Subscriptions are
  ITEM-keyed (the rail row = the item's own title) — the channel page's pill therefore writes the
  channel's REPRESENTATIVE item (the first item of the channel's own discovery order) and the
  channel's subscribed truth is the CONNECTOR-scoped read of the same list. ONE store, one write path.
- The catalog model: the item join (`view-models.ts` — learned from the runtime's own search/shorts
  hits; artwork via `contentArtworkOf` metadata seam `thumbnailUrl`); the fixture catalog
  (`packages/experience/src/fixtures.ts`): 9 items on `fake-source`, displayName
  "Fake Source (TEST FIXTURE — never production)", no artwork, no dates, no counts.
- The search surface: `loadSearchView` (typed statuses, token recovery, honest filters); the
  SearchFilters honest-subset law (only options with real backing).
- Item metadata seam: YouTube connector (service mode) carries `publishedAt`/`viewCount` in item
  metadata; fixture items carry none ⇒ the Videos-tab sort options derive HONESTLY (Latest/Oldest
  only when items declare dates; Popular only when a popularity metric is declared; else the
  channel's own feed order + the honest-absence note).
- Journeys: the runner registry (`journeys/web/index.ts`), the integrity test pins the encoded set
  J01–J34+J36–J43 (41). NUMBERING COLLISION FOUND: the survey's "new J43 (channel round trip)"
  collides with the R25-W2 realtime-translation J43 (encoded at base). Resolution: the channel
  journey is encoded as **J44** (the next free catalog number); renaming the accepted R25 journey
  would regress its acceptance record and requires docs/ edits outside this lane's allowed paths.
  Documented in evidence/r36/ + the completion report.
- The channel page is a PRESENTATION ROUTE (the /player + /feed/subscriptions law): the frozen
  SurfaceId set is untouched; `deriveNavigationState` grows the `/channel` prefix in its
  presentation-route list.
- Card link-in: HTML forbids nested anchors — the corpus-true restructure is YouTube's own
  stretched-link pattern (the card visual becomes a span; ONE play anchor stretches over the
  lockup via ::after; the channel slot is its own real link above it). `a[data-wfx-card]` +
  aria-label stay EXACTLY ONE per card (the journeys' finder + count assertions hold).

## Progress log

- [x] Survey complete (the seams above)
- [x] The channel entity (host/channel-views.ts) — the derivation law + the typed-absence set
- [x] The channel page route (/channel/[handle]) + ChannelSurface (banner/avatar/tabs/search)
- [x] The tabs — Home (continue-watching first), Videos (+ the honest sort availability), Shorts (the eligibility split, linking into /shorts), Playlists (the library's scoped named lists, typed-empty), About (the honest truths)
- [x] The engagement island — the ONE-store Subscribe (the connector-scoped truth + the representative item) + the bell's persisted record
- [x] The link-in laws — the cards' stretched-link pattern (one a[data-wfx-card] per card intact), the watch ChannelRow, the shorts row
- [x] The search channel-results section (the honest matching law; empty = absent)
- [x] The routing presentation-route class + the href law
- [x] The 32 lane tests — PASS on the lane, FAIL on main (proven on an isolated base worktree)
- [x] J44 (encoded as J44 — the survey's "J43" collision with the R25-W2 realtime-translation journey documented) — PASS 57 assertions
- [x] The fix round: the unsubscribe/subscription-read bridge law (the source-key resolution — the R30 reload-durability lesson applied to the channel surface)
- [x] Guards: install/lint(lane-clean)/typecheck/battery(5287/1/0 vs base 5255/1/0)/contract-check/lane-check/parity-conformance(19/19)/build(exit 0)
- [x] Affected journeys re-run on BOTH trees — identical verdicts (zero regressions; the failures are the documented stale-grammar debt)
- [x] Evidence (guards/browser-verification/measured-facts/DIVERGENCES/INDEX)
- [x] The bundle + the relay (see the completion report)

## The final state

Lane head `87926416b40c9e004df4978156f36cecc1981094` (the final worklog commit; the code head `084be57` + the evidence commits). All gates green. See INDEX.md for the map.
