/**
 * @wfx/model-fabric — the realtime-translation logical task (R25-B).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-B): Model
 * Fabric gains a REALTIME TRANSLATION logical task with its own
 * capability dimensions — rather than overloading the existing batch
 * transform task. Three structural laws:
 *
 * 1. THE LOGICAL TASK IS A SEPARATE VOCABULARY, deliberately BESIDE
 *    the frozen `ModelTask` union (the open-model intelligence-
 *    capability precedent): the frozen union governs the batch
 *    `invoke()` gateway; a streaming session is NOT an invoke() — it
 *    runs through the `RealtimeTranslationSessionFactory` seam
 *    (R25-A). `realtimeTaskIsDistinctFromBatchTasks()` asserts the
 *    separation at runtime and any drift throws.
 * 2. THE CAPABILITY DIMENSIONS are the plan's list, verbatim (15
 *    dimensions), as a CLOSED vocabulary with a typed profile record
 *    every realtime provider descriptor must fill completely.
 * 3. THE SPECIALIST LAW: realtime translation is its own specialist
 *    lane. R2T2 keeps the low-latency source-ASR lane; MOSS/Whisper
 *    keep the batch transcription stacks; the realtime specialist is
 *    chosen for realtime translation COMBOS (translated speech,
 *    speaker separation, visual context) — never as the universal
 *    model. The routing derivation itself lives in `router.ts`.
 */

import type { ModelTask } from "@wfx/domain";

import { MODEL_TASKS } from "../types";
import { TRANSFORMATION_TASK_KINDS } from "../transform/tasks";
import type { OpenModelLatencyProfile, OpenModelPrivacyClass } from "../open-models/open-model";
import { validateRealtimeTokenRateCard, type RealtimeTokenRateCard } from "./cost";

// ---------------------------------------------------------------------------
// The logical task (a vocabulary BESIDE the frozen ModelTask union)
// ---------------------------------------------------------------------------

/**
 * The realtime translation LOGICAL task id — a separate vocabulary
 * beside the frozen `ModelTask` union (the batch gateway never sees
 * it; the session seam does). Exactly the plan's recommendation.
 */
export const REALTIME_TRANSLATION_LOGICAL_TASK = "realtime-translation" as const;

/** The logical task union (one member today; extension is lead-owned). */
export type RealtimeLogicalTask = typeof REALTIME_TRANSLATION_LOGICAL_TASK;

/**
 * THE NEVER-OVERLOAD LAW (machine-checkable): the realtime logical
 * task must NEVER appear in the frozen `ModelTask` union (which would
 * push a streaming session through the batch invoke() gateway) nor in
 * the batch `TransformationTaskKind` vocabulary (which would overload
 * the batch transform task the plan explicitly preserves). Drift in
 * either direction throws — the separation is structural.
 *
 * @throws Error when either batch vocabulary has absorbed the
 *         realtime logical task id.
 */
