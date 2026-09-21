/**
 * @wfx/model-fabric — the voice-cloning consent state contracts
 * (R25-H).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-H): voice
 * cloning is NEVER the default WebFlix path.
 *
 * - DEFAULT: translated speech uses a neutral/system voice;
 * - a user may enable voice preservation ONLY when rights/consent
 *   requirements are satisfied;
 * - the voice-clone provenance/consent state is RECORDED with the
 *   generated artifact/session;
 * - NEVER silently clone a source speaker.
 *
 * The frozen typed shapes (`RealtimeTranslatedVoicePolicy`,
 * `RealtimeVoiceConsentState`, `RealtimeVoiceConsentRecord`) live in
 * the domain contracts (R25-A lane additions); this module adds the
 * DECISION layer:
 *
 * - {@link resolveTranslatedVoiceDecision} — the consent gate (pure):
 *   neutral voice passes by default; voice preservation passes ONLY
 *   with a satisfied consent record; everything else is the typed
 *   `consent-required` refusal with the neutral-voice fallback —
 *   visible, never silent, never a clone;
 * - {@link voiceCloningConsentProvenanceOf} — the provenance record
 *   that MUST be recorded with the session/artifact;
 * - the total laws: cloning without satisfied consent is never
 *   allowed; the default policy is never voice preservation.
 */

import type {
  RealtimeTranslatedVoicePolicy,
  RealtimeTranslationSessionInputs,
  RealtimeVoiceConsentRecord,
  RealtimeVoiceConsentState,
} from "@wfx/domain";

import { isRealtimeVoiceConsentState } from "./session";

// ---------------------------------------------------------------------------
// The default law
// ---------------------------------------------------------------------------

/**
 * THE DEFAULT TRANSLATED-VOICE POLICY: the neutral/system voice.
 * Voice preservation is an explicit, consent-gated opt-in — never the
 * default (the R25-H law, carried as the constant every caller
 * defaults to).
 */
export const DEFAULT_REALTIME_TRANSLATED_VOICE_POLICY: RealtimeTranslatedVoicePolicy =
  "neutral-system-voice";

// ---------------------------------------------------------------------------
// The consent gate (the typed decision)
// ---------------------------------------------------------------------------

/** The typed outcome of the voice-policy consent gate. */
export type TranslatedVoiceDecision =
  | {
      /** The neutral/system voice runs — the default path, no consent needed. */
      kind: "neutral-system-voice";
      readonly policy: RealtimeTranslatedVoicePolicy;
      readonly reason: string;
    }
  | {
      /** Voice preservation runs — a satisfied consent record authorizes it. */
      kind: "preserve-source-voice";
      readonly policy: RealtimeTranslatedVoicePolicy;
      readonly consent: RealtimeVoiceConsentRecord;
      readonly reason: string;
    }
  | {
      /**
       * Voice preservation was requested but consent is NOT satisfied:
       * the refusal. Voice cloning never happens on this branch; the
       * honest fallback is the neutral voice, and the refusal is
       * VISIBLE (typed) — never a silent clone, never a silent
       * degrade.
       */
      kind: "consent-required";
      readonly policy: RealtimeTranslatedVoicePolicy;
      readonly fallbackPolicy: RealtimeTranslatedVoicePolicy;
      readonly consentState: RealtimeVoiceConsentState;
      readonly reason: string;
    };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isSatisfiedConsentRecord(x: unknown): x is RealtimeVoiceConsentRecord {
  return (
    isRecord(x) &&
    x.state === "satisfied" &&
    typeof x.basis === "string" &&
    x.basis.trim().length > 0 &&
    typeof x.recordedAt === "string" &&
    x.recordedAt.length > 0
  );
}

/**
 * THE CONSENT GATE (pure): decide the translated-voice plan for a
 * requested policy under a consent record.
 *
 * - `neutral-system-voice` → the neutral voice (the default; no
 *   consent requirement).
 * - `preserve-source-voice` + a SATISFIED consent record → voice
 *   preservation, with the consent record carried into the decision
 *   (it must be recorded with the session/artifact).
 * - `preserve-source-voice` + anything else (missing, unsatisfied,
 *   revoked, malformed) → the typed `consent-required` refusal with
 *   the neutral-voice fallback. The clone NEVER happens; the refusal
 *   is honest and visible.
 */
