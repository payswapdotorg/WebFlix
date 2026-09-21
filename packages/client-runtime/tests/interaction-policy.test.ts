/**
 * @wfx/client-runtime — R24 interaction-policy seam tests (the parity
 * regression suite).
 *
 * The frozen seams, at the shared seam:
 * - the R24-E STARTUP LAW: the two-lane work taxonomy (essential vs
 *   deferred), the plan sequencer, and the machine check that catches
 *   deferred work smuggled onto the awaited critical path (playback NEVER
 *   waits on recommendation/AI enrichment);
 * - the READINESS GATES: the start decision consumes the essential gates
 *   ONLY — enrichment has no parameter, by construction;
 * - the ENRICHMENT BOUNDARY view: playback may start while every
 *   enrichment kind is pending; enrichment failures are typed
 *   nonessential and never gate anything;
 * - the ATTENTION-POLICY-AWARE AUTOPLAY: the frozen policy table decides
 *   every mode, fires only after playback ends, never gates first frame,
 *   and produces IDENTICAL decisions for anonymous and authenticated
 *   viewers (no login dependency — R23-A);
 * - the AGGREGATE parity-regression invariants: one callable folding
 *   taxonomy + placement + startup law + autoplay law + the frozen
 *   thresholds.
 */

import { describe, expect, it } from "bun:test";

import {
  AUTOPLAY_POLICY,
  PLAYBACK_STARTUP_DEFERRED_WORK,
  PLAYBACK_STARTUP_ESSENTIAL_WORK,
  PLAYBACK_STARTUP_WORK,
  checkParityRegressionInvariants,
  isDeferredStartupWork,
  isEssentialStartupWork,
  isPlaybackStartupWork,
  planPlaybackStartup,
  renderPlaybackStartupSeam,
  resolveAutoplayDecision,
  resolvePlaybackStartEligibility,
  startupLawViolations,
  type PlaybackReadinessGates,
  type PlaybackStartupPlan,
} from "../src/index";

const ALL_GATES: PlaybackReadinessGates = {
  canonicalItemResolved: true,
  realizationResolved: true,
  resumeStateLoaded: true,
  mediaSurfaceEngaged: true,
  firstFrameEvidence: true,
};

describe("R24 startup law — the two-lane work taxonomy", () => {
  it("freezes the essential lane as the five-step canonical path", () => {
    expect(PLAYBACK_STARTUP_ESSENTIAL_WORK).toEqual([
      "resolve-canonical-item",
      "resolve-playback-realization",
      "load-resume-state",
      "engage-media-surface",
      "await-first-frame-evidence",
    ]);
  });

  it("freezes the deferred lane as exactly the R24-E nonessential set", () => {
    expect(PLAYBACK_STARTUP_DEFERRED_WORK).toEqual([
      "fetch-poster",
      "fetch-nonessential-metadata",
      "recommendation-enrichment",
      "ai-enrichment",
      "semantic-indexing",
      "analytics",
      "social-surface-enrichment",
    ]);
    // the two lanes partition the vocabulary with no overlap
    const overlap = PLAYBACK_STARTUP_DEFERRED_WORK.filter(isEssentialStartupWork);
    expect(overlap).toEqual([]);
    for (const work of PLAYBACK_STARTUP_WORK) {
      expect(isEssentialStartupWork(work) !== isDeferredStartupWork(work)).toBe(
        true,
      );
      expect(isPlaybackStartupWork(work)).toBe(true);
    }
    expect(isPlaybackStartupWork("load-recommendations-first")).toBe(false);
  });

  it("the recommendation/AI/analytics members are ALL deferred (the startup law)", () => {
    for (const work of [
      "recommendation-enrichment",
      "ai-enrichment",
      "semantic-indexing",
      "analytics",
      "fetch-poster",
      "fetch-nonessential-metadata",
      "social-surface-enrichment",
    ] as const) {
      expect(isDeferredStartupWork(work)).toBe(true);
      expect(isEssentialStartupWork(work)).toBe(false);
    }
  });
});

