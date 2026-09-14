/**
 * @wfx/model-fabric/src/transform — typed transformation task descriptors (WFX-033, Lane A).
 *
 * Every media transformation the tool layer expresses is a TYPED TASK
 * DESCRIPTOR: the frozen `ModelTask` capability it routes through (the
 * "capability requirement" — a provider must declare it), the typed input
 * schema (validated with FIELD-PATH errors), the output type, the cost class
 * (token/byte/second), and DETERMINISTIC estimate functions (pure functions
 * of the validated input — no randomness, no provider calls).
 *
 * Task kind → frozen fabric capability mapping (the frozen vocabulary has no
 * separate subtitle/transcript capabilities — composition is layered on top):
 *
 *   transcript  → 'transcription'   transcribe → 'speechToText'
 *   translation → 'translation'     subtitle   → 'translation' (composed)
 *   summary     → 'summary'         speech     → 'textToSpeech'
 *   dubbing     → 'dubbing'         commentary → 'commentary'
 *
 * Honest-scope decisions (lead-visible):
 * - NO actual media processing happens here: inputs are typed REFERENCES
 *   (`mediaRef`, `audioRef`) plus durations/segments; speech/dubbing OUTPUTS
 *   are typed SPECS (voice/duration/bytes), not audio. Realization belongs to
 *   the native/adapter layers.
 * - Speech voices and commentary styles are CLOSED vocabularies so fakes and
 *   estimates stay deterministic.
 * - Cost/duration estimates use documented constants (abstract cost units,
 *   same units as `ModelPolicy.maxCostPerOperation`); cost values are rounded
 *   to 6 decimals so repeated estimation is bit-stable and golden-testable.
 * - Input validators follow the domain convention: unknown extra fields are
 *   ACCEPTED (structural typing); only declared fields are checked; failures
 *   aggregate into ONE typed issue list.
 */

import type { ModelTask } from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";

import {
  composeSubtitleCues,
  validateTranscriptSegments,
  type SubtitleCue,
  type TranscriptSegment,
} from "./subtitle";

// ---------------------------------------------------------------------------
// Validation vocabulary (field-path issues)
// ---------------------------------------------------------------------------

/**
 * A field-path validation issue: `path` locates the offending field (e.g.
 * `"media.sourceId"`, `"segments[1].endMs"`, `"options.privacy"`), `message`
 * says what is wrong. Structurally identical to `TimedTextIssue` in
 * subtitle.ts by design — subtitle validator results flow into task-level
 * issue lists without adapters.
 */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Result of validating an untrusted input against a task schema. */
export type InputValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ValidationIssue[] };

// ---------------------------------------------------------------------------
// Media provenance (the permission input — lives inside every task input)
// ---------------------------------------------------------------------------

/**
 * The provenance record of the media being transformed. The permission
 * authority (`permissions.ts`) reads EXACTLY these fields; every task input
 * embeds one under `media`, so no transformation can be requested without a
 * provenance record to judge.
 *
 * - `sourceId` — stable identifier used in denial reasons (e.g.
 *   `'wfx-reference'`).
 * - `authorizedSource` — true only for user-owned, licensed, public-domain,
 *   Creative Commons, or otherwise authorized media (product boundary).
 * - `drmProtected` — true when the input is DRM-protected: ALWAYS denied.
 * - `allowsTranscript` / `allowsTranslation` / `allowsDubbing` /
 *   `allowsCommentary` — license flags. Required booleans (no silent
 *   defaults): if a source's license state is unknown, the caller must
 *   encode `false` and be denied — fail-closed.
 */
export interface MediaProvenanceRecord {
  sourceId: string;
  authorizedSource: boolean;
  drmProtected: boolean;
  allowsTranscript: boolean;
  allowsTranslation: boolean;
  allowsDubbing: boolean;
  allowsCommentary: boolean;
}

/** Base shape of every transformation task input. */
export interface BaseTransformationInput {
  media: MediaProvenanceRecord;
}

// ---------------------------------------------------------------------------
// Task kinds
// ---------------------------------------------------------------------------

/** The closed vocabulary of transformation task kinds. */
export type TransformationTaskKind =
  | "transcript"
  | "translation"
  | "subtitle"
  | "summary"
  | "speech"
  | "transcribe"
  | "dubbing"
  | "commentary";

