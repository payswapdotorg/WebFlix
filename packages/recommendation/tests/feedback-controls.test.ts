/**
 * R05 — recommendation controls: the J15/J16/J18 behavioral evidence.
 *
 * - J15 FEEDBACK CONTROLS: `not-interested` demotes (never removes);
 *   `dont-recommend-source`/`dont-recommend-creator` exclude WITH honest
 *   notes (never silent gaps, never errors); `already-watched` deprioritizes
 *   repeats without touching history; `more-like-this` boosts similarity
 *   neighborhoods; THE REVERSIBILITY LAW — control applied → composition
 *   changes → control removed → composition restores byte-for-byte.
 * - J16 ANTI-TUNNEL: concentrated watch history + a mixed pool → the
 *   composed top block carries the diversity floor (a second distinct
 *   objective surfaces) unless the user explicitly narrowed with a
 *   persistent intent (then the narrowing wins, honestly traced).
 * - J18 ATTENTION MODES: mindful ≠ immersive in measurable output (dial
 *   floors, default time budget, chain caps); the heuristic's exploration/
 *   novelty terms read the attention-adjusted dials; no mode silently
 *   optimizes for maximum session length.
 *
 * Deterministic: seeded fixture pools, fixed timestamps, no network.
 */

import { describe, expect, it } from "bun:test";

import {
  applyFeedback,
  attentionAdjustedDials,
  attentionConstraints,
  MINDFUL_DEFAULT_MAX_SESSION_EXTENSION_MINUTES,
  MINDFUL_EXPLORATION_FLOOR,
  MINDFUL_NOVELTY_FLOOR,
  DIVERSITY_FLOOR_MIN_DISTINCT,
  DIVERSITY_TOP_BLOCK_SIZE,
  effectiveDiversityRunCap,
  FEEDBACK_KIND_TARGETS,
  FEEDBACK_MORE_LIKE_THIS_BOOST,
  RecommendationOSError,
  runRecommendation,
  type RecommendationFeedback,
  type RecommendationContext,
} from "../src/index";

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  RecommendationPolicy,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// Helpers (hand-authored deterministic fixtures — no retrieval dependency)
// ---------------------------------------------------------------------------

const USER = "wfxusr_01ARZ3NDEKF1XTVRE00000000";
const SESSION = "wfxsess_01ARZ3NDEKF1XTVRE0000000";
const T0 = "2026-09-16T12:00:00.000Z";
const T_MINUS_1H = "2026-09-16T11:00:00.000Z";

/** Canonical-shaped hand-authored item id: wfxitm_ + 26-char ULID body. */
function cid(n: number): string {
  return `wfxitm_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`;
}

/** A hand-built candidate. */
function candidate(over: {
  itemId: string;
  title: string;
  durationMs?: number;
  connectorId?: string;
  creatorId?: string;
  publishedAt?: string;
}): EntertainmentCandidate {
  return {
    itemId: over.itemId,
    realization: {
      connectorId: over.connectorId ?? "wfx-test-native",
      externalRef: `ref-${over.itemId.slice(-4)}`,
      capabilities: ["identity", "catalogSearch", "metadata", "playNative", "playEmbed", "availability"],
      availability: "available",
    },
    features: {
      canonicalType: "video",
      canonicalTitle: over.title,
      matchText: over.title.toLowerCase(),
      ...(over.durationMs !== undefined ? { durationMs: over.durationMs } : {}),
      ...(over.creatorId !== undefined ? { creatorId: over.creatorId } : {}),
      ...(over.publishedAt !== undefined ? { publishedAt: over.publishedAt } : {}),
    },
  };
}

/** A policy literal. */
function policy(over: Partial<RecommendationPolicy> = {}): RecommendationPolicy {
  return {
    id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
    userId: USER,
    objectives: [],
    exploration: 0.2,
    novelty: 0.2,
    socialInfluence: 0.1,
    attentionMode: "balanced",
    ...over,
  };
}

/** An event literal. */
function event(itemId: string, type: EntertainmentEvent["type"], occurredAt: string): EntertainmentEvent {
  return { userId: USER, itemId, type, occurredAt, sessionId: SESSION };
}

/** One feedback record literal. */
function feedback(
  kind: RecommendationFeedback["kind"],
  targetId: string,
  n: number,
): RecommendationFeedback {
  return {
    id: `wfxfeed_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`,
    kind,
    targetType: FEEDBACK_KIND_TARGETS[kind],
    targetId,
    createdAt: T0,
  };
}

