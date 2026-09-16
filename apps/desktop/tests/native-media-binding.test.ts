/**
 * R08 — the native-media binding tests (THE R10 SEAM).
 *
 * The spawn/attach protocol against the simulated engine process: the
 * frozen DTO wire (commands in, state-changed acks + spontaneous
 * telemetry out), session mapping, THE INTEGRITY LAW (engine-sourced
 * verdicts only — never fabricated), the crash law, typed failures, the
 * R10/R12 seam honesty (readRange/prioritize), and wire-deadline
 * enforcement. Deterministic: no network, no real process spawn — the
 * simulated engine speaks the real DTO protocol through a JSON wire and
 * the frozen runtime guards.
 */

import { describe, expect, it } from "bun:test";

import { FixedClock } from "@wfx/client-runtime";
import { NativeMediaError } from "@wfx/native-media";
import type {
  EngineCommand,
  EngineConfig,
  EngineEvent,
  EngineEventHandler,
  EngineHandle,
  NativeEngineProcess,
  NativeMediaErrorCode,
} from "@wfx/native-media";
import {
  NativeMediaPortError,
  type NativeMediaErrorCode as PortErrorCode,
  type NativeMediaSessionEvent,
  type NativeMediaSessionSnapshot,
} from "@wfx/platform-contracts";

import { SimEngineProcess } from "./shell-simulator";
import {
  createNativeMediaBinding,
  integrityForState,
  portErrorFromEngineError,
} from "../src/platform/native-media-binding";

const ENGINE_CONFIG: EngineConfig = {
  cacheDir: "/sim/app-data/wfx-desktop/engine-cache",
  maxCacheBytes: 64 * 1024 * 1024,
};

const MAGNET = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=authorized";

function makeBinding(overrides: Partial<Parameters<typeof createNativeMediaBinding>[0]> = {}) {
  const process = new SimEngineProcess();
  const clock = new FixedClock(1_000);
  const binding = createNativeMediaBinding({
    process,
    config: ENGINE_CONFIG,
    clock,
    ...overrides,
  });
  return { process, clock, binding };
}

/** A handle whose `send` behavior is fully scripted (protocol edge cases). */
class ScriptedHandle implements EngineHandle {
  nextAnswer: EngineEvent | Error | "hang" = { protocolVersion: 1, kind: "state-changed", session: { id: "s1", assetId: "a1", fileId: "f1", state: "buffering", bufferedMs: 0, positionMs: 0 } };
  private readonly handlers = new Set<EngineEventHandler>();
  terminated = false;

  async send(_command: EngineCommand): Promise<EngineEvent> {
    if (this.nextAnswer === "hang") return new Promise<EngineEvent>(() => undefined);
    if (this.nextAnswer instanceof Error) throw this.nextAnswer;
    return this.nextAnswer;
  }

