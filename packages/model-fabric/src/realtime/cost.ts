/**
 * @wfx/model-fabric — the realtime translation usage/cost model and
 * the cost-policy controls (R25-K).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-K): because
 * translated speech is substantially more expensive than input audio,
 * Model Policy supports text-only translation, text + audio
 * translation, session duration limits, anonymous quotas, user/account
 * budget limits, adaptive visual sampling, and AUTOMATIC FALLBACK TO
 * TEXT-ONLY when audio output would exceed policy — and cost controls
 * NEVER block the user's existing playback.
 *
 * THE NEVER-BLOCK-PLAYBACK LAW (the machine-checkable core):
 * {@link mayCostControlsBlockPlayback} is total and ALWAYS `false`.
 * Cost controls may degrade or end the TRANSLATION overlay (typed
 * decisions, honest reasons); they have no authority over the media
 * pipeline. The session contract (R25-A) carries no playback
 * capability at all.
 *
 * THE COST TRUTH (the frozen research facts): the currently documented
 * production pricing is INDICATIVE International/Singapore pricing —
 * $7.50 per million input-audio tokens, $20 per million text-output
 * tokens, $30 per million output-audio tokens, $0.55 per million
 * image-input tokens — implying roughly $0.19/hour for input audio
 * alone and about $1.35/hour for output audio alone BEFORE text/image
 * usage and promotions; actual cost varies with usage and output.
 * These are carried as constants with provenance, never as guarantees;
 * the lead's benchmark owns verifying them against live billing.
 *
 * WHAT THIS MODULE IS: PURE math + policy derivations. Token counts
 * are provider-reported truth (`RealtimeSessionUsage`, R25-A);
 * MONETARY COST IS DERIVED HERE — never by the provider adapter, never
 * in the client. All monetary results round to 6 decimals so repeated
 * estimation is bit-stable and golden-testable (transform-tasks
 * precedent).
 */

import type { RealtimeOutputModality, RealtimeSessionUsage } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The token rate card (the price/cost-model capability dimension)
// ---------------------------------------------------------------------------

/**
 * A realtime provider's token rate card — the price/cost-model
 * capability dimension every realtime provider descriptor carries.
 * Rates are USD per MILLION tokens, finite, non-negative, and always
 * labeled with their pricing basis and provenance (an unlabeled price
 * is drift — it cannot be audited).
 */
export interface RealtimeTokenRateCard {
  /** The currency all rates are denominated in. */
  readonly currency: "USD";
  /** USD per million INPUT-AUDIO tokens. */
  readonly inputAudioUsdPerMillionTokens: number;
  /** USD per million TEXT-OUTPUT tokens. */
  readonly textOutputUsdPerMillionTokens: number;
  /** USD per million OUTPUT-AUDIO tokens. */
  readonly outputAudioUsdPerMillionTokens: number;
  /** USD per million IMAGE-INPUT tokens. */
  readonly imageInputUsdPerMillionTokens: number;
  /** The pricing basis this card truthfully refers to (e.g. "indicative International/Singapore pricing"). */
  readonly pricingBasis: string;
  /** Where this card's truth came from (non-empty). */
  readonly provenance: string;
}