/** A mixed watch pool: science fiction dominates by count + freshness. */
function mixedWatchPool(): EntertainmentCandidate[] {
  return [
    candidate({ itemId: cid(1), title: "Science Fiction Epic 1", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(2), title: "Science Fiction Epic 2", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(3), title: "Science Fiction Epic 3", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(4), title: "Science Fiction Epic 4", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(5), title: "Science Fiction Epic 5", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(6), title: "Science Fiction Epic 6", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(7), title: "Science Fiction Epic 7", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(8), title: "Science Fiction Epic 8", durationMs: 7_200_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(9), title: "Comedy Special", durationMs: 3_600_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(10), title: "History Documentary", durationMs: 5_400_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(11), title: "Fitness Routine", durationMs: 300_000, publishedAt: T_MINUS_1H }),
    candidate({ itemId: cid(12), title: "Travel Guide", durationMs: 2_700_000, publishedAt: T_MINUS_1H }),
  ];
}

/** The ctx skeleton. */
function ctx(
  over: Partial<RecommendationContext> & { candidatePool: EntertainmentCandidate[] },
): RecommendationContext {
  return {
    userId: USER,
    sessionId: SESSION,
    surface: "watch",
    intents: [
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE0000000082",
        userId: USER,
        scope: "persistent",
        objective: "science fiction epics",
        weight: 0.8,
        confidence: 0.9,
        provenance: "explicit",
      },
    ],
    policy: policy(),
    recentEvents: [],
    ...over,
  };
}

/** Every trace decision of a page, flattened. */
function allDecisions(page: { trace: { stages: readonly { decisions: readonly { kind: string; detail: string; itemIds: readonly string[] }[] }[] } }) {
  return page.trace.stages.flatMap((stage) => stage.decisions);
}

/** The composed feed's item ids. */
function feedIds(page: { cards: readonly { candidate: { itemId: string } }[] }): string[] {
  return page.cards.map((card) => card.candidate.itemId);
}

// ---------------------------------------------------------------------------
// J15 — the feedback controls
// ---------------------------------------------------------------------------

