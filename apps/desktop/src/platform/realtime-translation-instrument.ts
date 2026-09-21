/**
 * @wfx/app-desktop — the realtime translation latency instrument (R25-W3,
 * the plan's R25-L "Performance acceptance" — the Desktop-side measures).
 *
 * THE LAW THIS INSTRUMENT KEEPS (docs/plans/2026-09-20-webflix-qwen-
 * livetranslate-plan.md R25-L + the R24 discipline): "WebFlix must
 * benchmark end-to-end latency rather than treating [the provider's
 * reported figure] as guaranteed UI latency." Every measure below is a
 * REAL delta the injectable clock observed between two honest points of
 * the composition — the instrument NEVER invents a number, and a metric
 * that was not observed stays `null` (honest absence, never zero
 * theater). A synthetic pass is impossible by construction: the record
 * derives from observations that only the live composition can record.
 *
 * THE MEASURED VOCABULARY (the plan's R25-L list, verbatim):
 * - first source transcript delta (from the translation start request);
 * - first translated text delta;
 * - first translated speech chunk;
 * - stable translated segment (the first translation-segment-final);
 * - speaker attribution availability (observed or not — a boolean truth,
 *   never a fabricated time);
 * - reconnect time (interruption → reconnected);
 * - audio continuity (gap count + total gap ms);
 * - drift between source and translated subtitle timing (the last
 *   observed drift + the correction count).
 *
 * THE CLOCK SEAM: `nowMs()` — the SystemClock in production, the
 * deterministic clock in tests (the R24 playback-startup instrument's
 * exact pattern; this record reconciles with the shared telemetry
 * contract when Worker 1's lane lands — the same escalation).
 */

// ---------------------------------------------------------------------------
// The observation vocabulary (the honest points of the translation path)
// ---------------------------------------------------------------------------

/** One observed point of the realtime translation path. */
export type RealtimeTranslationObservation =
  | { readonly kind: "translation-start-requested" }
  | { readonly kind: "session-created" }
  | { readonly kind: "first-audio-appended" }
  | { readonly kind: "first-transcript-delta" }
  | { readonly kind: "first-translation-delta" }
  | { readonly kind: "first-translated-audio-chunk" }
  | { readonly kind: "first-stable-segment" }
  | { readonly kind: "speaker-attribution-observed" }
  | { readonly kind: "translation-interruption"; readonly detail: string }
  | { readonly kind: "reconnected" }
  | { readonly kind: "translation-failed"; readonly detail: string }
  | { readonly kind: "translation-stopped" }
  | {
      /** One observed continuity gap (the mixer's closed gap). */
      readonly kind: "audio-continuity-gap";
      readonly gapMs: number;
    }
  | {
      /** One observed drift measurement (the mixer's law: measured, never rewritten). */
      readonly kind: "drift-observed";
      readonly driftMs: number;
    }
  | { readonly kind: "drift-correction"; readonly magnitudeMs: number };

/** Every observation kind, in the frozen vocabulary order. */
export const REALTIME_TRANSLATION_OBSERVATION_KINDS: readonly RealtimeTranslationObservation["kind"][] =
  [
    "translation-start-requested",
    "session-created",
    "first-audio-appended",
    "first-transcript-delta",
    "first-translation-delta",
    "first-translated-audio-chunk",
    "first-stable-segment",
    "speaker-attribution-observed",
    "translation-interruption",
    "reconnected",
    "translation-failed",
    "translation-stopped",
    "audio-continuity-gap",
    "drift-observed",
    "drift-correction",
  ] as const;

// ---------------------------------------------------------------------------
// The measurement record (the frozen R25-L metric vocabulary)
// ---------------------------------------------------------------------------

/** One realtime translation measurement record. */
export interface RealtimeTranslationMeasurement {
  /** The pass's label. */
  readonly label: string;
  /** The realization the pass translated (the capture path's rung). */
  readonly realization: string;
  /** The target language. */
  readonly targetLanguage: string;
  /** The output modalities. */
  readonly outputModalities: "text" | "text+audio";
  /** The raw observations (the retained raw record). */
  readonly observations: readonly TimestampedRealtimeObservation[];

  // — the R25-L measures (ms; null = honestly not observed in this pass) —
  /** First source transcript delta from the translation start request. */
  readonly firstTranscriptDeltaMs: number | null;
  /** First translated text delta from the translation start request. */
  readonly firstTranslationDeltaMs: number | null;
  /** First translated speech chunk from the translation start request. */
  readonly firstTranslatedSpeechChunkMs: number | null;
  /** First stable translated segment from the translation start request. */
  readonly stableSegmentMs: number | null;
  /** Speaker attribution availability (observed or not — never a fabricated time). */
  readonly speakerAttributionObserved: boolean;
  /** Reconnect time (interruption → reconnected; null when no interruption). */
  readonly reconnectTimeMs: number | null;
  /** Audio continuity: the gaps observed in translated-speech mode. */
  readonly audioContinuity: { readonly gaps: number; readonly totalGapMs: number };
  /** The drift between source and translated timing (last observed; null when none). */
  readonly driftMs: number | null;
  /** The drift corrections applied (the mixer's stale-drop law). */
  readonly driftCorrections: number;

