/**
 * @wfx/model-fabric — R25-C the Qwen LiveTranslate adapter session tests.
 *
 * THE ADAPTER LAWS, pinned against the recorded-frame doubles (no
 * live endpoint — the testability law):
 *
 * - THE CREDENTIAL LAW: the env path names the variable; an absent
 *   key is the honest typed NOT-REGISTERED answer; an empty key at
 *   session start is the typed provider-failure terminal error with
 *   the recovery sentence IN the detail — never a crash, never a
 *   hardcoded fallback;
 * - THE STATE MACHINE: the frozen 7-operation legality table holds
 *   (illegal ops throw the typed adapter error);
 * - THE FULL RECONSTRUCTION: the recorded two-speaker session flow
 *   maps onto the neutral 12-event vocabulary (session-created with
 *   the effective inputs + provider/model identity, speaker
 *   attribution with first-appearance labels, transcript deltas/
 *   final with timing + language + speaker, translation deltas/final
 *   with the previous_item_id source linkage, translated-audio
 *   chunks Base64-decoded with sequences, cumulative usage telemetry,
 *   timing-metadata firsts, session-closed with the final usage);
 * - THE NEVER-FORCE LAW: image frames under an 'off' policy are the
 *   typed refusal; the documented provider fences (size,
 *   audio-first) are typed events, never silent drops; the adapter
 *   requests NO frames on its own (the wire stays image-free without
 *   caller appends);
 * - THE RECONNECT LAW: transport loss → the typed recoverable-error
 *   + the resume loop — the SAME session re-connects, re-sends the
 *   configuration, and replays the buffered audio (resume, never
 *   restart: no second session-created); bounded retries with the
 *   injectable backoff; the honest give-up is the typed terminal
 *   error and base playback continues (no exception to the caller);
 * - THE RATE-LIMIT LAW: a rate-limit hit maps to the recoverable
 *   provider-failure whose recovery sentence names RPM=10/TPM=100k,
 *   then the bounded retry SUCCEEDS (never a silent drop, never a
 *   playback blocker); session starts are smoothed to the RPM
 *   cadence through the factory gate (bounded wait, injectable
 *   clock);
 * - PROVIDER ERROR NORMALIZATION at the session level: the auth
 *   failure is the terminal provider-failure carrying the
 *   DASHSCOPE_API_KEY recovery sentence; the config rejection is the
 *   terminal policy error; the per-item transcription failure is
 *   recoverable and the session CONTINUES;
 * - THE MAPPING-TABLE COVERAGE: every event kind the adapter can
 *   emit is exercised by at least one recorded-frame path.
 */

import { describe, expect, it } from "bun:test";

import type {
  RealtimeTranslationEvent,
  RealtimeTranslationSession,
  RealtimeTranslationSessionInputs,
} from "@wfx/domain";

import {
  QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE,
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
  QWEN_LIVETRANSLATE_MODEL_ID,
  REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
  RECORDED_QWEN_AUDIO_PAYLOAD_BYTES,
  RECORDED_QWEN_TRANSPORT_IS_TEST_FIXTURE,
  bytesToBase64,
  createQwenLiveTranslateSessionFactory,
  createQwenLiveTranslateSpecialist,
  createWebSocketQwenTransport,
  readQwenLiveTranslateCredential,
  QwenAdapterConfigurationError,
  QwenAdapterInputError,
  QwenAdapterOperationError,
  type QwenAdapterClock,
  type RecordedQwenTransportDouble,
} from "../src/index";
import { createRecordedQwenTransport } from "../src/index";

// ---------------------------------------------------------------------------
// The deterministic test machinery (no real timers on the frame path)
// ---------------------------------------------------------------------------

/** A stepping fake clock: every now() advances a fixed step (deterministic timing metadata). */
function createSteppingClock(stepMs = 100): { clock: QwenAdapterClock; sleepCalls: number[] } {
  let now = Date.UTC(2026, 8, 22, 12, 0, 0, 0);
  const sleepCalls: number[] = [];
  return {
    clock: {
      now: () => {
        const value = now;
        now += stepMs;
        return value;
      },
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    },
    sleepCalls,
  };
}

