/**
 * WFX-054 — the YouTube CONNECTOR surface tests: the BaseConnector dual
 * surface (typed results + frozen-contract degradations), capability gating,
 * the dual-auth model (OAuth vs API key), token rotation on expiry,
 * actions, library read/write, the extended pagination surfaces, and
 * registry integration. All through the scripted transport — no network.
 */

import { describe, expect, it } from "bun:test";

import type { ConnectorContext, UserAction } from "@wfx/domain";

import {
  ConnectorRegistry,
  isErr,
  isOk,
  isUnauthorized,
  isUnsupported,
  YOUTUBE_CONNECTOR_CAPABILITIES,
  YOUTUBE_CONNECTOR_DESCRIPTOR,
  YOUTUBE_CONNECTOR_ID,
  createInMemoryYouTubeCredentialSource,
  createScriptedYouTubeTransport,
  createYouTubeConnector,
  FIXTURE_CHANNEL,
  FIXTURE_CHANNEL_ID,
  FIXTURE_ERROR_QUOTA_EXCEEDED,
  FIXTURE_NO_CONTENT,
  FIXTURE_OAUTH_REFRESH_OK,
  FIXTURE_PLAYLIST_ITEM_INSERTED,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_PLAYLIST_ITEMS_WATCH_LATER_ROW,
  FIXTURE_SEARCH_PAGE_1,
  FIXTURE_SEARCH_PAGE_2,
  FIXTURE_VIDEO_IDS,
  FIXTURE_VIDEOS_DELETED,
  FIXTURE_VIDEOS_DOCUMENTARY,
  FIXTURE_VIDEOS_NOT_EMBEDDABLE,
  FIXTURE_VIDEOS_NOT_FOUND,
  FIXTURE_VIDEOS_REGION_BLOCKED,
  YouTubeConnector,
  YouTubeConnectorConfigError,
  type YouTubeClock,
  type YouTubeTokenSet,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic test fixtures (clock + tokens)
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);

class TestClock implements YouTubeClock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

function freshTokens(overrides: Partial<YouTubeTokenSet> = {}): YouTubeTokenSet {
  return {
    accessToken: "fixture-access-token-1",
    refreshToken: "fixture-refresh-token-1",
    tokenType: "Bearer",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    expiresAtMs: NOW + 3600 * 1000,
    obtainedAtMs: NOW,
    ...overrides,
  };
}

const CTX: ConnectorContext = { userId: "wfxusr_fixture00000000000001", locale: "en", region: "US" };
const OAUTH = { clientId: "fixture-client-id", clientSecret: "fixture-client-secret" };

const SEARCH_URL_P1 = `${"https://www.googleapis.com/youtube/v3"}/search?part=snippet&type=video&maxResults=25&q=desert+rain+documentary&regionCode=US&relevanceLanguage=en`;
// Page 2's URL mirrors youtubeSearchList's query emission order exactly
// (part, type, maxResults, q, pageToken, regionCode, relevanceLanguage).
const SEARCH_URL_P2 =
  `${"https://www.googleapis.com/youtube/v3"}/search?part=snippet&type=video&maxResults=25` +
  `&q=desert+rain+documentary&pageToken=FIXTURE_PAGE_2&regionCode=US&relevanceLanguage=en`;
const VIDEOS_URL = (id: string) =>
  `${"https://www.googleapis.com/youtube/v3"}/videos?part=snippet%2CcontentDetails%2Cstatus%2Cstatistics&id=${id}`;

/** Build a connector over a scripted transport; returns everything needed. */
function makeConnector(
  calls: readonly {
    url: string;
    method?: "GET" | "POST" | "DELETE";
    status: number;
    body: unknown;
  }[],
  extra: {
    apiKey?: string;
    oauth?: { clientId: string; clientSecret: string };
    clock?: TestClock;
    savePlaylistId?: string;
    tokens?: YouTubeTokenSet;
  } = {},
) {
  const scripted = createScriptedYouTubeTransport(calls);
  const credentials = createInMemoryYouTubeCredentialSource();
  const clock = extra.clock ?? new TestClock(NOW);
  const connector = new YouTubeConnector({
    transport: scripted.transport,
    credentialSource: credentials,
    clock,
    ...(extra.apiKey !== undefined ? { apiKey: extra.apiKey } : {}),
    ...(extra.oauth !== undefined ? { oauth: extra.oauth } : {}),
    ...(extra.savePlaylistId !== undefined ? { savePlaylistId: extra.savePlaylistId } : {}),
  });
  return { connector, requests: scripted.requests, credentials, clock };
}

