/**
 * @wfx/experience — Short Feed session-aware re-ranking triggers (WFX-028, Lane C).
 *
 * `shouldRerank(sessionState, events)` decides — PURELY, from typed data —
 * whether the Short Feed should ask the Recommendation OS for a fresh
 * short-surface page NOW. The frozen architecture's Short Feed law:
 * "vertical, swipe-driven, rapid candidate replacement and SESSION-AWARE
 * RANKING" — this module is the session-awareness: it fires on
 *
 *   - N forward SWIPES since the last re-rank, or
 *   - M elapsed SECONDS since the last re-rank, or
 *   - a LIKE / SAVE engagement signal in the accumulated events,
 *
 * with N and M derived from the session's intent-graph POLICY (the frozen
 * `RecommendationPolicy.attentionMode` vocabulary — the same reuse law as
 * WFX-027's binge-chain visibility):
 *
 * - `mindful`   — the most frequent re-ranking (N=3 swipes / M=30s): a
 *   conscious-choice feed stays fresh; skipped candidates are replaced
 *   quickly and the feed never tunnels.
 * - `balanced`  — the default middle (N=5 / M=60s).
 * - `immersive` — the most stable (N=8 / M=120s): flow is not interrupted
 *   by re-ranking churn.
 * - `custom`    — the frozen custom policy carries no re-rank dial (attention
 *   tuning is delegated to the user's explicit objectives), so the neutral
 *   balanced thresholds apply — a documented default, never presented as
 *   user-chosen.
 *
 * THE ATTENTION-POLICY LAW (frozen architecture, "Attention policy"): "The
 * system does not silently optimize for maximum session length when the user
 * selected a different objective." This decision CANNOT violate it by
 * construction: it only answers "re-rank now?" and carries evidence. It
 * never extends, chains, or ranks anything itself, never alters the policy
 * (the attention mode rides along verbatim for traceability), and its
 * re-rank scope is a typed REORDER-ONLY constraint (see `RerankScope`).
 *
 * ANTI-TUNNEL-VISION LAW (frozen architecture, "Recommendation principles"):
 * "A single watched topic must never permanently narrow the user profile."
 * The decision's evidence is the EXACT output of the WFX-011 inference
 * (`inferFromEvents`, @wfx/domain) on the accumulated events — strictly
 * ADDITIVE `IntentUpdate`s (create-or-reinforce; the Intent Graph applies
 * them through `record()`, which can never delete or down-rank). Re-ranking
 * DEMOTES NOTHING below visibility: the `RerankScope` is a permutation of
 * the ahead-of-cursor candidates only — every candidate stays in the feed.
 *
 * Determinism laws: no randomness, no hidden clock (`nowMs` is injected),
 * no globals; trigger order is fixed ("swipe-count", "elapsed-ms",
 * "engagement-signal").
 */

import type { EntertainmentEvent, IntentUpdate, RecommendationPolicy } from "@wfx/domain";
import {
  inferFromEvents,
  isRecord,
  previewValue,
  validateEntertainmentEvent,
  validatePolicy,
} from "@wfx/domain";

import { ExperienceError } from "../ports";
import type { AttentionMode } from "../watch/continuity";

// ---------------------------------------------------------------------------
// The session state (shared with replacement.ts — one session, one type)
// ---------------------------------------------------------------------------

/**
 * The Short Feed session state: identity, the frozen intent-graph policy,
 * the session's engagement evidence, and the re-rank trigger counters. All
 * of it is HOST-SUPPLIED data (injected, never fetched); `nowMs` replaces
 * any hidden clock.
 */