export function realtimeTaskIsDistinctFromBatchTasks(): true {
  if ((MODEL_TASKS as readonly string[]).includes(REALTIME_TRANSLATION_LOGICAL_TASK)) {
    throw new Error(
      "realtime-translation must never join the frozen ModelTask union — a streaming session is not a batch invoke() (the never-overload law)",
    );
  }
  if ((TRANSFORMATION_TASK_KINDS as readonly string[]).includes(REALTIME_TRANSLATION_LOGICAL_TASK)) {
    throw new Error(
      "realtime-translation must never join the batch TransformationTaskKind vocabulary — the batch transform task stays its own lane (the never-overload law)",
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// The capability dimensions (the plan's 15, verbatim)
// ---------------------------------------------------------------------------

/**
 * The realtime-translation capability dimensions — the plan's R25-B
 * list, verbatim, as the CLOSED dimension vocabulary:
 *
 * - `streaming-input`            — accepts streaming audio input;
 * - `source-asr`                 — produces the source transcript;
 * - `text-translation`           — translates source text;
 * - `streaming-text-output`      — emits incremental translation text;
 * - `translated-speech-output`   — emits translated speech;
 * - `speaker-attribution`        — separates/labels speakers;
 * - `visual-context-input`       — accepts image/video frames;
 * - `hotword-support`            — accepts normalized hotword mappings;
 * - `voice-cloning`              — supports voice preservation (ALWAYS
 *                                  consent-gated, by type);
 * - `supported-language-directions` — the honest language coverage;
 * - `latency-profile`            — the honest latency envelope;
 * - `privacy-class`              — where input travels;
 * - `price-cost-model`           — the token rate card;
 * - `provider-provenance`        — where the record's truth came from;
 * - `revision-model-id`          — the pinned model identity.
 */
export type RealtimeCapabilityDimension =
  | "streaming-input"
  | "source-asr"
  | "text-translation"
  | "streaming-text-output"
  | "translated-speech-output"
  | "speaker-attribution"
  | "visual-context-input"
  | "hotword-support"
  | "voice-cloning"
  | "supported-language-directions"
  | "latency-profile"
  | "privacy-class"
  | "price-cost-model"
  | "provider-provenance"
  | "revision-model-id";

/** Every capability dimension, in plan order. */
export const REALTIME_CAPABILITY_DIMENSIONS: readonly RealtimeCapabilityDimension[] = [
  "streaming-input",
  "source-asr",
  "text-translation",
  "streaming-text-output",
  "translated-speech-output",
  "speaker-attribution",
  "visual-context-input",
  "hotword-support",
  "voice-cloning",
  "supported-language-directions",
  "latency-profile",
  "privacy-class",
  "price-cost-model",
  "provider-provenance",
  "revision-model-id",
] as const;

/** Runtime membership check against the dimension union. */
export function isRealtimeCapabilityDimension(x: unknown): x is RealtimeCapabilityDimension {
  return (
    typeof x === "string" &&
    (REALTIME_CAPABILITY_DIMENSIONS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The per-dimension value shapes
// ---------------------------------------------------------------------------

/**
 * The voice-cloning capability: supported or not, and ALWAYS
 * consent-gated — the literal `true` in the type is the R25-H law
 * made structural (there is no consent-optional voice cloning).
 */
export interface RealtimeVoiceCloningCapability {
  /** Does the provider support voice preservation at all? */
  readonly supported: boolean;
  /** Voice cloning is ALWAYS consent-gated — the literal is the law. */
  readonly consentGated: true;
}

/**
 * The honest language-direction coverage: which source languages the
 * provider serves, and — separately — the subset that also supports
 * translated AUDIO output (the 60-source / 29-audio-output research
 * shape). `audioOutputLanguages` must be a subset of
 * `sourceLanguages`.
 */
export interface RealtimeLanguageDirections {
  readonly sourceLanguages: readonly string[];
  readonly audioOutputLanguages: readonly string[];
}

/** The pinned model identity (the revision/model-id dimension). */
export interface RealtimeModelIdentity {
  readonly modelId: string;
  readonly revision: string;
}

/**
 * The COMPLETE capability profile a realtime provider descriptor
 * carries — one field per dimension, every dimension required (a
 * profile that cannot answer a dimension honestly is drift, rejected
 * by {@link validateRealtimeCapabilityProfile}).
 */
export interface RealtimeTranslationCapabilityProfile {
  /** streaming-input */
  readonly streamingInput: boolean;
  /** source-asr */
  readonly sourceAsr: boolean;
  /** text-translation */
  readonly textTranslation: boolean;
  /** streaming-text-output */
  readonly streamingTextOutput: boolean;
  /** translated-speech-output */
  readonly translatedSpeechOutput: boolean;
  /** speaker-attribution */
  readonly speakerAttribution: boolean;
  /** visual-context-input */
  readonly visualContextInput: boolean;
  /** hotword-support */
  readonly hotwordSupport: boolean;
  /** voice-cloning (always consent-gated — structural law) */
  readonly voiceCloning: RealtimeVoiceCloningCapability;
  /** supported-language-directions */
  readonly supportedLanguageDirections: RealtimeLanguageDirections;
  /** latency-profile (the open-model latency vocabulary, reused) */
  readonly latencyProfile: OpenModelLatencyProfile;
  /** privacy-class (the open-model privacy vocabulary, reused) */
  readonly privacyClass: OpenModelPrivacyClass;
  /** price-cost-model (the token rate card — R25-K) */
  readonly priceCostModel: RealtimeTokenRateCard;
  /** provider-provenance (non-empty — where this profile's truth came from) */
  readonly providerProvenance: string;
  /** revision-model-id (the pinned model identity) */
  readonly model: RealtimeModelIdentity;
}

/** The outcome of validating a capability profile. */
export type RealtimeCapabilityProfileValidation =
  | { ok: true }
  | { ok: false; problems: readonly string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Validate a realtime capability profile against the honest-shape
 * laws (pure; drift is rejected, never coerced):
 *
 * - every boolean dimension is a real boolean;
 * - voice cloning is consent-gated (the structural R25-H law);
 * - language directions are non-empty lists of non-empty tags, and
 *   audio-output languages are a SUBSET of source languages;
 * - latency/privacy members of their unions;
 * - the rate card validates;
 * - provenance non-empty; the model identity non-empty on both parts;
 * - coherence: a provider that cannot translate text is not a
 *   realtime translation provider (`textTranslation` + `sourceAsr`
 *   are the minimum bar); translated speech output requires
 *   `streamingInput`; visual-context input without audio streaming is
 *   not realtime translation.
 */
export function validateRealtimeCapabilityProfile(
  profile: unknown,
): RealtimeCapabilityProfileValidation {
  const problems: string[] = [];
  if (!isRecord(profile)) {
    return { ok: false, problems: ["expected a capability profile object"] };
  }

  for (const dimension of [
    "streamingInput",
    "sourceAsr",
    "textTranslation",
    "streamingTextOutput",
    "translatedSpeechOutput",
    "speakerAttribution",
    "visualContextInput",
    "hotwordSupport",
  ] as const) {
    if (typeof profile[dimension] !== "boolean") {
      problems.push(`${dimension}: expected a boolean (the dimension must be answered honestly)`);
    }
  }

  const voiceCloning = profile.voiceCloning;
  if (!isRecord(voiceCloning) || typeof voiceCloning.supported !== "boolean") {
    problems.push("voiceCloning: expected { supported: boolean }");
  } else if (voiceCloning.consentGated !== true) {
    problems.push("voiceCloning.consentGated: must be true — voice cloning is ALWAYS consent-gated");
  }

  const directions = profile.supportedLanguageDirections;
  if (!isRecord(directions) || !Array.isArray(directions.sourceLanguages)) {
    problems.push("supportedLanguageDirections: expected { sourceLanguages: string[] }");
  } else {
    if (directions.sourceLanguages.length === 0) {
      problems.push("supportedLanguageDirections.sourceLanguages: expected at least one source language");
    }
    for (const language of directions.sourceLanguages) {
      if (typeof language !== "string" || language.trim().length === 0) {
        problems.push("supportedLanguageDirections.sourceLanguages: every entry must be a non-empty tag");
        break;
      }
    }
    const audio = directions.audioOutputLanguages;
    if (!Array.isArray(audio)) {
      problems.push("supportedLanguageDirections.audioOutputLanguages: expected an array");
    } else {
      const source = new Set(directions.sourceLanguages as unknown[]);
      for (const language of audio) {
        if (typeof language !== "string" || language.length === 0) {
          problems.push("supportedLanguageDirections.audioOutputLanguages: every entry must be a non-empty tag");
          break;
        }
        if (!source.has(language)) {
          problems.push(
            `supportedLanguageDirections.audioOutputLanguages: '${language}' must also be a source language (audio output implies source support)`,
          );
        }
      }
    }
  }

  if (
    typeof profile.latencyProfile !== "string" ||
    !["low-latency-streaming", "near-interactive", "batch", "variable"].includes(profile.latencyProfile)
  ) {
    problems.push("latencyProfile: unknown latency profile");
  }
  if (typeof profile.privacyClass !== "string" || !["local-only", "remote"].includes(profile.privacyClass)) {
    problems.push("privacyClass: expected 'local-only' or 'remote'");
  }

  const rateCardValidation = validateRealtimeTokenRateCard(profile.priceCostModel);
  if (!rateCardValidation.ok) {
    problems.push(
      ...rateCardValidation.problems.map(
        (problem) => `priceCostModel: ${problem} (the R25-K cost model)`,
      ),
    );
  }

  if (typeof profile.providerProvenance !== "string" || profile.providerProvenance.length === 0) {
    problems.push("providerProvenance: expected non-empty provenance");
  }

  const model = profile.model;
  if (
    !isRecord(model) ||
    typeof model.modelId !== "string" ||
    model.modelId.length === 0 ||
    typeof model.revision !== "string" ||
    model.revision.length === 0
  ) {
    problems.push("model: expected { modelId, revision } — both non-empty (the revision/model-id dimension)");
  }

  // Coherence laws.
  if (profile.sourceAsr === false || profile.textTranslation === false) {
    problems.push(
      "coherence: a realtime translation provider must answer both source-asr and text-translation honestly — a profile that lacks either is not a realtime translation provider",
    );
  }
  if (profile.streamingInput !== true) {
    problems.push("coherence: realtime translation requires streaming input");
  }
  if (profile.translatedSpeechOutput === true && profile.streamingInput !== true) {
    problems.push("coherence: translated speech output requires streaming input");
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Does this profile serve a realtime translation request that needs
 * the given combination? (Pure; the router consults this — the
 * capability table, not the router, is the truth.)
 */
export function profileServesRealtimeRequest(
  profile: RealtimeTranslationCapabilityProfile,
  request: {
    readonly needsTranslatedSpeech?: boolean;
    readonly needsSpeakerSeparation?: boolean;
    readonly needsVisualContext?: boolean;
    readonly needsHotwords?: boolean;
  },
): boolean {
  if (request.needsTranslatedSpeech === true && !profile.translatedSpeechOutput) return false;
  if (request.needsSpeakerSeparation === true && !profile.speakerAttribution) return false;
  if (request.needsVisualContext === true && !profile.visualContextInput) return false;
  if (request.needsHotwords === true && !profile.hotwordSupport) return false;
  return true;
}

/**
 * Does this profile serve the given TARGET language (text and,
 * optionally, translated speech)? (Pure; language coverage is a
 * capability dimension, not an afterthought.)
 */
export function profileServesLanguage(
  profile: RealtimeTranslationCapabilityProfile,
  targetLanguage: string,
  options: { readonly requireAudioOutput?: boolean } = {},
): boolean {
  const serves = profile.supportedLanguageDirections.sourceLanguages.includes(targetLanguage);
  if (!serves) return false;
  if (options.requireAudioOutput === true) {
    return profile.supportedLanguageDirections.audioOutputLanguages.includes(targetLanguage);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The frozen-ModelTask relationship (the specialist-lane declarations)
// ---------------------------------------------------------------------------

/**
 * The batch tasks the realtime specialist must NOT displace (the
 * complementarity the plan freezes): the low-latency source-ASR lane
 * (R2T2's `speechToText`/`transcription` under the live-asr router)
 * and the batch transcription stacks stay exactly where they are.
 * This constant is documentation-as-law for the router tests; the
 * routing derivations live in `router.ts`.
 */
export const REALTIME_SPECIALIST_PRESERVED_BATCH_TASKS: readonly ModelTask[] = [
  "speechToText",
  "transcription",
];
