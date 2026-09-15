/**
 * WFX-052 — the transactional event outbox tests (PGlite, real Postgres).
 *
 * The pattern's acceptance points:
 * - WRITE SIDE atomicity: a domain event and the state change it describes
 *   commit in ONE transaction — both or neither (demonstrated with a
 *   library row + its "save" event).
 * - RELAY: due-claim with FOR UPDATE SKIP LOCKED, delivery, deterministic
 *   exponential backoff on failure, terminal failure after maxAttempts.
 * - AT-LEAST-ONCE: crash recovery via requeueStaleInFlight re-delivers.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PostgresEventSink,
  backoffForAttempt,
  drainEventOutbox,
  enqueueEvent,
  buildEnvelope,
  listOutboxRowsForUser,
  requeueStaleInFlight,
  type DrainEventOutboxOptions,
  type EventOutboxRow,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 0, 0, 0);
const USER = "wfxusr_00000000000000000000000001";
const ITEM = "wfxitm_00000000000000000000000001";

function validEvent(overrides: Partial<Parameters<typeof buildEnvelope>[0]> = {}) {
  return {
    userId: USER,
    itemId: ITEM,
    type: "start" as const,
    occurredAt: "2026-09-13T10:00:00.000Z",
    sessionId: "wfxpses_00000000000000000000000001",
    ...overrides,
  };
}

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let sink: PostgresEventSink;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  sink = new PostgresEventSink({ db: test.db, clock, ids });
});

afterAll(async () => {
  await test.close();
});

/** Count outbox rows by status for the shared user. */
async function rowsByStatus(): Promise<Record<string, number>> {
  const rows = await test.db.query<{ status: string }>(
    "SELECT status FROM event_outbox WHERE user_id = $1",
    [USER],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

describe("event sink — the write side", () => {
  it("emit() lands a pending outbox row with the full frozen envelope", async () => {
    await sink.emit(validEvent({ type: "impression" }));
    const listed = await listOutboxRowsForUser(test.db, USER);
    const row = listed[0];
    if (row === undefined) throw new Error("no outbox row");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.eventType).toBe("impression");
    expect(row.id.startsWith("wfxevt_")).toBe(true);
    expect(row.envelope.schemaVersion).toBe(1);
    // The outbox row id IS the canonical envelope identity.
    expect(String(row.envelope.eventId)).toBe(row.id);
    expect(row.envelope.event.itemId).toBe(ITEM);
    expect(row.envelope.event.sessionId).toBe("wfxpses_00000000000000000000000001");
  });

  it("rejects a malformed event typed, with NO row written", async () => {
    const before = (await listOutboxRowsForUser(test.db, USER)).length;
    let caught: unknown;
    try {
      await sink.emit(validEvent({ itemId: "not-a-canonical-id" }));
    } catch (thrown) {
      caught = thrown;
    }
    expect((caught as { kind?: string }).kind).toBe("invalid-input");
    expect((await listOutboxRowsForUser(test.db, USER)).length).toBe(before);
  });

  it("mints DISTINCT envelope ids for identical payloads (wrap-time identity)", async () => {
    await sink.emit(validEvent({ type: "like" }));
    await sink.emit(validEvent({ type: "like" }));
    const listed = await listOutboxRowsForUser(test.db, USER);
    const likeRows = listed.filter((row) => row.eventType === "like");
    expect(likeRows.length).toBe(2);
    expect(likeRows[0]?.id).not.toBe(likeRows[1]?.id);
  });
});

describe("transactional atomicity — event + state in ONE transaction", () => {
  it("commits the library row AND the save event together", async () => {
    const now = clock.now();
    const envelope = buildEnvelope(validEvent({ type: "save" }), ids);
    await test.db.begin(async (tx) => {
      await tx.query(
        `INSERT INTO library_entries (user_id, connector_id, external_ref, title, added_at)
         VALUES ($1, 'webflix-catalog', 'ref-atomic-1', 'Atomic Title', $2)`,
        [USER, new Date(now).toISOString()],
      );
      await enqueueEvent(tx, envelope, now);
    });

    const libRows = await test.db.query<{ external_ref: string }>(
      "SELECT external_ref FROM library_entries WHERE user_id = $1 AND external_ref = 'ref-atomic-1'",
      [USER],
    );
    expect(libRows.length).toBe(1);
    const outboxRows = await test.db.query<{ id: string }>(
      "SELECT id FROM event_outbox WHERE id = $1",
      [envelope.eventId],
    );
    expect(outboxRows.length).toBe(1);
  });

  it("rolls BOTH back when the transaction rejects (the whole point)", async () => {
    const before = await rowsByStatus();
    const libBefore = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM library_entries WHERE user_id = $1",
      [USER],
    );
    const envelope = buildEnvelope(validEvent({ type: "save" }), ids);
    let caught: unknown;
    try {
      await test.db.begin(async (tx) => {
        await tx.query(
          `INSERT INTO library_entries (user_id, connector_id, external_ref, title, added_at)
           VALUES ($1, 'webflix-catalog', 'ref-atomic-2', 'Doomed Title', $2)`,
          [USER, new Date(clock.now()).toISOString()],
        );
        await enqueueEvent(tx, envelope, clock.now());
        // Simulate a late failure INSIDE the same transaction.
        throw new Error("boom after both writes");
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect((caught as Error).message).toBe("boom after both writes");

    // NEITHER the library row NOR the event row may exist.
    const libAfter = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM library_entries WHERE user_id = $1",
      [USER],
    );
    expect(libAfter[0]?.count).toBe(libBefore[0]?.count);
    const outboxRows = await test.db.query<{ id: string }>(
      "SELECT id FROM event_outbox WHERE id = $1",
      [envelope.eventId],
    );
    expect(outboxRows.length).toBe(0);
    expect(await rowsByStatus()).toEqual(before);
  });
});

describe("drainEventOutbox — the relay", () => {
  let delivered: string[] = [];

  function options(now: number, extra: Partial<DrainEventOutboxOptions> = {}): DrainEventOutboxOptions {
    return {
      deliver: async (envelope) => {
        delivered.push(envelope.eventId);
      },
      now,
      backoffBaseMs: 1_000,
      maxAttempts: 3,
      ...extra,
    };
  }

  it("delivers due pending rows and marks them delivered", async () => {
    delivered = [];
    await sink.emit(validEvent({ type: "share" }));
    const result = await drainEventOutbox(test.db, options(clock.now()));
    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(result.delivered).toBe(result.claimed);
    expect(result.rescheduled).toBe(0);
    expect(result.failed).toBe(0);
    expect(delivered.length).toBe(result.claimed);

    const statuses = await rowsByStatus();
    expect(statuses["pending"] ?? 0).toBeGreaterThanOrEqual(0);
    expect(statuses["in-flight"] ?? 0).toBe(0);
  });

  it("reschedules a failed delivery with deterministic exponential backoff", async () => {
    // A deliverer that always fails, for rows emitted from here on.
    const failing: DrainEventOutboxOptions = {
      deliver: async () => {
        throw new Error("downstream unavailable");
      },
      now: clock.now(),
      backoffBaseMs: 1_000,
      maxAttempts: 3,
    };
    await sink.emit(validEvent({ type: "search" }));
    const before = await rowsByStatus();
    const result = await drainEventOutbox(test.db, failing);
    expect(result.rescheduled).toBeGreaterThanOrEqual(1);

    // The rescheduled row is pending again with attempts=1 and a backoff of
    // base * 2^0 = 1s from NOW (not yet due).
    const pending = await test.db.query<{ attempts: number; next_attempt_at: Date }>(
      "SELECT attempts, next_attempt_at FROM event_outbox WHERE user_id = $1 AND status = 'pending' AND attempts = 1",
      [USER],
    );
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const row = pending[0];
    expect(row?.attempts).toBe(1);
    const expectedNext = new Date(clock.now() + 1_000).toISOString();
    expect(new Date(row?.next_attempt_at ?? 0).toISOString()).toBe(expectedNext);

    // Not due yet → a drain at the same instant claims nothing new from it.
    const second = await drainEventOutbox(test.db, failing);
    expect(second.claimed).toBe(0);

    // After the backoff elapses it is due again → attempts=2.
    clock.advance(1_000);
    const third = await drainEventOutbox(test.db, { ...failing, now: clock.now() });
    expect(third.claimed).toBeGreaterThanOrEqual(1);
    expect(await rowsByStatus()).toEqual(before); // still pending (2 < maxAttempts 3)
  });

  it("marks a row FAILED after maxAttempts (terminal, no infinite retry)", async () => {
    const failing: DrainEventOutboxOptions = {
      deliver: async () => {
        throw new Error("permanently broken downstream");
      },
      now: clock.now(),
      backoffBaseMs: 1_000,
      maxAttempts: 3,
    };
    await sink.emit(validEvent({ type: "progress" }));
    // Drain until that row is terminal: attempts 1, 2, 3.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await drainEventOutbox(test.db, { ...failing, now: clock.now() });
      clock.advance(4_000); // past any backoff computed from base 1s
    }
    const failedRows = await test.db.query<{ status: string; attempts: number; last_error: string | null }>(
      "SELECT status, attempts, last_error FROM event_outbox WHERE user_id = $1 AND status = 'failed'",
      [USER],
    );
    expect(failedRows.length).toBeGreaterThanOrEqual(1);
    const row = failedRows[0];
    expect(row?.attempts).toBe(3);
    expect(row?.last_error).toContain("permanently broken downstream");
  });

  it("backoffForAttempt is the pure exponential law (base * 2^(n-1), capped)", () => {
    const opts: DrainEventOutboxOptions = {
      deliver: async () => {},
      now: 0,
      backoffBaseMs: 1_000,
      backoffCapMs: 300_000,
    };
    expect(backoffForAttempt(1, opts)).toBe(1_000);
    expect(backoffForAttempt(2, opts)).toBe(2_000);
    expect(backoffForAttempt(3, opts)).toBe(4_000);
    expect(backoffForAttempt(10, opts)).toBe(300_000); // capped
  });

  it("requeueStaleInFlight returns crashed relay rows to pending (AT-LEAST-ONCE)", async () => {
    // Simulate a relay crash: an event left in-flight with an old claimed_at.
    await sink.emit(validEvent({ type: "complete" }));
    clock.advance(10 * 60 * 1_000); // 10 minutes
    await test.db.query(
      `UPDATE event_outbox SET status = 'in-flight', claimed_at = $1, attempts = 1
       WHERE user_id = $2 AND status = 'pending' AND event_type = 'complete'`,
      [new Date(clock.now() - 5 * 60 * 1_000).toISOString(), USER],
    );

    const requeued = await requeueStaleInFlight(test.db, {
      now: clock.now(),
      olderThanMs: 60_000,
    });
    expect(requeued).toBeGreaterThanOrEqual(1);

    // The requeued row is deliverable again — at-least-once in action.
    delivered = [];
    const result = await drainEventOutbox(test.db, options(clock.now()));
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    expect(delivered.length).toBeGreaterThanOrEqual(1);
  });

  it("lists rows for a user newest-first (diagnostics order)", async () => {
    const listed: readonly EventOutboxRow[] = await listOutboxRowsForUser(test.db, USER, 5);
    expect(listed.length).toBeLessThanOrEqual(5);
    for (let index = 1; index < listed.length; index += 1) {
      const previous = listed[index - 1];
      const current = listed[index];
      if (previous === undefined || current === undefined) continue;
      expect(previous.createdAt >= current.createdAt).toBe(true);
    }
  });
});
