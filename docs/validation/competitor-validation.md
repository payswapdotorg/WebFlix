# WebFlix Competitor Validation

**Status:** FROZEN INPUT TO IMPLEMENTATION
**Date:** 2026-09-16

This document records current public competitor capabilities used to pressure-test the WebFlix implementation. It is not a product-ranking document; it identifies concrete capabilities and lessons that the implementation must account for.

## YouTube

Current YouTube documentation describes recommendation inputs including watch history, search history, subscriptions, likes, dislikes, and `Not interested` feedback. YouTube also documents controls for suppressing channels and clearing feedback/history. Sources:

- https://support.google.com/youtube/answer/16089387
- https://support.google.com/youtube/answer/6342839

Implementation lessons:

- recommendation feedback must be immediate;
- feedback must be reversible;
- long-form and Shorts session behavior need distinct surface logic;
- recommendation history controls must exist;
- one watched topic cannot silently become a permanent identity.

## Netflix

Current Netflix documentation describes profile-specific recommendation state, viewing history, Continue Watching, settings, and a recommendation system that considers viewing history, recent behavior, title information, time of day, preferred language, device, and watch duration. Netflix also provides a dedicated `My Netflix` destination on its updated TV experience.

Sources:

- https://help.netflix.com/en/node/100639
- https://help.netflix.com/en/node/321880164349028
- https://help.netflix.com/en/node/22205
- https://help.netflix.com/en/node/115312

Implementation lessons:

- profiles are real personalization boundaries;
- recent behavior should have stronger influence without deleting long-term preferences;
- Continue Watching is a first-class product surface;
- users need to remove/hide history influence;
- downloads/native availability should integrate with the normal viewing lifecycle.

## Plex

Current Plex documentation describes Discover, configured streaming services, universal details, Universal Watchlist, and lists. Plex lets users tell the product which services they have access to and then shows where content is available.

Sources:

- https://support.plex.tv/articles/discover/
- https://support.plex.tv/articles/universal-watchlist/
- https://support.plex.tv/articles/lists/

Implementation lessons:

- source configuration is a user-facing product flow;
- universal content identity and availability are central to aggregator value;
- Watchlist/Library must be source-neutral;
- lists and social curation are useful extension points;
- external streaming services may still require leaving the app, creating a continuity gap that WebFlix's BrowserHost is intended to reduce where permitted.

## Stremio

Current Stremio materials document desktop, mobile, web, TV and other platform variants; magnet-link and torrent-file playback; caching; and recent work on torrent buffering, downloads, profile UX, and player behavior.

Sources:

- https://www.stremio.com/downloads
- https://addons.stremio.com/
- https://blog.stremio.com/stremio-tech-update-80-stremio-v5-stremio-web-updated/

Implementation lessons:

- native/torrent media must be a first-class playback path;
- Desktop and Web need clearly differentiated capability envelopes;
- native acquisition state must be visible in the player;
- future platform expansion is an adapter problem, not a new product;
- torrent buffering and background/cache state need explicit UX.

## WebFlix synthesis

The implementation must integrate the lessons rather than reproduce any competitor surface independently:

```text
YouTube
  -> discovery depth + rapid recommendation feedback

Netflix
  -> profile continuity + Continue Watching + persistent personalization

Plex
  -> universal content identity + availability + source configuration + watchlist

Stremio
  -> native media + magnet/torrent support + cross-platform adapters

WebFlix
  -> adds explicit intent + attention policy + BYOM/local model control
             + contained BrowserHost + source/action capability truth
             + one shared runtime across Web/Desktop/future Mobile
```

The resulting product must remain compliant with provider authorization boundaries and the native-media policy in `docs/architecture/product-boundaries.md`.