  onEvent(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  terminate(): void {
    this.terminated = true;
    this.handlers.clear();
  }

  push(event: EngineEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}

function scriptedBinding(answer: EngineEvent | Error | "hang", callTimeoutMs?: number) {
  const handle = new ScriptedHandle();
  handle.nextAnswer = answer;
  const process: NativeEngineProcess = {
    spawn(): EngineHandle {
      return handle;
    },
  };
  const binding = createNativeMediaBinding({
    process,
    config: ENGINE_CONFIG,
    clock: new FixedClock(0),
    ...(callTimeoutMs !== undefined ? { callTimeoutMs } : {}),
  });
  return { handle, binding };
}

describe("R08 — the binding's spawn/attach protocol", () => {
  it("open marshals the frozen open DTO and adopts the state-changed ack", async () => {
    const { process, binding } = makeBinding();
    const snapshot = await binding.open({ magnet: MAGNET });
    // The engine received the versioned DTO command:
    const openCommand = process.lastSide?.commands[0];
    expect(openCommand?.kind).toBe("open");
    if (openCommand?.kind === "open") {
      expect(openCommand.protocolVersion).toBe(1);
      expect(openCommand.source.magnet).toBe(MAGNET);
      expect(openCommand.source.localPath).toBeUndefined();
    }
    // The ack's session became the port snapshot (integrity: unknown — no verdict yet):
    expect(snapshot.id).toBe("sim-session-1");
    expect(snapshot.state).toBe("buffering");
    expect(snapshot.integrity).toBe("unknown");
    expect(snapshot.bufferedMs).toBe(0);
    expect(snapshot.positionMs).toBe(0);
    binding.dispose();
  });

  it("open with a local path marshals the localPath source", async () => {
    const { process, binding } = makeBinding();
    await binding.open({ localPath: "/sim/app-data/media/verified.mkv" });
    const openCommand = process.lastSide?.commands[0];
    if (openCommand?.kind === "open") {
      expect(openCommand.source.localPath).toBe("/sim/app-data/media/verified.mkv");
      expect(openCommand.source.magnet).toBeUndefined();
    }
    binding.dispose();
  });

  it("torrentBytes cannot cross the v1 wire: typed invalid-input, engine untouched", async () => {
    const { process, binding } = makeBinding();
    const thrown = await binding.open({ torrentBytes: new Uint8Array([1, 2]) }).catch((e: unknown) => e);
    expect(thrown instanceof NativeMediaPortError).toBe(true);
    expect((thrown as NativeMediaPortError).code).toBe("invalid-input");
    expect((thrown as NativeMediaPortError).detail).toContain("torrentBytes cannot cross the v1 engine wire protocol");
    expect(process.lastSide?.commands).toHaveLength(0);
    binding.dispose();
  });

  it("no source / both sources are typed invalid-input", async () => {
    const { binding } = makeBinding();
    const none = await binding.open({}).catch((e: unknown) => e);
    expect((none as NativeMediaPortError).code).toBe("invalid-input");
    const both = await binding
      .open({ magnet: MAGNET, localPath: "/tmp/x" })
      .catch((e: unknown) => e);
    expect((both as NativeMediaPortError).code).toBe("invalid-input");
    binding.dispose();
  });

  it("a spawn failure throws the typed unavailable error (never a silent dead binding)", () => {
    const process = new SimEngineProcess();
    process.nextSpawnFailure = new Error("the engine binary is missing");
    let thrown: unknown;
    try {
      createNativeMediaBinding({
        process,
        config: ENGINE_CONFIG,
        clock: new FixedClock(0),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof NativeMediaPortError).toBe(true);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect((thrown as NativeMediaPortError).detail).toContain("could not be spawned");
  });

  it("control commands marshal their DTOs (seek carries the position; pause/resume/prioritize carry the session)", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    await binding.seek(session.id, 42_000);
    await binding.pause(session.id);
    await binding.resume(session.id);
    const kinds = process.lastSide?.commands.map((command) => command.kind);
    expect(kinds).toEqual(["open", "seek", "pause", "resume"]);
    const seek = process.lastSide?.commands[1];
    if (seek?.kind === "seek") expect(seek.positionMs).toBe(42_000);
    binding.dispose();
  });

  it("close adopts the final snapshot and is idempotent for the service", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    await binding.close(session.id);
    // The engine saw exactly one close (the binding localizes idempotence):
    const closes = process.lastSide?.commands.filter((command) => command.kind === "close");
    expect(closes).toHaveLength(1);
    // A second close resolves without bothering the dead session:
    await expect(binding.close(session.id)).resolves.toBeUndefined();
    expect(process.lastSide?.commands.filter((command) => command.kind === "close")).toHaveLength(1);
    binding.dispose();
  });
});

describe("R08 — the binding's session mapping (engine numbers, verbatim)", () => {
  it("telemetry patches the tracked snapshot: progress moves position, buffered moves bufferedMs", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    process.lastHandle?.emitProgress(session.id, 12_345);
    process.lastHandle?.emitBuffered(session.id, 67_890);
    const inspected = await binding.inspect(session.id);
    expect(inspected.positionMs).toBe(12_345);
    expect(inspected.bufferedMs).toBe(67_890);
    expect(inspected.state).toBe("buffering");
    binding.dispose();
  });

  it("an authoritative state-changed is adopted wholesale", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    process.lastHandle?.emitStateChanged({
      ...session,
      state: "playing",
      bufferedMs: 120_000,
      positionMs: 30_000,
    });
    const inspected = await binding.inspect(session.id);
    expect(inspected.state).toBe("playing");
    expect(inspected.bufferedMs).toBe(120_000);
    expect(inspected.positionMs).toBe(30_000);
    binding.dispose();
  });

  it("observations carry the engine's numbers and the binding's clock stamps", async () => {
    const { process, clock, binding } = makeBinding();
    const events: NativeMediaSessionEvent[] = [];
    binding.subscribe((event) => events.push(event));
    const session = await binding.open({ magnet: MAGNET });
    clock.advance(500);
    process.lastHandle?.emitProgress(session.id, 1_000);
    expect(events).toHaveLength(2); // open ack + progress
    const progress = events[1]!;
    expect(progress.sessionId).toBe(session.id);
    expect(progress.positionMs).toBe(1_000);
    expect(progress.occurredAtMs).toBe(1_500); // the clock stamp of arrival
    binding.dispose();
  });

  it("inspect answers unknown-session for untracked ids (typed)", async () => {
    const { binding } = makeBinding();
    const thrown = await binding.inspect("nope").catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("unknown-session");
    binding.dispose();
  });
});

