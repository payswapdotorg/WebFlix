/**
 * WFX-052 — watch history + playback sessions tests (PGlite, real Postgres).
 *
 * The spec's acceptance points: history upserts and reads, the projection +
 * event committing in ONE transaction (transactional-outbox write side),
 * and the durable frozen `PlaybackSession` round-trip.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PersistenceError,
  PostgresPlaybackSessionStore,
  PostgresWatchHistoryStore,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 10, 0, 0);
const USER = "wfxusr_00000000000000000000000001";
const USER2 = "wfxusr_00000000000000000000000002";
const ITEM_A = "wfxitm_00000000000000000000000001";
const ITEM_B = "wfxitm_00000000000000000000000002";
const SESSION = "wfxpses_00000000000000000000000001";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let watch: PostgresWatchHistoryStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  watch = new PostgresWatchHistoryStore({ db: test.db, clock, ids });
});

afterAll(async () => {
  await test.close();
});

describe("watch history — the projection + event in ONE transaction", () => {
  it("record() writes the projection row AND the outbox event", async () => {
    const entry = await watch.record({
      userId: USER,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 120_000,
      completed: false,
      sessionId: SESSION,
    });
    expect(entry.userId).toBe(USER);
    expect(entry.itemId).toBe(ITEM_A);
    expect(entry.positionMs).toBe(120_000);
    expect(entry.completed).toBe(false);
    expect(entry.lastEventType).toBe("progress");

    // The event landed in the outbox (same transaction).
    const events = await test.db.query<{ user_id: string; event_type: string; envelope: { event: { payload?: { positionMs?: number } } } }>(
      "SELECT user_id, event_type, envelope FROM event_outbox WHERE user_id = $1",
      [USER],
    );
    expect(events.length).toBe(1);
    expect(events[0]?.event_type).toBe("progress");
    expect(events[0]?.envelope.event.payload?.positionMs).toBe(120_000);
  });

  it("folds a later observation into the SAME (user, item) projection row", async () => {
    clock.advance(60_000);
    await watch.record({
      userId: USER,
      itemId: ITEM_A,
      eventType: "complete",
      positionMs: 7_200_000,
      completed: true,
      sessionId: SESSION,
    });
    const entry = await watch.get(USER, ITEM_A);
    expect(entry?.positionMs).toBe(7_200_000);
    expect(entry?.completed).toBe(true);
    expect(entry?.lastEventType).toBe("complete");

    // Two events total now; still ONE projection row.
    const events = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE user_id = $1",
      [USER],
    );
    expect(events[0]?.count).toBe("2");
    const rows = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM watch_history WHERE user_id = $1",
      [USER],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("rejects invalid observations typed BEFORE any SQL runs", async () => {
    const eventsBefore = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox",
    );
    let caught: unknown;
    try {
      await watch.record({
        userId: "",
        itemId: "not-canonical",
        eventType: "progress",
        positionMs: -5,
        sessionId: "",
      } as unknown as Parameters<PostgresWatchHistoryStore["record"]>[0]);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
    const eventsAfter = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox",
    );
    expect(eventsAfter[0]?.count).toBe(eventsBefore[0]?.count);
  });

  it("listRecent orders most-recently-updated first, per user", async () => {
    clock.advance(60_000);
    await watch.record({
      userId: USER,
      itemId: ITEM_B,
      eventType: "start",
      positionMs: 0,
      completed: false,
      sessionId: SESSION,
    });
    clock.advance(60_000);
    await watch.record({
      userId: USER2,
      itemId: ITEM_A,
      eventType: "start",
      positionMs: 0,
      completed: false,
      sessionId: SESSION,
    });

    const recent = await watch.listRecent(USER, 10);
    // ITEM_B was updated last (T0+120s) → newest-first is [B, A].
    expect(recent.map((entry) => entry.itemId)).toEqual([ITEM_B, ITEM_A]);
    expect(await watch.get(USER2, ITEM_A)).not.toBeNull();
    const user2Recent = await watch.listRecent(USER2, 10);
    expect(user2Recent.map((entry) => entry.itemId)).toEqual([ITEM_A]);
  });

  it("answers get() null for never-watched pairs (a query, not an error)", async () => {
    expect(await watch.get(USER, "wfxitm_000000000000000000000099")).toBeNull();
  });
});

describe("playback sessions (the durable frozen PlaybackSession)", () => {
  let sessions: PostgresPlaybackSessionStore;

  beforeAll(() => {
    sessions = new PostgresPlaybackSessionStore({ db: test.db, clock });
  });

  it("saves and reads back a session verbatim (jsonb realization)", async () => {
    const saved = await sessions.save({
      id: SESSION,
      userId: USER,
      itemId: ITEM_A,
      realization: {
        mode: "embed",
        connectorId: "webflix-catalog",
        url: "https://catalog.invalid/embed/1",
        capabilities: ["playEmbed"],
      },
      resumePositionMs: 0,
      createdAt: "2026-09-13T10:05:00.000Z",
    });
    expect(saved.id).toBe(SESSION);

    const reread = await sessions.get(SESSION);
    expect(reread?.userId).toBe(USER);
    expect(reread?.itemId).toBe(ITEM_A);
    expect(reread?.realization.mode).toBe("embed");
    expect(reread?.realization.url).toBe("https://catalog.invalid/embed/1");
    expect(reread?.resumePositionMs).toBe(0);
  });

  it("upserts by canonical id: resume positions update, never duplicate", async () => {
    const updated = await sessions.save({
      id: SESSION,
      userId: USER,
      itemId: ITEM_A,
      realization: {
        mode: "embed",
        connectorId: "webflix-catalog",
        url: "https://catalog.invalid/embed/1",
        capabilities: ["playEmbed"],
      },
      resumePositionMs: 900_000,
      createdAt: "2026-09-13T10:05:00.000Z",
    });
    expect(updated.resumePositionMs).toBe(900_000);

    const rows = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM playback_sessions WHERE id = $1",
      [SESSION],
    );
    expect(rows[0]?.count).toBe("1");

    const viaUpdate = await sessions.updateResume(SESSION, 1_000_000);
    expect(viaUpdate?.resumePositionMs).toBe(1_000_000);
    expect(await sessions.updateResume("wfxpses_000000000000000000000099", 5)).toBeNull();
  });

  it("listRecent returns the user's sessions newest-updated first", async () => {
    const recent = await sessions.listRecent(USER, 10);
    expect(recent.map((session) => session.id)).toEqual([SESSION]);
  });

  it("rejects a session without an id, typed", async () => {
    let caught: unknown;
    try {
      await sessions.save({
        id: "",
        userId: USER,
        itemId: ITEM_A,
        realization: {
          mode: "native",
          connectorId: "webflix-catalog",
          capabilities: ["playNative"],
        },
        resumePositionMs: 0,
        createdAt: "2026-09-13T10:05:00.000Z",
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
  });
});
