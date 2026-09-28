# R38-B — The studio survey + design (M1, written before any product edit)

**Lane:** `wfx/r38b/studio` · **Base:** `37effa325c5060e14afda7e07db5b7eb61e45d9e`
**The spec of record:** docs/plans/2026-09-28-youtube-parity-survey.md §1 row 30
(the studio gap) + §2 WAVE R38 R38-B (studio surfaces) + the lane-law
paragraph (lines 93–96) + the task packet's five binding laws
(concurrent-catalog, honest-analytics, moderation, customization, lane).

---

## 1. What creator truth EXISTS at base (the survey, with citations)

### 1.1 The catalog truth (the connector-fed items)

- The fixtures boot's catalog is the 9-item `FIXTURE_CATALOG`
  (packages/experience/src/fixtures.ts:107–300): 6 long-form items
  (Asteroid Drift [movie], Harbor Lights [series], Deep Field Diary, Static
  Bloom, Desert Rain Doc, Signal Fade) + 3 shorts (Neon Rain, Midnight
  Scoop, Rain Check). **No item carries `publishedAt` or `viewCount`
  metadata** — `FakeCatalogItem` (fixtures.ts:73–102) has no such fields,
  and `includeMetadata: false` items answer `null` metadata. J44's own
  assertion codifies this: "the Videos tab's sort options are honestly
  absent (the fixtures declare no dates/counts)" (j44-creator-channels.ts:122).
- The ONE source the fixtures boot declares: connectorId `fake-source`,
  displayName "Fake Source (TEST FIXTURE — never production)"
  (apps/web/src/host/source-auth-fixtures.ts:92–118). In service mode the
  sources model carries every wired connector (client-runtime sources.ts).

### 1.2 The R36 channel entity (the profile truth the studio customizes)

