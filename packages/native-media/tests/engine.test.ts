/**
 * @wfx/native-media — engine module tests (WFX-014, Lane B).
 *
 * Covers, per the task packet:
 * 1. Process DTO round-trip — every command/event variant survives
 *    JSON.parse(JSON.stringify(...)) and passes the runtime guards.
 * 2. Simulation engine — open → buffering → playing progression against
 *    a fake asset; seek/pause/resume/close state transitions through the
 *    WFX-004 session FSM; range reads with correct byte offsets; typed
 *    errors for unknown assets; deadline-aware prioritization.
 * 3. Adapter — the in-process pipe + adapter behaves like the direct
 *    simulation (same command sequence → same final states, including
 *    typed error outcomes), timeouts, crash detection.
 * 4. Cache policy — admission under budget, LRU/FIFO eviction order,
 *    zero-budget rejection.
 *
 * TIMING NOTE: the simulation is deterministic as a function of elapsed
 * wall time. Tests either (a) compare saturated fixed points (full
 * download / completed playback, where state is exact) or (b) assert
 * state codes and monotone invariants, never sub-tick timing.
 */

import { afterEach, describe, expect, it } from "bun:test";

import type { NativeMediaSession } from "@wfx/domain";

import {
  createEngineAdapter,
  createInProcessEngineProcess,
  type EngineAdapter,
  type InProcessEngineProcess,
} from "../src/engine/adapter";
import {
  createCacheTracker,
  evict,
  evictList,
  shouldAdmit,
  touch,
  track,
} from "../src/engine/cache";
import {
  errorFromEvent,
  errorToEvent,
  isEngineCommand,
  isEngineEvent,
  isEngineSessionDto,
  PROTOCOL_VERSION,
  sessionFromDto,
  sessionToDto,
  validateEngineConfig,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EngineHandle,
  type NativeEngineProcess,
} from "../src/engine/process";
import {
  createSimulationEngine,
  simulatedAssetSeed,
  simulatedByte,
  type SimulatedAsset,
  type SimulationConfig,
  type SimulationEngine,
} from "../src/engine/simulation";
import {
  createNativeMediaService,
  NativeMediaError,
  type NativeMediaErrorCode,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A small fast asset: 8 pieces of 1000 bytes, 300ms duration, ~8ms/piece. */
function fastAsset(): SimulatedAsset {
  return { totalBytes: 8000, durationMs: 300, pieceCount: 8 };
}

const FAST_SIM: SimulationConfig = {
  assets: { "/media/fast.mkv": fastAsset() },
  bytesPerSecond: 1_000_000, // 1000 bytes/ms -> one piece per ms
  tickMs: 5,
  rebufferLeadMs: 50,
};

const LOCAL_SOURCE = { localPath: "/media/fast.mkv" };

/** Registry of everything that owns a timer; disposed after each test. */
const disposables: { dispose(): void }[] = [];

function trackDisposable(d: { dispose(): void }): void {
  disposables.push(d);
}

afterEach(() => {
  while (disposables.length > 0) {
    const d = disposables.pop();
    if (d !== undefined) d.dispose();
  }
});

function makeSim(config: SimulationConfig = FAST_SIM): SimulationEngine {
  const engine = createSimulationEngine(config);
  trackDisposable(engine);
  return engine;
}

function makeAdapter(
  config: SimulationConfig = FAST_SIM,
  callTimeoutMs?: number,
): { adapter: EngineAdapter; process: InProcessEngineProcess } {
  const proc = createInProcessEngineProcess({ simulation: config });
  const adapter = createEngineAdapter(
    proc,
    { cacheDir: "/tmp/wfx-engine-test-cache", maxCacheBytes: 1_000_000 },
    callTimeoutMs === undefined ? {} : { callTimeoutMs },
  );
  trackDisposable(adapter);
  return { adapter, process: proc };
}

async function expectEngineError(
  promise: Promise<unknown>,
  code: NativeMediaErrorCode,
): Promise<NativeMediaError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(NativeMediaError);
    const nme = e as NativeMediaError;
    expect(nme.code).toBe(code);
    return nme;
  }
  throw new Error(`expected a typed engine error (${code}), got success`);
}

function expectedBytes(key: string, start: number, end: number): Uint8Array {
  const seed = simulatedAssetSeed(key);
  const out = new Uint8Array(end - start + 1);
  for (let i = start; i <= end; i += 1) {
    out[i - start] = simulatedByte(seed, i);
  }
  return out;
}

/** A process whose handle never answers — for ENGINE_TIMEOUT tests. */
function hangingProcess(): NativeEngineProcess {
  const handle: EngineHandle = {
    send() {
      return new Promise<EngineEvent>(() => {});
    },
    onEvent() {
      return () => {};
    },
    terminate() {},
  };
  return { spawn: () => handle };
}

