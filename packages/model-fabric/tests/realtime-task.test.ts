/**
 * @wfx/model-fabric — R25-B realtime logical task + capability tests.
 *
 * The Model Fabric extension at the seam:
 * - THE NEVER-OVERLOAD LAW: `realtime-translation` is a LOGICAL task
 *   BESIDE the frozen `ModelTask` union and the batch
 *   `TransformationTaskKind` vocabulary — never a member of either
 *   (a streaming session is not a batch invoke());
 * - THE CAPABILITY DIMENSION TOTALITY: the 15 dimensions are exactly
 *   the plan's list, and the profile validation rejects drift
 *   (missing dimensions, incoherent combinations, consent-optional
 *   voice cloning, subset-violating language directions);
 * - THE SERVING DERIVATIONS: the capability table — not the router —
 *   answers what a profile serves (combinations + languages).
 */

import { describe, expect, it } from "bun:test";

import { MODEL_TASKS } from "../src/types";
import { TRANSFORMATION_TASK_KINDS } from "../src/transform/tasks";

import {
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  REALTIME_CAPABILITY_DIMENSIONS,
  REALTIME_TRANSLATION_LOGICAL_TASK,
  REALTIME_SPECIALIST_PRESERVED_BATCH_TASKS,
  isRealtimeCapabilityDimension,
  profileServesLanguage,
  profileServesRealtimeRequest,
  realtimeSpecialistDimensionCoverage,
  realtimeTaskIsDistinctFromBatchTasks,
  validateRealtimeCapabilityProfile,
  type RealtimeTranslationCapabilityProfile,
} from "../src/index";

// ---------------------------------------------------------------------------
// The never-overload law
// ---------------------------------------------------------------------------