describe("R05 — J15 feedback controls (demote, exclude, boost — all reversible)", () => {
  it("not-interested DEMOTES the item to the very tail — never removes it", async () => {
    const pool = mixedWatchPool();
    const base = ctx({ candidatePool: pool });
    const page = await runRecommendation(base, {
      feedback: [feedback("not-interested", cid(1), 1)],
    });
    const ids = feedIds(page);
    // Still present (the pool-stays-wide law)...
    expect(ids).toContain(cid(1));
    // ...but at the very tail.
    expect(ids[ids.length - 1]).toBe(cid(1));
    // The demotion is traced honestly.
    const demotions = allDecisions(page).filter((d) => d.kind === "feedback-not-interested");
    expect(demotions.length).toBe(1);
    expect(demotions[0]!.itemIds).toEqual([cid(1)]);
    expect(demotions[0]!.detail).toContain("never removed");
  });

  it("already-watched DEPRIORITIZES repeats below the availability tail, without removing them", async () => {
    const pool = mixedWatchPool();
    const page = await runRecommendation(ctx({ candidatePool: pool }), {
      feedback: [feedback("already-watched", cid(2), 2)],
    });
    const ids = feedIds(page);
    expect(ids).toContain(cid(2));
    expect(ids[ids.length - 1]).toBe(cid(2));
    const demotions = allDecisions(page).filter((d) => d.kind === "feedback-already-watched");
    expect(demotions.length).toBe(1);
    expect(demotions[0]!.detail).toContain("recorded history is never touched");
  });

  it("not-interested tails BELOW already-watched (the stricter control goes last)", async () => {
    const pool = mixedWatchPool();
    const page = await runRecommendation(ctx({ candidatePool: pool }), {
      feedback: [feedback("already-watched", cid(3), 3), feedback("not-interested", cid(4), 4)],
    });
    const ids = feedIds(page);
    expect(ids[ids.length - 1]).toBe(cid(4)); // not-interested at the very tail
    expect(ids[ids.length - 2]).toBe(cid(3)); // already-watched above it
  });

  it("dont-recommend-source EXCLUDES the source's realizations WITH the honest note (never silent, never an error)", async () => {
    const pool = mixedWatchPool().map((item, index) =>
      index % 2 === 0 ? { ...item, realization: { ...item.realization, connectorId: "wfx-youtube" } } : item,
    );
    const page = await runRecommendation(ctx({ candidatePool: pool }), {
      feedback: [feedback("dont-recommend-source", "wfx-youtube", 5)],
    });
    const ids = new Set(feedIds(page));
    // Every youtube-realized item is gone from the composed feed...
    for (const [index, item] of pool.entries()) {
      if (index % 2 === 0) expect(ids.has(item.itemId)).toBe(false);
      else expect(ids.has(item.itemId)).toBe(true);
    }
    // ...and the exclusion carries the HONEST NOTE naming the control.
    const notes = allDecisions(page).filter((d) => d.kind === "feedback-suppression");
    expect(notes.length).toBe(1);
    expect(notes[0]!.detail).toContain("wfx-youtube");
    expect(notes[0]!.detail).toContain("dont-recommend-source");
    expect(notes[0]!.itemIds.length).toBe(6);
    expect(notes[0]!.detail).toContain("delete the control to restore");
  });

  it("source suppression is REALIZATION-level: an item realized by a non-suppressed source still surfaces", async () => {
    const item = candidate({ itemId: cid(20), title: "Science Fiction Epic 20", durationMs: 7_200_000 });
    const fromYoutube = {
      ...item,
      realization: { ...item.realization, connectorId: "wfx-youtube" },
    };
    const fromNative = { ...item, realization: { ...item.realization, connectorId: "wfx-test-native" } };
    const pool = [fromYoutube, fromNative, ...mixedWatchPool()];
    const page = await runRecommendation(ctx({ candidatePool: pool }), {
      feedback: [feedback("dont-recommend-source", "wfx-youtube", 6)],
    });
    // The item survives via its non-suppressed realization and is NOT a duplicate.
    expect(feedIds(page).filter((id) => id === cid(20)).length).toBe(1);
  });

  it("dont-recommend-creator EXCLUDES the creator's candidates with the honest note (creatorId feature)", async () => {
    const pool = mixedWatchPool().map((item, index) =>
      index < 4 ? { ...item, features: { ...item.features, creatorId: "creator-alpha" } } : item,
    );
    const page = await runRecommendation(ctx({ candidatePool: pool }), {
      feedback: [feedback("dont-recommend-creator", "creator-alpha", 7)],
    });
    const ids = new Set(feedIds(page));
    for (const [index, item] of pool.entries()) {
      if (index < 4) expect(ids.has(item.itemId)).toBe(false);
    }
    const notes = allDecisions(page).filter((d) => d.kind === "feedback-suppression");
    expect(notes.length).toBe(1);
    expect(notes[0]!.detail).toContain("creator-alpha");
    expect(notes[0]!.detail).toContain("dont-recommend-creator");
  });

  it("more-like-this BOOSTS the anchor's similarity neighborhood (token overlap), not the anchor", async () => {
    const pool = [
      ...mixedWatchPool(),
      candidate({ itemId: cid(15), title: "Late Night Standup Comedy", durationMs: 3_600_000 }), // shares "comedy"
    ];
    const page = await runRecommendation(ctx({ candidatePool: pool }), {
      feedback: [feedback("more-like-this", cid(9), 8)], // the Comedy Special
    });
    // The comedy-neighborhood item rises ABOVE the sci tail: the boost is
    // visible in the composed order, not just the trace.
    const ids = feedIds(page);
    expect(ids.indexOf(cid(15))).toBeLessThan(ids.indexOf(cid(11))); // comedy-adjacent above fitness
    const boosts = allDecisions(page).filter((d) => d.kind === "feedback-boost");
    expect(boosts.length).toBeGreaterThanOrEqual(2); // the neighborhood + the anchor note
    const neighborhood = boosts.find((d) => d.detail.startsWith("more-like-this: shares"));
    expect(neighborhood).toBeDefined();
    expect(neighborhood!.itemIds).toEqual([cid(15)]);
    expect(neighborhood!.detail).toContain(FEEDBACK_MORE_LIKE_THIS_BOOST.toFixed(2));
  });

  it("THE REVERSIBILITY LAW: control applied -> composition changes; control removed -> composition RESTORES byte-for-byte", async () => {
    const pool = mixedWatchPool();
    const base = ctx({ candidatePool: pool });
    const without = await runRecommendation(base); // no feedback
    const withControl = await runRecommendation(base, {
      feedback: [feedback("not-interested", cid(1), 1)],
    });
    // Applying changes the composition...
    expect(feedIds(withControl)).not.toEqual(feedIds(without));
    // ...and the empty feedback set restores the pre-control order EXACTLY
    // (the same cards in the same positions — the control was the only delta).
    const restored = await runRecommendation(base, { feedback: [] });
    expect(feedIds(restored)).toEqual(feedIds(without));
    expect(restored.cards.map((card) => card.position)).toEqual(
      without.cards.map((card) => card.position),
    );
  });

  it("structural garbage in the feedback set throws the typed error naming every problem", () => {
    const pool = mixedWatchPool();
    const garbage = [
      { id: "", kind: "not-interested", targetType: "item", targetId: cid(1), createdAt: T0 }, // empty id
      feedback("not-interested", cid(2), 2),
      feedback("not-interested", cid(2), 2), // duplicate id
      { id: "wfxfeed_x", kind: "banish-forever", targetType: "item", targetId: "x", createdAt: T0 }, // unknown kind
    ];
    let caught: unknown;
    try {
      applyFeedback(
        [{ candidate: pool[0]!, features: {} as never, modelScore: 1, confidence: 1, explanations: [], availabilityDemoted: false, feedbackAdjustment: 0, feedbackDemoted: null }],
        garbage as unknown as readonly RecommendationFeedback[],
      );
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(RecommendationOSError);
    expect((caught as RecommendationOSError).kind).toBe("invalid-input");
    expect((caught as RecommendationOSError).details.join("\n")).toContain("kind");
  });
});

// ---------------------------------------------------------------------------
// J16 — the anti-tunnel diversity floor
// ---------------------------------------------------------------------------

describe("R05 — J16 anti-tunnel: the diversity floor survives concentrated watching", () => {
  /**
   * The deterministic tunnel model: science-fiction titles score 10, every
   * other item 1 — a model that single-mindedly favors the concentrated
   * topic. (Model injection is the frozen seam; the floor must hold for ANY
   * model, so the worst case is the honest test case.)
   */
  const tunnelModel = {
    id: "wfx-tunnel-stub",
    version: "1.0.0",
    async score(runCtx: RecommendationContext) {
      return runCtx.candidatePool.map((c) => ({
        itemId: c.itemId,
        score: String(c.features.canonicalTitle ?? "").startsWith("Science Fiction") ? 10 : 1,
        explanations: [],
        confidence: 1,
      }));
    },
  };

  /** The inferred intents concentrated watching accumulates (NOT explicit asks). */
  function inferredIntents() {
    return [
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE0000000082",
        userId: USER,
        scope: "persistent" as const,
        objective: "science fiction epics",
        weight: 0.9,
        confidence: 0.9,
        provenance: "inferred" as const,
      },
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE0000000083",
        userId: USER,
        scope: "persistent" as const,
        objective: "standup comedy",
        weight: 0.5,
        confidence: 0.5,
        provenance: "inferred" as const,
      },
    ];
  }

  /** Concentrated watch history: the user completed EVERYTHING, sci first. */
  function concentratedHistory(): EntertainmentEvent[] {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) =>
      event(cid(n), "complete", T_MINUS_1H),
    );
  }

  /** The tunnel ctx: everything watched, the topic model dominant, exploration off. */
  function tunnelCtx(over: Partial<RecommendationContext> = {}): RecommendationContext {
    return ctx({
      candidatePool: mixedWatchPool(),
      intents: inferredIntents(),
      recentEvents: concentratedHistory(),
      policy: policy({ exploration: 0 }),
      ...over,
    });
  }

  it("the DIVERSITY FLOOR GUARANTEE: concentrated watching does not collapse the top block (deterministic, traced)", async () => {
    const page = await runRecommendation(tunnelCtx(), { model: tunnelModel });

    const topBlock = page.cards.slice(0, Math.min(DIVERSITY_TOP_BLOCK_SIZE, page.cards.length));
    const distinct = new Set(
      topBlock.map((card) => card.dominantObjective).filter((objective) => objective !== null),
    );
    // THE J16 GUARANTEE: the concentrated topic (a tunnel-biased model, a
    // concentrated history, exploration dial 0, INFERRED intents) did NOT
    // collapse the block — at least two distinct objectives surface.
    expect(distinct.size).toBeGreaterThanOrEqual(DIVERSITY_FLOOR_MIN_DISTINCT);
    // The delivering mechanisms are traced: the run cap broke the sci run,
    // and the exploration injection recorded its honest residual (everything
    // is watched — no unseen candidates left to inject). The diversity floor
    // (the named guarantee) holds the invariant as the backstop.
    expect(allDecisions(page).some((d) => d.kind === "objective-run-break")).toBe(true);
    expect(allDecisions(page).some((d) => d.kind === "exploration-injection-unsatisfied")).toBe(true);
    // And no narrowing fired: the inferred intents are NOT an explicit ask.
    expect(
      allDecisions(page).some((d) => d.detail.includes("the explicit narrowing wins")),
    ).toBe(false);
  });

  it("the floor YIELDS to an explicit persistent narrowing (the user's standing ask wins, observably and honestly traced)", async () => {
    const explicitNarrowing = inferredIntents().map((intent) =>
      intent.objective === "science fiction epics" ? { ...intent, provenance: "explicit" as const } : intent,
    );
    const page = await runRecommendation(tunnelCtx({ intents: explicitNarrowing }), {
      model: tunnelModel,
    });

    // OBSERVABLE: the narrowing wins — the composed top block concentrates
    // on the narrowed objective (the run cap, the injection, and the floor
    // all yielded to the user's standing ask).
    const topBlock = page.cards.slice(0, Math.min(DIVERSITY_TOP_BLOCK_SIZE, page.cards.length));
    const distinct = new Set(
      topBlock.map((card) => card.dominantObjective).filter((objective) => objective !== null),
    );
    expect(distinct.size).toBe(1);
    expect([...distinct][0]).toBe("science fiction epics");

    // HONEST: exactly ONE yield note, naming the mechanism.
    const yields = allDecisions(page).filter(
      (d) => d.kind === "diversity-floor" && d.detail.includes("the explicit narrowing wins"),
    );
    expect(yields.length).toBe(1);
    expect(yields[0]!.detail).toContain("science fiction epics");
    // The run cap did NOT fight the narrowing (no run breaks on the record).
    expect(allDecisions(page).some((d) => d.kind === "objective-run-break")).toBe(false);
  });

  it("session/temporary intents do NOT narrow (only an explicit persistent ask does)", async () => {
    const sessionIntents = inferredIntents().map((intent) =>
      intent.objective === "science fiction epics"
        ? { ...intent, scope: "session" as const, provenance: "explicit" as const }
        : intent,
    );
    const page = await runRecommendation(tunnelCtx({ intents: sessionIntents }), {
      model: tunnelModel,
    });
    // The floor did NOT yield: a second objective is in the top block.
    const topBlock = page.cards.slice(0, Math.min(DIVERSITY_TOP_BLOCK_SIZE, page.cards.length));
    const distinct = new Set(
      topBlock.map((card) => card.dominantObjective).filter((objective) => objective !== null),
    );
    expect(distinct.size).toBeGreaterThanOrEqual(DIVERSITY_FLOOR_MIN_DISTINCT);
    expect(
      allDecisions(page).some((d) => d.detail.includes("the explicit narrowing wins")),
    ).toBe(false);
  });

  it("the floor's honest residual: a single-objective pool records the unsatisfiable note (never a fake success)", async () => {
    const sciOnly = Array.from({ length: 6 }, (_, n) =>
      candidate({ itemId: cid(100 + n), title: `Science Fiction Epic ${100 + n}`, durationMs: 7_200_000 }),
    );
    const page = await runRecommendation(
      ctx({
        candidatePool: sciOnly,
        intents: inferredIntents().slice(0, 1),
        policy: policy({ exploration: 0 }),
      }),
      { model: tunnelModel },
    );
    const residual = allDecisions(page).filter((d) => d.kind === "diversity-floor-unsatisfiable");
    expect(residual.length).toBeGreaterThanOrEqual(1);
    expect(residual[0]!.detail).toContain("recorded honestly");
  });

  it("the pre-R05 exploration-injection path still works alongside the floor (unseen alternatives)", async () => {
    // Nothing watched: the injection mechanism (unseen candidates) is the
    // anti-tunnel path that fires — the floor is its backstop, not its
    // replacement.
    const page = await runRecommendation(
      tunnelCtx({ recentEvents: [] }),
      { model: tunnelModel },
    );
    expect(allDecisions(page).some((d) => d.kind === "exploration-injection")).toBe(true);
    const topBlock = page.cards.slice(0, Math.min(DIVERSITY_TOP_BLOCK_SIZE, page.cards.length));
    const distinct = new Set(
      topBlock.map((card) => card.dominantObjective).filter((objective) => objective !== null),
    );
    expect(distinct.size).toBeGreaterThanOrEqual(DIVERSITY_FLOOR_MIN_DISTINCT);
  });
});

