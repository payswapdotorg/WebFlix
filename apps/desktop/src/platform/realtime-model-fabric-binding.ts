/**
 * @wfx/app-desktop — the Model Fabric realtime binding (R25-L, the
 * integration seam that retires the port's stand-alone contract status).
 *
 * WHAT THIS MODULE IS: the production binding between the DESKTOP
 * composition's session port
 * (`realtime-translation-port.ts` — W3's lane binding) and the CANONICAL
 * frozen realtime contract (`@wfx/domain` frozen.ts R25-A block, ratified
 * from `wfx/r25/shared` @ 93b7a1b). W3's port was cut against the frozen
 * PLAN's vocabulary verbatim before the shared branch landed (the honest
 * note in the port header); this module is the promised rebind: the
 * desktop composition now binds to the ONE frozen contract through this
 * adapter, and the vocabulary equivalence is MACHINE-CHECKED at module
 * load (the drift guard below).
 *
 * THE ADAPTER'S SHAPE (two projections, both honest, never inventing):
 *
 * 1. INPUTS (desktop → canonical): the desktop session input projects
 *    onto `RealtimeTranslationSessionInputs`. `sourceMedia
 *    .audioStreamLegallyAvailable` is `true` BY CONSTRUCTION here: the
 *    desktop media adapter reaches this factory only through its closed
 *    lawful capture-path vocabulary (authorized-local /
 *    authorized-torrent / controlled-live — the R25-E capability
 *    resolution already refused every restricted path BEFORE a session
 *    could be requested); there is no path to this binding with an
 *    unlawful audio stream. The projected inputs are validated by
 *    Worker 1's fail-closed `validateRealtimeTranslationSessionInputs`
 *    (the SAME gate the web bridge honors — the legal-audio gate, the
 *    consent gate, the frozen-union membership) before the canonical
 *    factory is ever called.
 *
 * 2. EVENTS (canonical → desktop): the canonical 12-kind event union
 *    projects onto the desktop composition's event shapes. Every field
 *    the desktop consumes is either carried verbatim from the canonical
 *    event or LOCALLY MEASURED by this adapter (the per-session sequence
 *    counter, the tracked active speaker, the observed source/translation
 *    stream positions for drift, and the local usage accounting). No
 *    number is invented; where the canonical carries a truth the desktop
 *    shape has no field for (the provider token usage), the desktop
 *    usage event reports the adapter's OWN locally measured accounting
 *    (audio ms appended, image frames appended, translated text
 *    characters received, translated audio ms received) — the provider's
 *    token truth rides the canonical transport to the server-side cost
 *    model and never needs a desktop-side re-derivation.
 *
 * THE PRODUCT LAWS THIS BINDING PRESERVES STRUCTURALLY:
 * - ONE FROZEN CONTRACT: the vocabulary invariant below fails fast if
 *   either side drifts — there is no second vocabulary, ever.
 * - BASE PLAYBACK NEVER WAITS: the adapter holds no playback handle; a
 *   canonical failure maps to the desktop typed failure/events and the
 *   composition's laws take over (the never-block law is total upstream).
 * - CREDENTIALS NEVER CROSS: the canonical factory is Model Fabric's
 *   seam (server-side credentials — the Qwen adapter's law); this module
 *   has no credential parameter to abuse and adds none.
 * - RECONNECT IS RESUME: the desktop `reconnect()` delegates to the
 *   canonical session's own `reconnect()` — never a media restart (the
 *   recovery supervisor's law holds).
 */

import {
  REALTIME_EVENT_KINDS,
  validateRealtimeTranslationSessionInputs,
} from "@wfx/model-fabric";
import type {
  RealtimeTranslationEvent,
  RealtimeTranslationSession as CanonicalRealtimeTranslationSession,
  RealtimeTranslationSessionFactory as CanonicalRealtimeTranslationSessionFactory,
  RealtimeTranslationSessionInputs,
  RealtimeSessionConfiguration,
  RealtimeTranslationEventKind,
} from "@wfx/domain";

