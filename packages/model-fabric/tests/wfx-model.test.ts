/**
 * @wfx/model-fabric — WFX-031 first-party recommendation model adapter tests
 * (Lane A — intelligence).
 *
 * Covers the packet's required cases:
 * - Score determinism: fixed ctx → byte-identical outputs (run twice, plus a
 *   structurally-equal clone).
 * - Explanation completeness: every non-zero contribution has a line;
 *   explanations sum-check (signed contributions ≈ score − base; the wfx
 *   formula has no intercept, so base = 0).
 * - Surface weighting: session intent weighs more on `short` than `watch`
 *   for identical candidates.
 * - Fatigue monotonicity: more repeats ⇒ lower score, all else equal.
 * - Confidence: feature-missing ctx ⇒ lower confidence than complete ctx.
 * - Provider: task validation errors typed with paths; envelope correctness;
 *   privacy local-only; zero-cost typed.
 * - Registry: registers under both tasks; duplicate registration typed-refused.
 * - Swap contract: OS pipeline output shape identical with stub vs
 *   first-party (interface parity, not value equality).
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  ModelPolicy,
  RecommendationContext,
  RecommendationModel,
  RecommendationPolicy,
  RecommendationScore,
  UserIntent,
} from "@wfx/domain";

import { RecommendationOSError, type FeedPage } from "@wfx/recommendation";

import {
  assertModelContract,
  createModelSwapContract,
  createStubRecommendationModel,
  createWfxModelProvider,
  createWfxRecommendationModel,
  DuplicateProviderError,
  InvalidWfxModelVersionError,
  isInvocationId,
  ModelContractViolationError,
  ModelFabric,
  ModelFabricRegistry,
  registerWfxModel,
  WFX_CONFIDENCE_BASE,
  WFX_MODEL_ID,
  WFX_MODEL_VERSION,
  WFX_SCOPE_WEIGHTS,
  WFX_STUB_MODEL_ID,
  WfxModelProviderError,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

/** Canonical-shaped hand-authored item id: wfxitm_ + 26-char ULID body. */
function cid(n: number): string {
  return `wfxitm_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`;
}

/** The fixed "now" used across hand-built scenarios. */
const NOW = "2026-09-13T12:00:00.000Z";
const T_MINUS_1H = "2026-09-13T11:00:00.000Z";
const T_MINUS_30D = "2026-08-14T12:00:00.000Z";

/** A policy literal with a fixed deterministic id. */
function policy(over: Partial<RecommendationPolicy> = {}): RecommendationPolicy {
  return {
    id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
    userId: "wfx-test-user",
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
  return { userId: "wfx-test-user", itemId, type, occurredAt, sessionId: "wfx-test-session" };
}

/** An intent literal. */
function intent(
  scope: UserIntent["scope"],
  objective: string,
  weight: number,
  confidence: number,
  n: number,
): UserIntent {
  return {
    id: `wfxint_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`,
    userId: "wfx-test-user",
    scope,
    objective,
    weight,
    confidence,
    provenance: "explicit",
  };
}

/** A hand-built flat candidate. */
function candidate(over: {
  itemId: string;
  title: string;
  matchText?: string;
  durationMs?: number;
  orientation?: string;
  publishedAt?: string;
  availability?: "available" | "unknown" | "unavailable";
}): EntertainmentCandidate {
  return {
    itemId: over.itemId,
    realization: {
      connectorId: "wfx-test-native",
      externalRef: `ref-${over.itemId.slice(-4)}`,
      capabilities: ["identity", "metadata", "playNative"],
      availability: over.availability ?? "available",
    },
    features: {
      canonicalType: "video",
      canonicalTitle: over.title,
      matchText: over.matchText ?? `${over.title.toLowerCase()} video horizontal`,
      ...(over.durationMs !== undefined ? { durationMs: over.durationMs } : {}),
      ...(over.orientation !== undefined ? { orientation: over.orientation } : {}),
      ...(over.publishedAt !== undefined ? { publishedAt: over.publishedAt } : {}),
    },
  };
}

/** A context literal with defaults. */
function context(over: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    userId: "wfx-test-user",
    sessionId: "wfx-test-session",
    surface: "watch",
    intents: [],
    policy: policy(),
    recentEvents: [],
    candidatePool: [],
    ...over,
  };
}