describe("R25-B — the never-overload law", () => {
  it("the logical task id is exactly the plan's recommendation", () => {
    expect(REALTIME_TRANSLATION_LOGICAL_TASK).toBe("realtime-translation");
  });

  it("realtime-translation is NOT a member of the frozen ModelTask union", () => {
    expect((MODEL_TASKS as readonly string[]).includes(REALTIME_TRANSLATION_LOGICAL_TASK)).toBe(
      false,
    );
  });

  it("realtime-translation is NOT a member of the batch TransformationTaskKind vocabulary", () => {
    expect(
      (TRANSFORMATION_TASK_KINDS as readonly string[]).includes(REALTIME_TRANSLATION_LOGICAL_TASK),
    ).toBe(false);
  });

  it("realtimeTaskIsDistinctFromBatchTasks returns true today (and throws on drift)", () => {
    expect(realtimeTaskIsDistinctFromBatchTasks()).toBe(true);
  });

  it("the preserved batch tasks are the ASR lanes the specialist must not displace", () => {
    expect([...REALTIME_SPECIALIST_PRESERVED_BATCH_TASKS]).toEqual([
      "speechToText",
      "transcription",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The capability dimension totality
// ---------------------------------------------------------------------------

describe("R25-B — the capability dimensions (the plan's 15, verbatim)", () => {
  it("contains EXACTLY the plan's dimensions, in plan order", () => {
    expect([...REALTIME_CAPABILITY_DIMENSIONS]).toEqual([
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
    ]);
    expect(REALTIME_CAPABILITY_DIMENSIONS.length).toBe(15);
  });

  it("membership guard accepts members and rejects drift", () => {
    expect(isRealtimeCapabilityDimension("voice-cloning")).toBe(true);
    expect(isRealtimeCapabilityDimension("universal-model")).toBe(false);
  });

  it("the frozen specialist profile covers ALL 15 dimensions (the totality audit)", () => {
    expect(realtimeSpecialistDimensionCoverage()).toEqual([...REALTIME_CAPABILITY_DIMENSIONS]);
  });
});

// ---------------------------------------------------------------------------
// Profile validation (the honest-shape laws)
// ---------------------------------------------------------------------------

const VALID_PROFILE: RealtimeTranslationCapabilityProfile =
  QWEN_LIVETRANSLATE_FLASH_REALTIME.capabilityProfile;

describe("R25-B — capability profile validation", () => {
  it("accepts the frozen specialist's profile", () => {
    expect(validateRealtimeCapabilityProfile(VALID_PROFILE)).toEqual({ ok: true });
  });

  it("rejects non-object profiles", () => {
    const result = validateRealtimeCapabilityProfile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain("expected a capability profile");
  });

  it("requires every boolean dimension to be answered (a profile cannot shrug)", () => {
    const result = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      speakerAttribution: "yes",
      visualContextInput: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((problem) => problem.startsWith("speakerAttribution:"))).toBe(
        true,
      );
      expect(result.problems.some((problem) => problem.startsWith("visualContextInput:"))).toBe(
        true,
      );
    }
  });

  it("VOICE CLONING IS ALWAYS CONSENT-GATED — consentGated must be the literal true", () => {
    const result = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      voiceCloning: { supported: true, consentGated: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((problem) =>
          problem.includes("voiceCloning.consentGated: must be true"),
        ),
      ).toBe(true);
    }
  });

  it("language directions: audio-output languages must be a subset of source languages", () => {
    const result = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      supportedLanguageDirections: {
        sourceLanguages: ["en"],
        audioOutputLanguages: ["en", "zh"], // zh is not a declared source language
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((problem) =>
          problem.includes("'zh' must also be a source language"),
        ),
      ).toBe(true);
    }
  });

  it("language directions: empty source lists are drift", () => {
    const result = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      supportedLanguageDirections: { sourceLanguages: [], audioOutputLanguages: [] },
    });
    expect(result.ok).toBe(false);
  });

  it("coherence: no source ASR or no text translation is not a realtime translation provider", () => {
    const noAsr = validateRealtimeCapabilityProfile({ ...VALID_PROFILE, sourceAsr: false });
    expect(noAsr.ok).toBe(false);
    if (!noAsr.ok) {
      expect(noAsr.problems.some((problem) => problem.startsWith("coherence:"))).toBe(true);
    }
    const noTranslation = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      textTranslation: false,
    });
    expect(noTranslation.ok).toBe(false);
  });

  it("coherence: realtime translation requires streaming input", () => {
    const result = validateRealtimeCapabilityProfile({ ...VALID_PROFILE, streamingInput: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((problem) =>
          problem.includes("realtime translation requires streaming input"),
        ),
      ).toBe(true);
    }
  });

  it("rejects unknown latency/privacy values and missing provenance/identity", () => {
    const result = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      latencyProfile: "instant",
      privacyClass: "private",
      providerProvenance: "",
      model: { modelId: "", revision: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((problem) => problem.startsWith("latencyProfile:"))).toBe(true);
      expect(result.problems.some((problem) => problem.startsWith("privacyClass:"))).toBe(true);
      expect(result.problems.some((problem) => problem.startsWith("providerProvenance:"))).toBe(
        true,
      );
      expect(result.problems.some((problem) => problem.startsWith("model:"))).toBe(true);
    }
  });

  it("the rate card is validated as part of the profile (the price/cost dimension)", () => {
    const result = validateRealtimeCapabilityProfile({
      ...VALID_PROFILE,
      priceCostModel: { currency: "EUR" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.problems.some((problem) => problem.startsWith("priceCostModel:")),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The serving derivations (the capability table answers, not the router)
// ---------------------------------------------------------------------------

describe("R25-B — the serving derivations", () => {
  it("serves the request combinations the profile supports", () => {
    expect(
      profileServesRealtimeRequest(VALID_PROFILE, { needsTranslatedSpeech: true }),
    ).toBe(true);
    expect(
      profileServesRealtimeRequest(VALID_PROFILE, { needsSpeakerSeparation: true }),
    ).toBe(true);
    expect(profileServesRealtimeRequest(VALID_PROFILE, { needsVisualContext: true })).toBe(true);
    expect(profileServesRealtimeRequest(VALID_PROFILE, { needsHotwords: true })).toBe(true);
    expect(profileServesRealtimeRequest(VALID_PROFILE, {})).toBe(true);
  });

  it("refuses combinations the profile lacks", () => {
    const textOnlyProfile: RealtimeTranslationCapabilityProfile = {
      ...VALID_PROFILE,
      translatedSpeechOutput: false,
      visualContextInput: false,
    };
    expect(
      profileServesRealtimeRequest(textOnlyProfile, { needsTranslatedSpeech: true }),
    ).toBe(false);
    expect(profileServesRealtimeRequest(textOnlyProfile, { needsVisualContext: true })).toBe(
      false,
    );
    expect(profileServesRealtimeRequest(textOnlyProfile, {})).toBe(true);
  });

  it("serves languages by coverage, with audio output as the stricter check", () => {
    expect(profileServesLanguage(VALID_PROFILE, "en")).toBe(true);
    expect(profileServesLanguage(VALID_PROFILE, "th")).toBe(true); // source-only marker language
    expect(profileServesLanguage(VALID_PROFILE, "th", { requireAudioOutput: true })).toBe(false);
    expect(profileServesLanguage(VALID_PROFILE, "xx")).toBe(false);
  });
});