const ENGINE_CONFIG: EngineConfig = {
  cacheDir: "/tmp/wfx-engine-test-cache",
  maxCacheBytes: 1_000_000,
};

// ---------------------------------------------------------------------------
// 1. Process DTO round-trip
// ---------------------------------------------------------------------------

describe("engine process — wire DTO round-trip", () => {
  const commands: EngineCommand[] = [
    {
      protocolVersion: PROTOCOL_VERSION,
      kind: "open",
      source: { magnet: "magnet:?xt=urn:btih:abcdef" },
    },
    { protocolVersion: PROTOCOL_VERSION, kind: "open", source: { localPath: "/m/a.mkv" } },
    { protocolVersion: PROTOCOL_VERSION, kind: "seek", sessionId: "s1", positionMs: 42_500 },
    {
      protocolVersion: PROTOCOL_VERSION,
      kind: "prioritize",
      sessionId: "s1",
      deadlines: [
        { piece: 3, deadlineMs: 0 },
        { piece: 7, deadlineMs: 1200.5 },
      ],
    },
    { protocolVersion: PROTOCOL_VERSION, kind: "pause", sessionId: "s1" },
    { protocolVersion: PROTOCOL_VERSION, kind: "resume", sessionId: "s1" },
    { protocolVersion: PROTOCOL_VERSION, kind: "close", sessionId: "s1" },
  ];

  it("every command variant survives a JSON round-trip unchanged", () => {
    for (const command of commands) {
      const wire = JSON.parse(JSON.stringify(command)) as EngineCommand;
      expect(isEngineCommand(wire)).toBe(true);
      expect(wire).toEqual(command);
    }
  });

  it("every event variant survives a JSON round-trip unchanged", () => {
    const events: EngineEvent[] = [
      { protocolVersion: PROTOCOL_VERSION, kind: "progress", sessionId: "s1", positionMs: 1000 },
      { protocolVersion: PROTOCOL_VERSION, kind: "buffered", sessionId: "s1", bufferedMs: 5000 },
      {
        protocolVersion: PROTOCOL_VERSION,
        kind: "state-changed",
        session: {
          id: "s1",
          assetId: "a1",
          fileId: "f1",
          state: "playing",
          bufferedMs: 5000,
          positionMs: 1000,
        },
      },
      { protocolVersion: PROTOCOL_VERSION, kind: "error", code: "NOT_FOUND" },
      { protocolVersion: PROTOCOL_VERSION, kind: "error", code: "IO_ERROR", detail: "boom", sessionId: "s1" },
    ];
    for (const event of events) {
      const wire = JSON.parse(JSON.stringify(event)) as EngineEvent;
      expect(isEngineEvent(wire)).toBe(true);
      expect(wire).toEqual(event);
    }
  });

  it("guards reject a wrong protocol version", () => {
    const futureCommand = {
      protocolVersion: PROTOCOL_VERSION + 1,
      kind: "pause",
      sessionId: "s1",
    };
    const futureEvent = {
      protocolVersion: PROTOCOL_VERSION + 1,
      kind: "progress",
      sessionId: "s1",
      positionMs: 1,
    };
    expect(isEngineCommand(futureCommand)).toBe(false);
    expect(isEngineEvent(futureEvent)).toBe(false);
  });

  it("guards reject malformed DTOs", () => {
    expect(isEngineCommand({ protocolVersion: 1, kind: "open", source: {} })).toBe(false);
    expect(isEngineCommand({ protocolVersion: 1, kind: "seek", sessionId: "s1" })).toBe(false);
    expect(isEngineCommand({ protocolVersion: 1, kind: "pause" })).toBe(false);
    expect(
      isEngineCommand({
        protocolVersion: 1,
        kind: "prioritize",
        sessionId: "s1",
        deadlines: [{ piece: -1, deadlineMs: 5 }],
      }),
    ).toBe(false);
    expect(isEngineCommand({ protocolVersion: 1, kind: "explode", sessionId: "s1" })).toBe(false);
    expect(isEngineEvent({ protocolVersion: 1, kind: "progress", sessionId: "s1", positionMs: -1 })).toBe(false);
    expect(isEngineEvent({ protocolVersion: 1, kind: "buffered", sessionId: "", bufferedMs: 1 })).toBe(false);
    expect(
      isEngineEvent({
        protocolVersion: 1,
        kind: "state-changed",
        session: { id: "s1", state: "playing" },
      }),
    ).toBe(false);
    expect(isEngineEvent({ protocolVersion: 1, kind: "error", code: "NOT_A_CODE" })).toBe(false);
    expect(isEngineSessionDto({ id: "s1", state: "paused" })).toBe(false);
  });

  it("session DTO mappers round-trip and reject malformed input", () => {
    const session: NativeMediaSession = {
      id: "s1",
      assetId: "a1",
      fileId: "f1",
      state: "background",
      bufferedMs: 12_000,
      positionMs: 3000,
      integrity: "unknown",
    };
    const wire = JSON.parse(JSON.stringify(sessionToDto(session)));
    expect(isEngineSessionDto(wire)).toBe(true);
    expect(sessionFromDto(wire)).toEqual(session);
    expect(() => sessionFromDto({ id: "s1", state: "playing" })).toThrow(NativeMediaError);
    try {
      sessionToDto({ ...session, state: "nope" as never });
      throw new Error("expected INTERNAL");
    } catch (e) {
      expect((e as NativeMediaError).code).toBe("INTERNAL");
    }
  });

  it("error DTOs round-trip with code, detail, sessionId and retryable", () => {
    const original = new NativeMediaError("ENGINE_TIMEOUT", {
      detail: "deadline missed",
      sessionId: "s1",
    });
    const wire = JSON.parse(JSON.stringify(errorToEvent(original)));
    expect(isEngineEvent(wire)).toBe(true);
    const rebuilt = errorFromEvent(wire as Extract<EngineEvent, { kind: "error" }>);
    expect(rebuilt.code).toBe("ENGINE_TIMEOUT");
    expect(rebuilt.detail).toBe("deadline missed");
    expect(rebuilt.sessionId).toBe("s1");
    expect(rebuilt.retryable).toBe(true);
    const fatal = errorFromEvent(
      JSON.parse(JSON.stringify(errorToEvent(new NativeMediaError("VERIFICATION_FAILED")))) as Extract<
        EngineEvent,
        { kind: "error" }
      >,
    );
    expect(fatal.code).toBe("VERIFICATION_FAILED");
    expect(fatal.retryable).toBe(false);
  });

  it("validateEngineConfig accepts valid configs and rejects malformed ones", () => {
    expect(() => validateEngineConfig(ENGINE_CONFIG)).not.toThrow();
    expect(() => validateEngineConfig({ ...ENGINE_CONFIG, socketPath: "/tmp/wfx.sock" })).not.toThrow();
    for (const bad of [
      { ...ENGINE_CONFIG, cacheDir: "" },
      { ...ENGINE_CONFIG, cacheDir: 42 },
      { ...ENGINE_CONFIG, maxCacheBytes: -1 },
      { ...ENGINE_CONFIG, maxCacheBytes: Number.NaN },
      { ...ENGINE_CONFIG, socketPath: " " },
      null,
    ]) {
      try {
        validateEngineConfig(bad);
        throw new Error("expected INVALID_INPUT");
      } catch (e) {
        expect((e as NativeMediaError).code).toBe("INVALID_INPUT");
      }
    }
  });

  it("the in-process pipe validates its config and refuses terminated handles", async () => {
    const proc = createInProcessEngineProcess({ simulation: FAST_SIM });
    expect(() => proc.spawn({ cacheDir: "", maxCacheBytes: 1 })).toThrow(NativeMediaError);
    const handle = proc.spawn(ENGINE_CONFIG);
    handle.terminate(); // disposes the backing simulation
    handle.terminate(); // idempotent
    await expectEngineError(
      handle.send({ protocolVersion: PROTOCOL_VERSION, kind: "pause", sessionId: "x" }),
      "INVALID_INPUT",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Simulation engine
// ---------------------------------------------------------------------------

describe("simulation engine — typed source resolution", () => {
  it("rejects unknown assets with NOT_FOUND", async () => {
    const sim = makeSim();
    const error = await expectEngineError(
      sim.open({ magnet: "magnet:?xt=urn:btih:missing" }),
      "NOT_FOUND",
    );
    expect(error.detail).toContain("magnet:?xt=urn:btih:missing");
  });

  it("rejects torrentBytes sources with UNSUPPORTED_SOURCE", async () => {
    const sim = makeSim();
    await expectEngineError(
      sim.open({ torrentBytes: new Uint8Array([1, 2, 3]) }),
      "UNSUPPORTED_SOURCE",
    );
  });

  it("rejects empty/malformed input with INVALID_INPUT", async () => {
    const sim = makeSim();
    await expectEngineError(sim.open({}), "INVALID_INPUT");
    await expectEngineError(sim.open({ magnet: "not-a-magnet" }), "INVALID_INPUT");
    await expectEngineError(sim.open({ magnet: "" }), "INVALID_INPUT");
  });

  it("derives stable asset/file ids from the registry key", async () => {
    const sim = makeSim();
    const first = await sim.open(LOCAL_SOURCE);
    const second = await sim.open(LOCAL_SOURCE);
    expect(first.assetId).toBe(second.assetId);
    expect(first.fileId).toBe(second.fileId);
    expect(first.id).not.toBe(second.id);
    expect(first.state).toBe("buffering");
    expect(first.bufferedMs).toBe(0);
    expect(first.positionMs).toBe(0);
  });
});

describe("simulation engine — buffering and playback progression", () => {
  it("fills the buffered-through marker to duration without auto-playing", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sleep(80); // full download takes ~8ms at 1MB/s
    const snapshot = sim.snapshot(session.id);
    expect(snapshot).toBeDefined();
    expect(snapshot?.state).toBe("buffering");
    expect(snapshot?.bufferedMs).toBe(300);
    expect(snapshot?.positionMs).toBe(0);
  });

  it("progresses buffering -> playing -> complete through the FSM", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sim.resume(session.id);
    await sleep(80);
    expect(sim.snapshot(session.id)?.state).toBe("playing");
    // Playback takes 300ms at 1x (plus up to rebufferLeadMs of startup).
    await sleep(450);
    const final = sim.snapshot(session.id);
    expect(final?.state).toBe("complete");
    expect(final?.positionMs).toBe(300);
    expect(final?.bufferedMs).toBe(300);
  });

  it("pause freezes the playback clock but keeps downloading (no paused state)", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sim.resume(session.id);
    await sleep(120);
    await sim.pause(session.id);
    const frozen = sim.snapshot(session.id);
    expect(frozen?.state).toBe("playing"); // pause is not a state
    await sleep(90);
    const after = sim.snapshot(session.id);
    expect(after?.state).toBe("playing");
    expect(after?.positionMs).toBe(frozen?.positionMs); // clock frozen
    expect(after?.bufferedMs).toBe(300); // download continued
    await sim.resume(session.id);
    await sleep(500);
    expect(sim.snapshot(session.id)?.state).toBe("complete");
  });

  it("seek moves the playhead and re-cursors the download", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sim.seek(session.id, 150);
    expect(sim.snapshot(session.id)?.positionMs).toBe(150);
    await sleep(80);
    const snapshot = sim.snapshot(session.id);
    // After the re-cursor the contiguous run from the playhead reaches
    // the end of the media first; the backfill before the seek point may
    // still be running, but the playhead never moves without a resume.
    expect(snapshot?.positionMs).toBe(150);
    expect(snapshot?.bufferedMs).toBe(300);
  });

  it("rejects seeks outside [0, durationMs] and on unknown sessions", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await expectEngineError(sim.seek(session.id, -1), "INVALID_INPUT");
    await expectEngineError(sim.seek(session.id, 301), "INVALID_INPUT");
    await expectEngineError(sim.seek("nope", 10), "NOT_FOUND");
  });

  it("close releases the session; further operations are typed errors", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sim.close(session.id);
    expect(sim.snapshot(session.id)).toBeUndefined();
    await expectEngineError(sim.seek(session.id, 10), "SESSION_CLOSED");
    await expectEngineError(sim.resume(session.id), "SESSION_CLOSED");
    await expectEngineError(sim.statMedia(session.id), "SESSION_CLOSED");
    await expectEngineError(sim.readRange(session.id, 0, 9), "SESSION_CLOSED");
    await expectEngineError(sim.close("nope"), "NOT_FOUND");
    await sim.close(session.id); // idempotent double-close
  });

  it("control on terminal sessions answers SESSION_CLOSED", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sim.resume(session.id);
    await sleep(450);
    expect(sim.snapshot(session.id)?.state).toBe("complete");
    await expectEngineError(sim.pause(session.id), "SESSION_CLOSED");
    await expectEngineError(sim.seek(session.id, 0), "SESSION_CLOSED");
  });

  it("emits update notifications for state and telemetry changes", async () => {
    const sim = makeSim();
    const updates: NativeMediaSession[] = [];
    sim.onUpdate((s) => updates.push({ ...s }));
    const session = await sim.open(LOCAL_SOURCE);
    await sim.resume(session.id);
    await sleep(120);
    const states = updates.filter((u) => u.id === session.id).map((u) => u.state);
    expect(states).toContain("playing");
    expect(updates.some((u) => u.bufferedMs > 0 && u.id === session.id)).toBe(true);
  });
});

