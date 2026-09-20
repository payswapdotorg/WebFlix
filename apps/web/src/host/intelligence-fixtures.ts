/**
 * @wfx/app-web — the DEV-ONLY media-intelligence fixture feed (R23-F
 * consumption, Worker 2's lane).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * This module exists ONLY in fixtures mode (`WFX_DEV_FIXTURES=1` — the
 * loud dev badge): deterministic media-intelligence ARTIFACT SETS typed
 * EXACTLY as Worker 1's frozen R23-F shapes (`MediaIntelligenceArtifacts`
 * from `@wfx/model-fabric`), carrying HONEST provenance — every artifact
 * names the catalog model that produced it (the model-fabric open-model
 * catalog's real ids: MOSS-Transcribe-Diarize for transcripts/diarization,
 * Qwen2.5-VL for structural analysis, VideoPrism for visual concepts +
 * video embeddings, BGE-M3 for multilingual text embeddings). In service
 * mode NOTHING here runs: the surfaces render their honest empty states
 * (a fixture is never silently presented as production capability).
 *
 * HONEST COVERAGE TRUTH: the fixture set deliberately exercises BOTH
 * sides of the R23-H prerequisite law — full artifact sets (search by
 * meaning + moments available) and PARTIAL sets (moments available,
 * meaning-search prerequisites honestly missing), so the surfaces'
 * typed `prerequisites-missing` states are real, not decorative.
 */

import type {
  ArtifactModelMetadata,
  MediaIntelligenceArtifacts,
} from "@wfx/model-fabric";

// ---------------------------------------------------------------------------
// The deterministic provenance blocks (catalog-truth model ids)
// ---------------------------------------------------------------------------

const T0 = "2026-09-18T12:00:00.000Z";

/** The batch ASR route's provenance (MOSS-Transcribe-Diarize, per the R23-G routing). */
const mossProvenance = (stage: ArtifactModelMetadata["stage"]): ArtifactModelMetadata => ({
  stage,
  modelId: "open-model:moss-transcribe-diarize",
  modelRevision: "research-2026-09-20",
  confidence: 0.94,
  producedAt: T0,
});

/** The structural-analysis provenance (Qwen2.5-VL, the R23-H contributor). */
const qwenProvenance: ArtifactModelMetadata = {
  stage: "structural-analysis",
  modelId: "open-model:qwen2.5-vl-7b-instruct",
  modelRevision: "research-2026-09-20",
  confidence: 0.88,
  producedAt: T0,
};

/** The visual/video-embedding provenance (VideoPrism). */
const videoprismProvenance: ArtifactModelMetadata = {
  stage: "video-embeddings",
  modelId: "open-model:videoprism-base-f16r288",
  modelRevision: "research-2026-09-20",
  confidence: 0.9,
  producedAt: T0,
};

/** The multilingual text-embedding provenance (BGE-M3). */
const bgeProvenance: ArtifactModelMetadata = {
  stage: "text-embeddings",
  modelId: "open-model:bge-m3",
  modelRevision: "research-2026-09-20",
  confidence: 0.91,
  producedAt: T0,
};

// ---------------------------------------------------------------------------
// Deep Field Diary (fake:video-1) — the FULL artifact set
// ---------------------------------------------------------------------------