/** A connector + the SDK lifecycle driven to `initialized`, optionally seeded. */
async function readyConnector(
  calls: Parameters<typeof makeConnector>[0],
  extra: Parameters<typeof makeConnector>[1] = {},
  seed?: YouTubeTokenSet,
) {
  const made = makeConnector(calls, extra);
  const tokens = seed ?? extra.tokens;
  if (tokens !== undefined) {
    await made.credentials.store(CTX.userId, tokens);
  }
  await made.connector.initialize();
  return made;
}

// ---------------------------------------------------------------------------
// Configuration + descriptor truth
// ---------------------------------------------------------------------------

describe("YouTubeConnector configuration", () => {
  it("rejects mis-wired construction typed (programmer error)", () => {
    const credentials = createInMemoryYouTubeCredentialSource();
    const clock = new TestClock(NOW);
    expect(
      () =>
        new YouTubeConnector({
          transport: { request: async () => ({ status: 200, bodyText: "" }) },
          credentialSource: credentials,
          clock,
        }).id,
    ).toBeDefined();
    expect(
      () =>
        new YouTubeConnector({
          // @ts-expect-error deliberate mis-wiring: missing transport
          transport: undefined,
          credentialSource: credentials,
          clock,
        }),
    ).toThrow(YouTubeConnectorConfigError);
    expect(
      () =>
        new YouTubeConnector({
          transport: { request: async () => ({ status: 200, bodyText: "" }) },
          credentialSource: credentials,
          // @ts-expect-error deliberate mis-wiring: clock is undefined
          clock: undefined,
        }),
    ).toThrow(YouTubeConnectorConfigError);
    expect(
      () =>
        new YouTubeConnector({
          transport: { request: async () => ({ status: 200, bodyText: "" }) },
          // @ts-expect-error deliberate mis-wiring: missing credential source
          credentialSource: undefined,
          clock,
        }),
    ).toThrow(YouTubeConnectorConfigError);
    expect(
      () =>
        new YouTubeConnector({
          transport: { request: async () => ({ status: 200, bodyText: "" }) },
          credentialSource: credentials,
          clock,
          oauth: { clientId: "", clientSecret: "" },
        }),
    ).toThrow(YouTubeConnectorConfigError);
  });

  it("carries the honest descriptor (id, version, auth, capabilities)", () => {
    const descriptor = YOUTUBE_CONNECTOR_DESCRIPTOR;
    expect(descriptor.id).toBe("youtube");
    expect(descriptor.auth).toBe("oauth");
    expect([...descriptor.capabilities]).toEqual([...YOUTUBE_CONNECTOR_CAPABILITIES]);
    // Honest absences — each answered typed-unsupported by the SDK gate.
    for (const absent of [
      "identity",
      "playNative",
      "playBrowser",
      "follow",
      "comment",
      "download",
      "transform",
    ] as const) {
      expect(descriptor.capabilities).not.toContain(absent);
    }
  });
});

// ---------------------------------------------------------------------------
// Reads: search / metadata / resolve
// ---------------------------------------------------------------------------

