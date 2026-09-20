/**
 * @wfx/model-fabric — the R2T2 live/streaming ASR route (R23-G).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-G): R2T2 is
 * the LIVE/STREAMING low-latency ASR route — live captions where an
 * audio stream is legally available, voice/query input, real-time
 * speech-to-text feeding translation or commentary agents, and live
 * transcript search. R2T2 is NOT the universal offline ASR: Model
 * Fabric routes
 *
 * - R2T2 -> live/streaming low-latency;
 * - MOSS-Transcribe-Diarize or Whisper -> long-form/batch;
 * - provider/local model -> the alternative policy choice (the
 *   caller's preferred provider wins when it is registered and serves
 *   the task).
 *
 * THE LEGAL-AUDIO PRECONDITION (the honest gate): live ASR work runs
 * ONLY where an audio stream is legally available to WebFlix. When it
 * is not, {@link liveAsrReadiness} answers the typed
 * `audio-not-legally-available` refusal — there is NO capture
 * circumvention path (the frozen no-DRM/no-access-control-bypass laws;
 * the R25 non-negotiables echo the same boundary for realtime
 * translation).
 *
 * THE R2T2 ENVELOPE (frozen research facts, carried as constants):
 * true streaming with append-only committed output; configurable
 * 80 ms-2 s chunks; reported average latency ~200-600 ms; hotword/
 * context prompting; vLLM serving; broad multilingual capability with
 * Chinese/English as the primary optimization target.
 *
 * WHAT THIS MODULE IS: PURE routing derivations over registration truth
 * (which ASR-capable providers are registered) + the catalog. No
 * streaming engine, no audio capture, no model invocation — the
 * streaming session mechanics belong to the R25 realtime seam and the
 * platform adapters; this module is the ROUTING CONTRACT.
 */

import { openModelCatalogEntryOf, R2T2_OPEN_MODEL } from "./catalog";
import type { OpenModelDescriptor } from "./open-model";

// ---------------------------------------------------------------------------
// The frozen R2T2 envelope (research facts as constants)
// ---------------------------------------------------------------------------

/** R2T2's configurable chunk range, in milliseconds (frozen research fact). */
export const R2T2_CHUNK_RANGE_MS: Readonly<{ minMs: number; maxMs: number }> = {
  minMs: 80,
  maxMs: 2_000,
};

/** R2T2's reported average latency range, in milliseconds (frozen research fact). */
export const R2T2_REPORTED_AVERAGE_LATENCY_MS: Readonly<{
  minMs: number;
  maxMs: number;
}> = { minMs: 200, maxMs: 600 };

// ---------------------------------------------------------------------------
// The workload + use-case vocabularies
// ---------------------------------------------------------------------------

/**
 * The ASR workload kind — the routing dimension the plan freezes:
 * - `"live-streaming"` — live captions, voice input, realtime STT —
 *   the low-latency route (R2T2);
 * - `"long-form-batch"` — offline transcription of stored media — the
 *   batch route (MOSS-Transcribe-Diarize or Whisper).
 */
export type AsrWorkloadKind = "live-streaming" | "long-form-batch";

/** Every value of {@link AsrWorkloadKind}. */
export const ASR_WORKLOAD_KINDS: readonly AsrWorkloadKind[] = [
  "live-streaming",
  "long-form-batch",
] as const;

/** Runtime membership check against the workload union. */
export function isAsrWorkloadKind(x: unknown): x is AsrWorkloadKind {
  return (
    typeof x === "string" &&
    (ASR_WORKLOAD_KINDS as readonly string[]).includes(x)
  );
}

/**
 * The live-ASR use cases (the plan's R23-G list): live captions,
 * voice/query input, real-time STT feeding translation or commentary
 * agents, and live transcript search.
 */
export type LiveAsrUseCase =
  | "live-captions"
  | "voice-query-input"
  | "realtime-stt-translation"
  | "live-transcript-search";

