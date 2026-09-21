/**
 * @wfx/app-desktop — the realtime translation session port (R25-W3, the
 * plan's R25-A "Shared realtime session contract" — the DESKTOP-side
 * binding of the seam).
 *
 * ⚠️ CONTRACT STATUS — THE HONEST TRUTH (read before extending): the R25
 * plan assigns the SHARED realtime session contract to Worker 1
 * (`wfx/r25/shared` — the Model Fabric realtime task + the normalized
 * event vocabulary). That branch had NOT landed when this lane was cut
 * (verified: `git ls-remote` shows no `wfx/r25/shared`). This module
 * therefore binds the FROZEN PLAN'S R25-A VOCABULARY VERBATIM — the
 * session inputs, the event kinds, and the operations are copied from
 * docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md §R25-A, never
 * invented — as the desktop composition's port types. When Worker 1's
 * shared contract lands, the desktop composition rebinds to it and THIS
 * MODULE RETIRES (the R24-W3 playback-startup-instrument precedent: the
 * vocabulary reconciles at integration; the escalation is recorded in the
 * lane report). The vocabulary here is deliberately closed and
 * provider-neutral: NO Qwen event names, NO provider JSON, NO credentials
 * — the provider protocol never crosses into desktop code (the frozen
 * product law).
 *
 * WHAT THIS PORT IS: the seam the DESKTOP media adapter composes — the
 * adapter appends captured audio/frames INTO a session and consumes its
 * streaming events OUT. The session IMPLEMENTATION comes from the
 * injectable {@link RealtimeTranslationSessionFactory} (production: the
 * Model Fabric realtime task over the shared session contract — Worker 1 +
 * the lead's provider adapter behind Model Fabric; tests: a deterministic
 * session double). The factory seam is the ONLY place a provider could
 * ever enter, and it enters as Model Fabric's provider-neutral session —
 * never as a desktop-side API call.
 *
 * THE PRODUCT LAWS THIS PORT'S SHAPE ENFORCES STRUCTURALLY:
 * - BASE PLAYBACK NEVER WAITS FOR TRANSLATION: nothing in this port can
 *   gate a playback session — the adapter observes playback, it never
 *   blocks it; `start()` is called AFTER playback is already running.
 * - THE ORIGINAL AUDIO STAYS AVAILABLE: the output modes are a session
 *   INPUT ("text" | "text+audio"), and the desktop mixer owns the
 *   translated-speech/original-audio mode — translation never REPLACES
 *   the source stream.
 * - SESSION OPERATIONS ARE THE PLAN'S SEVEN: start, configure, append
 *   audio, append image frame, stop, reconnect/resume, close.
 */

// ---------------------------------------------------------------------------
// The session inputs (the plan's R25-A input list, verbatim)
// ---------------------------------------------------------------------------

/**
 * Which full-fidelity desktop path feeds the session (R25-E). The closed
 * vocabulary of LAWFUL capture paths — a restricted provider surface is
 * never a member (the honest unavailable truth is the capability
 * resolution's answer, not a session input).
 */
export type RealtimeCapturePath = "authorized-local" | "authorized-torrent" | "controlled-live";

/** The output modalities the session produces (the plan's R25-A). */
export type RealtimeOutputModality = "text" | "text+audio";

/** The subtitle mode the bilingual projection renders (the plan's R25-A). */
export type RealtimeSubtitleMode = "source" | "translated" | "bilingual";

/**
 * The speaker-attribution mode: `labeled` asks the session for speaker
 * attribution (simple, contextual labels — "Speaker 1"/"Speaker 2" — per
 * the plan's R25-G); `off` asks for none.
 */
export type RealtimeSpeakerAttributionMode = "labeled" | "off";

/**
 * The visual-context policy (the plan's R25-F): `audio-only` NEVER sends a
 * frame (audio alone must suffice — frames are never forced);
 * `adaptive` sends frames the SAMPLER decides are informative; `disabled`
 * is the explicit no-visual path even when frames exist.
 */
export type RealtimeVisualContextPolicy = "audio-only" | "adaptive" | "disabled";

/**
 * The translated-voice policy (the plan's R25-H): the default is a
 * NEUTRAL voice — voice preservation is opt-in ONLY when rights/consent
 * requirements are satisfied, and the consent state is recorded. Never a
 * silent clone.
 */
export interface RealtimeTranslatedVoicePolicy {
  readonly mode: "neutral" | "preserve-source";
  /**
   * The consent/rights truth when `preserve-source` is requested: who
   * consented, on what basis, and when. `null` when the mode is neutral.
   */
  readonly consent: { readonly basis: string; readonly recordedAt: string } | null;
}

