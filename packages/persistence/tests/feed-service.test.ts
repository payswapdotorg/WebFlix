/**
 * @wfx/persistence — R20-C BYOF feed import SERVICE tests (PGlite, real
 * Postgres).
 *
 * The composition layer's laws, pinned end-to-end against the actual
 * tables (part 1: a scripted fixture port) AND against the REAL YouTube
 * connector (part 2 — @wfx/connectors is a devDependency here, so the
 * integration proves the structural port + the full J33-shaped path:
 * preview → confirm → sync, all through the documented API fixtures).
 *
 * Laws pinned here (docs/architecture/byof-architecture.md + the R20 plan):
 * - SNAPSHOT IMPORT: preview stages the capture verbatim (per-item
 *   provenance: connector, method, container, source-native order,
 *   capturedAt); confirm promotes idempotently.
 * - CANONICAL IDENTITY RESOLUTION: existing record → known realization →
 *   mint (item + realization rows in the Entertainment Graph) → deferred
 *   (follows: a channel is NOT an EntertainmentItem; no fabricated type).
 *   The same video in two containers resolves to ONE canonical item.
 * - IDEMPOTENCE: re-importing the same capture creates zero duplicates and
 *   keeps stable record identity; confirming twice is a no-op.
 * - INCREMENTAL SYNC: the honest decision table — add / update
 *   (source-changed, order-changed) / remove (source-removed) / keep — with
 *   the SCOPE discipline (a likes-only sync never removes another import's
 *   follows) and DEDUPLICATION reported.
 * - STALE/OFFLINE SEMANTICS: unauthorized sync → `reauthorization-required`
 *   (records RETAINED); transport failure → `stale` with records /
 *   `degraded` without; a one-time route answers the typed `unsupported`
 *   (re-import, never a fake refresh). Failed capture attempts land their
 *   honest audit rows.
 * - WEBFLIX-LOCAL PRESERVATION: import + sync leave library_entries,
 *   watch_history, user_intents, and recommendation_state UNTOUCHED.
 * - MODE TRUTH: readFeed('webflix') is always [] (imported records are
 *   never re-labeled WebFlix-ranked); 'following' is the follow subset.
 *
 * Determinism: PGlite + FixedClock + SequentialIdGen; no network.
 */