export interface ShortSessionState {
  userId: string;
  sessionId: string;
  /** The frozen intent-graph policy (its attention mode drives the thresholds). */
  policy: RecommendationPolicy;
  /** Canonical item ids WATCHED (completed) this session — replaceable evidence. */
  watchedItemIds: readonly string[];
  /** Canonical item ids SKIPPED this session — replaceable evidence. */
  skippedItemIds: readonly string[];
  /** Forward swipes since the last re-rank decision (session start initially). */
  swipesSinceRerank: number;
  /** Elapsed milliseconds since the last re-rank decision (session start initially). */
  msSinceRerank: number;
  /** The injected "now" (epoch ms) — stamps the intent updates; no hidden clock. */
  nowMs: number;
  /**
   * The ahead-of-cursor item ids in current stack order — the re-rank
   * window. Kept in sync by the host (it owns the stack); the decision
   * reports it as the reorder scope.
   */
  aheadOfCursorItemIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Thresholds (documented constants, per frozen attention mode)
// ---------------------------------------------------------------------------

/** Mindful: re-rank after at most this many forward swipes. */
export const MINDFUL_RERANK_SWIPE_THRESHOLD = 3;
/** Mindful: re-rank after at most this many elapsed milliseconds. */
export const MINDFUL_RERANK_ELAPSED_MS = 30_000;
/** Balanced (default): re-rank after at most this many forward swipes. */
export const BALANCED_RERANK_SWIPE_THRESHOLD = 5;
/** Balanced (default): re-rank after at most this many elapsed milliseconds. */
export const BALANCED_RERANK_ELAPSED_MS = 60_000;
/** Immersive: re-rank after at most this many forward swipes (stability for flow). */
export const IMMERSIVE_RERANK_SWIPE_THRESHOLD = 8;
/** Immersive: re-rank after at most this many elapsed milliseconds. */
export const IMMERSIVE_RERANK_ELAPSED_MS = 120_000;

/**
 * Re-rank thresholds per attention mode (documented law — see the module
 * doc). Custom delegates attention tuning to explicit objectives, so the
 * neutral balanced thresholds apply.
 */
export const RERANK_THRESHOLDS: Readonly<
  Record<AttentionMode, { swipeThreshold: number; elapsedMsThreshold: number }>
> = {
  mindful: {
    swipeThreshold: MINDFUL_RERANK_SWIPE_THRESHOLD,
    elapsedMsThreshold: MINDFUL_RERANK_ELAPSED_MS,
  },
  balanced: {
    swipeThreshold: BALANCED_RERANK_SWIPE_THRESHOLD,
    elapsedMsThreshold: BALANCED_RERANK_ELAPSED_MS,
  },
  immersive: {
    swipeThreshold: IMMERSIVE_RERANK_SWIPE_THRESHOLD,
    elapsedMsThreshold: IMMERSIVE_RERANK_ELAPSED_MS,
  },
  custom: {
    swipeThreshold: BALANCED_RERANK_SWIPE_THRESHOLD,
    elapsedMsThreshold: BALANCED_RERANK_ELAPSED_MS,
  },
};

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Which re-rank trigger fired (fixed order: swipes, time, engagement). */
export type RerankTrigger = "swipe-count" | "elapsed-ms" | "engagement-signal";

/**
 * The re-ranking scope constraint (typed law): the OS may REORDER the
 * ahead-of-cursor candidates only. The reorder is a PERMUTATION of exactly
 * `eligibleItemIds` — nothing is removed, nothing is added, and nothing is
 * demoted below visibility: every candidate stays in the feed
 * (anti-tunnel-vision; the attention-policy law).
 */
export interface RerankScope {
  window: "ahead-of-cursor";
  /** The item ids eligible for reordering, in current stack order. */
  eligibleItemIds: readonly string[];
  /** Always "visible": no candidate may drop below visibility. */
  demotionFloor: "visible";
}

/**
 * The typed re-rank decision: whether to re-rank NOW, which triggers fired
 * (with non-empty reasons), the exact additive WFX-011 intent-update inputs
 * derived from the accumulated events, and — when re-ranking — the
 * reorder-only scope. The attention mode rides along VERBATIM for
 * traceability; this decision never alters policy, never optimizes session
 * length, and never demotes anything below visibility.
 */
export interface RerankDecision {
  /** True iff a re-rank should run now (at least one trigger fired). */
  rerank: boolean;
  /** Which triggers fired, in fixed order; empty iff `rerank` is false. */
  triggers: readonly RerankTrigger[];
  /** NON-EMPTY reasons: one per fired trigger, or why nothing fired. */
  reasons: readonly string[];
  /**
   * The EXACT WFX-011 `inferFromEvents` outputs for the accumulated events
   * — additive evidence only (create-or-reinforce; never deletes, never
   * down-ranks). Carried whether or not a trigger fired: additive evidence
   * is reported, never silently dropped by this module.
   */
  intentUpdates: readonly IntentUpdate[];
  /** The reorder-only scope; present iff `rerank` is true. */
  scope?: RerankScope;
  /** The session policy's attention mode, verbatim (traceability — never altered). */
  attentionMode: AttentionMode;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIdList(value: unknown, field: string, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push(`${field}: expected an array of item ids, got ${previewValue(value)}`);
    return;
  }
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      problems.push(`${field}[${index}]: expected a non-empty string, got ${previewValue(entry)}`);
    }
  });
}

