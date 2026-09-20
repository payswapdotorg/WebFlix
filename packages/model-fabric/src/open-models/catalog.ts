/**
 * @wfx/model-fabric — the researched open-model catalog (R23-J).
 *
 * THE LAW THIS MODULE FREEZES: the R23 plan's RESEARCH FINDINGS are the
 * source of truth for these entries — every catalog row carries its
 * REAL license (the license-truth law: the R2T2 row records EXACTLY
 * the code-Apache-2.0 / weights-NetEase-Model-Use-License split), its
 * pinned revision, its honest capabilities, its execution locations,
 * and its provenance naming the plan's research findings.
 *
 * This is a CATALOG, not a registration: listing a model here does NOT
 * make it a live provider. A model becomes live only when a platform
 * adapter binds an executor ({@link createOpenModelProvider}) and
 * registers it — capability claims without a real adapter path are the
 * reject-drift law. Catalog rows with zero frozen ModelTasks
 * (VideoPrism, BGE-M3) are intelligence-pipeline contributors, not task
 * routers — consumed by the R23-F/H artifact/feature lanes.
 *
 * COST TRUTH: `costPerOperation: 0` is the SELF-OPERATED cost (the
 * model runs on infrastructure the operator already pays for). Remote
 * hosting arrangements (HF Inference Endpoints) are priced by the host
 * and recorded by the DEPLOYING adapter's own metadata — the catalog
 * records model truth, never a hosting price list.
 */

import { validateOpenModelDescriptor } from "./open-model";
import type { OpenModelDescriptor } from "./open-model";

/** The plan document every catalog row's provenance names. */
export const OPEN_MODEL_CATALOG_PROVENANCE =
  "docs/plans/2026-09-20-webflix-open-viewing-torrent-ai-plan.md — research findings (2026-09-20)";

// ---------------------------------------------------------------------------
// The catalog (the plan's research candidates, honestly labeled)
// ---------------------------------------------------------------------------

/**
 * R2T2 — NetEase Youdao's Confucius4-R2T2 (built on Qwen3-ASR): the
 * live/streaming low-latency ASR route (true streaming, append-only
 * committed output, configurable 80 ms-2 s chunks, reported average
 * latency ~200-600 ms, hotword/context prompting, vLLM serving, broad
 * multilingual with Chinese/English as the primary optimization
 * target).
 *
 * LICENSE TRUTH (verbatim from the plan): accompanying R2T2 CODE is
 * Apache 2.0; the model WEIGHTS carry the NetEase Model Use License
 * Agreement. This row records exactly that split — R2T2 is NOT an
 * assumed Apache-licensed dependency.
 */
export const R2T2_OPEN_MODEL: OpenModelDescriptor = {
  providerId: "open-model:r2t2",
  modelId: "NetEase Youdao/Confucius4-R2T2",
  revision: "research-2026-09-20",
  license: {
    codeLicense: "Apache-2.0",
    weightsLicense: "NetEase Model Use License Agreement",
    notes:
      "Accompanying R2T2 code is Apache 2.0; the model weights carry the NetEase Model Use License Agreement — exactly this distinction, never an assumed Apache-licensed dependency. Deployers must review the weights license terms before serving it.",
  },
  supportedTasks: ["speechToText", "transcription"],
  intelligenceCapabilities: ["streaming-asr"],
  executionLocations: ["self-hosted", "hf-inference-endpoint", "local-desktop"],
  privacyClass: "remote",
  costPerOperation: 0,
  latencyProfile: "low-latency-streaming",
  hardwareRequirements: "consumer-gpu",
  provenance: OPEN_MODEL_CATALOG_PROVENANCE,
};

/**
 * MOSS-Transcribe-Diarize — OpenMOSS-Team's 0.9B long-form
 * multi-speaker transcription model with diarization, timestamps, and
 * acoustic-event awareness: the LONG-FORM/BATCH route companion.
 */
