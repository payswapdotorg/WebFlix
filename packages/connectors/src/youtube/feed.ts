/**
 * @wfx/connectors — the YouTube BYOF feed projection (R20-B, Lane B).
 *
 * PURE functions: documented API shapes → frozen `ConnectorFeedItem`s.
 * The projection carries the BYOF truth laws structurally:
 *
 * - SOURCE-NATIVE ORDER: subscriptions.list returns the follow graph in
 *   documented reverse-chronological (most-recent-first) ARRAY order — the
 *   index becomes `sourceOrder` and `orderSemantics` records what the order
 *   MEANS. Playlist items carry the provider's own `snippet.position`.
 *   Nothing here ranks, scores, or reorders as WebFlix recommendation.
 * - PROVENANCE: every item's container (`sourceRef`: 'LL', 'WL', the
 *   playlist id; follows have none — the subscription graph is the
 *   relationship), the source's own update timestamp, and the title as the
 *   source reports it round-trip verbatim.
 * - HONEST FIELDS ONLY: a channel is NOT an EntertainmentItem (the WFX-054
 *   projection law) — follow items reference the CHANNEL id as the external
 *   identity and leave canonical typing to the composition layer; no
 *   fabricated video metadata, no invented positions.
 */

import type { ConnectorFeedItem, FeedRelationship } from "@wfx/domain";

import type {
  YouTubePlaylistItemListResponse,
  YouTubePlaylistSummary,
  YouTubeSubscriptionListResponse,
} from "./api";

// ---------------------------------------------------------------------------
// The YouTube API-route relationship truth
// ---------------------------------------------------------------------------

/**
 * The relationships the authorized API route can actually expose — the
 * request-filter truth (anything else is the typed `unsupported` verdict):
 *
 * - `follow`      — subscriptions.list(mine=true), the follow graph;
 * - `like`        — playlistItems.list on "LL" (the liked-videos playlist);
 * - `watchlist`   — playlistItems.list on "WL" (Watch Later);
 * - `playlist`    — playlists.list(mine=true) + playlistItems.list per
 *                   playlist (the playlist containers).
 *
 * NOT exposable over the documented Data API (honest absences):
 * - `history`  — the watch history is not served by the YouTube Data API
 *   v3 (it is only available in the user's Google Takeout export);
 * - `ranked-feed` — the personalized home feed has no exportable API;
 * - `subscription`/`save`/`unknown` — vocabulary the API route never
 *   produces.
 */
export const YOUTUBE_FEED_RELATIONSHIPS: readonly FeedRelationship[] = [
  "follow",
  "like",
  "watchlist",
  "playlist",
] as const;

/** Default page sizes: one deterministic page per list (the SDK page law). */
export const YOUTUBE_FEED_SUBSCRIPTIONS_MAX = 50;
export const YOUTUBE_FEED_PLAYLISTS_MAX = 25;
export const YOUTUBE_FEED_PLAYLIST_ITEMS_MAX = 50;

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * Project subscriptions.list items into follow-graph feed items.
 * `sourceOrder` = the array index (the documented most-recent-first order);
 * `sourceUpdatedAt` = `snippet.publishedAt` (when the subscription was
 * added); the followed CHANNEL id is the external identity (no container:
 * the subscription graph is the relationship itself).
 */
export function projectSubscriptions(
  response: YouTubeSubscriptionListResponse,
): ConnectorFeedItem[] {
  return response.items.map((item, index): ConnectorFeedItem => {
    const thumbnail = item.snippet.thumbnails?.["default"]?.url;
    return {
      externalRef: item.snippet.resourceId.channelId,
      relationship: "follow",
      sourceOrder: index,
      title: item.snippet.title,
      sourceUpdatedAt: item.snippet.publishedAt,
      metadata: {
        subscriptionId: item.id,
        ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail } : {}),
      },
    };
  });
}

/**
 * Project one playlist's playlistItems.list page into playlist feed items.
 * `sourceRef` = the playlist id (the container); `sourceOrder` =
 * `snippet.position` (the provider's OWN native order — the strongest
 * source-order truth); `sourceUpdatedAt` = the item's `snippet.publishedAt`
 * (when the video was added to the playlist).
 */
export function projectPlaylistFeedItems(
  playlistId: string,
  response: YouTubePlaylistItemListResponse,
): ConnectorFeedItem[] {
  return response.items.map((item): ConnectorFeedItem => {
    const thumbnail = item.snippet.thumbnails?.["default"]?.url;
    return {
      externalRef: item.snippet.resourceId.videoId,
      relationship: "playlist",
      sourceOrder: item.snippet.position,
      sourceRef: playlistId,
      title: item.snippet.title,
      sourceUpdatedAt: item.snippet.publishedAt,
      metadata: {
        playlistItemId: item.id,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        videoPublishedAt:
          item.contentDetails.videoPublishedAt !== undefined
            ? item.contentDetails.videoPublishedAt
            : undefined,
        ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail } : {}),
      },
    };
  });
}

/** Project the special playlists' items (LL = likes, WL = watch later). */
export function projectSpecialPlaylistItems(
  playlistId: "LL" | "WL",
  response: YouTubePlaylistItemListResponse,
): ConnectorFeedItem[] {
  // The literal comparison is deliberate: importing the connector-module
  // constants here would close an import cycle (connector.ts imports this
  // module for onImportFeed); the "LL"/"WL" values are the documented
  // constants the connector module itself re-exports.
  const relationship: FeedRelationship = playlistId === "LL" ? "like" : "watchlist";
  return response.items.map((item, index): ConnectorFeedItem => {
    const thumbnail = item.snippet.thumbnails?.["default"]?.url;
    return {
      externalRef: item.snippet.resourceId.videoId,
      relationship,
      // The special playlists are served in their own native order; LL/WL
      // rows carry a position in the documented response — use it when the
      // provider reports one, else the array index.
      sourceOrder: Number.isInteger(item.snippet.position) ? item.snippet.position : index,
      sourceRef: playlistId,
      title: item.snippet.title,
      sourceUpdatedAt: item.snippet.publishedAt,
      metadata: {
        playlistItemId: item.id,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail } : {}),
      },
    };
  });
}

/**
 * The playlist containers the import route will read: the user's own
 * playlists (first page of playlists.list), each with the item budget the
 * bounded import discipline allows.
 */
export function playlistContainers(
  response: { items: YouTubePlaylistSummary[] },
): { playlistId: string; title: string; itemCount: number }[] {
  return response.items.map((playlist) => ({
    playlistId: playlist.id,
    title: playlist.snippet.title,
    itemCount: playlist.contentDetails.itemCount,
  }));
}

/** The special playlist containers the route reads (documented constants). */
export function specialPlaylistContainers(): { playlistId: "LL" | "WL"; title: string }[] {
  return [
    { playlistId: "LL", title: "Liked videos" },
    { playlistId: "WL", title: "Watch Later" },
  ];
}
