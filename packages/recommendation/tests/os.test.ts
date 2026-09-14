import { describe, expect, it } from "bun:test";

import {
  // WFX-020 retrieval fixtures (merged Lane A work — read-only inputs here)
  buildFixtureIndex,
  FIXTURE_USER_ID,
  // WFX-021 — the Recommendation OS under test
  applyPolicy,
  assembleFeatures,
  createHeuristicModel,
  diversify,
  diversityConcentrationThresholdPercent,
  diversityRunCap,
  effectiveRunCap,
  intakePool,
  RecommendationOSError,
  repetitionSignal,
  runRecommendation,
  score,
  BALANCED_MAX_SESSION_EXTENDING_CHAIN,
  DIVERSITY_TOP_BLOCK_SIZE,
  HEURISTIC_EXPLORATION_BASE,
  HEURISTIC_MODEL_ID,
  HEURISTIC_MODEL_VERSION,
  HEURISTIC_NOVELTY_BASE,
  HEURISTIC_SOCIAL_BASE,
  MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE,
  MINDFUL_MAX_SESSION_EXTENDING_CHAIN,
  NEUTRAL_FRESHNESS,
  inProgressItemIds,
  type RecommendationContext,
  type RecommendationModel,
  type RecommendationScore,
  type TraceDecision,
} from "../src/index";

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  RecommendationPolicy,
  UserIntent,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical-shaped hand-authored item id: wfxitm_ + 26-char ULID body. */
function cid(n: number): string {
  return `wfxitm_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`;
}

/** The full fixture candidate pool as FLAT frozen candidates (19 entries). */
function fixturePool(): EntertainmentCandidate[] {
  const index = buildFixtureIndex();
  return index.query({ limit: 100 }).map((retrieved) => retrieved.candidate);
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
  userId: string = FIXTURE_USER_ID,
): EntertainmentEvent {
  return { userId, itemId, type, occurredAt, sessionId: "wfx-test-session" };
}

/** A hand-built flat candidate. */
function candidate(over: {
  itemId: string;
  title: string;
  canonicalType?: EntertainmentCandidate["features"] extends never ? never : string;
  durationMs?: number;
  orientation?: string;
  matchText?: string;
  nextEpisodeOf?: string;
  publishedAt?: string;
  availability?: "available" | "unknown" | "unavailable";
  connectorId?: string;
}): EntertainmentCandidate {
  return {
    itemId: over.itemId,
    realization: {
      connectorId: over.connectorId ?? "wfx-test-native",
      externalRef: `ref-${over.itemId.slice(-4)}`,
      capabilities: ["identity", "catalogSearch", "metadata", "playNative", "playEmbed", "availability"],
      availability: over.availability ?? "available",
    },
    features: {
      canonicalType: over.canonicalType ?? "video",
      canonicalTitle: over.title,
      matchText:
        over.matchText ??
        `${over.title.toLowerCase()} ${(over.canonicalType ?? "video")} ${(over.orientation ?? "horizontal")}`,
      ...(over.durationMs !== undefined ? { durationMs: over.durationMs } : {}),
      ...(over.orientation !== undefined ? { orientation: over.orientation } : {}),
      ...(over.nextEpisodeOf !== undefined ? { nextEpisodeOf: over.nextEpisodeOf } : {}),
      ...(over.publishedAt !== undefined ? { publishedAt: over.publishedAt } : {}),
    },
  };
}

/** Runs fn expecting a typed RecommendationOSError; returns the error. */
function expectOSError(
  fn: () => unknown,
  kind: "invalid-input" | "model-contract",
): RecommendationOSError {
  try {
    fn();
  } catch (error) {
    const osError = error as RecommendationOSError;
    expect(osError).toBeInstanceOf(RecommendationOSError);
    expect(osError.kind).toBe(kind);
    expect(osError.details.length).toBeGreaterThan(0);
    return osError;
  }
  throw new Error(`expected a RecommendationOSError (${kind}) to be thrown`);
}

/** The longest run of consecutive cards sharing a dominant objective. */
function maxObjectiveRun(itemIdsInOrder: readonly { objective: string | null }[]): number {
  let best = 0;
  let current = 0;
  let last: string | null = null;
  for (const { objective } of itemIdsInOrder) {
    if (objective === null || objective !== last) {
      current = objective === null ? 0 : 1;
      last = objective;
    } else {
      current += 1;
    }
    best = Math.max(best, current);
  }
  return best;
}

/** All trace decisions of one run, flattened. */
function allDecisions(page: { trace: { stages: readonly { decisions: readonly TraceDecision[] }[] } }): TraceDecision[] {
  const out: TraceDecision[] = [];
  for (const stage of page.trace.stages) out.push(...stage.decisions);
  return out;
}

/** The fixed "now" used across hand-built scenarios. */
const NOW = "2026-09-13T12:00:00.000Z";
const T_MINUS_1H = "2026-09-13T11:00:00.000Z";
const T_MINUS_30D = "2026-08-14T12:00:00.000Z";

// ---------------------------------------------------------------------------
// The golden fixture context (deterministic: fixed ids, fixed events)
// ---------------------------------------------------------------------------

/** The golden ctx: fixture pool + fixture intents, a resume and a complete. */
function goldenCtx(surface: "watch" | "short"): RecommendationContext {
  return {
    userId: FIXTURE_USER_ID,
    sessionId: "wfx-test-session",
    surface,
    intents: [
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE000000001",
        userId: FIXTURE_USER_ID,
        scope: "persistent",
        objective: "science fiction epics",
        weight: 0.9,
        confidence: 0.85,
        provenance: "explicit",
      },
    ],
    policy: policy(),
    recentEvents: [
      event("wfxitm_01ARZ3NDEKF1XTVRE000000003", "progress", T_MINUS_1H), // Severance in progress
      event("wfxitm_01ARZ3NDEKF1XTVRE00000000A", "complete", "2026-09-13T10:00:00.000Z"), // Rome completed
    ],
    candidatePool: fixturePool(),
  };
}

// ===========================================================================
// 1. The anti-tunnel-vision law
// ===========================================================================

