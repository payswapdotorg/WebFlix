/**
 * @wfx/model-fabric/src/transform — deterministic fake transformation providers (WFX-033, Lane A).
 *
 * TEST FIXTURES ONLY — NEVER REGISTER AS PRODUCTION PROVIDERS. Every fake is
 * branded `isTestFixture: true` and carries a `calls` log so tests can assert
 * exactly which providers saw which inputs (e.g. that a permission denial
 * short-circuits before the fabric, or that a local-only policy never lets a
 * cloud provider see the input).
 *
 * Determinism laws (packet): NO randomness, NO network, NO file I/O, no
 * timers. Every output is a pure function of the validated task input:
 *
 * - transcript  — cue-grid transcript: 5s segments over the media duration,
 *                 text `transcript line i of n`.
 * - translation — identity translation with a deterministic prefix:
 *                 `[<targetLanguage>] <text>`.
 * - subtitle    — per-segment prefix translations (consumed by the task's
 *                 realize step, which composes the timed cues).
 * - summary     — first-N sentences (N = `maxSentences` ?? 3), split on
 *                 sentence-final punctuation.
 * - speech      — typed SPEC (voice, duration, bytes) computed with the SAME
 *                 exported estimate helpers the task descriptors use.
 * - transcribe  — deterministic text naming the audio reference.
 * - dubbing     — typed SPEC (language, voice, duration, bytes) derived from
 *                 the transcript track duration.
 * - commentary  — deterministic text naming the style and media reference.
 *
 * Fakes validate their input with the TASK DESCRIPTOR's validator and FAIL
 * LOUDLY on wrong shapes/tasks (an honest provider cannot serve an input it
 * does not understand — the failure surfaces through the fabric's typed
 * provider-error machinery). They implement the full `RegisteredModelProvider`
 * surface (privacy + declared costs) so they exercise the real routing,
 * privacy, and cost machinery.
 */

import type { ModelTask } from "@wfx/domain";

import type { ModelProviderPrivacy, RegisteredModelProvider } from "../registry";
import type { TranscriptSegment } from "./subtitle";
import {
  commentaryTask,
  dubbingTask,
  estimateSpeechBytes,
  estimateSpeechContentDurationMs,
  SPEECH_BYTES_PER_SECOND,
  speechTask,
  subtitleTask,
  summaryTask,
  transcriptTask,
  transcriptTrackDurationMs,
  transcribeTask,
  translationTask,
  type CommentaryTaskInput,
  type CommentaryTaskOutput,
  type DubbingTaskInput,
  type DubbingTaskOutput,
  type SpeechTaskInput,
  type SpeechTaskOutput,
  type SubtitleFabricOutput,
  type SubtitleTaskInput,
  type SummaryTaskInput,
  type SummaryTaskOutput,
  type TranscriptTaskInput,
  type TranscriptTaskOutput,
  type TranscribeTaskInput,
  type TranscribeTaskOutput,
  type TranslationTaskInput,
  type TranslationTaskOutput,
  type ValidationIssue,
} from "./tasks";

// ---------------------------------------------------------------------------
// Shared fake surface
// ---------------------------------------------------------------------------

/** One recorded fake-provider invocation. */
export interface TransformationFakeCall {
  task: ModelTask;
  input: unknown;
}

/** Registration options shared by every transformation fake. */
export interface FakeTransformationProviderOptions {
  /** Where the fake "runs". Default `'local'`. */
  privacy?: ModelProviderPrivacy;
  /** Declared costs per task (abstract units); unlisted tasks are undeclared. */
  costs?: Partial<Record<ModelTask, number>>;
}

/** The fake provider surface: a full `RegisteredModelProvider` plus test observability. */
export interface FakeTransformationProvider extends RegisteredModelProvider {
  /** Brand: this object is a TEST FIXTURE, never a production provider. */
  readonly isTestFixture: true;
  /** Every invocation the fake received, in order. */
  readonly calls: readonly TransformationFakeCall[];
}

function describeIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

/**
 * Shared fake plumbing: registration metadata (id, the single served
 * ModelTask, privacy, declared costs) and the invocation call log. Concrete
 * fakes implement `invoke` deterministically.
 */
abstract class FakeTransformationProviderBase implements FakeTransformationProvider {
  readonly isTestFixture = true as const;
  readonly privacy: ModelProviderPrivacy;
  private readonly declaredCosts: Partial<Record<ModelTask, number>>;
  private readonly callLog: TransformationFakeCall[] = [];

