/**
 * @wfx/model-fabric — R25-H voice-cloning consent state tests.
 *
 * THE CONSENT-STATE LAWS:
 * - VOICE CLONING IS NEVER THE DEFAULT: the default policy is the
 *   neutral system voice; preservation is an explicit opt-in;
 * - PRESERVATION PASSES ONLY WITH SATISFIED CONSENT: a real record
 *   (state 'satisfied', non-empty basis, timestamp) authorizes it and
 *   is carried into the decision;
 * - EVERYTHING ELSE IS THE TYPED REFUSAL: missing, unsatisfied,
 *   revoked, or malformed consent → `consent-required` with the
 *   neutral-voice fallback — visible, never silent, NEVER a clone;
 * - THE PROVENANCE RECORD: every decision maps to the record that
 *   must accompany the session/artifact (effective policy + consent
 *   state + basis);
 * - THE TOTAL LAWS: cloning without satisfied consent is never
 *   allowed; voice preservation is never the default.
 */

import { describe, expect, it } from "bun:test";

import type { RealtimeTranslationSessionInputs } from "@wfx/domain";

import {
  DEFAULT_REALTIME_TRANSLATED_VOICE_POLICY,
  isRealtimeVoicePolicyProvenanceRecord,
  isVoicePreservationEverTheDefault,
  mayCloneVoiceWithoutSatisfiedConsent,
  resolveTranslatedVoiceDecision,
  resolveTranslatedVoiceDecisionForInputs,
  voiceCloningConsentProvenanceOf,
} from "../src/index";

const SATISFIED = {
  state: "satisfied" as const,
  basis: "rights-holder consent recorded through the product consent flow",
  recordedAt: "2026-09-20T12:00:00.000Z",
};