- `ChannelIdentity` (apps/web/src/host/channel-views.ts:114–148): every
  field is DERIVED — handle = `channelHandleOf(connectorId)` (the slug law,
  app/href.ts:96–112), displayName = the sources model's own
  `displayName`, avatar = the honest MONOGRAM (channel-views.ts:443–448),
  banner = typed absence or derived art from the channel's own item
  artwork (channel-views.ts:415–430), description = **hardcoded typed
  absence** (channel-views.ts:450–453: "This source declares no channel
  description — WebFlix does not write one for it"), subscriberCount /
  links / verifiedBadge = typed absences.
- The read path: `loadChannelDirectory` → `host.runtime.sources.refresh()`
  (channel-views.ts:275–284) → the ServerPort's `readSources`
  (packages/client-runtime/src/sources.ts:292–350 — pure port read, **no
  profile-edit seam anywhere**); the items via `channelItemsOf` — the SAME
  discovery-seed composition the home view renders
  (channel-views.ts:351–369, seeds at :320–322); the full page view via
  `loadChannelView` (channel-views.ts:571–756).
- **THE FINDING (recorded honestly):** the task packet's §2 describes "the
  R36 channel-profile entity (`packages/domain/src/graph/**`)" — at this
  base NO channel-profile entity exists in the domain graph (grep: zero
  `ChannelProfile` matches in packages/domain). R36's channel profile is a
  web-host DERIVATION over `SourceInfo` + the channel's items. The packet
  itself hedges ("a channel-profile EDIT seam IF the R36 channel-profile
  entity needs a write path") — it does: this lane BUILDS the edit seam
  additively in the domain graph and composes with R36's read surfaces by
  importing them read-only (see §5).

### 1.3 The comments truth (the R28 honest comments law)

- `wfx-comments-v1` (CommentsSection.tsx:59–103): per-item arrays of
  `LocalComment { id, parentId, body, createdAt, authorHandle, liked }`.
  The store is the browser's OWN localStorage; the watch surface renders
  ONLY this truth (the count header counts it; a like shows only the
  user's own). The composer is SIGN-IN GATED (the corpus logged-out law,
  CommentsSection.tsx:427–505); the reply form writes into the same store
  (:221–266). The pinned-badge slot exists in the row grammar but "never
  fabricates a pin" (:177–178).
- **Moderation composes here** (§4): the studio reads/writes THIS store —
  the same truth the watch surface renders.

### 1.4 The reactions truth (the local wallet)

- `wfx-reactions-v1` (reactions-client.ts:19–73): per-item `"like" |
  "dislike"` — this browser's own record, reload-durable, defensively read.

### 1.5 The library truth (the one store)

- The Subscriptions/playlist writes ride `POST /api/library` →
  `runtime.libraryOps` (api/library/route.ts:92–156, the dev-boot bridge
  at :57–89); the frozen `SUBSCRIPTIONS_LIST` name
  (subscription-list.ts:14). The channel's subscription truth is the
  connector-scoped read (channel-views.ts:493–545).

### 1.6 The watch fold (the user's own viewing truth)

- `host.runtime.getHome().continueWatching` — the same seam the channel
  Home tab joins for resume affordances (channel-views.ts:651–679). Real
  per-item position/completion truth of THIS session's user.

### 1.7 What does NOT exist (the honest-absence inventory)

- No impression/view-count transport (nothing counts views of an item for
  the creator — the source declares no metadata; no ServerPort seam counts
  impressions).
- No audience/demographics transport (the R36 law: the subscriber count is
  NEVER fabricated — channel-views.ts:459–462).
- No upload/catalog-write seam at base (R38-A's concurrent lane owns it).
- No server-side studio service (apps/api carries no studio routes).

---

## 2. The studio-store design (the persistence law)

**THE SEAM LAW (the task packet's own words):** "persistence following the
existing subscription-list/reactions seam law: reload-durable, the R30
law." The named seams: the subscription-list (ONE store through the
runtime's library seam — where the studio's data IS library data) and the
reactions/comments/bells family (the browser's own localStorage records —
where the data is WebFlix's own social/creator truth with NO
server-side service behind it). The studio's data is exactly the latter
class at this base (no apps/api studio service exists; the moderation
truth MUST ride the same `wfx-comments-v1` transport the watch surface
renders). **Decision: the studio store = typed localStorage records, the
honest local transport, reload-durable per device, honestly labeled on
every surface ("stored locally on this device") — the identical law
CommentsSection/reactions/ChannelEngagement keep.**

Three records, all owned by `apps/web/src/host/studio-store/**`:

1. `wfx-studio-content-v1` — the studio-owned content records:
   - `drafts: Record<draftId, StudioDraftRecord>` — `{ id, connectorId,
     title, description, visibility: "private"|"unlisted"|"public"|
     "scheduled", scheduledFor: string|null, createdAt, updatedAt }`. The
     STATE derives: `scheduled` ⇔ visibility=scheduled with a future
     `scheduledFor`; otherwise `draft`. (The CONCURRENT-CATALOG law: a
     draft is a STUDIO-owned record, never a catalog write — it does not
     enter search/home/channel; the honest publish note names the upload
     wave. At merge, R38-A's uploaded items compose through the same read
     seam — the store resolves catalog items through the runtime's own
     search/join seams, never around them.)
   - `edits: Record<itemId, StudioItemEditRecord>` — the details-editor
     writes on CATALOG items: `{ itemId, connectorId, title, description,
     visibility, scheduledFor, savedAt }`. The catalog's own read surfaces
     keep their truth (the catalog write seam is R38-A's); the studio
     renders the composed truth (catalog + edit) with the provenance note.
2. `wfx-studio-moderation-v1` — `{ perItem: Record<itemId, { held:
   LocalComment[], pins: string[] }> }` — the moderation states (§4).
3. `wfx-studio-profile-v1` — `Record<connectorId, ChannelProfileEditJSON>`
   — the customization writes (§5), the domain seam's record serialized.

Store modules: pure types + validation + an INJECTABLE storage seam
(`StorageLike`) so the colocated lane tests run on an in-memory double
(the fake-web.ts law); the client transport binds `window.localStorage`
with the defensive read/best-effort write law (reactions-client.ts:24–49
verbatim pattern). Server render passes the server-side truths as
serialized props; the client islands load the local truth AFTER MOUNT
(the CommentsSection hydration law, CommentsSection.tsx:314–318) — never
a hydration mismatch, never a fabricated pre-mount number.

**No BYOF-fixture seed section** (the packet's option declined with
cause): pre-seeded studio state would be FABRICATED creator truth (drafts
the user never wrote). Everything derives from real catalog truth at read
time + the user's own writes. `byof-fixtures.ts` stays byte-identical.

---

## 3. The content list + the details editor (M2/M3 design)

### The channel binding (whose studio)

The studio manages THE CATALOG'S OWN CHANNEL — the channel R36's page
renders (the packet: "Depends on: R36 (the channel the studio customizes
+ the content list hangs on)"). `/studio?channel=<handle>` (default: the
directory's first source, deterministic by the sources model's own
connectorId sort — sources.ts:346). The studio resolves the channel
through R36's own seams — `loadChannelView` (channel-views.ts:571) is THE
composition point: the studio consumes the SAME view the channel page
renders (identity + items + subscription truth + stats), imported
read-only. A handle no source owns renders the honest typed not-found
state (the ChannelNotFound law — never a guessed channel).

### The content list (`/studio`)

- The table: one row per content record. PUBLISHED rows = the channel's
  real catalog items (from `loadChannelView().items` — every row a hit the
  transport really answered, with the card grammar's title/type/duration).
  DRAFT/SCHEDULED rows = the studio store's records (loaded after mount).
- The state filter (All / Published / Draft / Scheduled — chip links +
  client filter state).
- Honest empty states: no drafts yet ("Nothing in drafts — your next
  video starts here"); no scheduled; a channel with no items renders the
  typed-empty list. Counts are the real derived counts, never fabricated.
- The new-draft form (title/description/visibility) with typed validation
  (empty title refused, field-level errors — the SessionControls typed
  failure law) and the typed save states (idle → saving → saved/refused).
- The scheduled law: a draft scheduled for a future instant flips to the
  scheduled state with the honest publish note ("Publishing into the
  catalog lands with the upload wave — your schedule is recorded and
  ready" — the bell-menu honest-later-wave vocabulary,
  ChannelEngagement.tsx:50–51 pattern).

### The details editor (`/studio/video?id=…&connector=…&ref=…&title=…&type=…`)

- The /player parameterized-route grammar (href.ts:60–76 — the ItemRouteTarget
  shape), pure href builders in `apps/web/src/app/studio/href.ts`.
- The form: title (prefilled with the catalog truth), description (the
  catalog carries none — the editor starts empty with the honest note),
  visibility (public/unlisted/private/scheduled + the schedule datetime),
  each writing the studio-owned edit record on save.
- Typed save states: idle → saving → saved (the persisted record echoed:
  "Saved — the studio record for this video (stored locally on this
  device)") / refused (validation verbatim). RELOAD → the composed truth
  renders (the studio's values + the original catalog value named
  alongside — the provenance law).

---

## 4. The comments moderation design (M3 — the R28 composition)

**THE MODERATION LAW:** "operates on the SAME comments truth the watch
surface renders — your studio actions are real persisted moderation
states, never cosmetic." The composition, action by action:

- **READ** — the per-video list reads `wfx-comments-v1[itemId]` + the
  moderation record (held/pinned). The video picker = the channel's items
  (server props from `loadChannelView`).
- **REPLY** — writes a REAL reply into `wfx-comments-v1[itemId]`
  (`parentId` set, the signed-in profile's handle — the same `handleOf`
  law, CommentsSection.tsx:88–96). Sign-in gated exactly like the watch
  composer (the corpus law). **The watch surface renders the studio's
  reply — one store, real write.**
- **HOLD** — MOVES the comment out of `wfx-comments-v1[itemId]` into the
  moderation record's held list (the full LocalComment carried, so it is
  restorable). **The watch surface stops rendering it — real moderation.**
- **REVIEW** — the held queue renders the held comments with Approve
  (restore into `wfx-comments-v1`) / Remove (delete permanently). Both are
  real persisted effects on the same store.
- **PIN** — persists the pin in the moderation record; the studio renders
  pinned-first with the badge. **The honest divergence:** the watch
  surface's pinned-badge slot (CommentsSection.tsx:177–178 — "never
  fabricated") does not read the moderation record at this base (the R28
  file is frozen for this lane); the pin is real persisted state rendered
  by the studio, and the watch-surface binding is recorded as the lane's
  defect-candidate + the merge-time compose (evidence/r38b/DIVERGENCES.md).

The moderation surface carries the honest local-transport label (the
CommentsSection footnote law, :539–542).

---

## 5. The channel customization design (M4 — the graph seam)

**THE CUSTOMIZATION LAW:** banner/avatar/handle/description write "real
persisted profile state through the additive domain-graph seam."

### The domain-graph seam (packages/domain/src/graph/channel-profile.ts — NEW, additive)

- `ChannelProfileEdit` — the creator's declared profile edit, keyed by the
  channel's stable connectorId: `{ connectorId, handle: string|null,
  description: string|null, bannerUrl: string|null, avatarUrl: string|null,
  editedAt }` — every field NULLABLE (absent = not customized; the record
  never fabricates a value the creator did not declare). This is the
  write-path entity the R36 typed-absence slots (`ChannelIdentity`
  description/avatar/banner) were waiting for — a source-declared count
  binds the same slot (the R36 divergence row 4's own law).
- The closed vocabulary + guards follow model.ts's `Covers` pattern
  (model.ts:91–107); the handle guard enforces the SAME slug grammar as
  `channelHandleOf` (href.ts:96–112 — lowercase [a-z0-9-], collapsed
  separators, trimmed, 1–64 chars) so a customized handle is routable;
  the URL fields validate http(s) URL shape; the timestamp validates ISO
  8601 (`isIso6081` — the store's own validator family). The validating
  constructor throws the graph's typed `GraphError` with field-level
  details (model.ts:239–259 — never a silent coercion).
- `composeChannelProfile(base, edit)` — the PURE overlay law: the base
  identity's fields with the edit's declared fields winning (handle →
  description → bannerUrl/avatarUrl), plus which fields are customized.
  The graph's no-I/O boundary law is honored (store.ts:1–38): the seam is
  pure data + validation; the PERSISTENCE lives in the studio store (the
  same split the graph's own store keeps — "server persistence is a later
  work item").
- Exported additively through the graph barrel (graph/index.ts gains one
  export line; existing exports untouched; domain/src/index.ts:15 already
  re-exports the graph barrel).

### The studio composition (never editing R36's files)

- The customization surface loads R36's derived identity (through
  `loadChannelView` — the read surface, imported read-only), renders the
  BASE truth beside the LIVE COMPOSED PREVIEW (base + the persisted edit,
  through `composeChannelProfile`).
- The four editors (banner URL / avatar URL / handle / description) with
  typed validation (the graph seam's own guards — one law, two layers)
  and typed save states; the save persists the edit record
  (`wfx-studio-profile-v1`) — reload-durable, proven by the journey.
- **THE HONEST FINDING (the packet's claim vs the base's architecture):**
  "the R36 channel page then renders the customized truth" is NOT
  achievable inside this lane's ownership at this base: the channel
  page's read path is `loadChannelView` → `sources.refresh()` →
  `readSources` (sources.ts:292–350) + the search transport — there is NO
  seam through which a profile edit can flow into
  `/channel/[handle]`'s render without editing R36's files
  (channel-views.ts / ChannelSurface.tsx / the channel page — read-only
  for this lane) or the frozen client-runtime/ServerPort (outside the
  lane). The lane therefore: (a) builds the real write path (the graph
  seam + the persisted record), (b) renders the customized truth through
  the studio's composed preview, (c) proves the R36 read surfaces stay
  byte-compatible (J44 green, no regression), and (d) records the
  composition point for the merge-time binding (the exact one-place
  compose: `channelIdentityOf`'s return in channel-views.ts:440–467,
  overlaid with the graph seam's `composeChannelProfile`) in
  evidence/r38b/DIVERGENCES.md — a named defect-candidate, never a
  fabricated claim that the channel page shows it.

---

## 6. The analytics backing map (M4 — brutally honest, per panel)

**THE HONEST-ANALYTICS LAW:** "analytics render ONLY what the real local
transport carries… every metric without honest backing renders the TYPED
ABSENCE state — never a fabricated chart, never a seeded number, never a
fake axis."

| Panel | Metric | Backing | Render |
|---|---|---|---|
| Reach (per video) | Impressions / views by others | **NONE** — no impression transport; the source declares no viewCount (fixtures.ts:73–102) | TYPED ABSENCE: "No impression transport is connected on this host — WebFlix does not fabricate a reach number." |
| Reach (per video) | Your own view | **REAL** — the session's watch fold (`getHome().continueWatching`, the channel-views.ts:651 seam) | the real resume/completion truth ("watched to 42% by you" / "not watched by you yet") |
| Engagement (per video) | Comments | **REAL** — the `wfx-comments-v1` count (the same count the watch surface renders) | the real local count |
| Engagement (per video) | Your reaction | **REAL** — the `wfx-reactions-v1` record | "you liked this" / "you disliked this" / "no reaction recorded by you" |
| Engagement (per video) | Library saves | **REAL** — the runtime's library read (`runtime.library()`, the channel-views.ts:709 seam) | in your watchlist / in N named lists / not saved |
| Audience (per video + channel) | Subscriber count | **NONE** (the R36 law — never fabricated) | TYPED ABSENCE (the R36 sentence) + the user's OWN subscription truth |
| Audience | Demographics / geography / returning viewers | **NONE** — no audience transport | TYPED ABSENCE |
| Channel | Aggregates | **REAL** — the sums of the real per-video truths above (comments across items, your reactions, your saves) + the derived content counts (the R36 stats law) | real sums; every other channel metric = typed absence |

No chart renders without real data (no fabricated axes — the absence
cards carry the sentences). `evidence/r38b/honesty.md` proves each row
(the panel's honest source citation + the journey's live assertions).

---

## 7. The journey sketch (J48 — `journeys/web/j48-studio-edit-customize.ts`)

The WAVE R38 studio journey (the packet names it J48 — the survey's "J47"
numbering is R38-A's upload lane, not at this base; J45/J46 are R37's,
not at this base). The round trip, driven as a user over the fixtures
boot (open → networkidle → snapshot; fresh snapshot after every
DOM-changing interaction; never hardcoded canonical ids — the DOM's own
hrefs):

1. **The studio renders** (`/studio`): the studio chrome (the managed
   channel's identity + the link to its R36 channel page), the content
   table with the channel's REAL published items, the honest empty
   drafts/scheduled states.
2. **The draft round trip**: create a draft (unique title) → the typed
   saved state → the draft row (state=draft) → RELOAD → the draft
   persists (reload-durable). Schedule it (visibility=scheduled + future
   date) → the scheduled state + the honest publish note.
3. **The details editor round trip**: open a published video → the
   catalog truth prefills → edit title/description/visibility → save →
   the typed saved state → RELOAD → the composed truth persists.
4. **The comments moderation round trip** (the R28 composition): sign in
   (Settings ▸ General, the scripted dev persona — SessionControls' own
   flow) → post a comment on the video's WATCH surface (the real
   composer) → in the studio: the comment renders → REPLY (a real
   comment write) → verify ON THE WATCH SURFACE the reply renders → HOLD
   → verify ON THE WATCH SURFACE the comment is gone → the review queue
   → APPROVE → verify the comment is back.
5. **The analytics honest map**: the channel panels (the typed absences
   with their exact sentences + the real aggregates) + the per-video
   panel (the comment count ≥ 1 — the journey's own real write; the
   watch-fold truth; the absences).
6. **The customization round trip**: the base identity renders (the R36
   derivation: monogram/absence banner/the stable handle) → edit
   description + handle (unique slug) + banner/avatar URLs → save → the
   typed saved state → the composed preview renders the customized truth
   → RELOAD → persisted. The R36 channel page still renders its derived
   truth (the byte-compatible read — assert the monogram + the banner
   absence + the stable handle, J44's own assertions).
7. **The anonymous law**: the studio surfaces never redirect to a
   sign-in wall (the sign-in gate is only the comment composer's own
   corpus law).

J48 runs last in the catalog (after J44) — its sign-in step cannot
affect earlier journeys (one browser session per run, runner.ts:153–155;
the runner resets the acquisition/source-auth/model/library fixture
state per run, product.ts:178–181).

---

## 8. The owned-surface plan (what lands where)

| Path | What |
|---|---|
| `apps/web/src/app/studio/page.tsx` | the content list route (server) |
| `apps/web/src/app/studio/video/page.tsx` | the details editor route |
| `apps/web/src/app/studio/comments/page.tsx` | the comments management route |
| `apps/web/src/app/studio/analytics/page.tsx` | the analytics route |
| `apps/web/src/app/studio/customization/page.tsx` | the customization route |
| `apps/web/src/app/studio/loading.tsx` (+ per-route loading) | the skeleton law |
| `apps/web/src/app/studio/href.ts` | the pure studio href builders (the href.ts law) |
| `apps/web/src/components/studio/StudioChrome.tsx` | the studio header + tab bar (server) |
| `apps/web/src/components/studio/ContentTable.tsx` | the content list island |
| `apps/web/src/components/studio/DetailsEditor.tsx` | the editor island |
| `apps/web/src/components/studio/AnalyticsPanels.tsx` | the analytics island |
| `apps/web/src/components/studio/CommentsModeration.tsx` | the moderation island |
| `apps/web/src/components/studio/ChannelCustomization.tsx` | the customization island |
| `apps/web/src/host/studio-store/studio-content.ts` | the drafts/edits store |
| `apps/web/src/host/studio-store/studio-moderation.ts` | the moderation store |
| `apps/web/src/host/studio-store/studio-profile.ts` | the customization store |
| `apps/web/src/host/studio-store/studio-comments.ts` | the shared wfx-comments-v1 transport access (hold/restore/reply — the SAME store, never a second one) |
| `apps/web/src/host/studio-store/studio-analytics.ts` | the analytics composition (server truths + local truths → panels) |
| `apps/web/src/host/studio-store/studio-views.ts` | the server-side studio view loaders (composition over R36's `loadChannelView`) |
| `packages/domain/src/graph/channel-profile.ts` | the additive graph seam |
| `packages/domain/src/graph/index.ts` | +1 export line (additive) |
| colocated `*.test.ts` in each owned dir | the lane tests |
| `journeys/web/j48-studio-edit-customize.ts` + `index.ts` (+2 lines) | the journey + registration |
| `docs/validation/webflix-golden-journeys.md` | ONE dated additive section |
| `evidence/r38b/**` | this lane's evidence |

**NOT touched:** R36's files (channel-views.ts, ChannelSurface.tsx,
ChannelEngagement.tsx, the channel route, ChannelRow.tsx), routing.ts /
href.ts (the frozen SurfaceId set — /studio is a presentation route; the
studio pages do not call `syncNavigationToRoute`, which is the exact
semantic the presentation-route class gives the channel route, achieved
without editing the frozen file), globals.css (the studio composes the
existing wfx-* class vocabulary + inline layout styles), byof-fixtures.ts
(no seed — §2), apps/api, all other packages.

## 9. The risks + the honest answers

- **The R36-page composition claim** (§5): the honest divergence +
  defect-candidate + the documented merge-time binding point. NEVER a
  fabricated J48 assertion that /channel/ renders the customization.
- **The pin-on-watch claim** (§4): same class — the studio renders the
  pin; the watch binding is the merge-time compose.
- **Journey determinism** (shared browser session): J48 drives its own
  writes with UNIQUE values (timestamped titles/bodies/handles) and
  asserts by containment on its own artifacts — robust to any prior
  journey state without eval-writes into the product's stores.
- **The lint baseline** (guards.md §3): pre-existing errors outside the
  lane; this lane's files lint clean; the base error list is frozen as
  the comparison.
