/**
 * R25-W3 — the realtime audio capture tap's honesty laws (the plan's
 * R25-E capture path through the native-media service the lane owns).
 *
 * Proven here (machine-checked, from the observations):
 * - LAW 1 (no fabricated frames): every relayed frame CAME from the tap
 *   source, stamped with the capture clock — the service never invents
 *   samples/positions/timestamps.
 * - LAW 2 (no tap for unknown sources): an engine-unknown session and an
 *   unregistered live input answer the typed refusals; a complete/failed
 *   session answers `not-capturable`.
 * - LAW 3 (one tap per source, many consumers): a second subscriber rides
 *   the SAME platform tap (one openTap call); the tap closes only when
 *   the LAST consumer unsubscribes.
 * - LAW 4 (malformed frames are counted, never relayed): wrong source,
 *   NaN/negative position, empty samples, byte-misaligned samples, and a
 *   format mismatch each increment `invalidFrames` and relay nothing.
 * - The typed refusal → `NativeMediaError` mapping (closed codes).
 */

import { describe, expect, it } from "bun:test";

import {
  captureRefusalToError,
  createNativeAudioCaptureService,
  validateTapFrame,
  type NativeAudioTapController,
  type NativeAudioTapFrame,
  type NativeAudioTapNotification,
  type NativeAudioTapRefusal,
  type NativeAudioTapSource,
  type NativeCaptureSourceStats,
} from "../src/realtime/capture";
import { isNativeMediaError } from "../src/errors";

/** The subscribe-answer narrowing guard (controller vs typed refusal). */
function isRefusal(x: NativeAudioTapController | NativeAudioTapRefusal): x is NativeAudioTapRefusal {
  return typeof x === "object" && x !== null && "kind" in x;
}

// ---------------------------------------------------------------------------
// The deterministic world
// ---------------------------------------------------------------------------

const FORMAT = { sampleRateHz: 48_000, channels: 2, encoding: "pcm-s16le" as const };

/** A scripted platform tap source (the shell audio stack's double). */
class ScriptedTapSource implements NativeAudioTapSource {
  openTapCalls = 0;
  closeCalls = 0;
  private sink: ((frame: NativeAudioTapFrame) => void) | null = null;
  refuse = false;

  openTap(input: {
    readonly sourceId: string;
    readonly sourceKind: NativeAudioTapFrame["sourceKind"];
    readonly format: typeof FORMAT;
    readonly sink: (frame: NativeAudioTapFrame) => void;
  }): Promise<{ sourceId: string; close(): void } | { kind: "tap-open-failed"; detail: string }> {
    this.openTapCalls += 1;
    if (this.refuse) {
      return Promise.resolve({ kind: "tap-open-failed", detail: "the platform audio stack has no decode path for this source" });
    }
    this.sink = input.sink;
    return Promise.resolve({
      sourceId: input.sourceId,
      close: (): void => {
        this.closeCalls += 1;
        this.sink = null;
      },
    });
  }

  /** The test drives the platform's decoded-audio callback. */
  push(frame: NativeAudioTapFrame): void {
    this.sink?.(frame);
  }
}

function frame(
  sourceId: string,
  positionMs: number,
  sampleBytes = 8,
  sourceKind: NativeAudioTapFrame["sourceKind"] = "local-session",
): NativeAudioTapFrame {
  return {
    sourceId,
    sourceKind,
    positionMs,
    format: FORMAT,
    samples: new Uint8Array(sampleBytes),
  };
}

/** A session-state truth the tests script. */
type SessionState = "resolving" | "buffering" | "playing" | "background" | "complete" | "failed";

function sessionTruthOf(states: Record<string, SessionState | null>): {
  sessionStateOf(sourceId: string): SessionState | null;
} {
  return {
    sessionStateOf: (sourceId: string): SessionState | null => states[sourceId] ?? null,
  };
}

// ---------------------------------------------------------------------------
// The laws
// ---------------------------------------------------------------------------

