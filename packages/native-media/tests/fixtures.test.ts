import { describe, expect, it } from "bun:test";

import {
  describeRange,
  isNativeMediaError,
  isRetryable,
  makeSession,
  NATIVE_MEDIA_ERROR_CODES,
  sampleErrors,
  sampleRangeRequests,
  sampleSessions,
  SESSION_STATES,
  stubEngine,
} from "../src/index";

describe("stubEngine — the in-memory engine TEST FIXTURE", () => {
  it("is branded as a test fixture (never production)", () => {
    const engine = stubEngine();
    expect(engine.isTestFixture).toBe(true);
  });

  it("opens deterministic, well-formed sessions (default state: buffering)", async () => {
    const engine = stubEngine();
    const first = await engine.open({ localPath: "/media/a.mkv" });
    const second = await engine.open({ magnet: "magnet:?xt=urn:btih:0123" });
    expect(first.id).toBe("stub-session-1");
    expect(second.id).toBe("stub-session-2");
    expect(first.state).toBe("buffering");
    expect(second.state).toBe("buffering");
    // The returned session is a copy: mutating it cannot corrupt the stub.
    first.state = "complete";
    expect(engine.sessions.get("stub-session-1")?.state).toBe("buffering");
  });

  it("honors a configurable open state", async () => {
    const engine = stubEngine({ openState: "resolving" });
    const session = await engine.open({ torrentBytes: new Uint8Array([1]) });
    expect(session.state).toBe("resolving");
  });

  it("throws at the fixture level when open gets no source at all", async () => {
    const engine = stubEngine();
    await expect(engine.open({} as never)).rejects.toThrow();
  });

  it("records every engine call for adapter-mapping assertions", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/a.mkv" });
    await engine.seek(session.id, 500);
    await engine.pause(session.id);
    expect(engine.calls.map((c) => c.method)).toEqual(["open", "seek", "pause"]);
    expect(engine.calls[1]?.args).toEqual([session.id, 500]);
  });

  it("forceState bypasses the FSM by design (fixture power tool)", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/a.mkv" });
    expect(engine.forceState(session.id, "playing")).toBe(true);
    // Bypassing the FSM: playing -> resolving is illegal in production logic.
    expect(engine.forceState(session.id, "resolving")).toBe(true);
    expect(engine.sessions.get(session.id)?.state).toBe("resolving");
    expect(engine.forceState(session.id, "paused" as never)).toBe(false);
    expect(engine.forceState("ghost", "playing")).toBe(false);
  });

  it("advanceBufferedMs simulates buffering progress with guards", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/a.mkv" });
    expect(engine.advanceBufferedMs(session.id, 2_500)).toBe(true);
    expect(engine.sessions.get(session.id)?.bufferedMs).toBe(2_500);
    expect(engine.advanceBufferedMs(session.id, -1_000)).toBe(true);
    expect(engine.sessions.get(session.id)?.bufferedMs).toBe(1_500);
    expect(engine.advanceBufferedMs(session.id, -9_999)).toBe(false); // would go negative
    expect(engine.advanceBufferedMs(session.id, Number.NaN)).toBe(false);
    expect(engine.advanceBufferedMs("ghost", 10)).toBe(false);
  });

  it("advanceBufferedMs refuses terminal sessions", async () => {
    const engine = stubEngine({ openState: "failed" });
    const session = await engine.open({ localPath: "/a.mkv" });
    expect(engine.advanceBufferedMs(session.id, 10)).toBe(false);
  });

  it("seek updates the stub's session position; unknown/closed sessions throw", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/a.mkv" });
    await engine.seek(session.id, 900);
    expect(engine.sessions.get(session.id)?.positionMs).toBe(900);
    await expect(engine.seek("ghost", 1)).rejects.toThrow("unknown session");
    await engine.close(session.id);
    await expect(engine.seek(session.id, 1)).rejects.toThrow("closed");
    await expect(engine.pause(session.id)).rejects.toThrow("closed");
  });

  it("close is idempotent at the stub level", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/a.mkv" });
    await engine.close(session.id);
    await engine.close(session.id); // no throw
    await expect(engine.close("never")).rejects.toThrow("unknown session");
  });

  it("nextOpenError makes the next open() throw (one-shot)", async () => {
    const engine = stubEngine();
    engine.nextOpenError = new Error("planned failure");
    await expect(engine.open({ localPath: "/a.mkv" })).rejects.toThrow("planned failure");
    const session = await engine.open({ localPath: "/b.mkv" }); // hook cleared
    expect(session.id).toBe("stub-session-1");
  });

  it("hangNextOpen never settles (one-shot)", async () => {
    const engine = stubEngine();
    engine.hangNextOpen = true;
    const pending = engine.open({ localPath: "/a.mkv" });
    const winner = await Promise.race([
      pending.then(() => "settled"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hang"), 20)),
    ]);
    expect(winner).toBe("hang");
    const session = await engine.open({ localPath: "/b.mkv" }); // hook cleared
    expect(session.id).toBe("stub-session-1");
  });

  it("serves the deterministic default payload through the range extension", async () => {
    const engine = stubEngine();
    const session = await engine.open({ localPath: "/a.mkv" });
    expect(engine.payload.length).toBe(1024);
    expect(engine.payload[5]).toBe(5);
    expect(engine.payload[251]).toBe(0); // 251 % 251 === 0
    const stats = await engine.statMedia(session.id);
    expect(stats).toEqual({ totalBytes: 1024, contentType: "application/octet-stream" });
    const bytes = await engine.readRange(session.id, 4, 7);
    expect([...bytes]).toEqual([4, 5, 6, 7]);
    await expect(engine.readRange(session.id, 2000, 3000)).rejects.toThrow(); // empty range past the payload
  });

  it("honors payload and contentType options", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const engine = stubEngine({ payload, contentType: "video/mp4" });
    const session = await engine.open({ localPath: "/a.mkv" });
    const stats = await engine.statMedia(session.id);
    expect(stats).toEqual({ totalBytes: 4, contentType: "video/mp4" });
    const bytes = await engine.readRange(session.id, 1, 2);
    expect([...bytes]).toEqual([2, 3]);
  });
});

