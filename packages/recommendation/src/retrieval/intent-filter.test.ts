import { describe, expect, it } from "bun:test";

import {
  FIXTURE_INTENTS,
  INTENT_MATCH_MIN_TOKEN_LENGTH,
  RETRIEVAL_NOW,
  buildFixtureIndex,
  rankForIntents,
  RetrievalError,
  type RetrievedCandidate,
} from "../../src/index";
import type { UserIntent } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runs fn expecting a RetrievalError; asserts kind and returns the error. */
function expectRetrievalError(fn: () => void): RetrievalError {
  try {
    fn();
  } catch (error) {
    const retrievalError = error as RetrievalError;
    expect(retrievalError).toBeInstanceOf(RetrievalError);
    expect(retrievalError.kind).toBe("invalid-input");
    expect(retrievalError.details.length).toBeGreaterThan(0);
    return retrievalError;
  }
  throw new Error("expected a RetrievalError to be thrown");
}

/** A minimal hand-built RetrievedCandidate with the given match surface. */
function candidateWithSurface(matchText: string, id = `hand-${matchText}`): RetrievedCandidate {
  return {
    candidate: {
      itemId: id,
      realization: {
        connectorId: "wfx-test-native",
        externalRef: `ref-${id}`,
        capabilities: ["metadata"],
        availability: "available",
      },
      features: { matchText },
    },
    sourceRealizations: [],
    matchedObjectives: [],
    retrievedAt: RETRIEVAL_NOW,
  };
}

function intent(overrides: Partial<UserIntent> & { objective: string }): UserIntent {
  return {
    id: "wfxint_01ARZ3NDEK1NTENT0000000099",
    userId: "wfx-user-fixture",
    scope: "persistent",
    weight: 0.5,
    confidence: 1,
    provenance: "explicit",
    ...overrides,
  };
}

/** Membership fingerprint of a candidate list (order-insensitive). */
function membershipOf(candidates: readonly RetrievedCandidate[]): string[] {
  return candidates
    .map((entry) => `${entry.candidate.itemId}:${entry.candidate.realization.externalRef}`)
    .sort();
}

/** The full fixture candidate pool (19 candidates, insertion order). */
function fixturePool(): RetrievedCandidate[] {
  const index = buildFixtureIndex();
  return index.query({ limit: 100 });
}

/** Canonical titles of a candidate list. */
function titlesOf(candidates: readonly RetrievedCandidate[]): string[] {
  return candidates.map((entry) => String(entry.candidate.features.canonicalTitle));
}

// ---------------------------------------------------------------------------
// The anti-tunnel-vision law
// ---------------------------------------------------------------------------

