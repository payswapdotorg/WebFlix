/**
 * @wfx/connectors — recorded HTTP fixtures for the YouTube connector
 * (WFX-054, Lane B).
 *
 * Deterministic, network-free test data RECORDED FROM THE DOCUMENTED API
 * SHAPES (YouTube Data API v3 + Google OAuth2 — the shapes in ./api.ts and
 * ./oauth.ts). Google credentials are NOT provisioned in this environment
 * (no OAuth client, no API key — the YOUTUBE_* names are frozen in
 * .env.example but hold no values), so these fixtures encode the
 * documented contracts exactly: field names, nesting, and the documented
 * value grammars (ISO-8601 durations, string counts, special playlist
 * ids). Every fixture value is SYNTHETIC (no real user data, no real
 * video ids). When live credentials are provisioned, scripts/verify-live.ts
 * exercises the real endpoints; these fixtures keep the test suite
 * deterministic forever.
 *
 * `createScriptedYouTubeTransport()` is the test transport: it replays the
 * scripted replies in exact FIFO order, RECORDS every request for
 * assertion, and fails LOUDLY when the script runs dry (an unscripted call
 * is a bug in the test or an unwanted extra API call — never silently
 * answered, mirroring @wfx/actions' fixture-driver honesty laws).
 */

import type {
  YouTubeChannelListResponse,
  YouTubePlaylistItemInsertResponse,
  YouTubePlaylistItemListResponse,
  YouTubeSearchListResponse,
  YouTubeVideoListResponse,
} from "./api";
import type { YouTubeHttpReply, YouTubeHttpTransport } from "./http";

// ---------------------------------------------------------------------------
// Fixture ids (synthetic, format-faithful: video ids are 11 chars, channel
// ids are 24 chars starting with "UC")
// ---------------------------------------------------------------------------

/** Synthetic video ids used across the fixtures (11 chars, [A-Za-z0-9_-]). */
export const FIXTURE_VIDEO_IDS = {
  documentary: "Wfx54Docu001",
  shortVertical: "Wfx54Short01",
  liveStream: "Wfx54Live000",
  notEmbeddable: "Wfx54NoEmbed0",
  regionBlocked: "Wfx54RgnBlk00",
  privateVideo: "Wfx54Private0",
  deletedVideo: "Wfx54Deleted0",
} as const;

/** Synthetic channel id (24 chars, "UC" prefix). */
export const FIXTURE_CHANNEL_ID = "UCWfx54Channel00000000000A";

/** The scripted search query the fixtures answer. */
export const FIXTURE_SEARCH_QUERY = "desert rain documentary";

// ---------------------------------------------------------------------------
// search.list fixtures (two deterministic pages)
// ---------------------------------------------------------------------------

/** search.list page 1: three video results + nextPageToken. */
export const FIXTURE_SEARCH_PAGE_1: YouTubeSearchListResponse = {
  kind: "youtube#searchListResponse",
  etag: "fixture-etag-search-1",
  nextPageToken: "FIXTURE_PAGE_2",
  pageInfo: { totalResults: 5, resultsPerPage: 3 },
  items: [
    {
      kind: "youtube#searchResult",
      etag: "fixture-etag-s1",
      id: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.documentary },
      snippet: {
        publishedAt: "2025-03-14T09:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain — A Night Documentary",
        description: "The first fixture result.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          medium: { url: "https://i.ytimg.com/vi/Wfx54Docu001/mqdefault.jpg", width: 320, height: 180 },
        },
        liveBroadcastContent: "none",
        publishTime: "2025-03-14T09:00:00Z",
      },
    },
    {
      kind: "youtube#searchResult",
      etag: "fixture-etag-s2",
      id: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.shortVertical },
      snippet: {
        publishedAt: "2025-06-01T12:30:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain in 45 Seconds",
        description: "The second fixture result.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          medium: { url: "https://i.ytimg.com/vi/Wfx54Short01/mqdefault.jpg", width: 180, height: 320 },
        },
        liveBroadcastContent: "none",
        publishTime: "2025-06-01T12:30:00Z",
      },
    },
    {
      kind: "youtube#searchResult",
      etag: "fixture-etag-s3",
      id: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.notEmbeddable },
      snippet: {
        publishedAt: "2024-11-30T18:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Rain Over the Dunes (no embeds)",
        description: "The third fixture result.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          high: { url: "https://i.ytimg.com/vi/Wfx54NoEmbed0/hqdefault.jpg", width: 480, height: 360 },
        },
        liveBroadcastContent: "none",
        publishTime: "2024-11-30T18:00:00Z",
      },
    },
  ],
};

