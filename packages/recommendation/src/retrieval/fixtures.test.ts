import { describe, expect, it } from "bun:test";

import {
  BROWSER_CONNECTOR_CAPABILITIES,
  BROWSER_CONNECTOR_ID,
  CONFLICTING_DUNE_REPORT,
  EMBED_CONNECTOR_CAPABILITIES,
  EMBED_CONNECTOR_ID,
  FIXTURE_CREATORS,
  FIXTURE_INTENTS,
  FIXTURE_ITEMS,
  FIXTURE_LABELS,
  FIXTURE_REALIZATIONS,
  FIXTURE_SEARCH_RESULTS,
  FIXTURE_TOPICS,
  FRESH_LOFI_NATIVE_REPORT,
  NATIVE_CONNECTOR_CAPABILITIES,
  NATIVE_CONNECTOR_ID,
  RETRIEVAL_NOW,
  STALE_DUNE_NATIVE_REPORT,
  buildFixtureIndex,
} from "../../src/index";
import {
  isCreatorId,
  isEntertainmentItemId,
  isIntentId,
  isSourceRealizationId,
  isTopicId,
  ulidTimestamp,
  type EntertainmentItem,
  type IntentScope,
} from "@wfx/domain";

const CANONICAL_TYPES = new Set<EntertainmentItem["canonicalType"]>([
  "movie",
  "series",
  "episode",
  "video",
  "short",
  "post",
  "audio",
]);

const INTENT_SCOPES = new Set<IntentScope>([
  "persistent",
  "temporary",
  "session",
  "momentary",
  "social",
]);

/** Decode a fixture id's embedded ULID timestamp, failing loudly when invalid. */
function decodedTime(id: string): number {
  const value = ulidTimestamp(id);
  if (value === null) throw new Error(`unparseable fixture id: ${id}`);
  return value;
}

describe("retrieval fixtures — packet minimums", () => {
  it("provide at least 12 entertainment items covering ALL 7 canonical types", () => {
    expect(FIXTURE_ITEMS.length).toBeGreaterThanOrEqual(12);
    const present = new Set(FIXTURE_ITEMS.map((item) => item.canonicalType));
    expect(present).toEqual(CANONICAL_TYPES);
  });

  it("provide at least 18 source realizations across exactly 3 connector ids", () => {
    expect(FIXTURE_REALIZATIONS.length).toBeGreaterThanOrEqual(18);
    const connectorIds = new Set(FIXTURE_REALIZATIONS.map((r) => r.connectorId));
    expect(connectorIds).toEqual(
      new Set([NATIVE_CONNECTOR_ID, EMBED_CONNECTOR_ID, BROWSER_CONNECTOR_ID]),
    );
  });

  it("give the 3 connectors DIFFERENT capability sets (native / embed-only / browser+external)", () => {
    // Native-capable: declares playNative (and download).
    expect(NATIVE_CONNECTOR_CAPABILITIES).toContain("playNative");
    expect(NATIVE_CONNECTOR_CAPABILITIES).toContain("download");
    expect(NATIVE_CONNECTOR_CAPABILITIES).not.toContain("playBrowser");
    expect(NATIVE_CONNECTOR_CAPABILITIES).not.toContain("playExternal");
    // Embed-only: playEmbed, nothing native/browser/external.
    expect(EMBED_CONNECTOR_CAPABILITIES).toContain("playEmbed");
    expect(EMBED_CONNECTOR_CAPABILITIES).not.toContain("playNative");
    expect(EMBED_CONNECTOR_CAPABILITIES).not.toContain("playBrowser");
    expect(EMBED_CONNECTOR_CAPABILITIES).not.toContain("playExternal");
    // Browser + external handoff.
    expect(BROWSER_CONNECTOR_CAPABILITIES).toContain("playBrowser");
    expect(BROWSER_CONNECTOR_CAPABILITIES).toContain("playExternal");
    expect(BROWSER_CONNECTOR_CAPABILITIES).not.toContain("playNative");
    expect(BROWSER_CONNECTOR_CAPABILITIES).not.toContain("playEmbed");
    // All three sets are pairwise distinct.
    expect(new Set(NATIVE_CONNECTOR_CAPABILITIES)).not.toEqual(new Set(EMBED_CONNECTOR_CAPABILITIES));
    expect(new Set(NATIVE_CONNECTOR_CAPABILITIES)).not.toEqual(new Set(BROWSER_CONNECTOR_CAPABILITIES));
    expect(new Set(EMBED_CONNECTOR_CAPABILITIES)).not.toEqual(new Set(BROWSER_CONNECTOR_CAPABILITIES));
  });

  it("provide 5 user intents across all 5 frozen scopes", () => {
    expect(FIXTURE_INTENTS).toHaveLength(5);
    const scopes = new Set(FIXTURE_INTENTS.map((intent) => intent.scope));
    expect(scopes).toEqual(INTENT_SCOPES);
    for (const intent of FIXTURE_INTENTS) {
      expect(intent.objective.trim().length).toBeGreaterThan(0);
      expect(intent.weight).toBeGreaterThanOrEqual(0);
      expect(intent.weight).toBeLessThanOrEqual(1);
    }
  });
});