describe("R08 — THE INTEGRITY LAW (engine-sourced verdicts only)", () => {
  it("integrityForState: complete ⇒ verified; every other state ⇒ unknown", () => {
    expect(integrityForState("complete")).toBe("verified");
    expect(integrityForState("resolving")).toBe("unknown");
    expect(integrityForState("buffering")).toBe("unknown");
    expect(integrityForState("playing")).toBe("unknown");
    expect(integrityForState("background")).toBe("unknown");
    expect(integrityForState("failed")).toBe("unknown");
  });

  it("progress and telemetry NEVER flip integrity (no fabricated verdicts)", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    process.lastHandle?.emitBuffered(session.id, 999_999);
    process.lastHandle?.emitProgress(session.id, 888_888);
    expect((await binding.inspect(session.id)).integrity).toBe("unknown");
    binding.dispose();
  });

  it("the engine's complete report IS its verified verdict (the frozen law)", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    const events: NativeMediaSessionEvent[] = [];
    binding.subscribe((event) => events.push(event));
    process.lastHandle?.emitStateChanged({ ...session, state: "complete", bufferedMs: 3_600_000, positionMs: 3_600_000 });
    const inspected = await binding.inspect(session.id);
    expect(inspected.state).toBe("complete");
    expect(inspected.integrity).toBe("verified");
    expect(events[events.length - 1]?.integrity).toBe("verified");
    binding.dispose();
  });

  it("a VERIFICATION_FAILED rejection marks the session's integrity failed AND answers corrupt", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    process.lastSide?.failNextCommand("VERIFICATION_FAILED", "piece hashes mismatch");
    const thrown = await binding.seek(session.id, 1_000).catch((e: unknown) => e);
    expect(thrown instanceof NativeMediaPortError).toBe(true);
    expect((thrown as NativeMediaPortError).code).toBe("corrupt");
    // The tracked session's integrity is now the engine-sourced "failed":
    const inspected = await binding.inspect(session.id);
    expect(inspected.integrity).toBe("failed");
    expect(inspected.state).toBe("buffering"); // the ENGINE still owns the state
    binding.dispose();
  });
});