/** search.list page 2: two video results, no nextPageToken (last page). */
export const FIXTURE_SEARCH_PAGE_2: YouTubeSearchListResponse = {
  kind: "youtube#searchListResponse",
  etag: "fixture-etag-search-2",
  prevPageToken: "FIXTURE_PAGE_2",
  pageInfo: { totalResults: 5, resultsPerPage: 2 },
  items: [
    {
      kind: "youtube#searchResult",
      etag: "fixture-etag-s4",
      id: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.regionBlocked },
      snippet: {
        publishedAt: "2023-08-08T08:08:08Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Storms, Region Restricted",
        description: "The fourth fixture result.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          default: { url: "https://i.ytimg.com/vi/Wfx54RgnBlk00/default.jpg", width: 120, height: 90 },
        },
        liveBroadcastContent: "none",
        publishTime: "2023-08-08T08:08:08Z",
      },
    },
    {
      kind: "youtube#searchResult",
      etag: "fixture-etag-s5",
      id: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.liveStream },
      snippet: {
        publishedAt: "2026-09-15T10:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "LIVE: Rain over the Desert",
        description: "The fifth fixture result.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          medium: { url: "https://i.ytimg.com/vi/Wfx54Live000/mqdefault_live.jpg", width: 320, height: 180 },
        },
        liveBroadcastContent: "live",
        publishTime: "2026-09-15T10:00:00Z",
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// videos.list fixtures
// ---------------------------------------------------------------------------

/** videos.list: the embeddable public documentary (PT1H2M3S, counts). */
export const FIXTURE_VIDEOS_DOCUMENTARY: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-docu",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-docu",
      id: FIXTURE_VIDEO_IDS.documentary,
      snippet: {
        publishedAt: "2025-03-14T09:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain — A Night Documentary",
        description: "A fixture documentary.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          maxres: { url: "https://i.ytimg.com/vi/Wfx54Docu001/maxresdefault.jpg", width: 1280, height: 720 },
        },
        categoryId: "27",
        liveBroadcastContent: "none",
        tags: ["desert", "rain", "documentary"],
      },
      contentDetails: {
        duration: "PT1H2M3S",
        dimension: "2d",
        definition: "hd",
        caption: "true",
        licensedContent: false,
        projection: "rectangular",
      },
      status: {
        uploadStatus: "processed",
        privacyStatus: "public",
        license: "youtube",
        embeddable: true,
        publicStatsViewable: true,
        madeForKids: false,
      },
      statistics: {
        viewCount: "1234567",
        likeCount: "42",
        favoriteCount: "0",
        commentCount: "7",
      },
    },
  ],
};

/** videos.list: the vertical short (PT45S, 1080x1920 maxres thumbnail). */
export const FIXTURE_VIDEOS_SHORT: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-short",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-short",
      id: FIXTURE_VIDEO_IDS.shortVertical,
      snippet: {
        publishedAt: "2025-06-01T12:30:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain in 45 Seconds",
        description: "A fixture short.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          maxres: { url: "https://i.ytimg.com/vi/Wfx54Short01/maxresdefault.jpg", width: 1080, height: 1920 },
        },
        categoryId: "24",
        liveBroadcastContent: "none",
      },
      contentDetails: {
        duration: "PT45S",
        dimension: "2d",
        definition: "hd",
        caption: "false",
        licensedContent: false,
      },
      status: {
        uploadStatus: "processed",
        privacyStatus: "public",
        license: "youtube",
        embeddable: true,
        publicStatsViewable: true,
        madeForKids: false,
      },
      statistics: { viewCount: "987", likeCount: "12" },
    },
  ],
};

/** videos.list: the ongoing live stream (P0D duration, liveBroadcastContent). */
export const FIXTURE_VIDEOS_LIVE: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-live",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-live",
      id: FIXTURE_VIDEO_IDS.liveStream,
      snippet: {
        publishedAt: "2026-09-15T10:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "LIVE: Rain over the Desert",
        description: "A fixture live stream.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          medium: { url: "https://i.ytimg.com/vi/Wfx54Live000/mqdefault_live.jpg", width: 320, height: 180 },
        },
        categoryId: "24",
        liveBroadcastContent: "live",
      },
      contentDetails: {
        duration: "P0D",
        dimension: "2d",
        definition: "sd",
        caption: "false",
        licensedContent: false,
      },
      status: {
        uploadStatus: "processed",
        privacyStatus: "public",
        license: "youtube",
        embeddable: true,
        publicStatsViewable: true,
        madeForKids: false,
      },
      statistics: { viewCount: "5" },
    },
  ],
};

