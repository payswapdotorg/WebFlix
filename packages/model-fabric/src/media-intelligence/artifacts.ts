/**
 * @wfx/model-fabric — the media intelligence artifact contracts (R23-F).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-F): the
 * ingestion/indexing pipeline's DERIVED ARTIFACTS are TYPED CONTRACTS
 * with HONEST PROVENANCE — typed shapes + provenance, NOT a pipeline
 * implementation. The pipeline direction is frozen as the ordered stage
 * chain:
 *
 *   source/playable media -> audio extraction -> streaming/batch
 *   transcript -> speaker/acoustic events -> scene/chapter analysis ->
 *   visual/video embeddings -> multilingual text embeddings -> canonical
 *   semantic index -> recommendation/search features.
 *
 * THE MINIMUM DERIVED-ARTIFACT SET (the plan's list, frozen as the
 * closed {@link DerivedArtifactKind} union — every artifact set is
 * auditable against it by
 * {@link mediaIntelligenceArtifactCoverage}):
 *
 *   transcript segments with timestamps; optional speaker labels;
 *   language; chapters/scenes; visual concepts/entities; semantic video
 *   embedding; transcript/text embedding; searchable moments;
 *   confidence/provenance/model metadata.
 *
 * THE HONEST PROVENANCE LAW: every artifact carries its
 * {@link ArtifactModelMetadata} — WHICH model (id + revision) produced
 * it, WHEN, at WHAT confidence. Absent artifacts are ABSENT (never
 * fabricated placeholders); a derived artifact never claims a provenance
 * it does not carry; confidence outside [0, 1] is drift (rejected by
 * validation). Model ids referenced here are Model Fabric provider ids
 * (the R23-J open-model entries carry their real licenses — the license
 * truth flows through the registry, not through these shapes).
 *
 * WHAT THIS MODULE IS: PURE typed shapes + validation + coverage
 * derivations. No extraction, no model invocation, no indexing engine —
 * the pipeline implementation (streaming ASR, diarization, embedding
 * computation) arrives through Model Fabric providers in R23-G/H; this
 * module is the CONTRACT those providers' outputs must satisfy.
 */

import type { TranscriptSegment } from "../transform/subtitle";

// ---------------------------------------------------------------------------
// The stage chain (the pipeline direction, frozen)
// ---------------------------------------------------------------------------

/**
 * One stage of the media intelligence pipeline, in frozen chain order.
 * The chain names DIRECTION (what feeds what); it is not an execution
 * engine. `source-media` is the intake truth; `feature-publication` is
 * where derived signals become recommendation/search features (owned by
 * the Recommendation OS through the R23-H feature contracts — models
 * generate FEATURES/SIGNALS, never user policy).
 */
export type MediaIntelligenceStage =
  | "source-media"
  | "audio-extraction"
  | "transcription"
  | "speech-events"
  | "structural-analysis"
  | "video-embeddings"
  | "text-embeddings"
  | "semantic-index"
  | "feature-publication";

/** Every value of {@link MediaIntelligenceStage}, in chain order. */
export const MEDIA_INTELLIGENCE_STAGES: readonly MediaIntelligenceStage[] = [
  "source-media",
  "audio-extraction",
  "transcription",
  "speech-events",
  "structural-analysis",
  "video-embeddings",
  "text-embeddings",
  "semantic-index",
  "feature-publication",
] as const;

