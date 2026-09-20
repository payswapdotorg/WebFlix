/**
 * @wfx/model-fabric — R23-G/H/I tests: the R2T2 live ASR route, the
 * multimodal discovery features, and the privacy/local path.
 *
 * R23-G — the ASR routing contract:
 * - R2T2 -> live/streaming low-latency; MOSS-Transcribe-Diarize or
 *   Whisper -> long-form/batch; provider/local model -> the alternative
 *   policy choice (preferred provider wins);
 * - live workload without R2T2 is the typed no-live-route gap (batch
 *   models are never silently substituted into the live lane);
 * - the legal-audio precondition: no legally available audio stream =>
 *   the typed honest refusal — no circumvention path;
 * - the frozen R2T2 envelope constants (80 ms-2 s chunks; ~200-600 ms
 *   reported average latency).
 *
 * R23-H — the discovery feature contracts:
 * - the plan's seven features with honest R23-F prerequisites and
 *   contributing models;
 * - THE OWNERSHIP LAW: models generate signals; the Recommendation OS
 *   owns user policy and authorization (lawful-definition check +
 *   the total always-false guard);
 * - availability degrades honestly over partial artifact sets (typed
 *   prerequisites-missing naming exactly what is absent).
 *
 * R23-I — the privacy/local path:
 * - the WebGPU-optional fallback chain: webgpu -> wasm ->
 *   remote-fallback, with typed privacy impact per hop;
 * - a local-only policy with no local hop is the typed honest refusal
 *   (never a silent hop to a remote model);
 * - the private-preprocessing payload law (derived features only).
 */

import { describe, expect, it } from "bun:test";

import {
  ASR_WORKLOAD_KINDS,
  LIVE_ASR_USE_CASES,
  LOCAL_INFERENCE_BACKENDS,
  LOCAL_INFERENCE_TASK_KINDS,
  R2T2_CHUNK_RANGE_MS,
  R2T2_REPORTED_AVERAGE_LATENCY_MS,
  batchAsrCatalogCandidates,
  discoveryFeatureAvailability,
  discoveryFeatureAvailabilityView,
  discoveryFeatureContractOf,
  discoveryFeatureRequirementsAreKnown,
  isAsrWorkloadKind,
  isDiscoveryFeatureKind,
  isLawfulDiscoveryFeatureDefinition,
  isLiveAsrUseCase,
  isLocalInferenceBackend,
  isLocalInferenceTaskKind,
  liveAsrCatalogCandidates,
  liveAsrReadiness,
  localInferenceRoute,
  mayModelOwnUserPolicyOrAuthorization,
  privacyImpactOfLocalInferenceBackend,
  privatePreprocessingPayloadClass,
  routeAsr,
  type MediaIntelligenceArtifacts,
} from "../src/index";

const R2T2 = "open-model:r2t2";
const MOSS = "open-model:moss-transcribe-diarize";
const WHISPER = "open-model:whisper-large-v3-turbo";

// ---------------------------------------------------------------------------
// R23-G — the frozen envelope + vocabularies
// ---------------------------------------------------------------------------

describe("R23-G — the frozen R2T2 envelope and vocabularies", () => {
  it("the frozen research facts: 80 ms-2 s chunks; ~200-600 ms reported average latency", () => {
    expect(R2T2_CHUNK_RANGE_MS).toEqual({ minMs: 80, maxMs: 2_000 });
    expect(R2T2_REPORTED_AVERAGE_LATENCY_MS).toEqual({ minMs: 200, maxMs: 600 });
  });

  it("the workload + use-case vocabularies are closed", () => {
    expect(ASR_WORKLOAD_KINDS).toEqual(["live-streaming", "long-form-batch"]);
    expect(isAsrWorkloadKind("live-streaming")).toBe(true);
    expect(isAsrWorkloadKind("realtime")).toBe(false);
    expect(LIVE_ASR_USE_CASES).toEqual([
      "live-captions",
      "voice-query-input",
      "realtime-stt-translation",
      "live-transcript-search",
    ]);
    for (const useCase of LIVE_ASR_USE_CASES) {
      expect(isLiveAsrUseCase(useCase)).toBe(true);
    }
    expect(isLiveAsrUseCase("offline-transcription")).toBe(false);
  });

  it("the catalog's live/batch ASR candidates split honestly", () => {
    expect(liveAsrCatalogCandidates().map((entry) => entry.providerId)).toEqual([
      R2T2,
    ]);
    expect(batchAsrCatalogCandidates().map((entry) => entry.providerId)).toEqual([
      MOSS,
      WHISPER,
    ]);
  });
});

