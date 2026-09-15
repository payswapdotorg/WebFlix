import { describe, expect, it } from "bun:test";

import type { NativeMediaSession } from "@wfx/domain";

import {
  DEFAULT_COMPLETION_POLICY,
  DEFAULT_STORAGE_POLICY,
  NativeMediaError,
  createCacheTracker,
  createCompletionDriver,
  createStorageGovernor,
  decideCompletion,
  decideEviction,
  makeSession,
  planPriorities,
  resolveCompletionPolicy,
  resolveStoragePolicy,
  stubEngine,
  track as cacheTrack,
  touch as cacheTouch,
  validateBackgroundEnvironment,
  validateBackgroundPolicy,
  validateBackgroundSession,
  validateCompletionPolicy,
  validateStoragePolicy,
  type BackgroundCause,
  type BackgroundDemandFacts,
  type BackgroundEnvironment,
  type BackgroundLogEntry,
  type BackgroundOutcome,
  type BackgroundPolicy,
  type CacheTracker,
  type CompletionDriver,
  type CompletionEvent,
  type CompletionMode,
  type CompletionSink,
  type EvictionPlan,
  type SchedulerConfig,
  type SchedulerConfigInput,
  type SchedulerTickReport,
  type StorageAdmissionResult,
  type StorageGovernor,
  type StoragePolicy,
  type StorageReleaseResult,
  type StorageStats,
  type StubEngine,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const NOW = 100_000;

/** One well-formed backgrounded session with per-test overrides. */
function bgSession(overrides: Partial<NativeMediaSession> = {}): NativeMediaSession {
  return makeSession({
    id: "sess-1",
    assetId: "asset-1",
    fileId: "file-1",
    state: "background",
    bufferedMs: 60_000,
    positionMs: 30_000,
    ...overrides,
  });
}

/**
 * Scheduling facts with ZERO buffer ahead at 512 kbps (one nominal piece is
 * exactly 4000ms): the canonical demand for exact plan arithmetic.
 */
const FACTS: BackgroundDemandFacts = {
  positionMs: 30_000,
  playbackRate: 1,
  bitrateBps: 524_288,
  bufferAheadMs: 0,
  stallBudgetMs: 3_000,
};

/** The canonical test scheduler config (same as the WFX-023 tests). */
const SCHEDULER_CONFIG: SchedulerConfig = {
  horizonMs: 20_000,
  safetyMarginMs: 1_000,
  maxDeadlineBatch: 8,
  backgroundRateFactor: 0.25,
};

const ALL_MODES: CompletionMode[] = [
  "always",
  "wifi-only",
  "never",
  "charging-only",
];

/** Every (networkClass × charging) environment combination. */
const ALL_ENVIRONMENTS: BackgroundEnvironment[] = [
  { networkClass: "wifi", charging: true },
  { networkClass: "wifi", charging: false },
  { networkClass: "cellular", charging: true },
  { networkClass: "cellular", charging: false },
  { networkClass: "offline", charging: true },
  { networkClass: "offline", charging: false },
];

/** The golden action for (mode, environment), independent of the impl. */
function goldenAction(
  mode: CompletionMode,
  env: BackgroundEnvironment,
): "continue" | "pause" | "cancel" {
  if (mode === "never") return "cancel";
  if (mode === "always") return "continue";
  if (mode === "wifi-only") return env.networkClass === "wifi" ? "continue" : "pause";
  return env.charging ? "continue" : "pause";
}

/** The golden reason string, independent of the impl. */
function goldenReason(
  mode: CompletionMode,
  env: BackgroundEnvironment,
): string {
  if (mode === "never") {
    return 'completion mode "never": background completion is disabled by policy';
  }
  if (mode === "always") {
    return 'completion mode "always": background completion continues in every environment';
  }
  if (mode === "wifi-only") {
    return env.networkClass === "wifi"
      ? 'completion mode "wifi-only": networkClass is wifi — continuing'
      : `completion mode "wifi-only": networkClass is ${env.networkClass} — pausing (resumable)`;
  }
  return env.charging
    ? 'completion mode "charging-only": device is charging — continuing'
    : 'completion mode "charging-only": device is not charging — pausing (resumable)';
}

/** Assert a sync call throws a typed INVALID_INPUT NativeMediaError. */
function expectThrowsInvalidInput(fn: () => unknown): NativeMediaError {
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

/** Assert an async call rejects with a typed INVALID_INPUT NativeMediaError. */
async function expectRejectsInvalidInput(
  promise: Promise<unknown>,
): Promise<NativeMediaError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(NativeMediaError);
    const error = e as NativeMediaError;
    expect(error.code).toBe("INVALID_INPUT");
    return error;
  }
  throw new Error("expected the promise to reject");
}

/** An event-collecting sink (the injected CompletionSink). */
function collectorSink(): { events: CompletionEvent[]; sink: CompletionSink } {
  const events: CompletionEvent[] = [];
  return {
    events,
    sink: {
      onCompletion: (event) => {
        events.push(event);
      },
    },
  };
}

/** A full policy from parts, for driver construction. */
function backgroundPolicy(
  completion?: {
    mode?: CompletionMode | undefined;
    maxConcurrentCompletions?: number | undefined;
  },
  storage?: {
    maxCacheBytes?: number | undefined;
    protectedItems?: readonly string[] | undefined;
    evictOrder?: "lru" | "fifo" | undefined;
    minFreeBytes?: number | undefined;
  },
): BackgroundPolicy {
  return {
    completion: validateCompletionPolicy({
      mode: completion?.mode ?? DEFAULT_COMPLETION_POLICY.mode,
      maxConcurrentCompletions:
        completion?.maxConcurrentCompletions ??
        DEFAULT_COMPLETION_POLICY.maxConcurrentCompletions,
    }),
    storage: validateStoragePolicy({
      maxCacheBytes: storage?.maxCacheBytes ?? 1_000,
      protectedItems: storage?.protectedItems ?? [],
      evictOrder: storage?.evictOrder ?? "fifo",
      minFreeBytes: storage?.minFreeBytes ?? 0,
    }),
  };
}

/** Build a driver over a stub engine with the injected clock. */
function makeDriver(options: {
  mode?: CompletionMode;
  maxConcurrentCompletions?: number;
  storage?: Partial<StoragePolicy>;
  environment?: BackgroundEnvironment;
  sink?: CompletionSink;
  schedulerConfig?: SchedulerConfigInput;
  engine?: StubEngine;
}): {
  driver: CompletionDriver;
  engine: StubEngine;
  events: CompletionEvent[];
} {
  const engine = options.engine ?? stubEngine();
  const collector = collectorSink();
  const sink = options.sink ?? collector.sink;
  const driver = createCompletionDriver(
    engine,
    backgroundPolicy(
      {
        mode: options.mode,
        maxConcurrentCompletions: options.maxConcurrentCompletions,
      },
      options.storage,
    ),
    () => NOW,
    {
      environment: options.environment ?? { networkClass: "wifi", charging: true },
      completionSink: sink,
      ...(options.schedulerConfig !== undefined
        ? { schedulerConfig: options.schedulerConfig }
        : {}),
    },
  );
  return { driver, engine, events: collector.events };
}

/**
 * Open a session on the stub engine and force it to `background` so the
 * driver's engine calls (pause/resume/close/prioritize) find a live session.
 */
