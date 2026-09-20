/**
 * R20-B — the explicit connector feed/import capability: the SDK surface
 * (capability gating + input validation) and the YouTube provider path
 * (the FIRST REAL provider route over the documented user-scoped
 * endpoints). All through the scripted transport — no network, no fixtures
 * in production paths.
 *
 * Laws pinned here:
 * - `importFeedResult` is gated by the EXPLICIT `feedImport` capability —
 *   never catalogSearch; a connector without the declaration answers the
 *   typed `unsupported` verdict naming it.
 * - The YouTube route answers HONEST verdicts: `unsupported` for methods
 *   it cannot serve (official-export/user-file), `unsupported` naming the
 *   unexposable relationships (history — Takeout-only; ranked-feed),
 *   `unauthorized` without an OAuth grant (never a fabricated feed).
 * - Source-native order is DATA: subscriptions project the documented
 *   most-recent-first array order by index; playlist items carry the
 *   provider's OWN snippet.position (even when it disagrees with the
 *   array order). Nothing is ranked as WebFlix content.
 * - A capture is a SNAPSHOT: syncState 'snapshot' + continuousSync true —
 *   never self-labeled live.
 * - Bounded reads: exactly one page per list, empty playlists skipped,
 *   quota reported.
 */

import { describe, expect, it } from "bun:test";

import type { ConnectorContext } from "@wfx/domain";

import {
  ConnectorRegistry,
  isErr,
  isOk,
  isUnauthorized,
  isUnsupported,
  YOUTUBE_CONNECTOR_CAPABILITIES,
  YOUTUBE_CONNECTOR_ID,
  youtubeFeedImportCapabilities,
  createInMemoryYouTubeCredentialSource,
  createScriptedYouTubeTransport,
  createYouTubeConnector,
  FIXTURE_PLAYLIST_ID,
  FIXTURE_PLAYLISTS_MINE,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_PLAYLIST_ITEMS_RAIN,
  FIXTURE_PLAYLIST_ITEMS_WATCH_LATER,
  FIXTURE_SUBSCRIPTIONS,
  FIXTURE_CHANNEL_ID,
  FIXTURE_CHANNEL_ID_B,
  YouTubeConnector,
  type YouTubeClock,
  type YouTubeTokenSet,
} from "../src/index";
import { makeStubConnector } from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic harness (mirrors youtube-connector.test.ts)
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

class TestClock implements YouTubeClock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
}

function freshTokens(): YouTubeTokenSet {
  return {
    accessToken: "fixture-access-token-feed",
    refreshToken: "fixture-refresh-token-feed",
    tokenType: "Bearer",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    expiresAtMs: NOW + 3600 * 1000,
    obtainedAtMs: NOW,
  };
}

const CTX: ConnectorContext = { userId: "wfxusr_fixturefeed000000001", locale: "en", region: "US" };

const SUBS_URL =
  "https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50";
const PLAYLISTS_URL =
  "https://www.googleapis.com/youtube/v3/playlists?part=snippet%2CcontentDetails&mine=true&maxResults=25";
const playlistItemsUrl = (playlistId: string) =>
  `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=${playlistId}&maxResults=50`;

async function readyFeedConnector(
  calls: readonly { url: string; method?: "GET" | "POST" | "DELETE"; status: number; body: unknown }[],
): Promise<{ connector: YouTubeConnector; requests: ReturnType<typeof createScriptedYouTubeTransport>["requests"] }> {
  const scripted = createScriptedYouTubeTransport(calls);
  const credentials = createInMemoryYouTubeCredentialSource();
  const connector = new YouTubeConnector({
    transport: scripted.transport,
    credentialSource: credentials,
    clock: new TestClock(NOW),
  });
  await credentials.store(CTX.userId, freshTokens());
  await connector.initialize();
  return { connector, requests: scripted.requests };
}

// ---------------------------------------------------------------------------
// SDK surface — capability gating (BaseConnector)
// ---------------------------------------------------------------------------

