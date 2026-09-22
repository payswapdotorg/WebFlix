/**
 * @wfx/model-fabric — the intelligence READ TRANSPORT contract tests
 * (R26-W1).
 *
 * Machine-checked:
 * - the typed served/not-served envelope and its guards (the wire
 *   bodies never become contract data unvalidated);
 * - the closed not-served reason union + the honest next-action shape;
 * - the HTTP wire vocabulary (the ONE route contract the service side
 *   implements and the hosts consume — no second vocabulary);
 * - the wire guards reject malformed search/item reads (drift is
 *   rejected, never coerced).
 */

import { describe, expect, it } from "bun:test";

import {
  INTELLIGENCE_READ_ITEM_PARAM,
  INTELLIGENCE_READ_QUERY_PARAM,
  INTELLIGENCE_READ_ROUTE_PATH,
  isIntelligenceItemReadWire,
  isIntelligenceReadNotServedWire,
  isIntelligenceSearchReadWire,
  type IntelligenceItemRead,
  type IntelligenceReadTransport,
  type IntelligenceSearchRead,
} from "../src/index";

describe("the intelligence read transport contract (R26-W1)", () => {
  describe("the wire vocabulary (ONE contract)", () => {
    it("freezes the route path + the q/item query parameters", () => {
      expect(INTELLIGENCE_READ_ROUTE_PATH).toBe("/experience/intelligence");
      expect(INTELLIGENCE_READ_QUERY_PARAM).toBe("q");
      expect(INTELLIGENCE_READ_ITEM_PARAM).toBe("item");
    });
  });

  describe("the not-served outcome guards", () => {
    it("accepts a truthful transport-unavailable outcome with the named dependency", () => {
      expect(
        isIntelligenceReadNotServedWire({
          kind: "not-served",
          reason: "transport-unavailable",
          detail: "the route is absent",
          dependency: "the service-side route is the missing production dependency",
        }),
      ).toBe(true);
    });

    it("accepts a no-derived-artifacts outcome (the per-item honest absence)", () => {
      expect(
        isIntelligenceReadNotServedWire({
          kind: "not-served",
          reason: "no-derived-artifacts",
          detail: "this title has no derived intelligence",
          dependency: "the derivation pipeline has not produced an artifact set",
          nextAction: { label: "run transcription from the AI tray" },
        }),
      ).toBe(true);
    });

    it("rejects malformed outcomes (unknown reason, empty detail/dependency, bad next action)", () => {
      expect(
        isIntelligenceReadNotServedWire({
          kind: "not-served",
          reason: "because",
          detail: "d",
          dependency: "dep",
        }),
      ).toBe(false);
      expect(
        isIntelligenceReadNotServedWire({
          kind: "not-served",
          reason: "transport-unavailable",
          detail: "",
          dependency: "dep",
        }),
      ).toBe(false);
      expect(
        isIntelligenceReadNotServedWire({
          kind: "not-served",
          reason: "transport-unavailable",
          detail: "d",
          dependency: "",
        }),
      ).toBe(false);
      expect(
        isIntelligenceReadNotServedWire({
          kind: "not-served",
          reason: "transport-unavailable",
          detail: "d",
          dependency: "dep",
          nextAction: { label: "" },
        }),
      ).toBe(false);
      expect(
        isIntelligenceReadNotServedWire({
          kind: "served",
          reason: "transport-unavailable",
          detail: "d",
          dependency: "dep",
        }),
      ).toBe(false);
      expect(isIntelligenceReadNotServedWire(null)).toBe(false);
      expect(isIntelligenceReadNotServedWire("nope")).toBe(false);
    });
  });

  describe("the served read guards", () => {
    /** A minimal truthful search read. */
    const searchRead: IntelligenceSearchRead = {
      meaning: [
        {
          itemId: "wfxitm_0000000000000000000000A",
          connectorId: "youtube",
          externalRef: "vid-1",
          title: "Deep Field Diary",
          matchedText: "telescopes photograph distant galaxies",
          score: 0.72,
        },
      ],
      moments: [
        {
          itemId: "wfxitm_0000000000000000000000A",
          connectorId: "youtube",
          externalRef: "vid-1",
          title: "Deep Field Diary",
          startMs: 41_000,
          endMs: 58_000,
          description: "the first image resolves",
          matchedText: null,
          score: 0.81,
        },
      ],
      provenance: [
        {
          stage: "text-embeddings",
          modelId: "open-model:bge-m3",
          modelRevision: "research-2026-09-20",
          confidence: 0.91,
          producedAt: "2026-09-18T12:00:00.000Z",
        },
      ],
      meaningSearchAvailable: true,
    };

    /** A minimal truthful item read (an artifact set + the legal-audio truth). */
    const itemRead: IntelligenceItemRead = {
      artifacts: {
        itemId: "wfxitm_0000000000000000000000A",
        transcript: {
          kind: "transcript",
          language: "en",
          segments: [
            { startMs: 0, endMs: 4_000, text: "hello", language: "en" },
          ],
          model: {
            stage: "transcription",
            modelId: "open-model:moss-transcribe-diarize",
            modelRevision: "research-2026-09-20",
            confidence: 0.94,
            producedAt: "2026-09-18T12:00:00.000Z",
          },
        },
      },
      audioStreamLegallyAvailable: true,
    };

    it("accepts truthful search + item reads over the wire", () => {
      expect(isIntelligenceSearchReadWire(searchRead)).toBe(true);
      expect(isIntelligenceItemReadWire(itemRead)).toBe(true);
    });

    it("rejects malformed search reads (wrong arrays, non-finite scores, missing matchedText)", () => {
      expect(isIntelligenceSearchReadWire({ meaning: "no", moments: [], provenance: [], meaningSearchAvailable: true })).toBe(false);
      expect(
        isIntelligenceSearchReadWire({
          ...searchRead,
          meaning: [{ ...searchRead.meaning[0]!, score: Number.NaN }],
        }),
      ).toBe(false);
      expect(
        isIntelligenceSearchReadWire({
          ...searchRead,
          moments: [{ ...searchRead.moments[0]!, matchedText: 42 }],
        }),
      ).toBe(false);
      expect(isIntelligenceSearchReadWire(null)).toBe(false);
    });

    it("rejects malformed item reads (absent legal-audio truth, non-record artifacts, no itemId)", () => {
      expect(
        isIntelligenceItemReadWire({ artifacts: itemRead.artifacts }),
      ).toBe(false);
      expect(
        isIntelligenceItemReadWire({ audioStreamLegallyAvailable: "yes", artifacts: itemRead.artifacts }),
      ).toBe(false);
      expect(isIntelligenceItemReadWire({ audioStreamLegallyAvailable: true, artifacts: null })).toBe(false);
      expect(
        isIntelligenceItemReadWire({
          audioStreamLegallyAvailable: true,
          artifacts: { itemId: "" },
        }),
      ).toBe(false);
    });
  });

  describe("the transport interface (the seam the hosts bind)", () => {
    it("a transport implementation serves readiness + both reads with typed outcomes", async () => {
      const transport: IntelligenceReadTransport = {
        transportId: "test-double",
        readiness: () => ({
          kind: "not-serving",
          transport: "test-double",
          detail: "the double does not serve",
          dependency: "the dependency sentence",
        }),
        searchByMeaning: async () => ({
          kind: "not-served",
          reason: "transport-unavailable",
          detail: "the read is off",
          dependency: "the dependency sentence",
        }),
        itemArtifacts: async () => ({
          kind: "not-served",
          reason: "no-derived-artifacts",
          detail: "no artifacts",
          dependency: "the pipeline has not run",
        }),
      };
      expect(transport.transportId).toBe("test-double");
      expect(transport.readiness().kind).toBe("not-serving");
      const search = await transport.searchByMeaning("query");
      expect(search.kind).toBe("not-served");
      if (search.kind === "not-served") {
        expect(search.reason).toBe("transport-unavailable");
        expect(search.dependency).toContain("dependency");
      }
      const item = await transport.itemArtifacts("ref");
      expect(item.kind).toBe("not-served");
      if (item.kind === "not-served") {
        expect(item.reason).toBe("no-derived-artifacts");
      }
    });
  });
});
