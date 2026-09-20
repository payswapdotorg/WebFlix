# WebFlix — R24 YouTube Parity + Playback Performance Lab

Date: 2026-09-20  
Depends on: R23 shared contracts; the lab itself may begin as soon as R23 contracts are frozen and may run concurrently with R23 implementation.  
Status: APPROVED EXECUTION PLAN

## Goal

Make WebFlix feel as immediately understandable and effortless to watch as a mature YouTube viewer experience while preserving WebFlix's broader Universal Entertainment OS mission.

R24 is not a visual clone of YouTube and does not copy YouTube branding, icons, copy, or implementation. It is a parity lab:

- inventory the relevant viewer-facing YouTube capabilities;
- pair every capability with an explicit WebFlix treatment;
- keep WebFlix-only capabilities;
- place those capabilities in interaction locations that would feel natural if YouTube had introduced them;
- prove Web/Desktop semantic parity;
- make supported videos start with no unnecessary friction or WebFlix-only waiting;
- preserve torrent as a first-class realization rather than a secondary download flow.

## Current YouTube reference scope

The lab is based on the observable viewer product rather than the entire YouTube creator/business backend.

Reference areas include:

- Home/discovery and suggested content;
- search, search refinement and conversational/natural-language discovery;
- long-form Watch;
- Shorts;
- player controls and playback preferences;
- inline playback while browsing;
- autoplay and next-up;
- queue;
- watch history and Watch Later;
- playlists;
- subscriptions/channel following;
- likes/dislike or current feedback affordances;
- comments and sharing;
- chapters and transcripts;
- captions, quality and playback speed;
- live streams and live chat;
- casting / second-screen continuation where a platform supports it;
- offline/download paths where rights and platform capability permit;
- notifications;
- cross-device continuity.

YouTube's own current documentation confirms, among other things, queueing, playlists/Watch Later, inline playback, autoplay, chapters, adaptive quality selection, Shorts interactions/remix, live chat, and casting/companion behavior. R24 treats those as reference behaviors to pair, not as implementation constraints.

## R24-A — Shared parity taxonomy

Worker 1 freezes the shared parity record.

Each row must contain:

- `referenceCapability`;
- `referenceSurface`;
- `referenceBehavior`;
- `webflixTreatment`;
- classification: `parity | native-equivalent | platform-variant | intentionally-out-of-scope`;
- user entry point;
- Web/Desktop applicability;
- anonymous/auth requirement;
- source/realization implications;
- persistence expectation;
- accessibility requirement;
- performance relevance;
- test/journey ID;
- evidence link;
- implementation owner;
- dependency IDs.

No feature may remain "to be considered" after the lab review.

## R24-B — YouTube-consistent WebFlix extension law

WebFlix adds capabilities that YouTube does not have. These remain product features, but they must use the same interaction grammar:

1. A user encounters the feature at the point of intent.
2. The feature has one obvious primary action.
3. Detail is progressively disclosed.
4. The feature does not require visiting an architecture/diagnostics dashboard to understand it.
5. State and terminology remain stable between Home, Watch, Shorts and Library.
6. Platform differences are expressed as capability truth, not redesigned product semantics.

WebFlix-only features to preserve and place through this law include:

- source-neutral canonical identity;
- Where to watch / realization switching;
- authorized peer/torrent copies;
- Bring Your Own Feed;
- WebFlix / Following / imported / Blend feed modes;
- explicit session intent;
- Mindful / Balanced / Immersive / Custom attention policy;
- anti-tunnel recommendation controls;
- WebFlix/BYOM/local model selection;
- transcript/translation/dubbing/commentary/visual Q&A;
- semantic moment search;
- contained provider BrowserHost;
- local media and verified offline Library assets;
- provenance and model/license transparency.

These are not optional extras for the parity lab; they are part of the WebFlix identity.

## R24-C — Feature pairing matrix

The lab must map the viewer experience end-to-end.

### Discovery

| YouTube behavior | WebFlix pairing |
|---|---|
| Home feed | Home discovery with source-neutral cards and explicit intent controls |
| Search | Unified source-neutral Search with exact, semantic and moment retrieval |
| Search suggestions | WebFlix suggestions plus optional voice/AI query |
| Related/next videos | WebFlix recommendation policy + source-neutral realizations |
| Inline playback | Inline previews where platform capability and user attention policy allow |
| Subscriptions | Following plus native/BYOF relationship semantics |
| Shorts surface | Shorts |

### Watch/player

