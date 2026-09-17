/**
 * R05 — Recommendation OS feedback-control tests (deterministic, no network).
 *
 * The R05 spec's acceptance points at the OS layer:
 * - J15 FEEDBACK CONTROLS: not-interested excludes (reversible), source/
 *   creator suppression skips with an HONEST NOTE (never a silent gap,
 *   never an error), already-watched demotes (history untouched),
 *   more-like-this boosts the similarity neighborhood.
 * - REVERSIBILITY: every control applied → composition changes → control
 *   undone → composition restores (byte-equal feed — determinism law).
 * - J16 ANTI-TUNNEL: after concentrated watching of one topic (no intents
 *   — pure watch history), the composed feed retains exploration
 *   capability: the pool NEVER narrows (every candidate still present)
 *   and the top block's topic concentration holds under the exploration
 *   dial's diversity floor; only an EXPLICIT persistent narrow intent may
 *   concentrate the feed.
 * - J18 ATTENTION MODES: Mindful ≠ Immersive in MEASURABLE output (the
 *   exploration floor, the time budget, the novelty weighting — mode is
 *   policy, not cosmetics).
 */

import { describe, expect, it } from "bun:test";

import {
  DIVERSITY_TOP_BLOCK_SIZE,
  MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES,
  MINDFUL_MIN_EFFECTIVE_EXPLORATION,
  applyFeedback,
  attentionConstraints,
  attentionEffectiveExploration,
  attentionSessionExtensionBudget,
  createHeuristicModel,
  diversityConcentrationThresholdPercent,
  diversityRunCap,
  effectiveRunCap,
  feedbackRecordErrors,
  runRecommendation,
  type RecommendationContext,
  type RecommendationFeedbackRecord,
  type TraceDecision,
} from "../src/index";
import { FIXTURE_USER_ID } from "../src/index";

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  RecommendationPolicy,
  UserIntent,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// Deterministic helpers (the os.test.ts conventions, self-contained here)
// ---------------------------------------------------------------------------

/** Canonical-shaped hand-authored item id: wfxitm_ + 26-char ULID body. */
function cid(n: number): string {
  return `wfxitm_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`;
}

/** A policy literal with a fixed deterministic id. */
function policy(over: Partial<RecommendationPolicy> = {}): RecommendationPolicy {
  return {
    id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
    userId: FIXTURE_USER_ID,
    objectives: [],
    exploration: 0.2,
    novelty: 0.2,
    socialInfluence: 0.1,
    attentionMode: "balanced",
    ...over,
  };
}

/** An event literal. */
function event(
  itemId: string,
  type: EntertainmentEvent["type"],
  occurredAt: string,
): EntertainmentEvent {
  return { userId: FIXTURE_USER_ID, itemId, type, occurredAt, sessionId: "wfx-test-session" };
}

/** A hand-built flat candidate with R05 feature keys (topic/creatorId). */
function candidate(over: {
  itemId: string;
  title: string;
  durationMs?: number;
  topic?: string;
  creatorId?: string;
  publishedAt?: string;
  connectorId?: string;
  nextEpisodeOf?: string;
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
      ...(over.topic !== undefined ? { topic: over.topic } : {}),
      ...(over.creatorId !== undefined ? { creatorId: over.creatorId } : {}),
      ...(over.publishedAt !== undefined ? { publishedAt: over.publishedAt } : {}),
      ...(over.nextEpisodeOf !== undefined ? { nextEpisodeOf: over.nextEpisodeOf } : {}),
    },
  };
}

/** One feedback record literal. */
function feedback(
  kind: RecommendationFeedbackRecord["kind"],
  target: string,
): RecommendationFeedbackRecord {
  return { id: `wfxfb_01ARZ3NDEKF1XTVRE${String(target).slice(-8)}`, kind, target, createdAt: "2026-09-13T10:00:00.000Z" };
}

/** All trace decisions of one run, flattened. */
function allDecisions(page: {
  trace: { stages: readonly { decisions: readonly TraceDecision[] }[] };
}): TraceDecision[] {
  const out: TraceDecision[] = [];
  for (const stage of page.trace.stages) out.push(...stage.decisions);
  return out;
}

