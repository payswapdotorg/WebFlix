/**
 * @wfx/model-fabric — R25-K cost model + policy control tests.
 *
 * THE COST-POLICY MATH, exercised against the frozen indicative
 * rates:
 * - the rate card ($7.50/M input-audio, $20/M text-output, $30/M
 *   output-audio, $0.55/M image-input, USD, indicative);
 * - the cost math is itemized, bit-stable (6 decimals), and matches
 *   hand-computed values;
 * - the implied hourly figures (input ~$0.19/hr, output ~$1.35/hr)
 *   are carried as plan facts;
 * - THE AUTOMATIC TEXT-ONLY FALLBACK: a text+audio request whose
 *   projected audio output would exceed the remaining budget degrades
 *   to text-only — typed, visible, never silent;
 * - THE SESSION POLICY VERDICTS: budget ceiling → end-session-by-
 *   policy; duration limit and anonymous quota → end-session-by-
 *   policy; audio-affordability → degrade-to-text-only;
 * - THE NEVER-BLOCK-PLAYBACK LAW: total, always false;
 * - the adaptive visual sampling policy (hard ceiling; periodic
 *   fallback cadence);
 * - rate-card validation (unlabeled/incoherent pricing is drift).
 */

import { describe, expect, it } from "bun:test";

import type { RealtimeSessionUsage } from "@wfx/domain";

import {
  DEFAULT_REALTIME_ANONYMOUS_QUOTA,
  DEFAULT_REALTIME_COST_POLICY,
  DEFAULT_REALTIME_VISUAL_SAMPLING_POLICY,
  REALTIME_COST_MODEL_PROVENANCE,
  REALTIME_IMPLIED_AUDIO_COST_USD_PER_HOUR,
  REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
  evaluateRealtimeSessionPolicy,
  isRealtimeSessionUsage,
  isRealtimeVisualSampleTrigger,
  mayCostControlsBlockPlayback,
  realtimeSessionCostBreakdown,
  realtimeSessionCostUsd,
  resolveRealtimeOutputModality,
  shouldAppendVisualFrame,
  validateRealtimeTokenRateCard,
  type RealtimeTokenRateCard,
} from "../src/index";

// ---------------------------------------------------------------------------
// The frozen rate card
// ---------------------------------------------------------------------------