/** One hotword mapping (the plan's R25-I — domain terminology). */
export interface RealtimeHotwordMapping {
  /** The source-form the audio may contain (e.g. a character name). */
  readonly term: string;
  /** The preferred target-language rendering. */
  readonly translation: string;
}

/** The session's source audio descriptor (what the adapter will append). */
export interface RealtimeSourceAudioDescriptor {
  /** The lawful capture path feeding the session. */
  readonly capturePath: RealtimeCapturePath;
  /** The source's identity (the native playback session id / live input id). */
  readonly sourceId: string;
  /** The source media's canonical identity (when the item is known). */
  readonly sourceMediaId: string | null;
  /** The captured audio's format. */
  readonly format: {
    readonly sampleRateHz: number;
    readonly channels: number;
    readonly encoding: "pcm-s16le" | "pcm-f32le";
  };
}

/** One input frame for the append-image-frame seam (the plan's R25-F). */
export interface RealtimeImageFrameInput {
  /** The frame's playback position on the source timeline (ms). */
  readonly positionMs: number;
  /** The encoded image bytes (the media adapter's sampler produced them). */
  readonly bytes: Uint8Array;
  /** The media type of {@link bytes}. */
  readonly mediaType: "image/jpeg" | "image/png";
  /**
   * WHY the sampler emitted this frame (the honest trigger — never a
   * forced upload; the accounting the instrument reports).
   */
  readonly trigger: "scene-change" | "on-screen-text" | "speaker-change" | "periodic-fallback";
}

/**
 * The realtime translation session input — the plan's R25-A input list
 * verbatim (source media identity; source audio stream; optional
 * image/video-frame stream; optional source-language hint; target
 * language; output modalities; subtitle mode; speaker-attribution mode;
 * visual-context policy; hotword mappings; translated-voice policy).
 */
export interface RealtimeTranslationSessionInput {
  /** The source media identity (canonical item id when known). */
  readonly sourceMediaId: string | null;
  /** The source audio stream descriptor (what appendAudio will carry). */
  readonly sourceAudio: RealtimeSourceAudioDescriptor;
  /** The optional image/video-frame stream (present iff the sampler may emit). */
  readonly imageFrames: { readonly policy: RealtimeVisualContextPolicy } | null;
  /** The optional source-language hint. */
  readonly sourceLanguageHint: string | null;
  /** The target language (a BCP-47 tag, e.g. "en", "de", "ja"). */
  readonly targetLanguage: string;
  /** The output modalities. */
  readonly outputModalities: RealtimeOutputModality;
  /** The subtitle mode. */
  readonly subtitleMode: RealtimeSubtitleMode;
  /** The speaker-attribution mode. */
  readonly speakerAttribution: RealtimeSpeakerAttributionMode;
  /** The hotword mappings (may be empty). */
  readonly hotwords: readonly RealtimeHotwordMapping[];
  /** The translated-voice policy (neutral by default — never a silent clone). */
  readonly translatedVoice: RealtimeTranslatedVoicePolicy;
}

// ---------------------------------------------------------------------------
// The session events (the plan's R25-A event list, verbatim)
// ---------------------------------------------------------------------------

/** One source transcript delta (incremental ASR text, source language). */
export interface SourceTranscriptDeltaEvent {
  readonly kind: "source-transcript-delta";
  /** The session's own sequence number (monotone; starts at 1). */
  readonly seq: number;
  /** The delta text. */
  readonly text: string;
  /** The source-timeline position this delta covers (ms). */
  readonly positionMs: number;
  /** The attributed speaker label when attribution is on. */
  readonly speaker: string | null;
}

/** The finalized source transcript segment. */
export interface SourceTranscriptFinalEvent {
  readonly kind: "source-transcript-final";
  readonly seq: number;
  /** The complete segment text. */
  readonly text: string;
  readonly positionMs: number;
  /** The segment's duration on the source timeline (ms). */
  readonly durationMs: number;
  readonly speaker: string | null;
}

/** One translated text delta (incremental, target language). */
export interface TranslationDeltaEvent {
  readonly kind: "translation-delta";
  readonly seq: number;
  readonly text: string;
  readonly positionMs: number;
  readonly speaker: string | null;
}

/** The finalized translated segment (the stable-segment signal). */
export interface TranslationSegmentFinalEvent {
  readonly kind: "translation-segment-final";
  readonly seq: number;
  readonly text: string;
  readonly positionMs: number;
  readonly durationMs: number;
  readonly speaker: string | null;
}

