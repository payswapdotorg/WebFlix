import { describe, expect, it } from "bun:test";

import {
  BROWSER_CONNECTOR_ID,
  EMBED_CONNECTOR_ID,
  FRESH_LOFI_NATIVE_REPORT,
  FIXTURE_ITEMS,
  FIXTURE_LABELS,
  FIXTURE_REALIZATIONS,
  NATIVE_CONNECTOR_ID,
  NATIVE_CONNECTOR_CAPABILITIES,
  RETRIEVAL_NOW,
  STALE_DUNE_NATIVE_REPORT,
  type RetrievalItemInput,
} from "../../src/index";
import {
  CandidateIndex,
  RetrievalError,
  type RetrievedCandidate,
  type RetrievalQuery,
} from "../../src/index";

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

/** Fixture item by position, with a loud failure when absent. */
function fixtureItem(position: number): RetrievalItemInput {
  const item = FIXTURE_ITEMS[position];
  if (item === undefined) throw new Error(`missing fixture item at ${position}`);
  return item;
}

const DUNE = 0;
const BUDAPEST = 1;
const SEVERANCE = 2;
const SEVERANCE_S2E1 = 3;
const KURZGESAGT = 4;
const STRETCH = 5;
const DESK = 6;
const POST = 7;
const LOFI = 8;
const ROME = 9;
const CRANE = 10;
const STALKER = 11;

/** Canonical titles of a candidate list (readable assertions). */
function titlesOf(candidates: readonly RetrievedCandidate[]): string[] {
  return candidates.map((entry) => String(entry.candidate.features.canonicalTitle));
}

/** Fixture realization by position, with a loud failure when absent. */
function fixtureRealization(position: number) {
  const realization = FIXTURE_REALIZATIONS[position];
  if (realization === undefined) throw new Error(`missing fixture realization at ${position}`);
  return realization;
}