describe("R08 — the crash law (the engine dies)", () => {
  it("an error event on the spontaneous channel fails every live session and kills the engine", async () => {
    const { process, binding } = makeBinding();
    const first = await binding.open({ magnet: MAGNET });
    const second = await binding.open({ magnet: MAGNET });
    const failures: NativeMediaSessionEvent[] = [];
    binding.subscribe((event) => {
      if (event.state === "failed") failures.push(event);
    });
    process.lastHandle?.crash("simulated subprocess death");
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect(failure.detail).toContain("simulated subprocess death");
      // A crash does NOT fabricate an integrity verdict:
      expect(failure.integrity).toBe("unknown");
    }
    // The engine was terminated:
    expect(process.lastSide?.terminated).toBe(true);
    // And every subsequent operation rejects typed unavailable:
    const open = await binding.open({ magnet: MAGNET }).catch((e: unknown) => e);
    expect((open as NativeMediaPortError).code).toBe("unavailable");
    const inspect = await binding.inspect(first.id).catch((e: unknown) => e);
    expect((inspect as NativeMediaPortError).code).toBe("unavailable");
    expect((second as NativeMediaSessionSnapshot).id).toBe("sim-session-2");
    binding.dispose();
  });

  it("a malformed engine event is process-fatal (the wire is never trusted)", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    process.lastHandle?.emitMalformed();
    const thrown = await binding.pause(session.id).catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect((thrown as NativeMediaPortError).detail).toContain("not running");
    binding.dispose();
  });

  it("a malformed command ANSWER is process-fatal too", async () => {
    const { handle, binding } = scriptedBinding({ protocolVersion: 999 } as unknown as EngineEvent);
    const thrown = await binding.open({ magnet: MAGNET }).catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect(handle.terminated).toBe(true);
  });

  it("a well-formed but wrong-shaped answer is a typed rejection (no crash)", async () => {
    const { handle, binding } = scriptedBinding({
      protocolVersion: 1,
      kind: "progress",
      sessionId: "s1",
      positionMs: 5,
    });
    const thrown = await binding.open({ magnet: MAGNET }).catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect((thrown as NativeMediaPortError).detail).toContain("requires a state-changed acknowledgment");
    expect(handle.terminated).toBe(false); // the process may still be healthy
    binding.dispose();
  });

  it("a silent engine misses the wire deadline with the typed deadline-missed failure", async () => {
    const { binding } = scriptedBinding("hang", 25);
    const thrown = await binding.open({ magnet: MAGNET }).catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("deadline-missed");
    expect((thrown as NativeMediaPortError).detail).toContain("25ms");
    binding.dispose();
  });
});