/** Every task kind, in declaration order. */
export const TRANSFORMATION_TASK_KINDS = [
  "transcript",
  "translation",
  "subtitle",
  "summary",
  "speech",
  "transcribe",
  "dubbing",
  "commentary",
] as const satisfies readonly TransformationTaskKind[];

/** Runtime guard for {@link TransformationTaskKind}. */
export function isTransformationTaskKind(x: unknown): x is TransformationTaskKind {
  return typeof x === "string" && (TRANSFORMATION_TASK_KINDS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// Deterministic estimation vocabulary
// ---------------------------------------------------------------------------

/** How a task's cost scales: input tokens, output bytes, or media seconds. */
export type TransformationCostClass = "token" | "byte" | "second";

/** Abstract cost units per estimated token (1 token ≈ 4 characters). */
export const TOKEN_COST_RATE = 0.001;
/** Abstract cost units per estimated payload byte. */
export const BYTE_COST_RATE = 0.00001;
/** Abstract cost units per second of media/speech. */
export const SECOND_COST_RATE = 0.01;
/** Estimated speaking pace for speech synthesis: milliseconds per word. */
export const SPEECH_MS_PER_WORD = 400;
/** Estimated speech lead-in: milliseconds before the first word. */
export const SPEECH_LEAD_IN_MS = 300;
/** Estimated speech payload rate: bytes per second of audio spec (16 kHz 16-bit mono ≈ 16 KB/s). */
export const SPEECH_BYTES_PER_SECOND = 16_000;

/**
 * Round an abstract cost to 6 decimals so estimates are bit-stable under
 * IEEE-754 float dust (e.g. `60 * 0.01 === 0.6000000000000001` → `0.6`).
 * The transformation ceiling check compares the ROUNDED estimate consistently.
 */
function roundCostUnits(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Estimated tokens in a text (1 token ≈ 4 characters). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimated words in a text (whitespace-separated, trimmed). */
export function estimateSpeechWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

/** Estimated CONTENT duration (ms) of synthesized speech: words × 400ms + 300ms lead-in. */
export function estimateSpeechContentDurationMs(text: string): number {
  return estimateSpeechWords(text) * SPEECH_MS_PER_WORD + SPEECH_LEAD_IN_MS;
}

/** Estimated payload size (bytes) of a speech output spec. */
export function estimateSpeechBytes(text: string): number {
  return Math.ceil((estimateSpeechContentDurationMs(text) / 1000) * SPEECH_BYTES_PER_SECOND);
}

/** Total duration (ms) of a transcript track: the last segment's end. */
export function transcriptTrackDurationMs(segments: readonly TranscriptSegment[]): number {
  let last = 0;
  for (const segment of segments) last = Math.max(last, segment.endMs);
  return last;
}

// ---------------------------------------------------------------------------
// Descriptor interface
// ---------------------------------------------------------------------------

/** Result of a realize step: composing a provider output into the task output. */
export type RealizationResult<TOutput> =
  | { ok: true; value: TOutput }
  | { ok: false; issues: string[] };

/**
 * A typed transformation task descriptor.
 *
 * - `kind` — the task's identity in the closed transformation vocabulary.
 * - `modelTask` — the frozen `ModelTask` capability a provider must declare
 *   to serve this task (the capability requirement).
 * - `costClass` — how cost scales (token/byte/second) for documentation.
 * - `validate` — total input validator answering typed FIELD-PATH issues.
 * - `estimateCost` / `estimateDurationMs` — DETERMINISTIC estimates over the
 *   VALIDATED input (pure; abstract cost units / milliseconds).
 * - `realize` — optional composition step (used by SubtitleTask): maps the
 *   provider's fabric output into the task's public output. Failures are
 *   typed issues and surface as provider-contract violations — never fake
 *   success. When absent, `TOutput` is `TFabricOutput` by construction.
 */
export interface TransformationTaskDescriptor<
  TInput extends BaseTransformationInput,
  TFabricOutput,
  TOutput = TFabricOutput,
> {
  readonly kind: TransformationTaskKind;
  readonly modelTask: ModelTask;
  readonly description: string;
  readonly costClass: TransformationCostClass;
  validate(input: unknown): InputValidationResult<TInput>;
  estimateCost(input: TInput): number;
  estimateDurationMs(input: TInput): number;
  realize?(fabricOutput: TFabricOutput, input: TInput): RealizationResult<TOutput>;
}

/**
 * Wildcard instantiation for heterogeneous collections (e.g.
 * `TRANSFORMATION_TASKS`, exhaustive test matrices). Method bivariance makes
 * every concrete descriptor assignable.
 */
export type AnyTransformationTaskDescriptor = TransformationTaskDescriptor<
  BaseTransformationInput,
  unknown,
  unknown
>;

// ---------------------------------------------------------------------------
// Shared validator helpers (total; issues aggregated, never thrown)
// ---------------------------------------------------------------------------

function requireRecord(
  x: unknown,
  path: string,
  issues: ValidationIssue[],
): Record<string, unknown> | undefined {
  if (!isRecord(x)) {
    issues.push({ path, message: `expected an object, got ${previewValue(x)}` });
    return undefined;
  }
  return x;
}

function requireNonEmptyString(
  x: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof x !== "string" || x.trim().length === 0) {
    issues.push({ path, message: `expected a non-empty string, got ${previewValue(x)}` });
    return undefined;
  }
  return x;
}

function requireBoolean(x: unknown, path: string, issues: ValidationIssue[]): boolean | undefined {
  if (typeof x !== "boolean") {
    issues.push({ path, message: `expected a boolean, got ${previewValue(x)}` });
    return undefined;
  }
  return x;
}

function requirePositiveInteger(
  x: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (typeof x !== "number" || !Number.isInteger(x) || x <= 0) {
    issues.push({ path, message: `expected a positive integer, got ${previewValue(x)}` });
    return undefined;
  }
  return x;
}

function requireBoundedInteger(
  x: unknown,
  path: string,
  min: number,
  max: number,
  issues: ValidationIssue[],
): number | undefined {
  if (typeof x !== "number" || !Number.isInteger(x) || x < min || x > max) {
    issues.push({ path, message: `expected an integer between ${min} and ${max}, got ${previewValue(x)}` });
    return undefined;
  }
  return x;
}

function requireMember<T extends string>(
  x: unknown,
  values: readonly T[],
  path: string,
  issues: ValidationIssue[],
): T | undefined {
  if (typeof x !== "string" || !(values as readonly string[]).includes(x)) {
    issues.push({ path, message: `expected one of ${values.join(" | ")}, got ${previewValue(x)}` });
    return undefined;
  }
  return x as T;
}

/** Validate the embedded provenance record (`media.*` paths). */
function validateProvenanceFields(x: unknown, issues: ValidationIssue[]): void {
  const media = requireRecord(x, "media", issues);
  if (media === undefined) return;
  requireNonEmptyString(media.sourceId, "media.sourceId", issues);
  requireBoolean(media.authorizedSource, "media.authorizedSource", issues);
  requireBoolean(media.drmProtected, "media.drmProtected", issues);
  requireBoolean(media.allowsTranscript, "media.allowsTranscript", issues);
  requireBoolean(media.allowsTranslation, "media.allowsTranslation", issues);
  requireBoolean(media.allowsDubbing, "media.allowsDubbing", issues);
  requireBoolean(media.allowsCommentary, "media.allowsCommentary", issues);
}

/** Validate a transcript-segment array field (`segments[i].*` paths). */
function requireSegmentList(x: unknown, path: string, issues: ValidationIssue[]): void {
  const check = validateTranscriptSegments(x, path);
  if (!check.ok) issues.push(...check.issues);
}

// ---------------------------------------------------------------------------
// Task input/output schemas
// ---------------------------------------------------------------------------

/** Input: produce a timed transcript of a media asset (typed reference, no bytes). */
export interface TranscriptTaskInput extends BaseTransformationInput {
  mediaRef: string;
  durationMs: number;
}
/** Output: the timed transcript segments. */
export interface TranscriptTaskOutput {
  segments: TranscriptSegment[];
}

/** Input: translate a text into a target language. */
export interface TranslationTaskInput extends BaseTransformationInput {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
}
/** Output: the translated text. */
export interface TranslationTaskOutput {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
}

/**
 * Input: build translated subtitles from existing transcript segments (the
 * transcript itself is assumed already derived under its own permission).
 */
export interface SubtitleTaskInput extends BaseTransformationInput {
  segments: TranscriptSegment[];
  targetLanguage: string;
}
/**
 * The PROVIDER-side contract for the subtitle task: one translated text per
 * input segment, plus the language the provider translated into. The
 * pipeline's realize step composes these into timed cues via
 * `composeSubtitleCues` and verifies the language echo.
 */
export interface SubtitleFabricOutput {
  translations: string[];
  targetLanguage: string;
}
/** Output: the composed, timed subtitle cues. */
export interface SubtitleTaskOutput {
  cues: SubtitleCue[];
  targetLanguage: string;
}

/** Input: summarize a text (bounded sentence budget). */
export interface SummaryTaskInput extends BaseTransformationInput {
  text: string;
  /** Optional sentence budget, 1..20; providers choose their own default. */
  maxSentences?: number;
}
/** Output: the summary. */
export interface SummaryTaskOutput {
  summary: string;
  sentenceCount: number;
}

/** Closed voice vocabulary for speech synthesis specs. */
export type SpeechVoice = "narrator" | "clear" | "warm";
/** Every speech voice, in declaration order. */
export const SPEECH_VOICES = ["narrator", "clear", "warm"] as const satisfies readonly SpeechVoice[];

/** Input: synthesize a speech track from a text (output is a typed SPEC). */
export interface SpeechTaskInput extends BaseTransformationInput {
  text: string;
  voice: SpeechVoice;
}
/** Output: the speech track SPEC — voice, content duration, payload size. No audio bytes here. */
export interface SpeechTaskOutput {
  voice: SpeechVoice;
  durationMs: number;
  bytes: number;
}

/** Input: transcribe an audio reference to plain text (typed reference, no bytes). */
export interface TranscribeTaskInput extends BaseTransformationInput {
  audioRef: string;
  durationMs: number;
}
/** Output: the transcribed text. */
export interface TranscribeTaskOutput {
  text: string;
}

/** Input: dub an existing transcript into a target language and voice (output is a typed SPEC). */
export interface DubbingTaskInput extends BaseTransformationInput {
  segments: TranscriptSegment[];
  targetLanguage: string;
  voice: SpeechVoice;
}
/** Output: the dubbing track SPEC — language, voice, duration, payload size. No audio bytes here. */
export interface DubbingTaskOutput {
  targetLanguage: string;
  voice: SpeechVoice;
  durationMs: number;
  bytes: number;
}

/** Closed commentary style vocabulary. */
export type CommentaryStyle = "insightful" | "casual" | "critical";
/** Every commentary style, in declaration order. */
export const COMMENTARY_STYLES = [
  "insightful",
  "casual",
  "critical",
] as const satisfies readonly CommentaryStyle[];

/** Input: generate a commentary track for a media asset (typed reference). */
export interface CommentaryTaskInput extends BaseTransformationInput {
  mediaRef: string;
  durationMs: number;
  style: CommentaryStyle;
}
/** Output: the commentary text. */
export interface CommentaryTaskOutput {
  commentary: string;
}

// ---------------------------------------------------------------------------
// Input validators
// ---------------------------------------------------------------------------

function validateTranscriptInput(input: unknown): InputValidationResult<TranscriptTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireNonEmptyString(record.mediaRef, "mediaRef", issues);
  requirePositiveInteger(record.durationMs, "durationMs", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as TranscriptTaskInput };
}

function validateTranslationInput(input: unknown): InputValidationResult<TranslationTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireNonEmptyString(record.text, "text", issues);
  requireNonEmptyString(record.targetLanguage, "targetLanguage", issues);
  if (record.sourceLanguage !== undefined) {
    requireNonEmptyString(record.sourceLanguage, "sourceLanguage", issues);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as TranslationTaskInput };
}