async function openedBackgroundSession(
  engine: StubEngine,
): Promise<NativeMediaSession> {
  const session = await engine.open({
    magnet: "magnet:?xt=urn:btih:WFX024TESTSESSION000000000000",
  });
  engine.forceState(session.id, "background");
  return { ...session, state: "background" as const };
}

/** Engine method call helper over the stub's recorded calls. */
function callsOf(
  engine: StubEngine,
  method: string,
): { method: string; args: readonly unknown[] }[] {
  return engine.calls.filter((call) => call.method === method);
}

// ---------------------------------------------------------------------------
// policy — decideCompletion decision matrix
// ---------------------------------------------------------------------------

describe("WFX-024 background policy — decideCompletion", () => {
  it("full mode × environment matrix — golden actions AND reasons", () => {
    for (const mode of ALL_MODES) {
      const policy = resolveCompletionPolicy({ mode });
      for (const env of ALL_ENVIRONMENTS) {
        const decision = decideCompletion(bgSession(), policy, env);
        expect(decision.action).toBe(goldenAction(mode, env));
        expect(decision.reason).toBe(goldenReason(mode, env));
      }
    }
  });

  it("terminal sessions cancel with a nothing-to-do reason (every mode)", () => {
    for (const mode of ALL_MODES) {
      const policy = resolveCompletionPolicy({ mode });
      for (const terminal of ["complete", "failed"] as const) {
        const session = bgSession({ id: `sess-${terminal}`, state: terminal });
        for (const env of ALL_ENVIRONMENTS) {
          const decision = decideCompletion(session, policy, env);
          expect(decision.action).toBe("cancel");
          expect(decision.reason).toBe(
            `session 'sess-${terminal}' is already ${terminal}: nothing to complete`,
          );
        }
      }
    }
  });

  it("non-terminal non-background states follow the same mode matrix", () => {
    const policy = resolveCompletionPolicy({ mode: "wifi-only" });
    for (const state of ["resolving", "buffering", "playing"] as const) {
      const decision = decideCompletion(
        bgSession({ state }),
        policy,
        { networkClass: "cellular", charging: true },
      );
      expect(decision.action).toBe("pause");
      expect(decision.reason).toContain("wifi-only");
    }
  });

  it("deterministic: identical inputs yield identical decisions", () => {
    const policy = resolveCompletionPolicy({ mode: "charging-only" });
    const env: BackgroundEnvironment = { networkClass: "wifi", charging: false };
    const a = decideCompletion(bgSession(), policy, env);
    const b = decideCompletion(bgSession(), policy, env);
    expect(a).toEqual(b);
  });

  it("malformed session / policy / environment throw typed INVALID_INPUT", () => {
    const policy = resolveCompletionPolicy({});
    const env: BackgroundEnvironment = { networkClass: "wifi", charging: true };
    expectThrowsInvalidInput(() =>
      decideCompletion({ ...bgSession(), id: "" }, policy, env),
    );
    expectThrowsInvalidInput(() =>
      decideCompletion({ ...bgSession(), state: "paused" as never }, policy, env),
    );
    expectThrowsInvalidInput(() =>
      decideCompletion(bgSession(), { mode: "sometimes" } as never, env),
    );
    expectThrowsInvalidInput(() =>
      decideCompletion(bgSession(), policy, { networkClass: "5g" } as never),
    );
    expectThrowsInvalidInput(() =>
      decideCompletion(bgSession(), policy, { charging: "yes" } as never),
    );
  });
});

// ---------------------------------------------------------------------------
// policy — validation & defaults
// ---------------------------------------------------------------------------