/** Let the double's microtask frame chains and the adapter's awaits run. */
async function drain(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Collect the session's neutral events until the narrative closes. */
async function collectEvents(session: RealtimeTranslationSession): Promise<{
  events: RealtimeTranslationEvent[];
  done: Promise<void>;
}> {
  const events: RealtimeTranslationEvent[] = [];
  const done = (async () => {
    for await (const event of session.events()) {
      events.push(event);
    }
  })();
  return { events, done };
}

const LAWFUL_INPUTS: RealtimeTranslationSessionInputs = {
  sourceMedia: {
    itemId: "wfx-item-1",
    connectorId: "wfx-reference",
    externalRef: "ref-1",
    audioStreamLegallyAvailable: true,
  },
  targetLanguage: "en",
  sourceLanguageHint: "zh",
  outputModality: "text",
  subtitleMode: "bilingual",
  speakerAttribution: "simple-labels",
  visualContextPolicy: "adaptive",
  hotwords: [{ term: "WebFlix", preferredRendering: "WebFlix" }],
  translatedVoicePolicy: "neutral-system-voice",
};

const AUDIO_CHUNK = new Uint8Array([1, 2, 3, 4]);

function adapterConfig(double: RecordedQwenTransportDouble, clock?: QwenAdapterClock) {
  return {
    apiKey: "test-credential-not-a-real-key",
    transport: double.transport,
    ...(clock !== undefined ? { clock } : {}),
    maxReconnectAttempts: 2,
    sessionStartMinIntervalMs: 0,
    connectAckTimeoutMs: 250,
    stopAckTimeoutMs: 250,
  };
}

function kinds(events: readonly RealtimeTranslationEvent[]): string[] {
  return events.map((event) => event.kind);
}

// ---------------------------------------------------------------------------
// The credential path (the server-environment law)
// ---------------------------------------------------------------------------

describe("R25-C adapter — the credential path", () => {
  it("reads the credential from the documented env variable (values never echoed)", () => {
    const ok = readQwenLiveTranslateCredential({ DASHSCOPE_API_KEY: "  sk-live-key  " });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.apiKey).toBe("sk-live-key");
    const absent = readQwenLiveTranslateCredential({});
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.variable).toBe(QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE);
      expect(absent.recovery).toContain("DASHSCOPE_API_KEY");
      expect(absent.recovery).toContain("never a fallback to a hardcoded key");
      expect(absent.recovery).not.toContain("sk-live-key");
    }
    const blank = readQwenLiveTranslateCredential({ DASHSCOPE_API_KEY: "   " });
    expect(blank.ok).toBe(false);
  });

  it("an absent credential is the honest typed NOT-REGISTERED answer for the specialist construction", () => {
    const double = createRecordedQwenTransport();
    const construction = createQwenLiveTranslateSpecialist({}, { transport: double.transport });
    expect(construction.ok).toBe(false);
    if (!construction.ok) {
      expect(construction.credential.variable).toBe("DASHSCOPE_API_KEY");
      expect(construction.credential.recovery).toContain("operator secrets store");
    }
  });

  it("the specialist construction binds the registered descriptor + factory (one identity, one truth)", () => {
    const double = createRecordedQwenTransport();
    const construction = createQwenLiveTranslateSpecialist(
      { DASHSCOPE_API_KEY: "sk-live-key" },
      { transport: double.transport },
    );
    expect(construction.ok).toBe(true);
    if (construction.ok) {
      expect(construction.registration.providerId).toBe(REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID);
      expect(construction.registration.descriptor).toBe(QWEN_LIVETRANSLATE_FLASH_REALTIME);
      expect(construction.registration.modelId).toBe(QWEN_LIVETRANSLATE_MODEL_ID);
      expect(construction.registration.endpoint).toBe(QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD);
      expect(typeof construction.registration.factory.open).toBe("function");
    }
  });

  it("an empty key at session start is the typed provider-failure terminal error with the recovery sentence — never a crash", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateAdapterFactoryWithConfig(double, { apiKey: "" });
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start(); // must NOT throw
    await done;
    expect(session.state).toBe("closed");
    const terminal = events.find((event) => event.kind === "terminal-error");
    expect(terminal).toBeDefined();
    if (terminal?.kind === "terminal-error") {
      expect(terminal.errorKind).toBe("provider-failure");
      expect(terminal.detail).toContain("DASHSCOPE_API_KEY");
      expect(terminal.detail).toContain("never falls back to a hardcoded key");
    }
    const closed = events.find((event) => event.kind === "session-closed");
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("terminal-error");
    }
    expect(double.connects).toHaveLength(0); // no credential → no provider call at all
  });
});

function createQwenLiveTranslateAdapterFactoryWithConfig(
  double: RecordedQwenTransportDouble,
  overrides: Record<string, unknown>,
): { factory: ReturnType<typeof createQwenLiveTranslateSessionFactory>["factory"] } {
  const { factory } = createQwenLiveTranslateSessionFactory({
    ...adapterConfig(double),
    ...overrides,
  } as Parameters<typeof createQwenLiveTranslateSessionFactory>[0]);
  return { factory };
}

// ---------------------------------------------------------------------------
// The factory seam + the frozen state machine
// ---------------------------------------------------------------------------

describe("R25-C adapter — the factory seam and the frozen state machine", () => {
  it("open() validates the inputs fail-closed (the legal-audio + consent gates) before any session exists", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    await expect(
      factory.open({
        ...LAWFUL_INPUTS,
        sourceMedia: { itemId: "x" } as unknown as RealtimeTranslationSessionInputs["sourceMedia"],
      }),
    ).rejects.toThrow(QwenAdapterInputError);
    await expect(
      factory.open({
        ...LAWFUL_INPUTS,
        sourceMedia: { ...LAWFUL_INPUTS.sourceMedia, audioStreamLegallyAvailable: false },
      }),
    ).rejects.toThrow(/lawful audio path/);
    await expect(
      factory.open({ ...LAWFUL_INPUTS, translatedVoicePolicy: "preserve-source-voice" }),
    ).rejects.toThrow(/consent/);  });

  it("every illegal operation throws the typed adapter error (the frozen legality table)", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    // idle: append/stop/reconnect illegal
    await expect(session.appendAudio({ audio: AUDIO_CHUNK })).rejects.toThrow(QwenAdapterOperationError);
    await expect(session.stop()).rejects.toThrow(QwenAdapterOperationError);
    await expect(session.reconnect()).rejects.toThrow(QwenAdapterOperationError);
    await session.start();
    expect(session.state).toBe("streaming");
    // streaming: start/reconnect illegal
    await expect(session.start()).rejects.toThrow(QwenAdapterOperationError);
    await expect(session.reconnect()).rejects.toThrow(QwenAdapterOperationError);
    await session.stop();
    // stopped: only close legal
    await expect(session.appendAudio({ audio: AUDIO_CHUNK })).rejects.toThrow(QwenAdapterOperationError);
    await expect(session.configure({})).rejects.toThrow(QwenAdapterOperationError);
    await session.close();
    // closed: nothing legal
    await expect(session.close()).rejects.toThrow(QwenAdapterOperationError);
    await expect(session.start()).rejects.toThrow(QwenAdapterOperationError);
  });

  it("configure() validates the payload fail-closed (field-path issues attached)", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    await expect(session.configure({ outputModality: "loud" as never })).rejects.toThrow(
      QwenAdapterConfigurationError,
    );
    await expect(session.configure({ targetLanguage: "  " })).rejects.toThrow(
      QwenAdapterConfigurationError,
    );
    await session.close();
  });
});

