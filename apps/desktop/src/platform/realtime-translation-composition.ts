/**
 * @wfx/app-desktop — the desktop realtime translation composition (R25-W3,
 * the J43 driver surface — the plan's R25-G player experience on Desktop).
 *
 * WHAT THIS COMPOSITION IS: the one surface the Desktop player's Translate
 * control drives. It composes the lane's four modules behind a single
 * honest interface:
 *
 * ```text
 *   the player's Translate control (the affordance grammar's translate row)
 *     └─> translateControl(realization) — the honest per-rung truth
 *     └─> start(input) — the media adapter's feed (capture + sampler)
 *           ├─> the session (the factory seam — Model Fabric in production)
 *           │      events ──> the bilingual captions projection
 *           │      events ──> the latency instrument (the R25-L measures)
 *           │      translated-audio-chunk ──> the output mixer (buffering)
 *           │      recoverable/terminal errors ──> the recovery supervisor
 *     └─> setMode("translated-speech" | "original-audio") — the mixer's law
 *     └─> captions() — the live bilingual view (source/translation aligned)
 *     └─> status() — the live truth for the surfaces
 *     └─> stop() — translation stops; BASE PLAYBACK NEVER DOES
 * ```
 *
 * THE PRODUCT LAWS KEPT HERE:
 * - BASE PLAYBACK NEVER WAITS FOR TRANSLATION: `start` is an observation
 *   of an ALREADY-PLAYING session — the composition accepts the playback
 *   truth as INPUT (the native session id + the playback position feed),
 *   never drives it. The adapter + supervisor hold no playback handles
 *   (their own structural laws); this composition holds none either.
 * - THE HONEST PER-RUNG TRUTH: the Translate control's offered/unavailable
 *   truth is the adapter's capability resolution, surfaced verbatim — the
 *   R24 affordance grammar's discipline (offered with its capture path,
 *   or the honest unavailable sentence with the plan's alternatives).
 * - THE MODES: translated speech / original audio (the mixer's law — the
 *   original always available, the switch instant + lossless).
 * - THE BILINGUAL VIEW (R25-G): the source transcript and the translation
 *   are PRESERVED SIDE BY SIDE (alignment, never replacement); speaker
 *   labels are simple and contextual ("Speaker 1"/"Speaker 2" — the
 *   session's own labels, trusted metadata may name them later).
 * - RECOVERY NEVER RESTARTS THE MEDIA (the supervisor's law): the
 *   composition's status reports the supervisor's state; the playback
 *   truth is not touched by any recovery transition.
 */

import type { PlaybackRealization } from "@wfx/domain";

import type {
  RealtimeCaptureCapability,
  DesktopRealtimeMediaAdapter,
  RealtimeCaptureFeed,
} from "./realtime-media-adapter";
import type { RealtimeTranslationEvent, RealtimeTranslationSession } from "./realtime-translation-port";
import type { TranslatedAudioOutputMixer, TranslatedAudioOutputMode } from "./translated-audio-output";
import {
  createRealtimeRecoverySupervisor,
  type RealtimeRecoverySupervisor,
} from "./realtime-recovery";
import type { RealtimeRecoveryState } from "./realtime-recovery";
import type { DesktopRealtimeTranslationInstrument } from "./realtime-translation-instrument";

// ---------------------------------------------------------------------------
// The bilingual captions projection (the plan's R25-G alignment law)
// ---------------------------------------------------------------------------

/** One live bilingual caption row (the source/translation alignment). */
export interface BilingualCaptionRow {
  /** The row's source-timeline position (ms). */
  readonly positionMs: number;
  /** The source transcript text (the accumulated deltas; complete when final). */
  readonly sourceText: string;
  /** The translated text (the accumulated deltas; complete when final). */
  readonly translatedText: string;
  /** The attributed speaker label (null when attribution is off). */
  readonly speaker: string | null;
  /** The alignment truth: paired, source-only, or translation-only. */
  readonly alignment: "paired" | "source-only" | "translation-only";
  /** Whether the source segment is finalized. */
  readonly sourceFinal: boolean;
  /** Whether the translation segment is finalized. */
  readonly translationFinal: boolean;
}