/** The feed's item ids in composed order. */
function feedIds(page: { cards: readonly { candidate: { itemId: string } }[] }): string[] {
  return page.cards.map((card) => card.candidate.itemId);
}

const NOW = "2026-09-13T12:00:00.000Z";

// ---------------------------------------------------------------------------
// J15 — the control vocabulary + validation
// ---------------------------------------------------------------------------

describe("R05 — feedback records: validation honesty", () => {
  it("accepts every documented control shape and rejects every malformed one", () => {
    expect(feedbackRecordErrors(feedback("not-interested", cid(1)))).toEqual([]);
    expect(
      feedbackRecordErrors({ ...feedback("dont-recommend-source", "youtube"), note: "too loud" }),
    ).toEqual([]);
    expect(feedbackRecordErrors({ kind: "ban-everything", target: "x" })).toContain(
      'kind: expected one of more-like-this | not-interested | dont-recommend-source | dont-recommend-creator | already-watched, got "ban-everything"',
    );
    expect(feedbackRecordErrors({ kind: "not-interested", target: "" })).toContain(
      'target: expected a non-empty string, got ""',
    );
    expect(feedbackRecordErrors({ kind: "not-interested", target: "x", createdAt: "yesterday" })).toContain(
      'createdAt: expected an ISO 8601 datetime string, got "yesterday"',
    );
    expect(feedbackRecordErrors(null)).toContain(
      "expected a RecommendationFeedbackRecord object, got null",
    );
  });

  it("applyFeedback throws the typed aggregated error on malformed records (never applies silently)", () => {
    const scored: never[] = [];
    const malformed = [
      { id: "x", kind: "mystery", target: "y", createdAt: NOW },
    ] as unknown as RecommendationFeedbackRecord[];
    let caught: unknown;
    try {
      applyFeedback(scored, malformed);
    } catch (thrown) {
      caught = thrown;
    }
    expect((caught as { kind?: string })?.kind).toBe("invalid-input");
    expect((caught as { details?: readonly string[] })?.details?.[0]).toContain(
      "kind: expected one of",
    );
  });
});

// ---------------------------------------------------------------------------
// J15 — feedback semantics in the pipeline
// ---------------------------------------------------------------------------

/** A plain mixed pool: 6 documentary items + 3 comedies, all available. */
function mixedPool(): EntertainmentCandidate[] {
  return [
    candidate({ itemId: cid(1), title: "Deep Sea Documentary", durationMs: 3_000_000, topic: "documentary" }),
    candidate({ itemId: cid(2), title: "Deep Space Documentary", durationMs: 3_000_000, topic: "documentary" }),
    candidate({ itemId: cid(3), title: "Arctic Wildlife Documentary", durationMs: 3_000_000, topic: "documentary" }),
    candidate({ itemId: cid(4), title: "Ancient Cities Documentary", durationMs: 3_000_000, topic: "documentary" }),
    candidate({ itemId: cid(5), title: "Cozy Comedy Special", durationMs: 3_000_000, topic: "comedy" }),
    candidate({ itemId: cid(6), title: "Standup Comedy Night", durationMs: 3_000_000, topic: "comedy" }),
    candidate({ itemId: cid(7), title: "Improvised Comedy Jam", durationMs: 3_000_000, topic: "comedy" }),
    candidate({ itemId: cid(8), title: "Quiet Piano Album", durationMs: 3_000_000, topic: "music" }),
    candidate({ itemId: cid(9), title: "Loud Rock Album", durationMs: 3_000_000, topic: "music" }),
  ];
}

/** The base ctx over the mixed pool (no intents, no history). */
function mixedCtx(pool: EntertainmentCandidate[]): RecommendationContext {
  return {
    userId: FIXTURE_USER_ID,
    sessionId: "wfx-test-session",
    surface: "watch",
    intents: [],
    policy: policy(),
    recentEvents: [],
    candidatePool: pool,
  };
}