/** The rich swap-context: intents, events, five heterogeneous candidates. */
function swapContext(): RecommendationContext {
  return context({
    surface: "watch",
    intents: [
      intent("persistent", "science fiction epics", 0.9, 0.85, 1),
      intent("session", "sci-fi", 0.8, 0.9, 2),
    ],
    recentEvents: [
      event(cid(3), "complete", T_MINUS_1H),
      event(cid(3), "complete", T_MINUS_1H),
      event(cid(4), "progress", T_MINUS_1H),
    ],
    candidatePool: [
      candidate({
        itemId: cid(1),
        title: "Dune Part Two",
        matchText: "dune part two science fiction sci-fi epic movie horizontal",
        publishedAt: T_MINUS_30D,
        durationMs: 9_960_000,
        orientation: "horizontal",
      }),
      candidate({
        itemId: cid(2),
        title: "Neon Horizon",
        matchText: "neon horizon science fiction sci-fi series vertical",
        publishedAt: T_MINUS_1H,
        durationMs: 45_000,
        orientation: "vertical",
      }),
      candidate({
        itemId: cid(3),
        title: "Stalker",
        matchText: "stalker science fiction sci-fi classic movie horizontal",
        publishedAt: T_MINUS_30D,
        durationMs: 6_300_000,
        orientation: "horizontal",
      }),
      candidate({
        itemId: cid(4),
        title: "Desk Setup Tour",
        matchText: "desk setup tour tech vertical",
        publishedAt: T_MINUS_30D,
        durationMs: 60_000,
        orientation: "vertical",
        availability: "unknown",
      }),
      candidate({
        itemId: cid(5),
        title: "Morning Stretch",
        matchText: "morning stretch routine fitness vertical",
        publishedAt: T_MINUS_30D,
        durationMs: 30_000,
        orientation: "vertical",
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trailing signed contribution of an explanation line (3-decimal rendering). */
const CONTRIBUTION_RE = / ([+-]\d+\.\d{3})$/;

/** Parse every explanation line's signed contribution. */
function parsedContributions(explanations: readonly string[]): number[] {
  const out: number[] = [];
  for (const line of explanations) {
    const match = CONTRIBUTION_RE.exec(line);
    if (match !== null) out.push(Number.parseFloat(match[1]!));
  }
  return out;
}

/** The parsed contribution of the session-intent line for one item. */
function sessionIntentContribution(
  scores: readonly RecommendationScore[],
  itemId: string,
): number {
  const entry = scores.find((score) => score.itemId === itemId);
  const line = entry?.explanations.find((value) =>
    value.startsWith("session-intent match 'sci-fi'"),
  );
  const match = line === undefined ? null : CONTRIBUTION_RE.exec(line);
  return match === null ? Number.NaN : Number.parseFloat(match[1]!);
}

/** The score of one item. */
function scoreOf(
  scores: readonly RecommendationScore[],
  itemId: string,
): number {
  const entry = scores.find((score) => score.itemId === itemId);
  if (entry === undefined) throw new Error(`no score for ${itemId}`);
  return entry.score;
}

/** Await fn expecting a rejection; returns the caught error. */
async function expectRejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the invocation to reject");
}

// ===========================================================================
// 1. The model — determinism
// ===========================================================================

describe("WFX-031 model — determinism", () => {
  it("identical ctx yields byte-identical outputs (run twice)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const ctx = swapContext();
    const first = await model.score(ctx);
    const second = await model.score(ctx);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("a structurally-equal clone of the ctx yields the same bytes (content, not identity)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const first = await model.score(swapContext());
    const cloned = await model.score(structuredClone(swapContext()));
    expect(JSON.stringify(cloned)).toBe(JSON.stringify(first));
  });

  it("the ctx is never mutated by a run (deep-equal before/after)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const ctx = swapContext();
    const before = JSON.stringify(ctx);
    await model.score(ctx);
    expect(JSON.stringify(ctx)).toBe(before);
  });

  it("output ordering is the total order: score desc, then itemId asc", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const scores = await model.score(swapContext());
    const expected = [...scores]
      .sort((a, b) =>
        a.score !== b.score ? b.score - a.score : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
      )
      .map((score) => score.itemId);
    expect(scores.map((score) => score.itemId)).toEqual(expected);
  });

  it("equal scores tie-break by itemId ascending", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    // Three twins with no events, no intents, and equal features: equal scores.
    const ctx = context({
      candidatePool: [
        candidate({ itemId: cid(2), title: "Beta" }),
        candidate({ itemId: cid(1), title: "Alpha" }),
        candidate({ itemId: cid(3), title: "Gamma" }),
      ],
    });
    const scores = await model.score(ctx);
    expect(scores.map((score) => score.itemId)).toEqual([cid(1), cid(2), cid(3)]);
    expect(new Set(scores.map((score) => score.score)).size).toBe(1);
  });

  it("an empty pool is an honest empty result, not an error", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const scores = await model.score(context());
    expect(scores).toEqual([]);
  });

  it("one score per DISTINCT canonical item (duplicates in the pool collapse)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const base = candidate({ itemId: cid(1), title: "Dune", matchText: "dune sci-fi movie" });
    const twin: EntertainmentCandidate = {
      ...base,
      realization: {
        connectorId: "wfx-test-cloud",
        externalRef: "ref-cloud-0001",
        capabilities: ["identity"],
        availability: "available",
      },
    };
    const scores = await model.score(context({ candidatePool: [base, twin] }));
    expect(scores.map((score) => score.itemId)).toEqual([cid(1)]);
  });

  it("malformed ctx rejects with the OS typed error — never silent empty scores", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const badCtx = { ...swapContext(), surface: "viral" } as unknown as RecommendationContext;
    const caught = await expectRejection(() => model.score(badCtx));
    expect(caught).toBeInstanceOf(RecommendationOSError);
    expect((caught as RecommendationOSError).kind).toBe("invalid-input");
    expect((caught as RecommendationOSError).details.join(" ")).toContain("surface");
  });
});

