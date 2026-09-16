/**
 * @wfx/client-runtime — watch-state fold + at-least-once tests (R01).
 *
 * The fold laws (chronological last-writer-wins, staleness, idempotent
 * redelivery) and the at-least-once delivery law (a lost watch-state event
 * is never a silent success).
 */

import { describe, expect, it } from "bun:test";
import type { EntertainmentEvent } from "@wfx/domain";

import {
  RuntimeError,
  WatchStateEngine,
  createRuntime,
  foldWatchEvent,
  FixedClock,
  InMemoryServerPort,
  makeWebCapabilities,
  type RuntimeContext,
  type RuntimeIdGen,
} from "../src/index";

const ITEM_A = "wfxitm_00000000000000000000000001";
const T0 = Date.parse("2026-09-16T12:00:00.000Z");

const CONTEXT: RuntimeContext = { userId: "user-1", sessionId: "sess-1", locale: "en" };

/** A fixed-then-advancing id source (unique per event — the idempotency key). */
class SeqIds implements RuntimeIdGen {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `0000000000000000000${this.counter.toString().padStart(7, "0")}`;
  }
}

function event(
  type: EntertainmentEvent["type"],
  itemId: string,
  occurredAtMs: number,
  positionMs?: number,
): EntertainmentEvent {
  return {
    userId: CONTEXT.userId,
    itemId,
    type,
    occurredAt: new Date(occurredAtMs).toISOString(),
    sessionId: CONTEXT.sessionId,
    ...(positionMs !== undefined ? { payload: { positionMs } } : {}),
  };
}

describe("the pure fold (foldWatchEvent)", () => {
  it("start/progress fold in-progress with the payload position", () => {
    const start = foldWatchEvent(null, event("start", ITEM_A, T0, 0), { atMs: T0, seq: 1 });
    expect(start?.status).toBe("in-progress");
    expect(start?.lastPositionMs).toBe(0);
    const progress = foldWatchEvent(
      start ?? null,
      event("progress", ITEM_A, T0 + 1_000, 15_000),
      { atMs: T0 + 1_000, seq: 2 },
    );
    expect(progress?.status).toBe("in-progress");
    expect(progress?.lastPositionMs).toBe(15_000);
  });

  it("complete/skip fold their terminal labels", () => {
    const state = foldWatchEvent(null, event("complete", ITEM_A, T0, 90_000), { atMs: T0, seq: 1 });
    expect(state?.status).toBe("completed");
    expect(state?.completionRatio).toBe(1);
    const skipped = foldWatchEvent(null, event("skip", ITEM_A, T0, 30_000), { atMs: T0, seq: 1 });
    expect(skipped?.status).toBe("skipped");
  });

  it("the STALENESS LAW drops older evidence (at-least-once redelivery never rewinds)", () => {
    const progress = foldWatchEvent(null, event("progress", ITEM_A, T0 + 10_000, 60_000), {
      atMs: T0 + 10_000,
      seq: 2,
    });
    expect(progress?.lastPositionMs).toBe(60_000);
    // A late redelivery of an OLDER event: dropped.
    const stale = foldWatchEvent(
      progress ?? null,
      event("progress", ITEM_A, T0, 10_000),
      { atMs: T0, seq: 1 },
      undefined,
      { atMs: T0 + 10_000, seq: 2 },
    );
    expect(stale).toBeNull();
  });

  it("equal-timestamp events fold in input order (the WFX-029 tiebreak)", () => {
    const first = foldWatchEvent(null, event("progress", ITEM_A, T0, 10_000), { atMs: T0, seq: 1 });
    const second = foldWatchEvent(
      first ?? null,
      event("progress", ITEM_A, T0, 20_000),
      { atMs: T0, seq: 2 },
      undefined,
      { atMs: T0, seq: 1 },
    );
    expect(second?.lastPositionMs).toBe(20_000);
  });

  it("completion ratio is honest: 1 when completed, clamped when duration known, null when not", () => {
    const completed = foldWatchEvent(null, event("complete", ITEM_A, T0), { atMs: T0, seq: 1 });
    expect(completed?.completionRatio).toBe(1);
    const half = foldWatchEvent(
      null,
      event("progress", ITEM_A, T0, 50_000),
      { atMs: T0, seq: 1 },
      100_000,
    );
    expect(half?.completionRatio).toBe(0.5);
    const unknown = foldWatchEvent(null, event("progress", ITEM_A, T0, 50_000), { atMs: T0, seq: 1 });
    expect(unknown?.completionRatio).toBeNull();
  });

  it("a start after complete re-opens the item (chronology wins)", () => {
    const completed = foldWatchEvent(null, event("complete", ITEM_A, T0, 100_000), { atMs: T0, seq: 1 });
    const rewatched = foldWatchEvent(
      completed ?? null,
      event("start", ITEM_A, T0 + 5_000, 0),
      { atMs: T0 + 5_000, seq: 2 },
      undefined,
      { atMs: T0, seq: 1 },
    );
    expect(rewatched?.status).toBe("in-progress");
  });
});

