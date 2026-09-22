/**
 * @wfx/model-fabric — the managed realtime translation provider record
 * (R25-B provider metadata + provenance).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — the research
 * summary + R25-B): the currently documented production realtime
 * translation model is a MANAGED CLOUD service — inference runs at the
 * vendor's cloud service over a streaming session; there is NO public
 * open-weight distribution, so WebFlix treats it as a managed
 * provider and NEVER assumes self-hosting or open-weight rights. The
 * provider record encodes exactly that truth:
 *
 * - `distribution: "managed-service-only"` with `openWeights: false`
 *   — the license truth, recorded, never guessed;
 * - the service identity (Alibaba Cloud Model Studio) and the managed
 *   streaming transport — provenance metadata, NOT protocol: the
 *   provider adapter (another lane) owns the protocol end to end, and
 *   NO protocol vocabulary crosses into the shared session contract
 *   (the R25-A provider-neutrality law);
 * - the COMPLETE capability profile (the 15 R25-B dimensions);
 * - the frozen research facts: 60 documented source languages, 29
 *   with audio output; the vendor-reported ~2.3 s average lagging
 *   (versus ~2.8 s for the previous generation) recorded as a
 *   REPORTED figure — never a guaranteed UI latency (R25-L owns
 *   benchmarking end-to-end latency);
 * - the indicative token rate card (R25-K).
 *
 * THE SPECIALIST LAW (R25-B): this provider is the REALTIME
 * TRANSLATION specialist — chosen for realtime translation
 * combinations (translated speech, speaker separation, visual
 * context) — NEVER the universal model. R2T2 keeps the low-latency
 * source-ASR lane; MOSS/Whisper keep the batch stacks (the routing
 * derivations live in `router.ts`).
 *
 * WHAT THIS MODULE IS: PURE metadata + validation. NO protocol, NO
 * I/O, NO session mechanics — the session seam is R25-A; the adapter
 * lane builds the factory.
 */

import { R2T2_REPORTED_AVERAGE_LATENCY_MS } from "../open-models/live-asr";
import {
  REALTIME_CAPABILITY_DIMENSIONS,
  REALTIME_TRANSLATION_LOGICAL_TASK,
  validateRealtimeCapabilityProfile,
  realtimeTaskIsDistinctFromBatchTasks,
  type RealtimeTranslationCapabilityProfile,
} from "./task";
import {
  REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
  validateRealtimeTokenRateCard,
} from "./cost";

// ---------------------------------------------------------------------------
// The managed-provider category (distribution truth)
// ---------------------------------------------------------------------------

/**
 * The distribution truth of a realtime model provider:
 * - `"managed-service-only"` — inference runs at the vendor's managed
 *   cloud service; no open-weight distribution exists; self-hosting
 *   rights are NOT assumed;
 * - `"open-weights"` — weights are distributed under a license the
 *   deployer reviewed (the open-model category owns that path).
 */
export type RealtimeModelDistribution = "managed-service-only" | "open-weights";

/** Every distribution value. */
export const REALTIME_MODEL_DISTRIBUTIONS: readonly RealtimeModelDistribution[] = [
  "managed-service-only",
  "open-weights",
] as const;

/** Runtime membership check against the distribution union. */
export function isRealtimeModelDistribution(x: unknown): x is RealtimeModelDistribution {
  return (
    typeof x === "string" &&
    (REALTIME_MODEL_DISTRIBUTIONS as readonly string[]).includes(x)
  );
}

/**
 * The license truth of a realtime provider record — the managed-cloud
 * law made structural: a `managed-service-only` record carries
 * `openWeights: false` and says so in its notes; self-hosting is
 * never assumed for it.
 */
export interface RealtimeProviderLicenseTruth {
  /** The distribution truth. */
  readonly distribution: RealtimeModelDistribution;
  /** Are open weights publicly distributed for this model? */
  readonly openWeights: boolean;
  /** The honest distinction/terms note (non-empty). */
  readonly notes: string;
}

/** The managed streaming transport of the service (provenance, not protocol). */
export type RealtimeManagedTransport = "managed-streaming-session";

// ---------------------------------------------------------------------------
// The managed realtime model descriptor (the registered-provider record)
// ---------------------------------------------------------------------------

/**
 * One managed realtime translation provider record — the complete,
 * honest metadata the router and the product surfaces reason over:
 * provider/model identity, the managed service identity, the license
 * truth, the capability profile (all 15 dimensions), the indicative
 * rate card, and the provenance naming where the truth came from.
 */
