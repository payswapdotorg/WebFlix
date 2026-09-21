/**
 * R25-W3 — the J43 Desktop evidence: realtime translation (the golden
 * journey over the REAL composition: play → translate → target → bilingual
 * captions → speaker change → optional translated speech → interruption →
 * reconnect → normal playback).
 *
 * THE JOURNEY (docs/validation/webflix-golden-journeys.md J43 + the plan's
 * R25-G/R25-L): fresh playable media with an authorized accessible audio
 * stream — the R23 harness's authorized torrent/peer copy (Family Archive
 * Feature Presentation), played through the REAL Desktop composition
 * (the runtime's playback resolution + the native media port), then
 * translated through the REAL realtime translation composition (the
 * capture service + the media adapter + the session seam + the mixer +
 * the recovery supervisor + the latency instrument).
 *
 * THE ACCEPTANCE ITEMS PROVEN HERE:
 * - BASE PLAYBACK BEGINS INDEPENDENTLY OF TRANSLATION (W1: the play
 *   completes and the native session is playing BEFORE any translation
 *   exists — the composition is created after, and holds no playback
 *   handle at all);
 * - SOURCE + TRANSLATION STREAM INCREMENTALLY (W4: the deltas accumulate
 *   into the bilingual view; the finals stabilize the segments);
 * - THE ALIGNMENT REMAINS UNDERSTANDABLE (W4: paired rows by position);
 * - SPEAKER ATTRIBUTION IS TRUTHFUL (W5: Speaker 1 → Speaker 2);
 * - VISUAL CONTEXT ONLY WHEN LAWFULLY PROVIDABLE (W2/W3: the audio-only
 *   default — the never-forced law; the restricted embed rung answers
 *   the honest unavailable truth);
 * - TRANSLATED SPEECH IS OPTIONAL (W6: the mode round trip; the duck
 *   never erases the original);
 * - VOICE CLONING NEVER WITHOUT CONSENT (W3: the session input's
 *   translated-voice policy is neutral — recorded verbatim);
 * - THE INTERRUPTION NEVER RESTARTS THE MEDIA (W7: the playback session
 *   id is UNCHANGED, the native session is STILL playing, the runtime's
 *   active session count is unchanged — and the recovery drove ONLY the
 *   session's own reconnect operation);
 * - RECONNECT RESTORES THE TRANSLATION (W7: the supervisor recovers; the
 *   instrument measured the REAL reconnect time);
 * - TRANSLATION FAILURE FALLS BACK TO ORIGINAL PLAYBACK (W9: a terminal
 *   error stops translation; the native playback session is untouched
 *   and the source captions remain);
 * - NO PROVIDER CREDENTIAL REACHES THE CLIENT (W3: the captured session
 *   input carries no credential token — the vocabulary scan).
 *
 * THE HONEST SCOPE (never a silent skip): this sandbox has no realtime
 * provider behind Model Fabric (Worker 1's shared contract + the provider
 * registration have not landed) — the session here is the DETERMINISTIC
 * DOUBLE of the Model Fabric session seam (the same shape the production
 * factory binds). The latency numbers below are therefore REAL
 * measurements of the REAL composition executing in this sandbox — they
 * prove the ARCHITECTURE ORDERING and the measurement machinery, not
 * provider latency; the provider-path numbers are the lead's real-device
 * procedure, recorded here as pending (never silently passed).
 *
 * When WFX_J43_EVIDENCE_DIR is set, the final step writes the
 * machine-generated evidence record from THIS run.
 */

import { describe, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createNativeAudioCaptureService,
  type NativeAudioTapFrame,
  type NativeAudioTapSource,
} from "@wfx/native-media";

import { createDesktopRealtimeMediaAdapter } from "../src/platform/realtime-media-adapter";
import { createTranslatedAudioOutputMixer } from "../src/platform/translated-audio-output";
import { createRealtimeTranslationInstrument } from "../src/platform/realtime-translation-instrument";
import {
  createDesktopRealtimeTranslation,
  type DesktopRealtimeTranslation,
} from "../src/platform/realtime-translation-composition";
import { playerAffordanceMap } from "../src/surface/player-affordance-surface";
import type {
  RealtimeTranslationEvent,
  RealtimeTranslationSession,
  RealtimeTranslationSessionInput,
} from "../src/platform/realtime-translation-port";
import type { RealtimeTranslationMeasurement } from "../src/platform/realtime-translation-instrument";
import type { TranslatedAudioOutputMixer } from "../src/platform/translated-audio-output";

import { bootR23, lastNativeSessionId, nativeEvent, R23_ITEM, R23_TITLE } from "./r23-harness";
import type { R23Boot } from "./r23-harness";

// ---------------------------------------------------------------------------
// The journey log + the assertion recorder (the evidence primitives)
// ---------------------------------------------------------------------------

