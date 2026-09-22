/**
 * R25-L — the Model Fabric realtime binding's laws (the integration seam:
 * the desktop composition bound to the ONE frozen canonical contract).
 *
 * Proven here (machine-checked):
 * - THE VOCABULARY IS ONE: the canonical frozen event-kind list and the
 *   desktop port's list are element-for-element identical (the module's
 *   load-time drift guard + this explicit 1:1 assertion).
 * - THE INPUT PROJECTION IS FAITHFUL: every desktop input field lands on
 *   the canonical inputs honestly (the lawful-capture truth, the
 *   hotword rename, the voice-policy/consent mapping, the null-to-absent
 *   laws) — and Worker 1's fail-closed validation gates the canonical
 *   factory (invalid input NEVER reaches it; voice preservation without
 *   a satisfied consent record is refused).
 * - THE EVENT PROJECTION IS HONEST: every desktop event field is carried
 *   from the canonical event or LOCALLY measured (the monotone seq, the
 *   tracked speaker, the stream positions for drift, the local usage
 *   accounting — audio ms from the appended frames, image frames,
 *   settled translation text, received translated-audio ms); the drift
 *   observation is honestly absent until both streams have been
 *   observed.
 * - THE OPERATIONS DELEGATE: the desktop port's seven operations reach
 *   the canonical session (reconnect is the canonical resume — never a
 *   media restart), and a rejecting canonical append never throws into
 *   the capture path (failures surface as session events, by contract).
 * - THE FAILURE MAPPING IS TYPED: a refusing canonical factory answers
 *   the desktop `capability-unavailable` failure with the honest
 *   message — never a fake session, never a silent success.
 */

import { describe, expect, it } from "bun:test";

import { createRealtimeEventStream, REALTIME_EVENT_KINDS } from "@wfx/model-fabric";
import type {
  RealtimeTranslationSession as CanonicalRealtimeTranslationSession,
  RealtimeTranslationSessionFactory as CanonicalRealtimeTranslationSessionFactory,
  RealtimeTranslationSessionInputs,
  RealtimeTranslationSessionState,
} from "@wfx/domain";

import {
  createModelFabricRealtimeTranslationSessionFactory,
  projectDesktopRealtimeInputs,
} from "../src/platform/realtime-model-fabric-binding";
import {
  REALTIME_TRANSLATION_EVENT_KINDS,
  type RealtimeTranslationEvent as DesktopRealtimeTranslationEvent,
  type RealtimeTranslationSessionInput,
} from "../src/platform/realtime-translation-port";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DESKTOP_INPUT: RealtimeTranslationSessionInput = {
  sourceMediaId: "item-1",
  sourceAudio: {
    capturePath: "authorized-local",
    sourceId: "native-session-1",
    sourceMediaId: "item-1",
    format: { sampleRateHz: 48000, channels: 2, encoding: "pcm-s16le" },
  },
  imageFrames: { policy: "adaptive" },
  sourceLanguageHint: "en",
  targetLanguage: "es",
  outputModalities: "text+audio",
  subtitleMode: "bilingual",
  speakerAttribution: "labeled",
  hotwords: [{ term: "Kafka", translation: "Kafka" }],
  translatedVoice: { mode: "neutral", consent: null },
};

/** A canonical session double over a stream the test controls. */
function createCanonicalDouble(sessionId = "canonical-double"): {
  canonical: CanonicalRealtimeTranslationSession;
  stream: ReturnType<typeof createRealtimeEventStream>["stream"];
  calls: string[];
} {
  const { stream, events } = createRealtimeEventStream();
  const calls: string[] = [];
  let state: RealtimeTranslationSessionState = "idle";
  const canonical: CanonicalRealtimeTranslationSession = {
    sessionId,
    get state(): RealtimeTranslationSessionState {
      return state;
    },
    async start(): Promise<void> {
      calls.push("start");
      state = "starting";
    },
    async configure(): Promise<void> {
      calls.push("configure");
    },
    async appendAudio(): Promise<void> {
      calls.push("append-audio");
    },
    async appendImageFrame(): Promise<void> {
      calls.push("append-image-frame");
    },
    async stop(): Promise<void> {
      calls.push("stop");
      state = "stopped";
    },
    async reconnect(): Promise<void> {
      calls.push("reconnect");
      state = "streaming";
    },
    async close(): Promise<void> {
      calls.push("close");
      state = "closed";
      stream.close();
    },
    events,
  };
  return { canonical, stream, calls };
}