export const MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL: OpenModelDescriptor = {
  providerId: "open-model:moss-transcribe-diarize",
  modelId: "OpenMOSS-Team/MOSS-Transcribe-Diarize",
  revision: "research-2026-09-20",
  license: {
    codeLicense: "Apache-2.0",
    weightsLicense: "Apache-2.0",
    notes: "Apache 2.0 — one license for code and weights.",
  },
  supportedTasks: ["transcription"],
  intelligenceCapabilities: [
    "batch-transcription",
    "diarization",
    "acoustic-events",
  ],
  executionLocations: ["self-hosted", "local-desktop"],
  privacyClass: "remote",
  costPerOperation: 0,
  latencyProfile: "batch",
  hardwareRequirements: "consumer-gpu",
  provenance: OPEN_MODEL_CATALOG_PROVENANCE,
};

/**
 * Whisper large v3 turbo — openai's broad ASR: the offline/batch
 * transcription fallback for long-form work.
 */
export const WHISPER_LARGE_V3_TURBO_OPEN_MODEL: OpenModelDescriptor = {
  providerId: "open-model:whisper-large-v3-turbo",
  modelId: "openai/whisper-large-v3-turbo",
  revision: "research-2026-09-20",
  license: {
    codeLicense: "MIT",
    weightsLicense: "MIT",
    notes: "MIT — one license for code and weights.",
  },
  supportedTasks: ["transcription"],
  intelligenceCapabilities: ["batch-transcription"],
  executionLocations: ["self-hosted", "hf-inference-endpoint", "local-desktop"],
  privacyClass: "remote",
  costPerOperation: 0,
  latencyProfile: "batch",
  hardwareRequirements: "consumer-gpu",
  provenance: OPEN_MODEL_CATALOG_PROVENANCE,
};

/**
 * Qwen2.5-VL-7B-Instruct — video inputs and temporal understanding for
 * chaptering, visual grounding, scene/event extraction, and multimodal
 * search (the R23-H structural-analysis + multimodal-search
 * contributor).
 */
export const QWEN25_VL_OPEN_MODEL: OpenModelDescriptor = {
  providerId: "open-model:qwen2.5-vl-7b-instruct",
  modelId: "Qwen/Qwen2.5-VL-7B-Instruct",
  revision: "research-2026-09-20",
  license: {
    codeLicense: "Apache-2.0",
    weightsLicense: "Apache-2.0",
    notes: "Apache 2.0 — one license for code and weights.",
  },
  supportedTasks: ["summary", "commentary"],
  intelligenceCapabilities: [
    "visual-understanding",
    "scene-chapter-analysis",
    "multimodal-search",
  ],
  executionLocations: ["self-hosted", "hf-inference-endpoint", "local-desktop"],
  privacyClass: "remote",
  costPerOperation: 0,
  latencyProfile: "variable",
  hardwareRequirements: "consumer-gpu",
  provenance: OPEN_MODEL_CATALOG_PROVENANCE,
};

/**
 * VideoPrism base (f16r288) — google's video embedding model: strong
 * fit for item/moment semantic indexing and video-text retrieval (the
 * R23-F video-embedding + R23-H visual-similarity contributor). A
 * CATALOG-ONLY entry: no frozen ModelTask routing — the intelligence
 * pipeline consumes it directly.
 */
export const VIDEOPRISM_OPEN_MODEL: OpenModelDescriptor = {
  providerId: "open-model:videoprism-base-f16r288",
  modelId: "google/videoprism-base-f16r288",
  revision: "research-2026-09-20",
  license: {
    codeLicense: "Apache-2.0",
    weightsLicense: "Apache-2.0",
    notes: "Apache 2.0 — one license for code and weights.",
  },
  supportedTasks: [],
  intelligenceCapabilities: ["video-embedding", "video-text-retrieval"],
  executionLocations: ["self-hosted", "hf-inference-endpoint", "local-desktop"],
  privacyClass: "remote",
  costPerOperation: 0,
  latencyProfile: "batch",
  hardwareRequirements: "consumer-gpu",
  provenance: OPEN_MODEL_CATALOG_PROVENANCE,
};

