/**
 * @wfx/app-desktop — the adaptive visual frame sampler (R25-W3, the plan's
 * R25-F "Visual context").
 *
 * THE LAW THIS SAMPLER KEEPS (docs/plans/2026-09-20-webflix-qwen-livetranslate-
 * plan.md R25-F): "WebFlix should not send every video frame." The sampler
 * decides WHICH frames are informative, through the plan's four triggers:
 *
 * - scene-change trigger      — a significant visual change between frames;
 * - OCR/on-screen-text trigger— on-screen text appeared or changed;
 * - speaker/shot change trigger — the active speaker or shot changed;
 * - low-rate periodic fallback — nothing fired for a while, so one frame
 *   rides anyway (the floor that keeps visual context alive).
 *
 * THE SAMPLER BELONGS TO THE MEDIA ADAPTER, NOT THE PROVIDER (the plan's
 * law, verbatim): this module is the desktop media adapter's own decision
 * logic. It consumes SIGNALS (what the adapter/platform observed about the
 * frames) and emits DECISIONS (emit/don't-emit + the honest trigger). It
 * never captures pixels itself — the platform's frame observation feeds
 * it, and it never invents a signal it was not given.
 *
 * THE NEVER-FORCED LAW (the plan's rejection criterion "forcing
 * visual-frame upload when audio alone is sufficient"): under the
 * `audio-only` policy the sampler NEVER emits — a frame rides only when
 * the policy says the visual stream exists AND a trigger honestly fired.
 * Under `disabled` the sampler is inert by declaration. The accounting
 * (`samplerReport()`) is the evidence: every emitted frame names its
 * trigger, and the suppressed ones are counted by reason.
 *
 * PURITY: `considerFrame` is a pure function over its input (no clocks, no
 * state mutation — the driver below holds the state). The periodic
 * fallback consults the injected clock ONLY in the stateful driver.
 */

import type {
  RealtimeImageFrameInput,
  RealtimeVisualContextPolicy,
} from "./realtime-translation-port";

// ---------------------------------------------------------------------------
// The signal vocabulary (what the adapter observed about a frame)
// ---------------------------------------------------------------------------

/**
 * One frame's observation signals — what the platform/adapter truthfully
 * knows about it. Every signal is OPTIONAL: a source that cannot measure
 * scene difference honestly reports `null`, and the sampler decides on
 * what it actually knows (never a guessed signal).
 */
export interface VisualFrameSignals {
  /** The frame's playback position on the source timeline (ms). */
  readonly positionMs: number;
  /**
   * The measured visual difference vs the last CONSIDERED frame, 0..1
   * (the platform's honest scene-difference metric; null when not
   * measured).
   */
  readonly sceneDifference: number | null;
  /**
   * On-screen text truth: the text detected in this frame ("" when none
   * detected, null when OCR is not available on this source).
   */
  readonly onScreenText: string | null;
  /**
   * The shot/speaker index the platform attributes this frame to (null
   * when not attributed — the sampler then cannot use this trigger).
   */
  readonly shotOrSpeakerIndex: number | null;
  /** The encoded frame bytes (present iff the platform produced a frame). */
  readonly bytes: Uint8Array | null;
  /** The encoded frame's media type (present iff bytes are present). */
  readonly mediaType: "image/jpeg" | "image/png" | null;
}

// ---------------------------------------------------------------------------
// The sampler configuration (the thresholds are the adapter's policy)
// ---------------------------------------------------------------------------

/** Options for {@link createAdaptiveVisualSampler}. */
export interface AdaptiveVisualSamplerOptions {
  /** The visual-context policy (audio-only NEVER emits; disabled is inert). */
  readonly policy: RealtimeVisualContextPolicy;
  /**
   * The scene-change threshold (0..1): a sceneDifference at or above it
   * fires the scene-change trigger. Default: 0.35.
   */
  readonly sceneChangeThreshold?: number;
  /**
   * The minimum gap between emitted frames (ms) — the burst guard: even a
   * hard scene cut does not push more than one frame per gap. Default:
   * 1200.
   */
  readonly minFrameGapMs?: number;
  /**
   * The periodic fallback interval (ms): when no trigger fires for this
   * long, ONE frame rides (the plan's low-rate fallback). Default: 30_000.
   */
  readonly periodicFallbackMs?: number;
  /** The clock (the fallback's elapsed-time truth). Default: none — REQUIRED. */
  readonly nowMs: () => number;
}

/** Why the sampler emitted one frame (the plan's four triggers, closed). */
export type VisualSampleTrigger = RealtimeImageFrameInput["trigger"];

/** Why the sampler suppressed one frame (the honest accounting vocabulary). */
export type VisualSampleSuppressedReason =
  | "policy-audio-only"
  | "policy-disabled"
  | "no-frame"
  | "burst-guard"
  | "no-trigger";