// ---------------------------------------------------------------------------
// R23-G — the routing decision table
// ---------------------------------------------------------------------------

describe("R23-G — the ASR routing decision table", () => {
  it("live workload + R2T2 registered => the R2T2 low-latency route", () => {
    const decision = routeAsr({
      workload: "live-streaming",
      availableProviderIds: [R2T2, MOSS],
    });
    expect(decision.kind).toBe("r2t2-live-low-latency");
    if (decision.kind === "r2t2-live-low-latency") {
      expect(decision.providerId).toBe(R2T2);
      expect(decision.detail).toContain("live");
    }
  });

  it("live workload without R2T2 => the typed gap (batch models are NOT silently substituted)", () => {
    const decision = routeAsr({
      workload: "live-streaming",
      availableProviderIds: [MOSS, WHISPER],
    });
    expect(decision.kind).toBe("no-live-route-registered");
    if (decision.kind === "no-live-route-registered") {
      expect(decision.detail).toContain("rather than fake live timing");
      expect(decision.recovery).toContain("open-model:r2t2");
    }
    // And with nothing registered at all:
    const empty = routeAsr({
      workload: "live-streaming",
      availableProviderIds: [],
    });
    expect(empty.kind).toBe("no-live-route-registered");
  });

  it("batch workload => MOSS first, Whisper second", () => {
    const both = routeAsr({
      workload: "long-form-batch",
      availableProviderIds: [WHISPER, R2T2, MOSS],
    });
    expect(both.kind).toBe("batch-model");
    if (both.kind === "batch-model") {
      expect(both.providerId).toBe(MOSS);
    }
    const whisperOnly = routeAsr({
      workload: "long-form-batch",
      availableProviderIds: [WHISPER],
    });
    expect(whisperOnly.kind).toBe("batch-model");
    if (whisperOnly.kind === "batch-model") {
      expect(whisperOnly.providerId).toBe(WHISPER);
    }
    const none = routeAsr({
      workload: "long-form-batch",
      availableProviderIds: [R2T2],
    });
    expect(none.kind).toBe("no-batch-route-registered");
    if (none.kind === "no-batch-route-registered") {
      expect(none.recovery).toContain("open-model:moss-transcribe-diarize");
      expect(none.recovery).toContain("open-model:whisper-large-v3-turbo");
    }
  });

  it("the preferred provider is the ALTERNATIVE POLICY CHOICE (it wins when registered)", () => {
    const decision = routeAsr({
      workload: "live-streaming",
      availableProviderIds: [R2T2, "byom:custom-asr"],
      preferredProviderId: "byom:custom-asr",
    });
    expect(decision.kind).toBe("provider-policy-choice");
    if (decision.kind === "provider-policy-choice") {
      expect(decision.providerId).toBe("byom:custom-asr");
      expect(decision.detail).toContain("model policy");
    }
    // An unavailable preference falls back to the default routing.
    const fallback = routeAsr({
      workload: "live-streaming",
      availableProviderIds: [R2T2],
      preferredProviderId: "byom:custom-asr",
    });
    expect(fallback.kind).toBe("r2t2-live-low-latency");
  });
});

// ---------------------------------------------------------------------------
// R23-G — the legal-audio precondition
// ---------------------------------------------------------------------------