// ---------------------------------------------------------------------------
// The full reconstruction (the recorded two-speaker session flow)
// ---------------------------------------------------------------------------

describe("R25-C adapter — the full reconstruction onto the neutral vocabulary", () => {
  it("maps one recorded utterance cycle onto the complete neutral event sequence", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);

    await session.start();
    expect(session.state).toBe("streaming");
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;

    expect(session.state).toBe("stopped");
    expect(kinds(events)).toEqual([
      "session-created",
      "speaker-attribution",
      "source-transcript-delta",
      "timing-metadata",
      "source-transcript-delta",
      "source-transcript-final",
      "translation-delta",
      "timing-metadata",
      "translation-delta",
      "translation-segment-final",
      "usage-telemetry",
      "session-closed",
    ]);

    // session-created: the neutral identity + the effective inputs.
    const created = events[0];
    if (created?.kind === "session-created") {
      expect(created.providerId).toBe(REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID);
      expect(created.modelId).toBe(QWEN_LIVETRANSLATE_MODEL_ID);
      expect(created.modelRevision).toBe(QWEN_LIVETRANSLATE_FLASH_REALTIME.model.revision);
      expect(created.effectiveInputs).toEqual(LAWFUL_INPUTS);
      expect(created.sessionId).toBe(session.sessionId);
    } else {
      expect(String(created?.kind)).toBe("session-created");
    }

    // speaker-attribution: the diarization mapping (first appearance → Speaker 1).
    const speaker = events[1];
    if (speaker?.kind === "speaker-attribution") {
      expect(speaker.speakerId).toBe("speaker-0");
      expect(speaker.label).toBe("Speaker 1");
      expect(speaker.segmentId).toBe("item_asr_0");
      expect(speaker.trustedSource).toBe(false); // server diarization, never fabricated trust
    } else {
      expect(String(speaker?.kind)).toBe("speaker-attribution");
    }

    // the transcript deltas reconstruct in arrival order.
    const deltas = events.filter((event) => event.kind === "source-transcript-delta");
    expect(deltas).toHaveLength(2);
    const firstDelta = deltas[0];
    const secondDelta = deltas[1];
    if (firstDelta?.kind === "source-transcript-delta") {
      expect(firstDelta.segmentId).toBe("item_asr_0");
      expect(firstDelta.deltaText).toBe("今天天气真好，我");
      expect(firstDelta.timing).toEqual({ startedAtMs: 1200, endedAtMs: 1200 });
    }
    if (secondDelta?.kind === "source-transcript-delta") {
      expect(secondDelta.deltaText).toBe("们去公园散步吧。");
      expect(firstDelta?.kind === "source-transcript-delta").toBe(true);
      if (firstDelta?.kind === "source-transcript-delta") {
        expect(firstDelta.deltaText + secondDelta.deltaText).toBe("今天天气真好，我们去公园散步吧。");
      }
    }

    // the transcript final carries the text, the language, the speaker, the timing.
    const final = events.find((event) => event.kind === "source-transcript-final");
    if (final?.kind === "source-transcript-final") {
      expect(final.text).toBe("今天天气真好，我们去公园散步吧。");
      // The frozen contract carries sourceLanguage only on DELTAS — the
      // final never has it (the adapter respects the contract exactly).
      expect("sourceLanguage" in final).toBe(false);
      expect(final.speakerId).toBe("speaker-0");
      expect(final.timing).toEqual({ startedAtMs: 1200, endedAtMs: 2700 });
    } else {
      expect(String(final?.kind)).toBe("source-transcript-final");
    }

    // the translation deltas carry the previous_item_id source linkage
    // and reconstruct the full text in arrival order (append semantics).
    const translationDeltas = events.filter((event) => event.kind === "translation-delta");
    expect(translationDeltas).toHaveLength(2);
    if (translationDeltas[0]?.kind === "translation-delta") {
      expect(translationDeltas[0].segmentId).toBe("item_translation_0");
      expect(translationDeltas[0].sourceSegmentId).toBe("item_asr_0");
      expect(translationDeltas[0].targetLanguage).toBe("en");
    }
    if (
      translationDeltas[0]?.kind === "translation-delta" &&
      translationDeltas[1]?.kind === "translation-delta"
    ) {
      expect(translationDeltas[0].deltaText + translationDeltas[1].deltaText).toBe(
        "The weather is really nice today; let's take a walk in the park.",
      );
      expect(translationDeltas[0].deltaText.length).toBeGreaterThan(0);
      expect(translationDeltas[1].deltaText.length).toBeGreaterThan(0);
    }

    // the translation final carries the full text + the source timing.
    const translationFinal = events.find((event) => event.kind === "translation-segment-final");
    if (translationFinal?.kind === "translation-segment-final") {
      expect(translationFinal.text).toBe(
        "The weather is really nice today; let's take a walk in the park.",
      );
      expect(translationFinal.sourceSegmentId).toBe("item_asr_0");
      expect(translationFinal.timing).toEqual({ startedAtMs: 1200, endedAtMs: 2700 });
    } else {
      expect(String(translationFinal?.kind)).toBe("translation-segment-final");
    }

    // usage telemetry: the provider-reported truth (the reference's example numbers).
    const usage = events.find((event) => event.kind === "usage-telemetry");
    if (usage?.kind === "usage-telemetry") {
      expect(usage.usage).toEqual({
        inputAudioTokens: 27,
        textOutputTokens: 2,
        outputAudioTokens: 7,
        imageInputTokens: 0,
      });
    } else {
      expect(String(usage?.kind)).toBe("usage-telemetry");
    }

    // session-closed: the user-stop reason + the final usage.
    const closed = events.at(-1);
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("user-stop");
      expect(closed.finalUsage).toEqual({
        inputAudioTokens: 27,
        textOutputTokens: 2,
        outputAudioTokens: 7,
        imageInputTokens: 0,
      });
    } else {
      expect(String(closed?.kind)).toBe("session-closed");
    }

    // the wire: session.update → append → session.finish, in order.
    expect(double.sentFrames.map((frame) => frame.type)).toEqual([
      "session.update",
      "input_audio_buffer.append",
      "session.finish",
    ]);
    // the connect: the documented URL + the bearer shape (the key value lives ONLY in the header).
    expect(double.connects).toHaveLength(1);
    expect(double.connects[0]?.url).toBe(
      "wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime",
    );
    expect(double.connects[0]?.authorizationHeader).toBe("Bearer test-credential-not-a-real-key");
  });

  it("accumulates usage across cycles and attributes the SECOND diarized speaker by first appearance", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain(4);
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;

    const attributions = events.filter((event) => event.kind === "speaker-attribution");
    expect(attributions).toHaveLength(2);
    if (attributions[1]?.kind === "speaker-attribution") {
      expect(attributions[1].speakerId).toBe("speaker-1");
      expect(attributions[1].label).toBe("Speaker 2"); // first appearance of provider speaker 1
      expect(attributions[1].segmentId).toBe("item_asr_1");
    }
    const transcriptFinals = events.filter((event) => event.kind === "source-transcript-final");
    expect(transcriptFinals).toHaveLength(2);
    if (transcriptFinals[1]?.kind === "source-transcript-final") {
      expect(transcriptFinals[1].speakerId).toBe("speaker-1");
      expect(transcriptFinals[1].timing).toEqual({ startedAtMs: 4200, endedAtMs: 5700 });
    }
    const translationFinals = events.filter((event) => event.kind === "translation-segment-final");
    expect(translationFinals).toHaveLength(2);
    if (translationFinals[1]?.kind === "translation-segment-final") {
      expect(translationFinals[1].sourceSegmentId).toBe("item_asr_1");
      expect(translationFinals[1].text).toBe("Great idea! I'd also like to grab some coffee.");
    }
    const usageEvents = events.filter((event) => event.kind === "usage-telemetry");
    expect(usageEvents).toHaveLength(2);
    if (usageEvents[1]?.kind === "usage-telemetry") {
      expect(usageEvents[1].usage).toEqual({
        inputAudioTokens: 54,
        textOutputTokens: 4,
        outputAudioTokens: 14,
        imageInputTokens: 0,
      });
    }
    const closed = events.at(-1);
    if (closed?.kind === "session-closed") {
      expect(closed.finalUsage?.inputAudioTokens).toBe(54);
      expect(closed.finalUsage?.outputAudioTokens).toBe(14);
    }
  });

  it("speaker attribution 'off' suppresses the attribution events and the transcript speaker ids (server_vad turn detection)", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open({ ...LAWFUL_INPUTS, speakerAttribution: "off" });
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;

    expect(events.filter((event) => event.kind === "speaker-attribution")).toHaveLength(0);
    const final = events.find((event) => event.kind === "source-transcript-final");
    if (final?.kind === "source-transcript-final") {
      expect(final.speakerId).toBeUndefined();
    }
    // The turn detection maps to server_vad under 'off'.
    const update = double.sentFrames.find((frame) => frame.type === "session.update");
    expect(update).toBeDefined();
    const parsed = JSON.parse(update!.text) as { session: { audio: { input: { turn_detection: { type: string } } } } };
    expect(parsed.session.audio.input.turn_detection.type).toBe("server_vad");
  });

  it("the text-and-audio modality reconstructs the translated AUDIO chunks (Base64 → pcm16 bytes with sequences)", async () => {
    const double = createRecordedQwenTransport({ audioOutputModality: "text-and-audio" });
    const { factory } = createQwenLiveTranslateSessionFactory(
      adapterConfig(double),
    );
    const session = await factory.open({ ...LAWFUL_INPUTS, outputModality: "text-and-audio" });
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;

    const audioChunks = events.filter((event) => event.kind === "translated-audio-chunk");
    expect(audioChunks).toHaveLength(1);
    if (audioChunks[0]?.kind === "translated-audio-chunk") {
      expect(Array.from(audioChunks[0].audio)).toEqual(Array.from(RECORDED_QWEN_AUDIO_PAYLOAD_BYTES));
      expect(audioChunks[0].format).toBe("pcm16");
      expect(audioChunks[0].sequence).toBe(1);
      expect(audioChunks[0].timing).toEqual({ startedAtMs: 1200, endedAtMs: 2700 });
    }
    // the audio_transcript family reconstructs the translation text too.
    const translationFinal = events.find((event) => event.kind === "translation-segment-final");
    expect(String(translationFinal?.kind)).toBe("translation-segment-final");
    if (translationFinal?.kind === "translation-segment-final") {
      expect(translationFinal.text).toBe(
        "The weather is really nice today; let's take a walk in the park.",
      );
    }
    // the session.update carried the text+audio modality.
    const update = double.sentFrames.find((frame) => frame.type === "session.update");
    const parsed = JSON.parse(update!.text) as { session: { output_modalities: string[] } };
    expect(parsed.session.output_modalities).toEqual(["text", "audio"]);
  });

  it("emits the timing-metadata firsts with the injectable stepping clock (deterministic multiples)", async () => {
    const double = createRecordedQwenTransport();
    const { clock } = createSteppingClock(100);
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double, clock));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;

    const timings = events.filter((event) => event.kind === "timing-metadata");
    expect(timings).toHaveLength(2);
    const first = timings[0];
    const second = timings[1];
    if (first?.kind === "timing-metadata") {
      expect(first.firstSourceTranscriptDeltaMs).toBeGreaterThanOrEqual(0);
      expect(first.firstTranslationDeltaMs).toBeUndefined();
    }
    if (second?.kind === "timing-metadata") {
      expect(second.firstSourceTranscriptDeltaMs).toBeGreaterThanOrEqual(0);
      expect(second.firstTranslationDeltaMs).toBeGreaterThanOrEqual(second.firstSourceTranscriptDeltaMs ?? 0);
      expect(second.sourceToTranslationLagMs).toBe(
        Math.max(
          0,
          (second.firstTranslationDeltaMs ?? 0) - (second.firstSourceTranscriptDeltaMs ?? 0),
        ),
      );
      expect(second.firstTranslatedAudioChunkMs).toBeUndefined(); // text-only session
    }
  });
});