/** One sampler decision — the honest emit/suppress + its reason. */
export type VisualSampleDecision =
  | {
      readonly emit: true;
      readonly trigger: VisualSampleTrigger;
      /** The frame input the adapter should append to the session. */
      readonly frame: RealtimeImageFrameInput;
    }
  | {
      readonly emit: false;
      readonly reason: VisualSampleSuppressedReason;
    };

// ---------------------------------------------------------------------------
// The pure decision (the plan's four triggers)
// ---------------------------------------------------------------------------

/** The internal trigger evaluation (pure; exported for tests). */
export function evaluateFrameTriggers(
  signals: VisualFrameSignals,
  context: {
    readonly policy: RealtimeVisualContextPolicy;
    readonly sceneChangeThreshold: number;
    readonly lastEmittedAtMs: number | null;
    readonly lastEmittedPositionMs: number | null;
    readonly minFrameGapMs: number;
    readonly periodicFallbackMs: number;
    readonly lastConsideredOnScreenText: string | null;
    readonly lastConsideredShotIndex: number | null;
    /**
     * The effective last-fallback time: the real one, or the sampler's
     * creation anchor (the fallback cadence starts at creation).
     */
    readonly effectiveLastFallbackMs: number;
    /** An out-of-band speaker change is pending (the session's event). */
    readonly speakerChangePending: boolean;
    readonly nowMs: number;
  },
): { readonly trigger: VisualSampleTrigger } | { readonly suppressedReason: VisualSampleSuppressedReason } {
  // The policy gates first — the never-forced law.
  if (context.policy !== "adaptive") {
    return { suppressedReason: "no-trigger" };
  }
  if (signals.bytes === null || signals.mediaType === null) {
    return { suppressedReason: "no-frame" };
  }
  // The burst guard: a frame rides only when it is FAR ENOUGH from the
  // last emitted one — on the MEDIA TIMELINE or in wall-clock time
  // (either may carry the truth: a paused-but-live clock with an
  // advancing timeline, or a live input whose positions barely move).
  const lastGap =
    context.lastEmittedAtMs !== null ? context.nowMs - context.lastEmittedAtMs : Number.POSITIVE_INFINITY;
  const lastPositionGap =
    context.lastEmittedPositionMs !== null
      ? signals.positionMs - context.lastEmittedPositionMs
      : Number.POSITIVE_INFINITY;
  const withinBurstGuard = !(lastGap >= context.minFrameGapMs || lastPositionGap >= context.minFrameGapMs);

  // TRIGGER 1 — scene change: the measured difference crossed the threshold.
  if (
    signals.sceneDifference !== null &&
    signals.sceneDifference >= context.sceneChangeThreshold
  ) {
    if (withinBurstGuard) return { suppressedReason: "burst-guard" };
    return { trigger: "scene-change" };
  }
  // TRIGGER 2 — on-screen text: detected text that is NEW or CHANGED (a
  // null OCR truth honestly cannot fire this).
  if (
    signals.onScreenText !== null &&
    signals.onScreenText.length > 0 &&
    signals.onScreenText !== context.lastConsideredOnScreenText
  ) {
    if (withinBurstGuard) return { suppressedReason: "burst-guard" };
    return { trigger: "on-screen-text" };
  }
  // TRIGGER 3 — speaker/shot change: the attributed index changed (a
  // null index honestly cannot fire this).
  if (
    signals.shotOrSpeakerIndex !== null &&
    context.lastConsideredShotIndex !== null &&
    signals.shotOrSpeakerIndex !== context.lastConsideredShotIndex
  ) {
    if (withinBurstGuard) return { suppressedReason: "burst-guard" };
    return { trigger: "speaker-change" };
  }
  // TRIGGER 3b — an out-of-band speaker change (the session's own
  // speaker-attribution event): the next frame rides it.
  if (context.speakerChangePending) {
    if (withinBurstGuard) return { suppressedReason: "burst-guard" };
    return { trigger: "speaker-change" };
  }
  // TRIGGER 4 — the low-rate periodic fallback: nothing fired for the
  // interval since the last fallback (or the sampler's creation).
  if (
    context.nowMs - context.effectiveLastFallbackMs >= context.periodicFallbackMs &&
    !withinBurstGuard
  ) {
    return { trigger: "periodic-fallback" };
  }
  return { suppressedReason: "no-trigger" };
}

// ---------------------------------------------------------------------------
// The stateful sampler driver
// ---------------------------------------------------------------------------

/** The honest sampler accounting (the instrument's evidence). */
export interface VisualSamplerReport {
  readonly policy: RealtimeVisualContextPolicy;
  /** Frames CONSIDERED (the adapter offered them). */
  readonly consideredFrames: number;
  /** Frames EMITTED, by trigger. */
  readonly emittedByTrigger: Readonly<Record<VisualSampleTrigger, number>>;
  /** Frames suppressed, by reason. */
  readonly suppressedByReason: Readonly<Record<VisualSampleSuppressedReason, number>>;
}

