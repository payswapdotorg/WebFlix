/**
 * @wfx/client-runtime — the R24 interaction-policy seams: the playback
 * startup law, the recommendation/AI enrichment boundary, and
 * attention-policy-aware autoplay (Worker 1's shared seams; Workers 2/3
 * bind their surfaces' guarantees to them).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md — R24-E "Startup
 * architecture laws" + the R24-C autoplay pairing; J41's acceptance):
 *
 * PLAYBACK NEVER WAITS ON RECOMMENDATION/AI ENRICHMENT:
 * - resolve the canonical item and playback realization without an
 *   unnecessary serial chain;
 * - do not wait for recommendation or AI enrichment before playback;
 * - fetch poster/metadata independently of the media startup critical
 *   path;
 * - nonessential metadata, recommendations, AI indexing and analytics
 *   must not block first-frame playback;
 * - never show fake buffering progress.
 *
 * The seam splits startup work into TWO LANES BY CONSTRUCTION:
 * - the ESSENTIAL lane (the only things first frame may wait for):
 *   canonical item resolution -> realization resolution -> resume state
 *   -> media-surface engage -> first-frame evidence;
 * - the DEFERRED lane (everything else — recommendations, AI enrichment,
 *   semantic indexing, analytics, social enrichment, posters and
 *   nonessential metadata): it runs, it renders when ready, and its
 *   states are TYPED as nonessential — there is NO parameter through
 *   which it can enter the start decision.
 *
 * ATTENTION-POLICY-AWARE AUTOPLAY (the R24-C pairing "Autoplay |
 * Attention-policy-aware autoplay"; J18: the system does not silently
 * optimize for maximum time spent when the user selected another mode):
 * the frozen policy table maps Mindful/Balanced/Immersive/Custom to the
 * autoplay truth. The decision fires only AFTER playback ends, never
 * gates first frame, and NEVER consults the viewer's account state —
 * anonymous autoplay needs no login (R23-A).
 *
 * WHAT THIS MODULE IS: typed seams + pure derivations the surfaces use to
 * GUARANTEE the laws: the startup plan sequencer, the readiness gates
 * fold, the enrichment-boundary view, the autoplay decision, and the
 * aggregate parity-regression invariant check (one callable the CI and
 * the lead's harness assert).
 *
 * WHAT THIS MODULE IS NOT: a scheduler, a player, or a recommendation
 * engine. It never starts work, never reads clocks, never fetches — it
 * types and checks the INTERACTION POLICY the surfaces must honor.
 */

import type { AttentionMode } from "./intent";
import {
  FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP,
  STARTUP_FAILURE_RATE_MAX_DELTA_PP,
  TTFF_MAX_DELTA_MS,
} from "./playback-telemetry";
import {
  validateCapabilityPlacementMatrix,
  type CapabilityPlacementValidation,
} from "./capability-placement";
import {
  validateParityTaxonomy,
  type ParityTaxonomyValidation,
} from "./parity-taxonomy";

// ---------------------------------------------------------------------------
// The startup work taxonomy (the two lanes of the R24-E startup law)
// ---------------------------------------------------------------------------

/**
 * One unit of playback-startup work, classified into the two frozen
 * lanes: the ESSENTIAL path first frame may lawfully wait for, and the
 * DEFERRED enrichment lane it may NEVER wait for.
 */
export type PlaybackStartupWorkId =
  // — the essential lane (the startup critical path) —
  /** Resolve the canonical item (identity first — the R24-E law). */
  | "resolve-canonical-item"
  /** Resolve the playback realization (Where to watch). */
  | "resolve-playback-realization"
  /** Load resume state (playback starts at the right position). */
  | "load-resume-state"
  /** Engage the media surface (browser host / native session / embed). */
  | "engage-media-surface"
  /** Await first-frame evidence (truthful playback evidence). */
  | "await-first-frame-evidence"
  // — the deferred lane (never blocks first frame) —
  /** Fetch the poster (independently, off the media critical path). */
  | "fetch-poster"
  /** Fetch nonessential metadata (description and friends). */
  | "fetch-nonessential-metadata"
  /** Recommendation enrichment (related rail / up-next composition). */
  | "recommendation-enrichment"
  /** AI enrichment (transcripts, chapter derivation, AI action readiness). */
  | "ai-enrichment"
  /** Semantic indexing (moment index work). */
  | "semantic-indexing"
  /** Analytics emission. */
  | "analytics"
  /** Social surface enrichment (comments/reactions hydration). */
  | "social-surface-enrichment";

