/**
 * WFX-055A — the outbox relay tests (bun:test, PGlite).
 *
 * Pins the relay laws of `src/host/relay.ts` — the durable event-delivery
 * path over the 052 transactional outbox — with REALLY-enqueued events
 * (`PostgresEventSink` → `event_outbox`) against the app-local PGlite
 * harness (real migrations 0001..0007, no network, no server):
 *
 * - `runRelayDrain`:
 *   - the pending drain folds watch-state events into the `watch_history`
 *     projection: `position_ms` advances ONLY when the event SPEAKS a
 *     position (missing / negative / non-number payload positions never
 *     rewind progress); `completed` is MONOTONE (a replayed `complete`
 *     cannot un-complete — not even a later skip can); `last_event_type`
 *     and `updated_at` reflect the LAST delivered event;
 *   - stale `in-flight` rows (a crashed relay, older than the 10-minute
 *     window) are requeued FIRST and then delivered — while rows INSIDE
 *     the window are left exactly as they are;
 *   - non-watch event types are honest no-ops: the envelope is marked
 *     delivered and NO projection row appears (even when the event
 *     speaks a position — the type filter runs before the fold);
 *   - redelivery idempotency: draining the same events a second time
 *     leaves the projection in the SAME state (at-least-once safety).
 * - `scheduleOpportunisticDrain` (the bounded best-effort lane): the
 *   count trigger at 10 events, the 60s interval throttle, the in-flight
 *   guard, and the bounded claim of 20 rows per opportunistic drain —
 *   never a tight loop. Observed through a probe `DbClient` that counts
 *   drain starts (each drain's FIRST statement is `requeueStaleInFlight`'s
 *   UPDATE — a SQL shape no other outbox statement shares) and can park
 *   one drain at that statement on a test-owned latch.
 *
 * Determinism: one PGlite per file, FixedClock + SequentialIdGen
 * everywhere. bun gives each test file a fresh module registry, so the
 * opportunistic lane's module counters start pristine in this file; the
 * opportunistic `it`s share them IN DECLARATION ORDER — the ledger is
 * documented in that describe block's header. The only wall-clock touch
 * is the bounded `waitFor` poll's deadline (harness code, never logic
 * under test).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { EntertainmentEvent } from "@wfx/domain";
import { FixedClock, SequentialIdGen } from "@wfx/experience";
import {
  PostgresEventSink,
  toIsoTimestamp,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "@wfx/persistence";

import { runRelayDrain, scheduleOpportunisticDrain } from "../src/host/relay";
import { readSeededRow, type SeededRow } from "./test-boot";
import { createTestDb, type TestDb } from "./test-db";

/** Section-1 drain clock: 2026-09-16T09:00:00.000Z (enqueue + claim time). */
const DRAIN_CLOCK_START = Date.UTC(2026, 8, 16, 9, 0, 0);
/** The staleness window of host/relay.ts (STALE_IN_FLIGHT_MS = 10 minutes). */
const STALE_WINDOW_MS = 10 * 60_000;
/** A canonical session id (any non-empty string passes the frozen validator). */
const SESSION_ID = "wfxpses_00000000000000000000000009";

let testDb: TestDb;
/** The runRelayDrain clock (2026 era — far from the opportunistic epoch clock). */
let clock: FixedClock;
/** The scheduleOpportunisticDrain clock (epoch-based — see the O-ledger). */
let oppClock: FixedClock;
let ids: SequentialIdGen;
let sink: PostgresEventSink;
/** The opportunistic lane's own sink (stamps next_attempt_at in oppClock time). */
let oppSink: PostgresEventSink;
let seeded: SeededRow;

beforeAll(async () => {
  testDb = await createTestDb();
  clock = new FixedClock(DRAIN_CLOCK_START);
  oppClock = new FixedClock(0);
  ids = new SequentialIdGen();
  sink = new PostgresEventSink({ db: testDb.db, clock, ids });
  oppSink = new PostgresEventSink({ db: testDb.db, clock: oppClock, ids });
  seeded = await readSeededRow(testDb.db);
});

