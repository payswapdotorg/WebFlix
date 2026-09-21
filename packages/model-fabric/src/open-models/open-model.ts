/**
 * @wfx/model-fabric — the huggingface-open-model provider category (R23-J).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-J): a
 * FIRST-CLASS provider category `huggingface-open-model` in Model
 * Fabric, where every entry carries its REAL license, revision,
 * supported tasks, execution locations, privacy class, cost, latency
 * profile, hardware requirements, and provenance. Open models enter as
 * HONEST, license-labeled intelligence — never as assumed-open
 * dependencies.
 *
 * THE LICENSE TRUTH LAW (binding; the plan's frozen research finding):
 * licenses apply DIFFERENTLY to code and weights. The R2T2
 * accompanying CODE is Apache 2.0, but the WEIGHTS carry the NetEase
 * Model Use License Agreement — and the provider metadata must record
 * EXACTLY this distinction. {@link OpenModelLicenseTerms} therefore
 * carries BOTH a code license and a weights license (identical when the
 * project ships one license; distinct when it does not), and every
 * descriptor must carry non-empty terms — a license-less open-model
 * entry is drift, rejected by {@link validateOpenModelDescriptor}.
 *
 * THE NO-SDK LAW: NO direct Hugging Face SDK calls inside shared
 * product logic. This module performs NO I/O of any kind. Execution
 * happens through the injected {@link OpenModelExecutorPort} — a seam
 * the PLATFORM ADAPTER owns (self-hosted endpoint client, HF Inference
 * Endpoint client, or local/Desktop model runtime). Shared product
 * logic sees only typed descriptors, routing derivations, and the
 * executor seam.
 *
 * THE MODEL-AUTHORITY BOUNDARY (the R23 acceptance law, frozen here in
 * its sharpest form): NO model — first-party, BYOM, or open — may
 * AUTHORIZE a playback or acquisition action. Models generate features
 * and signals; authorization and user policy belong to the product
 * surfaces and the Recommendation OS.
 * {@link mayModelAuthorizePlaybackOrAcquisition} is total and ALWAYS
 * `false`.
 *
 * WHAT THIS MODULE IS: PURE typed shapes + validation + the executor
 * seam + the registry adapter (descriptor -> RegisteredModelProvider).
 */

import type { ModelTask } from "@wfx/domain";

import { isModelTask } from "../types";
import type { RegisteredModelProvider } from "../registry";

// ---------------------------------------------------------------------------
// The license truth (code/weights distinction)
// ---------------------------------------------------------------------------

/**
 * An open model's REAL license terms — the code/weights distinction the
 * license-truth law requires:
 *
 * - `codeLicense` — the license of the accompanying code/repository;
 * - `weightsLicense` — the license of the model WEIGHTS (the checkpoint);
 * - `notes` — the honest distinction text when the two differ (e.g. the
 *   R2T2 entry's "code is Apache 2.0; weights carry the NetEase Model
 *   Use License Agreement"), or additional terms a deployer must review.
 *
 * When a project ships one license for both, both fields carry it and
 * `notes` states that.
 */
export interface OpenModelLicenseTerms {
  /** The license of the accompanying code (non-empty SPDX id or name). */
  readonly codeLicense: string;
  /** The license of the model weights (non-empty SPDX id or name). */
  readonly weightsLicense: string;
  /** The honest distinction/terms note (non-empty). */
  readonly notes: string;
}

/** Structural guard for claimed license terms. */
export function isOpenModelLicenseTerms(
  x: unknown,
): x is OpenModelLicenseTerms {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (typeof record.codeLicense !== "string" || record.codeLicense.length === 0) {
    return false;
  }
  if (
    typeof record.weightsLicense !== "string" ||
    record.weightsLicense.length === 0
  ) {
    return false;
  }
  return typeof record.notes === "string" && record.notes.length > 0;
}

// ---------------------------------------------------------------------------
// Execution locations / privacy / latency / hardware
// ---------------------------------------------------------------------------