/** Build a fixture-loaded index. */
function fixtureIndex(): CandidateIndex {
  return new CandidateIndex({ retrievedAt: RETRIEVAL_NOW });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("candidate index — construction", () => {
  it("requires a deterministic ISO 8601 retrieval anchor (no hidden clock)", () => {
    expectRetrievalError(() => new CandidateIndex({} as { retrievedAt: string }));
    expectRetrievalError(() => new CandidateIndex({ retrievedAt: "yesterday" }));
    expectRetrievalError(() => new CandidateIndex({ retrievedAt: "2026-09-13T12:00:00" }));
    const index = new CandidateIndex({ retrievedAt: RETRIEVAL_NOW });
    expect(index.query({ limit: 5 })).toEqual([]);
  });

  it("stamps every retrieved candidate with the anchor instant", () => {
    const index = new CandidateIndex({ retrievedAt: RETRIEVAL_NOW });
    index.ingest([fixtureItem(DUNE)], [fixtureRealization(0)]);
    for (const candidate of index.query({ limit: 10 })) {
      expect(candidate.retrievedAt).toBe(RETRIEVAL_NOW);
    }
  });
});

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

describe("candidate index — ingest", () => {
  it("bulk-loads items and realizations and reports the counts", () => {
    const index = fixtureIndex();
    const summary = index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    expect(summary).toEqual({
      itemsInserted: 12,
      realizationsAttached: 19,
      realizationsDeduplicated: 0,
    });
    expect(index.query({ limit: 100 })).toHaveLength(19);
  });

  it("accepts an empty bulk load and returns zero counters", () => {
    const index = fixtureIndex();
    expect(index.ingest([], [])).toEqual({
      itemsInserted: 0,
      realizationsAttached: 0,
      realizationsDeduplicated: 0,
    });
  });

  it("throws one aggregated typed error for malformed items and leaves state untouched", () => {
    const index = fixtureIndex();
    const badItem = { id: "not-an-id", canonicalType: "movie" } as unknown as RetrievalItemInput;
    const error = expectRetrievalError(() => index.ingest([fixtureItem(DUNE), badItem], []));
    expect(error.details.some((detail) => detail.startsWith("items[1]"))).toBe(true);
    // All-or-nothing: the valid item from the failed call is NOT inserted.
    expect(index.query({ limit: 100 })).toEqual([]);
  });

  it("throws for malformed realizations (field-level details)", () => {
    const index = fixtureIndex();
    const bad = { ...fixtureRealization(0), capabilities: ["teleport"] } as never;
    const error = expectRetrievalError(() => index.ingest([fixtureItem(DUNE)], [bad]));
    expect(error.details.some((detail) => detail.includes("capabilities"))).toBe(true);
  });

  it("rejects orphan realizations — the index never invents canonical identities", () => {
    const index = fixtureIndex();
    const orphan = { ...fixtureRealization(0), entertainmentItemId: "wfxitm_01ARZ3NDEKF1XTVRE0000000ZZ" };
    const error = expectRetrievalError(() => index.ingest([], [orphan]));
    expect(error.details.some((detail) => detail.includes("not known to this index"))).toBe(true);
  });

  it("rejects enrichment references that are not canonical creator/topic ids", () => {
    const index = fixtureIndex();
    const badCreators = { ...fixtureItem(DUNE), creators: ["creator-1"] } as RetrievalItemInput;
    const badTopics = { ...fixtureItem(BUDAPEST), topics: ["topic-1"] } as RetrievalItemInput;
    expectRetrievalError(() => index.ingest([badCreators], []));
    expectRetrievalError(() => index.ingest([badTopics], []));
  });

  it("rejects malformed label maps (non-canonical keys, empty values)", () => {
    const index = fixtureIndex();
    expectRetrievalError(() =>
      index.ingest([], [], { creatorNames: { "creator-1": "Someone" } }),
    );
    expectRetrievalError(() =>
      index.ingest([], [], { topicLabels: { "wfxtop_01ARZ3NDEK70P1C00000000001": "   " } }),
    );
  });

  it("rejects a (connectorId, externalRef) pair claimed by two different items", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const conflicting = {
      ...fixtureRealization(0),
      entertainmentItemId: fixtureItem(BUDAPEST).id,
    };
    const error = expectRetrievalError(() => index.ingest([], [conflicting]));
    expect(error.details.some((detail) => detail.includes("already realized by item"))).toBe(true);
    // State untouched: Dune still owns the pair with full capabilities.
    const dune = index
      .query({ limit: 100, text: "Dune" })
      .find((entry) => entry.candidate.realization.connectorId === NATIVE_CONNECTOR_ID);
    expect(dune?.candidate.realization.capabilities).toContain("playNative");
  });

  it("deduplicates repeated pairs KEEPING THE FRESHEST (stale report discarded)", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const summary = index.ingest([], [STALE_DUNE_NATIVE_REPORT]);
    expect(summary.realizationsDeduplicated).toBe(1);
    expect(summary.realizationsAttached).toBe(0);

    const duneNative = index
      .query({ limit: 100, text: "Dune" })
      .filter((entry) => entry.candidate.realization.connectorId === NATIVE_CONNECTOR_ID);
    // The stale report (capabilities: ["metadata"]) lost; the base report survived.
    expect(duneNative).toHaveLength(1);
    expect(duneNative[0]?.candidate.realization.capabilities).toEqual([
      ...NATIVE_CONNECTOR_CAPABILITIES,
    ]);
  });

  it("replaces the stored realization when a FRESHER report of a pair arrives", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const summary = index.ingest([], [FRESH_LOFI_NATIVE_REPORT]);
    expect(summary).toEqual({ itemsInserted: 0, realizationsAttached: 0, realizationsDeduplicated: 1 });

    const loFiNative = index
      .query({ limit: 100, text: "Lo-Fi" })
      .find((entry) => entry.candidate.realization.connectorId === NATIVE_CONNECTOR_ID);
    // Whole-realization replacement: id, capabilities, availability from the fresh report.
    expect(loFiNative?.candidate.realization.externalRef).toBe("nv/lofi-vol4");
    expect(loFiNative?.candidate.realization.capabilities).toEqual(
      FRESH_LOFI_NATIVE_REPORT.capabilities,
    );
    expect(loFiNative?.candidate.realization.availability).toBe("unknown");
  });

  it("re-ingesting a known item merges (defined fields win) and keeps insertion order", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const renamed = { ...fixtureItem(DUNE), canonicalTitle: "Dune Part Deux" };
    index.ingest([renamed], []);
    const dune = index.query({ limit: 100, text: "deux" });
    expect(titlesOf(dune)).toEqual(["Dune Part Deux", "Dune Part Deux", "Dune Part Deux"]);
    // Insertion order stable: Dune candidates still come first overall.
    expect(titlesOf(index.query({ limit: 1 }))).toEqual(["Dune Part Deux"]);
  });
});