export interface ManagedRealtimeModelDescriptor {
  /** The Model Fabric provider id this record registers under. */
  readonly providerId: string;
  /** The logical task this provider serves (the specialist lane). */
  readonly logicalTask: typeof REALTIME_TRANSLATION_LOGICAL_TASK;
  /** The pinned model identity (the revision/model-id dimension). */
  readonly model: { readonly modelId: string; readonly revision: string };
  /** The managed service identity (e.g. the vendor's cloud studio). */
  readonly serviceName: string;
  /** The managed streaming transport (provenance, not protocol). */
  readonly transport: RealtimeManagedTransport;
  /** The license truth (managed-service-only ⇒ openWeights false). */
  readonly license: RealtimeProviderLicenseTruth;
  /** The complete capability profile (validated against all 15 dimensions). */
  readonly capabilityProfile: RealtimeTranslationCapabilityProfile;
  /** Where this record's truth came from (non-empty). */
  readonly provenance: string;
}

/** The outcome of validating a managed realtime model descriptor. */
export type ManagedRealtimeModelValidation =
  | { ok: true }
  | { ok: false; problems: readonly string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Validate a managed realtime model descriptor (pure; drift is
 * rejected, never coerced): non-empty provider id; the logical task
 * is the realtime-translation specialist lane; non-empty model
 * identity and service name; the managed transport; the license truth
 * agrees with the distribution (managed-service-only ⇒ openWeights
 * false, with notes); the capability profile validates against every
 * dimension; non-empty provenance.
 */
export function validateManagedRealtimeModelDescriptor(
  descriptor: unknown,
): ManagedRealtimeModelValidation {
  const problems: string[] = [];
  if (!isRecord(descriptor)) {
    return { ok: false, problems: ["expected a managed realtime model descriptor object"] };
  }

  if (typeof descriptor.providerId !== "string" || descriptor.providerId.length === 0) {
    problems.push("providerId: expected a non-empty Model Fabric provider id");
  }
  if (descriptor.logicalTask !== REALTIME_TRANSLATION_LOGICAL_TASK) {
    problems.push(
      `logicalTask: expected '${REALTIME_TRANSLATION_LOGICAL_TASK}' — this record category is the realtime translation specialist lane`,
    );
  }
  if (
    !isRecord(descriptor.model) ||
    typeof descriptor.model.modelId !== "string" ||
    descriptor.model.modelId.length === 0 ||
    typeof descriptor.model.revision !== "string" ||
    descriptor.model.revision.length === 0
  ) {
    problems.push("model: expected { modelId, revision } — both non-empty");
  }
  if (typeof descriptor.serviceName !== "string" || descriptor.serviceName.length === 0) {
    problems.push("serviceName: expected a non-empty managed service identity");
  }
  if (descriptor.transport !== "managed-streaming-session") {
    problems.push("transport: expected 'managed-streaming-session' (the managed streaming transport)");
  }

  const license = descriptor.license;
  if (!isRecord(license) || !isRealtimeModelDistribution(license.distribution)) {
    problems.push("license: expected { distribution: 'managed-service-only' | 'open-weights' }");
  } else {
    if (license.distribution === "managed-service-only" && license.openWeights !== false) {
      problems.push(
        "license.openWeights: a managed-service-only record must carry openWeights false — never assume open-weight rights",
      );
    }
    if (typeof license.notes !== "string" || license.notes.length === 0) {
      problems.push("license.notes: expected non-empty terms notes");
    }
  }

  const profileValidation = validateRealtimeCapabilityProfile(descriptor.capabilityProfile);
  if (!profileValidation.ok) {
    problems.push(
      ...profileValidation.problems.map((problem) => `capabilityProfile: ${problem}`),
    );
  } else if (
    isRecord(descriptor.model) &&
    isRecord(descriptor.capabilityProfile) &&
    isRecord(descriptor.capabilityProfile.model) &&
    descriptor.capabilityProfile.model.modelId !== descriptor.model.modelId
  ) {
    problems.push(
      "capabilityProfile.model.modelId: must agree with the descriptor's model identity (one truth, two views of the revision/model-id dimension)",
    );
  }

  if (typeof descriptor.provenance !== "string" || descriptor.provenance.length === 0) {
    problems.push("provenance: expected non-empty provenance");
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

// ---------------------------------------------------------------------------
// The frozen record — the managed realtime translation specialist
// ---------------------------------------------------------------------------

/** The R25 plan document this provider record's provenance names. */
export const REALTIME_PROVIDER_PROVENANCE =
  "docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md — research findings (2026-09-20)";

/**
 * The Model Fabric provider id of the managed realtime translation
 * specialist (the registered-provider record's identity).
 */
export const REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID =
  "managed-cloud:qwen3.8-livetranslate-flash-realtime";

/**
 * The frozen research facts the record carries beside its profile:
 * the documented language coverage (60 source languages, 29 with
 * audio output) and the vendor-REPORTED latency figures (~2.3 s
 * average lagging versus ~2.8 s for the previous generation) —
 * reported, never guaranteed; R25-L owns end-to-end benchmarking.
 */
export const REALTIME_SPECIALIST_REPORTED_FACTS: Readonly<{
  documentedSourceLanguages: number;
  documentedAudioOutputLanguages: number;
  reportedAverageLagMs: number;
  previousGenerationReportedAverageLagMs: number;
  asrTranscriptEnabledByDefault: boolean;
  basis: string;
}> = {
  documentedSourceLanguages: 60,
  documentedAudioOutputLanguages: 29,
  reportedAverageLagMs: 2_300,
  previousGenerationReportedAverageLagMs: 2_800,
  asrTranscriptEnabledByDefault: true,
  basis: "vendor-reported figures from the R25 research summary — reported, never guaranteed UI latency; WebFlix benchmarks end-to-end (R25-L)",
};

/**
 * The 60 documented source languages and the 29 with audio output —
 * recorded as COVERAGE COUNTS plus the honest note that the exact
 * per-language lists live in the vendor's current documentation
 * (verified by the lead; a hardcoded list copied from one doc reading
 * would be drift the moment the vendor updates it). The profile's
 * language-directions dimension therefore carries the count-true
 * marker languages the product itself needs today, with the counts
 * recorded here as the research fact.
 */
export const REALTIME_SPECIALIST_LANGUAGE_COVERAGE: Readonly<{
  /** Marker source languages the product truthfully serves today (validated subset claims only). */
  sourceLanguages: readonly string[];
  /** Marker audio-output languages (a subset of sourceLanguages). */
  audioOutputLanguages: readonly string[];
  counts: Readonly<{
    documentedSourceLanguages: number;
    documentedAudioOutputLanguages: number;
  }>;
  basis: string;
}> = {
  sourceLanguages: ["en", "zh", "ja", "ko", "de", "fr", "es", "ru", "ar", "pt", "hi", "th", "vi", "id"],
  audioOutputLanguages: ["en", "zh", "ja", "ko", "de", "fr", "es", "ru", "ar", "pt"],
  counts: {
    documentedSourceLanguages: 60,
    documentedAudioOutputLanguages: 29,
  },
  basis: "the exact per-language lists are the vendor's current documentation (lead-verified); the product records only the marker languages it truthfully serves plus the documented counts",
};

/**
 * THE REGISTERED-PROVIDER RECORD for the managed realtime translation
 * specialist: Qwen3.8-LiveTranslate-Flash-Realtime, served as a
 * managed cloud model over a streaming session by Alibaba Cloud Model
 * Studio. Managed provider, managed-service-only distribution, no
 * open-weight rights assumed. The provider ADAPTER (another lane)
 * owns the protocol; this record is metadata + provenance.
 */
export const QWEN_LIVETRANSLATE_FLASH_REALTIME: ManagedRealtimeModelDescriptor = {
  providerId: REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
  logicalTask: REALTIME_TRANSLATION_LOGICAL_TASK,
  model: {
    modelId: "qwen3.8-livetranslate-flash-realtime",
    revision: "research-2026-09-20",
  },
  serviceName: "Alibaba Cloud Model Studio",
  transport: "managed-streaming-session",
  license: {
    distribution: "managed-service-only",
    openWeights: false,
    notes:
      "The currently documented production endpoint is the vendor's managed cloud service; no public open-weight distribution was found in the reviewed official materials — WebFlix treats this as a managed provider and never assumes self-hosting or open-weight rights.",
  },
  capabilityProfile: {
    streamingInput: true,
    sourceAsr: true,
    textTranslation: true,
    streamingTextOutput: true,
    translatedSpeechOutput: true,
    speakerAttribution: true,
    visualContextInput: true,
    hotwordSupport: true,
    voiceCloning: {
      supported: true,
      consentGated: true, // the R25-H law, structural: consent is not optional
    },
    supportedLanguageDirections: {
      sourceLanguages: [...REALTIME_SPECIALIST_LANGUAGE_COVERAGE.sourceLanguages],
      audioOutputLanguages: [...REALTIME_SPECIALIST_LANGUAGE_COVERAGE.audioOutputLanguages],
    },
    latencyProfile: "low-latency-streaming",
    privacyClass: "remote", // a managed cloud service — input travels to the vendor
    priceCostModel: REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
    providerProvenance: REALTIME_PROVIDER_PROVENANCE,
    model: {
      modelId: "qwen3.8-livetranslate-flash-realtime",
      revision: "research-2026-09-20",
    },
  },
  provenance: REALTIME_PROVIDER_PROVENANCE,
};

// ---------------------------------------------------------------------------
// The specialist-lane laws (machine-checkable)
// ---------------------------------------------------------------------------

/**
 * THE MANAGED-PROVIDER LAW (total): may a managed-service-only
 * realtime provider be treated as self-hostable or open-weight?
 * NEVER — the distribution truth is the license truth. The
 * machine-checkable law for the R25 acceptance battery.
 */
export function mayManagedRealtimeProviderAssumeSelfHosting(): false {
  return false;
}

/**
 * Assert the never-overload law holds for this record's lane (wiring
 * check): the logical task stays distinct from both batch
 * vocabularies. Throws on drift; returns true otherwise.
 */
export function realtimeProviderRecordObeysLaneLaws(): true {
  return realtimeTaskIsDistinctFromBatchTasks();
}

/**
 * The capability dimensions this provider's profile answers, in plan
 * order (tests assert the profile covers ALL of them — the totality
 * audit).
 */
export function realtimeSpecialistDimensionCoverage(): readonly string[] {
  const profile = QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile as unknown as Record<
    string,
    unknown
  >;
  /** The dimension id → profile field mapping (every dimension, one truth). */
  const fieldByDimension: Readonly<Record<string, string>> = {
    "streaming-input": "streamingInput",
    "source-asr": "sourceAsr",
    "text-translation": "textTranslation",
    "streaming-text-output": "streamingTextOutput",
    "translated-speech-output": "translatedSpeechOutput",
    "speaker-attribution": "speakerAttribution",
    "visual-context-input": "visualContextInput",
    "hotword-support": "hotwordSupport",
    "voice-cloning": "voiceCloning",
    "supported-language-directions": "supportedLanguageDirections",
    "latency-profile": "latencyProfile",
    "privacy-class": "privacyClass",
    "price-cost-model": "priceCostModel",
    "provider-provenance": "providerProvenance",
    "revision-model-id": "model",
  };
  return REALTIME_CAPABILITY_DIMENSIONS.filter((dimension) => {
    const field = fieldByDimension[dimension];
    return field !== undefined && field in profile;
  });
}

/** Validate the frozen specialist record as a whole (the audit entry point). */
export function validateRealtimeSpecialistRecord(): ManagedRealtimeModelValidation {
  return validateManagedRealtimeModelDescriptor(QWEN_LIVETRANSLATE_FLASH_REALTIME);
}

/** Validate the frozen specialist's rate card (the R25-K audit entry point). */
export function validateRealtimeSpecialistRateCard(): ReturnType<typeof validateRealtimeTokenRateCard> {
  return validateRealtimeTokenRateCard(
    QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile.priceCostModel,
  );
}

/**
 * The vendor-reported lag versus the R2T2 reported average — the
 * honest comparison the router's latency reasoning may quote (both
 * REPORTED figures, never guarantees; from different measurement
 * contexts, so this is documentation, not a routing input).
 */
export const REPORTED_LATENCY_CONTEXT: Readonly<{
  realtimeSpecialistReportedAverageLagMs: number;
  liveAsrReportedAverageLatencyMs: Readonly<{ minMs: number; maxMs: number }>;
  basis: string;
}> = {
  realtimeSpecialistReportedAverageLagMs: REALTIME_SPECIALIST_REPORTED_FACTS.reportedAverageLagMs,
  liveAsrReportedAverageLatencyMs: R2T2_REPORTED_AVERAGE_LATENCY_MS,
  basis: "both figures are vendor/project-REPORTED from different measurement contexts — documentation only, never routing inputs or guarantees (R25-L owns end-to-end benchmarks)",
};