/** The live bilingual view (ordered by position). */
export interface BilingualCaptionsView {
  readonly rows: readonly BilingualCaptionRow[];
  /** The active speaker (the last speaker-attribution label). */
  readonly activeSpeaker: string | null;
  /** The alignment window the view uses (ms — the honest merge truth). */
  readonly alignmentWindowMs: number;
}

// ---------------------------------------------------------------------------
// The start input + the typed results
// ---------------------------------------------------------------------------

/** The composition's start input (the player's Translate action). */
export interface DesktopRealtimeTranslationStartInput {
  /** The playback realization being translated. */
  readonly realization: PlaybackRealization;
  /** The engaged native playback session id (null for a live input). */
  readonly nativeSessionId: string | null;
  /** The registered live-input id (null unless the path is controlled-live). */
  readonly liveInputId: string | null;
  /** The canonical item id when known. */
  readonly sourceMediaId: string | null;
  /** The chosen target language (BCP-47). */
  readonly targetLanguage: string;
  /** The optional source-language hint. */
  readonly sourceLanguageHint: string | null;
  /** The subtitle mode. */
  readonly subtitleMode: "source" | "translated" | "bilingual";
  /** The speaker-attribution mode. */
  readonly speakerAttribution: "labeled" | "off";
  /** The visual-context policy (audio-only is the never-forced default). */
  readonly visualContextPolicy: "audio-only" | "adaptive" | "disabled";
  /** Whether translated speech is requested (text-only keeps costs honest). */
  readonly outputModalities: "text" | "text+audio";
  /** Domain terminology (hotwords). */
  readonly hotwords?: readonly { readonly term: string; readonly translation: string }[];
}

/** The typed start failure (closed vocabulary). */
export type DesktopRealtimeTranslationStartFailure =
  | { readonly kind: "capture-unauthorized"; readonly detail: string }
  | { readonly kind: "capture-refused"; readonly detail: string }
  | { readonly kind: "session-creation-failed"; readonly detail: string }
  | { readonly kind: "already-translating"; readonly detail: string };

// ---------------------------------------------------------------------------
// The status + the surface
// ---------------------------------------------------------------------------

/** The composition's live status (the surfaces' truth). */
export interface DesktopRealtimeTranslationStatus {
  /** Whether a translation session is live. */
  readonly active: boolean;
  /** The recovery state (idle/active/interrupted/reconnected/failed). */
  readonly recovery: RealtimeRecoveryState;
  /** The output mode in force. */
  readonly outputMode: TranslatedAudioOutputMode;
  /** The target language (null when inactive). */
  readonly targetLanguage: string | null;
  /** The honest per-rung capability the start resolved against. */
  readonly capability: RealtimeCaptureCapability | null;
}

/** Options for {@link createDesktopRealtimeTranslation}. */
export interface DesktopRealtimeTranslationOptions {
  /** The media adapter (the capture + sampler integration). */
  readonly adapter: DesktopRealtimeMediaAdapter;
  /** The translated-audio output mixer. */
  readonly mixer: TranslatedAudioOutputMixer;
  /** The latency instrument (the R25-L measures). */
  readonly instrument: DesktopRealtimeTranslationInstrument;
  /** The clock (the composition's observation stamps). */
  readonly nowMs: () => number;
  /**
   * The recovery supervisor's tunables (attempts/backoff/schedule/driver)
   * — the composition creates the supervisor per started session and
   * wires its transitions into the instrument.
   */
  readonly recovery?: {
    readonly maxAttempts?: number | undefined;
    readonly backoffMs?: readonly number[] | undefined;
    readonly schedule?: ((callback: () => void, ms: number) => void) | undefined;
    readonly reconnectDriver?: ((session: RealtimeTranslationSession) => Promise<void>) | undefined;
  };
  /**
   * The alignment window for the bilingual rows' merge (ms): a source
   * segment and a translation segment align when their positions are
   * within the window. Default: 1_000.
   */
  readonly alignmentWindowMs?: number;
}