describe("WFX-021 — anti-tunnel-vision (one watched topic never narrows the feed)", () => {
  const tunnelCtx = (): RecommendationContext => {
    const dune = "wfxitm_01ARZ3NDEKF1XTVRE000000001";
    const severance = "wfxitm_01ARZ3NDEKF1XTVRE000000003";
    const s2e1 = "wfxitm_01ARZ3NDEKF1XTVRE000000004";
    const stalker = "wfxitm_01ARZ3NDEKF1XTVRE00000000C";
    const watches = [
      ...Array.from({ length: 4 }, () => event(dune, "complete", T_MINUS_1H)),
      ...Array.from({ length: 3 }, () => event(severance, "complete", T_MINUS_1H)),
      ...Array.from({ length: 2 }, () => event(s2e1, "complete", T_MINUS_1H)),
      event(stalker, "complete", T_MINUS_1H),
    ];
    return {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [
        {
          id: "wfxint_01ARZ3NDEKF1XTVRE0000000081",
          userId: FIXTURE_USER_ID,
          scope: "persistent",
          objective: "science fiction epics",
          weight: 0.95,
          confidence: 0.9,
          provenance: "explicit",
        },
      ],
      policy: policy(),
      recentEvents: watches, // 10 watches of ONE topic
      candidatePool: fixturePool(),
    };
  };

  it("a user with 10+ watches of one topic still receives non-that-topic candidates in the feed", async () => {
    const page = await runRecommendation(tunnelCtx());
    const titles = page.cards.map((card) => String(card.candidate.features.canonicalTitle));
    expect(titles).toContain("The Grand Budapest Hotel"); // comedy
    expect(titles).toContain("The History of Rome - Episode 1"); // history
    expect(titles).toContain("Desk Setup Tour 2026"); // tech
    expect(titles).toContain("Morning Stretch Routine"); // fitness
    // The heavy topic is fatigued down: the feed's HEAD is not a sci-fi monoculture.
    const firstThree = page.cards.slice(0, 3).map((card) => card.dominantObjective);
    expect(firstThree.every((objective) => objective !== "science fiction epics")).toBe(true);
  });

  it("profile narrowing is impossible by construction: membership is a permutation, never a subset", async () => {
    const ctx = tunnelCtx();
    const poolItemIds = new Set(ctx.candidatePool.map((c) => c.itemId));
    const page = await runRecommendation(ctx);
    expect(page.cards.length).toBe(poolItemIds.size);
    expect(new Set(page.cards.map((card) => card.candidate.itemId)).size).toBe(poolItemIds.size);
    for (const card of page.cards) expect(poolItemIds.has(card.candidate.itemId)).toBe(true);
  });

  it("the ctx is never mutated by a run (deep-equal before/after)", async () => {
    const ctx = tunnelCtx();
    const before = JSON.stringify(ctx);
    await runRecommendation(ctx);
    expect(JSON.stringify(ctx)).toBe(before);
  });

  it("the diversity invariant holds at the output: no objective run exceeds the exploration-derived cap", async () => {
    const page = await runRecommendation(tunnelCtx());
    const cap = diversityRunCap(page.cards.length === 0 ? policy() : policy()); // e=0.2 -> K=4
    const run = maxObjectiveRun(page.cards.map((card) => ({ objective: card.dominantObjective })));
    expect(run).toBeLessThanOrEqual(cap);
  });

  it("diversify itself never removes or narrows: permutation of the input", async () => {
    const ctx = goldenCtx("watch");
    const features = assembleFeatures(ctx);
    const model = createHeuristicModel();
    const scored = await score(ctx, features, model);
    const policyResult = applyPolicy(ctx, scored.scored);
    const diversified = diversify(policyResult.ranked, ctx.intents, policy());
    expect(diversified.ranked.length).toBe(policyResult.ranked.length);
    const membershipA = policyResult.ranked.map((item) => item.candidate.itemId).sort();
    const membershipB = diversified.ranked.map((item) => item.candidate.itemId).sort();
    expect(membershipA).toEqual(membershipB);
  });
});

// ===========================================================================
// 2. Attention policy
// ===========================================================================

/** A mixed pool: a 3-episode chain anchored on a consumed episode + variety. */
function chainCtx(over: Partial<RecommendationPolicy> = {}): RecommendationContext {
  const e1 = cid(11);
  const e2 = cid(12);
  const e3 = cid(13);
  const e4 = cid(14);
  const pool = [
    candidate({ itemId: e4, title: "Science Fiction Series 1x04", canonicalType: "episode", durationMs: 1_800_000, nextEpisodeOf: e3 }),
    candidate({ itemId: e3, title: "Science Fiction Series 1x03", canonicalType: "episode", durationMs: 1_800_000, nextEpisodeOf: e2 }),
    candidate({ itemId: e2, title: "Science Fiction Series 1x02", canonicalType: "episode", durationMs: 1_800_000, nextEpisodeOf: e1 }),
    candidate({ itemId: cid(15), title: "Comedy Special", durationMs: 3_600_000 }),
    candidate({ itemId: cid(16), title: "Fitness Routine", durationMs: 300_000 }),
  ];
  return {
    userId: FIXTURE_USER_ID,
    sessionId: "wfx-test-session",
    surface: "watch",
    intents: [
      {
        id: "wfxint_01ARZ3NDEKF1XTVRE0000000082",
        userId: FIXTURE_USER_ID,
        scope: "persistent",
        objective: "science fiction epics",
        weight: 0.8,
        confidence: 0.9,
        provenance: "explicit",
      },
    ],
    policy: policy(over),
    recentEvents: [event(e1, "complete", T_MINUS_1H)],
    candidatePool: pool,
  };
}

/** Max consecutive session-extending placements in a composed feed. */
function maxExtendingRun(
  cards: readonly { itemId: string; next: string | null }[],
  consumed: ReadonlySet<string>,
): number {
  let best = 0;
  let current = 0;
  let prev: string | null = null;
  for (const card of cards) {
    const extendsSession =
      card.next !== null && ((prev !== null && card.next === prev) || consumed.has(card.next));
    current = extendsSession ? current + 1 : 0;
    best = Math.max(best, current);
    prev = card.itemId;
  }
  return best;
}

