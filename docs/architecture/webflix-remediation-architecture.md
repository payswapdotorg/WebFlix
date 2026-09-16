# WebFlix Remediation Architecture — Approved Freeze

**Status:** FROZEN FOR IMPLEMENTATION
**Version:** 2.0 remediation freeze
**Date:** 2026-09-16
**Canonical product identity:** Universal Entertainment OS

## Purpose

This document supersedes the client, native-media, acquisition, validation, and worker-allocation portions of the earlier WFX-001–043 implementation sequence. The original frozen architecture remains the domain foundation; this document is the canonical remediation architecture for completing the actual product.

## Product outcome

WebFlix is one entertainment experience over many authorized supply paths. The user should think in terms of **what to watch**, **why it is being recommended**, **where it can be played**, and **whether WebFlix can make it available locally**. Source identity is secondary to the canonical Entertainment Item.

The product must combine:

- streaming/provider sources;
- social/video sources;
- local media;
- authorized native/torrent media;
- one library/history;
- one recommendation and intent system;
- one playback surface;
- shared Web and Desktop experience semantics;
- a future Mobile adapter without rewriting product logic.

## Non-negotiable product invariants

1. User intent is primary; a recent watch is one signal, never permanent identity.
2. Content identity is canonical; source realization is secondary.
3. Provider capabilities are explicit and truthful.
4. Provider DRM, access controls, CAPTCHAs, anti-bot controls, rate limits, geographic restrictions, and private credentials are never circumvented.
5. Native acquisition is limited to user-owned, licensed, public-domain, Creative Commons, or otherwise authorized media.
6. Torrent protocol internals remain behind the native-media boundary and use a mature protocol implementation; WebFlix does not reimplement BitTorrent in product-core TypeScript.
7. Recommendation policy is explicit and user-controlled.
8. Mindful, Balanced, Immersive, and Custom attention modes are policy, not cosmetic settings.
9. Web, Desktop, and future Mobile clients consume shared client/runtime contracts.
10. A fixture is never silently presented as production capability.
11. Every important journey must be browser-validated on a running UI before its work item is accepted.
12. CI/test status is insufficient on its own: source, imports, persistence, platform wiring, and browser journeys are inspected directly.

## Runtime layering

```text
                    Experience Core
                         |
                 Shared Client Runtime
                         |
             Platform Capability Adapter
                /         |          \
             Web      Desktop      Mobile
                         |
                Native Capability Ports
                         |
              +----------+-----------+
              |                      |
        Local Media Engine     Torrent Engine
                                     |
                        Mature BitTorrent library
                                     |
                   Piece map / peers / integrity
                                     |
                        Playback-aware scheduler
                                     |
                        Local media/range gateway
                                     |
                             Media Surface
```

The shared client runtime owns navigation, presentation state, intent submission, library semantics, watch state, playback commands, action state, and error-state semantics. Platform adapters own lifecycle, storage, browser embedding, native media, notifications, background execution, sharing, and other device capabilities.

No platform adapter owns business rules that belong to the Experience Core, Recommendation OS, Entertainment Graph, or Intent Graph.

## Client adapters

### Web adapter

Web is browser-constrained. It supports the common experience, official embeds, provider web playback through a contained BrowserHost when technically permitted, normal browser storage constraints, PWA behavior, and honest unsupported states for native-only functionality.

Web must never silently substitute fixture ports for a production service.

### Desktop adapter

Desktop is the full-power reference client. It must provide:

- real native media engine binding;
- filesystem-backed media/cache storage;
- background acquisition/completion while unfocused;
- persistent native sessions and recovery;
- contained browser surface;
- native playback and local range access;
- OS lifecycle integration;
- Tauri or equivalent native shell.

The Desktop production path must not default to `stubEngine()`.

### Mobile adapter

Mobile is not a separate product implementation. It binds the same shared client runtime to OS-constrained storage, playback, browser, lifecycle, background, notification, and sharing capabilities. The architecture must make adding Mobile an adapter exercise rather than a product rewrite.

## Media Surface

Playback resolution remains:

1. Native
2. Official Embed
3. Contained Browser
4. External handoff

The browser mode is a UX surface, never a circumvention mechanism.

Every realization exposes truthful capability and availability information. The primary consumer experience emphasizes play/resume/save/availability rather than exposing internal capability diagnostics unless requested.

## Native Media Core

`packages/native-media` is the orchestration boundary for local and torrent-backed media.

It owns:

- media sessions;
- storage allocation;
- range reads;
- playback buffering state;
- integrity status;
- background completion;
- scheduler integration;
- error taxonomy;
- recovery;
- native service process lifecycle.

## Torrent Engine

The torrent engine is a first-class implementation stream, not a fixture and not merely a transport helper.

### Inputs

- authorized magnet links;
- authorized `.torrent` metadata/files;
- authorized source realizations resolved from connectors.

### Responsibilities