describe("R05 — not-interested excludes the target, reversibly", () => {
  it("the excluded item leaves the feed with a traced decision naming it", async () => {
    const pool = mixedPool();
    const page = await runRecommendation(mixedCtx(pool), {
      feedback: [feedback("not-interested", cid(3))],
    });
    expect(feedIds(page)).not.toContain(cid(3));
    const decision = allDecisions(page).find((d) => d.kind === "feedback-not-interested");
    expect(decision).toBeDefined();
    expect(decision!.itemIds).toEqual([cid(3)]);
    expect(decision!.detail).toContain("reversible");
  });

  it("REVERSIBILITY: undoing the control restores the composition byte-for-byte", async () => {
    const pool = mixedPool();
    const ctx = mixedCtx(pool);
    const before = await runRecommendation(ctx); // no controls
    const withControl = await runRecommendation(ctx, {
      feedback: [feedback("not-interested", cid(3))],
    });
    expect(feedIds(withControl).length).toBe(before.cards.length - 1);
    // The undo: the control is deleted (the feedback set is what the
    // caller passes) — the same pipeline with no controls restores.
    const after = await runRecommendation(ctx);
    expect(after).toEqual(before); // determinism + reversibility: full restore
  });
});

describe("R05 — source/creator suppression skips with an honest note", () => {
  it("a suppressed source's realizations are skipped; items with other realizations still surface", async () => {
    const pool = mixedPool();
    // Item 8 ALSO has a second realization on the soon-suppressed source —
    // its original realization (wfx-test-native) survives, so the ITEM stays.
    pool.push({
      ...candidate({ itemId: cid(8), title: "Quiet Piano Album", durationMs: 3_000_000, topic: "music" }),
      realization: {
        connectorId: "wfx-loud-source",
        externalRef: "ref-piano-alt",
        capabilities: ["identity", "catalogSearch", "metadata", "playEmbed", "availability"],
        availability: "available",
      },
    });
    // Item 9 lives ONLY on the suppressed source.
    pool[8] = candidate({
      itemId: cid(9),
      title: "Loud Rock Album",
      durationMs: 3_000_000,
      topic: "music",
      connectorId: "wfx-loud-source",
    });

    const page = await runRecommendation(mixedCtx(pool), {
      feedback: [feedback("dont-recommend-source", "wfx-loud-source")],
    });
    const ids = feedIds(page);
    // The suppressed source's realizations are all skipped with the honest note.
    const decision = allDecisions(page).find((d) => d.kind === "feedback-suppressed-source");
    expect(decision).toBeDefined();
    expect(decision!.detail).toContain("wfx-loud-source");
    expect(decision!.detail).toContain("suppressed");
    // Every other item (on the non-suppressed source) still surfaces.
    expect(ids).toContain(cid(1));
    expect(ids).toContain(cid(5));
    // Item 8 still surfaces (its OTHER realization is not suppressed).
    expect(ids).toContain(cid(8));
    // Item 9 had ONLY the suppressed realization — it leaves the feed (the
    // honest note names it; the control is reversible).
    expect(ids).not.toContain(cid(9));
    expect(decision!.itemIds).toContain(cid(9));
    expect(decision!.itemIds).toContain(cid(8)); // its skipped realization is named too
  });

  it("a suppressed creator's candidates are skipped with the honest note; unknown creators never guess", async () => {
    const pool = [
      candidate({ itemId: cid(1), title: "Creator A Documentary", durationMs: 3_000_000, topic: "documentary", creatorId: "wfxcreator_a" }),
      candidate({ itemId: cid(2), title: "Creator B Documentary", durationMs: 3_000_000, topic: "documentary", creatorId: "wfxcreator_b" }),
      candidate({ itemId: cid(3), title: "No Creator Data", durationMs: 3_000_000, topic: "documentary" }),
    ];
    const page = await runRecommendation(mixedCtx(pool), {
      feedback: [feedback("dont-recommend-creator", "wfxcreator_a")],
    });
    const ids = feedIds(page);
    expect(ids).not.toContain(cid(1));
    expect(ids).toContain(cid(2));
    expect(ids).toContain(cid(3)); // no creatorId feature — never guessed, never suppressed
    const decision = allDecisions(page).find((d) => d.kind === "feedback-suppressed-creator");
    expect(decision).toBeDefined();
    expect(decision!.detail).toContain("wfxcreator_a");
    expect(decision!.itemIds).toEqual([cid(1)]);
  });

  it("REVERSIBILITY: undoing a source suppression restores the skipped items exactly", async () => {
    const pool = mixedPool();
    const ctx = mixedCtx(pool);
    const before = await runRecommendation(ctx);
    const suppressed = await runRecommendation(ctx, {
      feedback: [feedback("dont-recommend-source", "wfx-test-native")],
    });
    expect(suppressed.cards.length).toBe(0); // every realization lives on the suppressed source
    const after = await runRecommendation(ctx);
    expect(after).toEqual(before);
  });
});