describe("WFX-021 — attention policy (explicit modes, never silent session-length optimization)", () => {
  it("mindful mode never produces unbroken chains: objective runs AND session-extending chains are capped", async () => {
    const ctx = chainCtx({ attentionMode: "mindful" });
    const page = await runRecommendation(ctx);
    const consumed = new Set([cid(11)]);
    const objectiveRun = maxObjectiveRun(
      page.cards.map((card) => ({ objective: card.dominantObjective })),
    );
    expect(objectiveRun).toBeLessThanOrEqual(MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE);
    const extendingRun = maxExtendingRun(
      page.cards.map((card) => ({
        itemId: card.candidate.itemId,
        next:
          typeof card.candidate.features["nextEpisodeOf"] === "string"
            ? (card.candidate.features["nextEpisodeOf"] as string)
            : null,
      })),
      consumed,
    );
    expect(extendingRun).toBeLessThanOrEqual(MINDFUL_MAX_SESSION_EXTENDING_CHAIN);
    // The cap was actually enforced (traced), not vacuously satisfied.
    const chainCaps = allDecisions(page).filter((decision) => decision.kind === "chain-cap");
    expect(chainCaps.length).toBeGreaterThan(0);
  });

  it("immersive mode allows chains but never removes alternatives", async () => {
    const ctx = chainCtx({ attentionMode: "immersive" });
    const page = await runRecommendation(ctx);
    const itemIds = page.cards.map((card) => card.candidate.itemId);
    // Full episodic chain allowed: 1x02 -> 1x03 -> 1x04 consecutive.
    const pos2 = itemIds.indexOf(cid(12));
    const pos3 = itemIds.indexOf(cid(13));
    const pos4 = itemIds.indexOf(cid(14));
    expect(pos3).toBe(pos2 + 1);
    expect(pos4).toBe(pos3 + 1);
    // Alternatives present: every pool item survives.
    expect(new Set(itemIds).size).toBe(ctx.candidatePool.length);
  });

  it("no mode silently drops candidates to extend sessions (membership preserved in all four modes)", async () => {
    for (const attentionMode of ["mindful", "balanced", "immersive", "custom"] as const) {
      const ctx = chainCtx({ attentionMode });
      const page = await runRecommendation(ctx);
      const poolIds = new Set(ctx.candidatePool.map((c) => c.itemId));
      const feedIds = new Set(page.cards.map((card) => card.candidate.itemId));
      expect(feedIds.size).toBe(poolIds.size);
      expect(page.cards.length).toBe(poolIds.size);
    }
  });

  it("balanced mode caps chains at the documented default (4), below immersive's unbounded chains", () => {
    expect(BALANCED_MAX_SESSION_EXTENDING_CHAIN).toBe(4);
    const page = runRecommendation(chainCtx({ attentionMode: "balanced" }));
    expect(page).resolves.toBeDefined();
  });

  it("maxSessionExtensionMinutes is respected: a 45-minute cap stops a 30+30-minute chain", async () => {
    const ctx = chainCtx({ maxSessionExtensionMinutes: 45 });
    const page = await runRecommendation(ctx);
    const caps = allDecisions(page).filter((decision) => decision.kind === "session-extension-cap");
    expect(caps.length).toBeGreaterThan(0);
    expect(caps[0]!.detail).toContain("45-minute");
    // The blocked episode (1x03, 30 min after the already-chained 30 min) is
    // NOT placed right after its anchor: the chain is broken.
    const itemIds = page.cards.map((card) => card.candidate.itemId);
    const pos2 = itemIds.indexOf(cid(12));
    const pos3 = itemIds.indexOf(cid(13));
    expect(pos3).not.toBe(pos2 + 1);
    // And it was demoted, never removed.
    expect(pos3).toBeGreaterThan(-1);
  });

  it("every mode declares its attention parameters in the trace (attention-policy decision)", async () => {
    for (const attentionMode of ["mindful", "balanced", "immersive", "custom"] as const) {
      const page = await runRecommendation(chainCtx({ attentionMode }));
      const declared = allDecisions(page).find((decision) => decision.kind === "attention-policy");
      expect(declared).toBeDefined();
      expect(declared!.detail).toContain(attentionMode);
    }
  });
});

// ===========================================================================
// 3. Policy objectives (custom mode): maximize/minimize directions honored
// ===========================================================================

describe("WFX-021 — custom policy objectives (directions honored, model scores untouched)", () => {
  const flatModel: RecommendationModel = {
    id: "wfx-flat-stub",
    version: "1.0.0",
    async score(ctx: RecommendationContext): Promise<RecommendationScore[]> {
      return ctx.candidatePool.map((c) => ({
        itemId: c.itemId,
        score: 1,
        explanations: [],
        confidence: 1,
      }));
    },
  };

  const objectiveCtx = (direction: "maximize" | "minimize"): RecommendationContext => ({
    userId: FIXTURE_USER_ID,
    sessionId: "wfx-test-session",
    surface: "watch",
    intents: [],
    policy: policy({
      attentionMode: "custom",
      objectives: [{ id: "comedy", weight: 1, direction }],
    }),
    recentEvents: [],
    candidatePool: [
      candidate({ itemId: cid(21), title: "Comedy Night Live", durationMs: 3_600_000 }),
      candidate({ itemId: cid(22), title: "Science Fiction Saga", durationMs: 3_600_000 }),
      candidate({ itemId: cid(23), title: "History Lecture", durationMs: 3_600_000 }),
    ],
  });

  it("a maximize objective ranks matching items first", async () => {
    const page = await runRecommendation(objectiveCtx("maximize"), { model: flatModel });
    expect(page.cards[0]!.candidate.features.canonicalTitle).toBe("Comedy Night Live");
    // Traced as an explicit adjustment; the model score itself is unchanged.
    const adjustments = allDecisions(page).filter((d) => d.kind === "custom-objective");
    expect(adjustments.length).toBe(1);
    expect(adjustments[0]!.detail).toContain("maximize");
    expect(adjustments[0]!.detail).toContain("model score 1 unchanged");
    expect(page.cards.every((card) => card.modelScore === 1)).toBe(true);
  });

  it("a minimize objective ranks matching items last (below non-demoted items)", async () => {
    const page = await runRecommendation(objectiveCtx("minimize"), { model: flatModel });
    const titles = page.cards.map((card) => String(card.candidate.features.canonicalTitle));
    expect(titles.indexOf("Comedy Night Live")).toBe(titles.length - 1);
    expect(page.cards.every((card) => card.modelScore === 1)).toBe(true);
    const adjustments = allDecisions(page).filter((d) => d.kind === "custom-objective");
    expect(adjustments[0]!.detail).toContain("minimize");
  });

  it("an item:-prefixed objective id matches that exact canonical item", async () => {
    const target = cid(23);
    const ctx: RecommendationContext = {
      ...objectiveCtx("maximize"),
      policy: policy({
        attentionMode: "custom",
        objectives: [{ id: `item:${target}`, weight: 1, direction: "maximize" }],
      }),
    };
    const page = await runRecommendation(ctx, { model: flatModel });
    expect(page.cards[0]!.candidate.itemId).toBe(target);
  });
});

// ===========================================================================
// 4. Pipeline trace completeness (auditable end-to-end)
// ===========================================================================