const deepField: MediaIntelligenceArtifacts = {
  itemId: "wfxitm_deepfielddiary0000000000000",
  transcript: {
    kind: "transcript",
    language: "en",
    segments: [
      { startMs: 0, endMs: 6400, text: "The observatory wakes an hour before dusk — every dome, one checklist.", language: "en", speakerLabel: "Dr. Amara Osei" },
      { startMs: 6500, endMs: 15200, text: "First light is a ritual: cooling the sensors, opening the shutter, listening for the sky.", language: "en", speakerLabel: "Dr. Amara Osei" },
      { startMs: 15300, endMs: 24800, text: "A deep field is not one photograph. It is hours of the same patch of darkness, stacked.", language: "en", speakerLabel: "Dr. Amara Osei" },
      { startMs: 25000, endMs: 36000, text: "The long exposure begins. The telescope tracks a fixed point while the earth turns beneath it.", language: "en", speakerLabel: "Narrator" },
      { startMs: 36100, endMs: 45300, text: "Galaxies drift into view one by one — each smudge of light, an entire island of stars.", language: "en", speakerLabel: "Narrator" },
      { startMs: 45500, endMs: 55600, text: "You are not looking at a picture of space. You are looking back in time.", language: "en", speakerLabel: "Dr. Amara Osei" },
      { startMs: 55800, endMs: 64200, text: "The final stack resolves. Thousands of galaxies in a frame of sky you could cover with a grain of sand at arm's length.", language: "en", speakerLabel: "Narrator" },
      { startMs: 64300, endMs: 71400, text: "That is the gift of the long exposure: patience, made visible.", language: "en", speakerLabel: "Dr. Amara Osei" },
    ],
    model: mossProvenance("transcription"),
  },
  speechEvents: {
    kind: "speech-events",
    events: [
      { kind: "speaker", label: "Dr. Amara Osei", startMs: 0, endMs: 6400 },
      { kind: "speaker", label: "Dr. Amara Osei", startMs: 6500, endMs: 15200 },
      { kind: "acoustic", event: "observatory ambient hum", startMs: 15000, endMs: 25000, confidence: 0.81 },
      { kind: "speaker", label: "Narrator", startMs: 25000, endMs: 36000 },
      { kind: "speaker", label: "Narrator", startMs: 36100, endMs: 45300 },
      { kind: "acoustic", event: "shutter actuation", startMs: 46100, endMs: 46600, confidence: 0.9 },
      { kind: "speaker", label: "Dr. Amara Osei", startMs: 45500, endMs: 55600 },
      { kind: "acoustic", event: "applause", startMs: 64600, endMs: 67000, confidence: 0.86 },
    ],
    model: mossProvenance("speech-events"),
  },
  chaptersScenes: {
    kind: "chapters-scenes",
    units: [
      { kind: "chapter", startMs: 0, endMs: 24800, title: "Opening the observatory", summary: "The team wakes the telescope and opens the shutter for the night's deep-field run." },
      { kind: "chapter", startMs: 25000, endMs: 45300, title: "The long exposure", summary: "Hours of the same patch of darkness, stacked into a single image." },
      { kind: "chapter", startMs: 45500, endMs: 71400, title: "What the image revealed", summary: "The final stack resolves thousands of galaxies — patience, made visible." },
      { kind: "scene", startMs: 46100, endMs: 51000, title: "First light on the sensor", summary: "The shutter actuates and the first frames land." },
    ],
    model: qwenProvenance,
  },
  visualConcepts: {
    kind: "visual-concepts",
    detections: [
      { name: "observatory dome", kind: "concept", confidence: 0.97, startMs: 0, endMs: 24800 },
      { name: "telescope", kind: "concept", confidence: 0.95, startMs: 8000, endMs: 55000 },
      { name: "control room", kind: "concept", confidence: 0.86, startMs: 20000, endMs: 30000 },
      { name: "star field", kind: "concept", confidence: 0.98, startMs: 45500, endMs: 71400 },
      { name: "galaxy", kind: "concept", confidence: 0.93, startMs: 55800, endMs: 71400 },
      { name: "Very Large Telescope", kind: "entity", confidence: 0.71 },
    ],
    model: videoprismProvenance,
  },
  videoEmbedding: {
    kind: "video-embedding",
    embedding: { vector: [0.12, -0.34, 0.56, 0.08, -0.21, 0.44, 0.03, -0.18], dimensions: 8 },
    model: videoprismProvenance,
  },
  textEmbedding: {
    kind: "text-embedding",
    embedding: { vector: [0.22, -0.14, 0.41, 0.19, -0.33, 0.27, 0.11, -0.09], dimensions: 8 },
    language: "en",
    model: bgeProvenance,
  },
  searchableMoments: {
    kind: "searchable-moments",
    moments: [
      { startMs: 46100, endMs: 51000, description: "The shutter actuates and the first frames of the deep field land on the sensor.", matchedText: "The long exposure begins. The telescope tracks a fixed point while the earth turns beneath it.", score: 0.93 },
      { startMs: 55800, endMs: 64200, description: "The final stacked image resolves — thousands of galaxies in a patch of sky the size of a grain of sand.", matchedText: "The final stack resolves. Thousands of galaxies in a frame of sky you could cover with a grain of sand at arm's length.", score: 0.97 },
      { startMs: 0, endMs: 6400, description: "The observatory wakes an hour before dusk — the crew's opening checklist.", matchedText: "The observatory wakes an hour before dusk — every dome, one checklist.", score: 0.88 },
      { startMs: 45500, endMs: 55600, description: "Dr. Osei explains that a deep field is looking back in time, not at a picture.", matchedText: "You are not looking at a picture of space. You are looking back in time.", score: 0.95 },
      { startMs: 15300, endMs: 24800, description: "How a deep field is built: hours of the same patch of darkness, stacked.", matchedText: "A deep field is not one photograph. It is hours of the same patch of darkness, stacked.", score: 0.91 },
    ],
    model: {
      stage: "semantic-index",
      modelId: "open-model:bge-m3",
      modelRevision: "research-2026-09-20",
      confidence: 0.9,
      producedAt: T0,
    },
  },
  semanticIndex: {
    kind: "semantic-index",
    itemId: "wfxitm_deepfielddiary0000000000000",
    entries: [
      { text: "The observatory wakes an hour before dusk — every dome, one checklist.", language: "en", span: { startMs: 0, endMs: 6400 }, source: "transcript-segment" },
      { text: "First light is a ritual: cooling the sensors, opening the shutter, listening for the sky.", language: "en", span: { startMs: 6500, endMs: 15200 }, source: "transcript-segment" },
      { text: "A deep field is not one photograph. It is hours of the same patch of darkness, stacked.", language: "en", span: { startMs: 15300, endMs: 24800 }, source: "transcript-segment" },
      { text: "The long exposure begins. The telescope tracks a fixed point while the earth turns beneath it.", language: "en", span: { startMs: 25000, endMs: 36000 }, source: "transcript-segment" },
      { text: "Galaxies drift into view one by one — each smudge of light, an entire island of stars.", language: "en", span: { startMs: 36100, endMs: 45300 }, source: "transcript-segment" },
      { text: "You are not looking at a picture of space. You are looking back in time.", language: "en", span: { startMs: 45500, endMs: 55600 }, source: "transcript-segment" },
      { text: "Opening the observatory — the team wakes the telescope and opens the shutter for the night's deep-field run.", language: "en", span: { startMs: 0, endMs: 24800 }, source: "chapter" },
      { text: "The long exposure — hours of the same patch of darkness, stacked into a single image.", language: "en", span: { startMs: 25000, endMs: 45300 }, source: "chapter" },
      { text: "What the image revealed — the final stack resolves thousands of galaxies, patience made visible.", language: "en", span: { startMs: 45500, endMs: 71400 }, source: "chapter" },
      { text: "A space documentary about capturing a deep-field image of distant galaxies with patience and a telescope.", language: "en", span: null, source: "metadata", embedding: bgeProvenance },
    ],
    buildProvenance: [mossProvenance("transcription"), qwenProvenance, videoprismProvenance, bgeProvenance],
  },
};

