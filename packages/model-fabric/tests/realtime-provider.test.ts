/**
 * @wfx/model-fabric — R25-B provider metadata + provenance tests.
 *
 * The managed realtime provider record at the seam:
 * - THE MANAGED-PROVIDER LAW: the record is managed-service-only,
 *   openWeights false, never self-hostable by assumption;
 * - THE SPECIALIST RECORD AUDIT: the frozen record validates as a
 *   whole (identity, service, transport, license truth, the full
 *   capability profile, the rate card, provenance) and carries the
 *   frozen research facts (60/29 languages, reported lag figures);
 * - VALIDATION: drift is rejected — wrong logical task, managed
 *   distribution with open weights claimed, model-id disagreement
 *   between the descriptor and its profile, missing provenance;
 * - THE SPECIALIST-LANE LAWS: the record obeys the lane laws;
 *   self-hosting is never assumable; the R2T2 live-ASR lane and the
 *   batch stacks are the complement, not the competition.
 */

import { describe, expect, it } from "bun:test";

import {
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  REALTIME_MODEL_DISTRIBUTIONS,
  REALTIME_PROVIDER_PROVENANCE,
  REALTIME_SPECIALIST_LANGUAGE_COVERAGE,
  REALTIME_SPECIALIST_REPORTED_FACTS,
  REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
  REPORTED_LATENCY_CONTEXT,
  isRealtimeModelDistribution,
  mayManagedRealtimeProviderAssumeSelfHosting,
  realtimeProviderRecordObeysLaneLaws,
  validateManagedRealtimeModelDescriptor,
  validateRealtimeSpecialistRateCard,
  validateRealtimeSpecialistRecord,
  type ManagedRealtimeModelDescriptor,
} from "../src/index";

// ---------------------------------------------------------------------------
// The frozen specialist record (the audit)
// ---------------------------------------------------------------------------