/** A canonical factory that hands back one controlled double. */
function createCanonicalFactory(
  canonical: CanonicalRealtimeTranslationSession,
): CanonicalRealtimeTranslationSessionFactory & { opened: RealtimeTranslationSessionInputs[] } {
  const opened: RealtimeTranslationSessionInputs[] = [];
  return {
    opened,
    async open(inputs: RealtimeTranslationSessionInputs): Promise<CanonicalRealtimeTranslationSession> {
      opened.push(inputs);
      return canonical;
    },
  };
}

/** Let the binding's consume loop drain the pushed canonical events. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10);
  });
}

const OCCURRED_AT = "2026-09-22T06:00:00.000Z";

// ---------------------------------------------------------------------------
// The vocabulary invariant
// ---------------------------------------------------------------------------

describe("R25-L realtime model fabric binding — the vocabulary invariant", () => {
  it("the desktop port's event kinds are the canonical frozen list, element for element", () => {
    // The binding module itself fails fast on drift (module-load guard);
    // this asserts the 1:1 explicitly for the record.
    expect([...REALTIME_TRANSLATION_EVENT_KINDS]).toEqual([
      ...REALTIME_EVENT_KINDS,
    ]);
  });
});

// ---------------------------------------------------------------------------
// The input projection
// ---------------------------------------------------------------------------

describe("R25-L realtime model fabric binding — the input projection", () => {
  it("projects every desktop input field onto the canonical inputs honestly", () => {
    const projected = projectDesktopRealtimeInputs(DESKTOP_INPUT);
    expect(projected.sourceMedia).toEqual({
      itemId: "item-1",
      audioStreamLegallyAvailable: true,
    });
    expect(projected.targetLanguage).toBe("es");
    expect(projected.sourceLanguageHint).toBe("en");
    expect(projected.outputModality).toBe("text-and-audio");
    expect(projected.subtitleMode).toBe("bilingual");
    expect(projected.speakerAttribution).toBe("simple-labels");
    expect(projected.visualContextPolicy).toBe("adaptive");
    expect(projected.hotwords).toEqual([
      { term: "Kafka", preferredRendering: "Kafka" },
    ]);
    expect(projected.translatedVoicePolicy).toBe("neutral-system-voice");
    expect("voiceConsent" in projected && projected.voiceConsent !== undefined).toBe(false);
  });

  it("maps the null/absent laws: no hint, no frame stream, no consent", () => {
    const projected = projectDesktopRealtimeInputs({
      ...DESKTOP_INPUT,
      sourceMediaId: null,
      imageFrames: null,
      sourceLanguageHint: null,
      hotwords: [{ term: "ono", translation: "" }],
      translatedVoice: { mode: "preserve-source", consent: { basis: "rights-holder-consent", recordedAt: OCCURRED_AT } },
    });
    expect(projected.sourceMedia.itemId).toBeUndefined();
    expect(projected.sourceMedia.audioStreamLegallyAvailable).toBe(true);
    expect("sourceLanguageHint" in projected).toBe(false);
    expect(projected.visualContextPolicy).toBe("off");
    expect(projected.hotwords).toEqual([{ term: "ono" }]);
    expect(projected.translatedVoicePolicy).toBe("preserve-source-voice");
    expect(projected.voiceConsent).toEqual({
      state: "satisfied",
      basis: "rights-holder-consent",
      recordedAt: OCCURRED_AT,
    });
  });
});

// ---------------------------------------------------------------------------
// The factory binding — validation + failure mapping
// ---------------------------------------------------------------------------

describe("R25-L realtime model fabric binding — the factory gates", () => {
  it("refuses invalid input through Worker 1's fail-closed gate and never calls the canonical factory", async () => {
    const { canonical } = createCanonicalDouble();
    const factory = createCanonicalFactory(canonical);
    const binding = createModelFabricRealtimeTranslationSessionFactory(factory);
    const outcome = await binding.createSession({
      ...DESKTOP_INPUT,
      targetLanguage: "",
    });
    expect(outcome).toMatchObject({ kind: "invalid-input" });
    expect(factory.opened).toHaveLength(0);
  });

  it("refuses voice preservation without a satisfied consent record (the consent gate)", async () => {
    const { canonical } = createCanonicalDouble();
    const factory = createCanonicalFactory(canonical);
    const binding = createModelFabricRealtimeTranslationSessionFactory(factory);
    const outcome = await binding.createSession({
      ...DESKTOP_INPUT,
      translatedVoice: { mode: "preserve-source", consent: null },
    });
    expect(outcome).toMatchObject({ kind: "invalid-input" });
    expect(
      "kind" in outcome &&
        outcome.kind === "invalid-input" &&
        outcome.detail.includes("voiceConsent"),
    ).toBe(true);
    expect(factory.opened).toHaveLength(0);
  });

  it("maps a refusing canonical factory to the typed capability-unavailable failure", async () => {
    const binding = createModelFabricRealtimeTranslationSessionFactory({
      async open(): Promise<CanonicalRealtimeTranslationSession> {
        throw new Error("no capable specialist registered for this direction");
      },
    });
    const outcome = await binding.createSession(DESKTOP_INPUT);
    expect(outcome).toEqual({
      kind: "capability-unavailable",
      detail:
        "the Model Fabric realtime session factory refused the session: no capable specialist registered for this direction",
    });
  });

  it("opens the canonical factory with the projected, validated inputs", async () => {
    const { canonical } = createCanonicalDouble();
    const factory = createCanonicalFactory(canonical);
    const binding = createModelFabricRealtimeTranslationSessionFactory(factory);
    const outcome = await binding.createSession(DESKTOP_INPUT);
    expect(outcome).not.toHaveProperty("kind");
    expect(factory.opened).toHaveLength(1);
    expect(factory.opened[0]?.targetLanguage).toBe("es");
    expect(factory.opened[0]?.sourceMedia.audioStreamLegallyAvailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The session adapter — operations + the event projection
// ---------------------------------------------------------------------------

describe("R25-L realtime model fabric binding — the session adapter", () => {
  it("delegates the seven operations to the canonical session (reconnect is the canonical resume)", async () => {
    const { canonical, calls } = createCanonicalDouble();
    const binding = createModelFabricRealtimeTranslationSessionFactory(
      createCanonicalFactory(canonical),
    );
    const session = (await binding.createSession(DESKTOP_INPUT)) as {
      id: string;
      start(): Promise<void>;
      configure(update: { targetLanguage?: string }): Promise<void>;
      appendAudio(frame: { positionMs: number; samples: Uint8Array }): void;
      appendImageFrame(frame: { positionMs: number; bytes: Uint8Array; mediaType: "image/jpeg"; trigger: "periodic-fallback" }): void;
      stop(): Promise<void>;
      reconnect(): Promise<void>;
      close(): Promise<void>;
      subscribe(listener: (event: DesktopRealtimeTranslationEvent) => void): () => void;
    };
    expect(session.id).toBe("canonical-double");
    await session.start();
    await session.configure({ targetLanguage: "de" });
    session.appendAudio({ positionMs: 1000, samples: new Uint8Array(9600) });
    session.appendImageFrame({
      positionMs: 1200,
      bytes: new Uint8Array(8),
      mediaType: "image/jpeg",
      trigger: "periodic-fallback",
    });
    await session.stop();
    await session.reconnect();
    await session.close();
    expect(calls).toEqual([
      "start",
      "configure",
      "append-audio",
      "append-image-frame",
      "stop",
      "reconnect",
      "close",
    ]);
  });

  it("never throws a rejecting canonical append into the capture path", async () => {
    const { stream, events } = createRealtimeEventStream();
    const canonical: CanonicalRealtimeTranslationSession = {
      sessionId: "rejecting-append",
      state: "streaming",
      async start(): Promise<void> {},
      async configure(): Promise<void> {},
      async appendAudio(): Promise<void> {
        throw new Error("append refused");
      },
      async appendImageFrame(): Promise<void> {},
      async stop(): Promise<void> {},
      async reconnect(): Promise<void> {},
      async close(): Promise<void> {
        stream.close();
      },
      events,
    };
    const binding = createModelFabricRealtimeTranslationSessionFactory(
      createCanonicalFactory(canonical),
    );
    const session = (await binding.createSession(DESKTOP_INPUT)) as {
      appendAudio(frame: { positionMs: number; samples: Uint8Array }): void;
    };
    expect(() => {
      session.appendAudio({ positionMs: 0, samples: new Uint8Array(4) });
    }).not.toThrow();
    await flush();
  });

  it("projects the canonical event stream onto the desktop shapes with locally measured fields", async () => {
    const { canonical, stream } = createCanonicalDouble("session-7");
    const binding = createModelFabricRealtimeTranslationSessionFactory(
      createCanonicalFactory(canonical),
    );
    const session = (await binding.createSession(DESKTOP_INPUT)) as {
      appendAudio(frame: { positionMs: number; samples: Uint8Array }): void;
      appendImageFrame(frame: { positionMs: number; bytes: Uint8Array; mediaType: "image/jpeg"; trigger: "periodic-fallback" }): void;
      subscribe(listener: (event: DesktopRealtimeTranslationEvent) => void): () => void;
    };
    const received: DesktopRealtimeTranslationEvent[] = [];
    session.subscribe((event) => {
      received.push(event);
    });

    // Local accounting inputs: 9600 bytes of s16le stereo at 48kHz = 50ms.
    session.appendAudio({ positionMs: 0, samples: new Uint8Array(9600) });
    session.appendImageFrame({
      positionMs: 100,
      bytes: new Uint8Array(8),
      mediaType: "image/jpeg",
      trigger: "periodic-fallback",
    });

    const inputs = projectDesktopRealtimeInputs(DESKTOP_INPUT);
    stream.push({
      kind: "session-created",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      providerId: "managed-cloud:qwen3.8-livetranslate-flash-realtime",
      modelId: "qwen3.8-livetranslate-flash-realtime",
      modelRevision: "rev-1",
      effectiveInputs: inputs,
    });
    stream.push({
      kind: "source-transcript-delta",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      segmentId: "s1",
      deltaText: "Hola",
      timing: { startedAtMs: 1000, endedAtMs: 1400 },
    });
    stream.push({
      kind: "speaker-attribution",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      speakerId: "spk-2",
      label: "Speaker 2",
      trustedSource: true,
    });
    stream.push({
      kind: "source-transcript-final",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      segmentId: "s1",
      text: "Hola mundo",
      timing: { startedAtMs: 1000, endedAtMs: 2000 },
    });
    stream.push({
      kind: "translation-segment-final",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      segmentId: "t1",
      sourceSegmentId: "s1",
      targetLanguage: "es",
      text: "Hello world",
      timing: { startedAtMs: 1000, endedAtMs: 2100 },
    });
    stream.push({
      kind: "translated-audio-chunk",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      sequence: 1,
      audio: new Uint8Array([1, 2, 3, 4]),
      format: "pcm16",
      timing: { startedAtMs: 1000, endedAtMs: 1150 },
    });
    stream.push({
      kind: "timing-metadata",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
    });
    stream.push({
      kind: "usage-telemetry",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      usage: {
        inputAudioTokens: 54000,
        textOutputTokens: 400,
        outputAudioTokens: 14000,
        imageInputTokens: 0,
      },
    });
    stream.push({
      kind: "recoverable-error",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      errorKind: "network",
      detail: "transport lost",
      recovery: "the session resumes on reconnect — playback continues",
    });
    stream.push({
      kind: "terminal-error",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      errorKind: "provider-failure",
      detail: "the bounded retry budget was exhausted",
    });
    stream.push({
      kind: "session-closed",
      sessionId: "session-7",
      occurredAt: OCCURRED_AT,
      reason: "user-stop",
    });
    await flush();

    // session-created: honest null source language; target from inputs.
    expect(received[0]).toEqual({
      kind: "session-created",
      sessionId: "session-7",
      sourceLanguage: null,
      targetLanguage: "es",
    });
    // The delta carries the canonical timing position, no speaker yet.
    expect(received[1]).toEqual({
      kind: "source-transcript-delta",
      seq: 1,
      text: "Hola",
      positionMs: 1000,
      speaker: null,
    });
    // The attribution lands at the last source position; later events
    // carry the tracked speaker.
    expect(received[2]).toEqual({
      kind: "speaker-attribution",
      seq: 2,
      speaker: "Speaker 2",
      positionMs: 1000,
    });
    expect(received[3]).toEqual({
      kind: "source-transcript-final",
      seq: 3,
      text: "Hola mundo",
      positionMs: 1000,
      durationMs: 1000,
      speaker: "Speaker 2",
    });
    expect(received[4]).toEqual({
      kind: "translation-segment-final",
      seq: 4,
      text: "Hello world",
      positionMs: 1000,
      durationMs: 1100,
      speaker: "Speaker 2",
    });
    expect(received[5]).toEqual({
      kind: "translated-audio-chunk",
      seq: 5,
      samples: new Uint8Array([1, 2, 3, 4]),
      durationMs: 150,
      positionMs: 1000,
    });
    // The drift observation is LOCALLY measured (source vs translation
    // stream positions), only once both have been observed.
    expect(received[6]).toEqual({
      kind: "timing-metadata",
      seq: 6,
      sourceConsumedMs: 1000,
      translationRenderedMs: 1000,
    });
    // The usage event reports the adapter's OWN locally measured
    // accounting — the provider token truth is never re-derived.
    expect(received[7]).toEqual({
      kind: "usage-telemetry",
      seq: 7,
      usage: {
        inputAudioMs: 50,
        inputImageFrames: 1,
        outputTextCharacters: "Hello world".length,
        outputAudioMs: 150,
      },
    });
    expect(received[8]).toEqual({
      kind: "recoverable-error",
      detail:
        "transport lost — the session resumes on reconnect — playback continues",
      requiresReconnect: true,
    });
    expect(received[9]).toEqual({
      kind: "terminal-error",
      detail:
        "provider-failure: the bounded retry budget was exhausted",
    });
    expect(received[10]).toEqual({
      kind: "session-closed",
      reason: "stopped",
    });
    // The desktop seq law: monotone from 1 across the text stream.
    const textSeqs = received
      .filter((event) => event.kind !== "session-created" && event.kind !== "recoverable-error" && event.kind !== "terminal-error" && event.kind !== "session-closed")
      .map((event) =>
        event.kind === "usage-telemetry" || event.kind === "timing-metadata" || event.kind === "speaker-attribution" || event.kind === "source-transcript-delta" || event.kind === "source-transcript-final" || event.kind === "translation-segment-final" || event.kind === "translated-audio-chunk"
          ? event.seq
          : -1,
      );
    expect(textSeqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("honestly emits no drift observation before both streams have been observed", async () => {
    const { canonical, stream } = createCanonicalDouble("session-8");
    const binding = createModelFabricRealtimeTranslationSessionFactory(
      createCanonicalFactory(canonical),
    );
    const session = (await binding.createSession(DESKTOP_INPUT)) as {
      subscribe(listener: (event: DesktopRealtimeTranslationEvent) => void): () => void;
    };
    const received: DesktopRealtimeTranslationEvent[] = [];
    session.subscribe((event) => {
      received.push(event);
    });
    // Only a SOURCE delta has been observed — no translation yet.
    stream.push({
      kind: "source-transcript-delta",
      sessionId: "session-8",
      occurredAt: OCCURRED_AT,
      segmentId: "s1",
      deltaText: "solo fuente",
      timing: { startedAtMs: 500, endedAtMs: 700 },
    });
    stream.push({
      kind: "timing-metadata",
      sessionId: "session-8",
      occurredAt: OCCURRED_AT,
    });
    await flush();
    expect(received.map((event) => event.kind)).toEqual([
      "source-transcript-delta",
    ]);
  });

  it("maps the canonical close reasons honestly (source-ended is never fabricated)", async () => {
    const { canonical, stream } = createCanonicalDouble("session-9");
    const binding = createModelFabricRealtimeTranslationSessionFactory(
      createCanonicalFactory(canonical),
    );
    const session = (await binding.createSession(DESKTOP_INPUT)) as {
      subscribe(listener: (event: DesktopRealtimeTranslationEvent) => void): () => void;
    };
    const received: DesktopRealtimeTranslationEvent[] = [];
    session.subscribe((event) => {
      received.push(event);
    });
    for (const reason of ["provider-closed", "user-close", "policy"] as const) {
      stream.push({
        kind: "session-closed",
        sessionId: "session-9",
        occurredAt: OCCURRED_AT,
        reason,
      });
    }
    await flush();
    expect(
      received.map((event) => (event.kind === "session-closed" ? event.reason : event.kind)),
    ).toEqual(["closed", "closed", "closed"]);
  });
});