/** The desktop realtime translation composition (the J43 driver surface). */
export interface DesktopRealtimeTranslation {
  /** The honest per-rung Translate control truth (the affordance grammar). */
  translateControl(input: {
    readonly realization: PlaybackRealization;
    readonly nativeSessionId: string | null;
    readonly liveInputId: string | null;
  }): {
    readonly offered: boolean;
    readonly capability: RealtimeCaptureCapability;
  };

  /** Start translating one playing item (the playback is ALREADY running). */
  start(
    input: DesktopRealtimeTranslationStartInput,
  ): Promise<{ readonly kind: "started" } | DesktopRealtimeTranslationStartFailure>;

  /** Switch the output mode (instant + lossless — the mixer's law). */
  setMode(mode: "translated-speech" | "original-audio"): void;

  /** The live bilingual captions view (the alignment law). */
  captions(): BilingualCaptionsView;

  /** The live status. */
  status(): DesktopRealtimeTranslationStatus;

  /** Stop translating (base playback is untouched — never this surface's business). */
  stop(): Promise<void>;
  /**
   * Pump ONE pending recovery attempt now — the deterministic-test driver
   * over the supervisor's own seam (production runs the schedule). Also
   * the manual recovery trigger for a UI affordance that offers
   * "reconnect now".
   */
  pumpRecovery(): Promise<void>;
}

/**
 * Create the desktop realtime translation composition — the J43 driver
 * surface over the lane's adapter/mixer/supervisor/instrument.
 */
