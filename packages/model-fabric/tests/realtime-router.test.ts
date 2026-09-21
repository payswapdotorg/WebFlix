/**
 * @wfx/model-fabric — R25-B realtime router policy tests.
 *
 * THE ROUTER POLICY TABLE (the plan's decision list, exercised
 * end-to-end):
 * - Qwen chosen for realtime-translation COMBOS: translated speech,
 *   speaker separation, visual context;
 * - R2T2 (or another live-ASR provider) when only low-latency SOURCE
 *   TRANSCRIPTION is needed — never the realtime specialist;
 * - BATCH workloads are refused with the honest recovery (never
 *   overload the batch transform task; never the universal model);
 * - honest typed gaps when nothing is registered;
 * - the caller's policy preference wins when registered and capable;
 * - capability gaps answer honestly (unsupported language, missing
 *   modality) instead of half-serving.
 */

import { describe, expect, it } from "bun:test";

import { R2T2_OPEN_MODEL } from "../src/open-models/catalog";
import {
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
  routeRealtimeTranslation,
  type RealtimeRoutingInput,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SPECIALIST = REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID;
const R2T2 = R2T2_OPEN_MODEL.providerId;

function routing(
  overrides: Partial<RealtimeRoutingInput> = {},
  request: RealtimeRoutingInput["request"] = { needsTranslation: true, targetLanguage: "en" },
): RealtimeRoutingInput {
  return {
    workload: "realtime",
    request,
    availableRealtimeProviderIds: [SPECIALIST],
    availableLiveAsrProviderIds: [R2T2],
    realtimeCapabilityProfiles: {
      [SPECIALIST]: QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The specialist lane (realtime translation combos)
// ---------------------------------------------------------------------------

describe("R25-B router — the realtime translation specialist combos", () => {
  it("chooses the specialist for realtime translation + translated speech", () => {
    const decision = routeRealtimeTranslation(
      routing({}, { needsTranslation: true, needsTranslatedSpeech: true, targetLanguage: "en" }),
    );
    expect(decision.kind).toBe("realtime-translation-specialist");
    if (decision.kind === "realtime-translation-specialist") {
      expect(decision.providerId).toBe(SPECIALIST);
      expect(decision.detail).toContain("translated speech");
    }
  });

  it("chooses the specialist for realtime translation + speaker separation", () => {
    const decision = routeRealtimeTranslation(
      routing({}, { needsTranslation: true, needsSpeakerSeparation: true, targetLanguage: "en" }),
    );
    expect(decision).toMatchObject({ kind: "realtime-translation-specialist", providerId: SPECIALIST });
  });

  it("chooses the specialist for realtime translation + visual context", () => {
    const decision = routeRealtimeTranslation(
      routing({}, { needsTranslation: true, needsVisualContext: true, targetLanguage: "en" }),
    );
    expect(decision).toMatchObject({ kind: "realtime-translation-specialist", providerId: SPECIALIST });
  });

  it("chooses the specialist for plain realtime text translation (the base combo)", () => {
    const decision = routeRealtimeTranslation(routing());
    expect(decision).toMatchObject({ kind: "realtime-translation-specialist", providerId: SPECIALIST });
  });

  it("chooses the specialist for the full combination (speech + speakers + visual + hotwords)", () => {
    const decision = routeRealtimeTranslation(
      routing(
        {},
        {
          needsTranslation: true,
          needsTranslatedSpeech: true,
          needsSpeakerSeparation: true,
          needsVisualContext: true,
          needsHotwords: true,
          targetLanguage: "zh",
        },
      ),
    );
    expect(decision).toMatchObject({ kind: "realtime-translation-specialist", providerId: SPECIALIST });
  });
});

// ---------------------------------------------------------------------------
// The live-ASR lane (transcription only)
// ---------------------------------------------------------------------------

describe("R25-B router — the low-latency source-transcription lane", () => {
  it("routes transcription-ONLY requests to R2T2, NOT the realtime specialist", () => {
    const decision = routeRealtimeTranslation(
      routing({}, { needsTranslation: false }),
    );
    expect(decision.kind).toBe("low-latency-source-transcription");
    if (decision.kind === "low-latency-source-transcription") {
      expect(decision.providerId).toBe(R2T2);
      expect(decision.detail).toContain("no translation is needed");
    }
  });

  it("falls back to another registered live-ASR provider when R2T2 is absent", () => {
    const decision = routeRealtimeTranslation(
      routing({ availableLiveAsrProviderIds: ["open-model:some-other-live-asr"] }, {
        needsTranslation: false,
      }),
    );
    expect(decision).toMatchObject({
      kind: "low-latency-source-transcription",
      providerId: "open-model:some-other-live-asr",
    });
  });

  it("answers the honest gap when no live-ASR provider is registered (never the specialist, never batch)", () => {
    const decision = routeRealtimeTranslation(
      routing({ availableLiveAsrProviderIds: [] }, { needsTranslation: false }),
    );
    expect(decision.kind).toBe("no-live-asr-route-registered");
    if (decision.kind === "no-live-asr-route-registered") {
      expect(decision.recovery).toContain("open-model:r2t2");
    }
  });
});

// ---------------------------------------------------------------------------
// The batch guard
// ---------------------------------------------------------------------------

describe("R25-B router — the batch guard (never the universal model)", () => {
  it("REFUSES batch workloads even when the specialist is registered", () => {
    const decision = routeRealtimeTranslation(
      routing({ workload: "batch" }, { needsTranslation: true, needsTranslatedSpeech: true }),
    );
    expect(decision.kind).toBe("batch-workload-not-realtime");
    if (decision.kind === "batch-workload-not-realtime") {
      expect(decision.recovery).toContain("MOSS-Transcribe-Diarize");
    }
  });
});

// ---------------------------------------------------------------------------
// The policy preference (the alternative policy choice)
// ---------------------------------------------------------------------------

describe("R25-B router — the caller's policy preference", () => {
  it("a set, registered, capable preferred provider wins", () => {
    const decision = routeRealtimeTranslation(
      routing({ preferredProviderId: SPECIALIST }, { needsTranslation: true, targetLanguage: "en" }),
    );
    expect(decision).toMatchObject({
      kind: "provider-policy-choice",
      providerId: SPECIALIST,
    });
  });

  it("a preferred provider that CANNOT serve the request does not win (capability truth first)", () => {
    const decision = routeRealtimeTranslation(
      routing(
        { preferredProviderId: R2T2 }, // a live-ASR provider cannot translate
        { needsTranslation: true, needsTranslatedSpeech: true, targetLanguage: "en" },
      ),
    );
    expect(decision.kind).not.toBe("provider-policy-choice");
    expect(decision.kind).toBe("realtime-translation-specialist");
  });

  it("an unregistered preferred provider is ignored (registration truth)", () => {
    const decision = routeRealtimeTranslation(
      routing(
        { preferredProviderId: "managed-cloud:not-registered" },
        { needsTranslation: true, targetLanguage: "en" },
      ),
    );
    expect(decision.kind).toBe("realtime-translation-specialist");
  });
});

// ---------------------------------------------------------------------------
// The honest gaps
// ---------------------------------------------------------------------------

describe("R25-B router — the honest gaps", () => {
  it("no realtime provider registered: the typed gap with the recovery hint", () => {
    const decision = routeRealtimeTranslation(
      routing(
        { availableRealtimeProviderIds: [], realtimeCapabilityProfiles: {} },
        { needsTranslation: true, targetLanguage: "en" },
      ),
    );
    expect(decision.kind).toBe("no-realtime-route-registered");
    if (decision.kind === "no-realtime-route-registered") {
      expect(decision.recovery).toContain(SPECIALIST);
    }
  });

  it("the specialist is registered but the target language is unsupported: the capability gap", () => {
    const decision = routeRealtimeTranslation(
      routing({}, { needsTranslation: true, targetLanguage: "xx" }),
    );
    expect(decision.kind).toBe("realtime-capability-gap");
    if (decision.kind === "realtime-capability-gap") {
      expect(decision.providerId).toBe(SPECIALIST);
      expect(decision.detail).toContain("target language 'xx'");
    }
  });

  it("speech output in an audio-output-unsupported language: the capability gap", () => {
    // 'th' is a marker source language WITHOUT audio output.
    const decision = routeRealtimeTranslation(
      routing(
        {},
        { needsTranslation: true, needsTranslatedSpeech: true, targetLanguage: "th" },
      ),
    );
    expect(decision.kind).toBe("realtime-capability-gap");
  });

  it("another registered realtime provider serves when the specialist cannot", () => {
    const capableProfile = {
      ...QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile,
      supportedLanguageDirections: {
        sourceLanguages: ["xx", "en"],
        audioOutputLanguages: ["xx"],
      },
    };
    const decision = routeRealtimeTranslation(
      routing({
        availableRealtimeProviderIds: [SPECIALIST, "managed-cloud:xx-capable"],
        realtimeCapabilityProfiles: {
          [SPECIALIST]: QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile,
          "managed-cloud:xx-capable": capableProfile,
        },
      }, { needsTranslation: true, targetLanguage: "xx" }),
    );
    expect(decision).toMatchObject({
      kind: "realtime-translation-provider",
      providerId: "managed-cloud:xx-capable",
    });
  });

  it("an alternative realtime provider serves when the specialist is not registered", () => {
    const decision = routeRealtimeTranslation(
      routing({
        availableRealtimeProviderIds: ["managed-cloud:other"],
        realtimeCapabilityProfiles: {
          "managed-cloud:other": QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile,
        },
      }, { needsTranslation: true, targetLanguage: "en" }),
    );
    expect(decision).toMatchObject({
      kind: "realtime-translation-provider",
      providerId: "managed-cloud:other",
    });
  });

  it("an alternative realtime provider WITHOUT a readable profile is never chosen (drift is not a pass)", () => {
    const decision = routeRealtimeTranslation(
      routing({
        availableRealtimeProviderIds: ["managed-cloud:opaque"],
        realtimeCapabilityProfiles: {}, // no profile — unreadable
      }, { needsTranslation: true, targetLanguage: "en" }),
    );
    expect(decision.kind).toBe("no-realtime-route-registered");
  });
});