/** videos.list: public but NOT embeddable (external handoff only). */
export const FIXTURE_VIDEOS_NOT_EMBEDDABLE: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-noembed",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-noembed",
      id: FIXTURE_VIDEO_IDS.notEmbeddable,
      snippet: {
        publishedAt: "2024-11-30T18:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Rain Over the Dunes (no embeds)",
        description: "A fixture video that forbids embedding.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          high: { url: "https://i.ytimg.com/vi/Wfx54NoEmbed0/hqdefault.jpg", width: 480, height: 360 },
        },
        categoryId: "1",
        liveBroadcastContent: "none",
      },
      contentDetails: {
        duration: "PT4M1S",
        dimension: "2d",
        definition: "sd",
        caption: "false",
        licensedContent: true,
      },
      status: {
        uploadStatus: "processed",
        privacyStatus: "public",
        license: "youtube",
        embeddable: false,
        publicStatsViewable: false,
        madeForKids: false,
      },
      statistics: { viewCount: "10" },
    },
  ],
};

/** videos.list: region-restricted (blocked in DE + FR; embeddable). */
export const FIXTURE_VIDEOS_REGION_BLOCKED: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-region",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-region",
      id: FIXTURE_VIDEO_IDS.regionBlocked,
      snippet: {
        publishedAt: "2023-08-08T08:08:08Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Storms, Region Restricted",
        description: "A fixture video blocked in DE and FR.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {
          default: { url: "https://i.ytimg.com/vi/Wfx54RgnBlk00/default.jpg", width: 120, height: 90 },
        },
        categoryId: "27",
        liveBroadcastContent: "none",
      },
      contentDetails: {
        duration: "P1DT2H3M4.5S",
        dimension: "2d",
        definition: "sd",
        caption: "false",
        licensedContent: false,
        regionRestriction: { blocked: ["DE", "FR"] },
      },
      status: {
        uploadStatus: "processed",
        privacyStatus: "public",
        license: "youtube",
        embeddable: true,
        publicStatsViewable: true,
        madeForKids: false,
      },
      statistics: { viewCount: "100" },
    },
  ],
};

/** videos.list: a PRIVATE video (typed not-found / unavailable). */
export const FIXTURE_VIDEOS_PRIVATE: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-private",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-private",
      id: FIXTURE_VIDEO_IDS.privateVideo,
      snippet: {
        publishedAt: "2025-01-01T00:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Private Fixture Video",
        description: "A fixture private video.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {},
        categoryId: "22",
        liveBroadcastContent: "none",
      },
      contentDetails: {
        duration: "PT10S",
        dimension: "2d",
        definition: "sd",
        caption: "false",
        licensedContent: false,
      },
      status: {
        uploadStatus: "processed",
        privacyStatus: "private",
        license: "youtube",
        embeddable: true,
        publicStatsViewable: false,
        madeForKids: false,
      },
      statistics: {},
    },
  ],
};

/** videos.list: a DELETED video (uploadStatus deleted → typed not-found). */
export const FIXTURE_VIDEOS_DELETED: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-deleted",
  items: [
    {
      kind: "youtube#video",
      etag: "fixture-etag-video-deleted",
      id: FIXTURE_VIDEO_IDS.deletedVideo,
      snippet: {
        publishedAt: "2020-01-01T00:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Deleted Fixture Video",
        description: "A fixture deleted video.",
        channelTitle: "WebFlix Fixture Channel",
        thumbnails: {},
        liveBroadcastContent: "none",
      },
      contentDetails: {
        duration: "PT1M",
        dimension: "2d",
        definition: "sd",
        caption: "false",
        licensedContent: false,
      },
      status: {
        uploadStatus: "deleted",
        privacyStatus: "public",
        license: "youtube",
        embeddable: true,
        publicStatsViewable: false,
        madeForKids: false,
      },
      statistics: {},
    },
  ],
};

/** videos.list: an unknown id — the documented empty-items miss. */
export const FIXTURE_VIDEOS_NOT_FOUND: YouTubeVideoListResponse = {
  kind: "youtube#videoListResponse",
  etag: "fixture-etag-videos-none",
  items: [],
};