/**
 * BGE-M3 — BAAI's multilingual dense + sparse + multi-vector retrieval
 * model: the transcript/chapter/metadata hybrid search and reranking
 * contributor (the R23-F text-embedding + R23-H search-by-meaning
 * backbone). CATALOG-ONLY (no frozen ModelTask routing); the
 * multilingual embedding space is what makes cross-language
 * search-by-meaning honest. The plan states the BGE-M3 ecosystem's
 * role; the MIT license is the BAAI repository's declared license
 * (recorded here so the row carries its real license per the
 * license-truth law).
 */
export const BGE_M3_OPEN_MODEL: OpenModelDescriptor = {
  providerId: "open-model:bge-m3",
  modelId: "BAAI/bge-m3",
  revision: "research-2026-09-20",
  license: {
    codeLicense: "MIT",
    weightsLicense: "MIT",
    notes:
      "MIT — the BAAI repository's declared license for code and weights (the plan records the ecosystem's retrieval role; the license is recorded from the repository itself).",
  },
  supportedTasks: [],
  intelligenceCapabilities: [
    "text-embedding",
    "multilingual-embedding",
    "sparse-retrieval",
    "reranking",
  ],
  executionLocations: ["self-hosted", "local-desktop", "local-browser"],
  privacyClass: "remote",
  costPerOperation: 0,
  latencyProfile: "near-interactive",
  hardwareRequirements: "cpu-practical",
  provenance: OPEN_MODEL_CATALOG_PROVENANCE,
};

/**
 * The researched open-model catalog — the plan's research candidates in
 * plan order. Pure data; every row validates against the honest-shape
 * laws (see {@link validateOpenModelCatalog}).
 */
export const RESEARCHED_OPEN_MODELS: readonly OpenModelDescriptor[] = [
  R2T2_OPEN_MODEL,
  MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL,
  WHISPER_LARGE_V3_TURBO_OPEN_MODEL,
  QWEN25_VL_OPEN_MODEL,
  VIDEOPRISM_OPEN_MODEL,
  BGE_M3_OPEN_MODEL,
] as const;

/** The catalog row for one provider id (throws for unknown ids — drift). */
export function openModelCatalogEntryOf(providerId: string): OpenModelDescriptor {
  const entry = RESEARCHED_OPEN_MODELS.find(
    (row) => row.providerId === providerId,
  );
  if (entry === undefined) {
    throw new Error(
      `open-model catalog: no researched entry for '${providerId}' — the catalog is the plan's research list, never a guess`,
    );
  }
  return entry;
}

/** The outcome of a catalog audit. */
export type OpenModelCatalogAudit =
  | { ok: true; entries: readonly OpenModelDescriptor[] }
  | { ok: false; problems: readonly string[] };

/**
 * Audit the whole catalog: unique provider ids, and EVERY row passes
 * {@link validateOpenModelDescriptor} (the license-truth law included —
 * a license-less or privacy-incoherent row is drift). Adapters and
 * tests call this so the catalog can never silently rot.
 */
export function validateOpenModelCatalog(): OpenModelCatalogAudit {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of RESEARCHED_OPEN_MODELS) {
    if (seen.has(entry.providerId)) {
      problems.push(`duplicate providerId '${entry.providerId}' in the catalog`);
    }
    seen.add(entry.providerId);
    const validation = validateOpenModelDescriptor(entry);
    if (!validation.ok) {
      problems.push(
        `${entry.providerId}: ${validation.problems.join("; ")}`,
      );
    }
  }
  return problems.length === 0
    ? { ok: true, entries: RESEARCHED_OPEN_MODELS }
    : { ok: false, problems };
}