describe("WFX-024 background policy — validation & defaults", () => {
  it("defaults are conservative (wifi-only, cap 1, 2 GiB / 64 MiB, lru)", () => {
    expect(DEFAULT_COMPLETION_POLICY).toEqual({
      mode: "wifi-only",
      maxConcurrentCompletions: 1,
    });
    expect(DEFAULT_STORAGE_POLICY.maxCacheBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(DEFAULT_STORAGE_POLICY.minFreeBytes).toBe(64 * 1024 * 1024);
    expect(DEFAULT_STORAGE_POLICY.evictOrder).toBe("lru");
    expect(DEFAULT_STORAGE_POLICY.protectedItems).toEqual([]);
    expect(resolveCompletionPolicy()).toEqual(DEFAULT_COMPLETION_POLICY);
    expect(resolveStoragePolicy()).toEqual(DEFAULT_STORAGE_POLICY);
  });

  it("CompletionPolicy validation rejects malformed values", () => {
    expectThrowsInvalidInput(() => validateCompletionPolicy(null));
    expectThrowsInvalidInput(() =>
      validateCompletionPolicy({ mode: "sometimes", maxConcurrentCompletions: 1 }),
    );
    expectThrowsInvalidInput(() =>
      validateCompletionPolicy({ mode: "always", maxConcurrentCompletions: 0 }),
    );
    expectThrowsInvalidInput(() =>
      validateCompletionPolicy({ mode: "always", maxConcurrentCompletions: 1.5 }),
    );
    expect(
      validateCompletionPolicy({ mode: "never", maxConcurrentCompletions: 3 }),
    ).toEqual({ mode: "never", maxConcurrentCompletions: 3 });
  });

  it("StoragePolicy validation rejects malformed values", () => {
    expectThrowsInvalidInput(() => validateStoragePolicy(null));
    expectThrowsInvalidInput(() =>
      validateStoragePolicy({
        maxCacheBytes: -1,
        protectedItems: [],
        evictOrder: "lru",
        minFreeBytes: 0,
      }),
    );
    expectThrowsInvalidInput(() =>
      validateStoragePolicy({
        maxCacheBytes: 1000,
        protectedItems: [""],
        evictOrder: "lru",
        minFreeBytes: 0,
      }),
    );
    expectThrowsInvalidInput(() =>
      validateStoragePolicy({
        maxCacheBytes: 1000,
        protectedItems: ["a", "a"],
        evictOrder: "lru",
        minFreeBytes: 0,
      }),
    );
    expectThrowsInvalidInput(() =>
      validateStoragePolicy({
        maxCacheBytes: 1000,
        protectedItems: [],
        evictOrder: "random",
        minFreeBytes: 0,
      }),
    );
    expectThrowsInvalidInput(() =>
      validateStoragePolicy({
        maxCacheBytes: 1000,
        protectedItems: [],
        evictOrder: "lru",
        minFreeBytes: 1001,
      }),
    );
    // minFreeBytes == maxCacheBytes is allowed (a zero-effective budget,
    // mirroring WFX-014's maxBytes: 0 precedent — admits only nothing).
    expect(
      validateStoragePolicy({
        maxCacheBytes: 1000,
        protectedItems: [],
        evictOrder: "fifo",
        minFreeBytes: 1000,
      }),
    ).toEqual({
      maxCacheBytes: 1000,
      protectedItems: [],
      evictOrder: "fifo",
      minFreeBytes: 1000,
    });
  });

  it("BackgroundPolicy / environment / session validators", () => {
    expectThrowsInvalidInput(() => validateBackgroundPolicy(null));
    expectThrowsInvalidInput(() =>
      validateBackgroundPolicy({ completion: resolveCompletionPolicy() }),
    );
    expect(
      validateBackgroundEnvironment({ networkClass: "wifi", charging: false }),
    ).toEqual({ networkClass: "wifi", charging: false });
    expectThrowsInvalidInput(() => validateBackgroundEnvironment(null));
    expectThrowsInvalidInput(() =>
      validateBackgroundEnvironment({ networkClass: "wifi" }),
    );
    expect(validateBackgroundSession(bgSession())).toEqual(bgSession());
    expectThrowsInvalidInput(() => validateBackgroundSession(null));
    expectThrowsInvalidInput(() =>
      validateBackgroundSession({ ...bgSession(), state: undefined }),
    );
    expectThrowsInvalidInput(() =>
      validateBackgroundSession({ ...bgSession(), positionMs: -1 }),
    );
  });

  it("resolve helpers reject runtime garbage instead of defaulting", () => {
    expectThrowsInvalidInput(() => resolveCompletionPolicy("wifi-only" as never));
    expectThrowsInvalidInput(() => resolveStoragePolicy([1, 2, 3] as never));
  });
});

// ---------------------------------------------------------------------------
// policy — decideEviction (pure planner)
// ---------------------------------------------------------------------------

describe("WFX-024 background policy — decideEviction", () => {
  /** FIFO tracker: a(100), b(200), c(300) — insertion order is the policy. */
  function fifoTracker(): CacheTracker {
    let tracker = createCacheTracker({ maxBytes: 100_000, evictOrder: "fifo" });
    tracker = cacheTrack(tracker, "a", 100);
    tracker = cacheTrack(tracker, "b", 200);
    tracker = cacheTrack(tracker, "c", 300);
    return tracker;
  }

  /** LRU tracker: same entries, then `a` is read (promoted to most recent). */
  function lruTracker(): CacheTracker {
    let tracker = createCacheTracker({ maxBytes: 100_000, evictOrder: "lru" });
    tracker = cacheTrack(tracker, "a", 100);
    tracker = cacheTrack(tracker, "b", 200);
    tracker = cacheTrack(tracker, "c", 300);
    tracker = cacheTouch(tracker, "a");
    return tracker;
  }

  function storage(overrides: Partial<StoragePolicy> = {}): StoragePolicy {
    return resolveStoragePolicy({
      maxCacheBytes: 1_000,
      protectedItems: [],
      evictOrder: "fifo",
      minFreeBytes: 0,
      ...overrides,
    });
  }

  it("fits without eviction when under the effective ceiling", () => {
    const plan = decideEviction(fifoTracker(), 100, storage());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.victims).toEqual([]);
      expect(plan.freedBytes).toBe(0);
      expect(plan.freeBytesAfter).toBe(300); // 1000 - (600 + 100)
    }
  });

  it("FIFO order is exact (oldest-insert first)", () => {
    // 600 + 500 = 1100 > 1000 ⇒ evict a(100) ⇒ 1000 exactly fits.
    const plan = decideEviction(fifoTracker(), 500, storage());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.victims).toEqual([{ key: "a", bytes: 100 }]);
      expect(plan.freedBytes).toBe(100);
      expect(plan.freeBytesAfter).toBe(0);
    }
  });

  it("LRU order is exact (least-recently-used first, touch reorders)", () => {
    // LRU order after touch(a): [b, c, a] ⇒ evict b(200) ⇒ 900 fits.
    const plan = decideEviction(lruTracker(), 500, storage());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.victims).toEqual([{ key: "b", bytes: 200 }]);
      expect(plan.freedBytes).toBe(200);
      expect(plan.freeBytesAfter).toBe(100);
    }
  });

  it("minFreeBytes is respected: headroom reserved inside the ceiling", () => {
    // Ceiling = 1000 - 200 = 800. 600 + 500 = 1100 > 800 ⇒ evict a(100) ⇒
    // 1000 > 800 ⇒ evict b(200) ⇒ 800 fits exactly; 200 bytes stay free.
    const plan = decideEviction(fifoTracker(), 500, storage({ minFreeBytes: 200 }));
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.victims).toEqual([
        { key: "a", bytes: 100 },
        { key: "b", bytes: 200 },
      ]);
      expect(plan.freedBytes).toBe(300);
      expect(plan.freeBytesAfter).toBe(200);
    }
  });

  it("protected entries are NEVER evicted (skipped mid-order)", () => {
    // FIFO order [c, a, b] (c inserted first); c is protected ⇒ skipped.
    let tracker = createCacheTracker({ maxBytes: 100_000, evictOrder: "fifo" });
    tracker = cacheTrack(tracker, "c", 300);
    tracker = cacheTrack(tracker, "a", 100);
    tracker = cacheTrack(tracker, "b", 200);
    const plan = decideEviction(
      tracker,
      600,
      storage({ protectedItems: ["c"] }),
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.victims.map((v) => v.key)).toEqual(["a", "b"]);
      expect(plan.victims.some((v) => v.key === "c")).toBe(false);
      expect(plan.freeBytesAfter).toBe(100);
    }
  });

  it("impossible plan ⇒ typed refusal with reason, shortfall and protected keys", () => {
    // Freeable = a(100) + b(200) = 300 < needed 400 ⇒ impossible.
    const plan: EvictionPlan = decideEviction(
      fifoTracker(),
      800,
      storage({ protectedItems: ["c"] }),
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.victims).toEqual([]);
      expect(plan.freedBytes).toBe(0);
      expect(plan.shortfallBytes).toBe(100);
      expect(plan.maxFreeableBytes).toBe(300);
      expect(plan.protectedKeys).toEqual(["c"]);
      expect(plan.reason).toContain("eviction impossible");
      expect(plan.reason).toContain("protected entries are never evicted: c");
    }
  });

  it("incoming bytes alone over the effective ceiling ⇒ typed refusal", () => {
    const plan = decideEviction(fifoTracker(), 5_000, storage());
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      // Even after evicting everything (600 bytes), 5000 still exceeds 1000.
      expect(plan.shortfallBytes).toBe(600 - 600 + 5_000 - 1_000);
      expect(plan.maxFreeableBytes).toBe(600);
    }
  });

  it("deterministic: identical inputs yield identical plans", () => {
    const a = decideEviction(lruTracker(), 500, storage());
    const b = decideEviction(lruTracker(), 500, storage());
    expect(a).toEqual(b);
  });

  it("malformed tracker / incomingBytes / storage throw typed INVALID_INPUT", () => {
    expectThrowsInvalidInput(() => decideEviction(null as never, 100, storage()));
    expectThrowsInvalidInput(() =>
      decideEviction({ ...fifoTracker(), entries: "nope" } as never, 100, storage()),
    );
    expectThrowsInvalidInput(() => decideEviction(fifoTracker(), -5, storage()));
    expectThrowsInvalidInput(() => decideEviction(fifoTracker(), 10.5, storage()));
    expectThrowsInvalidInput(() =>
      decideEviction(fifoTracker(), 100, { ...storage(), minFreeBytes: 2_000 }),
    );
  });
});

// ---------------------------------------------------------------------------
// storage — StorageGovernor
// ---------------------------------------------------------------------------