describe("R25-B — the managed specialist record audit", () => {
  it("the record validates as a whole", () => {
    expect(validateRealtimeSpecialistRecord()).toEqual({ ok: true });
  });

  it("the record's rate card validates (the R25-K audit entry point)", () => {
    expect(validateRealtimeSpecialistRateCard()).toEqual({ ok: true });
  });

  it("carries the plan's provider identity and service truth", () => {
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.providerId).toBe(
      REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
    );
    expect(REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID).toBe(
      "managed-cloud:qwen3.8-livetranslate-flash-realtime",
    );
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.model.modelId).toBe(
      "qwen3.8-livetranslate-flash-realtime",
    );
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.serviceName).toBe("Alibaba Cloud Model Studio");
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.transport).toBe("managed-streaming-session");
  });

  it("THE MANAGED-PROVIDER LAW: managed-service-only, openWeights false, never self-hostable", () => {
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.license.distribution).toBe("managed-service-only");
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.license.openWeights).toBe(false);
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.license.notes).toContain("never assumes self-hosting");
    expect(mayManagedRealtimeProviderAssumeSelfHosting()).toBe(false); // total, always false
  });

  it("carries the frozen research facts (60/29 languages; reported lag; ASR default)", () => {
    expect(REALTIME_SPECIALIST_REPORTED_FACTS.documentedSourceLanguages).toBe(60);
    expect(REALTIME_SPECIALIST_REPORTED_FACTS.documentedAudioOutputLanguages).toBe(29);
    expect(REALTIME_SPECIALIST_REPORTED_FACTS.reportedAverageLagMs).toBe(2300);
    expect(REALTIME_SPECIALIST_REPORTED_FACTS.previousGenerationReportedAverageLagMs).toBe(2800);
    expect(REALTIME_SPECIALIST_REPORTED_FACTS.asrTranscriptEnabledByDefault).toBe(true);
    // Reported figures are never guarantees — the basis says so:
    expect(REALTIME_SPECIALIST_REPORTED_FACTS.basis).toContain("never guaranteed");
  });

  it("the language coverage records marker languages + the documented counts (never a copied full list)", () => {
    expect(REALTIME_SPECIALIST_LANGUAGE_COVERAGE.counts.documentedSourceLanguages).toBe(60);
    expect(REALTIME_SPECIALIST_LANGUAGE_COVERAGE.counts.documentedAudioOutputLanguages).toBe(29);
    // Audio-output markers are a subset of source markers:
    for (const language of REALTIME_SPECIALIST_LANGUAGE_COVERAGE.audioOutputLanguages) {
      expect(REALTIME_SPECIALIST_LANGUAGE_COVERAGE.sourceLanguages.includes(language)).toBe(true);
    }
    expect(REALTIME_SPECIALIST_LANGUAGE_COVERAGE.sourceLanguages.length).toBeLessThan(60); // markers, not the vendor list
  });

  it("the reported-latency context documents BOTH reported figures as non-guarantees", () => {
    expect(REPORTED_LATENCY_CONTEXT.realtimeSpecialistReportedAverageLagMs).toBe(2300);
    expect(REPORTED_LATENCY_CONTEXT.liveAsrReportedAverageLatencyMs).toEqual({
      minMs: 200,
      maxMs: 600,
    });
    expect(REPORTED_LATENCY_CONTEXT.basis).toContain("never routing inputs");
  });

  it("the provenance names the R25 plan document", () => {
    expect(REALTIME_PROVIDER_PROVENANCE).toContain("qwen-livetranslate-plan.md");
    expect(QWEN_LIVETRANSLATE_FLASH_REALTIME.provenance).toBe(REALTIME_PROVIDER_PROVENANCE);
  });

  it("the record obeys the specialist-lane laws", () => {
    expect(realtimeProviderRecordObeysLaneLaws()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Descriptor validation (the honest-shape laws)
// ---------------------------------------------------------------------------

describe("R25-B — managed descriptor validation", () => {
  it("rejects a wrong logical task (this category is the specialist lane only)", () => {
    const result = validateManagedRealtimeModelDescriptor({
      ...QWEN_LIVETRANSLATE_FLASH_REALTIME,
      logicalTask: "translation",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((problem) => problem.startsWith("logicalTask:"))).toBe(true);
    }
  });

  it("THE MANAGED-DISTRIBUTION TRUTH: managed-service-only must carry openWeights false", () => {
    const result = validateManagedRealtimeModelDescriptor({
      ...QWEN_LIVETRANSLATE_FLASH_REALTIME,
      license: {
        distribution: "managed-service-only",
        openWeights: true, // drift: no open-weight distribution exists
        notes: "claiming open weights",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((problem) =>
          problem.includes("must carry openWeights false — never assume open-weight rights"),
        ),
      ).toBe(true);
    }
  });

  it("the descriptor's model identity must agree with its capability profile", () => {
    const result = validateManagedRealtimeModelDescriptor({
      ...QWEN_LIVETRANSLATE_FLASH_REALTIME,
      model: { modelId: "some-other-model", revision: "research-2026-09-20" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((problem) =>
          problem.includes("must agree with the descriptor's model identity"),
        ),
      ).toBe(true);
    }
  });

  it("rejects missing service identity, wrong transport, and missing provenance", () => {
    const result = validateManagedRealtimeModelDescriptor({
      ...QWEN_LIVETRANSLATE_FLASH_REALTIME,
      serviceName: "",
      transport: "rest-api",
      provenance: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((problem) => problem.startsWith("serviceName:"))).toBe(true);
      expect(result.problems.some((problem) => problem.startsWith("transport:"))).toBe(true);
      expect(result.problems.some((problem) => problem.startsWith("provenance:"))).toBe(true);
    }
  });

  it("rejects non-object descriptors outright", () => {
    expect(validateManagedRealtimeModelDescriptor("qwen").ok).toBe(false);
    expect(validateManagedRealtimeModelDescriptor(undefined).ok).toBe(false);
  });

  it("accepts a well-formed open-weights descriptor variant (the category is honest, not Qwen-only)", () => {
    const openWeightsDescriptor: ManagedRealtimeModelDescriptor = {
      ...QWEN_LIVETRANSLATE_FLASH_REALTIME,
      providerId: "managed-cloud:some-future-realtime-model",
      serviceName: "Some Managed Service",
      license: {
        distribution: "open-weights",
        openWeights: true,
        notes: "Weights are distributed under a reviewed license.",
      },
    };
    expect(validateManagedRealtimeModelDescriptor(openWeightsDescriptor)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// The distribution vocabulary
// ---------------------------------------------------------------------------

describe("R25-B — the distribution vocabulary", () => {
  it("contains the two truths", () => {
    expect([...REALTIME_MODEL_DISTRIBUTIONS]).toEqual(["managed-service-only", "open-weights"]);
  });

  it("membership guard accepts members and rejects drift", () => {
    expect(isRealtimeModelDistribution("managed-service-only")).toBe(true);
    expect(isRealtimeModelDistribution("open-weights")).toBe(true);
    expect(isRealtimeModelDistribution("self-hosted-just-because")).toBe(false);
  });
});