// ---------------------------------------------------------------------------
// Asteroid Drift (fake:movie-1) — the FULL artifact set (a different flavor)
// ---------------------------------------------------------------------------

const asteroid: MediaIntelligenceArtifacts = {
  itemId: "wfxitm_asteroiddrift00000000000000",
  transcript: {
    kind: "transcript",
    language: "en",
    segments: [
      { startMs: 0, endMs: 7800, text: "Station-keeping is a lie we tell the asteroids. Drift is the truth.", language: "en", speakerLabel: "Captain Reyes" },
      { startMs: 7900, endMs: 17600, text: "The garden bay holds. Spin gravity does the rest.", language: "en", speakerLabel: "Navigator Ito" },
      { startMs: 17700, endMs: 28400, text: "Fuel for one burn. We spend it on the garden, not on caution.", language: "en", speakerLabel: "Captain Reyes" },
      { startMs: 28600, endMs: 39900, text: "The drift begins — slow, patient, unstoppable. The field opens ahead of us.", language: "en", speakerLabel: "Navigator Ito" },
      { startMs: 40100, endMs: 50800, text: "There. Riding the light. A garden the size of a moon.", language: "en", speakerLabel: "Navigator Ito" },
      { startMs: 51000, endMs: 61500, text: "Everyone gets one impossible thing. This one is ours.", language: "en", speakerLabel: "Captain Reyes" },
      { startMs: 61700, endMs: 71300, text: "The final burn. Hold onto something green.", language: "en", speakerLabel: "Captain Reyes" },
      { startMs: 71500, endMs: 78200, text: "And the asteroids let us pass.", language: "en", speakerLabel: "Navigator Ito" },
    ],
    model: mossProvenance("transcription"),
  },
  speechEvents: {
    kind: "speech-events",
    events: [
      { kind: "speaker", label: "Captain Reyes", startMs: 0, endMs: 7800 },
      { kind: "speaker", label: "Navigator Ito", startMs: 7900, endMs: 17600 },
      { kind: "speaker", label: "Captain Reyes", startMs: 17700, endMs: 28400 },
      { kind: "acoustic", event: "station ambience", startMs: 28600, endMs: 39900, confidence: 0.79 },
      { kind: "speaker", label: "Navigator Ito", startMs: 28600, endMs: 39900 },
      { kind: "acoustic", event: "alarm", startMs: 49500, endMs: 50200, confidence: 0.93 },
      { kind: "speaker", label: "Captain Reyes", startMs: 61700, endMs: 71300 },
    ],
    model: mossProvenance("speech-events"),
  },
  chaptersScenes: {
    kind: "chapters-scenes",
    units: [
      { kind: "chapter", startMs: 0, endMs: 28400, title: "The drift begins", summary: "Reyes and Ito argue about fuel, the garden, and what station-keeping really is." },
      { kind: "chapter", startMs: 28600, endMs: 50800, title: "The garden bay", summary: "The drift through the asteroid field toward the impossible garden." },
      { kind: "chapter", startMs: 51000, endMs: 78200, title: "The final burn", summary: "One burn, spent on the garden — and the asteroids let them pass." },
      { kind: "scene", startMs: 40100, endMs: 50800, title: "Riding the light", summary: "The garden the size of a moon comes into view." },
    ],
    model: qwenProvenance,
  },
  visualConcepts: {
    kind: "visual-concepts",
    detections: [
      { name: "spacecraft interior", kind: "concept", confidence: 0.96 },
      { name: "asteroid field", kind: "concept", confidence: 0.94, startMs: 28600, endMs: 50800 },
      { name: "hydroponic garden", kind: "concept", confidence: 0.9, startMs: 40100, endMs: 50800 },
      { name: "space suit", kind: "concept", confidence: 0.82, startMs: 51000, endMs: 61500 },
      { name: "control console", kind: "concept", confidence: 0.88 },
    ],
    model: videoprismProvenance,
  },
  videoEmbedding: {
    kind: "video-embedding",
    embedding: { vector: [-0.25, 0.18, -0.07, 0.39, 0.28, -0.12, 0.31, 0.05], dimensions: 8 },
    model: videoprismProvenance,
  },
  textEmbedding: {
    kind: "text-embedding",
    embedding: { vector: [-0.19, 0.27, -0.11, 0.33, 0.22, -0.08, 0.25, 0.02], dimensions: 8 },
    language: "en",
    model: bgeProvenance,
  },
  searchableMoments: {
    kind: "searchable-moments",
    moments: [
      { startMs: 28600, endMs: 39900, description: "The drift begins — the asteroid field opens ahead of the station.", matchedText: "The drift begins — slow, patient, unstoppable. The field opens ahead of us.", score: 0.94 },
      { startMs: 40100, endMs: 50800, description: "The garden the size of a moon comes into view, riding the light.", matchedText: "There. Riding the light. A garden the size of a moon.", score: 0.96 },
      { startMs: 61700, endMs: 71300, description: "The final burn — one impossible thing, spent on the garden.", matchedText: "The final burn. Hold onto something green.", score: 0.92 },
      { startMs: 0, endMs: 7800, description: "Reyes opens with the truth about station-keeping and drift.", matchedText: "Station-keeping is a lie we tell the asteroids. Drift is the truth.", score: 0.87 },
    ],
    model: {
      stage: "semantic-index",
      modelId: "open-model:bge-m3",
      modelRevision: "research-2026-09-20",
      confidence: 0.9,
      producedAt: T0,
    },
  },
  semanticIndex: {
    kind: "semantic-index",
    itemId: "wfxitm_asteroiddrift00000000000000",
    entries: [
      { text: "Station-keeping is a lie we tell the asteroids. Drift is the truth.", language: "en", span: { startMs: 0, endMs: 7800 }, source: "transcript-segment" },
      { text: "The drift begins — slow, patient, unstoppable. The field opens ahead of us.", language: "en", span: { startMs: 28600, endMs: 39900 }, source: "transcript-segment" },
      { text: "There. Riding the light. A garden the size of a moon.", language: "en", span: { startMs: 40100, endMs: 50800 }, source: "transcript-segment" },
      { text: "The drift begins — Reyes and Ito argue about fuel, the garden, and what station-keeping really is.", language: "en", span: { startMs: 0, endMs: 28400 }, source: "chapter" },
      { text: "The garden bay — the drift through the asteroid field toward the impossible garden.", language: "en", span: { startMs: 28600, endMs: 50800 }, source: "chapter" },
      { text: "The final burn — one burn, spent on the garden, and the asteroids let them pass.", language: "en", span: { startMs: 51000, endMs: 78200 }, source: "chapter" },
      { text: "A science-fiction short about a station drifting through an asteroid field toward a garden the size of a moon.", language: "en", span: null, source: "metadata", embedding: bgeProvenance },
    ],
    buildProvenance: [mossProvenance("transcription"), qwenProvenance, videoprismProvenance, bgeProvenance],
  },
};

