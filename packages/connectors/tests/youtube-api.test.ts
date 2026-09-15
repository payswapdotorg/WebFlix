/**
 * WFX-054 — YouTube API client tests: documented request building (auth
 * model, parts, params), response parsing (shape validation), and the typed
 * failure taxonomy (quota-exceeded, rate-limit, unauthorized, unavailable,
 * malformed). All through the scripted transport — no network.
 */

import { describe, expect, it } from "bun:test";

import {
  classifyYouTubeHttpStatus,
  classifyYouTubeTransportFailure,
  isYouTubeErrorBody,
  toConnectorError,
  youTubeKindFromDetail,
  YouTubeApiError,
} from "../src/index";
import {
  FIXTURE_CHANNEL,
  FIXTURE_CHANNEL_ID,
  FIXTURE_ERROR_QUOTA_EXCEEDED,
  FIXTURE_ERROR_UNAUTHORIZED,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_SEARCH_PAGE_1,
  FIXTURE_VIDEOS_DOCUMENTARY,
  FIXTURE_VIDEOS_NOT_FOUND,
  YOUTUBE_API_ROOT,
  youtubeChannelsList,
  youtubePlaylistItemsDelete,
  youtubePlaylistItemsInsert,
  youtubePlaylistItemsList,
  youtubeSearchList,
  youtubeVideosList,
  youtubeVideosRate,
} from "../src/index";
import { createScriptedYouTubeTransport } from "../src/index";

const OAUTH = { accessToken: "fixture-access-token-1" };
const API_KEY = { apiKey: "fixture-api-key" };

