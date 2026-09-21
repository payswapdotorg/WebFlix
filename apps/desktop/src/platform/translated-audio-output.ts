/**
 * @wfx/app-desktop — the translated-audio output mixer (R25-W3, the plan's
 * desktop lane "native output mixing + translated-audio buffering").
 *
 * THE LAWS THIS MIXER KEEPS:
 *
 * 1. THE ORIGINAL AUDIO STAYS AVAILABLE (the plan's R25-G mode law): the
 *    two modes are `translated-speech` (the translated chunks play, the
 *    original ducks) and `original-audio` (the translated stream mutes;
 *    the original plays at full level). Translation NEVER REPLACES the
 *    source stream — switching modes is instant and lossless for the
 *    original path (there is nothing to "restore": the original was
 *    never taken away, only attenuated).
 * 2. BUFFERED, BOUNDED, ORDERED PLAYBACK (the jitter buffer): translated
 *    audio chunks arrive provider-paced; playback consumes them at the
 *    SOURCE timeline's pace, keyed by each chunk's SOURCE positionMs (the
 *    alignment key the session stamps). The buffer is bounded — when the
 *    translated stream runs far AHEAD of the playhead, chunks are dropped
 *    OLDEST-FIRST and the accounting says so (never silent, never
 *    unbounded).
 * 3. DRIFT IS MEASURED, NEVER REWRITTEN (the plan's "drift management
 *    between the source and translated streams"): drift = the translated
 *    stream's rendered position minus the source playhead. Beyond the
 *    tolerance the mixer DROPS the stale chunks (the translated stream
 *    conforms to the source — the source's own timeline is never touched
 *    or re-timed) and reports a typed drift-correction with the honest
 *    magnitude.
 * 4. GAPS ARE HONEST (audio continuity): a playback step with no due
 *    chunk (the provider has not produced one yet — or an interruption
 *    is in flight) outputs the ORIGINAL at duck-restore level and counts
 *    a continuity gap with its duration. In translated-speech mode the
 *    fallback law: the original carries the moment (never silence).
 *
 * WHAT THE MIXER IS NOT: a decoder (the chunks are already PCM — the
 * session's declared format), the ORIGINAL audio's renderer (the platform
 * audio stack owns that; the mixer only answers the per-step MIX DECISION
 * + hands the due translated chunk to the output sink), or a provider
 * client.
 *
 * THE CLOCK SEAM: like the R24 instrument, every timestamp comes from the
 * injectable clock — the mix decisions are pure functions of (playhead,
 * buffer, mode); the accounting records what actually happened.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The output mode (the plan's R25-G: translated speech / original audio). */
export type TranslatedAudioOutputMode = "translated-speech" | "original-audio";

/** One translated audio chunk entering the buffer (the session's event). */
export interface TranslatedAudioChunkInput {
  /** The SOURCE-timeline position this chunk translates (the alignment key). */
  readonly positionMs: number;
  /** The chunk's duration (ms). */
  readonly durationMs: number;
  /** The translated speech PCM bytes. */
  readonly samples: Uint8Array;
  /** The wall-clock time the chunk ARRIVED (the session event's stamp). */
  readonly arrivedAtMs: number;
}

/** One output mix decision for a playback step (what the audio stack does). */
export interface OutputMixDecision {
  /** The step's source playhead (ms). */
  readonly playheadMs: number;
  /** The mode in force. */
  readonly mode: TranslatedAudioOutputMode;
  /** The ORIGINAL audio's gain for this step (0..1 — duck or full). */
  readonly originalGain: number;
  /** The translated chunk due for playback now (null when none is due). */
  readonly translatedChunk: TranslatedAudioChunkInput | null;
  /** The honest continuity truth for this step. */
  readonly continuity: "translated" | "original-carries" | "original-only";
}

// ---------------------------------------------------------------------------
// The mixer
// ---------------------------------------------------------------------------

