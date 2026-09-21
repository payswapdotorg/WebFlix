/**
 * R25-W3 — the realtime recovery supervisor's laws (the plan's desktop
 * lane "reconnect/recovery" + J43's interruption step).
 *
 * Proven here (machine-checked):
 * - THE NEVER-RESTART LAW (structural): the supervisor holds ONLY the
 *   session handle — the composition's playback session/native port/
 *   controller are never passed in, so a recovery CANNOT restart the
 *   media item (there is nothing to restart through). The scripted
 *   session double records every operation the supervisor issues: after
 *   an interruption + recovery the ONLY operations are reconnect() calls.
 * - THE RECOVERY LOOP: a recoverable-error (or an out-of-band transport
 *   loss) enters interrupted; the bounded attempts drive the SESSION'S
 *   OWN reconnect() operation with backoff; success answers reconnected
 *   with the REAL reconnect-time delta measured through the clock.
 * - THE HONEST GIVE-UP: the attempt budget exhausted answers failed with
 *   the honest detail — translation stops, the failure is reported, and
 *   NOTHING happens to base playback (the double proves it: no other
 *   operations were issued).
 * - THE TERMINAL FALLBACK: a terminal-error answers failed immediately.
 * - THE REAL-CLOCK LAW: the reconnect time is a real delta observed by
 *   the injectable clock (null absence before any recovery — never a
 *   fabricated number).
 */

import { describe, expect, it } from "bun:test";

import { createRealtimeRecoverySupervisor } from "../src/platform/realtime-recovery";
import type {
  RealtimeTranslationEvent,
  RealtimeTranslationSession,
} from "../src/platform/realtime-translation-port";

// ---------------------------------------------------------------------------
// The deterministic world
// ---------------------------------------------------------------------------

function makeClock(startMs = 0): { readonly nowMs: () => number; readonly advanceTo: (ms: number) => void } {
  let t = startMs;
  return { nowMs: (): number => t, advanceTo: (ms: number): void => { t = ms; } };
}

/**
 * The scripted session double — records EVERY operation the supervisor
 * issues (the never-restart law's evidence) and lets the test emit
 * session events on demand.
 */
class ScriptedRecoverySession implements RealtimeTranslationSession {
  readonly id = "rt-recovery";
  readonly operations: string[] = [];
  /** The reconnect attempts' verdicts the test scripts (true = success). */
  reconnectVerdicts: boolean[] = [];
  private listeners = new Set<(event: RealtimeTranslationEvent) => void>();