function validateSubtitleInput(input: unknown): InputValidationResult<SubtitleTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireSegmentList(record.segments, "segments", issues);
  requireNonEmptyString(record.targetLanguage, "targetLanguage", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as SubtitleTaskInput };
}

function validateSummaryInput(input: unknown): InputValidationResult<SummaryTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireNonEmptyString(record.text, "text", issues);
  if (record.maxSentences !== undefined) {
    requireBoundedInteger(record.maxSentences, "maxSentences", 1, 20, issues);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as SummaryTaskInput };
}

function validateSpeechInput(input: unknown): InputValidationResult<SpeechTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireNonEmptyString(record.text, "text", issues);
  requireMember(record.voice, SPEECH_VOICES, "voice", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as SpeechTaskInput };
}

function validateTranscribeInput(input: unknown): InputValidationResult<TranscribeTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireNonEmptyString(record.audioRef, "audioRef", issues);
  requirePositiveInteger(record.durationMs, "durationMs", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as TranscribeTaskInput };
}

function validateDubbingInput(input: unknown): InputValidationResult<DubbingTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireSegmentList(record.segments, "segments", issues);
  requireNonEmptyString(record.targetLanguage, "targetLanguage", issues);
  requireMember(record.voice, SPEECH_VOICES, "voice", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as DubbingTaskInput };
}