  protected constructor(
    readonly id: string,
    private readonly serves: ModelTask,
    options: FakeTransformationProviderOptions = {},
  ) {
    this.privacy = options.privacy ?? "local";
    this.declaredCosts = options.costs ?? {};
  }

  get capabilities(): ModelTask[] {
    return [this.serves];
  }

  get calls(): readonly TransformationFakeCall[] {
    return this.callLog;
  }

  costPerOperation(task: ModelTask): number | undefined {
    return this.declaredCosts[task];
  }

  protected record(task: ModelTask, input: unknown): void {
    this.callLog.push({ task, input });
  }

  /** Fail loudly (the fabric maps the throw to a typed provider-error). */
  protected fail(message: string): never {
    throw new Error(`fake '${this.id}': ${message}`);
  }

  abstract invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut>;
}

// ---------------------------------------------------------------------------
// Deterministic output generators (pure functions of validated input)
// ---------------------------------------------------------------------------

/** Transcript segment length used by the cue-grid fake. */
export const FAKE_TRANSCRIPT_SEGMENT_MS = 5_000;
/** Default sentence budget for the summary fake when the input omits one. */
export const FAKE_SUMMARY_DEFAULT_SENTENCES = 3;

function generateTranscriptOutput(input: TranscriptTaskInput): TranscriptTaskOutput {
  const count = Math.max(1, Math.ceil(input.durationMs / FAKE_TRANSCRIPT_SEGMENT_MS));
  const segments: TranscriptSegment[] = [];
  for (let index = 0; index < count; index++) {
    segments.push({
      startMs: index * FAKE_TRANSCRIPT_SEGMENT_MS,
      endMs: Math.min((index + 1) * FAKE_TRANSCRIPT_SEGMENT_MS, input.durationMs),
      text: `transcript line ${index + 1} of ${count}`,
    });
  }
  return { segments };
}

function generateTranslationOutput(input: TranslationTaskInput): TranslationTaskOutput {
  return {
    text: `[${input.targetLanguage}] ${input.text}`,
    targetLanguage: input.targetLanguage,
    ...(input.sourceLanguage !== undefined ? { sourceLanguage: input.sourceLanguage } : {}),
  };
}

function generateSubtitleOutput(input: SubtitleTaskInput): SubtitleFabricOutput {
  return {
    translations: input.segments.map((segment) => `[${input.targetLanguage}] ${segment.text}`),
    targetLanguage: input.targetLanguage,
  };
}

function generateSummaryOutput(input: SummaryTaskInput): SummaryTaskOutput {
  const max = input.maxSentences ?? FAKE_SUMMARY_DEFAULT_SENTENCES;
  const sentences = input.text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim().length > 0);
  const picked = sentences.slice(0, max);
  return { summary: picked.join(" "), sentenceCount: picked.length };
}

function generateSpeechOutput(input: SpeechTaskInput): SpeechTaskOutput {
  return {
    voice: input.voice,
    durationMs: estimateSpeechContentDurationMs(input.text),
    bytes: estimateSpeechBytes(input.text),
  };
}

function generateTranscribeOutput(input: TranscribeTaskInput): TranscribeTaskOutput {
  return { text: `transcription of ${input.audioRef} (${input.durationMs} ms)` };
}

function generateDubbingOutput(input: DubbingTaskInput): DubbingTaskOutput {
  const durationMs = transcriptTrackDurationMs(input.segments);
  return {
    targetLanguage: input.targetLanguage,
    voice: input.voice,
    durationMs,
    bytes: Math.ceil((durationMs / 1000) * SPEECH_BYTES_PER_SECOND),
  };
}

function generateCommentaryOutput(input: CommentaryTaskInput): CommentaryTaskOutput {
  return { commentary: `${input.style} commentary on ${input.mediaRef} (${input.durationMs} ms of media)` };
}

// ---------------------------------------------------------------------------
// Concrete fakes (one per transformation task; subtitle + translation both
// serve the frozen 'translation' capability with different input contracts)
// ---------------------------------------------------------------------------

class FakeTranscriptProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, transcriptTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== transcriptTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${transcriptTask.modelTask}')`);
    }
    const validated = transcriptTask.validate(input);
    if (!validated.ok) this.fail(`invalid transcript task input — ${describeIssues(validated.issues)}`);
    return generateTranscriptOutput(validated.value) as unknown as TOut;
  }
}

class FakeTranslationProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, translationTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== translationTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${translationTask.modelTask}')`);
    }
    const validated = translationTask.validate(input);
    if (!validated.ok) this.fail(`invalid translation task input — ${describeIssues(validated.issues)}`);
    return generateTranslationOutput(validated.value) as unknown as TOut;
  }
}

class FakeSubtitleProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, subtitleTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== subtitleTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${subtitleTask.modelTask}')`);
    }
    const validated = subtitleTask.validate(input);
    if (!validated.ok) this.fail(`invalid subtitle task input — ${describeIssues(validated.issues)}`);
    return generateSubtitleOutput(validated.value) as unknown as TOut;
  }
}

class FakeSummaryProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, summaryTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== summaryTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${summaryTask.modelTask}')`);
    }
    const validated = summaryTask.validate(input);
    if (!validated.ok) this.fail(`invalid summary task input — ${describeIssues(validated.issues)}`);
    return generateSummaryOutput(validated.value) as unknown as TOut;
  }
}

class FakeSpeechProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, speechTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== speechTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${speechTask.modelTask}')`);
    }
    const validated = speechTask.validate(input);
    if (!validated.ok) this.fail(`invalid speech task input — ${describeIssues(validated.issues)}`);
    return generateSpeechOutput(validated.value) as unknown as TOut;
  }
}

class FakeTranscribeProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, transcribeTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== transcribeTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${transcribeTask.modelTask}')`);
    }
    const validated = transcribeTask.validate(input);
    if (!validated.ok) this.fail(`invalid transcribe task input — ${describeIssues(validated.issues)}`);
    return generateTranscribeOutput(validated.value) as unknown as TOut;
  }
}

class FakeDubbingProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, dubbingTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== dubbingTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${dubbingTask.modelTask}')`);
    }
    const validated = dubbingTask.validate(input);
    if (!validated.ok) this.fail(`invalid dubbing task input — ${describeIssues(validated.issues)}`);
    return generateDubbingOutput(validated.value) as unknown as TOut;
  }
}

class FakeCommentaryProvider extends FakeTransformationProviderBase {
  constructor(id: string, options: FakeTransformationProviderOptions = {}) {
    super(id, commentaryTask.modelTask, options);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    if (task !== commentaryTask.modelTask) {
      this.fail(`does not serve task '${task}' (serves '${commentaryTask.modelTask}')`);
    }
    const validated = commentaryTask.validate(input);
    if (!validated.ok) this.fail(`invalid commentary task input — ${describeIssues(validated.issues)}`);
    return generateCommentaryOutput(validated.value) as unknown as TOut;
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Create the transcript fake (cue-grid, deterministic). TEST FIXTURE — NEVER production. */
export function makeFakeTranscriptProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeTranscriptProvider(id, options);
}

/** Create the text-translation fake (deterministic prefix). TEST FIXTURE — NEVER production. */
export function makeFakeTranslationProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeTranslationProvider(id, options);
}

/** Create the subtitle fake (per-segment prefix translations). TEST FIXTURE — NEVER production. */
export function makeFakeSubtitleProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeSubtitleProvider(id, options);
}

/** Create the summary fake (first-N sentences). TEST FIXTURE — NEVER production. */
export function makeFakeSummaryProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeSummaryProvider(id, options);
}

/** Create the textToSpeech fake (typed spec from the shared estimators). TEST FIXTURE — NEVER production. */
export function makeFakeSpeechProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeSpeechProvider(id, options);
}

/** Create the speechToText fake (deterministic text). TEST FIXTURE — NEVER production. */
export function makeFakeTranscribeProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeTranscribeProvider(id, options);
}

/** Create the dubbing fake (typed spec from track duration). TEST FIXTURE — NEVER production. */
export function makeFakeDubbingProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeDubbingProvider(id, options);
}

/** Create the commentary fake (deterministic text). TEST FIXTURE — NEVER production. */
export function makeFakeCommentaryProvider(
  id: string,
  options: FakeTransformationProviderOptions = {},
): FakeTransformationProvider {
  return new FakeCommentaryProvider(id, options);
}
