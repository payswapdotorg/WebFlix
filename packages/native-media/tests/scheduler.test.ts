import { describe, expect, it } from "bun:test";

import {
  DEFAULT_NETWORK_ESTIMATE_MS,
  DEFAULT_SCHEDULER_CONFIG,
  NOMINAL_PIECE_BYTES,
  planPriorities,
  priorityForState,
  resolveSchedulerConfig,
  SESSION_PRIORITY_WEIGHTS,
  pieceDurationMs,
  shouldStallProtect,
  stubEngine,
  validatePlaybackDemand,
  createScheduler,
  isConsumingDemand,
  NativeMediaError,
  SESSION_STATES,
  type NativeMediaErrorCode,
  type PlaybackDemand,
  type SchedulerBatchEntry,
  type SchedulerBatchReceipt,
  type SchedulerConfig,
  type SchedulerFailure,
  type SchedulerStats,
  type ServiceResponse,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/**
 * The canonical test config: 20s horizon, 1s safety margin, batch cap 8,
 * background share 0.25. At 512 kbps one nominal piece is exactly 4000ms,
 * so all golden arithmetic below is integral and exact.
 */
const CONFIG: SchedulerConfig = {
  horizonMs: 20_000,
  safetyMarginMs: 1_000,
  maxDeadlineBatch: 8,
  backgroundRateFactor: 0.25,
};

const NOW = 100_000;

/** Build a well-formed foreground demand with per-test overrides. */
function demand(overrides: Partial<PlaybackDemand> = {}): PlaybackDemand {
  return {
    sessionId: "sess-a",
    state: "playing",
    positionMs: 60_000,
    playbackRate: 1,
    bitrateBps: 524_288,
    bufferAheadMs: 0,
    stallBudgetMs: 3_000,
    ...overrides,
  };
}

/** Build a well-formed scheduler stats snapshot with overrides. */
function stats(overrides: Partial<SchedulerStats> = {}): SchedulerStats {
  return {
    ticks: 1,
    lastTickAt: NOW,
    piecesScheduled: 0,
    latePieces: 0,
    perSessionPlanSizes: new Map<string, number>(),
    lastErrors: [],
    errorCount: 0,
    ...overrides,
  };
}

/** Assert a factory/pure call throws a NativeMediaError with the code. */
function expectInvalidInput(fn: () => unknown): NativeMediaError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NativeMediaError);
    const error = e as NativeMediaError;
    expect(error.code).toBe("INVALID_INPUT");
    return error;
  }
  throw new Error("expected the call to throw");
}

/** Assert a session tick result carries a typed envelope error; return it. */
function expectEnvelopeError(
  result: ServiceResponse<SchedulerBatchReceipt>,
): NativeMediaError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error).toBeInstanceOf(NativeMediaError);
  return result.error;
}

/** Assert a promise rejects with a NativeMediaError with the code. */
async function expectRejects(
  promise: Promise<unknown>,
  code: NativeMediaErrorCode,
): Promise<NativeMediaError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(NativeMediaError);
    const error = e as NativeMediaError;
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error("expected the promise to reject");
}

/** Collect the prioritize batches the stub engine received, in order. */
function prioritizeBatches(engine: ReturnType<typeof stubEngine>): SchedulerBatchEntry[][] {
  return engine.calls
    .filter((call) => call.method === "prioritize")
    .map((call) => call.args[1] as SchedulerBatchEntry[]);
}

// ---------------------------------------------------------------------------
// model — config defaults + validation
// ---------------------------------------------------------------------------