describe("importFeedResult — the explicit capability gate", () => {
  it("is gated by 'feedImport', NOT catalogSearch: a stub without the declaration answers unsupported", async () => {
    const stub = makeStubConnector(); // catalogSearch-capable, no feedImport
    await stub.initialize();
    const result = await stub.importFeedResult(CTX, { method: "api" });
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported");
      if (result.error.kind === "unsupported") {
        expect(result.error.capability).toBe("feedImport");
        expect(result.error.detail).toContain("does not declare 'feedImport'");
      }
    }
  });

  it("validates the request: unknown method and unknown relationships are typed invalid-input", async () => {
    const { connector } = await readyFeedConnector([]);
    const badMethod = await connector.importFeedResult(CTX, {
      // @ts-expect-error deliberate drift: an unknown method
      method: "scrape",
    });
    expect(isErr(badMethod)).toBe(true);
    if (!badMethod.ok) expect(badMethod.error.kind).toBe("invalid-input");

    const badRelationship = await connector.importFeedResult(CTX, {
      method: "api",
      // @ts-expect-error deliberate drift: an unknown relationship
      relationships: ["favorited"],
    });
    expect(isErr(badRelationship)).toBe(true);
    if (!badRelationship.ok) expect(badRelationship.error.kind).toBe("invalid-input");

    const badArtifact = await connector.importFeedResult(CTX, {
      method: "user-file",
      // @ts-expect-error deliberate drift: artifact must be bytes
      artifact: "not-bytes",
    });
    expect(isErr(badArtifact)).toBe(true);
    if (!badArtifact.ok) expect(badArtifact.error.kind).toBe("invalid-input");
  });

  it("the lifecycle gate applies before anything else (uninitialized connector throws)", async () => {
    const scripted = createScriptedYouTubeTransport([]);
    const connector = new YouTubeConnector({
      transport: scripted.transport,
      credentialSource: createInMemoryYouTubeCredentialSource(),
      clock: new TestClock(NOW),
    });
    await expect(connector.importFeedResult(CTX, { method: "api" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The YouTube route — honest verdicts
// ---------------------------------------------------------------------------

describe("YouTube feed import — honest verdicts", () => {
  it("declares the explicit feedImport capability (and the capability truth record)", () => {
    expect(YOUTUBE_CONNECTOR_CAPABILITIES).toContain("feedImport");
    const capabilities = youtubeFeedImportCapabilities();
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]?.method).toBe("api");
    expect(capabilities[0]?.supportsContinuousSync).toBe(true);
    expect(capabilities[0]?.supportsFollowing).toBe(true);
    expect(capabilities[0]?.supportsPlaylists).toBe(true);
    expect(capabilities[0]?.supportsLikesOrSaves).toBe(true);
  });

  it("answers typed unsupported for non-API methods (no export parsing, no fallback)", async () => {
    const { connector } = await readyFeedConnector([]);
    for (const method of ["official-export", "user-file", "snapshot"] as const) {
      const result = await connector.importFeedResult(CTX, { method });
      expect(isErr(result)).toBe(true);
      if (!result.ok && isUnsupported(result.error)) {
        expect(result.error.detail).toContain("API import route only");
      }
    }
  });

  it("answers typed unsupported naming history (Takeout-only) and ranked-feed — never a silent partial import", async () => {
    const { connector } = await readyFeedConnector([]);
    const history = await connector.importFeedResult(CTX, {
      method: "api",
      relationships: ["history"],
    });
    expect(isErr(history)).toBe(true);
    if (!history.ok && isUnsupported(history.error)) {
      expect(history.error.detail).toContain("history");
      expect(history.error.detail).toContain("Takeout");
    }
    const mixed = await connector.importFeedResult(CTX, {
      method: "api",
      relationships: ["follow", "ranked-feed"],
    });
    expect(isErr(mixed)).toBe(true);
    if (!mixed.ok) expect(mixed.error.kind).toBe("unsupported"); // no silent partial
  });

  it("answers typed unauthorized without an OAuth grant (an API key never suffices)", async () => {
    const scripted = createScriptedYouTubeTransport([]);
    const connector = new YouTubeConnector({
      transport: scripted.transport,
      credentialSource: createInMemoryYouTubeCredentialSource(),
      clock: new TestClock(NOW),
      apiKey: "fixture-api-key",
    });
    await connector.initialize();
    const result = await connector.importFeedResult(CTX, { method: "api" });
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(isUnauthorized(result.error)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The YouTube route — the real capture path
// ---------------------------------------------------------------------------

describe("YouTube feed import — the authorized API capture", () => {
  it("captures the full route (follows, likes, watch-later, playlists) in ONE snapshot with provenance", async () => {
    const { connector, requests } = await readyFeedConnector([
      { url: SUBS_URL, status: 200, body: FIXTURE_SUBSCRIPTIONS },
      { url: playlistItemsUrl("LL"), status: 200, body: FIXTURE_PLAYLIST_ITEMS_LIKED },
      { url: playlistItemsUrl("WL"), status: 200, body: FIXTURE_PLAYLIST_ITEMS_WATCH_LATER },
      { url: PLAYLISTS_URL, status: 200, body: FIXTURE_PLAYLISTS_MINE },
      { url: playlistItemsUrl(FIXTURE_PLAYLIST_ID), status: 200, body: FIXTURE_PLAYLIST_ITEMS_RAIN },
    ]);

    const result = await connector.importFeedResult(CTX, { method: "api" });
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected the capture to succeed");

    const snapshot = result.value;
    expect(snapshot.connectorId).toBe(YOUTUBE_CONNECTOR_ID);
    expect(snapshot.method).toBe("api");
    expect(snapshot.capturedAt).toBe(new Date(NOW).toISOString());
    expect(snapshot.continuousSync).toBe(true);
    expect(snapshot.orderSemantics).toBe("source-native");
    // A CAPTURE IS A SNAPSHOT — never self-labeled live:
    expect(snapshot.syncState).toBe("snapshot");
    // The multi-container capture carries NO uniform sourceRef:
    expect(snapshot.sourceRef).toBeUndefined();
    // The bounded quota truth rides in metadata (5 calls = 5 units):
    expect(snapshot.metadata?.["quotaUnits"]).toBe(5);

    // Follows: the documented most-recent-first ARRAY order by index.
    const follows = snapshot.items.filter((item) => item.relationship === "follow");
    expect(follows.map((item) => item.externalRef)).toEqual([FIXTURE_CHANNEL_ID_B, FIXTURE_CHANNEL_ID]);
    expect(follows[0]?.sourceOrder).toBe(0);
    expect(follows[0]?.sourceUpdatedAt).toBe("2026-09-10T08:00:00Z"); // when the follow happened
    expect(follows[0]?.title).toBe("Storm Chasers Lab");
    expect(follows[0]?.sourceRef).toBeUndefined(); // the follow graph has no container

    // Likes: the LL page, container 'LL':
    const likes = snapshot.items.filter((item) => item.relationship === "like");
    expect(likes.map((item) => item.externalRef)).toEqual(["Wfx54Docu001", "Wfx54Short01"]);
    expect(likes.every((item) => item.sourceRef === "LL")).toBe(true);

    // Watch-later: the WL page:
    const watchlist = snapshot.items.filter((item) => item.relationship === "watchlist");
    expect(watchlist.map((item) => item.externalRef)).toEqual(["Wfx54Live000"]);
    expect(watchlist[0]?.sourceRef).toBe("WL");

    // Playlists: the provider's OWN positions — snippet.position (1 then 0),
    // NOT the array order:
    const playlistItems = snapshot.items.filter((item) => item.relationship === "playlist");
    expect(playlistItems.map((item) => item.externalRef)).toEqual(["Wfx54Docu001", "Wfx54NoEmbed0"]);
    expect(playlistItems[0]?.sourceOrder).toBe(1);
    expect(playlistItems[1]?.sourceOrder).toBe(0);
    expect(playlistItems.every((item) => item.sourceRef === FIXTURE_PLAYLIST_ID)).toBe(true);

    // Every request carried the OAuth bearer (user-scoped route):
    expect(requests.length).toBe(5);
    for (const request of requests) {
      expect(request.headers["authorization"]).toBe("Bearer fixture-access-token-feed");
    }
    // The empty playlist (itemCount 0) was skipped honestly — exactly 5 calls.
  });

  it("scopes to ONE playlist when sourceRef names it (single-container capture)", async () => {
    const { connector } = await readyFeedConnector([
      { url: playlistItemsUrl(FIXTURE_PLAYLIST_ID), status: 200, body: FIXTURE_PLAYLIST_ITEMS_RAIN },
    ]);
    const result = await connector.importFeedResult(CTX, {
      method: "api",
      relationships: ["playlist"],
      sourceRef: FIXTURE_PLAYLIST_ID,
    });
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("expected the scoped capture to succeed");
    expect(result.value.items.length).toBe(2);
    expect(result.value.sourceRef).toBe(FIXTURE_PLAYLIST_ID); // uniform container: named
    expect(result.value.metadata?.["quotaUnits"]).toBe(1);
  });

  it("relationship filters bound the capture (follows only = exactly one call)", async () => {
    const { connector, requests } = await readyFeedConnector([
      { url: SUBS_URL, status: 200, body: FIXTURE_SUBSCRIPTIONS },
    ]);
    const result = await connector.importFeedResult(CTX, {
      method: "api",
      relationships: ["follow"],
    });
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.items.length).toBe(2);
      expect(result.value.items.every((item) => item.relationship === "follow")).toBe(true);
    }
    expect(requests.length).toBe(1);
  });

  it("maps a provider failure to the typed SDK vocabulary (transport/unauthorized/quota)", async () => {
    const { connector } = await readyFeedConnector([
      { url: SUBS_URL, status: 403, body: FIXTURE_ERROR_QUOTA_EXCEEDED_BODY },
    ]);
    const result = await connector.importFeedResult(CTX, {
      method: "api",
      relationships: ["follow"],
    });
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(["transport", "unauthorized"]).toContain(result.error.kind);
      expect(result.error.kind === "transport" ? result.error.detail : "").toContain("quota");
    }
  });

  it("a malformed provider response is a typed transport failure — never a fabricated feed", async () => {
    const { connector } = await readyFeedConnector([
      { url: SUBS_URL, status: 200, body: { kind: "youtube#videoListResponse", items: [] } },
    ]);
    const result = await connector.importFeedResult(CTX, {
      method: "api",
      relationships: ["follow"],
    });
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error.kind).toBe("transport");
  });
});

/** The quota-exceeded error body the 403 fixture replays. */
const FIXTURE_ERROR_QUOTA_EXCEEDED_BODY = {
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
};

// ---------------------------------------------------------------------------
// Registry integration — the capability matrix truth
// ---------------------------------------------------------------------------

describe("registry integration — the feedImport capability truth", () => {
  it("the YouTube connector registers and the matrix reports feedImport", async () => {
    const registry = new ConnectorRegistry();
    const scripted = createScriptedYouTubeTransport([]);
    const connector = createYouTubeConnector({
      transport: scripted.transport,
      credentialSource: createInMemoryYouTubeCredentialSource(),
      clock: new TestClock(NOW),
    });
    await connector.initialize();
    registry.register(connector);
    const matrix = registry.capabilityMatrix();
    const row = matrix.find((entry) => entry.id === YOUTUBE_CONNECTOR_ID);
    expect(row).toBeDefined();
    expect(row?.capabilities.feedImport).toBe(true);
    expect(registry.withCapability("feedImport").map((entry) => entry.descriptor().id)).toContain(
      YOUTUBE_CONNECTOR_ID,
    );
    // The truth is NOT inferred from catalogSearch:
    const catalogOnly = makeStubConnector();
    await catalogOnly.initialize();
    registry.register(catalogOnly);
    expect(registry.withCapability("feedImport").map((entry) => entry.descriptor().id)).not.toContain(
      catalogOnly.descriptor().id,
    );
  });
});