/** A speaker attribution change (the truthful labels — R25-G). */
export interface SpeakerAttributionEvent {
  readonly kind: "speaker-attribution";
  readonly seq: number;
  /** The new active speaker's label (simple + contextual). */
  readonly speaker: string;
  readonly positionMs: number;
}

/** One translated speech audio chunk (output modality text+audio only). */
export interface TranslatedAudioChunkEvent {
  readonly kind: "translated-audio-chunk";
  readonly seq: number;
  /** The translated speech bytes (PCM — the session's declared format). */
  readonly samples: Uint8Array;
  /** The chunk's duration (ms). */
  readonly durationMs: number;
  /** The SOURCE-timeline position this chunk translates (the alignment key). */
  readonly positionMs: number;
}

/** The source/translation timing metadata (the plan's R25-A event). */
export interface TimingMetadataEvent {
  readonly kind: "timing-metadata";
  readonly seq: number;
  /** The source position the session has consumed through (ms). */
  readonly sourceConsumedMs: number;
  /** The translation's rendered position on the source timeline (ms). */
  readonly translationRenderedMs: number;
}

/** The usage/cost telemetry (the plan's R25-A event). */
export interface UsageTelemetryEvent {
  readonly kind: "usage-telemetry";
  readonly seq: number;
  /** The session's usage accounting (provider-neutral units). */
  readonly usage: {
    readonly inputAudioMs: number;
    readonly inputImageFrames: number;
    readonly outputTextCharacters: number;
    readonly outputAudioMs: number;
  };
}

/** A recoverable error (the reconnect path — never terminal). */
export interface RecoverableErrorEvent {
  readonly kind: "recoverable-error";
  /** The honest detail of what failed. */
  readonly detail: string;
  /** Whether the session recommends reconnect/resume now. */
  readonly requiresReconnect: boolean;
}

/** A terminal error (the session is dead; base playback continues). */
export interface TerminalErrorEvent {
  readonly kind: "terminal-error";
  readonly detail: string;
}

/** The session closed cleanly (stop/close completed). */
export interface SessionClosedEvent {
  readonly kind: "session-closed";
  /** The honest close reason. */
  readonly reason: "stopped" | "closed" | "source-ended";
}

/** The session was created (the start completed — the session's ack). */
export interface SessionCreatedEvent {
  readonly kind: "session-created";
  /** The session's own id (the composition correlates on this). */
  readonly sessionId: string;
  /** The languages the session is actually translating between. */
  readonly sourceLanguage: string | null;
  readonly targetLanguage: string;
}

/**
 * The realtime translation session event union — the plan's R25-A event
 * list VERBATIM: session-created; source-transcript-delta;
 * source-transcript-final; translation-delta; translation-segment-final;
 * speaker-attribution; translated-audio-chunk; source/translation timing
 * metadata; usage/cost telemetry; recoverable error; terminal error;
 * session-closed.
 */
export type RealtimeTranslationEvent =
  | SessionCreatedEvent
  | SourceTranscriptDeltaEvent
  | SourceTranscriptFinalEvent
  | TranslationDeltaEvent
  | TranslationSegmentFinalEvent
  | SpeakerAttributionEvent
  | TranslatedAudioChunkEvent
  | TimingMetadataEvent
  | UsageTelemetryEvent
  | RecoverableErrorEvent
  | TerminalErrorEvent
  | SessionClosedEvent;

/** Every event kind, in the plan's frozen order (the closed vocabulary). */
export const REALTIME_TRANSLATION_EVENT_KINDS: readonly RealtimeTranslationEvent["kind"][] = [
  "session-created",
  "source-transcript-delta",
  "source-transcript-final",
  "translation-delta",
  "translation-segment-final",
  "speaker-attribution",
  "translated-audio-chunk",
  "timing-metadata",
  "usage-telemetry",
  "recoverable-error",
  "terminal-error",
  "session-closed",
] as const;

