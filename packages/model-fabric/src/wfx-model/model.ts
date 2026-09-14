/**
 * WFX-031 — the WebFlix first-party recommendation model (Lane A — intelligence).
 *
 * `createWfxRecommendationModel(version)` builds the FIRST-PARTY, REPLACEABLE
 * recommendation strategy behind the frozen `RecommendationModel` contract
 * (docs/architecture/contracts.md, "Recommendation OS"): models rank
 * candidates — they never own policy, persistence, authorization, or provider
 * actions. Attention-mode and diversity rules stay in the OS (WFX-021): this
 * module does SCORING ONLY and attaches one human-readable explanation line
 * to every contributing term.
 *
 * Determinism law: `score(ctx)` is a pure, synchronous-Promise function of
 * the context ALONE — no I/O, no clocks, no randomness, no hidden globals.
 * Identical ctx yields byte-identical output INCLUDING ordering (total order:
 * score desc, then itemId asc — a deterministic tiebreak always exists, so
 * sort stability never matters).
 *
 * Feature contract: features are computed by the MERGED OS feature stage
 * `assembleFeatures(ctx)` (WFX-021, public API of `@wfx/recommendation`) —
 * the same seam the OS's own shipped heuristic model uses, so the wfx model
 * and the OS share ONE feature vocabulary by construction (zero drift). The
 * `CandidateFeatures` type is imported from `@wfx/recommendation` and never
 * redefined. Malformed ctx surfaces as the OS's typed aggregated
 * `RecommendationOSError` (kind "invalid-input") — never a silent coercion
 * and never silent empty scores.
 *
 * Scoring formula (typed weighted sum — every constant is exported below):
 *
 *   score = Σ over matched intents:
 *             WFX_INTENT_WEIGHT × scopeWeight(surface, intent.scope) × strength
 *         + WFX_NOVELTY_BASE × policy.novelty × freshnessDecay(ageDays)
 *         + WFX_AVAILABILITY_WEIGHT × availabilityRatio
 *         + (unseen ? WFX_EXPLORATION_BASE × policy.exploration : 0)
 *         − WFX_FATIGUE_WEIGHT × fatigue
 *
 * - intent-match per scope: session scope carries the HIGHEST weight on BOTH
 *   surfaces, and the short surface amplifies it further (session-aware
 *   ranking is the short feed's law — see `WFX_SCOPE_WEIGHTS`); long-lived
 *   persistent preference is the watch feed's runner-up.
 * - freshness: deterministic half-life decay `0.5 ** (ageDays / 7)` over the
 *   OS-computed content age. Unknown age (no `publishedAt`, no session
 *   anchor, or an unparseable instant) decays to the documented NEUTRAL 0.5
 *   — a recorded assumption that also lowers confidence, never a silent
 *   zero.
 * - availability: the OS availability ratio over the item's distinct
 *   realization reports in the pool.
 * - fatigue: SUBTRACTED and never clamped — the monotonicity law (more
 *   repeats ⇒ strictly lower score, all else equal) holds by construction.
 * - exploration / novelty: the policy dials enter as MULTIPLIERS — the model
 *   applies the user's appetite, it never invents policy. The policy's
 *   `socialInfluence` dial is deliberately NOT part of this formula (the
 *   WFX-031 packet enumerates the exploration and novelty multipliers only);
 *   social signals enter as scope-weighted intent matches.
 *
 * Confidence is derived from FEATURE COMPLETENESS (the four documented
 * signals of `WFX_CONFIDENCE_SIGNALS`), never from score magnitude: missing
 * evidence lowers confidence toward `WFX_CONFIDENCE_BASE` and never silently
 * becomes zero.
 *
 * Explanations: one line per NON-ZERO contributing term with its signed
 * contribution (e.g. `session-intent match 'sci-fi' +0.252`, `fatigue (3
 * recent repeat(s), recency-weighted 3.000) -0.900`). Zero-contribution
 * terms omit their line (the sum-check stays exact); a score with NO
 * contributing term carries the explicit neutral line `no contributing
 * signal — neutral score +0.000` — explainability always. The formula has no
 * intercept, so the signed lines always sum to the score (up to the
 * 3-decimal rendering of each term).
 */

import type {
  IntentScope,
  RecommendationContext,
  RecommendationModel,
  RecommendationScore,
} from "@wfx/domain";

import {
  assembleFeatures,
  type CandidateFeatures,
  type FeedSurface,
} from "@wfx/recommendation";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The frozen provider/model identity of the WebFlix first-party strategy. */
export const WFX_MODEL_ID = "wfx-first-party";

/** The default first-party model version (semver, validated at construction). */
export const WFX_MODEL_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Version validation (semver — the official semver.org grammar, no deps)
// ---------------------------------------------------------------------------

/** The official semver.org regular expression (MAJOR.MINOR.PATCH [+prerelease][+build]). */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Structural check: is `version` a valid semver string (semver.org grammar)? */
export function isValidSemverVersion(version: unknown): version is string {
  return typeof version === "string" && SEMVER_RE.test(version);
}

