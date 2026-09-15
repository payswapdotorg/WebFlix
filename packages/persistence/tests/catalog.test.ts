/**
 * WFX-052 — the WebFlix catalog `ConnectorPort` + library store tests
 * (PGlite, real Postgres).
 *
 * The spec's acceptance points: the Ports seam over real SQL (feed/candidate
 * source), library upserts and reads, and the transactional-outbox wiring —
 * a library ADD commits its row AND its "save" event in ONE transaction, and
 * actions (like/save) enqueue their events atomically.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PostgresCatalogConnector,
  PostgresLibraryStore,
  WEBFLIX_CATALOG_CAPABILITIES,
  WEBFLIX_CATALOG_CONNECTOR_ID,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 10, 0, 0);
const T0 = "2026-09-13T10:00:00.000Z";
const USER = "wfxusr_00000000000000000000000001";
const ITEM_A = "wfxitm_00000000000000000000000001";
const ITEM_B = "wfxitm_00000000000000000000000002";
const REF_A = "cat:asteroid-drift";
const REF_B = "cat:neon-rain";
const CTX = { userId: USER, locale: "en-US" } as const;

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let catalog: PostgresCatalogConnector;
let library: PostgresLibraryStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  catalog = new PostgresCatalogConnector({ db: test.db, clock, ids });
  library = new PostgresLibraryStore({ db: test.db, clock });

  // Seed the catalog graph: two items with realizations + playback answers.
  await seedGraph();
});

afterAll(async () => {
  await test.close();
});

async function seedGraph(): Promise<void> {
  const { PostgresGraphStore } = await import("../src/index");
  const graph = new PostgresGraphStore(test.db);
  await graph.upsertItem({
    id: ITEM_A,
    canonicalType: "movie",
    canonicalTitle: "Asteroid Drift",
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
    canonicalTitle: "Neon Rain",
    durationMs: 45_000,
    orientation: "vertical",
    creators: [],
    topics: [],
    createdAt: T0,
    updatedAt: T0,
  });
  await graph.upsertRealization({
    id: "wfxsrc_00000000000000000000000001",
    entertainmentItemId: ITEM_A,
    connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
    externalRef: REF_A,
    capabilities: ["playEmbed", "playBrowser"],
    availability: "available",
    playback: [
      {
        mode: "embed",
        connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
        url: "https://catalog.invalid/embed/asteroid-drift",
        capabilities: ["playEmbed"],
      },
      {
        mode: "browser",
        connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
        url: "https://catalog.invalid/watch/asteroid-drift",
        capabilities: ["playBrowser"],
      },
    ],
    createdAt: T0,
    updatedAt: T0,
  });
  await graph.upsertRealization({
    id: "wfxsrc_00000000000000000000000002",
    entertainmentItemId: ITEM_B,
    connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
    externalRef: REF_B,
    capabilities: ["playEmbed"],
    availability: "available",
    playback: [
      {
        mode: "embed",
        connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
        url: "https://catalog.invalid/embed/neon-rain",
        capabilities: ["playEmbed"],
      },
    ],
    createdAt: T0,
    updatedAt: T0,
  });
}

describe("descriptor — capability truth", () => {
  it("declares exactly the durably-backed capabilities (no lies)", () => {
    const descriptor = catalog.descriptor();
    expect(descriptor.id).toBe(WEBFLIX_CATALOG_CONNECTOR_ID);
    expect([...descriptor.capabilities].sort()).toEqual([...WEBFLIX_CATALOG_CAPABILITIES].sort());
    // follow/comment/download/transform are NOT declared — no durable store.
    expect(descriptor.capabilities).not.toContain("follow");
    expect(descriptor.capabilities).not.toContain("comment");
    expect(descriptor.capabilities).not.toContain("download");
    expect(descriptor.capabilities).not.toContain("transform");
  });
});

describe("search / metadata / resolve — the feed/candidate source seam", () => {
  it("search maps catalog rows to frozen SearchResults, blank queries to []", async () => {
    const hits = await catalog.search(CTX, "rain");
    expect(hits.length).toBe(1);
    expect(hits[0]?.connectorId).toBe(WEBFLIX_CATALOG_CONNECTOR_ID);
    expect(hits[0]?.externalRef).toBe(REF_B);
    expect(hits[0]?.title).toBe("Neon Rain");
    expect(hits[0]?.canonicalType).toBe("short");
    expect(hits[0]?.durationMs).toBe(45_000);
    expect(hits[0]?.orientation).toBe("vertical");

    expect(await catalog.search(CTX, "  ")).toEqual([]);
    expect(await catalog.search(CTX, "no-such-title")).toEqual([]);
  });

  it("metadata answers the frozen SourceItem shape; null for unknown refs", async () => {
    const item = await catalog.metadata(CTX, REF_A);
    expect(item?.connectorId).toBe(WEBFLIX_CATALOG_CONNECTOR_ID);
    expect(item?.externalRef).toBe(REF_A);
    expect(item?.title).toBe("Asteroid Drift");
    expect(item?.availability).toBe("available");
    expect(item?.capabilities).toEqual(["playEmbed", "playBrowser"]);
    expect(await catalog.metadata(CTX, "cat:unknown")).toBeNull();
  });

  it("resolve returns ONLY the STORED playback realizations — nothing fabricated", async () => {
    const realizations = await catalog.resolve(CTX, REF_A);
    expect(realizations.map((r) => r.mode).sort()).toEqual(["browser", "embed"]);
    expect(await catalog.resolve(CTX, "cat:unknown")).toEqual([]);
  });
});

describe("executeAction — the outbox write side for actions", () => {
  it("confirms a like AND lands its frozen event in the same transaction", async () => {
    const receipt = await catalog.executeAction(CTX, {
      type: "like",
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: REF_A,
    });
    expect(receipt.status).toBe("confirmed");
    expect(receipt.occurredAt).toBe("2026-09-13T10:00:00.000Z");

    const events = await test.db.query<{ event_type: string; item_id: string }>(
      "SELECT event_type, item_id FROM event_outbox WHERE user_id = $1",
      [USER],
    );
    expect(events.some((e) => e.event_type === "like" && e.item_id === ITEM_A)).toBe(true);
  });

  it("confirms a save with library row + save event committed together", async () => {
    const receipt = await catalog.executeAction(CTX, {
      type: "save",
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: REF_B,
    });
    expect(receipt.status).toBe("confirmed");

    const libRows = await test.db.query<{ external_ref: string }>(
      "SELECT external_ref FROM library_entries WHERE user_id = $1",
      [USER],
    );
    expect(libRows.some((row) => row.external_ref === REF_B)).toBe(true);
    const events = await test.db.query<{ event_type: string; item_id: string }>(
      "SELECT event_type, item_id FROM event_outbox WHERE user_id = $1",
      [USER],
    );
    expect(events.some((e) => e.event_type === "save" && e.item_id === ITEM_B)).toBe(true);
  });

  it("answers unsupported for capabilities it does not declare", async () => {
    const receipt = await catalog.executeAction(CTX, {
      type: "comment",
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: REF_A,
    });
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toContain("comment");
  });

  it("answers failed for an action aimed at a DIFFERENT connector (plain-surface law)", async () => {
    const receipt = await catalog.executeAction(CTX, {
      type: "like",
      connectorId: "some-other-connector",
      externalRef: REF_A,
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("some-other-connector");
    expect(receipt.detail).toContain(WEBFLIX_CATALOG_CONNECTOR_ID);
  });

  it("answers failed for an unknown ref — the catalog never invents identities", async () => {
    const receipt = await catalog.executeAction(CTX, {
      type: "like",
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: "cat:never-ingested",
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("never invents canonical identities");
  });

  it("answers failed for a malformed action object", async () => {
    const receipt = await catalog.executeAction(CTX, {
      nope: true,
    } as unknown as Parameters<PostgresCatalogConnector["executeAction"]>[1]);
    expect(receipt.status).toBe("failed");
  });
});

describe("writeLibrary / readLibrary — the library seam", () => {
  it("add commits the library row AND the save event in ONE transaction", async () => {
    const receipt = await catalog.writeLibrary(CTX, {
      op: "add",
      externalRef: REF_A,
      title: "Asteroid Drift (saved)",
      metadata: { via: "writeLibrary" },
    });
    expect(receipt.status).toBe("confirmed");

    const libRow = await test.db.query<{
      title: string;
      metadata: { via?: string } | null;
    }>(
      "SELECT title, metadata FROM library_entries WHERE user_id = $1 AND external_ref = $2",
      [USER, REF_A],
    );
    expect(libRow[0]?.title).toBe("Asteroid Drift (saved)");
    expect(libRow[0]?.metadata?.via).toBe("writeLibrary");

    const saveEvents = await test.db.query<{ event_type: string; item_id: string }>(
      "SELECT event_type, item_id FROM event_outbox WHERE user_id = $1 AND event_type = 'save'",
      [USER],
    );
    expect(saveEvents.some((e) => e.item_id === ITEM_A)).toBe(true);
  });

  it("readLibrary lists the user's entries in frozen LibraryEntry shape", async () => {
    const entries = await catalog.readLibrary(CTX);
    const refs = entries.map((entry) => entry.externalRef).sort();
    expect(refs).toEqual([REF_A, REF_B]);
    expect(entries[0]?.connectorId).toBe(WEBFLIX_CATALOG_CONNECTOR_ID);
    expect(typeof entries[0]?.addedAt).toBe("string");
  });

  it("remove deletes the row; removing an absent entry answers failed", async () => {
    const removed = await catalog.writeLibrary(CTX, { op: "remove", externalRef: REF_A });
    expect(removed.status).toBe("confirmed");
    expect(await library.has(USER, WEBFLIX_CATALOG_CONNECTOR_ID, REF_A)).toBe(false);

    const absent = await catalog.writeLibrary(CTX, { op: "remove", externalRef: REF_A });
    expect(absent.status).toBe("failed");
    expect(absent.detail).toContain("not present");
  });

  it("answers failed for a malformed command", async () => {
    const receipt = await catalog.writeLibrary(CTX, {
      op: "rename",
      externalRef: REF_A,
    } as unknown as Parameters<PostgresCatalogConnector["writeLibrary"]>[1]);
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("'add' or 'remove'");
  });
});

describe("PostgresLibraryStore — the raw store", () => {
  it("addWithin/list/has/remove round-trip with deterministic ordering", async () => {
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: "cat:zeta", title: "Zeta" },
    });
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: "cat:alpha", title: "Alpha" },
    });
    const listed = await library.list(USER, WEBFLIX_CATALOG_CONNECTOR_ID);
    // Both added at the same injected instant → (added_at, external_ref) order.
    const refs = listed.map((entry) => entry.externalRef);
    expect(refs.indexOf("cat:alpha")).toBeGreaterThan(-1);
    expect(refs.indexOf("cat:zeta")).toBeGreaterThan(refs.indexOf("cat:alpha"));
    expect(await library.has(USER, WEBFLIX_CATALOG_CONNECTOR_ID, "cat:zeta")).toBe(true);

    expect(
      await library.removeWithin(test.db, {
        userId: USER,
        connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
        externalRef: "cat:zeta",
      }),
    ).toBe(true);
    expect(
      await library.removeWithin(test.db, {
        userId: USER,
        connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
        externalRef: "cat:zeta",
      }),
    ).toBe(false);
  });

  it("re-adding the same (user, connector, ref) replaces title/metadata (upsert)", async () => {
    await library.addWithin(test.db, {
      userId: USER,
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      command: { op: "add", externalRef: "cat:alpha", title: "Alpha v2" },
    });
    const listed = await library.list(USER, WEBFLIX_CATALOG_CONNECTOR_ID);
    const alpha = listed.find((entry) => entry.externalRef === "cat:alpha");
    expect(alpha?.title).toBe("Alpha v2");
  });
});