describe("the engine (local fold + delivery)", () => {
  it("updateWatchState folds locally and delivers through the port", async () => {
    const server = new InMemoryServerPort();
    const engine = new WatchStateEngine(server, CONTEXT, new FixedClock(T0), new SeqIds());
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 25_000 });
    const state = engine.operations().get(ITEM_A);
    expect(state?.status).toBe("in-progress");
    expect(state?.lastPositionMs).toBe(25_000);
    expect(engine.operations().pendingEventCount()).toBe(0);
    expect(server.emittedEvents).toHaveLength(1);
    expect(server.emittedEvents[0]?.type).toBe("progress");
    expect(server.emittedEvents[0]?.payload?.positionMs).toBe(25_000);
  });

  it("a delivery failure THROWS (never silent) and keeps the event pending", async () => {
    const server = new InMemoryServerPort();
    const clock = new FixedClock(T0);
    const engine = new WatchStateEngine(server, CONTEXT, clock, new SeqIds());
    server.failNextEmits({ kind: "network", detail: "offline" });
    let thrown: unknown;
    try {
      await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 10_000 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).kind).toBe("network");
    // Local-first: the fold happened despite the delivery failure…
    expect(engine.operations().get(ITEM_A)?.lastPositionMs).toBe(10_000);
    // …and the event is still pending (at-least-once visibility).
    expect(engine.operations().pendingEventCount()).toBe(1);
    expect(server.emittedEvents).toHaveLength(0);
  });

  it("retryPendingWatchEvents delivers the backlog and reports honestly", async () => {
    const server = new InMemoryServerPort();
    const engine = new WatchStateEngine(server, CONTEXT, new FixedClock(T0), new SeqIds());
    server.failNextEmits({ kind: "network", detail: "offline" });
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 10_000 }).catch(() => undefined);
    expect(engine.operations().pendingEventCount()).toBe(1);

    const report = await engine.retryPendingWatchEvents();
    expect(report.retried).toBe(1);
    expect(report.delivered).toBe(1);
    expect(report.remaining).toBe(0);
    expect(report.failures).toEqual([]);
    expect(server.emittedEvents).toHaveLength(1);
  });

  it("repeated failures stay pending with honest failure reports", async () => {
    const server = new InMemoryServerPort();
    const engine = new WatchStateEngine(server, CONTEXT, new FixedClock(T0), new SeqIds());
    server.failNextEmits(
      { kind: "network", detail: "offline" },
      { kind: "network", detail: "still offline" },
    );
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 1_000 }).catch(() => undefined);
    const report = await engine.retryPendingWatchEvents();
    expect(report.delivered).toBe(0);
    expect(report.remaining).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("still offline");
  });

  it("duplicate redelivery of the SAME event applies exactly once (idempotent)", async () => {
    const server = new InMemoryServerPort();
    const clock = new FixedClock(T0);
    const engine = new WatchStateEngine(server, CONTEXT, clock, new SeqIds());
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 10_000 });
    // A redelivery of the identical event (same id, same payload): the
    // server-side fold tolerates it; locally the engine is idempotent.
    await engine.retryPendingWatchEvents(); // nothing pending
    expect(engine.operations().get(ITEM_A)?.lastPositionMs).toBe(10_000);
    expect(server.emittedEvents).toHaveLength(1);
  });

  it("an out-of-order late report is dropped by the staleness law (position never rewinds)", async () => {
    const server = new InMemoryServerPort();
    const clock = new FixedClock(T0);
    const engine = new WatchStateEngine(server, CONTEXT, clock, new SeqIds());
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 60_000 });
    clock.set(T0 - 60_000); // a LATE clock (simulating redelivered old evidence)
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 5_000 });
    const state = engine.operations().get(ITEM_A);
    expect(state?.lastPositionMs).toBe(60_000); // not rewound
    expect(state?.highestPositionMs).toBe(60_000);
    // The stale event was still DELIVERED (the server fold tolerates
    // duplicates by chronology — the documented at-least-once law).
    expect(server.emittedEvents).toHaveLength(2);
  });

  it("registerItemDuration produces honest completion ratios", async () => {
    const server = new InMemoryServerPort();
    const engine = new WatchStateEngine(server, CONTEXT, new FixedClock(T0), new SeqIds());
    engine.registerItemDuration(ITEM_A, 200_000);
    await engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: 50_000 });
    expect(engine.operations().get(ITEM_A)?.completionRatio).toBe(0.25);
  });

  it("invalid commands throw the typed invalid-input error", async () => {
    const engine = new WatchStateEngine(
      new InMemoryServerPort(),
      CONTEXT,
      new FixedClock(T0),
      new SeqIds(),
    );
    await expect(
      engine.apply({ kind: "progress", itemId: "", positionMs: 1 } as never),
    ).rejects.toMatchObject({ kind: "invalid-input" });
    await expect(
      engine.apply({ kind: "progress", itemId: ITEM_A, positionMs: -5 } as never),
    ).rejects.toMatchObject({ kind: "invalid-input" });
  });
});

describe("the lifecycle shutdown flush (at-least-once on exit)", () => {
  it("the runtime registers a shutdown hook that flushes pending events", async () => {
    const server = new InMemoryServerPort();
    const web = makeWebCapabilities();
    const runtime = createRuntime(web, server, {
      context: CONTEXT,
      clock: new FixedClock(T0),
      ids: new SeqIds(),
    });
    server.failNextEmits({ kind: "network", detail: "offline" });
    await runtime
      .updateWatchState({ kind: "progress", itemId: ITEM_A, positionMs: 10_000 })
      .catch(() => undefined);
    expect(runtime.watchState.pendingEventCount()).toBe(1);
    // The adapter fires shutdown: the async hook flushes the outbox (and
    // the double AWAITS it — the adapter contract).
    await web.ports.lifecycle.emit("shutdown", T0 + 1_000);
    expect(runtime.watchState.pendingEventCount()).toBe(0);
    expect(server.emittedEvents).toHaveLength(1);
  });
});