// ---------------------------------------------------------------------------
// Desert Rain Doc (fake:video-3) — the PARTIAL set (honest prerequisites)
// ---------------------------------------------------------------------------

/**
 * The honest PARTIAL artifact set: transcript + chapters + moments (the
 * moment-search prerequisites) but NO embeddings (the search-by-meaning
 * prerequisites honestly missing) — the R23-H `prerequisites-missing`
 * states this set exercises are real.
 */
const desertRain: MediaIntelligenceArtifacts = {
  itemId: "wfxitm_desertraindoc000000000000",
  transcript: {
    kind: "transcript",
    language: "en",
    segments: [
      { startMs: 0, endMs: 8200, text: "The desert keeps its own calendar. Rain is the rarest page.", language: "en", speakerLabel: "Elena Marsh" },
      { startMs: 8300, endMs: 19100, text: "When the storm crosses the ridge, the sand drinks for a hundred years of thirst.", language: "en", speakerLabel: "Elena Marsh" },
      { startMs: 19300, endMs: 30500, text: "Within a day, the valley floors bloom — a green that will not wait.", language: "en", speakerLabel: "Elena Marsh" },
      { startMs: 30700, endMs: 40200, text: "The flowers set seed before the heat returns. The whole year happens in a week.", language: "en", speakerLabel: "Elena Marsh" },
    ],
    model: mossProvenance("transcription"),
  },
  chaptersScenes: {
    kind: "chapters-scenes",
    units: [
      { kind: "chapter", startMs: 0, endMs: 19100, title: "The storm crosses the ridge", summary: "Rain reaches the desert — the rarest page of its calendar." },
      { kind: "chapter", startMs: 19300, endMs: 40200, title: "A green that will not wait", summary: "The bloom, the seed, and the year that happens in a week." },
    ],
    model: qwenProvenance,
  },
  searchableMoments: {
    kind: "searchable-moments",
    moments: [
      { startMs: 8300, endMs: 19100, description: "The storm crosses the ridge and the sand drinks a hundred years of thirst.", matchedText: "When the storm crosses the ridge, the sand drinks for a hundred years of thirst.", score: 0.93 },
      { startMs: 19300, endMs: 30500, description: "The valley floors bloom within a day of the rain.", matchedText: "Within a day, the valley floors bloom — a green that will not wait.", score: 0.9 },
    ],
    model: {
      stage: "semantic-index",
      modelId: "open-model:bge-m3",
      modelRevision: "research-2026-09-20",
      confidence: 0.9,
      producedAt: T0,
    },
  },
  semanticIndex: {
    kind: "semantic-index",
    itemId: "wfxitm_desertraindoc000000000000",
    entries: [
      { text: "The desert keeps its own calendar. Rain is the rarest page.", language: "en", span: { startMs: 0, endMs: 8200 }, source: "transcript-segment" },
      { text: "When the storm crosses the ridge, the sand drinks for a hundred years of thirst.", language: "en", span: { startMs: 8300, endMs: 19100 }, source: "transcript-segment" },
      { text: "The storm crosses the ridge — rain reaches the desert, the rarest page of its calendar.", language: "en", span: { startMs: 0, endMs: 19100 }, source: "chapter" },
      { text: "A green that will not wait — the bloom, the seed, and the year that happens in a week.", language: "en", span: { startMs: 19300, endMs: 40200 }, source: "chapter" },
    ],
    buildProvenance: [mossProvenance("transcription"), qwenProvenance],
  },
};