| YouTube behavior | WebFlix pairing |
|---|---|
| Play/pause | Same familiar control placement and keyboard behavior |
| Seek/scrub | Same direct manipulation model |
| Volume/mute | Same player-local control |
| Fullscreen | Same player affordance |
| Miniplayer/PiP where supported | Platform capability equivalent |
| Playback speed | Player settings |
| Quality | Source/player quality selection where exposed |
| Captions | AI/provider/local subtitle paths |
| Transcript | Timestamped transcript |
| Chapters | Chapter rail/list + semantic chapter fallback |
| Autoplay | Attention-policy-aware autoplay |
| Up next | Source-neutral next content |
| Queue | Session queue + save queue to Library/playlist where supported |
| Share | Canonical WebFlix link + source link when appropriate |
| Like/save | Existing action model |
| Feedback | Existing recommendation feedback |
| Comments/reactions | Provider/social actions where authorized |
| Watch history | WebFlix History |
| Watch Later | Watchlist |
| Playlists | WebFlix playlists/library collections |
| Live playback | Supported live realization |
| Live chat | Provider/realization-specific live interaction when supported |
| External handoff | Return-context-preserving source handoff |
| Cast/second screen | Platform adapter capability, not fake universal support |

### Shorts

| YouTube behavior | WebFlix pairing |
|---|---|
| Vertical swipe/binge | ShortsFeed |
| Like/save/share | Existing hydrated Shorts actions |
| Sound / related content | Canonical audio/source links where available |
| Remix/source attribution | Authorized source-aware remix/reference path |
| Clear-screen style viewing | WebFlix distraction-free presentation under attention policy |
| Speed controls | Shorts player controls |
| Recommendation feedback | Inline Shorts feedback |

### Identity and continuity

| YouTube behavior | WebFlix pairing |
|---|---|
| Account-based history | Account history |
| Anonymous public viewing | WebFlix accountless public viewing |
| Cross-device continuity | Shared server-side profile/library state |
| Source subscription relationships | Following + BYOF |
| Notifications | Web/desktop notification adapter when supported |
| TV/second-screen continuation | Platform adapter where supported |

## R24-D — First-class torrent parity

Torrent must be present in the same user decision flow as any other playable realization.

A user should encounter:

**Where to watch**
- WebFlix
- Authorized peer copy
- Provider/source realization
- External source

The torrent path must:

- use the same title/item/player language;
- share resume/watch-state semantics;
- start playback from verified available media before full completion where the platform supports it;
- surface buffering honestly;
- preserve background completion and recovery;
- expose verified offline only after integrity requirements are satisfied;
- never be reduced to "download file" when it can actually play;
- never bypass authorization, DRM, CAPTCHA or provider controls.

Web browser torrent support remains limited to WebRTC-capable peer scenarios; Desktop remains the full native torrent path.

## R24-E — Playback performance contract

The product requirement is "videos should load just as easily as YouTube."

The lab therefore compares WebFlix with YouTube using the same device, browser, network profile and content whenever the same public video is available on both.

### Primary metrics

- navigation-to-player-visible;
- click-to-first-frame (TTFF);
- click-to-audible playback where applicable;
- time-to-playable;
- startup failure rate;
- first 60-second rebuffer ratio;
- seek response latency;
- player control responsiveness;
- recovery time after a transient network failure.

### Initial hard thresholds for the lab

Against the same-content YouTube baseline:

- p50 TTFF: WebFlix no more than 150 ms slower;
- p75 TTFF: no more than 300 ms slower;
- p95 TTFF: no more than 750 ms slower;
- startup failure rate: no more than 0.5 percentage points worse;
- first-60-second rebuffer ratio: no more than 0.25 percentage points worse;
- supported content requires one obvious primary play action;
- nonessential metadata, recommendations, AI indexing and analytics must not block first-frame playback.

These thresholds are lab acceptance targets. The lead may tighten them after baseline measurement, but must not silently loosen them.

### Startup architecture laws

- resolve the canonical item and playback realization without an unnecessary serial chain;
- do not wait for recommendation or AI enrichment before playback;
- preload/preconnect only where it produces measured benefit;
- fetch poster/metadata independently from the media startup critical path;
- use adaptive quality where the underlying realization exposes quality choices;
- maintain stable player chrome while media initializes;
- for authorized torrent playback, prioritize the verified ranges needed for immediate playback rather than waiting for full completion;
- when a realization cannot start, expose the next supported way to watch with minimal ceremony;
- never show fake buffering progress.

## R24-F — UX/UI parity lab

The lead coordinates a live lab session with all three workers.

### Session 1 — Feature inventory

Worker 1 presents the parity taxonomy. Workers 2 and 3 challenge missing viewer features from Web and Desktop.

### Session 2 — Journey walkthrough

Workers 2 and 3 walk the same representative tasks:

1. arrive anonymous;
2. discover a video;
3. open Watch;
4. start playback;
5. change speed/quality/captions;
6. scrub/seek;
7. view transcript/chapters;
8. add to queue/watchlist/playlist;
9. like/save/share/feedback;
10. continue to another video;
11. use Shorts;
12. use search to locate a moment;
13. switch realization to an authorized peer/torrent copy;
14. continue from the same position;
15. use AI transformations;
16. view Library/history;
17. switch platform/device where available.

The lab uses the running product and agent-browser, not static mockups alone.

### Session 3 — Extension consistency review

For each WebFlix-only capability, the lab asks:

- Where would a YouTube user naturally expect this control?
- Does it appear in context rather than settings-only?
- Is the wording concise?
- Is the primary action obvious?
- Does it preserve the same card/player/action grammar?
- Does it work without login when identity is not required?
- Does it degrade honestly by platform/source capability?
- Is it visibly distinct from engineering diagnostics?