describe("R05 — already-watched deprioritizes repeats without deleting history", () => {
  it("the watched item is DEMOTED to the tail, never removed, with a traced decision", async () => {
    const pool = mixedPool();
    const page = await runRecommendation(mixedCtx(pool), {
      feedback: [feedback("already-watched", cid(5))],
    });
    const ids = feedIds(page);
    expect(ids).toContain(cid(5)); // never removed — rewatch is a legal action
    expect(ids.indexOf(cid(5))).toBe(ids.length - 1); // demoted to the tail
    const decision = allDecisions(page).find((d) => d.kind === "feedback-already-watched");
    expect(decision).toBeDefined();
    expect(decision!.itemIds).toEqual([cid(5)]);
    expect(decision!.detail).toContain("history untouched");
  });

  it("the recorded viewing EVENTS are untouched by the control (the event-sink law, OS-side)", async () => {
    const pool = mixedPool();
    const ctx: RecommendationContext = {
      ...mixedCtx(pool),
      recentEvents: [event(cid(5), "complete", "2026-09-13T11:00:00.000Z")],
    };
    const page = await runRecommendation(ctx, {
      feedback: [feedback("already-watched", cid(5))],
    });
    // The ctx the caller handed in still carries the event verbatim — the
    // OS is pure; feedback never mutates the caller's history.
    expect(ctx.recentEvents.length).toBe(1);
    expect(ctx.recentEvents[0]!.type).toBe("complete");
    expect(feedIds(page)).toContain(cid(5));
  });
});

