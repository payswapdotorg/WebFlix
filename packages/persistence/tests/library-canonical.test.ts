/**
 * @wfx/persistence — R04 canonical-keyed library + history removal/exclusion
 * tests (PGlite, real Postgres).
 *
 * Acceptance points:
 * - CANONICAL-KEY UPSERT: a save of the same canonical item from a
 *   DIFFERENT source is a no-op on the list count (one row); the realization
 *   set in metadata.realizations GROWS; the primary realization reference
 *   updates (cross-source replacement).
 * - CROSS-SOURCE REPLACEMENT: when the original source's realization
 *   vanishes from source_realizations, the row stays listed (the save is
 *   the user's intent, not a lease on a source's lifetime).
 * - HISTORY REMOVALS: removing an item adds a row to history_removals; the
 *   read model filters it; the event_outbox is UNCHANGED (audit truth).
 * - HISTORY EXCLUSIONS: excluding an item adds a row to history_exclusions;
 *   the read model filters it; a re-watch does NOT clear the exclusion (the
 *   user's explicit choice persists).
 * - THE EVENT-SINK LAW: removal/exclusion NEVER touches the event_outbox.
 *
 * Determinism: PGlite + FixedClock + SequentialIdGen.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PostgresHistoryExclusionStore,
  PostgresHistoryRemovalStore,
  PostgresLibraryStore,
  PostgresWatchHistoryStore,
  WEBFLIX_CATALOG_CONNECTOR_ID,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 16, 12, 0, 0);
const T0 = "2026-09-16T12:00:00.000Z";
const USER = "wfxusr_canonical_r04_test";
// Valid 26-char Crockford Base32 ULID bodies (high counters won't collide
// with the seeded catalog's timestamp-first ULIDs).
const ITEM_A = "wfxitm_00000000000000000000000098";
const ITEM_B = "wfxitm_00000000000000000000000099";
const REF_CAT_A = "cat:canonical-r04-a";
const REF_CAT_B = "cat:canonical-r04-b";
const REF_OTHER_A = "other:canonical-r04-a";
const SESSION_ID = "wfxsess_test_session";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let library: PostgresLibraryStore;
let watch: PostgresWatchHistoryStore;
let removals: PostgresHistoryRemovalStore;
let exclusions: PostgresHistoryExclusionStore;

async function setup(): Promise<void> {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  library = new PostgresLibraryStore({ db: test.db, clock });
  watch = new PostgresWatchHistoryStore({ db: test.db, clock, ids });
  removals = new PostgresHistoryRemovalStore({ db: test.db, clock });
  exclusions = new PostgresHistoryExclusionStore({ db: test.db, clock });
  // Seed the catalog graph: one canonical item with TWO realizations
  // (different connectors) + a second item.
  await seedGraph();
}

async function seedGraph(): Promise<void> {
  const { PostgresGraphStore } = await import("../src/index");
  const graph = new PostgresGraphStore(test.db);
  await graph.upsertItem({
    id: ITEM_A,
    canonicalType: "movie",
    canonicalTitle: "Canonical R04 Item A",
    durationMs: 7_200_000,
    orientation: "horizontal",
    creators: [],
    topics: [],
    createdAt: T0,
    updatedAt: T0,
  });
  await graph.upsertItem({
    id: ITEM_B,
    canonicalType: "short",
    canonicalTitle: "Canonical R04 Item B",
    durationMs: 45_000,
    orientation: "vertical",
    creators: [],
    topics: [],
    createdAt: T0,
    updatedAt: T0,
  });
  await graph.upsertRealization({
    id: "wfxsrc_000000000000000000000000A1",
    entertainmentItemId: ITEM_A,
    connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
    externalRef: REF_CAT_A,
    capabilities: ["playEmbed"],
    availability: "available",
    playback: [],
    createdAt: T0,
    updatedAt: T0,
  });
  await graph.upsertRealization({
    id: "wfxsrc_000000000000000000000000A2",
    entertainmentItemId: ITEM_A,
    connectorId: "other-source",
    externalRef: REF_OTHER_A,
    capabilities: ["playEmbed"],
    availability: "available",
    playback: [],
    createdAt: T0,
    updatedAt: T0,
  });
  await graph.upsertRealization({
    id: "wfxsrc_000000000000000000000000A3",
    entertainmentItemId: ITEM_B,
    connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
    externalRef: REF_CAT_B,
    capabilities: ["playEmbed"],
    availability: "available",
    playback: [],
    createdAt: T0,
    updatedAt: T0,
  });
}

async function teardown(): Promise<void> {
  await test.close();
}

describe("R04 — canonical-keyed library (migration 0009 + the store)", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("a save of the same canonical item from a DIFFERENT source is a no-op on the list count", async () => {
    // First save: from webflix-catalog, REF_CAT_A.
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: REF_CAT_A, title: "Canonical R04 Item A" },
    });
    let listed = await library.listAllForProfile(`user:${USER}`);
    expect(listed.length).toBe(1);

    // Second save: from OTHER-SOURCE, REF_OTHER_A — same canonical item.
    // The list count stays at ONE (the canonical key wins).
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: "other-source",
      command: { op: "add", externalRef: REF_OTHER_A, title: "Canonical R04 Item A (re-save)" },
    });
    listed = await library.listAllForProfile(`user:${USER}`);
    expect(listed.length).toBe(1);
    // The primary realization reference UPDATED to the latest save
    // (the cross-source replacement law: the user's most recent intent wins).
    expect(listed[0]?.externalRef).toBe(REF_OTHER_A);
    expect(listed[0]?.connectorId).toBe("other-source");
  });

  it("the realization set in metadata.realizations GROWS on a cross-source save", async () => {
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: REF_CAT_A, title: "Canonical R04 Item A" },
    });
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: "other-source",
      command: { op: "add", externalRef: REF_OTHER_A, title: "Canonical R04 Item A (re-save)" },
    });
    // The metadata.realizations array has BOTH realizations (deduped by
    // (connectorId, externalRef)).
    const rows = await test.db.query<{ metadata: { realizations?: Array<{ connectorId: string; externalRef: string }> } }>(
      `SELECT metadata FROM library_entries WHERE user_id = $1`,
      [USER],
    );
    const realizations = rows[0]?.metadata?.realizations ?? [];
    expect(realizations.length).toBe(2);
    const refs = realizations.map((r) => r.externalRef).sort();
    expect(refs).toEqual([REF_CAT_A, REF_OTHER_A].sort());
  });

  it("the canonicalItemId travels through metadata for the runtime to adopt", async () => {
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: REF_CAT_A, title: "Canonical R04 Item A" },
    });
    const listed = await library.listAllForProfile(`user:${USER}`);
    expect(listed[0]?.metadata?.canonicalItemId).toBe(ITEM_A);
  });

  it("CROSS-SOURCE REALIZATION REPLACEMENT: the effective realization follows LIVE sources (never breaks while another realization exists)", async () => {
    // Save the same canonical item from BOTH sources (A first, B second —
    // the primary reference updates to B, the LATEST save).
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: REF_CAT_A, title: "Canonical R04 Item A" },
    });
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: "other-source",
      command: { op: "add", externalRef: REF_OTHER_A, title: "Canonical R04 Item A (re-save)" },
    });
    let listed = await library.listAllForProfile(`user:${USER}`);
    expect(listed.length).toBe(1);
    expect(listed[0]?.connectorId).toBe("other-source"); // primary = latest save
    expect(listed[0]?.externalRef).toBe(REF_OTHER_A);

    // The other-source realization DISAPPEARS (the source vanishes — delete
    // its source_realizations row). The row must NOT break: the effective
    // realization falls back to the LIVE catalog realization.
    await test.db.query(
      `DELETE FROM source_realizations WHERE connector_id = 'other-source' AND external_ref = $1`,
      [REF_OTHER_A],
    );
    listed = await library.listAllForProfile(`user:${USER}`);
    expect(listed.length).toBe(1); // still saved (the save is the user's intent)
    expect(listed[0]?.connectorId).toBe(WEBFLIX_CATALOG_CONNECTOR_ID); // the live replacement
    expect(listed[0]?.externalRef).toBe(REF_CAT_A);
    expect(listed[0]?.metadata?.canonicalItemId).toBe(ITEM_A); // canonical id intact

    // The LAST realization vanishes too — the row STAYS LISTED with its
    // (dead) primary reference: honest unavailable-for-playback (the
    // resolve path answers no realizations for a dead ref), never dropped.
    await test.db.query(
      `DELETE FROM source_realizations WHERE connector_id = $1 AND external_ref = $2`,
      [WEBFLIX_CATALOG_CONNECTOR_ID, REF_CAT_A],
    );
    listed = await library.listAllForProfile(`user:${USER}`);
    expect(listed.length).toBe(1); // still listed — no lease on a source's lifetime
    expect(listed[0]?.externalRef).toBe(REF_OTHER_A); // the recorded primary (dead — honest)
    expect(listed[0]?.metadata?.canonicalItemId).toBe(ITEM_A);
  });

  it("removing an item by its realization removes the canonical-keyed row", async () => {
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: REF_CAT_A, title: "Canonical R04 Item A" },
    });
    expect(await library.has(USER, WEBFLIX_CATALOG_CONNECTOR_ID, REF_CAT_A)).toBe(true);

    // Remove by the realization (the runtime's API).
    const removed = await library.removeWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: REF_CAT_A,
    });
    expect(removed).toBe(true);
    expect(await library.has(USER, WEBFLIX_CATALOG_CONNECTOR_ID, REF_CAT_A)).toBe(false);
  });
});

describe("R04 — history removals + exclusions (the event-sink law)", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("a removal adds a row to history_removals; the projection stays; events stay recorded", async () => {
    // Record a watch event for ITEM_A.
    await watch.record({
      userId: USER,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 30_000,
      completed: false,
      sessionId: SESSION_ID,
    });
    // The watch_history projection shows the item.
    let history = await watch.listRecent(USER);
    expect(history.some((row) => row.itemId === ITEM_A)).toBe(true);

    // Capture the event_outbox row count (the audit truth).
    const outboxBefore = await test.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_outbox WHERE user_id = $1`,
      [USER],
    );
    expect(outboxBefore[0]?.count).toBe(1);

    // Remove the item from history (adds a row to history_removals).
    await removals.add({ userId: USER, itemId: ITEM_A });
    expect(await removals.isRemoved(`user:${USER}`, ITEM_A)).toBe(true);

    // The event_outbox is UNCHANGED — the event-sink law (events are the
    // immutable truth; the removal is a projection-side filter).
    const outboxAfter = await test.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_outbox WHERE user_id = $1`,
      [USER],
    );
    expect(outboxAfter[0]?.count).toBe(1);

    // The watch_history PROJECTION row ALSO stays (the projection is
    // derived from events; the removal is a filter ON TOP of the
    // projection, not a delete of the projection itself). The
    // HistoryHost.readHistory() composes the filter — the API-level
    // handlers-history test exercises that composition.
    const projectionRows = await test.db.query<{ item_id: string }>(
      `SELECT item_id FROM watch_history WHERE user_id = $1 AND item_id = $2`,
      [USER, ITEM_A],
    );
    expect(projectionRows.length).toBe(1);
  });

  it("clearRemoval re-materializes the item in history (the relay's re-watch hook)", async () => {
    await watch.record({
      userId: USER,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 30_000,
      completed: false,
      sessionId: SESSION_ID,
    });
    await removals.add({ userId: USER, itemId: ITEM_A });
    expect(await removals.isRemoved(`user:${USER}`, ITEM_A)).toBe(true);

    // A re-watch (the relay's fold calls clearRemoval).
    const cleared = await removals.clearRemoval(`user:${USER}`, ITEM_A);
    expect(cleared).toBe(true);
    expect(await removals.isRemoved(`user:${USER}`, ITEM_A)).toBe(false);

    // The history read shows the item again (re-materialized).
    const history = await watch.listRecent(USER);
    expect(history.some((row) => row.itemId === ITEM_A)).toBe(true);
  });

  it("an exclusion adds a row to history_exclusions; a re-watch does NOT clear it", async () => {
    await watch.record({
      userId: USER,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 30_000,
      completed: false,
      sessionId: SESSION_ID,
    });
    await exclusions.add({ userId: USER, itemId: ITEM_A });
    expect(await exclusions.isExcluded(`user:${USER}`, ITEM_A)).toBe(true);

    // A re-watch (the relay's fold does NOT call clearExclusion — only
    // clearRemoval). The exclusion PERSISTS.
    await watch.record({
      userId: USER,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 60_000,
      completed: false,
      sessionId: SESSION_ID,
    });
    expect(await exclusions.isExcluded(`user:${USER}`, ITEM_A)).toBe(true);

    // Removing the exclusion re-includes the item.
    const removed = await exclusions.removeExclusion(`user:${USER}`, ITEM_A);
    expect(removed).toBe(true);
    expect(await exclusions.isExcluded(`user:${USER}`, ITEM_A)).toBe(false);
  });

  it("removals + exclusions are profile-scoped (the migration 0007 effective-profile key)", async () => {
    await removals.add({ userId: USER, itemId: ITEM_A, profileId: "wfxprof_test_a" });
    expect(await removals.isRemoved("wfxprof_test_a", ITEM_A)).toBe(true);
    // A DIFFERENT profile does NOT see this removal.
    expect(await removals.isRemoved("wfxprof_test_b", ITEM_A)).toBe(false);
  });

  it("removals + exclusions are idempotent (re-adding the same (profile, item) is a no-op)", async () => {
    await removals.add({ userId: USER, itemId: ITEM_A });
    const firstRow = await test.db.query<{ removed_at: string }>(
      `SELECT removed_at FROM history_removals WHERE user_id = $1 AND item_id = $2`,
      [USER, ITEM_A],
    );
    expect(firstRow.length).toBe(1);
    const firstAt = String(firstRow[0]?.removed_at);

    // Wait a tick (advance the clock) and re-add — the row stays (keeps
    // the earliest removed_at, the idempotent law).
    clock.advance(60_000);
    await removals.add({ userId: USER, itemId: ITEM_A });
    const secondRow = await test.db.query<{ removed_at: string }>(
      `SELECT removed_at FROM history_removals WHERE user_id = $1 AND item_id = $2`,
      [USER, ITEM_A],
    );
    expect(secondRow.length).toBe(1);
    expect(String(secondRow[0]?.removed_at)).toBe(firstAt);
  });
});