describe("rankForIntents — the anti-tunnel-vision law (never removes, never narrows)", () => {
  it("returns a permutation: same length, same members, no duplicates", () => {
    const pool = fixturePool();
    const ranked = rankForIntents(pool, FIXTURE_INTENTS);
    expect(ranked).toHaveLength(pool.length);
    expect(membershipOf(ranked)).toEqual(membershipOf(pool));
    expect(new Set(membershipOf(ranked)).size).toBe(ranked.length);
  });

  it("ranks the full fixture pool deterministically (score desc, insertion tiebreak)", () => {
    const ranked = rankForIntents(fixturePool(), FIXTURE_INTENTS);
    expect(titlesOf(ranked)).toEqual([
      // 1.215 — matches BOTH the persistent sci-fi intent and the space intent.
      "Kurzgesagt: The Last Human",
      "Kurzgesagt: The Last Human",
      // 0.765 — the persistent sci-fi intent only; insertion order within the tie.
      "Dune: Part Two",
      "Dune: Part Two",
      "Dune: Part Two",
      "Severance",
      "Severance",
      "Severance S2E1: Hello, Ms. Casey",
      "Stalker",
      // 0.56 — the momentary lo-fi audio intent (token "lo-fi" / type "audio").
      "Lo-Fi Study Beats Vol. 4",
      "Lo-Fi Study Beats Vol. 4",
      "The History of Rome - Episode 1",
      // 0.45 — session/social intent matches (incl. the documented 3-char
      // function-word token "for" in the ULID post's title).
      "The Grand Budapest Hotel",
      "Morning Stretch Routine",
      "Morning Stretch Routine",
      "Desk Setup Tour 2026",
      "Desk Setup Tour 2026",
      "Deep-dive: why ULIDs beat UUIDs for content ids",
      // 0 — no match: still present, ranked by insertion order in the tail.
      "Folding a Paper Crane in 4K",
    ]);
  });

  it("NEVER mutates the input array or its candidate objects", () => {
    const pool = fixturePool();
    const snapshot = titlesOf(pool);
    const snapshotObjectives = pool.map((entry) => entry.matchedObjectives.length);
    rankForIntents(pool, FIXTURE_INTENTS);
    expect(titlesOf(pool)).toEqual(snapshot);
    expect(pool.map((entry) => entry.matchedObjectives.length)).toEqual(snapshotObjectives);
  });

  it("empty candidates and empty intents are results, not errors", () => {
    expect(rankForIntents([], FIXTURE_INTENTS)).toEqual([]);
    const pool = fixturePool();
    const noop = rankForIntents(pool, []);
    expect(titlesOf(noop)).toEqual(titlesOf(pool));
    expect(noop.every((entry) => entry.matchedObjectives.length === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Matching semantics
// ---------------------------------------------------------------------------

describe("rankForIntents — matching semantics", () => {
  it("more matched intents outrank fewer; stronger intents outrank weaker", () => {
    const strong = candidateWithSurface("alpha beta");
    const twoWeak = candidateWithSurface("beta gamma");
    const none = candidateWithSurface("zeta");
    const intents = [
      intent({ objective: "alpha", weight: 1, confidence: 1 }), // strong: 1.0
      intent({ objective: "beta", weight: 0.3, confidence: 0.5 }), // weak: 0.15
      intent({ objective: "gamma", weight: 0.3, confidence: 0.5 }), // weak: 0.15
    ];
    const ranked = rankForIntents([twoWeak, strong, none], intents);
    // strong (1.0) > twoWeak (0.15 + 0.15 = 0.3) > none (0).
    expect(ranked.map((entry) => entry.candidate.itemId)).toEqual([
      "hand-alpha beta",
      "hand-beta gamma",
      "hand-zeta",
    ]);
  });

  it("matching two intents beats matching one when strengths are comparable", () => {
    const both = candidateWithSurface("alpha beta");
    const one = candidateWithSurface("alpha only");
    const intents = [
      intent({ objective: "alpha", weight: 0.5, confidence: 1 }),
      intent({ objective: "beta", weight: 0.5, confidence: 1 }),
    ];
    const ranked = rankForIntents([one, both], intents);
    expect(ranked.map((entry) => entry.candidate.itemId)).toEqual([
      "hand-alpha beta",
      "hand-alpha only",
    ]);
  });

  it("ties keep insertion order (STABLE)", () => {
    const first = candidateWithSurface("same text", "tie-first");
    const second = candidateWithSurface("same text", "tie-second");
    const third = candidateWithSurface("same text", "tie-third");
    const ranked = rankForIntents([third, first, second], [intent({ objective: "same" })]);
    expect(ranked.map((entry) => entry.candidate.itemId)).toEqual([
      "tie-third",
      "tie-first",
      "tie-second",
    ]);
  });

  it("enriches matchedObjectives in intent order and freezes the output", () => {
    const pool = fixturePool();
    const ranked = rankForIntents(pool, FIXTURE_INTENTS);
    const kurzgesagt = ranked.find(
      (entry) => entry.candidate.features.canonicalTitle === "Kurzgesagt: The Last Human",
    );
    expect(kurzgesagt?.matchedObjectives).toEqual([
      "science fiction epics",
      "space documentaries",
    ]);
    const dune = ranked.find(
      (entry) => entry.candidate.features.canonicalTitle === "Dune: Part Two",
    );
    expect(dune?.matchedObjectives).toEqual(["science fiction epics"]);
    const crane = ranked.find(
      (entry) => entry.candidate.features.canonicalTitle === "Folding a Paper Crane in 4K",
    );
    expect(crane?.matchedObjectives).toEqual([]);
    for (const entry of ranked) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.matchedObjectives)).toBe(true);
    }
  });

  it("objective tokens shorter than the minimum never match", () => {
    expect(INTENT_MATCH_MIN_TOKEN_LENGTH).toBe(3);
    const surface = candidateWithSurface("xx yy zzz");
    const shortOnly = rankForIntents([surface], [intent({ objective: "of a to" })]);
    expect(shortOnly[0]?.matchedObjectives).toEqual([]);
    // A token of exactly the minimum length does match.
    const minToken = rankForIntents([surface], [intent({ objective: "zzz" })]);
    expect(minToken[0]?.matchedObjectives).toEqual(["zzz"]);
  });

  it("falls back to canonicalTitle when matchText is absent; no surface matches nothing", () => {
    const titled: RetrievedCandidate = {
      candidate: {
        itemId: "titled",
        realization: {
          connectorId: "c",
          externalRef: "r",
          capabilities: [],
          availability: "unknown",
        },
        features: { canonicalTitle: "Dune: Part Two" },
      },
      sourceRealizations: [],
      matchedObjectives: [],
      retrievedAt: RETRIEVAL_NOW,
    };
    const bare: RetrievedCandidate = {
      candidate: {
        itemId: "bare",
        realization: {
          connectorId: "c",
          externalRef: "r2",
          capabilities: [],
          availability: "unknown",
        },
        features: {},
      },
      sourceRealizations: [],
      matchedObjectives: [],
      retrievedAt: RETRIEVAL_NOW,
    };
    const ranked = rankForIntents([bare, titled], [intent({ objective: "DUNE" })]);
    expect(ranked.map((entry) => entry.candidate.itemId)).toEqual(["titled", "bare"]);
    expect(ranked[0]?.matchedObjectives).toEqual(["DUNE"]);
    expect(ranked[1]?.matchedObjectives).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("rankForIntents — typed input validation", () => {
  it("rejects non-array arguments", () => {
    expectRetrievalError(() =>
      rankForIntents(null as unknown as readonly RetrievedCandidate[], []),
    );
    expectRetrievalError(() =>
      rankForIntents([], null as unknown as readonly UserIntent[]),
    );
  });

  it("rejects malformed candidates with indexed field details", () => {
    const error = expectRetrievalError(() =>
      rankForIntents([null as unknown as RetrievedCandidate, candidateWithSurface("ok")], []),
    );
    expect(error.details.some((detail) => detail.startsWith("candidates[0]"))).toBe(true);
  });

  it("rejects malformed intents with indexed field details", () => {
    const base = { ...intent({ objective: "ok" }) };
    expectRetrievalError(() =>
      rankForIntents([], [{ ...base, weight: 1.5 }]),
    );
    expectRetrievalError(() =>
      rankForIntents([], [{ ...base, scope: "eternal" as UserIntent["scope"] }]),
    );
    expectRetrievalError(() =>
      rankForIntents([], [{ ...base, objective: "   " }]),
    );
    expectRetrievalError(() =>
      rankForIntents([], [{ ...base, provenance: "guessed" as UserIntent["provenance"] }]),
    );
    expectRetrievalError(() =>
      rankForIntents([], [{ ...base, confidence: Number.NaN }]),
    );
    expectRetrievalError(() =>
      rankForIntents([], [{ ...base, expiresAt: "soon" }]),
    );
    const aggregate = expectRetrievalError(() =>
      rankForIntents(
        [],
        [
          { ...base, weight: 2 },
          { ...base, scope: "dream" as UserIntent["scope"] },
        ],
      ),
    );
    expect(aggregate.details).toHaveLength(2);
  });

  it("accepts every fixture intent without throwing", () => {
    expect(() => rankForIntents([], FIXTURE_INTENTS)).not.toThrow();
  });
});