import {
  REALTIME_TRANSLATION_EVENT_KINDS,
  type RealtimeAudioAppendInput,
  type RealtimeHotwordMapping,
  type RealtimeImageFrameInput,
  type RealtimeSessionCreationFailure,
  type RealtimeTranslationEvent as DesktopRealtimeTranslationEvent,
  type RealtimeTranslationSession,
  type RealtimeTranslationSessionFactory,
  type RealtimeTranslationSessionInput,
} from "./realtime-translation-port";

// ---------------------------------------------------------------------------
// The vocabulary invariant — ONE frozen contract, machine-checked
// ---------------------------------------------------------------------------

/**
 * The drift guard: the desktop composition's event-kind list must be
 * element-for-element the canonical frozen list (same members, same
 * frozen order). Any change on either side without the other is a
 * contract break and fails fast at module load — the 1:1 vocabulary
 * equivalence W3 promised and R25-L enforces.
 */
const CANONICAL_KINDS_JOINED = (REALTIME_EVENT_KINDS as readonly string[]).join(
  "\u0000",
);
const DESKTOP_KINDS_JOINED = (
  REALTIME_TRANSLATION_EVENT_KINDS as readonly string[]
).join("\u0000");
if (CANONICAL_KINDS_JOINED !== DESKTOP_KINDS_JOINED) {
  throw new Error(
    "realtime-model-fabric-binding: the desktop event-kind vocabulary has drifted from the frozen @wfx/domain realtime contract — reconcile the port with the ratified shared contract (this is a contract break, never a silent divergence)",
  );
}

/** Compile-time 1:1 (both directions): desktop kinds ⊆ canonical kinds and back. */
const _desktopKindsAreCanonical: readonly RealtimeTranslationEventKind[] =
  REALTIME_TRANSLATION_EVENT_KINDS;
const _canonicalKindsAreDesktop: readonly RealtimeTranslationEvent["kind"][] =
  REALTIME_EVENT_KINDS;
void _desktopKindsAreCanonical;
void _canonicalKindsAreDesktop;

// ---------------------------------------------------------------------------
// The input projection (desktop → canonical)
// ---------------------------------------------------------------------------

/** The per-session locally measured usage accounting (never invented). */
interface LocalUsageAccounting {
  inputAudioMs: number;
  inputImageFrames: number;
  outputTextCharacters: number;
  outputAudioMs: number;
}

/** Bytes per sample for the desktop capture encodings. */
function bytesPerSample(encoding: "pcm-s16le" | "pcm-f32le"): number {
  return encoding === "pcm-s16le" ? 2 : 4;
}

/**
 * Project the desktop session input onto the canonical frozen inputs.
 * Exported for the binding's tests (the projection is part of the seam's
 * contract surface).
 *
 * THE MODE-UNION MAPPING (honest, never a raw assignment — the two
 * bindings named the same dimensions differently): the desktop
 * `"text+audio"` modality is the canonical `"text-and-audio"`; the
 * desktop `"labeled"` attribution is the canonical `"simple-labels"`;
 * the desktop `"audio-only"` and `"disabled"` visual policies both
 * cross the wire as the canonical `"off"` (no frame is ever sent under
 * either — the desktop sampler keeps its own local distinction, the
 * canonical wire carries only frames-or-not).
 */