/**
 * WHERE an open model can execute — the R23-J execution-location
 * dimension (self-hosted/HF Inference Endpoint AND local/Desktop are
 * both first-class; local-browser is the R23-I Transformers.js path
 * where a model is small enough):
 *
 * - `"self-hosted"` — the operator hosts the model (vLLM etc.);
 * - `"hf-inference-endpoint"` — Hugging Face Inference Endpoints host it
 *   (the production hosting option behind Model Fabric);
 * - `"local-desktop"` — the model runs in the Desktop model runtime
 *   (input never leaves the machine);
 * - `"local-browser"` — the model runs in-browser (Transformers.js —
 *   WebGPU when available, WASM otherwise).
 */
export type OpenModelExecutionLocation =
  | "self-hosted"
  | "hf-inference-endpoint"
  | "local-desktop"
  | "local-browser";

/** Every value of {@link OpenModelExecutionLocation}. */
export const OPEN_MODEL_EXECUTION_LOCATIONS: readonly OpenModelExecutionLocation[] =
  ["self-hosted", "hf-inference-endpoint", "local-desktop", "local-browser"] as const;

/** Runtime membership check against the execution-location union. */
export function isOpenModelExecutionLocation(
  x: unknown,
): x is OpenModelExecutionLocation {
  return (
    typeof x === "string" &&
    (OPEN_MODEL_EXECUTION_LOCATIONS as readonly string[]).includes(x)
  );
}

/**
 * The PRIVACY class of one execution arrangement (the honest
 * consequence, derived from WHERE the model runs):
 * - `"local-only"` — on-device execution; input never leaves the machine
 *   (local-desktop, local-browser);
 * - `"remote"` — input is sent to a hosting service (self-hosted, HF
 *   Inference Endpoint) — usable under trusted-cloud/any-cloud model
 *   policies, refused under local-only policies.
 */
export type OpenModelPrivacyClass = "local-only" | "remote";

/** Every value of {@link OpenModelPrivacyClass}. */
export const OPEN_MODEL_PRIVACY_CLASSES: readonly OpenModelPrivacyClass[] = [
  "local-only",
  "remote",
] as const;

/** Runtime membership check against the privacy-class union. */
export function isOpenModelPrivacyClass(
  x: unknown,
): x is OpenModelPrivacyClass {
  return (
    typeof x === "string" &&
    (OPEN_MODEL_PRIVACY_CLASSES as readonly string[]).includes(x)
  );
}

/** The privacy class of one execution location (pure; total). */
export function privacyClassOfExecutionLocation(
  location: OpenModelExecutionLocation,
): OpenModelPrivacyClass {
  switch (location) {
    case "local-desktop":
    case "local-browser":
      return "local-only";
    case "self-hosted":
    case "hf-inference-endpoint":
      return "remote";
  }
}

/**
 * The LATENCY profile dimension — the honest operating envelope the
 * router and surfaces reason over:
 *
 * - `"low-latency-streaming"` — true streaming, append-only committed
 *   output, configurable chunk sizes, reported latency well under a
 *   second (the R2T2 envelope: 80 ms-2 s chunks, ~200-600 ms reported
 *   average);
 * - `"near-interactive"` — small/fast enough for interactive single-shot
 *   calls (query embeddings, lightweight classification);
 * - `"batch"` — long-form/offline work (full-file transcription,
 *   indexing pipelines);
 * - `"variable"` — depends on workload size (large multimodal
 *   generation).
 */
export type OpenModelLatencyProfile =
  | "low-latency-streaming"
  | "near-interactive"
  | "batch"
  | "variable";

/** Every value of {@link OpenModelLatencyProfile}. */
export const OPEN_MODEL_LATENCY_PROFILES: readonly OpenModelLatencyProfile[] =
  ["low-latency-streaming", "near-interactive", "batch", "variable"] as const;

/** Runtime membership check against the latency-profile union. */
export function isOpenModelLatencyProfile(
  x: unknown,
): x is OpenModelLatencyProfile {
  return (
    typeof x === "string" &&
    (OPEN_MODEL_LATENCY_PROFILES as readonly string[]).includes(x)
  );
}

