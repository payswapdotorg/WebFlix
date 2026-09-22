/**
 * R25-W3 — the desktop realtime media adapter's laws (the plan's R25-E
 * "Media-source integration" + R25-F "the sampler belongs to the media
 * adapter").
 *
 * Proven here (machine-checked):
 * - THE AUTHORIZED-MEDIA LAW: native/browser rungs with an engaged native
 *   session answer `authorized` (local, torrent, live); the embed rung
 *   answers the honest `unavailable-restricted` truth naming the plan's
 *   alternatives and the never-bypass law; an unbound provider answers
 *   the honest `unavailable-no-provider` truth.
 * - THE TORRENT TRUTH: a native realization whose connector is the
 *   authorized-peer-copy id answers the authorized-torrent path.
 * - THE WIRING: a started feed appends the captured frames into the
 *   session's append-audio seam (the source's own timeline), runs the
 *   sampler against the platform's per-position signals, and appends
 *   emitted frames into the append-image-frame seam — with the honest
 *   accounting live on the feed handle.
 * - THE HONEST FAILURES: a restricted startFeed refuses before any session
 *   is created; a refused tap closes the session; a failed session.start
 *   unsubscribes + closes.
 * - BASE PLAYBACK IS NEVER TOUCHED: the adapter holds no playback handle
 *   at all — there is nothing to gate playback on (the structural law).
 */

import { describe, expect, it } from "bun:test";
import type { PlaybackRealization } from "@wfx/domain";
import {
  createNativeAudioCaptureService,
  type NativeAudioTapFrame,
  type NativeAudioTapSource,
} from "@wfx/native-media";

import {
  createDesktopRealtimeMediaAdapter,
  isProviderBound,
  resolveRealtimeCaptureCapability,
} from "../src/platform/realtime-media-adapter";
import {
  createUnavailableRealtimeSessionFactory,
  type RealtimeTranslationEvent,
  type RealtimeTranslationSession,
  type RealtimeTranslationSessionFactory,
  type RealtimeTranslationSessionInput,
} from "../src/platform/realtime-translation-port";

// ---------------------------------------------------------------------------
// The deterministic world
// ---------------------------------------------------------------------------

const FORMAT = { sampleRateHz: 48_000, channels: 2, encoding: "pcm-s16le" as const };

function realization(mode: PlaybackRealization["mode"], connectorId: string): PlaybackRealization {
  return { mode, connectorId, capabilities: [] };
}

/** The scripted platform tap source. */
class ScriptedTapSource implements NativeAudioTapSource {
  openTapCalls = 0;
  refuse = false;
  private sink: ((frame: NativeAudioTapFrame) => void) | null = null;

  openTap(input: {
    readonly sourceId: string;
    readonly sourceKind: NativeAudioTapFrame["sourceKind"];
    readonly format: typeof FORMAT;
    readonly sink: (frame: NativeAudioTapFrame) => void;
  }): Promise<{ sourceId: string; close(): void } | { kind: "tap-open-failed"; detail: string }> {
    this.openTapCalls += 1;
    if (this.refuse) {
      return Promise.resolve({ kind: "tap-open-failed", detail: "no decode path" });
    }
    this.sink = input.sink;
    return Promise.resolve({
      sourceId: input.sourceId,
      close: (): void => {
        this.sink = null;
      },
    });
  }

  push(sourceId: string, positionMs: number): void {
    this.sink?.({
      sourceId,
      sourceKind: "local-session",
      positionMs,
      format: FORMAT,
      samples: new Uint8Array(8),
    });
  }
}

/** The scripted session double — records the append-seam traffic. */
class ScriptedSession implements RealtimeTranslationSession {
  readonly appendedAudio: { readonly positionMs: number; readonly samples: Uint8Array }[] = [];
  readonly appendedFrames: { readonly positionMs: number; readonly trigger: string }[] = [];
  started = false;
  closed = false;
  failStart = false;
  readonly events: RealtimeTranslationEvent[] = [];

  readonly id = "rt-scripted";

