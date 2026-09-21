/**
 * @wfx/model-fabric — the realtime translation session contract (R25-A).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-A): realtime
 * translation is a STREAMING session seam, provider-neutral by law.
 * The typed shapes (inputs, events, operations, states, the session
 * port) are the frozen domain contracts from
 * `docs/architecture/contracts.md` (R25-A lane additions, Worker 1, for
 * lead ratification) — imported from `@wfx/domain`, never redefined
 * here. This module adds the OPERATIONAL layer:
 *
 * - the runtime vocabularies (mirrors of the frozen unions, drift =
 *   compile error via `satisfies` + `Covers`, domain precedent);
 * - input validation (field-path issues, fail-closed);
 * - the OPERATION × STATE legality table (the session state machine);
 * - the provider-neutrality law (the forbidden-token scan: no provider
 *   event names, no provider-specific JSON in the shared session
 *   contract);
 * - the in-memory event stream helper (the pure queue adapter-side
 *   implementations build on; no I/O).
 *
 * THE PROVIDER-NEUTRALITY LAW (the R25 rejection criteria, encoded):
 * no provider API calls, no provider event names, no provider-specific
 * JSON in shared product logic. The provider adapter (another lane)
 * owns the protocol end to end; this contract's vocabularies are the
 * neutral events/operations the adapter MUST map onto. The one lawful
 * place provider names appear is the registered-provider metadata
 * record (`provider.ts`) — provenance, never protocol.
 *
 * THE PLAYBACK LAW (R25-K/J43): a realtime translation session is an
 * OVERLAY on playback. Translation starting, failing, degrading, or
 * ending NEVER blocks, stops, or delays base playback — the session
 * contract has no capability over the media pipeline at all.
 */