describe("WFX-021 — pipeline trace completeness (every stage recorded, every demotion explained)", () => {
  it("records all six stages in frozen-architecture order with counts and decisions", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    const stages = page.trace.stages;
    expect(stages.map((stage) => stage.stage)).toEqual([
      "retrieval",
      "features",
      "scoring",
      "policy",
      "diversity",
      "composition",
    ]);
    expect(stages[0]!.inputCount).toBe(19);
    expect(stages[0]!.outputCount).toBe(19);
    expect(stages[1]!.inputCount).toBe(19);
    expect(stages[1]!.outputCount).toBe(19);
    expect(stages[2]!.inputCount).toBe(19);
    expect(stages[2]!.outputCount).toBe(19);
    expect(stages[3]!.inputCount).toBe(19);
    expect(stages[3]!.outputCount).toBe(12); // canonical dedupe: 19 -> 12 items
    expect(stages[4]!.inputCount).toBe(12);
    expect(stages[4]!.outputCount).toBe(12); // permutation
    expect(stages[5]!.inputCount).toBe(12);
    expect(stages[5]!.outputCount).toBe(12);
  });

  it("records the injected model identity in the trace", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    expect(page.trace.model.id).toBe(HEURISTIC_MODEL_ID);
    expect(page.trace.model.version).toBe(HEURISTIC_MODEL_VERSION);
  });

  it("explains every canonical dedupe: 6 decisions, each naming the winner and the losers", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    const dedupes = allDecisions(page).filter((decision) => decision.kind === "dedupe-kept");
    expect(dedupes.length).toBe(6);
    for (const decision of dedupes) {
      expect(decision.detail).toContain("kept realization");
      expect(decision.detail).toContain("over");
      expect(decision.itemIds.length).toBe(1);
    }
  });

  it("explains the availability-floor demotion: Stalker (0 available realizations) traced and tailed", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    const demotions = allDecisions(page).filter((d) => d.kind === "availability-demotion");
    expect(demotions.length).toBe(1);
    expect(demotions[0]!.itemIds).toContain("wfxitm_01ARZ3NDEKF1XTVRE00000000C");
    expect(demotions[0]!.detail).toContain("NOT removed");
    // Demoted, not deleted: the item is the LAST card of the feed.
    expect(page.cards[page.cards.length - 1]!.candidate.itemId).toBe(
      "wfxitm_01ARZ3NDEKF1XTVRE00000000C",
    );
  });

  it("explains every composed position: one position decision per card with reasons", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    const positions = allDecisions(page).filter((d) => d.kind === "position");
    expect(positions.length).toBe(page.cards.length);
    for (const [index, decision] of positions.entries()) {
      expect(decision.detail).toContain(`position ${index}`);
      expect(decision.detail.length).toBeGreaterThan(`position ${index}:`.length);
    }
    // Every card also carries its reasons inline.
    for (const card of page.cards) expect(card.positionReasons.length).toBeGreaterThan(0);
  });

  it("records the resume placement: the in-progress item leads the watch feed", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    expect(page.cards[0]!.candidate.itemId).toBe("wfxitm_01ARZ3NDEKF1XTVRE000000003");
    expect(page.cards[0]!.positionReasons[0]).toContain("resume-continuation");
  });

  it("records honest empties: an empty pool and a missing time anchor are results, not errors", async () => {
    const emptyCtx: RecommendationContext = {
      ...goldenCtx("watch"),
      candidatePool: [],
      recentEvents: [],
      intents: [],
    };
    const page = await runRecommendation(emptyCtx);
    expect(page.cards).toHaveLength(0);
    const kinds = allDecisions(page).map((decision) => decision.kind);
    expect(kinds).toContain("pool-empty");
    expect(kinds).toContain("no-time-anchor");
    expect(page.trace.stages[0]!.inputCount).toBe(0);
  });
});

// ===========================================================================
// 5. Deterministic golden outputs
// ===========================================================================

describe("WFX-021 — deterministic golden outputs (fixed ctx -> fixed feed)", () => {
  it("two runs of the same ctx are deep-equal (feed AND trace)", async () => {
    const pageA = await runRecommendation(goldenCtx("watch"));
    const pageB = await runRecommendation(goldenCtx("watch"));
    expect(JSON.stringify(pageA)).toBe(JSON.stringify(pageB));
  });

  it("golden watch order: resume first, long-form preference, availability tail", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    expect(page.cards.map((card) => card.candidate.itemId)).toEqual([
      "wfxitm_01ARZ3NDEKF1XTVRE000000003", // Severance (resume: in-progress watch)
      "wfxitm_01ARZ3NDEKF1XTVRE000000004", // Severance S2E1 (45 min, long-form)
      "wfxitm_01ARZ3NDEKF1XTVRE000000001", // Dune: Part Two (166 min)
      "wfxitm_01ARZ3NDEKF1XTVRE000000002", // The Grand Budapest Hotel (99 min)
      "wfxitm_01ARZ3NDEKF1XTVRE000000009", // Lo-Fi Study Beats (60 min)
      "wfxitm_01ARZ3NDEKF1XTVRE00000000A", // The History of Rome (40 min)
      "wfxitm_01ARZ3NDEKF1XTVRE000000005", // Kurzgesagt (10.5 min — short tier begins)
      "wfxitm_01ARZ3NDEKF1XTVRE00000000B", // Paper Crane (8 min)
      "wfxitm_01ARZ3NDEKF1XTVRE000000008", // ULID post (no duration)
      "wfxitm_01ARZ3NDEKF1XTVRE000000007", // Desk Setup (92 s)
      "wfxitm_01ARZ3NDEKF1XTVRE000000006", // Morning Stretch (45 s)
      "wfxitm_01ARZ3NDEKF1XTVRE00000000C", // Stalker (availability floor tail)
    ]);
  });

  it("golden short order: vertical-first, session tiers, availability tail", async () => {
    const page = await runRecommendation(goldenCtx("short"));
    expect(page.cards.map((card) => card.candidate.itemId)).toEqual([
      "wfxitm_01ARZ3NDEKF1XTVRE000000007", // Desk Setup (vertical, micro 92 s)
      "wfxitm_01ARZ3NDEKF1XTVRE000000006", // Morning Stretch (vertical, micro 45 s)
      "wfxitm_01ARZ3NDEKF1XTVRE000000008", // ULID post (square tier)
      "wfxitm_01ARZ3NDEKF1XTVRE000000009", // Lo-Fi (unknown orientation tier)
      "wfxitm_01ARZ3NDEKF1XTVRE00000000A", // History of Rome (unknown orientation tier)
      "wfxitm_01ARZ3NDEKF1XTVRE000000004", // Severance S2E1 (horizontal tier begins)
      "wfxitm_01ARZ3NDEKF1XTVRE000000001", // Dune: Part Two
      "wfxitm_01ARZ3NDEKF1XTVRE000000005", // Kurzgesagt
      "wfxitm_01ARZ3NDEKF1XTVRE00000000B", // Paper Crane
      "wfxitm_01ARZ3NDEKF1XTVRE000000002", // The Grand Budapest Hotel
      "wfxitm_01ARZ3NDEKF1XTVRE000000003", // Severance
      "wfxitm_01ARZ3NDEKF1XTVRE00000000C", // Stalker (availability floor tail)
    ]);
  });
});

// ===========================================================================
// 6. Surface rules (watch vs short)
// ===========================================================================