/**
 * Thrown by `createWfxRecommendationModel` when the requested version is not
 * a valid semver string (a construction-time programmer error — the model
 * identity is versioned explicitly and honestly).
 */
export class InvalidWfxModelVersionError extends Error {
  /** The rejected version value, verbatim. */
  readonly version: string;

  constructor(version: string) {
    super(
      `InvalidWfxModelVersionError: version must be a valid semver string (MAJOR.MINOR.PATCH with optional -prerelease and +build, no leading zeros), got ${JSON.stringify(version)}`,
    );
    this.name = "InvalidWfxModelVersionError";
    this.version = version;
  }
}

// ---------------------------------------------------------------------------
// Documented scoring constants
// ---------------------------------------------------------------------------

/** Per-matched-intent weight (applied before the scope and strength factors). */
export const WFX_INTENT_WEIGHT = 0.35;

/**
 * Scope weights per requested surface. Session scope is the HIGHEST weight
 * on BOTH surfaces ("session scope weighted highest for the requested
 * surface"), and the short surface weights it strictly higher than the watch
 * surface — the short feed is session-aware by frozen architecture, while
 * the watch feed keeps long-lived persistent preference as its runner-up.
 */
export const WFX_SCOPE_WEIGHTS: Readonly<
  Record<FeedSurface, Readonly<Record<IntentScope, number>>>
> = Object.freeze({
  watch: Object.freeze({
    persistent: 0.85,
    temporary: 0.75,
    momentary: 0.6,
    session: 0.9,
    social: 0.7,
  }),
  short: Object.freeze({
    persistent: 0.75,
    temporary: 0.7,
    momentary: 0.65,
    session: 1,
    social: 0.65,
  }),
});

/**
 * Freshness half-life in days: content aged one half-life carries half the
 * freshness signal; each further half-life halves it again (deterministic
 * exponential decay — no clocks, the age comes from the ctx's own events).
 */
export const WFX_FRESHNESS_HALF_LIFE_DAYS = 7;

/**
 * The decay assigned when content age is UNKNOWN (no `publishedAt`, no
 * session anchor, or an unparseable instant): the documented neutral 0.5 —
 * recorded in the explanation line and reflected in lower confidence, never
 * a silent zero.
 */
export const WFX_NEUTRAL_FRESHNESS_DECAY = 0.5;

/** Base weight of the freshness term (the policy novelty dial multiplies it). */
export const WFX_NOVELTY_BASE = 0.15;

/** Weight of the source-availability term. */
export const WFX_AVAILABILITY_WEIGHT = 0.1;

/** Base weight of the exploration term (the policy exploration dial multiplies it, unseen items only). */
export const WFX_EXPLORATION_BASE = 0.2;

/**
 * Weight of the fatigue term — SUBTRACTED, never clamped, so the fatigue
 * monotonicity law holds without saturation (more repeats ⇒ strictly lower
 * score, all else equal).
 */
export const WFX_FATIGUE_WEIGHT = 0.3;

// ---------------------------------------------------------------------------
// Confidence — derived from feature completeness, never from score magnitude
// ---------------------------------------------------------------------------

/**
 * The four feature-completeness signals confidence is derived from (documented
 * order; see `confidenceOf`):
 *
 * 1. `text-surface`  — the candidate carries `matchText` or `canonicalTitle`,
 *                      so intent matching was POSSIBLE (an absent text surface
 *                      is missing evidence, not "no match").
 * 2. `content-age`   — `ageDays` is known: `publishedAt` present AND the
 *                      session anchor present, so the half-life decay is a
 *                      real measurement rather than the neutral 0.5.
 * 3. `duration`      — the item's `durationMs` is known.
 * 4. `orientation`   — the item's `orientation` is known.
 */
export const WFX_CONFIDENCE_SIGNALS = [
  "text-surface",
  "content-age",
  "duration",
  "orientation",
] as const;

/**
 * The fixed lower bound of confidence: with every completeness signal absent
 * the model still reports `WFX_CONFIDENCE_BASE` — confidence is never a
 * silent zero (and never fabricated as 1 without complete evidence).
 */
export const WFX_CONFIDENCE_BASE = 0.25;

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Render a term contribution for explanation lines (auditable, stable). */
function term(value: number): string {
  return value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
}

/**
 * The deterministic freshness decay: `0.5 ** (ageDays / halfLife)`; the
 * documented neutral `WFX_NEUTRAL_FRESHNESS_DECAY` when age is unknown.
 */
export function wfxFreshnessDecay(ageDays: number | null): number {
  if (ageDays === null) return WFX_NEUTRAL_FRESHNESS_DECAY;
  return 0.5 ** (ageDays / WFX_FRESHNESS_HALF_LIFE_DAYS);
}

/** Does the pool entry behind these features carry a text surface at all? */
function hasTextSurface(features: CandidateFeatures, ctx: RecommendationContext): boolean {
  const candidateFeatures = ctx.candidatePool[features.poolIndex]?.features;
  if (candidateFeatures === undefined) return false;
  return (
    typeof candidateFeatures.matchText === "string" ||
    typeof candidateFeatures.canonicalTitle === "string"
  );
}