1. Parse/validate torrent metadata.
2. Acquire metadata for magnets through the mature protocol implementation.
3. Establish and maintain torrent sessions.
4. Track peers and piece availability through the library boundary.
5. Expose file selection before full download.
6. Maintain piece map and verified/unverified state.
7. Verify piece integrity.
8. Support playback-aware piece prioritization.
9. Support deadline scheduling for the next required media ranges.
10. Provide progress and state transitions to the Native Media Core.
11. Persist recoverable torrent/session state.
12. Continue authorized background completion after playback stops or the Desktop app is unfocused.
13. Detect and surface corruption, peer starvation, metadata failures, and interrupted sessions.
14. Produce a locally playable verified asset.

### Explicitly out of scope for the torrent engine

- implementing the BitTorrent protocol from scratch;
- bypassing access controls;
- sourcing infringing catalogs;
- hiding acquisition provenance from the user when disclosure is required;
- making browser clients pretend to have native torrent capabilities they do not have.

## Torrent playback lifecycle

```text
Authorized source
    -> magnet/.torrent
    -> metadata
    -> choose playable file
    -> create torrent session
    -> map media ranges to pieces
    -> prioritize deadline pieces
    -> buffer
    -> play/seek
    -> continue background completion
    -> verify all pieces
    -> persist verified local asset
    -> replay from Library
```

Playback must be possible before the full asset completes when sufficient verified ranges are available. Failure to reach a playback deadline must produce an explicit buffering/recovery state rather than false playback success.

## Acquisition UX

The user-facing states are product states, not torrent jargon:

`Available -> Preparing -> Buffering -> Playing -> Completing -> Ready offline -> Failed/Recoverable`

The user can inspect detailed torrent state from an advanced view, but the primary UX should feel like integrated native media rather than a torrent client.

## Identity, profiles, and library

Authentication and profile state become product primitives.

A profile owns:

- recommendation policy;
- intent history;
- watch history;
- library/watchlist;
- saves;
- native assets;
- connector authorizations;
- personalization controls;
- attention mode;
- model selection.

Cross-device continuity is keyed to the same server-side identity/profile state.

## Source management

Users can:

- connect a source;
- see actual capabilities;
- see authorization state;
- reconnect/reauthorize;
- disconnect;
- inspect source-specific availability;
- see whether an action was synchronized externally or only recorded locally.

## Recommendation UX

The Recommendation OS must expose both the model and policy controls without making the user learn the implementation.

Supported controls include:

- WebFlix model;
- BYOM/model provider;
- local model where supported;
- objective selection;
- novelty/exploration;
- social influence;
- attention mode;
- `More like this`;
- `Not interested`;
- `Don't recommend this source/creator`;
- `I've already watched this`;
- temporary exploration/reset influence;
- explicit intent such as learning, mood, surprise, friend taste, or tonight's viewing.

A watched item can influence the session without permanently dominating the profile.

## AI media transformation

AI capabilities are presented as explicit user actions with progress and results:

- transcription;
- subtitle generation;
- translation;
- permitted dubbing;
- TTS/STT;
- commentary;
- summaries.

Provider credentials never enter model prompts. Model privacy policy is enforced at the runtime boundary.

## Golden journey validation

The canonical journey set is defined in `docs/validation/webflix-golden-journeys.md`.

A work item affecting UI cannot be accepted without running its affected journey against the running application with agent-browser and recording evidence.

The lead independently repeats the relevant journeys after integration.

## Competitor-informed requirements

### YouTube

WebFlix adopts the usability lesson that recommendation feedback must be immediate and reversible: `Not interested`, creator/source suppression, history controls, and distinct treatment of Shorts versus long-form. YouTube documents these controls as inputs into recommendations. Source: `https://support.google.com/youtube/answer/6342839` and `https://support.google.com/youtube/answer/16089387`.

### Netflix

WebFlix adopts the continuity lesson: profile-specific recommendations/history/settings, Continue Watching, and a dedicated library destination. Netflix documents profile-specific recommendation state and recommendation signals including viewing history, recent activity, time/device context, and user feedback. Sources: `https://help.netflix.com/en/node/100639` and `https://help.netflix.com/en/node/321880164349028`.

### Plex

WebFlix adopts the universal-discovery lesson: one watchlist and universal details showing availability across configured services. Plex documents Universal Watchlist and Discover/Streaming Services configuration. Sources: `https://support.plex.tv/articles/universal-watchlist/` and `https://support.plex.tv/articles/discover/`.

WebFlix intentionally pushes further on playback continuity by using its contained BrowserHost where permitted rather than assuming every external service must force the user out of the experience.

### Stremio

WebFlix adopts the native/extensible-media lesson: Stremio supports magnet links/torrent files, desktop/mobile/web variants, and native playback behavior around those sources. Sources: `https://addons.stremio.com/`, `https://www.stremio.com/downloads`, and `https://blog.stremio.com/stremio-tech-update-80-stremio-v5-stremio-web-updated/`.

WebFlix differentiates by combining that native-media capability with universal content identity, source-neutral recommendation policy, explicit user intent, and integrated provider/social playback.

## Completion standard

The product is not accepted when the architecture merely exists. It is accepted when the golden journeys, cross-platform parity, torrent lifecycle, recovery flows, and capability truth are demonstrated against real wired implementations.