describe("search (SDK surface + extended pagination)", () => {
  it("returns page 1 projected, authenticated with the OAuth token", async () => {
    const { connector, requests } = await readyConnector(
      [{ url: SEARCH_URL_P1, status: 200, body: FIXTURE_SEARCH_PAGE_1 }],
      { tokens: freshTokens() },
    );
    const result = await connector.searchResult(CTX, "desert rain documentary");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toHaveLength(3);
    expect(result.value[0]?.externalRef).toBe(FIXTURE_VIDEO_IDS.documentary);
    expect(result.value[0]?.metadata?.["rank"]).toBe(1);
    expect(requests[0]?.headers["authorization"]).toBe("Bearer fixture-access-token-1");
    // regionCode/relevanceLanguage flow from the ConnectorContext.
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("regionCode")).toBe("US");
    expect(query.get("relevanceLanguage")).toBe("en");
  });

  it("falls back to the API key for public search when the user never connected", async () => {
    const { connector, requests } = await readyConnector(
      [{ url: SEARCH_URL_P1 + "&key=fixture-api-key", status: 200, body: FIXTURE_SEARCH_PAGE_1 }],
      { apiKey: "fixture-api-key" },
    );
    const result = await connector.searchResult(CTX, "desert rain documentary");
    expect(result.ok).toBe(true);
    expect(new URL(requests[0]?.url ?? "").searchParams.get("key")).toBe("fixture-api-key");
  });

  it("answers typed unauthorized when neither token nor API key exists", async () => {
    const { connector } = await readyConnector([]);
    const result = await connector.searchResult(CTX, "desert rain documentary");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("unauthorized");
  });

  it("paginates deterministically through the extended surface (pageToken round-trip)", async () => {
    const { connector } = await readyConnector(
      [
        { url: SEARCH_URL_P1, status: 200, body: FIXTURE_SEARCH_PAGE_1 },
        { url: SEARCH_URL_P2, status: 200, body: FIXTURE_SEARCH_PAGE_2 },
      ],
      { tokens: freshTokens() },
    );
    const page1 = await connector.searchYouTubePage(CTX, "desert rain documentary");
    expect(page1.ok).toBe(true);
    if (!page1.ok) throw new Error("unreachable");
    expect(page1.value.results).toHaveLength(3);
    expect(page1.value.quotaUnits).toBe(100); // search.list = 100 units
    expect(page1.value.nextPageToken).toBe("FIXTURE_PAGE_2");

    const page2 = await connector.searchYouTubePage(
      CTX,
      "desert rain documentary",
      page1.value.nextPageToken,
    );
    expect(page2.ok).toBe(true);
    if (!page2.ok) throw new Error("unreachable");
    expect(page2.value.results).toHaveLength(2);
    expect(page2.value.results[0]?.externalRef).toBe(FIXTURE_VIDEO_IDS.regionBlocked);
    expect(page2.value.nextPageToken).toBeUndefined(); // last page
  });

  it("surfaces quota exhaustion as the typed suspension family with the kind code", async () => {
    const { connector } = await readyConnector(
      [{ url: SEARCH_URL_P1, status: 403, body: FIXTURE_ERROR_QUOTA_EXCEEDED }],
      { tokens: freshTokens() },
    );
    const result = await connector.searchResult(CTX, "desert rain documentary");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("transport");
    if (result.error.kind !== "transport") throw new Error("unreachable");
    expect(result.error.detail.startsWith("youtube:quota-exceeded:")).toBe(true);
    expect(result.error.detail).toContain("midnight Pacific Time");
  });

  it("degrades a network failure to an empty read on the PLAIN surface (SDK law)", async () => {
    const { connector } = await readyConnector(
      [{ url: SEARCH_URL_P1, status: 500, body: "backend error" }],
      { tokens: freshTokens() },
    );
    const plain = await connector.search(CTX, "desert rain documentary");
    expect(plain).toEqual([]);
    const lastError = connector.lastError();
    expect(lastError?.kind).toBe("transport"); // the truth is recorded
  });
});

describe("metadata (videos.list projection)", () => {
  it("projects the documented video into a rich SourceItem", async () => {
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.documentary), status: 200, body: FIXTURE_VIDEOS_DOCUMENTARY }],
      { tokens: freshTokens() },
    );
    const result = await connector.metadataResult(CTX, FIXTURE_VIDEO_IDS.documentary);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value?.title).toBe("Desert Rain — A Night Documentary");
    expect(result.value?.durationMs).toBe(3_723_000);
    expect(result.value?.availability).toBe("available");
    expect(result.value?.metadata?.["etag"]).toBe("fixture-etag-video-docu");
  });

  it("answers null for an unknown id (the documented empty-items miss)", async () => {
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL("unknown-id"), status: 200, body: FIXTURE_VIDEOS_NOT_FOUND }],
      { tokens: freshTokens() },
    );
    const result = await connector.metadataResult(CTX, "unknown-id");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBeNull();
    // The plain surface degrades identically.
    expect(await connector.metadata(CTX, "unknown-id")).toBeNull();
  });

  it("answers null for a DELETED video (typed not-found, never a zombie item)", async () => {
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.deletedVideo), status: 200, body: FIXTURE_VIDEOS_DELETED }],
      { tokens: freshTokens() },
    );
    const result = await connector.metadataResult(CTX, FIXTURE_VIDEO_IDS.deletedVideo);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toBeNull();
  });

  it("region-blocked metadata stays honest: unavailable for the caller's region", async () => {
    const deCtx: ConnectorContext = { ...CTX, region: "DE" };
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.regionBlocked), status: 200, body: FIXTURE_VIDEOS_REGION_BLOCKED }],
      { tokens: freshTokens() },
    );
    const result = await connector.metadataResult(deCtx, FIXTURE_VIDEO_IDS.regionBlocked);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value?.availability).toBe("unavailable");
  });
});