function assertUsableSessionState(sessionState: ShortSessionState): void {
  if (!isRecord(sessionState)) {
    throw new ExperienceError("sessionState: expected a ShortSessionState object");
  }
  const problems: string[] = [];
  if (!isNonEmptyString(sessionState.userId)) {
    problems.push(
      `sessionState.userId: expected a non-empty string, got ${previewValue(sessionState.userId)}`,
    );
  }
  if (!isNonEmptyString(sessionState.sessionId)) {
    problems.push(
      `sessionState.sessionId: expected a non-empty string, got ${previewValue(sessionState.sessionId)}`,
    );
  }
  const policyCheck = validatePolicy(sessionState.policy);
  if (!policyCheck.ok) {
    problems.push(
      ...policyCheck.errors.map((message) => `sessionState.policy: ${message}`),
    );
  }
  isIdList(sessionState.watchedItemIds, "sessionState.watchedItemIds", problems);
  isIdList(sessionState.skippedItemIds, "sessionState.skippedItemIds", problems);
  isIdList(sessionState.aheadOfCursorItemIds, "sessionState.aheadOfCursorItemIds", problems);
  if (
    typeof sessionState.swipesSinceRerank !== "number" ||
    !Number.isFinite(sessionState.swipesSinceRerank) ||
    sessionState.swipesSinceRerank < 0
  ) {
    problems.push(
      `sessionState.swipesSinceRerank: expected a finite non-negative number, got ${previewValue(sessionState.swipesSinceRerank)}`,
    );
  }
  if (
    typeof sessionState.msSinceRerank !== "number" ||
    !Number.isFinite(sessionState.msSinceRerank) ||
    sessionState.msSinceRerank < 0
  ) {
    problems.push(
      `sessionState.msSinceRerank: expected a finite non-negative number, got ${previewValue(sessionState.msSinceRerank)}`,
    );
  }
  if (
    typeof sessionState.nowMs !== "number" ||
    !Number.isFinite(sessionState.nowMs) ||
    sessionState.nowMs < 0
  ) {
    problems.push(
      `sessionState.nowMs: expected a finite non-negative epoch-milliseconds number, got ${previewValue(sessionState.nowMs)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertUsableAccumulatedEvents(
  userId: string,
  events: readonly EntertainmentEvent[],
): void {
  if (!Array.isArray(events)) {
    throw new ExperienceError(
      `events: expected an array of EntertainmentEvent, got ${previewValue(events)}`,
    );
  }
  const problems: string[] = [];
  events.forEach((event, index) => {
    const checked = validateEntertainmentEvent(event);
    if (!checked.ok) {
      problems.push(...checked.errors.map((message) => `events[${index}]: ${message}`));
      return;
    }
    if (checked.value.userId.trim() !== userId.trim()) {
      problems.push(
        `events[${index}]: userId '${checked.value.userId}' does not match the session user '${userId}'`,
      );
    }
  });
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// shouldRerank
// ---------------------------------------------------------------------------

/**
 * Decide whether the Short Feed should re-rank now (pure — see the module
 * doc for every law).
 *
 * @param sessionState the session's identity, policy, evidence, and trigger
 *        counters (all host-supplied; `nowMs` is the injected clock).
 * @param events the frozen `EntertainmentEvent`s accumulated since the last
 *        re-rank decision (session start initially). Validated with the
 *        WFX-002 validator; every event must belong to the session user.
 * @returns the typed `RerankDecision` — triggers, reasons, the exact
 *          additive WFX-011 intent-update inputs, and (when re-ranking)
 *          the reorder-only scope.
 * @throws `ExperienceError` on malformed caller input (session state or
 *         events).
 */
export function shouldRerank(
  sessionState: ShortSessionState,
  events: readonly EntertainmentEvent[],
): RerankDecision {
  assertUsableSessionState(sessionState);
  assertUsableAccumulatedEvents(sessionState.userId, events);

  const mode = sessionState.policy.attentionMode;
  const thresholds = RERANK_THRESHOLDS[mode];

  // The exact WFX-011 inference on the accumulated events — additive only.
  // (Validation above guarantees this call cannot throw.)
  const intentUpdates = inferFromEvents(sessionState.userId, events, sessionState.nowMs);

  const triggers: RerankTrigger[] = [];
  const reasons: string[] = [];

  if (sessionState.swipesSinceRerank >= thresholds.swipeThreshold) {
    triggers.push("swipe-count");
    reasons.push(
      `swipe threshold reached: ${sessionState.swipesSinceRerank} forward swipes since the last re-rank >= ${thresholds.swipeThreshold} (attention mode '${mode}')`,
    );
  }
  if (sessionState.msSinceRerank >= thresholds.elapsedMsThreshold) {
    triggers.push("elapsed-ms");
    reasons.push(
      `time threshold reached: ${sessionState.msSinceRerank}ms since the last re-rank >= ${thresholds.elapsedMsThreshold}ms (attention mode '${mode}')`,
    );
  }
  const engagementSignals = events.filter(
    (event) => event.type === "like" || event.type === "save",
  );
  if (engagementSignals.length > 0) {
    triggers.push("engagement-signal");
    reasons.push(
      `engagement signal: ${engagementSignals.length} like/save event(s) since the last re-rank`,
    );
  }

  if (triggers.length === 0) {
    reasons.push(
      `no re-rank trigger: ${sessionState.swipesSinceRerank} swipes (< ${thresholds.swipeThreshold}), ${sessionState.msSinceRerank}ms (< ${thresholds.elapsedMsThreshold}ms), no like/save signal (attention mode '${mode}')`,
    );
    return {
      rerank: false,
      triggers: Object.freeze([]),
      reasons: Object.freeze(reasons),
      intentUpdates: Object.freeze(intentUpdates),
      attentionMode: mode,
    };
  }

  reasons.push(
    `re-rank scope: reorder the ${sessionState.aheadOfCursorItemIds.length} ahead-of-cursor candidate(s) only — a permutation, nothing removed, nothing demoted below visibility`,
  );
  return {
    rerank: true,
    triggers: Object.freeze(triggers),
    reasons: Object.freeze(reasons),
    intentUpdates: Object.freeze(intentUpdates),
    scope: Object.freeze({
      window: "ahead-of-cursor",
      eligibleItemIds: Object.freeze([...sessionState.aheadOfCursorItemIds]),
      demotionFloor: "visible",
    }),
    attentionMode: mode,
  };
}
