/**
 * R20-H — the apps/api feed-import route tests (bun:test).
 *
 * Exercises the FULL `/feeds/**` surface by importing the route handlers
 * directly (no server, no network) over a COMPLETE `ApiBoot` composition
 * whose feed-import wiring is the REAL YouTube connector
 * (@wfx/connectors) over its RECORDED fixtures — the exact wiring law the
 * web fixtures host (`apps/web/src/host/byof/byof-fixtures.ts`)
 * established: the URL-keyed deterministic transport answering the
 * documented endpoint URLs with the recorded fixture bodies, the
 * in-memory credential source holding the (fixture) grant, and the
 * projection truth (`feedItemCanonicalType: "video"`) riding on the
 * wiring. The service under the routes is the REAL `FeedImportService`
 * (@wfx/persistence, R20-C) over the REAL migration set on PGlite.
 *
 * Laws pinned here (the R20 dispatch's truth laws, over HTTP):
 * - TYPED SUCCESS PATHS: preview stages the capture with its DISPLAY
 *   COLUMNS (escalation 4: title/externalRef); confirm promotes
 *   idempotently; the records read answers the source-native order; the
 *   webflix mode is ALWAYS EMPTY (the mode-truth law served, not
 *   filtered client-side).
 * - TYPED FAILURE PATHS: the missing grant answers 401 with the honest
 *   audit row (never a silent empty); the export-file method and the
 *   non-exposable relationships answer the typed 409 `unsupported`
 *   verdicts; an unknown connector answers 404; garbage bodies answer
 *   the typed 400 naming every problem.
 * - THE DESTRUCTIVE TWO-STEP LAW: disconnect RETAINS every record (the
 *   W2 fold verbatim — the marker prefix, reauthorization-required);
 *   delete-records is the SEPARATE explicit destructive action that
 *   alone removes records, and it states exactly how many.
 * - THE HONEST SYNC: the changed source reconciles with the engine's
 *   own counts; a failed re-authorization lands
 *   reauthorization-required with records RETAINED.
 * - IDEMPOTENCE: re-import over HTTP creates zero duplicate records
 *   (the import-key law).
 *
 * Determinism: PGlite + the test boot's FixedClock/SequentialIdGen + the
 * connector's fixed clock inside the recorded fixtures' timestamp world;
 * the mutable source phase (the J33 "source changed" drive) is this
 * file's own scripted state; no network.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import {
  FIXTURE_PLAYLISTS_MINE,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_PLAYLIST_ITEMS_RAIN,
  FIXTURE_PLAYLIST_ITEMS_WATCH_LATER,
  FIXTURE_SUBSCRIPTIONS,
  YOUTUBE_CONNECTOR_ID,
  YOUTUBE_FEED_RELATIONSHIPS,
  createInMemoryYouTubeCredentialSource,
  createYouTubeConnector,
  type YouTubeHttpTransport,
  type YouTubePlaylistItemListResponse,
  type YouTubeSubscriptionListResponse,
  type YouTubeTokenSet,
} from "@wfx/connectors";
import type { FeedConnectorWiring } from "../src/host/feed-import";

import { GET as sourcesGET } from "../src/app/feeds/sources/route";
import { POST as previewPOST } from "../src/app/feeds/preview/route";
import { GET as previewGET } from "../src/app/feeds/preview/[importId]/route";
import { POST as confirmPOST } from "../src/app/feeds/preview/[importId]/confirm/route";
import { POST as discardPOST } from "../src/app/feeds/preview/[importId]/discard/route";
import { GET as importsGET } from "../src/app/feeds/imports/route";
import { GET as recordsGET } from "../src/app/feeds/records/route";
import { POST as syncPOST } from "../src/app/feeds/imports/[importId]/sync/route";
import { POST as disconnectPOST } from "../src/app/feeds/imports/[importId]/disconnect/route";
import { POST as deletePOST } from "../src/app/feeds/imports/[importId]/delete-records/route";
import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import {
  createApiTestBoot,
  identityHeaders,
  postRequest,
  getRequest,
  type ApiTestBoot,
} from "./test-boot";

// ---------------------------------------------------------------------------
// The scripted source (the recorded fixtures, URL-keyed — the web fixtures
// host's transport law, mirrored verbatim)
// ---------------------------------------------------------------------------

const SUBS_URL =
  "https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50";
const LIKED_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=LL&maxResults=50";
const WATCH_LATER_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=WL&maxResults=50";
const PLAYLISTS_URL =
  "https://www.googleapis.com/youtube/v3/playlists?part=snippet%2CcontentDetails&mine=true&maxResults=25";
const RAIN_PLAYLIST_URL = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=PLwfx54Fixture000000000000000001&maxResults=50`;

/** A synthetic third channel (24 chars, "UC" prefix — the fixture grammar). */
const AURORA_CHANNEL_ID = "UCWfx54Channel00000000000C";