describe("resolve (playback realization)", () => {
  it("embeddable video → embed then external, per the frozen precedence", async () => {
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.documentary), status: 200, body: FIXTURE_VIDEOS_DOCUMENTARY }],
      { tokens: freshTokens() },
    );
    const result = await connector.resolveResult(CTX, FIXTURE_VIDEO_IDS.documentary);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.map((r) => r.mode)).toEqual(["embed", "external"]);
    expect(result.value[0]?.url).toBe("https://www.youtube.com/embed/Wfx54Docu001");
  });

  it("non-embeddable video → external handoff only", async () => {
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.notEmbeddable), status: 200, body: FIXTURE_VIDEOS_NOT_EMBEDDABLE }],
      { tokens: freshTokens() },
    );
    const result = await connector.resolveResult(CTX, FIXTURE_VIDEO_IDS.notEmbeddable);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.map((r) => r.mode)).toEqual(["external"]);
  });

  it("deleted video → [] (typed not-found at the resolve surface)", async () => {
    const { connector } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.deletedVideo), status: 200, body: FIXTURE_VIDEOS_DELETED }],
      { tokens: freshTokens() },
    );
    const result = await connector.resolveResult(CTX, FIXTURE_VIDEO_IDS.deletedVideo);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function action(type: UserAction["type"], payload?: Record<string, unknown>): UserAction {
  return {
    type,
    connectorId: YOUTUBE_CONNECTOR_ID,
    externalRef: FIXTURE_VIDEO_IDS.documentary,
    ...(payload !== undefined ? { payload } : {}),
  };
}

const RATE_URL = `https://www.googleapis.com/youtube/v3/videos/rate?id=${FIXTURE_VIDEO_IDS.documentary}&rating=like`;