/** Options for {@link createTranslatedAudioOutputMixer}. */
export interface TranslatedAudioOutputMixerOptions {
  /** The clock (arrival stamps + elapsed-time drift measurement). */
  readonly nowMs: () => number;
  /**
   * The buffer bound (ms of translated audio ahead of the playhead). A
   * chunk that would push the buffer beyond the bound is dropped and
   * counted. Default: 12_000.
   */
  readonly bufferBoundMs?: number;
  /**
   * The drift tolerance (ms): the translated stream may render at most
   * this far BEHIND the playhead (late) before a correction fires (the
   * stale-drop law). Default: 2_500.
   */
  readonly driftToleranceMs?: number;
  /**
   * The duck gain applied to the original while translated speech plays.
   * Default: 0.25 (the original stays faintly present — the mode law:
   * available, not erased).
   */
  readonly duckGain?: number;
  /**
   * The lookback window for due-chunk selection (ms): a chunk is due when
   * its position is within [playhead - lookback, playhead + step]. Default:
   * 400 — a chunk slightly behind the playhead still plays (the provider
   * paced it late but it remains intelligible).
   */
  readonly dueLookbackMs?: number;
}

/** The mixer's honest accounting (the instrument's evidence). */
export interface TranslatedAudioMixerReport {
  readonly mode: TranslatedAudioOutputMode;
  /** Chunks accepted into the buffer. */
  readonly acceptedChunks: number;
  /** Chunks PLAYED (handed to the output sink). */
  readonly playedChunks: number;
  /** Chunks dropped by the buffer bound (the honest overflow count). */
  readonly droppedByBufferBound: number;
  /** Chunks dropped by drift correction (the stale-drop law). */
  readonly droppedByDrift: number;
  /** The continuity gaps observed in translated-speech mode (count + total ms). */
  readonly continuityGaps: { readonly count: number; readonly totalMs: number };
  /** The last measured drift (translated rendered − playhead; null before any). */
  readonly lastDriftMs: number | null;
  /** The drift corrections applied (count + the last magnitude). */
  readonly driftCorrections: { readonly count: number; readonly lastMagnitudeMs: number | null };
  /** The mode switches observed (never a restart — instant + lossless). */
  readonly modeSwitches: number;
  /** The chunks currently buffered (the live jitter buffer depth). */
  readonly bufferedChunks: number;
}

/** The translated-audio output mixer. */
export interface TranslatedAudioOutputMixer {
  /** Offer one translated chunk (the session's translated-audio-chunk event). */
  offer(chunk: TranslatedAudioChunkInput): void;

  /** Switch the output mode (instant; the original path never restarts). */
  setMode(mode: TranslatedAudioOutputMode): void;

  /**
   * One playback step: the mix decision for the current playhead. Pure
   * consumption — the decision is a function of (playhead, buffer, mode).
   */
  step(playheadMs: number): OutputMixDecision;

  /** The honest accounting. */
  report(): TranslatedAudioMixerReport;
}

/**
 * Create the translated-audio output mixer — the bounded jitter buffer +
 * the mode-aware mix decisions + the measured-never-rewritten drift law.
 */