/** The ADVANCED source phase (the J33 sync step's changed source). */
const FIXTURE_SUBSCRIPTIONS_ADVANCED: YouTubeSubscriptionListResponse = {
  ...FIXTURE_SUBSCRIPTIONS,
  etag: "fixture-etag-subs-advanced",
  pageInfo: { totalResults: 3, resultsPerPage: 50 },
  items: [
    {
      kind: "youtube#subscription",
      etag: "fixture-etag-sub-c",
      id: "FIXTURE_SUB_C",
      snippet: {
        publishedAt: "2026-09-18T09:00:00Z",
        title: "Aurora Nights",
        description: "A newly followed fixture channel (the advanced source phase).",
        channelId: AURORA_CHANNEL_ID,
        resourceId: { kind: "youtube#channel", channelId: AURORA_CHANNEL_ID },
      },
    },
    ...FIXTURE_SUBSCRIPTIONS.items,
  ],
};

const FIXTURE_PLAYLIST_ITEMS_LIKED_ADVANCED: YouTubePlaylistItemListResponse = {
  ...FIXTURE_PLAYLIST_ITEMS_LIKED,
  etag: "fixture-etag-pl-items-advanced",
  // The 45-second like was removed at the source; the documentary remains.
  items: [FIXTURE_PLAYLIST_ITEMS_LIKED.items[0]!],
};

/** One source phase: the URL → recorded-body map a capture reads. */
type SourcePhase = ReadonlyMap<string, unknown>;

const PHASE_INITIAL: SourcePhase = new Map<string, unknown>([
  [SUBS_URL, FIXTURE_SUBSCRIPTIONS],
  [LIKED_URL, FIXTURE_PLAYLIST_ITEMS_LIKED],
  [WATCH_LATER_URL, FIXTURE_PLAYLIST_ITEMS_WATCH_LATER],
  [PLAYLISTS_URL, FIXTURE_PLAYLISTS_MINE],
  [RAIN_PLAYLIST_URL, FIXTURE_PLAYLIST_ITEMS_RAIN],
]);

const PHASE_ADVANCED: SourcePhase = new Map<string, unknown>([
  [SUBS_URL, FIXTURE_SUBSCRIPTIONS_ADVANCED],
  [LIKED_URL, FIXTURE_PLAYLIST_ITEMS_LIKED_ADVANCED],
  [WATCH_LATER_URL, FIXTURE_PLAYLIST_ITEMS_WATCH_LATER],
  [PLAYLISTS_URL, FIXTURE_PLAYLISTS_MINE],
  [RAIN_PLAYLIST_URL, FIXTURE_PLAYLIST_ITEMS_RAIN],
]);

/** The mutable wiring state the drives move (reads never advance it). */
interface WiringState {
  phase: SourcePhase;
  authorized: boolean;
}
const wiringState: WiringState = { phase: PHASE_INITIAL, authorized: false };

/** The connector clock — fixed inside the recorded fixtures' world. */
const YT_CLOCK_NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
class FixedYouTubeClock {
  now(): number {
    return YT_CLOCK_NOW;
  }
}

