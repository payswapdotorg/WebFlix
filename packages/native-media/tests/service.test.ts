import { describe, expect, it } from "bun:test";

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import {
  createNativeMediaService,
  makeSession,
  NativeMediaError,
  contentRangeHeaderValue,
  type NativeMediaErrorCode,
  type OpenSessionRequest,
  type PlayCommand,
  type RangeAccessEngine,
  type ServiceResponse,
  stubEngine,
  type StubEngine,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mustOpen(
  service: ReturnType<typeof createNativeMediaService>,
  source: OpenSessionRequest = { localPath: "/media/movie.mkv" },
): Promise<NativeMediaSession> {
  const result = await service.open(source);
  if (result.ok) return result.value;
  throw new Error(`open unexpectedly failed: ${result.error.code}: ${result.error.detail ?? ""}`);
}

function expectErr<T>(
  result: ServiceResponse<T>,
  code: NativeMediaErrorCode,
): NativeMediaError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error).toBeInstanceOf(NativeMediaError);
  expect(result.error.code).toBe(code);
  return result.error;
}

function callCount(engine: StubEngine, method: string): number {
  return engine.calls.filter((c) => c.method === method).length;
}

function lastCall(engine: StubEngine, method: string) {
  const found = engine.calls.filter((c) => c.method === method);
  return found[found.length - 1];
}

/** A frozen-surface engine WITHOUT the optional range extension. */
function bareEngine(): NativeMediaEngine {
  return {
    async open() {
      return makeSession({
        id: "bare-session-1",
        assetId: "bare-asset",
        fileId: "bare-file",
        state: "buffering",
      });
    },
    async seek() {},
    async pause() {},
    async resume() {},
    async prioritize() {},
    async close() {},
  };
}

// ---------------------------------------------------------------------------
// createNativeMediaService — factory validation
// ---------------------------------------------------------------------------

