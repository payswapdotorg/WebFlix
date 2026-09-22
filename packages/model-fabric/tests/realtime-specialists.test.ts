/**
 * @wfx/model-fabric — R25-C the realtime specialist registration table
 * tests.
 *
 * The registration-truth laws, pinned:
 * - a descriptor WITHOUT a bound factory is NOT registrable
 *   (capability claims without a real adapter path are drift);
 * - validation is fail-closed (shape, the managed-model laws, the
 *   providerId agreement) with named problems, never coerced;
 * - duplicate provider ids are REJECTED (re-registration is drift,
 *   never a silent overwrite);
 * - THE ROUTER INTEGRATION: the table's truth feeds
 *   `routeRealtimeTranslation` — the registered Qwen specialist wins
 *   the realtime translation combos WITH its bound factory
 *   resolvable; an empty table answers the honest
 *   no-realtime-route-registered gap; a capability gap names what the
 *   profile lacks; batch workloads are refused; the live-ASR lane
 *   stays untouched (transcription-only routes to R2T2, never the
 *   specialist);
 * - THE CREDENTIAL GATE ON REGISTRATION: the env-wired Qwen
 *   construction is the honest not-registered answer without the
 *   credential — the router then reports the honest gap rather than
 *   routing to a provider that cannot run;
 * - the Qwen registration's identity agrees with the frozen provider
 *   record (one truth, two views).
 */

import { describe, expect, it } from "bun:test";

import type { RealtimeTranslationSessionInputs } from "@wfx/domain";

import {
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
  createQwenLiveTranslateSpecialist,
  createRealtimeSpecialistTable,
  createRecordedQwenTransport,
  routeRealtimeTranslationAgainstSpecialists,
  validateRealtimeSpecialistRegistration,
  type RealtimeSpecialistRegistration,
} from "../src/index";

const LAWFUL_INPUTS: RealtimeTranslationSessionInputs = {
  sourceMedia: {
    itemId: "wfx-item-1",
    connectorId: "wfx-reference",
    externalRef: "ref-1",
    audioStreamLegallyAvailable: true,
  },
  targetLanguage: "en",
  outputModality: "text",
  subtitleMode: "bilingual",
  speakerAttribution: "simple-labels",
  visualContextPolicy: "adaptive",
  hotwords: [],
  translatedVoicePolicy: "neutral-system-voice",
};

/** The env-wired Qwen registration against the recorded double (server-side only). */
function qwenRegistration(
  env: Record<string, string | undefined> = { DASHSCOPE_API_KEY: "sk-live-key" },
): RealtimeSpecialistRegistration {
  const double = createRecordedQwenTransport();
  const construction = createQwenLiveTranslateSpecialist(env, { transport: double.transport });
  expect(construction.ok).toBe(true);
  if (!construction.ok) throw new Error("unreachable: the credential is provisioned");
  return construction.registration;
}

// ---------------------------------------------------------------------------
// The registration validation laws
// ---------------------------------------------------------------------------

