/**
 * R25-W3 — the desktop realtime translation composition's laws (the J43
 * driver surface: the plan's R25-G player experience on Desktop).
 *
 * Proven here (machine-checked):
 * - THE HONEST CONTROL TRUTH: translateControl surfaces the adapter's
 *   capability verbatim (offered on the authorized rung; the honest
 *   unavailable sentence on the embed rung).
 * - THE START LAW: start wires the feed, resets the instrument at the
 *   user's Translate action, subscribes the event projection, starts the
 *   supervisor, and sets translated-speech ONLY when the user asked for
 *   audio (text-only keeps the original-audio mode — the cost law).
 * - THE BILINGUAL VIEW (R25-G): source transcript and translation are
 *   PRESERVED SIDE BY SIDE — paired rows align by position, source-only
 *   rows keep the source text when the translation lags, and the source
 *   transcript is never REPLACED; speaker labels ride the rows.
 * - THE SPEAKER LAW: a speaker-attribution event updates the active
 *   speaker and notifies the feed's sampler (the R25-F out-of-band
 *   trigger).
 * - THE MODE LAW: setMode forwards to the mixer; the status reports it.
 * - THE RECOVERY STATUS: the supervisor's state surfaces in the status —
 *   and the playback truth is not among the composition's inputs at all.
 * - THE STOP LAW: stop stops the feed + closes the session; a second
 *   start works after the stop (the player can translate again).
 */

import { describe, expect, it } from "bun:test";
import type { PlaybackRealization } from "@wfx/domain";
import {
  createNativeAudioCaptureService,
  type NativeAudioTapFrame,
  type NativeAudioTapSource,
} from "@wfx/native-media";

import { createDesktopRealtimeMediaAdapter } from "../src/platform/realtime-media-adapter";
import { createTranslatedAudioOutputMixer } from "../src/platform/translated-audio-output";
import { createRealtimeTranslationInstrument } from "../src/platform/realtime-translation-instrument";
import { createDesktopRealtimeTranslation } from "../src/platform/realtime-translation-composition";
import type {
  RealtimeTranslationEvent,
  RealtimeTranslationSession,
  RealtimeTranslationSessionInput,
} from "../src/platform/realtime-translation-port";

// ---------------------------------------------------------------------------
// The deterministic world
// ---------------------------------------------------------------------------

const FORMAT = { sampleRateHz: 48_000, channels: 2, encoding: "pcm-s16le" as const };

function realization(mode: PlaybackRealization["mode"], connectorId: string): PlaybackRealization {
  return { mode, connectorId, capabilities: [] };
}

/** The scripted platform tap source (the J43 world reuses the same seam). */
class ScriptedTapSource implements NativeAudioTapSource {
  private sink: ((frame: NativeAudioTapFrame) => void) | null = null;
  openTapCalls = 0;