// ===========================================================================
// 2. The model — explanation completeness & sum-check
// ===========================================================================

describe("WFX-031 model — explanations", () => {
  it("every non-zero contributing term has its line (all term families covered)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const scores = await model.score(swapContext());
    const byItem = new Map(scores.map((score) => [score.itemId, score]));
    const dune = byItem.get(cid(1))!; // unseen, intent matches, fresh, available
    const stalker = byItem.get(cid(3))!; // fatigued (2 repeats), intent matches

    const duneLines = dune.explanations.join("\n");
    expect(duneLines).toContain("persistent-intent match 'science fiction epics'");
    expect(duneLines).toContain("session-intent match 'sci-fi'");
    expect(duneLines).toContain("freshness half-life ");
    expect(duneLines).toContain("source availability 1/1");
    expect(duneLines).toContain("unseen item — exploration appetite");
    expect(duneLines).not.toContain("fatigue ("); // unseen items carry no fatigue term

    const stalkerLines = stalker.explanations.join("\n");
    expect(stalkerLines).toContain("fatigue (2 recent repeat(s)");
    expect(stalkerLines).not.toContain("unseen item"); // seen items carry no exploration term

    const desk = byItem.get(cid(4))!;
    expect(desk.explanations.join("\n")).not.toContain("-intent match"); // no intent matched
    expect(desk.explanations.join("\n")).not.toContain("source availability"); // ratio 0 → term 0, line omitted
  });

  it("sum-check: the signed contributions sum to the score (base = 0 — no intercept)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const scores = await model.score(swapContext());
    expect(scores.length).toBeGreaterThan(0);
    for (const entry of scores) {
      const contributions = parsedContributions(entry.explanations);
      if (entry.score !== 0) {
        expect(contributions.length).toBeGreaterThan(0); // every non-zero score is explained
      }
      const sum = contributions.reduce((acc, value) => acc + value, 0);
      const tolerance = contributions.length * 0.0005 + 1e-9; // 3-decimal rendering per line
      expect(Math.abs(sum - entry.score)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("every explanation line carries a signed contribution and names its term", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const scores = await model.score(swapContext());
    for (const entry of scores) {
      for (const line of entry.explanations) {
        expect(CONTRIBUTION_RE.test(line)).toBe(true); // signed contribution on EVERY line
      }
    }
  });
});

// ===========================================================================
// 3. The model — surface weighting
// ===========================================================================

describe("WFX-031 model — surface weighting", () => {
  function weightingContext(surface: "watch" | "short"): RecommendationContext {
    return context({
      surface,
      intents: [intent("session", "sci-fi", 0.8, 0.9, 7)],
      recentEvents: [event(cid(99), "impression", NOW)], // session anchor only
      candidatePool: [
        candidate({
          itemId: cid(1),
          title: "Dune",
          matchText: "dune sci-fi epic movie",
          publishedAt: T_MINUS_30D,
          durationMs: 9_600_000,
          orientation: "horizontal",
        }),
      ],
    });
  }

  it("session intent weighs more on short than watch for identical candidates", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const watchScores = await model.score(weightingContext("watch"));
    const shortScores = await model.score(weightingContext("short"));

    const watchContribution = sessionIntentContribution(watchScores, cid(1));
    const shortContribution = sessionIntentContribution(shortScores, cid(1));
    expect(Number.isNaN(watchContribution)).toBe(false);
    expect(Number.isNaN(shortContribution)).toBe(false);
    expect(shortContribution).toBeGreaterThan(watchContribution);
  });

  it("with only a session intent, the total score is strictly higher on short (all other terms are surface-independent)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const watchScore = scoreOf(await model.score(weightingContext("watch")), cid(1));
    const shortScore = scoreOf(await model.score(weightingContext("short")), cid(1));
    expect(shortScore).toBeGreaterThan(watchScore);
  });

  it("the scope-weight tables: session is the highest scope on BOTH surfaces, and higher on short than watch", () => {
    expect(WFX_SCOPE_WEIGHTS.short.session).toBeGreaterThan(WFX_SCOPE_WEIGHTS.watch.session);
    for (const surface of ["watch", "short"] as const) {
      const weights = WFX_SCOPE_WEIGHTS[surface];
      const max = Math.max(...Object.values(weights));
      expect(weights.session).toBe(max); // session scope weighted highest for the requested surface
    }
  });
});