function validateCommentaryInput(input: unknown): InputValidationResult<CommentaryTaskInput> {
  const issues: ValidationIssue[] = [];
  const record = requireRecord(input, "input", issues);
  if (record === undefined) return { ok: false, issues };
  validateProvenanceFields(record.media, issues);
  requireNonEmptyString(record.mediaRef, "mediaRef", issues);
  requirePositiveInteger(record.durationMs, "durationMs", issues);
  requireMember(record.style, COMMENTARY_STYLES, "style", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: input as CommentaryTaskInput };
}

// ---------------------------------------------------------------------------
// Subtitle realize step (provider output → composed cues)
// ---------------------------------------------------------------------------

/**
 * Compose the SubtitleTask's public output from the provider's translation
 * output: verify the language echo, then compose timed cues via the pure
 * builder. Deliberately DEFENSIVE against providers that lie about their
 * output shape at runtime (the fabric trusts providers; the realize step
 * does not) — every violation answers typed issues, never a crash, never
 * fake success.
 */
function realizeSubtitleOutput(
  fabricOutput: SubtitleFabricOutput,
  input: SubtitleTaskInput,
): RealizationResult<SubtitleTaskOutput> {
  if (typeof fabricOutput !== "object" || fabricOutput === null) {
    return { ok: false, issues: ["provider returned a non-object subtitle output"] };
  }
  const raw = fabricOutput as unknown as Record<string, unknown>;
  const issues: string[] = [];
  if (raw.targetLanguage !== input.targetLanguage) {
    issues.push(
      `provider translated into '${String(raw.targetLanguage)}' but the input requested '${input.targetLanguage}'`,
    );
  }
  if (!Array.isArray(raw.translations)) {
    issues.push("provider translations is not an array");
  }
  if (issues.length > 0) return { ok: false, issues };

  const composed = composeSubtitleCues(input.segments, raw.translations as readonly string[]);
  if (!composed.ok) {
    return {
      ok: false,
      issues: composed.issues.map((issue) => `${issue.path}: ${issue.message}`),
    };
  }
  return { ok: true, value: { cues: composed.cues, targetLanguage: input.targetLanguage } };
}

