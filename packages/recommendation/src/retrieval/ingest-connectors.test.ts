import { describe, expect, it } from "bun:test";

import {
  FIXTURE_ITEMS,
  FIXTURE_SEARCH_RESULTS,
  NATIVE_CONNECTOR_ID,
  buildFixtureIndex,
  fixtureItemFor,
  ingestConnectorResults,
  RetrievalError,
  syntheticRealizationId,
  type CandidateIndex,
  type IngestReport,
  type RetrievalItemInput,
} from "../../src/index";
import { isSourceRealizationId, ulidTimestamp } from "@wfx/domain";

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

/** Canonical titles of a candidate list. */
function titlesOf(candidates: readonly { candidate: { features: Record<string, unknown> } }[]): string[] {
  return candidates.map((entry) => String(entry.candidate.features.canonicalTitle));
}

/** A well-formed result for a custom (connectorId, externalRef) pair. */
function resultFor(connectorId: string, externalRef: string, title: string) {
  return { connectorId, externalRef, title };
}

// ---------------------------------------------------------------------------
// Deterministic synthetic ids
// ---------------------------------------------------------------------------

describe("syntheticRealizationId — determinism", () => {
  it("maps one external identity to exactly one id (no clock, no entropy)", () => {
    expect(syntheticRealizationId("wfx-test-native", "nv/x")).toBe(
      syntheticRealizationId("wfx-test-native", "nv/x"),
    );
    expect(syntheticRealizationId("wfx-test-native", "nv/x")).not.toBe(
      syntheticRealizationId("wfx-test-native", "nv/y"),
    );
    expect(syntheticRealizationId("wfx-test-native", "nv/x")).not.toBe(
      syntheticRealizationId("wfx-test-embed", "nv/x"),
    );
  });

  it("produces structurally canonical ids that decode to epoch 0 (always stale)", () => {
    const id = syntheticRealizationId("wfx-test-native", "nv/dune-part-two");
    expect(isSourceRealizationId(id)).toBe(true);
    expect(ulidTimestamp(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

describe("ingestConnectorResults — the fold", () => {
  it("folds the fixture batch: 3 ingested, 2 skipped with typed reasons", () => {
    const index = buildFixtureIndex();
    const report = ingestConnectorResults(index, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    expect(report.ingested).toBe(3);
    expect(report.skipped).toBe(2);
    expect(report.skipReasons).toHaveLength(2);
    expect(report.skipReasons[0]).toContain("unmappable");
    expect(report.skipReasons[0]).toContain("nv/region-locked-special");
    expect(report.skipReasons[1]).toContain("externalRef");
    // The report accounts for every result — nothing silently dropped.
    expect(report.ingested + report.skipped).toBe(FIXTURE_SEARCH_RESULTS.length);
  });

  it("attaches a NEW pair as an honest existence record (no capability claims)", () => {
    const index = buildFixtureIndex();
    ingestConnectorResults(index, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    const extended = index.query({ limit: 100, text: "Dune" }).filter(
      (entry) => entry.candidate.realization.externalRef === "nv/dune-extended-cut",
    );
    expect(extended).toHaveLength(1);
    expect(extended[0]?.candidate.realization.connectorId).toBe(NATIVE_CONNECTOR_ID);
    expect(extended[0]?.candidate.realization.capabilities).toEqual([]);
    expect(extended[0]?.candidate.realization.availability).toBe("unknown");
    // An existence record never satisfies a capability requirement.
    expect(
      index.query({ limit: 100, text: "Dune", requiredCapability: "playNative" }).filter(
        (entry) => entry.candidate.realization.externalRef === "nv/dune-extended-cut",
      ),
    ).toEqual([]);
  });

  it("never lets a search hit clobber a richer known realization (freshest wins)", () => {
    const index = buildFixtureIndex();
    ingestConnectorResults(index, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    // The S2E1 native pair was re-reported by the bridge with an epoch-0
    // synthetic id; the base report (full NATIVE capabilities) must survive.
    const episode = index.query({ limit: 100, text: "Casey" });
    expect(episode).toHaveLength(1);
    expect(episode[0]?.candidate.realization.capabilities).toContain("playNative");
    expect(episode[0]?.candidate.realization.capabilities).toHaveLength(11);
    expect(episode[0]?.sourceRealizations).toHaveLength(1);
  });

  it("is idempotent: folding the same batch twice yields the identical report and state", () => {
    const index = buildFixtureIndex();
    const first = ingestConnectorResults(index, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    const state = index.query({ limit: 100 });
    const second = ingestConnectorResults(index, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    expect(second).toEqual(first);
    expect(index.query({ limit: 100 })).toEqual(state);
  });

  it("is deterministic across independent indexes", () => {
    const left = buildFixtureIndex();
    const right = buildFixtureIndex();
    ingestConnectorResults(left, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    ingestConnectorResults(right, FIXTURE_SEARCH_RESULTS, fixtureItemFor);
    expect(left.query({ limit: 100 })).toEqual(right.query({ limit: 100 }));
  });

  it("accepts an empty result batch", () => {
    const index = buildFixtureIndex();
    const report = ingestConnectorResults(index, [], fixtureItemFor);
    expect(report).toEqual({ ingested: 0, skipped: 0, skipReasons: [] } satisfies IngestReport);
  });

  it("ingests results whose items are NEW to the index", () => {
    const index = buildFixtureIndex();
    const newItem: RetrievalItemInput = {
      id: "wfxitm_01ARZ3NDEKF1XTVRE00000000D",
      canonicalType: "movie",
      canonicalTitle: "Bridge Born Movie",
      durationMs: 600_000,
      orientation: "horizontal",
    };
    const results = [resultFor(NATIVE_CONNECTOR_ID, "nv/bridge-born", "Bridge Born Movie")];
    const report = ingestConnectorResults(index, results, () => newItem);
    expect(report).toEqual({ ingested: 1, skipped: 0, skipReasons: [] });
    expect(titlesOf(index.query({ limit: 100, text: "bridge" }))).toEqual([
      "Bridge Born Movie",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Skip paths — never silently dropped
// ---------------------------------------------------------------------------

describe("ingestConnectorResults — skip paths", () => {
  it("counts malformed results as skipped with field-level reasons", () => {
    const index = buildFixtureIndex();
    const results = [
      { connectorId: "", externalRef: "nv/x", title: "T" },
      resultFor(NATIVE_CONNECTOR_ID, "nv/no-title", ""),
      { connectorId: NATIVE_CONNECTOR_ID, externalRef: "nv/bad-type", title: "T", canonicalType: "film" },
      { connectorId: NATIVE_CONNECTOR_ID, externalRef: "nv/bad-duration", title: "T", durationMs: -1 },
      "not-a-result",
    ];
    const report = ingestConnectorResults(index, results as never, () => FIXTURE_ITEMS[0] ?? null);
    expect(report.ingested).toBe(0);
    expect(report.skipped).toBe(5);
    expect(report.skipReasons[0]).toContain("connectorId");
    expect(report.skipReasons[1]).toContain("title");
    expect(report.skipReasons[2]).toContain("canonicalType");
    expect(report.skipReasons[3]).toContain("durationMs");
    expect(report.skipReasons[4]).toContain("SearchResult object");
  });

  it("counts unmappable results as skipped, naming the external identity", () => {
    const index = buildFixtureIndex();
    const results = [resultFor(NATIVE_CONNECTOR_ID, "nv/ghost", "Ghost Title")];
    const report = ingestConnectorResults(index, results, () => null);
    expect(report).toEqual({
      ingested: 0,
      skipped: 1,
      skipReasons: [
        'results[0]: unmappable — itemFor returned no canonical item for (wfx-test-native, nv/ghost) "Ghost Title"',
      ],
    });
  });

  it("counts index-rejected mapped items as skipped with the index's details", () => {
    const index = buildFixtureIndex();
    const malformedItem = { id: "bad", canonicalType: "movie" } as RetrievalItemInput;
    const results = [resultFor(NATIVE_CONNECTOR_ID, "nv/bad-item", "Bad Item")];
    const report = ingestConnectorResults(index, results, () => malformedItem);
    expect(report.ingested).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.skipReasons[0]).toContain("rejected by index");
    expect(report.skipReasons[0]).toContain("id:");
  });

  it("counts cross-item pair conflicts as skipped — one pair, one canonical identity", () => {
    const index = buildFixtureIndex();
    const budapest = FIXTURE_ITEMS[1];
    const results = [resultFor(NATIVE_CONNECTOR_ID, "nv/dune-part-two", "Dune: Part Two")];
    const report = ingestConnectorResults(index, results, () => budapest ?? null);
    expect(report.ingested).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.skipReasons[0]).toContain("already realized by item");
    // The index is untouched: Dune still owns the pair.
    const duneNative = index
      .query({ limit: 100, text: "Dune" })
      .find((entry) => entry.candidate.realization.connectorId === NATIVE_CONNECTOR_ID);
    expect(duneNative?.candidate.realization.capabilities).toContain("playNative");
  });
});

// ---------------------------------------------------------------------------
// Caller-level failures
// ---------------------------------------------------------------------------

describe("ingestConnectorResults — caller-level failures", () => {
  it("rejects a non-array results argument", () => {
    const index = buildFixtureIndex();
    expectRetrievalError(() =>
      ingestConnectorResults(index, null as unknown as [], fixtureItemFor),
    );
  });

  it("rejects a non-function mapper", () => {
    const index = buildFixtureIndex();
    expectRetrievalError(() =>
      ingestConnectorResults(
        index,
        [],
        null as unknown as (r: { connectorId: string }) => null,
      ),
    );
  });

  it("rejects a non-index target", () => {
    expectRetrievalError(() =>
      ingestConnectorResults({} as CandidateIndex, [], fixtureItemFor),
    );
  });

  it("propagates a throwing itemFor unchanged (caller bugs are not fold outcomes)", () => {
    const index = buildFixtureIndex();
    const results = [resultFor(NATIVE_CONNECTOR_ID, "nv/x", "T")];
    expect(() =>
      ingestConnectorResults(index, results, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});