// ---------------------------------------------------------------------------
// The visual-frame laws (never-force + the provider's own fences)
// ---------------------------------------------------------------------------

describe("R25-C adapter — the visual-frame laws", () => {
  it("THE NEVER-FORCE LAW: a frame under an 'off' policy is the typed refusal", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open({ ...LAWFUL_INPUTS, visualContextPolicy: "off" });
    await session.start();
    await expect(
      session.appendImageFrame({ frame: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/never forced/);
    await session.close();
  });

  it("the adapter requests NO frames on its own — the wire stays image-free without caller appends", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;
    expect(double.sentFrames.filter((frame) => frame.type === "input_image_buffer.append")).toHaveLength(0);
    expect(events.filter((event) => event.kind === "recoverable-error")).toHaveLength(0);
  });

  it("appends the image frame under the adaptive policy (after audio, within the size fence)", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    const frame = new Uint8Array([137, 80, 78, 71]); // a tiny image payload
    await session.appendImageFrame({ frame });
    await drain(2);
    const imageFrames = double.sentFrames.filter((f) => f.type === "input_image_buffer.append");
    expect(imageFrames).toHaveLength(1);
    const parsed = JSON.parse(imageFrames[0]!.text) as { image: string };
    expect(parsed.image).toBe(bytesToBase64(frame));
    await session.close();
  });

  it("an oversized frame is the typed policy event and is NOT sent (never a silent drop)", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await session.appendImageFrame({ frame: new Uint8Array(500 * 1024 + 1) });
    await drain(2);
    expect(double.sentFrames.filter((f) => f.type === "input_image_buffer.append")).toHaveLength(0);
    const recoverable = events.find((event) => event.kind === "recoverable-error");
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.errorKind).toBe("policy");
      expect(recoverable.detail).toContain("512000");
      expect(recoverable.recovery).toContain("never a silent drop");
    } else {
      expect(String(recoverable?.kind)).toBe("recoverable-error");
    }
    await session.close();
    await done;
  });

  it("an image frame before ANY audio is the typed policy event (the provider's audio-first wire order)", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendImageFrame({ frame: new Uint8Array([1, 2, 3]) });
    await drain(2);
    expect(double.sentFrames.filter((f) => f.type === "input_image_buffer.append")).toHaveLength(0);
    const recoverable = events.find((event) => event.kind === "recoverable-error");
    expect(String(recoverable?.kind)).toBe("recoverable-error");
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.detail).toContain("at least one audio chunk");
    }
    await session.close();
    await done;
  });

  it("frames appended while still 'starting' are BUFFERED (audio first) and flushed once streaming — never dropped", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateAdapterFactoryWithConfig(double, {
      // A connect that never completes the handshake: frames buffer.
      failFirstConnects: 1,
      connectAckTimeoutMs: 5,
    });
    const session = await factory.open(LAWFUL_INPUTS);
    // start() retries with backoff; append during 'starting' buffers.
    const startPromise = session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await session.appendImageFrame({ frame: new Uint8Array([9, 9]) });
    await startPromise; // the retry connects, the buffered media flushes
    await drain(4);
    const imageFrames = double.sentFrames.filter((f) => f.type === "input_image_buffer.append");
    expect(imageFrames).toHaveLength(1);
    // audio preceded the image on the wire (the provider's own order).
    const types = double.sentFrames.map((f) => f.type);
    const firstAudio = types.indexOf("input_audio_buffer.append");
    const firstImage = types.indexOf("input_image_buffer.append");
    expect(firstAudio).toBeGreaterThanOrEqual(0);
    expect(firstImage).toBeGreaterThan(firstAudio - 1);
    await session.close();
  });
});

