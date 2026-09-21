/**
 * @wfx/model-fabric — the realtime translation routing contract
 * (R25-B router policy seams).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-B): the router
 * may choose the realtime translation specialist (the managed
 * provider) when the request requires combinations such as realtime
 * translation + translated speech, realtime translation + speaker
 * separation, or realtime translation + visual context. It MUST
 * choose R2T2 or another provider when the requested output is ONLY
 * low-latency source transcription, and it MUST NEVER route batch
 * workloads to the realtime specialist (never overload the batch
 * transform task; never treat the realtime specialist as the
 * universal model).
 *
 * THE THREE LANES, VERBATIM FROM THE PLAN:
 *
 * - REALTIME SPECIALIST → realtime translation + audio output /
 *   speaker separation / visual context (the combinations only a
 *   simultaneous-translation model serves);
 * - R2T2 (or another registered live-ASR provider) → low-latency
 *   source transcription only (live captions without translation —
 *   the R23-G lane keeps it);
 * - BATCH STACKS (MOSS-Transcribe-Diarize / Whisper) → long-form/
 *   offline transcription stays exactly where it is.
 *
 * WHAT THIS MODULE IS: PURE routing derivations over registration
 * truth — which realtime-capable provider ids and live-ASR provider
 * ids are REGISTERED (the routeAsr precedent: a catalog row never
 * bound and registered is NOT available; capability claims without a
 * real adapter path are drift). No session mechanics, no I/O — the
 * session seam is R25-A; the adapter lane owns the protocol.
 */

import { R2T2_OPEN_MODEL } from "../open-models/catalog";
import {
  REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
} from "./provider";
import {
  profileServesLanguage,
  profileServesRealtimeRequest,
  type RealtimeTranslationCapabilityProfile,
} from "./task";

// ---------------------------------------------------------------------------
// The request profile (what the user is asking for)
// ---------------------------------------------------------------------------

/**
 * What a realtime media request needs — the routing dimensions the
 * plan's decision table keys on. A request that needs NO translation
 * (only low-latency source transcription) is the R2T2 lane; a request
 * that needs translation (with or without the extras) is the
 * realtime-specialist lane; a batch workload is neither.
 */
export interface RealtimeRequestProfile {
  /** Does the request need TRANSLATED output at all? (false ⇒ live-ASR or batch lane) */
  readonly needsTranslation: boolean;
  /** Does the request need translated SPEECH (not just text)? */
  readonly needsTranslatedSpeech?: boolean;
  /** Does the request need speaker separation/attribution? */
  readonly needsSpeakerSeparation?: boolean;
  /** Does the request need visual context (frame input)? */
  readonly needsVisualContext?: boolean;
  /** Does the request need hotword support? */
  readonly needsHotwords?: boolean;
  /** The target language, when translation is needed. */
  readonly targetLanguage?: string;
}

/** The workload kind the router distinguishes (the third lane guard). */
export type RealtimeWorkloadKind = "realtime" | "batch";

/** Every workload kind. */
export const REALTIME_WORKLOAD_KINDS: readonly RealtimeWorkloadKind[] = [
  "realtime",
  "batch",
] as const;