describe("scheduler model — config defaults + validation", () => {
  it("DEFAULT_SCHEDULER_CONFIG carries the documented validated defaults", () => {
    expect(DEFAULT_SCHEDULER_CONFIG).toEqual({
      horizonMs: 30_000,
      safetyMarginMs: 2_000,
      maxDeadlineBatch: 32,
      backgroundRateFactor: 0.25,
    });
  });

  it("resolveSchedulerConfig() with no input returns the defaults", () => {
    expect(resolveSchedulerConfig()).toEqual(DEFAULT_SCHEDULER_CONFIG);
    expect(resolveSchedulerConfig({})).toEqual(DEFAULT_SCHEDULER_CONFIG);
  });

  it("resolveSchedulerConfig applies partial overrides over the defaults", () => {
    expect(resolveSchedulerConfig({ horizonMs: 5_000 })).toEqual({
      ...DEFAULT_SCHEDULER_CONFIG,
      horizonMs: 5_000,
    });
    expect(
      resolveSchedulerConfig({ safetyMarginMs: 0, backgroundRateFactor: 0.5 }),
    ).toEqual({
      ...DEFAULT_SCHEDULER_CONFIG,
      safetyMarginMs: 0,
      backgroundRateFactor: 0.5,
    });
  });

  it("resolveSchedulerConfig rejects malformed values with typed INVALID_INPUT", () => {
    for (const bad of [
      { horizonMs: 0 },
      { horizonMs: -1 },
      { horizonMs: Number.NaN },
      { horizonMs: Number.POSITIVE_INFINITY },
      { safetyMarginMs: -1 },
      { safetyMarginMs: Number.NaN },
      { maxDeadlineBatch: 0 },
      { maxDeadlineBatch: -3 },
      { maxDeadlineBatch: 2.5 },
      { backgroundRateFactor: 0 },
      { backgroundRateFactor: -0.5 },
      { backgroundRateFactor: 1.5 },
      { backgroundRateFactor: Number.NaN },
    ]) {
      expectInvalidInput(() => resolveSchedulerConfig(bad));
    }
    expectInvalidInput(() => resolveSchedulerConfig("nope" as never));
    expectInvalidInput(() => resolveSchedulerConfig(null as never));
    expectInvalidInput(() => resolveSchedulerConfig([] as never));
  });

  it("backgroundRateFactor of exactly 1 is accepted (tiering disabled)", () => {
    expect(resolveSchedulerConfig({ backgroundRateFactor: 1 }).backgroundRateFactor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// model — session priority (deterministic weight per FSM state)
// ---------------------------------------------------------------------------

describe("scheduler model — session priority", () => {
  it("every FSM state has a deterministic weight (table covers SESSION_STATES)", () => {
    expect(Object.keys(SESSION_PRIORITY_WEIGHTS).sort()).toEqual(
      [...SESSION_STATES].sort(),
    );
    for (const state of SESSION_STATES) {
      const weight = SESSION_PRIORITY_WEIGHTS[state];
      expect(typeof weight).toBe("number");
      expect(Number.isFinite(weight)).toBe(true);
    }
  });

  it("playing is foreground, background is background, the rest are idle", () => {
    expect(priorityForState("playing")).toEqual({ tier: "foreground", weight: 100 });
    expect(priorityForState("background")).toEqual({ tier: "background", weight: 10 });
    for (const state of ["resolving", "buffering", "complete", "failed"] as const) {
      expect(priorityForState(state)).toEqual({ tier: "idle", weight: 0 });
    }
  });

  it("foreground outweighs background outweighs idle", () => {
    const fg = priorityForState("playing").weight;
    const bg = priorityForState("background").weight;
    const idle = priorityForState("complete").weight;
    expect(fg).toBeGreaterThan(bg);
    expect(bg).toBeGreaterThan(idle);
  });
});

// ---------------------------------------------------------------------------
// model — piece geometry + demand validation
// ---------------------------------------------------------------------------

describe("scheduler model — piece geometry + demand validation", () => {
  it("pieceDurationMs derives the piece timeline from bitrate", () => {
    expect(NOMINAL_PIECE_BYTES).toBe(262_144);
    expect(pieceDurationMs(524_288)).toBe(4_000);
    expect(pieceDurationMs(1_048_576)).toBe(2_000);
    expect(pieceDurationMs(131_072)).toBe(16_000);
  });

  it("pieceDurationMs rejects non-positive or non-finite bitrates", () => {
    expectInvalidInput(() => pieceDurationMs(0));
    expectInvalidInput(() => pieceDurationMs(-100));
    expectInvalidInput(() => pieceDurationMs(Number.NaN));
  });

  it("validatePlaybackDemand returns a well-formed copy of a valid demand", () => {
    const d = demand();
    const copy = validatePlaybackDemand(d);
    expect(copy).toEqual(d);
    expect(copy).not.toBe(d);
  });

  it("validatePlaybackDemand rejects malformed demands with typed INVALID_INPUT", () => {
    expectInvalidInput(() => validatePlaybackDemand(null));
    expectInvalidInput(() => validatePlaybackDemand("x"));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), sessionId: "" }));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), state: "paused" }));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), positionMs: -1 }));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), playbackRate: -1 }));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), bitrateBps: 0 }));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), bufferAheadMs: -5 }));
    expectInvalidInput(() => validatePlaybackDemand({ ...demand(), stallBudgetMs: -1 }));
    expectInvalidInput(() =>
      validatePlaybackDemand({ ...demand(), playbackRate: Number.NaN }),
    );
  });

  it("playbackRate 0 is VALID input (paused — the FSM has no paused state)", () => {
    expect(validatePlaybackDemand(demand({ playbackRate: 0 })).playbackRate).toBe(0);
  });

  it("isConsumingDemand: only playing/background at a positive rate consume", () => {
    expect(isConsumingDemand(demand())).toBe(true);
    expect(isConsumingDemand(demand({ state: "background" }))).toBe(true);
    expect(isConsumingDemand(demand({ playbackRate: 0.5 }))).toBe(true);
    expect(isConsumingDemand(demand({ playbackRate: 0 }))).toBe(false);
    expect(isConsumingDemand(demand({ state: "buffering" }))).toBe(false);
    expect(isConsumingDemand(demand({ state: "resolving" }))).toBe(false);
    expect(isConsumingDemand(demand({ state: "complete" }))).toBe(false);
    expect(isConsumingDemand(demand({ state: "failed" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// plan — golden outputs
// ---------------------------------------------------------------------------

describe("planPriorities — golden outputs", () => {
  it("foreground golden: empty buffer, rate 1, exact deadline list", () => {
    const plan = planPriorities(demand({ sessionId: "sess-fg" }), CONFIG, NOW, 400);
    expect(plan).toEqual([
      { piece: 0, deadlineMs: 100_000, late: true, immediate: true },
      { piece: 1, deadlineMs: 102_600, late: false, immediate: false },
      { piece: 2, deadlineMs: 106_600, late: false, immediate: false },
      { piece: 3, deadlineMs: 110_600, late: false, immediate: false },
      { piece: 4, deadlineMs: 114_600, late: false, immediate: false },
      { piece: 5, deadlineMs: 118_600, late: false, immediate: false },
    ]);
  });

  it("background golden: shorter horizon, diluted (later) deadlines", () => {
    const plan = planPriorities(
      demand({ sessionId: "sess-bg", state: "background" }),
      CONFIG,
      NOW,
      400,
    );
    expect(plan).toEqual([
      { piece: 0, deadlineMs: 100_000, late: true, immediate: true },
      { piece: 1, deadlineMs: 114_600, late: false, immediate: false },
    ]);
  });

  it("golden with buffered runway and 2x playback rate skips buffered pieces", () => {
    const plan = planPriorities(
      demand({ sessionId: "sess-2x", bufferAheadMs: 9_000, playbackRate: 2 }),
      CONFIG,
      NOW,
      400,
    );
    expect(plan).toEqual([
      { piece: 3, deadlineMs: 104_600, late: false, immediate: false },
      { piece: 4, deadlineMs: 106_600, late: false, immediate: false },
      { piece: 5, deadlineMs: 108_600, late: false, immediate: false },
      { piece: 6, deadlineMs: 110_600, late: false, immediate: false },
      { piece: 7, deadlineMs: 112_600, late: false, immediate: false },
      { piece: 8, deadlineMs: 114_600, late: false, immediate: false },
      { piece: 9, deadlineMs: 116_600, late: false, immediate: false },
      { piece: 10, deadlineMs: 118_600, late: false, immediate: false },
    ]);
  });

  it("uses the fixed DEFAULT_NETWORK_ESTIMATE_MS constant when no estimate is injected", () => {
    expect(DEFAULT_NETWORK_ESTIMATE_MS).toBe(500);
    // margin = 1000 safety + 500 default estimate = 1500
    const plan = planPriorities(demand(), CONFIG, NOW);
    expect(plan[1]).toEqual({
      piece: 1,
      deadlineMs: 102_500,
      late: false,
      immediate: false,
    });
  });
});

// ---------------------------------------------------------------------------
// plan — foreground vs background fairness
// ---------------------------------------------------------------------------

describe("planPriorities — foreground vs background fairness", () => {
  it("background never preempts foreground: later deadline for the same consumption point", () => {
    const base = demand({ bufferAheadMs: 4_000 });
    const foreground = planPriorities(base, CONFIG, NOW, 400);
    const background = planPriorities(
      { ...base, state: "background" },
      CONFIG,
      NOW,
      400,
    );

    // Background plans strictly fewer pieces (horizon x factor).
    expect(background.length).toBe(1);
    expect(foreground.map((entry) => entry.piece)).toEqual([1, 2, 3, 4, 5]);

    const fgByPiece = new Map(foreground.map((entry) => [entry.piece, entry]));
    for (const entry of background) {
      const fg = fgByPiece.get(entry.piece);
      expect(fg).toBeDefined();
      if (fg !== undefined) {
        // Strictly later than the foreground-equivalent deadline (except
        // clamped-to-now ties, which cannot occur with this buffer).
        expect(entry.deadlineMs).toBeGreaterThan(fg.deadlineMs);
      }
    }
    expect(background[0]?.deadlineMs).toBe(114_600);
    expect(fgByPiece.get(1)?.deadlineMs).toBe(102_600);
  });

  it("background deadlines still respect the full horizon (never beyond it)", () => {
    const plan = planPriorities(
      demand({ state: "background" }),
      CONFIG,
      NOW,
      400,
    );
    for (const entry of plan) {
      expect(entry.deadlineMs).toBeLessThanOrEqual(NOW + CONFIG.horizonMs);
    }
  });
});

// ---------------------------------------------------------------------------
// plan — edges: immediate piece, late clamping, batch cap, horizon law
// ---------------------------------------------------------------------------

describe("planPriorities — immediate piece, late clamping, batch cap, horizon law", () => {
  it("expired deadlines clamp to now with a late marker; the immediate piece is first", () => {
    // margin = 5000 safety + 4000 estimate = 9000: pieces 0-2 are late.
    const lateConfig: SchedulerConfig = {
      ...CONFIG,
      safetyMarginMs: 5_000,
    };
    const plan = planPriorities(demand(), lateConfig, NOW, 4_000);
    expect(plan).toEqual([
      { piece: 0, deadlineMs: 100_000, late: true, immediate: true },
      { piece: 1, deadlineMs: 100_000, late: true, immediate: false },
      { piece: 2, deadlineMs: 100_000, late: true, immediate: false },
      { piece: 3, deadlineMs: 103_000, late: false, immediate: false },
      { piece: 4, deadlineMs: 107_000, late: false, immediate: false },
      { piece: 5, deadlineMs: 111_000, late: false, immediate: false },
    ]);
    // The immediate piece carries a HARD deadline at exactly now.
    expect(plan[0]?.deadlineMs).toBe(NOW);
  });

  it("a raw deadline exactly at now is immediate but NOT late", () => {
    // margin = 1000 + 3000 = 4000 = the first needed piece's offset.
    const plan = planPriorities(demand({ bufferAheadMs: 4_000 }), CONFIG, NOW, 3_000);
    expect(plan[0]).toEqual({
      piece: 1,
      deadlineMs: 100_000,
      late: false,
      immediate: true,
    });
    expect(plan[1]).toEqual({
      piece: 2,
      deadlineMs: 104_000,
      late: false,
      immediate: false,
    });
  });

  it("the batch cap truncates AFTER sorting — the immediate piece survives", () => {
    const capped: SchedulerConfig = { ...CONFIG, maxDeadlineBatch: 3 };
    const plan = planPriorities(demand(), capped, NOW, 400);
    expect(plan).toEqual([
      { piece: 0, deadlineMs: 100_000, late: true, immediate: true },
      { piece: 1, deadlineMs: 102_600, late: false, immediate: false },
      { piece: 2, deadlineMs: 106_600, late: false, immediate: false },
    ]);
  });

  it("the horizon boundary piece is included; beyond it is excluded; deadlines never exceed now+horizon", () => {
    // horizon 19999: lastK = floor(19999/4000) = 4 — piece 5 excluded.
    const tight: SchedulerConfig = { ...CONFIG, horizonMs: 19_999 };
    const plan = planPriorities(demand(), tight, NOW, 400);
    expect(plan.map((entry) => entry.piece)).toEqual([0, 1, 2, 3, 4]);
    for (const entry of plan) {
      expect(entry.deadlineMs).toBeLessThanOrEqual(NOW + tight.horizonMs);
    }
  });

  it("a buffer already beyond the horizon yields an empty plan", () => {
    const plan = planPriorities(
      demand({ bufferAheadMs: 25_000 }),
      CONFIG,
      NOW,
      400,
    );
    expect(plan).toEqual([]);
  });

  it("non-playing states yield empty plans", () => {
    for (const state of ["resolving", "buffering", "complete", "failed"] as const) {
      expect(planPriorities(demand({ state }), CONFIG, NOW, 400)).toEqual([]);
    }
  });

  it("a paused session (playbackRate 0, FSM state playing) yields an empty plan", () => {
    expect(planPriorities(demand({ playbackRate: 0 }), CONFIG, NOW, 400)).toEqual([]);
  });

  it("rejects malformed demand/config/now/estimate with typed INVALID_INPUT", () => {
    expectInvalidInput(() => planPriorities({ ...demand(), bitrateBps: 0 }, CONFIG, NOW));
    expectInvalidInput(() => planPriorities(demand(), { ...CONFIG, horizonMs: -1 }, NOW));
    expectInvalidInput(() => planPriorities(demand(), CONFIG, -1));
    expectInvalidInput(() => planPriorities(demand(), CONFIG, Number.NaN));
    expectInvalidInput(() => planPriorities(demand(), CONFIG, NOW, -100));
    expectInvalidInput(() => planPriorities(demand(), CONFIG, NOW, Number.POSITIVE_INFINITY));
  });

  it("is pure: the same inputs produce the identical plan twice", () => {
    const first = planPriorities(demand(), CONFIG, NOW, 400);
    const second = planPriorities(demand(), CONFIG, NOW, 400);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// createScheduler — factory validation
// ---------------------------------------------------------------------------

describe("createScheduler — factory validation", () => {
  const clock = () => NOW;

  it("rejects a non-object engine with typed INVALID_INPUT", () => {
    expectInvalidInput(() => createScheduler(null as never, {}, clock));
    expectInvalidInput(() => createScheduler("engine" as never, {}, clock));
  });

  it("rejects an engine missing frozen methods with typed INVALID_INPUT", () => {
    const engine = stubEngine() as unknown as Record<string, unknown>;
    const broken = { ...engine, prioritize: undefined };
    expectInvalidInput(() => createScheduler(broken as never, {}, clock));
  });

  it("rejects a non-function clock with typed INVALID_INPUT", () => {
    const engine = stubEngine();
    expectInvalidInput(() => createScheduler(engine, {}, "not a clock" as never));
    expectInvalidInput(() => createScheduler(engine, {}, undefined as never));
  });

  it("rejects malformed config / network estimate with typed INVALID_INPUT", () => {
    const engine = stubEngine();
    expectInvalidInput(() => createScheduler(engine, { horizonMs: 0 }, clock));
    expectInvalidInput(() => createScheduler(engine, {}, clock, -1));
    expectInvalidInput(() => createScheduler(engine, {}, clock, Number.NaN));
  });

  it("accepts a full frozen-surface engine with an injected clock", () => {
    const scheduler = createScheduler(stubEngine(), {}, clock);
    expect(typeof scheduler.tick).toBe("function");
    expect(typeof scheduler.stats).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// createScheduler — the tick loop
// ---------------------------------------------------------------------------

describe("createScheduler — tick loop", () => {
  it("sends the exact golden batch (frozen wire shape) to engine.prioritize", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/movie.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    const report = await scheduler.tick([
      demand({ sessionId: session.id }),
    ]);

    expect(report.tick).toBe(1);
    expect(report.atMs).toBe(NOW);
    expect(report.failures).toEqual([]);
    const batches = prioritizeBatches(engine);
    expect(batches.length).toBe(1);
    // EXACT frozen wire shape: { piece, deadlineMs } only — no markers.
    expect(batches[0]).toEqual([
      { piece: 0, deadlineMs: 100_000 },
      { piece: 1, deadlineMs: 102_600 },
      { piece: 2, deadlineMs: 106_600 },
      { piece: 3, deadlineMs: 110_600 },
      { piece: 4, deadlineMs: 114_600 },
      { piece: 5, deadlineMs: 118_600 },
    ]);
    expect(report.sessions[0]?.planSize).toBe(6);
    expect(report.sessions[0]?.latePieces).toBe(1);
    expect(report.sessions[0]?.engineCalled).toBe(true);
    expect(report.sessions[0]?.result.ok).toBe(true);
    expect(report.sessions[0]?.priority).toEqual({ tier: "foreground", weight: 100 });

    const snapshot = scheduler.stats();
    expect(snapshot.ticks).toBe(1);
    expect(snapshot.lastTickAt).toBe(NOW);
    expect(snapshot.piecesScheduled).toBe(6);
    expect(snapshot.latePieces).toBe(1);
    expect(snapshot.errorCount).toBe(0);
    expect(snapshot.perSessionPlanSizes.get(session.id)).toBe(6);
  });

  it("stats before the first tick are the documented zero state", () => {
    const scheduler = createScheduler(stubEngine(), CONFIG, () => NOW);
    const snapshot = scheduler.stats();
    expect(snapshot).toEqual({
      ticks: 0,
      lastTickAt: null,
      piecesScheduled: 0,
      latePieces: 0,
      perSessionPlanSizes: new Map(),
      lastErrors: [],
      errorCount: 0,
    });
  });

  it("idempotent ticks: same demands + frozen clock send the identical batch twice", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/movie.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    const demands = [demand({ sessionId: session.id })];

    await scheduler.tick(demands);
    await scheduler.tick(demands);

    const batches = prioritizeBatches(engine);
    expect(batches.length).toBe(2);
    expect(batches[1]).toEqual(batches[0]); // no deadline drift
    const snapshot = scheduler.stats();
    expect(snapshot.ticks).toBe(2);
    expect(snapshot.piecesScheduled).toBe(12);
    expect(snapshot.latePieces).toBe(2);
    expect(snapshot.perSessionPlanSizes.get(session.id)).toBe(6);
  });

  it("clock movement shifts deadlines by exactly the elapsed time", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/movie.mkv" });
    let t = NOW;
    const scheduler = createScheduler(engine, CONFIG, () => t, 400);
    const demands = [demand({ sessionId: session.id })];

    await scheduler.tick(demands);
    t += 10_000;
    await scheduler.tick(demands);

    const batches = prioritizeBatches(engine);
    expect(batches.length).toBe(2);
    const first = batches[0] ?? [];
    const second = batches[1] ?? [];
    expect(second.length).toBe(first.length);
    for (let i = 0; i < second.length; i += 1) {
      expect(second[i]?.deadlineMs).toBe((first[i]?.deadlineMs ?? 0) + 10_000);
    }
  });

  it("foreground sessions are scheduled first regardless of input order", async () => {
    const engine = stubEngine();
    const bg = await engine.open({ localPath: "/media/bg.mkv" }); // stub-session-1
    const fg = await engine.open({ localPath: "/media/fg.mkv" }); // stub-session-2
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    // Background demand passed FIRST; foreground must still be scheduled first.
    const report = await scheduler.tick([
      demand({ sessionId: bg.id, state: "background" }),
      demand({ sessionId: fg.id }),
    ]);

    const calls = engine.calls.filter((call) => call.method === "prioritize");
    expect(calls.map((call) => call.args[0])).toEqual([fg.id, bg.id]);
    expect(report.sessions.map((s) => s.sessionId)).toEqual([fg.id, bg.id]);
    expect(report.sessions[0]?.priority.tier).toBe("foreground");
    expect(report.sessions[1]?.priority.tier).toBe("background");
  });

  it("within the same tier, sessionId ascending is the deterministic tie-break", async () => {
    const engine = stubEngine();
    const s1 = await engine.open({ localPath: "/media/1.mkv" });
    const s2 = await engine.open({ localPath: "/media/2.mkv" });
    const s3 = await engine.open({ localPath: "/media/3.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    await scheduler.tick([
      demand({ sessionId: s3.id }),
      demand({ sessionId: s1.id }),
      demand({ sessionId: s2.id }),
    ]);

    const calls = engine.calls.filter((call) => call.method === "prioritize");
    expect(calls.map((call) => call.args[0])).toEqual([s1.id, s2.id, s3.id]);
  });

  it("non-playing sessions yield empty plans and are NOT sent to the engine", async () => {
    const engine = stubEngine();
    const playing = await engine.open({ localPath: "/media/a.mkv" });
    const done = await engine.open({ localPath: "/media/b.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    const report = await scheduler.tick([
      demand({ sessionId: done.id, state: "complete" }),
      demand({ sessionId: playing.id }),
    ]);

    const calls = engine.calls.filter((call) => call.method === "prioritize");
    expect(calls.map((call) => call.args[0])).toEqual([playing.id]);
    const doneResult = report.sessions.find((s) => s.sessionId === done.id);
    expect(doneResult?.planSize).toBe(0);
    expect(doneResult?.engineCalled).toBe(false);
    expect(doneResult?.result.ok).toBe(true);
    if (doneResult?.result.ok) {
      expect(doneResult.result.value.batch).toEqual([]);
    }
    expect(scheduler.stats().perSessionPlanSizes.get(done.id)).toBe(0);
  });

  it("paused sessions (rate 0) yield empty plans and are NOT sent to the engine", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/paused.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    const report = await scheduler.tick([
      demand({ sessionId: session.id, playbackRate: 0 }),
    ]);

    expect(prioritizeBatches(engine)).toEqual([]);
    expect(report.sessions[0]?.planSize).toBe(0);
    expect(report.sessions[0]?.engineCalled).toBe(false);
  });

  it("engine failure during prioritize never crashes the tick; the typed error is recorded", async () => {
    const engine = stubEngine();
    const first = await engine.open({ localPath: "/media/1.mkv" });
    const second = await engine.open({ localPath: "/media/2.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    engine.nextControlError = new Error("engine exploded");

    const report = await scheduler.tick([
      demand({ sessionId: first.id }),
      demand({ sessionId: second.id }),
    ]);

    // The failing session carries a typed, non-retryable INTERNAL error.
    const failed = report.sessions.find((s) => s.sessionId === first.id);
    if (failed === undefined) throw new Error("missing failed session result");
    const failure = expectEnvelopeError(failed.result);
    expect(failure.code).toBe("INTERNAL");
    expect(failure.retryable).toBe(false);
    expect(failure.sessionId).toBe(first.id);
    expect(failure.detail).toContain("engine exploded");
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]?.sessionId).toBe(first.id);
    expect(report.failures[0]?.tick).toBe(1);

    // The healthy session in the SAME tick was still scheduled.
    const healthy = report.sessions.find((s) => s.sessionId === second.id);
    expect(healthy?.result.ok).toBe(true);
    const snapshot = scheduler.stats();
    expect(snapshot.errorCount).toBe(1);
    expect(snapshot.piecesScheduled).toBe(6); // only the healthy batch
    expect(snapshot.lastErrors.length).toBe(1);
    expect(snapshot.lastErrors[0]?.error.code).toBe("INTERNAL");
  });

  it("a typed NativeMediaError from the engine keeps its code and retryability", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/io.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    engine.nextControlError = new NativeMediaError("IO_ERROR", {
      sessionId: session.id,
      detail: "disk hiccup",
    });

    const report = await scheduler.tick([demand({ sessionId: session.id })]);

    const failed = report.sessions[0];
    if (failed === undefined) throw new Error("missing session result");
    const failure = expectEnvelopeError(failed.result);
    expect(failure.code).toBe("IO_ERROR");
    expect(failure.retryable).toBe(true);
    expect(failure.sessionId).toBe(session.id);
    expect(scheduler.stats().errorCount).toBe(1);
    expect(scheduler.stats().piecesScheduled).toBe(0);
  });

  it("an unknown session is a typed failure — no silent schedule drop", async () => {
    const engine = stubEngine();
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    const report = await scheduler.tick([demand({ sessionId: "ghost" })]);

    const failed = report.sessions[0];
    if (failed === undefined) throw new Error("missing session result");
    const failure = expectEnvelopeError(failed.result);
    expect(failure.code).toBe("INTERNAL");
    expect(failure.sessionId).toBe("ghost");
    expect(report.failures.length).toBe(1);
    expect(scheduler.stats().piecesScheduled).toBe(0);
  });

  it("duplicate session ids: first occurrence wins, the duplicate is a typed failure", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/dup.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    const report = await scheduler.tick([
      demand({ sessionId: session.id }),
      demand({ sessionId: session.id, bufferAheadMs: 8_000 }),
    ]);

    const calls = engine.calls.filter((call) => call.method === "prioritize");
    expect(calls.length).toBe(1); // first occurrence scheduled once
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]?.error.code).toBe("INVALID_INPUT");
    expect(report.failures[0]?.sessionId).toBe(session.id);
    expect(scheduler.stats().errorCount).toBe(1);
    expect(scheduler.stats().perSessionPlanSizes.get(session.id)).toBe(6);
  });

  it("a malformed demand is a typed failure; the rest of the tick survives", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/ok.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    const report = await scheduler.tick([
      // Intentionally malformed (missing bitrate/buffer/stall fields):
      {
        sessionId: "broken",
        state: "playing",
        positionMs: 0,
        playbackRate: 1,
      } as unknown as PlaybackDemand,
      demand({ sessionId: session.id }),
    ]);

    expect(report.failures.length).toBe(1);
    expect(report.failures[0]?.error.code).toBe("INVALID_INPUT");
    expect(report.failures[0]?.sessionId).toBe("broken");
    const healthy = report.sessions.find((s) => s.sessionId === session.id);
    expect(healthy?.result.ok).toBe(true);
    expect(prioritizeBatches(engine).length).toBe(1);
  });

  it("a broken clock rejects the tick with typed INVALID_INPUT", async () => {
    const engine = stubEngine();
    const scheduler = createScheduler(engine, CONFIG, () => -5, 400);
    await expectRejects(scheduler.tick([]), "INVALID_INPUT");
    // The refused tick did not count.
    expect(scheduler.stats().ticks).toBe(0);
  });

  it("a non-array sessions argument rejects with typed INVALID_INPUT", async () => {
    const engine = stubEngine();
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    await expectRejects(
      scheduler.tick("nope" as unknown as readonly PlaybackDemand[]),
      "INVALID_INPUT",
    );
  });

  it("stats() returns defensive copies — mutation cannot corrupt the scheduler", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/x.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    // One healthy session + one unknown session (a recorded typed failure).
    await scheduler.tick([
      demand({ sessionId: session.id }),
      demand({ sessionId: "ghost" }),
    ]);

    const first = scheduler.stats();
    (first.perSessionPlanSizes as Map<string, number>).set("intruder", 99);
    (first.lastErrors as SchedulerFailure[]).pop();

    const second = scheduler.stats();
    expect(second.perSessionPlanSizes.has("intruder")).toBe(false);
    expect(second.perSessionPlanSizes.get(session.id)).toBe(6);
    expect(second.lastErrors.length).toBe(1);
    expect(second.errorCount).toBe(1);
  });

  it("the empty config {} resolves the validated defaults (30s horizon, 500ms estimate)", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/defaults.mkv" });
    const scheduler = createScheduler(engine, {}, () => NOW);

    await scheduler.tick([demand({ sessionId: session.id })]);

    // horizon 30000 / D 4000 -> pieces 0..7 (8 entries);
    // margins 2000 + 500 = 2500.
    const batches = prioritizeBatches(engine);
    expect(batches[0]?.length).toBe(8);
    expect(batches[0]?.[0]).toEqual({ piece: 0, deadlineMs: 100_000 });
    expect(batches[0]?.[1]).toEqual({ piece: 1, deadlineMs: 101_500 });
  });

  it("an injected network estimate on the factory is honored", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/estimate.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 100);

    await scheduler.tick([demand({ sessionId: session.id })]);

    // margins 1000 + 100 = 1100: piece 1 due at 100000 + 4000 - 1100.
    expect(prioritizeBatches(engine)[0]?.[1]).toEqual({
      piece: 1,
      deadlineMs: 102_900,
    });
  });

  it("one tick never schedules a piece beyond the horizon", async () => {
    const engine = stubEngine();
    const fgSession = await engine.open({ localPath: "/media/horizon-fg.mkv" });
    const bgSession = await engine.open({ localPath: "/media/horizon-bg.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);

    await scheduler.tick([
      demand({ sessionId: fgSession.id }),
      demand({ sessionId: bgSession.id, state: "background" }),
    ]);

    expect(prioritizeBatches(engine).length).toBe(2);
    for (const batch of prioritizeBatches(engine)) {
      for (const entry of batch) {
        expect(entry.deadlineMs).toBeLessThanOrEqual(NOW + CONFIG.horizonMs);
      }
    }
  });

  it("concurrent ticks are serialized — stats stay consistent", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/serial.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    const demands = [demand({ sessionId: session.id })];

    const [reportA, reportB] = await Promise.all([
      scheduler.tick(demands),
      scheduler.tick(demands),
    ]);

    expect(reportA.tick).toBe(1);
    expect(reportB.tick).toBe(2);
    expect(scheduler.stats().ticks).toBe(2);
    expect(scheduler.stats().piecesScheduled).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// stall guard
// ---------------------------------------------------------------------------

describe("shouldStallProtect — projected underrun protection", () => {
  it("soft underrun protects with extend-horizon", () => {
    // projected = 2000 - 500*1 = 1500 < 3000 budget.
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-soft", bufferAheadMs: 2_000, stallBudgetMs: 3_000 }),
      stats(),
    );
    expect(recommendation.protect).toBe(true);
    expect(recommendation.suggestedActions).toEqual(["extend-horizon"]);
    expect(recommendation.reason).toContain("1500");
    expect(recommendation.reason).toContain("3000");
    expect(recommendation.reason).toContain("underrun");
  });

  it("hard underrun (buffer empties before arrival) protects with reduce-bitrate", () => {
    // projected = 400 - 500*1 = -100 < 0.
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-hard", bufferAheadMs: 400, stallBudgetMs: 3_000 }),
      stats(),
    );
    expect(recommendation.protect).toBe(true);
    expect(recommendation.suggestedActions).toEqual(["reduce-bitrate"]);
    expect(recommendation.reason).toContain("-100");
  });

  it("missed deadlines (stats.latePieces) add pause-prefetch", () => {
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-late", bufferAheadMs: 2_000, stallBudgetMs: 3_000 }),
      stats({ latePieces: 2 }),
    );
    expect(recommendation.protect).toBe(true);
    expect(recommendation.suggestedActions).toEqual([
      "pause-prefetch",
      "extend-horizon",
    ]);
  });

  it("competing prefetch plans add pause-prefetch on a hard underrun", () => {
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-compete", bufferAheadMs: 400, stallBudgetMs: 3_000 }),
      stats({ perSessionPlanSizes: new Map([["other", 6], ["sess-compete", 0]]) }),
    );
    expect(recommendation.protect).toBe(true);
    expect(recommendation.suggestedActions).toEqual([
      "reduce-bitrate",
      "pause-prefetch",
    ]);
  });

  it("a healthy projected buffer does not protect", () => {
    // projected = 10000 - 500 = 9500 >= 3000.
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-healthy", bufferAheadMs: 10_000, stallBudgetMs: 3_000 }),
      stats(),
    );
    expect(recommendation.protect).toBe(false);
    expect(recommendation.suggestedActions).toEqual([]);
    expect(recommendation.reason).toContain("healthy");
    expect(recommendation.reason).toContain("9500");
  });

  it("a projection exactly at the budget is healthy (strictly-below protects)", () => {
    // projected = 3500 - 500 = 3000 == budget.
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-edge", bufferAheadMs: 3_500, stallBudgetMs: 3_000 }),
      stats(),
    );
    expect(recommendation.protect).toBe(false);
  });

  it("the drain model multiplies the estimate by the playback rate", () => {
    // projected = 4000 - 1000*2 = 2000 < 3000.
    const recommendation = shouldStallProtect(
      demand({
        sessionId: "sess-rate",
        bufferAheadMs: 4_000,
        playbackRate: 2,
        stallBudgetMs: 3_000,
      }),
      stats(),
      1_000,
    );
    expect(recommendation.protect).toBe(true);
    expect(recommendation.reason).toContain("2000");
  });

  it("an injected network estimate flips the projection", () => {
    const d = demand({ sessionId: "sess-flip", bufferAheadMs: 4_000, stallBudgetMs: 3_000 });
    expect(shouldStallProtect(d, stats(), 500).protect).toBe(false); // 3500 left
    expect(shouldStallProtect(d, stats(), 2_000).protect).toBe(true); // 2000 left
  });

  it("paused (rate 0) sessions never protect", () => {
    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-paused", playbackRate: 0 }),
      stats(),
    );
    expect(recommendation.protect).toBe(false);
    expect(recommendation.suggestedActions).toEqual([]);
    expect(recommendation.reason).toContain("not consuming");
  });

  it("non-playing states never protect", () => {
    for (const state of ["resolving", "buffering", "complete", "failed"] as const) {
      const recommendation = shouldStallProtect(
        demand({ sessionId: "sess-idle", state }),
        stats(),
      );
      expect(recommendation.protect).toBe(false);
      expect(recommendation.suggestedActions).toEqual([]);
    }
  });

  it("rejects malformed demand / stats / estimate with typed INVALID_INPUT", () => {
    expectInvalidInput(() =>
      shouldStallProtect({ ...demand(), bitrateBps: 0 }, stats()),
    );
    expectInvalidInput(() => shouldStallProtect(demand(), null as never));
    expectInvalidInput(() =>
      shouldStallProtect(demand(), stats({ latePieces: -1 })),
    );
    expectInvalidInput(() =>
      shouldStallProtect(demand(), {
        ...stats(),
        perSessionPlanSizes: "not a map" as never,
      }),
    );
    expectInvalidInput(() => shouldStallProtect(demand(), stats(), -1));
  });

  it("compose: real scheduler stats (with late pieces) drive pause-prefetch", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/media/compose.mkv" });
    const scheduler = createScheduler(engine, CONFIG, () => NOW, 400);
    // Golden A includes one late piece (piece 0, empty buffer).
    await scheduler.tick([demand({ sessionId: session.id })]);
    const realStats = scheduler.stats();
    expect(realStats.latePieces).toBe(1);

    const recommendation = shouldStallProtect(
      demand({ sessionId: "sess-other", bufferAheadMs: 2_000, stallBudgetMs: 3_000 }),
      realStats,
    );
    expect(recommendation.protect).toBe(true);
    expect(recommendation.suggestedActions).toEqual([
      "pause-prefetch",
      "extend-horizon",
    ]);
  });
});