/** The fixture grant (valid while stored — the connect drive stores it). */
function byofFixtureTokens(): YouTubeTokenSet {
  return {
    accessToken: "fixture-access-token-r20h-api",
    refreshToken: "fixture-refresh-token-r20h-api",
    tokenType: "Bearer",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    expiresAtMs: YT_CLOCK_NOW + 3600 * 1000,
    obtainedAtMs: YT_CLOCK_NOW,
  };
}

/** The URL-keyed deterministic transport (the web fixtures host's law). */
function createPhaseTransport(getPhase: () => SourcePhase): YouTubeHttpTransport {
  return {
    async request(request: { readonly url: string }): Promise<{ readonly status: number; readonly bodyText: string }> {
      const body = getPhase().get(request.url);
      if (body === undefined) {
        throw new Error(
          `feeds route test transport: no scripted reply for '${request.url}' — an unscripted endpoint is a bug in the test, never a fabricated answer`,
        );
      }
      return { status: 200, bodyText: JSON.stringify(body) };
    },
  };
}

/** The in-memory credential source (the grant's own presence is the truth). */
const credentialSource = createInMemoryYouTubeCredentialSource();

// ---------------------------------------------------------------------------
// The boot (one per file; the drives restore pristine state per test)
// ---------------------------------------------------------------------------

const TEST_USER = "wfx-api-test-user";
const TEST_PROFILE_KEY = `user:${TEST_USER}`;

let apiBoot: ApiTestBoot | undefined;

beforeAll(async () => {
  const connector = createYouTubeConnector({
    transport: createPhaseTransport(() => wiringState.phase),
    credentialSource,
    clock: new FixedYouTubeClock(),
  });
  const feedWiring: FeedConnectorWiring[] = [
    {
      connector,
      importable: [...YOUTUBE_FEED_RELATIONSHIPS],
      unavailable: [
        {
          relationship: "history",
          reason:
            "YouTube's watch history is only available in your Google Takeout export; the Data API does not serve it.",
        },
        { relationship: "ranked-feed", reason: "YouTube's personalized home feed has no exportable API." },
      ],
      continuousSync: true,
      feedItemCanonicalType: "video",
    },
  ];
  apiBoot = await createApiTestBoot({ feedWiring });
  setApiBootForTests(apiBoot.boot);
});

beforeEach(async () => {
  // Pristine BYOF state per test: the harness DB's feed rows wiped, the
  // source back to its initial phase, the grant absent.
  if (apiBoot === undefined) throw new Error("test setup: the api boot did not happen");
  await apiBoot.testDb.db.query(`DELETE FROM feed_preview_items`);
  await apiBoot.testDb.db.query(`DELETE FROM feed_records`);
  await apiBoot.testDb.db.query(`DELETE FROM feed_imports`);
  await credentialSource.clear(TEST_USER);
  wiringState.phase = PHASE_INITIAL;
  wiringState.authorized = false;
});

afterAll(async () => {
  resetApiBootForTests();
  if (apiBoot !== undefined) await apiBoot.testDb.close();
});

// ---------------------------------------------------------------------------
// Helpers (the typed answer readers)
// ---------------------------------------------------------------------------

/** One typed route failure body. */
interface RouteFailure {
  readonly error?: unknown;
  readonly detail?: unknown;
  readonly importId?: unknown;
  readonly syncState?: unknown;
}

async function readFailure(response: Response): Promise<RouteFailure> {
  return (await response.json()) as RouteFailure;
}

/** The typed answer of one staged preview. */
interface StagedPreview {
  readonly importId: string;
  readonly connectorId: string;
  readonly itemCount: number;
  readonly relationshipCounts: Record<string, number>;
  readonly freshness: string;
  readonly continuousSync: boolean;
  readonly items: readonly {
    readonly externalRef: string;
    readonly relationship: string;
    readonly sourceOrder: number;
    readonly title?: string;
    readonly entertainmentItemId: string;
  }[];
}