/** Runtime membership check against the workload union. */
export function isRealtimeWorkloadKind(x: unknown): x is RealtimeWorkloadKind {
  return typeof x === "string" && (REALTIME_WORKLOAD_KINDS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// The routing input (registration truth + the policy preference)
// ---------------------------------------------------------------------------

/**
 * The routing input: the request profile, the workload kind, the
 * registration truth, and the caller's model-policy preference (the
 * alternative policy choice — when set, registered, and capable, it
 * wins over the default routing, the routeAsr law).
 */
export interface RealtimeRoutingInput {
  /** The workload kind: realtime (streaming) or batch (offline/long-form). */
  readonly workload: RealtimeWorkloadKind;
  /** What the request needs. */
  readonly request: RealtimeRequestProfile;
  /**
   * The REALTIME-CAPABLE provider ids REGISTERED in Model Fabric
   * (registration truth — descriptors that were never bound to an
   * adapter and registered are NOT available).
   */
  readonly availableRealtimeProviderIds: readonly string[];
  /**
   * The LIVE-ASR provider ids REGISTERED for low-latency source
   * transcription (the R23-G lane's registration truth).
   */
  readonly availableLiveAsrProviderIds: readonly string[];
  /**
   * The caller's model-policy preferred provider (the alternative
   * policy choice).
   */
  readonly preferredProviderId?: string;
  /**
   * The capability profiles of the available realtime providers, by
   * provider id — the capability truth the specialist decision keys
   * on (language coverage, translated speech, speaker separation,
   * visual context, hotwords). Absent entries are treated as
   * not-capable (an unreadable profile is drift, never a pass).
   */
  readonly realtimeCapabilityProfiles?: Readonly<Record<string, RealtimeTranslationCapabilityProfile>>;
}

// ---------------------------------------------------------------------------
// The typed routing decision
// ---------------------------------------------------------------------------

/** The typed outcome of one realtime routing decision. */
export type RealtimeRouteDecision =
  | {
      /** The realtime translation specialist won the request. */
      kind: "realtime-translation-specialist";
      readonly providerId: string;
      readonly detail: string;
    }
  | {
      /** A registered realtime provider other than the default specialist won (still the specialist LANE). */
      kind: "realtime-translation-provider";
      readonly providerId: string;
      readonly detail: string;
    }
  | {
      /** R2T2 (or another live-ASR provider) won the transcription-only request. */
      kind: "low-latency-source-transcription";
      readonly providerId: string;
      readonly detail: string;
    }
  | {
      /** The caller's preferred provider won (the alternative policy choice). */
      kind: "provider-policy-choice";
      readonly providerId: string;
      readonly detail: string;
    }
  | {
      /** A batch workload was pointed at the realtime router — refused, with the honest recovery. */
      kind: "batch-workload-not-realtime";
      readonly detail: string;
      readonly recovery: string;
    }
  | {
      /** Translation needed, but no realtime provider registered — the honest gap. */
      kind: "no-realtime-route-registered";
      readonly detail: string;
      readonly recovery: string;
    }
  | {
      /** The realtime specialist is registered but cannot serve this request — the honest capability gap. */
      kind: "realtime-capability-gap";
      readonly providerId: string;
      readonly detail: string;
      readonly recovery: string;
    }
  | {
      /** Transcription-only requested, but no live-ASR provider registered — the honest gap. */
      kind: "no-live-asr-route-registered";
      readonly detail: string;
      readonly recovery: string;
    };

// ---------------------------------------------------------------------------
// The routing decision (pure)
// ---------------------------------------------------------------------------

/**
 * THE REALTIME ROUTING DECISION (pure; the single derivation the
 * realtime seam consults), in deterministic order:
 *
 * 1. BATCH GUARD: a batch workload NEVER routes to the realtime
 *    specialist — the typed refusal names the batch stacks (never
 *    overload the batch transform task; never the universal model).
 * 2. POLICY FIRST: a set, registered, capable preferred provider
 *    wins (the alternative policy choice — the routeAsr law).
 * 3. TRANSCRIPTION-ONLY: a request that needs no translation routes
 *    to R2T2 when registered (the R23-G lane), else the honest gap.
 *    Batch models are never silently substituted into a live lane.
 * 4. REALTIME SPECIALIST: a request that needs translation routes to
 *    the managed specialist when registered AND capable (language
 *    coverage + the requested combination); another registered
 *    realtime provider may serve when the specialist cannot; else the
 *    honest capability gap. A live-ASR provider is never silently
 *    substituted into the translation lane (transcription is not
 *    translation).
 * 5. NO REALTIME ROUTE: translation needed, nothing registered — the
 *    honest gap with the recovery hint.
 */
export function routeRealtimeTranslation(input: RealtimeRoutingInput): RealtimeRouteDecision {
  // 1. The batch guard.
  if (input.workload === "batch") {
    return {
      kind: "batch-workload-not-realtime",
      detail:
        "a batch (offline/long-form) workload never routes to the realtime translation specialist — batch transcription stays with the batch stacks",
      recovery:
        "route long-form transcription through the batch transform stacks (MOSS-Transcribe-Diarize or Whisper under the batch ASR routing)",
    };
  }

  const realtimeAvailable = new Set(input.availableRealtimeProviderIds);
  const liveAsrAvailable = new Set(input.availableLiveAsrProviderIds);
  const profiles = input.realtimeCapabilityProfiles ?? {};

  // 2. The alternative policy choice (preferred + registered + capable).
  if (
    input.preferredProviderId !== undefined &&
    (realtimeAvailable.has(input.preferredProviderId) ||
      liveAsrAvailable.has(input.preferredProviderId))
  ) {
    const profile = profiles[input.preferredProviderId];
    const capable = profile === undefined ? false : requestServedByProfile(input.request, profile);
    if (capable) {
      return {
        kind: "provider-policy-choice",
        providerId: input.preferredProviderId,
        detail: `Your model policy prefers '${input.preferredProviderId}' for realtime media work — it runs this ${describeRequest(input.request)} under that policy.`,
      };
    }
  }

  // 3. Transcription-only: the live-ASR lane (R2T2).
  if (input.request.needsTranslation !== true) {
    if (liveAsrAvailable.has(R2T2_OPEN_MODEL.providerId)) {
      return {
        kind: "low-latency-source-transcription",
        providerId: R2T2_OPEN_MODEL.providerId,
        detail:
          "R2T2 runs this low-latency source-transcription request — true streaming with committed output, typically well under a second; no translation is needed, so the realtime translation specialist stays out of it.",
      };
    }
    const anyLiveAsr = input.availableLiveAsrProviderIds[0];
    if (anyLiveAsr !== undefined) {
      return {
        kind: "low-latency-source-transcription",
        providerId: anyLiveAsr,
        detail:
          `'${anyLiveAsr}' runs this low-latency source-transcription request under your policy — no translation is needed, so the realtime translation specialist stays out of it.`,
      };
    }
    return {
      kind: "no-live-asr-route-registered",
      detail:
        "No low-latency live speech provider is registered — live source transcription stays off rather than fake live timing with a batch model or overload the realtime translation specialist.",
      recovery:
        "Bind and register the R2T2 open model (open-model:r2t2), or set a model policy that prefers another registered live speech provider.",
    };
  }

  // 4. The realtime translation specialist lane.
  const specialistId = REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID;
  const specialistProfile =
    profiles[specialistId] ?? QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile;
  if (realtimeAvailable.has(specialistId)) {
    if (requestServedByProfile(input.request, specialistProfile)) {
      return {
        kind: "realtime-translation-specialist",
        providerId: specialistId,
        detail: `The realtime translation specialist runs this ${describeRequest(input.request)} — simultaneous translation with ${specialistDetail(input.request)}.`,
      };
    }
    // The specialist cannot serve this exact request — try another
    // registered realtime provider before answering the honest gap.
    const alternative = alternativeRealtimeProvider(input, specialistId);
    if (alternative !== undefined) {
      return {
        kind: "realtime-translation-provider",
        providerId: alternative,
        detail: `The realtime translation specialist cannot serve this ${describeRequest(input.request)} — registered realtime provider '${alternative}' can, and runs it instead.`,
      };
    }
    return {
      kind: "realtime-capability-gap",
      providerId: specialistId,
      detail: capabilityGapDetail(input.request, specialistProfile),
      recovery:
        "choose a supported target language/modality combination, or set a model policy that prefers another registered realtime translation provider.",
    };
  }

  // 5. Another registered realtime provider may serve.
  const alternative = alternativeRealtimeProvider(input, specialistId);
  if (alternative !== undefined) {
    return {
      kind: "realtime-translation-provider",
      providerId: alternative,
      detail: `Registered realtime provider '${alternative}' runs this ${describeRequest(input.request)} — the realtime translation specialist is not registered on this deployment.`,
    };
  }

  return {
    kind: "no-realtime-route-registered",
    detail:
      "No realtime translation provider is registered — realtime translation stays off rather than fake simultaneous output with a batch model or a live-ASR-only provider.",
    recovery:
      "register the managed realtime translation provider (managed-cloud:qwen3.8-livetranslate-flash-realtime) through its adapter, or set a model policy that prefers another registered realtime translation provider.",
  };
}

// ---------------------------------------------------------------------------
// Internal derivations
// ---------------------------------------------------------------------------

/** Can this profile serve the request's combination + language? */
function requestServedByProfile(
  request: RealtimeRequestProfile,
  profile: RealtimeTranslationCapabilityProfile,
): boolean {
  if (!profileServesRealtimeRequest(profile, request)) return false;
  if (request.targetLanguage !== undefined) {
    return profileServesLanguage(profile, request.targetLanguage, {
      requireAudioOutput: request.needsTranslatedSpeech === true,
    });
  }
  return true;
}

/** The first registered realtime provider OTHER than the excluded id that can serve the request. */
function alternativeRealtimeProvider(
  input: RealtimeRoutingInput,
  excludeProviderId: string,
): string | undefined {
  const profiles = input.realtimeCapabilityProfiles ?? {};
  for (const providerId of input.availableRealtimeProviderIds) {
    if (providerId === excludeProviderId) continue;
    const profile = profiles[providerId];
    if (profile === undefined) continue; // unreadable profile — drift, never a pass
    if (requestServedByProfile(input.request, profile)) return providerId;
  }
  return undefined;
}

/** A human-readable name for the request's shape. */
function describeRequest(request: RealtimeRequestProfile): string {
  if (request.needsTranslation !== true) return "source-transcription request";
  const extras: string[] = [];
  if (request.needsTranslatedSpeech === true) extras.push("translated speech");
  if (request.needsSpeakerSeparation === true) extras.push("speaker separation");
  if (request.needsVisualContext === true) extras.push("visual context");
  if (request.needsHotwords === true) extras.push("hotwords");
  return extras.length > 0
    ? `realtime translation request (${extras.join(" + ")})`
    : "realtime translation request";
}

/** The honest specialist detail for the winning decision. */
function specialistDetail(request: RealtimeRequestProfile): string {
  if (request.needsTranslatedSpeech === true && request.needsVisualContext === true) {
    return "streaming source transcript, translated text and speech, and visual context";
  }
  if (request.needsTranslatedSpeech === true) {
    return "streaming source transcript, translated text and translated speech";
  }
  if (request.needsVisualContext === true) {
    return "streaming source transcript, translated text, and visual context";
  }
  return "streaming source transcript and translated text";
}

/** The honest capability-gap detail naming what the profile lacks. */
function capabilityGapDetail(
  request: RealtimeRequestProfile,
  profile: RealtimeTranslationCapabilityProfile,
): string {
  const gaps: string[] = [];
  if (request.needsTranslatedSpeech === true && !profile.translatedSpeechOutput) {
    gaps.push("translated speech output");
  }
  if (request.needsSpeakerSeparation === true && !profile.speakerAttribution) {
    gaps.push("speaker separation");
  }
  if (request.needsVisualContext === true && !profile.visualContextInput) {
    gaps.push("visual context input");
  }
  if (request.needsHotwords === true && !profile.hotwordSupport) {
    gaps.push("hotword support");
  }
  if (
    request.targetLanguage !== undefined &&
    !profileServesLanguage(profile, request.targetLanguage, {
      requireAudioOutput: request.needsTranslatedSpeech === true,
    })
  ) {
    gaps.push(`target language '${request.targetLanguage}'`);
  }
  return gaps.length > 0
    ? `the realtime translation specialist does not serve ${gaps.join(" + ")} — the request stays honest rather than half-served`
    : "the realtime translation specialist cannot serve this request";
}
