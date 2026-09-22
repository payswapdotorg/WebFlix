/**
 * @wfx/platform-contracts — the capability-AVAILABILITY contract tests
 * (R26-W1).
 *
 * The production capability-truth law, machine-checked:
 * - the closed capability vocabulary (no per-platform drift);
 * - the typed served/not-served truths and their guards;
 * - the report fold REJECTS unknown capabilities (drift is an error);
 * - THE RENDER LAW: a not-served (or unreported) capability NEVER
 *   renders as usable.
 */

import { describe, expect, it } from "bun:test";

import {
  SERVED_CAPABILITY_KINDS,
  capabilityAvailabilityReportOf,
  capabilityMayRenderAsUsable,
  capabilityTruthOf,
  isCapabilityAvailabilityEntry,
  isCapabilityAvailabilityReport,
  isCapabilityNextAction,
  isCapabilityServingTruth,
  isServedCapabilityKind,
  type CapabilityAvailabilityEntry,
} from "../src/index";

describe("capability-availability contract (R26-W1)", () => {
  describe("the closed vocabulary", () => {
    it("carries exactly the six canonical capabilities in canonical order", () => {
      expect([...SERVED_CAPABILITY_KINDS]).toEqual([
        "semantic-search",
        "moment-retrieval",
        "multimodal-intelligence",
        "realization-availability",
        "realtime-bridge",
        "artwork",
      ]);
    });

    it("recognizes every member and rejects unknown kinds", () => {
      for (const kind of SERVED_CAPABILITY_KINDS) {
        expect(isServedCapabilityKind(kind)).toBe(true);
      }
      expect(isServedCapabilityKind("semantic")).toBe(false);
      expect(isServedCapabilityKind("translate")).toBe(false);
      expect(isServedCapabilityKind("")).toBe(false);
      expect(isServedCapabilityKind(null)).toBe(false);
      expect(isServedCapabilityKind(42)).toBe(false);
    });
  });

  describe("the typed serving truths", () => {
    it("guards a truthful served row (no next action — the law: served rows never carry one)", () => {
      expect(
        isCapabilityServingTruth({
          kind: "served",
          transport: "dev-fixture-index",
          detail: "the deterministic dev index",
        }),
      ).toBe(true);
      expect(
        isCapabilityServingTruth({
          kind: "served",
          transport: "dev-fixture-index",
          detail: "x",
          nextAction: { label: "should not be here" },
        }),
      ).toBe(false);
    });

    it("guards a truthful not-served row with and without a real next action", () => {
      const withAction = {
        kind: "not-served",
        transport: "experience-api-http",
        detail: "the route is absent",
        nextAction: { label: "Search by title still works", href: "/search" },
      };
      expect(isCapabilityServingTruth(withAction)).toBe(true);
      expect(
        isCapabilityServingTruth({
          kind: "not-served",
          transport: "x",
          detail: "y",
        }),
      ).toBe(true);
    });

    it("rejects malformed rows (empty transport, empty detail, bad action shapes, unknown kind)", () => {
      expect(isCapabilityServingTruth({ kind: "served", transport: "", detail: "d" })).toBe(false);
      expect(isCapabilityServingTruth({ kind: "served", transport: "t", detail: "" })).toBe(false);
      expect(isCapabilityServingTruth({ kind: "maybe", transport: "t", detail: "d" })).toBe(false);
      expect(
        isCapabilityServingTruth({
          kind: "not-served",
          transport: "t",
          detail: "d",
          nextAction: { label: "" },
        }),
      ).toBe(false);
      expect(
        isCapabilityServingTruth({
          kind: "not-served",
          transport: "t",
          detail: "d",
          nextAction: { label: "ok", href: 7 },
        }),
      ).toBe(false);
      expect(isCapabilityNextAction({ label: "a", href: "/b", detail: "c" })).toBe(true);
      expect(isCapabilityNextAction(null)).toBe(false);
    });
  });

  describe("the report fold", () => {
    it("accepts a complete truthful report and reads entries by capability", () => {
      const entries: CapabilityAvailabilityEntry[] = [
        {
          capability: "semantic-search",
          truth: {
            kind: "not-served",
            transport: "experience-api-http",
            detail: "the service-side route is the missing dependency",
          },
        },
        {
          capability: "realtime-bridge",
          truth: {
            kind: "served",
            transport: "wfx-realtime-bridge",
            detail: "the bridge is serving",
          },
        },
      ];
      const report = capabilityAvailabilityReportOf(entries);
      expect(report.entries).toHaveLength(2);
      expect(capabilityTruthOf(report, "semantic-search")?.kind).toBe("not-served");
      expect(capabilityTruthOf(report, "realtime-bridge")?.kind).toBe("served");
      expect(capabilityTruthOf(report, "artwork")).toBeNull();
      expect(isCapabilityAvailabilityReport(report)).toBe(true);
      expect(isCapabilityAvailabilityReport({ entries: "no" })).toBe(false);
      expect(isCapabilityAvailabilityEntry({ capability: "artwork" })).toBe(false);
    });

    it("REJECTS an entry naming an unknown capability (drift is an error, never a silent drop)", () => {
      expect(() =>
        capabilityAvailabilityReportOf([
          {
            capability: "teleportation" as never,
            truth: { kind: "served", transport: "x", detail: "y" },
          },
        ]),
      ).toThrow();
      expect(() =>
        capabilityAvailabilityReportOf([
          { capability: "artwork", truth: { kind: "nope", transport: "x", detail: "y" } as never },
        ]),
      ).toThrow();
    });
  });

  describe("THE RENDER LAW", () => {
    it("a served capability renders as usable; a not-served one NEVER does", () => {
      const report = capabilityAvailabilityReportOf([
        {
          capability: "semantic-search",
          truth: { kind: "served", transport: "t", detail: "d" },
        },
        {
          capability: "realtime-bridge",
          truth: {
            kind: "not-served",
            transport: "t",
            detail: "the bridge is not serving",
            nextAction: { label: "captions still work" },
          },
        },
      ]);
      expect(capabilityMayRenderAsUsable(report, "semantic-search")).toBe(true);
      expect(capabilityMayRenderAsUsable(report, "realtime-bridge")).toBe(false);
    });

    it("a capability the host did not even report is NOT usable by construction", () => {
      const report = capabilityAvailabilityReportOf([]);
      expect(capabilityMayRenderAsUsable(report, "semantic-search")).toBe(false);
      expect(capabilityMayRenderAsUsable(report, "artwork")).toBe(false);
    });
  });
});