/** The outcome of validating a rate card. */
export type RealtimeTokenRateCardValidation =
  | { ok: true }
  | { ok: false; problems: readonly string[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isFiniteNonNegative(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

/** Validate a rate card (pure; drift is rejected, never coerced). */
export function validateRealtimeTokenRateCard(card: unknown): RealtimeTokenRateCardValidation {
  const problems: string[] = [];
  if (!isRecord(card)) {
    return { ok: false, problems: ["expected a rate card object"] };
  }
  if (card.currency !== "USD") {
    problems.push("currency: expected 'USD' (the only denominated currency today)");
  }
  for (const field of [
    "inputAudioUsdPerMillionTokens",
    "textOutputUsdPerMillionTokens",
    "outputAudioUsdPerMillionTokens",
    "imageInputUsdPerMillionTokens",
  ] as const) {
    if (!isFiniteNonNegative(card[field])) {
      problems.push(`${field}: expected a finite non-negative USD-per-million-tokens rate`);
    }
  }
  if (typeof card.pricingBasis !== "string" || card.pricingBasis.length === 0) {
    problems.push("pricingBasis: expected non-empty pricing basis (an unauditable price is drift)");
  }
  if (typeof card.provenance !== "string" || card.provenance.length === 0) {
    problems.push("provenance: expected non-empty provenance");
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * The R25 plan document this cost model's frozen facts come from.
 */
export const REALTIME_COST_MODEL_PROVENANCE =
  "docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md — R25-K cost research (2026-09-20)";

/**
 * The INDICATIVE rate card for the managed realtime translation
 * provider — the frozen research facts, exactly as documented:
 * $7.50/M input-audio, $20/M text-output, $30/M output-audio,
 * $0.55/M image-input (International/Singapore, indicative). Never a
 * guarantee; the lead's benchmark owns live verification.
 */
export const REALTIME_TRANSLATION_INDICATIVE_RATE_CARD: RealtimeTokenRateCard = {
  currency: "USD",
  inputAudioUsdPerMillionTokens: 7.5,
  textOutputUsdPerMillionTokens: 20,
  outputAudioUsdPerMillionTokens: 30,
  imageInputUsdPerMillionTokens: 0.55,
  pricingBasis: "indicative International/Singapore pricing — actual cost varies with usage and output",
  provenance: REALTIME_COST_MODEL_PROVENANCE,
};

/**
 * The plan-derived implied audio cost figures (frozen research
 * facts, recorded as documentation constants — derived BEFORE
 * text/image usage and promotions):
 * - input audio alone: roughly $0.19/hour;
 * - output audio alone: roughly $1.35/hour.
 */
export const REALTIME_IMPLIED_AUDIO_COST_USD_PER_HOUR: Readonly<{
  inputAudioAlone: number;
  outputAudioAlone: number;
  basis: string;
}> = {
  inputAudioAlone: 0.19,
  outputAudioAlone: 1.35,
  basis: "documented audio rates imply these approximations before text/image usage and promotions — never a guarantee",
};

// ---------------------------------------------------------------------------
// The cost math (pure, bit-stable)
// ---------------------------------------------------------------------------

/** Round to 6 decimals — bit-stable, golden-testable (transform-tasks precedent). */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function tokensToUsd(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion;
}

/** Validate a usage record's token counts (finite, non-negative). */
export function isRealtimeSessionUsage(x: unknown): x is RealtimeSessionUsage {
  if (!isRecord(x)) return false;
  return (
    isFiniteNonNegative(x.inputAudioTokens) &&
    isFiniteNonNegative(x.textOutputTokens) &&
    isFiniteNonNegative(x.outputAudioTokens) &&
    isFiniteNonNegative(x.imageInputTokens)
  );
}

/**
 * The itemized cost of one usage record (pure): each token dimension
 * priced independently, monetary values rounded to 6 decimals.
 */
export interface RealtimeSessionCostBreakdown {
  readonly inputAudioUsd: number;
  readonly textOutputUsd: number;
  readonly outputAudioUsd: number;
  readonly imageInputUsd: number;
  readonly totalUsd: number;
}

/** The itemized breakdown of a usage record under a rate card. */
export function realtimeSessionCostBreakdown(
  usage: RealtimeSessionUsage,
  card: RealtimeTokenRateCard = REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
): RealtimeSessionCostBreakdown {
  const inputAudioUsd = round6(tokensToUsd(usage.inputAudioTokens, card.inputAudioUsdPerMillionTokens));
  const textOutputUsd = round6(
    tokensToUsd(usage.textOutputTokens, card.textOutputUsdPerMillionTokens),
  );
  const outputAudioUsd = round6(
    tokensToUsd(usage.outputAudioTokens, card.outputAudioUsdPerMillionTokens),
  );
  const imageInputUsd = round6(
    tokensToUsd(usage.imageInputTokens, card.imageInputUsdPerMillionTokens),
  );
  return {
    inputAudioUsd,
    textOutputUsd,
    outputAudioUsd,
    imageInputUsd,
    totalUsd: round6(inputAudioUsd + textOutputUsd + outputAudioUsd + imageInputUsd),
  };
}

/** The total cost of one usage record under a rate card (USD, 6-decimal stable). */
export function realtimeSessionCostUsd(
  usage: RealtimeSessionUsage,
  card: RealtimeTokenRateCard = REALTIME_TRANSLATION_INDICATIVE_RATE_CARD,
): number {
  return realtimeSessionCostBreakdown(usage, card).totalUsd;
}

// ---------------------------------------------------------------------------
// The cost policy (the R25-K control list)
// ---------------------------------------------------------------------------

/** The anonymous-session quota (R25-K anonymous quotas + R25-J's accountless law). */
export interface RealtimeAnonymousQuota {
  /** The maximum session duration an anonymous (non-durable) session may run, in milliseconds. */
  readonly maxSessionDurationMs: number;
  /** The honest basis for this quota (non-empty — an unauditable limit is drift). */
  readonly basis: string;
}

/** The default anonymous realtime-session quota (30 minutes, product-policy default). */
export const DEFAULT_REALTIME_ANONYMOUS_QUOTA: RealtimeAnonymousQuota = {
  maxSessionDurationMs: 30 * 60 * 1000,
  basis: "product default — anonymous realtime translation is session-scoped, quota-limited, and never requires login",
};

/**
 * The realtime translation cost policy — the R25-K control list:
 * output-modality preference, session duration limits, anonymous
 * quotas, budget limits, adaptive visual sampling, and the
 * automatic-fallback switch. Every limit carries an honest basis.
 */
export interface RealtimeTranslationCostPolicy {
  /** The modality the user REQUESTED (before policy evaluation). */
  readonly requestedOutputModality: RealtimeOutputModality;
  /** The per-session budget ceiling in USD (optional). */
  readonly maxSessionCostUsd?: number;
  /** The per-session duration limit in milliseconds (optional). */
  readonly maxSessionDurationMs?: number;
  /** The anonymous-session quota (applies when the viewer is anonymous). */
  readonly anonymousQuota?: RealtimeAnonymousQuota;
  /** May cost policy automatically fall back to text-only when audio output would exceed policy? (Default: yes.) */
  readonly autoFallbackToTextOnly: boolean;
}

/** The default cost policy: text-only request, fallback enabled, no extra limits. */
export const DEFAULT_REALTIME_COST_POLICY: RealtimeTranslationCostPolicy = {
  requestedOutputModality: "text",
  autoFallbackToTextOnly: true,
};

// ---------------------------------------------------------------------------
// The modality resolution (auto-fallback to text-only)
// ---------------------------------------------------------------------------

/** The typed outcome of resolving the effective output modality. */
export interface RealtimeModalityResolution {
  /** The modality the session will actually run. */
  readonly outputModality: RealtimeOutputModality;
  /** True when policy DEGRADED the request (the honest, visible signal — never silent). */
  readonly degradedFromRequested: boolean;
  /** The actionable reason (present on every branch). */
  readonly reason: string;
}

/**
 * Resolve the effective output modality under the cost policy (pure):
 *
 * - A text-only request stays text-only.
 * - A text+audio request stays text+audio when there is no budget
 *   conflict — either no ceiling, or the projected additional
 *   audio-output cost fits the remaining budget.
 * - A text+audio request whose projected audio output would exceed
 *   the remaining budget DEGRADES to text-only when
 *   `autoFallbackToTextOnly` is true (the R25-K automatic fallback —
 *   typed and visible, never silent), with the honest math in the
 *   reason.
 * - When `autoFallbackToTextOnly` is false the resolution keeps the
 *   requested modality and reports the budget conflict — ending the
 *   SESSION by policy is {@link evaluateRealtimeSessionPolicy}'s
 *   verdict, and NONE of these outcomes may block playback (the
 *   total law below).
 */
export function resolveRealtimeOutputModality(input: {
  readonly policy: RealtimeTranslationCostPolicy;
  readonly usageSoFar: RealtimeSessionUsage;
  readonly card?: RealtimeTokenRateCard;
  /** The projected additional output-audio tokens this session would incur (e.g. the next stretch of speech). */
  readonly projectedAdditionalAudioOutputTokens?: number;
}): RealtimeModalityResolution {
  const card = input.card ?? REALTIME_TRANSLATION_INDICATIVE_RATE_CARD;
  const requested = input.policy.requestedOutputModality;

  if (requested === "text") {
    return {
      outputModality: "text",
      degradedFromRequested: false,
      reason: "text-only translation requested — no translated-speech cost is incurred",
    };
  }

  const ceiling = input.policy.maxSessionCostUsd;
  if (ceiling === undefined) {
    return {
      outputModality: "text-and-audio",
      degradedFromRequested: false,
      reason: "text + audio translation requested with no session budget ceiling",
    };
  }

  const spentSoFar = realtimeSessionCostUsd(input.usageSoFar, card);
  const remaining = round6(ceiling - spentSoFar);
  const projected = round6(
    tokensToUsd(input.projectedAdditionalAudioOutputTokens ?? 0, card.outputAudioUsdPerMillionTokens),
  );

  if (projected <= remaining) {
    return {
      outputModality: "text-and-audio",
      degradedFromRequested: false,
      reason: `text + audio translation fits the session budget — projected $${projected.toFixed(6)} audio output against $${remaining.toFixed(6)} remaining of the $${ceiling.toFixed(6)} ceiling`,
    };
  }

  if (input.policy.autoFallbackToTextOnly) {
    return {
      outputModality: "text",
      degradedFromRequested: true,
      reason: `translated speech would exceed the session budget (projected $${projected.toFixed(6)} against $${remaining.toFixed(6)} remaining) — automatically falling back to text-only translation; playback is never blocked`,
    };
  }

  return {
    outputModality: "text-and-audio",
    degradedFromRequested: false,
    reason: `text + audio translation continues despite the projected budget conflict ($${projected.toFixed(6)} against $${remaining.toFixed(6)} remaining) — the policy disabled automatic fallback; the session budget verdict is evaluated separately`,
  };
}

// ---------------------------------------------------------------------------
// The session policy evaluation (duration + budget verdicts)
// ---------------------------------------------------------------------------

/** The typed verdict of evaluating a running session against the cost policy. */
export type RealtimeSessionPolicyVerdict =
  | { kind: "continue"; reason: string }
  | { kind: "degrade-to-text-only"; reason: string }
  | { kind: "end-session-by-policy"; reason: string };

/**
 * Evaluate a RUNNING session against the cost policy (pure): the
 * duration limit and budget ceiling produce typed verdicts —
 * `continue`, `degrade-to-text-only` (when audio output is running
 * and the fallback is enabled), or `end-session-by-policy`.
 *
 * THE PLAYBACK LAW (structural): an `end-session-by-policy` verdict
 * ends the TRANSLATION overlay only. {@link mayCostControlsBlockPlayback}
 * is the total law — playback is never blocked, stopped, or delayed by
 * any of these verdicts.
 */
export function evaluateRealtimeSessionPolicy(input: {
  readonly policy: RealtimeTranslationCostPolicy;
  readonly usageSoFar: RealtimeSessionUsage;
  readonly sessionDurationMs: number;
  readonly viewerIsAnonymous: boolean;
  readonly card?: RealtimeTokenRateCard;
}): RealtimeSessionPolicyVerdict {
  const card = input.card ?? REALTIME_TRANSLATION_INDICATIVE_RATE_CARD;
  const spentSoFar = realtimeSessionCostUsd(input.usageSoFar, card);

  // 1. The budget ceiling: exceeding it ends the session by policy.
  const ceiling = input.policy.maxSessionCostUsd;
  if (ceiling !== undefined && spentSoFar >= ceiling) {
    return {
      kind: "end-session-by-policy",
      reason: `the realtime translation session reached its $${ceiling.toFixed(6)} budget ceiling ($${spentSoFar.toFixed(6)} spent) — the translation overlay ends; playback is never blocked`,
    };
  }

  // 2. The duration limits: the configured limit, plus the anonymous
  //    quota when the viewer is anonymous (the stricter one governs).
  const durationLimits: Array<{ limitMs: number; basis: string }> = [];
  if (input.policy.maxSessionDurationMs !== undefined) {
    durationLimits.push({
      limitMs: input.policy.maxSessionDurationMs,
      basis: "the session duration limit",
    });
  }
  if (input.viewerIsAnonymous && input.policy.anonymousQuota !== undefined) {
    durationLimits.push({
      limitMs: input.policy.anonymousQuota.maxSessionDurationMs,
      basis: "the anonymous-session quota",
    });
  }
  for (const limit of durationLimits) {
    if (input.sessionDurationMs >= limit.limitMs) {
      return {
        kind: "end-session-by-policy",
        reason: `the realtime translation session reached ${limit.basis} (${limit.limitMs} ms) — the translation overlay ends; playback is never blocked`,
      };
    }
  }

  // 3. The modality check: audio output still affordable?
  if (input.policy.requestedOutputModality === "text-and-audio") {
    const spentBreakdown = realtimeSessionCostBreakdown(input.usageSoFar, card);
    if (ceiling !== undefined && input.policy.autoFallbackToTextOnly) {
      const remaining = round6(ceiling - spentSoFar);
      const audioSpent = spentBreakdown.outputAudioUsd;
      if (audioSpent > 0 && remaining < audioSpent) {
        // The next comparable stretch of audio output would overshoot.
        return {
          kind: "degrade-to-text-only",
          reason: `translated speech has consumed $${audioSpent.toFixed(6)} and only $${remaining.toFixed(6)} remains of the $${ceiling.toFixed(6)} ceiling — degrading to text-only translation; playback is never blocked`,
        };
      }
    }
  }

  return {
    kind: "continue",
    reason: "the realtime translation session is within its cost policy",
  };
}

// ---------------------------------------------------------------------------
// The never-block-playback law (total, always false)
// ---------------------------------------------------------------------------

/**
 * THE PLAYBACK LAW, frozen as a total function: may a realtime
 * translation COST CONTROL block, stop, or delay the user's existing
 * playback? NEVER. Cost controls own the translation overlay only —
 * they degrade it (text-only fallback) or end it (session budget/
 * duration verdicts), and every one of those outcomes leaves playback
 * untouched. The machine-checkable law the R25 acceptance battery
 * asserts (the `mayModelAuthorizePlaybackOrAcquisition` precedent).
 */
export function mayCostControlsBlockPlayback(): false {
  return false;
}

// ---------------------------------------------------------------------------
// Adaptive visual sampling (the R25-F/R25-K sampling policy)
// ---------------------------------------------------------------------------

/**
 * The visual-sample triggers (R25-F): the information-rich events the
 * media adapter's sampler reacts to, plus the low-rate periodic
 * fallback. The SAMPLER belongs to the media adapter; this POLICY is
 * the shared contract — WebFlix never sends every frame.
 */
export type RealtimeVisualSampleTrigger =
  | "scene-change"
  | "on-screen-text"
  | "shot-or-speaker-change"
  | "periodic-fallback";

/** Every visual-sample trigger. */
export const REALTIME_VISUAL_SAMPLE_TRIGGERS: readonly RealtimeVisualSampleTrigger[] = [
  "scene-change",
  "on-screen-text",
  "shot-or-speaker-change",
  "periodic-fallback",
] as const;

/** Runtime membership check against the trigger union. */
export function isRealtimeVisualSampleTrigger(x: unknown): x is RealtimeVisualSampleTrigger {
  return (
    typeof x === "string" &&
    (REALTIME_VISUAL_SAMPLE_TRIGGERS as readonly string[]).includes(x)
  );
}

/**
 * The adaptive visual sampling policy: a hard frames-per-minute
 * ceiling and a low-rate periodic fallback cadence. The media adapter
 * owns the sampler; it MUST respect this policy (the never-send-every-
 * frame law).
 */
export interface RealtimeVisualSamplingPolicy {
  /** The hard ceiling on appended frames per minute (positive). */
  readonly maxFramesPerMinute: number;
  /** The minimum interval between periodic-fallback frames, in milliseconds (positive). */
  readonly periodicFallbackIntervalMs: number;
  /** The honest basis for this policy (non-empty). */
  readonly basis: string;
}

/** The default adaptive visual sampling policy (6 frames/minute hard ceiling, 15s periodic fallback). */
export const DEFAULT_REALTIME_VISUAL_SAMPLING_POLICY: RealtimeVisualSamplingPolicy = {
  maxFramesPerMinute: 6,
  periodicFallbackIntervalMs: 15_000,
  basis: "product default — visual context is sampled (scene/on-screen-text/shot triggers plus a low-rate periodic fallback), never every frame",
};

/**
 * The pure sampler decision: may the adapter append a frame for this
 * trigger right now? Information-rich triggers (scene change,
 * on-screen text, shot/speaker change) pass while under the hard
 * ceiling; the periodic fallback additionally requires its interval to
 * have elapsed. Over the ceiling, nothing passes — the policy is the
 * law, not a suggestion.
 */
export function shouldAppendVisualFrame(input: {
  readonly trigger: RealtimeVisualSampleTrigger;
  readonly framesAppendedInCurrentMinute: number;
  readonly msSinceLastPeriodicFrame: number;
  readonly policy: RealtimeVisualSamplingPolicy;
}): boolean {
  if (input.framesAppendedInCurrentMinute >= input.policy.maxFramesPerMinute) {
    return false; // the hard ceiling — never send every frame
  }
  if (input.trigger === "periodic-fallback") {
    return input.msSinceLastPeriodicFrame >= input.policy.periodicFallbackIntervalMs;
  }
  return true;
}