describe("simulation engine — range reads over the piece buffer", () => {
  it("serves the exact deterministic bytes once pieces are downloaded", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await sleep(80); // fully downloaded
    const stats = await sim.statMedia(session.id);
    expect(stats.totalBytes).toBe(8000);
    expect(stats.contentType).toBe("application/octet-stream");
    expect(await sim.readRange(session.id, 0, 1023)).toEqual(
      expectedBytes("/media/fast.mkv", 0, 1023),
    );
    expect(await sim.readRange(session.id, 3995, 4005)).toEqual(
      expectedBytes("/media/fast.mkv", 3995, 4005),
    );
    expect(await sim.readRange(session.id, 7990, 7999)).toEqual(
      expectedBytes("/media/fast.mkv", 7990, 7999),
    );
  });

  it("fails with a retryable IO_ERROR while pieces are missing", async () => {
    const sim = makeSim({ ...FAST_SIM, bytesPerSecond: 20_000 }); // 1 piece per 50ms
    const session = await sim.open(LOCAL_SOURCE);
    await sleep(60); // ~1 piece downloaded
    const error = await expectEngineError(sim.readRange(session.id, 4000, 4999), "IO_ERROR");
    expect(error.retryable).toBe(true);
    await sleep(600); // fully downloaded by then (400ms needed)
    expect(await sim.readRange(session.id, 4000, 4999)).toEqual(
      expectedBytes("/media/fast.mkv", 4000, 4999),
    );
  });

  it("handles ragged (non-equal) piece sizes exactly", async () => {
    const sim = makeSim({
      assets: {
        "/media/ragged.mkv": { totalBytes: 10, durationMs: 30, pieceCount: 3 },
      },
      bytesPerSecond: 1_000_000,
      tickMs: 5,
    });
    const session = await sim.open({ localPath: "/media/ragged.mkv" });
    await sleep(30); // pieces 3+3+4 bytes -> fully downloaded
    expect(sim.snapshot(session.id)?.bufferedMs).toBe(30); // exact through the fat last piece
    expect(await sim.readRange(session.id, 0, 9)).toEqual(
      expectedBytes("/media/ragged.mkv", 0, 9),
    );
    await expectEngineError(sim.readRange(session.id, 0, 10), "RANGE_NOT_SATISFIABLE");
  });

  it("rejects malformed and unsatisfiable intervals with typed errors", async () => {
    const sim = makeSim();
    const session = await sim.open(LOCAL_SOURCE);
    await expectEngineError(sim.readRange(session.id, -1, 10), "INVALID_INPUT");
    await expectEngineError(sim.readRange(session.id, 10, 5), "INVALID_INPUT");
    await expectEngineError(sim.readRange(session.id, 0, 8000), "RANGE_NOT_SATISFIABLE");
    await expectEngineError(sim.readRange("nope", 0, 9), "NOT_FOUND");
  });
});