export function createDesktopRealtimeTranslation(
  options: DesktopRealtimeTranslationOptions,
): DesktopRealtimeTranslation {
  const alignmentWindowMs = options.alignmentWindowMs ?? 1_000;

  let feed: RealtimeCaptureFeed | null = null;
  let supervisor: RealtimeRecoverySupervisor | null = null;
  let activeCapability: RealtimeCaptureCapability | null = null;
  let targetLanguage: string | null = null;

  // The bilingual projection's source of truth: the accumulated segments.
  interface SegmentAccumulator {
    positionMs: number;
    text: string;
    speaker: string | null;
    final: boolean;
    durationMs: number | null;
  }
  let sourceSegments: SegmentAccumulator[] = [];
  let translatedSegments: SegmentAccumulator[] = [];
  let activeSpeaker: string | null = null;

  /** Fold one session event into the projection + instrument + mixer. */
  function onSessionEvent(event: RealtimeTranslationEvent): void {
    const instrument = options.instrument;
    switch (event.kind) {
      case "session-created": {
        instrument.observe({ kind: "session-created" });
        return;
      }
      case "source-transcript-delta": {
        const existing = sourceSegments.find(
          (segment) => Math.abs(segment.positionMs - event.positionMs) <= alignmentWindowMs,
        );
        if (existing === undefined) {
          sourceSegments.push({
            positionMs: event.positionMs,
            text: event.text,
            speaker: event.speaker,
            final: false,
            durationMs: null,
          });
          if (sourceSegments.length === 1) {
            instrument.observe({ kind: "first-transcript-delta" });
          }
        } else {
          existing.text = `${existing.text}${event.text}`;
          if (event.speaker !== null) existing.speaker = event.speaker;
        }
        return;
      }
      case "source-transcript-final": {
        const existing = sourceSegments.find(
          (segment) => Math.abs(segment.positionMs - event.positionMs) <= alignmentWindowMs,
        );
        if (existing === undefined) {
          sourceSegments.push({
            positionMs: event.positionMs,
            text: event.text,
            speaker: event.speaker,
            final: true,
            durationMs: event.durationMs,
          });
          if (sourceSegments.length === 1) {
            instrument.observe({ kind: "first-transcript-delta" });
          }
        } else {
          existing.text = event.text;
          existing.final = true;
          existing.durationMs = event.durationMs;
          if (event.speaker !== null) existing.speaker = event.speaker;
        }
        return;
      }
      case "translation-delta": {
        const existing = translatedSegments.find(
          (segment) => Math.abs(segment.positionMs - event.positionMs) <= alignmentWindowMs,
        );
        if (existing === undefined) {
          translatedSegments.push({
            positionMs: event.positionMs,
            text: event.text,
            speaker: event.speaker,
            final: false,
            durationMs: null,
          });
          if (translatedSegments.length === 1) {
            instrument.observe({ kind: "first-translation-delta" });
          }
        } else {
          existing.text = `${existing.text}${event.text}`;
          if (event.speaker !== null) existing.speaker = event.speaker;
        }
        return;
      }
      case "translation-segment-final": {
        const existing = translatedSegments.find(
          (segment) => Math.abs(segment.positionMs - event.positionMs) <= alignmentWindowMs,
        );
        if (existing === undefined) {
          translatedSegments.push({
            positionMs: event.positionMs,
            text: event.text,
            speaker: event.speaker,
            final: true,
            durationMs: event.durationMs,
          });
          if (translatedSegments.length === 1) {
            instrument.observe({ kind: "first-translation-delta" });
          }
        } else {
          existing.text = event.text;
          existing.final = true;
          existing.durationMs = event.durationMs;
          if (event.speaker !== null) existing.speaker = event.speaker;
        }
        instrument.observe({ kind: "first-stable-segment" });
        return;
      }
      case "speaker-attribution": {
        activeSpeaker = event.speaker;
        instrument.observe({ kind: "speaker-attribution-observed" });
        // The sampler's out-of-band speaker notification (R25-F trigger 3b:
        // the NEXT considered frame rides the speaker-change trigger).
        feed?.notifySpeakerChanged();
        return;
      }
      case "translated-audio-chunk": {
        options.mixer.offer({
          positionMs: event.positionMs,
          durationMs: event.durationMs,
          samples: event.samples,
          arrivedAtMs: options.nowMs(),
        });
        instrument.observe({ kind: "first-translated-audio-chunk" });
        return;
      }
      case "timing-metadata": {
        // The drift observation (the plan's source/translation timing).
        const drift = event.translationRenderedMs - event.sourceConsumedMs;
        instrument.observe({ kind: "drift-observed", driftMs: drift });
        return;
      }
      case "usage-telemetry": {
        // Usage/cost telemetry rides the shared contract's transport
        // (Worker 1's lane); the composition records nothing here.
        return;
      }
      case "recoverable-error": {
        instrument.observe({ kind: "translation-interruption", detail: event.detail });
        return;
      }
      case "terminal-error": {
        instrument.observe({ kind: "translation-failed", detail: event.detail });
        return;
      }
      case "session-closed": {
        instrument.observe({ kind: "translation-stopped" });
        return;
      }
    }
  }

  return {
    translateControl(input): { offered: boolean; capability: RealtimeCaptureCapability } {
      const capability = options.adapter.captureCapability({
        realization: input.realization,
        nativeSessionId: input.nativeSessionId,
        liveInputId: input.liveInputId,
      });
      return { offered: capability.kind === "authorized", capability };
    },

    async start(input): Promise<{ readonly kind: "started" } | DesktopRealtimeTranslationStartFailure> {
      if (feed !== null) {
        return {
          kind: "already-translating",
          detail: "a realtime translation session is already live for this player — stop it before starting another",
        };
      }
      // The instrument's origin: the user's Translate action.
      options.instrument.reset();
      options.instrument.observe({ kind: "translation-start-requested" });

      // The session's events drive the projection + the instrument + the
      // mixer; the supervisor drives the recovery law. The pre-start hook
      // subscribes BEFORE the session starts (the session-created ack is
      // never missed).
      const startedFeed = await options.adapter.startFeed({
        realization: input.realization,
        nativeSessionId: input.nativeSessionId,
        liveInputId: input.liveInputId,
        sourceMediaId: input.sourceMediaId,
        targetLanguage: input.targetLanguage,
        sourceLanguageHint: input.sourceLanguageHint,
        outputModalities: input.outputModalities,
        subtitleMode: input.subtitleMode,
        speakerAttribution: input.speakerAttribution,
        visualContextPolicy: input.visualContextPolicy,
        hotwords: input.hotwords,
        onSession: (session: RealtimeTranslationSession): void => {
          session.subscribe(onSessionEvent);
          supervisor = createRealtimeRecoverySupervisor({
            session,
            nowMs: options.nowMs,
            ...(options.recovery?.maxAttempts !== undefined
              ? { maxAttempts: options.recovery.maxAttempts }
              : {}),
            ...(options.recovery?.backoffMs !== undefined ? { backoffMs: options.recovery.backoffMs } : {}),
            ...(options.recovery?.schedule !== undefined ? { schedule: options.recovery.schedule } : {}),
            ...(options.recovery?.reconnectDriver !== undefined
              ? { reconnectDriver: options.recovery.reconnectDriver }
              : {}),
            // The supervisor's transitions are the instrument's recovery
            // evidence (the R25-L reconnect time + the fallback truth).
            onTransition: (transition): void => {
              if (transition.to === "reconnected") {
                options.instrument.observe({ kind: "reconnected" });
              } else if (transition.to === "failed") {
                options.instrument.observe({
                  kind: "translation-failed",
                  detail: transition.detail ?? "the recovery supervisor failed",
                });
              }
            },
          });
          supervisor.start();
        },
      });
      if ("kind" in startedFeed) {
        return startedFeed;
      }
      feed = startedFeed;
      activeCapability = options.adapter.captureCapability({
        realization: input.realization,
        nativeSessionId: input.nativeSessionId,
        liveInputId: input.liveInputId,
      });
      targetLanguage = input.targetLanguage;

      // The mode law: translated speech only when the user asked for it.
      if (input.outputModalities === "text+audio") {
        options.mixer.setMode("translated-speech");
      }

      return { kind: "started" };
    },

    setMode(mode: "translated-speech" | "original-audio"): void {
      options.mixer.setMode(mode);
    },

    captions(): BilingualCaptionsView {
      // THE ALIGNMENT LAW: merge the source and translation segments by
      // position (within the alignment window) — preserving BOTH, never
      // replacing the source transcript (the plan's R25-G).
      const rows: BilingualCaptionRow[] = [];
      const translatedUsed = new Set<number>();
      for (const source of [...sourceSegments].sort((a, b) => a.positionMs - b.positionMs)) {
        const translatedIndex = translatedSegments.findIndex(
          (segment, index) =>
            !translatedUsed.has(index) && Math.abs(segment.positionMs - source.positionMs) <= alignmentWindowMs,
        );
        if (translatedIndex >= 0) {
          translatedUsed.add(translatedIndex);
          const translated = translatedSegments[translatedIndex]!;
          rows.push({
            positionMs: source.positionMs,
            sourceText: source.text,
            translatedText: translated.text,
            speaker: source.speaker ?? translated.speaker,
            alignment: "paired",
            sourceFinal: source.final,
            translationFinal: translated.final,
          });
        } else {
          rows.push({
            positionMs: source.positionMs,
            sourceText: source.text,
            translatedText: "",
            speaker: source.speaker,
            alignment: "source-only",
            sourceFinal: source.final,
            translationFinal: false,
          });
        }
      }
      for (const [index, translated] of translatedSegments.entries()) {
        if (translatedUsed.has(index)) continue;
        rows.push({
          positionMs: translated.positionMs,
          sourceText: "",
          translatedText: translated.text,
          speaker: translated.speaker,
          alignment: "translation-only",
          sourceFinal: false,
          translationFinal: translated.final,
        });
      }
      rows.sort((a, b) => a.positionMs - b.positionMs);
      return { rows, activeSpeaker, alignmentWindowMs };
    },

    status(): DesktopRealtimeTranslationStatus {
      return {
        active: feed !== null,
        recovery: supervisor?.state() ?? "idle",
        outputMode: options.mixer.report().mode,
        targetLanguage,
        capability: activeCapability,
      };
    },

    async stop(): Promise<void> {
      if (feed === null) return;
      const session = feed.session;
      feed.stop();
      feed = null;
      supervisor?.stop();
      supervisor = null;
      activeCapability = null;
      targetLanguage = null;
      await session.stop().catch(() => undefined);
      await session.close().catch(() => undefined);
    },

    async pumpRecovery(): Promise<void> {
      await supervisor?.pumpPendingAttempt();
    },
  };
}