describe("youtubeSearchList (100 quota units)", () => {
  it("builds the documented request: type=video, part=snippet, auth", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/search?part=snippet&type=video&maxResults=25&q=desert+rain+documentary`, status: 200, body: FIXTURE_SEARCH_PAGE_1 },
    ]);
    const response = await youtubeSearchList(transport, OAUTH, {
      q: "desert rain documentary",
    });
    expect(response.kind).toBe("youtube#searchListResponse");
    expect(response.items).toHaveLength(3);
    expect(response.nextPageToken).toBe("FIXTURE_PAGE_2");

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) throw new Error("unreachable");
    expect(request.method).toBe("GET");
    expect(request.headers["authorization"]).toBe("Bearer fixture-access-token-1");
    const query = new URL(request.url).searchParams;
    expect(query.get("part")).toBe("snippet");
    expect(query.get("type")).toBe("video");
    expect(query.get("maxResults")).toBe("25");
    expect(query.get("q")).toBe("desert rain documentary");
    expect(query.get("key")).toBeNull(); // OAuth preferred: no API key mixed in
  });

  it("authenticates with the API key when no token is held (public data)", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/search?part=snippet&type=video&maxResults=25&q=desert+rain+documentary&key=fixture-api-key`, status: 200, body: FIXTURE_SEARCH_PAGE_1 },
    ]);
    await youtubeSearchList(transport, API_KEY, { q: "desert rain documentary" });
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("key")).toBe("fixture-api-key");
    expect(requests[0]?.headers["authorization"]).toBeUndefined();
  });

  it("passes pageToken, regionCode, relevanceLanguage; clamps maxResults to 1..50", async () => {
    const expected =
      `${YOUTUBE_API_ROOT}/search?part=snippet&type=video&maxResults=50` +
      `&q=x&pageToken=FIXTURE_PAGE_2&regionCode=DE&relevanceLanguage=de`;
    const { transport, requests } = createScriptedYouTubeTransport([
      { url: expected, status: 200, body: FIXTURE_SEARCH_PAGE_1 },
    ]);
    await youtubeSearchList(transport, OAUTH, {
      q: "x",
      pageToken: "FIXTURE_PAGE_2",
      maxResults: 500, // clamped to the documented maximum
      regionCode: "DE",
      relevanceLanguage: "de",
    });
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("maxResults")).toBe("50");
    expect(query.get("pageToken")).toBe("FIXTURE_PAGE_2");
    expect(query.get("regionCode")).toBe("DE");
    expect(query.get("relevanceLanguage")).toBe("de");
  });

  it("THROWS when no authentication is available at all (never unauthenticated)", async () => {
    const { transport } = createScriptedYouTubeTransport([]);
    expect(() => youtubeSearchList(transport, {}, { q: "x" })).toThrow(YouTubeApiError);
  });

  it("classifies quota exhaustion (403 quotaExceeded) as the typed suspension family", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/search?part=snippet&type=video&maxResults=25&q=x`, status: 403, body: FIXTURE_ERROR_QUOTA_EXCEEDED },
    ]);
    try {
      await youtubeSearchList(transport, OAUTH, { q: "x" });
      throw new Error("expected youtubeSearchList to throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(YouTubeApiError);
      const error = thrown as YouTubeApiError;
      expect(error.kind).toBe("quota-exceeded");
      expect(error.status).toBe(403);
      expect(error.reason).toBe("quotaExceeded");
      expect(error.retryable).toBe(true);
      expect(error.message).toContain("midnight Pacific Time");
    }
  });

  it("rejects a 2xx body with the wrong response kind (malformed-response)", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/search?part=snippet&type=video&maxResults=25&q=x`, status: 200, body: { kind: "youtube#videoListResponse", items: [] } },
    ]);
    await expect(youtubeSearchList(transport, OAUTH, { q: "x" })).rejects.toThrow(
      /expected 'youtube#searchListResponse'/,
    );
  });

  it("rejects a non-JSON 2xx body typed", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/search?part=snippet&type=video&maxResults=25&q=x`, status: 200, body: "<html>not json</html>" },
    ]);
    await expect(youtubeSearchList(transport, OAUTH, { q: "x" })).rejects.toThrow(
      YouTubeApiError,
    );
  });
});

describe("youtubeVideosList (1 quota unit — metadata/resolve workhorse)", () => {
  it("requests the four documented parts and parses the full item", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        url: `${YOUTUBE_API_ROOT}/videos?part=snippet%2CcontentDetails%2Cstatus%2Cstatistics&id=Wfx54Docu001`,
        status: 200,
        body: FIXTURE_VIDEOS_DOCUMENTARY,
      },
    ]);
    const response = await youtubeVideosList(transport, OAUTH, { ids: ["Wfx54Docu001"] });
    expect(response.items).toHaveLength(1);
    const video = response.items[0];
    if (video === undefined) throw new Error("unreachable");
    expect(video.id).toBe("Wfx54Docu001");
    expect(video.contentDetails.duration).toBe("PT1H2M3S");
    expect(video.status.embeddable).toBe(true);
    expect(video.statistics.viewCount).toBe("1234567");
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("part")).toBe("snippet,contentDetails,status,statistics");
    expect(query.get("id")).toBe("Wfx54Docu001");
  });

  it("parses an empty-items miss (unknown id) without error", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/videos?part=snippet%2CcontentDetails%2Cstatus%2Cstatistics&id=unknown`, status: 200, body: FIXTURE_VIDEOS_NOT_FOUND },
    ]);
    const response = await youtubeVideosList(transport, OAUTH, { ids: ["unknown"] });
    expect(response.items).toHaveLength(0);
  });

  it("requires the embeddable boolean in status (the honest-embeddability field)", async () => {
    const body = JSON.parse(JSON.stringify(FIXTURE_VIDEOS_DOCUMENTARY)) as {
      items: { status: Record<string, unknown> }[];
    };
    delete (body.items[0]?.status ?? {})["embeddable"];
    const { transport } = createScriptedYouTubeTransport([
      { url: `${YOUTUBE_API_ROOT}/videos?part=snippet%2CcontentDetails%2Cstatus%2Cstatistics&id=x`, status: 200, body },
    ]);
    await expect(youtubeVideosList(transport, OAUTH, { ids: ["x"] })).rejects.toThrow(
      /embeddable/,
    );
  });
});

describe("youtubeChannelsList (1 quota unit)", () => {
  it("lists by channel id and parses the channel shape", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        url: `${YOUTUBE_API_ROOT}/channels?part=snippet%2Cstatistics%2CcontentDetails&id=${FIXTURE_CHANNEL_ID}`,
        status: 200,
        body: FIXTURE_CHANNEL,
      },
    ]);
    const response = await youtubeChannelsList(transport, OAUTH, {
      id: FIXTURE_CHANNEL_ID,
    });
    expect(response.items[0]?.snippet.title).toBe("WebFlix Fixture Channel");
    expect(response.items[0]?.contentDetails.relatedPlaylists.likes).toBe("LL");
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("part")).toBe("snippet,statistics,contentDetails");
    expect(query.get("id")).toBe(FIXTURE_CHANNEL_ID);
  });

  it("supports mine=true (the OAuth owner's channel)", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        url: `${YOUTUBE_API_ROOT}/channels?part=snippet%2Cstatistics%2CcontentDetails&mine=true`,
        status: 200,
        body: FIXTURE_CHANNEL,
      },
    ]);
    await youtubeChannelsList(transport, OAUTH, { mine: true });
    expect(new URL(requests[0]?.url ?? "").searchParams.get("mine")).toBe("true");
  });
});