describe("WFX-021 — surface rules (feed mode from content and session context only)", () => {
  it("watch and short compose the SAME pool differently (both surfaces, same ctx data)", async () => {
    const watch = await runRecommendation(goldenCtx("watch"));
    const short = await runRecommendation(goldenCtx("short"));
    expect(watch.surface).toBe("watch");
    expect(short.surface).toBe("short");
    const watchIds = watch.cards.map((card) => card.candidate.itemId);
    const shortIds = short.cards.map((card) => card.candidate.itemId);
    expect(watchIds).not.toEqual(shortIds);
    // Same membership, different order — surface, not source, chose the mode.
    expect([...watchIds].sort()).toEqual([...shortIds].sort());
  });

  it("short feed is vertical-first; watch feed prefers long-form durations", async () => {
    const short = await runRecommendation(goldenCtx("short"));
    expect(short.cards[0]!.candidate.features.orientation).toBe("vertical");
    expect(short.cards[1]!.candidate.features.orientation).toBe("vertical");
    const watch = await runRecommendation(goldenCtx("watch"));
    // After the resume head, the watch feed's next cards are the long-form ones.
    const second = Number(watch.cards[1]!.candidate.features.durationMs);
    expect(second).toBeGreaterThanOrEqual(1_200_000);
  });

  it("source does not choose feed mode: identical items under swapped connector ids compose identically", async () => {
    const poolA = [
      candidate({ itemId: cid(31), title: "Vertical Clip One", durationMs: 60_000, orientation: "vertical" }),
      candidate({ itemId: cid(32), title: "Horizontal Feature", durationMs: 3_600_000, orientation: "horizontal" }),
    ];
    const poolB = poolA.map((c, index) => ({
      ...c,
      realization: {
        ...c.realization,
        connectorId: index === 0 ? "wfx-other-source" : "wfx-third-source",
        externalRef: `other-${index}`,
      },
    }));
    const base = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      intents: [],
      policy: policy(),
      recentEvents: [],
    };
    const pageA = await runRecommendation({ ...base, surface: "short", candidatePool: poolA });
    const pageB = await runRecommendation({ ...base, surface: "short", candidatePool: poolB });
    expect(pageA.cards.map((card) => card.candidate.itemId)).toEqual(
      pageB.cards.map((card) => card.candidate.itemId),
    );
  });

  it("session-aware boost: a session-scope intent match leads the short feed's orientation tier", async () => {
    const ctx: RecommendationContext = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "short",
      intents: [
        {
          id: "wfxint_01ARZ3NDEKF1XTVRE0000000083",
          userId: FIXTURE_USER_ID,
          scope: "session",
          objective: "vertical cooking shorts",
          weight: 0.9,
          confidence: 0.8,
          provenance: "inferred",
        },
      ],
      policy: policy(),
      recentEvents: [],
      candidatePool: [
        candidate({ itemId: cid(41), title: "Vertical Cooking Shorts: Knife Skills", durationMs: 45_000, orientation: "vertical" }),
        candidate({ itemId: cid(42), title: "Vertical Travel Clip", durationMs: 50_000, orientation: "vertical" }),
      ],
    };
    const page = await runRecommendation(ctx);
    expect(page.cards[0]!.candidate.itemId).toBe(cid(41));
    expect(page.cards[0]!.positionReasons.some((reason) => reason.includes("session-intent-boost"))).toBe(true);
  });
});

// ===========================================================================
// 7. Injected-model contract (the OS never overrides model scores)
// ===========================================================================

describe("WFX-021 — injected-model contract (scores flow through verbatim)", () => {
  const stubModel: RecommendationModel = {
    id: "wfx-stub-ranker",
    version: "9.9.9",
    async score(_ctx: RecommendationContext): Promise<RecommendationScore[]> {
      // Scores ONLY two of the twelve items; exotic values must survive verbatim.
      return [
        {
          itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000001",
          score: 5.25,
          explanations: ["stub says dune first", "stub reason two"],
          confidence: 0.9,
        },
        {
          itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000002",
          score: 3.125,
          explanations: ["stub says budapest second"],
          confidence: 0.4,
        },
      ];
    },
  };

  it("a stub model's scores, confidences, and explanations flow through unchanged", async () => {
    const ctx = goldenCtx("watch");
    const page = await runRecommendation(ctx, { model: stubModel });
    expect(page.trace.model.id).toBe("wfx-stub-ranker");
    const dune = page.cards.find((card) => card.candidate.itemId === "wfxitm_01ARZ3NDEKF1XTVRE000000001")!;
    expect(dune.modelScore).toBe(5.25);
    expect(dune.confidence).toBe(0.9);
    expect([...dune.explanations]).toEqual(["stub says dune first", "stub reason two"]);
    const budapest = page.cards.find((card) => card.candidate.itemId === "wfxitm_01ARZ3NDEKF1XTVRE000000002")!;
    expect(budapest.modelScore).toBe(3.125);
    // The resume head leads (surface composition), then the stub's ranking:
    // dune (5.25) is the FIRST scored card, budapest (3.125) the second.
    const scoredCards = page.cards.filter((card) => card.modelScore !== null);
    expect(scoredCards[0]!.candidate.itemId).toBe("wfxitm_01ARZ3NDEKF1XTVRE000000001");
    expect(scoredCards[1]!.candidate.itemId).toBe("wfxitm_01ARZ3NDEKF1XTVRE000000002");
  });

  it("items the model omits are carried unscored (null) with a trace decision — never invented, never dropped", async () => {
    const ctx = goldenCtx("watch");
    const page = await runRecommendation(ctx, { model: stubModel });
    const omitted = allDecisions(page).filter((d) => d.kind === "model-omitted-score");
    expect(omitted.length).toBe(10);
    const nullCards = page.cards.filter((card) => card.modelScore === null);
    expect(nullCards.length).toBe(10);
    for (const card of nullCards) {
      expect(card.confidence).toBeNull();
      expect(card.explanations).toHaveLength(0);
    }
    // Membership still complete: 12 distinct items.
    expect(new Set(page.cards.map((card) => card.candidate.itemId)).size).toBe(12);
  });

  it("policy decisions are recorded separately — the scoring stage carries no score modifications", async () => {
    const ctx = goldenCtx("watch");
    const page = await runRecommendation(ctx, { model: stubModel });
    const scoringStage = page.trace.stages.find((stage) => stage.stage === "scoring")!;
    for (const decision of scoringStage.decisions) {
      expect(decision.kind).toBe("model-omitted-score"); // nothing else, ever
    }
    const policyStage = page.trace.stages.find((stage) => stage.stage === "policy")!;
    const policyKinds = policyStage.decisions.map((decision) => decision.kind);
    expect(policyKinds).toContain("dedupe-kept");
    expect(policyKinds).toContain("availability-demotion");
    expect(policyKinds).toContain("attention-policy");
  });

  it("a model scoring an item outside the pool is a typed model-contract violation", async () => {
    const badModel: RecommendationModel = {
      id: "wfx-bad-model",
      version: "1.0.0",
      async score(): Promise<RecommendationScore[]> {
        return [{ itemId: "wfxitm_01ARZ3NDEKF1XTVRE00000000F", score: 1, explanations: [], confidence: 1 }];
      },
    };
    await expect(
      runRecommendation(goldenCtx("watch"), { model: badModel }),
    ).rejects.toThrow();
    try {
      await runRecommendation(goldenCtx("watch"), { model: badModel });
    } catch (error) {
      expect((error as RecommendationOSError).kind).toBe("model-contract");
    }
  });

  it("duplicate item scores and non-finite scores are typed model-contract violations", async () => {
    const ctx = goldenCtx("watch");
    const features = assembleFeatures(ctx);
    const dupModel: RecommendationModel = {
      id: "wfx-dup-model",
      version: "1.0.0",
      async score(): Promise<RecommendationScore[]> {
        const entry = {
          itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000001",
          score: 1,
          explanations: [],
          confidence: 1,
        };
        return [entry, entry];
      },
    };
    expect(
      await score(ctx, features, dupModel).then(
        () => undefined,
        (error: RecommendationOSError) => error,
      ),
    ).toBeInstanceOf(RecommendationOSError);
    const nanModel: RecommendationModel = {
      id: "wfx-nan-model",
      version: "1.0.0",
      async score(): Promise<RecommendationScore[]> {
        return [
          {
            itemId: "wfxitm_01ARZ3NDEKF1XTVRE000000001",
            score: Number.NaN,
            explanations: [],
            confidence: 1,
          },
        ];
      },
    };
    expect(
      await score(ctx, features, nanModel).then(
        () => undefined,
        (error: RecommendationOSError) => error,
      ),
    ).toBeInstanceOf(RecommendationOSError);
  });

  it("a model contract violation surfaces as a rejected promise from the pipeline (async stage)", async () => {
    const throwingModel: RecommendationModel = {
      id: "wfx-throwing-model",
      version: "1.0.0",
      async score(): Promise<RecommendationScore[]> {
        throw new Error("model exploded");
      },
    };
    // The model's own error propagates untouched — never rebranded.
    await expect(runRecommendation(goldenCtx("watch"), { model: throwingModel })).rejects.toThrow(
      "model exploded",
    );
  });
});