// ===========================================================================
// 4. The model — fatigue monotonicity
// ===========================================================================

describe("WFX-031 model — fatigue monotonicity", () => {
  function fatigueContext(repeats: number): RecommendationContext {
    return context({
      intents: [intent("session", "sci-fi", 0.8, 0.9, 8)],
      recentEvents: Array.from({ length: repeats }, () => event(cid(1), "complete", T_MINUS_1H)),
      candidatePool: [
        candidate({
          itemId: cid(1),
          title: "Stalker",
          matchText: "stalker sci-fi movie",
          publishedAt: T_MINUS_30D,
        }),
      ],
    });
  }

  it("more repeats ⇒ strictly lower score, all else equal (1 < 2 < 3 repeats)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const one = scoreOf(await model.score(fatigueContext(1)), cid(1));
    const two = scoreOf(await model.score(fatigueContext(2)), cid(1));
    const three = scoreOf(await model.score(fatigueContext(3)), cid(1));
    expect(three).toBeLessThan(two);
    expect(two).toBeLessThan(one);
  });

  it("the fatigue term is unclamped — the score keeps decreasing with many repeats", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const ten = scoreOf(await model.score(fatigueContext(10)), cid(1));
    const twenty = scoreOf(await model.score(fatigueContext(20)), cid(1));
    expect(twenty).toBeLessThan(ten);
    expect(twenty).toBeLessThan(0); // the penalty is never saturated
  });
});

// ===========================================================================
// 5. The model — confidence from feature completeness
// ===========================================================================

describe("WFX-031 model — confidence", () => {
  function confidenceContext(stripped: boolean): RecommendationContext {
    const full = candidate({
      itemId: cid(1),
      title: "Dune",
      matchText: "dune sci-fi movie",
      publishedAt: T_MINUS_30D,
      durationMs: 9_600_000,
      orientation: "horizontal",
    });
    const bare: EntertainmentCandidate = {
      itemId: cid(1),
      realization: {
        connectorId: "wfx-test-native",
        externalRef: "ref-0001",
        capabilities: ["identity"],
        availability: "available",
      },
      features: { canonicalType: "video" }, // no text surface, no age, no duration, no orientation
    };
    return context({
      intents: [intent("session", "sci-fi", 0.8, 0.9, 9)],
      recentEvents: [event(cid(99), "impression", NOW)], // anchor present, item unseen
      candidatePool: [stripped ? bare : full],
    });
  }

  it("feature-missing ctx ⇒ lower confidence than complete ctx", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const complete = (await model.score(confidenceContext(false)))[0]!;
    const missing = (await model.score(confidenceContext(true)))[0]!;
    expect(missing.confidence).toBeLessThan(complete.confidence);
  });

  it("complete features ⇒ confidence 1; all four signals missing ⇒ the documented base, never a silent zero", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    const complete = (await model.score(confidenceContext(false)))[0]!;
    const missing = (await model.score(confidenceContext(true)))[0]!;
    expect(complete.confidence).toBe(1);
    expect(missing.confidence).toBe(WFX_CONFIDENCE_BASE);
    expect(missing.confidence).toBeGreaterThan(0);
  });

  it("unknown age is recorded honestly (neutral decay line) rather than silently zeroed", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    // No events → no session anchor → age unknown → neutral 0.5 decay.
    const ctx = context({
      candidatePool: [candidate({ itemId: cid(1), title: "Dune", matchText: "dune sci-fi movie" })],
    });
    const entry = (await model.score(ctx))[0]!;
    expect(entry.explanations.join("\n")).toContain("unknown age — neutral 0.500");
  });
});