  async start(): Promise<void> {
    if (this.failStart) throw new Error("the session could not start");
    this.started = true;
  }
  async configure(): Promise<void> {
    void this;
  }
  appendAudio(frame: { readonly positionMs: number; readonly samples: Uint8Array }): void {
    this.appendedAudio.push(frame);
  }
  appendImageFrame(frame: { readonly positionMs: number; readonly trigger: string }): void {
    this.appendedFrames.push(frame);
  }
  async stop(): Promise<void> {
    void this;
  }
  async reconnect(): Promise<void> {
    void this;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  subscribe(listener: (event: RealtimeTranslationEvent) => void): () => void {
    return (): void => {
      void listener;
    };
  }
}

/** The scripted factory (a "bound provider" — the Model Fabric seam's double). */
function scriptedSessionFactory(
  script: (input: RealtimeTranslationSessionInput, session: ScriptedSession) => void = () => undefined,
): { factory: RealtimeTranslationSessionFactory; sessions: ScriptedSession[] } {
  const sessions: ScriptedSession[] = [];
  return {
    sessions,
    factory: {
      async createSession(input: RealtimeTranslationSessionInput) {
        const session = new ScriptedSession();
        script(input, session);
        sessions.push(session);
        return session;
      },
    },
  };
}

function adapterWorld(input?: {
  readonly tapRefuse?: boolean;
  readonly failStart?: boolean;
}): {
  adapter: ReturnType<typeof createDesktopRealtimeMediaAdapter>;
  tap: ScriptedTapSource;
  sessions: ScriptedSession[];
  frameSignals: { readonly calls: number };
} {
  const tap = new ScriptedTapSource();
  tap.refuse = input?.tapRefuse ?? false;
  const capture = createNativeAudioCaptureService({
    tapSource: tap,
    sessionTruth: {
      sessionStateOf: (sourceId: string): "resolving" | "buffering" | "playing" | "background" | "complete" | "failed" | null =>
        sourceId === "native-s" ? "playing" : null,
    },
    clock: () => 0,
  });
  const { factory, sessions } = scriptedSessionFactory((_input, session) => {
    session.failStart = input?.failStart ?? false;
  });
  let signalCalls = 0;
  const adapter = createDesktopRealtimeMediaAdapter({
    captureService: capture,
    sessionFactory: factory,
    nowMs: () => 0,
    frameSignalsOf: (positionMs: number) => {
      signalCalls += 1;
      return {
        positionMs,
        sceneDifference: positionMs === 0 ? 0.9 : 0.02,
        onScreenText: null,
        shotOrSpeakerIndex: null,
        bytes: new Uint8Array([9, 9]),
        mediaType: "image/jpeg",
      };
    },
  });
  return { adapter, tap, sessions, frameSignals: { get calls(): number { return signalCalls; } } };
}

const START_INPUT = {
  realization: realization("native", "local-media"),
  nativeSessionId: "native-s",
  liveInputId: null as string | null,
  sourceMediaId: "wfxitm_r25",
  targetLanguage: "en",
  sourceLanguageHint: "de",
  outputModalities: "text+audio" as const,
  subtitleMode: "bilingual" as const,
  speakerAttribution: "labeled" as const,
  visualContextPolicy: "adaptive" as const,
};

// ---------------------------------------------------------------------------
// The authorized-media law (the capability resolution)
// ---------------------------------------------------------------------------

describe("R25-W3 — the realtime media adapter: the authorized-media law", () => {
  it("a native rung with an engaged session answers authorized-local", () => {
    const capability = resolveRealtimeCaptureCapability({
      realization: realization("native", "local-media"),
      nativeSessionId: "native-s",
      liveInputId: null,
      realtimeProviderBound: true,
    });
    expect(capability.kind).toBe("authorized");
    if (capability.kind === "authorized") {
      expect(capability.capturePath).toBe("authorized-local");
      expect(capability.nativeSessionId).toBe("native-s");
    }
  });

  it("an authorized torrent/peer copy answers authorized-torrent (the connector truth)", () => {
    const capability = resolveRealtimeCaptureCapability({
      realization: realization("native", "authorized-peer-copy"),
      nativeSessionId: "native-s",
      liveInputId: null,
      realtimeProviderBound: true,
    });
    expect(capability.kind).toBe("authorized");
    if (capability.kind === "authorized") {
      expect(capability.capturePath).toBe("authorized-torrent");
    }
  });

  it("a live input answers controlled-live", () => {
    const capability = resolveRealtimeCaptureCapability({
      realization: realization("native", "wfx-live"),
      nativeSessionId: "native-s",
      liveInputId: "live-1",
      realtimeProviderBound: true,
    });
    expect(capability.kind).toBe("authorized");
    if (capability.kind === "authorized") {
      expect(capability.capturePath).toBe("controlled-live");
    }
  });

  it("THE EMBED LAW — the provider's contained surface answers the honest unavailable-restricted truth", () => {
    const capability = resolveRealtimeCaptureCapability({
      realization: realization("embed", "provider-x"),
      nativeSessionId: null,
      liveInputId: null,
      realtimeProviderBound: true,
    });
    expect(capability.kind).toBe("unavailable-restricted");
    if (capability.kind === "unavailable-restricted") {
      // The plan's alternatives + the never-bypass law, in the sentence.
      expect(capability.detail).toContain("DRM");
      expect(capability.detail).toContain("captions");
      expect(capability.detail).toContain("bypass");
    }
  });

  it("the external rung (another app's player) answers unavailable-restricted too", () => {
    const capability = resolveRealtimeCaptureCapability({
      realization: realization("external", "handoff"),
      nativeSessionId: null,
      liveInputId: null,
      realtimeProviderBound: true,
    });
    expect(capability.kind).toBe("unavailable-restricted");
  });

  it("an unbound provider answers the honest unavailable-no-provider truth (playback unaffected)", () => {
    const capability = resolveRealtimeCaptureCapability({
      realization: realization("native", "local-media"),
      nativeSessionId: "native-s",
      liveInputId: null,
      realtimeProviderBound: false,
    });
    expect(capability.kind).toBe("unavailable-no-provider");
  });

  it("the provider-bound truth distinguishes the honest unavailable factory from a bound seam", () => {
    expect(isProviderBound(createUnavailableRealtimeSessionFactory())).toBe(false);
    const { factory } = scriptedSessionFactory();
    expect(isProviderBound(factory)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The feed wiring (the capture → append-audio/append-image-frame seams)
// ---------------------------------------------------------------------------

describe("R25-W3 — the realtime media adapter: the feed wiring", () => {
  it("a started feed appends captured audio into the session seam and runs the sampler", async () => {
    const world = adapterWorld();
    const feed = await world.adapter.startFeed({ ...START_INPUT });
    expect("kind" in feed ? feed.kind : "feed").not.toBe("capture-unauthorized");
    if (!("session" in feed)) throw new Error("the feed should have started");
    const session = feed.session as ScriptedSession;
    expect(session.started).toBe(true);

    // The platform pushes decoded frames; the feed relays them into
    // appendAudio with the SOURCE'S OWN timeline as the alignment key.
    world.tap.push("native-s", 0);
    world.tap.push("native-s", 1_020);
    world.tap.push("native-s", 2_040);
    expect(session.appendedAudio.length).toBe(3);
    expect(session.appendedAudio[0]!.positionMs).toBe(0);
    expect(session.appendedAudio[1]!.positionMs).toBe(1_020);

    // The sampler considered every frame's signals and emitted the
    // informative one (scene 0.9 at position 0 → the scene-change
    // trigger; the calm ones suppressed).
    expect(session.appendedFrames.length).toBe(1);
    expect(session.appendedFrames[0]!.trigger).toBe("scene-change");

    // The honest accounting is live on the feed handle.
    expect(feed.captureStats().appendedAudioFrames).toBe(3);
    expect(feed.captureStats().appendedImageFrames).toBe(1);
    expect(feed.samplerReport().consideredFrames).toBe(3);

    // stop unsubscribes the tap; the session itself stays open (the
    // composition owns close).
    feed.stop();
    world.tap.push("native-s", 5_000);
    expect(session.appendedAudio.length).toBe(3);
  });

  it("THE NEVER-FORCED LAW — an audio-only policy appends ZERO frames while audio flows", async () => {
    const world = adapterWorld();
    const feed = await world.adapter.startFeed({ ...START_INPUT, visualContextPolicy: "audio-only" });
    if (!("session" in feed)) throw new Error("the audio-only feed should have started");
    const session = feed.session as ScriptedSession;
    world.tap.push("native-s", 0);
    world.tap.push("native-s", 1_020);
    expect(session.appendedAudio.length).toBe(2);
    expect(session.appendedFrames.length).toBe(0);
    expect(feed.samplerReport().policy).toBe("audio-only");
    expect(feed.samplerReport().emittedByTrigger["scene-change"]).toBe(0);
  });

  it("a restricted startFeed refuses BEFORE any session is created (never a bypass)", async () => {
    const world = adapterWorld();
    const failure = await world.adapter.startFeed({
      ...START_INPUT,
      realization: realization("embed", "provider-x"),
      nativeSessionId: null,
    });
    expect("kind" in failure && failure.kind).toBe("capture-unauthorized");
    expect(world.sessions.length).toBe(0);
    expect(world.tap.openTapCalls).toBe(0);
  });

  it("a refused tap closes the session honestly (never a session without its audio source)", async () => {
    const world = adapterWorld({ tapRefuse: true });
    const failure = await world.adapter.startFeed({ ...START_INPUT });
    expect("kind" in failure && failure.kind).toBe("capture-refused");
    if ("kind" in failure && failure.kind === "capture-refused") {
      expect(failure.detail).toContain("tap-open-failed");
    }
    expect(world.sessions.length).toBe(1);
    expect(world.sessions[0]!.closed).toBe(true);
  });

  it("a failed session.start unsubscribes the tap and closes the session", async () => {
    const world = adapterWorld({ failStart: true });
    const failure = await world.adapter.startFeed({ ...START_INPUT });
    expect("kind" in failure && failure.kind).toBe("session-creation-failed");
    expect(world.sessions.length).toBe(1);
    expect(world.sessions[0]!.closed).toBe(true);
    // The tap was opened then abandoned — the frames after go nowhere.
    world.tap.push("native-s", 0);
    expect(world.sessions[0]!.appendedAudio.length).toBe(0);
  });

  it("the session input carries the plan's vocabulary (the capture path + the language truth)", async () => {
    const captured: RealtimeTranslationSessionInput[] = [];
    const tap = new ScriptedTapSource();
    const capture = createNativeAudioCaptureService({
      tapSource: tap,
      sessionTruth: {
        sessionStateOf: (id: string): "resolving" | "buffering" | "playing" | "background" | "complete" | "failed" | null =>
          id === "native-s" ? "playing" : null,
      },
      clock: () => 0,
    });
    const { factory } = {
      factory: {
        async createSession(input: RealtimeTranslationSessionInput) {
          captured.push(input);
          return new ScriptedSession();
        },
      } satisfies RealtimeTranslationSessionFactory,
    };
    const adapter = createDesktopRealtimeMediaAdapter({
      captureService: capture,
      sessionFactory: factory,
      nowMs: () => 0,
      frameSignalsOf: (positionMs: number) => ({
        positionMs,
        sceneDifference: null,
        onScreenText: null,
        shotOrSpeakerIndex: null,
        bytes: null,
        mediaType: null,
      }),
    });
    await adapter.startFeed({
      ...START_INPUT,
      realization: realization("native", "authorized-peer-copy"),
      hotwords: [{ term: "Lena", translation: "Lena" }],
    });
    expect(captured.length).toBe(1);
    const input = captured[0]!;
    expect(input.sourceAudio.capturePath).toBe("authorized-torrent");
    expect(input.sourceAudio.sourceId).toBe("native-s");
    expect(input.targetLanguage).toBe("en");
    expect(input.sourceLanguageHint).toBe("de");
    expect(input.subtitleMode).toBe("bilingual");
    expect(input.speakerAttribution).toBe("labeled");
    expect(input.hotwords.length).toBe(1);
    expect(input.translatedVoice.mode).toBe("neutral"); // never a silent clone
    expect(input.imageFrames?.policy).toBe("adaptive");
  });
});