/**
 * The ESSENTIAL lane in canonical order — the ONLY work first frame may
 * wait for, and the complete path to it.
 */
export const PLAYBACK_STARTUP_ESSENTIAL_WORK: readonly PlaybackStartupWorkId[] =
  [
    "resolve-canonical-item",
    "resolve-playback-realization",
    "load-resume-state",
    "engage-media-surface",
    "await-first-frame-evidence",
  ] as const;

/**
 * The DEFERRED lane — everything else startup touches. The R24-E law
 * names the members explicitly: nonessential metadata, recommendations,
 * AI indexing, analytics — plus posters (fetched independently) and
 * social enrichment.
 */
export const PLAYBACK_STARTUP_DEFERRED_WORK: readonly PlaybackStartupWorkId[] =
  [
    "fetch-poster",
    "fetch-nonessential-metadata",
    "recommendation-enrichment",
    "ai-enrichment",
    "semantic-indexing",
    "analytics",
    "social-surface-enrichment",
  ] as const;

/** Every startup work id (both lanes). */
export const PLAYBACK_STARTUP_WORK: readonly PlaybackStartupWorkId[] = [
  ...PLAYBACK_STARTUP_ESSENTIAL_WORK,
  ...PLAYBACK_STARTUP_DEFERRED_WORK,
] as const;

/** Runtime membership check against the work union. */
export function isPlaybackStartupWork(
  x: unknown,
): x is PlaybackStartupWorkId {
  return (
    typeof x === "string" &&
    (PLAYBACK_STARTUP_WORK as readonly string[]).includes(x)
  );
}

/** True when `work` is on the ESSENTIAL lane (the startup critical path). */
export function isEssentialStartupWork(
  work: PlaybackStartupWorkId,
): boolean {
  return (PLAYBACK_STARTUP_ESSENTIAL_WORK as readonly string[]).includes(
    work,
  );
}

/** True when `work` is on the DEFERRED lane (never blocks first frame). */
export function isDeferredStartupWork(work: PlaybackStartupWorkId): boolean {
  return (PLAYBACK_STARTUP_DEFERRED_WORK as readonly string[]).includes(
    work,
  );
}

// ---------------------------------------------------------------------------
// The startup plan seam (the sequencer + its machine-checkable law)
// ---------------------------------------------------------------------------

/**
 * The typed startup plan a surface renders: which work is AWAITED before
 * first frame (the essential lane, in canonical order) and which work is
 * DEFERRED (it runs, but first frame never waits for it). The plan is the
 * contract the J41 harness and the regression tests verify against.
 */
export interface PlaybackStartupPlan {
  /** The essential lane, in canonical order (the awaited critical path). */
  readonly essential: readonly PlaybackStartupWorkId[];
  /** The deferred lane — BY CONSTRUCTION never awaited before first frame. */
  readonly deferred: readonly PlaybackStartupWorkId[];
  /** The work that was requested but is neither essential nor deferred (a contract error — always empty in lawful plans). */
  readonly unknown: readonly string[];
}

/**
 * Plan a startup from the requested work set (PURE): essential work is
 * awaited in the frozen canonical order; deferred work is split into its
 * own lane that first frame never waits on; unknown ids are surfaced
 * (never silently dropped — the startup law check names them).
 */
export function planPlaybackStartup(
  requested: readonly PlaybackStartupWorkId[],
): PlaybackStartupPlan {
  const essential = PLAYBACK_STARTUP_ESSENTIAL_WORK.filter((work) =>
    (requested as readonly string[]).includes(work),
  );
  const deferred = PLAYBACK_STARTUP_DEFERRED_WORK.filter((work) =>
    (requested as readonly string[]).includes(work),
  );
  const unknown = requested.filter(
    (work) => !isPlaybackStartupWork(work),
  ) as readonly string[];
  return { essential, deferred, unknown };
}