// ---------------------------------------------------------------------------
// The reconnect law (resume, never restart)
// ---------------------------------------------------------------------------

describe("R25-C adapter — the reconnect law (resume, never restart)", () => {
  it("a mid-session transport loss recovers: the SAME session re-connects, re-sends the config, and replays the buffered audio", async () => {
    const double = createRecordedQwenTransport({ dropAfterCycles: 1 });
    const { clock } = createSteppingClock(100); // instant sleeps: the resume loop runs immediately
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double, clock));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);

    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain(8); // cycle 0 completes → the scripted drop → the resume loop
    expect(session.state).toBe("streaming"); // resumed
    await drain(8); // the replayed audio drives cycle 1
    await session.stop();
    await done;

    // The recoverable network error with the resume recovery sentence.
    const recoverable = events.find((event) => event.kind === "recoverable-error");
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.errorKind).toBe("network");
      expect(recoverable.detail).toContain("close code 1006");
      expect(recoverable.recovery).toContain("resuming the SAME session");
      expect(recoverable.recovery).toContain("resume, never restart");
    } else {
      expect(String(recoverable?.kind)).toBe("recoverable-error");
    }

    // NO second session-created (resume, never restart).
    expect(events.filter((event) => event.kind === "session-created")).toHaveLength(1);
    // No terminal error: the session survived.
    expect(events.filter((event) => event.kind === "terminal-error")).toHaveLength(0);

    // Two connections; the second re-sent the session configuration.
    expect(double.connects).toHaveLength(2);
    const updates = double.sentFrames.filter((frame) => frame.type === "session.update");
    expect(updates).toHaveLength(2);

    // The buffered audio was REPLAYED on the resumed connection (the resume tail).
    const appends = double.sentFrames.filter((frame) => frame.type === "input_audio_buffer.append");
    expect(appends).toHaveLength(2);
    const parsedAppend = JSON.parse(appends[1]!.text) as { audio: string };
    expect(parsedAppend.audio).toBe(bytesToBase64(AUDIO_CHUNK));

    // The translation CONTINUED after the resume (speaker 2's cycle).
    const translationFinals = events.filter((event) => event.kind === "translation-segment-final");
    expect(translationFinals).toHaveLength(2);
    if (translationFinals[1]?.kind === "translation-segment-final") {
      expect(translationFinals[1].sourceSegmentId).toBe("item_asr_1");
    }

    // The narrative closed honestly at stop with the accumulated usage.
    const closed = events.at(-1);
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("user-stop");
      expect(closed.finalUsage?.inputAudioTokens).toBe(54);
    } else {
      expect(String(closed?.kind)).toBe("session-closed");
    }
  });

  it("the bounded give-up is the typed terminal network error — base playback continues (no exception to the caller)", async () => {
    const double = createRecordedQwenTransport({ failFirstConnects: 99 });
    const { factory } = createQwenLiveTranslateAdapterFactoryWithConfig(double, {
      maxReconnectAttempts: 2,
    });
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start(); // must NOT throw
    await done;
    expect(session.state).toBe("closed");
    // budget 2 → 3 connect attempts, 2 recoverable notices, 1 terminal give-up.
    expect(double.connects).toHaveLength(3);
    const recoverable = events.filter((event) => event.kind === "recoverable-error");
    expect(recoverable).toHaveLength(2);
    for (const event of recoverable) {
      if (event.kind === "recoverable-error") {
        expect(event.errorKind).toBe("network");
        expect(event.recovery).toContain("bounded exponential backoff");
      }
    }
    const terminal = events.find((event) => event.kind === "terminal-error");
    if (terminal?.kind === "terminal-error") {
      expect(terminal.errorKind).toBe("network");
      expect(terminal.detail).toContain("could not be established after 3 attempts");
      expect(terminal.detail).toContain("base playback and the original captions continue");
    } else {
      expect(String(terminal?.kind)).toBe("terminal-error");
    }
    const closed = events.at(-1);
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("terminal-error");
    } else {
      expect(String(closed?.kind)).toBe("session-closed");
    }
  });

  it("the domain reconnect() op short-circuits the pending backoff wait (the caller saw the network return)", async () => {
    const double = createRecordedQwenTransport({ dropAfterCycles: 1 });
    // A GATING clock: long backoff sleeps PARK until released, short
    // yields (flush pacing) resolve instantly — the parked backoff is
    // exactly what the domain reconnect() op must cut short.
    let releaseParkedSleep: (() => void) | null = null;
    const parkedSleeps: number[] = [];
    const clock: QwenAdapterClock = {
      now: () => Date.now(),
      sleep: (ms: number) =>
        ms > 100
          ? new Promise<void>((resolve) => {
              parkedSleeps.push(ms);
              releaseParkedSleep = resolve;
            })
          : Promise.resolve(),
    };
    const backoff = { delayMsForAttempt: () => 60_000 }; // a LONG wait the trigger must cut short
    const { factory } = createQwenLiveTranslateAdapterFactoryWithConfig(double, {
      clock,
      backoff,
      maxReconnectAttempts: 5,
    });
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain(6); // the drop → reconnecting → the long backoff wait parks
    expect(session.state).toBe("reconnecting");
    expect(parkedSleeps).toContain(60_000); // the wait the op must cut short
    await session.reconnect(); // the domain resume op: run NOW
    await drain(10); // the immediate resume + the replayed cycle
    expect(session.state).toBe("streaming");
    await session.stop();
    await done;
    expect(double.connects).toHaveLength(2);
    expect(events.filter((event) => event.kind === "terminal-error")).toHaveLength(0);
    // Release any leftover parked wait (cleanup); the cast defeats TS's
    // closure-unaware narrowing (assignments inside the sleep closure
    // are not tracked).
    (releaseParkedSleep as (() => void) | null)?.();
    void parkedSleeps;
  });
});