// ===========================================================================
// 6. The model — version validation
// ===========================================================================

describe("WFX-031 model — version validation", () => {
  it("accepts valid semver (release, prerelease, build) and carries it verbatim", () => {
    for (const version of ["1.0.0", "1.2.3", "1.0.0-beta.1", "2.0.0+build.5"]) {
      const model = createWfxRecommendationModel(version);
      expect(model.id).toBe(WFX_MODEL_ID);
      expect(model.version).toBe(version);
    }
  });

  it("rejects invalid semver with the typed construction error", () => {
    for (const bad of ["1.0", "v1.0.0", "01.0.0", "1.0.0.0", "", "latest"]) {
      let caught: unknown;
      try {
        createWfxRecommendationModel(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvalidWfxModelVersionError);
      expect((caught as InvalidWfxModelVersionError).version).toBe(bad);
    }
  });
});

// ===========================================================================
// 7. The provider
// ===========================================================================

describe("WFX-031 provider — routing & typed validation", () => {
  it("routes to the wrapped first-party model (identical output)", async () => {
    const provider = createWfxModelProvider();
    expect(provider.id).toBe(WFX_MODEL_ID);
    expect(provider.model.id).toBe(WFX_MODEL_ID);
    expect(provider.model.version).toBe(WFX_MODEL_VERSION);
    const ctx = swapContext();
    const viaProvider = await provider.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      ctx,
    );
    const viaModel = await provider.model.score(ctx);
    expect(JSON.stringify(viaProvider)).toBe(JSON.stringify(viaModel));
  });

  it("serves BOTH declared tasks (recommendation and ranking)", async () => {
    const provider = createWfxModelProvider();
    expect(provider.capabilities).toEqual(["recommendation", "ranking"]);
    const ctx = swapContext();
    const asRecommendation = await provider.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      ctx,
    );
    const asRanking = await provider.invoke<RecommendationContext, RecommendationScore[]>(
      "ranking",
      ctx,
    );
    expect(JSON.stringify(asRanking)).toBe(JSON.stringify(asRecommendation));
  });

  it("task validation: an unsupported task rejects with a TYPED error naming task and supported set", async () => {
    const provider = createWfxModelProvider();
    const caught = await expectRejection(() =>
      provider.invoke<RecommendationContext, RecommendationScore[]>("summary", swapContext()),
    );
    expect(caught).toBeInstanceOf(WfxModelProviderError);
    const typed = caught as WfxModelProviderError;
    expect(typed.kind).toBe("unsupported-task");
    expect(typed.details.join(" ")).toContain("summary");
    expect(typed.details.join(" ")).toContain("recommendation, ranking");
  });

  it("input validation: a malformed context rejects typed, with FIELD PATHS in details", async () => {
    const provider = createWfxModelProvider();
    const badCtx = {
      ...swapContext(),
      surface: "viral",
      candidatePool: [{ ...candidate({ itemId: "", title: "Broken" }) }],
    } as unknown as RecommendationContext;
    const caught = await expectRejection(() =>
      provider.invoke<RecommendationContext, RecommendationScore[]>("recommendation", badCtx),
    );
    expect(caught).toBeInstanceOf(WfxModelProviderError);
    const typed = caught as WfxModelProviderError;
    expect(typed.kind).toBe("invalid-input");
    const details = typed.details.join("\n");
    expect(details).toContain("surface:");
    expect(details).toContain("candidatePool[0]");
  });

  it("input validation: a non-object input rejects typed — never silent empty scores", async () => {
    const provider = createWfxModelProvider();
    const caught = await expectRejection(() =>
      provider.invoke<null, RecommendationScore[]>("recommendation", null),
    );
    expect(caught).toBeInstanceOf(WfxModelProviderError);
    expect((caught as WfxModelProviderError).kind).toBe("invalid-input");
  });

  it("never throws raw: an unexpected underlying-model failure is re-typed", async () => {
    const throwing: RecommendationModel = {
      id: "throwing-stub",
      version: "1.0.0",
      async score() {
        throw new Error("deliberate model failure");
      },
    };
    const provider = createWfxModelProvider({ model: throwing });
    const caught = await expectRejection(() =>
      provider.invoke<RecommendationContext, RecommendationScore[]>("recommendation", swapContext()),
    );
    expect(caught).toBeInstanceOf(WfxModelProviderError);
    const typed = caught as WfxModelProviderError;
    expect(typed.kind).toBe("model-failure");
    expect(typed.details.join(" ")).toContain("deliberate model failure");
  });

  it("an injected stub model flows through the SAME adapter (model-agnostic seam)", async () => {
    const stub = createStubRecommendationModel();
    const provider = createWfxModelProvider({ model: stub });
    const viaProvider = await provider.invoke<RecommendationContext, RecommendationScore[]>(
      "ranking",
      swapContext(),
    );
    const viaStub = await stub.score(swapContext());
    expect(JSON.stringify(viaProvider)).toBe(JSON.stringify(viaStub));
  });

  it("version option: the default model version is parameterizable", () => {
    const provider = createWfxModelProvider({ version: "2.1.0" });
    expect(provider.model.version).toBe("2.1.0");
    expect(() => createWfxModelProvider({ version: "not-semver" })).toThrow(
      InvalidWfxModelVersionError,
    );
  });
});