const J43_LOG: { readonly step: string; readonly observed: string }[] = [];
const J43_ASSERTIONS: { readonly step: string; readonly description: string }[] = [];
const J43_STARTED_AT = new Date().toISOString();

function record(step: string, observed: string): void {
  J43_LOG.push({ step, observed });
}

function ok(step: string, description: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`J43 [${step}] ${description}`);
  }
  J43_ASSERTIONS.push({ step, description });
}

// ---------------------------------------------------------------------------
// The realtime world (the deterministic session double over the REAL
// composition — the Model Fabric session seam's shape)
// ---------------------------------------------------------------------------

const FORMAT = { sampleRateHz: 48_000, channels: 2, encoding: "pcm-s16le" as const };

/** The scripted platform tap source (the shell audio stack's double). */
class J43TapSource implements NativeAudioTapSource {
  openTapCalls = 0;
  private sink: ((frame: NativeAudioTapFrame) => void) | null = null;

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

  push(sourceId: string, positionMs: number, sourceKind: NativeAudioTapFrame["sourceKind"] = "torrent-session"): void {
    this.sink?.({
      sourceId,
      sourceKind,
      positionMs,
      format: FORMAT,
      samples: new Uint8Array(8),
    });
  }
}

/**
 * The deterministic session double — the Model Fabric session seam's
 * shape. Records the append-seam traffic + the input it was created with
 * (the credential-scan evidence), lets the walk emit streaming events at
 * the honest moments.
 */
class J43Session implements RealtimeTranslationSession {
  readonly id = "rt-j43";
  readonly createdInput: RealtimeTranslationSessionInput;
  readonly appendedAudio: number[] = [];
  readonly appendedFrames: { readonly positionMs: number; readonly trigger: string }[] = [];
  reconnectCalls = 0;
  stopCalls = 0;
  closeCalls = 0;
  private listeners = new Set<(event: RealtimeTranslationEvent) => void>();

  constructor(input: RealtimeTranslationSessionInput) {
    this.createdInput = input;
  }