// ---------------------------------------------------------------------------
// J18 — attention modes change measurable behavior
// ---------------------------------------------------------------------------

describe("R05 — J18 attention modes (mindful != immersive in measurable output)", () => {
  it("mindful floors the exploration/novelty dials; the other modes pass them through EXACTLY", () => {
    const lowDials = policy({ attentionMode: "mindful", exploration: 0.1, novelty: 0.1 });
    const adjusted = attentionAdjustedDials(lowDials);
    expect(adjusted.exploration).toBe(MINDFUL_EXPLORATION_FLOOR); // 0.6
    expect(adjusted.novelty).toBe(MINDFUL_NOVELTY_FLOOR); // 0.6

    // A higher user dial always wins over the floor.
    expect(attentionAdjustedDials(policy({ attentionMode: "mindful", exploration: 0.9, novelty: 0.9 })).exploration).toBe(0.9);

    for (const mode of ["balanced", "immersive", "custom"] as const) {
      const dials = attentionAdjustedDials(policy({ attentionMode: mode, exploration: 0.1, novelty: 0.25 }));
      expect(dials.exploration).toBe(0.1);
      expect(dials.novelty).toBe(0.25);
    }
  });

  it("mindful carries the DEFAULT session-extension time budget; immersive does not", () => {
    const mindful = attentionConstraints(policy({ attentionMode: "mindful" }));
    const immersive = attentionConstraints(policy({ attentionMode: "immersive" }));
    expect(mindful.maxSessionExtensionMinutes).toBe(MINDFUL_DEFAULT_MAX_SESSION_EXTENSION_MINUTES);
    expect(immersive.maxSessionExtensionMinutes).toBeNull();
    // An explicit user value always wins in every mode.
    expect(
      attentionConstraints(policy({ attentionMode: "mindful", maxSessionExtensionMinutes: 15 }))
        .maxSessionExtensionMinutes,
    ).toBe(15);
  });

  it("the effective diversity run cap reads the adjusted dial (mindful's floor tightens K)", () => {
    // exploration 0.2 raw -> K=4 balanced; mindful floors to 0.6 -> K=2.
    expect(effectiveDiversityRunCap(policy({ attentionMode: "balanced", exploration: 0.2 }))).toBe(4);
    expect(effectiveDiversityRunCap(policy({ attentionMode: "mindful", exploration: 0.2 }))).toBe(2);
  });

  it("the heuristic model's explanations carry the attention-adjusted dials in mindful mode", async () => {
    const pool = mixedWatchPool();
    const mindfulPage = await runRecommendation(ctx({ candidatePool: pool, intents: [] }), {
      // A temporary exploration window, not a persistent narrowing.
      // (No feedback — we assert the scoring explanations.)
    });
    // Balanced: the raw dials appear verbatim.
    const balancedExplanations = mindfulPage.cards.flatMap((card) => card.explanations);
    expect(balancedExplanations.some((line) => line.includes("exploration 0.2"))).toBe(true);

    const mindfulPage2 = await runRecommendation(
      ctx({ candidatePool: pool, intents: [], policy: policy({ attentionMode: "mindful" }) }),
    );
    const mindfulExplanations = mindfulPage2.cards.flatMap((card) => card.explanations);
    expect(mindfulExplanations.some((line) => line.includes("exploration 0.6"))).toBe(true);
    expect(
      mindfulExplanations.some((line) => line.includes('attention-adjusted from 0.2 for mode "mindful"')),
    ).toBe(true);
  });

  it("mindful != immersive in the COMPOSED FEED (same dials, different behavior)", async () => {
    const pool = [
      // A chain: episodes 2 and 3 continue watched episode 1 (30 min each).
      candidate({ itemId: cid(31), title: "Science Fiction Series 1x02", durationMs: 1_800_000, creatorId: "creator-beta" }),
      candidate({ itemId: cid(32), title: "Science Fiction Series 1x03", durationMs: 1_800_000, creatorId: "creator-beta" }),
      candidate({ itemId: cid(33), title: "Science Fiction Series 1x04", durationMs: 1_800_000, creatorId: "creator-beta" }),
      candidate({ itemId: cid(34), title: "Science Fiction Series 1x05", durationMs: 1_800_000, creatorId: "creator-beta" }),
      candidate({ itemId: cid(35), title: "Comedy Special", durationMs: 3_600_000 }),
      candidate({ itemId: cid(36), title: "Fitness Routine", durationMs: 300_000 }),
    ];
    const ep1 = cid(30);
    const events = [event(ep1, "complete", T_MINUS_1H)];
    const poolWithChain = pool.map((item, index) =>
      index === 0
        ? { ...item, features: { ...item.features, nextEpisodeOf: ep1 } }
        : index === 1
          ? { ...item, features: { ...item.features, nextEpisodeOf: cid(31) } }
          : index === 2
            ? { ...item, features: { ...item.features, nextEpisodeOf: cid(32) } }
            : index === 3
              ? { ...item, features: { ...item.features, nextEpisodeOf: cid(33) } }
              : item,
    );

    const mindful = await runRecommendation(
      ctx({
        candidatePool: poolWithChain,
        intents: [],
        recentEvents: events,
        policy: policy({ attentionMode: "mindful" }),
      }),
    );
    const immersive = await runRecommendation(
      ctx({
        candidatePool: poolWithChain,
        intents: [],
        recentEvents: events,
        policy: policy({ attentionMode: "immersive" }),
      }),
    );

    // Same membership (nothing is ever removed in any mode)...
    expect(new Set(feedIds(mindful))).toEqual(new Set(feedIds(immersive)));
    // ...but DIFFERENT order: the composed feeds are measurably different.
    expect(feedIds(mindful)).not.toEqual(feedIds(immersive));

    // The mindful attention-policy decision declares its derived constraints.
    const declared = allDecisions(mindful).find((d) => d.kind === "attention-policy");
    expect(declared).toBeDefined();
    expect(declared!.detail).toContain("mindful");
    expect(declared!.detail).toContain(`${MINDFUL_DEFAULT_MAX_SESSION_EXTENSION_MINUTES}`);
  });

  it("no mode silently optimizes for maximum session length: immersive chains remain the USER'S explicit choice (declared, unhidden)", async () => {
    const pool = mixedWatchPool();
    for (const mode of ["mindful", "balanced", "immersive", "custom"] as const) {
      const page = await runRecommendation(
        ctx({ candidatePool: pool, intents: [], policy: policy({ attentionMode: mode }) }),
      );
      const declared = allDecisions(page).find((d) => d.kind === "attention-policy");
      expect(declared).toBeDefined();
      expect(declared!.detail).toContain(mode);
      // Membership is preserved in every mode.
      expect(new Set(feedIds(page)).size).toBe(new Set(pool.map((c) => c.itemId)).size);
    }
  });
});

// ---------------------------------------------------------------------------
// The feedback stage's own seams (pure-function law)
// ---------------------------------------------------------------------------

describe("R05 — the feedback stage is a pure function of its inputs", () => {
  it("an empty feedback set is a byte-identical no-op (same ranked order, one empty stage row)", async () => {
    const pool = mixedWatchPool();
    const base = ctx({ candidatePool: pool });
    const none = await runRecommendation(base);
    const empty = await runRecommendation(base, { feedback: [] });
    expect(feedIds(empty)).toEqual(feedIds(none));
  });

  it("deterministic: identical (ctx, feedback) yields identical output, trace included", async () => {
    const pool = mixedWatchPool();
    const base = ctx({ candidatePool: pool });
    const controls = [feedback("not-interested", cid(1), 1), feedback("more-like-this", cid(9), 9)];
    const first = await runRecommendation(base, { feedback: controls });
    const second = await runRecommendation(base, { feedback: controls });
    expect(JSON.stringify(feedIds(first))).toBe(JSON.stringify(feedIds(second)));
    expect(JSON.stringify(allDecisions(first).map((d) => d.detail))).toBe(
      JSON.stringify(allDecisions(second).map((d) => d.detail)),
    );
  });
});