/** One startup-law violation (machine-checkable). */
export interface StartupLawViolation {
  readonly problem: string;
}

/**
 * The R24-E startup law as a machine check on a plan:
 *
 * 1. LANE INTEGRITY — every id on the essential lane is essential and
 *    every id on the deferred lane is deferred (no smuggling deferred
 *    work — recommendations, AI enrichment, indexing, analytics — into
 *    the awaited critical path);
 * 2. COMPLETE PATH — the essential lane carries ALL FIVE canonical steps
 *    in order (a plan that cannot reach first frame is not a startup
 *    plan);
 * 3. NO UNKNOWN WORK — every requested id is a member of the frozen
 *    vocabulary;
 * 4. NO DUPLICATES — no lane repeats work.
 */
export function startupLawViolations(
  plan: PlaybackStartupPlan,
): readonly StartupLawViolation[] {
  const violations: StartupLawViolation[] = [];

  for (const work of plan.essential) {
    if (!isEssentialStartupWork(work)) {
      violations.push({
        problem: `deferred work "${work}" is on the awaited essential lane (first frame must never wait on it)`,
      });
    }
  }
  for (const work of plan.deferred) {
    if (!isDeferredStartupWork(work)) {
      violations.push({
        problem: `essential work "${work}" is on the deferred lane (the startup critical path is incomplete)`,
      });
    }
  }
  if (
    plan.essential.length !== PLAYBACK_STARTUP_ESSENTIAL_WORK.length ||
    plan.essential.some(
      (work, index) => work !== PLAYBACK_STARTUP_ESSENTIAL_WORK[index],
    )
  ) {
    violations.push({
      problem:
        "the essential lane must be the complete five-step canonical path in order (canonical item -> realization -> resume -> surface engage -> first-frame evidence)",
    });
  }
  for (const id of plan.unknown) {
    violations.push({
      problem: `unknown startup work "${id}" is not a member of the frozen vocabulary`,
    });
  }
  const laneSizes = new Map<string, number>();
  for (const work of [...plan.essential, ...plan.deferred]) {
    laneSizes.set(work, (laneSizes.get(work) ?? 0) + 1);
  }
  for (const [work, count] of laneSizes) {
    if (count > 1) {
      violations.push({ problem: `startup work "${work}" appears ${String(count)} times` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The readiness gates (the start decision — enrichment cannot enter)
// ---------------------------------------------------------------------------

/**
 * The ESSENTIAL gates of the start decision. This is the ONLY input the
 * playback-start eligibility consumes — enrichment has no parameter here
 * BY CONSTRUCTION, which is how the seam GUARANTEES playback never waits
 * on recommendation/AI work.
 */
export interface PlaybackReadinessGates {
  readonly canonicalItemResolved: boolean;
  readonly realizationResolved: boolean;
  readonly resumeStateLoaded: boolean;
  readonly mediaSurfaceEngaged: boolean;
  readonly firstFrameEvidence: boolean;
}

/** The start-eligibility fold over the essential gates (pure). */
export interface PlaybackStartEligibility {
  readonly mayStart: boolean;
  /** The essential gates still missing (empty when mayStart). */
  readonly blockedBy: readonly PlaybackStartupWorkId[];
}

/** Resolve whether playback may start (from the ESSENTIAL gates ONLY). */
export function resolvePlaybackStartEligibility(
  gates: PlaybackReadinessGates,
): PlaybackStartEligibility {
  const blockedBy: PlaybackStartupWorkId[] = [];
  if (!gates.canonicalItemResolved) blockedBy.push("resolve-canonical-item");
  if (!gates.realizationResolved) blockedBy.push("resolve-playback-realization");
  if (!gates.resumeStateLoaded) blockedBy.push("load-resume-state");
  if (!gates.mediaSurfaceEngaged) blockedBy.push("engage-media-surface");
  if (!gates.firstFrameEvidence) blockedBy.push("await-first-frame-evidence");
  return { mayStart: blockedBy.length === 0, blockedBy };
}

// ---------------------------------------------------------------------------
// The enrichment boundary seam (typed nonessential states)
// ---------------------------------------------------------------------------

/**
 * The state of one DEFERRED work item — typed as NONESSENTIAL at the
 * seam: a failure here is `failed-nonessential`, which surfaces may
 * render honestly (a quiet retry, a hidden rail) but which the playback
 * start decision can never read.
 */
export type PlaybackEnrichmentState =
  | "pending"
  | "ready"
  | "failed-nonessential";

/**
 * The enrichment-boundary view a surface renders: the playback lane
 * (essential gates only) and the enrichment lane (nonessential states)
 * SIDE BY SIDE — playback may be started while every enrichment kind is
 * still pending, and that is the CONTRACT, not a race.
 */
export interface PlaybackStartupSeamView {
  readonly playback: PlaybackStartEligibility;
  readonly enrichment: {
    readonly state: PlaybackEnrichmentState;
    readonly kinds: readonly PlaybackStartupWorkId[];
  };
}

/**
 * Render the startup seam (PURE): the playback half derives ONLY from the
 * essential gates; the enrichment half derives ONLY from the nonessential
 * states. Neither reads the other — the boundary is the guarantee.
 */
export function renderPlaybackStartupSeam(
  gates: PlaybackReadinessGates,
  enrichmentStates: Readonly<
    Partial<Record<PlaybackStartupWorkId, PlaybackEnrichmentState>>
  >,
): PlaybackStartupSeamView {
  const kinds = (Object.keys(enrichmentStates) as PlaybackStartupWorkId[])
    .filter(isDeferredStartupWork)
    .sort();
  const states = kinds.map((kind) => enrichmentStates[kind] ?? "pending");
  const state: PlaybackEnrichmentState = states.every((s) => s === "ready")
    ? "ready"
    : states.some((s) => s === "failed-nonessential")
      ? "failed-nonessential"
      : "pending";
  return {
    playback: resolvePlaybackStartEligibility(gates),
    enrichment: { state, kinds },
  };
}

// ---------------------------------------------------------------------------
// Attention-policy-aware autoplay (the R24-C pairing, frozen)
// ---------------------------------------------------------------------------

/**
 * The frozen autoplay policy row for one attention mode. Autoplay is
 * POLICY, not cosmetics (the frozen architecture law): the system never
 * silently optimizes for maximum time spent against the user's mode.
 */
export interface AutoplayPolicyRow {
  /** Whether playback auto-advances to the next item after it ends. */
  readonly autoplay: boolean | "follows-user-dial";
  /** Whether the up-next affordance renders (the quiet alternative). */
  readonly upNextAffordance: boolean;
  /** The user-facing rationale (one derivation source). */
  readonly rationale: string;
}

/**
 * THE frozen autoplay policy table (the R24-C pairing "Autoplay |
 * Attention-policy-aware autoplay"). Mindful never auto-advances;
 * Balanced auto-advances with a cancellable countdown; Immersive
 * maximizes continuity; Custom follows the user's dial.
 */
export const AUTOPLAY_POLICY: Readonly<Record<AttentionMode, AutoplayPolicyRow>> =
  {
    mindful: {
      autoplay: false,
      upNextAffordance: true,
      rationale:
        "Mindful: playback stops when the item ends; the next item is offered, never forced.",
    },
    balanced: {
      autoplay: true,
      upNextAffordance: true,
      rationale:
        "Balanced: the next item plays with a cancellable countdown.",
    },
    immersive: {
      autoplay: true,
      upNextAffordance: true,
      rationale:
        "Immersive: playback flows continuously into the next item.",
    },
    custom: {
      autoplay: "follows-user-dial",
      upNextAffordance: true,
      rationale:
        "Custom: autoplay follows your own autoplay setting.",
    },
  };

/** The input of the autoplay decision (the seam's whole truth). */
export interface AutoplayDecisionInput {
  /** The active attention mode (the policy owner). */
  readonly attentionMode: AttentionMode;
  /** The Custom mode's user autoplay dial (used only for Custom). */
  readonly customAutoplayEnabled: boolean;
  /** Whether up-next content exists (from the Recommendation OS lane). */
  readonly hasNextContent: boolean;
  /**
   * The viewer's session state. DELIBERATELY unused by the decision
   * (anonymous autoplay needs no login — R23-A); it exists on the seam so
   * the LAW is testable: the decision must be identical either way.
   */
  readonly viewerIsAnonymous: boolean;
  /** Whether the current item has ENDED (autoplay fires only here). */
  readonly playbackEnded: boolean;
}

/** The autoplay decision (pure derivation). */
export interface AutoplayDecision {
  readonly autoplay: boolean;
  readonly upNextAffordance: boolean;
  readonly reason: string;
}

/**
 * Resolve the autoplay decision (PURE, from the frozen policy table):
 *
 * - the decision applies ONLY after playback ends — it never gates
 *   startup or first frame (the R24-E startup law);
 * - without next content there is nothing to autoplay (honest stop);
 * - the attention policy decides (Mindful stops, Balanced/Immersive
 *   continue, Custom follows the dial);
 * - the viewer's account state NEVER enters the decision (anonymous
 *   autoplay needs no login — the R23-A law).
 */
export function resolveAutoplayDecision(
  input: AutoplayDecisionInput,
): AutoplayDecision {
  if (!input.playbackEnded) {
    return {
      autoplay: false,
      upNextAffordance: false,
      reason:
        "The current item is still playing — autoplay applies only after it ends.",
    };
  }
  if (!input.hasNextContent) {
    return {
      autoplay: false,
      upNextAffordance: false,
      reason: "There is no next content to play.",
    };
  }
  const policy = AUTOPLAY_POLICY[input.attentionMode];
  const autoplay =
    policy.autoplay === "follows-user-dial"
      ? input.customAutoplayEnabled
      : policy.autoplay;
  return {
    autoplay,
    upNextAffordance: policy.upNextAffordance,
    reason: policy.rationale,
  };
}

// ---------------------------------------------------------------------------
// The aggregate parity-regression invariants (one callable)
// ---------------------------------------------------------------------------

/**
 * The complete R24-W1 parity-regression invariant report: taxonomy
 * completeness, placement laws, the startup law, the autoplay law and the
 * frozen performance thresholds — one callable for CI, the surfaces and
 * the lead's lab harness. `ok` is the AND of every invariant.
 */
export interface ParityRegressionInvariants {
  readonly taxonomy: ParityTaxonomyValidation;
  readonly placement: CapabilityPlacementValidation;
  readonly startupLaw: {
    readonly ok: boolean;
    readonly violations: readonly StartupLawViolation[];
  };
  readonly autoplayLaw: {
    readonly ok: boolean;
    readonly problems: readonly string[];
  };
  readonly thresholds: {
    readonly ttffP50MaxDeltaMs: number;
    readonly ttffP75MaxDeltaMs: number;
    readonly ttffP95MaxDeltaMs: number;
    readonly startupFailureRateMaxDeltaPp: number;
    readonly first60sRebufferRatioMaxDeltaPp: number;
  };
  readonly ok: boolean;
}

/**
 * Check EVERY R24 shared-lane invariant (pure):
 *
 * 1. TAXONOMY — the complete classified inventory (the lab rule);
 * 2. PLACEMENT — the R24-B laws 1-6 + coverage over all capabilities;
 * 3. STARTUP LAW — the full-work plan passes the machine check (the two
 *    lanes cannot smuggle; the five-step essential path is complete) and
 *    the enrichment boundary keeps a started playback lawful while every
 *    enrichment kind is pending;
 * 4. AUTOPLAY LAW — the frozen policy table decides every attention mode,
 *    requires playback to have ended, and produces IDENTICAL decisions
 *    for anonymous and authenticated viewers (no login dependency);
 * 5. THRESHOLDS — the frozen R24-E constants are exactly the plan's
 *    numbers (a silent loosening fails here).
 */
export function checkParityRegressionInvariants(): ParityRegressionInvariants {
  const taxonomy = validateParityTaxonomy();
  const placement = validateCapabilityPlacementMatrix();

  const plan = planPlaybackStartup(PLAYBACK_STARTUP_WORK);
  const startupViolations: StartupLawViolation[] = [
    ...startupLawViolations(plan),
  ];
  const seamWhileEnrichmentPending = renderPlaybackStartupSeam(
    {
      canonicalItemResolved: true,
      realizationResolved: true,
      resumeStateLoaded: true,
      mediaSurfaceEngaged: true,
      firstFrameEvidence: true,
    },
    Object.fromEntries(
      PLAYBACK_STARTUP_DEFERRED_WORK.map((work) => [work, "pending" as const]),
    ) as Partial<Record<PlaybackStartupWorkId, PlaybackEnrichmentState>>,
  );
  if (!seamWhileEnrichmentPending.playback.mayStart) {
    startupViolations.push({
      problem:
        "playback may not start while enrichment is pending (the enrichment boundary is broken)",
    });
  }

  const autoplayProblems: string[] = [];
  const modes: readonly AttentionMode[] = [
    "mindful",
    "balanced",
    "immersive",
    "custom",
  ];
  for (const mode of modes) {
    if (AUTOPLAY_POLICY[mode] === undefined) {
      autoplayProblems.push(`attention mode ${mode} has no autoplay policy row`);
      continue;
    }
    const anonymous = resolveAutoplayDecision({
      attentionMode: mode,
      customAutoplayEnabled: true,
      hasNextContent: true,
      viewerIsAnonymous: true,
      playbackEnded: true,
    });
    const authenticated = resolveAutoplayDecision({
      attentionMode: mode,
      customAutoplayEnabled: true,
      hasNextContent: true,
      viewerIsAnonymous: false,
      playbackEnded: true,
    });
    if (
      anonymous.autoplay !== authenticated.autoplay ||
      anonymous.upNextAffordance !== authenticated.upNextAffordance
    ) {
      autoplayProblems.push(
        `autoplay decision for ${mode} depends on the viewer's account state (R23-A violation)`,
      );
    }
    const midPlayback = resolveAutoplayDecision({
      attentionMode: mode,
      customAutoplayEnabled: true,
      hasNextContent: true,
      viewerIsAnonymous: true,
      playbackEnded: false,
    });
    if (midPlayback.autoplay) {
      autoplayProblems.push(
        `autoplay for ${mode} fires before playback ended (startup-law violation)`,
      );
    }
  }
  const noNext = resolveAutoplayDecision({
    attentionMode: "immersive",
    customAutoplayEnabled: true,
    hasNextContent: false,
    viewerIsAnonymous: true,
    playbackEnded: true,
  });
  if (noNext.autoplay) {
    autoplayProblems.push("autoplay fires without next content");
  }

  const thresholds = {
    ttffP50MaxDeltaMs: TTFF_MAX_DELTA_MS.p50,
    ttffP75MaxDeltaMs: TTFF_MAX_DELTA_MS.p75,
    ttffP95MaxDeltaMs: TTFF_MAX_DELTA_MS.p95,
    startupFailureRateMaxDeltaPp: STARTUP_FAILURE_RATE_MAX_DELTA_PP,
    first60sRebufferRatioMaxDeltaPp: FIRST_60S_REBUFFER_RATIO_MAX_DELTA_PP,
  };

  const startupLaw = {
    ok: startupViolations.length === 0,
    violations: startupViolations,
  };
  const autoplayLaw = {
    ok: autoplayProblems.length === 0,
    problems: autoplayProblems,
  };

  return {
    taxonomy,
    placement,
    startupLaw,
    autoplayLaw,
    thresholds,
    ok:
      taxonomy.ok &&
      placement.ok &&
      startupLaw.ok &&
      autoplayLaw.ok &&
      thresholds.ttffP50MaxDeltaMs === 150 &&
      thresholds.ttffP75MaxDeltaMs === 300 &&
      thresholds.ttffP95MaxDeltaMs === 750 &&
      thresholds.startupFailureRateMaxDeltaPp === 0.5 &&
      thresholds.first60sRebufferRatioMaxDeltaPp === 0.25,
  };
}