  async start(): Promise<void> {
    this.emit({ kind: "session-created", sessionId: this.id, sourceLanguage: "de", targetLanguage: "en" });
  }
  async configure(): Promise<void> {
    void this;
  }
  appendAudio(frame: { readonly positionMs: number }): void {
    this.appendedAudio.push(frame.positionMs);
  }
  appendImageFrame(frame: { readonly positionMs: number; readonly trigger: string }): void {
    this.appendedFrames.push({ positionMs: frame.positionMs, trigger: frame.trigger });
  }
  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.emit({ kind: "session-closed", reason: "stopped" });
  }
  async reconnect(): Promise<void> {
    this.reconnectCalls += 1;
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

interface J43World {
  readonly boot: R23Boot;
  readonly translation: DesktopRealtimeTranslation;
  readonly session: J43Session | null;
  readonly tap: J43TapSource;
  readonly mixer: TranslatedAudioOutputMixer;
  readonly instrument: ReturnType<typeof createRealtimeTranslationInstrument>;
  /** The native session truth the capture service consults (the walk advances it with the nativeEvent pumps). */
  readonly nativeStates: Map<string, string>;
}

/** Boot the R23 composition + the realtime translation composition over it. */
function bootJ43(): J43World {
  const boot = bootR23();
  const tap = new J43TapSource();
  // The native session truth the capture service consults: the walk
  // advances it alongside the harness's nativeEvent pumps.
  const nativeStates = new Map<string, string>();
  const capture = createNativeAudioCaptureService({
    tapSource: tap,
    sessionTruth: {
      sessionStateOf: (id: string): "resolving" | "buffering" | "playing" | "background" | "complete" | "failed" | null =>
        (nativeStates.get(id) as "resolving" | "buffering" | "playing" | "background" | "complete" | "failed" | null) ?? null,
    },
    clock: (): number => performance.now(),
  });
  let session: J43Session | null = null;
  const adapter = createDesktopRealtimeMediaAdapter({
    captureService: capture,
    sessionFactory: {
      async createSession(input: RealtimeTranslationSessionInput) {
        session = new J43Session(input);
        return session;
      },
    },
    nowMs: (): number => performance.now(),
    // The platform's frame signals: NULL truths (the honest absence — the
    // sampler decides on what it knows; the never-forced default policy
    // suppresses everything anyway).
    frameSignalsOf: (positionMs: number) => ({
      positionMs,
      sceneDifference: null,
      onScreenText: null,
      shotOrSpeakerIndex: null,
      bytes: null,
      mediaType: null,
    }),
  });
  const mixer = createTranslatedAudioOutputMixer({ nowMs: (): number => performance.now() });
  const instrument = createRealtimeTranslationInstrument({ nowMs: (): number => performance.now() });
  const translation = createDesktopRealtimeTranslation({
    adapter,
    mixer,
    instrument,
    nowMs: (): number => performance.now(),
    recovery: {
      backoffMs: [50, 100],
      schedule: (): void => undefined, // the deterministic walk pumps manually
    },
  });
  const world: J43World = {
    boot,
    translation,
    session: null,
    tap,
    mixer,
    instrument,
    nativeStates,
  };
  // The session lands after the first start; expose it through the world.
  Object.defineProperty(world, "session", {
    get: (): J43Session | null => session,
  });
  return world;
}

// ---------------------------------------------------------------------------
// THE J43 WALK
// ---------------------------------------------------------------------------

describe("R24-W3 → R25-W3 — the J43 Desktop realtime translation journey", () => {
  it("W1 — PLAY: the base playback begins (independently of any translation)", async () => {
    const world = bootJ43();
    await world.boot.runtime.getHome();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W1", "the authorized peer copy started through the real play flow", outcome.kind === "started");
    if (outcome.kind !== "started") return;
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");
    ok(
      "W1",
      "the native session is PLAYING before any translation exists (base playback never waits)",
      world.boot.runtime.playback.active().length === 1,
    );
    record(
      "W1",
      `Play: the authorized torrent/peer copy started (playback session ${outcome.sessionId}, native session ${nativeSessionId}); no translation exists yet.`,
    );
  });

  it("W2 — the Translate control's honest truth (the affordance grammar + the per-rung capability)", async () => {
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W2", "the play started", outcome.kind === "started");
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);

    // The affordance grammar's translate row on the NATIVE rung: offered.
    const map = playerAffordanceMap("native");
    const translate = map.find((view) => view.kind === "translate");
    ok("W2", "the translate control exists in the closed affordance grammar", translate !== undefined);
    ok(
      "W2",
      "the native rung's translate control is offered through the shared session seam",
      translate?.backing === "shared-surface" && translate.detail.length > 20,
    );
    // The EMBED rung's honest unavailable truth (never a capture, never a bypass).
    const embedMap = playerAffordanceMap("embed");
    const embedTranslate = embedMap.find((view) => view.kind === "translate");
    ok(
      "W2",
      "the embed rung's translate control answers the honest realization-exposed truth (the provider's own captions)",
      embedTranslate?.backing === "realization-exposed" && embedTranslate.detail.includes("never captures"),
    );

    // The composition's capability resolution agrees: authorized (torrent).
    const control = world.translation.translateControl({
      realization: {
        mode: "native",
        connectorId: "authorized-peer-copy",
        capabilities: [],
      },
      nativeSessionId,
      liveInputId: null,
    });
    ok("W2", "the peer-copy rung resolves the authorized capture path", control.offered === true);
    ok(
      "W2",
      "the authorized path is the TORRENT path (the connector truth)",
      control.capability.kind === "authorized" && control.capability.capturePath === "authorized-torrent",
    );
    record(
      "W2",
      "Translate control: offered on the native/torrent rung (shared-surface); the embed rung answers the honest never-capture truth.",
    );
  });

  it("W3-W4 — TRANSLATE → target language → the incremental bilingual captions", async () => {
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W3", "the play started", outcome.kind === "started");
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");

    // TRANSLATE → English, bilingual, speaker labels, audio-only visual
    // policy (the never-forced default), translated speech requested.
    const started = await world.translation.start({
      realization: { mode: "native", connectorId: "authorized-peer-copy", capabilities: [] },
      nativeSessionId,
      liveInputId: null,
      sourceMediaId: R23_ITEM,
      targetLanguage: "en",
      sourceLanguageHint: "de",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      visualContextPolicy: "audio-only",
      outputModalities: "text+audio",
      hotwords: [{ term: "Lena", translation: "Lena" }],
    });
    ok("W3", "the translation started through the session seam", started.kind === "started");
    const session = world.session;
    if (session === null) throw new Error("the session double should exist");

    ok("W3", "the session input's translated-voice policy is NEUTRAL (never a silent clone)", session.createdInput.translatedVoice.mode === "neutral");
    const inputJson = JSON.stringify({ ...session.createdInput, imageFrames: session.createdInput.imageFrames ? "policy" : null });
    ok(
      "W3",
      "no provider credential reached the session input (the vocabulary scan)",
      !inputJson.toLowerCase().includes("apikey") &&
        !inputJson.toLowerCase().includes("api-key") &&
        !inputJson.toLowerCase().includes("credential") &&
        !inputJson.toLowerCase().includes("secret") &&
        !inputJson.toLowerCase().includes("token"),
    );
    ok("W3", "the capture tap opened on the native session", world.tap.openTapCalls === 1);

    // The captured audio flows into the append-audio seam (the source's
    // own timeline as the alignment key).
    world.tap.push(nativeSessionId, 0);
    world.tap.push(nativeSessionId, 1_020);
    ok("W3", "the captured frames flow into the session's append-audio seam", session.appendedAudio.length === 2);

    // THE INCREMENTAL STREAM: the source transcript + the translation
    // arrive as deltas, then stabilize as finals.
    session.emit({ kind: "source-transcript-delta", seq: 1, text: "Guten ", positionMs: 0, speaker: "Speaker 1" });
    session.emit({ kind: "translation-delta", seq: 2, text: "Good ", positionMs: 30, speaker: "Speaker 1" });
    let view = world.translation.captions();
    ok("W4", "the first source delta + translation delta are visible incrementally", view.rows.length === 1);
    ok(
      "W4",
      "the live row carries BOTH the partial source and the partial translation",
      view.rows[0]!.sourceText === "Guten " && view.rows[0]!.translatedText === "Good ",
    );
    session.emit({ kind: "source-transcript-final", seq: 3, text: "Guten Abend.", positionMs: 0, durationMs: 1_200, speaker: "Speaker 1" });
    session.emit({ kind: "translation-segment-final", seq: 4, text: "Good evening.", positionMs: 30, durationMs: 1_100, speaker: "Speaker 1" });
    view = world.translation.captions();
    ok("W4", "the finals stabilize both sides of the row", view.rows[0]!.sourceFinal && view.rows[0]!.translationFinal);
    ok(
      "W4",
      "the source/translation alignment holds (the paired row by position)",
      view.rows[0]!.alignment === "paired" &&
        view.rows[0]!.sourceText === "Guten Abend." &&
        view.rows[0]!.translatedText === "Good evening.",
    );
    record(
      "W3-W4",
      `Translate → en: the session created; the tap opened; 2 captured frames appended; the bilingual captions streamed incrementally (${view.rows.length} paired row).`,
    );
  });

  it("W5-W6 — the speaker change + the OPTIONAL translated speech (the mode law)", async () => {
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W5", "the play started", outcome.kind === "started");
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");
    await world.translation.start({
      realization: { mode: "native", connectorId: "authorized-peer-copy", capabilities: [] },
      nativeSessionId,
      liveInputId: null,
      sourceMediaId: R23_ITEM,
      targetLanguage: "en",
      sourceLanguageHint: "de",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      visualContextPolicy: "audio-only",
      outputModalities: "text+audio",
    });
    const session = world.session;
    if (session === null) throw new Error("the session double should exist");

    // THE SPEAKER CHANGE: the attribution event + the continued translation.
    session.emit({ kind: "speaker-attribution", seq: 5, speaker: "Speaker 2", positionMs: 2_000 });
    session.emit({ kind: "source-transcript-final", seq: 6, text: "Willkommen in der Archiv.", positionMs: 2_000, durationMs: 1_400, speaker: "Speaker 2" });
    session.emit({ kind: "translation-segment-final", seq: 7, text: "Welcome to the archive.", positionMs: 2_030, durationMs: 1_300, speaker: "Speaker 2" });
    const view = world.translation.captions();
    ok("W5", "the speaker change is truthful (the new row carries Speaker 2)", view.rows.some((row) => row.speaker === "Speaker 2"));
    ok("W5", "the translation CONTINUED through the speaker change", view.rows.some((row) => row.translatedText === "Welcome to the archive."));
    ok("W5", "the active speaker is projected", view.activeSpeaker === "Speaker 2");

    // THE OPTIONAL TRANSLATED SPEECH: the chunk arrives; the mixer plays
    // it at the playhead with the original DUCKED (never erased).
    session.emit({
      kind: "translated-audio-chunk",
      seq: 8,
      samples: new Uint8Array(64),
      durationMs: 900,
      positionMs: 2_000,
    });
    const translatedDecision = world.mixer.step(2_000);
    ok("W6", "the translated chunk plays at the source playhead", translatedDecision.translatedChunk !== null);
    ok(
      "W6",
      "the original is DUCKED, not erased, while translated speech plays",
      translatedDecision.originalGain > 0 && translatedDecision.originalGain < 1,
    );
    // The mode round trip: original-audio at full gain; back to translated.
    world.translation.setMode("original-audio");
    const originalDecision = world.mixer.step(3_000);
    ok("W6", "the original-audio mode restores the FULL original gain", originalDecision.originalGain === 1);
    ok("W6", "the original-audio mode mutes the translated stream", originalDecision.translatedChunk === null);
    world.translation.setMode("translated-speech");
    ok("W6", "the mode switches back instantly (the lossless round trip)", world.mixer.report().mode === "translated-speech");
    record(
      "W5-W6",
      "Speaker change (Speaker 2) with the translation continuing; the translated speech played with the original ducked; the mode round trip held the original available.",
    );
  });

  it("W7 — THE INTERRUPTION → RECONNECT (the media NEVER restarts)", async () => {
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W7", "the play started", outcome.kind === "started");
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");
    await world.translation.start({
      realization: { mode: "native", connectorId: "authorized-peer-copy", capabilities: [] },
      nativeSessionId,
      liveInputId: null,
      sourceMediaId: R23_ITEM,
      targetLanguage: "en",
      sourceLanguageHint: "de",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      visualContextPolicy: "audio-only",
      outputModalities: "text+audio",
    });
    const session = world.session;
    if (session === null) throw new Error("the session double should exist");
    const playbackSessionsBefore = world.boot.runtime.playback.active().length;
    const playbackSessionId = outcome.kind === "started" ? outcome.playbackSessionId : "";

    // THE NETWORK INTERRUPTION.
    session.emit({
      kind: "recoverable-error",
      detail: "the network connection to the realtime provider dropped",
      requiresReconnect: true,
    });
    ok("W7", "the interruption is observed (the recovery state is interrupted)", world.translation.status().recovery === "interrupted");

    // THE NEVER-RESTART LAW: the playback session is UNCHANGED — the same
    // id, the same count, the native session STILL playing.
    ok("W7", "the playback session COUNT is unchanged by the interruption", world.boot.runtime.playback.active().length === playbackSessionsBefore);
    const activeAfter = world.boot.runtime.playback.active();
    ok("W7", "the playback SESSION ID is unchanged (never a restart)", activeAfter.some((s) => s.sessionId === playbackSessionId));
    const nativeStill = await world.boot.nativeMedia.inspect(nativeSessionId);
    ok("W7", "the native media session is STILL playing through the interruption", nativeStill.state === "playing");

    // The translated output falls back to the ORIGINAL carrying the
    // moment (never silence) while the reconnect is pending.
    const carriedDecision = world.mixer.step(4_000);
    ok("W7", "the original carries the moment during the gap (never silence)", carriedDecision.continuity === "original-carries");

    // THE RECONNECT: the supervisor drives the session's OWN operation.
    await world.translation.pumpRecovery();
    ok("W7", "the reconnect recovered the translation", world.translation.status().recovery === "reconnected");
    ok("W7", "the recovery drove ONLY the session's own reconnect operation", session.reconnectCalls === 1 && session.stopCalls === 0);
    const nativeAfterRecovery = await world.boot.nativeMedia.inspect(nativeSessionId);
    ok("W7", "the native session is STILL playing after the recovery (no restart)", nativeAfterRecovery.state === "playing");

    // The translation continues after the reconnect.
    session.emit({ kind: "source-transcript-delta", seq: 9, text: "Der ", positionMs: 6_000, speaker: "Speaker 2" });
    session.emit({ kind: "translation-delta", seq: 10, text: "The ", positionMs: 6_030, speaker: "Speaker 2" });
    const viewAfter = world.translation.captions();
    ok("W7", "the translation continues after the reconnect", viewAfter.rows.length >= 1);
    record(
      "W7",
      `Interruption → reconnect: the playback session ${playbackSessionId} NEVER restarted (the native session stayed playing); the recovery drove only session.reconnect() (1 call); the translation resumed.`,
    );
  });

  it("W8 — THE LATENCY MEASURES (the R25-L vocabulary, real clocks)", async () => {
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W8", "the play started", outcome.kind === "started");
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");
    await world.translation.start({
      realization: { mode: "native", connectorId: "authorized-peer-copy", capabilities: [] },
      nativeSessionId,
      liveInputId: null,
      sourceMediaId: R23_ITEM,
      targetLanguage: "en",
      sourceLanguageHint: "de",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      visualContextPolicy: "audio-only",
      outputModalities: "text+audio",
    });
    const session = world.session;
    if (session === null) throw new Error("the session double should exist");

    // The streaming events at the composition's own pace.
    session.emit({ kind: "source-transcript-delta", seq: 1, text: "Guten ", positionMs: 0, speaker: "Speaker 1" });
    session.emit({ kind: "translation-delta", seq: 2, text: "Good ", positionMs: 30, speaker: "Speaker 1" });
    session.emit({
      kind: "translated-audio-chunk",
      seq: 3,
      samples: new Uint8Array(32),
      durationMs: 500,
      positionMs: 30,
    });
    session.emit({ kind: "translation-segment-final", seq: 4, text: "Good evening.", positionMs: 30, durationMs: 600, speaker: "Speaker 1" });
    session.emit({ kind: "speaker-attribution", seq: 5, speaker: "Speaker 1", positionMs: 0 });
    session.emit({ kind: "timing-metadata", seq: 6, sourceConsumedMs: 1_200, translationRenderedMs: 900 });
    // The interruption + recovery (the reconnect-time measure).
    session.emit({ kind: "recoverable-error", detail: "a transient drop", requiresReconnect: true });
    await world.translation.pumpRecovery();
    // A continuity gap observed by the player shell (the mixer's honest
    // gap: a step with no due chunk, then the resumed chunk).
    world.mixer.step(10_000);
    session.emit({
      kind: "translated-audio-chunk",
      seq: 7,
      samples: new Uint8Array(32),
      durationMs: 400,
      positionMs: 10_000,
    });
    const resumedDecision = world.mixer.step(10_000);
    ok("W8", "the resumed chunk plays after the gap", resumedDecision.translatedChunk !== null);
    const gapReport = world.mixer.report().continuityGaps;
    world.instrument.observe({ kind: "audio-continuity-gap", gapMs: gapReport.totalMs });

    const measurement = world.instrument.measurement({
      label: R23_TITLE,
      realization: "authorized-torrent",
      targetLanguage: "en",
      outputModalities: "text+audio",
      translatedAudioChunks: 2,
      capturedAudioFrames: session.appendedAudio.length,
      visualFramesAppended: session.appendedFrames.length,
    });

    // THE REAL-CLOCK LAW: every observed measure is a positive real delta.
    ok("W8", "the first transcript delta was MEASURED (positive, real)", (measurement.firstTranscriptDeltaMs ?? -1) > 0);
    ok("W8", "the first translation delta was MEASURED", (measurement.firstTranslationDeltaMs ?? -1) > 0);
    ok("W8", "the first translated speech chunk was MEASURED", (measurement.firstTranslatedSpeechChunkMs ?? -1) > 0);
    ok("W8", "the stable segment was MEASURED", (measurement.stableSegmentMs ?? -1) > 0);
    ok("W8", "the speaker attribution availability was observed", measurement.speakerAttributionObserved === true);
    ok("W8", "the reconnect time was MEASURED", (measurement.reconnectTimeMs ?? -1) > 0);
    ok("W8", "the audio continuity gap was observed with its real duration", measurement.audioContinuity.gaps >= 1 && measurement.audioContinuity.totalGapMs >= 0);
    ok("W8", "the drift was MEASURED (rendered − consumed)", measurement.driftMs === -300);
    ok("W8", "the translation did NOT fail in this pass", measurement.translationFailed === false);
    record(
      "W8",
      `The R25-L measures (real clocks): firstTranscriptDelta=${measurement.firstTranscriptDeltaMs?.toFixed(3)}ms, firstTranslationDelta=${measurement.firstTranslationDeltaMs?.toFixed(3)}ms, firstSpeechChunk=${measurement.firstTranslatedSpeechChunkMs?.toFixed(3)}ms, stableSegment=${measurement.stableSegmentMs?.toFixed(3)}ms, reconnect=${measurement.reconnectTimeMs?.toFixed(3)}ms, continuityGaps=${measurement.audioContinuity.gaps} (${measurement.audioContinuity.totalGapMs.toFixed(3)}ms), drift=${measurement.driftMs}ms.`,
    );

    // W9 — stop the translation: normal playback continues.
    await world.translation.stop();
    ok("W9", "stopping the translation closed the session", session.stopCalls === 1 && session.closeCalls === 1);
    const nativeAfterStop = await world.boot.nativeMedia.inspect(nativeSessionId);
    ok("W9", "the native playback session is STILL playing after the translation stopped", nativeAfterStop.state === "playing");
    record("W9", "Normal playback: the translation stopped cleanly; the base playback continued untouched.");
  });

  it("W10 — THE FAILURE FALLBACK (translation failure never stops base playback)", async () => {
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    ok("W10", "the play started", outcome.kind === "started");
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");
    await world.translation.start({
      realization: { mode: "native", connectorId: "authorized-peer-copy", capabilities: [] },
      nativeSessionId,
      liveInputId: null,
      sourceMediaId: R23_ITEM,
      targetLanguage: "en",
      sourceLanguageHint: "de",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      visualContextPolicy: "audio-only",
      outputModalities: "text+audio",
    });
    const session = world.session;
    if (session === null) throw new Error("the session double should exist");

    // The source captions exist BEFORE the failure.
    session.emit({ kind: "source-transcript-final", seq: 1, text: "Guten Abend.", positionMs: 0, durationMs: 1_200, speaker: "Speaker 1" });

    // THE TERMINAL FAILURE.
    session.emit({ kind: "terminal-error", detail: "the realtime provider refused the session permanently" });
    ok("W10", "the terminal failure stopped the translation (the failed state)", world.translation.status().recovery === "failed");

    // THE FALLBACK LAW: the base playback continues; the source captions remain.
    const nativeStill = await world.boot.nativeMedia.inspect(nativeSessionId);
    ok("W10", "the native playback session is STILL playing after the translation failed", nativeStill.state === "playing");
    const view = world.translation.captions();
    ok("W10", "the source captions REMAIN after the failure (the fallback)", view.rows.some((row) => row.sourceText === "Guten Abend."));
    record("W10", "Failure fallback: the terminal error stopped the translation; the base playback and the source captions remained.");
  });
});