describe("playlistItems (1 / 50 quota units)", () => {
  it("lists the liked playlist (LL) with snippet+contentDetails", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        url: `${YOUTUBE_API_ROOT}/playlistItems?part=snippet%2CcontentDetails&playlistId=LL&maxResults=50`,
        status: 200,
        body: FIXTURE_PLAYLIST_ITEMS_LIKED,
      },
    ]);
    const response = await youtubePlaylistItemsList(transport, OAUTH, {
      playlistId: "LL",
    });
    expect(response.items).toHaveLength(2);
    expect(response.items[0]?.snippet.resourceId.videoId).toBe("Wfx54Docu001");
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("playlistId")).toBe("LL");
    expect(query.get("part")).toBe("snippet,contentDetails");
  });

  it("filters by videoId when removing (the documented lookup-before-delete)", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        url: `${YOUTUBE_API_ROOT}/playlistItems?part=snippet%2CcontentDetails&playlistId=WL&maxResults=1&videoId=Wfx54Docu001`,
        status: 200,
        body: FIXTURE_PLAYLIST_ITEMS_LIKED,
      },
    ]);
    await youtubePlaylistItemsList(transport, OAUTH, {
      playlistId: "WL",
      videoId: "Wfx54Docu001",
      maxResults: 1,
    });
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("videoId")).toBe("Wfx54Docu001");
  });

  it("inserts the documented body (playlistId + resourceId in snippet)", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        method: "POST",
        url: `${YOUTUBE_API_ROOT}/playlistItems?part=snippet%2CcontentDetails`,
        status: 200,
        body: {
          kind: "youtube#playlistItem",
          etag: "e",
          id: "NEW",
          snippet: {
            publishedAt: "2026-09-14T10:00:00Z",
            channelId: FIXTURE_CHANNEL_ID,
            title: "Desert Rain — A Night Documentary",
            description: "",
            channelTitle: "WebFlix Fixture Channel",
            playlistId: "WL",
            position: 0,
            resourceId: { kind: "youtube#video", videoId: "Wfx54Docu001" },
          },
          contentDetails: { videoId: "Wfx54Docu001" },
        },
      },
    ]);
    const inserted = await youtubePlaylistItemsInsert(transport, OAUTH, {
      playlistId: "WL",
      videoId: "Wfx54Docu001",
    });
    expect(inserted.id).toBe("NEW");
    const request = requests[0];
    if (request === undefined) throw new Error("unreachable");
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(request.body ?? "{}") as {
      snippet: { playlistId: string; resourceId: { kind: string; videoId: string } };
    };
    expect(body.snippet.playlistId).toBe("WL");
    expect(body.snippet.resourceId.kind).toBe("youtube#video");
    expect(body.snippet.resourceId.videoId).toBe("Wfx54Docu001");
  });

  it("deletes by playlist-item id (204 No Content)", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      {
        method: "DELETE",
        url: `${YOUTUBE_API_ROOT}/playlistItems?id=FIXTURE_WL_ITEM_1`,
        status: 204,
        body: "",
      },
    ]);
    await youtubePlaylistItemsDelete(transport, OAUTH, {
      playlistItemId: "FIXTURE_WL_ITEM_1",
    });
    expect(requests[0]?.method).toBe("DELETE");
    expect(new URL(requests[0]?.url ?? "").searchParams.get("id")).toBe(
      "FIXTURE_WL_ITEM_1",
    );
  });
});

describe("youtubeVideosRate (50 quota units)", () => {
  it("rates like/dislike/none via POST with id+rating query", async () => {
    for (const rating of ["like", "dislike", "none"] as const) {
      const { transport, requests } = createScriptedYouTubeTransport([
        {
          method: "POST",
          url: `${YOUTUBE_API_ROOT}/videos/rate?id=Wfx54Docu001&rating=${rating}`,
          status: 204,
          body: "",
        },
      ]);
      await youtubeVideosRate(transport, OAUTH, {
        videoId: "Wfx54Docu001",
        rating,
      });
      const query = new URL(requests[0]?.url ?? "").searchParams;
      expect(query.get("id")).toBe("Wfx54Docu001");
      expect(query.get("rating")).toBe(rating);
    }
  });

  it("classifies a 401 as unauthorized (expired/revoked token)", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { method: "POST", url: `${YOUTUBE_API_ROOT}/videos/rate?id=x&rating=like`, status: 401, body: FIXTURE_ERROR_UNAUTHORIZED },
    ]);
    try {
      await youtubeVideosRate(transport, OAUTH, { videoId: "x", rating: "like" });
      throw new Error("expected youtubeVideosRate to throw");
    } catch (thrown) {
      const error = thrown as YouTubeApiError;
      expect(error.kind).toBe("unauthorized");
      expect(error.retryable).toBe(false);
    }
  });
});