/** Every value of {@link LiveAsrUseCase}, in plan order. */
export const LIVE_ASR_USE_CASES: readonly LiveAsrUseCase[] = [
  "live-captions",
  "voice-query-input",
  "realtime-stt-translation",
  "live-transcript-search",
] as const;

/** Runtime membership check against the use-case union. */
export function isLiveAsrUseCase(x: unknown): x is LiveAsrUseCase {
  return (
    typeof x === "string" &&
    (LIVE_ASR_USE_CASES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The legal-audio precondition (the honest gate)
// ---------------------------------------------------------------------------

/** The preconditions every live-ASR use case must declare. */
export interface LiveAsrPreconditions {
  /**
   * Whether an audio stream is LEGALLY available to WebFlix for this
   * use case (the content's audio the platform may lawfully process).
   */
  readonly audioStreamLegallyAvailable: boolean;
}

/** The readiness truth of one live-ASR use case. */
export type LiveAsrReadiness =
  | { kind: "ready" }
  | {
      /** The honest refusal: the audio stream is not legally available. */
      kind: "audio-not-legally-available";
      /** One honest sentence naming the boundary (never a circumvention hint). */
      readonly detail: string;
    };

/**
 * The legal-audio gate (pure): live ASR work runs ONLY where an audio
 * stream is legally available. The refusal is TYPED and honest — it
 * names the boundary, never a workaround (no DRM, no access-control
 * bypass, no capture of protected provider media).
 */
export function liveAsrReadiness(
  preconditions: LiveAsrPreconditions,
): LiveAsrReadiness {
  if (preconditions.audioStreamLegallyAvailable) {
    return { kind: "ready" };
  }
  return {
    kind: "audio-not-legally-available",
    detail:
      "Live speech features need an audio stream WebFlix is legally allowed to process — this content's audio is not available to WebFlix, so live captions and live transcription stay off for it (there is no bypass, by design).",
  };
}

// ---------------------------------------------------------------------------
// The routing contract
// ---------------------------------------------------------------------------

/** The routing input: workload + registration truth + the policy preference. */
export interface AsrRoutingInput {
  /** The workload to route for. */
  readonly workload: AsrWorkloadKind;
  /**
   * The ASR-capable provider ids REGISTERED in Model Fabric (the
   * registration truth — a catalog row that was never bound to an
   * executor and registered is NOT available; capability claims
   * without a real adapter path are drift).
   */
  readonly availableProviderIds: readonly string[];
  /**
   * The caller's model-policy preferred provider (the
   * provider/local-model ALTERNATIVE POLICY CHOICE — when set,
   * registered, and serving the task, it wins over the default
   * routing).
   */
  readonly preferredProviderId?: string;
}

/** The typed outcome of one ASR routing decision. */
export type AsrRouteDecision =
  | {
      /** R2T2 won the live/streaming low-latency route. */
      kind: "r2t2-live-low-latency";
      readonly providerId: string;
      readonly detail: string;
    }
  | {
      /** MOSS-Transcribe-Diarize or Whisper won the long-form/batch route. */
      kind: "batch-model";
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
      /** Live workload, no low-latency route registered — the honest gap. */
      kind: "no-live-route-registered";
      readonly detail: string;
      readonly recovery: string;
    }
  | {
      /** Batch workload, no batch route registered — the honest gap. */
      kind: "no-batch-route-registered";
      readonly detail: string;
      readonly recovery: string;
    };

/**
 * THE ASR ROUTING DECISION (pure; the single derivation Model Fabric's
 * ASR lane consults):
 *
 * 1. POLICY FIRST: when `preferredProviderId` is set, registered, and
 *    serves ASR tasks, it wins — the provider/local model is the
 *    alternative policy choice the plan preserves (the workload may
 *    still be live; policy owns the latency trade-off, and the decision
 *    names the choice honestly).
 * 2. LIVE-STREAMING: R2T2 (registered) wins the low-latency route;
 *    without it, the typed `no-live-route-registered` gap answers with
 *    the recovery hint (bind + register the R2T2 open model, or set a
 *    provider policy) — batch models are NOT silently substituted into
 *    the live lane (a ~seconds-latency batch pass would fake live
 *    captions).
 * 3. LONG-FORM-BATCH: MOSS-Transcribe-Diarize first, Whisper second
 *    (the plan's "MOSS-Transcribe-Diarize or Whisper"); without either,
 *    the typed `no-batch-route-registered` gap with its recovery.
 */
export function routeAsr(input: AsrRoutingInput): AsrRouteDecision {
  // 1. The alternative policy choice.
  if (
    input.preferredProviderId !== undefined &&
    input.availableProviderIds.includes(input.preferredProviderId)
  ) {
    return {
      kind: "provider-policy-choice",
      providerId: input.preferredProviderId,
      detail: `Your model policy prefers '${input.preferredProviderId}' for speech work — it runs this ${
        input.workload === "live-streaming" ? "live" : "batch"
      } workload under that policy.`,
    };
  }

  const available = new Set(input.availableProviderIds);

  // 2. The live/streaming low-latency route.
  if (input.workload === "live-streaming") {
    if (available.has(R2T2_OPEN_MODEL.providerId)) {
      return {
        kind: "r2t2-live-low-latency",
        providerId: R2T2_OPEN_MODEL.providerId,
        detail:
          "R2T2 runs this live workload — true streaming with committed output in configurable chunks, typically well under a second.",
      };
    }
    return {
      kind: "no-live-route-registered",
      detail:
        "No low-latency live speech provider is registered — live captions and realtime speech features stay off rather than fake live timing with a batch model.",
      recovery:
        "Bind and register the R2T2 open model (open-model:r2t2), or set a model policy that prefers another registered speech provider.",
    };
  }

  // 3. The long-form/batch route: MOSS first, Whisper second.
  const moss = "open-model:moss-transcribe-diarize";
  const whisper = "open-model:whisper-large-v3-turbo";
  if (available.has(moss)) {
    return {
      kind: "batch-model",
      providerId: moss,
      detail:
        "MOSS-Transcribe-Diarize runs this long-form workload — multi-speaker transcription with speaker labels, timestamps, and acoustic-event awareness.",
    };
  }
  if (available.has(whisper)) {
    return {
      kind: "batch-model",
      providerId: whisper,
      detail:
        "Whisper runs this long-form workload — broad batch transcription as the fallback route.",
    };
  }
  return {
    kind: "no-batch-route-registered",
    detail:
      "No batch speech provider is registered — long-form transcription stays off rather than fail silently.",
    recovery:
      "Bind and register MOSS-Transcribe-Diarize or Whisper (open-model:moss-transcribe-diarize / open-model:whisper-large-v3-turbo), or set a model policy that prefers another registered speech provider.",
  };
}

// ---------------------------------------------------------------------------
// Catalog derivations (which open models can serve ASR work)
// ---------------------------------------------------------------------------

/**
 * Does this catalog entry contribute to ASR work? (Pure — the catalog
 * rows' intelligence capabilities decide; the frozen tasks alone would
 * miss catalog-only distinctions and the R2T2 live/batch split.)
 */
export function isOpenModelAsrCapable(entry: OpenModelDescriptor): boolean {
  return entry.intelligenceCapabilities.some((capability) =>
    capability === "streaming-asr" || capability === "batch-transcription"
      ? true
      : false,
  );
}

/** The catalog's LIVE-route candidates (streaming-asr capability). */
export function liveAsrCatalogCandidates(): readonly OpenModelDescriptor[] {
  return [R2T2_OPEN_MODEL].filter((entry) =>
    entry.intelligenceCapabilities.includes("streaming-asr"),
  );
}

/** The catalog's BATCH-route candidates (batch-transcription capability). */
export function batchAsrCatalogCandidates(): readonly OpenModelDescriptor[] {
  const candidates = [
    "open-model:moss-transcribe-diarize",
    "open-model:whisper-large-v3-turbo",
  ];
  return candidates
    .map((providerId) => openModelCatalogEntryOf(providerId))
    .filter((entry) =>
      entry.intelligenceCapabilities.includes("batch-transcription"),
    );
}
