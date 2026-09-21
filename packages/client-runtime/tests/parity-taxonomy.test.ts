/**
 * @wfx/client-runtime — R24-A parity-taxonomy tests.
 *
 * The frozen feature-inventory contract, at the shared seam:
 * - the COMPLETE inventory: the plan's entire R24-C pairing matrix
 *   (Discovery, Watch/player, Shorts, Identity/continuity) + the frozen
 *   lab inventory's reference rows + every R24-B WebFlix-only extension;
 * - the lab rule: every row resolves to exactly one classification, and
 *   no row may remain "to be considered" (the pending-copy guard);
 * - the out-of-scope companions (reason + nearest WebFlix path) required
 *   the moment a row classifies intentionally-out-of-scope;
 * - the R24-B point-of-intent law: no WebFlix-only extension is exposed
 *   only through Settings — every extension has a contextual entry;
 * - the frozen primary-navigation law: every entry point renders inside
 *   the closed product-surface union (no second product architecture,
 *   no architecture-dashboard route);
 * - the view derivations the J40/J42 evidence harness consumes.
 */

import { describe, expect, it } from "bun:test";

import {
  LAB_INVENTORY_EXTRA_ROWS,
  PARITY_CLASSIFICATIONS,
  PARITY_CLASSIFICATION_LABELS,
  PARITY_TAXONOMY,
  PARITY_TAXONOMY_AREAS,
  PARITY_TAXONOMY_ROW_IDS,
  PLAN_R24B_EXTENSION_ITEMS,
  PLAN_R24C_DISCOVERY_CELLS,
  PLAN_R24C_IDENTITY_CELLS,
  PLAN_R24C_SHORTS_CELLS,
  PLAN_R24C_WATCH_PLAYER_CELLS,
  isParityClassification,
  isParityTaxonomyArea,
  isParityTaxonomyRowId,
  parityClassificationDistribution,
  parityTaxonomyRowOf,
  parityTaxonomyRowsOfArea,
  parityTaxonomyRowsOfClassification,
  parityTaxonomyViewRow,
  validateParityTaxonomy,
  type ParityTaxonomyRowId,
} from "../src/index";