/** Runtime guard for {@link RealtimeTranslationEvent}["kind"]. */
export function isRealtimeTranslationEventKind(
  value: unknown,
): value is RealtimeTranslationEvent["kind"] {
  return (
    typeof value === "string" &&
    (REALTIME_TRANSLATION_EVENT_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The session operations (the plan's R25-A operation list, verbatim)
// ---------------------------------------------------------------------------

/** One audio frame appended into the session (the append-audio seam). */
export interface RealtimeAudioAppendInput {
  /** The frame's source-timeline position (ms). */
  readonly positionMs: number;
  /** The captured decoded PCM bytes. */
  readonly samples: Uint8Array;
}

/**
 * The realtime translation session — the plan's R25-A operations VERBATIM:
 * start; configure; append audio; append image frame; stop;
 * reconnect/resume; close.
 */
export interface RealtimeTranslationSession {
  /** The session's id (assigned at creation). */
  readonly id: string;
  /**
   * Start the session (the session-created ack arrives as an event).
   * Rejects typed when the session is not startable — never a silent
   * no-op.
   */
  start(): Promise<void>;
  /**
   * Configure (or reconfigure) the session's translatable parameters
   * (target language, subtitle mode, speaker attribution, hotwords). The
   * audio/image seams stay open across a configure.
   */
  configure(update: {
    readonly targetLanguage?: string;
    readonly subtitleMode?: RealtimeSubtitleMode;
    readonly speakerAttribution?: RealtimeSpeakerAttributionMode;
    readonly hotwords?: readonly RealtimeHotwordMapping[];
  }): Promise<void>;
  /** Append one captured audio frame (the append-audio seam). */
  appendAudio(frame: RealtimeAudioAppendInput): void;
  /** Append one sampled image frame (the append-image-frame seam). */
  appendImageFrame(frame: RealtimeImageFrameInput): void;
  /** Stop translating (the session winds down; session-closed follows). */
  stop(): Promise<void>;
  /**
   * Reconnect/resume after an interruption (the recovery path — the
   * session's own operation; NEVER a media restart). Rejects typed when
   * the session cannot resume.
   */
  reconnect(): Promise<void>;
  /** Close the session (terminal; idempotent). */
  close(): Promise<void>;
  /** Subscribe to the session's streaming events. */
  subscribe(listener: (event: RealtimeTranslationEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// The factory seam (where the provider-neutral session comes from)
// ---------------------------------------------------------------------------

/** The typed failure of a session creation attempt (closed vocabulary). */
export type RealtimeSessionCreationFailure =
  | { readonly kind: "no-realtime-provider"; readonly detail: string }
  | { readonly kind: "capability-unavailable"; readonly detail: string }
  | { readonly kind: "invalid-input"; readonly detail: string };

/**
 * The session factory seam — the ONLY entry a provider-side realtime
 * implementation can take into the desktop composition. Production wires
 * the Model Fabric realtime-translation task (Worker 1's shared contract
 * — provider-neutral, credentials server-side); tests wire deterministic
 * doubles. A DESKTOP-side provider API call would be a lane violation by
 * construction: there is no provider parameter here to abuse.
 */
export interface RealtimeTranslationSessionFactory {
  createSession(input: RealtimeTranslationSessionInput): Promise<
    RealtimeTranslationSession | RealtimeSessionCreationFailure
  >;
}

/**
 * The marker the honest unavailable factory carries (the provider-bound
 * truth the desktop surfaces consult — a composition that wired the
 * unavailable factory reports the no-provider truth).
 */
export const UNAVAILABLE_REALTIME_FACTORY: unique symbol = Symbol(
  "wfx.unavailable-realtime-factory",
);

/** The honest unavailable factory (carries the marker). */
export interface UnavailableRealtimeFactory extends RealtimeTranslationSessionFactory {
  readonly [UNAVAILABLE_REALTIME_FACTORY]: true;
}

/**
 * The honest unavailable factory: a composition with NO realtime provider
 * bound answers the typed `no-realtime-provider` failure — never a fake
 * session, never a silent no-op (the default binding until Model Fabric's
 * realtime task lands).
 */
export function createUnavailableRealtimeSessionFactory(): UnavailableRealtimeFactory {
  return {
    [UNAVAILABLE_REALTIME_FACTORY]: true,
    async createSession(): Promise<RealtimeSessionCreationFailure> {
      return {
        kind: "no-realtime-provider",
        detail:
          "no realtime translation provider is bound through Model Fabric yet — the shared realtime session contract (R25-A) lands with the shared lane and the provider registration behind it",
      };
    },
  };
}

/** Whether a factory is the honest unavailable one (the no-provider truth). */
export function isUnavailableRealtimeSessionFactory(
  factory: RealtimeTranslationSessionFactory,
): boolean {
  return (
    typeof factory === "object" &&
    factory !== null &&
    (factory as { readonly [UNAVAILABLE_REALTIME_FACTORY]?: true })[UNAVAILABLE_REALTIME_FACTORY] === true
  );
}