/** Runtime membership check against the stage union. */
export function isMediaIntelligenceStage(
  x: unknown,
): x is MediaIntelligenceStage {
  return (
    typeof x === "string" &&
    (MEDIA_INTELLIGENCE_STAGES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Artifact model metadata (the honest provenance every artifact carries)
// ---------------------------------------------------------------------------

/**
 * The provenance block EVERY derived artifact carries — the
 * confidence/provenance/model-metadata contract:
 *
 * - `stage` — the pipeline stage that produced the artifact;
 * - `modelId` — the Model Fabric provider id that produced it (a real
 *   registry id; the string `"source-provided"` marks truth that came
 *   WITH the media rather than being derived — e.g. an upstream
 *   official transcript — still honest provenance, never a fabricated
 *   model);
 * - `modelRevision` — the model's revision/pin when the provider
 *   declares one (the R23-J open-model revision field);
 * - `confidence` — the producing model's own confidence for this
 *   artifact, in [0, 1];
 * - `producedAt` — full ISO 8601 datetime string (UTC).
 */
export interface ArtifactModelMetadata {
  readonly stage: MediaIntelligenceStage;
  readonly modelId: string;
  readonly modelRevision?: string;
  readonly confidence: number;
  readonly producedAt: string;
}

/** The id marking truth that arrived WITH the media (not derived). */
export const SOURCE_PROVIDED_MODEL_ID = "source-provided";

/** Structural guard for a claimed provenance block. */
export function isArtifactModelMetadata(
  x: unknown,
): x is ArtifactModelMetadata {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (!isMediaIntelligenceStage(record.stage)) return false;
  if (typeof record.modelId !== "string" || record.modelId.length === 0) {
    return false;
  }
  if (
    record.modelRevision !== undefined &&
    typeof record.modelRevision !== "string"
  ) {
    return false;
  }
  if (
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    return false;
  }
  return typeof record.producedAt === "string" && record.producedAt.length > 0;
}

// ---------------------------------------------------------------------------
// Transcript segments (timestamps + optional speaker labels + language)
// ---------------------------------------------------------------------------

/**
 * One intelligence-pipeline transcript segment: the transform module's
 * timed-text `TranscriptSegment` (startMs/endMs/text — the shared core)
 * EXTENDED with the R23-F truths — the segment's language tag
 * (BCP-47-style, non-empty) and an OPTIONAL speaker label (present iff
 * diarization ran and attributed the span). The name stays distinct
 * from the subtitle core so both exports remain unambiguous.
 */
export interface MediaTranscriptSegment extends TranscriptSegment {
  /** The segment's language tag (e.g. "en", "zh-CN"). */
  readonly language: string;
  /** Present iff diarization attributed this span to a speaker. */
  readonly speakerLabel?: string;
}

/** Structural guard for a claimed intelligence transcript segment. */
export function isMediaTranscriptSegment(x: unknown): x is MediaTranscriptSegment {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (
    typeof record.startMs !== "number" ||
    !Number.isFinite(record.startMs) ||
    record.startMs < 0
  ) {
    return false;
  }
  if (
    typeof record.endMs !== "number" ||
    !Number.isFinite(record.endMs) ||
    record.endMs < record.startMs
  ) {
    return false;
  }
  if (typeof record.text !== "string" || record.text.length === 0) return false;
  if (typeof record.language !== "string" || record.language.length === 0) {
    return false;
  }
  return (
    record.speakerLabel === undefined ||
    (typeof record.speakerLabel === "string" && record.speakerLabel.length > 0)
  );
}

/** The transcript artifact: ordered segments + provenance. */
export interface TranscriptArtifact {
  readonly kind: "transcript";
  /** Segments in temporal order (non-empty once derived). */
  readonly segments: readonly MediaTranscriptSegment[];
  /** The transcript's dominant language tag. */
  readonly language: string;
  /** Honest provenance (which ASR produced it, when, at what confidence). */
  readonly model: ArtifactModelMetadata;
}

// ---------------------------------------------------------------------------
// Speaker / acoustic events
// ---------------------------------------------------------------------------

/**
 * One speech/acoustic event derived from the audio: a SPEAKER span
 * (diarization attributed a label/turn) or an ACOUSTIC event (non-speech
 * sound the model detected — laughter, music, applause...).
 */
export type SpeechAcousticEvent =
  | {
      kind: "speaker";
      /** The attributed speaker label (non-empty). */
      readonly label: string;
      readonly startMs: number;
      readonly endMs: number;
    }
  | {
      kind: "acoustic";
      /** The detected acoustic event's name (non-empty, model vocabulary). */
      readonly event: string;
      readonly startMs: number;
      readonly endMs: number;
      /** The detection confidence in [0, 1]. */
      readonly confidence: number;
    };

/** Structural guard for a claimed speech/acoustic event. */
export function isSpeechAcousticEvent(
  x: unknown,
): x is SpeechAcousticEvent {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (
    typeof record.startMs !== "number" ||
    !Number.isFinite(record.startMs) ||
    record.startMs < 0
  ) {
    return false;
  }
  if (
    typeof record.endMs !== "number" ||
    !Number.isFinite(record.endMs) ||
    record.endMs < record.startMs
  ) {
    return false;
  }
  if (record.kind === "speaker") {
    return typeof record.label === "string" && record.label.length > 0;
  }
  if (record.kind === "acoustic") {
    return (
      typeof record.event === "string" &&
      record.event.length > 0 &&
      typeof record.confidence === "number" &&
      Number.isFinite(record.confidence) &&
      record.confidence >= 0 &&
      record.confidence <= 1
    );
  }
  return false;
}

/** The speaker/acoustic-events artifact: ordered events + provenance. */
export interface SpeechEventsArtifact {
  readonly kind: "speech-events";
  /** Events in temporal order. */
  readonly events: readonly SpeechAcousticEvent[];
  /** Honest provenance (which diarization/acoustic model produced them). */
  readonly model: ArtifactModelMetadata;
}

// ---------------------------------------------------------------------------
// Chapters / scenes
// ---------------------------------------------------------------------------

/**
 * One structural unit of the item: a CHAPTER (coarse, editorial) or a
 * SCENE (fine, visually detected), with optional title/summary.
 */
export interface ChapterScene {
  /** The unit's granularity. */
  readonly kind: "chapter" | "scene";
  readonly startMs: number;
  readonly endMs: number;
  /** Present when the model or source provided a title. */
  readonly title?: string;
  /** Present when the model produced a one-sentence summary. */
  readonly summary?: string;
}

/** Structural guard for a claimed chapter/scene. */
export function isChapterScene(x: unknown): x is ChapterScene {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (record.kind !== "chapter" && record.kind !== "scene") return false;
  if (
    typeof record.startMs !== "number" ||
    !Number.isFinite(record.startMs) ||
    record.startMs < 0
  ) {
    return false;
  }
  if (
    typeof record.endMs !== "number" ||
    !Number.isFinite(record.endMs) ||
    record.endMs < record.startMs
  ) {
    return false;
  }
  if (record.title !== undefined && typeof record.title !== "string") {
    return false;
  }
  return (
    record.summary === undefined || typeof record.summary === "string"
  );
}

/** The chapters/scenes artifact: ordered units + provenance. */
export interface ChaptersScenesArtifact {
  readonly kind: "chapters-scenes";
  /** Units in temporal order (non-empty once derived). */
  readonly units: readonly ChapterScene[];
  /** Honest provenance (which structural-analysis model produced them). */
  readonly model: ArtifactModelMetadata;
}

// ---------------------------------------------------------------------------
// Visual concepts / entities
// ---------------------------------------------------------------------------

/**
 * One visual concept or entity detected in the item's video: WHAT was
 * recognized (a concept like "kitchen" or an entity like "Eiffel
 * Tower"), at what confidence, optionally pinned to a temporal span
 * (absent = item-global).
 */
export interface VisualConceptEntity {
  /** The detected concept or entity name (model vocabulary, non-empty). */
  readonly name: string;
  /** Whether the name is a generic concept or a specific entity. */
  readonly kind: "concept" | "entity";
  /** Detection confidence in [0, 1]. */
  readonly confidence: number;
  /** Span start within the item, in milliseconds (>= 0). */
  readonly startMs?: number;
  /** Span end within the item, in milliseconds (>= startMs). */
  readonly endMs?: number;
}

/** Structural guard for a claimed visual concept/entity. */
export function isVisualConceptEntity(
  x: unknown,
): x is VisualConceptEntity {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.length === 0) return false;
  if (record.kind !== "concept" && record.kind !== "entity") return false;
  if (
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    return false;
  }
  if (
    record.startMs !== undefined &&
    (typeof record.startMs !== "number" ||
      !Number.isFinite(record.startMs) ||
      record.startMs < 0)
  ) {
    return false;
  }
  if (record.endMs !== undefined) {
    if (
      typeof record.endMs !== "number" ||
      !Number.isFinite(record.endMs) ||
      record.endMs < 0
    ) {
      return false;
    }
    if (record.startMs !== undefined && record.endMs < record.startMs) {
      return false;
    }
  }
  return true;
}

/** The visual concepts/entities artifact + provenance. */
export interface VisualConceptsArtifact {
  readonly kind: "visual-concepts";
  /** Detections (non-empty once derived). */
  readonly detections: readonly VisualConceptEntity[];
  /** Honest provenance (which visual model produced them). */
  readonly model: ArtifactModelMetadata;
}

// ---------------------------------------------------------------------------
// Embeddings (semantic video + multilingual transcript text)
// ---------------------------------------------------------------------------

/**
 * One embedding vector with its dimensional contract: the vector's
 * components must be finite, and `dimensions` must equal the vector's
 * length (the shape is the contract — a dimension mismatch is drift).
 */
export interface EmbeddingVector {
  /** The vector components (finite, non-empty). */
  readonly vector: readonly number[];
  /** The vector's dimensionality (=== vector.length). */
  readonly dimensions: number;
}

/** Structural guard for a claimed embedding vector. */
export function isEmbeddingVector(x: unknown): x is EmbeddingVector {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (!Array.isArray(record.vector) || record.vector.length === 0) return false;
  if (record.vector.some((c) => typeof c !== "number" || !Number.isFinite(c))) {
    return false;
  }
  return record.dimensions === record.vector.length;
}

/**
 * The semantic VIDEO embedding artifact: one dense vector summarizing
 * the item's (or a span's) visual semantics, with provenance naming the
 * embedding model (e.g. the VideoPrism-family open model that produced
 * it through Model Fabric).
 */
export interface VideoEmbeddingArtifact {
  readonly kind: "video-embedding";
  /** The embedding (dimensions === vector.length). */
  readonly embedding: EmbeddingVector;
  /** Span the vector summarizes; absent = the whole item. */
  readonly startMs?: number;
  readonly endMs?: number;
  /** Honest provenance (which video-embedding model produced it). */
  readonly model: ArtifactModelMetadata;
}

/**
 * The multilingual transcript/text embedding artifact: one dense vector
 * over the item's text (transcript and/or metadata), in a multilingual
 * embedding space (same-space queries and text compare across
 * languages), with provenance naming the embedding model (e.g. the
 * BGE-M3-family open model).
 */
export interface TextEmbeddingArtifact {
  readonly kind: "text-embedding";
  /** The embedding (dimensions === vector.length). */
  readonly embedding: EmbeddingVector;
  /** The embedded text's language tag. */
  readonly language: string;
  /** Honest provenance (which text-embedding model produced it). */
  readonly model: ArtifactModelMetadata;
}

// ---------------------------------------------------------------------------
// Searchable moments
// ---------------------------------------------------------------------------

/**
 * One searchable moment: a temporal span a natural-language query can
 * land on, with the honest text that matched (transcript segment,
 * chapter title/summary, or visual-event description) and an optional
 * match score in [0, 1].
 */
export interface SearchableMoment {
  readonly startMs: number;
  readonly endMs: number;
  /** The human-readable description of what happens in the span. */
  readonly description: string;
  /** The underlying text that matched (when the match was textual). */
  readonly matchedText?: string;
  /** Match relevance in [0, 1] (absent for enumerated, non-scored moments). */
  readonly score?: number;
}

/** Structural guard for a claimed searchable moment. */
export function isSearchableMoment(x: unknown): x is SearchableMoment {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (
    typeof record.startMs !== "number" ||
    !Number.isFinite(record.startMs) ||
    record.startMs < 0
  ) {
    return false;
  }
  if (
    typeof record.endMs !== "number" ||
    !Number.isFinite(record.endMs) ||
    record.endMs < record.startMs
  ) {
    return false;
  }
  if (
    typeof record.description !== "string" ||
    record.description.length === 0
  ) {
    return false;
  }
  if (
    record.matchedText !== undefined &&
    (typeof record.matchedText !== "string" || record.matchedText.length === 0)
  ) {
    return false;
  }
  if (record.score !== undefined) {
    if (
      typeof record.score !== "number" ||
      !Number.isFinite(record.score) ||
      record.score < 0 ||
      record.score > 1
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The searchable-moments artifact: the item's queryable moments +
 * provenance naming the model/stage that produced the moment set (the
 * semantic index fold — see {@link CanonicalSemanticIndex}).
 */
export interface SearchableMomentsArtifact {
  readonly kind: "searchable-moments";
  /** Moments in temporal order (non-empty once derived). */
  readonly moments: readonly SearchableMoment[];
  /** Honest provenance. */
  readonly model: ArtifactModelMetadata;
}

// ---------------------------------------------------------------------------
// The canonical semantic index (the stage-8 contract)
// ---------------------------------------------------------------------------

/**
 * One entry of the canonical semantic index: the searchable text of one
 * temporal unit (a transcript segment, a chapter/scene, or a visual
 * event description) with the unit's span and an OPTIONAL embedding
 * reference (the embedding itself lives in its own artifact; the index
 * entry records which one — by stage + model id — so the index stays
 * lightweight and honest).
 */
export interface SemanticIndexEntry {
  /** The entry's searchable text (non-empty). */
  readonly text: string;
  /** The unit's language tag (multilingual index entries). */
  readonly language: string;
  /** The unit's span; null for item-global entries. */
  readonly span: { readonly startMs: number; readonly endMs: number } | null;
  /** The unit's granularity (where it came from). */
  readonly source:
    | "transcript-segment"
    | "chapter"
    | "scene"
    | "visual-event"
    | "metadata";
  /** The embedding provenance when an embedding backs this entry. */
  readonly embedding?: ArtifactModelMetadata;
}

/**
 * The canonical semantic index: the item-scoped, stage-8 fold of every
 * derived artifact into searchable entries — the structure search-by-
 * meaning and moment search (R23-H) query. The index carries the
 * provenance of EVERY model that contributed (the build provenance —
 * honest multi-model lineage, never a single fake "indexer" identity).
 */
export interface CanonicalSemanticIndex {
  readonly kind: "semantic-index";
  /** The canonical item the index belongs to. */
  readonly itemId: string;
  /** Index entries (non-empty once built). */
  readonly entries: readonly SemanticIndexEntry[];
  /** The contributing models' provenance (at least one). */
  readonly buildProvenance: readonly ArtifactModelMetadata[];
}

// ---------------------------------------------------------------------------
// The derived-artifact minimum set (the plan's list, auditable)
// ---------------------------------------------------------------------------

/**
 * One kind of MINIMUM derived artifact — exactly the plan's R23-F list.
 * The union is the audit vocabulary: an artifact set's coverage against
 * it is machine-checkable
 * ({@link mediaIntelligenceArtifactCoverage}), so "minimum" is enforced
 * as typed truth, not aspiration.
 */
export type DerivedArtifactKind =
  | "transcript-segments"
  | "speaker-labels"
  | "language"
  | "chapters-scenes"
  | "visual-concepts-entities"
  | "semantic-video-embedding"
  | "transcript-text-embedding"
  | "searchable-moments"
  | "confidence-provenance-model-metadata";

/** Every value of {@link DerivedArtifactKind}, in plan order. */
export const DERIVED_ARTIFACT_KINDS: readonly DerivedArtifactKind[] = [
  "transcript-segments",
  "speaker-labels",
  "language",
  "chapters-scenes",
  "visual-concepts-entities",
  "semantic-video-embedding",
  "transcript-text-embedding",
  "searchable-moments",
  "confidence-provenance-model-metadata",
] as const;

/** Runtime membership check against the derived-artifact union. */
export function isDerivedArtifactKind(
  x: unknown,
): x is DerivedArtifactKind {
  return (
    typeof x === "string" &&
    (DERIVED_ARTIFACT_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The artifact set (the per-item derived truth)
// ---------------------------------------------------------------------------

/**
 * One item's derived media-intelligence truth: every artifact is
 * OPTIONAL (absent until derived — never a fabricated placeholder),
 * every present artifact carries honest provenance, and the set is
 * auditable against the minimum list by
 * {@link mediaIntelligenceArtifactCoverage}.
 */
export interface MediaIntelligenceArtifacts {
  /** The canonical item the artifacts belong to. */
  readonly itemId: string;
  /** Transcript segments with timestamps (+ language, + speaker labels where diarization ran). */
  readonly transcript?: TranscriptArtifact;
  /** Speaker/acoustic events (diarization + acoustic detection). */
  readonly speechEvents?: SpeechEventsArtifact;
  /** Chapters/scenes (structural analysis). */
  readonly chaptersScenes?: ChaptersScenesArtifact;
  /** Visual concepts/entities. */
  readonly visualConcepts?: VisualConceptsArtifact;
  /** Semantic video embedding. */
  readonly videoEmbedding?: VideoEmbeddingArtifact;
  /** Multilingual transcript/text embedding. */
  readonly textEmbedding?: TextEmbeddingArtifact;
  /** Searchable moments. */
  readonly searchableMoments?: SearchableMomentsArtifact;
  /** The canonical semantic index (the stage-8 fold). */
  readonly semanticIndex?: CanonicalSemanticIndex;
}

// ---------------------------------------------------------------------------
// Validation (honest shapes only — drift is rejected, never coerced)
// ---------------------------------------------------------------------------

/** The outcome of artifact-set validation. */
export type MediaIntelligenceValidation =
  | { ok: true }
  | { ok: false; problems: readonly string[] };

/**
 * Validate one artifact set against the frozen shapes: every present
 * artifact must carry a usable provenance block, every timestamp must
 * be a lawful span, every confidence in [0, 1], every embedding's
 * dimensions must match its vector, every list non-empty, and the
 * semantic index (when present) must belong to the same item. (Pure.)
 */
export function validateMediaIntelligenceArtifacts(
  artifacts: MediaIntelligenceArtifacts,
): MediaIntelligenceValidation {
  const problems: string[] = [];

  if (artifacts.itemId.length === 0) {
    problems.push("itemId: expected a non-empty canonical item id");
  }

  if (artifacts.transcript !== undefined) {
    const transcript = artifacts.transcript;
    if (transcript.kind !== "transcript") {
      problems.push("transcript.kind: expected 'transcript'");
    }
    if (transcript.segments.length === 0) {
      problems.push("transcript.segments: expected at least one segment");
    }
    transcript.segments.forEach((segment, index) => {
      if (!isMediaTranscriptSegment(segment)) {
        problems.push(
          `transcript.segments[${index}]: invalid segment shape (timestamps/text/language/speaker)`,
        );
      }
    });
    if (transcript.language.length === 0) {
      problems.push("transcript.language: expected a non-empty language tag");
    }
    if (!isArtifactModelMetadata(transcript.model)) {
      problems.push("transcript.model: invalid provenance block");
    }
  }

  if (artifacts.speechEvents !== undefined) {
    const speechEvents = artifacts.speechEvents;
    if (speechEvents.kind !== "speech-events") {
      problems.push("speechEvents.kind: expected 'speech-events'");
    }
    if (speechEvents.events.length === 0) {
      problems.push("speechEvents.events: expected at least one event");
    }
    speechEvents.events.forEach((event, index) => {
      if (!isSpeechAcousticEvent(event)) {
        problems.push(`speechEvents.events[${index}]: invalid event shape`);
      }
    });
    if (!isArtifactModelMetadata(speechEvents.model)) {
      problems.push("speechEvents.model: invalid provenance block");
    }
  }

  if (artifacts.chaptersScenes !== undefined) {
    const chaptersScenes = artifacts.chaptersScenes;
    if (chaptersScenes.kind !== "chapters-scenes") {
      problems.push("chaptersScenes.kind: expected 'chapters-scenes'");
    }
    if (chaptersScenes.units.length === 0) {
      problems.push("chaptersScenes.units: expected at least one unit");
    }
    chaptersScenes.units.forEach((unit, index) => {
      if (!isChapterScene(unit)) {
        problems.push(`chaptersScenes.units[${index}]: invalid unit shape`);
      }
    });
    if (!isArtifactModelMetadata(chaptersScenes.model)) {
      problems.push("chaptersScenes.model: invalid provenance block");
    }
  }

  if (artifacts.visualConcepts !== undefined) {
    const visualConcepts = artifacts.visualConcepts;
    if (visualConcepts.kind !== "visual-concepts") {
      problems.push("visualConcepts.kind: expected 'visual-concepts'");
    }
    if (visualConcepts.detections.length === 0) {
      problems.push("visualConcepts.detections: expected at least one detection");
    }
    visualConcepts.detections.forEach((detection, index) => {
      if (!isVisualConceptEntity(detection)) {
        problems.push(
          `visualConcepts.detections[${index}]: invalid detection shape`,
        );
      }
    });
    if (!isArtifactModelMetadata(visualConcepts.model)) {
      problems.push("visualConcepts.model: invalid provenance block");
    }
  }

  if (artifacts.videoEmbedding !== undefined) {
    const videoEmbedding = artifacts.videoEmbedding;
    if (videoEmbedding.kind !== "video-embedding") {
      problems.push("videoEmbedding.kind: expected 'video-embedding'");
    }
    if (!isEmbeddingVector(videoEmbedding.embedding)) {
      problems.push(
        "videoEmbedding.embedding: invalid vector (finite components, dimensions === length)",
      );
    }
    if (!isArtifactModelMetadata(videoEmbedding.model)) {
      problems.push("videoEmbedding.model: invalid provenance block");
    }
  }

  if (artifacts.textEmbedding !== undefined) {
    const textEmbedding = artifacts.textEmbedding;
    if (textEmbedding.kind !== "text-embedding") {
      problems.push("textEmbedding.kind: expected 'text-embedding'");
    }
    if (!isEmbeddingVector(textEmbedding.embedding)) {
      problems.push(
        "textEmbedding.embedding: invalid vector (finite components, dimensions === length)",
      );
    }
    if (textEmbedding.language.length === 0) {
      problems.push("textEmbedding.language: expected a non-empty language tag");
    }
    if (!isArtifactModelMetadata(textEmbedding.model)) {
      problems.push("textEmbedding.model: invalid provenance block");
    }
  }

  if (artifacts.searchableMoments !== undefined) {
    const searchableMoments = artifacts.searchableMoments;
    if (searchableMoments.kind !== "searchable-moments") {
      problems.push("searchableMoments.kind: expected 'searchable-moments'");
    }
    if (searchableMoments.moments.length === 0) {
      problems.push("searchableMoments.moments: expected at least one moment");
    }
    searchableMoments.moments.forEach((moment, index) => {
      if (!isSearchableMoment(moment)) {
        problems.push(
          `searchableMoments.moments[${index}]: invalid moment shape`,
        );
      }
    });
    if (!isArtifactModelMetadata(searchableMoments.model)) {
      problems.push("searchableMoments.model: invalid provenance block");
    }
  }

  if (artifacts.semanticIndex !== undefined) {
    const semanticIndex = artifacts.semanticIndex;
    if (semanticIndex.kind !== "semantic-index") {
      problems.push("semanticIndex.kind: expected 'semantic-index'");
    }
    if (semanticIndex.itemId !== artifacts.itemId) {
      problems.push(
        `semanticIndex.itemId: expected '${artifacts.itemId}' (the same canonical item), got '${semanticIndex.itemId}'`,
      );
    }
    if (semanticIndex.entries.length === 0) {
      problems.push("semanticIndex.entries: expected at least one entry");
    }
    semanticIndex.entries.forEach((entry, index) => {
      if (entry.text.length === 0) {
        problems.push(`semanticIndex.entries[${index}].text: expected non-empty`);
      }
      if (entry.language.length === 0) {
        problems.push(
          `semanticIndex.entries[${index}].language: expected a non-empty language tag`,
        );
      }
      if (
        entry.embedding !== undefined &&
        !isArtifactModelMetadata(entry.embedding)
      ) {
        problems.push(
          `semanticIndex.entries[${index}].embedding: invalid provenance block`,
        );
      }
    });
    if (semanticIndex.buildProvenance.length === 0) {
      problems.push(
        "semanticIndex.buildProvenance: expected at least one contributing model",
      );
    }
    if (
      !semanticIndex.buildProvenance.every((block) =>
        isArtifactModelMetadata(block),
      )
    ) {
      problems.push("semanticIndex.buildProvenance: invalid provenance block(s)");
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

// ---------------------------------------------------------------------------
// Coverage (the minimum-set audit)
// ---------------------------------------------------------------------------

/**
 * Audit one artifact set against the plan's MINIMUM derived-artifact
 * list (pure; the typed truth — never aspiration):
 * - `transcript-segments` — a transcript with at least one segment;
 * - `speaker-labels` — any transcript segment carries a speaker label,
 *   or speech events include speaker turns;
 * - `language` — the transcript declares its language;
 * - `chapters-scenes` — at least one chapter/scene unit;
 * - `visual-concepts-entities` — at least one detection;
 * - `semantic-video-embedding` — a video embedding artifact;
 * - `transcript-text-embedding` — a text embedding artifact;
 * - `searchable-moments` — at least one moment (or a semantic index with
 *   entries, the stage-8 superset);
 * - `confidence-provenance-model-metadata` — the set VALIDATES (every
 *   present artifact carries a usable provenance block).
 */
export function mediaIntelligenceArtifactCoverage(
  artifacts: MediaIntelligenceArtifacts,
): Readonly<Record<DerivedArtifactKind, boolean>> {
  const validation = validateMediaIntelligenceArtifacts(artifacts);
  const speakerLabels =
    (artifacts.transcript?.segments.some(
      (segment) => segment.speakerLabel !== undefined,
    ) ?? false) ||
    (artifacts.speechEvents?.events.some(
      (event) => event.kind === "speaker",
    ) ?? false);
  const moments =
    (artifacts.searchableMoments?.moments.length ?? 0) > 0 ||
    (artifacts.semanticIndex?.entries.length ?? 0) > 0;
  return {
    "transcript-segments": (artifacts.transcript?.segments.length ?? 0) > 0,
    "speaker-labels": speakerLabels,
    language: (artifacts.transcript?.language.length ?? 0) > 0,
    "chapters-scenes": (artifacts.chaptersScenes?.units.length ?? 0) > 0,
    "visual-concepts-entities":
      (artifacts.visualConcepts?.detections.length ?? 0) > 0,
    "semantic-video-embedding": artifacts.videoEmbedding !== undefined,
    "transcript-text-embedding": artifacts.textEmbedding !== undefined,
    "searchable-moments": moments,
    "confidence-provenance-model-metadata": validation.ok,
  };
}

/**
 * Does the artifact set meet the FULL minimum (every kind covered)?
 * (Pure; the completeness check the R23-H features' prerequisite audit
 * consumes — features degrade honestly over partial artifact sets,
 * never silently pretending completeness.)
 */
export function meetsMinimumMediaIntelligence(
  artifacts: MediaIntelligenceArtifacts,
): boolean {
  const coverage = mediaIntelligenceArtifactCoverage(artifacts);
  return (DERIVED_ARTIFACT_KINDS as readonly DerivedArtifactKind[]).every(
    (kind) => coverage[kind],
  );
}