  async start(): Promise<void> {
    this.operations.push("start");
  }
  async configure(): Promise<void> {
    this.operations.push("configure");
  }
  appendAudio(): void {
    this.operations.push("appendAudio");
  }
  appendImageFrame(): void {
    this.operations.push("appendImageFrame");
  }
  async stop(): Promise<void> {
    this.operations.push("stop");
  }
  async reconnect(): Promise<void> {
    this.operations.push(`reconnect#${this.reconnectCalls + 1}`);
    this.reconnectCalls += 1;
    const verdict = this.reconnectVerdicts[this.reconnectCalls - 1] ?? true;
    if (!verdict) throw new Error(`reconnect attempt ${this.reconnectCalls} was refused by the session`);
  }
  reconnectCalls = 0;
  async close(): Promise<void> {
    this.operations.push("close");
  }
  subscribe(listener: (event: RealtimeTranslationEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** The test emits a session event. */
  emit(event: RealtimeTranslationEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function supervisorWorld(input?: {
  readonly maxAttempts?: number;
  readonly verdicts?: boolean[];
}): {
  session: ScriptedRecoverySession;
  supervisor: ReturnType<typeof createRealtimeRecoverySupervisor>;
  clock: ReturnType<typeof makeClock>;
  scheduled: { callback: () => void; ms: number }[];
} {
  const session = new ScriptedRecoverySession();
  session.reconnectVerdicts = input?.verdicts ?? [];
  const clock = makeClock(1_000);
  const scheduled: { callback: () => void; ms: number }[] = [];
  const supervisor = createRealtimeRecoverySupervisor({
    session,
    nowMs: clock.nowMs,
    maxAttempts: input?.maxAttempts,
    backoffMs: [250, 500, 1_000],
    schedule: (callback, ms) => {
      scheduled.push({ callback, ms });
    },
  });
  return { session, supervisor, clock, scheduled };
}

describe("R25-W3 — the realtime recovery supervisor", () => {
  it("starts active and records the supervision transition", () => {
    const world = supervisorWorld();
    world.supervisor.start();
    expect(world.supervisor.state()).toBe("active");
    expect(world.supervisor.report().transitions.length).toBe(1);
    expect(world.supervisor.report().transitions[0]!.to).toBe("active");
  });

  it("THE RECOVERY LOOP — a recoverable error interrupts; the session's OWN reconnect recovers with the REAL time delta", async () => {
    const world = supervisorWorld({ verdicts: [true] });
    world.supervisor.start();

    // The interruption arrives (the session's recoverable-error event).
    world.session.emit({
      kind: "recoverable-error",
      detail: "the network connection to the realtime provider dropped",
      requiresReconnect: true,
    });
    expect(world.supervisor.state()).toBe("interrupted");
    expect(world.supervisor.report().interruptions).toBe(1);
    expect(world.supervisor.report().lastReconnectMs).toBeNull(); // honest absence DURING the interruption

    // The real clock advances while the backoff waits (250ms for attempt 1).
    world.clock.advanceTo(1_600);
    await world.supervisor.pumpPendingAttempt();

    expect(world.supervisor.state()).toBe("reconnected");
    const report = world.supervisor.report();
    expect(report.recoveries).toBe(1);
    expect(report.reconnectAttempts).toBe(1);
    expect(report.lastReconnectMs).toBe(600); // 1_600 − 1_000: the REAL delta
    expect(world.session.reconnectCalls).toBe(1);

    // THE NEVER-RESTART LAW: the ONLY operations the supervisor issued are
    // reconnect calls — no stop, no close, no start, nothing else.
    expect(world.session.operations.filter((op) => op.startsWith("reconnect#")).length).toBe(1);
    expect(world.session.operations.every((op) => op.startsWith("reconnect#"))).toBe(true);
  });

  it("THE BACKOFF — the attempts wait the schedule (250 → 500 → 1000), one at a time", async () => {
    const world = supervisorWorld({ verdicts: [false, false, true] });
    world.supervisor.start();
    world.session.emit({
      kind: "recoverable-error",
      detail: "drop",
      requiresReconnect: true,
    });

    expect(world.scheduled.length).toBe(1);
    expect(world.scheduled[0]!.ms).toBe(250);

    // Attempt 1 fails.
    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("interrupted");
    expect(world.scheduled.length).toBe(2);
    expect(world.scheduled[1]!.ms).toBe(500);

    // Attempt 2 fails.
    await world.supervisor.pumpPendingAttempt();
    expect(world.scheduled.length).toBe(3);
    expect(world.scheduled[2]!.ms).toBe(1_000);

    // Attempt 3 recovers.
    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("reconnected");
    expect(world.session.reconnectCalls).toBe(3);
    expect(world.supervisor.report().reconnectAttempts).toBe(3);
  });

  it("THE HONEST GIVE-UP — the attempt budget exhausted answers failed (translation stops; NOTHING else happens)", async () => {
    const world = supervisorWorld({ maxAttempts: 2, verdicts: [false, false] });
    world.supervisor.start();
    world.session.emit({
      kind: "recoverable-error",
      detail: "drop",
      requiresReconnect: true,
    });

    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("interrupted");
    await world.supervisor.pumpPendingAttempt();
    // The budget (2) is exhausted: the honest FAILED verdict.
    expect(world.supervisor.state()).toBe("failed");
    const report = world.supervisor.report();
    expect(report.terminalFailures).toBe(1);
    expect(report.reconnectAttempts).toBe(2);
    expect(report.lastReconnectMs).toBeNull(); // never recovered — the honest absence

    // The failure detail names the law (base playback continues).
    const failedTransition = report.transitions.find((t) => t.to === "failed");
    expect(failedTransition?.detail).toContain("base playback continues");

    // THE NEVER-RESTART LAW again: only reconnect attempts were issued.
    expect(world.session.operations.every((op) => op.startsWith("reconnect#"))).toBe(true);
    expect(world.session.operations.length).toBe(2);
  });

  it("THE TERMINAL FALLBACK — a terminal error answers failed immediately (no retry loop)", () => {
    const world = supervisorWorld();
    world.supervisor.start();
    world.session.emit({
      kind: "terminal-error",
      detail: "the realtime provider refused the session permanently",
    });
    expect(world.supervisor.state()).toBe("failed");
    const report = world.supervisor.report();
    expect(report.terminalFailures).toBe(1);
    expect(report.reconnectAttempts).toBe(0);
    // No operations at all — the composition owns stopping the feed.
    expect(world.session.operations.length).toBe(0);
  });

  it("the out-of-band transport-loss signal rides the same law (interrupted → reconnect → recovered)", async () => {
    const world = supervisorWorld({ verdicts: [true] });
    world.supervisor.start();
    world.supervisor.notifyTransportLost("the realtime bridge detected the socket drop");
    expect(world.supervisor.state()).toBe("interrupted");
    world.clock.advanceTo(2_000);
    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("reconnected");
    expect(world.supervisor.report().lastReconnectMs).toBe(1_000);
  });

  it("a second interruption after a recovery rides the same loop with fresh accounting", async () => {
    const world = supervisorWorld({ verdicts: [true, true] });
    world.supervisor.start();
    // First interruption + recovery.
    world.session.emit({ kind: "recoverable-error", detail: "drop 1", requiresReconnect: true });
    world.clock.advanceTo(1_400);
    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("reconnected");

    // Second interruption (a NEW interruption, not a double-count).
    world.session.emit({ kind: "recoverable-error", detail: "drop 2", requiresReconnect: true });
    expect(world.supervisor.report().interruptions).toBe(2);
    world.clock.advanceTo(2_900);
    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("reconnected");
    const report = world.supervisor.report();
    expect(report.recoveries).toBe(2);
    expect(report.reconnectAttempts).toBe(1); // fresh per-interruption accounting
    expect(report.lastReconnectMs).toBe(1_500); // 2_900 − 1_400: the REAL second delta
  });

  it("a recoverable-error WITHOUT requiresReconnect while already interrupted does not double-count", async () => {
    const world = supervisorWorld({ verdicts: [true] });
    world.supervisor.start();
    world.session.emit({ kind: "recoverable-error", detail: "drop", requiresReconnect: true });
    world.session.emit({ kind: "recoverable-error", detail: "still down", requiresReconnect: false });
    expect(world.supervisor.report().interruptions).toBe(1);
    await world.supervisor.pumpPendingAttempt();
    expect(world.supervisor.state()).toBe("reconnected");
  });

  it("the transitions carry the honest detail + the append-only record", async () => {
    const world = supervisorWorld({ verdicts: [true] });
    world.supervisor.start();
    world.session.emit({ kind: "recoverable-error", detail: "the drop detail", requiresReconnect: true });
    await world.supervisor.pumpPendingAttempt();
    const transitions = world.supervisor.report().transitions;
    expect(transitions.map((t) => t.to)).toEqual(["active", "interrupted", "reconnected"]);
    expect(transitions[1]!.detail).toBe("the drop detail");
    expect(transitions[2]!.detail).toContain("recovered the session");
    // stop unsubscribes (idempotent) — the record stays.
    world.supervisor.stop();
    world.supervisor.stop();
    expect(world.supervisor.report().transitions.length).toBe(3);
  });
});