describe("simulation engine — deadline-aware prioritization", () => {
  // 10 pieces of 1000 bytes; throughput 12_500 B/s -> one piece per 80ms.
  const SLOW_SIM: SimulationConfig = {
    assets: {
      "/media/slow.mkv": { totalBytes: 10_000, durationMs: 1000, pieceCount: 10 },
    },
    bytesPerSecond: 12_500,
    tickMs: 5,
  };

  it("hoists deadline pieces ahead of the sequential order", async () => {
    const sim = makeSim(SLOW_SIM);
    const session = await sim.open({ localPath: "/media/slow.mkv" });
    await sim.prioritize(session.id, [{ piece: 9, deadlineMs: 0 }]);
    await sleep(250); // ~3 pieces downloaded
    expect(await sim.readRange(session.id, 9000, 9999)).toEqual(
      expectedBytes("/media/slow.mkv", 9000, 9999),
    );
    await expectEngineError(sim.readRange(session.id, 7000, 7999), "IO_ERROR");
  });

  it("sequential (unprioritized) download leaves late pieces missing", async () => {
    const sim = makeSim(SLOW_SIM);
    const session = await sim.open({ localPath: "/media/slow.mkv" });
    await sleep(250); // ~3 pieces downloaded: 0, 1, 2
    await expectEngineError(sim.readRange(session.id, 9000, 9999), "IO_ERROR");
    expect(await sim.readRange(session.id, 0, 999)).toEqual(
      expectedBytes("/media/slow.mkv", 0, 999),
    );
  });

  it("validates deadline input", async () => {
    const sim = makeSim(SLOW_SIM);
    const session = await sim.open({ localPath: "/media/slow.mkv" });
    await expectEngineError(sim.prioritize(session.id, [{ piece: 10, deadlineMs: 0 }]), "INVALID_INPUT");
    await expectEngineError(sim.prioritize(session.id, [{ piece: 0, deadlineMs: -1 }]), "INVALID_INPUT");
    await expectEngineError(sim.prioritize("nope", []), "NOT_FOUND");
  });
});