/** One persisted import row as the routes serve it. */
interface ImportRow {
  readonly id: string;
  readonly connectorId: string;
  readonly method: string;
  readonly status: string;
  readonly syncState: string;
  readonly continuousSync: boolean;
  readonly itemCount: number;
  readonly relationships?: readonly string[];
  readonly error?: string;
}

/** Stage + confirm one import (the J33 spine over HTTP). */
async function importFeed(): Promise<string> {
  const preview = await previewPOST(
    postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
  );
  if (preview.status !== 200) throw new Error(`preview failed: ${preview.status}`);
  const body = (await preview.json()) as { preview: StagedPreview };
  const confirmed = await confirmPOST(
    postRequest(`/feeds/preview/${body.preview.importId}/confirm`, {}, identityHeaders()),
    { params: Promise.resolve({ importId: body.preview.importId }) },
  );
  if (confirmed.status !== 200) throw new Error(`confirm failed: ${confirmed.status}`);
  return body.preview.importId;
}

/** Read the current records of one mode. */
async function readRecords(mode: string): Promise<readonly unknown[]> {
  const response = await recordsGET(getRequest(`/feeds/records?mode=${mode}`, identityHeaders()));
  const body = (await response.json()) as { records: readonly unknown[] };
  return body.records;
}

// ---------------------------------------------------------------------------
// The sources route (the choose-source step's truth)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — the importable sources", () => {
  it("answers the wired connector's documented feed truth with the not-connected state", async () => {
    const response = await sourcesGET(getRequest("/feeds/sources", identityHeaders()));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sources: {
        connectorId: string;
        displayName: string;
        connected: boolean;
        continuousSync: boolean;
        importable: string[];
        unavailable: { relationship: string; reason: string }[];
      }[];
    };
    expect(body.sources.length).toBe(1);
    const source = body.sources[0]!;
    expect(source.connectorId).toBe(YOUTUBE_CONNECTOR_ID);
    expect(source.displayName).toBe("YouTube");
    // No durable account row: the honest not-connected truth.
    expect(source.connected).toBe(false);
    expect(source.continuousSync).toBe(true);
    expect(source.importable).toEqual(["follow", "like", "watchlist", "playlist"]);
    expect(source.unavailable.map((entry) => entry.relationship)).toEqual(["history", "ranked-feed"]);
    expect(source.unavailable[0]!.reason).toContain("Google Takeout export");
  });

  it("derives the connected truth from the durable account store (the R03 law)", async () => {
    await apiBoot!.boot.connectorAccounts.saveAccount({
      userId: TEST_USER,
      connectorId: YOUTUBE_CONNECTOR_ID,
      kind: "oauth-token",
      authState: "signedIn",
      secret: "sealed-stub-token-set",
      metadata: { expiresAtMs: YT_CLOCK_NOW + 3600 * 1000 },
    });
    const response = await sourcesGET(getRequest("/feeds/sources", identityHeaders()));
    const body = (await response.json()) as { sources: { connected: boolean }[] };
    expect(body.sources[0]!.connected).toBe(true);
  });

  it("an expired token is REPORTED not-connected — never silently connected", async () => {
    await apiBoot!.boot.connectorAccounts.saveAccount({
      userId: TEST_USER,
      connectorId: YOUTUBE_CONNECTOR_ID,
      kind: "oauth-token",
      authState: "signedIn",
      secret: "sealed-stub-token-set",
      // Expired relative to the boot's fixed clock (epoch+30s), not the
      // recorded fixtures' timestamp world.
      metadata: { expiresAtMs: 10_000 },
    });
    const response = await sourcesGET(getRequest("/feeds/sources", identityHeaders()));
    const body = (await response.json()) as { sources: { connected: boolean }[] };
    expect(body.sources[0]!.connected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The preview route (capture + staging, with display columns)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — the preview capture", () => {
  it("without the grant the attempt answers the typed 401 and lands its honest audit row", async () => {
    const response = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    expect(response.status).toBe(401);
    const failure = await readFailure(response);
    expect(failure.error).toBe("unauthorized");
    expect(String(failure.detail)).toContain("no valid credentials");
    expect(failure.syncState).toBe("reauthorization-required");
    expect(typeof failure.importId).toBe("string");
    // The honest attempt trail (never a silent empty state).
    const imports = await importsGET(getRequest("/feeds/imports", identityHeaders()));
    const trail = (await imports.json()) as { imports: ImportRow[] };
    expect(trail.imports.length).toBe(1);
    expect(trail.imports[0]!.status).toBe("reauthorization-required");
    expect(trail.imports[0]!.itemCount).toBe(0);
  });

  it("with the grant the staged preview carries the capture truth AND the display columns", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const response = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { preview: StagedPreview };
    const preview = body.preview;
    expect(preview.connectorId).toBe("youtube");
    expect(preview.itemCount).toBe(7);
    expect(preview.relationshipCounts).toEqual({ follow: 2, like: 2, watchlist: 1, playlist: 2 });
    // A capture is a SNAPSHOT — never presented as live.
    expect(preview.freshness).toBe("snapshot");
    expect(preview.continuousSync).toBe(true);
    // Escalation 4: the display columns (title/externalRef), in the
    // store's own staged-read order (`ORDER BY position` — the same law
    // the store's readPreview and the web fixtures host's documented
    // SELECT apply).
    expect(preview.items.length).toBe(7);
    expect(preview.items[0]!.title).toBe("Storm Chasers Lab");
    expect(preview.items[0]!.relationship).toBe("follow");
    const titles = preview.items.map((item) => item.title ?? item.externalRef);
    expect(titles).toContain("WebFlix Fixture Channel");
    expect(titles).toContain("Desert Rain — A Night Documentary");
    expect(titles).toContain("Desert Rain in 45 Seconds");
    // The same video captured in TWO relationships (a like in "LL" and a
    // row of the owned playlist) stages TWO rows sharing one externalRef —
    // the graph-merge law's input (pinned by the persistence tests).
  });

  it("the staged preview read serves the same display truth (and 404s after confirm)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const staged = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    const body = (await staged.json()) as { preview: StagedPreview };
    const read = await previewGET(
      getRequest(`/feeds/preview/${body.preview.importId}`, identityHeaders()),
      { params: Promise.resolve({ importId: body.preview.importId }) },
    );
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { preview: StagedPreview };
    expect(readBody.preview.items[0]!.title).toBe("Storm Chasers Lab");
    // After confirm the preview is GONE (honest 404, not a stale read).
    await confirmPOST(
      postRequest(`/feeds/preview/${body.preview.importId}/confirm`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: body.preview.importId }) },
    );
    const after = await previewGET(
      getRequest(`/feeds/preview/${body.preview.importId}`, identityHeaders()),
      { params: Promise.resolve({ importId: body.preview.importId }) },
    );
    expect(after.status).toBe(404);
  });

  it("the export-file method answers the typed 409 unsupported verdict (capability truth)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const response = await previewPOST(
      postRequest(
        "/feeds/preview",
        {
          connectorId: "youtube",
          method: "official-export",
          artifact: Buffer.from("takeout-zip-bytes").toString("base64"),
        },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(409);
    const failure = await readFailure(response);
    expect(failure.error).toBe("unsupported");
    expect(String(failure.detail)).toContain("authorized API import route only");
  });

  it("a non-exposable relationship filter answers the typed 409 verdict naming the truth", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const response = await previewPOST(
      postRequest(
        "/feeds/preview",
        { connectorId: "youtube", relationships: ["history"] },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(409);
    const failure = await readFailure(response);
    expect(failure.error).toBe("unsupported");
    expect(String(failure.detail)).toContain("cannot expose: history");
    expect(String(failure.detail)).toContain("Google Takeout export");
  });

  it("an unknown connector answers the typed 404 unknown-connector verdict", async () => {
    const response = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "vudu" }, identityHeaders()),
    );
    expect(response.status).toBe(404);
    const failure = await readFailure(response);
    expect(failure.error).toBe("unknown-connector");
  });

  it("a garbage body answers the typed 400 naming every problem at once", async () => {
    const response = await previewPOST(
      postRequest(
        "/feeds/preview",
        { connectorId: "", method: "takeout", relationships: [], artifact: 5, extra: true },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(400);
    const failure = await readFailure(response);
    const detail = String(failure.detail);
    expect(detail).toContain("connectorId");
    expect(detail).toContain("method");
    expect(detail).toContain("relationships");
    expect(detail).toContain("artifact");
    expect(detail).toContain("extra");
  });

  it("a garbage (non-JSON) body answers the typed 400", async () => {
    const response = await previewPOST(
      postRequest("/feeds/preview", "{not json", identityHeaders()),
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The confirm + records routes (the import lands; the mode-truth law)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — confirm, records, and the mode-truth law", () => {
  it("confirm promotes the preview and the records read answers the source-native order", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const importId = await importFeed();
    const confirmed = await importsGET(getRequest("/feeds/imports", identityHeaders()));
    const trail = (await confirmed.json()) as { imports: ImportRow[] };
    const row = trail.imports.find((entry) => entry.id === importId)!;
    expect(row.status).toBe("complete");
    // The continuous route lands LIVE after confirm (never labeled from a
    // capture's self-assignment).
    expect(row.syncState).toBe("live");

    const records = (await readRecords("byof")) as {
      externalRef: string;
      title?: string;
      importId: string;
      provenance: { sourceOrder: number; relationship: string; importMethod: string };
    }[];
    expect(records.length).toBe(7);
    // The store's source-native read order: follows first (relationship
    // groups in the store's own order), titles riding along.
    expect(records[0]!.provenance.relationship).toBe("follow");
    expect(records[0]!.title).toBe("Storm Chasers Lab");
    expect(records.every((record) => record.importId === importId)).toBe(true);
  });

  it("the webflix mode is ALWAYS EMPTY over HTTP (imported records are never re-labeled)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    await importFeed();
    expect((await readRecords("webflix")).length).toBe(0);
    expect((await readRecords("byof")).length).toBe(7);
    const following = (await readRecords("following")) as {
      provenance: { relationship: string };
    }[];
    expect(following.length).toBe(2);
    expect(following.every((record) => record.provenance.relationship === "follow")).toBe(true);
  });

  it("an unknown read mode answers the typed 400", async () => {
    const response = await recordsGET(getRequest("/feeds/records?mode=ranked", identityHeaders()));
    expect(response.status).toBe(400);
  });

  it("re-import over HTTP is idempotent — no duplicate records (the import-key law)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    await importFeed();
    await importFeed();
    expect((await readRecords("byof")).length).toBe(7);
  });

  it("confirming a failed attempt answers the typed 400 (it never staged a preview)", async () => {
    // The no-grant attempt lands the honest audit row.
    const failed = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    const failure = await readFailure(failed);
    const failedImportId = failure.importId as string;
    const response = await confirmPOST(
      postRequest(`/feeds/preview/${failedImportId}/confirm`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: failedImportId }) },
    );
    expect(response.status).toBe(400);
    const body = await readFailure(response);
    expect(body.error).toBe("invalid-input");
    expect(String(body.detail)).toContain("never staged a preview to confirm");
  });
});