describe("createNativeMediaService — factory validation", () => {
  it("rejects a non-object engine with INVALID_INPUT", () => {
    expect(() => createNativeMediaService(null as never)).toThrow(NativeMediaError);
    expect(() => createNativeMediaService("engine" as never)).toThrow(NativeMediaError);
  });

  it("rejects an engine missing a frozen-surface method", () => {
    const partial = { async open() {}, async seek() {} } as unknown as NativeMediaEngine;
    try {
      createNativeMediaService(partial);
      throw new Error("expected INVALID_INPUT");
    } catch (e) {
      const nme = e as NativeMediaError;
      expect(nme.code).toBe("INVALID_INPUT");
      expect(nme.detail).toContain("prioritize");
    }
  });

  it("rejects a malformed callTimeoutMs", () => {
    expect(() =>
      createNativeMediaService(stubEngine(), { callTimeoutMs: Number.NaN }),
    ).toThrow(NativeMediaError);
    expect(() => createNativeMediaService(stubEngine(), { callTimeoutMs: -1 })).toThrow(
      NativeMediaError,
    );
  });

  it("accepts callTimeoutMs = 0 (deadline enforcement disabled)", () => {
    expect(() => createNativeMediaService(stubEngine(), { callTimeoutMs: 0 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// open — input validation (before any engine call)
// ---------------------------------------------------------------------------

describe("service.open — input validation", () => {
  it("requires at least one source (INVALID_INPUT, engine never called)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const error = expectErr(await service.open({}), "INVALID_INPUT");
    expect(error.detail).toContain("at least one source");
    expect(callCount(engine, "open")).toBe(0);
  });

  it("rejects empty and non-magnet strings in the magnet field", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.open({ magnet: "" }), "INVALID_INPUT");
    expectErr(await service.open({ magnet: "   " }), "INVALID_INPUT");
    expectErr(await service.open({ magnet: "https://example.invalid/file.torrent" }), "INVALID_INPUT");
  });

  it("rejects empty torrentBytes and empty/whitespace localPath", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.open({ torrentBytes: new Uint8Array(0) }), "INVALID_INPUT");
    expectErr(await service.open({ localPath: "" }), "INVALID_INPUT");
    expectErr(await service.open({ localPath: "   " }), "INVALID_INPUT");
  });

  it("rejects a non-object request", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.open(null as never), "INVALID_INPUT");
    expectErr(await service.open("magnet:?xt=urn:btih:abc" as never), "INVALID_INPUT");
  });

  it("forwards multi-source requests to the engine (engine decides)", async () => {
    const service = createNativeMediaService(stubEngine());
    const result = await service.open({
      magnet: "magnet:?xt=urn:btih:0123456789abcdef",
      localPath: "/media/dual.mkv",
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// open — success and error mapping
// ---------------------------------------------------------------------------

describe("service.open — success and engine error mapping", () => {
  it("opens a localPath source and returns a validated session envelope", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const result = await service.open({ localPath: "/media/movie.mkv" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.id).toBe("stub-session-1");
    expect(result.value.state).toBe("buffering"); // stub default open state
    expect(result.value.assetId).toBe("stub-asset-1");
    expect(callCount(engine, "open")).toBe(1);
  });

  it("opens magnet and torrentBytes sources too", async () => {
    const service = createNativeMediaService(stubEngine());
    const magnet = await service.open({ magnet: "magnet:?xt=urn:btih:0123456789abcdef" });
    expect(magnet.ok).toBe(true);
    const torrent = await service.open({
      torrentBytes: new Uint8Array([0x64, 0x6f, 0x64]),
    });
    expect(torrent.ok).toBe(true);
  });

  it("maps a generic engine throw to a non-retryable INTERNAL error", async () => {
    const engine = stubEngine();
    engine.nextOpenError = new Error("torrent library exploded");
    const service = createNativeMediaService(engine);
    const error = expectErr(await service.open({ localPath: "/x.mkv" }), "INTERNAL");
    expect(error.detail).toContain("torrent library exploded");
    expect(error.retryable).toBe(false);
  });

  it("preserves an engine-thrown NativeMediaError code and detail", async () => {
    const engine = stubEngine();
    engine.nextOpenError = new NativeMediaError("UNSUPPORTED_SOURCE", {
      detail: "engine compiled without torrent support",
    });
    const service = createNativeMediaService(engine);
    const error = expectErr(await service.open({ magnet: "magnet:?xt=urn:btih:aa" }), "UNSUPPORTED_SOURCE");
    expect(error.detail).toBe("engine compiled without torrent support");
  });

  it("maps an engine TimeoutError-named throw to a retryable ENGINE_TIMEOUT", async () => {
    const engine = stubEngine();
    const timeout = new Error("engine call timed out");
    timeout.name = "TimeoutError";
    engine.nextOpenError = timeout;
    const service = createNativeMediaService(engine);
    const error = expectErr(await service.open({ localPath: "/x.mkv" }), "ENGINE_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("enforces the per-call deadline: a hung engine yields ENGINE_TIMEOUT", async () => {
    const engine = stubEngine();
    engine.hangNextOpen = true;
    const service = createNativeMediaService(engine, { callTimeoutMs: 15 });
    const error = expectErr(await service.open({ localPath: "/x.mkv" }), "ENGINE_TIMEOUT");
    expect(error.retryable).toBe(true);
    expect(error.detail).toContain("engine.open");
  });

  it("maps a malformed engine result to INTERNAL — never a default-filled session", async () => {
    const engine = stubEngine();
    engine.nextOpenResult = {};
    const service = createNativeMediaService(engine);
    const error = expectErr(await service.open({ localPath: "/x.mkv" }), "INTERNAL");
    expect(error.detail).toContain("missing");

    engine.nextOpenResult = { id: "half", state: "playing" };
    expectErr(await service.open({ localPath: "/x.mkv" }), "INTERNAL");
  });

  it("rejects a duplicate session id from the engine with INTERNAL", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const first = await mustOpen(service); // tracked as session 'stub-session-1'
    engine.nextOpenResult = { ...first }; // same id, fresh object
    const error = expectErr(await service.open({ localPath: "/b.mkv" }), "INTERNAL");
    expect(error.detail).toContain("duplicate");
  });
});

// ---------------------------------------------------------------------------
// control — command validation and engine mapping
// ---------------------------------------------------------------------------

describe("service.control — validation and engine mapping", () => {
  it("pause maps to engine.pause and leaves the session state unchanged", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const result = await service.control(session.id, { kind: "pause" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("buffering");
    }
    expect(callCount(engine, "pause")).toBe(1);
    expect(lastCall(engine, "pause")?.args[0]).toBe(session.id);
  });

  it("seek maps to engine.seek(id, positionMs) and updates the snapshot position", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const result = await service.control(session.id, { kind: "seek", positionMs: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.positionMs).toBe(5000);
    expect(callCount(engine, "seek")).toBe(1);
    expect(lastCall(engine, "seek")?.args[1]).toBe(5000);
    const status = await service.status(session.id);
    expect(status.ok && status.value.positionMs).toBe(5000);
  });

  it("negative, missing, and non-finite seek positions are INVALID_INPUT (engine not called)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    for (const command of [
      { kind: "seek", positionMs: -1 },
      { kind: "seek" },
      { kind: "seek", positionMs: Number.NaN },
      { kind: "seek", positionMs: Number.POSITIVE_INFINITY },
      { kind: "seek", positionMs: "1000" as never },
    ] as PlayCommand[]) {
      expectErr(await service.control(session.id, command), "INVALID_INPUT");
    }
    expect(callCount(engine, "seek")).toBe(0);
  });

  it("positionMs on pause/resume is rejected (strictly typed input)", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    expectErr(
      await service.control(session.id, { kind: "pause", positionMs: 10 } as PlayCommand),
      "INVALID_INPUT",
    );
    expectErr(await service.control(session.id, { kind: "resume", positionMs: 10 }), "INVALID_INPUT");
  });

  it("unknown command kinds are INVALID_INPUT", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    expectErr(
      await service.control(session.id, { kind: "rewind" } as unknown as PlayCommand),
      "INVALID_INPUT",
    );
    expectErr(await service.control(session.id, null as never), "INVALID_INPUT");
  });

  it("prioritize maps to engine.prioritize with the validated deadlines", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const deadlines = [
      { piece: 3, deadlineMs: 500 },
      { piece: 0, deadlineMs: 0 },
    ];
    const result = await service.control(session.id, { kind: "prioritize", deadlines });
    expect(result.ok).toBe(true);
    expect(callCount(engine, "prioritize")).toBe(1);
    expect(lastCall(engine, "prioritize")?.args[1]).toEqual(deadlines);
  });

  it("empty deadline lists are forwarded (an honest no-op command)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const result = await service.control(session.id, { kind: "prioritize", deadlines: [] });
    expect(result.ok).toBe(true);
    expect(callCount(engine, "prioritize")).toBe(1);
  });

  it("malformed prioritize deadlines are INVALID_INPUT (engine not called)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    for (const command of [
      { kind: "prioritize" },
      { kind: "prioritize", deadlines: "now" as never },
      { kind: "prioritize", deadlines: [{ piece: -1, deadlineMs: 5 }] },
      { kind: "prioritize", deadlines: [{ piece: 1.5, deadlineMs: 5 }] },
      { kind: "prioritize", deadlines: [{ piece: 1, deadlineMs: -5 }] },
      { kind: "prioritize", deadlines: [{ piece: 1, deadlineMs: "soon" as never }] },
      { kind: "prioritize", deadlines: ["nope" as never] },
    ] as PlayCommand[]) {
      expectErr(await service.control(session.id, command), "INVALID_INPUT");
    }
    expect(callCount(engine, "prioritize")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// control — session-state enforcement (FSM)
// ---------------------------------------------------------------------------

describe("service.control — session-state enforcement", () => {
  it("play from buffering transitions the snapshot to playing (engine.resume called)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service); // stub opens in 'buffering'
    const result = await service.control(session.id, { kind: "play" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("playing");
    expect(callCount(engine, "resume")).toBe(1);
  });

  it("play on an already-playing session is an idempotent success", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    await service.control(session.id, { kind: "play" });
    const again = await service.control(session.id, { kind: "play" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.state).toBe("playing");
  });

  it("resume from background transitions to playing", async () => {
    const engine = stubEngine({ openState: "background" });
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const result = await service.control(session.id, { kind: "resume" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("playing");
  });

  it("play while resolving is INVALID_INPUT (FSM forbids resolving→playing)", async () => {
    const engine = stubEngine({ openState: "resolving" });
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const error = expectErr(await service.control(session.id, { kind: "play" }), "INVALID_INPUT");
    expect(error.detail).toContain("resolving");
    expect(callCount(engine, "resume")).toBe(0);
  });

  it("play with positionMs seeks first, then resumes (both engine calls, in order)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const result = await service.control(session.id, { kind: "play", positionMs: 1234 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("playing");
      expect(result.value.positionMs).toBe(1234);
    }
    expect(callCount(engine, "seek")).toBe(1);
    expect(callCount(engine, "resume")).toBe(1);
    const controlCalls = engine.calls
      .filter((c) => c.method === "seek" || c.method === "resume")
      .map((c) => c.method);
    expect(controlCalls).toEqual(["seek", "resume"]);
  });

  it("control on a closed session is SESSION_CLOSED", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const closed = await service.control(session.id, { kind: "close" });
    expect(closed.ok).toBe(true);
    const error = expectErr(
      await service.control(session.id, { kind: "pause" }),
      "SESSION_CLOSED",
    );
    expect(error.sessionId).toBe(session.id);
  });

  it("control on a failed session is SESSION_CLOSED (terminal)", async () => {
    const engine = stubEngine({ openState: "failed" });
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    expectErr(await service.control(session.id, { kind: "play" }), "SESSION_CLOSED");
    expectErr(await service.control(session.id, { kind: "seek", positionMs: 1 }), "SESSION_CLOSED");
  });

  it("control on a complete session is SESSION_CLOSED (terminal)", async () => {
    const engine = stubEngine({ openState: "complete" });
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    expectErr(await service.control(session.id, { kind: "pause" }), "SESSION_CLOSED");
  });

  it("control on an unknown session is NOT_FOUND", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.control("never-opened", { kind: "pause" }), "NOT_FOUND");
  });

  it("an empty sessionId is INVALID_INPUT", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.control("", { kind: "pause" }), "INVALID_INPUT");
    expectErr(await service.control("  ", { kind: "pause" }), "INVALID_INPUT");
  });

  it("close stops further control/status/range with SESSION_CLOSED (idempotent semantics)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    expect((await service.control(session.id, { kind: "close" })).ok).toBe(true);
    expectErr(await service.control(session.id, { kind: "pause" }), "SESSION_CLOSED");
    expectErr(await service.status(session.id), "SESSION_CLOSED");
    expectErr(
      await service.range({ sessionId: session.id, startByte: 0 }),
      "SESSION_CLOSED",
    );
  });
});