// ---------------------------------------------------------------------------
// channels.list + playlistItems fixtures
// ---------------------------------------------------------------------------

/** channels.list: the fixture channel. */
export const FIXTURE_CHANNEL: YouTubeChannelListResponse = {
  kind: "youtube#channelListResponse",
  etag: "fixture-etag-channel",
  items: [
    {
      kind: "youtube#channel",
      etag: "fixture-etag-channel-item",
      id: FIXTURE_CHANNEL_ID,
      snippet: {
        title: "WebFlix Fixture Channel",
        description: "The fixture channel.",
        customUrl: "@webflixfixture",
        publishedAt: "2020-02-02T02:02:02Z",
        thumbnails: {
          default: { url: "https://i.ytimg.com/vi/Wfx54Docu001/default.jpg", width: 88, height: 88 },
        },
        country: "US",
      },
      statistics: {
        viewCount: "1000000",
        subscriberCount: "25000",
        hiddenSubscriberCount: false,
        videoCount: "42",
      },
      contentDetails: { relatedPlaylists: { likes: "LL", uploads: "UUWfx54Channel00000000000A" } },
    },
  ],
};

/** playlistItems.list: the user's liked videos (playlist LL). */
export const FIXTURE_PLAYLIST_ITEMS_LIKED: YouTubePlaylistItemListResponse = {
  kind: "youtube#playlistItemListResponse",
  etag: "fixture-etag-pl-items",
  items: [
    {
      kind: "youtube#playlistItem",
      etag: "fixture-etag-pl-item-1",
      id: "FIXTURE_PLITEM_1",
      snippet: {
        publishedAt: "2026-09-10T10:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain — A Night Documentary",
        description: "Liked fixture item.",
        channelTitle: "WebFlix Fixture Channel",
        playlistId: "LL",
        position: 0,
        resourceId: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.documentary },
        thumbnails: {
          medium: { url: "https://i.ytimg.com/vi/Wfx54Docu001/mqdefault.jpg", width: 320, height: 180 },
        },
      },
      contentDetails: {
        videoId: FIXTURE_VIDEO_IDS.documentary,
        videoPublishedAt: "2025-03-14T09:00:00Z",
      },
    },
    {
      kind: "youtube#playlistItem",
      etag: "fixture-etag-pl-item-2",
      id: "FIXTURE_PLITEM_2",
      snippet: {
        publishedAt: "2026-09-12T11:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain in 45 Seconds",
        description: "Liked fixture item.",
        channelTitle: "WebFlix Fixture Channel",
        playlistId: "LL",
        position: 1,
        resourceId: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.shortVertical },
      },
      contentDetails: {
        videoId: FIXTURE_VIDEO_IDS.shortVertical,
        videoPublishedAt: "2025-06-01T12:30:00Z",
      },
    },
  ],
};

/** playlistItems.list on WL filtered by videoId: the row to remove. */
export const FIXTURE_PLAYLIST_ITEMS_WATCH_LATER_ROW: YouTubePlaylistItemListResponse = {
  kind: "youtube#playlistItemListResponse",
  etag: "fixture-etag-pl-wl",
  items: [
    {
      kind: "youtube#playlistItem",
      etag: "fixture-etag-pl-wl-1",
      id: "FIXTURE_WL_ITEM_1",
      snippet: {
        publishedAt: "2026-09-13T09:00:00Z",
        channelId: FIXTURE_CHANNEL_ID,
        title: "Desert Rain — A Night Documentary",
        description: "Saved fixture item.",
        channelTitle: "WebFlix Fixture Channel",
        playlistId: "WL",
        position: 0,
        resourceId: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.documentary },
      },
      contentDetails: {
        videoId: FIXTURE_VIDEO_IDS.documentary,
        videoPublishedAt: "2025-03-14T09:00:00Z",
      },
    },
  ],
};

/** playlistItems.insert: the created Watch Later row. */
export const FIXTURE_PLAYLIST_ITEM_INSERTED: YouTubePlaylistItemInsertResponse = {
  kind: "youtube#playlistItem",
  etag: "fixture-etag-pl-inserted",
  id: "FIXTURE_WL_ITEM_NEW",
  snippet: {
    publishedAt: "2026-09-14T10:00:00Z",
    channelId: FIXTURE_CHANNEL_ID,
    title: "Desert Rain — A Night Documentary",
    description: "",
    channelTitle: "WebFlix Fixture Channel",
    playlistId: "WL",
    position: 3,
    resourceId: { kind: "youtube#video", videoId: FIXTURE_VIDEO_IDS.documentary },
  },
  contentDetails: {
    videoId: FIXTURE_VIDEO_IDS.documentary,
    videoPublishedAt: "2025-03-14T09:00:00Z",
  },
};

