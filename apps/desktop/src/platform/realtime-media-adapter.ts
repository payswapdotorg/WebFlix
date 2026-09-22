/**
 * @wfx/app-desktop — the realtime media adapter (R25-W3, the plan's R25-E
 * "Media-source integration" — the desktop lane's capture integration).
 *
 * THE LAW THIS ADAPTER KEEPS (docs/plans/2026-09-20-webflix-qwen-livetranslate-
 * plan.md R25-E): "The model should consume audio/frames only when WebFlix
 * has lawful and technical access."
 *
 * THE CAPTURE CAPABILITY RESOLUTION (the honest per-rung truth, the R24
 * affordance grammar's discipline):
 *
 * - FULL-FIDELITY PATHS (the plan's list, verbatim): the WebFlix-owned
 *   media pipeline (`authorized-local`), authorized torrent/peer playback
 *   (`authorized-torrent`), and WebFlix-controlled live input
 *   (`controlled-live`) answer `authorized` — the capture tap can open
 *   through the native-media service.
 * - RESTRICTED PATHS: provider iframe/embed surfaces answer the honest
 *   `unavailable-restricted` truth — with the plan's alternatives named
 *   (prefer provider-provided captions/transcripts; translate
 *   user-provided text/subtitles where permitted) and the hard law
 *   restated: never bypass DRM, cross-origin isolation, access controls
 *   or source restrictions. There is NO code path from a restricted
 *   surface into a session — the adapter refuses to even mint the input.
 * - `unavailable-no-provider` — the honest truth when no realtime
 *   provider is bound through Model Fabric yet (base playback continues;
 *   the Translate control reports the truth).
 *
 * WHAT THE ADAPTER IS: the bridge between the native playback paths and
 * the shared RealtimeTranslationSession's append-audio/append-image-frame
 * seams. It resolves the capture capability for one playback realization,
 * opens the native audio tap, feeds the session's appendAudio with the
 * captured frames (the source's own timeline as the alignment key), and
 * runs the ADAPTIVE VISUAL SAMPLER (the plan's R25-F law: "the frame
 * sampler belongs to the media adapter, not the Qwen provider").
 *
 * WHAT THE ADAPTER IS NOT: a provider client (the session comes from the
 * factory seam — Model Fabric's realtime task in production, never a
 * desktop-side API call), a mixer (the translated-audio output module owns
 * that), or a recovery driver (the recovery supervisor owns that).
 */

import type { PlaybackRealization } from "@wfx/domain";
import type {
  NativeAudioCaptureService,
  NativeAudioTapNotification,
  StampedAudioTapFrame,
} from "@wfx/native-media";

import {
  createAdaptiveVisualSampler,
  type AdaptiveVisualSampler,
  type VisualFrameSignals,
} from "./adaptive-visual-sampler";
import {
  isUnavailableRealtimeSessionFactory,
  type RealtimeCapturePath,
  type RealtimeTranslationSession,
  type RealtimeTranslationSessionInput,
  type RealtimeTranslationSessionFactory,
  type RealtimeVisualContextPolicy,
} from "./realtime-translation-port";

// ---------------------------------------------------------------------------
// The capture capability (the honest per-rung truth)
// ---------------------------------------------------------------------------

/** The closed capture-capability vocabulary (the R25-E truth). */
export type RealtimeCaptureCapability =
  | {
      readonly kind: "authorized";
      /** Which full-fidelity path feeds the session. */
      readonly capturePath: RealtimeCapturePath;
      /** The native playback session (null for a live input). */
      readonly nativeSessionId: string | null;
      /** The live input's id (null unless the path is controlled-live). */
      readonly liveInputId: string | null;
      /** The honest sentence the capability surface reports. */
      readonly detail: string;
    }
  | {
      readonly kind: "unavailable-restricted";
      /** The honest sentence — the plan's alternatives, never a bypass. */
      readonly detail: string;
    }
  | {
      readonly kind: "unavailable-no-provider";
      readonly detail: string;
    };