describe("WFX-031 provider — privacy & cost (by construction)", () => {
  it("registers as local privacy — eligible for local-only policies", () => {
    const provider = createWfxModelProvider();
    expect(provider.privacy).toBe("local");
  });

  it("cost is a TYPED ZERO for both served tasks, and undeclared for unserved tasks", () => {
    const provider = createWfxModelProvider();
    expect(provider.costPerOperation("recommendation")).toBe(0);
    expect(provider.costPerOperation("ranking")).toBe(0);
    expect(typeof provider.costPerOperation("recommendation")).toBe("number");
    expect(provider.costPerOperation("summary")).toBeUndefined();
    expect(provider.costPerOperation("translation")).toBeUndefined();
  });

  it("the adapter source performs no import of any network capability (local-only by construction)", () => {
    const wfxModelDir = join(import.meta.dir, "../src/wfx-model");
    const forbidden = [
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
      "node:dgram",
      "node:undici",
      "fetch(",
      "WebSocket",
      "XMLHttpRequest",
      "require(",
    ];
    const files = readdirSync(wfxModelDir).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = readFileSync(join(wfxModelDir, file), "utf8");
      for (const token of forbidden) {
        if (source.includes(token)) {
          throw new Error(
            `local-only violation: '${token}' found in packages/model-fabric/src/wfx-model/${file}`,
          );
        }
      }
    }
  });
});

// ===========================================================================
// 8. Registry glue + gateway envelope
// ===========================================================================

describe("WFX-031 registry — registration under both tasks", () => {
  it("registers the provider for recommendation AND ranking via the merged WFX-030 registry API", () => {
    const registry = new ModelFabricRegistry();
    const provider = registerWfxModel(registry);
    expect(provider.id).toBe(WFX_MODEL_ID);
    expect(registry.size()).toBe(1);
    expect(registry.providersFor("recommendation").map((entry) => entry.id)).toEqual([
      WFX_MODEL_ID,
    ]);
    expect(registry.providersFor("ranking").map((entry) => entry.id)).toEqual([WFX_MODEL_ID]);
    expect(registry.providersFor("summary")).toEqual([]);

    const described = registry.describe();
    expect(described.byTask.recommendation).toEqual([WFX_MODEL_ID]);
    expect(described.byTask.ranking).toEqual([WFX_MODEL_ID]);
    expect(described.providers[0]!.privacy).toBe("local");
  });

  it("duplicate registration is typed-refused (DuplicateProviderError, registry unchanged)", () => {
    const registry = new ModelFabricRegistry();
    registerWfxModel(registry);
    let caught: unknown;
    try {
      registerWfxModel(registry);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DuplicateProviderError);
    expect((caught as DuplicateProviderError).id).toBe(WFX_MODEL_ID);
    expect(registry.size()).toBe(1);
    expect(registry.providersFor("recommendation").map((entry) => entry.id)).toEqual([
      WFX_MODEL_ID,
    ]);
  });

  it("options flow through the glue (a parameterized version registers)", () => {
    const registry = new ModelFabricRegistry();
    const provider = registerWfxModel(registry, { version: "3.0.0" });
    expect(provider.model.version).toBe("3.0.0");
  });
});