// ---------------------------------------------------------------------------
// Query — filters
// ---------------------------------------------------------------------------

describe("candidate index — query filters", () => {
  it("an empty index returns [] — emptiness is a result, never an error", () => {
    const index = fixtureIndex();
    expect(index.query({ limit: 10 })).toEqual([]);
    expect(index.query({ limit: 10, text: "dune" })).toEqual([]);
    expect(index.query({ limit: 10, requiredCapability: "playNative" })).toEqual([]);
  });

  it("returns every (item, realization) pair in deterministic insertion order", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const all = index.query({ limit: 100 });
    expect(all).toHaveLength(19);
    expect(titlesOf(all.slice(0, 4))).toEqual([
      "Dune: Part Two",
      "Dune: Part Two",
      "Dune: Part Two",
      "The Grand Budapest Hotel",
    ]);
  });

  it("filters by canonicalType", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const audio = index.query({ limit: 100, canonicalType: "audio" });
    expect(titlesOf(audio)).toEqual([
      "Lo-Fi Study Beats Vol. 4",
      "Lo-Fi Study Beats Vol. 4",
      "The History of Rome - Episode 1",
    ]);
  });

  it("filters by orientation (undefined orientation never matches)", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const vertical = index.query({ limit: 100, orientation: "vertical" });
    expect(titlesOf(vertical)).toEqual([
      "Morning Stretch Routine",
      "Morning Stretch Routine",
      "Desk Setup Tour 2026",
      "Desk Setup Tour 2026",
    ]);
  });

  it("filters by an inclusive duration window; unknown durations never match", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const windowed = index.query({
      limit: 100,
      durationRangeMs: { minMs: 60_000, maxMs: 600_000 },
    });
    expect(titlesOf(windowed)).toEqual([
      "Desk Setup Tour 2026",
      "Desk Setup Tour 2026",
      "Folding a Paper Crane in 4K",
    ]);
    // Half-open windows work; the untitled-duration series/post never match.
    const lowerBounded = index.query({ limit: 100, durationRangeMs: { minMs: 9_000_000 } });
    expect(titlesOf(lowerBounded)).toEqual([
      "Dune: Part Two",
      "Dune: Part Two",
      "Dune: Part Two",
      "Stalker",
    ]);
  });

  it("filters candidate realizations by connectorId while preserving all realizations", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const embed = index.query({ limit: 100, connectorId: EMBED_CONNECTOR_ID });
    expect(embed).toHaveLength(7);
    for (const entry of embed) {
      expect(entry.candidate.realization.connectorId).toBe(EMBED_CONNECTOR_ID);
    }
    // Dune's embed candidate still carries its browser/native realizations verbatim.
    const duneEmbed = embed.find((entry) => titlesOf([entry])[0] === "Dune: Part Two");
    expect(duneEmbed?.sourceRealizations.map((r) => r.connectorId)).toEqual([
      NATIVE_CONNECTOR_ID,
      EMBED_CONNECTOR_ID,
      BROWSER_CONNECTOR_ID,
    ]);
  });

  it("requiredCapability filters on REALIZATION capabilities (the capability law)", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const nativePlayable = index.query({ limit: 100, requiredCapability: "playNative" });
    // Only items with at least one playNative-declaring realization match.
    expect(titlesOf(nativePlayable)).toEqual([
      "Dune: Part Two",
      "Severance",
      "Severance S2E1: Hello, Ms. Casey",
      "Morning Stretch Routine",
      "Lo-Fi Study Beats Vol. 4",
      "The History of Rome - Episode 1",
    ]);
    // A movie whose ONLY realization lacks playNative must NOT match.
    const budapest = nativePlayable.filter((entry) => entry.candidate.itemId === fixtureItem(BUDAPEST).id);
    expect(budapest).toEqual([]);
    // Only the DECLARING realization materializes a candidate.
    for (const entry of nativePlayable) {
      expect(entry.candidate.realization.capabilities).toContain("playNative");
    }
    // Stalker (browser+external only) matches playBrowser/playExternal, never playNative/playEmbed.
    const stalkerItemId = fixtureItem(STALKER).id;
    expect(
      index.query({ limit: 100, requiredCapability: "playBrowser" }).filter(
        (entry) => entry.candidate.itemId === stalkerItemId,
      ),
    ).toHaveLength(1);
    expect(
      index.query({ limit: 100, requiredCapability: "playEmbed" }).filter(
        (entry) => entry.candidate.itemId === stalkerItemId,
      ),
    ).toEqual([]);
    expect(
      index.query({ limit: 100, requiredCapability: "playNative" }).filter(
        (entry) => entry.candidate.itemId === stalkerItemId,
      ),
    ).toEqual([]);
  });

  it("preserves every realization's capability data verbatim on matched candidates", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const dune = index.query({ limit: 100, text: "Dune" })[0];
    expect(dune?.sourceRealizations).toHaveLength(3);
    expect(dune?.sourceRealizations.map((r) => r.capabilities)).toEqual([
      [...NATIVE_CONNECTOR_CAPABILITIES],
      [
        "identity",
        "catalogSearch",
        "metadata",
        "playEmbed",
        "availability",
        "like",
        "comment",
      ],
      [
        "identity",
        "catalogSearch",
        "metadata",
        "playBrowser",
        "playExternal",
        "availability",
        "follow",
      ],
    ]);
    expect(dune?.sourceRealizations.map((r) => r.availability)).toEqual([
      "available",
      "available",
      "unknown",
    ]);
  });

  it("truncates results to limit", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    expect(index.query({ limit: 1 })).toHaveLength(1);
    expect(index.query({ limit: 5 })).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Query — text matching
// ---------------------------------------------------------------------------

describe("candidate index — text matching", () => {
  it("matches tokens case-insensitively over titles, creator names, and topic labels", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);

    expect(titlesOf(index.query({ limit: 100, text: "DUNE" }))).toHaveLength(3);
    // Creator-name surface: "villeneuve" resolves through the label map.
    expect(titlesOf(index.query({ limit: 100, text: "villeneuve" }))).toHaveLength(3);
    // Topic-label surface: "wellness" (Morning Stretch) and "caper" (Budapest).
    expect(titlesOf(index.query({ limit: 100, text: "wellness" }))).toHaveLength(2);
    expect(titlesOf(index.query({ limit: 100, text: "caper" }))).toHaveLength(1);
    // canonicalType and orientation are part of the surface.
    expect(titlesOf(index.query({ limit: 100, text: "audio" }))).toHaveLength(3);
    expect(titlesOf(index.query({ limit: 100, text: "vertical" }))).toHaveLength(4);
  });

  it("requires EVERY token to match (AND semantics)", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    // Both "science" and "fiction" → the science-fiction items only.
    expect(titlesOf(index.query({ limit: 100, text: "science fiction" }))).toEqual([
      "Dune: Part Two",
      "Dune: Part Two",
      "Dune: Part Two",
      "Severance",
      "Severance",
      "Severance S2E1: Hello, Ms. Casey",
      "Stalker",
    ]);
    // Kurzgesagt has topic "science" but not "fiction" → excluded by AND.
    expect(
      titlesOf(index.query({ limit: 100, text: "science fiction" })).includes(
        "Kurzgesagt: The Last Human",
      ),
    ).toBe(false);
    // No single item contains both "dune" and "budapest".
    expect(index.query({ limit: 100, text: "dune budapest" })).toEqual([]);
  });

  it("combines text with structural filters", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const verticalShorts = index.query({
      limit: 100,
      text: "short",
      canonicalType: "short",
    });
    expect(titlesOf(verticalShorts)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Query — invalid shapes
// ---------------------------------------------------------------------------

describe("candidate index — invalid query shapes", () => {
  const index = fixtureIndex();

  it("rejects a non-object query", () => {
    expectRetrievalError(() => index.query(null as unknown as RetrievalQuery));
    expectRetrievalError(() => index.query("dune" as unknown as RetrievalQuery));
  });

  it("rejects a missing or non-positive / non-integer limit", () => {
    expectRetrievalError(() => index.query({} as RetrievalQuery));
    expectRetrievalError(() => index.query({ limit: 0 }));
    expectRetrievalError(() => index.query({ limit: -3 }));
    expectRetrievalError(() => index.query({ limit: 1.5 }));
    expectRetrievalError(() => index.query({ limit: Number.POSITIVE_INFINITY }));
  });

  it("rejects blank text (an empty needle is a caller bug)", () => {
    expectRetrievalError(() => index.query({ limit: 5, text: "   " }));
    expectRetrievalError(() => index.query({ limit: 5, text: "" }));
  });

  it("rejects out-of-vocabulary canonicalType / orientation / requiredCapability", () => {
    expectRetrievalError(() =>
      index.query({ limit: 5, canonicalType: "film" } as unknown as RetrievalQuery),
    );
    expectRetrievalError(() =>
      index.query({ limit: 5, orientation: "diagonal" } as unknown as RetrievalQuery),
    );
    expectRetrievalError(() =>
      index.query({ limit: 5, requiredCapability: "teleport" } as unknown as RetrievalQuery),
    );
  });

  it("rejects malformed duration ranges", () => {
    expectRetrievalError(() => index.query({ limit: 5, durationRangeMs: {} }));
    expectRetrievalError(() =>
      index.query({ limit: 5, durationRangeMs: { minMs: 500, maxMs: 100 } }),
    );
    expectRetrievalError(() =>
      index.query({ limit: 5, durationRangeMs: { minMs: -5 } }),
    );
    expectRetrievalError(() =>
      index.query({ limit: 5, durationRangeMs: { maxMs: Number.NaN } }),
    );
  });

  it("rejects an empty connectorId", () => {
    expectRetrievalError(() => index.query({ limit: 5, connectorId: "  " }));
  });

  it("aggregates multiple field errors into one typed error", () => {
    const error = expectRetrievalError(() =>
      index.query({ limit: 0, text: "  ", canonicalType: "film" } as unknown as RetrievalQuery),
    );
    expect(error.details).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Defensive reads
// ---------------------------------------------------------------------------

describe("candidate index — defensive reads", () => {
  it("returns deeply frozen candidates — mutation cannot corrupt the index", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const candidate = index.query({ limit: 1 })[0];
    if (candidate === undefined) throw new Error("expected a candidate");
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.candidate)).toBe(true);
    expect(Object.isFrozen(candidate.candidate.features)).toBe(true);
    expect(Object.isFrozen(candidate.candidate.realization)).toBe(true);
    expect(Object.isFrozen(candidate.candidate.realization.capabilities)).toBe(true);
    expect(Object.isFrozen(candidate.sourceRealizations)).toBe(true);
    expect(Object.isFrozen(candidate.matchedObjectives)).toBe(true);
    expect(() => (candidate.sourceRealizations as unknown as unknown[]).push({})).toThrow();
    // The index still answers identically after the attempted mutation.
    expect(index.query({ limit: 100 })).toHaveLength(19);
  });

  it("carries deterministic scoring features on every candidate", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const dune = index.query({ limit: 100, text: "Dune" })[0];
    if (dune === undefined) throw new Error("expected a dune candidate");
    expect(dune.candidate.itemId).toBe(fixtureItem(DUNE).id);
    expect(dune.candidate.features.canonicalType).toBe("movie");
    expect(dune.candidate.features.canonicalTitle).toBe("Dune: Part Two");
    expect(dune.candidate.features.durationMs).toBe(9_960_000);
    expect(dune.candidate.features.orientation).toBe("horizontal");
    expect(dune.candidate.features.realizationCount).toBe(3);
    expect(dune.candidate.features.capabilityCount).toBe(11);
    expect(dune.candidate.features.availability).toBe("available");
    expect(dune.candidate.features.matchText).toBe(
      "dune: part two denis villeneuve science fiction epic movie horizontal",
    );
    expect(dune.candidate.features.matchText).not.toContain("vertical");
  });
});

// ---------------------------------------------------------------------------
// Unused fixture-position linter guards (keep DESK..STALKER meaningful)
// ---------------------------------------------------------------------------

describe("candidate index — fixture coverage sanity", () => {
  it("every fixture item is reachable through the index", () => {
    const index = fixtureIndex();
    index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
    const reachable = new Set(index.query({ limit: 100 }).map((entry) => entry.candidate.itemId));
    for (const position of [DESK, POST, ROME, CRANE, STALKER, STRETCH, KURZGESAGT, SEVERANCE, SEVERANCE_S2E1, BUDAPEST, LOFI]) {
      expect(reachable.has(fixtureItem(position).id)).toBe(true);
    }
  });
});