// ---------------------------------------------------------------------------
// The feed (keyed by the stable external ref — the cross-module key)
// ---------------------------------------------------------------------------

/** One fixture intelligence row: the artifact set + the legal-audio truth. */
export interface IntelligenceFixtureRow {
  readonly externalRef: string;
  readonly title: string;
  /** The item's canonical id (learned at read — per module instance). */
  itemId: string | null;
  /** The item's connector id (learned with the canonical id). */
  connectorId: string | null;
  /** The artifacts (the frozen R23-F shapes). */
  readonly artifacts: MediaIntelligenceArtifacts;
  /**
   * R23-G's legal-audio precondition truth: whether an audio stream is
   * legally available to WebFlix for this item (the honest gate — the
   * typed refusal names the boundary when it is not).
   */
  readonly audioStreamLegallyAvailable: boolean;
}

/** The fixture rows (deterministic). */
export const INTELLIGENCE_FIXTURE_ROWS: readonly IntelligenceFixtureRow[] = [
  { externalRef: "fake:video-1", title: "Deep Field Diary", itemId: null, connectorId: null, artifacts: deepField, audioStreamLegallyAvailable: true },
  { externalRef: "fake:movie-1", title: "Asteroid Drift", itemId: null, connectorId: null, artifacts: asteroid, audioStreamLegallyAvailable: true },
  { externalRef: "fake:video-3", title: "Desert Rain Doc", itemId: null, connectorId: null, artifacts: desertRain, audioStreamLegallyAvailable: false },
];

/**
 * The fixture intelligence row of a stable external ref (null when the
 * item has no artifact set — the honest absence).
 */
export function intelligenceFixtureOf(
  externalRef: string,
): IntelligenceFixtureRow | null {
  return INTELLIGENCE_FIXTURE_ROWS.find((row) => row.externalRef === externalRef) ?? null;
}