// ---------------------------------------------------------------------------
// The sync route (the honest reconciliation)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — the incremental sync", () => {
  it("a still-preview import answers the typed 400 refusal (nothing is imported yet)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const staged = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    const body = (await staged.json()) as { preview: StagedPreview };
    const response = await syncPOST(
      postRequest(`/feeds/imports/${body.preview.importId}/sync`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: body.preview.importId }) },
    );
    expect(response.status).toBe(400);
    const failure = await readFailure(response);
    expect(failure.error).toBe("invalid-input");
    expect(String(failure.detail)).toContain("still a preview");
  });

  it("the changed source reconciles with the engine's own honest counts", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const importId = await importFeed();
    wiringState.phase = PHASE_ADVANCED;
    const response = await syncPOST(
      postRequest(`/feeds/imports/${importId}/sync`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: importId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      import: ImportRow;
      report: { added: number; updated: number; removed: number; kept: number };
    };
    // One new follow added, two follows re-ordered (updated), one like
    // removed at the source, four unchanged — the engine's honest diff.
    expect(body.report).toMatchObject({ added: 1, updated: 2, removed: 1, kept: 4 });
    expect(body.import.syncState).toBe("live");
    const records = (await readRecords("byof")) as { title?: string }[];
    expect(records.length).toBe(7);
    expect(records.some((record) => record.title === "Aurora Nights")).toBe(true);
    expect(records.some((record) => record.title === "Desert Rain in 45 Seconds")).toBe(false);
  });

  it("a failed re-authorization lands reauthorization-required with the records RETAINED", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const importId = await importFeed();
    // The grant disappears (the J33 authorization-failure drive).
    await credentialSource.clear(TEST_USER);
    const response = await syncPOST(
      postRequest(`/feeds/imports/${importId}/sync`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: importId }) },
    );
    expect(response.status).toBe(401);
    const failure = await readFailure(response);
    expect(failure.error).toBe("unauthorized");
    expect(failure.syncState).toBe("reauthorization-required");
    expect(failure.importId).toBe(importId);
    // The records SURVIVE the failing sync (the retention law).
    expect((await readRecords("byof")).length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// The disconnect + delete-records routes (the destructive two-step law)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — the destructive two-step law", () => {
  it("disconnect is NON-destructive: the W2 fold verbatim, records retained", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const importId = await importFeed();
    const response = await disconnectPOST(
      postRequest(`/feeds/imports/${importId}/disconnect`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: importId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; importId: string };
    expect(body.ok).toBe(true);
    expect(body.importId).toBe(importId);

    // Every record still serves (provenance survives — the survival law).
    expect((await readRecords("byof")).length).toBe(7);
    // The fold: reauthorization-required carrying the marker prefix, with
    // the retention sentence (exactly the W2-shipped fold).
    const imports = await importsGET(getRequest("/feeds/imports", identityHeaders()));
    const trail = (await imports.json()) as { imports: ImportRow[] };
    const row = trail.imports.find((entry) => entry.id === importId)!;
    expect(row.syncState).toBe("reauthorization-required");
    expect(row.error?.startsWith("Import disconnected by the user")).toBe(true);
    expect(row.error).toContain("records and their provenance are retained");
  });

  it("a disconnect refusal names the record-ownership precondition (a preview owns none)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const staged = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    const body = (await staged.json()) as { preview: StagedPreview };
    const response = await disconnectPOST(
      postRequest(`/feeds/imports/${body.preview.importId}/disconnect`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: body.preview.importId }) },
    );
    expect(response.status).toBe(400);
    const failure = await readFailure(response);
    expect(failure.error).toBe("invalid-input");
    expect(String(failure.detail)).toContain("owns no imported records");
  });

  it("delete-records is the SEPARATE explicit destructive action — it alone removes records", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const importId = await importFeed();
    // Disconnect first: the records are RETAINED (never a delete side effect).
    await disconnectPOST(
      postRequest(`/feeds/imports/${importId}/disconnect`, {}, identityHeaders()),
      { params: Promise.resolve({ importId }) },
    );
    expect((await readRecords("byof")).length).toBe(7);
    // The explicit delete (the action the client's two-step arm releases).
    const response = await deletePOST(
      postRequest(`/feeds/imports/${importId}/delete-records`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: importId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; removed: number };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(7);
    // The records are gone; the import row remains as the store's audit trail.
    expect((await readRecords("byof")).length).toBe(0);
    const imports = await importsGET(getRequest("/feeds/imports", identityHeaders()));
    const trail = (await imports.json()) as { imports: ImportRow[] };
    expect(trail.imports.some((entry) => entry.id === importId)).toBe(true);
  });

  it("an unknown import answers the typed 404 on every addressed route", async () => {
    const unknown = "wfximp_unknown0000000000000000";
    const syncAnswer = await syncPOST(
      postRequest(`/feeds/imports/${unknown}/sync`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: unknown }) },
    );
    expect(syncAnswer.status).toBe(404);
    const disconnectAnswer = await disconnectPOST(
      postRequest(`/feeds/imports/${unknown}/disconnect`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: unknown }) },
    );
    expect(disconnectAnswer.status).toBe(404);
    const deleteAnswer = await deletePOST(
      postRequest(`/feeds/imports/${unknown}/delete-records`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: unknown }) },
    );
    expect(deleteAnswer.status).toBe(404);
    const failure = await readFailure(deleteAnswer);
    expect(failure.error).toBe("not-found");
  });
});