describe("WFX-024 storage governor — admission, eviction, release, stats", () => {
  function governor(overrides: Partial<StoragePolicy> = {}): StorageGovernor {
    return createStorageGovernor(
      resolveStoragePolicy({
        maxCacheBytes: 1_000,
        protectedItems: [],
        evictOrder: "fifo",
        minFreeBytes: 0,
        ...overrides,
      }),
    );
  }

  it("admit below ceiling is a plain ok with exact byte math", () => {
    const g = governor({ minFreeBytes: 100 });
    const a = g.admit("asset-a", 400);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.admittedBytes).toBe(400);
      expect(a.evicted).toEqual([]);
      expect(a.freeBytesAfter).toBe(600);
    }
    expect(g.stats().usedBytes).toBe(400);
    expect(g.stats().freeBytes).toBe(600);
    expect(g.stats().perAsset.get("asset-a")).toBe(400);
  });

  it("admit over ceiling: plan-then-admit with EXACT byte math", () => {
    const g = governor({ minFreeBytes: 100 }); // effective ceiling 900
    g.admit("asset-a", 400);
    // 400 + 600 = 1000 > 900 ⇒ plan evicts a(400) ⇒ 0 + 600 = 600 ≤ 900.
    const b = g.admit("asset-b", 600);
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.evicted).toEqual([{ key: "asset-a", bytes: 400 }]);
      expect(b.freeBytesAfter).toBe(400);
    }
    const stats: StorageStats = g.stats();
    expect(stats.usedBytes).toBe(600);
    expect(stats.freeBytes).toBe(400);
    expect(stats.perAsset.get("asset-b")).toBe(600);
    expect(stats.perAsset.has("asset-a")).toBe(false);
    expect(stats.evictions).toBe(1);
    expect(stats.evictedBytes).toBe(400);
    expect(stats.entryCount).toBe(1);
  });

  it("admit impossible ⇒ typed over-ceiling refusal (never silently over)", () => {
    const g = governor({ minFreeBytes: 100 }); // effective ceiling 900
    g.admit("asset-a", 400);
    g.admit("asset-b", 600);
    // Even evicting everything (0 used) leaves 950 > 900.
    const c: StorageAdmissionResult = g.admit("asset-c", 950);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.refusal.kind).toBe("over-ceiling");
      expect(c.refusal.reason).toContain("eviction impossible");
      expect(c.refusal.plan?.ok).toBe(false);
    }
    // The tracker is unchanged — never silently over-ceiling.
    expect(g.stats().usedBytes).toBe(600);
    expect(g.stats().entryCount).toBe(1);
  });

  it("re-admitting a tracked asset ⇒ typed duplicate refusal", () => {
    const g = governor();
    g.admit("asset-a", 400);
    const again = g.admit("asset-a", 100);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.refusal.kind).toBe("duplicate");
      expect(again.refusal.reason).toContain("asset-a");
    }
    expect(g.stats().usedBytes).toBe(400);
  });

  it("protected assets are never evicted to make room (typed refusal)", () => {
    const g = governor({ protectedItems: ["asset-keep"] });
    g.admit("asset-keep", 700);
    g.admit("asset-x", 200); // 900 used
    // Evicting asset-x (200) still leaves 700 + 500 = 1200 > 1000: the
    // protected asset-keep cannot be touched ⇒ impossible ⇒ typed refusal.
    const r = g.admit("asset-y", 500);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe("over-ceiling");
      expect(r.refusal.reason).toContain("asset-keep");
      expect(r.refusal.plan?.ok).toBe(false);
    }
    // Nothing was applied: both entries (incl. the non-protected one) stay.
    expect(g.stats().usedBytes).toBe(900);
    expect(g.stats().perAsset.get("asset-keep")).toBe(700);
    expect(g.stats().perAsset.get("asset-x")).toBe(200);
  });

  it("governor LRU: touch reorders eviction via the WFX-014 accounting", () => {
    const g = governor({ evictOrder: "lru" });
    g.admit("a", 400);
    g.admit("b", 400);
    g.admit("c", 200); // 1000 used
    expect(g.touch("a").ok).toBe(true); // order becomes [b, c, a]
    const r = g.admit("d", 300);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evicted.map((v) => v.key)).toEqual(["b"]);
    }
    expect(g.stats().perAsset.has("a")).toBe(true);
    expect(g.stats().perAsset.has("b")).toBe(false);
  });

  it("touch of an unknown asset ⇒ typed refusal", () => {
    const g = governor();
    const r = g.touch("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.kind).toBe("unknown-asset");
    }
  });

  it("release frees the bound session's cache; unknown session refused", () => {
    const g = governor();
    g.associate("sess-1", "asset-a");
    g.admit("asset-a", 400);
    const release: StorageReleaseResult = g.release("sess-1");
    expect(release.ok).toBe(true);
    if (release.ok) {
      expect(release.assetId).toBe("asset-a");
      expect(release.freedBytes).toBe(400);
    }
    expect(g.stats().usedBytes).toBe(0);
    expect(g.stats().sessionBindings).toBe(0);
    const unknown = g.release("sess-1");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.refusal.kind).toBe("unknown-session");
    }
  });

  it("release of a protected asset ⇒ typed refusal (protected never released)", () => {
    const g = governor({ protectedItems: ["asset-keep"] });
    g.associate("sess-1", "asset-keep");
    g.admit("asset-keep", 400);
    const release = g.release("sess-1");
    expect(release.ok).toBe(false);
    if (!release.ok) {
      expect(release.refusal.kind).toBe("protected");
      expect(release.refusal.reason).toContain("never released");
    }
    expect(g.stats().usedBytes).toBe(400);
  });

  it("release of a session with no cached bytes is an ok no-op", () => {
    const g = governor();
    g.associate("sess-1", "asset-a");
    const release = g.release("sess-1");
    expect(release.ok).toBe(true);
    if (release.ok) {
      expect(release.freedBytes).toBe(0);
      expect(release.note).toContain("no cached bytes");
    }
  });

  it("markPersistent: only protected assets; typed refusal otherwise", () => {
    const g = governor({ protectedItems: ["asset-keep"] });
    const ok = g.markPersistent("asset-keep");
    expect(ok.ok).toBe(true);
    const refused = g.markPersistent("asset-other");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusal.kind).toBe("not-protected");
    }
    expect(g.stats().persistentAssets).toEqual(["asset-keep"]);
    expect(g.stats().protectedAssets).toEqual(["asset-keep"]);
    expect(g.isProtected("asset-keep")).toBe(true);
    expect(g.isProtected("asset-other")).toBe(false);
  });

  it("malformed inputs throw typed INVALID_INPUT (programmer errors)", () => {
    const g = governor();
    expectThrowsInvalidInput(() => g.admit("", 100));
    expectThrowsInvalidInput(() => g.admit("a", 0));
    expectThrowsInvalidInput(() => g.admit("a", -10));
    expectThrowsInvalidInput(() => g.associate("", "a"));
    expectThrowsInvalidInput(() => g.associate("s", ""));
    expectThrowsInvalidInput(() => g.release(""));
    expectThrowsInvalidInput(() => g.touch(""));
    expectThrowsInvalidInput(() => g.markPersistent(""));
    expectThrowsInvalidInput(() => createStorageGovernor(null as never));
  });
});