// ===========================================================================
// 8. Fatigue monotonicity (more repeats => higher fatigue => lower rank)
// ===========================================================================

describe("WFX-021 — repetition and fatigue monotonicity", () => {
  const monoCtx = (): RecommendationContext => {
    const items = [cid(51), cid(52), cid(53), cid(54)];
    return {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [],
      policy: policy(),
      recentEvents: [
        event(items[1]!, "complete", T_MINUS_1H), // item 1: one repeat
        event(items[2]!, "complete", T_MINUS_1H), // item 2: two repeats
        event(items[2]!, "start", "2026-09-13T10:30:00.000Z"),
        event(items[3]!, "complete", T_MINUS_1H), // item 3: three repeats
        event(items[3]!, "complete", "2026-09-13T10:30:00.000Z"),
        event(items[3]!, "complete", "2026-09-13T10:00:00.000Z"),
      ],
      candidatePool: items.map((itemId, index) =>
        candidate({ itemId, title: `Neutral Item ${index}`, durationMs: 600_000 }),
      ),
    };
  };

  it("strictly monotone: 0 < 1 < 2 < 3 repeats yields strictly descending ranks", async () => {
    const page = await runRecommendation(monoCtx());
    const positions = page.cards.map((card) => card.candidate.itemId);
    expect(positions).toEqual([cid(51), cid(52), cid(53), cid(54)]); // 0,1,2,3 repeats
    const scores = page.cards.map((card) => card.modelScore);
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
    expect(scores[1]!).toBeGreaterThan(scores[2]!);
    expect(scores[2]!).toBeGreaterThan(scores[3]!);
  });

  it("repetitionSignal is strictly monotone in repeat count (all else equal)", () => {
    const item = cid(60);
    const one = repetitionSignal(item, [event(item, "complete", T_MINUS_1H)], T_MINUS_1H);
    const two = repetitionSignal(
      item,
      [event(item, "complete", T_MINUS_1H), event(item, "start", T_MINUS_1H)],
      T_MINUS_1H,
    );
    const three = repetitionSignal(
      item,
      [
        event(item, "complete", T_MINUS_1H),
        event(item, "start", T_MINUS_1H),
        event(item, "progress", T_MINUS_1H),
      ],
      T_MINUS_1H,
    );
    expect(one.fatigue).toBeGreaterThan(0);
    expect(two.fatigue).toBeGreaterThan(one.fatigue);
    expect(three.fatigue).toBeGreaterThan(two.fatigue);
    expect(three.repetitionCount).toBe(3);
  });

  it("fatigue decays with age: a 30-day-old repeat weighs far less than a fresh one", () => {
    const item = cid(61);
    const fresh = repetitionSignal(item, [event(item, "complete", NOW)], NOW);
    const old = repetitionSignal(item, [event(item, "complete", T_MINUS_30D)], NOW);
    expect(old.fatigue).toBeCloseTo(1 / 31, 6);
    expect(fresh.fatigue).toBeCloseTo(1, 6);
  });
});

// ===========================================================================
// 9. Feature assembly (typed, deterministic, ctx-only)
// ===========================================================================

describe("WFX-021 — feature assembly (deterministic from ctx alone)", () => {
  it("assembles pool-aligned features: one record per candidate, repetition and availability included", () => {
    const ctx = goldenCtx("watch");
    const features = assembleFeatures(ctx);
    expect(features.byCandidate.length).toBe(ctx.candidatePool.length);
    expect(features.anchorAt).toBe(T_MINUS_1H);
    // Severance (2 realizations, both available): ratio 1.
    const severance = features.byCandidate.find(
      (f) => f.itemId === "wfxitm_01ARZ3NDEKF1XTVRE000000003",
    )!;
    expect(severance.availabilityRatio).toBe(1);
    expect(severance.realizationReports).toBe(2);
    // Stalker (1 realization, unavailable): ratio 0.
    const stalker = features.byCandidate.find(
      (f) => f.itemId === "wfxitm_01ARZ3NDEKF1XTVRE00000000C",
    )!;
    expect(stalker.availabilityRatio).toBe(0);
    // Severance has a progress event: repetition 1, fatigue 1 (age 0 vs anchor).
    expect(severance.repetitionCount).toBe(1);
    expect(severance.fatigue).toBeCloseTo(1, 6);
    // Dune is unseen (no events): exploration flag true.
    const dune = features.byCandidate.find(
      (f) => f.itemId === "wfxitm_01ARZ3NDEKF1XTVRE000000001",
    )!;
    expect(dune.unseen).toBe(true);
    expect(dune.dominantObjective).toBe("science fiction epics");
    expect(dune.intentMatchByScope.persistent).toBeCloseTo(0.9 * 0.85, 6);
  });

  it("freshness: publishedAt vs the event anchor; neutral when absent", () => {
    const ctx: RecommendationContext = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [],
      policy: policy(),
      recentEvents: [event(cid(70), "impression", NOW)],
      candidatePool: [
        candidate({ itemId: cid(71), title: "Fresh Release", publishedAt: NOW }),
        candidate({ itemId: cid(72), title: "Old Release", publishedAt: T_MINUS_30D }),
        candidate({ itemId: cid(73), title: "No Date Release" }),
      ],
    };
    const features = assembleFeatures(ctx);
    const fresh = features.byCandidate.find((f) => f.itemId === cid(71))!;
    const old = features.byCandidate.find((f) => f.itemId === cid(72))!;
    const none = features.byCandidate.find((f) => f.itemId === cid(73))!;
    expect(fresh.freshness).toBeCloseTo(1, 6);
    expect(old.freshness).toBeCloseTo(1 / 31, 6);
    expect(none.freshness).toBe(NEUTRAL_FRESHNESS);
    expect(old.ageDays).toBeCloseTo(30, 6);
  });

  it("duration/orientation fit differs per surface (watch vs short tables)", () => {
    const watchCtx: RecommendationContext = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [],
      policy: policy(),
      recentEvents: [],
      candidatePool: [candidate({ itemId: cid(81), title: "Long Horizontal", durationMs: 3_600_000, orientation: "horizontal" })],
    };
    const shortCtx: RecommendationContext = { ...watchCtx, surface: "short" };
    const watch = assembleFeatures(watchCtx).byCandidate[0]!;
    const short = assembleFeatures(shortCtx).byCandidate[0]!;
    expect(watch.durationFit).toBe(1); // 60 min >= 30 min target
    expect(watch.orientationFit).toBe(1); // horizontal fits watch
    expect(short.durationFit).toBeCloseTo(90_000 / 3_600_000, 6); // 90 s / 60 min
    expect(short.orientationFit).toBe(0); // horizontal does not fit short
  });
});