export function projectDesktopRealtimeInputs(
  input: RealtimeTranslationSessionInput,
): RealtimeTranslationSessionInputs {
  const hotwords: readonly {
    term: string;
    preferredRendering?: string;
  }[] = input.hotwords.map((hotword: RealtimeHotwordMapping) => ({
    term: hotword.term,
    ...(hotword.translation !== ""
      ? { preferredRendering: hotword.translation }
      : {}),
  }));
  return {
    sourceMedia: {
      // The lawful-capture truth: the desktop adapter only reaches the
      // factory through its closed authorized-path vocabulary (R25-E).
      ...(input.sourceMediaId !== null
        ? { itemId: input.sourceMediaId }
        : {}),
      audioStreamLegallyAvailable: true,
    },
    targetLanguage: input.targetLanguage,
    ...(input.sourceLanguageHint !== null
      ? { sourceLanguageHint: input.sourceLanguageHint }
      : {}),
    outputModality:
      input.outputModalities === "text+audio" ? "text-and-audio" : "text",
    subtitleMode: input.subtitleMode,
    speakerAttribution:
      input.speakerAttribution === "labeled" ? "simple-labels" : "off",
    visualContextPolicy:
      input.imageFrames?.policy === "adaptive" ? "adaptive" : "off",
    hotwords,
    translatedVoicePolicy:
      input.translatedVoice.mode === "neutral"
        ? "neutral-system-voice"
        : "preserve-source-voice",
    ...(input.translatedVoice.mode === "preserve-source" &&
    input.translatedVoice.consent !== null
      ? {
          voiceConsent: {
            state: "satisfied" as const,
            basis: input.translatedVoice.consent.basis,
            recordedAt: input.translatedVoice.consent.recordedAt,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The event projection (canonical → desktop, locally measured)
// ---------------------------------------------------------------------------

/** The adapter's per-session projection state. */
interface ProjectionState {
  seq: number;
  activeSpeaker: string | null;
  lastSourcePositionMs: number | null;
  lastTranslationPositionMs: number | null;
  usage: LocalUsageAccounting;
  sampleRateHz: number;
  channels: number;
  encoding: "pcm-s16le" | "pcm-f32le";
}

function nextSeq(state: ProjectionState): number {
  state.seq += 1;
  return state.seq;
}

function audioMsOf(
  state: ProjectionState,
  samples: Uint8Array,
): number {
  const frameCount =
    samples.byteLength /
    (state.channels * bytesPerSample(state.encoding));
  return (frameCount / state.sampleRateHz) * 1000;
}

/**
 * Project ONE canonical event onto zero or more desktop events (the
 * timing-metadata projection may be unobservable-yet and then honestly
 * emits nothing). Pure apart from the projection state's bookkeeping.
 */
function projectCanonicalEvent(
  event: RealtimeTranslationEvent,
  state: ProjectionState,
): readonly DesktopRealtimeTranslationEvent[] {
  switch (event.kind) {
    case "session-created":
      return [
        {
          kind: "session-created",
          sessionId: event.sessionId,
          // The canonical contract does not promise a detected source
          // language at creation (the detected language is the provider's
          // own downstream truth); null is the honest answer here.
          sourceLanguage: null,
          targetLanguage: event.effectiveInputs.targetLanguage,
        },
      ];
    case "source-transcript-delta": {
      state.lastSourcePositionMs = event.timing.startedAtMs;
      return [
        {
          kind: "source-transcript-delta",
          seq: nextSeq(state),
          text: event.deltaText,
          positionMs: event.timing.startedAtMs,
          speaker: state.activeSpeaker,
        },
      ];
    }
    case "source-transcript-final": {
      state.lastSourcePositionMs = event.timing.startedAtMs;
      return [
        {
          kind: "source-transcript-final",
          seq: nextSeq(state),
          text: event.text,
          positionMs: event.timing.startedAtMs,
          durationMs: Math.max(
            0,
            event.timing.endedAtMs - event.timing.startedAtMs,
          ),
          speaker: state.activeSpeaker,
        },
      ];
    }
    case "translation-delta": {
      // The canonical translation-delta carries no timing (deltas are
      // text-only); the honest position is the last observed SOURCE
      // position (the translation renders behind the source stream).
      return [
        {
          kind: "translation-delta",
          seq: nextSeq(state),
          text: event.deltaText,
          positionMs: nullCoalesce(state.lastSourcePositionMs, 0),
          speaker: state.activeSpeaker,
        },
      ];
    }
    case "translation-segment-final": {
      state.lastTranslationPositionMs = event.timing.startedAtMs;
      // The settled translation text is the session's text output —
      // counted once here (never double-counted with the deltas).
      state.usage.outputTextCharacters += event.text.length;
      return [
        {
          kind: "translation-segment-final",
          seq: nextSeq(state),
          text: event.text,
          positionMs: event.timing.startedAtMs,
          durationMs: Math.max(
            0,
            event.timing.endedAtMs - event.timing.startedAtMs,
          ),
          speaker: state.activeSpeaker,
        },
      ];
    }
    case "speaker-attribution": {
      state.activeSpeaker = event.label;
      return [
        {
          kind: "speaker-attribution",
          seq: nextSeq(state),
          speaker: event.label,
          positionMs: nullCoalesce(state.lastSourcePositionMs, 0),
        },
      ];
    }
    case "translated-audio-chunk": {
      state.lastTranslationPositionMs = event.timing.startedAtMs;
      const durationMs = Math.max(
        0,
        event.timing.endedAtMs - event.timing.startedAtMs,
      );
      state.usage.outputAudioMs += durationMs;
      return [
        {
          kind: "translated-audio-chunk",
          // The port's seq law is the session's own monotone counter —
          // the provider's audio sequence is a wire-side truth the
          // desktop shape does not carry.
          seq: nextSeq(state),
          samples: event.audio,
          durationMs,
          positionMs: event.timing.startedAtMs,
        },
      ];
    }
    case "timing-metadata": {
      // The desktop drift observation is LOCALLY measured: where the
      // source stream stands vs where the translation has rendered. The
      // canonical first-delta fields are the web lane's latency record
      // (measured against session start); the composition's drift wants
      // the stream positions. Until both have been observed, the drift is
      // honestly unobservable — nothing is emitted.
      if (
        state.lastSourcePositionMs === null ||
        state.lastTranslationPositionMs === null
      ) {
        return [];
      }
      return [
        {
          kind: "timing-metadata",
          seq: nextSeq(state),
          sourceConsumedMs: state.lastSourcePositionMs,
          translationRenderedMs: state.lastTranslationPositionMs,
        },
      ];
    }
    case "usage-telemetry": {
      // The desktop usage shape carries the adapter's OWN locally
      // measured accounting (provider-neutral units); the canonical token
      // truth is the server-side cost model's input and is not re-derived
      // here — no number is invented.
      return [
        {
          kind: "usage-telemetry",
          seq: nextSeq(state),
          usage: { ...state.usage },
        },
      ];
    }
    case "recoverable-error":
      return [
        {
          kind: "recoverable-error",
          detail: `${event.detail} — ${event.recovery}`,
          requiresReconnect: event.errorKind === "network",
        },
      ];
    case "terminal-error":
      return [
        {
          kind: "terminal-error",
          detail: `${event.errorKind}: ${event.detail}`,
        },
      ];
    case "session-closed":
      return [
        {
          kind: "session-closed",
          reason: event.reason === "user-stop" ? "stopped" : "closed",
        },
      ];
  }
}

function nullCoalesce(value: number | null, fallback: number): number {
  return value === null ? fallback : value;
}

// ---------------------------------------------------------------------------
// The session adapter (canonical session → desktop port session)
// ---------------------------------------------------------------------------

function adaptCanonicalSession(
  canonical: CanonicalRealtimeTranslationSession,
  desktopInput: RealtimeTranslationSessionInput,
): RealtimeTranslationSession {
  const listeners = new Set<
    (event: DesktopRealtimeTranslationEvent) => void
  >();
  const state: ProjectionState = {
    seq: 0,
    activeSpeaker: null,
    lastSourcePositionMs: null,
    lastTranslationPositionMs: null,
    usage: {
      inputAudioMs: 0,
      inputImageFrames: 0,
      outputTextCharacters: 0,
      outputAudioMs: 0,
    },
    sampleRateHz: desktopInput.sourceAudio.format.sampleRateHz,
    channels: desktopInput.sourceAudio.format.channels,
    encoding: desktopInput.sourceAudio.format.encoding,
  };

  // Always consume the canonical stream (from BEFORE start — the
  // composition subscribes pre-start, and the canonical stream must
  // never buffer unboundedly). Projection failures are impossible by
  // construction (the switch is total over the frozen union); the loop
  // ends when the canonical stream closes (session end).
  void (async () => {
    try {
      for await (const canonicalEvent of canonical.events()) {
        for (const desktopEvent of projectCanonicalEvent(
          canonicalEvent,
          state,
        )) {
          for (const listener of listeners) {
            listener(desktopEvent);
          }
        }
      }
    } catch {
      // The canonical stream died outside the contract's close path —
      // the session's own terminal-error/session-closed events are the
      // honest signals; nothing further is fabricated here.
    }
  })();

  return {
    id: canonical.sessionId,
    start(): Promise<void> {
      return canonical.start();
    },
    configure(update: {
      readonly targetLanguage?: string;
      readonly subtitleMode?:
        | "source"
        | "translated"
        | "bilingual"
        | undefined;
      readonly speakerAttribution?: "labeled" | "off" | undefined;
      readonly hotwords?: readonly RealtimeHotwordMapping[] | undefined;
    }): Promise<void> {
      const configuration: RealtimeSessionConfiguration = {
        ...(update.targetLanguage !== undefined
          ? { targetLanguage: update.targetLanguage }
          : {}),
        ...(update.subtitleMode !== undefined
          ? { subtitleMode: update.subtitleMode }
          : {}),
        ...(update.speakerAttribution !== undefined
          ? {
              speakerAttribution:
                update.speakerAttribution === "labeled"
                  ? "simple-labels"
                  : "off",
            }
          : {}),
        ...(update.hotwords !== undefined
          ? {
              hotwords: update.hotwords.map((hotword) => ({
                term: hotword.term,
                ...(hotword.translation !== ""
                  ? { preferredRendering: hotword.translation }
                  : {}),
              })),
            }
          : {}),
      };
      return canonical.configure(configuration);
    },
    appendAudio(frame: RealtimeAudioAppendInput): void {
      state.usage.inputAudioMs += audioMsOf(state, frame.samples);
      // Appends are the capture tap's fire-and-forget seam by design; a
      // canonical append rejection surfaces through the session's own
      // recoverable-error events, never as a throw into the capture path.
      void canonical
        .appendAudio({ audio: frame.samples, mediaPositionMs: frame.positionMs })
        .catch(() => undefined);
    },
    appendImageFrame(frame: RealtimeImageFrameInput): void {
      state.usage.inputImageFrames += 1;
      void canonical
        .appendImageFrame({
          frame: frame.bytes,
          mediaPositionMs: frame.positionMs,
        })
        .catch(() => undefined);
    },
    stop(): Promise<void> {
      return canonical.stop();
    },
    reconnect(): Promise<void> {
      return canonical.reconnect();
    },
    close(): Promise<void> {
      return canonical.close();
    },
    subscribe(
      listener: (event: DesktopRealtimeTranslationEvent) => void,
    ): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The factory binding (the ONLY production entry for a provider session)
// ---------------------------------------------------------------------------

/**
 * Bind a canonical Model Fabric realtime session factory (the frozen
 * `RealtimeTranslationSessionFactory` — Worker 1's contract, the Qwen
 * adapter behind it in production) to the DESKTOP composition's factory
 * port. The desktop lane's composition consumes the returned factory;
 * the provider protocol, credentials, and cost model stay behind Model
 * Fabric's seam by law.
 */
export function createModelFabricRealtimeTranslationSessionFactory(
  canonicalFactory: CanonicalRealtimeTranslationSessionFactory,
): RealtimeTranslationSessionFactory {
  return {
    async createSession(
      input: RealtimeTranslationSessionInput,
    ): Promise<
      RealtimeTranslationSession | RealtimeSessionCreationFailure
    > {
      const projected = projectDesktopRealtimeInputs(input);
      // Worker 1's fail-closed gate — the SAME validation the web bridge
      // honors (legal-audio, consent, frozen-union membership). Issues
      // answer the desktop typed invalid-input failure with every field
      // path named; the canonical factory is never called on bad input.
      const validation = validateRealtimeTranslationSessionInputs(projected);
      if (!validation.ok) {
        return {
          kind: "invalid-input",
          detail: validation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; "),
        };
      }
      try {
        const canonicalSession = await canonicalFactory.open(
          validation.value,
        );
        return adaptCanonicalSession(canonicalSession, input);
      } catch (error) {
        return {
          kind: "capability-unavailable",
          detail: `the Model Fabric realtime session factory refused the session: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  };
}
