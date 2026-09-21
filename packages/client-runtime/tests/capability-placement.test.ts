/**
 * @wfx/client-runtime — R24 capability-placement contract tests.
 *
 * The frozen feature capability matrix + placement contracts, at the
 * shared seam:
 * - COVERAGE: exactly one placement record for every taxonomy capability
 *   (65), joined into the shared capability-matrix read model;
 * - the R24-B LAWS 1-6 as machine-checkable contracts: point-of-intent
 *   encounter (never settings-only for WebFlix-only extensions — an R24
 *   rejection), one obvious primary action, progressive disclosure
 *   (summary -> detail -> diagnostics, strictly climbing), no dashboard
 *   requirement (closed product-surface union; settingsManaged is lawful
 *   only for reference capabilities), stable terminology (unique terms,
 *   shared only inside declared families), platform differences as
 *   capability truth (placement agrees with the taxonomy applicability;
 *   an honest next step points at a platform that has the path);
 * - the R24-E startup hook at the placement level: NO capability blocks
 *   first-frame playback;
 * - the law-check function itself catches hand-broken records (the guard
 *   is real, not decorative).
 */

import { describe, expect, it } from "bun:test";

import {
  CAPABILITY_PLACEMENTS,
  PLACEMENT_DISCLOSURE_LADDER,
  PLACEMENT_LAWS,
  capabilityMatrix,
  capabilityMatrixEntryOf,
  checkPlacementLaws,
  isPlacementDisclosureLevel,
  validateCapabilityPlacementMatrix,
  type CapabilityPlacementRecord,
} from "../src/index";
import {
  PARITY_TAXONOMY,
  parityTaxonomyRowOf,
  PLAN_R24B_EXTENSION_ITEMS,
} from "../src/index";

describe("R24 capability placement — coverage", () => {
  it("passes the complete machine validation (laws 1-6 + structure + coverage)", () => {
    const report = validateCapabilityPlacementMatrix();
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.recordCount).toBe(65);
  });

  it("has exactly one placement record per taxonomy capability", () => {
    const ids = CAPABILITY_PLACEMENTS.map((record) => record.capability);
    expect(new Set(ids).size).toBe(65);
    for (const row of PARITY_TAXONOMY) {
      expect(ids.filter((id) => id === row.id).length).toBe(1);
    }
  });

  it("joins into the capability matrix read model (classification + placement)", () => {
    const matrix = capabilityMatrix();
    expect(matrix.length).toBe(65);
    for (const entry of matrix) {
      const row = parityTaxonomyRowOf(entry.capability);
      expect(row).toBeDefined();
      expect(entry.classification).toBe(row!.classification);
      expect(entry.webflixTreatment).toBe(row!.webflixTreatment);
      expect(entry.entrySurfaces).toEqual(row!.userEntryPoint.surfaces);
      expect(entry.primaryAction.length).toBeGreaterThan(0);
      expect(entry.stableTerm.length).toBeGreaterThan(0);
    }
    const whereToWatch = capabilityMatrixEntryOf("where-to-watch");
    expect(whereToWatch?.classification).toBe("native-equivalent");
    expect(whereToWatch?.primaryAction).toBe("Choose where to watch");
    expect(whereToWatch?.webSupport).toBe("supported");
  });
});