describe("R25-C specialists — the registration validation laws", () => {
  it("a descriptor WITHOUT a bound factory is NOT registrable (registration is the binding)", () => {
    const result = validateRealtimeSpecialistRegistration({
      providerId: REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
      descriptor: QWEN_LIVETRANSLATE_FLASH_REALTIME,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("factory");
  });

  it("validation is fail-closed with named problems (shape, descriptor laws, the id agreement)", () => {
    expect(validateRealtimeSpecialistRegistration(null).ok).toBe(false);
    expect(validateRealtimeSpecialistRegistration({}).ok).toBe(false);
    const mismatched = validateRealtimeSpecialistRegistration({
      providerId: "some-other-provider",
      descriptor: QWEN_LIVETRANSLATE_FLASH_REALTIME,
      factory: { open: async () => { throw new Error("never called"); } },
    });
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.problems.join(" ")).toContain("must agree");
    const badFactory = validateRealtimeSpecialistRegistration({
      providerId: REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
      descriptor: QWEN_LIVETRANSLATE_FLASH_REALTIME,
      factory: {},
    });
    expect(badFactory.ok).toBe(false);
  });

  it("the env-wired Qwen registration validates", () => {
    expect(validateRealtimeSpecialistRegistration(qwenRegistration()).ok).toBe(true);
  });

  it("duplicate provider ids are REJECTED — re-registration is drift, never a silent overwrite", () => {
    const table = createRealtimeSpecialistTable();
    expect(table.register(qwenRegistration()).ok).toBe(true);
    const second = table.register(qwenRegistration());
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.problems.join(" ")).toContain("already registered");
    expect(table.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The router integration (the registration truth feeds the routing)
// ---------------------------------------------------------------------------

describe("R25-C specialists — the router integration", () => {
  it("the registered Qwen specialist wins the realtime translation combos WITH its bound factory resolvable", () => {
    const table = createRealtimeSpecialistTable();
    table.register(qwenRegistration());
    for (const request of [
      { needsTranslation: true, targetLanguage: "en" },
      { needsTranslation: true, needsTranslatedSpeech: true, targetLanguage: "en" },
      { needsTranslation: true, needsSpeakerSeparation: true, targetLanguage: "zh" },
      { needsTranslation: true, needsVisualContext: true, targetLanguage: "ja" },
    ]) {
      const decision = routeRealtimeTranslationAgainstSpecialists(table, {
        workload: "realtime",
        request,
        availableLiveAsrProviderIds: ["open-model:r2t2"],
      });
      expect(decision.kind).toBe("realtime-translation-specialist");
      if (decision.kind === "realtime-translation-specialist") {
        expect(decision.providerId).toBe(REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID);
      }
      expect(decision.factory).toBeDefined();
      expect(typeof decision.factory?.open).toBe("function");
    }
  });

  it("the factory the router resolves OPENS a working session against the recorded double", async () => {
    const table = createRealtimeSpecialistTable();
    table.register(qwenRegistration());
    const decision = routeRealtimeTranslationAgainstSpecialists(table, {
      workload: "realtime",
      request: { needsTranslation: true, targetLanguage: "en" },
      availableLiveAsrProviderIds: [],
    });
    const factory = decision.factory;
    expect(factory).toBeDefined();
    const session = await factory!.open(LAWFUL_INPUTS);
    expect(session.state).toBe("idle");
    await session.start();
    expect(session.state).toBe("streaming");
    await session.close();
  });

  it("an EMPTY table answers the honest no-realtime-route-registered gap (no factory)", () => {
    const table = createRealtimeSpecialistTable();
    const decision = routeRealtimeTranslationAgainstSpecialists(table, {
      workload: "realtime",
      request: { needsTranslation: true, targetLanguage: "en" },
      availableLiveAsrProviderIds: ["open-model:r2t2"],
    });
    expect(decision.kind).toBe("no-realtime-route-registered");
    if (decision.kind === "no-realtime-route-registered") {
      expect(decision.recovery).toContain("managed-cloud:qwen3.8-livetranslate-flash-realtime");
    }
    expect(decision.factory).toBeUndefined();
  });

  it("THE CREDENTIAL GATE: without the credential the table stays empty and the router answers the honest gap", () => {
    const double = createRecordedQwenTransport();
    const construction = createQwenLiveTranslateSpecialist({}, { transport: double.transport });
    expect(construction.ok).toBe(false);
    const table = createRealtimeSpecialistTable();
    // The honest not-registered construction is NEVER registered — the
    // router's recovery sentence names the registration path.
    const decision = routeRealtimeTranslationAgainstSpecialists(table, {
      workload: "realtime",
      request: { needsTranslation: true, targetLanguage: "en" },
      availableLiveAsrProviderIds: ["open-model:r2t2"],
    });
    expect(decision.kind).toBe("no-realtime-route-registered");
  });

  it("a capability gap is honest: an unsupported target language names the gap, never a half-service", () => {
    const table = createRealtimeSpecialistTable();
    table.register(qwenRegistration());
    const decision = routeRealtimeTranslationAgainstSpecialists(table, {
      workload: "realtime",
      request: { needsTranslation: true, targetLanguage: "xx" },
      availableLiveAsrProviderIds: [],
    });
    expect(decision.kind).toBe("realtime-capability-gap");
    if (decision.kind === "realtime-capability-gap") {
      expect(decision.detail).toContain("'xx'");
    }
    expect(decision.factory).toBeUndefined();
  });

  it("transcription-only requests route to the LIVE-ASR lane, never the realtime specialist", () => {
    const table = createRealtimeSpecialistTable();
    table.register(qwenRegistration());
    const decision = routeRealtimeTranslationAgainstSpecialists(table, {
      workload: "realtime",
      request: { needsTranslation: false },
      availableLiveAsrProviderIds: ["open-model:r2t2"],
    });
    expect(decision.kind).toBe("low-latency-source-transcription");
    if (decision.kind === "low-latency-source-transcription") {
      expect(decision.providerId).toBe("open-model:r2t2");
    }
    expect(decision.factory).toBeUndefined(); // the specialist's factory is NOT resolved for the ASR lane
  });

  it("batch workloads are refused — batch transcription stays with the batch stacks", () => {
    const table = createRealtimeSpecialistTable();
    table.register(qwenRegistration());
    const decision = routeRealtimeTranslationAgainstSpecialists(table, {
      workload: "batch",
      request: { needsTranslation: true, targetLanguage: "en" },
      availableLiveAsrProviderIds: [],
    });
    expect(decision.kind).toBe("batch-workload-not-realtime");
    if (decision.kind === "batch-workload-not-realtime") {
      expect(decision.recovery).toContain("MOSS-Transcribe-Diarize or Whisper");
    }
    expect(decision.factory).toBeUndefined();
  });

  it("the table's capability profiles are the descriptors' own (the router's capability truth)", () => {
    const table = createRealtimeSpecialistTable();
    table.register(qwenRegistration());
    const profiles = table.capabilityProfiles();
    expect(profiles[REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID]).toBe(
      QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile,
    );
    expect(table.providerIds()).toEqual([REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID]);
    expect(table.factoryFor("unknown-provider")).toBeUndefined();
    expect(table.registrationFor(REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID)?.descriptor).toBe(
      QWEN_LIVETRANSLATE_FLASH_REALTIME,
    );
  });
});