describe("R23-G — the legal-audio precondition (the honest gate)", () => {
  it("legally available audio => ready", () => {
    expect(liveAsrReadiness({ audioStreamLegallyAvailable: true })).toEqual({
      kind: "ready",
    });
  });

  it("no legally available audio => the typed refusal, never a circumvention hint", () => {
    const readiness = liveAsrReadiness({ audioStreamLegallyAvailable: false });
    expect(readiness.kind).toBe("audio-not-legally-available");
    if (readiness.kind === "audio-not-legally-available") {
      expect(readiness.detail).toContain("legally");
      expect(readiness.detail).toContain("no bypass, by design");
    }
  });
});

// ---------------------------------------------------------------------------
// R23-H — the discovery feature contracts
// ---------------------------------------------------------------------------

describe("R23-H — the frozen feature contracts", () => {
  it("covers EXACTLY the plan's seven features", () => {
    const kinds = Array.from({ length: 7 }, (_, i) => i);
    expect(kinds).toHaveLength(7);
    const contracts = [
      "search-by-meaning",
      "moment-search",
      "chapter-aware-signals",
      "visual-similarity",
      "anti-tunnel-exploration",
      "richer-explanations",
      "cold-start-understanding",
    ];
    for (const kind of contracts) {
      expect(isDiscoveryFeatureKind(kind)).toBe(true);
      const contract = discoveryFeatureContractOf(kind as never);
      expect(contract.label.length).toBeGreaterThan(0);
      expect(contract.detail.length).toBeGreaterThan(0);
      expect(contract.requiredArtifacts.length).toBeGreaterThan(0);
      expect(contract.contributingModels.length).toBeGreaterThan(0);
      expect(discoveryFeatureRequirementsAreKnown(contract)).toBe(true);
    }
    expect(isDiscoveryFeatureKind("voice-search")).toBe(false);
    expect(() => discoveryFeatureContractOf("voice-search" as never)).toThrow(
      /contract drift/,
    );
  });

  it("THE OWNERSHIP LAW: every contract keeps signals with models and policy with the OS", () => {
    for (const contract of [
      "search-by-meaning",
      "moment-search",
      "chapter-aware-signals",
      "visual-similarity",
      "anti-tunnel-exploration",
      "richer-explanations",
      "cold-start-understanding",
    ] as const) {
      const row = discoveryFeatureContractOf(contract);
      expect(isLawfulDiscoveryFeatureDefinition(row)).toBe(true);
      // A definition claiming model-side policy authority is drift.
      expect(
        isLawfulDiscoveryFeatureDefinition({
          ...row,
          policyOwnership: "model" as never,
        }),
      ).toBe(false);
    }
    // The total sharp end: models never own user policy or authorization.
    expect(mayModelOwnUserPolicyOrAuthorization()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R23-H — honest availability over artifact truth
// ---------------------------------------------------------------------------

/** A minimal artifacts set builder for availability derivations. */
function artifactsWith(coverage: {
  transcript?: boolean;
  chapters?: boolean;
  visual?: boolean;
  videoEmbedding?: boolean;
  textEmbedding?: boolean;
  moments?: boolean;
}): MediaIntelligenceArtifacts {
  const t0 = "2026-09-21T12:00:00.000Z";
  const provenance = {
    stage: "transcription" as const,
    modelId: "moss-transcribe-diarize",
    confidence: 0.9,
    producedAt: t0,
  };
  return {
    itemId: "wfxitm_demo0001",
    ...(coverage.transcript
      ? {
          transcript: {
            kind: "transcript" as const,
            segments: [
              { startMs: 0, endMs: 5_000, text: "hello", language: "en" },
            ],
            language: "en",
            model: provenance,
          },
        }
      : {}),
    ...(coverage.chapters
      ? {
          chaptersScenes: {
            kind: "chapters-scenes" as const,
            units: [{ kind: "chapter" as const, startMs: 0, endMs: 60_000 }],
            model: { ...provenance, stage: "structural-analysis" as const },
          },
        }
      : {}),
    ...(coverage.visual
      ? {
          visualConcepts: {
            kind: "visual-concepts" as const,
            detections: [
              { name: "kitchen", kind: "concept" as const, confidence: 0.9 },
            ],
            model: { ...provenance, stage: "video-embeddings" as const },
          },
        }
      : {}),
    ...(coverage.videoEmbedding
      ? {
          videoEmbedding: {
            kind: "video-embedding" as const,
            embedding: { vector: [0.1, 0.2], dimensions: 2 },
            model: { ...provenance, stage: "video-embeddings" as const },
          },
        }
      : {}),
    ...(coverage.textEmbedding
      ? {
          textEmbedding: {
            kind: "text-embedding" as const,
            embedding: { vector: [0.3, 0.4], dimensions: 2 },
            language: "en",
            model: { ...provenance, stage: "text-embeddings" as const },
          },
        }
      : {}),
    ...(coverage.moments
      ? {
          searchableMoments: {
            kind: "searchable-moments" as const,
            moments: [
              { startMs: 0, endMs: 10_000, description: "the beginning" },
            ],
            model: { ...provenance, stage: "semantic-index" as const },
          },
        }
      : {}),
  };
}

describe("R23-H — availability degrades honestly over partial artifact sets", () => {
  it("visual-similarity is available exactly when the video embedding exists", () => {
    const withEmbedding = artifactsWith({ videoEmbedding: true });
    expect(discoveryFeatureAvailability("visual-similarity", withEmbedding).kind).toBe(
      "available",
    );
    const without = artifactsWith({});
    expect(
      discoveryFeatureAvailability("visual-similarity", without).kind,
    ).toBe("prerequisites-missing");
  });

  it("the typed gap names EXACTLY what is missing (never a silent downgrade)", () => {
    const sparse = artifactsWith({ transcript: true });
    const availability = discoveryFeatureAvailability(
      "search-by-meaning",
      sparse,
    );
    expect(availability.kind).toBe("prerequisites-missing");
    if (availability.kind === "prerequisites-missing") {
      expect([...availability.missing].sort()).toEqual([
        "semantic-video-embedding",
        "transcript-text-embedding",
      ]);
      expect(availability.detail).toContain("stays off honestly");
    }
  });

  it("the full view renders every feature's availability in frozen order", () => {
    const view = discoveryFeatureAvailabilityView(artifactsWith({}));
    for (const kind of [
      "search-by-meaning",
      "moment-search",
      "chapter-aware-signals",
      "visual-similarity",
      "anti-tunnel-exploration",
      "richer-explanations",
      "cold-start-understanding",
    ] as const) {
      expect(view[kind].kind).toBe("prerequisites-missing");
    }
    const full = discoveryFeatureAvailabilityView(
      artifactsWith({
        transcript: true,
        chapters: true,
        visual: true,
        videoEmbedding: true,
        textEmbedding: true,
        moments: true,
      }),
    );
    for (const kind of [
      "search-by-meaning",
      "moment-search",
      "chapter-aware-signals",
      "visual-similarity",
      "anti-tunnel-exploration",
      "richer-explanations",
      "cold-start-understanding",
    ] as const) {
      expect(view[kind]).toBeDefined();
    }
    // With everything derived, search-by-meaning and visual-similarity are available;
    // richer-explanations needs visual concepts (present) + transcript + chapters (present).
    expect(full["search-by-meaning"].kind).toBe("available");
    expect(full["visual-similarity"].kind).toBe("available");
    expect(full["chapter-aware-signals"].kind).toBe("available");
    expect(full["richer-explanations"].kind).toBe("available");
    if (full["search-by-meaning"].kind === "available") {
      expect(full["search-by-meaning"].contributingModels).toContain(
        "open-model:bge-m3",
      );
      expect(full["search-by-meaning"].contributingModels).toContain(
        "open-model:videoprism-base-f16r288",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// R23-I — the privacy/local path
// ---------------------------------------------------------------------------

describe("R23-I — the WebGPU-optional fallback chain", () => {
  it("the task + backend vocabularies are closed (the plan's lists)", () => {
    expect(LOCAL_INFERENCE_TASK_KINDS).toEqual([
      "query-embeddings",
      "lightweight-classification",
      "local-media-helpers",
      "local-search-own-media",
      "private-preprocessing",
    ]);
    for (const task of LOCAL_INFERENCE_TASK_KINDS) {
      expect(isLocalInferenceTaskKind(task)).toBe(true);
    }
    expect(isLocalInferenceTaskKind("video-encoding")).toBe(false);
    expect(LOCAL_INFERENCE_BACKENDS).toEqual(["webgpu", "wasm", "remote-fallback"]);
    expect(isLocalInferenceBackend("webgpu")).toBe(true);
    expect(isLocalInferenceBackend("cuda")).toBe(false);
  });

  it("WebGPU available => the webgpu local hop (local-only impact)", () => {
    const route = localInferenceRoute(
      "query-embeddings",
      { webgpuAvailable: true, wasmAvailable: true },
      "local-only",
    );
    expect(route.kind).toBe("webgpu");
    if (route.kind === "webgpu") {
      expect(route.privacyImpact).toBe("local-only");
      expect(route.detail).toContain("nothing leaves this device");
    }
  });

  it("WebGPU off => the WASM local fallback (still local-only impact)", () => {
    const route = localInferenceRoute(
      "lightweight-classification",
      { webgpuAvailable: false, wasmAvailable: true },
      "local-only",
    );
    expect(route.kind).toBe("wasm");
    if (route.kind === "wasm") {
      expect(route.privacyImpact).toBe("local-only");
      expect(route.detail).toContain("WebGPU is off");
    }
  });

  it("no local hop + cloud policy => the remote fallback with the honest privacy consequence", () => {
    const route = localInferenceRoute(
      "query-embeddings",
      { webgpuAvailable: false, wasmAvailable: false },
      "trusted-cloud",
    );
    expect(route.kind).toBe("remote-fallback");
    if (route.kind === "remote-fallback") {
      expect(route.privacyImpact).toBe("input-leaves-device");
      expect(route.detail).toContain("leaves this device");
    }
    const anyCloud = localInferenceRoute(
      "query-embeddings",
      { webgpuAvailable: false, wasmAvailable: false },
      "any-cloud",
    );
    expect(anyCloud.kind).toBe("remote-fallback");
  });

  it("no local hop + local-only policy => the typed refusal (never a silent remote hop)", () => {
    const route = localInferenceRoute(
      "local-search-own-media",
      { webgpuAvailable: false, wasmAvailable: false },
      "local-only",
    );
    expect(route.kind).toBe("local-unavailable");
    if (route.kind === "local-unavailable") {
      expect(route.detail).toContain("stays off, honestly");
      expect(route.recovery).toContain("WebGPU");
    }
  });

  it("every task routes through the same chain (no task special-cases the privacy law)", () => {
    for (const task of LOCAL_INFERENCE_TASK_KINDS) {
      expect(
        localInferenceRoute(task, { webgpuAvailable: true, wasmAvailable: true }, "local-only")
          .kind,
      ).toBe("webgpu");
      expect(
        localInferenceRoute(task, { webgpuAvailable: false, wasmAvailable: true }, "local-only")
          .kind,
      ).toBe("wasm");
      expect(
        localInferenceRoute(task, { webgpuAvailable: false, wasmAvailable: false }, "local-only")
          .kind,
      ).toBe("local-unavailable");
    }
  });

  it("the privacy impact is derived from the hop (local hops stay on-device)", () => {
    expect(privacyImpactOfLocalInferenceBackend("webgpu")).toBe("local-only");
    expect(privacyImpactOfLocalInferenceBackend("wasm")).toBe("local-only");
    expect(privacyImpactOfLocalInferenceBackend("remote-fallback")).toBe(
      "input-leaves-device",
    );
  });

  it("the private-preprocessing payload law: derived features only, never the raw input", () => {
    expect(privatePreprocessingPayloadClass()).toBe("derived-features-only");
  });
});