import { afterEach, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";
import type {
  ConnectorDescriptor,
  ConnectorFeedSnapshot,
  FeedImportRequest,
  FeedRelationship,
} from "@wfx/domain";

import {
  FeedImportService,
  type FeedConnectorFailure,
  type FeedConnectorPort,
  type FeedConnectorSnapshotResult,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 19, 10, 0, 0);
const T0 = "2026-09-19T10:00:00.000Z";
const T1 = "2026-09-19T11:00:00.000Z";
const USER = "wfxusr_feedservice_r20c";
const PROFILE = "wfxusr_feedservice_r20c:main";

let test: TestDb | undefined;
let clock: FixedClock;
let ids: SequentialIdGen;
let service: FeedImportService;
let port: FixtureFeedPort;

// ---------------------------------------------------------------------------
// The scripted fixture port (the structural seam, satisfied by hand)
// ---------------------------------------------------------------------------

interface ScriptedReply {
  readonly snapshot?: ConnectorFeedSnapshot;
  readonly error?: FeedConnectorFailure;
}

class FixtureFeedPort implements FeedConnectorPort {
  readonly calls: FeedImportRequest[] = [];
  readonly feedItemCanonicalType?: "video";
  private readonly script: (request: FeedImportRequest) => ScriptedReply;

  constructor(script: (request: FeedImportRequest) => ScriptedReply, typed?: "video") {
    this.script = script;
    if (typed !== undefined) this.feedItemCanonicalType = typed;
  }

  descriptor(): ConnectorDescriptor {
    return {
      id: "fixture-feed",
      version: "1.0.0",
      displayName: "Fixture Feed",
      capabilities: ["feedImport", "playExternal"],
      auth: "oauth",
    };
  }

  async importFeedResult(
    _ctx: Parameters<FeedConnectorPort["importFeedResult"]>[0],
    request: FeedImportRequest,
  ): Promise<FeedConnectorSnapshotResult> {
    this.calls.push(request);
    const reply = this.script(request);
    if (reply.error !== undefined) {
      return { ok: false, error: reply.error };
    }
    if (reply.snapshot === undefined) {
      throw new Error("fixture port: no snapshot and no error scripted");
    }
    return { ok: true, value: reply.snapshot };
  }
}

function snap(
  items: ConnectorFeedSnapshot["items"],
  overrides: Partial<ConnectorFeedSnapshot> = {},
): ConnectorFeedSnapshot {
  return {
    connectorId: "fixture-feed",
    method: "api",
    capturedAt: T0,
    continuousSync: true,
    orderSemantics: "source-native",
    syncState: "snapshot",
    items,
    ...overrides,
  };
}

function item(
  externalRef: string,
  relationship: FeedRelationship,
  overrides: Partial<ConnectorFeedSnapshot["items"][number]> = {},
): ConnectorFeedSnapshot["items"][number] {
  return {
    externalRef,
    relationship,
    sourceOrder: 0,
    ...overrides,
  };
}

async function countRows(table: string): Promise<number> {
  const rows = await test!.db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${table}`,
  );
  return Number((rows[0] as { count: number } | undefined)?.count ?? 0);
}

function setup(script: (request: FeedImportRequest) => ScriptedReply, typed?: "video"): void {
  port = new FixtureFeedPort(script, typed);
  service = new FeedImportService({
    db: test!.db,
    clock,
    ids,
    connectors: (connectorId) => (connectorId === "fixture-feed" ? port : undefined),
  });
}

afterEach(async () => {
  if (test !== undefined) await test.close();
});

async function boot(script: (request: FeedImportRequest) => ScriptedReply, typed?: "video"): Promise<void> {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  setup(script, typed);
}

describe("R20-C service — snapshot import", () => {
  it("previews and confirms a capture with full per-item provenance", async () => {
    await boot(() => ({
      snapshot: snap([
        item("vidA", "like", { sourceRef: "LL", sourceOrder: 0, title: "Video A" }),
        item("UCchan1", "follow", { sourceOrder: 0, title: "Channel One" }),
      ]),
    }));
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en", region: "US" },
      connectorId: "fixture-feed",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error.detail);
    expect(preview.value.itemCount).toBe(2);
    expect(preview.value.relationshipCounts).toEqual({ like: 1, follow: 1 });
    expect(preview.value.freshness).toBe("snapshot");

    const confirmed = await service.confirmFeedImport(preview.value.importId);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.error.detail);
    expect(confirmed.value.status).toBe("complete");
    expect(confirmed.value.syncState).toBe("live"); // continuous route lands live
    expect(confirmed.value.continuousSync).toBe(true);

    const records = await service.readFeed(PROFILE, "byof");
    expect(records.length).toBe(2);
    const like = records.find((r) => r.provenance.relationship === "like");
    expect(like?.externalRef).toBe("vidA");
    expect(like?.provenance.connectorId).toBe("fixture-feed");
    expect(like?.provenance.importMethod).toBe("api");
    expect(like?.provenance.sourceRef).toBe("LL");
    expect(like?.provenance.sourceOrder).toBe(0);
    expect(like?.provenance.capturedAt).toBe(T0);
    expect(like?.title).toBe("Video A");
    const follow = records.find((r) => r.provenance.relationship === "follow");
    expect(follow?.externalRef).toBe("UCchan1");
    expect(follow?.provenance.sourceRef).toBeUndefined();
  });

  it("re-importing the same capture is idempotent: zero duplicates, stable record identity", async () => {
    await boot(() => ({
      snapshot: snap([
        item("vidA", "like", { sourceRef: "LL", sourceOrder: 0, title: "Video A" }),
        item("vidB", "watchlist", { sourceRef: "WL", sourceOrder: 0 }),
      ]),
    }));
    const first = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!first.ok) throw new Error(first.error.detail);
    await service.confirmFeedImport(first.value.importId);
    const before = await service.readFeed(PROFILE, "byof");
    expect(before.length).toBe(2);

    const second = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!second.ok) throw new Error(second.error.detail);
    await service.confirmFeedImport(second.value.importId);

    const after = await service.readFeed(PROFILE, "byof");
    expect(after.length).toBe(2); // no duplicates
    // Stable identity: the re-import kept the existing records' ids.
    for (const record of after) {
      const prior = before.find((r) => r.externalRef === record.externalRef);
      expect(prior?.id).toBe(record.id);
    }
  });

  it("confirming a preview twice stays a no-op (the R20-A law through the service)", async () => {
    await boot(() => ({ snapshot: snap([item("vidA", "like", { sourceRef: "LL" })]) }));
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    await service.confirmFeedImport(preview.value.importId);
    const again = await service.confirmFeedImport(preview.value.importId);
    expect(again.ok).toBe(true);
    expect(await countRows("feed_records")).toBe(1);
  });

  it("confirming an unknown import is the typed not-found verdict", async () => {
    await boot(() => ({ snapshot: snap([]) }));
    const result = await service.confirmFeedImport("wfximp_missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
  });
});

// ---------------------------------------------------------------------------
// Canonical identity resolution
// ---------------------------------------------------------------------------

describe("R20-C service — canonical identity resolution", () => {
  it("mints Entertainment Graph items + realizations for typed captures", async () => {
    await boot(() => ({
      snapshot: snap([item("vidA", "like", { sourceRef: "LL", title: "Video A" })]),
    }), "video");
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    await service.confirmFeedImport(preview.value.importId);

    expect(await countRows("entertainment_items")).toBe(1);
    expect(await countRows("source_realizations")).toBe(1);
    const items = await test!.db.query<{ id: string; canonical_type: string; canonical_title: string | null }>(
      `SELECT id, canonical_type, canonical_title FROM entertainment_items`,
    );
    expect(items[0]?.canonical_type).toBe("video");
    expect(items[0]?.canonical_title).toBe("Video A");
    const records = await service.readFeed(PROFILE, "byof");
    expect(records[0]?.entertainmentItemId).toBe(items[0]?.id);
  });

  it("the same video in two containers resolves to ONE canonical item (one realization)", async () => {
    await boot(() => ({
      snapshot: snap([
        item("vidA", "like", { sourceRef: "LL", sourceOrder: 0 }),
        item("vidA", "playlist", { sourceRef: "PL_1", sourceOrder: 3 }),
      ]),
    }), "video");
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    await service.confirmFeedImport(preview.value.importId);

    // TWO feed records (two relationships) but ONE canonical item.
    expect(await countRows("feed_records")).toBe(2);
    expect(await countRows("entertainment_items")).toBe(1);
    expect(await countRows("source_realizations")).toBe(1);
    const records = await service.readFeed(PROFILE, "byof");
    expect(new Set(records.map((r) => r.entertainmentItemId)).size).toBe(1);
  });

  it("follows get DEFERRED anchors: no entertainment_items row, marker visible, identity stable across re-imports", async () => {
    await boot(() => ({
      snapshot: snap([item("UCchan1", "follow", { sourceOrder: 0, title: "Channel One" })]),
    }));
    const first = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!first.ok) throw new Error(first.error.detail);
    await service.confirmFeedImport(first.value.importId);

    expect(await countRows("entertainment_items")).toBe(0); // a channel is NOT an EntertainmentItem
    const records = await service.readFeed(PROFILE, "byof");
    expect(records.length).toBe(1);
    expect(records[0]?.metadata?.["canonicalResolution"]).toBe("deferred-follow");
    expect(records[0]?.entertainmentItemId).toMatch(/^wfxitm_/);

    const second = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!second.ok) throw new Error(second.error.detail);
    await service.confirmFeedImport(second.value.importId);
    const after = await service.readFeed(PROFILE, "byof");
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(records[0]?.id); // stable identity
    expect(after[0]?.entertainmentItemId).toBe(records[0]?.entertainmentItemId); // stable anchor
    // The deferred marker SURVIVES the re-import: the store's idempotent
    // upsert refreshes metadata to the newest capture wholesale, so the
    // composition must carry the resolution fact forward (visible, never
    // silent — a deferred anchor may never silently become an unmarked one).
    expect(after[0]?.metadata?.["canonicalResolution"]).toBe("deferred-follow");
  });

  it("untyped captures defer honestly when the connector declares no canonical type", async () => {
    await boot(() => ({ snapshot: snap([item("postX", "save", { sourceRef: "saved" })]) }));
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    await service.confirmFeedImport(preview.value.importId);
    expect(await countRows("entertainment_items")).toBe(0); // never a guessed type
    const records = await service.readFeed(PROFILE, "byof");
    expect(records[0]?.metadata?.["canonicalResolution"]).toBe("deferred-untyped");
  });
});

// ---------------------------------------------------------------------------
// Mode truth
// ---------------------------------------------------------------------------

describe("R20-C service — mode truth", () => {
  it("readFeed('webflix') is ALWAYS empty — imported records are never re-labeled WebFlix-ranked", async () => {
    await boot(() => ({
      snapshot: snap([
        item("vidA", "like", { sourceRef: "LL" }),
        item("UCchan1", "follow"),
      ]),
    }));
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    await service.confirmFeedImport(preview.value.importId);
    expect(await service.readFeed(PROFILE, "webflix")).toEqual([]);
    expect((await service.readFeed(PROFILE, "following")).length).toBe(1);
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(2);
    expect((await service.readFeed(PROFILE, "hybrid")).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Incremental sync: the honest decision table
// ---------------------------------------------------------------------------

/** A canned capture used by the sync tests. */
const SYNC_CAPTURE_V1: ConnectorFeedSnapshot["items"] = [
  item("vidA", "like", { sourceRef: "LL", sourceOrder: 0, title: "Video A", sourceUpdatedAt: T0 }),
  item("vidB", "like", { sourceRef: "LL", sourceOrder: 1, title: "Video B", sourceUpdatedAt: T0 }),
  item("vidC", "like", { sourceRef: "LL", sourceOrder: 2, title: "Video C", sourceUpdatedAt: T0 }),
];

/** Import the canned capture and confirm it; returns the import id. */
async function importLikes(
  _items: readonly ConnectorFeedSnapshot["items"][number][],
): Promise<string> {
  const preview = await service.previewFeedImport({
    userId: USER,
    profileId: PROFILE,
    ctx: { userId: USER, locale: "en" },
    connectorId: "fixture-feed",
    relationships: ["like"],
  });
  if (!preview.ok) throw new Error(preview.error.detail);
  const confirmed = await service.confirmFeedImport(preview.value.importId);
  if (!confirmed.ok) throw new Error(confirmed.error.detail);
  return confirmed.value.id;
}

describe("R20-C service — incremental sync", () => {
  it("an unchanged capture syncs to all-keep (idempotence through the whole path)", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap(SYNC_CAPTURE_V1) };
    await boot(() => script);
    const importId = await importLikes(SYNC_CAPTURE_V1);

    script = { snapshot: snap(SYNC_CAPTURE_V1, { capturedAt: T1 }) };
    const result = await service.syncFeedImport(importId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.detail);
    expect(result.value.report.added).toBe(0);
    expect(result.value.report.updated).toBe(0);
    expect(result.value.report.removed).toBe(0);
    expect(result.value.report.kept).toBe(3);
    expect(result.value.report.preservedLocalActions).toBe(true);
    expect(result.value.import.syncState).toBe("live"); // a successful sync of a continuous route
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(3);
  });

  it("a changed capture syncs the honest decision table: add + update(source-changed) + update(order-changed) + remove + keep", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap(SYNC_CAPTURE_V1) };
    await boot(() => script, "video");
    const importId = await importLikes(SYNC_CAPTURE_V1);

    // v2: vidB removed (unliked), vidA retitled (source-changed), vidC
    // moved to position 0 (order-changed), vidD added.
    script = {
      snapshot: snap(
        [
          item("vidC", "like", { sourceRef: "LL", sourceOrder: 0, title: "Video C", sourceUpdatedAt: T0 }),
          item("vidA", "like", { sourceRef: "LL", sourceOrder: 1, title: "Video A (renamed)", sourceUpdatedAt: T1 }),
          item("vidD", "like", { sourceRef: "LL", sourceOrder: 2, title: "Video D", sourceUpdatedAt: T1 }),
        ],
        { capturedAt: T1 },
      ),
    };
    const result = await service.syncFeedImport(importId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.detail);
    expect(result.value.report.added).toBe(1);
    expect(result.value.report.updated).toBe(2);
    expect(result.value.report.removed).toBe(1);
    expect(result.value.report.kept).toBe(0);

    const records = await service.readFeed(PROFILE, "byof");
    expect(records.length).toBe(3); // 3 - 1 removed + 1 added
    const vidA = records.find((r) => r.externalRef === "vidA");
    expect(vidA?.title).toBe("Video A (renamed)"); // refreshed provenance
    expect(vidA?.provenance.sourceOrder).toBe(1); // source-native order as DATA
    const vidB = records.find((r) => r.externalRef === "vidB");
    expect(vidB).toBeUndefined(); // the source no longer lists it — removed
    // The removed record's canonical item SURVIVES in the graph (another
    // relationship may still reference it; the graph never orphans knowledge).
    expect(await countRows("entertainment_items")).toBe(4);
  });

  it("a sync UPDATE of a deferred follow preserves the deferred marker (visible, never silent)", async () => {
    let script: ScriptedReply;
    script = {
      snapshot: snap([item("UCchan1", "follow", { sourceOrder: 0, title: "Channel One" })]),
    };
    await boot(() => script);
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    const confirmed = await service.confirmFeedImport(preview.value.importId);
    if (!confirmed.ok) throw new Error(confirmed.error.detail);

    const before = await service.readFeed(PROFILE, "byof");
    expect(before[0]?.metadata?.["canonicalResolution"]).toBe("deferred-follow");

    // The source reports the channel retitled + a later subscription
    // timestamp: the record takes the update path (source-changed), whose
    // upsert refreshes metadata wholesale — the deferred fact must ride on.
    script = {
      snapshot: snap(
        [item("UCchan1", "follow", { sourceOrder: 0, title: "Channel One (renamed)", sourceUpdatedAt: T1 })],
        { capturedAt: T1 },
      ),
    };
    const result = await service.syncFeedImport(confirmed.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.detail);
    expect(result.value.report.updated).toBe(1);

    const after = await service.readFeed(PROFILE, "byof");
    expect(after.length).toBe(1);
    expect(after[0]?.title).toBe("Channel One (renamed)"); // refreshed provenance
    expect(after[0]?.entertainmentItemId).toBe(before[0]?.entertainmentItemId); // stable anchor
    expect(after[0]?.metadata?.["canonicalResolution"]).toBe("deferred-follow"); // the fact survives
    expect(await countRows("entertainment_items")).toBe(0); // still NOT an EntertainmentItem
  });

  it("SCOPE DISCIPLINE: a likes-only sync never removes another import's follows", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap([...SYNC_CAPTURE_V1, item("UCchan1", "follow", { sourceOrder: 0 })]) };
    await boot(() => script);
    // Import #1: likes only (relationships filter pinned on the import row).
    const likesImport = await importLikes(SYNC_CAPTURE_V1);
    // Import #2: the follows.
    const followPreview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
      relationships: ["follow"],
    });
    if (!followPreview.ok) throw new Error(followPreview.error.detail);
    await service.confirmFeedImport(followPreview.value.importId);
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(4);

    // Sync the likes import with a capture that lists NO likes at all: the
    // likes are removed (the source no longer lists them), the follow
    // SURVIVES (outside the synced scope).
    script = { snapshot: snap([item("UCchan1", "follow", { sourceOrder: 0 })], { capturedAt: T1 }) };
    const result = await service.syncFeedImport(likesImport);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.detail);
    expect(result.value.report.removed).toBe(3);
    expect(result.value.report.kept).toBe(0); // the follow is OUT of scope
    const records = await service.readFeed(PROFILE, "byof");
    expect(records.length).toBe(1);
    expect(records[0]?.provenance.relationship).toBe("follow");
  });

  it("deduplicates intra-capture duplicates and reports the count", async () => {
    await boot(
      () => ({
        snapshot: snap([
          item("vidA", "like", { sourceRef: "LL", sourceOrder: 0 }),
          item("vidA", "like", { sourceRef: "LL", sourceOrder: 5 }), // same relationship, same container
        ]),
      }),
      "video",
    );
    const importId = await importLikes([
      item("vidA", "like", { sourceRef: "LL", sourceOrder: 0 }),
      item("vidA", "like", { sourceRef: "LL", sourceOrder: 5 }),
    ]);
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(1);
    const result = await service.syncFeedImport(importId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.detail);
    expect(result.value.report.deduplicated).toBe(1);
    expect(result.value.report.kept).toBe(1);
  });

  it("a preview-status import refuses to sync (confirm first)", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap(SYNC_CAPTURE_V1) };
    await boot(() => script);
    const preview = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    const result = await service.syncFeedImport(preview.value.importId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid-input");
  });

  it("a one-time route (continuousSync false) answers the typed unsupported verdict for sync", async () => {
    await boot(() => ({
      snapshot: snap([item("vidA", "like", { sourceRef: "LL" })], { continuousSync: false }),
    }));
    const importId = await importLikes([item("vidA", "like", { sourceRef: "LL" })]);
    const confirmed = await service.readFeed(PROFILE, "byof");
    expect(confirmed.length).toBe(1);

    const result = await service.syncFeedImport(importId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported");
      expect(result.error.detail).toContain("one-time");
    }
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(1); // records retained
  });

  it("syncing an unknown import is the typed not-found verdict", async () => {
    await boot(() => ({ snapshot: snap([]) }));
    const result = await service.syncFeedImport("wfximp_missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
  });
});

// ---------------------------------------------------------------------------
// Stale / offline semantics (the survival law)
// ---------------------------------------------------------------------------

describe("R20-C service — stale/offline semantics", () => {
  it("an unauthorized sync folds to reauthorization-required and RETAINS every record", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap(SYNC_CAPTURE_V1) };
    await boot(() => script);
    const importId = await importLikes(SYNC_CAPTURE_V1);
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(3);

    script = { error: { kind: "unauthorized" } };
    const result = await service.syncFeedImport(importId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthorized");
      expect(result.error.syncState).toBe("reauthorization-required");
    }
    const records = await service.readFeed(PROFILE, "byof");
    expect(records.length).toBe(3); // THE SURVIVAL LAW
    expect(records[0]?.provenance.syncState).toBe("reauthorization-required");
  });

  it("a transport failure on an import WITH records folds to stale and retains them", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap(SYNC_CAPTURE_V1) };
    await boot(() => script);
    const importId = await importLikes(SYNC_CAPTURE_V1);

    script = { error: { kind: "transport", detail: "connection reset" } };
    const result = await service.syncFeedImport(importId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("transport");
      expect(result.error.syncState).toBe("stale"); // hasRecords
    }
    const records = await service.readFeed(PROFILE, "byof");
    expect(records.length).toBe(3); // retained
    expect(records[0]?.provenance.syncState).toBe("stale");
  });

  it("a failed FIRST capture (unauthorized) lands its honest audit row — no preview, no fake success", async () => {
    await boot(() => ({ error: { kind: "unauthorized" } }));
    const result = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthorized");
      expect(result.error.importId).toBeDefined();
      expect(result.error.syncState).toBe("reauthorization-required");
    }
    // The audit row exists and confirms the failed import cannot be confirmed.
    const rows = await test!.db.query<{ status: string; sync_state: string; item_count: number; error: string }>(
      `SELECT status, sync_state, item_count, error FROM feed_imports`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("reauthorization-required");
    expect(rows[0]?.item_count).toBe(0);
    const confirmAttempt = await service.confirmFeedImport(result.ok ? "" : result.error.importId ?? "");
    expect(confirmAttempt.ok).toBe(false);
    if (!confirmAttempt.ok) expect(confirmAttempt.error.kind).toBe("invalid-input");
  });

  it("a failed FIRST capture (transport) records a degraded audit row", async () => {
    await boot(() => ({ error: { kind: "transport", detail: "provider down" } }));
    const result = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("transport");
      expect(result.error.syncState).toBe("degraded"); // no records yet
    }
    const rows = await test!.db.query<{ status: string }>(`SELECT status FROM feed_imports`);
    expect(rows[0]?.status).toBe("failed");
  });

  it("an unsupported verdict (the honest route truth) creates NO import row", async () => {
    await boot(() => ({
      error: { kind: "unsupported", detail: "the route cannot expose history" },
    }));
    const result = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "fixture-feed",
      relationships: ["history"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported");
      expect(result.error.detail).toContain("history");
      expect(result.error.importId).toBeUndefined(); // static truth, no transaction
    }
    expect(await countRows("feed_imports")).toBe(0);
  });

  it("an unknown connector is the typed unknown-connector verdict (no rows, no throw)", async () => {
    await boot(() => ({ snapshot: snap([]) }));
    const result = await service.previewFeedImport({
      userId: USER,
      profileId: PROFILE,
      ctx: { userId: USER, locale: "en" },
      connectorId: "not-wired",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unknown-connector");
    expect(await countRows("feed_imports")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WebFlix-local action preservation (the separation law)
// ---------------------------------------------------------------------------

describe("R20-C service — WebFlix-local action preservation", () => {
  it("import + sync of a concentrated feed leaves library, history, intents, and recommendation state untouched", async () => {
    let script: ScriptedReply;
    script = { snapshot: snap(SYNC_CAPTURE_V1) };
    await boot(() => script);
    const before = {
      library: await countRows("library_entries"),
      history: await countRows("watch_history"),
      intents: await countRows("user_intents"),
      recommendation: await countRows("recommendation_state"),
    };
    const importId = await importLikes(SYNC_CAPTURE_V1);
    script = {
      snapshot: snap(
        [
          item("vidA", "like", { sourceRef: "LL", sourceOrder: 0, title: "Video A", sourceUpdatedAt: T1 }),
          item("vidB", "like", { sourceRef: "LL", sourceOrder: 1, title: "Video B", sourceUpdatedAt: T0 }),
        ],
        { capturedAt: T1 },
      ),
    };
    const sync = await service.syncFeedImport(importId);
    expect(sync.ok).toBe(true);

    expect(await countRows("library_entries")).toBe(before.library);
    expect(await countRows("watch_history")).toBe(before.history);
    expect(await countRows("user_intents")).toBe(before.intents);
    expect(await countRows("recommendation_state")).toBe(before.recommendation);
  });

  it("deleteImportedRecords removes ONLY feed records (the explicit user path)", async () => {
    await boot(() => ({ snapshot: snap(SYNC_CAPTURE_V1) }));
    await importLikes(SYNC_CAPTURE_V1);
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(3);
    const removed = await service.deleteImportedRecords(PROFILE, { connectorId: "fixture-feed" });
    expect(removed).toBe(3);
    expect((await service.readFeed(PROFILE, "byof")).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Caller input truth
// ---------------------------------------------------------------------------

describe("R20-C service — caller input truth", () => {
  it("rejects malformed requests with the typed invalid-input verdict (never a throw)", async () => {
    await boot(() => ({ snapshot: snap([]) }));
    const cases: Parameters<typeof service.previewFeedImport>[0][] = [
      { userId: "", profileId: PROFILE, ctx: { userId: USER, locale: "en" }, connectorId: "fixture-feed" },
      { userId: USER, profileId: "", ctx: { userId: USER, locale: "en" }, connectorId: "fixture-feed" },
      {
        userId: USER,
        profileId: PROFILE,
        ctx: { userId: USER, locale: "en" },
        connectorId: "fixture-feed",
        relationships: [],
      },
      {
        userId: USER,
        profileId: PROFILE,
        ctx: { userId: USER, locale: "en" },
        connectorId: "fixture-feed",
        relationships: ["not-a-relationship" as FeedRelationship],
      },
      {
        userId: USER,
        profileId: PROFILE,
        ctx: { userId: USER, locale: "en" },
        connectorId: "fixture-feed",
        method: "official-export",
      },
    ];
    for (const request of cases) {
      const result = await service.previewFeedImport(request);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid-input");
    }
    expect(await countRows("feed_imports")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The REAL YouTube connector through the service (the first real provider
// path, R20-B + R20-C composed; the documented fixtures drive the scripted
// transport — no network, no fixture fallback in the production seams)
// ---------------------------------------------------------------------------

import {
  createInMemoryYouTubeCredentialSource,
  createScriptedYouTubeTransport,
  createYouTubeConnector,
  FIXTURE_PLAYLISTS_MINE,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_PLAYLIST_ITEMS_RAIN,
  FIXTURE_PLAYLIST_ITEMS_WATCH_LATER,
  FIXTURE_SUBSCRIPTIONS,
  FIXTURE_VIDEO_IDS,
  YOUTUBE_CONNECTOR_ID,
  type YouTubeConnector,
  type YouTubeTokenSet,
} from "@wfx/connectors";

const YT_NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const YT_USER = "wfxusr_youtube_r20c";
const YT_PROFILE = "wfxusr_youtube_r20c:main";
const YT_CTX = { userId: YT_USER, locale: "en", region: "US" } as const;

const SUBS_URL =
  "https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50";
const LL_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=LL&maxResults=50";
const WL_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=WL&maxResults=50";
const PLAYLISTS_URL =
  "https://www.googleapis.com/youtube/v3/playlists?part=snippet%2CcontentDetails&mine=true&maxResults=25";
const RAIN_URL = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=PLwfx54Fixture000000000000000001&maxResults=50`;

class YouTubeTestClock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
}

function ytTokens(): YouTubeTokenSet {
  return {
    accessToken: "fixture-access-token-r20c",
    refreshToken: "fixture-refresh-token-r20c",
    tokenType: "Bearer",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    expiresAtMs: YT_NOW + 3600 * 1000,
    obtainedAtMs: YT_NOW,
  };
}

interface ScriptedCall {
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
}

/**
 * Boot the service against a REAL YouTube connector over the scripted
 * transport. `withTokens` controls the grant (absent → unauthorized).
 * Returns the service + a connector swapper for multi-phase scripts.
 */
async function bootYouTube(
  calls: readonly ScriptedCall[],
  withTokens: boolean,
): Promise<{
  service: FeedImportService;
  swap: (nextCalls: readonly ScriptedCall[]) => Promise<void>;
}> {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();

  const scripted = createScriptedYouTubeTransport(calls);
  const credentials = createInMemoryYouTubeCredentialSource();
  const connector: YouTubeConnector = createYouTubeConnector({
    transport: scripted.transport,
    credentialSource: credentials,
    clock: new YouTubeTestClock(YT_NOW),
  });
  if (withTokens) await credentials.store(YT_USER, ytTokens());
  await connector.initialize();

  // The HOST WIRING PATTERN (this is what apps/api composes at boot): the
  // real connector satisfies the structural port; the projection truth
  // (`feedItemCanonicalType: "video"` — YouTube feed items are videos, the
  // WFX-054 law) rides on the wiring, not the frozen descriptor.
  let currentPort: FeedConnectorPort = {
    descriptor: () => connector.descriptor(),
    importFeedResult: (ctx, request) => connector.importFeedResult(ctx, request),
    feedItemCanonicalType: "video",
  };
  const feedService = new FeedImportService({
    db: test.db,
    clock,
    ids,
    connectors: (connectorId) => (connectorId === YOUTUBE_CONNECTOR_ID ? currentPort : undefined),
  });
  const swap = async (nextCalls: readonly ScriptedCall[]): Promise<void> => {
    const nextScripted = createScriptedYouTubeTransport(nextCalls);
    const nextCredentials = createInMemoryYouTubeCredentialSource();
    const nextConnector = createYouTubeConnector({
      transport: nextScripted.transport,
      credentialSource: nextCredentials,
      clock: new YouTubeTestClock(YT_NOW),
    });
    await nextCredentials.store(YT_USER, ytTokens());
    await nextConnector.initialize();
    currentPort = {
      descriptor: () => nextConnector.descriptor(),
      importFeedResult: (ctx, request) => nextConnector.importFeedResult(ctx, request),
      feedItemCanonicalType: "video",
    };
  };
  return { service: feedService, swap };
}

/** The full-capture script: subs (2) + LL (2) + WL (1) + playlists (2, one empty skipped). */
function fullCaptureScript(likedItems = FIXTURE_PLAYLIST_ITEMS_LIKED): ScriptedCall[] {
  return [
    { url: SUBS_URL, status: 200, body: FIXTURE_SUBSCRIPTIONS },
    { url: LL_URL, status: 200, body: likedItems },
    { url: WL_URL, status: 200, body: FIXTURE_PLAYLIST_ITEMS_WATCH_LATER },
    { url: PLAYLISTS_URL, status: 200, body: FIXTURE_PLAYLISTS_MINE },
    { url: RAIN_URL, status: 200, body: FIXTURE_PLAYLIST_ITEMS_RAIN },
  ];
}

describe("R20-C service — the real YouTube provider path", () => {
  it("imports the full authorized capture: provenance, canonical items, deferred follows, shared identity", async () => {
    const { service: svc } = await bootYouTube(fullCaptureScript(), true);
    service = svc;
    const preview = await service.previewFeedImport({
      userId: YT_USER,
      profileId: YT_PROFILE,
      ctx: YT_CTX,
      connectorId: YOUTUBE_CONNECTOR_ID,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error.detail);
    expect(preview.value.itemCount).toBe(7);
    expect(preview.value.relationshipCounts).toEqual({
      follow: 2,
      like: 2,
      watchlist: 1,
      playlist: 2,
    });

    const confirmed = await service.confirmFeedImport(preview.value.importId);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.error.detail);
    expect(confirmed.value.syncState).toBe("live");

    // Canonical truth: 4 distinct videos minted (documentary, shortVertical,
    // liveStream, notEmbeddable) with realizations; the 2 follows defer.
    expect(await countRows("entertainment_items")).toBe(4);
    expect(await countRows("source_realizations")).toBe(4);
    expect(await countRows("feed_records")).toBe(7);

    const records = await service.readFeed(YT_PROFILE, "byof");
    expect(records.length).toBe(7);

    // The documentary in "LL" and in "Rain Documentaries" is ONE canonical item.
    const documentaryIds = new Set(
      records
        .filter((r) => r.externalRef === FIXTURE_VIDEO_IDS.documentary)
        .map((r) => r.entertainmentItemId),
    );
    expect(documentaryIds.size).toBe(1);

    // Follows: deferred anchors, source-native order as DATA.
    const follows = records.filter((r) => r.provenance.relationship === "follow");
    expect(follows.length).toBe(2);
    expect(follows.map((f) => f.provenance.sourceOrder).sort()).toEqual([0, 1]);
    for (const follow of follows) {
      expect(follow.metadata?.["canonicalResolution"]).toBe("deferred-follow");
    }

    // The playlist rows carry the provider's OWN position (1 and 0), not array order.
    const playlistRows = records.filter((r) => r.provenance.relationship === "playlist");
    expect(playlistRows.map((p) => p.provenance.sourceOrder).sort()).toEqual([0, 1]);

    // Mode truth through the real path.
    expect(await service.readFeed(YT_PROFILE, "webflix")).toEqual([]);
    expect((await service.readFeed(YT_PROFILE, "following")).length).toBe(2);
  });

  it("an unauthorized user gets the typed unauthorized verdict + the honest audit row", async () => {
    const { service: svc } = await bootYouTube(fullCaptureScript(), false);
    service = svc;
    const result = await service.previewFeedImport({
      userId: YT_USER,
      profileId: YT_PROFILE,
      ctx: YT_CTX,
      connectorId: YOUTUBE_CONNECTOR_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthorized");
      expect(result.error.syncState).toBe("reauthorization-required");
      expect(result.error.importId).toBeDefined();
    }
    expect(await countRows("feed_records")).toBe(0);
    expect(await countRows("entertainment_items")).toBe(0);
  });

  it("an honest unsupported verdict for a method the route cannot serve (Takeout-only history)", async () => {
    const { service: svc } = await bootYouTube(fullCaptureScript(), true);
    service = svc;
    const result = await service.previewFeedImport({
      userId: YT_USER,
      profileId: YT_PROFILE,
      ctx: YT_CTX,
      connectorId: YOUTUBE_CONNECTOR_ID,
      method: "official-export",
      artifact: new Uint8Array([1, 2, 3]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported");
      expect(result.error.detail).toContain("official-export");
    }
    expect(await countRows("feed_imports")).toBe(0);
  });

  it("syncs incrementally: an unliked video is removed, the rest retained, live after success", async () => {
    const { service: svc, swap } = await bootYouTube(fullCaptureScript(), true);
    service = svc;
    const preview = await service.previewFeedImport({
      userId: YT_USER,
      profileId: YT_PROFILE,
      ctx: YT_CTX,
      connectorId: YOUTUBE_CONNECTOR_ID,
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    const confirmed = await service.confirmFeedImport(preview.value.importId);
    if (!confirmed.ok) throw new Error(confirmed.error.detail);
    expect((await service.readFeed(YT_PROFILE, "byof")).length).toBe(7);

    // v2: the user unliked the short vertical — LL keeps only the documentary.
    const likedOnlyDocumentary = {
      ...FIXTURE_PLAYLIST_ITEMS_LIKED,
      items: FIXTURE_PLAYLIST_ITEMS_LIKED.items.filter(
        (row) => row.snippet.resourceId.videoId !== FIXTURE_VIDEO_IDS.shortVertical,
      ),
    };
    await swap(fullCaptureScript(likedOnlyDocumentary));
    const sync = await service.syncFeedImport(confirmed.value.id);
    expect(sync.ok).toBe(true);
    if (!sync.ok) throw new Error(sync.error.detail);
    expect(sync.value.report.removed).toBe(1);
    expect(sync.value.report.added).toBe(0);
    expect(sync.value.report.kept).toBe(6);
    expect(sync.value.import.syncState).toBe("live");

    const records = await service.readFeed(YT_PROFILE, "byof");
    expect(records.length).toBe(6);
    expect(records.some((r) => r.externalRef === FIXTURE_VIDEO_IDS.shortVertical)).toBe(false);
    // Every record converged to the live state (the state-machine fold).
    expect(new Set(records.map((r) => r.provenance.syncState))).toEqual(new Set(["live"]));
  });

  it("a transport failure on sync folds to stale and retains every record (survival law)", async () => {
    const { service: svc, swap } = await bootYouTube(fullCaptureScript(), true);
    service = svc;
    const preview = await service.previewFeedImport({
      userId: YT_USER,
      profileId: YT_PROFILE,
      ctx: YT_CTX,
      connectorId: YOUTUBE_CONNECTOR_ID,
    });
    if (!preview.ok) throw new Error(preview.error.detail);
    const confirmed = await service.confirmFeedImport(preview.value.importId);
    if (!confirmed.ok) throw new Error(confirmed.error.detail);

    await swap([{ url: SUBS_URL, status: 503, body: { error: { message: "backend error" } } }]);
    const sync = await service.syncFeedImport(confirmed.value.id);
    expect(sync.ok).toBe(false);
    if (!sync.ok) {
      expect(sync.error.kind).toBe("transport");
      expect(sync.error.syncState).toBe("stale"); // has records
    }
    const records = await service.readFeed(YT_PROFILE, "byof");
    expect(records.length).toBe(7); // every record retained
    expect(new Set(records.map((r) => r.provenance.syncState))).toEqual(new Set(["stale"]));
  });
});