describe("the failure taxonomy (errors.ts)", () => {
  it("classifies every documented HTTP family", () => {
    const quota = classifyYouTubeHttpStatus(403, JSON.stringify(FIXTURE_ERROR_QUOTA_EXCEEDED));
    expect(quota.kind).toBe("quota-exceeded");
    expect(quota.retryable).toBe(true);

    const rateLimit = classifyYouTubeHttpStatus(403, JSON.stringify({
      error: { errors: [{ reason: "userRateLimitExceeded" }] },
    }));
    expect(rateLimit.kind).toBe("rate-limit");

    const tooMany = classifyYouTubeHttpStatus(429, "");
    expect(tooMany.kind).toBe("rate-limit");
    expect(tooMany.retryable).toBe(true);

    const forbidden = classifyYouTubeHttpStatus(403, JSON.stringify({
      error: { errors: [{ reason: "forbidden" }], message: "forbidden" },
    }));
    expect(forbidden.kind).toBe("forbidden");
    expect(forbidden.retryable).toBe(false);

    const notFound = classifyYouTubeHttpStatus(404, "");
    expect(notFound.kind).toBe("not-found");

    const badRequest = classifyYouTubeHttpStatus(400, "not json");
    expect(badRequest.kind).toBe("bad-request");
    expect(badRequest.retryable).toBe(false);

    const backend = classifyYouTubeHttpStatus(503, "");
    expect(backend.kind).toBe("unavailable");
    expect(backend.retryable).toBe(true);

    const drift = classifyYouTubeHttpStatus(418, "");
    expect(drift.kind).toBe("unavailable");
    expect(drift.message).toContain("unexpected HTTP 418");
  });

  it("classifies transport-level failures (network refusal / timeout)", () => {
    const error = classifyYouTubeTransportFailure(new Error("fetch failed"));
    expect(error.kind).toBe("unavailable");
    expect(error.retryable).toBe(true);
    expect(error.status).toBeUndefined();
  });

  it("recognizes well-formed Google error bodies only", () => {
    expect(isYouTubeErrorBody(FIXTURE_ERROR_QUOTA_EXCEEDED)).toBe(true);
    expect(isYouTubeErrorBody({ error: "invalid_grant" })).toBe(false); // OAuth2 shape — different module
    expect(isYouTubeErrorBody(null)).toBe(false);
    expect(isYouTubeErrorBody({})).toBe(false);
    expect(isYouTubeErrorBody([])).toBe(false);
  });

  it("maps the taxonomy onto the SDK's CLOSED error vocabulary with kind codes", () => {
    const quota = classifyYouTubeHttpStatus(403, JSON.stringify(FIXTURE_ERROR_QUOTA_EXCEEDED));
    const sdkQuota = toConnectorError(quota);
    expect(sdkQuota.kind).toBe("transport");
    if (sdkQuota.kind !== "transport") throw new Error("unreachable");
    expect(sdkQuota.connectorId).toBe("youtube");
    expect(sdkQuota.detail.startsWith("youtube:quota-exceeded:")).toBe(true);

    const unauthorizedError = classifyYouTubeHttpStatus(401, JSON.stringify(FIXTURE_ERROR_UNAUTHORIZED));
    const sdkUnauthorized = toConnectorError(unauthorizedError);
    expect(sdkUnauthorized.kind).toBe("unauthorized");

    const bad = classifyYouTubeHttpStatus(400, "{}");
    const sdkBad = toConnectorError(bad);
    expect(sdkBad.kind).toBe("invalid-input");
  });

  it("round-trips the kind code through the SDK detail string", () => {
    for (const kind of [
      "quota-exceeded",
      "rate-limit",
      "unavailable",
      "forbidden",
      "not-found",
      "malformed-response",
    ] as const) {
      const error = new YouTubeApiError({
        kind,
        detail: "detail",
        retryable: true,
      });
      const sdk = toConnectorError(error);
      if (sdk.kind !== "transport") throw new Error("unreachable");
      expect(youTubeKindFromDetail(sdk.detail)).toBe(kind);
    }
    expect(youTubeKindFromDetail("no code here")).toBeNull();
    expect(youTubeKindFromDetail("youtube:not-a-real-kind: x")).toBeNull();
  });
});
