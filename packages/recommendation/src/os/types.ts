/**
 * Recommendation OS — shared types (WFX-021, Lane A — intelligence).
 *
 * This module defines the OS's OWN vocabulary: the typed per-candidate
 * feature record, the scored working record that flows through the stages,
 * the auditable `PipelineTrace`, and the `FeedPage` output. The FROZEN
 * contracts (`RecommendationContext` / `RecommendationModel` /
 * `RecommendationScore` — docs/architecture/contracts.md, "Recommendation
 * OS") are IMPORTED from `@wfx/domain` and never redefined here; models rank
 * candidates, they do not own policy, persistence, authorization, or
 * provider actions.
 *
 * Purity law: every type here describes pure, deterministic data. No stage
 * performs I/O, reads a hidden clock, or touches randomness — the only time
 * source is the ctx's own event timestamps (see events.ts), and every
 * ordering decision is total (a deterministic tiebreak always exists).
 */

import type {
  EntertainmentCandidate,
  EntertainmentItem,
  IntentScope,
  RecommendationContext,
  RecommendationModel,
  RecommendationPolicy,
  RecommendationScore,
} from "@wfx/domain";

// The frozen Recommendation OS contracts, re-exported for consumer
// convenience (same bindings, no redefinition — one import site).
export type { RecommendationContext, RecommendationModel, RecommendationScore };

/** The two feed surfaces (mirrors the frozen `RecommendationContext.surface`). */
export type FeedSurface = RecommendationContext["surface"];

/** Canonical item orientation union (from the frozen EntertainmentItem). */
export type ItemOrientation = NonNullable<EntertainmentItem["orientation"]>;

/**
 * Pipeline stage names, in the frozen-architecture order:
 * candidate generation -> feature assembly -> model scoring -> policy
 * constraints -> intent-aware diversity -> feed composition.
 */
export type PipelineStageName =
  | "retrieval"
  | "features"
  | "scoring"
  | "policy"
  | "diversity"
  | "composition";

/**
 * Machine-readable decision kinds recorded in the trace (closed vocabulary).
 * Every reorder, demotion, cap, and placement the OS performs is recorded —
 * there are no silent policy decisions and no silent score overrides.
 */
export type TraceDecisionKind =
  /** The candidate pool is empty (an honest result, not an error). */
  | "pool-empty"
  /** recentEvents carries no timestamps — freshness decays to neutral. */
  | "no-time-anchor"
  /** The injected model returned no score for an item; carried unscored. */
  | "model-omitted-score"
  /** Canonical dedupe: one realization kept per item, losers recorded. */
  | "dedupe-kept"
  /** Availability floor: zero available realizations — demoted to the tail. */
  | "availability-demotion"
  /** Custom-mode objective matched — explicit rank adjustment applied. */
  | "custom-objective"
  /** Attention-mode parameters declared for downstream enforcement. */
  | "attention-policy"
  /** Mindful mode's novelty weighting — fresh content rank-boosted (traced). */
  | "attention-novelty-weighting"
  /** R05: `not-interested` feedback — the target excluded (reversible). */
  | "feedback-not-interested"
  /** R05: a suppressed source's realizations skipped with an honest note. */
  | "feedback-suppressed-source"
  /** R05: a suppressed creator's candidates skipped with an honest note. */
  | "feedback-suppressed-creator"
  /** R05: `already-watched` feedback — the target demoted (history untouched). */
  | "feedback-already-watched"
  /** R05: `more-like-this` feedback — the similarity neighborhood boosted. */
  | "feedback-more-like-this"
  /** Diversity: a same-dominant-objective run hit the cap — extenders demoted. */
  | "objective-run-break"
  /** Diversity: the remaining items share one objective — no alternative exists. */
  | "objective-run-unsatisfiable"
  /** Diversity: unseen candidate swapped into a concentrated top block. */
  | "exploration-injection"
  /** Diversity: concentration remains but no unseen candidates are available. */
  | "exploration-injection-unsatisfied"
  /** Session-extending chain hit the count cap — the chain is broken. */
  | "chain-cap"
  /** Session-extension minutes cap (or unknown duration) — chain stopped. */
  | "session-extension-cap"
  /** A constraint could not be fully repaired within the sweep budget. */
  | "constraint-residual"
  /** Per-card placement record (position reasons, end-to-end explainability). */
  | "position";