describe("retrieval fixtures — canonical id literals", () => {
  it("every item / realization / intent / creator / topic id is canonical-shaped", () => {
    for (const item of FIXTURE_ITEMS) expect(isEntertainmentItemId(item.id)).toBe(true);
    for (const realization of FIXTURE_REALIZATIONS) {
      expect(isSourceRealizationId(realization.id)).toBe(true);
    }
    for (const intent of FIXTURE_INTENTS) expect(isIntentId(intent.id)).toBe(true);
    for (const creator of FIXTURE_CREATORS) expect(isCreatorId(creator.id)).toBe(true);
    for (const topic of FIXTURE_TOPICS) expect(isTopicId(topic.id)).toBe(true);
  });

  it("every realization attaches to a fixture item; base pairs are unique", () => {
    const itemIds = new Set(FIXTURE_ITEMS.map((item) => item.id));
    for (const realization of FIXTURE_REALIZATIONS) {
      expect(itemIds.has(realization.entertainmentItemId)).toBe(true);
    }
    const pairs = FIXTURE_REALIZATIONS.map((r) => `${r.connectorId}:${r.externalRef}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("the freshness-controlled re-reports bracket their base reports by ULID time", () => {
    const duneNative = FIXTURE_REALIZATIONS.find(
      (r) => r.connectorId === NATIVE_CONNECTOR_ID && r.externalRef === "nv/dune-part-two",
    );
    const loFiNative = FIXTURE_REALIZATIONS.find(
      (r) => r.connectorId === NATIVE_CONNECTOR_ID && r.externalRef === "nv/lofi-vol4",
    );
    if (duneNative === undefined || loFiNative === undefined) {
      throw new Error("expected the dune and lo-fi native base reports to exist");
    }
    expect(decodedTime(STALE_DUNE_NATIVE_REPORT.id)).toBeLessThan(decodedTime(duneNative.id));
    expect(decodedTime(FRESH_LOFI_NATIVE_REPORT.id)).toBeGreaterThan(decodedTime(loFiNative.id));
    expect(isSourceRealizationId(CONFLICTING_DUNE_REPORT.id)).toBe(true);
  });
});

describe("retrieval fixtures — determinism", () => {
  it("contains no randomness or hidden clock reads: two builds are identical", () => {
    const left = buildFixtureIndex();
    const right = buildFixtureIndex();
    expect(left.query({ limit: 100 })).toEqual(right.query({ limit: 100 }));
    expect(RETRIEVAL_NOW).toBe("2026-09-13T12:00:00.000Z");
  });

  it("loads every item and realization into the index (19 candidates)", () => {
    const index = buildFixtureIndex();
    expect(index.query({ limit: 100 })).toHaveLength(19);
    expect(index.query({ limit: 100 }).every((entry) => entry.retrievedAt === RETRIEVAL_NOW)).toBe(
      true,
    );
  });

  it("resolves creator and topic names through the label maps", () => {
    const index = buildFixtureIndex();
    index.ingest([], [], FIXTURE_LABELS); // re-ingesting labels is a merge, not a reset
    expect(index.query({ limit: 100, text: "tarkovsky" })).toHaveLength(1);
    expect(index.query({ limit: 100, text: "villeneuve" })).toHaveLength(3);
    expect(index.query({ limit: 100, text: "wellness" })).toHaveLength(2);
  });

  it("search-result fixtures exercise every bridge outcome", () => {
    expect(FIXTURE_SEARCH_RESULTS).toHaveLength(5);
    const refs = FIXTURE_SEARCH_RESULTS.map((r) => r.externalRef);
    // One NEW pair, two KNOWN pairs, one UNMAPPABLE, one MALFORMED.
    expect(refs).toContain("nv/dune-extended-cut");
    expect(refs).toContain("nv/severance-s2e1");
    expect(refs).toContain("em/grand-budapest");
    expect(refs).toContain("nv/region-locked-special");
    expect(refs).toContain("");
  });
});