// ===========================================================================
// 10. The heuristic default model (explainable, policy-dial-respecting)
// ===========================================================================

describe("WFX-021 — heuristic default model", () => {
  it("explains every contributing term (intent, availability, fits, fatigue)", async () => {
    const ctx = goldenCtx("watch");
    const model = createHeuristicModel();
    const scores = await model.score(ctx);
    const dune = scores.find((entry) => entry.itemId === "wfxitm_01ARZ3NDEKF1XTVRE000000001")!;
    const joined = dune.explanations.join("\n");
    expect(joined).toContain('matches persistent intent "science fiction epics"');
    expect(joined).toContain("source availability 2/3");
    expect(joined).toContain("duration fit for watch");
    expect(joined).toContain("orientation fit for watch (horizontal)");
    expect(joined).toContain("unseen item — exploration appetite");
    // Severance was watched: its fatigue term is explained.
    const severance = scores.find(
      (entry) => entry.itemId === "wfxitm_01ARZ3NDEKF1XTVRE000000003",
    )!;
    expect(severance.explanations.join("\n")).toContain("fatigue: 1 recent repeat");
  });

  it("respects the exploration dial as a multiplier on the unseen feature", async () => {
    const mk = (exploration: number): RecommendationContext => ({
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [],
      policy: policy({ exploration }),
      recentEvents: [],
      candidatePool: [candidate({ itemId: cid(91), title: "Unseen Item", durationMs: 600_000 })],
    });
    const model = createHeuristicModel();
    const low = (await model.score(mk(0.1))).find((entry) => entry.itemId === cid(91))!;
    const high = (await model.score(mk(0.9))).find((entry) => entry.itemId === cid(91))!;
    expect(high.score - low.score).toBeCloseTo(HEURISTIC_EXPLORATION_BASE * (0.9 - 0.1), 6);
  });

  it("respects the novelty dial as a multiplier on freshness", async () => {
    const mk = (novelty: number): RecommendationContext => ({
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [],
      policy: policy({ novelty }),
      recentEvents: [event(cid(92), "impression", NOW)],
      candidatePool: [candidate({ itemId: cid(93), title: "Novel Item", durationMs: 600_000 })],
    });
    const model = createHeuristicModel();
    const low = (await model.score(mk(0.1))).find((entry) => entry.itemId === cid(93))!;
    const high = (await model.score(mk(0.9))).find((entry) => entry.itemId === cid(93))!;
    // freshness = 0.5 (publishedAt absent) -> difference = base * 0.8 * 0.5.
    expect(high.score - low.score).toBeCloseTo(HEURISTIC_NOVELTY_BASE * 0.8 * 0.5, 6);
  });

  it("respects the socialInfluence dial as a multiplier on social-scope match", async () => {
    const socialIntent: UserIntent = {
      id: "wfxint_01ARZ3NDEKF1XTVRE0000000084",
      userId: FIXTURE_USER_ID,
      scope: "social",
      objective: "comedy watch party",
      weight: 0.5,
      confidence: 0.8,
      provenance: "explicit",
    };
    const mk = (socialInfluence: number): RecommendationContext => ({
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [socialIntent],
      policy: policy({ socialInfluence }),
      recentEvents: [],
      candidatePool: [candidate({ itemId: cid(94), title: "Comedy Watch Party", durationMs: 600_000 })],
    });
    const model = createHeuristicModel();
    const low = (await model.score(mk(0.1))).find((entry) => entry.itemId === cid(94))!;
    const high = (await model.score(mk(0.9))).find((entry) => entry.itemId === cid(94))!;
    expect(high.score - low.score).toBeCloseTo(HEURISTIC_SOCIAL_BASE * 0.8 * 0.4, 6);
  });
});

// ===========================================================================
// 11. Diversity formulas and exploration injection
// ===========================================================================

