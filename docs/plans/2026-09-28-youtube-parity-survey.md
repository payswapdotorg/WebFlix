# YouTube Feature Survey → WebFlix Parity Roadmap (R36+)

**Survey date:** 2026-09-28 · **Surveyor:** the Lead (direct survey of youtube.com's
feature surface — main sidebar, watch/shorts/search/channels/live/studio surfaces —
cross-checked against this repository's tree and the R00–R35 acceptance record)

**Operator directive:** survey all of YouTube's features directly from the website,
rank by priority, tick the already-implemented ones off after review, and generate an
implementation roadmap from the rest. Orchestrate across the 3 replay session slots,
parallelizing for speed without compromising quality.

---

## 1. The survey — every YouTube feature surface, ranked, with parity status

Status legend: ✅ implemented + review-verified on this tree · ◐ partial (named
residual) · ❌ gap (roadmap item) · ⬦ out of WebFlix scope (the aggregator-parity law)

### TIER 1 — The core viewing spine (P0: without these YouTube is not YouTube)

| # | YouTube feature | Status | Evidence on this tree |
|---|---|---|---|
| 1 | Home feed: personalized rails, shorts shelf, continue-watching | ✅ | R26 real thumbnails (home renders 100 cards with real artwork), R29 rails, continuity R04 |
| 2 | Search the whole catalog of videos | ✅ | `/search` route; title + semantic lanes; R33-C channel-identity on result cards |
| 3 | Search filters (type / duration) | ✅ | R29-B SearchFilters — the honest subset law (upload-date/features groups honestly absent until real backing exists) |
| 4 | Shorts: seamless full-screen vertical browsing (swipe, keys, queue, real video, unmute) | ✅ | R32 rail + R33-A ShortsMediaStage (real playing vertical video, session seam, swipe/keys/queue, hover-preview) |
| 5 | Watch page: player + actions + description + up-next | ✅ | R29-B WatchActions, DescriptionExpander, UpNextRail |
| 6 | Like / dislike split pill | ✅ | R29-B reactions — honest local transport (`wfx-reactions-v1`) + provider dispatch when the source declares the capability |
| 7 | Share (panel + timestamp) | ✅ | R28 ShareControl |
| 8 | Save (watchlist / playlist) + Add to queue | ✅ | WatchlistSave + the kebab vocabulary |
| 9 | Comments (post, reply, sort) | ✅ | R28 CommentsSection — the honest comments law (only real user actions, never fabricated counts) |
| 10 | Subscribe from the watch surface | ✅ | ChannelRow + `subscription-list` (writes the Subscriptions library list; rendered in Library) |
| 11 | Player chrome: play/seek/volume/speed/quality/captions/miniplayer/fullscreen + keyboard (J/K/L/←/→/0-9/M/F/C/T) | ✅ | PlayerChrome R29 + captions layer + LiveCaptionsSurface (R25) |
| 12 | Transcript | ✅ | the T-key transcript surface |
| 13 | Watch history + continuity | ✅ | R04 + `/library` |
| 14 | Subscriptions feed | ✅ | R32 `/feed/subscriptions` (pinned rail + channel rows + swipe/keys/queue) |
| 15 | Anonymous viewing + sign-in | ✅ | R23 anonymous law (no login walls) + auth API |
| 16 | Semantic / moment search ("the part where it rains") | ✅ (native) | R23 J39 — the WebFlix-native super-surface beyond YouTube (production transport gated by the operator) |
| 17 | **Creator channel pages** — banner, avatar, verified, subs count, tabs (Home / Videos / Shorts / Playlists / Community / About), channel search, sort (latest/popular/oldest) | ❌ **GAP — the #1 structural gap** | no `/channel`/`@handle` route exists anywhere in the tree |
| 18 | **Search for creators** — channel result rows (avatar, name, subs, description) with inline Subscribe | ❌ **GAP** | search returns items only; no channel results section |
| 19 | **Bell notifications** (all / personalized / none per channel; bell menu) | ❌ GAP | no notification surface |
| 20 | **Live videos: LIVE badge + viewer count, `/live` browse, current live chat** | ❌ **GAP** | only the r24-parity audit mentions live; no live item type, no chat |
| 21 | **Live chat replay on archived live VODs** (timed to playhead) | ❌ **GAP** | — |
| 22 | **Premieres** (scheduled, countdown, pre-show chat) | ❌ GAP | — |
| 23 | Playlists end-to-end (create, rename, reorder, visibility, shuffle, collaborative) | ◐ partial | save-to-playlist + Library list rendering exist; no create/reorder/collaborative management |
| 24 | Liked videos + Watch Later as first-class library destinations | ◐ partial | watchlist ≈ Watch Later; no Liked-videos page (reactions are view-local) |
| 25 | Trending + Explore verticals (Music / Gaming / News / Sport / Courses / Podcasts) | ❌ GAP | — |
| 26 | Community posts (polls, images, members-only posts) | ❌ GAP | — |
| 27 | Clips (shareable snippet with attribution) | ❌ GAP | — |
| 28 | Podcasts surface + video designation | ❌ GAP | — |

### TIER 2 — The creator surface (P0–P1: the operator's named priorities)

| # | YouTube feature | Status | Evidence |
|---|---|---|---|
| 29 | **Upload videos** — drag-drop, processing, details (title/description/visibility public-unlisted-private-scheduled, thumbnail), publish into the real catalog | ❌ **GAP** | no upload surface; the catalog is BYOF-provider-fed |
| 30 | **YouTube Studio end-to-end** — content list (drafts/scheduled/published), video details editor, analytics (reach/engagement/audience), comments management (hold/review/pin/reply), channel customization (branding/banner/handle) | ❌ **GAP** | no studio surface |
| 31 | **User's own channel end-to-end** ("You": your videos, your playlists, your liked, customize, view-as-visitor) | ❌ **GAP** | Library is a destination, not a channel; no own-channel surface |
| 32 | **Go live** — live control room, webcam instant, schedule, chat moderation, end→publish VOD with chat replay | ❌ **GAP** | — |
| 33 | **Monetization surface** — channel memberships (join tiers, perks, badges, members-only), Super Thanks, Super Chat/Stickers, gifts | ❌ **GAP** | must honor the R28 honest-transport law (real local truth, never fabricated counts) |
| 34 | AI-native transforms (BYOM model management, transform UX) | ✅ (native) | R06 — WebFlix's own super-surface (beyond YouTube parity) |
| 35 | Auto-dubbing / multi-language audio | ◐ native analog | R25 LiveTranslate (Qwen) — operator-gated |
| 36 | Conversational AI ("Ask about this video") | ◐ native analog | the AI actions tray + intent graph (R24-J42 station) |

### TIER 3 — Depth and edges (P2)

| # | YouTube feature | Status | Evidence |
|---|---|---|---|
| 37 | Download / offline playback | ◐ native | the product's own offline mode; web-adapter download honestly absent |
| 38 | Restricted mode / appearance / language / location / playback prefs | ◐ | Settings surface carries the native set |
| 39 | Account switcher + identity | ✅ | R02 + AccountMenu |
| 40 | Keyboard shortcuts (global) | ✅ | the shortcut grammar (C/T/F/M/J/K/L/0-9) |
| 41 | Music / Movies & TV rentals / Primetime channels | ⬦ | aggregator parity instead (Where-to-watch, BYOF, torrent) |
| 42 | Playables / VR / Kids | ⬦ | out of scope for the web product |

**Survey verdict — the ticked-off list (already implemented, review-verified):**
home feed, catalog search, search filters (honest subset), shorts browsing, watch
page, like/dislike, share, save/queue, comments, subscribe (watch surface), player
chrome + keyboard + captions + transcript, history/continuity, subscriptions feed,
anonymous viewing, semantic moment search, BYOF/BYOM/AI transforms, offline mode,
identity/accounts. **20 of the 28 core-surface rows** are green.

**The residual core gaps (the roadmap's fuel):** channel pages (17), creator search
(18), live + live chat + replay (20–21), premieres (22), playlist management (23),
liked/watch-later destinations (24), explore verticals (25), community posts (26),
clips (27), podcasts (28), upload (29), studio (30), user channel (31), go-live (32),
monetization surface (33), notifications (19).

---

## 2. The implementation roadmap (priority-ranked, 3-slot parallel)

Lane law (unchanged): branch `wfx/rNN/<scope>`, lane-local evidence only, battery
floor + lane tests + affected journeys green, lead review → merge to main →
production auto-deploys. The honest-transport law (R28) governs every social surface:
only real user actions counted, typed-absence states, never fabricated numbers.

### WAVE R36 — Creator channels end-to-end (P0 · 1 slot)
The #1 structural gap. `/channel/[handle]` (+ id) routes: banner, avatar, identity,
subs count, join date, description, links. Tabs: Home (featured), Videos (sort
latest/popular/oldest), Shorts, Playlists, About + channel search. Subscribe + bell
(all/personalized/none — honest backing) on the channel. Cards' + watch-page channel
rows link to channels. Search: channel result rows with inline Subscribe.
**Depends on:** nothing — purely additive surfaces over the existing catalog model.
**Journeys:** new J43 (channel browse/subscribe round trip) + affected J01–J42.

### WAVE R37 — Live video + live chat (P0 · 1 slot)
Live item type (LIVE badge, viewer count) + `/live` browse rail. Watch-page live
mode with **current live chat** (real-time transport — the WS seam). **Live chat
replay** on archived live VODs, timed to the playhead. Chat grammar: member badges,
pinned message, slow mode, emojis. Premieres (countdown + pre-show chat) if the
lane has capacity — else deferred to R40.
**Depends on:** nothing structural; composes with R36's channel Live tab.
**Journeys:** new J44 (live watch + chat) + J45 (chat replay scrub).

### WAVE R38 — Upload + Studio (P0–P1 · 2 parallel slots: R38-A pipeline, R38-B studio)
- **R38-A (content pipeline):** upload flow — drag-drop video, processing state,
  details form (title/description/visibility public/unlisted/private/scheduled,
  thumbnail pick), publish into the REAL local catalog (uploaded items become
  watchable, appear in home/search/channel/shorts per type).
- **R38-B (studio surfaces):** Studio — content list (drafts/scheduled/published),
  video details editor, analytics (reach/engagement/audience per video + channel),
  comments management (hold/review/pin/reply), channel customization
  (banner/avatar/handle/description).
**Depends on:** R36 (the channel the studio customizes + the content list hangs on).
**Journeys:** new J46 (upload→watch round trip), J47 (studio edit + customize).

### WAVE R39 — User channel + go live + monetization surface (P1 · 1–2 slots)
"You" channel end-to-end (your videos/playlists/liked/customize/view-as-visitor).
Live control room: webcam instant go-live, schedule, chat moderation, end → publish
VOD with chat replay. Monetization surface: membership tiers (join/perks/badges/
members-only), Super Thanks on watch, gifts in live chat — the honest-transport law
throughout (a local wallet of the user's own real actions, typed states otherwise).
**Depends on:** R36 + R37 + R38-A.
**Journeys:** new J48 (go live end-to-end), J49 (membership + thanks).

### WAVE R40 — Discovery + playlists + notifications depth (P2 · 1 slot)
Trending + Explore verticals. Playlist management (create/rename/reorder/visibility/
shuffle/collaborative). Liked videos + Watch Later destinations. Bell notifications
menu. Clips. Podcasts designation. Community posts (polls/images). The deferred
premieres if not already landed.
**Depends on:** R36 (channels) + R38-A (catalog writes).
**Journeys:** J50+ as encoded.

### Sequencing on the 3 replay slots (max parallelism, zero quality compromise)

```
slot-1: r35a (read-path fixes — in flight)  → on merge: R38-A (upload pipeline)
slot-2: r35b (32-spec journey re-encode — in flight) → on merge: R38-B (studio)
slot-3: FREE NOW                            → R36 (channels) dispatches immediately
then: R37 (live) when the first r35 lane merges; R39; R40 — the standing queue.
```

Every wave: the battery floor must not regress; every social surface obeys the
honest-transport law; every UI surface lands with lane tests + journey evidence;
production auto-deploys on merge to main.