/**
 * The HARDWARE requirements dimension — the honest minimum an execution
 * location needs (adapters match deployments against it; a claim
 * without the real adapter path is drift):
 *
 * - `"cpu-practical"` — runs usefully on ordinary CPU hardware;
 * - `"cpu-slow"` — CPU-feasible but slow (batch only, honestly);
 * - `"consumer-gpu"` — a consumer GPU (e.g. ~8 GB VRAM) suffices;
 * - `"high-memory-gpu"` — a high-memory/datacenter GPU is required;
 * - `"browser-feasible"` — small enough for in-browser WASM/WebGPU
 *   execution (the R23-I path).
 */
export type OpenModelHardwareRequirement =
  | "cpu-practical"
  | "cpu-slow"
  | "consumer-gpu"
  | "high-memory-gpu"
  | "browser-feasible";

/** Every value of {@link OpenModelHardwareRequirement}. */
export const OPEN_MODEL_HARDWARE_REQUIREMENTS: readonly OpenModelHardwareRequirement[] =
  [
    "cpu-practical",
    "cpu-slow",
    "consumer-gpu",
    "high-memory-gpu",
    "browser-feasible",
  ] as const;

/** Runtime membership check against the hardware union. */
export function isOpenModelHardwareRequirement(
  x: unknown,
): x is OpenModelHardwareRequirement {
  return (
    typeof x === "string" &&
    (OPEN_MODEL_HARDWARE_REQUIREMENTS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Intelligence capabilities (the R23-F/H pipeline vocabulary)
// ---------------------------------------------------------------------------

/**
 * What an open model contributes to the MEDIA-INTELLIGENCE pipeline
 * (R23-F artifacts / R23-H features) — an EXTENDED vocabulary beside
 * the frozen `ModelTask` union (the frozen union governs Model Fabric
 * task routing; these capabilities govern artifact/feature generation,
 * which the frozen tasks do not type). The plan's research candidates
 * map onto it:
 *
 * - `streaming-asr` — true streaming transcription (R2T2);
 * - `batch-transcription` — long-form/offline transcription
 *   (MOSS-Transcribe-Diarize, Whisper);
 * - `diarization` — speaker attribution (MOSS-Transcribe-Diarize);
 * - `acoustic-events` — non-speech acoustic detection
 *   (MOSS-Transcribe-Diarize);
 * - `video-embedding` — semantic video embeddings (VideoPrism);
 * - `video-text-retrieval` — video-text alignment (VideoPrism);
 * - `visual-understanding` — visual grounding / event extraction
 *   (Qwen2.5-VL);
 * - `scene-chapter-analysis` — chapter/scene structure (Qwen2.5-VL);
 * - `multimodal-search` — multimodal query understanding (Qwen2.5-VL);
 * - `text-embedding` — text embeddings (BGE-M3 family);
 * - `multilingual-embedding` — same-space multilingual embeddings
 *   (BGE-M3);
 * - `sparse-retrieval` — sparse/lexical retrieval signals (BGE-M3);
 * - `reranking` — retrieval reranking (BGE-M3);
 * - `browser-local-inference` — small in-browser models
 *   (Transformers.js-class, the R23-I path).
 */
export type OpenModelIntelligenceCapability =
  | "streaming-asr"
  | "batch-transcription"
  | "diarization"
  | "acoustic-events"
  | "video-embedding"
  | "video-text-retrieval"
  | "visual-understanding"
  | "scene-chapter-analysis"
  | "multimodal-search"
  | "text-embedding"
  | "multilingual-embedding"
  | "sparse-retrieval"
  | "reranking"
  | "browser-local-inference";

/** Every value of {@link OpenModelIntelligenceCapability}. */
export const OPEN_MODEL_INTELLIGENCE_CAPABILITIES: readonly OpenModelIntelligenceCapability[] =
  [
    "streaming-asr",
    "batch-transcription",
    "diarization",
    "acoustic-events",
    "video-embedding",
    "video-text-retrieval",
    "visual-understanding",
    "scene-chapter-analysis",
    "multimodal-search",
    "text-embedding",
    "multilingual-embedding",
    "sparse-retrieval",
    "reranking",
    "browser-local-inference",
  ] as const;

/** Runtime membership check against the capability union. */
export function isOpenModelIntelligenceCapability(
  x: unknown,
): x is OpenModelIntelligenceCapability {
  return (
    typeof x === "string" &&
    (OPEN_MODEL_INTELLIGENCE_CAPABILITIES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The descriptor (the first-class huggingface-open-model entry)
// ---------------------------------------------------------------------------

/**
 * One `huggingface-open-model` entry — the first-class provider
 * category's complete, honest metadata record (the R23-J field list,
 * verbatim): model id, revision, LICENSE, supported tasks, execution
 * locations, privacy class, cost, latency profile, hardware
 * requirements, provenance.
 */
export interface OpenModelDescriptor {
  /** The Model Fabric provider id this entry registers under (e.g. `open-model:r2t2`). */
  readonly providerId: string;
  /** The model's own id on its hub (e.g. `openai/whisper-large-v3-turbo`). */
  readonly modelId: string;
  /** The pinned revision (commit/tag) the entry truthfully refers to. */
  readonly revision: string;
  /** The REAL license terms (code/weights distinction — the license-truth law). */
  readonly license: OpenModelLicenseTerms;
  /**
   * The frozen ModelTasks this model can serve in Model Fabric routing
   * (may be empty for catalog-only entries whose contribution is
   * intelligence capabilities, not task routing).
   */
  readonly supportedTasks: readonly ModelTask[];
  /** What the model contributes to the R23-F/H intelligence pipeline. */
  readonly intelligenceCapabilities: readonly OpenModelIntelligenceCapability[];
  /** Where the model can execute (at least one). */
  readonly executionLocations: readonly OpenModelExecutionLocation[];
  /**
   * The privacy class per execution location is DERIVED
   * ({@link privacyClassOfExecutionLocation}); this field carries the
   * entry's OVERALL class — `local-only` iff EVERY location is local.
   */
  readonly privacyClass: OpenModelPrivacyClass;
  /** The declared cost per operation, in fabric abstract cost units (>= 0). */
  readonly costPerOperation: number;
  /** The honest latency envelope. */
  readonly latencyProfile: OpenModelLatencyProfile;
  /** The honest hardware requirement. */
  readonly hardwareRequirements: OpenModelHardwareRequirement;
  /** Where this entry's truth came from (provenance — non-empty). */
  readonly provenance: string;
}

/** The outcome of descriptor validation. */
export type OpenModelDescriptorValidation =
  | { ok: true }
  | { ok: false; problems: readonly string[] };

/**
 * Validate one descriptor against the honest-shape laws (pure; drift is
 * rejected, never coerced): non-empty provider/model ids and revision;
 * REAL license terms present (the license-truth law — the ONE thing an
 * entry may never lack); supported tasks must be frozen ModelTasks;
 * intelligence capabilities must be members of the extended union; at
 * least one execution location; the overall privacy class must agree
 * with the locations (local-only iff every location is local); cost
 * finite and >= 0; latency/hardware members of their unions; non-empty
 * provenance.
 */
export function validateOpenModelDescriptor(
  descriptor: OpenModelDescriptor,
): OpenModelDescriptorValidation {
  const problems: string[] = [];

  if (typeof descriptor.providerId !== "string" || descriptor.providerId.length === 0) {
    problems.push("providerId: expected a non-empty Model Fabric provider id");
  }
  if (typeof descriptor.modelId !== "string" || descriptor.modelId.length === 0) {
    problems.push("modelId: expected a non-empty hub model id");
  }
  if (typeof descriptor.revision !== "string" || descriptor.revision.length === 0) {
    problems.push("revision: expected a non-empty pinned revision");
  }
  if (!isOpenModelLicenseTerms(descriptor.license)) {
    problems.push(
      "license: REAL license terms required (code + weights + notes) — the license-truth law",
    );
  }
  if (
    !descriptor.supportedTasks.every((task) => isModelTask(task))
  ) {
    problems.push("supportedTasks: every entry must be a frozen ModelTask");
  }
  if (
    !descriptor.intelligenceCapabilities.every((capability) =>
      isOpenModelIntelligenceCapability(capability),
    )
  ) {
    problems.push("intelligenceCapabilities: unknown capability in the extended union");
  }
  if (descriptor.executionLocations.length === 0) {
    problems.push("executionLocations: expected at least one execution location");
  } else if (
    !descriptor.executionLocations.every((location) =>
      isOpenModelExecutionLocation(location),
    )
  ) {
    problems.push("executionLocations: unknown location in the union");
  }
  if (descriptor.executionLocations.length > 0) {
    const derived =
      descriptor.executionLocations.every(
        (location) => privacyClassOfExecutionLocation(location) === "local-only",
      )
        ? "local-only"
        : "remote";
    if (descriptor.privacyClass !== derived) {
      problems.push(
        `privacyClass: expected '${derived}' for these execution locations, got '${descriptor.privacyClass}'`,
      );
    }
  }
  if (
    typeof descriptor.costPerOperation !== "number" ||
    !Number.isFinite(descriptor.costPerOperation) ||
    descriptor.costPerOperation < 0
  ) {
    problems.push("costPerOperation: expected a finite number >= 0");
  }
  if (!isOpenModelLatencyProfile(descriptor.latencyProfile)) {
    problems.push("latencyProfile: unknown latency profile");
  }
  if (!isOpenModelHardwareRequirement(descriptor.hardwareRequirements)) {
    problems.push("hardwareRequirements: unknown hardware requirement");
  }
  if (typeof descriptor.provenance !== "string" || descriptor.provenance.length === 0) {
    problems.push("provenance: expected non-empty provenance");
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

// ---------------------------------------------------------------------------
// The executor seam (NO Hugging Face SDK in shared product logic)
// ---------------------------------------------------------------------------

/**
 * The resolved binding one execution carries: WHICH descriptor, WHICH
 * execution location the adapter chose for it. The adapter (self-hosted
 * client / HF Inference Endpoint client / Desktop model runtime /
 * Transformers.js runtime) resolves the location from its own deployment
 * truth — shared logic never guesses.
 */
export interface ResolvedOpenModelBinding {
  readonly descriptor: OpenModelDescriptor;
  readonly executionLocation: OpenModelExecutionLocation;
}

/**
 * THE EXECUTOR SEAM. The platform adapter implements it; Model Fabric
 * calls it. This is the ONLY way an open model actually runs — there is
 * NO Hugging Face SDK import, NO HTTP client, NO filesystem access
 * anywhere in shared product logic (the no-SDK law, structural).
 *
 * Implementations must answer typed failures (rejection or throw) —
 * never fake success; the fabric gateway wraps failures into the typed
 * `FabricError` envelope as with every provider.
 */
export interface OpenModelExecutorPort {
  /** Execute one task invocation against the resolved open-model binding. */
  execute(
    task: ModelTask,
    input: unknown,
    binding: ResolvedOpenModelBinding,
  ): Promise<unknown>;
}

/** Structural check: does a value satisfy the executor seam? */
export function isOpenModelExecutorPort(
  x: unknown,
): x is OpenModelExecutorPort {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  return typeof record.execute === "function";
}

// ---------------------------------------------------------------------------
// The registry adapter (descriptor -> RegisteredModelProvider)
// ---------------------------------------------------------------------------

/** Bounded, safe rendering of an unexpected failure (never the input). */
function errorMessageOf(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message.length > 0 ? error.message : String(error);
  } else {
    message = String(error);
  }
  return message.length > 200 ? `${message.slice(0, 197)}...` : message;
}

/**
 * Create the Model Fabric provider for one open-model descriptor: the
 * frozen `RegisteredModelProvider` surface (capabilities = the
 * descriptor's frozen supportedTasks; privacy = the WFX-030 registry
 * vocabulary mapped from {@link OpenModelPrivacyClass}; declared cost =
 * the descriptor's costPerOperation for every served task) with
 * invocation routed through the INJECTED executor seam.
 *
 * Catalog-only entries (zero frozen supportedTasks) are refused — they
 * cannot serve task routing and belong to the intelligence pipeline's
 * own consumption, never to the task registry.
 *
 * The executor's failures propagate as typed rejections (the gateway's
 * provider-error envelope); an unexpected throw is bounded and
 * re-typed, never swallowed, never fake success.
 */
export function createOpenModelProvider(options: {
  readonly descriptor: OpenModelDescriptor;
  readonly executor: OpenModelExecutorPort;
}): RegisteredModelProvider {
  const { descriptor, executor } = options;
  const validation = validateOpenModelDescriptor(descriptor);
  if (!validation.ok) {
    throw new Error(
      `createOpenModelProvider: invalid open-model descriptor '${descriptor.providerId}': ${validation.problems.join("; ")}`,
    );
  }
  if (descriptor.supportedTasks.length === 0) {
    throw new Error(
      `createOpenModelProvider: open model '${descriptor.providerId}' declares no frozen ModelTask — catalog-only entries are consumed by the intelligence pipeline, not registered for task routing`,
    );
  }
  if (!isOpenModelExecutorPort(executor)) {
    throw new Error(
      `createOpenModelProvider: executor must satisfy the OpenModelExecutorPort seam (an execute function)`,
    );
  }

  const privacy = descriptor.privacyClass === "local-only" ? "local" : "cloud";

  return {
    id: descriptor.providerId,
    get capabilities(): ModelTask[] {
      return [...descriptor.supportedTasks];
    },
    privacy,
    costPerOperation(task: ModelTask): number | undefined {
      // Declared cost for every served task; honest absence otherwise.
      return (descriptor.supportedTasks as readonly string[]).includes(task)
        ? descriptor.costPerOperation
        : undefined;
    },
    async invoke<TInput, TOutput>(
      task: ModelTask,
      input: TInput,
    ): Promise<TOutput> {
      if (!(descriptor.supportedTasks as readonly string[]).includes(task)) {
        throw new Error(
          `open-model provider '${descriptor.providerId}' does not serve task '${task}' — supported: ${descriptor.supportedTasks.join(", ")}`,
        );
      }
      // The ADAPTER resolves the execution location from its deployment
      // truth; the first declared location is the deterministic default
      // binding for this seam call (adapters wrapping their own choice
      // inject a binding-resolving executor).
      const firstLocation = descriptor.executionLocations[0];
      const binding: ResolvedOpenModelBinding =
        firstLocation !== undefined
          ? { descriptor, executionLocation: firstLocation }
          : { descriptor, executionLocation: "self-hosted" };
      try {
        const output = await executor.execute(task, input, binding);
        return output as TOutput;
      } catch (error) {
        // Typed rejections propagate as-is; unexpected throws are
        // bounded and re-typed — never swallowed, never fake success.
        if (error instanceof Error) throw error;
        throw new Error(
          `open-model provider '${descriptor.providerId}' failed: ${errorMessageOf(error)}`,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The model-authority boundary (the frozen R23 acceptance law)
// ---------------------------------------------------------------------------

/**
 * THE MODEL-AUTHORITY BOUNDARY, frozen as a total function: may a model
 * authorize a playback or acquisition action? NEVER. Models —
 * first-party, BYOM, or open (huggingface-open-model) — generate
 * features and signals; authorization belongs to the product surfaces,
 * and user policy belongs to the Recommendation OS. This is the
 * machine-checkable law the R23 acceptance battery asserts.
 */
export function mayModelAuthorizePlaybackOrAcquisition(): false {
  return false;
}
