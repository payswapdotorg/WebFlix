/**
 * WFX-052 — Entertainment Graph tables tests (PGlite, real Postgres).
 *
 * The spec's acceptance points: graph upserts and reads — canonical item
 * identity, "one content identity, many realizations" with STABLE
 * realization ids on re-report, merge semantics (earliest-created /
 * latest-updated, accumulate-don't-forget), search, and the never-invents-
 * identities law (FK guard).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PersistenceError, PostgresGraphStore } from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const T0 = "2026-09-13T10:00:00.000Z";
const T1 = "2026-09-13T11:00:00.000Z";
const T2 = "2026-09-13T12:00:00.000Z";

const ITEM_A = "wfxitm_00000000000000000000000001";
const ITEM_B = "wfxitm_00000000000000000000000002";
const ITEM_UNTITLED = "wfxitm_00000000000000000000000003";
const REALIZATION_A1 = "wfxsrc_00000000000000000000000001";
const REALIZATION_A2 = "wfxsrc_00000000000000000000000002";

let test: TestDb;
let graph: PostgresGraphStore;

beforeAll(async () => {
  test = await createTestDb();
  graph = new PostgresGraphStore(test.db);
});

afterAll(async () => {
  await test.close();
});

describe("upsertItem", () => {
  it("inserts a first-sight item with timestamps kept verbatim", async () => {
    const stored = await graph.upsertItem({
      id: ITEM_A,
      canonicalType: "movie",
      canonicalTitle: "Asteroid Drift",
      durationMs: 7_200_000,
      orientation: "horizontal",
      creators: ["wfxcre_00000000000000000000000001"],
      topics: [],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(stored.id).toBe(ITEM_A);
    expect(stored.canonicalTitle).toBe("Asteroid Drift");
    expect(stored.durationMs).toBe(7_200_000);
    expect(stored.orientation).toBe("horizontal");
    expect(stored.creators).toEqual(["wfxcre_00000000000000000000000001"]);
    expect(stored.createdAt).toBe(T0);
    expect(stored.updatedAt).toBe(T0);
  });

  it("MERGES on re-upsert: defined scalars win, omitted scalars are KEPT", async () => {
    const merged = await graph.upsertItem({
      id: ITEM_A,
      canonicalType: "movie",
      canonicalTitle: "Asteroid Drift (Director's Cut)",
      creators: [
        "wfxcre_00000000000000000000000001",
        "wfxcre_00000000000000000000000002",
      ],
      topics: ["wfxtop_00000000000000000000000001"],
      // durationMs + orientation omitted — the graph never forgets
      createdAt: T1, // LATER than stored T0 → earliest wins
      updatedAt: T2,
    });
    expect(merged.canonicalTitle).toBe("Asteroid Drift (Director's Cut)");
    expect(merged.durationMs).toBe(7_200_000); // kept
    expect(merged.orientation).toBe("horizontal"); // kept
    expect(merged.creators).toHaveLength(2);
    expect(merged.topics).toEqual(["wfxtop_00000000000000000000000001"]);
    expect(merged.createdAt).toBe(T0); // earliest
    expect(merged.updatedAt).toBe(T2); // latest
  });

  it("round-trips an item with NO title through SQL NULL honestly", async () => {
    const stored = await graph.upsertItem({
      id: ITEM_UNTITLED,
      canonicalType: "video",
      creators: [],
      topics: [],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(stored.canonicalTitle).toBeNull();
    expect(stored.durationMs).toBeNull();
    expect(stored.orientation).toBeNull();

    const reread = await graph.getItem(ITEM_UNTITLED);
    expect(reread?.canonicalTitle).toBeNull();
  });

  it("rejects malformed items typed (invalid-input), writing nothing", async () => {
    let caught: unknown;
    try {
      await graph.upsertItem({
        id: "not-canonical",
        canonicalType: "movie",
        creators: [],
        topics: [],
        createdAt: T0,
        updatedAt: T0,
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
    expect(await graph.getItem("not-canonical")).toBeNull();
  });

  it("answers getItem null for unknown ids (a query, not an error)", async () => {
    expect(await graph.getItem("wfxitm_000000000000000000000099")).toBeNull();
  });
});

describe("upsertRealization — one identity, many realizations", () => {
  it("attaches a realization to its canonical item", async () => {
    const stored = await graph.upsertRealization({
      id: REALIZATION_A1,
      entertainmentItemId: ITEM_A,
      connectorId: "webflix-catalog",
      externalRef: "cat:asteroid-drift",
      capabilities: ["playEmbed", "playBrowser"],
      availability: "available",
      playback: [
        {
          mode: "embed",
          connectorId: "webflix-catalog",
          url: "https://catalog.invalid/embed/asteroid-drift",
          capabilities: ["playEmbed"],
        },
      ],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(stored.id).toBe(REALIZATION_A1);
    expect(stored.entertainmentItemId).toBe(ITEM_A);
    expect(stored.playback).toHaveLength(1);
  });

  it("keeps the ORIGINAL wfxsrc_ id on a re-report of the same (connector, ref)", async () => {
    const rereported = await graph.upsertRealization({
      id: "wfxsrc_00000000000000000000000099", // different minted id — must NOT win
      entertainmentItemId: ITEM_A,
      connectorId: "webflix-catalog",
      externalRef: "cat:asteroid-drift",
      capabilities: ["playEmbed", "playBrowser", "playExternal"],
      availability: "unknown",
      playback: [],
      createdAt: T1,
      updatedAt: T1,
    });
    expect(rereported.id).toBe(REALIZATION_A1); // stable identity
    expect(rereported.capabilities).toEqual(["playEmbed", "playBrowser", "playExternal"]);
    expect(rereported.updatedAt).toBe(T1);

    // And there is exactly ONE row for the (connector, ref) pair.
    const all = await graph.realizationsOf(ITEM_A);
    expect(all.filter((row) => row.externalRef === "cat:asteroid-drift")).toHaveLength(1);
  });

  it("holds many realizations of one item (the 'many' side of the law)", async () => {
    await graph.upsertRealization({
      id: REALIZATION_A2,
      entertainmentItemId: ITEM_A,
      connectorId: "youtube",
      externalRef: "yt:asteroid-trailer",
      capabilities: ["playEmbed"],
      availability: "available",
      playback: [],
      createdAt: T1,
      updatedAt: T1,
    });
    const all = await graph.realizationsOf(ITEM_A);
    expect(all).toHaveLength(2);
    expect(all.map((row) => row.connectorId).sort()).toEqual(["webflix-catalog", "youtube"]);
  });

  it("rejects a realization for an UNKNOWN item — never invents identities", async () => {
    let caught: unknown;
    try {
      await graph.upsertRealization({
        id: "wfxsrc_00000000000000000000000077",
        entertainmentItemId: "wfxitm_00000000000000000000000077",
        connectorId: "webflix-catalog",
        externalRef: "cat:ghost",
        capabilities: [],
        availability: "unknown",
        playback: [],
        createdAt: T0,
        updatedAt: T0,
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
    expect((caught as Error).message).toContain("never invents canonical identities");
  });

  it("resolves a realization by (connectorId, externalRef)", async () => {
    const found = await graph.realizationByRef("youtube", "yt:asteroid-trailer");
    expect(found?.id).toBe(REALIZATION_A2);
    expect(await graph.realizationByRef("youtube", "yt:nope")).toBeNull();
  });
});

describe("searchItems", () => {
  it("finds case-insensitive substrings of titles, deterministically ordered", async () => {
    await graph.upsertItem({
      id: ITEM_B,
      canonicalType: "short",
      canonicalTitle: "Neon Rain",
      creators: [],
      topics: [],
      createdAt: T1,
      updatedAt: T1,
    });
    expect((await graph.searchItems("rain")).map((hit) => hit.id)).toEqual([ITEM_B]);
    expect((await graph.searchItems("drift")).map((hit) => hit.id)).toEqual([ITEM_A]);
    // A needle both titles share ("r"), ordered by (title, id): Asteroid… < Neon…
    expect((await graph.searchItems("r")).map((hit) => hit.id)).toEqual([ITEM_A, ITEM_B]);
    // Case-insensitive both ways.
    expect((await graph.searchItems("ASTEROID")).map((hit) => hit.id)).toEqual([ITEM_A]);
  });

  it("never matches untitled items and treats LIKE metacharacters literally", async () => {
    const percent = await graph.searchItems("%");
    expect(percent).toEqual([]); // no title contains a literal %
    // Blank-after-trim needles are invalid input (the graph's search law).
    for (const needle of ["", "   "]) {
      let caught: unknown;
      try {
        await graph.searchItems(needle);
      } catch (thrown) {
        caught = thrown;
      }
      expect(caught).toBeInstanceOf(PersistenceError);
      expect((caught as PersistenceError).kind).toBe("invalid-input");
    }
  });
});

describe("listItems", () => {
  it("walks the catalog in deterministic (created_at, id) order", async () => {
    const items = await graph.listItems(50, 0);
    // created_at: A=T0, UNTITLED=T0, B=T1 → (T0, id 01), (T0, id 03), (T1, id 02).
    expect(items.map((item) => item.id)).toEqual([ITEM_A, ITEM_UNTITLED, ITEM_B]);
  });
});