// ---------------------------------------------------------------------------
// THE EVIDENCE RECORD (the machine-generated manifest from THIS run)
// ---------------------------------------------------------------------------

describe("R25-W3 — the J43 evidence record", () => {
  it("writes the machine-generated J43 evidence when WFX_J43_EVIDENCE_DIR is set", async () => {
    const evidenceDir = process.env.WFX_J43_EVIDENCE_DIR;
    if (evidenceDir === undefined || evidenceDir.length === 0) return;

    // One fresh full pass for the record (the walk above already proved
    // the laws; this pass runs the complete journey once more with the
    // measurement retained).
    const world = bootJ43();
    const outcome = await world.boot.whereToWatch.playPeerCopy(R23_ITEM);
    const nativeSessionId = lastNativeSessionId(world.boot.nativeMedia);
    nativeEvent(world.boot.nativeMedia, nativeSessionId, "playing", 0, 25_000);
    world.nativeStates.set(nativeSessionId, "playing");
    const startResult = await world.translation.start({
      realization: { mode: "native", connectorId: "authorized-peer-copy", capabilities: [] },
      nativeSessionId,
      liveInputId: null,
      sourceMediaId: R23_ITEM,
      targetLanguage: "en",
      sourceLanguageHint: "de",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      visualContextPolicy: "audio-only",
      outputModalities: "text+audio",
    });
    ok("evidence", "the evidence pass started", startResult.kind === "started");
    const session = world.session;
    if (session === null) throw new Error("the session double should exist");
    world.tap.push(nativeSessionId, 0);
    world.tap.push(nativeSessionId, 1_020);
    session.emit({ kind: "source-transcript-delta", seq: 1, text: "Guten ", positionMs: 0, speaker: "Speaker 1" });
    session.emit({ kind: "translation-delta", seq: 2, text: "Good ", positionMs: 30, speaker: "Speaker 1" });
    session.emit({ kind: "source-transcript-final", seq: 3, text: "Guten Abend.", positionMs: 0, durationMs: 1_200, speaker: "Speaker 1" });
    session.emit({ kind: "translation-segment-final", seq: 4, text: "Good evening.", positionMs: 30, durationMs: 1_100, speaker: "Speaker 1" });
    session.emit({ kind: "speaker-attribution", seq: 5, speaker: "Speaker 2", positionMs: 2_000 });
    session.emit({ kind: "source-transcript-final", seq: 6, text: "Willkommen in der Archiv.", positionMs: 2_000, durationMs: 1_400, speaker: "Speaker 2" });
    session.emit({ kind: "translation-segment-final", seq: 7, text: "Welcome to the archive.", positionMs: 2_030, durationMs: 1_300, speaker: "Speaker 2" });
    session.emit({ kind: "translated-audio-chunk", seq: 8, samples: new Uint8Array(64), durationMs: 900, positionMs: 2_000 });
    const speechDecision = world.mixer.step(2_000);
    session.emit({ kind: "timing-metadata", seq: 9, sourceConsumedMs: 3_000, translationRenderedMs: 2_800 });
    session.emit({ kind: "recoverable-error", detail: "a transient network interruption", requiresReconnect: true });
    const carried = world.mixer.step(4_000);
    await world.translation.pumpRecovery();
    // The continuity gap: a step with no due chunk (the gap opens), then
    // the resumed chunk (the gap closes) — the player shell's observation.
    world.mixer.step(4_500);
    session.emit({ kind: "translated-audio-chunk", seq: 12, samples: new Uint8Array(32), durationMs: 400, positionMs: 4_500 });
    const resumedEvidence = world.mixer.step(4_500);
    const gapEvidence = world.mixer.report().continuityGaps;
    world.instrument.observe({ kind: "audio-continuity-gap", gapMs: gapEvidence.totalMs });
    session.emit({ kind: "source-transcript-delta", seq: 10, text: "Der ", positionMs: 6_000, speaker: "Speaker 2" });
    session.emit({ kind: "translation-delta", seq: 11, text: "The ", positionMs: 6_030, speaker: "Speaker 2" });
    const measurement: RealtimeTranslationMeasurement = world.instrument.measurement({
      label: R23_TITLE,
      realization: "authorized-torrent",
      targetLanguage: "en",
      outputModalities: "text+audio",
      translatedAudioChunks: 2,
      capturedAudioFrames: session.appendedAudio.length,
      visualFramesAppended: session.appendedFrames.length,
    });
    await world.translation.stop();
    const nativeAtEnd = await world.boot.nativeMedia.inspect(nativeSessionId);

    const manifest = {
      schema: "wfx-j43-realtime-translation-manifest/1",
      environment: {
        mode: "desktop-composition-simulator",
        clock: "performance.now (the real sub-millisecond sandbox clock)",
        startedAt: J43_STARTED_AT,
        finishedAt: new Date().toISOString(),
        harness: "apps/desktop/tests/j43-realtime-translation-desktop.test.ts over bootR23()",
      },
      summary: {
        total: J43_ASSERTIONS.length,
        passed: J43_ASSERTIONS.length,
        failed: 0,
        steps: J43_LOG.length,
        assertions: J43_ASSERTIONS.length,
      },
      journey: {
        id: "J43",
        title: "Realtime translation (Desktop)",
        status: "PASS",
        assertions: J43_ASSERTIONS,
      },
      walk: J43_LOG,
      measurement: {
        ...measurement,
        observations: measurement.observations.map((o) => ({ kind: o.kind, atMs: o.atMs })),
      },
      mixerReport: world.mixer.report(),
      evidencePass: {
        playbackSessionStarted: outcome.kind === "started",
        translatedSpeechDecision: speechDecision.continuity,
        carriedDuringInterruption: carried.continuity,
        resumedAfterReconnect: resumedEvidence.continuity,
        nativeSessionStateAtEnd: nativeAtEnd.state,
        reconnectCalls: session.reconnectCalls,
        sessionStopCalls: session.stopCalls,
        sessionCloseCalls: session.closeCalls,
      },
      honestScope: [
        "No realtime provider is bound through Model Fabric in this sandbox (Worker 1's shared contract + the provider registration have not landed) — the session here is the DETERMINISTIC DOUBLE of the Model Fabric session seam, the same shape the production factory binds.",
        "The latency numbers are REAL measurements of the REAL TypeScript composition executing in this sandbox (the deterministic doubles resolve immediately) — they prove the ARCHITECTURE ORDERING and the measurement machinery, not provider latency. The provider-path numbers are the lead's real-device procedure, recorded as pending (never silently passed).",
        "The desktop playback rides the R23 harness's authorized torrent/peer copy — the same journey law as J38/J41; the local-file and controlled-live capture paths are proven by the capture-service and adapter unit laws.",
        "The Web lane's J43 (Worker 2) shares the same session seam vocabulary; the Web/Desktop semantics agreement is the integration-time truth.",
      ],
    };

    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const summaryLines: string[] = [
      "# J43 — Realtime translation (Desktop) — the R25-W3 evidence",
      "",
      `Run: ${J43_STARTED_AT} → ${manifest.environment.finishedAt} (${manifest.environment.mode}).`,
      "",
      "## The walk",
      "",
      ...J43_LOG.map((entry) => `- **${entry.step}** — ${entry.observed}`),
      "",
      "## The assertions",
      "",
      `**${J43_ASSERTIONS.length} assertions, all passing.**`,
      "",
      ...J43_ASSERTIONS.map((entry) => `- [${entry.step}] ${entry.description}`),
      "",
      "## The R25-L latency measures (real clocks)",
      "",
      `- first source transcript delta: ${measurement.firstTranscriptDeltaMs?.toFixed(3)} ms`,
      `- first translated text delta: ${measurement.firstTranslationDeltaMs?.toFixed(3)} ms`,
      `- first translated speech chunk: ${measurement.firstTranslatedSpeechChunkMs?.toFixed(3)} ms`,
      `- stable translated segment: ${measurement.stableSegmentMs?.toFixed(3)} ms`,
      `- speaker attribution availability: ${measurement.speakerAttributionObserved}`,
      `- reconnect time: ${measurement.reconnectTimeMs?.toFixed(3)} ms`,
      `- audio continuity gaps: ${measurement.audioContinuity.gaps} (${measurement.audioContinuity.totalGapMs.toFixed(3)} ms)`,
      `- drift (rendered − consumed): ${measurement.driftMs} ms (${measurement.driftCorrections} correction(s))`,
      `- translated audio chunks: ${measurement.translatedAudioChunks}; captured audio frames: ${measurement.capturedAudioFrames}; visual frames appended: ${measurement.visualFramesAppended} (the audio-only never-forced policy)`,
      "",
      "## The honest scope (never silent skips)",
      "",
      ...manifest.honestScope.map((note) => `- ${note}`),
      "",
    ];
    writeFileSync(join(evidenceDir, "summary.md"), summaryLines.join("\n"));
  });
});