/** One auditable decision made by a pipeline stage. */
export interface TraceDecision {
  /** Machine-readable decision kind (closed vocabulary above). */
  kind: TraceDecisionKind;
  /** Human-readable explanation of the decision. */
  detail: string;
  /** Canonical item ids the decision applies to (may be empty). */
  itemIds: readonly string[];
}

/** One pipeline stage's record in the trace. */
export interface PipelineStageRecord {
  stage: PipelineStageName;
  /** Items entering the stage. */
  inputCount: number;
  /** Items leaving the stage (equal to input for permutation stages). */
  outputCount: number;
  /** Every decision the stage made, in decision order. */
  decisions: readonly TraceDecision[];
}

/** The full auditable trace of one recommendation run. */
export interface PipelineTrace {
  /** Identity of the injected model (the OS never hardcodes a provider). */
  model: { id: string; version: string };
  /** Stage records in pipeline order (always all six, in order). */
  stages: readonly PipelineStageRecord[];
}

// ---------------------------------------------------------------------------
// Feature assembly types (features.ts)
// ---------------------------------------------------------------------------

/** One intent matched by a candidate (deterministic from ctx alone). */
export interface MatchedIntentSignal {
  /** The matched intent's id (frozen UserIntent.id). */
  intentId: string;
  /** The matched intent's objective string. */
  objective: string;
  /** The matched intent's scope (frozen IntentScope). */
  scope: IntentScope;
  /** `weight * confidence` of the matched intent (each in [0, 1]). */
  strength: number;
}

/**
 * The typed feature record for one retrieval candidate.
 *
 * Every value is computable from `RecommendationContext` ALONE — no I/O, no
 * clocks, no randomness. Item-level signals (intent match, freshness,
 * repetition, fatigue, availability) are identical for all realizations of
 * the same canonical item; per-candidate fields identify the pool entry.
 */
export interface CandidateFeatures {
  /** 0-based index of this candidate in `ctx.candidatePool`. */
  poolIndex: number;
  /** Canonical item id (same across realizations of one item). */
  itemId: string;
  /** Realization identity: `connectorId` + "\u0000" + `externalRef`. */
  realizationKey: string;
  /** Intents matched by this candidate, in ctx intent order. */
  matchedIntents: readonly MatchedIntentSignal[];
  /** Sum of matched strengths per scope (social included). */
  intentMatchByScope: Readonly<Record<IntentScope, number>>;
  /** Sum of NON-social matched strengths, clamped to [0, 1]. */
  intentMatchTotal: number;
  /** Objective of the strongest matched intent (ties: first in ctx order); null when nothing matches. */
  dominantObjective: string | null;
  /** Content age in days vs the session anchor; null when unknown. */
  ageDays: number | null;
  /** `1 / (1 + ageDays)` when known; 0.5 (neutral) when unknown. */
  freshness: number;
  /** Recent repetition events for this item (start/progress/complete/skip). */
  repetitionCount: number;
  /** Recency-weighted repetition: sum over repetition events of `1 / (1 + ageDays)`. */
  fatigue: number;
  /** Distinct realization reports of this item present in the pool. */
  realizationReports: number;
  /** Distinct realization reports declaring `availability: "available"`. */
  availableRealizations: number;
  /** `availableRealizations / realizationReports` (0 when no reports). */
  availabilityRatio: number;
  /** Item duration in ms; null when absent. */
  durationMs: number | null;
  /** Item orientation; null when absent. */
  orientation: ItemOrientation | null;
  /** Duration fit for the ctx surface, in [0, 1] (0.5 when duration unknown). */
  durationFit: number;
  /** Orientation fit for the ctx surface, in [0, 1] (documented tables). */
  orientationFit: number;
  /** True when the user has no non-impression events for this item (unseen). */
  unseen: boolean;
  /** Sum of matched SOCIAL-scope strengths, clamped to [0, 1]. */
  socialMatch: number;
}

