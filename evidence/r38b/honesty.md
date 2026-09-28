# R38-B — THE HONEST-ANALYTICS PROOF (every panel's backing or its typed absence)

**The binding law (the task packet, the R28 law extended):** "analytics
render ONLY what the real local transport carries. Reach/engagement/
audience panels show the LOCAL truth of the user's own real actions
(their own views, their own interactions — the local wallet law), and
every metric without honest backing renders the TYPED ABSENCE state —
never a fabricated chart, never a seeded number, never a fake axis."

Every panel of the studio's analytics surfaces
(`apps/web/src/components/studio/AnalyticsPanels.tsx`, composed through
`apps/web/src/host/studio-store/studio-analytics.ts`), mapped to its
backing. The typed-absence sentences are FROZEN (ANALYTICS_ABSENCE_NOTES,
studio-analytics.ts:62–74) and J48 asserts them live
(journeys/web/j48-studio-edit-customize.ts §8).

## 1. The backing map (per panel)

| Panel | Metric | Backing | The rendered truth |
|---|---|---|---|
| Reach (per video) | Impressions / views by others | **NONE — typed absence** | "No impression transport is connected on this host — WebFlix does not fabricate a reach number." Nothing on this host counts impressions: the fixture catalog declares no `viewCount` metadata (packages/experience/src/fixtures.ts:73–102 — `FakeCatalogItem` carries no such field; J44's own sort-absence assertion codifies it), and no ServerPort seam counts impressions. The absence is STRUCTURAL — `videoAnalyticsRowOf` answers it for every input, even an item with a declared `viewCount` (the lane test pins this: studio-analytics.test.ts "renders impressions as the STRUCTURAL typed absence"). |
| Reach (per video) | Your own view | **REAL** — the session's watch fold | The per-item resume truth (`positionMs`/`completionRatio`) from the runtime's own `getHome().continueWatching` seam — the SAME seam the channel page's Home tab joins (channel-views.ts:651–679). Absent watch ⇒ the honest sentence "Not watched by you yet — your own viewing is the one reach truth this panel carries." |
| Engagement (per video) | Comments | **REAL** — the `wfx-comments-v1` count | The same per-item count the watch surface's header renders (CommentsSection.tsx:383 — `comments.length`), read from the SAME store (studio-comments.ts). Loaded after mount (the hydration law); the panel renders "reading this device's record…" until loaded — never a pre-mount fabricated number. |
| Engagement (per video) | Your reaction | **REAL** — the `wfx-reactions-v1` record | This browser's own like/dislike (reactions-client.ts:52–54 — `readReaction`), the same record the watch page's split pill renders. No reaction ⇒ the honest absence sentence ("No reaction recorded by you on this device…"). |
| Engagement (per video) | Library saves | **REAL** — the runtime's library read | The named lists carrying the item (`runtime.library()` — the same seam the channel playlists and the Library render). No save ⇒ "Not saved in your library…". |
| Audience (channel + per video) | Subscriber count | **NONE — typed absence** | "This source declares no subscriber count — WebFlix never fabricates one." — the R36 law verbatim (channel-views.ts:459–462). |
| Audience (channel) | Your own subscription truth | **REAL** — the connector-scoped library read | The channel's `subscribed` truth from `loadChannelView` (the R36 derivation — the same read the channel page's pill renders). |
| Audience | Demographics / geography / age / returning-viewers | **NONE — typed absence** | "No audience-insights transport is connected on this host — WebFlix does not fabricate demographics." |
| Channel | Total comments / your reactions / your saves / your views | **REAL** — the sums of the per-video truths above | `channelAnalyticsOf` sums ONLY the real per-item truths (the lane test pins the sums and the untouched-record zeros — never seeded numbers). |

## 2. Why no chart renders

The surfaces render the absence cards (the sentence-bearing
`data-wfx-analytics-absent` slots) and the real numbers
(`data-wfx-analytics-real` slots). No axis, no sparkline, no graph
component exists in the studio surfaces — the honest-absence grammar
(the SearchFilters law: an option without real backing is absent, never
dead) is the only form a metric without backing can take.

## 3. The live proof (J48 §8 — evidence/r38b/journeys/final-run/)

- The three structural absences render their frozen sentences (asserted
  live: impressions / subscribers / demographics).
- The real local numbers are THIS JOURNEY'S OWN writes, honestly counted:
  the comment + the moderation reply (totalComments = 2), the like on the
  watch surface (yourReactions = 1, the per-video "you liked this"), the
  honest watch-fold truth ("not watched by you yet" — the journey never
  played the video; the panel says exactly that, never a fabricated view).
- Screenshots: `final-run/j48-analytics.png`.

## 4. The other surfaces' honesty (the same law)

- **The content list**: the published rows are the catalog's REAL items
  (the same discovery-derived feed the channel page renders); the
  drafts/scheduled rows are this device's own records with the honest
  empty states; the scheduled state's publish note names the upload wave
  (never a fabricated catalog row). Counts on the filter chips are the
  real derived counts.
- **The details editor**: the catalog's own truth renders in the
  provenance panel; the studio record names the original beside the edit;
  the typed save states render verbatim (never a fabricated success).
- **The moderation**: every action is a real write on the ONE comments
  store (the hold really removes; the approve really restores — both
  proven live on the watch surface by J48 §7).
- **The customization**: the base derived truth renders beside the
  composed preview; the record is the domain-graph seam's own validated
  shape (the graph's field-level refusals render verbatim).