/** The adaptive visual sampler the desktop media adapter owns. */
export interface AdaptiveVisualSampler {
  /** Consider one observed frame; answer the emit/suppress decision. */
  considerFrame(signals: VisualFrameSignals): VisualSampleDecision;
  /**
   * A speaker-change notification OUTSIDE a frame observation (the
   * session's speaker-attribution event, or the platform's shot change):
   * the NEXT considered frame rides the speaker-change trigger.
   */
  notifySpeakerChanged(): void;
  /** The honest accounting (never a fabricated count). */
  samplerReport(): VisualSamplerReport;
}

/**
 * Create the adaptive visual sampler. The pure trigger evaluation +
 * stateful gap/fallback accounting — no pixel capture, no provider
 * knowledge, no forced frames.
 */
export function createAdaptiveVisualSampler(
  options: AdaptiveVisualSamplerOptions,
): AdaptiveVisualSampler {
  const policy = options.policy;
  const sceneChangeThreshold = options.sceneChangeThreshold ?? 0.35;
  const minFrameGapMs = options.minFrameGapMs ?? 1_200;
  const periodicFallbackMs = options.periodicFallbackMs ?? 30_000;
  const nowMs = options.nowMs;

  let consideredFrames = 0;
  const emittedByTrigger: Record<VisualSampleTrigger, number> = {
    "scene-change": 0,
    "on-screen-text": 0,
    "speaker-change": 0,
    "periodic-fallback": 0,
  };
  const suppressedByReason: Record<VisualSampleSuppressedReason, number> = {
    "policy-audio-only": 0,
    "policy-disabled": 0,
    "no-frame": 0,
    "burst-guard": 0,
    "no-trigger": 0,
  };
  let lastEmittedAtMs: number | null = null;
  let lastEmittedPositionMs: number | null = null;
  let lastConsideredOnScreenText: string | null = null;
  let lastConsideredShotIndex: number | null = null;
  let lastFallbackAtMs: number | null = null;
  let speakerChangePending = false;
  /** The fallback cadence's anchor: the sampler's creation time. */
  const createdAtMs = nowMs();

  return {
    considerFrame(signals: VisualFrameSignals): VisualSampleDecision {
      consideredFrames += 1;

      // The policy gates FIRST — the never-forced law.
      if (policy === "audio-only") {
        suppressedByReason["policy-audio-only"] += 1;
        return { emit: false, reason: "policy-audio-only" };
      }
      if (policy === "disabled") {
        suppressedByReason["policy-disabled"] += 1;
        return { emit: false, reason: "policy-disabled" };
      }
      if (signals.bytes === null || signals.mediaType === null) {
        suppressedByReason["no-frame"] += 1;
        return { emit: false, reason: "no-frame" };
      }

      const evaluation = evaluateFrameTriggers(signals, {
        policy,
        sceneChangeThreshold,
        lastEmittedAtMs,
        lastEmittedPositionMs,
        minFrameGapMs,
        periodicFallbackMs,
        lastConsideredOnScreenText,
        lastConsideredShotIndex,
        effectiveLastFallbackMs: lastFallbackAtMs ?? createdAtMs,
        speakerChangePending,
        nowMs: nowMs(),
      });
      if ("suppressedReason" in evaluation) {
        suppressedByReason[evaluation.suppressedReason] += 1;
        // The consideration truth still advances (the signals were seen).
        lastConsideredOnScreenText = signals.onScreenText;
        lastConsideredShotIndex = signals.shotOrSpeakerIndex;
        return { emit: false, reason: evaluation.suppressedReason };
      }

      const trigger: VisualSampleTrigger = evaluation.trigger;
      speakerChangePending = false;

      // The accounting of what was considered.
      lastConsideredOnScreenText = signals.onScreenText;
      lastConsideredShotIndex = signals.shotOrSpeakerIndex;
      lastEmittedAtMs = nowMs();
      lastEmittedPositionMs = signals.positionMs;
      if (trigger === "periodic-fallback") lastFallbackAtMs = nowMs();

      emittedByTrigger[trigger] += 1;
      return {
        emit: true,
        trigger,
        frame: {
          positionMs: signals.positionMs,
          bytes: signals.bytes,
          mediaType: signals.mediaType,
          trigger,
        },
      };
    },

    notifySpeakerChanged(): void {
      speakerChangePending = true;
    },

    samplerReport(): VisualSamplerReport {
      return {
        policy,
        consideredFrames,
        emittedByTrigger: { ...emittedByTrigger },
        suppressedByReason: { ...suppressedByReason },
      };
    },
  };
}

/** The zero-report (the never-sampled truth). */
export function emptyVisualSamplerReport(
  policy: RealtimeVisualContextPolicy,
): VisualSamplerReport {
  return {
    policy,
    consideredFrames: 0,
    emittedByTrigger: {
      "scene-change": 0,
      "on-screen-text": 0,
      "speaker-change": 0,
      "periodic-fallback": 0,
    },
    suppressedByReason: {
      "policy-audio-only": 0,
      "policy-disabled": 0,
      "no-frame": 0,
      "burst-guard": 0,
      "no-trigger": 0,
    },
  };
}