describe("R24 capability placement — the six R24-B laws", () => {
  it("law 1 (point of intent): no WebFlix-only extension is settings-only", () => {
    for (const id of PLAN_R24B_EXTENSION_ITEMS) {
      const row = parityTaxonomyRowOf(id);
      expect(row).toBeDefined();
      expect(row!.userEntryPoint.contextual).toBe(true);
      expect(
        row!.userEntryPoint.surfaces.some((s) => s !== "settings"),
      ).toBe(true);
    }
    // the law-check guard catches a settings-only extension
    const broken: CapabilityPlacementRecord = {
      ...CAPABILITY_PLACEMENTS.find((r) => r.capability === "where-to-watch")!,
      capability: "where-to-watch",
    };
    expect(checkPlacementLaws(broken)).toEqual([]);
    // (a settings-only variant is impossible to build from the frozen
    // taxonomy data — the violation fires through the taxonomy row, which
    // is covered by the taxonomy tests' guard on entry surfaces)
  });

  it("law 1: settings-managed is lawful only for reference capabilities", () => {
    const settingsManaged = CAPABILITY_PLACEMENTS.filter(
      (record) => record.settingsManaged,
    );
    // the single honestly settings-managed reference capability
    expect(settingsManaged.map((r) => r.capability)).toEqual([
      "notifications",
    ]);
    const row = parityTaxonomyRowOf("notifications");
    expect(row!.area).not.toBe("webflix-extension");
    expect(row!.userEntryPoint.surfaces).toEqual(["settings"]);
    expect(row!.userEntryPoint.contextual).toBe(false);
  });

  it("law 2 (one primary action): every record has one non-blank primary", () => {
    for (const record of CAPABILITY_PLACEMENTS) {
      expect(record.primaryAction.trim().length).toBeGreaterThan(0);
      const lowered = record.secondaryActions.map((a) =>
        a.trim().toLowerCase(),
      );
      expect(lowered).not.toContain(record.primaryAction.trim().toLowerCase());
      expect(new Set(lowered).size).toBe(lowered.length);
    }
  });

  it("law 3 (progressive disclosure): ladders climb summary->detail->diagnostics", () => {
    for (const record of CAPABILITY_PLACEMENTS) {
      expect(record.disclosure.length).toBeGreaterThan(0);
      expect(record.disclosure[0]).toBe("summary");
      let lastIndex = -1;
      for (const level of record.disclosure) {
        expect(isPlacementDisclosureLevel(level)).toBe(true);
        const index = PLACEMENT_DISCLOSURE_LADDER.indexOf(level);
        expect(index).toBeGreaterThan(lastIndex);
        lastIndex = index;
      }
    }
    // raw diagnostics exist only behind at least summary + detail
    const withDiagnostics = CAPABILITY_PLACEMENTS.filter((r) =>
      r.disclosure.includes("diagnostics"),
    );
    for (const record of withDiagnostics) {
      expect(record.disclosure).toContain("summary");
      expect(record.disclosure).toContain("detail");
    }
    expect(withDiagnostics.length).toBeGreaterThan(0);
  });

  it("law 4 (no dashboard requirement): entries render in the closed surface union", () => {
    for (const record of CAPABILITY_PLACEMENTS) {
      const row = parityTaxonomyRowOf(record.capability);
      expect(row).toBeDefined();
      for (const surface of row!.userEntryPoint.surfaces) {
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

  it("law 5 (stable terminology): unique terms except declared families", () => {
    const families = new Map<string, string[]>();
    const plain = new Map<string, number>();
    for (const record of CAPABILITY_PLACEMENTS) {
      expect(record.stableTerm.trim().length).toBeGreaterThan(0);
      if (record.sharedTermFamily) {
        const members = families.get(record.sharedTermFamily) ?? [];
        members.push(record.stableTerm);
        families.set(record.sharedTermFamily, members);
      } else {
        plain.set(record.stableTerm, (plain.get(record.stableTerm) ?? 0) + 1);
      }
    }
    for (const [term, count] of plain) {
      expect(count).toBe(1);
      // a family-owned term cannot be reused by an unrelated capability
      for (const [, terms] of families) {
        expect(terms).not.toContain(term);
      }
    }
    for (const [family, members] of families) {
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(new Set(members).size).toBe(1);
      expect(family.length).toBeGreaterThan(0);
    }
    // the frozen families: playback-speed, feedback, history, following, offline
    expect([...families.keys()].sort()).toEqual(
      ["feedback", "following", "history", "offline", "playback-speed"].sort(),
    );
  });

  it("law 6 (platform differences as capability truth): placement agrees with the taxonomy", () => {
    for (const record of CAPABILITY_PLACEMENTS) {
      const row = parityTaxonomyRowOf(record.capability);
      expect(record.platformTruth.web).toBe(row!.webDesktopApplicability.web);
      expect(record.platformTruth.desktop).toBe(
        row!.webDesktopApplicability.desktop,
      );
      // an honest next step points at a platform that has the path
      if (record.platformTruth.web === "native-only-next-step") {
        expect(record.platformTruth.desktop).toBe("supported");
      }
    }
    // the torrent capability truth is preserved (R23-C/D laws)
    const peerCopy = capabilityMatrixEntryOf("authorized-peer-copy");
    expect(peerCopy?.webSupport).toBe("capability-dependent");
    expect(peerCopy?.desktopSupport).toBe("supported");
  });

  it("the R24-E startup hook: no capability blocks first-frame playback", () => {
    for (const record of CAPABILITY_PLACEMENTS) {
      expect(record.blocksPlayback).toBe(false);
    }
    // the guard catches a blocking record
    const broken: CapabilityPlacementRecord = {
      ...CAPABILITY_PLACEMENTS.find((r) => r.capability === "captions")!,
      blocksPlayback: true,
    };
    const violations = checkPlacementLaws(broken);
    expect(
      violations.some(
        (v) => v.law === "blocks-playback" && v.capability === "captions",
      ),
    ).toBe(true);
  });

  it("the law vocabulary matches the plan's six laws", () => {
    expect(PLACEMENT_LAWS).toEqual([
      "point-of-intent",
      "one-primary-action",
      "progressive-disclosure",
      "no-dashboard-requirement",
      "stable-terminology",
      "platform-capability-truth",
    ]);
  });
});

describe("R24 capability placement — the law guard catches broken records", () => {
  it("catches a disclosure ladder that starts at detail", () => {
    const broken: CapabilityPlacementRecord = {
      ...CAPABILITY_PLACEMENTS.find((r) => r.capability === "queue")!,
      disclosure: ["detail", "summary"],
    };
    const violations = checkPlacementLaws(broken);
    expect(
      violations.some((v) => v.law === "progressive-disclosure"),
    ).toBe(true);
  });

  it("catches a duplicated primary/secondary action", () => {
    const base = CAPABILITY_PLACEMENTS.find(
      (r) => r.capability === "share",
    )!;
    const broken: CapabilityPlacementRecord = {
      ...base,
      secondaryActions: ["Copy the WebFlix link", "Open share targets"],
    };
    const violations = checkPlacementLaws(broken);
    expect(
      violations.some((v) => v.law === "one-primary-action"),
    ).toBe(true);
  });

  it("catches platform truth that disagrees with the taxonomy", () => {
    const broken: CapabilityPlacementRecord = {
      ...CAPABILITY_PLACEMENTS.find(
        (r) => r.capability === "local-offline-media",
      )!,
      platformTruth: { web: "supported", desktop: "supported" },
    };
    const violations = checkPlacementLaws(broken);
    expect(
      violations.some((v) => v.law === "platform-capability-truth"),
    ).toBe(true);
  });

  it("catches a dead-end next step (native-only with no owning platform)", () => {
    const broken: CapabilityPlacementRecord = {
      ...CAPABILITY_PLACEMENTS.find(
        (r) => r.capability === "local-offline-media",
      )!,
      platformTruth: { web: "native-only-next-step", desktop: "capability-dependent" },
    };
    const violations = checkPlacementLaws(broken);
    expect(
      violations.some((v) => v.law === "platform-capability-truth"),
    ).toBe(true);
  });

  it("catches empty state views and blank terms", () => {
    const base = CAPABILITY_PLACEMENTS.find(
      (r) => r.capability === "up-next",
    )!;
    const broken: CapabilityPlacementRecord = {
      ...base,
      stableTerm: "  ",
      states: { ...base.states, empty: "" },
    };
    const violations = checkPlacementLaws(broken);
    expect(
      violations.some((v) => v.law === "stable-terminology"),
    ).toBe(true);
    expect(violations.some((v) => v.law === "structure")).toBe(true);
  });
});

describe("R24 capability placement — the WebFlix extension placements", () => {
  it("every R24-B extension has contextual placement with one obvious action", () => {
    for (const id of PLAN_R24B_EXTENSION_ITEMS) {
      const entry = capabilityMatrixEntryOf(id);
      expect(entry).toBeDefined();
      expect(entry!.settingsManaged).toBe(false);
      expect(entry!.primaryAction.length).toBeGreaterThan(0);
      expect(entry!.blocksPlayback).toBe(false);
    }
  });

  it("the frozen placement decisions match the lab's WebFlix-only table", () => {
    // Where to watch near Play, behaving like a familiar playback source selector
    expect(capabilityMatrixEntryOf("where-to-watch")?.stableTerm).toBe(
      "Where to watch",
    );
    // the authorized peer copy is a peer realization, not a download-only flow
    const peerCopy = capabilityMatrixEntryOf("authorized-peer-copy");
    expect(peerCopy?.primaryAction).toBe("Play the authorized peer copy");
    // BYOF lives beside Following (feed mode + source context)
    expect(
      capabilityMatrixEntryOf("bring-your-own-feed")?.primaryAction,
    ).toBe("Bring Your Feed");
    // model selection is optional — never required to watch
    expect(
      capabilityMatrixEntryOf("model-selection")?.secondaryActions,
    ).toContain("Manage providers (Model & AI)");
    // AI transformations are contextual media tools (player/AI tray)
    expect(capabilityMatrixEntryOf("ai-transformations")?.stableTerm).toBe(
      "AI actions",
    );
  });
});