describe("R25-K — the frozen indicative rate card", () => {
  it("carries the plan's documented rates exactly", () => {
    expect(REALTIME_TRANSLATION_INDICATIVE_RATE_CARD).toMatchObject({
      currency: "USD",
      inputAudioUsdPerMillionTokens: 7.5,
      textOutputUsdPerMillionTokens: 20,
      outputAudioUsdPerMillionTokens: 30,
      imageInputUsdPerMillionTokens: 0.55,
    });
    expect(REALTIME_TRANSLATION_INDICATIVE_RATE_CARD.pricingBasis).toContain("indicative");
    expect(REALTIME_TRANSLATION_INDICATIVE_RATE_CARD.provenance).toBe(
      REALTIME_COST_MODEL_PROVENANCE,
    );
  });

  it("carries the plan-derived implied hourly figures", () => {
    expect(REALTIME_IMPLIED_AUDIO_COST_USD_PER_HOUR.inputAudioAlone).toBeCloseTo(0.19, 2);
    expect(REALTIME_IMPLIED_AUDIO_COST_USD_PER_HOUR.outputAudioAlone).toBeCloseTo(1.35, 2);
    expect(REALTIME_IMPLIED_AUDIO_COST_USD_PER_HOUR.basis).toContain("never a guarantee");
  });

  it("validates the frozen card and rejects drift", () => {
    expect(validateRealtimeTokenRateCard(REALTIME_TRANSLATION_INDICATIVE_RATE_CARD)).toEqual({
      ok: true,
    });
    expect(
      validateRealtimeTokenRateCard({
        ...REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
        inputAudioUsdPerMillionTokens: -1,
      }).ok,
    ).toBe(false);
    expect(
      validateRealtimeTokenRateCard({
        ...REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
        pricingBasis: "",
      }).ok,
    ).toBe(false);
    expect(
      validateRealtimeTokenRateCard({ currency: "EUR", pricingBasis: "x", provenance: "y" }).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The cost math (itemized, bit-stable, hand-computed)
// ---------------------------------------------------------------------------

describe("R25-K — the cost math", () => {
  const usage: RealtimeSessionUsage = {
    inputAudioTokens: 2_000_000, // 2M tokens → $15.00 at $7.50/M
    textOutputTokens: 500_000, // 0.5M tokens → $10.00 at $20/M
    outputAudioTokens: 100_000, // 0.1M tokens → $3.00 at $30/M
    imageInputTokens: 1_000_000, // 1M tokens → $0.55 at $0.55/M
  };

  it("itemizes each dimension and totals (hand-computed)", () => {
    const breakdown = realtimeSessionCostBreakdown(usage);
    expect(breakdown.inputAudioUsd).toBe(15);
    expect(breakdown.textOutputUsd).toBe(10);
    expect(breakdown.outputAudioUsd).toBe(3);
    expect(breakdown.imageInputUsd).toBe(0.55);
    expect(breakdown.totalUsd).toBe(28.55);
  });

  it("the total is the itemized sum and is bit-stable across repeated calls", () => {
    const first = realtimeSessionCostUsd(usage);
    for (let i = 0; i < 10; i++) {
      expect(realtimeSessionCostUsd(usage)).toBe(first);
    }
  });

  it("zero usage costs zero (never a negative or NaN)", () => {
    const empty: RealtimeSessionUsage = {
      inputAudioTokens: 0,
      textOutputTokens: 0,
      outputAudioTokens: 0,
      imageInputTokens: 0,
    };
    expect(realtimeSessionCostUsd(empty)).toBe(0);
  });

  it("fractional token counts round to 6 decimals (golden-stable)", () => {
    const odd: RealtimeSessionUsage = {
      inputAudioTokens: 123_457,
      textOutputTokens: 3,
      outputAudioTokens: 0,
      imageInputTokens: 1,
    };
    const cost = realtimeSessionCostUsd(odd);
    // 123457/1e6*7.5 = 0.9259275 → rounds to 0.925928 (6 decimals)
    // 3/1e6*20 = 0.00006 → 0.00006
    // 1/1e6*0.55 = 0.00000055 → rounds to 0.000001 within the total
    expect(cost).toBe(0.925989);
    expect(String(cost)).toBe("0.925989");
  });

  it("a custom rate card prices the same usage differently (the card is the input, not a global)", () => {
    const customCard: RealtimeTokenRateCard = {
      currency: "USD",
      inputAudioUsdPerMillionTokens: 0,
      textOutputUsdPerMillionTokens: 0,
      outputAudioUsdPerMillionTokens: 10,
      imageInputUsdPerMillionTokens: 0,
      pricingBasis: "test card",
      provenance: "test",
    };
    const usage2: RealtimeSessionUsage = {
      inputAudioTokens: 1_000_000,
      textOutputTokens: 1_000_000,
      outputAudioTokens: 1_000_000,
      imageInputTokens: 1_000_000,
    };
    expect(realtimeSessionCostUsd(usage2, customCard)).toBe(10);
  });

  it("isRealtimeSessionUsage validates token counts", () => {
    expect(isRealtimeSessionUsage(usage)).toBe(true);
    expect(isRealtimeSessionUsage({ ...usage, inputAudioTokens: -1 })).toBe(false);
    expect(isRealtimeSessionUsage({ ...usage, textOutputTokens: Number.NaN })).toBe(false);
    expect(isRealtimeSessionUsage("cheap")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The modality resolution (the automatic text-only fallback)
// ---------------------------------------------------------------------------

describe("R25-K — the automatic text-only fallback", () => {
  const spentHalf: RealtimeSessionUsage = {
    inputAudioTokens: 0,
    textOutputTokens: 0,
    outputAudioTokens: 1_000_000, // $30 spent of a $40 ceiling
    imageInputTokens: 0,
  };

  it("a text-only request stays text-only", () => {
    const decision = resolveRealtimeOutputModality({
      policy: { ...DEFAULT_REALTIME_COST_POLICY, requestedOutputModality: "text" },
      usageSoFar: spentHalf,
    });
    expect(decision).toMatchObject({ outputModality: "text", degradedFromRequested: false });
  });

  it("text+audio with no ceiling stays text+audio", () => {
    const decision = resolveRealtimeOutputModality({
      policy: {
        requestedOutputModality: "text-and-audio",
        autoFallbackToTextOnly: true,
      },
      usageSoFar: spentHalf,
    });
    expect(decision).toMatchObject({ outputModality: "text-and-audio", degradedFromRequested: false });
  });

  it("text+audio that fits the remaining budget stays text+audio (with the math in the reason)", () => {
    const decision = resolveRealtimeOutputModality({
      policy: {
        requestedOutputModality: "text-and-audio",
        maxSessionCostUsd: 40,
        autoFallbackToTextOnly: true,
      },
      usageSoFar: spentHalf, // $30 spent → $10 remaining
      projectedAdditionalAudioOutputTokens: 100_000, // $3 projected → fits
    });
    expect(decision.outputModality).toBe("text-and-audio");
    expect(decision.degradedFromRequested).toBe(false);
    expect(decision.reason).toContain("fits the session budget");
  });

  it("DEGRADES to text-only when projected audio output would exceed the remaining budget (visible, never silent)", () => {
    const decision = resolveRealtimeOutputModality({
      policy: {
        requestedOutputModality: "text-and-audio",
        maxSessionCostUsd: 40,
        autoFallbackToTextOnly: true,
      },
      usageSoFar: spentHalf, // $30 spent → $10 remaining
      projectedAdditionalAudioOutputTokens: 1_000_000, // $30 projected → exceeds
    });
    expect(decision.outputModality).toBe("text");
    expect(decision.degradedFromRequested).toBe(true);
    expect(decision.reason).toContain("automatically falling back to text-only");
    expect(decision.reason).toContain("playback is never blocked");
  });

  it("keeps the requested modality when the fallback is disabled (the conflict is reported honestly)", () => {
    const decision = resolveRealtimeOutputModality({
      policy: {
        requestedOutputModality: "text-and-audio",
        maxSessionCostUsd: 40,
        autoFallbackToTextOnly: false,
      },
      usageSoFar: spentHalf,
      projectedAdditionalAudioOutputTokens: 1_000_000,
    });
    expect(decision.outputModality).toBe("text-and-audio");
    expect(decision.degradedFromRequested).toBe(false);
    expect(decision.reason).toContain("disabled automatic fallback");
  });
});

// ---------------------------------------------------------------------------
// The session policy verdicts (duration, budget, anonymous quota)
// ---------------------------------------------------------------------------

describe("R25-K — the session policy verdicts", () => {
  const lightUsage: RealtimeSessionUsage = {
    inputAudioTokens: 1_000,
    textOutputTokens: 100,
    outputAudioTokens: 0,
    imageInputTokens: 0,
  };
  const heavyUsage: RealtimeSessionUsage = {
    inputAudioTokens: 2_000_000,
    textOutputTokens: 500_000,
    outputAudioTokens: 100_000,
    imageInputTokens: 1_000_000,
  }; // $28.55

  it("continues within policy", () => {
    const verdict = evaluateRealtimeSessionPolicy({
      policy: { ...DEFAULT_REALTIME_COST_POLICY, maxSessionCostUsd: 100 },
      usageSoFar: lightUsage,
      sessionDurationMs: 1_000,
      viewerIsAnonymous: false,
    });
    expect(verdict.kind).toBe("continue");
  });

  it("budget ceiling exceeded → end-session-by-policy (the overlay ends; playback never blocked)", () => {
    const verdict = evaluateRealtimeSessionPolicy({
      policy: { ...DEFAULT_REALTIME_COST_POLICY, maxSessionCostUsd: 20 },
      usageSoFar: heavyUsage, // $28.55 ≥ $20
      sessionDurationMs: 1_000,
      viewerIsAnonymous: false,
    });
    expect(verdict.kind).toBe("end-session-by-policy");
    if (verdict.kind === "end-session-by-policy") {
      expect(verdict.reason).toContain("budget ceiling");
      expect(verdict.reason).toContain("playback is never blocked");
    }
  });

  it("duration limit reached → end-session-by-policy", () => {
    const verdict = evaluateRealtimeSessionPolicy({
      policy: { ...DEFAULT_REALTIME_COST_POLICY, maxSessionDurationMs: 60_000 },
      usageSoFar: lightUsage,
      sessionDurationMs: 60_000,
      viewerIsAnonymous: false,
    });
    expect(verdict.kind).toBe("end-session-by-policy");
    if (verdict.kind === "end-session-by-policy") {
      expect(verdict.reason).toContain("session duration limit");
    }
  });

  it("ANONYMOUS QUOTA: the anonymous viewer's quota governs even without a configured duration limit", () => {
    const quota = { maxSessionDurationMs: 30 * 60 * 1000, basis: "test quota" };
    const verdict = evaluateRealtimeSessionPolicy({
      policy: { ...DEFAULT_REALTIME_COST_POLICY, anonymousQuota: quota },
      usageSoFar: lightUsage,
      sessionDurationMs: quota.maxSessionDurationMs, // exactly at the quota
      viewerIsAnonymous: true,
    });
    expect(verdict.kind).toBe("end-session-by-policy");
    if (verdict.kind === "end-session-by-policy") {
      expect(verdict.reason).toContain("anonymous-session quota");
    }
    // The same duration with an authenticated viewer is fine (no account quota):
    const authenticated = evaluateRealtimeSessionPolicy({
      policy: { ...DEFAULT_REALTIME_COST_POLICY, anonymousQuota: quota },
      usageSoFar: lightUsage,
      sessionDurationMs: quota.maxSessionDurationMs,
      viewerIsAnonymous: false,
    });
    expect(authenticated.kind).toBe("continue");
  });

  it("the stricter of the configured limit and the anonymous quota governs", () => {
    const verdict = evaluateRealtimeSessionPolicy({
      policy: {
        ...DEFAULT_REALTIME_COST_POLICY,
        maxSessionDurationMs: 60_000, // stricter than the quota
        anonymousQuota: { maxSessionDurationMs: 3_600_000, basis: "test" },
      },
      usageSoFar: lightUsage,
      sessionDurationMs: 60_000,
      viewerIsAnonymous: true,
    });
    expect(verdict.kind).toBe("end-session-by-policy");
    if (verdict.kind === "end-session-by-policy") {
      expect(verdict.reason).toContain("session duration limit");
    }
  });

  it("audio-affordability mid-session → degrade-to-text-only", () => {
    // $30 of audio spent of a $31 ceiling; only $1 remains — the next
    // comparable stretch would overshoot, so degrade.
    const verdict = evaluateRealtimeSessionPolicy({
      policy: {
        requestedOutputModality: "text-and-audio",
        maxSessionCostUsd: 31,
        autoFallbackToTextOnly: true,
      },
      usageSoFar: {
        inputAudioTokens: 0,
        textOutputTokens: 0,
        outputAudioTokens: 1_000_000, // $30
        imageInputTokens: 0,
      },
      sessionDurationMs: 1_000,
      viewerIsAnonymous: false,
    });
    expect(verdict.kind).toBe("degrade-to-text-only");
    if (verdict.kind === "degrade-to-text-only") {
      expect(verdict.reason).toContain("degrading to text-only");
      expect(verdict.reason).toContain("playback is never blocked");
    }
  });

  it("THE NEVER-BLOCK-PLAYBACK LAW: total, always false", () => {
    expect(mayCostControlsBlockPlayback()).toBe(false);
    expect(mayCostControlsBlockPlayback()).toBe(false);
  });

  it("the default policy: text-only, fallback enabled", () => {
    expect(DEFAULT_REALTIME_COST_POLICY.requestedOutputModality).toBe("text");
    expect(DEFAULT_REALTIME_COST_POLICY.autoFallbackToTextOnly).toBe(true);
  });

  it("the default anonymous quota is 30 minutes, session-scoped, login-free", () => {
    expect(DEFAULT_REALTIME_ANONYMOUS_QUOTA.maxSessionDurationMs).toBe(30 * 60 * 1000);
    expect(DEFAULT_REALTIME_ANONYMOUS_QUOTA.basis).toContain("never requires login");
  });
});

// ---------------------------------------------------------------------------
// The adaptive visual sampling policy
// ---------------------------------------------------------------------------

describe("R25-K — the adaptive visual sampling policy", () => {
  it("information-rich triggers pass while under the hard ceiling", () => {
    expect(
      shouldAppendVisualFrame({
        trigger: "scene-change",
        framesAppendedInCurrentMinute: 0,
        msSinceLastPeriodicFrame: 0,
        policy: DEFAULT_REALTIME_VISUAL_SAMPLING_POLICY,
      }),
    ).toBe(true);
    expect(
      shouldAppendVisualFrame({
        trigger: "on-screen-text",
        framesAppendedInCurrentMinute: 5, // ceiling is 6 → under
        msSinceLastPeriodicFrame: 0,
        policy: DEFAULT_REALTIME_VISUAL_SAMPLING_POLICY,
      }),
    ).toBe(true);
  });

  it("the hard ceiling blocks everything — WebFlix never sends every frame", () => {
    expect(
      shouldAppendVisualFrame({
        trigger: "scene-change",
        framesAppendedInCurrentMinute: 6, // ceiling reached
        msSinceLastPeriodicFrame: 0,
        policy: DEFAULT_REALTIME_VISUAL_SAMPLING_POLICY,
      }),
    ).toBe(false);
  });

  it("the periodic fallback fires only after its interval elapses", () => {
    const policy = DEFAULT_REALTIME_VISUAL_SAMPLING_POLICY; // 15s fallback
    expect(
      shouldAppendVisualFrame({
        trigger: "periodic-fallback",
        framesAppendedInCurrentMinute: 0,
        msSinceLastPeriodicFrame: policy.periodicFallbackIntervalMs - 1,
        policy,
      }),
    ).toBe(false);
    expect(
      shouldAppendVisualFrame({
        trigger: "periodic-fallback",
        framesAppendedInCurrentMinute: 0,
        msSinceLastPeriodicFrame: policy.periodicFallbackIntervalMs,
        policy,
      }),
    ).toBe(true);
  });

  it("trigger membership guard", () => {
    expect(isRealtimeVisualSampleTrigger("scene-change")).toBe(true);
    expect(isRealtimeVisualSampleTrigger("every-frame")).toBe(false);
  });
});