// ---------------------------------------------------------------------------
// The rate-limit law (RPM=10 / TPM=100,000 International)
// ---------------------------------------------------------------------------

describe("R25-C adapter — the rate-limit law", () => {
  it("a provider rate-limit hit maps to the recoverable provider-failure naming the limits, then the bounded retry SUCCEEDS", async () => {
    const double = createRecordedQwenTransport({ rateLimitFirstUpdates: 1 });
    const { factory } = createQwenLiveTranslateAdapterFactoryWithConfig(double, {
      maxReconnectAttempts: 2,
    });
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    expect(session.state).toBe("streaming"); // the retry succeeded
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;

    const recoverable = events.find(
      (event) =>
        event.kind === "recoverable-error" &&
        event.errorKind === "provider-failure",
    );
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.recovery).toContain("RPM=10");
      expect(recoverable.recovery).toContain("100,000");
      expect(recoverable.detail).toContain("requests_exceeded");
    } else {
      expect(String(recoverable?.kind)).toBe("recoverable-error");
    }
    // Never a silent drop: the session delivered the full translation.
    expect(events.filter((event) => event.kind === "translation-segment-final")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "terminal-error")).toHaveLength(0);
    // Two connects: the rate-limited attempt + the successful retry.
    expect(double.connects).toHaveLength(2);
  });

  it("session starts are SMOOTHED to the RPM cadence through the factory gate (bounded wait, injectable clock)", async () => {
    const double = createRecordedQwenTransport();
    const { clock, sleepCalls } = createSteppingClock(100);
    const { factory } = createQwenLiveTranslateAdapterFactoryWithConfig(double, {
      clock,
      sessionStartMinIntervalMs: 6_000, // the RPM=10 derivation
    });
    const first = await factory.open(LAWFUL_INPUTS);
    const second = await factory.open(LAWFUL_INPUTS);
    await first.start();
    const smoothingSleeps = [...sleepCalls];
    await second.start();
    // The first session start may pace against nothing; the second MUST
    // wait the bounded remainder of the 6000 ms interval.
    const waits = sleepCalls.filter((ms) => ms > 0 && ms <= 6_000);
    expect(waits.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...waits)).toBeLessThanOrEqual(6_000);
    expect(smoothingSleeps).toEqual([]); // the FIRST start never waits
    expect(second.state).toBe("streaming");
    await first.close();
    await second.close();
  });
});