  // — the composition's own accounting (the honest throughput truth) —
  /** The translated audio chunks received (the session's events). */
  readonly translatedAudioChunks: number;
  /** The captured audio frames appended (the capture tap's relay). */
  readonly capturedAudioFrames: number;
  /** The visual frames appended (the sampler's emissions). */
  readonly visualFramesAppended: number;
  /** Whether the translation FAILED in this pass (base playback continued). */
  readonly translationFailed: boolean;
  readonly translationFailureDetail: string | null;
}

/** One timestamped observation (the raw retained record). */
export interface TimestampedRealtimeObservation {
  readonly kind: RealtimeTranslationObservation["kind"];
  readonly atMs: number;
  readonly detail?: string;
  readonly gapMs?: number;
  readonly driftMs?: number;
  readonly magnitudeMs?: number;
}

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

/** Options for {@link createRealtimeTranslationInstrument}. */
export interface RealtimeTranslationInstrumentOptions {
  /** The clock seam — the timestamp source (never a hidden wall clock). */
  readonly nowMs: () => number;
}

/** The realtime translation latency instrument. */
export interface DesktopRealtimeTranslationInstrument {
  /** Record one observation at the clock's current instant. */
  observe(observation: RealtimeTranslationObservation): void;
  /** Derive the measurement record from the observations since the last reset. */
  measurement(input: {
    readonly label: string;
    readonly realization: string;
    readonly targetLanguage: string;
    readonly outputModalities: "text" | "text+audio";
    readonly translatedAudioChunks: number;
    readonly capturedAudioFrames: number;
    readonly visualFramesAppended: number;
  }): RealtimeTranslationMeasurement;
  /** The raw observations since the last reset. */
  raw(): readonly TimestampedRealtimeObservation[];
  /** Reset for the next pass. */
  reset(): void;
}

/**
 * Create the realtime translation latency instrument. Pure recording +
 * derivation: no product policy, no transport, no invention — the caller
 * observes the honest points, the instrument keeps them and derives the
 * frozen R25-L vocabulary from them.
 */
export function createRealtimeTranslationInstrument(
  options: RealtimeTranslationInstrumentOptions,
): DesktopRealtimeTranslationInstrument {
  const { nowMs } = options;
  let observations: TimestampedRealtimeObservation[] = [];

  const at = (kind: RealtimeTranslationObservation["kind"]): number | null => {
    const found = observations.find((entry) => entry.kind === kind);
    return found !== undefined ? found.atMs : null;
  };

  return {
    observe(observation: RealtimeTranslationObservation): void {
      observations.push({
        kind: observation.kind,
        atMs: nowMs(),
        ...("detail" in observation ? { detail: observation.detail } : {}),
        ...("gapMs" in observation ? { gapMs: observation.gapMs } : {}),
        ...("driftMs" in observation ? { driftMs: observation.driftMs } : {}),
        ...("magnitudeMs" in observation ? { magnitudeMs: observation.magnitudeMs } : {}),
      });
    },

    measurement(input: {
      readonly label: string;
      readonly realization: string;
      readonly targetLanguage: string;
      readonly outputModalities: "text" | "text+audio";
      readonly translatedAudioChunks: number;
      readonly capturedAudioFrames: number;
      readonly visualFramesAppended: number;
    }): RealtimeTranslationMeasurement {
      const startRequested = at("translation-start-requested");
      const failure = observations.find((entry) => entry.kind === "translation-failed");

      const delta = (from: number | null, to: number | null): number | null =>
        from !== null && to !== null && to >= from ? to - from : null;

      const gaps = observations.filter((entry) => entry.kind === "audio-continuity-gap");
      const drifts = observations.filter((entry) => entry.kind === "drift-observed");
      const corrections = observations.filter((entry) => entry.kind === "drift-correction");

      return {
        label: input.label,
        realization: input.realization,
        targetLanguage: input.targetLanguage,
        outputModalities: input.outputModalities,
        observations: [...observations],

        firstTranscriptDeltaMs: delta(startRequested, at("first-transcript-delta")),
        firstTranslationDeltaMs: delta(startRequested, at("first-translation-delta")),
        firstTranslatedSpeechChunkMs: delta(startRequested, at("first-translated-audio-chunk")),
        stableSegmentMs: delta(startRequested, at("first-stable-segment")),
        speakerAttributionObserved: at("speaker-attribution-observed") !== null,
        reconnectTimeMs: delta(at("translation-interruption"), at("reconnected")),
        audioContinuity: {
          gaps: gaps.length,
          totalGapMs: gaps.reduce((sum, entry) => sum + (entry.gapMs ?? 0), 0),
        },
        driftMs: drifts.length > 0 ? (drifts[drifts.length - 1]!.driftMs ?? null) : null,
        driftCorrections: corrections.length,

        translatedAudioChunks: input.translatedAudioChunks,
        capturedAudioFrames: input.capturedAudioFrames,
        visualFramesAppended: input.visualFramesAppended,
        translationFailed: failure !== undefined,
        translationFailureDetail: failure?.detail ?? null,
      };
    },

    raw(): readonly TimestampedRealtimeObservation[] {
      return [...observations];
    },

    reset(): void {
      observations = [];
    },
  };
}

// ---------------------------------------------------------------------------
// The percentile derivation (the R24 threshold machinery, reused verbatim
// in spirit — honest over small samples: the nearest-rank method)
// ---------------------------------------------------------------------------

/** The p50/p75/p95 derivation over one metric's non-null observations. */
export function realtimePercentile(
  values: readonly number[],
  percentile: 50 | 75 | 95,
): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}