// ---------------------------------------------------------------------------
// control — engine failure mapping
// ---------------------------------------------------------------------------

describe("service.control — engine failure mapping", () => {
  it("a generic engine throw maps to INTERNAL with the sessionId attached", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    engine.nextControlError = new Error("engine bug");
    const error = expectErr(await service.control(session.id, { kind: "pause" }), "INTERNAL");
    expect(error.sessionId).toBe(session.id);
    expect(error.detail).toContain("engine bug");
    expect(error.retryable).toBe(false);
  });

  it("an engine-thrown NativeMediaError keeps its code (IO_ERROR stays retryable)", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    engine.nextControlError = new NativeMediaError("IO_ERROR", { detail: "disk hiccup", sessionId: session.id });
    const error = expectErr(await service.control(session.id, { kind: "seek", positionMs: 1 }), "IO_ERROR");
    expect(error.retryable).toBe(true);
    expect(error.detail).toBe("disk hiccup");
  });

  it("an engine throw named TimeoutError maps to ENGINE_TIMEOUT", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const timeout = new Error("waited too long");
    timeout.name = "TimeoutError";
    engine.nextControlError = timeout;
    const error = expectErr(await service.control(session.id, { kind: "pause" }), "ENGINE_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("the per-call deadline turns a hung control call into ENGINE_TIMEOUT", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine, { callTimeoutMs: 15 });
    const session = await mustOpen(service);
    engine.hangNextControl = true;
    const error = expectErr(await service.control(session.id, { kind: "pause" }), "ENGINE_TIMEOUT");
    expect(error.detail).toContain("engine.pause");
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe("service.status — last-known snapshot", () => {
  it("returns the tracked snapshot (open-time view plus control updates)", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    await service.control(session.id, { kind: "play" });
    await service.control(session.id, { kind: "seek", positionMs: 2500 });
    const status = await service.status(session.id);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.state).toBe("playing");
      expect(status.value.positionMs).toBe(2500);
    }
  });

  it("still reports terminal (complete/failed) snapshots", async () => {
    for (const openState of ["complete", "failed"] as const) {
      const service = createNativeMediaService(stubEngine({ openState }));
      const session = await mustOpen(service);
      const status = await service.status(session.id);
      expect(status.ok).toBe(true);
      if (status.ok) expect(status.value.state).toBe(openState);
    }
  });

  it("answers NOT_FOUND for unknown sessions and INVALID_INPUT for empty ids", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.status("nope"), "NOT_FOUND");
    expectErr(await service.status(""), "INVALID_INPUT");
  });

  it("hands out copies — mutating the returned session does not corrupt the service", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    const status = await service.status(session.id);
    if (status.ok) {
      status.value.state = "complete";
      status.value.positionMs = 999_999;
    }
    const again = await service.status(session.id);
    expect(again.ok && again.value.state).toBe("buffering");
    expect(again.ok && again.value.positionMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// range
// ---------------------------------------------------------------------------

describe("service.range — byte access through the range extension", () => {
  it("serves a closed interval from the stub payload end-to-end", async () => {
    const engine = stubEngine();
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const result = await service.range({ sessionId: session.id, startByte: 0, endByte: 1023 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startByte).toBe(0);
      expect(result.value.endByte).toBe(1023);
      expect(result.value.totalBytes).toBe(1024);
      expect(result.value.contentType).toBe("application/octet-stream");
      expect(result.value.data.length).toBe(1024);
      expect(contentRangeHeaderValue(result.value)).toBe("bytes 0-1023/1024");
    }
    expect(callCount(engine, "statMedia")).toBe(1);
    expect(callCount(engine, "readRange")).toBe(1);
    expect(lastCall(engine, "readRange")?.args).toEqual([session.id, 0, 1023]);
  });

  it("resolves open-ended requests to the end of the payload", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    const result = await service.range({ sessionId: session.id, startByte: 512 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startByte).toBe(512);
      expect(result.value.endByte).toBe(1023);
      expect(result.value.data.length).toBe(512);
    }
  });

  it("resolves suffix-form requests (negative startByte)", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    const result = await service.range({ sessionId: session.id, startByte: -256 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startByte).toBe(768);
      expect(result.value.endByte).toBe(1023);
      expect(result.value.data.length).toBe(256);
    }
  });

  it("serves the whole payload when the suffix exceeds the media size", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    const result = await service.range({ sessionId: session.id, startByte: -5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startByte).toBe(0);
      expect(result.value.endByte).toBe(1023);
    }
  });

  it("serves truncated intervals that extend past the payload", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    const result = await service.range({ sessionId: session.id, startByte: 1000, endByte: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startByte).toBe(1000);
      expect(result.value.endByte).toBe(1023);
      expect(result.value.data.length).toBe(24);
    }
  });

  it("answers RANGE_NOT_SATISFIABLE (with sessionId) for out-of-bounds starts", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    const error = expectErr(
      await service.range({ sessionId: session.id, startByte: 5000 }),
      "RANGE_NOT_SATISFIABLE",
    );
    expect(error.sessionId).toBe(session.id);
  });

  it("answers NOT_FOUND for unknown sessions and SESSION_CLOSED for failed ones", async () => {
    const service = createNativeMediaService(stubEngine());
    expectErr(await service.range({ sessionId: "ghost", startByte: 0 }), "NOT_FOUND");
    const failed = createNativeMediaService(stubEngine({ openState: "failed" }));
    const session = await mustOpen(failed);
    expectErr(await failed.range({ sessionId: session.id, startByte: 0 }), "SESSION_CLOSED");
  });

  it("still serves range reads on a complete session (the cache persists)", async () => {
    const service = createNativeMediaService(stubEngine({ openState: "complete" }));
    const session = await mustOpen(service);
    const result = await service.range({ sessionId: session.id, startByte: 0, endByte: 9 });
    expect(result.ok).toBe(true);
  });

  it("rejects malformed range requests with INVALID_INPUT", async () => {
    const service = createNativeMediaService(stubEngine());
    const session = await mustOpen(service);
    expectErr(
      await service.range({ sessionId: session.id, startByte: 1.5 } as never),
      "INVALID_INPUT",
    );
    expectErr(await service.range({ sessionId: "", startByte: 0 } as never), "INVALID_INPUT");
    expectErr(
      await service.range({ sessionId: session.id, startByte: -5, endByte: 9 } as never),
      "INVALID_INPUT",
    );
    expectErr(await service.range(null as never), "INVALID_INPUT");
  });

  it("answers a typed UNSUPPORTED_SOURCE when the engine lacks the range extension", async () => {
    const service = createNativeMediaService(bareEngine());
    const session = await mustOpen(service);
    const error = expectErr(
      await service.range({ sessionId: session.id, startByte: 0 }),
      "UNSUPPORTED_SOURCE",
    );
    expect(error.detail).toContain("range-access extension");
  });

  it("maps range-extension engine throws to INTERNAL", async () => {
    const engine: NativeMediaEngine & RangeAccessEngine = {
      async open() {
        return makeSession({
          id: "throwing-1",
          assetId: "a",
          fileId: "f",
          state: "buffering",
        });
      },
      async seek() {},
      async pause() {},
      async resume() {},
      async prioritize() {},
      async close() {},
      async statMedia() {
        throw new Error("stat boom");
      },
      async readRange() {
        throw new Error("read boom");
      },
    };
    const service = createNativeMediaService(engine);
    const session = await mustOpen(service);
    const error = expectErr(
      await service.range({ sessionId: session.id, startByte: 0 }),
      "INTERNAL",
    );
    expect(error.detail).toContain("stat boom");
  });

  it("maps wrong-length engine reads to INTERNAL — never a padded success", async () => {
    // A stub with a 64-byte payload whose statMedia LIES about the size (1024):
    // readRange then serves fewer bytes than the resolved span demands.
    const stub = stubEngine({ payload: new Uint8Array(64) });
    const lyingEngine: NativeMediaEngine & RangeAccessEngine = {
      open: (input) => stub.open(input),
      seek: (sessionId, positionMs) => stub.seek(sessionId, positionMs),
      prioritize: (sessionId, deadlines) => stub.prioritize(sessionId, deadlines),
      pause: (sessionId) => stub.pause(sessionId),
      resume: (sessionId) => stub.resume(sessionId),
      close: (sessionId) => stub.close(sessionId),
      async statMedia() {
        return { totalBytes: 1024, contentType: "application/octet-stream" };
      },
      readRange: (sessionId, startByte, endByte) => stub.readRange(sessionId, startByte, endByte),
    };
    const service = createNativeMediaService(lyingEngine);
    const session = await mustOpen(service, { localPath: "/lying.mkv" });
    const error = expectErr(
      await service.range({ sessionId: session.id, startByte: 0, endByte: 1023 }),
      "INTERNAL",
    );
    expect(error.detail).toContain("span");
  });
});