// ---------------------------------------------------------------------------
// completion driver — decisions applied to a real (stub) engine
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — onSessionBackground", () => {
  it("continue: session joins the background set, is schedulable, logged", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    const outcome: BackgroundOutcome = await driver.onSessionBackground(session, FACTS);
    expect(outcome.policyDecision.action).toBe("continue");
    expect(outcome.effective.action).toBe("continue");
    expect(outcome.transition).toBe("continue");
    expect(outcome.schedulable).toBe(true);
    expect(outcome.engineCalls).toEqual([]);
    expect(driver.stats().activeCompletions).toEqual([session.id]);
    expect(driver.stats().trackedSessions).toBe(1);
    const entry = driver.log()[0];
    expect(entry?.transition).toBe("continue");
    expect(entry?.cause).toBe("policy");
    expect(entry?.sessionId).toBe(session.id);
    expect(entry?.assetId).toBe(session.assetId);
    expect(entry?.reason).toContain("always");
  });

  it("continue WITHOUT facts: tracked but explicitly unschedulable", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    const outcome = await driver.onSessionBackground(session);
    expect(outcome.transition).toBe("continue");
    expect(outcome.schedulable).toBe(false);
    expect(driver.stats().unschedulable).toEqual([session.id]);
    // tick() schedules nothing for it — reported in stats, never invented.
    const report: SchedulerTickReport = await driver.tick();
    expect(report.sessions).toEqual([]);
  });

  it("policy pause (wifi-only + cellular): engine.pause issued, resumable, logged", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      environment: { networkClass: "cellular", charging: true },
    });
    const session = await openedBackgroundSession(engine);
    const outcome = await driver.onSessionBackground(session, FACTS);
    expect(outcome.policyDecision.action).toBe("pause");
    expect(outcome.effective.action).toBe("pause");
    expect(outcome.transition).toBe("pause");
    expect(outcome.schedulable).toBe(false);
    expect(callsOf(engine, "pause").length).toBe(1);
    expect(callsOf(engine, "pause")[0]?.args[0]).toBe(session.id);
    expect(driver.stats().paused.length).toBe(1);
    expect(driver.stats().paused[0]?.cause).toBe("policy");
    expect(driver.stats().activeCompletions).toEqual([]);
    const entry = driver.log()[0];
    expect(entry?.transition).toBe("pause");
    expect(entry?.cause).toBe("policy");
    expect(entry?.reason).toContain("wifi-only");
    expect(entry?.reason).toContain("resumable");
  });

  it("cancel (mode never): engine.close issued, cache released, logged", async () => {
    const { driver, engine } = makeDriver({
      mode: "never",
      storage: { maxCacheBytes: 10_000 },
    });
    const session = await openedBackgroundSession(engine);
    expect(driver.storage().admit(session.assetId, 4_000).ok).toBe(true);
    const outcome = await driver.onSessionBackground(session, FACTS);
    expect(outcome.policyDecision.action).toBe("cancel");
    expect(outcome.transition).toBe("cancel");
    expect(outcome.schedulable).toBe(false);
    expect(callsOf(engine, "close").length).toBe(1);
    expect(callsOf(engine, "close")[0]?.args[0]).toBe(session.id);
    expect(outcome.release?.ok).toBe(true);
    if (outcome.release?.ok) {
      expect(outcome.release.freedBytes).toBe(4_000);
    }
    expect(driver.storage().stats().usedBytes).toBe(0);
    expect(driver.stats().cancels).toBe(1);
    expect(driver.stats().trackedSessions).toBe(0);
    const entry = driver.log()[0];
    expect(entry?.transition).toBe("cancel");
    expect(entry?.cause).toBe("policy");
  });

  it("cancel keeps the cache when the protected asset completed (persistence)", async () => {
    const { driver, engine } = makeDriver({
      mode: "never",
      storage: { maxCacheBytes: 10_000, protectedItems: ["stub-asset-1"] },
    });
    const session = await openedBackgroundSession(engine); // stub-asset-1
    expect(driver.storage().admit(session.assetId, 4_000).ok).toBe(true);
    const terminal = { ...session, state: "complete" as const };
    const outcome = await driver.onSessionBackground(terminal);
    expect(outcome.policyDecision.action).toBe("cancel");
    expect(outcome.policyDecision.reason).toContain("already complete");
    expect(outcome.release).toBeUndefined(); // completed downloads persist
    expect(driver.storage().stats().usedBytes).toBe(4_000);
    const entry = driver.log()[0];
    expect(entry?.cause).toBe("terminal");
  });

  it("terminal sessions pushed to background cancel (nothing to do)", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    for (const terminal of ["complete", "failed"] as const) {
      const session = await openedBackgroundSession(engine);
      const outcome = await driver.onSessionBackground({
        ...session,
        state: terminal,
      });
      expect(outcome.policyDecision.action).toBe("cancel");
      expect(outcome.policyDecision.reason).toContain(terminal);
      expect(outcome.transition).toBe("cancel");
      expect(callsOf(engine, "close").some((c) => c.args[0] === session.id)).toBe(
        true,
      );
    }
    expect(driver.stats().trackedSessions).toBe(0);
  });

  it("malformed session / facts throw typed INVALID_INPUT", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    await expectRejectsInvalidInput(
      driver.onSessionBackground({ ...session, id: " " }),
    );
    await expectRejectsInvalidInput(
      driver.onSessionBackground(session, { ...FACTS, bitrateBps: 0 }),
    );
    await expectRejectsInvalidInput(
      driver.onSessionBackground(session, { ...FACTS, playbackRate: -1 }),
    );
    expect(driver.stats().trackedSessions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// completion driver — environment changes
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — onEnvironmentChange", () => {
  it("wifi-only pause is RESUMABLE: wifi returns ⇒ resume; both transitions logged with causes", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      environment: { networkClass: "cellular", charging: false },
    });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    expect(callsOf(engine, "resume").length).toBe(0);

    const report = await driver.onEnvironmentChange({
      networkClass: "wifi",
      charging: false,
    });
    expect(report.previousEnvironment).toEqual({
      networkClass: "cellular",
      charging: false,
    });
    expect(report.environment).toEqual({ networkClass: "wifi", charging: false });
    expect(report.outcomes.length).toBe(1);
    expect(report.outcomes[0]?.transition).toBe("resume");
    expect(report.outcomes[0]?.schedulable).toBe(true);
    expect(callsOf(engine, "resume").length).toBe(1);
    expect(callsOf(engine, "resume")[0]?.args[0]).toBe(session.id);
    expect(driver.stats().activeCompletions).toEqual([session.id]);
    expect(driver.stats().paused).toEqual([]);

    const log = driver.log();
    const pauseEntry = log.find((e) => e.transition === "pause");
    const resumeEntry = log.find((e) => e.transition === "resume");
    expect(pauseEntry?.cause).toBe("policy");
    expect(pauseEntry?.reason).toContain("wifi-only");
    expect(pauseEntry?.reason).toContain("cellular");
    expect(resumeEntry?.cause).toBe("environment");
    expect(resumeEntry?.reason).toContain("wifi-only");
    expect(resumeEntry?.reason).toContain("wifi");
  });

  it("environment degradation pauses ACTIVE completions (wifi → cellular)", async () => {
    const { driver, engine } = makeDriver({ mode: "wifi-only" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    expect(driver.stats().activeCompletions.length).toBe(1);
    const report = await driver.onEnvironmentChange({
      networkClass: "cellular",
      charging: true,
    });
    expect(report.outcomes[0]?.transition).toBe("pause");
    expect(report.outcomes[0]?.policyDecision.action).toBe("pause");
    expect(callsOf(engine, "pause").length).toBe(1);
    expect(driver.stats().paused[0]?.cause).toBe("policy");
    const entry = driver.log().find((e) => e.transition === "pause");
    expect(entry?.cause).toBe("environment");
  });

  it("irrelevant environment changes are no-ops (no spurious transitions)", async () => {
    const { driver, engine } = makeDriver({ mode: "wifi-only" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    // charging toggles are irrelevant under wifi-only while on wifi
    const report = await driver.onEnvironmentChange({
      networkClass: "wifi",
      charging: false,
    });
    expect(report.outcomes[0]?.transition).toBeNull();
    expect(callsOf(engine, "pause").length).toBe(0);
    expect(callsOf(engine, "resume").length).toBe(0);
    expect(driver.log().length).toBe(1); // only the initial continue
  });

  it("re-evaluation covers ALL paused sessions in tracking order", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      maxConcurrentCompletions: 3,
      environment: { networkClass: "cellular", charging: true },
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    await driver.onSessionBackground(s1, FACTS);
    await driver.onSessionBackground(s2, FACTS);
    expect(driver.stats().paused.length).toBe(2);
    const report = await driver.onEnvironmentChange({
      networkClass: "wifi",
      charging: true,
    });
    expect(report.outcomes.map((o) => o.transition)).toEqual(["resume", "resume"]);
    expect(driver.stats().activeCompletions).toEqual([s1.id, s2.id]);
  });

  it("malformed environment throws typed INVALID_INPUT", async () => {
    const { driver } = makeDriver({ mode: "always" });
    await expectRejectsInvalidInput(
      driver.onEnvironmentChange({ networkClass: "wimax" } as never),
    );
    await expectRejectsInvalidInput(
      driver.onEnvironmentChange({ networkClass: "wifi", charging: 1 } as never),
    );
  });
});

// ---------------------------------------------------------------------------
// completion driver — concurrency cap + FIFO release
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — concurrency cap & FIFO release", () => {
  it("excess sessions pause with a typed cap reason; FIFO release order", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      maxConcurrentCompletions: 2,
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    const s3 = await openedBackgroundSession(engine);
    const s4 = await openedBackgroundSession(engine);

    const o1 = await driver.onSessionBackground(s1, FACTS);
    const o2 = await driver.onSessionBackground(s2, FACTS);
    expect(o1.transition).toBe("continue");
    expect(o2.transition).toBe("continue");

    for (const outcome of [
      await driver.onSessionBackground(s3, FACTS),
      await driver.onSessionBackground(s4, FACTS),
    ]) {
      expect(outcome.policyDecision.action).toBe("continue"); // policy allows
      expect(outcome.effective.action).toBe("pause"); // cap overrides
      expect(outcome.effective.reason).toContain("maxConcurrentCompletions (2)");
      expect(outcome.effective.reason).toContain("resumable");
      expect(outcome.transition).toBe("pause");
    }
    expect(callsOf(engine, "pause").length).toBe(2);
    expect(driver.stats().activeCompletions).toEqual([s1.id, s2.id]);
    expect(driver.stats().paused.map((p) => p.sessionId)).toEqual([s3.id, s4.id]);
    expect(driver.stats().paused.every((p) => p.cause === "concurrency")).toBe(true);

    // s1 completes ⇒ exactly ONE slot frees ⇒ s3 (FIFO: paused first) resumes.
    const update = await driver.onSessionUpdate(
      { ...s1, state: "complete" },
      { totalBytes: 5_000 },
    );
    expect(update.completed).toBe(true);
    expect(callsOf(engine, "resume").map((c) => c.args[0])).toEqual([s3.id]);
    expect(driver.stats().activeCompletions).toEqual([s2.id, s3.id]);
    expect(driver.stats().paused.map((p) => p.sessionId)).toEqual([s4.id]);

    // s2 completes ⇒ the next slot goes to s4.
    await driver.onSessionUpdate({ ...s2, state: "complete" }, { totalBytes: 6_000 });
    expect(callsOf(engine, "resume").map((c) => c.args[0])).toEqual([s3.id, s4.id]);
    expect(driver.stats().activeCompletions).toEqual([s3.id, s4.id]);
    expect(driver.stats().paused).toEqual([]);
  });

  it("policy-paused sessions do NOT consume freed slots (cap respects policy)", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      maxConcurrentCompletions: 1,
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    await driver.onSessionBackground(s1, FACTS); // active (cap 1/1)
    // Environment degrades ⇒ s1 pauses for POLICY (its slot frees).
    await driver.onEnvironmentChange({ networkClass: "cellular", charging: true });
    expect(driver.stats().paused[0]?.cause).toBe("policy");
    // s2 backgrounds under cellular ⇒ POLICY-paused (the cap slot is free —
    // it must not be consumed by a policy-paused session).
    await driver.onSessionBackground(s2, FACTS);
    expect(driver.stats().paused.map((p) => p.cause)).toEqual(["policy", "policy"]);
    expect(callsOf(engine, "resume").length).toBe(0);
    // wifi returns: s1 takes the single slot; s2 flips to cap-paused.
    await driver.onEnvironmentChange({ networkClass: "wifi", charging: true });
    expect(callsOf(engine, "resume").map((c) => c.args[0])).toEqual([s1.id]);
    expect(driver.stats().activeCompletions).toEqual([s1.id]);
    expect(driver.stats().paused.map((p) => p.cause)).toEqual(["concurrency"]);
    // s1 completes ⇒ the freed slot resumes s2 (cap-paused by now).
    await driver.onSessionUpdate({ ...s1, state: "complete" }, { totalBytes: 1 });
    expect(callsOf(engine, "resume").map((c) => c.args[0])).toEqual([s1.id, s2.id]);
    expect(driver.stats().activeCompletions).toEqual([s2.id]);
  });

  it("cap-paused session flips to policy cause when the environment degrades", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      maxConcurrentCompletions: 1,
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    await driver.onSessionBackground(s1, FACTS); // active
    const o2 = await driver.onSessionBackground(s2, FACTS); // cap-paused
    expect(o2.effective.reason).toContain("maxConcurrentCompletions");
    // wifi → cellular: the cap-paused session re-evaluates to a POLICY pause.
    const report = await driver.onEnvironmentChange({
      networkClass: "cellular",
      charging: true,
    });
    expect(report.outcomes.map((o) => o.transition)).toEqual(["pause", null]);
    expect(driver.stats().paused.map((p) => p.cause)).toEqual([
      "policy",
      "policy",
    ]);
    const causes = driver.log().map((e) => e.cause);
    expect(causes).toContain("environment");
  });
});