describe("sampleSessions — one per frozen state", () => {
  it("covers all six states exactly once", () => {
    expect(sampleSessions.length).toBe(6);
    const states = sampleSessions.map((s) => s.state);
    expect([...new Set(states)].sort()).toEqual([...SESSION_STATES].sort());
  });

  it("every sample passes makeSession validation (round-trip)", () => {
    for (const session of sampleSessions) {
      expect(makeSession({ ...session })).toEqual(session);
    }
  });
});

describe("sampleErrors — one per taxonomy code", () => {
  it("covers every code in NATIVE_MEDIA_ERROR_CODES order", () => {
    expect(sampleErrors.length).toBe(NATIVE_MEDIA_ERROR_CODES.length);
    for (let i = 0; i < sampleErrors.length; i += 1) {
      const error = sampleErrors[i];
      const code = NATIVE_MEDIA_ERROR_CODES[i];
      if (error === undefined || code === undefined) {
        throw new Error("fixture drift: sampleErrors and the code list diverged");
      }
      expect(error.code).toBe(code);
      expect(error.detail).toContain(code.toLowerCase());
    }
  });

  it("every sample is a genuine NativeMediaError with table-consistent retryability", () => {
    for (const error of sampleErrors) {
      expect(isNativeMediaError(error)).toBe(true);
      expect(error.retryable).toBe(isRetryable(error.code));
    }
  });
});

describe("sampleRangeRequests — canned range shapes", () => {
  it("covers closed, open-ended, suffix, complete-session, and unknown-session forms", () => {
    expect(sampleRangeRequests.length).toBe(5);
    expect(describeRange(sampleRangeRequests[0] as never)).toBe("bytes=0-1023");
    expect(describeRange(sampleRangeRequests[1] as never)).toBe("bytes=512-");
    expect(describeRange(sampleRangeRequests[2] as never)).toBe("bytes=-256");
    expect(sampleRangeRequests[4]?.sessionId).toBe("sample-unknown");
  });
});