/** Feature assembly output: per-candidate features (pool-aligned) + anchor. */
export interface FeatureSet {
  /** Features aligned 1:1 with `ctx.candidatePool` (by poolIndex). */
  byCandidate: readonly CandidateFeatures[];
  /** The session time anchor: latest `occurredAt` among recentEvents; null when no events. */
  anchorAt: string | null;
}

// ---------------------------------------------------------------------------
// Working record (scoring -> policy -> diversity -> composition)
// ---------------------------------------------------------------------------

/**
 * The record that flows through the OS stages after model scoring.
 *
 * `modelScore` / `confidence` / `explanations` are the model's VERBATIM
 * output — the OS never overrides them silently; ordering decisions are
 * carried separately in the stage results and the trace.
 */
export interface ScoredCandidate {
  /** The pool candidate (frozen intake copy — see pipeline.ts). */
  candidate: EntertainmentCandidate;
  /** The assembled features of this pool entry. */
  features: CandidateFeatures;
  /** Verbatim model score for the item; null when the model omitted it. */
  modelScore: number | null;
  /** Verbatim model confidence; null alongside `modelScore`. */
  confidence: number | null;
  /** Verbatim model explanations. */
  explanations: readonly string[];
  /** True once the policy availability floor demoted this item to the tail. */
  availabilityDemoted: boolean;
}

/** Attention constraints derived from the policy (attention.ts owns the law). */
export interface AttentionConstraints {
  /** The policy's attention mode (frozen vocabulary). */
  attentionMode: RecommendationPolicy["attentionMode"];
  /**
   * Maximum consecutive items sharing a dominant matched objective that
   * downstream stages enforce, or null when the mode does not mandate gaps
   * (the diversity stage's exploration-derived K then applies).
   */
  maxConsecutiveSameObjective: number | null;
  /**
   * Maximum consecutive session-extending placements in the composed feed,
   * or null when the mode allows unbounded chains (immersive / custom).
   */
  maxSessionExtendingChain: number | null;
  /** `policy.maxSessionExtensionMinutes` when provided (all modes). */
  maxSessionExtensionMinutes: number | null;
}

// ---------------------------------------------------------------------------
// Feed output types (composition.ts)
// ---------------------------------------------------------------------------

/** One composed feed position. */
export interface FeedCard {
  /** 0-based position in the final feed. */
  position: number;
  /** The winning candidate for this position (frozen defensive copy). */
  candidate: EntertainmentCandidate;
  /** Verbatim model score for the item; null when the model omitted it. */
  modelScore: number | null;
  /** Verbatim model confidence; null alongside `modelScore`. */
  confidence: number | null;
  /** Verbatim model explanations. */
  explanations: readonly string[];
  /** The dominant matched objective at this position; null when none. */
  dominantObjective: string | null;
  /** Why this card sits at this position (also recorded in the trace). */
  positionReasons: readonly string[];
}

/** The output of one recommendation run. */
export interface FeedPage {
  surface: FeedSurface;
  userId: string;
  sessionId: string;
  /** Every distinct canonical item of the pool, exactly once, in feed order. */
  cards: readonly FeedCard[];
  /** The end-to-end auditable trace. */
  trace: PipelineTrace;
}

// ---------------------------------------------------------------------------
// Typed failure
// ---------------------------------------------------------------------------

/** Typed failure kinds produced by Recommendation OS operations. */
export type RecommendationOSErrorKind =
  /** Caller-supplied data violated a documented invariant. */
  | "invalid-input"
  /** The injected model violated the frozen RecommendationModel contract. */
  | "model-contract";

/**
 * Typed error thrown by OS operations on bad input and on model-contract
 * violations. Failures are explicit and structured — the error carries a
 * machine-readable `kind` plus field-level `details`; there are no silent
 * coercions and no fake-success paths (missing data is carried honestly in
 * the trace, malformed data is a typed error).
 */
export class RecommendationOSError extends Error {
  readonly kind: RecommendationOSErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(kind: RecommendationOSErrorKind, details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`RecommendationOSError (${kind}): ${list.join("; ")}`);
    this.name = "RecommendationOSError";
    this.kind = kind;
    this.details = list;
  }
}