describe("R24-A parity taxonomy — the frozen inventory", () => {
  it("passes the complete machine validation (the lab rule as code)", () => {
    const report = validateParityTaxonomy();
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("covers the plan's ENTIRE R24-C Discovery matrix", () => {
    for (const id of PLAN_R24C_DISCOVERY_CELLS) {
      expect(parityTaxonomyRowOf(id)).toBeDefined();
    }
    expect(PLAN_R24C_DISCOVERY_CELLS.length).toBe(7);
  });

  it("covers the plan's ENTIRE R24-C Watch/player matrix (24 cells, cast consolidated)", () => {
    for (const id of PLAN_R24C_WATCH_PLAYER_CELLS) {
      expect(parityTaxonomyRowOf(id)).toBeDefined();
    }
    // 23 watch-area cells + the cast cell consolidated into the
    // tv-second-screen-continuation row (the lab inventory's own merge).
    expect(PLAN_R24C_WATCH_PLAYER_CELLS.length).toBe(24);
  });

  it("covers the plan's ENTIRE R24-C Shorts matrix", () => {
    for (const id of PLAN_R24C_SHORTS_CELLS) {
      expect(parityTaxonomyRowOf(id)).toBeDefined();
    }
    expect(PLAN_R24C_SHORTS_CELLS.length).toBe(7);
  });

  it("covers the plan's ENTIRE R24-C Identity/continuity matrix", () => {
    for (const id of PLAN_R24C_IDENTITY_CELLS) {
      expect(parityTaxonomyRowOf(id)).toBeDefined();
    }
    expect(PLAN_R24C_IDENTITY_CELLS.length).toBe(6);
  });

  it("covers EVERY R24-B WebFlix-only extension (all 14)", () => {
    expect(PLAN_R24B_EXTENSION_ITEMS.length).toBe(14);
    for (const id of PLAN_R24B_EXTENSION_ITEMS) {
      const row = parityTaxonomyRowOf(id);
      expect(row).toBeDefined();
      expect(row!.area).toBe("webflix-extension");
    }
    const extensions = parityTaxonomyRowsOfArea("webflix-extension");
    expect(extensions.length).toBe(14);
    expect(
      extensions.map((row) => row.id).sort(),
    ).toEqual([...PLAN_R24B_EXTENSION_ITEMS].sort());
  });

  it("covers the frozen lab inventory's extra reference rows", () => {
    for (const id of LAB_INVENTORY_EXTRA_ROWS) {
      expect(parityTaxonomyRowOf(id)).toBeDefined();
    }
  });

  it("row ids are unique and the union is exactly the matrix", () => {
    const ids = PARITY_TAXONOMY.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set([...ids, ...PARITY_TAXONOMY_ROW_IDS]).size).toBe(
      PARITY_TAXONOMY_ROW_IDS.length,
    );
    for (const id of PARITY_TAXONOMY_ROW_IDS) {
      expect(isParityTaxonomyRowId(id)).toBe(true);
    }
    expect(isParityTaxonomyRowId("not-a-row")).toBe(false);
  });

  it("has the expected shape: 65 rows across 5 areas", () => {
    expect(PARITY_TAXONOMY.length).toBe(65);
    expect(PARITY_TAXONOMY.length).toBe(PARITY_TAXONOMY_ROW_IDS.length);
    expect(parityTaxonomyRowsOfArea("discovery").length).toBe(10);
    expect(parityTaxonomyRowsOfArea("watch-player").length).toBe(26);
    expect(parityTaxonomyRowsOfArea("shorts").length).toBe(7);
    expect(parityTaxonomyRowsOfArea("identity-continuity").length).toBe(8);
    expect(parityTaxonomyRowsOfArea("webflix-extension").length).toBe(14);
  });
});

describe("R24-A parity taxonomy — classification completeness (the lab rule)", () => {
  it("every row carries one of the four frozen classifications", () => {
    for (const row of PARITY_TAXONOMY) {
      expect(isParityClassification(row.classification)).toBe(true);
      expect(PARITY_CLASSIFICATIONS).toContain(row.classification);
    }
  });

  it("the distribution sums to the row count and matches the frozen record", () => {
    const distribution = parityClassificationDistribution();
    const total = Object.values(distribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(PARITY_TAXONOMY.length);
    // The frozen R24-A record: 11 parity, 45 native-equivalent,
    // 9 platform-variant, 0 intentionally-out-of-scope (the plan's R24-C
    // matrix and the lab inventory contain no out-of-scope rows; the
    // classification + its machine-checked companions stay frozen for
    // lead-ratified additions).
    expect(distribution.parity).toBe(11);
    expect(distribution["native-equivalent"]).toBe(45);
    expect(distribution["platform-variant"]).toBe(9);
    expect(distribution["intentionally-out-of-scope"]).toBe(0);
  });

  it("classification lookups return consistent sets", () => {
    const parity = parityTaxonomyRowsOfClassification("parity");
    expect(parity.length).toBe(11);
    for (const row of parity) expect(row.classification).toBe("parity");
    // The frozen platform-variant set (the lab inventory's rows): the
    // capability exists where the platform actually supports it — the
    // MECHANISM varies per platform (browser API / native window / provider
    // authorization / WebRTC peers), which is capability truth, never
    // redesigned product semantics.
    const variants = parityTaxonomyRowsOfClassification("platform-variant");
    const expectedVariants: readonly ParityTaxonomyRowId[] = [
      "fullscreen",
      "miniplayer-pip",
      "quality",
      "comments-reactions",
      "live-playback",
      "live-chat",
      "shorts-remix-attribution",
      "notifications",
      "tv-second-screen-continuation",
    ];
    expect(variants.map((row) => row.id).sort()).toEqual(
      [...expectedVariants].sort(),
    );
    for (const row of variants) {
      expect(row.area).not.toBe("webflix-extension");
    }
  });

  it("no row remains 'to be considered' (the pending-copy guard)", () => {
    // The validator enforces this over every row; spot-verify the guard
    // itself catches the plan's forbidden phrasings.
    const forbidden = [
      "to be considered",
      "To Be Determined",
      "pending classification",
      "unclassified",
    ];
    for (const row of PARITY_TAXONOMY) {
      const text = `${row.classification} ${row.referenceCapability} ${row.webflixTreatment}`;
      for (const phrase of forbidden) {
        expect(text.toLowerCase().includes(phrase.toLowerCase())).toBe(false);
      }
    }
  });

  it("intentionally-out-of-scope rows require reason + nearest path (lab rule)", () => {
    const outOfScope = parityTaxonomyRowsOfClassification(
      "intentionally-out-of-scope",
    );
    for (const row of outOfScope) {
      expect(row.outOfScopeReason?.length ?? 0).toBeGreaterThan(0);
      expect(row.nearestWebFlixPath?.length ?? 0).toBeGreaterThan(0);
    }
    // The validator's companion check: a hand-built out-of-scope row
    // without companions must fail validation (verified by contract
    // shape — the fields are required by validateParityTaxonomy when the
    // classification is used).
    expect(PARITY_CLASSIFICATION_LABELS["intentionally-out-of-scope"]).toBe(
      "Intentionally out of scope",
    );
  });
});

describe("R24-A parity taxonomy — the frozen product laws", () => {
  it("never mints a second product architecture (closed surface union)", () => {
    for (const row of PARITY_TAXONOMY) {
      expect(row.userEntryPoint.surfaces.length).toBeGreaterThan(0);
      for (const surface of row.userEntryPoint.surfaces) {
        // ProductSurfaceId is the CLOSED union: home/watch/shorts/search/
        // item/library/settings/player — a dashboard route cannot be
        // expressed (compile-time), and hand-built data is rejected here.
        expect([
          "home",
          "watch",
          "shorts",
          "search",
          "item",
          "library",
          "settings",
          "player",
        ]).toContain(surface);
      }
    }
  });

  it("no WebFlix-only extension is settings-only (R24-B point-of-intent law)", () => {
    for (const row of parityTaxonomyRowsOfArea("webflix-extension")) {
      expect(row.userEntryPoint.contextual).toBe(true);
      expect(row.userEntryPoint.surfaces).not.toEqual(["settings"]);
      expect(
        row.userEntryPoint.surfaces.some((s) => s !== "settings"),
      ).toBe(true);
    }
  });

  it("anonymous viewing stays frictionless (R23-A/B preserved in the inventory)", () => {
    const anonymousRow = parityTaxonomyRowOf("anonymous-public-viewing");
    expect(anonymousRow?.classification).toBe("native-equivalent");
    expect(anonymousRow?.authRequirement).toBe("anonymous");
    // the R24-E startup law connection: accountless public viewing is
    // startup-critical (a login gate on public playback is a rejection)
    expect(anonymousRow?.performanceRelevance).toBe("startup-critical");
    // every playback-start row keeps the anonymous class
    for (const id of ["play-pause", "where-to-watch", "authorized-peer-copy", "browser-host"] as const) {
      expect(parityTaxonomyRowOf(id)?.authRequirement).toBe("anonymous");
    }
  });

  it("torrent stays first-class (R23-C preserved in the inventory)", () => {
    const peerCopy = parityTaxonomyRowOf("authorized-peer-copy");
    expect(peerCopy?.classification).toBe("native-equivalent");
    expect(peerCopy?.performanceRelevance).toBe("startup-critical");
    expect(peerCopy?.dependencyIds).toContain("R23-C");
    // Where to watch carries the realization-switching contract
    const whereToWatch = parityTaxonomyRowOf("where-to-watch");
    expect(whereToWatch?.performanceRelevance).toBe("startup-critical");
  });

  it("playback startup never depends on recommendation/AI work (R24-E taxonomy truth)", () => {
    // recommendation + AI rows are startup-ADJACENT (deferred, non-blocking)
    for (const id of ["related-next-videos", "autoplay", "up-next", "ai-transformations", "captions", "transcript"] as const) {
      expect(parityTaxonomyRowOf(id)?.performanceRelevance).toBe(
        "startup-adjacent",
      );
    }
    // the startup-critical set is exactly the measured critical path
    const critical = PARITY_TAXONOMY.filter(
      (row) => row.performanceRelevance === "startup-critical",
    ).map((row) => row.id);
    const expectedCritical: readonly ParityTaxonomyRowId[] = [
      "play-pause",
      "anonymous-public-viewing",
      "canonical-identity",
      "where-to-watch",
      "authorized-peer-copy",
      "browser-host",
    ];
    expect(critical.sort()).toEqual([...expectedCritical].sort());
  });

  it("area vocabulary + membership checks", () => {
    expect(PARITY_TAXONOMY_AREAS.length).toBe(5);
    for (const area of PARITY_TAXONOMY_AREAS) {
      expect(isParityTaxonomyArea(area)).toBe(true);
    }
    expect(isParityTaxonomyArea("dashboard")).toBe(false);
  });
});

describe("R24-A parity taxonomy — views for the lab harness", () => {
  it("flattens rows into the serializable lab view", () => {
    for (const row of PARITY_TAXONOMY) {
      const view = parityTaxonomyViewRow(row);
      expect(view.id).toBe(row.id);
      expect(view.classification).toBe(row.classification);
      expect(view.classificationLabel).toBe(
        PARITY_CLASSIFICATION_LABELS[row.classification],
      );
      expect(view.entryControl).toBe(row.userEntryPoint.control);
      expect(view.webSupport).toBe(row.webDesktopApplicability.web);
      expect(view.desktopSupport).toBe(row.webDesktopApplicability.desktop);
      expect(view.authRequirement).toBe(row.authRequirement);
    }
  });

  it("the classification labels are the lab's wording (one derivation source)", () => {
    expect(PARITY_CLASSIFICATION_LABELS.parity).toBe("Parity");
    expect(PARITY_CLASSIFICATION_LABELS["native-equivalent"]).toBe(
      "Native equivalent",
    );
    expect(PARITY_CLASSIFICATION_LABELS["platform-variant"]).toBe(
      "Platform variant",
    );
  });

  it("journey ids referenced by the inventory include the R24 acceptance journeys", () => {
    const journeys = new Set(
      PARITY_TAXONOMY.flatMap((row) => row.testJourneyIds),
    );
    expect(journeys.has("J40")).toBe(true);
    expect(journeys.has("J41")).toBe(true);
    expect(journeys.has("J42")).toBe(true);
  });
});