// ---------------------------------------------------------------------------
// The discard route (escalation 4 — the presentation lifecycle)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — the preview discard (escalation 4)", () => {
  it("discarding a staged preview removes the staging and nothing else", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const staged = await previewPOST(
      postRequest("/feeds/preview", { connectorId: "youtube" }, identityHeaders()),
    );
    const body = (await staged.json()) as { preview: StagedPreview };
    const importId = body.preview.importId;

    const discard = await discardPOST(
      postRequest(`/feeds/preview/${importId}/discard`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: importId }) },
    );
    expect(discard.status).toBe(200);
    const discardBody = (await discard.json()) as { ok: boolean; importId: string };
    expect(discardBody.importId).toBe(importId);

    // The staged rows + import row are gone; NO feed records ever existed
    // (records exist solely after confirm — the store's law).
    const imports = await importsGET(getRequest("/feeds/imports", identityHeaders()));
    const trail = (await imports.json()) as { imports: ImportRow[] };
    expect(trail.imports.length).toBe(0);
    expect((await readRecords("byof")).length).toBe(0);
    const read = await previewGET(
      getRequest(`/feeds/preview/${importId}`, identityHeaders()),
      { params: Promise.resolve({ importId }) },
    );
    expect(read.status).toBe(404);
  });

  it("only a staged preview can be discarded (a confirmed import answers the typed refusal)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    const importId = await importFeed();
    const response = await discardPOST(
      postRequest(`/feeds/preview/${importId}/discard`, {}, identityHeaders()),
      { params: Promise.resolve({ importId: importId }) },
    );
    expect(response.status).toBe(400);
    const failure = await readFailure(response);
    expect(failure.error).toBe("invalid-input");
    expect(String(failure.detail)).toContain("only a staged preview can be discarded");
    // The confirmed import's records were NOT touched by the refusal.
    expect((await readRecords("byof")).length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// The identity laws (headers, never URLs; the anonymous transition)
// ---------------------------------------------------------------------------

describe("R20-H feeds routes — the identity laws", () => {
  it("an absent identity header answers the typed 400 (identity never rides in URLs)", async () => {
    const response = await sourcesGET(getRequest("/feeds/sources"));
    expect(response.status).toBe(400);
  });

  it("the anonymous identity scopes every row to the same effective profile key", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    await importFeed();
    const records = (await readRecords("byof")) as { profileId: string }[];
    expect(records.length).toBe(7);
    expect(records.every((record) => record.profileId === TEST_PROFILE_KEY)).toBe(true);
  });

  it("a different anonymous identity reads the honest empty state (never another user's feed)", async () => {
    await credentialSource.store(TEST_USER, byofFixtureTokens());
    await importFeed();
    const response = await recordsGET(
      getRequest("/feeds/records?mode=byof", identityHeaders({ "x-wfx-user-id": "wfx-other-user" })),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { records: unknown[] };
    expect(body.records.length).toBe(0);
  });
});
