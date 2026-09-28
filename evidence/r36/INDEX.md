# R36 — INDEX (the lane's evidence map)

Lane: `wfx/r36/channels` · Base: `main @ 8937bb8` · Code head: `084be57` · Last substance commit: `7cf97c0` (the final-head re-verification addendum; the relay manifest names the shipping tip)
Scope: the survey's rows 17/18/10/19 — creator channel pages + tabs +
subscribe/bell + channel search results (docs/plans/
2026-09-28-youtube-parity-survey.md, WAVE R36).

| File | What it proves |
|---|---|
| `guards.md` | Every gate's command + result: install, the BASE-vs-LANE battery (5255/1/0 → 5287/1/0, exactly +32 lane tests, zero regressions), lane-clean lint, typecheck, contract-check, lane-check (955 files), parity-conformance (19/19 CONFORMANT), the web build (exit 0, /channel/[handle] dynamic), J44 PASS (57 assertions), the affected-journey base-vs-lane diff (identical verdicts — the stale-grammar debt, zero regressions), the lane-tests-fail-on-main proof |
| `browser-verification.md` | The walked browser evidence: J44's full round trip (the 8 stages, every assertion named) + the affected-journey attribution table |
| `measured-facts.md` | The lane's own numbers: the channel entity's honest fields, the handle law's derivations, the eligibility split, the in-channel search, the battery counts side-by-side, the bell record |
| `DIVERGENCES.md` | The honest-divergence ledger: 15 rows (3 survey rows CLOSED; the banner/avatar/subscriber-count/verified/handle/join-date/Community-tab/sort/bell-delivery/video-count/card-link/J44-numbering divergences, each with the frozen-law resolution) |
| `partial-results.md` | The step-zero survey (the seams this lane builds on) + the progress log |
| `journeys/` | J44's committed run: manifest.json (commit 084be57, the determinism record), summary.md, 5 screenshots + the snapshot + narration artifacts |
| `journeys-affected/` | The J01–J37 affected re-run on the lane (summary + manifest) |
| `journeys-affected-j30j40/` | The J30/J40 affected re-run on the lane |
| `j37-lane-solo/` | The J37 flake attribution's solo run — re-executed at the final head and committed: FAIL at exactly the base's assertion (7 assertions, 3 artifacts — the stale-grammar debt, not a lane regression) |
| ~~`journeys-j44-smoke/`~~ | NOT IN THE TREE — the J44 smoke runs during encoding, superseded by `journeys/` and pruned in the evidence commit `1209971`; the trail lives in the git history at `084be57`. (This row previously described the pruned files as kept — corrected by the final-head re-verification addendum in `guards.md`.) |
| ~~`battery-baseline-main.log`~~ | NOT RETAINED — the first base-battery attempt was truncated by the sandbox's background-process limit and the log was never committed; the completed base measurement (the isolated-worktree run, `guards.md` row 1) is the record. (This row previously described the file as present — corrected by the final-head re-verification addendum in `guards.md`.) |

## The lane's code (the review map)

| Path | What it is |
|---|---|
| `apps/web/src/app/channel/[handle]/page.tsx` + `loading.tsx` | The route (a presentation route — the /player law) |
| `apps/web/src/host/channel-views.ts` | THE CHANNEL ENTITY: the derivation law (handle/displayName/avatar/banner/description/links/connectedSince/subscriberCount/verified — every field honestly derived or typed-absent), the honest channel feed (the discovery seeds scoped to the connector), the sort availability, the connector-scoped subscription truth (the source-key resolution), the playlists scoping, the channel-results matching |
| `apps/web/src/components/channel/ChannelSurface.tsx` | The page grammar: banner/avatar/name/meta + the tab bar + the channel search + the five tabs' content (server component) |
| `apps/web/src/components/channel/ChannelEngagement.tsx` | The Subscribe pill (the ONE store) + the bell (the persisted per-channel preference record with the honest delivery note) |
| `apps/web/src/components/channel/ChannelInlineSubscribe.tsx` | The search channel-result row's inline Subscribe (the same one-store law) |
| `apps/web/src/app/href.ts` | `channelHandleOf` + `channelHrefOf` (the pure href law) |
| `apps/web/src/app/routing.ts` | The /channel/ presentation-route class + the re-exports |
| `apps/web/src/components/cards/ItemCard.tsx` | The stretched-link law (the card visual + ONE play anchor + the channel link above it; `a[data-wfx-card]` exactly one per card; the shorts variant's pinned grammar unchanged) |
| `apps/web/src/components/player/ChannelRow.tsx` | The watch row's identity link (additive; the R33-C seam unchanged) |
| `apps/web/src/components/shorts/ShortsSubscribeRow.tsx` | The shorts row's name link (additive) |
| `apps/web/src/components/search/SearchSurface.tsx` + `host/view-models.ts` | The channel-results section (the honest matching law; empty = absent) |
| `apps/web/src/app/globals.css` | The R36 block (the stretched link, the channel page, the channel-result rows — every value on the corpus token contract) |
| `apps/web/tests/r36-channels.test.ts` | The 32 lane tests (fail on main, pass on the lane) |
| `journeys/web/j44-creator-channels.ts` + `web/index.ts` + `report.test.ts` | J44 (the survey's WAVE R36 journey, encoded as J44 — the numbering collision documented) + the registry/integrity updates |

## Escalations

NONE. Zero shared-package changes (the lane-check proves it: 955 files, no
cross-lane private imports; the channel entity derives entirely from the
web app's own seams — the sources model, the item join, the library folds).

**The relay's log policy:** the `web-dev-server.log` files under
`evidence/r36/` are gitignored (the repo's global `*.log` rule — zero
`.log` files tracked under `evidence/` in the whole history); they ride the
RELAY only, not the bundle, and the manifest header says so.