// ---------------------------------------------------------------------------
// OAuth + error fixtures
// ---------------------------------------------------------------------------

/** The documented Google token response for a successful exchange. */
export const FIXTURE_OAUTH_EXCHANGE_OK = {
  access_token: "fixture-access-token-1",
  expires_in: 3600,
  refresh_token: "fixture-refresh-token-1",
  scope:
    "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
  token_type: "Bearer",
} as const;

/** The documented Google token response for a refresh (no new refresh token). */
export const FIXTURE_OAUTH_REFRESH_OK = {
  access_token: "fixture-access-token-2",
  expires_in: 3600,
  scope:
    "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
  token_type: "Bearer",
} as const;

/** The documented Google error body for quota exhaustion (403). */
export const FIXTURE_ERROR_QUOTA_EXCEEDED = {
  error: {
    code: 403,
    message: "The request cannot be completed because you have exceeded your quota.",
    errors: [
      {
        message: "The request cannot be completed because you have exceeded your quota.",
        domain: "youtube.quota",
        reason: "quotaExceeded",
      },
    ],
  },
} as const;

/** The documented Google error body for an expired/revoked token (401). */
export const FIXTURE_ERROR_UNAUTHORIZED = {
  error: {
    code: 401,
    message: "The request uses the <code>access_token</code> parameter...",
    errors: [
      {
        message: "Invalid Credentials",
        domain: "global",
        reason: "authError",
        location: "Authorization",
        locationType: "header",
      },
    ],
  },
} as const;

/** The documented OAuth error body for a bad authorization code (400). */
export const FIXTURE_OAUTH_ERROR_INVALID_GRANT = {
  error: "invalid_grant",
  error_description: "Code was already redeemed.",
} as const;

// ---------------------------------------------------------------------------
// The scripted transport
// ---------------------------------------------------------------------------

/** One scripted reply: the body of a matched request. */
export interface YouTubeScriptedCall {
  readonly url: string;
  readonly method?: "GET" | "POST" | "DELETE";
  readonly status: number;
  /** A JSON-serializable body, or a raw string. */
  readonly body: unknown;
}

/** A recorded request (for assertions; auth headers included). */
export interface YouTubeRecordedRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * Build the deterministic test transport: replies are consumed in exact
 * FIFO order; every request is recorded. A request whose URL does not
 * match the next scripted reply — or a call after the script ran dry —
 * THROWS with a descriptive error (the test fails loudly; an unscripted
 * network call can never be silently answered). The recorded URL uses the
 * documented GET semantic; POST/DELETE matches on method too.
 */
export function createScriptedYouTubeTransport(calls: readonly YouTubeScriptedCall[]): {
  transport: YouTubeHttpTransport;
  requests: YouTubeRecordedRequest[];
} {
  const queue = [...calls];
  const requests: YouTubeRecordedRequest[] = [];
  const transport: YouTubeHttpTransport = {
    async request(request): Promise<YouTubeHttpReply> {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers ?? {},
        ...(request.body !== undefined ? { body: request.body } : {}),
      });
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(
          `youtube fixture transport: script exhausted — no reply scripted for ${request.method} ${request.url}`,
        );
      }
      const methodMatches = next.method === undefined || next.method === request.method;
      if (!methodMatches || next.url !== request.url) {
        throw new Error(
          `youtube fixture transport: request mismatch — got ${request.method} ${request.url}, ` +
            `next scripted reply is for ${next.method ?? "(any)"} ${next.url}`,
        );
      }
      const bodyText = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
      return { status: next.status, bodyText };
    },
  };
  return { transport, requests };
}

/** Serialize a fixture into a reply body string (JSON). */
export function fixtureBody(fixture: unknown): string {
  return JSON.stringify(fixture);
}

/** The documented 204 No-Content reply for rate/delete successes. */
export const FIXTURE_NO_CONTENT: YouTubeScriptedCall["body"] = "";

/** The JSON body of an empty API response when tests need one inline. */
export function emptyVideosBody(): string {
  return fixtureBody(FIXTURE_VIDEOS_NOT_FOUND);
}