// ---------------------------------------------------------------------------
// Task descriptors (frozen singletons)
// ---------------------------------------------------------------------------

/** The transcript task: timed transcript of a media asset. */
export const transcriptTask: TransformationTaskDescriptor<
  TranscriptTaskInput,
  TranscriptTaskOutput
> = Object.freeze<TransformationTaskDescriptor<TranscriptTaskInput, TranscriptTaskOutput>>({
  kind: "transcript",
  modelTask: "transcription",
  description:
    "Produce a timed transcript (segments with startMs/endMs/text) for an authorized media asset.",
  costClass: "second",
  validate: validateTranscriptInput,
  estimateCost: (input) => roundCostUnits((input.durationMs / 1000) * SECOND_COST_RATE),
  estimateDurationMs: (input) => Math.round(input.durationMs * 0.1) + 500,
});

/** The translation task: translate a text into a target language. */
export const translationTask: TransformationTaskDescriptor<
  TranslationTaskInput,
  TranslationTaskOutput
> = Object.freeze<TransformationTaskDescriptor<TranslationTaskInput, TranslationTaskOutput>>({
  kind: "translation",
  modelTask: "translation",
  description: "Translate a text into a target language.",
  costClass: "token",
  validate: validateTranslationInput,
  estimateCost: (input) => roundCostUnits(estimateTokens(input.text) * TOKEN_COST_RATE),
  estimateDurationMs: (input) => Math.round(estimateTokens(input.text) * 80) + 250,
});

/**
 * The subtitle task: translated subtitles composed from transcript segments.
 * The fabric invocation is a 'translation' (per-segment texts); the realize
 * step composes the timed cue output via subtitle.ts pure builders.
 */
export const subtitleTask: TransformationTaskDescriptor<
  SubtitleTaskInput,
  SubtitleFabricOutput,
  SubtitleTaskOutput