const REVOKED = {
  state: "revoked" as const,
  basis: "previously recorded consent, since revoked",
  recordedAt: "2026-09-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// The default law
// ---------------------------------------------------------------------------

describe("R25-H — voice cloning is NEVER the default", () => {
  it("the default translated-voice policy is the neutral system voice", () => {
    expect(DEFAULT_REALTIME_TRANSLATED_VOICE_POLICY).toBe("neutral-system-voice");
  });

  it("isVoicePreservationEverTheDefault is total and always false", () => {
    expect(isVoicePreservationEverTheDefault()).toBe(false);
    expect(isVoicePreservationEverTheDefault()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The consent gate
// ---------------------------------------------------------------------------

describe("R25-H — the consent gate", () => {
  it("the neutral voice passes by default — no consent requirement", () => {
    const decision = resolveTranslatedVoiceDecision("neutral-system-voice");
    expect(decision.kind).toBe("neutral-system-voice");
    if (decision.kind === "neutral-system-voice") {
      expect(decision.reason).toContain("no voice cloning occurs");
    }
    // Even a REVOKED consent record does not affect the neutral path:
    expect(resolveTranslatedVoiceDecision("neutral-system-voice", REVOKED).kind).toBe(
      "neutral-system-voice",
    );
  });

  it("voice preservation passes ONLY with a satisfied consent record (basis + timestamp required)", () => {
    const decision = resolveTranslatedVoiceDecision("preserve-source-voice", SATISFIED);
    expect(decision.kind).toBe("preserve-source-voice");
    if (decision.kind === "preserve-source-voice") {
      expect(decision.consent).toEqual(SATISFIED);
      expect(decision.reason).toContain("satisfied consent record");
    }
  });

  it("MISSING consent → the typed consent-required refusal (never a clone, never silent)", () => {
    const decision = resolveTranslatedVoiceDecision("preserve-source-voice");
    expect(decision.kind).toBe("consent-required");
    if (decision.kind === "consent-required") {
      expect(decision.consentState).toBe("missing");
      expect(decision.fallbackPolicy).toBe("neutral-system-voice");
      expect(decision.reason).toContain("never cloned without it");
    }
  });

  it("UNSATISFIED consent → the typed refusal naming the state", () => {
    const decision = resolveTranslatedVoiceDecision("preserve-source-voice", {
      state: "missing",
      basis: "no consent captured",
      recordedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(decision.kind).toBe("consent-required");
    if (decision.kind === "consent-required") {
      expect(decision.consentState).toBe("missing");
    }
  });

  it("REVOKED consent → the typed refusal (revocation is respected immediately)", () => {
    const decision = resolveTranslatedVoiceDecision("preserve-source-voice", REVOKED);
    expect(decision.kind).toBe("consent-required");
    if (decision.kind === "consent-required") {
      expect(decision.consentState).toBe("revoked");
      expect(decision.fallbackPolicy).toBe("neutral-system-voice");
    }
  });

  it("MALFORMED consent (satisfied state but empty basis) does NOT authorize preservation", () => {
    const decision = resolveTranslatedVoiceDecision("preserve-source-voice", {
      state: "satisfied",
      basis: "   ",
      recordedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(decision.kind).toBe("consent-required");
    if (decision.kind === "consent-required") {
      expect(decision.consentState).toBe("satisfied"); // reported honestly…
      expect(decision.fallbackPolicy).toBe("neutral-system-voice"); // …but the record is not valid authorization
    }
  });

  it("a non-record consent value is treated as missing (fail closed)", () => {
    const decision = resolveTranslatedVoiceDecision("preserve-source-voice", "the user said yes");
    expect(decision.kind).toBe("consent-required");
    if (decision.kind === "consent-required") {
      expect(decision.consentState).toBe("missing");
    }
  });

  it("THE SILENT-CLONE LAW: total, always false", () => {
    expect(mayCloneVoiceWithoutSatisfiedConsent()).toBe(false);
    expect(mayCloneVoiceWithoutSatisfiedConsent()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The session-inputs path
// ---------------------------------------------------------------------------

describe("R25-H — the session-inputs consent path", () => {
  const baseInputs: RealtimeTranslationSessionInputs = {
    sourceMedia: { itemId: "item-1", audioStreamLegallyAvailable: true },
    targetLanguage: "en",
    outputModality: "text-and-audio",
    subtitleMode: "bilingual",
    speakerAttribution: "simple-labels",
    visualContextPolicy: "off",
    hotwords: [],
    translatedVoicePolicy: "preserve-source-voice",
  };

  it("preservation without consent in the session inputs → the refusal", () => {
    expect(resolveTranslatedVoiceDecisionForInputs(baseInputs).kind).toBe("consent-required");
  });

  it("preservation with satisfied consent in the session inputs → authorized", () => {
    const decision = resolveTranslatedVoiceDecisionForInputs({
      ...baseInputs,
      voiceConsent: SATISFIED,
    });
    expect(decision.kind).toBe("preserve-source-voice");
  });

  it("neutral policy in the session inputs → the neutral path regardless of consent", () => {
    const decision = resolveTranslatedVoiceDecisionForInputs({
      ...baseInputs,
      translatedVoicePolicy: "neutral-system-voice",
    });
    expect(decision.kind).toBe("neutral-system-voice");
  });
});

// ---------------------------------------------------------------------------
// The provenance record (recorded with the session/artifact)
// ---------------------------------------------------------------------------

describe("R25-H — the provenance record", () => {
  it("the neutral path records not-required consent", () => {
    const record = voiceCloningConsentProvenanceOf(
      resolveTranslatedVoiceDecision("neutral-system-voice"),
      "2026-09-20T12:00:00.000Z",
    );
    expect(record).toEqual({
      effectivePolicy: "neutral-system-voice",
      consentState: "not-required",
      recordedAt: "2026-09-20T12:00:00.000Z",
    });
    expect(isRealtimeVoicePolicyProvenanceRecord(record)).toBe(true);
  });

  it("authorized preservation records the satisfied consent WITH its basis", () => {
    const record = voiceCloningConsentProvenanceOf(
      resolveTranslatedVoiceDecision("preserve-source-voice", SATISFIED),
      "2026-09-20T12:00:00.000Z",
    );
    expect(record).toEqual({
      effectivePolicy: "preserve-source-voice",
      consentState: "satisfied",
      consentBasis: SATISFIED.basis,
      recordedAt: "2026-09-20T12:00:00.000Z",
    });
    expect(isRealtimeVoicePolicyProvenanceRecord(record)).toBe(true);
  });

  it("the refusal records the NEUTRAL fallback that actually ran + the honest consent state", () => {
    const record = voiceCloningConsentProvenanceOf(
      resolveTranslatedVoiceDecision("preserve-source-voice", REVOKED),
      "2026-09-20T12:00:00.000Z",
    );
    expect(record.effectivePolicy).toBe("neutral-system-voice"); // what ran
    expect(record.consentState).toBe("revoked"); // the honest state
    expect(isRealtimeVoicePolicyProvenanceRecord(record)).toBe(true);
  });

  it("the structural guard rejects malformed provenance records", () => {
    expect(isRealtimeVoicePolicyProvenanceRecord(null)).toBe(false);
    expect(isRealtimeVoicePolicyProvenanceRecord({})).toBe(false);
    expect(
      isRealtimeVoicePolicyProvenanceRecord({
        effectivePolicy: "clone-anyway",
        consentState: "satisfied",
        recordedAt: "2026-09-20T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isRealtimeVoicePolicyProvenanceRecord({
        effectivePolicy: "neutral-system-voice",
        consentState: "maybe",
        recordedAt: "2026-09-20T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