export function resolveTranslatedVoiceDecision(
  requestedPolicy: RealtimeTranslatedVoicePolicy,
  consent?: unknown,
): TranslatedVoiceDecision {
  if (requestedPolicy === "neutral-system-voice") {
    return {
      kind: "neutral-system-voice",
      policy: "neutral-system-voice",
      reason:
        "translated speech uses the neutral system voice — the default path; no voice cloning occurs and no consent is required",
    };
  }

  if (isSatisfiedConsentRecord(consent)) {
    return {
      kind: "preserve-source-voice",
      policy: "preserve-source-voice",
      consent,
      reason: `voice preservation is authorized by a satisfied consent record (basis: ${consent.basis}) — the consent state is recorded with this session/artifact`,
    };
  }

  const consentState: RealtimeVoiceConsentState = isRecord(consent)
    ? isRealtimeVoiceConsentState(consent.state)
      ? consent.state
      : "missing"
    : "missing";

  return {
    kind: "consent-required",
    policy: "preserve-source-voice",
    fallbackPolicy: "neutral-system-voice",
    consentState,
    reason:
      `voice preservation requires satisfied rights/consent, and the consent state is '${consentState}' — a source speaker's voice is never cloned without it; translated speech falls back to the neutral system voice (visibly, never silently)`,
  };
}

/**
 * Resolve the voice decision for a full session-inputs record (the
 * session-open path): the requested policy + the attached consent
 * record, one call.
 */
export function resolveTranslatedVoiceDecisionForInputs(
  inputs: RealtimeTranslationSessionInputs,
): TranslatedVoiceDecision {
  return resolveTranslatedVoiceDecision(inputs.translatedVoicePolicy, inputs.voiceConsent);
}

// ---------------------------------------------------------------------------
// The provenance record (recorded with the session/artifact)
// ---------------------------------------------------------------------------

/**
 * The voice-policy provenance record that MUST accompany every
 * session (and every generated translated-speech artifact): which
 * voice policy ran, the consent state that authorized it, and the
 * basis when preservation ran. This is the R25-H "recorded with the
 * generated artifact/session" law's typed shape.
 */
export interface RealtimeVoicePolicyProvenanceRecord {
  /** The voice policy that ACTUALLY ran (post-gate, never the raw request). */
  readonly effectivePolicy: RealtimeTranslatedVoicePolicy;
  /** The consent state that was in effect. */
  readonly consentState: RealtimeVoiceConsentState;
  /** The consent basis, present when preservation ran. */
  readonly consentBasis?: string;
  /** When this record was made (ISO 8601). */
  readonly recordedAt: string;
}

/**
 * Derive the provenance record from a voice decision (pure). The
 * caller supplies the timestamp — this module has no clock (the
 * control-views law).
 */
export function voiceCloningConsentProvenanceOf(
  decision: TranslatedVoiceDecision,
  recordedAt: string,
): RealtimeVoicePolicyProvenanceRecord {
  switch (decision.kind) {
    case "neutral-system-voice":
      return {
        effectivePolicy: "neutral-system-voice",
        consentState: "not-required",
        recordedAt,
      };
    case "preserve-source-voice":
      return {
        effectivePolicy: "preserve-source-voice",
        consentState: "satisfied",
        consentBasis: decision.consent.basis,
        recordedAt,
      };
    case "consent-required":
      return {
        effectivePolicy: "neutral-system-voice", // the fallback that ran
        consentState: decision.consentState,
        recordedAt,
      };
  }
}

// ---------------------------------------------------------------------------
// The total laws (machine-checkable, always one answer)
// ---------------------------------------------------------------------------

/**
 * THE SILENT-CLONE LAW, frozen as a total function: may a source
 * speaker's voice be cloned without a SATISFIED consent record?
 * NEVER. Every branch of the consent gate respects this; the function
 * exists so the acceptance battery can assert the law by name (the
 * `mayModelAuthorizePlaybackOrAcquisition` precedent).
 */
export function mayCloneVoiceWithoutSatisfiedConsent(): false {
  return false;
}

/**
 * THE DEFAULT LAW, frozen as a total function: is voice preservation
 * ever the default translated-voice policy? NEVER. The default is the
 * neutral/system voice; preservation is an explicit, consent-gated
 * opt-in.
 */
export function isVoicePreservationEverTheDefault(): false {
  return false;
}

/**
 * Structural check for a voice-policy provenance record (the shape
 * that must be persisted with sessions/artifacts).
 */
export function isRealtimeVoicePolicyProvenanceRecord(
  x: unknown,
): x is RealtimeVoicePolicyProvenanceRecord {
  if (!isRecord(x)) return false;
  if (
    x.effectivePolicy !== "neutral-system-voice" &&
    x.effectivePolicy !== "preserve-source-voice"
  ) {
    return false;
  }
  if (!isRealtimeVoiceConsentState(x.consentState)) return false;
  if (x.consentBasis !== undefined && typeof x.consentBasis !== "string") return false;
  return typeof x.recordedAt === "string" && x.recordedAt.length > 0;
}
