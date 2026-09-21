/**
 * @wfx/model-fabric — R23-F media-intelligence artifact-contract tests.
 *
 * The typed artifact contracts for the ingestion/indexing pipeline, at
 * the shared seam:
 * - the frozen stage chain (source media -> ... -> feature publication);
 * - the honest provenance law: EVERY artifact carries its
 *   confidence/provenance/model metadata block (guards + bounds);
 * - the per-artifact shapes: transcript segments (timestamps, optional
 *   speaker labels, language), speech/acoustic events, chapters/scenes,
 *   visual concepts/entities, video+text embeddings (dimensions ===
 *   vector length), searchable moments, the canonical semantic index;
 * - the closed minimum derived-artifact union (exactly the plan's list);
 * - validation: drift is rejected, never coerced (bad timestamps, bad
 *   confidence, dimension mismatch, empty lists, foreign-item index);
 * - coverage: the machine-checkable minimum-set audit (partial sets
 *   degrade honestly; the full minimum is typed truth, not aspiration).
 */

import { describe, expect, it } from "bun:test";

import {
  DERIVED_ARTIFACT_KINDS,
  MEDIA_INTELLIGENCE_STAGES,
  SOURCE_PROVIDED_MODEL_ID,
  isArtifactModelMetadata,
  isDerivedArtifactKind,
  isEmbeddingVector,
  isMediaIntelligenceStage,
  isSearchableMoment,
  isSpeechAcousticEvent,
  isMediaTranscriptSegment,
  isVisualConceptEntity,
  mediaIntelligenceArtifactCoverage,
  meetsMinimumMediaIntelligence,
  validateMediaIntelligenceArtifacts,
  type ArtifactModelMetadata,
  type MediaIntelligenceArtifacts,
} from "../src/index";

const T0 = "2026-09-21T12:00:00.000Z";

function provenance(
  overrides: Partial<ArtifactModelMetadata> = {},
): ArtifactModelMetadata {
  return {
    stage: "transcription",
    modelId: "moss-transcribe-diarize",
    modelRevision: "v1.0.0",
    confidence: 0.92,
    producedAt: T0,
    ...overrides,
  };
}

