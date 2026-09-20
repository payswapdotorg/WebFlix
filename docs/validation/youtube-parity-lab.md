# WebFlix YouTube Parity Lab

**Status:** FROZEN LAB CONTRACT  
**Date:** 2026-09-20  
**Purpose:** viewer-feature, UX/UI, cross-platform and playback-performance comparison.

This is a living evidence document. It records the behavior being paired, the WebFlix treatment, implementation status, evidence and source references. It is not a request to copy YouTube branding or proprietary UI.

## Lab rule

Every relevant viewer-facing capability observed in the current YouTube product must resolve to exactly one classification:

- **PARITY** — WebFlix provides the same user capability using source-neutral semantics.
- **NATIVE-EQUIVALENT** — WebFlix provides the capability with a WebFlix-specific implementation because its multi-source mission requires different mechanics.
- **PLATFORM-VARIANT** — the capability exists where the Web/Desktop/mobile platform actually supports it.
- **INTENTIONALLY-OUT-OF-SCOPE** — it is not part of the Universal Entertainment OS mission; the row must include the reason and the nearest user-facing WebFlix path.

A blank classification is a lab failure.

## Reference feature inventory

### Discovery and navigation

| Reference area | WebFlix pairing | Classification | Evidence |
|---|---|---|---|
| Home recommendations | Home source-neutral discovery | NATIVE-EQUIVALENT | J02 |
| Search | Unified Search | NATIVE-EQUIVALENT | J05/J39 |
| Natural-language/conversational search | Semantic search + AI query path | NATIVE-EQUIVALENT | J39 |
| Inline playback in feeds/search | Inline preview where attention/platform policy permits | NATIVE-EQUIVALENT | J40 |
| Following/subscriptions | Following + imported feed relationships | NATIVE-EQUIVALENT | J33/J40 |
| Notifications | Adapter notification path when available | PLATFORM-VARIANT | J40 |
| Channel/profile pages | Source-aware creator/source detail within canonical identity | NATIVE-EQUIVALENT | J06/J40 |
| Recommended next content | Recommendation OS + explicit intent/attention | NATIVE-EQUIVALENT | J17/J18 |
| History | WebFlix History | PARITY | J11 |
| Watch Later | WebFlix Watchlist | NATIVE-EQUIVALENT | J11/J40 |

### Long-form Watch

| Reference area | WebFlix pairing | Classification | Evidence |
|---|---|---|---|
| Play/pause | Player controls | PARITY | J03/J40 |
| Seek/scrub | Player seek | PARITY | J03/J40 |
| Volume/mute | Player-local control | PARITY | J40 |
| Fullscreen | Platform player/fullscreen capability | PLATFORM-VARIANT | J40 |
| Speed | Player settings | PARITY | J40 |
| Quality | Realization/player quality control where exposed | PLATFORM-VARIANT | J40/J41 |
| Captions | Provider/local/AI subtitles | NATIVE-EQUIVALENT | J20/J39 |
| Transcript | Timestamped transcript | NATIVE-EQUIVALENT | J20/J39 |
| Chapters | Provider/derived chapters | NATIVE-EQUIVALENT | J39 |
| Autoplay | Attention-policy-aware autoplay | NATIVE-EQUIVALENT | J18/J40 |
| Up next | Source-neutral next realization/content | NATIVE-EQUIVALENT | J40 |
| Queue | Session queue | NATIVE-EQUIVALENT | J40 |
| Save queue | WebFlix playlist/library collection | NATIVE-EQUIVALENT | J40 |
| Like | Action system where supported | PARITY | J10 |
| Dislike/current negative feedback behavior | Recommendation feedback system | NATIVE-EQUIVALENT | J15 |
| Share | Canonical link + source link | NATIVE-EQUIVALENT | J40 |
| Comments | Provider/comment adapter where authorized | PLATFORM-VARIANT | J10/J40 |
| Description/links | Item detail/content metadata | NATIVE-EQUIVALENT | J06 |
| Chapters/preview | Chapter rail/list | NATIVE-EQUIVALENT | J39 |
| Continue watching | Library/history/resume | NATIVE-EQUIVALENT | J11/J12 |
| External handoff | Return-context preserving fallback | NATIVE-EQUIVALENT | J09 |

### Shorts

| Reference area | WebFlix pairing | Classification | Evidence |
|---|---|---|---|
| Vertical swipe | ShortsFeed | PARITY | J04 |
| Like/save/share | Hydrated Shorts actions | PARITY | J04/J36 |
| Related audio/content | Source-aware audio/content relation | NATIVE-EQUIVALENT | J04 |
| Remix attribution | Authorized source-aware remix/reference path | PLATFORM-VARIANT | J04 |
| Clear-screen viewing | Distraction-free Shorts presentation | NATIVE-EQUIVALENT | J18/J40 |
| Speed control | Shorts player control | PARITY | J40 |
| Inline feedback | Recommendation feedback | NATIVE-EQUIVALENT | J15/J40 |

### Identity, continuity and second screen

| Reference area | WebFlix pairing | Classification | Evidence |
|---|---|---|---|
| Anonymous public watching | Public accountless viewing | NATIVE-EQUIVALENT | J37 |
| Account history | WebFlix History | PARITY | J11 |
| Cross-device continuity | Shared profile/library state | NATIVE-EQUIVALENT | J12/J31 |
| Cast/TV continuation | Platform adapter capability | PLATFORM-VARIANT | J40 |
| Device handoff | Return-context + platform capability | NATIVE-EQUIVALENT | J09/J31 |
| Offline viewing | Verified local asset/offline Library | NATIVE-EQUIVALENT | J21-J27 |