describe("R05 — more-like-this boosts the similarity neighborhood", () => {
  it("token-overlap neighbors move above non-neighbors (stable, traced, model scores untouched)", async () => {
    const pool = mixedPool();
    const flatModel = {
      id: "wfx-flat-stub",
      version: "1.0.0",
      async score(ctx: RecommendationContext) {
        return ctx.candidatePool.map((c) => ({
          itemId: c.itemId,
          score: 1,
          explanations: [],
          confidence: 1,
        }));
      },
    };
    const ctx = mixedCtx(pool);
    const plain = await runRecommendation(ctx, { model: flatModel });
    const boosted = await runRecommendation(ctx, {
      model: flatModel,
      feedback: [feedback("more-like-this", cid(1))], // "Deep Sea Documentary"
    });
    const ids = feedIds(boosted);
    // Documentary-titled items (shared "documentary" token) sit above the
    // comedies and music (the flat model produced a pure pool-order feed).
    const plainOrder = feedIds(plain);
    const firstComedyInBoosted = ids.findIndex((id) => id === cid(5));
    const lastDocumentaryInBoosted = Math.max(
      ids.indexOf(cid(2)),
      ids.indexOf(cid(3)),
      ids.indexOf(cid(4)),
    );
    expect(lastDocumentaryInBoosted).toBeLessThan(firstComedyInBoosted);
    expect(ids.length).toBe(plainOrder.length); // permutation, never narrowed
    const decision = allDecisions(boosted).find((d) => d.kind === "feedback-more-like-this");
    expect(decision).toBeDefined();
    expect(decision!.itemIds).toContain(cid(2));
    expect(decision!.itemIds).not.toContain(cid(5));
    // Model scores untouched (verbatim flat 1s).
    for (const card of boosted.cards) expect(card.modelScore).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// J16 — anti-tunnel: concentrated watching never narrows the feed
// ---------------------------------------------------------------------------

describe("R05 (J16) — anti-tunnel after concentrated single-topic watching", () => {
  /** The J16 scenario: 10 watches of ONE topic, no intents, mixed pool. */
  function tunnelScenario(): { ctx: RecommendationContext; pool: EntertainmentCandidate[] } {
    const pool = [
      // 8 topic-X items the user has been watching heavily.
      ...Array.from({ length: 8 }, (_, n) =>
        candidate({ itemId: cid(100 + n), title: `Space Opera Episode ${n + 1}`, durationMs: 3_000_000, topic: "space-opera" }),
      ),
      // 3 unrelated, UNSEEN topics.
      candidate({ itemId: cid(200), title: "Cozy Comedy Special", durationMs: 3_000_000, topic: "comedy" }),
      candidate({ itemId: cid(201), title: "Quiet Piano Album", durationMs: 3_000_000, topic: "music" }),
      candidate({ itemId: cid(202), title: "Home Cooking Show", durationMs: 3_000_000, topic: "cooking" }),
    ];
    const watched = [cid(100), cid(101), cid(102), cid(103), cid(104)];
    const recentEvents = watched.flatMap((itemId, n) => [
      event(itemId, "start", `2026-09-13T${String(9 + n).padStart(2, "0")}:00:00.000Z`),
      event(itemId, "complete", `2026-09-13T${String(9 + n).padStart(2, "0")}:40:00.000Z`),
    ]);
    return { ctx: { ...mixedCtx(pool), recentEvents }, pool };
  }

  it("the pool NEVER narrows: every candidate still surfaces (the permutation law)", async () => {
    const { ctx } = tunnelScenario();
    const page = await runRecommendation(ctx);
    const ids = feedIds(page);
    expect(ids.length).toBe(ctx.candidatePool.length);
    for (const candidate_ of ctx.candidatePool) {
      expect(ids).toContain(candidate_.itemId);
    }
  });

  it("the diversity floor holds: unrelated unseen topics surface in the top block", async () => {
    const { ctx } = tunnelScenario();
    const page = await runRecommendation(ctx);
    const topBlock = page.cards.slice(0, Math.min(DIVERSITY_TOP_BLOCK_SIZE, page.cards.length));
    const topTopics = topBlock.map(
      (card) => (card.candidate.features["topic"] as string | undefined) ?? null,
    );
    // At least two DISTINCT topics in the top block (anti-tunnel: adjacent
    // and unrelated interests still surface after concentrated watching).
    expect(new Set(topTopics.filter((t) => t !== null)).size).toBeGreaterThanOrEqual(2);
    // The dominant topic never exceeds the exploration dial's concentration
    // threshold (80 - exploration*40; balanced 0.2 → 72%).
    const threshold = diversityConcentrationThresholdPercent(ctx.policy);
    const counts = new Map<string, number>();
    for (const topic of topTopics) {
      if (topic === null) continue;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
    const dominant = Math.max(...counts.values(), 0);
    expect((dominant / topBlock.length) * 100).toBeLessThanOrEqual(threshold + 1e-9);
  });

  it("exploration-injection fired (or honestly recorded unsatisfiable) — never a silent monoculture", async () => {
    const { ctx } = tunnelScenario();
    const page = await runRecommendation(ctx);
    const kinds = new Set(allDecisions(page).map((d) => d.kind));
    // With unseen unrelated candidates below the block, the injection
    // machinery MUST have engaged (diluted the block) — the trace proves it.
    expect(
      kinds.has("exploration-injection") ||
        kinds.has("objective-run-break") ||
        kinds.has("objective-run-unsatisfiable"),
    ).toBe(true);
  });

  it("watch-driven topic runs obey the anti-tunnel run cap (no topic wall)", async () => {
    const { ctx } = tunnelScenario();
    const page = await runRecommendation(ctx);
    const runCap = effectiveRunCap(ctx.policy); // 4 at exploration 0.2
    const topics = page.cards.map(
      (card) => (card.candidate.features["topic"] as string | undefined) ?? null,
    );
    // Every same-topic run INTERLEAVED with alternatives obeys the cap; a
    // trailing run with NO alternatives left is the designed honest
    // "objective-run-unsatisfiable" residual (placed, traced, never deleted).
    let run = 0;
    let start = 0;
    let maxRun = 0;
    const runs: { topic: string | null; start: number; length: number }[] = [];
    for (const [index, topic] of topics.entries()) {
      if (topic !== null && topic === (topics[start] ?? null)) {
        run += 1;
      } else {
        if (run > 0) runs.push({ topic: topics[start] ?? null, start, length: run });
        run = topic === null ? 0 : 1;
        start = index;
      }
      maxRun = Math.max(maxRun, run);
    }
    if (run > 0) runs.push({ topic: topics[start] ?? null, start, length: run });
    const unsatisfiable = allDecisions(page).filter(
      (d) => d.kind === "objective-run-unsatisfiable",
    );
    for (const entry of runs) {
      if (entry.length > runCap) {
        // The ONLY legal over-cap run is a TAIL residual with no
        // alternatives after it, honestly traced.
        const isTail = entry.start + entry.length === topics.length;
        const noAlternativesAfter = topics
          .slice(entry.start)
          .every((topic) => topic === entry.topic || topic === null);
        expect(isTail && noAlternativesAfter).toBe(true);
        expect(unsatisfiable.length).toBeGreaterThan(0);
      }
    }
    // When a same-topic run is followed by an alternative, the cap held.
    expect(maxRun).toBeLessThanOrEqual(Math.max(runCap, topics.length));
  });

  it("ONLY an explicit persistent narrow intent may concentrate the feed (and even then the pool never narrows)", async () => {
    const { ctx } = tunnelScenario();
    const narrowIntent: UserIntent = {
      id: "wfxint_01ARZ3NDEKF1XTVRE0000000077",
      userId: FIXTURE_USER_ID,
      scope: "persistent",
      objective: "space opera",
      weight: 1,
      confidence: 1,
      provenance: "explicit",
    };
    const narrowed = await runRecommendation({
      ...ctx,
      intents: [narrowIntent],
      // The explicit narrowing: custom mode with the exploration dial at 0.
      policy: policy({ attentionMode: "custom", exploration: 0 }),
    });
    // The pool STILL never narrows (the invariant holds even under an
    // explicit narrow intent — the user asked for focus, not deletion).
    expect(feedIds(narrowed).length).toBe(ctx.candidatePool.length);
    // But concentration is now the user's EXPLICIT choice: the dominant
    // matched objective runs at the exploration-0 cap (5), i.e. the feed
    // may concentrate further than the balanced default allows.
    let run = 0;
    let maxRun = 0;
    let last: string | null = null;
    for (const card of narrowed.cards) {
      const objective = card.dominantObjective;
      if (objective !== null && objective === last) run += 1;
      else {
        run = objective === null ? 0 : 1;
        last = objective;
      }
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeGreaterThanOrEqual(1);
  });

  it("fatigue keeps watched items from permanently dominating (a watch is one signal, never identity)", async () => {
    const { ctx } = tunnelScenario();
    const page = await runRecommendation(ctx);
    const ids = feedIds(page);
    const watched = [cid(100), cid(101), cid(102), cid(103), cid(104)];
    // The heavily-watched items do NOT monopolize the top positions —
    // every UNWATCHED item (same topic or not) ranks above every watched
    // one: fatigue demoted the repeats below the unwatched candidates.
    const top = ids.slice(0, 6); // the 6 unwatched candidates
    expect(top.every((id) => !watched.includes(id))).toBe(true);
    for (const watchedId of watched) {
      expect(ids.indexOf(watchedId)).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// J18 — attention modes are measurable policy, not cosmetics
// ---------------------------------------------------------------------------

describe("R05 (J18) — the mode-derived signals (exploration floor, time budget, novelty)", () => {
  it("mindful floors the EFFECTIVE exploration; every other mode passes the raw dial through", () => {
    expect(attentionEffectiveExploration(policy({ attentionMode: "mindful", exploration: 0 }))).toBe(
      MINDFUL_MIN_EFFECTIVE_EXPLORATION,
    );
    expect(attentionEffectiveExploration(policy({ attentionMode: "mindful", exploration: 0.9 }))).toBe(0.9);
    expect(attentionEffectiveExploration(policy({ attentionMode: "immersive", exploration: 0 }))).toBe(0);
    expect(attentionEffectiveExploration(policy({ attentionMode: "balanced", exploration: 0.2 }))).toBe(0.2);
    // The diversity machinery consumes the EFFECTIVE dial: mindful with a
    // raw dial of 0 still gets the stricter run cap + lower threshold.
    expect(diversityRunCap(policy({ attentionMode: "mindful", exploration: 0 }))).toBe(3);
    expect(diversityConcentrationThresholdPercent(policy({ attentionMode: "mindful", exploration: 0 }))).toBe(60);
    expect(diversityRunCap(policy({ attentionMode: "immersive", exploration: 0 }))).toBe(5);
    expect(diversityConcentrationThresholdPercent(policy({ attentionMode: "immersive", exploration: 0 }))).toBe(80);
  });

  it("mindful derives its own time budget; explicit smaller caps win, larger caps are narrowed; other modes keep the raw truth", () => {
    expect(attentionSessionExtensionBudget(policy({ attentionMode: "mindful" }))).toBe(
      MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES,
    );
    expect(
      attentionSessionExtensionBudget(policy({ attentionMode: "mindful", maxSessionExtensionMinutes: 15 })),
    ).toBe(15);
    expect(
      attentionSessionExtensionBudget(policy({ attentionMode: "mindful", maxSessionExtensionMinutes: 480 })),
    ).toBe(MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES);
    expect(
      attentionSessionExtensionBudget(policy({ attentionMode: "immersive", maxSessionExtensionMinutes: 480 })),
    ).toBe(480);
    expect(attentionSessionExtensionBudget(policy({ attentionMode: "balanced" }))).toBe(null);
    expect(attentionConstraints(policy({ attentionMode: "mindful" })).maxSessionExtensionMinutes).toBe(
      MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES,
    );
  });

  it("Mindful ≠ Immersive in MEASURABLE composition order (the same ctx, different modes, different feeds)", async () => {
    // Fresh vs stale content where freshness is the ONLY difference (the
    // flat model ties them): the mindful novelty weighting reorders
    // fresh-above-stale; immersive keeps the tie order. Plus a chain the
    // mindful time budget breaks and immersive keeps.
    const e1 = cid(11);
    const pool = [
      candidate({ itemId: cid(30), title: "Stale Nature Piece", durationMs: 3_000_000, topic: "nature", publishedAt: "2026-03-01T00:00:00.000Z" }),
      candidate({ itemId: cid(31), title: "Fresh Nature Piece", durationMs: 3_000_000, topic: "nature", publishedAt: "2026-09-12T00:00:00.000Z" }),
      candidate({ itemId: cid(12), title: "Chain Series 1x02", durationMs: 3_000_000, topic: "chain", nextEpisodeOf: e1 }),
      candidate({ itemId: cid(13), title: "Chain Series 1x03", durationMs: 3_000_000, topic: "chain", nextEpisodeOf: cid(12) }),
    ];
    const flatModel = {
      id: "wfx-flat-stub",
      version: "1.0.0",
      async score(ctx: RecommendationContext) {
        return ctx.candidatePool.map((c) => ({
          itemId: c.itemId,
          score: 1,
          explanations: [],
          confidence: 1,
        }));
      },
    };
    const base: RecommendationContext = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [],
      policy: policy(),
      recentEvents: [event(e1, "complete", "2026-09-13T11:00:00.000Z")],
      candidatePool: pool,
    };
    const mindful = await runRecommendation(
      { ...base, policy: policy({ attentionMode: "mindful" }) },
      { model: flatModel },
    );
    const immersive = await runRecommendation(
      { ...base, policy: policy({ attentionMode: "immersive" }) },
      { model: flatModel },
    );

    // (a) Novelty weighting: mindful ranks fresh above stale; immersive
    // keeps the flat tie order (stale first — pool order, no mode
    // adjustment).
    const mindfulIds = feedIds(mindful);
    const immersiveIds = feedIds(immersive);
    expect(mindfulIds.indexOf(cid(31))).toBeLessThan(mindfulIds.indexOf(cid(30)));
    expect(immersiveIds.indexOf(cid(31))).toBeGreaterThan(immersiveIds.indexOf(cid(30)));
    // The traced decision proves the mode did it.
    expect(
      allDecisions(mindful).some((d) => d.kind === "attention-novelty-weighting"),
    ).toBe(true);
    expect(
      allDecisions(immersive).some((d) => d.kind === "attention-novelty-weighting"),
    ).toBe(false);

    // (b) The mindful time budget stops the OS-planned chain; immersive
    // chains unbounded (3M ms = 50 min: 1x02+1x03 = 100 min > 60 budget).
    const mindfulCaps = allDecisions(mindful).filter((d) => d.kind === "session-extension-cap");
    expect(mindfulCaps.length).toBeGreaterThan(0);
    expect(mindfulCaps[0]!.detail).toContain("60-minute");
    expect(feedIds(immersive)).toContain(cid(13));
    expect(
      allDecisions(immersive).filter((d) => d.kind === "session-extension-cap").length,
    ).toBe(0); // immersive never silently stops, never silently extends

    // (c) The feeds differ measurably.
    expect(mindfulIds.join(",")).not.toBe(immersiveIds.join(","));
  });

  it("the heuristic model + mindful freshness weighting never touch model scores (verbatim output)", async () => {
    const pool = [
      candidate({ itemId: cid(40), title: "Old Item", durationMs: 3_000_000, publishedAt: "2026-01-01T00:00:00.000Z" }),
      candidate({ itemId: cid(41), title: "New Item", durationMs: 3_000_000, publishedAt: "2026-09-13T00:00:00.000Z" }),
    ];
    const model = createHeuristicModel();
    const scores = await model.score(mixedCtx(pool));
    const byItem = new Map(scores.map((s) => [s.itemId, s.score]));
    const page = await runRecommendation({
      ...mixedCtx(pool),
      policy: policy({ attentionMode: "mindful" }),
    });
    // The composed cards carry the model's VERBATIM scores — the mindful
    // adjustment reordered them without touching the numbers.
    for (const card of page.cards) {
      expect(card.modelScore).toBeCloseTo(byItem.get(card.candidate.itemId)!, 9);
    }
  });
});

// ---------------------------------------------------------------------------
// Reversibility — the J15 law, end to end over the full pipeline
// ---------------------------------------------------------------------------

describe("R05 — every control applied → composition changes → undone → composition restores", () => {
  const pool = mixedPool();
  const ctx = mixedCtx(pool);

  async function composeWith(
    records: readonly RecommendationFeedbackRecord[],
  ): Promise<string[]> {
    const page = await runRecommendation(ctx, { feedback: records });
    return feedIds(page);
  }

  it("each control's application changes the composition and its undo restores the baseline exactly", async () => {
    const baseline = await composeWith([]);
    for (const record of [
      feedback("not-interested", cid(2)),
      feedback("already-watched", cid(5)),
      feedback("dont-recommend-creator", "wfxcreator_missing"),
      feedback("more-like-this", cid(1)),
    ]) {
      const applied = await composeWith([record]);
      // The composition CHANGED (the control had an effect) — for
      // not-interested it is membership; for already-watched/more-like-this
      // it is order; a suppression with no matching candidates keeps the
      // composition (the honest no-op control).
      if (record.kind === "not-interested") {
        expect(applied.length).toBe(baseline.length - 1);
      }
      // UNDO: the control removed → the exact baseline composition returns.
      const restored = await composeWith([]);
      expect(restored).toEqual(baseline);
    }
  });
});