// ---------------------------------------------------------------------------
// completion driver — completion detection & events
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — completion detection", () => {
  it("emits the typed CompletionEvent EXACTLY ONCE per completing session", async () => {
    const { driver, engine, events } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);

    const update = await driver.onSessionUpdate(
      { ...session, state: "complete" },
      { totalBytes: 12_345 },
    );
    expect(update.recognized).toBe(true);
    expect(update.completed).toBe(true);
    expect(update.event).toEqual({
      sessionId: session.id,
      assetId: session.assetId,
      completedAt: NOW,
      totalBytes: 12_345,
    });
    expect(events.length).toBe(1);
    expect(events[0]).toEqual(update.event);

    // Pushing the same completing session again: unrecognized, NO second event.
    const again = await driver.onSessionUpdate(
      { ...session, state: "complete" },
      { totalBytes: 12_345 },
    );
    expect(again.recognized).toBe(false);
    expect(again.completed).toBe(false);
    expect(events.length).toBe(1);

    // An untracked session completing never emits.
    const other = await openedBackgroundSession(engine);
    const untracked = await driver.onSessionUpdate(
      { ...other, state: "complete" },
      { totalBytes: 1 },
    );
    expect(untracked.recognized).toBe(false);
    expect(events.length).toBe(1);
    expect(driver.stats().completions).toBe(1);
  });

  it("completion without totalBytes ⇒ typed refusal, no fabricated event", async () => {
    const { driver, engine, events } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    const update = await driver.onSessionUpdate({ ...session, state: "complete" });
    expect(update.completed).toBe(true);
    expect(update.event).toBeUndefined();
    expect(update.completionRefusal).toBeInstanceOf(NativeMediaError);
    expect(update.completionRefusal?.code).toBe("INVALID_INPUT");
    expect(update.completionRefusal?.detail).toContain("totalBytes");
    expect(events.length).toBe(0);
    // The completion itself is still processed: tracked no more, counted.
    expect(driver.stats().trackedSessions).toBe(0);
    expect(driver.stats().completions).toBe(1);
    expect(driver.stats().failureCount).toBe(1);
    expect(driver.stats().lastErrors[0]?.operation).toBe("completion-event");
  });

  it("a throwing sink is a typed failure — the driver survives", async () => {
    const exploding: CompletionSink = {
      onCompletion: () => {
        throw new Error("sink exploded");
      },
    };
    const { driver, engine } = makeDriver({ mode: "always", sink: exploding });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    const update = await driver.onSessionUpdate(
      { ...session, state: "complete" },
      { totalBytes: 100 },
    );
    expect(update.completed).toBe(true);
    expect(update.event).toBeDefined();
    expect(driver.stats().failureCount).toBe(1);
    const entry = driver.log().find((e) => e.transition === "complete");
    expect(entry?.cause).toBe("engine-failure");
    // The driver survives: another session still works end to end.
    const s2 = await openedBackgroundSession(engine);
    const o2 = await driver.onSessionBackground(s2, FACTS);
    expect(o2.transition).toBe("continue");
  });

  it("completed PROTECTED assets are marked persistent (per policy)", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      storage: { protectedItems: ["stub-asset-1"] },
    });
    const session = await openedBackgroundSession(engine); // stub-asset-1
    await driver.onSessionBackground(session, FACTS);
    await driver.onSessionUpdate(
      { ...session, state: "complete" },
      { totalBytes: 10 },
    );
    expect(driver.storage().stats().persistentAssets).toEqual([session.assetId]);
    const entry = driver.log().find((e) => e.transition === "complete");
    expect(entry?.reason).toContain("marked persistent");
  });

  it("failed sessions release their cache and free the slot", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      storage: { maxCacheBytes: 10_000 },
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    await driver.onSessionBackground(s1, FACTS);
    await driver.onSessionBackground(s2, FACTS); // cap (1) ⇒ paused
    expect(driver.storage().admit(s1.assetId, 4_000).ok).toBe(true);
    const update = await driver.onSessionUpdate({ ...s1, state: "failed" });
    expect(update.failed).toBe(true);
    expect(update.release?.ok).toBe(true);
    if (update.release?.ok) {
      expect(update.release.freedBytes).toBe(4_000);
    }
    expect(driver.storage().stats().usedBytes).toBe(0);
    expect(driver.stats().sessionFailures).toBe(1);
    // The failed session's slot was freed ⇒ s2 resumes.
    expect(callsOf(engine, "resume").map((c) => c.args[0])).toEqual([s2.id]);
    const entry = driver.log().find((e) => e.transition === "failed");
    expect(entry?.cause).toBe("session-failure");
    expect(entry?.reason).toContain("released");
  });

  it("non-terminal updates refresh scheduling facts from the snapshot", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    await driver.onSessionUpdate({
      ...session,
      bufferedMs: 90_000,
      positionMs: 30_000,
    });
    // bufferAheadMs derived: 90_000 - 30_000 = 60_000 ⇒ first needed piece 15
    // ⇒ far beyond the background horizon ⇒ empty plan (honest WFX-023 math).
    const report = await driver.tick();
    expect(report.sessions[0]?.planSize).toBe(0);
    expect(report.sessions[0]?.engineCalled).toBe(false);
  });

  it("malformed metrics throw typed INVALID_INPUT", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    await expectRejectsInvalidInput(
      driver.onSessionUpdate({ ...session, state: "complete" }, { totalBytes: 0 }),
    );
    await expectRejectsInvalidInput(
      driver.onSessionUpdate({ ...session, state: "complete" }, { totalBytes: 1.5 } as never),
    );
  });
});