describe("R25-W3 — the native audio capture tap", () => {
  it("LAW 1 — relays the platform's frames verbatim, stamped with the capture clock (never fabricated)", async () => {
    let clock = 1_000;
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({ "s-1": "playing" }),
      clock: (): number => clock,
    });
    const observed: NativeAudioTapNotification[] = [];
    const controller = await service.subscribe(
      { sourceId: "s-1", sourceKind: "local-session", format: FORMAT },
      (n) => observed.push(n),
    );
    expect(controller).toBeDefined();
    expect("kind" in controller).toBe(false);

    clock = 1_050;
    tap.push(frame("s-1", 0));
    clock = 1_100;
    tap.push(frame("s-1", 1_020));

    expect(observed.length).toBe(2);
    expect(observed[0]!.frame.positionMs).toBe(0);
    expect(observed[0]!.frame.capturedAtMs).toBe(1_050);
    expect(observed[1]!.frame.positionMs).toBe(1_020);
    expect(observed[1]!.frame.capturedAtMs).toBe(1_100);
    // The samples are the platform's bytes (length preserved verbatim).
    expect(observed[0]!.frame.samples.length).toBe(8);

    const stats = service.statistics().find((s) => s.sourceId === "s-1");
    expect(stats?.relayedFrames).toBe(2);
    expect(stats?.invalidFrames).toBe(0);
    expect(stats?.lastPositionMs).toBe(1_020);
    expect(isRefusal(controller)).toBe(false);
    if (!isRefusal(controller)) controller.unsubscribe();
  });

  it("LAW 2 — refuses taps for engine-unknown sessions, unregistered live inputs, and non-live states", async () => {
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({ "s-live": "playing", "s-done": "complete", "s-failed": "failed" }),
      clock: () => 0,
    });

    const unknown = await service.subscribe(
      { sourceId: "s-not-there", sourceKind: "local-session", format: FORMAT },
      () => undefined,
    );
    expect(isRefusal(unknown) && unknown.kind).toBe("unknown-source");

    const unregisteredLive = await service.subscribe(
      { sourceId: "live-x", sourceKind: "live-input", format: FORMAT },
      () => undefined,
    );
    expect(isRefusal(unregisteredLive) && unregisteredLive.kind).toBe("unknown-source");

    const complete = await service.subscribe(
      { sourceId: "s-done", sourceKind: "local-session", format: FORMAT },
      () => undefined,
    );
    expect(isRefusal(complete) && complete.kind).toBe("not-capturable");

    const failed = await service.subscribe(
      { sourceId: "s-failed", sourceKind: "local-session", format: FORMAT },
      () => undefined,
    );
    expect(isRefusal(failed) && failed.kind).toBe("not-capturable");

    // Nothing opened on the platform.
    expect(tap.openTapCalls).toBe(0);
    expect(service.statistics().length).toBe(0);
  });

  it("LAW 3 — one platform tap per source; the tap closes with the LAST consumer", async () => {
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({ "s-1": "playing" }),
      clock: () => 0,
    });
    const a: NativeAudioTapNotification[] = [];
    const b: NativeAudioTapNotification[] = [];
    const controllerA = await service.subscribe(
      { sourceId: "s-1", sourceKind: "local-session", format: FORMAT },
      (n) => a.push(n),
    );
    const controllerB = await service.subscribe(
      { sourceId: "s-1", sourceKind: "local-session", format: FORMAT },
      (n) => b.push(n),
    );
    // ONE platform tap for both consumers.
    expect(tap.openTapCalls).toBe(1);
    expect(isRefusal(controllerA)).toBe(false);
    expect(isRefusal(controllerB)).toBe(false);
    if (isRefusal(controllerA) || isRefusal(controllerB)) throw new Error("the taps should have opened");

    tap.push(frame("s-1", 0));
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);

    // The FIRST unsubscribe leaves the tap open for the other.
    controllerA.unsubscribe();
    tap.push(frame("s-1", 1_020));
    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
    expect(tap.closeCalls).toBe(0);

    // The LAST unsubscribe closes the platform tap.
    controllerB.unsubscribe();
    expect(tap.closeCalls).toBe(1);
    tap.push(frame("s-1", 2_040));
    expect(b.length).toBe(2);
    expect(service.statistics().length).toBe(0);
  });

  it("LAW 4 — malformed frames are counted and dropped, never relayed", async () => {
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({ "s-1": "playing" }),
      clock: () => 0,
    });
    const observed: NativeAudioTapNotification[] = [];
    await service.subscribe(
      { sourceId: "s-1", sourceKind: "local-session", format: FORMAT },
      (n) => observed.push(n),
    );

    tap.push({ ...frame("s-other", 0), sourceKind: "local-session" }); // wrong source
    tap.push({ ...frame("s-1", Number.NaN) }); // NaN position
    tap.push({ ...frame("s-1", -5) }); // negative position
    tap.push({ ...frame("s-1", 0, 0) }); // empty samples
    tap.push({ ...frame("s-1", 0, 7) }); // byte-misaligned samples
    tap.push({ ...frame("s-1", 0), format: { ...FORMAT, sampleRateHz: 44_100 } }); // format mismatch

    expect(observed.length).toBe(0);
    const stats = service.statistics().find((s) => s.sourceId === "s-1");
    expect(stats?.invalidFrames).toBe(6);
    expect(stats?.relayedFrames).toBe(0);

    // A SEEK is a legal re-position (the clock jumps forward, never back
    // through validation — the monotonicity law is per-frame honesty, not
    // a global constraint).
    tap.push(frame("s-1", 500_000));
    expect(observed.length).toBe(1);
    expect(observed[0]!.frame.positionMs).toBe(500_000);
  });

  it("the validation is a pure, total function over garbage inputs", () => {
    expect(validateTapFrame(null as unknown as NativeAudioTapFrame, { sourceId: "s", format: FORMAT })).toBe("the frame is not an object");
    expect(
      validateTapFrame({ ...frame("s", 0), samples: "nope" as unknown as Uint8Array }, { sourceId: "s", format: FORMAT }),
    ).toBe("the frame carries no samples");
    expect(validateTapFrame(frame("s", 0), { sourceId: "s", format: FORMAT })).toBeNull();
  });

  it("maps the typed refusals onto the package's closed NativeMediaError codes", () => {
    const unknown = captureRefusalToError({ kind: "unknown-source", detail: "x" });
    const notCapturable = captureRefusalToError({ kind: "not-capturable", detail: "x" });
    const openFailed = captureRefusalToError({ kind: "tap-open-failed", detail: "x" });
    expect(isNativeMediaError(unknown) && unknown.code === "NOT_FOUND").toBe(true);
    expect(isNativeMediaError(notCapturable) && notCapturable.code === "INVALID_INPUT").toBe(true);
    expect(isNativeMediaError(openFailed) && openFailed.code === "IO_ERROR").toBe(true);
  });

  it("dispose closes every open tap (the shutdown law, idempotent)", async () => {
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({ "s-1": "playing", "s-2": "playing" }),
      clock: () => 0,
    });
    await service.subscribe({ sourceId: "s-1", sourceKind: "local-session", format: FORMAT }, () => undefined);
    await service.subscribe({ sourceId: "s-2", sourceKind: "local-session", format: FORMAT }, () => undefined);
    service.dispose();
    expect(tap.closeCalls).toBe(2);
    service.dispose();
    expect(tap.closeCalls).toBe(2);
    const stats: readonly NativeCaptureSourceStats[] = service.statistics();
    expect(stats.length).toBe(0);
  });

  it("a torrent-session tap rides the same laws (the authorized peer path)", async () => {
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({ "torrent-s": "playing" }),
      clock: () => 0,
    });
    const observed: NativeAudioTapNotification[] = [];
    await service.subscribe(
      { sourceId: "torrent-s", sourceKind: "torrent-session", format: FORMAT },
      (n) => observed.push(n),
    );
    tap.push(frame("torrent-s", 0, 8, "torrent-session"));
    expect(observed.length).toBe(1);
    expect(observed[0]!.frame.sourceKind).toBe("torrent-session");
  });

  it("a registered live input is tappable; the registration truth is the only existence law", async () => {
    const tap = new ScriptedTapSource();
    const service = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: sessionTruthOf({}),
      liveInputTruth: { isLiveInput: (id) => id === "live-1" },
      clock: () => 0,
    });
    const observed: NativeAudioTapNotification[] = [];
    const ok = await service.subscribe(
      { sourceId: "live-1", sourceKind: "live-input", format: FORMAT },
      (n) => observed.push(n),
    );
    expect(isRefusal(ok) && ok.kind === "unknown-source").toBe(false);
    tap.push(frame("live-1", 0, 8, "live-input"));
    expect(observed.length).toBe(1);
    expect(observed[0]!.frame.sourceKind).toBe("live-input");
  });
});