import type {
  RealtimeAudioChunkInput,
  RealtimeImageFrameInput,
  RealtimeOutputModality,
  RealtimeSessionConfiguration,
  RealtimeSegmentTiming,
  RealtimeSpeakerAttributionMode,
  RealtimeSubtitleMode,
  RealtimeTranslatedAudioFormat,
  RealtimeTranslatedVoicePolicy,
  RealtimeTranslationErrorKind,
  RealtimeTranslationEvent,
  RealtimeTranslationEventKind,
  RealtimeTranslationOperation,
  RealtimeTranslationSession,
  RealtimeTranslationSessionInputs,
  RealtimeTranslationSessionState,
  RealtimeVisualContextPolicy,
  RealtimeVoiceConsentState,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// Compile-time coverage (drift = compile error, domain precedent)
// ---------------------------------------------------------------------------

/** Compile-time check that `Values` covers every member of the frozen `Union`. */
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? unknown
  : never;

/** Every frozen output modality, in frozen-contract order. */
export const REALTIME_OUTPUT_MODALITIES = [
  "text",
  "text-and-audio",
] as const satisfies readonly RealtimeOutputModality[];
const _outputModalitiesCover: Covers<RealtimeOutputModality, typeof REALTIME_OUTPUT_MODALITIES> =
  null;

/** Every frozen subtitle mode, in frozen-contract order. */
export const REALTIME_SUBTITLE_MODES = [
  "source",
  "translated",
  "bilingual",
] as const satisfies readonly RealtimeSubtitleMode[];
const _subtitleModesCover: Covers<RealtimeSubtitleMode, typeof REALTIME_SUBTITLE_MODES> = null;

/** Every frozen speaker-attribution mode, in frozen-contract order. */
export const REALTIME_SPEAKER_ATTRIBUTION_MODES = [
  "off",
  "simple-labels",
  "trusted-metadata",
] as const satisfies readonly RealtimeSpeakerAttributionMode[];
const _speakerAttributionModesCover: Covers<
  RealtimeSpeakerAttributionMode,
  typeof REALTIME_SPEAKER_ATTRIBUTION_MODES
> = null;

/** Every frozen visual-context policy, in frozen-contract order. */
export const REALTIME_VISUAL_CONTEXT_POLICIES = [
  "off",
  "adaptive",
] as const satisfies readonly RealtimeVisualContextPolicy[];
const _visualContextPoliciesCover: Covers<
  RealtimeVisualContextPolicy,
  typeof REALTIME_VISUAL_CONTEXT_POLICIES
> = null;

/** Every frozen translated-voice policy, in frozen-contract order. */
export const REALTIME_TRANSLATED_VOICE_POLICIES = [
  "neutral-system-voice",
  "preserve-source-voice",
] as const satisfies readonly RealtimeTranslatedVoicePolicy[];
const _translatedVoicePoliciesCover: Covers<
  RealtimeTranslatedVoicePolicy,
  typeof REALTIME_TRANSLATED_VOICE_POLICIES
> = null;

/** Every frozen voice-consent state, in frozen-contract order. */
export const REALTIME_VOICE_CONSENT_STATES = [
  "not-required",
  "satisfied",
  "missing",
  "revoked",
] as const satisfies readonly RealtimeVoiceConsentState[];
const _voiceConsentStatesCover: Covers<
  RealtimeVoiceConsentState,
  typeof REALTIME_VOICE_CONSENT_STATES
> = null;

/** Every frozen session state, in frozen-contract order. */
export const REALTIME_SESSION_STATES = [
  "idle",
  "starting",
  "streaming",
  "reconnecting",
  "stopped",
  "closed",
] as const satisfies readonly RealtimeTranslationSessionState[];
const _sessionStatesCover: Covers<RealtimeTranslationSessionState, typeof REALTIME_SESSION_STATES> =
  null;

/** Every frozen session operation, in frozen-contract order. */
export const REALTIME_OPERATIONS = [
  "start",
  "configure",
  "append-audio",
  "append-image-frame",
  "stop",
  "reconnect",
  "close",
] as const satisfies readonly RealtimeTranslationOperation[];
const _operationsCover: Covers<RealtimeTranslationOperation, typeof REALTIME_OPERATIONS> = null;

/**
 * Every frozen event kind, in frozen-contract order — the COMPLETE
 * event vocabulary (12 kinds, exactly the R25-A plan list in its
 * provider-neutral form). Tests assert totality against this table.
 */
export const REALTIME_EVENT_KINDS = [
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
] as const satisfies readonly RealtimeTranslationEventKind[];
const _eventKindsCover: Covers<RealtimeTranslationEventKind, typeof REALTIME_EVENT_KINDS> = null;

/** Every frozen error kind, in frozen-contract order. */
export const REALTIME_ERROR_KINDS = [
  "network",
  "timeout",
  "policy",
  "unsupported-language-direction",
  "consent-required",
  "provider-failure",
  "unknown",
] as const satisfies readonly RealtimeTranslationErrorKind[];
const _errorKindsCover: Covers<RealtimeTranslationErrorKind, typeof REALTIME_ERROR_KINDS> = null;

/** Every frozen translated-audio format, in frozen-contract order. */
export const REALTIME_AUDIO_FORMATS = [
  "pcm16",
  "opus",
] as const satisfies readonly RealtimeTranslatedAudioFormat[];
const _audioFormatsCover: Covers<RealtimeTranslatedAudioFormat, typeof REALTIME_AUDIO_FORMATS> =
  null;

// ---------------------------------------------------------------------------
// Runtime guards (the membership checks adapters and the bridge use)
// ---------------------------------------------------------------------------

function isStringIn(vocabulary: readonly string[]): (x: unknown) => boolean {
  return (x: unknown): boolean => typeof x === "string" && vocabulary.includes(x);
}

/** Runtime membership check against the output-modality union. */
export function isRealtimeOutputModality(x: unknown): x is RealtimeOutputModality {
  return isStringIn(REALTIME_OUTPUT_MODALITIES)(x);
}

/** Runtime membership check against the subtitle-mode union. */
export function isRealtimeSubtitleMode(x: unknown): x is RealtimeSubtitleMode {
  return isStringIn(REALTIME_SUBTITLE_MODES)(x);
}

/** Runtime membership check against the speaker-attribution union. */
export function isRealtimeSpeakerAttributionMode(
  x: unknown,
): x is RealtimeSpeakerAttributionMode {
  return isStringIn(REALTIME_SPEAKER_ATTRIBUTION_MODES)(x);
}

/** Runtime membership check against the visual-context-policy union. */
export function isRealtimeVisualContextPolicy(x: unknown): x is RealtimeVisualContextPolicy {
  return isStringIn(REALTIME_VISUAL_CONTEXT_POLICIES)(x);
}

/** Runtime membership check against the translated-voice-policy union. */
export function isRealtimeTranslatedVoicePolicy(x: unknown): x is RealtimeTranslatedVoicePolicy {
  return isStringIn(REALTIME_TRANSLATED_VOICE_POLICIES)(x);
}

/** Runtime membership check against the voice-consent-state union. */
export function isRealtimeVoiceConsentState(x: unknown): x is RealtimeVoiceConsentState {
  return isStringIn(REALTIME_VOICE_CONSENT_STATES)(x);
}

/** Runtime membership check against the session-state union. */
export function isRealtimeSessionState(x: unknown): x is RealtimeTranslationSessionState {
  return isStringIn(REALTIME_SESSION_STATES)(x);
}

/** Runtime membership check against the operation union. */
export function isRealtimeOperation(x: unknown): x is RealtimeTranslationOperation {
  return isStringIn(REALTIME_OPERATIONS)(x);
}

/** Runtime membership check against the event-kind union. */
export function isRealtimeEventKind(x: unknown): x is RealtimeTranslationEventKind {
  return isStringIn(REALTIME_EVENT_KINDS)(x);
}

/** Runtime membership check against the error-kind union. */
export function isRealtimeErrorKind(x: unknown): x is RealtimeTranslationErrorKind {
  return isStringIn(REALTIME_ERROR_KINDS)(x);
}

/** Runtime membership check against the audio-format union. */
export function isRealtimeAudioFormat(x: unknown): x is RealtimeTranslatedAudioFormat {
  return isStringIn(REALTIME_AUDIO_FORMATS)(x);
}

// ---------------------------------------------------------------------------
// Input validation (field-path issues, fail-closed — domain convention)
// ---------------------------------------------------------------------------

/** A field-path validation issue (transform tasks precedent). */
export interface RealtimeInputIssue {
  path: string;
  message: string;
}

/** The outcome of validating untrusted session inputs. */
export type RealtimeInputsValidation =
  | { ok: true; value: RealtimeTranslationSessionInputs }
  | { ok: false; issues: readonly RealtimeInputIssue[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Validate realtime translation session inputs (pure, fail-closed):
 *
 * - `sourceMedia.audioStreamLegallyAvailable` must be `true` — the
 *   honest legal-audio gate (R25-E): no lawful audio path, no session.
 *   There is no override and no circumvention branch.
 * - `targetLanguage` (and the optional hint) must be non-empty strings.
 * - `outputModality`/`subtitleMode`/`speakerAttribution`/
 *   `visualContextPolicy`/`translatedVoicePolicy` must be members of
 *   their frozen unions.
 * - `hotwords` must be an array of mappings with non-empty terms.
 * - Voice preservation requires a consent record whose state is
 *   `'satisfied'` — the consent gate (R25-H); anything less fails with
 *   the actionable `voiceConsent` issue (never silently proceeds).
 */
export function validateRealtimeTranslationSessionInputs(
  inputs: unknown,
): RealtimeInputsValidation {
  const issues: RealtimeInputIssue[] = [];

  if (!isRecord(inputs)) {
    return { ok: false, issues: [{ path: "", message: "expected a session inputs object" }] };
  }

  // --- source media identity (the legal-audio gate) ---
  const sourceMedia = inputs.sourceMedia;
  if (!isRecord(sourceMedia)) {
    issues.push({ path: "sourceMedia", message: "expected a source media identity object" });
  } else {
    if (sourceMedia.audioStreamLegallyAvailable !== true) {
      issues.push({
        path: "sourceMedia.audioStreamLegallyAvailable",
        message:
          "must be true — realtime translation runs only where WebFlix has a lawful audio path (there is no bypass, by design)",
      });
    }
    for (const field of ["itemId", "connectorId", "externalRef"] as const) {
      const value = sourceMedia[field];
      if (value !== undefined && typeof value !== "string") {
        issues.push({ path: `sourceMedia.${field}`, message: "expected a string when present" });
      }
    }
    if (
      sourceMedia.itemId === undefined &&
      sourceMedia.connectorId === undefined &&
      sourceMedia.externalRef === undefined
    ) {
      issues.push({
        path: "sourceMedia",
        message:
          "expected at least one of itemId, connectorId, externalRef — the session must name the media it translates",
      });
    }
  }

  // --- languages ---
  if (typeof inputs.targetLanguage !== "string" || inputs.targetLanguage.trim().length === 0) {
    issues.push({ path: "targetLanguage", message: "expected a non-empty target language tag" });
  }
  if (
    inputs.sourceLanguageHint !== undefined &&
    (typeof inputs.sourceLanguageHint !== "string" || inputs.sourceLanguageHint.trim().length === 0)
  ) {
    issues.push({
      path: "sourceLanguageHint",
      message: "expected a non-empty language tag when present",
    });
  }

  // --- vocabulary members ---
  if (!isRealtimeOutputModality(inputs.outputModality)) {
    issues.push({
      path: "outputModality",
      message: `expected one of ${REALTIME_OUTPUT_MODALITIES.join(" | ")}`,
    });
  }
  if (!isRealtimeSubtitleMode(inputs.subtitleMode)) {
    issues.push({
      path: "subtitleMode",
      message: `expected one of ${REALTIME_SUBTITLE_MODES.join(" | ")}`,
    });
  }
  if (!isRealtimeSpeakerAttributionMode(inputs.speakerAttribution)) {
    issues.push({
      path: "speakerAttribution",
      message: `expected one of ${REALTIME_SPEAKER_ATTRIBUTION_MODES.join(" | ")}`,
    });
  }
  if (!isRealtimeVisualContextPolicy(inputs.visualContextPolicy)) {
    issues.push({
      path: "visualContextPolicy",
      message: `expected one of ${REALTIME_VISUAL_CONTEXT_POLICIES.join(" | ")}`,
    });
  }
  if (!isRealtimeTranslatedVoicePolicy(inputs.translatedVoicePolicy)) {
    issues.push({
      path: "translatedVoicePolicy",
      message: `expected one of ${REALTIME_TRANSLATED_VOICE_POLICIES.join(" | ")}`,
    });
  }

  // --- hotwords (R25-I: the normalized vocabulary; provider syntax is the adapter's) ---
  if (!Array.isArray(inputs.hotwords)) {
    issues.push({ path: "hotwords", message: "expected an array of hotword mappings" });
  } else {
    inputs.hotwords.forEach((mapping: unknown, index: number) => {
      if (!isRecord(mapping)) {
        issues.push({ path: `hotwords[${index}]`, message: "expected a hotword mapping object" });
        return;
      }
      if (typeof mapping.term !== "string" || mapping.term.trim().length === 0) {
        issues.push({ path: `hotwords[${index}].term`, message: "expected a non-empty term" });
      }
      if (
        mapping.preferredRendering !== undefined &&
        (typeof mapping.preferredRendering !== "string" || mapping.preferredRendering.length === 0)
      ) {
        issues.push({
          path: `hotwords[${index}].preferredRendering`,
          message: "expected a non-empty rendering when present",
        });
      }
    });
  }

  // --- the consent gate (R25-H) ---
  if (inputs.translatedVoicePolicy === "preserve-source-voice") {
    const consent = inputs.voiceConsent;
    if (!isRecord(consent)) {
      issues.push({
        path: "voiceConsent",
        message:
          "voice preservation requires a consent record — never silently clone a source speaker",
      });
    } else if (consent.state !== "satisfied") {
      issues.push({
        path: "voiceConsent.state",
        message: `voice preservation requires consent state 'satisfied', got '${String(consent.state)}' — the neutral system voice is the default and the fallback`,
      });
    } else if (typeof consent.basis !== "string" || consent.basis.trim().length === 0) {
      issues.push({
        path: "voiceConsent.basis",
        message: "a satisfied consent record must name its basis (never silently synthesized)",
      });
    } else if (typeof consent.recordedAt !== "string" || consent.recordedAt.length === 0) {
      issues.push({
        path: "voiceConsent.recordedAt",
        message: "a satisfied consent record must carry its recordedAt timestamp",
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: inputs as unknown as RealtimeTranslationSessionInputs };
}

/**
 * Validate a mid-session configuration payload (pure, fail-closed).
 * Every present field must satisfy its field law; absent fields are
 * left untouched. The empty configuration is VALID (a no-op) — the
 * state machine decides whether configure is legal in the current
 * state, this validator only judges the payload's shape.
 */
export function validateRealtimeSessionConfiguration(
  configuration: unknown,
):
  | { ok: true; value: RealtimeSessionConfiguration }
  | { ok: false; issues: readonly RealtimeInputIssue[] } {
  if (!isRecord(configuration)) {
    return {
      ok: false,
      issues: [{ path: "", message: "expected a session configuration object" }],
    };
  }
  const issues: RealtimeInputIssue[] = [];
  const value: Record<string, unknown> = {};

  if (configuration.targetLanguage !== undefined) {
    if (
      typeof configuration.targetLanguage !== "string" ||
      configuration.targetLanguage.trim().length === 0
    ) {
      issues.push({ path: "targetLanguage", message: "expected a non-empty language tag" });
    } else {
      value.targetLanguage = configuration.targetLanguage;
    }
  }
  if (configuration.outputModality !== undefined) {
    if (!isRealtimeOutputModality(configuration.outputModality)) {
      issues.push({
        path: "outputModality",
        message: `expected one of ${REALTIME_OUTPUT_MODALITIES.join(" | ")}`,
      });
    } else {
      value.outputModality = configuration.outputModality;
    }
  }
  if (configuration.subtitleMode !== undefined) {
    if (!isRealtimeSubtitleMode(configuration.subtitleMode)) {
      issues.push({
        path: "subtitleMode",
        message: `expected one of ${REALTIME_SUBTITLE_MODES.join(" | ")}`,
      });
    } else {
      value.subtitleMode = configuration.subtitleMode;
    }
  }
  if (configuration.speakerAttribution !== undefined) {
    if (!isRealtimeSpeakerAttributionMode(configuration.speakerAttribution)) {
      issues.push({
        path: "speakerAttribution",
        message: `expected one of ${REALTIME_SPEAKER_ATTRIBUTION_MODES.join(" | ")}`,
      });
    } else {
      value.speakerAttribution = configuration.speakerAttribution;
    }
  }
  if (configuration.visualContextPolicy !== undefined) {
    if (!isRealtimeVisualContextPolicy(configuration.visualContextPolicy)) {
      issues.push({
        path: "visualContextPolicy",
        message: `expected one of ${REALTIME_VISUAL_CONTEXT_POLICIES.join(" | ")}`,
      });
    } else {
      value.visualContextPolicy = configuration.visualContextPolicy;
    }
  }
  if (configuration.hotwords !== undefined) {
    if (!Array.isArray(configuration.hotwords)) {
      issues.push({ path: "hotwords", message: "expected an array of hotword mappings" });
    } else {
      let hotwordsValid = true;
      configuration.hotwords.forEach((mapping: unknown, index: number) => {
        if (
          !isRecord(mapping) ||
          typeof mapping.term !== "string" ||
          mapping.term.trim().length === 0
        ) {
          hotwordsValid = false;
          issues.push({
            path: `hotwords[${index}].term`,
            message: "expected a non-empty term",
          });
        }
      });
      if (hotwordsValid) value.hotwords = configuration.hotwords;
    }
  }
  if (configuration.translatedVoicePolicy !== undefined) {
    if (!isRealtimeTranslatedVoicePolicy(configuration.translatedVoicePolicy)) {
      issues.push({
        path: "translatedVoicePolicy",
        message: `expected one of ${REALTIME_TRANSLATED_VOICE_POLICIES.join(" | ")}`,
      });
    } else {
      value.translatedVoicePolicy = configuration.translatedVoicePolicy;
    }
  }
  // THE CONSENT GATE (fail-closed): a reconfiguration that SELECTS
  // voice preservation must carry a satisfied consent record in the
  // same payload — never silently clone a source speaker. (A caller
  // re-asserting an existing satisfied record supplies it again.)
  if (configuration.translatedVoicePolicy === "preserve-source-voice") {
    if (!isRecord(configuration.voiceConsent) || configuration.voiceConsent.state !== "satisfied") {
      issues.push({
        path: "voiceConsent",
        message:
          "voice preservation requires a consent record with state 'satisfied' — never silently clone a source speaker",
      });
    }
  }
  if (configuration.voiceConsent !== undefined) {
    if (!isRecord(configuration.voiceConsent) || configuration.voiceConsent.state !== "satisfied") {
      issues.push({
        path: "voiceConsent",
        message:
          "voice preservation requires a consent record with state 'satisfied' — never silently clone a source speaker",
      });
    } else {
      value.voiceConsent = configuration.voiceConsent;
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: value as RealtimeSessionConfiguration };
}

// ---------------------------------------------------------------------------
// The operation × state legality table (the session state machine)
// ---------------------------------------------------------------------------

/**
 * The context the legality table needs beyond the raw state: the
 * session's CURRENT visual-context policy (append-image-frame is legal
 * only under an 'adaptive' policy) — the R25-F law that the caller may
 * not force frame upload when the policy says off.
 */
export interface RealtimeOperationContext {
  /** The session's current visual-context policy ('off' forbids append-image-frame). */
  readonly visualContextPolicy: RealtimeVisualContextPolicy;
}

/**
 * The operation legality table (pure, total over operations × states):
 *
 * - `start`               — only from `idle` (a stopped/closed session
 *                           never restarts; open a new session).
 * - `configure`           — `idle` (pre-start wiring) or `streaming`
 *                           (mid-session reconfiguration).
 * - `append-audio`        — `starting` (buffering while the provider
 *                           session comes up) or `streaming`.
 * - `append-image-frame`  — `starting`/`streaming` AND an 'adaptive'
 *                           visual-context policy — never under 'off'
 *                           (the never-force-visual-upload law).
 * - `stop`                — `starting` or `streaming` (signal end of
 *                           input; flush pending finals) → `stopped`.
 * - `reconnect`           — only from `reconnecting` (resume the SAME
 *                           session after a recoverable interruption —
 *                           reconnect never restarts the media item).
 * - `close`               — every state except `closed`.
 *
 * No operation is legal from `closed` (a closed session is terminal)
 * and no operation is legal from `stopped` except `close`.
 */
const OPERATION_LEGALITY: Readonly<
  Record<RealtimeTranslationOperation, readonly RealtimeTranslationSessionState[]>
> = {
  start: ["idle"],
  configure: ["idle", "streaming"],
  "append-audio": ["starting", "streaming"],
  "append-image-frame": ["starting", "streaming"],
  stop: ["starting", "streaming"],
  reconnect: ["reconnecting"],
  close: ["idle", "starting", "streaming", "reconnecting", "stopped"],
};

/** Is `operation` legal in `state` under `context`? (Pure, total.) */
export function isRealtimeOperationLegal(
  operation: RealtimeTranslationOperation,
  state: RealtimeTranslationSessionState,
  context: RealtimeOperationContext = { visualContextPolicy: "adaptive" },
): boolean {
  if (operation === "append-image-frame" && context.visualContextPolicy === "off") {
    return false; // the never-force-visual-upload law (R25-F)
  }
  return OPERATION_LEGALITY[operation].includes(state);
}

/** Every operation's legal states, in frozen-operation order (tests assert totality). */
export function realtimeOperationLegalStates(): Readonly<
  Record<RealtimeTranslationOperation, readonly RealtimeTranslationSessionState[]>
> {
  return {
    start: [...OPERATION_LEGALITY.start],
    configure: [...OPERATION_LEGALITY.configure],
    "append-audio": [...OPERATION_LEGALITY["append-audio"]],
    "append-image-frame": [...OPERATION_LEGALITY["append-image-frame"]],
    stop: [...OPERATION_LEGALITY.stop],
    reconnect: [...OPERATION_LEGALITY.reconnect],
    close: [...OPERATION_LEGALITY.close],
  };
}

/**
 * The EVENT-driven state transitions (the provider adapter applies
 * these as it observes its own protocol; shared consumers may verify
 * them): `session-created` moves starting→streaming; a recoverable
 * interruption moves streaming→reconnecting; terminal-error and
 * session-closed are terminal (→closed).
 */
export const REALTIME_EVENT_STATE_TRANSITIONS: Readonly<{
  onSessionCreated: RealtimeTranslationSessionState;
  onRecoverableInterruption: RealtimeTranslationSessionState;
  terminalStates: readonly RealtimeTranslationSessionState[];
}> = {
  onSessionCreated: "streaming",
  onRecoverableInterruption: "reconnecting",
  terminalStates: ["closed"],
};

// ---------------------------------------------------------------------------
// The provider-neutrality law (the forbidden-token scan)
// ---------------------------------------------------------------------------

/**
 * The protocol tokens that must NEVER appear in the shared realtime
 * session contract surface — provider protocol vocabulary (event
 * names, buffer-op JSON, vendor identifiers). Scanning the CONTRACT
 * (the shared session surface) for these tokens is the
 * machine-checkable half of the provider-neutrality law; the other
 * half is structural: the contract's own vocabularies are frozen and
 * contain none of them by construction.
 */
export const REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS: readonly string[] = [
  "dashscope",
  "input_audio_buffer",
  "input_image_buffer",
  "session.update",
  "qwen3.8-livetranslate",
  "qwen3.8_livetranslate",
  "alibabacloud",
  "alibaba-cloud",
];

/**
 * Scan a claimed contract source for forbidden provider-protocol
 * tokens (case-insensitive). Returns every violation found — empty
 * means the source is provider-neutral. The lead and any lane can
 * re-assert the law against the committed contract at any time.
 */
export function scanRealtimeSessionProviderNeutrality(source: string): readonly string[] {
  const lowered = source.toLowerCase();
  return REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS.filter((token) =>
    lowered.includes(token),
  );
}

// ---------------------------------------------------------------------------
// The in-memory event stream (the pure helper behind `events()`)
// ---------------------------------------------------------------------------

/**
 * A purely in-memory event stream: adapter-side session
 * implementations push typed events; consumers iterate them via the
 * frozen `events(): AsyncIterable<RealtimeTranslationEvent>` surface.
 * No I/O, no clock (events carry their own occurredAt), no provider
 * knowledge. Iteration ends when the stream is closed.
 */
export class RealtimeEventStream implements AsyncIterable<RealtimeTranslationEvent> {
  private readonly queue: RealtimeTranslationEvent[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<RealtimeTranslationEvent>) => void;
  }> = [];
  private closed = false;

  /**
   * Enqueue one event. Waiters are served in FIFO order. Pushing after
   * close is a wiring bug — it throws (fail fast), never drops
   * silently.
   */
  push(event: RealtimeTranslationEvent): void {
    if (this.closed) {
      throw new Error(
        `RealtimeEventStream: event '${event.kind}' pushed after close — events must never be dropped silently`,
      );
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ value: event, done: false });
      return;
    }
    this.queue.push(event);
  }

  /** Close the stream; pending iterations end (done). Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  /** Number of buffered events (observability for tests/diagnostics). */
  get buffered(): number {
    return this.queue.length;
  }

  /** The async iterator (multiple consumers each get their own view). */
  [Symbol.asyncIterator](): AsyncIterator<RealtimeTranslationEvent> {
    return {
      next: (): Promise<IteratorResult<RealtimeTranslationEvent>> => this.nextEvent(),
    };
  }

  /** One iterator step: buffered event, end-of-stream, or a parked waiter. */
  private nextEvent(): Promise<IteratorResult<RealtimeTranslationEvent>> {
    const event = this.queue.shift();
    if (event !== undefined) {
      return Promise.resolve({ value: event, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as never, done: true });
    }
    return new Promise<IteratorResult<RealtimeTranslationEvent>>((resolve) => {
      this.waiters.push({ resolve });
    });
  }
}

/**
 * Create a session-shaped event stream + the `events()` function the
 * frozen `RealtimeTranslationSession` port exposes. Pure construction;
 * the adapter owns pushing/closing.
 */
export function createRealtimeEventStream(): {
  stream: RealtimeEventStream;
  events: () => AsyncIterable<RealtimeTranslationEvent>;
} {
  const stream = new RealtimeEventStream();
  return { stream, events: () => stream };
}

// ---------------------------------------------------------------------------
// Segment timing helper (the shared validation of timing metadata)
// ---------------------------------------------------------------------------

/** Structural check for a segment timing record (non-negative, ordered). */
export function isRealtimeSegmentTiming(x: unknown): x is RealtimeSegmentTiming {
  if (!isRecord(x)) return false;
  const startedAtMs = x.startedAtMs;
  const endedAtMs = x.endedAtMs;
  return (
    typeof startedAtMs === "number" &&
    Number.isFinite(startedAtMs) &&
    startedAtMs >= 0 &&
    typeof endedAtMs === "number" &&
    Number.isFinite(endedAtMs) &&
    endedAtMs >= startedAtMs
  );
}

// ---------------------------------------------------------------------------
// The never-block-playback law (total, always false — the R25-K law)
// ---------------------------------------------------------------------------

/**
 * THE PLAYBACK LAW, frozen as a total function: may a realtime
 * translation session (or its cost/latency controls) block, stop, or
 * delay base media playback? NEVER. Translation is an overlay;
 * starting it, failing it, degrading it, or ending it by policy never
 * touches the media pipeline. This is the machine-checkable law the
 * R25 acceptance battery asserts (the
 * `mayModelAuthorizePlaybackOrAcquisition` precedent).
 */
export function mayRealtimeTranslationBlockPlayback(): false {
  return false;
}

// ---------------------------------------------------------------------------
// A reference session double (TEST/BRIDGE SCAFFOLDING — never production)
// ---------------------------------------------------------------------------

/**
 * A minimal in-memory `RealtimeTranslationSession` double that obeys
 * the state machine and the event stream. This exists so the shared
 * tests (and Workers 2/3 bridge scaffolding) can exercise the frozen
 * port without any provider: it performs NO translation and produces
 * NO transcript — it is the state-machine-legal skeleton, clearly
 * labeled (the `testing.ts` law: fixtures are never production
 * providers).
 */
export function createRealtimeSessionDouble(
  inputs: RealtimeTranslationSessionInputs,
  sessionId = "realtime-double-session",
): RealtimeTranslationSession {
  const { stream, events } = createRealtimeEventStream();
  let state: RealtimeTranslationSessionState = "idle";
  let current = inputs;
  const assertLegal = (operation: RealtimeTranslationOperation): void => {
    if (
      !isRealtimeOperationLegal(operation, state, {
        visualContextPolicy: current.visualContextPolicy,
      })
    ) {
      throw new Error(
        `realtime session double: operation '${operation}' is illegal in state '${state}'`,
      );
    }
  };
  return {
    sessionId,
    get state() {
      return state;
    },
    async start() {
      assertLegal("start");
      state = "starting";
    },
    async configure(configuration) {
      assertLegal("configure");
      current = { ...current, ...configuration };
    },
    async appendAudio(_chunk: RealtimeAudioChunkInput) {
      assertLegal("append-audio");
    },
    async appendImageFrame(_frame: RealtimeImageFrameInput) {
      assertLegal("append-image-frame");
    },
    async stop() {
      assertLegal("stop");
      state = "stopped";
    },
    async reconnect() {
      assertLegal("reconnect");
      state = "streaming";
    },
    async close() {
      assertLegal("close");
      state = "closed";
      stream.close();
    },
    events,
  };
}