> = Object.freeze<TransformationTaskDescriptor<SubtitleTaskInput, SubtitleFabricOutput, SubtitleTaskOutput>>({
  kind: "subtitle",
  modelTask: "translation",
  description:
    "Translate existing transcript segments and compose timed subtitle cues for the target language.",
  costClass: "token",
  validate: validateSubtitleInput,
  estimateCost: (input) =>
    roundCostUnits(
      input.segments.reduce((sum, segment) => sum + estimateTokens(segment.text), 0) *
        TOKEN_COST_RATE,
    ),
  estimateDurationMs: (input) =>
    Math.round(
      input.segments.reduce((sum, segment) => sum + estimateTokens(segment.text), 0) * 80,
    ) + 250,
  realize: realizeSubtitleOutput,
});

/** The summary task: summarize a text within a bounded sentence budget. */
export const summaryTask: TransformationTaskDescriptor<SummaryTaskInput, SummaryTaskOutput> =
  Object.freeze<TransformationTaskDescriptor<SummaryTaskInput, SummaryTaskOutput>>({
    kind: "summary",
    modelTask: "summary",
    description: "Summarize a text within a bounded sentence budget.",
    costClass: "token",
    validate: validateSummaryInput,
    estimateCost: (input) => roundCostUnits(estimateTokens(input.text) * TOKEN_COST_RATE),
    estimateDurationMs: (input) => Math.round(estimateTokens(input.text) * 60) + 250,
  });

/** The speech task (textToSpeech): synthesize a speech track spec from a text. */
export const speechTask: TransformationTaskDescriptor<SpeechTaskInput, SpeechTaskOutput> =
  Object.freeze<TransformationTaskDescriptor<SpeechTaskInput, SpeechTaskOutput>>({
    kind: "speech",
    modelTask: "textToSpeech",
    description:
      "Synthesize a speech track from a text; the output is a typed SPEC (voice, duration, bytes), not audio.",
    costClass: "byte",
    validate: validateSpeechInput,
    estimateCost: (input) => roundCostUnits(estimateSpeechBytes(input.text) * BYTE_COST_RATE),
    estimateDurationMs: (input) => Math.round(estimateSpeechWords(input.text) * 100) + 200,
  });

/** The transcribe task (speechToText): transcribe an audio reference to text. */
export const transcribeTask: TransformationTaskDescriptor<
  TranscribeTaskInput,
  TranscribeTaskOutput
> = Object.freeze<TransformationTaskDescriptor<TranscribeTaskInput, TranscribeTaskOutput>>({
  kind: "transcribe",
  modelTask: "speechToText",
  description: "Transcribe an audio reference into plain text.",
  costClass: "second",
  validate: validateTranscribeInput,
  estimateCost: (input) => roundCostUnits((input.durationMs / 1000) * SECOND_COST_RATE),
  estimateDurationMs: (input) => input.durationMs + 500,
});

/** The dubbing task: dub an existing transcript into a target language/voice (typed SPEC output). */
export const dubbingTask: TransformationTaskDescriptor<DubbingTaskInput, DubbingTaskOutput> =
  Object.freeze<TransformationTaskDescriptor<DubbingTaskInput, DubbingTaskOutput>>({
    kind: "dubbing",
    modelTask: "dubbing",
    description:
      "Dub an existing transcript into a target language and voice; the output is a typed SPEC, not audio.",
    costClass: "second",
    validate: validateDubbingInput,
    estimateCost: (input) =>
      roundCostUnits((transcriptTrackDurationMs(input.segments) / 1000) * SECOND_COST_RATE),
    estimateDurationMs: (input) => transcriptTrackDurationMs(input.segments) + 1000,
  });

/** The commentary task: generate a commentary track for a media asset. */
export const commentaryTask: TransformationTaskDescriptor<
  CommentaryTaskInput,
  CommentaryTaskOutput
> = Object.freeze<TransformationTaskDescriptor<CommentaryTaskInput, CommentaryTaskOutput>>({
  kind: "commentary",
  modelTask: "commentary",
  description: "Generate a commentary track for an authorized media asset.",
  costClass: "second",
  validate: validateCommentaryInput,
  estimateCost: (input) => roundCostUnits((input.durationMs / 1000) * SECOND_COST_RATE),
  estimateDurationMs: (input) => Math.round(input.durationMs * 0.5) + 1000,
});

/** Every task descriptor, in declaration order (exhaustive-matrix entry point). */
export const TRANSFORMATION_TASKS: readonly AnyTransformationTaskDescriptor[] = [
  transcriptTask,
  translationTask,
  subtitleTask,
  summaryTask,
  speechTask,
  transcribeTask,
  dubbingTask,
  commentaryTask,
];
