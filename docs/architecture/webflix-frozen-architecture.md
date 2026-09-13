# WebFlix Frozen Architecture

**Status:** FROZEN FOR IMPLEMENTATION
**Version:** 1.0
**Date:** 2026-09-13
**Canonical product identity:** Universal Entertainment OS

## Product thesis

WebFlix is the user's primary interface to entertainment, not a replacement for every media provider. The user expresses entertainment intent; WebFlix discovers, ranks, resolves, and presents content from connected services, social/video platforms, native media, local libraries, and authorized native sources. Providers remain sources of supply where WebFlix cannot legally or technically own the playback stream.

The central abstraction is **Entertainment Item**, not platform. The user should normally perceive one continuous WebFlix experience even when playback is native, embedded, or rendered inside an in-app browser surface.

## Product invariants

1. User intent is primary. A recent watch is one signal, not a permanent identity.
2. Entertainment is cross-source. Source identity is secondary to content identity.
3. Capabilities are explicit. Every connector declares actual discovery, playback, action, download, and transformation capabilities.
4. Provider boundaries are respected. No access-control or DRM circumvention.
5. Native acquisition is for user-owned, licensed, public-domain, Creative Commons, or otherwise authorized media.
6. Recommendation is user-controlled. Users may use WebFlix models, bring a model, use local models, or define policies.
7. Engagement is an objective, not the default. Mindful/Balanced/Immersive/Custom attention modes are explicit.
8. One content identity, many realizations. Source is a realization, not the canonical identity.
9. Cross-platform clients share domain contracts.
10. No hidden mocks; claimed provider capability must be real or explicitly unsupported.

## System boundaries

### Experience Core
Navigation, feeds, cards, watch state presentation, playback intent, library UX, profiles, social actions, settings. It never calls provider SDKs directly.

### Connector SDK
Stable interface between WebFlix and an external/local source: identity, auth, search, metadata, playback realization, user actions, availability, library sync, and permitted transformations.

### Entertainment Graph
Canonical entity graph for content, creators, topics, source realizations, relationships, events, and derived features.

### Intent Graph
Persistent interests, temporary interests, session intent, momentary constraints, social intent, and user-created objectives with scope, confidence, provenance, and expiry.

### Recommendation OS
Candidate generation -> feature assembly -> model scoring -> policy constraints -> intent-aware diversity -> feed composition.

### Model Fabric
Provider-neutral gateway for recommendation/ranking plus permitted summarization, translation, transcription, speech, dubbing, and commentary.

### Media Surface
One WebFlix playback shell with four realization modes: Native, Embedded, Browser, External.

### Native Media Service
A separately packaged native service, preferably Rust around mature media/torrent libraries. It owns media sessions, piece prioritization, deadline-aware streaming, integrity verification, local cache, range access, and background completion. Protocol internals never leak into product core.

### Platform Adapters
Web, desktop, iOS, and Android translate lifecycle/storage/browser/playback/casting capabilities into shared contracts.

## Playback resolution

`EntertainmentItem -> SourceRealization -> CapabilityResolution -> PlaybackSession -> MediaSurface`

Precedence:

1. Native when WebFlix controls the media path and the device can play it.
2. Official embed when the provider exposes a supported player contract.
3. In-app browser when provider web playback is permitted.
4. External handoff otherwise.

Browser mode is a UX surface, not a mechanism for defeating provider security.

## Experience modes

**Watch Feed:** long-form, episodic continuity, resume, quality/audio/subtitle controls.

**Short Feed:** vertical, swipe-driven, rapid candidate replacement and session-aware ranking.

Source does not choose feed mode; content and session context do.

## Recommendation principles

The recommender distinguishes long-lived preference, current session intent, momentary context, exploration appetite, social preferences, source availability, repetition, and fatigue. A single watched topic must never permanently narrow the user profile.

## Attention policy

Mindful, Balanced, Immersive, and Custom modes are explicit policy. The system does not silently optimize for maximum session length when the user selected a different objective.

## Cross-platform strategy

Web is broad but browser-constrained. Desktop is the reference full-power native client. Mobile uses native media/platform facilities and OS-constrained background behavior. All share domain semantics and event vocabulary.

## Technology guidance

- Web: Next.js + TypeScript.
- Shared contracts: TypeScript plus generated schemas where useful.
- Server persistence: PostgreSQL-compatible.
- Native media: Rust preferred; mature media/torrent libraries behind a narrow adapter.
- FFmpeg for permitted inspection/remux/transcode.
- Desktop: Tauri or equivalent native shell.
- Mobile: native bridges where needed to preserve storage/playback/browser capabilities.
- Jobs: transactional outbox + durable workers initially.

## Explicit non-goals

- Owning a general content index as a product dependency.
- Circumventing provider access controls, DRM, anti-bot systems, or subscription requirements.
- Reimplementing the torrent protocol.
- Pretending every provider is natively playable.
- Making a proprietary foundation model a launch prerequisite.