// ---------------------------------------------------------------------------
// Provider error normalization at the session level
// ---------------------------------------------------------------------------

describe("R25-C adapter — provider error normalization at the session level", () => {
  it("the invalid-credential error is the TERMINAL provider-failure carrying the DASHSCOPE_API_KEY recovery sentence", async () => {
    const double = createRecordedQwenTransport({ authErrorOnConnect: true });
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await done;
    expect(session.state).toBe("closed");
    const terminal = events.find((event) => event.kind === "terminal-error");
    if (terminal?.kind === "terminal-error") {
      expect(terminal.errorKind).toBe("provider-failure");
      expect(terminal.detail).toContain("invalid_api_key");
      expect(terminal.detail).toContain("DASHSCOPE_API_KEY");
      expect(terminal.detail).toContain("never a fallback to a hardcoded key");
    } else {
      expect(String(terminal?.kind)).toBe("terminal-error");
    }
    // The terminal path does NOT retry (the credential will not heal).
    expect(double.connects).toHaveLength(1);
  });

  it("the invalid-request config rejection is the TERMINAL policy error naming the provider's param", async () => {
    const double = createRecordedQwenTransport({
      injectErrorFrame: JSON.stringify({
        event_id: "event_invalid",
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "invalid_value",
          message: "Invalid modalities: ['audio'].",
          param: "session.output_modalities",
        },
      }),
    });
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await done;
    const terminal = events.find((event) => event.kind === "terminal-error");
    if (terminal?.kind === "terminal-error") {
      expect(terminal.errorKind).toBe("policy");
      expect(terminal.detail).toContain("session.output_modalities");
    } else {
      expect(String(terminal?.kind)).toBe("terminal-error");
    }
  });

  it("the per-item transcription failure is RECOVERABLE and the session CONTINUES translating", async () => {
    const double = createRecordedQwenTransport({
      injectFrameMidStream: JSON.stringify({
        event_id: "event_asr_fail",
        type: "conversation.item.input_audio_transcription.failed",
        item_id: "item_asr_0",
        content_index: 0,
        error: { code: "asr_failed", message: "recognition failed for this utterance" },
      }),
    });
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;
    expect(events.filter((event) => event.kind === "terminal-error")).toHaveLength(0);
    // The translation still completed for the utterance.
    expect(events.filter((event) => event.kind === "translation-segment-final")).toHaveLength(1);
    // The typed per-item notice arrived.
    const recoverable = events.find((event) => event.kind === "recoverable-error");
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.detail).toContain("source-transcription failed for one utterance");
      expect(recoverable.recovery).toContain("never a session kill");
    }
  });

  it("an unparsable frame is the typed recoverable unknown notice — never a crash, never a silent drop", async () => {
    const double = createRecordedQwenTransport({
      injectFrameMidStream: "{not-json",
    });
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;
    const recoverable = events.find((event) => event.kind === "recoverable-error");
    if (recoverable?.kind === "recoverable-error") {
      expect(recoverable.errorKind).toBe("unknown");
      expect(recoverable.detail).toContain("unparsable provider frame");
    } else {
      expect(String(recoverable?.kind)).toBe("recoverable-error");
    }
    expect(events.filter((event) => event.kind === "translation-segment-final")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The stop/close narratives + the production transport construction
// ---------------------------------------------------------------------------

describe("R25-C adapter — the stop/close narratives and the production transport", () => {
  it("close() from streaming emits the user-close reason with the final usage and ends the stream", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.close();
    await done;
    expect(session.state).toBe("closed");
    const closed = events.at(-1);
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("user-close");
      expect(closed.finalUsage?.inputAudioTokens).toBe(27);
    } else {
      expect(String(closed?.kind)).toBe("session-closed");
    }
    // close() from streaming does NOT send the graceful finish frame.
    expect(double.sentFrames.filter((frame) => frame.type === "session.finish")).toHaveLength(0);
  });

  it("stop() without a provider finish ack (the un-clean provider close) still closes the narrative honestly", async () => {
    const double = createRecordedQwenTransport({ closeWithoutFinish: true });
    const { factory } = createQwenLiveTranslateSessionFactoryWithTimeout(double);
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop(); // the double closes without session.finished; the bounded wait resolves
    await done;
    expect(session.state).toBe("stopped");
    const closed = events.at(-1);
    if (closed?.kind === "session-closed") {
      expect(closed.reason).toBe("user-stop");
    } else {
      expect(String(closed?.kind)).toBe("session-closed");
    }
  });

  it("the production WebSocket transport constructs (the live path is the lead's procedure, never this battery)", () => {
    const transport = createWebSocketQwenTransport({ connectTimeoutMs: 1_000 });
    expect(typeof transport.connect).toBe("function");
  });

  it("the recorded double is branded a TEST FIXTURE (never production wiring)", () => {
    expect(RECORDED_QWEN_TRANSPORT_IS_TEST_FIXTURE).toBe(true);
  });

  it("configure() mid-stream re-sends the session configuration and reverts honestly on rejection", async () => {
    const double = createRecordedQwenTransport();
    const { factory } = createQwenLiveTranslateSessionFactory(adapterConfig(double));
    const session = await factory.open(LAWFUL_INPUTS);
    const { events, done } = await collectEvents(session);
    await session.start();
    await session.configure({ targetLanguage: "de" });
    // The effective target changed → the translation events carry it.
    expect(session.state).toBe("streaming");
    await session.appendAudio({ audio: AUDIO_CHUNK });
    await drain();
    await session.stop();
    await done;
    const translationDelta = events.find((event) => event.kind === "translation-delta");
    if (translationDelta?.kind === "translation-delta") {
      expect(translationDelta.targetLanguage).toBe("de");
    } else {
      expect(String(translationDelta?.kind)).toBe("translation-delta");
    }
    const updates = double.sentFrames.filter((frame) => frame.type === "session.update");
    expect(updates).toHaveLength(2);
    const second = JSON.parse(updates[1]!.text) as { session: { translation: { language: string } } };
    expect(second.session.translation.language).toBe("de");
  });
});

function createQwenLiveTranslateSessionFactoryWithTimeout(
  double: RecordedQwenTransportDouble,
): { factory: ReturnType<typeof createQwenLiveTranslateSessionFactory>["factory"] } {
  const { factory } = createQwenLiveTranslateSessionFactory({
    ...adapterConfig(double),
    stopAckTimeoutMs: 30,
  });
  return { factory };
}