describe("R24 startup law — the plan sequencer + machine check", () => {
  it("plans the full work set into the two lawful lanes", () => {
    const plan = planPlaybackStartup(PLAYBACK_STARTUP_WORK);
    expect(startupLawViolations(plan)).toEqual([]);
    expect(plan.essential).toEqual(PLAYBACK_STARTUP_ESSENTIAL_WORK);
    expect(plan.deferred).toEqual(PLAYBACK_STARTUP_DEFERRED_WORK);
    expect(plan.unknown).toEqual([]);
  });

  it("CATCHES deferred work smuggled onto the awaited lane", () => {
    const plan: PlaybackStartupPlan = {
      essential: [
        "resolve-canonical-item",
        "resolve-playback-realization",
        "load-resume-state",
        "engage-media-surface",
        "recommendation-enrichment", // the smuggle: waiting on recommendations!
        "await-first-frame-evidence",
      ],
      deferred: PLAYBACK_STARTUP_DEFERRED_WORK,
      unknown: [],
    };
    const violations = startupLawViolations(plan);
    expect(
      violations.some((v) =>
        v.problem.includes('"recommendation-enrichment" is on the awaited'),
      ),
    ).toBe(true);
    // the essential-path check also fires (the canonical order changed)
    expect(
      violations.some((v) => v.problem.includes("canonical path")),
    ).toBe(true);
  });

  it("CATCHES an incomplete essential path (cannot reach first frame)", () => {
    const plan: PlaybackStartupPlan = {
      essential: PLAYBACK_STARTUP_ESSENTIAL_WORK.slice(0, 4),
      deferred: PLAYBACK_STARTUP_DEFERRED_WORK,
      unknown: [],
    };
    expect(startupLawViolations(plan).length).toBeGreaterThan(0);
    // also: essential work parked on the deferred lane
    const plan2: PlaybackStartupPlan = {
      essential: PLAYBACK_STARTUP_ESSENTIAL_WORK,
      deferred: [
        ...PLAYBACK_STARTUP_DEFERRED_WORK,
        "await-first-frame-evidence",
      ],
      unknown: [],
    };
    const violations = startupLawViolations(plan2);
    expect(
      violations.some((v) =>
        v.problem.includes("critical path is incomplete"),
      ),
    ).toBe(true);
  });

  it("CATCHES unknown and duplicated work", () => {
    const plan: PlaybackStartupPlan = {
      essential: [...PLAYBACK_STARTUP_ESSENTIAL_WORK, "await-first-frame-evidence"],
      deferred: PLAYBACK_STARTUP_DEFERRED_WORK,
      unknown: ["warm-the-recommendation-cache"],
    };
    const violations = startupLawViolations(plan);
    expect(violations.some((v) => v.problem.includes("unknown startup work"))).toBe(
      true,
    );
    expect(
      violations.some((v) => v.problem.includes("appears 2 times")),
    ).toBe(true);
  });
});

describe("R24 startup law — the readiness gates (enrichment cannot enter)", () => {
  it("starts only when every essential gate is open", () => {
    expect(resolvePlaybackStartEligibility(ALL_GATES)).toEqual({
      mayStart: true,
      blockedBy: [],
    });
    const missing = resolvePlaybackStartEligibility({
      ...ALL_GATES,
      realizationResolved: false,
      firstFrameEvidence: false,
    });
    expect(missing.mayStart).toBe(false);
    expect(missing.blockedBy).toEqual([
      "resolve-playback-realization",
      "await-first-frame-evidence",
    ]);
  });

  it("the seam keeps playback and enrichment in SEPARATE lanes", () => {
    // ALL enrichment pending — playback still starts (the contract)
    const view = renderPlaybackStartupSeam(
      ALL_GATES,
      Object.fromEntries(
        PLAYBACK_STARTUP_DEFERRED_WORK.map((work) => [work, "pending" as const]),
      ),
    );
    expect(view.playback.mayStart).toBe(true);
    expect(view.enrichment.state).toBe("pending");
    expect(view.enrichment.kinds).toEqual([...PLAYBACK_STARTUP_DEFERRED_WORK].sort());

    // enrichment failures are typed NONESSENTIAL — playback is unaffected
    const failing = renderPlaybackStartupSeam(
      ALL_GATES,
      {
        "recommendation-enrichment": "failed-nonessential",
        "ai-enrichment": "pending",
      },
    );
    expect(failing.playback.mayStart).toBe(true);
    expect(failing.enrichment.state).toBe("failed-nonessential");

    // everything ready
    const ready = renderPlaybackStartupSeam(ALL_GATES, {
      "recommendation-enrichment": "ready",
      analytics: "ready",
    });
    expect(ready.enrichment.state).toBe("ready");

    // essential gates missing — honest blocking (named, never silent)
    const blocked = renderPlaybackStartupSeam(
      { ...ALL_GATES, mediaSurfaceEngaged: false },
      {},
    );
    expect(blocked.playback.mayStart).toBe(false);
    expect(blocked.playback.blockedBy).toEqual(["engage-media-surface"]);
  });
});