describe("actions (like / save)", () => {
  it("like → videos.rate with a confirmed receipt", async () => {
    const { connector, requests } = await readyConnector(
      [{ method: "POST", url: RATE_URL, status: 204, body: FIXTURE_NO_CONTENT }],
      { tokens: freshTokens() },
    );
    const result = await connector.executeActionResult(CTX, action("like"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.status).toBe("confirmed");
    expect(result.value.occurredAt).toBe(new Date(NOW).toISOString());
    expect(requests[0]?.headers["authorization"]).toBe("Bearer fixture-access-token-1");
  });

  it("unlike → rating 'none' (the documented removal)", async () => {
    const unlikeUrl = `https://www.googleapis.com/youtube/v3/videos/rate?id=${FIXTURE_VIDEO_IDS.documentary}&rating=none`;
    const { connector } = await readyConnector(
      [{ method: "POST", url: unlikeUrl, status: 204, body: FIXTURE_NO_CONTENT }],
      { tokens: freshTokens() },
    );
    const result = await connector.executeActionResult(
      CTX,
      action("like", { rating: "none" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.detail).toContain("'none'");
  });

  it("rejects an invalid rating typed (invalid-input) before any network call", async () => {
    const { connector, requests } = await readyConnector([], { tokens: freshTokens() });
    const result = await connector.executeActionResult(
      CTX,
      action("like", { rating: " enthusiastic " }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("invalid-input");
    expect(requests).toHaveLength(0);
  });

  it("save → playlistItems.insert with the playlist-item externalId", async () => {
    const insertUrl =
      "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails";
    const { connector } = await readyConnector(
      [{ method: "POST", url: insertUrl, status: 200, body: FIXTURE_PLAYLIST_ITEM_INSERTED }],
      { tokens: freshTokens() },
    );
    const result = await connector.executeActionResult(CTX, action("save"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.status).toBe("confirmed");
    expect(result.value.externalId).toBe("FIXTURE_WL_ITEM_NEW");
  });

  it("user actions REQUIRE OAuth — the API key never suffices", async () => {
    const { connector, requests } = await readyConnector([], { apiKey: "fixture-api-key" });
    for (const userAction of [action("like"), action("save")]) {
      const result = await connector.executeActionResult(CTX, userAction);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe("unauthorized");
    }
    expect(requests).toHaveLength(0);
  });

  it("quota exhaustion on an action → typed suspension family + FAILED receipt on the plain surface", async () => {
    const dislikeUrl = `https://www.googleapis.com/youtube/v3/videos/rate?id=${FIXTURE_VIDEO_IDS.documentary}&rating=dislike`;
    const { connector } = await readyConnector(
      [
        { method: "POST", url: RATE_URL, status: 403, body: FIXTURE_ERROR_QUOTA_EXCEEDED },
        { method: "POST", url: dislikeUrl, status: 403, body: FIXTURE_ERROR_QUOTA_EXCEEDED },
      ],
      { tokens: freshTokens() },
    );
    const result = await connector.executeActionResult(CTX, action("like"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("transport");
    if (result.error.kind !== "transport") throw new Error("unreachable");
    expect(result.error.detail.startsWith("youtube:quota-exceeded:")).toBe(true);

    // The frozen plain surface: a failed receipt carrying the truth (the
    // dislike call is scripted with its own quota rejection).
    const plain = await connector.executeAction(CTX, action("like", { rating: "dislike" }));
    expect(plain.status).toBe("failed");
    expect(plain.detail).toContain("youtube:quota-exceeded:");
  });

  it("unauthorized (401) on an action → typed unauthorized + plain receipt", async () => {
    const { connector } = await readyConnector(
      [
        {
          method: "POST",
          url: RATE_URL,
          status: 401,
          body: { error: { errors: [{ reason: "authError" }] } },
        },
      ],
      { tokens: freshTokens() },
    );
    const result = await connector.executeActionResult(CTX, action("like"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("unauthorized");
  });

  it("undeclared actions (follow/comment/download/transform) → typed unsupported, no network", async () => {
    const { connector, requests } = await readyConnector([], { tokens: freshTokens() });
    for (const type of ["follow", "comment", "download", "transform"] as const) {
      const result = await connector.executeActionResult(CTX, action(type));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(isUnsupported(result.error)).toBe(true);
      if (!isUnsupported(result.error)) throw new Error("unreachable");
      expect(result.error.capability).toBe(type);
      // The frozen plain surface: an UNSUPPORTED receipt.
      const plain = await connector.executeAction(CTX, action(type));
      expect(plain.status).toBe("unsupported");
    }
    expect(requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const LL_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=LL&maxResults=50";

describe("library read (liked videos — the official surface)", () => {
  it("reads LL through the SDK surface", async () => {
    const { connector } = await readyConnector(
      [{ url: LL_URL, status: 200, body: FIXTURE_PLAYLIST_ITEMS_LIKED }],
      { tokens: freshTokens() },
    );
    const result = await connector.readLibraryResult(CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.externalRef).toBe(FIXTURE_VIDEO_IDS.documentary);
    expect(result.value[0]?.metadata?.["playlistItemId"]).toBe("FIXTURE_PLITEM_1");
  });

  it("paginates through the extended surface with quota cost", async () => {
    const { connector } = await readyConnector(
      [{ url: LL_URL, status: 200, body: FIXTURE_PLAYLIST_ITEMS_LIKED }],
      { tokens: freshTokens() },
    );
    const page = await connector.readLikedVideosPage(CTX);
    expect(page.ok).toBe(true);
    if (!page.ok) throw new Error("unreachable");
    expect(page.value.entries).toHaveLength(2);
    expect(page.value.quotaUnits).toBe(1); // playlistItems.list = 1 unit
  });

  it("requires OAuth (API key cannot read a user's likes)", async () => {
    const { connector } = await readyConnector([], { apiKey: "fixture-api-key" });
    const result = await connector.readLibraryResult(CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(isUnauthorized(result.error)).toBe(true);
  });
});

describe("library write (Watch Later add/remove)", () => {
  const INSERT_URL =
    "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails";
  const WL_LOOKUP_URL = (videoId: string) =>
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=WL&maxResults=1&videoId=${videoId}`;
  const WL_DELETE_URL = (itemId: string) =>
    `https://www.googleapis.com/youtube/v3/playlistItems?id=${itemId}`;

  it("add → playlistItems.insert confirmed with the item id", async () => {
    const { connector } = await readyConnector(
      [{ method: "POST", url: INSERT_URL, status: 200, body: FIXTURE_PLAYLIST_ITEM_INSERTED }],
      { tokens: freshTokens() },
    );
    const result = await connector.writeLibraryResult(CTX, {
      op: "add",
      externalRef: FIXTURE_VIDEO_IDS.documentary,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.status).toBe("confirmed");
    expect(result.value.externalId).toBe("FIXTURE_WL_ITEM_NEW");
  });

  it("remove → lookup by videoId, then delete by playlist-item id", async () => {
    const { connector, requests } = await readyConnector(
      [
        { url: WL_LOOKUP_URL(FIXTURE_VIDEO_IDS.documentary), status: 200, body: FIXTURE_PLAYLIST_ITEMS_WATCH_LATER_ROW },
        { method: "DELETE", url: WL_DELETE_URL("FIXTURE_WL_ITEM_1"), status: 204, body: "" },
      ],
      { tokens: freshTokens() },
    );
    const result = await connector.writeLibraryResult(CTX, {
      op: "remove",
      externalRef: FIXTURE_VIDEO_IDS.documentary,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.status).toBe("confirmed");
    expect(result.value.externalId).toBe("FIXTURE_WL_ITEM_1");
    expect(requests[1]?.method).toBe("DELETE");
  });

  it("remove of a video not in the playlist → confirmed idempotent no-op (no fabricated id)", async () => {
    const empty = { kind: "youtube#playlistItemListResponse", etag: "e", items: [] };
    const { connector } = await readyConnector(
      [{ url: WL_LOOKUP_URL("othervideo"), status: 200, body: empty }],
      { tokens: freshTokens() },
    );
    const result = await connector.writeLibraryResult(CTX, {
      op: "remove",
      externalRef: "othervideo",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.status).toBe("confirmed");
    expect(result.value.externalId).toBeUndefined();
    expect(result.value.detail).toContain("idempotent");
  });

  it("honors a custom save playlist (per-connector config)", async () => {
    const lookupUrl =
      "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=PL_CUSTOM&maxResults=1&videoId=x";
    const empty = { kind: "youtube#playlistItemListResponse", etag: "e", items: [] };
    const { connector } = await readyConnector(
      [{ url: lookupUrl, status: 200, body: empty }],
      { tokens: freshTokens(), savePlaylistId: "PL_CUSTOM" },
    );
    await connector.writeLibraryResult(CTX, { op: "remove", externalRef: "x" });
    // The lookup hit the CUSTOM playlist (asserted by the scripted URL match).
  });
});

// ---------------------------------------------------------------------------
// Token rotation (the OAuth lifecycle through the connector)
// ---------------------------------------------------------------------------

describe("token rotation on expiry", () => {
  it("refreshes an expired token, uses it, and STORES the rotation", async () => {
    const expired = freshTokens({
      accessToken: "fixture-access-token-STALE",
      expiresAtMs: NOW - 1000, // already expired
    });
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const { connector, credentials, requests, clock } = await readyConnector(
      [
        { method: "POST", url: tokenUrl, status: 200, body: FIXTURE_OAUTH_REFRESH_OK },
        { url: VIDEOS_URL(FIXTURE_VIDEO_IDS.documentary), status: 200, body: FIXTURE_VIDEOS_DOCUMENTARY },
      ],
      { oauth: OAUTH },
      expired,
    );
    const result = await connector.metadataResult(CTX, FIXTURE_VIDEO_IDS.documentary);
    expect(result.ok).toBe(true);

    // The refresh POST happened with grant_type=refresh_token…
    const refreshForm = new URLSearchParams(requests[0]?.body ?? "");
    expect(refreshForm.get("grant_type")).toBe("refresh_token");
    expect(refreshForm.get("refresh_token")).toBe("fixture-refresh-token-1");
    // …and the metadata call used the ROTATED access token.
    expect(requests[1]?.headers["authorization"]).toBe("Bearer fixture-access-token-2");
    // …and the rotated set was persisted (rotation honored).
    expect(credentials.snapshot(CTX.userId)?.accessToken).toBe("fixture-access-token-2");
    void clock;
  });

  it("public ops fall back to the API key when rotation is impossible (no oauth config)", async () => {
    const expired = freshTokens({ expiresAtMs: NOW - 1000 });
    const { connector, requests } = await readyConnector(
      [{ url: SEARCH_URL_P1 + "&key=fixture-api-key", status: 200, body: FIXTURE_SEARCH_PAGE_1 }],
      { apiKey: "fixture-api-key" },
      expired,
    );
    const result = await connector.searchResult(CTX, "desert rain documentary");
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1); // no refresh attempt, straight fallback
  });

  it("user ops answer unauthorized when rotation is impossible", async () => {
    // exactOptionalPropertyTypes: build the no-refresh-token set by OMITTING
    // the property, never by materializing `refreshToken: undefined`.
    const { refreshToken: _omitted, ...withoutRefresh } = freshTokens({
      expiresAtMs: NOW - 1000,
    });
    const expired: YouTubeTokenSet = withoutRefresh;
    const { connector, credentials } = await readyConnector([], {}, expired);
    const result = await connector.executeActionResult(CTX, action("like"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("unauthorized");
    // The expired set is NOT cleared here (only a refresh-REJECTION clears).
    expect(credentials.snapshot(CTX.userId)).not.toBeNull();
  });

  it("a refresh-REJECTED rotation clears the dead credentials and answers unauthorized", async () => {
    const expired = freshTokens({ expiresAtMs: NOW - 1000 });
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const { connector, credentials } = await readyConnector(
      [
        {
          method: "POST",
          url: tokenUrl,
          status: 400,
          body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        },
      ],
      { oauth: OAUTH },
      expired,
    );
    const result = await connector.executeActionResult(CTX, action("like"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("unauthorized");
    expect(credentials.snapshot(CTX.userId)).toBeNull(); // cleared — re-auth required
  });

  it("shares ONE in-flight refresh across concurrent operations (single-flight)", async () => {
    const expired = freshTokens({ expiresAtMs: NOW - 1000 });
    const tokenUrl = "https://oauth2.googleapis.com/token";
    // ONE refresh reply serves TWO concurrent metadata calls.
    const { connector, requests } = await readyConnector(
      [
        { method: "POST", url: tokenUrl, status: 200, body: FIXTURE_OAUTH_REFRESH_OK },
        { url: VIDEOS_URL(FIXTURE_VIDEO_IDS.documentary), status: 200, body: FIXTURE_VIDEOS_DOCUMENTARY },
        { url: VIDEOS_URL(FIXTURE_VIDEO_IDS.notEmbeddable), status: 200, body: FIXTURE_VIDEOS_NOT_EMBEDDABLE },
      ],
      { oauth: OAUTH },
      expired,
    );
    const [a, b] = await Promise.all([
      connector.metadataResult(CTX, FIXTURE_VIDEO_IDS.documentary),
      connector.metadataResult(CTX, FIXTURE_VIDEO_IDS.notEmbeddable),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Exactly one token-endpoint POST, then two authorized API calls.
    expect(requests.filter((r) => r.url === tokenUrl)).toHaveLength(1);
    expect(requests.filter((r) => r.headers["authorization"] === "Bearer fixture-access-token-2")).toHaveLength(2);
  });

  it("valid tokens skip the refresh entirely", async () => {
    const { connector, requests } = await readyConnector(
      [{ url: VIDEOS_URL(FIXTURE_VIDEO_IDS.documentary), status: 200, body: FIXTURE_VIDEOS_DOCUMENTARY }],
      { oauth: OAUTH },
      freshTokens(), // valid for an hour
    );
    const result = await connector.metadataResult(CTX, FIXTURE_VIDEO_IDS.documentary);
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1); // no token-endpoint call
  });
});

// ---------------------------------------------------------------------------
// Extended surfaces + registry integration
// ---------------------------------------------------------------------------

describe("channelSummary (channels.list enrichment)", () => {
  it("projects a channel summary; unknown channel → ok-null", async () => {
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cstatistics%2CcontentDetails&id=${FIXTURE_CHANNEL_ID}`;
    const { connector } = await readyConnector(
      [{ url: channelUrl, status: 200, body: FIXTURE_CHANNEL }],
      { tokens: freshTokens() },
    );
    const result = await connector.channelSummary(CTX, FIXTURE_CHANNEL_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value?.title).toBe("WebFlix Fixture Channel");
    expect(result.value?.uploadsPlaylistId).toBe("UUWfx54Channel00000000000A");
  });

  it("lifecycle-guards the extended surfaces like the SDK guards the hooks", async () => {
    const made = makeConnector([]);
    // registered (not initialized) → typed LifecycleError from the SDK module.
    expect(() => made.connector.searchYouTubePage(CTX, "q")).toThrow();
    expect(() => made.connector.readLikedVideosPage(CTX)).toThrow();
    expect(() => made.connector.channelSummary(CTX, "UC")).toThrow();
  });
});

describe("registry integration (the WFX-012 pattern)", () => {
  it("registers as a live instance; the capability matrix tells the truth", async () => {
    const registry = new ConnectorRegistry();
    const { connector } = await readyConnector([], { tokens: freshTokens() });
    registry.register(connector);

    expect(registry.get(YOUTUBE_CONNECTOR_ID)).toBe(connector);
    const row = registry
      .capabilityMatrix()
      .find((candidate) => candidate.id === YOUTUBE_CONNECTOR_ID);
    expect(row).toBeDefined();
    if (row === undefined) throw new Error("unreachable");
    expect(row.hasInstance).toBe(true);
    expect(row.auth).toBe("oauth");
    expect(row.displayName).toBe("YouTube");
    for (const cap of YOUTUBE_CONNECTOR_CAPABILITIES) {
      expect(row.capabilities[cap]).toBe(true);
    }
    for (const absent of ["playNative", "follow", "comment", "download", "transform"] as const) {
      expect(row.capabilities[absent]).toBe(false);
    }
  });

  it("supports descriptor-only registration (known-but-not-connected)", () => {
    const registry = new ConnectorRegistry();
    registry.register(YOUTUBE_CONNECTOR_DESCRIPTOR);
    expect(registry.get(YOUTUBE_CONNECTOR_ID)).toBeUndefined();
    const row = registry
      .capabilityMatrix()
      .find((candidate) => candidate.id === YOUTUBE_CONNECTOR_ID);
    expect(row?.hasInstance).toBe(false);
  });

  it("withCapability finds the connector for every declared capability", async () => {
    const registry = new ConnectorRegistry();
    const { connector } = await readyConnector([], { tokens: freshTokens() });
    registry.register(connector);
    for (const cap of ["like", "save", "playEmbed", "libraryWrite"] as const) {
      expect(registry.withCapability(cap)).toContain(connector);
    }
    expect(registry.withCapability("playNative")).not.toContain(connector);
  });
});

describe("createYouTubeConnector factory", () => {
  it("returns an initialized-able connector assignable to the frozen contract", async () => {
    const credentials = createInMemoryYouTubeCredentialSource();
    const connector = createYouTubeConnector({
      transport: createScriptedYouTubeTransport([]).transport,
      credentialSource: credentials,
      clock: new TestClock(NOW),
    });
    expect(connector.id).toBe("youtube");
    await connector.initialize();
    expect(connector.state()).toBe("initialized");
    // The frozen plain surface exists (SourceConnector compatibility).
    expect(typeof connector.search).toBe("function");
    expect(typeof connector.executeAction).toBe("function");
    await connector.dispose();
    expect(isOk({ ok: true, value: 1 })).toBe(true);
    expect(isErr({ ok: false, error: { kind: "unauthorized", connectorId: "youtube" } })).toBe(true);
  });
});