export function createTranslatedAudioOutputMixer(
  options: TranslatedAudioOutputMixerOptions,
): TranslatedAudioOutputMixer {
  const bufferBoundMs = options.bufferBoundMs ?? 12_000;
  const driftToleranceMs = options.driftToleranceMs ?? 2_500;
  const duckGain = options.duckGain ?? 0.25;
  const dueLookbackMs = options.dueLookbackMs ?? 400;

  let mode: TranslatedAudioOutputMode = "original-audio"; // the conservative default: nothing changes until the user opts in
  let buffered: TranslatedAudioChunkInput[] = [];
  let acceptedChunks = 0;
  let playedChunks = 0;
  let droppedByBufferBound = 0;
  let droppedByDrift = 0;
  let continuityGapCount = 0;
  let continuityGapTotalMs = 0;
  let gapStartedAtMs: number | null = null;
  let lastDriftMs: number | null = null;
  let driftCorrectionCount = 0;
  let driftCorrectionLastMagnitudeMs: number | null = null;
  let modeSwitches = 0;

  return {
    offer(chunk: TranslatedAudioChunkInput): void {
      if (
        typeof chunk?.positionMs !== "number" ||
        !Number.isFinite(chunk.positionMs) ||
        chunk.positionMs < 0 ||
        typeof chunk?.durationMs !== "number" ||
        !Number.isFinite(chunk.durationMs) ||
        chunk.durationMs <= 0 ||
        !(chunk.samples instanceof Uint8Array) ||
        chunk.samples.length === 0
      ) {
        // A malformed chunk never enters the buffer (the honest refusal).
        return;
      }
      acceptedChunks += 1;

      // THE BUFFER BOUND (law 2): the buffer may hold at most bufferBoundMs
      // of translated audio AHEAD of the newest chunk's own position —
      // chunks whose position is behind the buffer's effective tail are
      // dropped oldest-first with the honest count.
      buffered.push(chunk);
      buffered.sort((a, b) => a.positionMs - b.positionMs);
      const tail = buffered.length > 0 ? buffered[buffered.length - 1]!.positionMs : 0;
      while (buffered.length > 0 && tail - buffered[0]!.positionMs > bufferBoundMs) {
        const dropped = buffered.shift()!;
        droppedByBufferBound += 1;
        void dropped;
      }
    },

    setMode(next: TranslatedAudioOutputMode): void {
      if (next === mode) return;
      mode = next;
      modeSwitches += 1;
      // The instant, lossless switch: the original path never restarted —
      // only the mix gains change. The translated buffer is preserved (a
      // switch back resumes the buffered stream, never a re-fetch).
    },

    step(playheadMs: number): OutputMixDecision {
      if (typeof playheadMs !== "number" || !Number.isFinite(playheadMs)) {
        // A garbage playhead answers the honest original-only decision.
        return {
          playheadMs: 0,
          mode,
          originalGain: mode === "translated-speech" ? duckGain : 1,
          translatedChunk: null,
          continuity: "original-only",
        };
      }

      // THE DRIFT LAW (law 3): drift = the translated stream's rendered
      // position (the newest chunk's end) minus the playhead. When the
      // translated stream is LATE beyond tolerance, the stale chunks are
      // dropped (the translated stream conforms to the source) and the
      // correction is recorded with its magnitude — the source timeline
      // is never touched.
      const newest = buffered.length > 0 ? buffered[buffered.length - 1]! : null;
      if (newest !== null) {
        const renderedEndMs = newest.positionMs + newest.durationMs;
        lastDriftMs = renderedEndMs - playheadMs;
        if (playheadMs - renderedEndMs > driftToleranceMs) {
          // The whole buffer is stale: drop it (the honest correction).
          const magnitudeMs = playheadMs - renderedEndMs;
          droppedByDrift += buffered.length;
          buffered = [];
          driftCorrectionCount += 1;
          driftCorrectionLastMagnitudeMs = magnitudeMs;
        }
      }

      if (mode === "original-audio") {
        // The original-audio mode: the translated stream is muted; the
        // original plays at full level. (A running gap closes silently —
        // the translated stream was opted out, not interrupted.)
        if (gapStartedAtMs !== null) {
          gapStartedAtMs = null;
        }
        return {
          playheadMs,
          mode,
          originalGain: 1,
          translatedChunk: null,
          continuity: "original-only",
        };
      }

      // The translated-speech mode: find the due chunk (within the
      // lookback window through the playhead).
      const dueIndex = buffered.findIndex(
        (chunk) => chunk.positionMs <= playheadMs + 1 && chunk.positionMs >= playheadMs - dueLookbackMs,
      );
      if (dueIndex >= 0) {
        const due = buffered.splice(dueIndex, 1)[0]!;
        playedChunks += 1;
        if (gapStartedAtMs !== null) {
          // A gap ENDS with the first translated chunk that plays again.
          continuityGapTotalMs += Math.max(0, options.nowMs() - gapStartedAtMs);
          continuityGapCount += 1;
          gapStartedAtMs = null;
        }
        return {
          playheadMs,
          mode,
          originalGain: duckGain,
          translatedChunk: due,
          continuity: "translated",
        };
      }

      // No due chunk: the fallback law — the ORIGINAL carries the moment
      // (never silence), and the gap accounting is honest about it.
      if (gapStartedAtMs === null) {
        gapStartedAtMs = options.nowMs();
      }
      return {
        playheadMs,
        mode,
        originalGain: 1, // the duck releases for the carried moment
        translatedChunk: null,
        continuity: "original-carries",
      };
    },

    report(): TranslatedAudioMixerReport {
      return {
        mode,
        acceptedChunks,
        playedChunks,
        droppedByBufferBound,
        droppedByDrift,
        continuityGaps: { count: continuityGapCount, totalMs: continuityGapTotalMs },
        lastDriftMs,
        driftCorrections: { count: driftCorrectionCount, lastMagnitudeMs: driftCorrectionLastMagnitudeMs },
        modeSwitches,
        bufferedChunks: buffered.length,
      };
    },
  };
}