describe("simulation engine — works under the WFX-004 service envelope", () => {
  it("serves range requests end-to-end through createNativeMediaService", async () => {
    const sim = makeSim();
    const service = createNativeMediaService(sim);
    const opened = await service.open(LOCAL_SOURCE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("unreachable");
    const played = await service.control(opened.value.id, { kind: "play" });
    expect(played.ok).toBe(true);
    await sleep(80);
    const range = await service.range({
      sessionId: opened.value.id,
      startByte: 100,
      endByte: 355,
    });
    expect(range.ok).toBe(true);
    if (!range.ok) throw new Error("unreachable");
    expect(range.value.data).toEqual(expectedBytes("/media/fast.mkv", 100, 355));
    expect(range.value.totalBytes).toBe(8000);
    const closed = await service.control(opened.value.id, { kind: "close" });
    expect(closed.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Adapter
// ---------------------------------------------------------------------------

describe("adapter — in-process pipe behaves like the direct simulation", () => {
  it("same command sequence -> identical saturated final snapshots", async () => {
    const direct = makeSim();
    const { adapter } = makeAdapter();

    const directSession = await direct.open(LOCAL_SOURCE);
    const adapterSession = await adapter.open(LOCAL_SOURCE);
    expect(adapterSession).toEqual(directSession); // identical open snapshots

    await sleep(60);
    await direct.resume(directSession.id);
    await adapter.resume(adapterSession.id);
    await sleep(60);
    // Mid-flight: identical states (ms fields are timing-dependent).
    expect(adapter.snapshot(adapterSession.id)?.state).toBe(
      direct.snapshot(directSession.id)?.state,
    );

    await direct.seek(directSession.id, 200);
    await adapter.seek(adapterSession.id, 200);
    await sleep(550); // saturated: playback complete, backfill complete

    const directFinal = direct.snapshot(directSession.id);
    const adapterFinal = adapter.snapshot(adapterSession.id);
    expect(adapterFinal).toBeDefined();
    expect(directFinal).toBeDefined();
    expect(adapterFinal).toEqual(directFinal); // exact deep equality
    expect(adapterFinal?.state).toBe("complete");
    expect(adapterFinal?.positionMs).toBe(300);
    expect(adapterFinal?.bufferedMs).toBe(300);
  });

  it("same failing commands -> identical typed error codes", async () => {
    const direct = makeSim();
    const { adapter } = makeAdapter();

    const directMiss = await expectEngineError(
      direct.open({ magnet: "magnet:?xt=urn:btih:missing" }),
      "NOT_FOUND",
    );
    const adapterMiss = await expectEngineError(
      adapter.open({ magnet: "magnet:?xt=urn:btih:missing" }),
      "NOT_FOUND",
    );
    expect(adapterMiss.code).toBe(directMiss.code);

    await expectEngineError(direct.open({ torrentBytes: new Uint8Array([1]) }), "UNSUPPORTED_SOURCE");
    await expectEngineError(adapter.open({ torrentBytes: new Uint8Array([1]) }), "UNSUPPORTED_SOURCE");
    await expectEngineError(direct.open({}), "INVALID_INPUT");
    await expectEngineError(adapter.open({}), "INVALID_INPUT");

    const directSession = await direct.open(LOCAL_SOURCE);
    const adapterSession = await adapter.open(LOCAL_SOURCE);
    await expectEngineError(direct.seek(directSession.id, 9999), "INVALID_INPUT");
    await expectEngineError(adapter.seek(adapterSession.id, 9999), "INVALID_INPUT");
    await expectEngineError(direct.seek("nope", 1), "NOT_FOUND");
    await expectEngineError(adapter.seek("nope", 1), "NOT_FOUND");

    await direct.close(directSession.id);
    await adapter.close(adapterSession.id);
    await expectEngineError(direct.resume(directSession.id), "SESSION_CLOSED");
    await expectEngineError(adapter.resume(adapterSession.id), "SESSION_CLOSED");
  });

  it("close bookkeeping matches the direct simulation", async () => {
    const direct = makeSim();
    const { adapter } = makeAdapter();
    const d = await direct.open(LOCAL_SOURCE);
    const a = await adapter.open(LOCAL_SOURCE);
    await direct.close(d.id);
    await adapter.close(a.id);
    expect(adapter.snapshot(a.id)).toBeUndefined();
    expect(direct.snapshot(d.id)).toBeUndefined();
    await adapter.close(a.id); // idempotent, like the simulation
  });

  it("adapter session updates stream state changes to listeners", async () => {
    const { adapter } = makeAdapter();
    const states: string[] = [];
    adapter.onSessionUpdate((update) => states.push(update.session.state));
    const session = await adapter.open(LOCAL_SOURCE);
    await adapter.resume(session.id);
    await sleep(120);
    expect(states[0]).toBe("buffering");
    expect(states).toContain("playing");
  });
});

describe("adapter — timeouts, crashes, disposal, unsupported surface", () => {
  it("a silent engine misses the wire deadline with a retryable ENGINE_TIMEOUT", async () => {
    const adapter = createEngineAdapter(hangingProcess(), ENGINE_CONFIG, {
      callTimeoutMs: 25,
    });
    trackDisposable(adapter);
    const error = await expectEngineError(adapter.open(LOCAL_SOURCE), "ENGINE_TIMEOUT");
    expect(error.retryable).toBe(true);
    expect(error.detail).toContain("25ms");
  });

  it("a process error fails every live session with typed INTERNAL errors", async () => {
    const { adapter, process } = makeAdapter();
    const failures: { sessionId: string; code: NativeMediaErrorCode; detail?: string }[] = [];
    adapter.onSessionUpdate((update) => {
      if (update.failure !== undefined) {
        const entry: { sessionId: string; code: NativeMediaErrorCode; detail?: string } = {
          sessionId: update.session.id,
          code: update.failure.code,
        };
        if (update.failure.detail !== undefined) entry.detail = update.failure.detail;
        failures.push(entry);
      }
    });
    const first = await adapter.open(LOCAL_SOURCE);
    const second = await adapter.open(LOCAL_SOURCE);
    await adapter.resume(first.id);

    process.simulateCrash("simulated subprocess death");

    expect(failures).toHaveLength(2);
    expect(failures.every((f) => f.code === "INTERNAL")).toBe(true);
    expect(failures.every((f) => f.detail?.includes("simulated subprocess death"))).toBe(true);
    expect(adapter.snapshot(first.id)?.state).toBe("failed");
    expect(adapter.snapshot(second.id)?.state).toBe("failed");
    // Subsequent operations surface the crash as typed INTERNAL errors.
    const controlError = await expectEngineError(adapter.pause(second.id), "INTERNAL");
    expect(controlError.detail).toContain("engine process failed");
    const openError = await expectEngineError(adapter.open(LOCAL_SOURCE), "INTERNAL");
    expect(openError.detail).toContain("engine process failed");
  });

  it("dispose is idempotent and disables the adapter with typed errors", async () => {
    const { adapter } = makeAdapter();
    const session = await adapter.open(LOCAL_SOURCE);
    adapter.dispose();
    adapter.dispose();
    await expectEngineError(adapter.resume(session.id), "INVALID_INPUT");
  });

  it("does not implement the range extension — the service answers typed UNSUPPORTED_SOURCE", async () => {
    const { adapter } = makeAdapter();
    const service = createNativeMediaService(adapter);
    const opened = await service.open(LOCAL_SOURCE);
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("unreachable");
    const range = await service.range({
      sessionId: opened.value.id,
      startByte: 0,
      endByte: 9,
    });
    expect(range.ok).toBe(false);
    if (range.ok) throw new Error("unreachable");
    expect(range.error.code).toBe("UNSUPPORTED_SOURCE");
    expect(range.error.detail).toContain("range-access extension");
    await service.control(opened.value.id, { kind: "close" });
  });

  it("validates its own construction input", () => {
    expect(() => createEngineAdapter(null as never, ENGINE_CONFIG)).toThrow(NativeMediaError);
    expect(() =>
      createEngineAdapter({} as never, ENGINE_CONFIG),
    ).toThrow(NativeMediaError);
    expect(() =>
      createEngineAdapter(hangingProcess(), { cacheDir: "", maxCacheBytes: 1 }),
    ).toThrow(NativeMediaError);
    expect(() =>
      createEngineAdapter(hangingProcess(), ENGINE_CONFIG, { callTimeoutMs: -1 }),
    ).toThrow(NativeMediaError);
  });
});

// ---------------------------------------------------------------------------
// 4. Cache policy
// ---------------------------------------------------------------------------

describe("cache policy — tracker construction and validation", () => {
  it("rejects malformed policies with INVALID_INPUT", () => {
    for (const bad of [
      { maxBytes: -1, evictOrder: "lru" },
      { maxBytes: 1.5, evictOrder: "lru" },
      { maxBytes: 100, evictOrder: "mru" },
      { maxBytes: 100 },
      null,
    ]) {
      try {
        createCacheTracker(bad as never);
        throw new Error("expected INVALID_INPUT");
      } catch (e) {
        expect((e as NativeMediaError).code).toBe("INVALID_INPUT");
      }
    }
  });

  it("rejects malformed accounting input with INVALID_INPUT", () => {
    let tracker = createCacheTracker({ maxBytes: 1000, evictOrder: "lru" });
    tracker = track(tracker, "a", 400);
    expect(() => track(tracker, "a", 100)).toThrow(NativeMediaError); // duplicate
    expect(() => track(tracker, "", 100)).toThrow(NativeMediaError);
    expect(() => track(tracker, "b", 0)).toThrow(NativeMediaError);
    expect(() => touch(tracker, "missing")).toThrow(NativeMediaError);
    expect(() => evict(tracker, ["missing"])).toThrow(NativeMediaError);
    expect(() => evict(tracker, ["a", "a"])).toThrow(NativeMediaError);
    expect(() => shouldAdmit(tracker, -5)).toThrow(NativeMediaError);
    expect(() => evictList(tracker, 1.5)).toThrow(NativeMediaError);
  });
});

describe("cache policy — admission under budget", () => {
  it("admits while the budget holds and refuses past it", () => {
    let tracker = createCacheTracker({ maxBytes: 1000, evictOrder: "lru" });
    expect(shouldAdmit(tracker, 1000)).toBe(true);
    tracker = track(tracker, "a", 400);
    expect(shouldAdmit(tracker, 600)).toBe(true);
    expect(shouldAdmit(tracker, 601)).toBe(false);
    tracker = track(tracker, "b", 600);
    expect(shouldAdmit(tracker, 1)).toBe(false);
    expect(shouldAdmit(tracker, 0)).toBe(true); // degenerate zero-byte query
  });

  it("zero-budget policies reject every positive admission", () => {
    const tracker = createCacheTracker({ maxBytes: 0, evictOrder: "fifo" });
    expect(shouldAdmit(tracker, 1)).toBe(false);
    expect(shouldAdmit(tracker, 0)).toBe(true); // degenerate zero-byte query
    expect(evictList(tracker, 1)).toEqual([]); // nothing to evict, still no room
    // An entry larger than the whole budget never fits, even after a full
    // eviction: evictList names everything, the re-check still fails.
    let full = createCacheTracker({ maxBytes: 100, evictOrder: "fifo" });
    full = track(full, "a", 60);
    full = track(full, "b", 60);
    expect(evictList(full, 500)).toEqual(["a", "b"]);
    const emptied = evict(full, ["a", "b"]);
    expect(shouldAdmit(emptied, 500)).toBe(false);
    expect(shouldAdmit(emptied, 100)).toBe(true);
  });
});

describe("cache policy — LRU eviction order", () => {
  it("evicts least-recently-used entries first, honoring touch", () => {
    let tracker = createCacheTracker({ maxBytes: 1000, evictOrder: "lru" });
    tracker = track(tracker, "a", 300);
    tracker = track(tracker, "b", 300);
    tracker = track(tracker, "c", 300);
    expect(shouldAdmit(tracker, 200)).toBe(false);
    expect(evictList(tracker, 200)).toEqual(["a"]); // a is oldest
    tracker = touch(tracker, "a"); // a becomes most recent
    expect(evictList(tracker, 200)).toEqual(["b"]); // b is now the victim
    expect(evictList(tracker, 500)).toEqual(["b", "c"]);
    expect(evictList(tracker, 1200)).toEqual(["b", "c", "a"]); // never fits
    // Applying the computed eviction makes room (only "a" remains, 300 bytes).
    tracker = evict(tracker, evictList(tracker, 500));
    expect(tracker.usedBytes).toBe(300);
    expect(shouldAdmit(tracker, 700)).toBe(true);
    expect(shouldAdmit(tracker, 701)).toBe(false);
  });
});

describe("cache policy — FIFO eviction order", () => {
  it("evicts oldest-inserted entries first and ignores touch", () => {
    let tracker = createCacheTracker({ maxBytes: 1000, evictOrder: "fifo" });
    tracker = track(tracker, "a", 300);
    tracker = track(tracker, "b", 300);
    tracker = track(tracker, "c", 300);
    tracker = touch(tracker, "a"); // accepted, does NOT reorder under fifo
    expect(evictList(tracker, 200)).toEqual(["a"]);
    expect(evictList(tracker, 500)).toEqual(["a", "b"]);
    tracker = evict(tracker, ["a", "b"]);
    expect(tracker.usedBytes).toBe(300);
    expect(tracker.entries.map((e) => e.key)).toEqual(["c"]);
    expect(shouldAdmit(tracker, 700)).toBe(true);
  });

  it("over-budget trackers report the full rebalance eviction list", () => {
    let tracker = createCacheTracker({ maxBytes: 100, evictOrder: "fifo" });
    tracker = track(tracker, "a", 60);
    tracker = track(tracker, "b", 60);
    expect(tracker.usedBytes).toBe(120);
    expect(evictList(tracker, 0)).toEqual(["a"]); // rebalance to budget
    expect(evictList(tracker, 50)).toEqual(["a", "b"]); // needs both
    const rebalanced = evict(tracker, evictList(tracker, 0)); // evicts "a"
    expect(rebalanced.usedBytes).toBe(60);
    expect(shouldAdmit(rebalanced, 40)).toBe(true);
    expect(shouldAdmit(rebalanced, 41)).toBe(false);
    const emptied = evict(tracker, evictList(tracker, 50)); // evicts both
    expect(emptied.usedBytes).toBe(0);
    expect(shouldAdmit(emptied, 100)).toBe(true);
    expect(shouldAdmit(emptied, 101)).toBe(false);
  });
});