### Live

| Reference area | WebFlix pairing | Classification | Evidence |
|---|---|---|---|
| Live playback | Live realization where source supports it | PLATFORM-VARIANT | J30/J40 |
| Live chat/reactions | Provider-specific live interaction where authorized | PLATFORM-VARIANT | J40 |
| Replay | Canonical replay/history path | NATIVE-EQUIVALENT | J40 |

## WebFlix-only feature pairing

These capabilities do not wait for YouTube parity. They are evaluated for interaction consistency.

| WebFlix capability | Natural viewer placement | Consistency rule |
|---|---|---|
| Where to watch / realization choice | Near Play / player | Behaves like a familiar playback source selector |
| Authorized peer/torrent copy | Where to watch | A peer realization, not a download-only admin flow |
| Canonical source-neutral identity | Search/item/player | One title, multiple realizations |
| Bring Your Own Feed | Home feed mode + source context | Similar mental model to Following/subscriptions |
| Explicit intent | Home/Search/Personalize | Temporary context, not a settings maze |
| Attention modes | Home/Personalize/player | User control, not hidden optimization |
| Anti-tunnel feedback | Card/player/Shorts | Familiar recommendation feedback placement |
| BYOM/local model | AI tray + Model & AI | Optional model choice, not required to watch |
| AI transformations | Player/AI tray | Contextual media tools, not an architecture console |
| Semantic moment search | Search + transcript/chapters | Search behaves like "find the part where…" |
| Contained BrowserHost | Player realization | Feels like another playback surface |
| Verified local/offline | Library + playback | Same item continues locally |
| Provenance/model/license truth | Progressive disclosure | Trust metadata without making it the main UX |

## UX/UI review checklist

For every row, the lab records:

- first discoverable location;
- primary action;
- secondary action(s);
- empty state;
- loading state;
- success state;
- failure/recovery state;
- anonymous behavior;
- authenticated behavior;
- Web behavior;
- Desktop behavior;
- mobile-ready semantics;
- reduced-motion behavior;
- keyboard/screen-reader behavior;
- whether the feature blocks playback;
- screenshot/snapshot evidence.

### Familiarity law

The user should not need to learn a new navigation model because a feature belongs to WebFlix.

WebFlix may add information and controls, but it should add them at the same moment of user intent that a mature video platform would.

## Playback performance lab

### Benchmark setup

Record for every run:

- WebFlix commit SHA;
- YouTube version/page context used as reference;
- browser version;
- OS/device;
- viewport;
- network profile;
- cold vs warm cache;
- content ID/source/realization;
- whether the same public content exists on both systems.

### Metrics

1. Navigation -> player surface visible.
2. User play -> first rendered video frame.
3. User play -> audible playback where audio exists.
4. User play -> playback declared playable.
5. Startup failure.
6. Rebuffer ratio in first 60 seconds.
7. Seek response.
8. Control response.
9. Recovery after a transient interruption.
10. Realization-switch time when the user changes playback source.

### Pass targets

- p50 TTFF <= reference + 150 ms;
- p75 TTFF <= reference + 300 ms;
- p95 TTFF <= reference + 750 ms;
- startup failures <= reference + 0.5 percentage points;
- first-60-second rebuffer ratio <= reference + 0.25 percentage points;
- supported playback starts from one obvious play action;
- no nonessential AI/recommendation/indexing request blocks the first frame.

The lab must retain the raw observations. A green UI screenshot without timing evidence does not satisfy J41.

## Torrent performance track

For authorized peer/torrent media record:

- time to torrent metadata;
- time to selected file;
- time to first verified playable range;
- time to first frame;
- seek to a not-yet-played range;
- recovery after interruption;
- background completion;
- integrity-verification completion;
- transition to Ready offline.

Browser runs are marked **WebRTC-capable only**. Desktop native runs cover the complete torrent engine path.

## Source references

Current YouTube viewer reference material used by this lab includes:

- Autoplay: https://support.google.com/youtube/answer/6327615
- Inline playback: https://support.google.com/youtube/answer/7640367
- Queue: https://support.google.com/youtube/answer/9546304
- Playlists: https://support.google.com/youtube/answer/57792
- Watch Later: https://support.google.com/youtube/answer/56101
- Chapters: https://support.google.com/youtube/answer/9884579
- Video quality behavior: https://support.google.com/youtube/answer/91449
- Shorts experience: https://support.google.com/youtube/answer/13363900
- Shorts remix: https://support.google.com/youtube/answer/10623810
- Live streams: https://support.google.com/youtube/answer/15270973
- Cast/TV companion: https://support.google.com/youtube/answer/7640706
- YouTube's June 2026 Shorts UX update: https://blog.youtube/news-and-events/youtube-shorts-experience-updates-features/
- YouTube's May 2026 conversational search announcement: https://blog.youtube/news-and-events/youtube-news-google-io-2026/

## Lab completion signature

The lead records:

- date;
- WebFlix SHA;
- YouTube reference date/context;
- participating workers;
- matrix completion count;
- intentionally-out-of-scope rows with rationale;
- J40 result;
- J41 result;
- J42 result;
- screenshots/snapshots;
- performance traces;
- final acceptance decision.