describe("WFX-021 — intent-aware diversity (K and X formulas, exploration injection)", () => {
  it("K(exploration) = 1 + floor((1 - e) * 4), clamped to [1, 5]", () => {
    expect(diversityRunCap(policy({ exploration: 0 }))).toBe(5);
    expect(diversityRunCap(policy({ exploration: 0.2 }))).toBe(4);
    expect(diversityRunCap(policy({ exploration: 0.5 }))).toBe(3);
    expect(diversityRunCap(policy({ exploration: 0.75 }))).toBe(2);
    expect(diversityRunCap(policy({ exploration: 1 }))).toBe(1);
  });

  it("X(exploration) = 80 - e * 40, clamped to [40, 80]", () => {
    expect(diversityConcentrationThresholdPercent(policy({ exploration: 0 }))).toBe(80);
    expect(diversityConcentrationThresholdPercent(policy({ exploration: 0.5 }))).toBe(60);
    expect(diversityConcentrationThresholdPercent(policy({ exploration: 1 }))).toBe(40);
  });

  it("the mindful gap is the stricter cap: effectiveRunCap = min(K, mindful N)", () => {
    expect(effectiveRunCap(policy({ attentionMode: "mindful" }))).toBe(
      MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE,
    );
    expect(effectiveRunCap(policy({ attentionMode: "balanced" }))).toBe(4);
    expect(effectiveRunCap(policy({ attentionMode: "immersive" }))).toBe(4);
  });

  it("injects exploration candidates when the top block concentrates on one intent", async () => {
    const sci = (n: number) =>
      candidate({
        itemId: cid(100 + n),
        title: `Science Fiction Feature ${String(n).padStart(2, "0")}`,
        canonicalType: "movie",
        durationMs: 7_200_000,
      });
    const other = (n: number, topic: string) =>
      candidate({
        itemId: cid(200 + n),
        title: `${topic} Feature ${n}`,
        canonicalType: "movie",
        durationMs: 7_200_000,
      });
    const sciPool = Array.from({ length: 12 }, (_, n) => sci(n));
    const otherPool = [
      other(0, "comedy"),
      other(1, "comedy"),
      other(2, "history"),
      other(3, "craft"),
      other(4, "fitness"),
      other(5, "wellness"),
      other(6, "tech"),
      other(7, "travel"),
    ];
    const ctx: RecommendationContext = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [
        {
          id: "wfxint_01ARZ3NDEKF1XTVRE0000000085",
          userId: FIXTURE_USER_ID,
          scope: "persistent",
          objective: "science fiction epics",
          weight: 1,
          confidence: 1,
          provenance: "explicit",
        },
      ],
      policy: policy({ exploration: 0.8 }), // X = 48%
      recentEvents: [
        // The 12 sci-fi features were watched 30 days ago (decayed fatigue,
        // strong intent: they dominate the head).
        ...sciPool.map((c) => event(c.itemId, "complete", T_MINUS_30D)),
        // A fresh impression sets the session anchor (the OS's only clock).
        event(cid(200), "impression", NOW),
      ],
      candidatePool: [...sciPool, ...otherPool],
    };
    const page = await runRecommendation(ctx);
    const injections = allDecisions(page).filter((d) => d.kind === "exploration-injection");
    expect(injections.length).toBeGreaterThan(0);
    expect(injections[0]!.detail).toContain("science fiction epics");
    // The top block is diluted: at least 4 of the first 8 cards are NOT
    // sci-fi-dominant, and every pool item is still present.
    const top = page.cards.slice(0, Math.min(DIVERSITY_TOP_BLOCK_SIZE, page.cards.length));
    const nonSci = top.filter((card) => card.dominantObjective !== "science fiction epics");
    expect(nonSci.length).toBeGreaterThanOrEqual(4);
    expect(new Set(page.cards.map((card) => card.candidate.itemId)).size).toBe(20);
  });

  it("records an honest residual when concentration remains but no unseen candidates exist", async () => {
    // A monoculture pool: every candidate matches the same objective and has
    // been seen — injection is impossible and the trace says so.
    const sciPool = Array.from({ length: 4 }, (_, n) =>
      candidate({ itemId: cid(300 + n), title: `Science Fiction Only ${n}`, durationMs: 600_000 }),
    );
    const ctx: RecommendationContext = {
      userId: FIXTURE_USER_ID,
      sessionId: "wfx-test-session",
      surface: "watch",
      intents: [
        {
          id: "wfxint_01ARZ3NDEKF1XTVRE0000000086",
          userId: FIXTURE_USER_ID,
          scope: "persistent",
          objective: "science fiction epics",
          weight: 0.9,
          confidence: 0.9,
          provenance: "explicit",
        },
      ],
      policy: policy({ exploration: 0.8 }),
      recentEvents: sciPool.map((c) => event(c.itemId, "complete", T_MINUS_1H)),
      candidatePool: sciPool,
    };
    const page = await runRecommendation(ctx);
    const unsatisfied = allDecisions(page).filter(
      (d) => d.kind === "exploration-injection-unsatisfied",
    );
    expect(unsatisfied.length).toBeGreaterThan(0);
    expect(unsatisfied[0]!.detail).toContain("no unseen candidates");
    // The monoculture pool is still fully present (never narrowed).
    expect(page.cards.length).toBe(4);
  });
});

// ===========================================================================
// 12. Event signals (resume detection, anchors)
// ===========================================================================

describe("WFX-021 — event-derived signals (deterministic, ctx-only clock)", () => {
  it("in-progress detection follows the recency rule (newest start/progress vs newest complete)", () => {
    const item = cid(400);
    const startThenComplete = [
      event(item, "start", "2026-09-13T10:00:00.000Z"),
      event(item, "complete", "2026-09-13T11:00:00.000Z"),
    ];
    expect(inProgressItemIds(startThenComplete).has(item)).toBe(false);
    const rewatch = [
      event(item, "complete", "2026-09-13T10:00:00.000Z"),
      event(item, "progress", "2026-09-13T11:00:00.000Z"),
    ];
    expect(inProgressItemIds(rewatch).has(item)).toBe(true);
  });
});

// ===========================================================================
// 13. Typed failure paths (no fake success, no silent coercion)
// ===========================================================================

describe("WFX-021 — typed failure paths", () => {
  it("rejects a malformed surface, a foreign-user event, and a malformed candidate", () => {
    expectOSError(
      () => intakePool({ ...goldenCtx("watch"), surface: "long" as never }),
      "invalid-input",
    );
    expectOSError(
      () =>
        intakePool({
          ...goldenCtx("watch"),
          recentEvents: [event(cid(500), "complete", NOW, "wfx-other-user")],
        }),
      "invalid-input",
    );
    expectOSError(
      () =>
        intakePool({
          ...goldenCtx("watch"),
          candidatePool: [{ itemId: "x" } as unknown as EntertainmentCandidate],
        }),
      "invalid-input",
    );
  });

  it("rejects a features/pool misalignment in the scoring stage", async () => {
    const ctx = goldenCtx("watch");
    const features = assembleFeatures(ctx);
    const truncated = { byCandidate: features.byCandidate.slice(0, 3) };
    await expect(score(ctx, truncated, createHeuristicModel())).rejects.toThrow();
    try {
      await score(ctx, truncated, createHeuristicModel());
    } catch (error) {
      expect((error as RecommendationOSError).kind).toBe("invalid-input");
    }
  });

  it("rejects a malformed injected model", async () => {
    const error = await runRecommendation(goldenCtx("watch"), {
      model: { id: "", version: "1", score: async () => [] } as unknown as RecommendationModel,
    }).then(
      () => undefined,
      (caught: RecommendationOSError) => caught,
    );
    expect(error).toBeInstanceOf(RecommendationOSError);
    expect(error!.kind).toBe("invalid-input");
  });
});

// ===========================================================================
// 14. Purity and immutability laws
// ===========================================================================

describe("WFX-021 — purity laws (no hidden clocks, no randomness, frozen outputs)", () => {
  it("outputs are frozen: feed page, cards, trace", async () => {
    const page = await runRecommendation(goldenCtx("watch"));
    expect(Object.isFrozen(page)).toBe(true);
    for (const card of page.cards) expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(page.trace)).toBe(true);
    expect(Object.isFrozen(page.trace.stages)).toBe(true);
  });

  it("the source contains no hidden clock or randomness (deterministic by construction)", async () => {
    // Behavioral check: identical ctx -> identical output is already covered
    // by the golden tests; this greps the module sources for forbidden calls.
    const sources = [
      "src/os/attention.ts",
      "src/os/composition.ts",
      "src/os/diversity.ts",
      "src/os/events.ts",
      "src/os/fatigue.ts",
      "src/os/features.ts",
      "src/os/pipeline.ts",
      "src/os/policy.ts",
      "src/os/scoring.ts",
      "src/os/types.ts",
      "src/os/validate.ts",
    ];
    for (const relative of sources) {
      const text = await Bun.file(`${import.meta.dir}/../${relative}`).text();
      expect(text.includes("Date.now()")).toBe(false);
      expect(text.includes("Math.random")).toBe(false);
    }
  });
});