// ---------------------------------------------------------------------------
// completion driver — engine failures (typed, logged, driver survives)
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — engine failures", () => {
  it("engine.pause failure during a policy pause: typed envelope, logged, survives", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      environment: { networkClass: "cellular", charging: true },
    });
    const session = await openedBackgroundSession(engine);
    engine.nextControlError = new Error("pause exploded");
    const outcome = await driver.onSessionBackground(session, FACTS);
    expect(outcome.policyDecision.action).toBe("pause");
    expect(outcome.transition).toBe("pause");
    expect(outcome.engineCalls.length).toBe(1);
    const call = outcome.engineCalls[0];
    expect(call?.operation).toBe("pause");
    expect(call?.result.ok).toBe(false);
    if (call && !call.result.ok) {
      expect(call.result.error).toBeInstanceOf(NativeMediaError);
      expect(call.result.error.code).toBe("INTERNAL");
      expect(call.result.error.retryable).toBe(false);
      expect(call.result.error.sessionId).toBe(session.id);
    }
    const entry = driver.log()[0];
    expect(entry?.transition).toBe("pause");
    expect(entry?.cause).toBe("engine-failure");
    expect(entry?.error?.code).toBe("INTERNAL");
    expect(driver.stats().failureCount).toBe(1);
    expect(driver.stats().lastErrors[0]?.operation).toBe("pause");
    // The driver survives: wifi returns ⇒ resume works.
    const report = await driver.onEnvironmentChange({
      networkClass: "wifi",
      charging: true,
    });
    expect(report.outcomes[0]?.transition).toBe("resume");
    expect(callsOf(engine, "resume").length).toBe(1);
  });

  it("engine.close failure during a cancel: typed envelope, logged, survives", async () => {
    const { driver, engine } = makeDriver({ mode: "never" });
    const session = await openedBackgroundSession(engine);
    engine.nextControlError = new Error("close exploded");
    const outcome = await driver.onSessionBackground(session, FACTS);
    expect(outcome.transition).toBe("cancel");
    expect(outcome.engineCalls[0]?.operation).toBe("close");
    const result = outcome.engineCalls[0]?.result;
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("INTERNAL");
    }
    expect(driver.log()[0]?.cause).toBe("engine-failure");
    expect(driver.stats().failureCount).toBe(1);
    // The session is not tracked (the decision was cancel) and the driver
    // keeps working for the next session.
    expect(driver.stats().trackedSessions).toBe(0);
    const s2 = await openedBackgroundSession(engine);
    const o2 = await driver.onSessionBackground(s2, FACTS);
    expect(o2.transition).toBe("cancel");
    expect(o2.engineCalls[0]?.result.ok).toBe(true);
  });

  it("engine.resume failure during FIFO release: recorded, next candidate tried", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      maxConcurrentCompletions: 1,
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    const s3 = await openedBackgroundSession(engine);
    await driver.onSessionBackground(s1, FACTS);
    await driver.onSessionBackground(s2, FACTS);
    await driver.onSessionBackground(s3, FACTS);
    // s1 completes; s2's resume FAILS at the engine ⇒ s3 is tried next.
    engine.nextControlError = new Error("resume exploded");
    await driver.onSessionUpdate({ ...s1, state: "complete" }, { totalBytes: 1 });
    expect(driver.stats().failureCount).toBe(1);
    expect(driver.stats().lastErrors[0]?.operation).toBe("resume");
    expect(callsOf(engine, "resume").map((c) => c.args[0])).toEqual([s2.id, s3.id]);
    expect(driver.stats().activeCompletions).toEqual([s3.id]);
    const resumeFailure = driver.log().find(
      (e) => e.transition === "resume" && e.cause === "engine-failure",
    );
    expect(resumeFailure?.error?.code).toBe("INTERNAL");
    expect(driver.log().find((e) => e.cause === "slot-freed")?.sessionId).toBe(s3.id);
  });
});