/** The full-minimum artifact set (a well-derived item). */
function fullArtifacts(): MediaIntelligenceArtifacts {
  return {
    itemId: "wfxitm_demo0001",
    transcript: {
      kind: "transcript",
      segments: [
        {
          startMs: 0,
          endMs: 4_000,
          text: "Welcome to the show.",
          language: "en",
          speakerLabel: "Speaker 1",
        },
        {
          startMs: 4_000,
          endMs: 9_500,
          text: "Today we are cooking.",
          language: "en",
        },
      ],
      language: "en",
      model: provenance({ confidence: 0.94 }),
    },
    speechEvents: {
      kind: "speech-events",
      events: [
        { kind: "speaker", label: "Speaker 1", startMs: 0, endMs: 4_000 },
        { kind: "acoustic", event: "music", startMs: 9_500, endMs: 12_000, confidence: 0.81 },
      ],
      model: provenance({ stage: "speech-events", confidence: 0.88 }),
    },
    chaptersScenes: {
      kind: "chapters-scenes",
      units: [
        { kind: "chapter", startMs: 0, endMs: 60_000, title: "Intro", summary: "The host welcomes the audience." },
        { kind: "scene", startMs: 60_000, endMs: 120_000 },
      ],
      model: provenance({ stage: "structural-analysis", modelId: "qwen2.5-vl-7b-instruct", confidence: 0.79 }),
    },
    visualConcepts: {
      kind: "visual-concepts",
      detections: [
        { name: "kitchen", kind: "concept", confidence: 0.97, startMs: 60_000, endMs: 120_000 },
        { name: "Eiffel Tower", kind: "entity", confidence: 0.64 },
      ],
      model: provenance({ stage: "video-embeddings", modelId: "videoprism-base-f16r288", confidence: 0.9 }),
    },
    videoEmbedding: {
      kind: "video-embedding",
      embedding: { vector: [0.1, -0.2, 0.3, 0.4], dimensions: 4 },
      model: provenance({ stage: "video-embeddings", modelId: "videoprism-base-f16r288", confidence: 0.9 }),
    },
    textEmbedding: {
      kind: "text-embedding",
      embedding: { vector: [0.5, 0.25, -0.1, 0.05], dimensions: 4 },
      language: "en",
      model: provenance({ stage: "text-embeddings", modelId: "bge-m3", confidence: 0.95 }),
    },
    searchableMoments: {
      kind: "searchable-moments",
      moments: [
        {
          startMs: 60_000,
          endMs: 72_000,
          description: "The host starts cooking in the kitchen",
          matchedText: "Today we are cooking.",
          score: 0.87,
        },
      ],
      model: provenance({ stage: "semantic-index", modelId: "bge-m3", confidence: 0.87 }),
    },
    semanticIndex: {
      kind: "semantic-index",
      itemId: "wfxitm_demo0001",
      entries: [
        {
          text: "Welcome to the show.",
          language: "en",
          span: { startMs: 0, endMs: 4_000 },
          source: "transcript-segment",
          embedding: provenance({ stage: "text-embeddings", modelId: "bge-m3" }),
        },
        {
          text: "The host welcomes the audience.",
          language: "en",
          span: null,
          source: "chapter",
        },
      ],
      buildProvenance: [
        provenance({ stage: "transcription", modelId: "moss-transcribe-diarize" }),
        provenance({ stage: "text-embeddings", modelId: "bge-m3" }),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// The stage chain
// ---------------------------------------------------------------------------

describe("R23-F — the frozen stage chain", () => {
  it("the chain is exactly the plan's pipeline direction, in order", () => {
    expect(MEDIA_INTELLIGENCE_STAGES).toEqual([
      "source-media",
      "audio-extraction",
      "transcription",
      "speech-events",
      "structural-analysis",
      "video-embeddings",
      "text-embeddings",
      "semantic-index",
      "feature-publication",
    ]);
  });

  it("the stage guard is closed", () => {
    for (const stage of MEDIA_INTELLIGENCE_STAGES) {
      expect(isMediaIntelligenceStage(stage)).toBe(true);
    }
    expect(isMediaIntelligenceStage("transcription-model")).toBe(false);
    expect(isMediaIntelligenceStage("")).toBe(false);
    expect(isMediaIntelligenceStage(1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The honest provenance law
// ---------------------------------------------------------------------------

describe("R23-F — the honest provenance law", () => {
  it("a usable provenance block names stage, model, confidence, time", () => {
    expect(isArtifactModelMetadata(provenance())).toBe(true);
    const noRevision: ArtifactModelMetadata = {
      stage: "transcription",
      modelId: "moss-transcribe-diarize",
      confidence: 0.9,
      producedAt: T0,
    };
    expect(isArtifactModelMetadata(noRevision)).toBe(true);
    // source-provided truth is honest provenance too.
    expect(
      isArtifactModelMetadata(
        provenance({ modelId: SOURCE_PROVIDED_MODEL_ID, stage: "source-media", confidence: 1 }),
      ),
    ).toBe(true);
  });

  it("provenance guards reject the dishonest shapes", () => {
    // Unknown stage, empty model, out-of-bounds confidence, missing time.
    expect(isArtifactModelMetadata(provenance({ stage: "magic" as never }))).toBe(false);
    expect(isArtifactModelMetadata(provenance({ modelId: "" }))).toBe(false);
    expect(isArtifactModelMetadata(provenance({ confidence: 1.01 }))).toBe(false);
    expect(isArtifactModelMetadata(provenance({ confidence: -0.1 }))).toBe(false);
    expect(
      isArtifactModelMetadata(provenance({ confidence: Number.NaN })),
    ).toBe(false);
    expect(
      isArtifactModelMetadata(provenance({ producedAt: "" })),
    ).toBe(false);
    expect(isArtifactModelMetadata(null)).toBe(false);
    expect(isArtifactModelMetadata("moss")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The per-artifact shapes
// ---------------------------------------------------------------------------

describe("R23-F — the per-artifact shape guards", () => {
  it("transcript segments: timestamps, text, language, optional speaker", () => {
    expect(
      isMediaTranscriptSegment({ startMs: 0, endMs: 10, text: "hi", language: "en" }),
    ).toBe(true);
    expect(
      isMediaTranscriptSegment({
        startMs: 0,
        endMs: 10,
        text: "hi",
        language: "en",
        speakerLabel: "Speaker 1",
      }),
    ).toBe(true);
    // End before start, negative start, empty text/language, empty label.
    expect(
      isMediaTranscriptSegment({ startMs: 10, endMs: 0, text: "hi", language: "en" }),
    ).toBe(false);
    expect(
      isMediaTranscriptSegment({ startMs: -1, endMs: 10, text: "hi", language: "en" }),
    ).toBe(false);
    expect(
      isMediaTranscriptSegment({ startMs: 0, endMs: 10, text: "", language: "en" }),
    ).toBe(false);
    expect(
      isMediaTranscriptSegment({ startMs: 0, endMs: 10, text: "hi", language: "" }),
    ).toBe(false);
    expect(
      isMediaTranscriptSegment({
        startMs: 0,
        endMs: 10,
        text: "hi",
        language: "en",
        speakerLabel: "",
      }),
    ).toBe(false);
  });

  it("speech/acoustic events: speaker labels and bounded acoustic confidence", () => {
    expect(
      isSpeechAcousticEvent({ kind: "speaker", label: "S1", startMs: 0, endMs: 5 }),
    ).toBe(true);
    expect(
      isSpeechAcousticEvent({ kind: "acoustic", event: "music", startMs: 0, endMs: 5, confidence: 0.5 }),
    ).toBe(true);
    expect(
      isSpeechAcousticEvent({ kind: "acoustic", event: "music", startMs: 0, endMs: 5, confidence: 1.5 }),
    ).toBe(false);
    expect(
      isSpeechAcousticEvent({ kind: "speaker", label: "", startMs: 0, endMs: 5 }),
    ).toBe(false);
    expect(isSpeechAcousticEvent({ kind: "other", startMs: 0, endMs: 5 })).toBe(false);
  });

  it("visual concepts/entities: bounded confidence, lawful spans", () => {
    expect(
      isVisualConceptEntity({ name: "kitchen", kind: "concept", confidence: 0.9 }),
    ).toBe(true);
    expect(
      isVisualConceptEntity({
        name: "Eiffel Tower",
        kind: "entity",
        confidence: 0.6,
        startMs: 10,
        endMs: 20,
      }),
    ).toBe(true);
    expect(
      isVisualConceptEntity({ name: "kitchen", kind: "place", confidence: 0.9 }),
    ).toBe(false);
    expect(
      isVisualConceptEntity({ name: "", kind: "concept", confidence: 0.9 }),
    ).toBe(false);
    expect(
      isVisualConceptEntity({ name: "x", kind: "concept", confidence: 1.2 }),
    ).toBe(false);
    // End before start is drift.
    expect(
      isVisualConceptEntity({
        name: "x",
        kind: "concept",
        confidence: 0.9,
        startMs: 20,
        endMs: 10,
      }),
    ).toBe(false);
  });

  it("embedding vectors: dimensions === vector length, finite components", () => {
    expect(isEmbeddingVector({ vector: [0.1, 0.2], dimensions: 2 })).toBe(true);
    expect(isEmbeddingVector({ vector: [0.1, 0.2], dimensions: 3 })).toBe(false);
    expect(isEmbeddingVector({ vector: [], dimensions: 0 })).toBe(false);
    expect(isEmbeddingVector({ vector: [0.1, Number.NaN], dimensions: 2 })).toBe(
      false,
    );
    expect(isEmbeddingVector({ vector: [0.1], dimensions: "1" as never })).toBe(
      false,
    );
  });

  it("searchable moments: spans, descriptions, bounded scores", () => {
    expect(
      isSearchableMoment({
        startMs: 0,
        endMs: 10,
        description: "The chase begins",
        matchedText: "the chase",
        score: 0.4,
      }),
    ).toBe(true);
    expect(
      isSearchableMoment({ startMs: 0, endMs: 10, description: "d" }),
    ).toBe(true);
    expect(
      isSearchableMoment({ startMs: 10, endMs: 0, description: "d" }),
    ).toBe(false);
    expect(
      isSearchableMoment({ startMs: 0, endMs: 10, description: "" }),
    ).toBe(false);
    expect(
      isSearchableMoment({ startMs: 0, endMs: 10, description: "d", score: 1.5 }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("R23-F — artifact-set validation (drift rejected, never coerced)", () => {
  it("the full-minimum set validates clean", () => {
    const result = validateMediaIntelligenceArtifacts(fullArtifacts());
    expect(result.ok).toBe(true);
  });

  it("an empty set (nothing derived yet) validates clean — absence is honest", () => {
    const result = validateMediaIntelligenceArtifacts({ itemId: "wfxitm_demo0001" });
    expect(result.ok).toBe(true);
  });

  it("a foreign-item semantic index is drift", () => {
    const artifacts = fullArtifacts();
    const drifted = {
      ...artifacts,
      semanticIndex: {
        ...artifacts.semanticIndex!,
        itemId: "wfxitm_other999",
      },
    };
    const result = validateMediaIntelligenceArtifacts(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes("semanticIndex.itemId"))).toBe(
        true,
    );
    }
  });

  it("an invalid provenance block inside any artifact is drift", () => {
    const artifacts = fullArtifacts();
    const drifted = {
      ...artifacts,
      transcript: {
        ...artifacts.transcript!,
        model: provenance({ confidence: 2 }),
      },
    };
    const result = validateMediaIntelligenceArtifacts(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toContain("transcript.model: invalid provenance block");
    }
  });

  it("a dimension-mismatched embedding is drift", () => {
    const artifacts = fullArtifacts();
    const drifted = {
      ...artifacts,
      videoEmbedding: {
        ...artifacts.videoEmbedding!,
        embedding: { vector: [0.1, 0.2, 0.3], dimensions: 4 },
      },
    };
    const result = validateMediaIntelligenceArtifacts(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((p) => p.startsWith("videoEmbedding.embedding")),
      ).toBe(true);
    }
  });

  it("an empty derived list is drift (kind present, content absent)", () => {
    const artifacts = fullArtifacts();
    const drifted = {
      ...artifacts,
      searchableMoments: { ...artifacts.searchableMoments!, moments: [] },
    };
    const result = validateMediaIntelligenceArtifacts(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((p) => p.includes("searchableMoments.moments")),
      ).toBe(true);
    }
  });

  it("an index without build provenance is drift (never a fake indexer identity)", () => {
    const artifacts = fullArtifacts();
    const drifted = {
      ...artifacts,
      semanticIndex: { ...artifacts.semanticIndex!, buildProvenance: [] },
    };
    const result = validateMediaIntelligenceArtifacts(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((p) => p.includes("buildProvenance")),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage (the minimum-set audit)
// ---------------------------------------------------------------------------

describe("R23-F — the minimum-set coverage audit", () => {
  it("the derived-artifact union is EXACTLY the plan's minimum list", () => {
    expect(DERIVED_ARTIFACT_KINDS).toEqual([
      "transcript-segments",
      "speaker-labels",
      "language",
      "chapters-scenes",
      "visual-concepts-entities",
      "semantic-video-embedding",
      "transcript-text-embedding",
      "searchable-moments",
      "confidence-provenance-model-metadata",
    ]);
    for (const kind of DERIVED_ARTIFACT_KINDS) {
      expect(isDerivedArtifactKind(kind)).toBe(true);
    }
    expect(isDerivedArtifactKind("shot-list")).toBe(false);
  });

  it("the full set meets the minimum (every kind covered)", () => {
    const coverage = mediaIntelligenceArtifactCoverage(fullArtifacts());
    for (const kind of DERIVED_ARTIFACT_KINDS) {
      expect(coverage[kind]).toBe(true);
    }
    expect(meetsMinimumMediaIntelligence(fullArtifacts())).toBe(true);
  });

  it("a partial set degrades honestly (absent artifacts are absent)", () => {
    const full = fullArtifacts();
    const transcript = full.transcript!;
    const partial: MediaIntelligenceArtifacts = {
      itemId: "wfxitm_demo0001",
      transcript,
    };
    const coverage = mediaIntelligenceArtifactCoverage(partial);
    expect(coverage["transcript-segments"]).toBe(true);
    expect(coverage["language"]).toBe(true);
    expect(coverage["speaker-labels"]).toBe(true); // the transcript carries one labeled segment
    expect(coverage["chapters-scenes"]).toBe(false);
    expect(coverage["visual-concepts-entities"]).toBe(false);
    expect(coverage["semantic-video-embedding"]).toBe(false);
    expect(coverage["transcript-text-embedding"]).toBe(false);
    expect(coverage["searchable-moments"]).toBe(false);
    expect(coverage["confidence-provenance-model-metadata"]).toBe(true);
    expect(meetsMinimumMediaIntelligence(partial)).toBe(false);
  });

  it("the nothing-derived set covers nothing but still validates", () => {
    const bare: MediaIntelligenceArtifacts = { itemId: "wfxitm_demo0001" };
    const coverage = mediaIntelligenceArtifactCoverage(bare);
    for (const kind of DERIVED_ARTIFACT_KINDS) {
      if (kind !== "confidence-provenance-model-metadata") {
        expect(coverage[kind]).toBe(false);
      }
    }
    expect(coverage["confidence-provenance-model-metadata"]).toBe(true);
    expect(meetsMinimumMediaIntelligence(bare)).toBe(false);
  });

  it("a semantic index alone satisfies searchable-moments coverage (the stage-8 superset)", () => {
    const full = fullArtifacts();
    const semanticIndex = full.semanticIndex!;
    const indexedOnly: MediaIntelligenceArtifacts = {
      itemId: "wfxitm_demo0001",
      semanticIndex,
    };
    const coverage = mediaIntelligenceArtifactCoverage(indexedOnly);
    expect(coverage["searchable-moments"]).toBe(true);
  });

  it("speaker-labels coverage also flows from diarization events", () => {
    const full = fullArtifacts();
    const speechEvents = full.speechEvents!;
    const eventsOnly: MediaIntelligenceArtifacts = {
      itemId: "wfxitm_demo0001",
      speechEvents,
    };
    const coverage = mediaIntelligenceArtifactCoverage(eventsOnly);
    expect(coverage["speaker-labels"]).toBe(true);
  });

  it("an invalid set fails the provenance kind too (the audit is honest)", () => {
    const drifted = {
      ...fullArtifacts(),
      transcript: {
        ...fullArtifacts().transcript!,
        model: provenance({ confidence: 7 }),
      },
    };
    const coverage = mediaIntelligenceArtifactCoverage(drifted);
    expect(coverage["confidence-provenance-model-metadata"]).toBe(false);
    expect(meetsMinimumMediaIntelligence(drifted)).toBe(false);
  });
});
