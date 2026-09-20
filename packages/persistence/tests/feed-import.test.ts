/**
 * @wfx/persistence — R20-A/R20-C BYOF feed import store tests (PGlite,
 * real Postgres).
 *
 * Acceptance points (every law pinned against the actual tables):
 * - PREVIEW → CONFIRM: staged rows promote verbatim; the preview reports
 *   item count, per-relationship counts, and sample records.
 * - THE IDEMPOTENT IMPORT LAW: confirming twice = no duplicates; importing
 *   the same relationships through a SECOND import = no duplicates (the
 *   UNIQUE (profile_id, import_key) upsert); the existing record keeps its
 *   stable identity while provenance refreshes.
 * - PROVENANCE: every persisted record carries connector, method, captured
 *   timestamp, source-native order, relationship, and container ref.
 * - MODE TRUTH: readFeed('webflix') is always EMPTY (imported records are
 *   never re-labeled WebFlix-ranked); 'following' is the follow subset;
 *   'byof'/'hybrid' return the source-native order.
 * - THE SURVIVAL LAW: stale/reauthorization transitions NEVER delete
 *   records; only deleteFeedRecords (the explicit user path) removes rows.
 * - THE SEPARATION LAW: importing + syncing a concentrated feed leaves
 *   library_entries, watch_history, user_intents, and recommendation_state
 *   UNTOUCHED (WebFlix-local actions and recommendation identity survive).
 * - SYNC STATES: confirm of a continuous route lands 'live'; a one-time
 *   route lands 'snapshot' (never presented as live).
 *
 * Determinism: PGlite + FixedClock + SequentialIdGen.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";
import { feedImportKey } from "@wfx/domain";

import {
  PostgresFeedImportStore,
  PostgresGraphStore,
  type PersistedFeedRecord,
  type StageFeedItemInput,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 19, 9, 0, 0);
const T0 = "2026-09-19T09:00:00.000Z";
const USER = "wfxusr_byof_r20_test";
const PROFILE = "wfxusr_byof_r20_test:main";
const ITEM_A = "wfxitm_00000000000000000000000041";
const ITEM_B = "wfxitm_00000000000000000000000042";
const ITEM_C = "wfxitm_00000000000000000000000043";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let store: PostgresFeedImportStore;

function staged(overrides: Partial<StageFeedItemInput> & { externalRef: string }): StageFeedItemInput {
  return {
    relationship: "playlist",
    sourceOrder: 0,
    capturedAt: T0,
    entertainmentItemId: ITEM_A,
    ...overrides,
  };
}

async function countRows(table: string): Promise<number> {
  const rows = await test.db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${table}`,
  );
  return Number((rows[0] as { count: number } | undefined)?.count ?? 0);
}

async function setup(): Promise<void> {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  store = new PostgresFeedImportStore({ db: test.db, clock, ids });
}

beforeEach(setup);
afterEach(async () => {
  await test.close();
});

// ---------------------------------------------------------------------------
// Preview → confirm
// ---------------------------------------------------------------------------

describe("preview and confirm", () => {
  it("stages a preview and reports counts, relationship breakdown, and sample records", async () => {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      sourceRef: "PL_wfx_fixture",
      capturedAt: T0,
      items: [
        staged({ externalRef: "Wfx54Docu001", sourceOrder: 0, entertainmentItemId: ITEM_A, title: "First" }),
        staged({ externalRef: "Wfx54Short01", sourceOrder: 1, entertainmentItemId: ITEM_B }),
        staged({ externalRef: "UCWfx54Channel00000000000A", relationship: "follow", sourceOrder: 0, entertainmentItemId: ITEM_C }),
      ],
    });
    expect(started.status).toBe("preview");
    expect(started.syncState).toBe("snapshot");
    const preview = await store.readPreview(started.id);
    expect(preview).not.toBeNull();
    expect(preview?.itemCount).toBe(3);
    expect(preview?.relationshipCounts).toEqual({ playlist: 2, follow: 1 });
    expect(preview?.freshness).toBe("snapshot");
    expect(preview?.sample.length).toBe(3);
    expect(preview?.sample[0]?.provenance.relationship).toBe("playlist");
    expect(preview?.sample[0]?.provenance.sourceOrder).toBe(0);
  });

  it("confirm promotes staged rows verbatim and completes the import", async () => {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items: [
        staged({ externalRef: "Wfx54Docu001", sourceOrder: 0, sourceRef: "PL_A", entertainmentItemId: ITEM_A, title: "Desert Rain", sourceUpdatedAt: "2025-03-14T09:00:00Z" }),
      ],
    });
    const confirmed = await store.confirmImport(started.id);
    expect(confirmed.status).toBe("complete");
    expect(confirmed.syncState).toBe("live"); // continuous route lands live
    expect(confirmed.completedAt).toBeDefined();
    expect(confirmed.lastSyncedAt).toBeDefined();
    const records = await store.readFeed(PROFILE, "byof");
    expect(records.length).toBe(1);
    expect(records[0]?.externalRef).toBe("Wfx54Docu001");
    expect(records[0]?.entertainmentItemId).toBe(ITEM_A);
    expect(records[0]?.provenance.capturedAt).toBe("2026-09-19T09:00:00.000Z");
    expect(records[0]?.provenance.sourceOrder).toBe(0);
    expect(records[0]?.provenance.sourceRef).toBe("PL_A");
    expect(records[0]?.sourceUpdatedAt).toBe("2025-03-14T09:00:00.000Z");
    expect(records[0]?.title).toBe("Desert Rain");
  });

  it("confirming a one-time capture lands 'snapshot' — never presented as live", async () => {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "user-file",
      continuousSync: false,
      capturedAt: T0,
      items: [staged({ externalRef: "Wfx54Docu001" })],
    });
    const confirmed = await store.confirmImport(started.id);
    expect(confirmed.syncState).toBe("snapshot");
    const records = await store.readFeed(PROFILE, "byof");
    expect(records[0]?.provenance.syncState).toBe("snapshot");
  });

  it("confirming an unknown import is a typed not-found failure", async () => {
    expect(store.confirmImport("wfximp_missing")).rejects.toThrow(/unknown/);
  });

  it("rejects malformed staged items before any write (typed invalid-input)", async () => {
    await expect(
      store.startPreview({
        userId: USER,
        profileId: PROFILE,
        connectorId: "youtube",
        method: "api",
        continuousSync: true,
        capturedAt: T0,
        items: [staged({ externalRef: "", sourceOrder: -1 })],
      }),
    ).rejects.toThrow(/invalid-input|externalRef|sourceOrder/);
    expect(await countRows("feed_imports")).toBe(0);
    expect(await countRows("feed_preview_items")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The idempotent import law
// ---------------------------------------------------------------------------

describe("the idempotent import law", () => {
  async function importPlaylist(items: StageFeedItemInput[]): Promise<string> {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items,
    });
    await store.confirmImport(started.id);
    return started.id;
  }

  it("confirming the SAME preview twice creates zero duplicates", async () => {
    const first = await importPlaylist([
      staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0 }),
      staged({ externalRef: "Wfx54Short01", sourceRef: "PL_A", sourceOrder: 1 }),
    ]);
    const again = await store.confirmImport(first);
    expect(again.itemCount).toBe(2);
    expect(await countRows("feed_records")).toBe(2);
  });

  it("a SECOND import of the same relationships is a no-op on the row count (no duplicates)", async () => {
    await importPlaylist([
      staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0, title: "Original" }),
      staged({ externalRef: "Wfx54Short01", sourceRef: "PL_A", sourceOrder: 1 }),
    ]);
    await importPlaylist([
      staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0, title: "Original" }),
      staged({ externalRef: "Wfx54Short01", sourceRef: "PL_A", sourceOrder: 1 }),
    ]);
    expect(await countRows("feed_records")).toBe(2);
  });

  it("a re-import keeps the record's STABLE identity while provenance refreshes", async () => {
    await importPlaylist([staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0, title: "Old" })]);
    const first = (await store.readFeed(PROFILE, "byof"))[0] as PersistedFeedRecord;
    clock.advance(60_000);
    await importPlaylist([staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0, title: "New Title" })]);
    const records = await store.readFeed(PROFILE, "byof");
    expect(records.length).toBe(1);
    expect(records[0]?.id).toBe(first.id); // stable identity
    expect(records[0]?.title).toBe("New Title"); // refreshed provenance
    expect(records[0]?.importId).not.toBe(first.importId); // newest import owns the row
  });

  it("intra-capture duplicates collapse at STAGING (one relationship, one row)", async () => {
    await importPlaylist([
      staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0, title: "First occurrence" }),
      staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 5, title: "Later occurrence" }),
    ]);
    expect(await countRows("feed_records")).toBe(1);
    const records = await store.readFeed(PROFILE, "byof");
    expect(records[0]?.title).toBe("First occurrence");
    expect(records[0]?.provenance.sourceOrder).toBe(0);
  });

  it("the same external item under different relationships is TWO records", async () => {
    await importPlaylist([
      staged({ externalRef: "Wfx54Docu001", relationship: "like", sourceRef: "LL", sourceOrder: 0 }),
      staged({ externalRef: "Wfx54Docu001", relationship: "watchlist", sourceRef: "WL", sourceOrder: 0 }),
      staged({ externalRef: "Wfx54Docu001", relationship: "playlist", sourceRef: "PL_A", sourceOrder: 0 }),
    ]);
    expect(await countRows("feed_records")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Mode truth + ordering
// ---------------------------------------------------------------------------

describe("readFeed mode truth", () => {
  beforeEach(async () => {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items: [
        staged({ externalRef: "Wfx54Docu001", relationship: "playlist", sourceRef: "PL_A", sourceOrder: 1, entertainmentItemId: ITEM_A }),
        staged({ externalRef: "Wfx54Short01", relationship: "playlist", sourceRef: "PL_A", sourceOrder: 0, entertainmentItemId: ITEM_B }),
        staged({ externalRef: "UCWfx54Channel00000000000A", relationship: "follow", sourceOrder: 0, entertainmentItemId: ITEM_C }),
        staged({ externalRef: "UCWfx54Channel00000000000B", relationship: "subscription", sourceOrder: 1, entertainmentItemId: ITEM_C }),
      ],
    });
    await store.confirmImport(started.id);
  });

  it("byof returns every record in SOURCE-NATIVE order (per container)", async () => {
    const records = await store.readFeed(PROFILE, "byof");
    expect(records.length).toBe(4);
    // Follows (no container) first, then the playlist — each in native order.
    expect(records.map((r) => r.provenance.relationship)).toEqual([
      "follow",
      "subscription",
      "playlist",
      "playlist",
    ]);
    expect(records[2]?.externalRef).toBe("Wfx54Short01"); // source order 0
    expect(records[3]?.externalRef).toBe("Wfx54Docu001"); // source order 1
  });

  it("following returns ONLY the follow-graph subset", async () => {
    const records = await store.readFeed(PROFILE, "following");
    expect(records.length).toBe(2);
    expect(records.every((r) => r.provenance.relationship === "follow" || r.provenance.relationship === "subscription")).toBe(true);
  });

  it("webflix mode is ALWAYS EMPTY — imported source-native records are never re-labeled", async () => {
    expect(await store.readFeed(PROFILE, "webflix")).toEqual([]);
  });

  it("hybrid serves the source-native side (the WebFlix candidates come from elsewhere)", async () => {
    expect((await store.readFeed(PROFILE, "hybrid")).length).toBe(4);
  });

  it("other profiles see nothing (profile-scoped truth)", async () => {
    expect(await store.readFeed("wfxusr_byof_r20_test:other", "byof")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation application (R20-C persistence side)
// ---------------------------------------------------------------------------

describe("applyReconciliation", () => {
  async function seedBase(): Promise<string> {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      sourceRef: "PL_A",
      capturedAt: T0,
      items: [
        staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A", sourceOrder: 0, entertainmentItemId: ITEM_A, sourceUpdatedAt: "2025-03-14T09:00:00Z" }),
        staged({ externalRef: "Wfx54Short01", sourceRef: "PL_A", sourceOrder: 1, entertainmentItemId: ITEM_B }),
      ],
    });
    await store.confirmImport(started.id);
    return started.id;
  }

  it("applies adds, updates, and removals atomically with honest counts", async () => {
    const importId = await seedBase();
    clock.advance(120_000);
    const capturedAt = new Date(clock.now()).toISOString();
    const outcome = await store.applyReconciliation(importId, {
      upserts: [
        {
          key: feedImportKey({ profileId: PROFILE, connectorId: "youtube", relationship: "playlist", sourceRef: "PL_A", externalRef: "Wfx54Docu001" }),
          externalRef: "Wfx54Docu001",
          relationship: "playlist",
          sourceRef: "PL_A",
          sourceOrder: 1, // order changed: 0 -> 1
          capturedAt,
          sourceUpdatedAt: "2025-03-14T09:00:00Z",
          entertainmentItemId: ITEM_A,
        },
        {
          key: feedImportKey({ profileId: PROFILE, connectorId: "youtube", relationship: "playlist", sourceRef: "PL_A", externalRef: "Wfx54Live000" }),
          externalRef: "Wfx54Live000",
          relationship: "playlist",
          sourceRef: "PL_A",
          sourceOrder: 0,
          capturedAt,
          entertainmentItemId: ITEM_C,
        },
      ],
      removeKeys: [
        feedImportKey({ profileId: PROFILE, connectorId: "youtube", relationship: "playlist", sourceRef: "PL_A", externalRef: "Wfx54Short01" }),
      ],
      counts: { added: 1, updated: 1, removed: 1, kept: 0 },
      syncState: "live",
      capturedAt,
    });
    expect(outcome.added).toBe(1);
    expect(outcome.updated).toBe(1);
    expect(outcome.removed).toBe(1);
    expect(outcome.import.syncState).toBe("live");
    expect(outcome.import.itemCount).toBe(2);
    const records = await store.readRecordsInScope({ profileId: PROFILE, connectorId: "youtube" });
    expect(records.length).toBe(2);
    expect(records.map((r) => r.externalRef).sort()).toEqual(["Wfx54Docu001", "Wfx54Live000"]);
    const updated = records.find((r) => r.externalRef === "Wfx54Docu001");
    expect(updated?.provenance.sourceOrder).toBe(1);
    expect(updated?.provenance.capturedAt).toBe(capturedAt);
  });

  it("re-applying the SAME plan is a no-op on the row count (idempotent sync)", async () => {
    const importId = await seedBase();
    const capturedAt = new Date(clock.now()).toISOString();
    const plan = {
      upserts: [
        {
          key: feedImportKey({ profileId: PROFILE, connectorId: "youtube", relationship: "playlist", sourceRef: "PL_A", externalRef: "Wfx54Docu001" }),
          externalRef: "Wfx54Docu001",
          relationship: "playlist" as const,
          sourceRef: "PL_A",
          sourceOrder: 0,
          capturedAt,
          sourceUpdatedAt: "2025-03-14T09:00:00Z",
          entertainmentItemId: ITEM_A,
        },
      ],
      removeKeys: [],
      counts: { added: 0, updated: 0, removed: 0, kept: 2 },
      syncState: "live" as const,
      capturedAt,
    };
    await store.applyReconciliation(importId, plan);
    await store.applyReconciliation(importId, plan);
    expect(await countRows("feed_records")).toBe(2);
  });

  it("readRecordsInScope honors the container-less follows scope (NULL source_ref)", async () => {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items: [
        staged({ externalRef: "UCWfx54Channel00000000000A", relationship: "follow", entertainmentItemId: ITEM_C }),
        staged({ externalRef: "Wfx54Docu001", relationship: "playlist", sourceRef: "PL_A", entertainmentItemId: ITEM_A }),
      ],
    });
    await store.confirmImport(started.id);
    const follows = await store.readRecordsInScope({
      profileId: PROFILE,
      connectorId: "youtube",
      relationships: ["follow"],
      sourceRef: "",
    });
    expect(follows.length).toBe(1);
    expect(follows[0]?.externalRef).toBe("UCWfx54Channel00000000000A");
  });
});

// ---------------------------------------------------------------------------
// Honest state transitions (the survival law)
// ---------------------------------------------------------------------------

describe("sync outcome transitions", () => {
  async function confirmedImport(): Promise<string> {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items: [staged({ externalRef: "Wfx54Docu001", sourceRef: "PL_A" })],
    });
    await store.confirmImport(started.id);
    return started.id;
  }

  it("a transport failure stales the records and NEVER deletes them", async () => {
    const importId = await confirmedImport();
    const stale = await store.markSyncOutcome(importId, {
      syncState: "stale",
      error: "youtube:transport: provider unreachable",
    });
    expect(stale.syncState).toBe("stale");
    expect(stale.error).toContain("unreachable");
    expect(await countRows("feed_records")).toBe(1);
    const records = await store.readFeed(PROFILE, "byof");
    expect(records[0]?.provenance.syncState).toBe("stale");
  });

  it("an authorization failure demands reauthorization (import status + records) and keeps every row", async () => {
    const importId = await confirmedImport();
    const reauth = await store.markSyncOutcome(importId, { syncState: "reauthorization-required" });
    expect(reauth.status).toBe("reauthorization-required");
    expect(reauth.syncState).toBe("reauthorization-required");
    expect(await countRows("feed_records")).toBe(1);
    const records = await store.readFeed(PROFILE, "byof");
    expect(records[0]?.provenance.syncState).toBe("reauthorization-required");
  });

  it("a later successful sync restores live and clears the error", async () => {
    const importId = await confirmedImport();
    await store.markSyncOutcome(importId, { syncState: "stale", error: "boom" });
    const live = await store.markSyncOutcome(importId, { syncState: "live" });
    expect(live.syncState).toBe("live");
    expect(live.error).toBeUndefined();
    expect(live.status).toBe("complete");
    const records = await store.readFeed(PROFILE, "byof");
    expect(records[0]?.provenance.syncState).toBe("live");
  });

  it("only the EXPLICIT deletion path removes rows", async () => {
    const importId = await confirmedImport();
    // Sync failures never delete:
    await store.markSyncOutcome(importId, { syncState: "stale", error: "down" });
    await store.markSyncOutcome(importId, { syncState: "reauthorization-required" });
    expect(await countRows("feed_records")).toBe(1);
    // The explicit user deletion does:
    const removed = await store.deleteFeedRecords(PROFILE, { connectorId: "youtube" });
    expect(removed).toBe(1);
    expect(await countRows("feed_records")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The separation law (WebFlix-local preservation)
// ---------------------------------------------------------------------------

describe("WebFlix-local action preservation (the separation law)", () => {
  it("importing and syncing a concentrated feed leaves library, history, intents, and policy untouched", async () => {
    // Seed WebFlix-local state FIRST (the user's pre-existing identity):
    const graph = new PostgresGraphStore(test.db);
    await graph.upsertItem({
      id: ITEM_A,
      canonicalType: "video",
      canonicalTitle: "Concentrated Topic Video",
      durationMs: 600_000,
      orientation: "horizontal",
      creators: [],
      topics: [],
      createdAt: T0,
      updatedAt: T0,
    });
    await test.db.query(
      `INSERT INTO library_entries (user_id, connector_id, external_ref, title, added_at, metadata)
       VALUES ($1, 'webflix-catalog', 'cat:a', 'Local save', $2, NULL)`,
      [USER, T0],
    );
    await test.db.query(
      `INSERT INTO watch_history (user_id, item_id, position_ms, completed, last_event_type, created_at, updated_at)
       VALUES ($1, $2, 120000, false, 'progress', $3, $3)`,
      [USER, ITEM_A, T0],
    );
    await test.db.query(
      `INSERT INTO user_intents (id, user_id, scope, objective, weight, confidence, provenance,
         created_at, updated_at, last_reinforced_at, evidence_count)
       VALUES ('wfxint_seed', $1, 'persistent', 'user explicit objective', 0.8, 0.9, 'explicit', $2, $2, $2, 1)`,
      [USER, T0],
    );
    const libraryBefore = await countRows("library_entries");
    const historyBefore = await countRows("watch_history");
    const intentsBefore = await countRows("user_intents");
    const policyBefore = await countRows("recommendation_state");

    // Import a CONCENTRATED feed (one channel, twenty same-topic items):
    const items = Array.from({ length: 20 }, (_, index) =>
      staged({ externalRef: `Wfx54Conc${String(index).padStart(3, "0")}`, sourceRef: "PL_A", sourceOrder: index }),
    );
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items,
    });
    await store.confirmImport(started.id);
    // And sync it through reconciliation:
    clock.advance(300_000);
    const capturedAt = new Date(clock.now()).toISOString();
    await store.applyReconciliation(started.id, {
      upserts: items.map((item) => ({
        key: feedImportKey({
          profileId: PROFILE,
          connectorId: "youtube",
          relationship: item.relationship,
          ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
          externalRef: item.externalRef,
        }),
        externalRef: item.externalRef,
        relationship: item.relationship,
        ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
        sourceOrder: item.sourceOrder,
        capturedAt,
        entertainmentItemId: ITEM_A,
      })),
      removeKeys: [],
      counts: { added: 0, updated: 20, removed: 0, kept: 0 },
      syncState: "live",
      capturedAt,
    });

    // The concentrated import DID NOT touch WebFlix-local truth:
    expect(await countRows("library_entries")).toBe(libraryBefore);
    expect(await countRows("watch_history")).toBe(historyBefore);
    expect(await countRows("user_intents")).toBe(intentsBefore);
    expect(await countRows("recommendation_state")).toBe(policyBefore);
    // ...and the import itself is intact:
    expect(await countRows("feed_records")).toBe(20);
    const intentRows = await test.db.query<{ provenance: string }>(
      `SELECT provenance FROM user_intents WHERE user_id = $1`,
      [USER],
    );
    expect(intentRows.length).toBe(1);
    expect((intentRows[0] as { provenance: string }).provenance).toBe("explicit"); // not overwritten by imported signals
  });
});

// ---------------------------------------------------------------------------
// R20-C store additions: the sync-scope column, failed-capture audit rows,
// and the confirm-refusal guard
// ---------------------------------------------------------------------------

describe("R20-C store additions", () => {
  it("startPreview persists the request's relationship filter (migration 0013 — the sync scope)", async () => {
    const started = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      relationships: ["like", "watchlist"],
      items: [staged({ externalRef: "Wfx54Docu001", relationship: "like", sourceRef: "LL" })],
    });
    expect(started.relationships).toEqual(["like", "watchlist"]);
    const reread = await store.getImport(started.id);
    expect(reread?.relationships).toEqual(["like", "watchlist"]);
    // Unfiltered captures read back ABSENT (the route's full set).
    const unfiltered = await store.startPreview({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      continuousSync: true,
      capturedAt: T0,
      items: [staged({ externalRef: "Wfx54Short01" })],
    });
    expect(unfiltered.relationships).toBeUndefined();
  });

  it("recordFailedImport lands the honest audit row: reauthorization vs failed, zero items", async () => {
    const reauth = await store.recordFailedImport({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      relationships: ["like"],
      syncState: "reauthorization-required",
      error: "connector 'youtube' has no valid credentials for this feed request",
    });
    expect(reauth.status).toBe("reauthorization-required");
    expect(reauth.syncState).toBe("reauthorization-required");
    expect(reauth.itemCount).toBe(0);
    expect(reauth.error).toContain("credentials");
    expect(reauth.continuousSync).toBe(false);

    const failed = await store.recordFailedImport({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      syncState: "degraded",
      error: "connection reset",
    });
    expect(failed.status).toBe("failed");
    expect(failed.syncState).toBe("degraded");
    expect(failed.itemCount).toBe(0);
  });

  it("confirmImport refuses an import that never staged a preview (no fabricated success)", async () => {
    const failed = await store.recordFailedImport({
      userId: USER,
      profileId: PROFILE,
      connectorId: "youtube",
      method: "api",
      syncState: "degraded",
      error: "provider down",
    });
    await expect(store.confirmImport(failed.id)).rejects.toThrow(/never staged a preview/);
    const reread = await store.getImport(failed.id);
    expect(reread?.status).toBe("failed"); // unchanged — no fake complete
  });
});