describe("R08 — typed failures (the engine taxonomy maps onto the port taxonomy)", () => {
  it("NOT_FOUND answers unknown-session", async () => {
    const { binding } = makeBinding();
    const thrown = await binding.resume("nope").catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("unknown-session");
    binding.dispose();
  });

  it("ENGINE_TIMEOUT answers deadline-missed; IO_ERROR answers unavailable", async () => {
    const { process, binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    process.lastSide?.failNextCommand("ENGINE_TIMEOUT", "engine slow");
    const timedOut = await binding.pause(session.id).catch((e: unknown) => e);
    expect((timedOut as NativeMediaPortError).code).toBe("deadline-missed");
    process.lastSide?.failNextCommand("IO_ERROR", "disk hiccup");
    const io = await binding.resume(session.id).catch((e: unknown) => e);
    expect((io as NativeMediaPortError).code).toBe("unavailable");
    binding.dispose();
  });

  it("the error mapper covers the whole closed taxonomy", () => {
    const cases: { code: NativeMediaErrorCode; expected: PortErrorCode }[] = [
      { code: "INVALID_INPUT", expected: "invalid-input" },
      { code: "UNSUPPORTED_SOURCE", expected: "invalid-input" },
      { code: "NOT_FOUND", expected: "unknown-session" },
      { code: "SESSION_CLOSED", expected: "unknown-session" },
      { code: "VERIFICATION_FAILED", expected: "corrupt" },
      { code: "ENGINE_TIMEOUT", expected: "deadline-missed" },
      { code: "RANGE_NOT_SATISFIABLE", expected: "invalid-input" },
      { code: "IO_ERROR", expected: "unavailable" },
      { code: "INTERNAL", expected: "unavailable" },
    ];
    for (const testCase of cases) {
      const mapped = portErrorFromEngineError(new NativeMediaError(testCase.code, { detail: "x" }));
      expect(mapped.code).toBe(testCase.expected);
    }
  });

  it("seek validates its input (typed invalid-input)", async () => {
    const { binding } = makeBinding();
    const thrown = await binding.seek("s", -5).catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("invalid-input");
    binding.dispose();
  });
});

describe("R08 — the R10/R12 seams (honest by default)", () => {
  it("readRange without the range channel answers the typed honest failure — NEVER fabricated bytes", async () => {
    const { binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    const thrown = await binding
      .readRange(session.id, { offset: 0, length: 16 })
      .catch((e: unknown) => e);
    expect(thrown instanceof NativeMediaPortError).toBe(true);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect((thrown as NativeMediaPortError).detail).toContain("v1 engine wire protocol carries no byte-range command");
    expect((thrown as NativeMediaPortError).detail).toContain("R10");
    binding.dispose();
  });

  it("readRange with the R10 channel serves the bytes and maps the channel's typed failures", async () => {
    const payload = new Uint8Array(64);
    for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
    const channelCalls: string[] = [];
    const { binding } = makeBinding({
      rangeAccess: async (sessionId, request) => {
        channelCalls.push(`${sessionId}:${request.offset}:${request.length}`);
        if (sessionId === "dead") {
          throw new NativeMediaError("VERIFICATION_FAILED", { sessionId, detail: "range not verified" });
        }
        return payload.slice(request.offset, request.offset + request.length);
      },
    });
    const session = await binding.open({ magnet: MAGNET });
    const bytes = await binding.readRange(session.id, { offset: 8, length: 8 });
    expect(bytes).toEqual(payload.slice(8, 16));
    expect(channelCalls).toEqual([`${session.id}:8:8`]);
    const corrupt = await binding.readRange("dead", { offset: 0, length: 4 }).catch((e: unknown) => e);
    expect((corrupt as NativeMediaPortError).code).toBe("corrupt");
    binding.dispose();
  });

  it("readRange validates the request shape (typed invalid-input)", async () => {
    const { binding } = makeBinding();
    const zero = await binding.readRange("s", { offset: 0, length: 0 }).catch((e: unknown) => e);
    expect((zero as NativeMediaPortError).code).toBe("invalid-input");
    binding.dispose();
  });

  it("prioritize without the deadline mapper answers the typed honest failure naming the R12 seam", async () => {
    const { binding } = makeBinding();
    const session = await binding.open({ magnet: MAGNET });
    const thrown = await binding
      .prioritize(session.id, [{ offset: 0, length: 1024, deadlineMs: 5_000 }])
      .catch((e: unknown) => e);
    expect(thrown instanceof NativeMediaPortError).toBe(true);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect((thrown as NativeMediaPortError).detail).toContain("R12");
    binding.dispose();
  });

  it("prioritize with the R12 mapper marshals the translated piece deadlines to the engine", async () => {
    const { process, binding } = makeBinding({
      deadlineMapper: (deadlines) =>
        deadlines.map((deadline) => ({ piece: Math.floor(deadline.offset / 16), deadlineMs: deadline.deadlineMs })),
    });
    const session = await binding.open({ magnet: MAGNET });
    await binding.prioritize(session.id, [
      { offset: 0, length: 16, deadlineMs: 1_000 },
      { offset: 32, length: 16, deadlineMs: 2_000 },
    ]);
    const prioritize = process.lastSide?.commands.find((command) => command.kind === "prioritize");
    if (prioritize?.kind === "prioritize") {
      expect(prioritize.deadlines).toEqual([
        { piece: 0, deadlineMs: 1_000 },
        { piece: 2, deadlineMs: 2_000 },
      ]);
    } else {
      throw new Error("the prioritize command never reached the engine");
    }
    binding.dispose();
  });

  it("a mapper's typed rejection propagates (mapping honesty is the mapper's to keep)", async () => {
    const { binding } = makeBinding({
      deadlineMapper: () => new NativeMediaPortError("unavailable", "the piece map is not exposed yet"),
    });
    const session = await binding.open({ magnet: MAGNET });
    const thrown = await binding.prioritize(session.id, []).catch((e: unknown) => e);
    expect((thrown as NativeMediaPortError).code).toBe("unavailable");
    expect((thrown as NativeMediaPortError).detail).toContain("piece map");
    binding.dispose();
  });

  it("dispose terminates the engine (idempotent)", () => {
    const { process, binding } = makeBinding();
    binding.dispose();
    expect(process.lastSide?.terminated).toBe(true);
    binding.dispose(); // idempotent
  });
});