### Session 4 — Performance run

Run the same representative media through:

- WebFlix direct/owned playback where available;
- provider embed/browser realization where applicable;
- authorized torrent/peer realization where supported;
- YouTube baseline when the identical content is publicly available.

Run both cold-cache and warm-cache passes and record the complete metric set.

## R24-G — Three-worker implementation split

### Worker 1 — Shared

Own:

- R24-A parity taxonomy;
- shared performance telemetry contract;
- playback startup instrumentation types;
- feature capability matrix;
- shared terminology/placement contracts;
- parity regression tests;
- recommendation/autoplay interaction policy seams.

Allowed paths:
- packages/client-runtime/**
- packages/platform-contracts/**
- packages/domain/**
- packages/experience/**
- packages/recommendation/**
- packages/model-fabric/**
- packages/actions/**
- docs/** for assigned contract artifacts.

### Worker 2 — Web

Own:

- viewer-facing YouTube feature audit on Web;
- Web parity UI corrections;
- inline/miniplayer/player-control parity where applicable;
- search/Watch/Shorts/Library parity;
- performance instrumentation and benchmark harness in Web;
- cold/warm playback measurements;
- WebTorrent/browser parity evidence where technically supported;
- agent-browser evidence.

Allowed paths:
- apps/web/**
- approved Web journey/evidence paths.

### Worker 3 — Desktop/native/torrent

Own:

- Desktop YouTube-parity interaction audit;
- native player affordance parity;
- torrent-first Where-to-watch parity;
- torrent startup/recovery performance;
- local/offline parity;
- Desktop performance evidence;
- platform-specific cast/background/native capability truth.

Allowed paths:
- apps/desktop/**
- packages/native-media/**
- packages/torrent-engine/**
- approved Desktop journey/evidence paths.

### Lead

Own:

- feature inventory completeness;
- parity classification ratification;
- source verification against current YouTube viewer behavior;
- design-law ratification;
- cross-lane shared contract changes;
- comparative performance test protocol;
- integration;
- final J40-J42 acceptance;
- production verification.

## Dependency graph

R23 contracts -> R24-A/B/C lab lanes (parallel)
R24-A + R24-B + R24-C -> R24-D parity matrix + performance baseline
R24-D -> Web/desktop implementation lanes
R24 implementation -> J40 + J41 + J42 -> affected J01-J39 -> production acceptance

The parity lab may begin while R23 implementation is underway after R23 shared contracts are frozen. It must not create a second product architecture.

## Acceptance journeys

### J40 — YouTube viewer parity

Fresh user, no documentation:

Home -> search -> open video -> play -> use player controls -> browse inline/adjacent content -> queue/watchlist/playlist -> Shorts -> feedback -> Library/history.

Acceptance:
- every exercised YouTube behavior has a WebFlix pairing in the matrix;
- the WebFlix-only controls encountered in the same flow feel contextual rather than administrative;
- no dead buttons or placeholder capability labels;
- Web/Desktop semantics agree.

### J41 — YouTube-equivalent playback startup

For each benchmark title:

- same content;
- same browser/device;
- same network profile;
- cold cache;
- warm cache;
- WebFlix and YouTube baseline where possible.

Acceptance:
- thresholds in R24-E pass;
- no serial WebFlix API chain blocks startup;
- no AI/recommendation work blocks playback;
- torrent authorized peer playback starts from verified playable data where supported;
- transient failures recover with a useful next action.

### J42 — WebFlix extension parity

Exercise:

canonical identity -> Where to watch -> provider/peer/torrent realization -> BYOF context -> recommendation intent/attention -> AI actions -> semantic moment search -> Library/offline/provenance.

Acceptance:
- each WebFlix-only feature has an explicit parity/placement row;
- placement is contextual and familiar;
- no feature requires an architecture dashboard;
- torrent remains first-class;
- anonymous viewing remains frictionless;
- platform capability differences remain honest.

## R24 rejection criteria

Reject the implementation when:

- a viewer-facing YouTube capability is missing from the parity inventory;
- a WebFlix-only feature is exposed only in Settings/diagnostics without a contextual path;
- Web and Desktop invent different product semantics for the same feature;
- playback waits on nonessential recommendation/AI calls;
- the player requires a login when the realization is public and no durable identity is needed;
- torrent is framed only as "download/offline" when playback is supported;
- the UI visually clones YouTube branding instead of adopting familiar interaction grammar;
- a benchmark passes through synthetic fixture behavior rather than real production wiring.

## Completion truth

R24 is green only when:

- the parity matrix is complete and source-verified;
- J40, J41 and J42 pass on the applicable production-capable adapters;
- affected J01-J39 are rerun;
- Web/Desktop evidence is fresh;
- performance traces are attached;
- all WebFlix-only features have a contextual placement decision;
- no regressions are introduced to anonymous viewing, torrent first-class status, BYOF, AI/model controls or Library continuity.
