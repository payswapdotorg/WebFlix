# WebFlix Bring Your Own Feed Architecture

**Status:** FROZEN FOR IMPLEMENTATION
**Version:** 1.0
**Date:** 2026-09-19

## Purpose

Bring Your Own Feed (BYOF) is a first-class WebFlix capability layered on the existing Connector SDK, Entertainment Graph, Intent Graph, Recommendation OS, and shared client runtime.

BYOF lets a user bring an existing feed relationship from another platform into WebFlix instead of requiring WebFlix to reconstruct a brand-new recommendation feed first.

BYOF is not synonymous with "connect source". Source connection authenticates access; BYOF imports or mirrors the user's existing feed relationships and feed inputs.

## Product modes

WebFlix exposes three conceptually distinct discovery modes:

1. **WebFlix** — WebFlix Recommendation OS chooses candidates under the user's explicit intent/policy.
2. **Following / Native** — WebFlix shows items from the user's current connected follows/subscriptions/playlists when the source exposes them.
3. **BYOF** — WebFlix imports or continuously synchronizes an external feed relationship into a source-neutral WebFlix feed.

The user can switch modes without losing their WebFlix personalization.

## What BYOF may import

Only information available through an authorized connector or a user-supplied export/import artifact:

- followed creators/channels/accounts;
- subscriptions;
- playlists/watchlists/lists where exposed;
- liked/saved items where exposed;
- feed/export snapshots;
- supported platform-specific historical preference data;
- source-specific feed configuration that can be represented without circumventing access controls.

A BYOF import may be a one-time snapshot or a continuously synchronized feed, depending on the connector's actual capabilities.

## What BYOF must not do

- scrape authenticated/private pages;
- defeat bot controls, CAPTCHAs, rate limits, access controls, or DRM;
- infer private feed state from hidden endpoints;
- claim that an imported feed is live when the source only supplied a snapshot;
- silently convert source-native ranking into WebFlix ranking;
- overwrite the user's long-term WebFlix recommendation profile merely because the imported feed is concentrated;
- expose provider credentials to models;
- bypass a provider's documented API/export limitations.

## Feed provenance

Every imported feed record carries provenance:

- source connector;
- import method (api, official-export, user-file, snapshot);
- captured/imported timestamp;
- freshness/synchronization state;
- source reference when available;
- authorization status;
- whether the item came from an external ranked feed, a follow relationship, a playlist/list, or a historical preference artifact.

WebFlix never presents stale or snapshot data as live.

## Canonical identity

Imported items are normalized into the Entertainment Graph.

External feed record
        |
        v
Connector / Import adapter
        |
        v
Canonical Entertainment Item
        |
        +--> Source Realization
        |
        +--> Feed Provenance
        |
        +--> Optional User Intent / Follow relation

The canonical item remains source-neutral. The source realization remains the playback/action boundary.

## Recommendation interaction

BYOF is an input mode, not a hidden recommendation override.

The system must distinguish:

- **source-native ordering** — this is the order the source gave us;
- **WebFlix ranking** — WebFlix reordered or augmented this feed;
- **hybrid mode** — source-native items plus WebFlix discovery candidates.

The UI must make the mode understandable without exposing implementation jargon.

A concentrated BYOF feed must not permanently tunnel the profile. Imported follows/preferences are signals with bounded provenance and configurable influence.

## Sync model

Connect/import
      |
      v
Preview
      |
      v
User confirms
      |
      v
Import snapshot
      |
      +--> normalized graph records
      |
      +--> feed provenance
      |
      +--> optional continuous sync
                     |
                     v
              source changed
                     |
                     v
                 reconcile

Reconciliation is idempotent and preserves the user's WebFlix-local actions.

## Failure truth

The feed surface distinguishes:

- live;
- snapshot;
- stale;
- reauthorization-required;
- unsupported;
- degraded.

A source disappearing must not erase the user's previously imported graph/library state unless the user explicitly requests deletion.

## Platform model

BYOF is implemented once in the shared client/runtime and Experience API.

- Web: feed import UX, source auth/import preview, feed selection.
- Desktop: import-file picker, background synchronization, richer local cache where supported.
- Mobile: future adapter over the same contracts; no duplicated feed semantics.

## Acceptance

BYOF is complete only when J33 passes on Web and Desktop for at least one real connector/import route and all capability limitations remain explicit.