// ---------------------------------------------------------------------------
// completion driver — tick (merged WFX-023 contract, background fairness)
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — tick via the merged WFX-023 contract", () => {
  it("continued sessions schedule at the background tier: reduced horizon, dilated deadlines", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      schedulerConfig: SCHEDULER_CONFIG,
    });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);

    const report: SchedulerTickReport = await driver.tick();
    expect(report.tick).toBe(1);
    expect(report.atMs).toBe(NOW);
    expect(report.sessions.length).toBe(1);
    const result = report.sessions[0];
    expect(result?.sessionId).toBe(session.id);
    expect(result?.engineCalled).toBe(true);
    expect(result?.result.ok).toBe(true);
    // Background horizon = 20_000 * 0.25 = 5_000ms; one piece = 4_000ms
    // (512 kbps over a 256 KiB nominal piece) ⇒ exactly pieces {0, 1}.
    // Deadlines: k=0 clamps to now (immediate); k=1 gets 4_000 / 0.25 slack
    // minus the 1_000 safety margin and the 500ms estimate.
    if (result?.result.ok) {
      expect(result.result.value.batch).toEqual([
        { piece: 0, deadlineMs: NOW },
        { piece: 1, deadlineMs: NOW + 14_500 },
      ]);
    }
    expect(callsOf(engine, "prioritize").length).toBe(1);

    // The foreground-equivalent plan (same demand, state "playing") is
    // strictly larger — background fairness reduces, never starves.
    const foregroundPlan = planPriorities(
      { ...FACTS, sessionId: session.id, state: "playing" },
      SCHEDULER_CONFIG,
      NOW,
      500,
    );
    expect(foregroundPlan.length).toBe(6); // horizon 20_000 / 4_000 ⇒ k 0..5
    if (result) {
      expect(result.planSize).toBe(2);
      expect(result.planSize).toBeLessThan(foregroundPlan.length);
    }
  });

  it("paused and unschedulable sessions are not scheduled", async () => {
    const { driver, engine } = makeDriver({
      mode: "wifi-only",
      environment: { networkClass: "cellular", charging: true },
    });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS); // policy-paused
    const report = await driver.tick();
    expect(report.sessions).toEqual([]);
    expect(callsOf(engine, "prioritize").length).toBe(0);
  });

  it("tick is idempotent with an unchanged clock and facts", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      schedulerConfig: SCHEDULER_CONFIG,
    });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    const first = await driver.tick();
    const second = await driver.tick();
    expect(second.sessions[0]?.result).toEqual(first.sessions[0]?.result);
    expect(second.atMs).toBe(first.atMs);
  });
});

// ---------------------------------------------------------------------------
// completion driver — factory validation & audit trail
// ---------------------------------------------------------------------------

describe("WFX-024 completion driver — factory validation & observability", () => {
  it("factory validation: engine, policy, clock, environment, sink, governor", () => {
    const engine = stubEngine();
    const policy = backgroundPolicy();
    const clock = () => NOW;
    const sink = collectorSink().sink;
    expectThrowsInvalidInput(() =>
      createCompletionDriver(null as never, policy, clock, {
        environment: { networkClass: "wifi", charging: true },
        completionSink: sink,
      }),
    );
    expectThrowsInvalidInput(() =>
      createCompletionDriver({ ...engine, pause: undefined } as never, policy, clock, {
        environment: { networkClass: "wifi", charging: true },
        completionSink: sink,
      }),
    );
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, null as never, clock, {
        environment: { networkClass: "wifi", charging: true },
        completionSink: sink,
      }),
    );
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, policy, "now" as never, {
        environment: { networkClass: "wifi", charging: true },
        completionSink: sink,
      }),
    );
    // The environment is a REQUIRED injection — the driver never assumes
    // network or charging state.
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, policy, clock, {
        completionSink: sink,
      } as never),
    );
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, policy, clock, {
        environment: { networkClass: "ethernet" } as never,
        completionSink: sink,
      }),
    );
    // The sink is a REQUIRED injection — no hidden callbacks.
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, policy, clock, {
        environment: { networkClass: "wifi", charging: true },
      } as never),
    );
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, policy, clock, {
        environment: { networkClass: "wifi", charging: true },
        completionSink: {} as never,
      }),
    );
    expectThrowsInvalidInput(() =>
      createCompletionDriver(engine, policy, clock, {
        environment: { networkClass: "wifi", charging: true },
        completionSink: sink,
        governor: { admit: 1 } as never,
      }),
    );
    // A broken clock refuses to operate (host programmer error).
    const broken = createCompletionDriver(
      engine,
      policy,
      () => Number.NaN,
      { environment: { networkClass: "wifi", charging: true }, completionSink: sink },
    );
    expectRejectsInvalidInput(broken.onSessionBackground(bgSession()));
  });

  it("an injected governor is honored (shared storage across components)", async () => {
    const shared = createStorageGovernor(
      resolveStoragePolicy({ maxCacheBytes: 1_000, minFreeBytes: 0, evictOrder: "fifo" }),
    );
    const engine = stubEngine();
    const { sink } = collectorSink();
    const driver = createCompletionDriver(
      engine,
      backgroundPolicy({ mode: "always" }, { maxCacheBytes: 1_000 }),
      () => NOW,
      {
        environment: { networkClass: "wifi", charging: true },
        completionSink: sink,
        governor: shared,
      },
    );
    expect(driver.storage()).toBe(shared);
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    driver.storage().admit(session.assetId, 300);
    expect(shared.stats().usedBytes).toBe(300);
    expect(shared.stats().sessionBindings).toBe(1);
  });

  it("log() returns the full typed audit trail (defensive copies)", async () => {
    const { driver, engine } = makeDriver({ mode: "always" });
    const session = await openedBackgroundSession(engine);
    await driver.onSessionBackground(session, FACTS);
    const log = driver.log();
    expect(log.length).toBe(1);
    const copy: BackgroundLogEntry[] = [...log];
    copy.push({
      atMs: 0,
      sessionId: "fake",
      assetId: "fake",
      transition: "pause",
      cause: "policy",
      reason: "fake",
    });
    expect(driver.log().length).toBe(1);
    const causes: BackgroundCause[] = driver.log().map((e) => e.cause);
    expect(causes).toEqual(["policy"]);
    expect(driver.log()[0]?.atMs).toBe(NOW);
  });

  it("concurrent operations are serialized in call order (no interleaving)", async () => {
    const { driver, engine } = makeDriver({
      mode: "always",
      maxConcurrentCompletions: 2,
    });
    const s1 = await openedBackgroundSession(engine);
    const s2 = await openedBackgroundSession(engine);
    const [o1, o2] = await Promise.all([
      driver.onSessionBackground(s1, FACTS),
      driver.onSessionBackground(s2, FACTS),
    ]);
    expect(o1.transition).toBe("continue");
    expect(o2.transition).toBe("continue");
    expect(driver.stats().activeCompletions).toEqual([s1.id, s2.id]);
  });
});