describe("WFX-031 provider — fabric gateway envelope correctness", () => {
  function localOnlyPolicy(task: ModelPolicy["task"]): ModelPolicy {
    return { task, fallbackProviders: [WFX_MODEL_ID], privacy: "local-only" };
  }

  it("through the gateway: ok envelope wraps the scores; the trace reports the typed zero cost", async () => {
    const registry = new ModelFabricRegistry();
    registerWfxModel(registry);
    const fabric = new ModelFabric(registry);
    const ctx = swapContext();

    const result = await fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      ctx,
      localOnlyPolicy("recommendation"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.map((score) => score.itemId).sort()).toEqual(
        ctx.candidatePool.map((entry) => entry.itemId).sort(),
      );
      expect(result.trace.providerId).toBe(WFX_MODEL_ID);
      expect(result.trace.taskId).toBe("recommendation");
      expect(result.trace.fallbacks).toEqual([]);
      expect("cost" in result.trace).toBe(true); // typed cost-report PRESENT
      expect(result.trace.cost).toBe(0); // ...and it is zero, not undefined
      expect(isInvocationId(result.trace.invocationId)).toBe(true);
    }
  });

  it("through the gateway: invalid input is a typed provider-error — never fake success", async () => {
    const registry = new ModelFabricRegistry();
    registerWfxModel(registry);
    const fabric = new ModelFabric(registry);
    const badCtx = { ...swapContext(), surface: "viral" } as unknown as RecommendationContext;

    const result = await fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      badCtx,
      localOnlyPolicy("recommendation"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider-error");
      if (result.error.kind === "provider-error") {
        expect(result.error.providerId).toBe(WFX_MODEL_ID);
        expect(result.error.detail).toContain("surface"); // the field path survives the envelope
        expect(result.error.detail).toContain("invalid-input");
      }
      expect(result.trace).toBeDefined(); // provider failures always carry the trace
    }
  });

  it("through the gateway: the local-only policy routes to the local provider end-to-end", async () => {
    const registry = new ModelFabricRegistry();
    registerWfxModel(registry);
    const fabric = new ModelFabric(registry);
    const ranking = await fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "ranking",
      swapContext(),
      localOnlyPolicy("ranking"),
    );
    expect(ranking.ok).toBe(true);
    if (ranking.ok) {
      expect(ranking.trace.providerId).toBe(WFX_MODEL_ID);
      expect(ranking.trace.cost).toBe(0);
    }
  });
});

// ===========================================================================
// 9. Replaceability — the swap contract
// ===========================================================================

describe("WFX-031 replaceability — assertModelContract", () => {
  it("the first-party model satisfies the contract (shape, output, determinism)", async () => {
    const model = createWfxRecommendationModel(WFX_MODEL_VERSION);
    await assertModelContract(model); // built-in probe context
    await assertModelContract(model, swapContext()); // the richer test context
  });

  it("the stub model satisfies the SAME contract", async () => {
    await assertModelContract(createStubRecommendationModel());
  });

  it("a model scoring an item outside the pool violates the contract (typed, with the OS detail)", async () => {
    const alien: RecommendationModel = {
      id: "alien-model",
      version: "1.0.0",
      async score() {
        return [
          { itemId: "not-in-any-pool", score: 1, explanations: ["alien +1.000"], confidence: 1 },
        ];
      },
    };
    let caught: unknown;
    try {
      await assertModelContract(alien);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelContractViolationError);
    expect((caught as ModelContractViolationError).details.join(" ")).toContain("not-in-any-pool");
  });

  it("a non-deterministic model violates the contract (byte-identical output is required)", async () => {
    let flip = false;
    const flaky: RecommendationModel = {
      id: "flaky-model",
      version: "1.0.0",
      async score(ctx: RecommendationContext) {
        flip = !flip;
        const score = flip ? 0.6 : 0.5;
        return ctx.candidatePool.map((entry) => ({
          itemId: entry.itemId,
          score,
          explanations: [`flaky ${score.toFixed(3)}`],
          confidence: 0.5,
        }));
      },
    };
    let caught: unknown;
    try {
      await assertModelContract(flaky);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelContractViolationError);
    expect((caught as ModelContractViolationError).details.join(" ")).toContain("determinism");
  });

  it("a malformed model shape violates the contract (typed shape check first)", async () => {
    const malformed = { id: "", version: "" } as unknown as RecommendationModel;
    let caught: unknown;
    try {
      await assertModelContract(malformed);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelContractViolationError);
    expect((caught as ModelContractViolationError).details.length).toBeGreaterThan(0);
  });
});