/**
 * Confidence from feature completeness: `WFX_CONFIDENCE_BASE + (1 − base) ×
 * (present signals / total signals)`. Pure and deterministic; missing
 * evidence lowers confidence toward the base — never a silent zero.
 */
function confidenceOf(features: CandidateFeatures, ctx: RecommendationContext): number {
  const present = [
    hasTextSurface(features, ctx),
    features.ageDays !== null,
    features.durationMs !== null,
    features.orientation !== null,
  ].filter((signal) => signal).length;
  const total = WFX_CONFIDENCE_SIGNALS.length;
  return WFX_CONFIDENCE_BASE + (1 - WFX_CONFIDENCE_BASE) * (present / total);
}

/** The deterministic output order: score desc, then itemId asc (total order). */
function byScoreDescThenItemId(a: RecommendationScore, b: RecommendationScore): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Create the WebFlix first-party recommendation model.
 *
 * `score(ctx)` computes one `RecommendationScore` per DISTINCT canonical item
 * in the ctx pool (the frozen score interface is item-keyed; realization
 * dedupe is the OS policy stage's job, never the model's). The item's first
 * pool entry (lowest poolIndex) is its representative — item-level features
 * are identical across an item's realizations, so the choice is documented
 * and deterministic.
 *
 * @throws InvalidWfxModelVersionError when `version` is not a valid semver
 *         string — model identity is versioned explicitly, never guessed.
 */
export function createWfxRecommendationModel(version: string): RecommendationModel {
  if (!isValidSemverVersion(version)) {
    throw new InvalidWfxModelVersionError(version);
  }

  return {
    id: WFX_MODEL_ID,
    version,
    async score(ctx: RecommendationContext): Promise<RecommendationScore[]> {
      // Feature assembly validates the ctx (typed aggregated OS error on
      // malformed input — never silent, never empty-by-accident).
      const { byCandidate } = assembleFeatures(ctx);

      // One feature record per distinct item (first pool entry wins).
      const representative = new Map<string, CandidateFeatures>();
      for (const features of byCandidate) {
        if (!representative.has(features.itemId)) representative.set(features.itemId, features);
      }

      const scopeWeights = WFX_SCOPE_WEIGHTS[ctx.surface];
      const policy = ctx.policy;
      const scores: RecommendationScore[] = [];

      for (const features of representative.values()) {
        const explanations: string[] = [];
        let total = 0;

        // --- intent-match per scope (session weighted highest for the surface) ---
        for (const signal of features.matchedIntents) {
          const contribution =
            WFX_INTENT_WEIGHT * scopeWeights[signal.scope] * signal.strength;
          if (contribution !== 0) {
            total += contribution;
            explanations.push(
              `${signal.scope}-intent match '${signal.objective}' ${term(contribution)}`,
            );
          }
        }

        // --- freshness: deterministic half-life decay, novelty dial as multiplier ---
        const decay = wfxFreshnessDecay(features.ageDays);
        const freshnessContribution = WFX_NOVELTY_BASE * policy.novelty * decay;
        if (freshnessContribution !== 0) {
          total += freshnessContribution;
          const ageDescription =
            features.ageDays === null
              ? `unknown age — neutral ${WFX_NEUTRAL_FRESHNESS_DECAY.toFixed(3)}`
              : `half-life ${decay.toFixed(3)} over ${features.ageDays.toFixed(1)}d`;
          explanations.push(
            `freshness ${ageDescription} (novelty ${policy.novelty}) ${term(freshnessContribution)}`,
          );
        }

        // --- source availability ---
        const availabilityContribution =
          WFX_AVAILABILITY_WEIGHT * features.availabilityRatio;
        if (availabilityContribution !== 0) {
          total += availabilityContribution;
          explanations.push(
            `source availability ${features.availableRealizations}/${features.realizationReports} ${term(availabilityContribution)}`,
          );
        }

        // --- exploration: unseen items, policy exploration dial as multiplier ---
        if (features.unseen) {
          const explorationContribution = WFX_EXPLORATION_BASE * policy.exploration;
          if (explorationContribution !== 0) {
            total += explorationContribution;
            explanations.push(
              `unseen item — exploration appetite (exploration ${policy.exploration}) ${term(explorationContribution)}`,
            );
          }
        }

        // --- fatigue: SUBTRACTED, unclamped (monotonicity law) ---
        if (features.fatigue > 0) {
          const fatigueContribution = -WFX_FATIGUE_WEIGHT * features.fatigue;
          total += fatigueContribution;
          explanations.push(
            `fatigue (${features.repetitionCount} recent repeat(s), recency-weighted ${features.fatigue.toFixed(3)}) ${term(fatigueContribution)}`,
          );
        }

        // --- explainability always: a score with no contributing term says so ---
        if (explanations.length === 0) {
          explanations.push(`no contributing signal — neutral score ${term(0)}`);
        }

        scores.push({
          itemId: features.itemId,
          score: total,
          explanations: Object.freeze(explanations) as string[],
          confidence: confidenceOf(features, ctx),
        });
      }

      // Determinism: identical ctx ⇒ byte-identical output ordering.
      return scores.sort(byScoreDescThenItemId);
    },
  };
}