afterAll(async () => {
  await testDb.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid frozen event on the seeded item (payload omitted = speaks no position). */
function makeEvent(
  userId: string,
  type: EntertainmentEvent["type"],
  occurredAt: string,
  payload?: Record<string, unknown>,
): EntertainmentEvent {
  const event: EntertainmentEvent = {
    userId,
    itemId: seeded.itemId,
    type,
    occurredAt,
    sessionId: SESSION_ID,
  };
  if (payload !== undefined) event.payload = payload;
  return event;
}

/** Count outbox rows by status for one user. */
async function statusCounts(userId: string): Promise<Record<string, number>> {
  const rows = await testDb.db.query<{ status: string }>(
    "SELECT status FROM event_outbox WHERE user_id = $1",
    [userId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

/** The watch_history projection row for one user on the seeded item, normalized. */
interface ProjectionRow {
  readonly positionMs: number;
  readonly completed: boolean;
  readonly lastEventType: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

async function projection(userId: string): Promise<ProjectionRow | undefined> {
  const rows = await testDb.db.query<{
    position_ms: unknown;
    completed: boolean;
    last_event_type: string | null;
    created_at: unknown;
    updated_at: unknown;
  }>(
    `SELECT position_ms, completed, last_event_type, created_at, updated_at
       FROM watch_history WHERE user_id = $1 AND item_id = $2`,
    [userId, seeded.itemId],
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    positionMs: Number(row.position_ms),
    completed: row.completed,
    lastEventType: row.last_event_type,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** Simulate the at-least-once replay: flip delivered rows back to pending. */
async function redeliver(userId: string, eventType?: string): Promise<void> {
  const nowIso = new Date(clock.now()).toISOString();
  if (eventType === undefined) {
    await testDb.db.query(
      `UPDATE event_outbox SET status = 'pending', next_attempt_at = $1
        WHERE user_id = $2 AND status = 'delivered'`,
      [nowIso, userId],
    );
    return;
  }
  await testDb.db.query(
    `UPDATE event_outbox SET status = 'pending', next_attempt_at = $1
      WHERE user_id = $2 AND status = 'delivered' AND event_type = $3`,
    [nowIso, userId, eventType],
  );
}

/** Simulate a crashed relay claim: park a user's pending row in-flight. */
async function plantInFlight(userId: string, claimedAtMs: number): Promise<void> {
  await testDb.db.query(
    `UPDATE event_outbox SET status = 'in-flight', claimed_at = $1, attempts = 1
      WHERE user_id = $2 AND status = 'pending'`,
    [new Date(claimedAtMs).toISOString(), userId],
  );
}

/** Bounded poll for fire-and-forget drain effects (harness-only wall clock). */
async function waitFor(ready: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await ready())) {
    if (Date.now() >= deadline) {
      throw new Error("waitFor: condition never became true within the timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ---------------------------------------------------------------------------
// The probe DbClient (the opportunistic lane's observability seam)
// ---------------------------------------------------------------------------

/** What the probe observes / controls. */
interface DrainProbe {
  /** Drain starts observed (requeueStaleInFlight invocations). */
  requeues: number;
  /** When set, each drain start parks on this thunk first (the latch). */
  gate?: () => Promise<void>;
}

/**
 * The requeue statement's distinctive shape — `drainEventOutbox`'s claim
 * parameterizes its status (`status = $2`) and `enqueueEvent` is an INSERT,
 * so only `requeueStaleInFlight` (the FIRST statement of every relay drain)
 * matches. One match ⇔ one drain start.
 */
const REQUEUE_SIGNATURE = "status = 'pending', next_attempt_at = $1";

function probeDb(inner: DbClient, probe: DrainProbe): DbClient {
  return {
    query: async <Row extends object = SqlRow>(
      sqlText: string,
      params?: readonly unknown[],
    ): Promise<Row[]> => {
      if (sqlText.includes(REQUEUE_SIGNATURE)) {
        probe.requeues += 1;
        if (probe.gate !== undefined) await probe.gate();
      }
      return inner.query<Row>(sqlText, params);
    },
    begin: <T>(work: (tx: SqlClient) => Promise<T>): Promise<T> => inner.begin(work),
    close: (): Promise<void> => inner.close(),
  };
}

// ---------------------------------------------------------------------------
// runRelayDrain — the relay proper
// ---------------------------------------------------------------------------

describe("runRelayDrain — the pending drain and the watch-history fold", () => {
  it("delivers due pending events and folds the projection laws", async () => {
    const user = "relay-fold-user";
    await sink.emit(makeEvent(user, "start", "2026-09-16T10:00:00.000Z", { positionMs: 1_000 }));
    await sink.emit(makeEvent(user, "progress", "2026-09-16T10:01:00.000Z")); // speaks NO position
    await sink.emit(makeEvent(user, "progress", "2026-09-16T10:02:00.000Z", { positionMs: -999 })); // negative → unspoken
    await sink.emit(makeEvent(user, "progress", "2026-09-16T10:03:00.000Z", { positionMs: "fast" })); // non-number → unspoken
    await sink.emit(makeEvent(user, "progress", "2026-09-16T10:04:00.000Z", { positionMs: 5_000 }));

    expect(await statusCounts(user)).toEqual({ pending: 5 }); // durable, awaiting the relay

    const result = await runRelayDrain(testDb.db, clock);
    expect(result.requeued).toBe(0);
    expect(result.drain).toEqual({ claimed: 5, delivered: 5, rescheduled: 0, failed: 0 });
    expect(await statusCounts(user)).toEqual({ delivered: 5 });

    // position_ms advances ONLY when spoken: 1_000 set, three unspoken
    // progress events never rewound it, the last spoken position wins.
    // last_event_type/updated_at reflect the LAST delivered event; created_at
    // keeps the FIRST insert's occurredAt.
    expect(await projection(user)).toEqual({
      positionMs: 5_000,
      completed: false,
      lastEventType: "progress",
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:04:00.000Z",
    });
  });

  it("completed is MONOTONE — a replayed complete cannot un-complete", async () => {
    const user = "relay-complete-user";
    await sink.emit(makeEvent(user, "start", "2026-09-16T10:00:00.000Z", { positionMs: 2_000 }));
    await sink.emit(makeEvent(user, "complete", "2026-09-16T10:10:00.000Z", { positionMs: 9_000 }));

    const first = await runRelayDrain(testDb.db, clock);
    expect(first.drain).toEqual({ claimed: 2, delivered: 2, rescheduled: 0, failed: 0 });
    const completed = await projection(user);
    if (completed === undefined) throw new Error("test setup: no projection row after the drain");
    expect(completed).toMatchObject({ positionMs: 9_000, completed: true, lastEventType: "complete" });

    // The at-least-once replay of the SAME complete: idempotent fold, still true.
    await redeliver(user, "complete");
    const replay = await runRelayDrain(testDb.db, clock);
    expect(replay.drain).toEqual({ claimed: 1, delivered: 1, rescheduled: 0, failed: 0 });
    expect(await projection(user)).toEqual(completed);

    // A LATER non-completing watch event (an out-of-order skip) still cannot
    // un-complete it — completed = completed OR EXCLUDED.completed.
    await sink.emit(makeEvent(user, "skip", "2026-09-16T10:20:00.000Z"));
    const after = await runRelayDrain(testDb.db, clock);
    expect(after.drain).toEqual({ claimed: 1, delivered: 1, rescheduled: 0, failed: 0 });
    expect(await projection(user)).toEqual({
      positionMs: 9_000, // the skip speaks no position — nothing rewinds
      completed: true, // MONOTONE
      lastEventType: "skip",
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-16T10:20:00.000Z",
    });
  });

  it("requeues a stale in-flight row (crashed relay) and delivers it; fresh in-flight rows are left alone", async () => {
    const staleUser = "relay-stale-user";
    const freshUser = "relay-fresh-user";
    await sink.emit(makeEvent(staleUser, "start", "2026-09-16T10:00:00.000Z", { positionMs: 7_000 }));
    await sink.emit(makeEvent(freshUser, "progress", "2026-09-16T10:00:00.000Z", { positionMs: 3_000 }));

    // 11 minutes pass; a relay claimed BOTH rows and then crashed — one
    // claim a minute PAST the staleness window (stale), one only halfway
    // into it (fresh).
    clock.advance(STALE_WINDOW_MS + 60_000);
    await plantInFlight(staleUser, clock.now() - (STALE_WINDOW_MS + 60_000));
    await plantInFlight(freshUser, clock.now() - STALE_WINDOW_MS / 2);

    const result = await runRelayDrain(testDb.db, clock);
    expect(result.requeued).toBe(1); // ONLY the stale claim is recovered
    expect(result.drain).toEqual({ claimed: 1, delivered: 1, rescheduled: 0, failed: 0 });

    // The stale row: requeued → claimed → delivered → folded.
    expect(await statusCounts(staleUser)).toEqual({ delivered: 1 });
    expect(await projection(staleUser)).toMatchObject({
      positionMs: 7_000,
      completed: false,
      lastEventType: "start",
    });

    // The fresh in-flight row is UNTOUCHED — still claimed, never delivered,
    // no projection (its own relay pass owns it until it goes stale).
    expect(await statusCounts(freshUser)).toEqual({ "in-flight": 1 });
    expect(await projection(freshUser)).toBeUndefined();
  });

  it("non-watch event types are honest no-ops — delivered, NO projection row", async () => {
    const user = "relay-noop-user";
    await sink.emit(makeEvent(user, "impression", "2026-09-16T10:00:00.000Z"));
    await sink.emit(makeEvent(user, "like", "2026-09-16T10:01:00.000Z", { positionMs: 123_456 }));
    await sink.emit(makeEvent(user, "dislike", "2026-09-16T10:02:00.000Z", { positionMs: 654_321 }));
    await sink.emit(makeEvent(user, "save", "2026-09-16T10:03:00.000Z"));
    await sink.emit(makeEvent(user, "share", "2026-09-16T10:04:00.000Z", { positionMs: 999_999 }));
    await sink.emit(makeEvent(user, "search", "2026-09-16T10:05:00.000Z"));

    const result = await runRelayDrain(testDb.db, clock);
    expect(result.requeued).toBe(0);
    expect(result.drain).toEqual({ claimed: 6, delivered: 6, rescheduled: 0, failed: 0 });
    expect(await statusCounts(user)).toEqual({ delivered: 6 }); // honestly delivered…
    expect(await projection(user)).toBeUndefined(); // …with NO projection row — even for the like/dislike/share events that speak a position
  });

  it("redelivery idempotency — draining the same events twice leaves the SAME projection state", async () => {
    const user = "relay-replay-user";
    await sink.emit(makeEvent(user, "start", "2026-09-16T10:00:00.000Z", { positionMs: 12_000 }));
    await sink.emit(makeEvent(user, "progress", "2026-09-16T10:05:00.000Z", { positionMs: 15_000 }));

    const first = await runRelayDrain(testDb.db, clock);
    expect(first.drain).toEqual({ claimed: 2, delivered: 2, rescheduled: 0, failed: 0 });
    const snapshot = await projection(user);
    if (snapshot === undefined) throw new Error("test setup: no projection row after the drain");

    // The at-least-once replay of the WHOLE batch: both rows return to pending…
    await redeliver(user);
    const second = await runRelayDrain(testDb.db, clock);
    expect(second.drain).toEqual({ claimed: 2, delivered: 2, rescheduled: 0, failed: 0 });

    // …and the projection is EXACTLY where it was: one row, same values —
    // the fold is idempotent under full-batch redelivery.
    expect(await projection(user)).toEqual(snapshot);
    expect(await statusCounts(user)).toEqual({ delivered: 2 }); // the SAME rows, no duplicates
  });
});

// ---------------------------------------------------------------------------
// scheduleOpportunisticDrain — the bounded opportunistic lane
// ---------------------------------------------------------------------------

const OPP_USER = "relay-opp-user";
const OPP_LIMIT_USER = "relay-opp-limit-user";
let probe: DrainProbe;
let oppDb: DbClient;

describe("scheduleOpportunisticDrain — the bounded opportunistic lane", () => {
  // MODULE-STATE LEDGER (host/relay.ts keeps per-instance counters; bun runs
  // these `it`s in declaration order, so the ledger is deterministic):
  //   O1 fires the COUNT-triggered drain      at oppClock = 0       (last=0)
  //   O2 fires the INTERVAL-triggered drain   at oppClock = 60_000  (last=60_000)
  //   O3 parks a GATED drain                  at oppClock = 120_000, asserts the
  //      in-flight guard at 180_000, releases, and recovers at 240_000
  //   O4 fires the bounded-claim drain        at oppClock = 300_000
  // The epoch-based oppClock starts at 0 — below the 60s interval from a
  // pristine module state — so only the trigger under test ever fires.
  //
  // Drain starts are counted by the probe (requeue-statement matches); a
  // nudge that starts nothing is observable SYNCHRONOUSLY (nothing async was
  // even begun), a started drain's effects are awaited via `waitFor`.

  /** Nudge the lane `times` times at the current oppClock instant. */
  function nudge(times: number): void {
    for (let index = 0; index < times; index += 1) scheduleOpportunisticDrain(oppDb, oppClock);
  }

  beforeAll(() => {
    probe = { requeues: 0 };
    oppDb = probeDb(testDb.db, probe);
  });

  it("fires at the 10th event (count trigger) — and really delivers", async () => {
    await oppSink.emit(makeEvent(OPP_USER, "start", "2026-09-16T11:00:00.000Z", { positionMs: 100 }));
    expect((await statusCounts(OPP_USER))["pending"]).toBe(1);

    // 9 nudges at a non-due instant (count 9 < 10, interval 0s < 60s):
    // nothing starts at all — synchronously provable.
    nudge(9);
    expect(probe.requeues).toBe(0);
    expect((await statusCounts(OPP_USER))["pending"]).toBe(1);

    // The 10th nudge crosses OPPORTUNISTIC_AFTER_EVENTS → exactly ONE drain.
    nudge(1);
    expect(probe.requeues).toBe(1);

    // The opportunistic lane runs the REAL relay drain: the event is
    // delivered and folded (fire-and-forget → bounded poll).
    await waitFor(async () => (await statusCounts(OPP_USER))["delivered"] === 1);
    expect(await projection(OPP_USER)).toMatchObject({
      positionMs: 100,
      completed: false,
      lastEventType: "start",
    });
    expect(probe.requeues).toBe(1); // 10 nudges → ONE drain, never a tight loop
  });

  it("interval-throttles to one drain per 60s window; nudges right after a drain start nothing", async () => {
    await oppSink.emit(makeEvent(OPP_USER, "progress", "2026-09-16T11:01:00.000Z", { positionMs: 200 }));
    expect((await statusCounts(OPP_USER))["pending"]).toBe(1);

    // 59.999s since the last drain + 4 nudges (count 4 < 10): NOT due either
    // way — nothing starts.
    oppClock.advance(59_999);
    nudge(4);
    expect(probe.requeues).toBe(1); // still only O1's drain
    expect((await statusCounts(OPP_USER))["pending"]).toBe(1);

    // At exactly the 60s boundary the INTERVAL trigger fires ONE drain (the
    // count stands at 5 — this is purely the interval lane).
    oppClock.advance(1);
    nudge(1);
    expect(probe.requeues).toBe(2);
    await waitFor(async () => (await statusCounts(OPP_USER))["delivered"] === 2);

    // NO TIGHT LOOP: nudges at the same instant right after a drain (count
    // reset to 0, interval not elapsed) start nothing further.
    nudge(3);
    expect(probe.requeues).toBe(2);
  });

  it("the in-flight guard — nudges during a running drain start NOTHING; the lane recovers after", async () => {
    // Arm a one-shot latch: the next drain parks at its first statement
    // (requeueStaleInFlight) until released — a relay observably in-flight.
    let release: () => void = () => {};
    const latch = new Promise<void>((resolve) => {
      release = resolve;
    });
    probe.gate = () => latch;

    await oppSink.emit(makeEvent(OPP_USER, "progress", "2026-09-16T11:02:00.000Z", { positionMs: 300 }));
    oppClock.advance(60_000); // 120_000 — interval-due
    nudge(1);
    expect(probe.requeues).toBe(3); // the drain STARTED and parked at the latch

    // While it is in flight, interval-due nudges (60s further on) must not
    // start a second drain — the in-flight guard is the only thing holding
    // them back (count 5..7, interval 60_000 ≥ 60_000).
    oppClock.advance(60_000); // 180_000
    nudge(3);
    expect(probe.requeues).toBe(3); // still exactly ONE drain

    // Release: the parked drain completes for real…
    release();
    await waitFor(async () => (await statusCounts(OPP_USER))["delivered"] === 3);

    // …and the three guarded nudges never started anything — not even late.
    expect(probe.requeues).toBe(3);

    // The guard resets: a later due nudge drains again (recovery).
    await oppSink.emit(makeEvent(OPP_USER, "progress", "2026-09-16T11:03:00.000Z", { positionMs: 400 }));
    oppClock.advance(60_000); // 240_000
    nudge(1);
    expect(probe.requeues).toBe(4);
    await waitFor(async () => (await statusCounts(OPP_USER))["delivered"] === 4);

    // The opportunistic lane's cumulative fold across all four drains.
    expect(await projection(OPP_USER)).toEqual({
      positionMs: 400,
      completed: false,
      lastEventType: "progress",
      createdAt: "2026-09-16T11:00:00.000Z",
      updatedAt: "2026-09-16T11:03:00.000Z",
    });
  });

  it("bounds each opportunistic claim at 20 rows (the cron lane carries the rest)", async () => {
    for (let index = 1; index <= 25; index += 1) {
      await oppSink.emit(
        makeEvent(OPP_LIMIT_USER, "progress", "2026-09-16T12:00:00.000Z", { positionMs: index }),
      );
    }
    expect((await statusCounts(OPP_LIMIT_USER))["pending"]).toBe(25);

    oppClock.advance(60_000); // 300_000 — interval-due
    nudge(1);
    expect(probe.requeues).toBe(5);

    // Exactly OPPORTUNISTIC_LIMIT rows are claimed and delivered (the first
    // 20 in deterministic id order → the fold ends at position 20); the rest
    // stay pending for the cron lane — at-least-once, never lost.
    await waitFor(async () => (await statusCounts(OPP_LIMIT_USER))["delivered"] === 20);
    expect(await statusCounts(OPP_LIMIT_USER)).toEqual({ delivered: 20, pending: 5 });
    expect(await projection(OPP_LIMIT_USER)).toMatchObject({
      positionMs: 20,
      lastEventType: "progress",
    });
  });
});