describe("WFX-031 replaceability — the swap contract over the OS pipeline", () => {
  it("the same OS pipeline runs against the stub and the first-party model through the SAME interface", async () => {
    const contract = createModelSwapContract(swapContext());
    const stubPage = await contract.runWith(createStubRecommendationModel());
    const wfxPage = await contract.runWith(createWfxRecommendationModel(WFX_MODEL_VERSION));

    // The OS carries each injected model's identity VERBATIM — no hardcoding.
    expect(stubPage.trace.model.id).toBe(WFX_STUB_MODEL_ID);
    expect(wfxPage.trace.model.id).toBe(WFX_MODEL_ID);
    expect(wfxPage.trace.model.version).toBe(WFX_MODEL_VERSION);

    // Interface parity — not value equality.
    const parity = contract.parity(stubPage, wfxPage);
    expect(parity.ok).toBe(true);
    expect(parity.differences).toEqual([]);
  });

  it("prove(): the one-call replaceability proof (stub vs first-party)", async () => {
    const contract = createModelSwapContract(swapContext());
    const parity = await contract.prove();
    expect(parity.ok).toBe(true);
    expect(parity.differences).toEqual([]);
  });

  it("the two models are GENUINELY different (values differ — parity is interface-level only)", async () => {
    const contract = createModelSwapContract(swapContext());
    const stubPage = await contract.runWith(createStubRecommendationModel());
    const wfxPage = await contract.runWith(createWfxRecommendationModel(WFX_MODEL_VERSION));
    const stubScores = JSON.stringify(stubPage.cards.map((card) => card.modelScore));
    const wfxScores = JSON.stringify(wfxPage.cards.map((card) => card.modelScore));
    expect(stubScores).not.toBe(wfxScores);

    // ...yet every distinct pool item appears exactly once under BOTH models.
    const stubIds = new Set(stubPage.cards.map((card) => card.candidate.itemId));
    const wfxIds = new Set(wfxPage.cards.map((card) => card.candidate.itemId));
    expect(stubIds.size).toBe(swapContext().candidatePool.length);
    expect(wfxIds.size).toBe(swapContext().candidatePool.length);
    expect(stubIds).toEqual(wfxIds);
  });

  it("parity detects shape drift (a malformed page is refused with field-level differences)", async () => {
    const contract = createModelSwapContract(swapContext());
    const good = await contract.runWith(createStubRecommendationModel());

    const wrongType = {
      ...good,
      cards: [{ ...good.cards[0]!, modelScore: "high" }],
    } as unknown as FeedPage;
    const typeParity = contract.parity(good, wrongType);
    expect(typeParity.ok).toBe(false);
    expect(typeParity.differences.some((line) => line.includes("modelScore"))).toBe(true);

    const emptyCards = { ...good, cards: [] } as unknown as FeedPage;
    const lengthParity = contract.parity(good, emptyCards);
    expect(lengthParity.ok).toBe(false);
    expect(lengthParity.differences.some((line) => line.includes("cards.length"))).toBe(true);
  });

  it("a malformed bound context is a typed construction error (the control variable must be valid)", () => {
    const bad = { ...swapContext(), surface: "viral" } as unknown as RecommendationContext;
    let caught: unknown;
    try {
      createModelSwapContract(bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RecommendationOSError);
    expect((caught as RecommendationOSError).kind).toBe("invalid-input");
  });
});