/**
 * Resolve the capture capability for one playback realization — THE
 * AUTHORIZED-MEDIA LAW as a pure function of the realization truth.
 *
 * The native rung is the full-fidelity path (the engine serves the bytes —
 * local files, torrent copies; the live input registers explicitly). The
 * embed rung is the restricted surface. The browser rung plays
 * WebFlix-owned streams through the owned element — authorized where the
 * platform owns the decode (the desktop's owned-element capture rides the
 * same tap seam). The external rung hands playback to another app — no
 * WebFlix pipeline to capture, honestly unavailable.
 */
export function resolveRealtimeCaptureCapability(input: {
  readonly realization: PlaybackRealization;
  /** The native playback session id when the realization is engaged natively. */
  readonly nativeSessionId: string | null;
  /** The registered live-input id when the realization is a controlled live stream. */
  readonly liveInputId: string | null;
  /** Whether a realtime provider is bound through the session factory. */
  readonly realtimeProviderBound: boolean;
  /**
   * The connector ids whose native realizations are authorized torrent/peer
   * copies (default: `["authorized-peer-copy"]` — the torrent playback
   * binding's own connector id).
   */
  readonly torrentConnectorIds?: readonly string[];
}): RealtimeCaptureCapability {
  const mode = input.realization.mode;
  if (mode === "native" || mode === "browser") {
    if (!input.realtimeProviderBound) {
      return {
        kind: "unavailable-no-provider",
        detail:
          "realtime translation is not available yet — no realtime translation provider is bound through Model Fabric; playback itself is unaffected",
      };
    }
    const isTorrent = (input.torrentConnectorIds ?? ["authorized-peer-copy"]).includes(
      input.realization.connectorId,
    );
    if (input.nativeSessionId !== null) {
      const capturePath: RealtimeCapturePath = input.liveInputId !== null
        ? "controlled-live"
        : isTorrent
          ? "authorized-torrent"
          : "authorized-local";
      return {
        kind: "authorized",
        capturePath,
        nativeSessionId: input.nativeSessionId,
        liveInputId: input.liveInputId,
        detail:
          isTorrent
            ? "the authorized capture path — the authorized torrent/peer copy plays through WebFlix's own native pipeline, so the decoded audio can feed the realtime translation session"
            : "the authorized capture path — WebFlix's own playback pipeline serves this way of watching, so the decoded audio can feed the realtime translation session",
      };
    }
    if (input.liveInputId !== null) {
      return {
        kind: "authorized",
        capturePath: "controlled-live",
        nativeSessionId: null,
        liveInputId: input.liveInputId,
        detail:
          "the controlled live input — a WebFlix-controlled stream whose decoded audio can feed the realtime translation session",
      };
    }
    return {
      kind: "unavailable-restricted",
      detail:
        "this way of watching has no engaged native playback session to capture from — the honest unavailable truth; playback itself is unaffected",
    };
  }
  // The embed rung (the provider's contained surface) and the external
  // rung (another app's player): the restricted-surface law.
  return {
    kind: "unavailable-restricted",
    detail:
      "this way of watching plays inside the provider's own player — WebFlix will not bypass DRM, cross-origin isolation or access controls to capture its audio. Prefer the provider's own captions/transcripts where available, or translate a subtitle/text file you provide; the honest unavailable truth is this message, never a capture.",
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopRealtimeMediaAdapter}. */
export interface DesktopRealtimeMediaAdapterOptions {
  /** The native audio capture service (the native-media tap). */
  readonly captureService: NativeAudioCaptureService;
  /** The realtime translation session factory (the Model Fabric seam). */
  readonly sessionFactory: RealtimeTranslationSessionFactory;
  /** The clock (the adapter's observation stamps). */
  readonly nowMs: () => number;
  /**
   * The frame observation seam — the platform's per-frame signals for the
   * visual sampler (scene difference, OCR text, shot index, bytes). The
   * adapter consumes signals; it never captures pixels itself. Null
   * signals are honest (the sampler decides on what it knows).
   */
  readonly frameSignalsOf: (positionMs: number) => VisualFrameSignals;
  /** The capture format requested for taps (default: 48kHz stereo s16le). */
  readonly captureFormat?: {
    readonly sampleRateHz: number;
    readonly channels: number;
    readonly encoding: "pcm-s16le" | "pcm-f32le";
  };
}

/** One started realtime capture feed (the adapter's handle). */
export interface RealtimeCaptureFeed {
  /** The session the feed appends into. */
  readonly session: RealtimeTranslationSession;
  /** The sampler's honest accounting (live). */
  readonly samplerReport: () => ReturnType<AdaptiveVisualSampler["samplerReport"]>;
  /** The captured-frames accounting (live). */
  readonly captureStats: () => { readonly appendedAudioFrames: number; readonly appendedImageFrames: number };
  /**
   * An out-of-band speaker change (the session's speaker-attribution
   * event): primes the sampler's NEXT frame with the speaker-change
   * trigger (R25-F trigger 3b — the sampler belongs to this adapter).
   */
  notifySpeakerChanged(): void;
  /** Stop the feed (unsubscribes the tap; the session stays open — the composition owns close). */
  stop(): void;
}

/** The typed start failure (closed vocabulary). */
export type RealtimeFeedStartFailure =
  | { readonly kind: "capture-unauthorized"; readonly detail: string }
  | { readonly kind: "capture-refused"; readonly detail: string }
  | { readonly kind: "session-creation-failed"; readonly detail: string };

/** The desktop realtime media adapter. */
export interface DesktopRealtimeMediaAdapter {
  /** The honest per-rung capture capability (the authorized-media law). */
  captureCapability(input: {
    readonly realization: PlaybackRealization;
    readonly nativeSessionId: string | null;
    readonly liveInputId: string | null;
  }): RealtimeCaptureCapability;

  /**
   * Start one capture feed: resolve the capability, create the session
   * through the factory, open the native audio tap, and wire the frames
   * into the session's append seams. The visual sampler runs per the
   * policy. BASE PLAYBACK IS NEVER TOUCHED — the adapter only observes.
   */
  startFeed(input: {
    readonly realization: PlaybackRealization;
    readonly nativeSessionId: string | null;
    readonly liveInputId: string | null;
    readonly sourceMediaId: string | null;
    readonly targetLanguage: string;
    readonly sourceLanguageHint: string | null;
    readonly outputModalities: "text" | "text+audio";
    readonly subtitleMode: "source" | "translated" | "bilingual";
    readonly speakerAttribution: "labeled" | "off";
    readonly visualContextPolicy: RealtimeVisualContextPolicy;
    readonly hotwords?: readonly { readonly term: string; readonly translation: string }[] | undefined;
    readonly translatedVoice?: RealtimeTranslationSessionInput["translatedVoice"] | undefined;
    /**
     * The pre-start hook: invoked with the created session AFTER the tap
     * opens and BEFORE session.start() — the composition subscribes its
     * event projection here so the session-created ack is never missed.
     */
    readonly onSession?: ((session: RealtimeTranslationSession) => void) | undefined;
  }): Promise<RealtimeCaptureFeed | RealtimeFeedStartFailure>;
}

/**
 * Create the desktop realtime media adapter — the R25-E capture
 * integration over the native-media capture service and the shared
 * session factory seam.
 */
export function createDesktopRealtimeMediaAdapter(
  options: DesktopRealtimeMediaAdapterOptions,
): DesktopRealtimeMediaAdapter {
  const captureFormat = options.captureFormat ?? {
    sampleRateHz: 48_000,
    channels: 2,
    encoding: "pcm-s16le" as const,
  };

  return {
    captureCapability(input): RealtimeCaptureCapability {
      return resolveRealtimeCaptureCapability({
        realization: input.realization,
        nativeSessionId: input.nativeSessionId,
        liveInputId: input.liveInputId,
        realtimeProviderBound: isProviderBound(options.sessionFactory),
      });
    },

    async startFeed(input) {
      const capability = resolveRealtimeCaptureCapability({
        realization: input.realization,
        nativeSessionId: input.nativeSessionId,
        liveInputId: input.liveInputId,
        realtimeProviderBound: isProviderBound(options.sessionFactory),
      });
      if (capability.kind !== "authorized") {
        return {
          kind: "capture-unauthorized",
          detail: capability.detail,
        };
      }

      // The session input — the plan's R25-A input list.
      const sessionInput: RealtimeTranslationSessionInput = {
        sourceMediaId: input.sourceMediaId,
        sourceAudio: {
          capturePath: capability.capturePath,
          sourceId: capability.nativeSessionId ?? capability.liveInputId ?? "",
          sourceMediaId: input.sourceMediaId,
          format: captureFormat,
        },
        imageFrames: input.visualContextPolicy === "audio-only" ? null : { policy: input.visualContextPolicy },
        sourceLanguageHint: input.sourceLanguageHint,
        targetLanguage: input.targetLanguage,
        outputModalities: input.outputModalities,
        subtitleMode: input.subtitleMode,
        speakerAttribution: input.speakerAttribution,
        hotwords: input.hotwords ?? [],
        translatedVoice:
          input.translatedVoice ?? { mode: "neutral", consent: null },
      };
      const created = await options.sessionFactory.createSession(sessionInput);
      if ("kind" in created) {
        return {
          kind: "session-creation-failed",
          detail: `${created.kind}: ${created.detail}`,
        };
      }
      const session = created;

      // The visual sampler (R25-F — the sampler belongs to THIS adapter).
      const sampler = createAdaptiveVisualSampler({
        policy: input.visualContextPolicy,
        nowMs: options.nowMs,
      });

      let appendedAudioFrames = 0;
      let appendedImageFrames = 0;
      let stopped = false;

      // The audio tap: the captured frames flow into appendAudio, the
      // source's own timeline as the alignment key. The sampler rides the
      // SAME position stream (the visual context stays aligned with the
      // audio — the plan's synchronized source + translation output).
      const consumer = (notification: NativeAudioTapNotification): void => {
        if (stopped) return;
        if (notification.kind !== "frame") return;
        const frame: StampedAudioTapFrame = notification.frame;
        session.appendAudio({
          positionMs: frame.positionMs,
          samples: frame.samples,
        });
        appendedAudioFrames += 1;

        // The sampler considers the frame's POSITION (the platform's
        // per-position signals) and emits only when a trigger fires.
        const signals = options.frameSignalsOf(frame.positionMs);
        const decision = sampler.considerFrame(signals);
        if (decision.emit) {
          session.appendImageFrame(decision.frame);
          appendedImageFrames += 1;
        }
      };

      const tapInput = {
        sourceId: capability.nativeSessionId ?? capability.liveInputId ?? "",
        sourceKind:
          capability.capturePath === "controlled-live"
            ? ("live-input" as const)
            : capability.capturePath === "authorized-torrent"
              ? ("torrent-session" as const)
              : ("local-session" as const),
        format: captureFormat,
      };
      const subscription = await options.captureService.subscribe(tapInput, consumer);
      if ("kind" in subscription) {
        // The tap refused: close the session honestly and report — the
        // session never runs without its audio source.
        await session.close().catch(() => undefined);
        return {
          kind: "capture-refused",
          detail: `${subscription.kind}: ${subscription.detail}`,
        };
      }
      // The pre-start hook: the composition subscribes BEFORE the session
      // starts (the session-created ack must never be missed).
      input.onSession?.(session);
      const started = await session.start().catch(
        (thrown: unknown): Error =>
          thrown instanceof Error ? thrown : new Error(String(thrown)),
      );
      if (started instanceof Error) {
        subscription.unsubscribe();
        await session.close().catch(() => undefined);
        return {
          kind: "session-creation-failed",
          detail: `session.start failed: ${started.message}`,
        };
      }
      // The pre-start hook fired before start() — the composition's
      // projection saw the session-created ack.

      return {
        session,
        samplerReport: (): ReturnType<AdaptiveVisualSampler["samplerReport"]> => sampler.samplerReport(),
        captureStats: (): { readonly appendedAudioFrames: number; readonly appendedImageFrames: number } => ({
          appendedAudioFrames,
          appendedImageFrames,
        }),
        notifySpeakerChanged: (): void => {
          sampler.notifySpeakerChanged();
        },
        stop(): void {
          if (stopped) return;
          stopped = true;
          subscription.unsubscribe();
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The provider-bound truth (the honest default)
// ---------------------------------------------------------------------------

/**
 * Whether the session factory can actually create sessions (the honest
 * unavailable-factory truth — `createUnavailableRealtimeSessionFactory`
 * answers `no-realtime-provider`; a bound provider answers sessions).
 */
export function isProviderBound(factory: RealtimeTranslationSessionFactory): boolean {
  return !isUnavailableRealtimeSessionFactory(factory);
}