describe("R24 autoplay — the attention-policy seam", () => {
  it("freezes the policy table for every attention mode", () => {
    expect(AUTOPLAY_POLICY.mindful.autoplay).toBe(false);
    expect(AUTOPLAY_POLICY.mindful.upNextAffordance).toBe(true);
    expect(AUTOPLAY_POLICY.balanced.autoplay).toBe(true);
    expect(AUTOPLAY_POLICY.immersive.autoplay).toBe(true);
    expect(AUTOPLAY_POLICY.custom.autoplay).toBe("follows-user-dial");
    for (const mode of ["mindful", "balanced", "immersive", "custom"] as const) {
      expect(AUTOPLAY_POLICY[mode].rationale.length).toBeGreaterThan(0);
    }
  });

  it("decides per mode after playback ends", () => {
    const base = {
      customAutoplayEnabled: true,
      hasNextContent: true,
      viewerIsAnonymous: true,
      playbackEnded: true,
    };
    expect(resolveAutoplayDecision({ ...base, attentionMode: "mindful" }).autoplay).toBe(false);
    expect(resolveAutoplayDecision({ ...base, attentionMode: "balanced" }).autoplay).toBe(true);
    expect(resolveAutoplayDecision({ ...base, attentionMode: "immersive" }).autoplay).toBe(true);
    expect(resolveAutoplayDecision({ ...base, attentionMode: "custom" }).autoplay).toBe(true);
    expect(
      resolveAutoplayDecision({ ...base, attentionMode: "custom", customAutoplayEnabled: false })
        .autoplay,
    ).toBe(false);
    // Mindful still OFFERS the next item (the quiet alternative)
    expect(
      resolveAutoplayDecision({ ...base, attentionMode: "mindful" }).upNextAffordance,
    ).toBe(true);
  });

  it("never fires mid-playback (autoplay cannot gate startup)", () => {
    for (const mode of ["mindful", "balanced", "immersive", "custom"] as const) {
      const mid = resolveAutoplayDecision({
        attentionMode: mode,
        customAutoplayEnabled: true,
        hasNextContent: true,
        viewerIsAnonymous: true,
        playbackEnded: false,
      });
      expect(mid.autoplay).toBe(false);
      expect(mid.upNextAffordance).toBe(false);
    }
  });

  it("stops honestly without next content", () => {
    const decision = resolveAutoplayDecision({
      attentionMode: "immersive",
      customAutoplayEnabled: true,
      hasNextContent: false,
      viewerIsAnonymous: true,
      playbackEnded: true,
    });
    expect(decision.autoplay).toBe(false);
    expect(decision.reason).toContain("no next content");
  });

  it("is IDENTICAL for anonymous and authenticated viewers (no login dependency)", () => {
    for (const mode of ["mindful", "balanced", "immersive", "custom"] as const) {
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
      expect(anonymous.autoplay).toBe(authenticated.autoplay);
      expect(anonymous.upNextAffordance).toBe(authenticated.upNextAffordance);
      expect(anonymous.reason).toBe(authenticated.reason);
    }
  });
});

describe("R24 parity regression — the aggregate invariants", () => {
  it("passes every shared-lane invariant in one callable", () => {
    const report = checkParityRegressionInvariants();
    expect(report.taxonomy.ok).toBe(true);
    expect(report.placement.ok).toBe(true);
    expect(report.startupLaw.violations).toEqual([]);
    expect(report.startupLaw.ok).toBe(true);
    expect(report.autoplayLaw.problems).toEqual([]);
    expect(report.autoplayLaw.ok).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("folds the frozen performance thresholds into the report (no silent loosening)", () => {
    const report = checkParityRegressionInvariants();
    expect(report.thresholds.ttffP50MaxDeltaMs).toBe(150);
    expect(report.thresholds.ttffP75MaxDeltaMs).toBe(300);
    expect(report.thresholds.ttffP95MaxDeltaMs).toBe(750);
    expect(report.thresholds.startupFailureRateMaxDeltaPp).toBe(0.5);
    expect(report.thresholds.first60sRebufferRatioMaxDeltaPp).toBe(0.25);
  });

  it("carries the taxonomy + placement reports (65 rows / 65 records)", () => {
    const report = checkParityRegressionInvariants();
    expect(report.taxonomy.rowCount).toBe(65);
    expect(report.placement.recordCount).toBe(65);
  });
});