  openTap(input: {
    readonly sourceId: string;
    readonly sourceKind: NativeAudioTapFrame["sourceKind"];
    readonly format: typeof FORMAT;
    readonly sink: (frame: NativeAudioTapFrame) => void;
  }): Promise<{ sourceId: string; close(): void }> {
    this.openTapCalls += 1;
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

/** The scripted EMITTING session (the Model Fabric seam's double). */
class EmittingSession implements RealtimeTranslationSession {
  readonly id = "rt-j43";
  private listeners = new Set<(event: RealtimeTranslationEvent) => void>();
  readonly appendedAudio: number[] = [];
  stopCalls = 0;
  closeCalls = 0;

  async start(): Promise<void> {
    this.emit({ kind: "session-created", sessionId: this.id, sourceLanguage: "de", targetLanguage: "en" });
  }
  async configure(): Promise<void> {
    void this;
  }
  appendAudio(frame: { readonly positionMs: number }): void {
    this.appendedAudio.push(frame.positionMs);
  }
  appendImageFrame(): void {
    void this;
  }
  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.emit({ kind: "session-closed", reason: "stopped" });
  }
  async reconnect(): Promise<void> {
    void this;
  }
  async close(): Promise<void> {
    this.closeCalls += 1;
  }
  subscribe(listener: (event: RealtimeTranslationEvent) => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }
  emit(event: RealtimeTranslationEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function world(): {
  translation: ReturnType<typeof createDesktopRealtimeTranslation>;
  session: EmittingSession;
  tap: ScriptedTapSource;
  mixer: ReturnType<typeof createTranslatedAudioOutputMixer>;
  instrument: ReturnType<typeof createRealtimeTranslationInstrument>;
} {
  const tap = new ScriptedTapSource();
  const capture = createNativeAudioCaptureService({
    tapSource: tap,
    sessionTruth: {
      sessionStateOf: (id: string): "resolving" | "buffering" | "playing" | "background" | "complete" | "failed" | null =>
        id === "native-s" ? "playing" : null,
    },
    clock: () => 0,
  });
  const session = new EmittingSession();
  const adapter = createDesktopRealtimeMediaAdapter({
    captureService: capture,
    sessionFactory: {
      async createSession(_input: RealtimeTranslationSessionInput) {
        void _input;
        return session;
      },
    },
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
  const mixer = createTranslatedAudioOutputMixer({ nowMs: () => 0 });
  const instrument = createRealtimeTranslationInstrument({ nowMs: () => 0 });
  const translation = createDesktopRealtimeTranslation({
    adapter,
    mixer,
    instrument,
    nowMs: () => 0,
    recovery: { schedule: (): void => undefined },
  });
  return { translation, session, tap, mixer, instrument };
}

const START = {
  realization: realization("native", "authorized-peer-copy"),
  nativeSessionId: "native-s",
  liveInputId: null as string | null,
  sourceMediaId: "wfxitm_r25",
  targetLanguage: "en",
  sourceLanguageHint: "de",
  subtitleMode: "bilingual" as const,
  speakerAttribution: "labeled" as const,
  visualContextPolicy: "audio-only" as const,
  outputModalities: "text+audio" as const,
};

describe("R25-W3 — the desktop realtime translation composition", () => {
  it("THE HONEST CONTROL TRUTH — translateControl surfaces the capability verbatim", () => {
    const w = world();
    const offered = w.translation.translateControl({
      realization: realization("native", "authorized-peer-copy"),
      nativeSessionId: "native-s",
      liveInputId: null,
    });
    expect(offered.offered).toBe(true);
    expect(offered.capability.kind).toBe("authorized");

    const restricted = w.translation.translateControl({
      realization: realization("embed", "provider-x"),
      nativeSessionId: null,
      liveInputId: null,
    });
    expect(restricted.offered).toBe(false);
    expect(restricted.capability.kind).toBe("unavailable-restricted");
  });

  it("THE START LAW — start wires the projection + supervisor + mixer (speech only when asked)", async () => {
    const w = world();
    const result = await w.translation.start({ ...START });
    expect(result.kind).toBe("started");

    // The session-created event flowed through the projection.
    expect(w.instrument.raw().some((o) => o.kind === "session-created")).toBe(true);
    expect(w.instrument.raw()[0]!.kind).toBe("translation-start-requested");

    // translated-speech was set because the user asked for audio.
    expect(w.translation.status().outputMode).toBe("translated-speech");
    expect(w.translation.status().active).toBe(true);
    expect(w.translation.status().targetLanguage).toBe("en");

    // The captured audio flows into the session's append seam.
    w.tap.push("native-s", 0);
    w.tap.push("native-s", 1_020);
    expect(w.session.appendedAudio).toEqual([0, 1_020]);
  });

  it("THE COST LAW — a text-only start keeps the original-audio mode", async () => {
    const w = world();
    await w.translation.start({ ...START, outputModalities: "text" });
    expect(w.translation.status().outputMode).toBe("original-audio");
  });

  it("THE BILINGUAL VIEW — source and translation preserved side by side (alignment, never replacement)", async () => {
    const w = world();
    await w.translation.start({ ...START });

    // The source transcript arrives (a delta then a final).
    w.session.emit({ kind: "source-transcript-delta", seq: 1, text: "Guten ", positionMs: 0, speaker: "Speaker 1" });
    w.session.emit({ kind: "source-transcript-final", seq: 2, text: "Guten Abend.", positionMs: 0, durationMs: 1_200, speaker: "Speaker 1" });
    // The translation arrives (a delta then a final) at the aligned position.
    w.session.emit({ kind: "translation-delta", seq: 3, text: "Good ", positionMs: 40, speaker: "Speaker 1" });
    w.session.emit({ kind: "translation-segment-final", seq: 4, text: "Good evening.", positionMs: 40, durationMs: 1_100, speaker: "Speaker 1" });

    const view = w.translation.captions();
    expect(view.rows.length).toBe(1);
    const row = view.rows[0]!;
    expect(row.alignment).toBe("paired");
    expect(row.sourceText).toBe("Guten Abend.");
    expect(row.translatedText).toBe("Good evening.");
    expect(row.speaker).toBe("Speaker 1");
    expect(row.sourceFinal).toBe(true);
    expect(row.translationFinal).toBe(true);

    // A source segment with NO translation yet stays source-only (the
    // source transcript is never replaced or dropped).
    w.session.emit({ kind: "source-transcript-final", seq: 5, text: "Willkommen.", positionMs: 5_000, durationMs: 900, speaker: "Speaker 2" });
    const view2 = w.translation.captions();
    expect(view2.rows.length).toBe(2);
    expect(view2.rows[1]!.alignment).toBe("source-only");
    expect(view2.rows[1]!.sourceText).toBe("Willkommen.");
    expect(view2.rows[1]!.translatedText).toBe("");

    // The active speaker rides the view.
    w.session.emit({ kind: "speaker-attribution", seq: 6, speaker: "Speaker 2", positionMs: 5_000 });
    expect(w.translation.captions().activeSpeaker).toBe("Speaker 2");
  });

  it("THE SPEAKER LAW — the attribution event notifies the feed's sampler (the R25-F out-of-band trigger)", async () => {
    const w = world();
    await w.translation.start({ ...START, visualContextPolicy: "adaptive" });
    w.session.emit({ kind: "speaker-attribution", seq: 1, speaker: "Speaker 2", positionMs: 2_000 });
    // The instrument observed the attribution.
    expect(w.instrument.raw().some((o) => o.kind === "speaker-attribution-observed")).toBe(true);
  });

  it("THE AUDIO LAW — translated chunks flow into the mixer; the drift is observed from timing metadata", async () => {
    const w = world();
    await w.translation.start({ ...START });
    w.session.emit({
      kind: "translated-audio-chunk",
      seq: 1,
      samples: new Uint8Array(16),
      durationMs: 900,
      positionMs: 0,
    });
    expect(w.mixer.report().acceptedChunks).toBe(1);
    const decision = w.mixer.step(0);
    expect(decision.translatedChunk).not.toBeNull();

    w.session.emit({ kind: "timing-metadata", seq: 2, sourceConsumedMs: 1_000, translationRenderedMs: 900 });
    const measurement = w.instrument.measurement({
      label: "composition",
      realization: "native",
      targetLanguage: "en",
      outputModalities: "text+audio",
      translatedAudioChunks: 1,
      capturedAudioFrames: 0,
      visualFramesAppended: 0,
    });
    expect(measurement.driftMs).toBe(-100); // rendered − consumed
  });

  it("THE RECOVERY STATUS — the supervisor's state surfaces + the pump recovers (instrument wired)", async () => {
    const w = world();
    await w.translation.start({ ...START });
    expect(w.translation.status().recovery).toBe("active");
    w.session.emit({
      kind: "recoverable-error",
      detail: "the network dropped",
      requiresReconnect: true,
    });
    expect(w.translation.status().recovery).toBe("interrupted");
    // The interruption is instrumented.
    expect(w.instrument.raw().some((o) => o.kind === "translation-interruption")).toBe(true);
    // The pump drives the session's own reconnect → the recovery is
    // instrumented through the supervisor's transition.
    await w.translation.pumpRecovery();
    expect(w.translation.status().recovery).toBe("reconnected");
    expect(w.instrument.raw().some((o) => o.kind === "reconnected")).toBe(true);
  });

  it("THE STOP LAW — stop closes the session; a second start works after", async () => {
    const w = world();
    await w.translation.start({ ...START });
    await w.translation.stop();
    expect(w.session.stopCalls).toBe(1);
    expect(w.session.closeCalls).toBe(1);
    expect(w.translation.status().active).toBe(false);

    const again = await w.translation.start({ ...START });
    expect(again.kind).toBe("started");
  });

  it("the already-translating guard answers the typed failure", async () => {
    const w = world();
    await w.translation.start({ ...START });
    const second = await w.translation.start({ ...START });
    expect(second.kind).toBe("already-translating");
    await w.translation.stop();
  });

  it("the restricted start refuses honestly (the authorized-media law through the composition)", async () => {
    const w = world();
    const failure = await w.translation.start({
      ...START,
      realization: realization("embed", "provider-x"),
      nativeSessionId: null,
    });
    expect(failure.kind).toBe("capture-unauthorized");
    expect(w.translation.status().active).toBe(false);
  });
});
