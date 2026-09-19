/**
 * @wfx/domain tests — the BYOF reconciliation engine (R20-C, Worker 1).
 *
 * Every test pins a LAW from docs/architecture/byof-architecture.md and the
 * R20 truth laws:
 * - re-importing an unchanged capture is a NO-OP (idempotence);
 * - source removals delete feed records only; a scoped capture never
 *   touches out-of-scope records;
 * - source-native order changes are updates carrying data, never ranks;
 * - intra-capture duplicates collapse (first occurrence wins);
 * - the report fold pins preservedLocalActions.
 */

import { describe, expect, test } from "bun:test";

import type { ConnectorFeedSnapshot } from "../src/index";
import {
  feedImportKey,
  feedReconciliationReport,
  reconcileFeedSnapshot,
  type ReconcileFeedRecordInput,
  type ReconcileScope,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures (synthetic; the repo's no-network law)
// ---------------------------------------------------------------------------

const PROFILE = "wfx_profile_a";
const CONNECTOR = "youtube";

const scope: ReconcileScope = { profileId: PROFILE, connectorId: CONNECTOR };

function snapshot(
  items: ConnectorFeedSnapshot["items"],
  overrides: Partial<ConnectorFeedSnapshot> = {},
): ConnectorFeedSnapshot {
  return {
    connectorId: CONNECTOR,
    method: "api",
    capturedAt: "2026-09-19T10:00:00Z",
    continuousSync: true,
    orderSemantics: "source-native",
    syncState: "snapshot",
    items,
    ...overrides,
  };
}

function record(
  externalRef: string,
  overrides: {
    relationship?: ConnectorFeedSnapshot["items"][number]["relationship"];
    sourceRef?: string;
    sourceOrder?: number;
    sourceUpdatedAt?: string;
    title?: string;
  } = {},
): ReconcileFeedRecordInput {
  return {
    profileId: PROFILE,
    externalRef,
    provenance: {
      connectorId: CONNECTOR,
      ...(overrides.sourceRef !== undefined ? { sourceRef: overrides.sourceRef } : {}),
      relationship: overrides.relationship ?? "playlist",
      sourceOrder: overrides.sourceOrder ?? 0,
      capturedAt: "2026-09-01T00:00:00Z",
    },
    ...(overrides.sourceUpdatedAt !== undefined
      ? { sourceUpdatedAt: overrides.sourceUpdatedAt }
      : {}),
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
  };
}

// ---------------------------------------------------------------------------
// The decision table
// ---------------------------------------------------------------------------

describe("reconcileFeedSnapshot — the decision table", () => {
  test("new items are adds with materialization payloads in source-native order", () => {
    const plan = reconcileFeedSnapshot([], snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, title: "First" },
      { externalRef: "Wfx54Short01", relationship: "playlist", sourceOrder: 1, title: "Second" },
    ]), scope);
    expect(plan.counts).toEqual({ added: 2, updated: 0, removed: 0, kept: 0, deduplicated: 0 });
    expect(plan.decisions.map((d) => d.action)).toEqual(["add", "add"]);
    expect(plan.upserts.map((u) => u.item.externalRef)).toEqual(["Wfx54Docu001", "Wfx54Short01"]);
    expect(plan.decisions.every((d) => d.reason === "new-item")).toBe(true);
  });

  test("an unchanged capture is a NO-OP (the re-import idempotence law)", () => {
    const existing = [
      record("Wfx54Docu001", { sourceOrder: 0, title: "First", sourceUpdatedAt: "2025-03-14T09:00:00Z" }),
      record("Wfx54Short01", { sourceOrder: 1, title: "Second" }),
    ];
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, title: "First", sourceUpdatedAt: "2025-03-14T09:00:00Z" },
      { externalRef: "Wfx54Short01", relationship: "playlist", sourceOrder: 1, title: "Second" },
    ]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts).toEqual({ added: 0, updated: 0, removed: 0, kept: 2, deduplicated: 0 });
    expect(plan.upserts).toEqual([]);
    expect(plan.decisions.every((d) => d.action === "keep" && d.reason === "unchanged")).toBe(true);
  });

  test("a changed source timestamp is a source-changed update", () => {
    const existing = [record("Wfx54Docu001", { sourceUpdatedAt: "2025-03-14T09:00:00Z" })];
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, sourceUpdatedAt: "2025-04-01T09:00:00Z" },
    ]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts.updated).toBe(1);
    expect(plan.decisions[0]?.reason).toBe("source-changed");
  });

  test("a RE-ENCODED timestamp (persistence round-trip normalization) is NOT a source change", () => {
    // The store round-trips timestamptz through `toISOString()` —
    // "2025-03-14T09:00:00Z" comes back "2025-03-14T09:00:00.000Z". The
    // same instant re-encoded is the SAME knowledge: keep, never a
    // phantom update (R20-C, found through the service composition).
    const existing = [record("Wfx54Docu001", { sourceUpdatedAt: "2025-03-14T09:00:00.000Z", sourceOrder: 2 })];
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 2, sourceUpdatedAt: "2025-03-14T09:00:00Z" },
    ]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts).toEqual({ added: 0, updated: 0, removed: 0, kept: 1, deduplicated: 0 });
    expect(plan.decisions[0]?.reason).toBe("unchanged");
  });

  test("a newly-absent timestamp IS a source change (absence is knowledge)", () => {
    const existing = [record("Wfx54Docu001", { sourceUpdatedAt: "2025-03-14T09:00:00Z" })];
    const capture = snapshot([{ externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0 }]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts.updated).toBe(1);
    expect(plan.decisions[0]?.reason).toBe("source-changed");
  });

  test("a changed title is a source-changed update (provenance refreshes)", () => {
    const existing = [record("Wfx54Docu001", { title: "Old Title" })];
    const capture = snapshot([{ externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, title: "New Title" }]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts.updated).toBe(1);
    expect(plan.decisions[0]?.reason).toBe("source-changed");
  });

  test("a source-native order change is an order-changed update (order is data)", () => {
    const existing = [record("Wfx54Docu001", { sourceOrder: 4 })];
    const capture = snapshot([{ externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0 }]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts.updated).toBe(1);
    expect(plan.decisions[0]?.reason).toBe("order-changed");
  });

  test("an item the source dropped is a source-removed removal", () => {
    const existing = [record("Wfx54Docu001"), record("Wfx54Short01")];
    const capture = snapshot([{ externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0 }]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts.removed).toBe(1);
    const removal = plan.decisions.find((d) => d.action === "remove");
    expect(removal?.externalRef).toBe("Wfx54Short01");
    expect(removal?.reason).toBe("source-removed");
  });

  test("an empty capture removes every in-scope record (the source emptied the feed)", () => {
    const existing = [record("Wfx54Docu001", { sourceOrder: 0 }), record("Wfx54Short01", { sourceOrder: 1 })];
    const plan = reconcileFeedSnapshot(existing, snapshot([]), scope);
    expect(plan.counts.removed).toBe(2);
    expect(plan.counts.added + plan.counts.updated + plan.counts.kept).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scope discipline (scoped truth only)
// ---------------------------------------------------------------------------

describe("reconcileFeedSnapshot — scope discipline", () => {
  test("a capture of one playlist NEVER removes another playlist's records", () => {
    const existing = [
      record("Wfx54Docu001", { sourceRef: "PL_A", sourceOrder: 0 }),
      record("Wfx54Docu001", { sourceRef: "PL_B", sourceOrder: 5 }),
    ];
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, sourceRef: "PL_A" },
    ]);
    const plan = reconcileFeedSnapshot(existing, capture, { ...scope, sourceRef: "PL_A" });
    expect(plan.counts).toEqual({ added: 0, updated: 0, removed: 0, kept: 1, deduplicated: 0 });
  });

  test("a relationship-scoped sync never removes other relationships' records", () => {
    const existing = [
      record("Wfx54Docu001", { relationship: "like", sourceRef: "LL", sourceOrder: 0 }),
      record("Wfx54Docu001", { relationship: "playlist", sourceRef: "PL_A", sourceOrder: 0 }),
    ];
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "like", sourceOrder: 0, sourceRef: "LL" },
    ]);
    const plan = reconcileFeedSnapshot(existing, capture, { ...scope, relationships: ["like"] });
    expect(plan.counts.removed).toBe(0);
    expect(plan.counts.kept).toBe(1);
  });

  test("records of another connector are never in scope", () => {
    const foreign = { ...record("Wfx54Docu001"), provenance: { ...record("Wfx54Docu001").provenance, connectorId: "vimeo" } };
    const plan = reconcileFeedSnapshot([foreign], snapshot([]), scope);
    expect(plan.counts.removed).toBe(0);
  });

  test("records of another profile are never in scope", () => {
    const foreign = { ...record("Wfx54Docu001"), profileId: "wfx_profile_b" };
    const plan = reconcileFeedSnapshot([foreign], snapshot([]), scope);
    expect(plan.counts.removed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Intra-capture deduplication
// ---------------------------------------------------------------------------

describe("reconcileFeedSnapshot — intra-capture deduplication", () => {
  test("the same relationship twice in one capture collapses to the first occurrence", () => {
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, title: "First occurrence" },
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 3, title: "Later occurrence" },
    ]);
    const plan = reconcileFeedSnapshot([], capture, scope);
    expect(plan.counts).toEqual({ added: 1, updated: 0, removed: 0, kept: 0, deduplicated: 1 });
    expect(plan.upserts[0]?.item.sourceOrder).toBe(0);
    expect(plan.upserts[0]?.item.title).toBe("First occurrence");
  });

  test("the same external item under DIFFERENT relationships is two records (no false collapse)", () => {
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "like", sourceOrder: 0 },
      { externalRef: "Wfx54Docu001", relationship: "watchlist", sourceOrder: 0 },
    ]);
    const plan = reconcileFeedSnapshot([], capture, scope);
    expect(plan.counts.added).toBe(2);
    expect(plan.counts.deduplicated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Key integrity through the engine
// ---------------------------------------------------------------------------

describe("reconcileFeedSnapshot — import-key integrity", () => {
  test("every decision's key round-trips feedImportKey of its identity", () => {
    const capture = snapshot([
      { externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0, sourceRef: "PL_A" },
    ]);
    const plan = reconcileFeedSnapshot([], capture, { ...scope, sourceRef: "PL_A" });
    const decision = plan.decisions[0];
    expect(decision).toBeDefined();
    expect(decision?.key).toBe(
      feedImportKey({
        profileId: PROFILE,
        connectorId: CONNECTOR,
        relationship: "playlist",
        sourceRef: "PL_A",
        externalRef: "Wfx54Docu001",
      }),
    );
  });

  test("an existing record keyed with absent sourceRef matches a containerless capture", () => {
    const existing = [record("UCWfx54Channel00000000000A", { relationship: "follow" })];
    const capture = snapshot([
      { externalRef: "UCWfx54Channel00000000000A", relationship: "follow", sourceOrder: 0 },
    ]);
    const plan = reconcileFeedSnapshot(existing, capture, scope);
    expect(plan.counts.kept).toBe(1);
    expect(plan.counts.added).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The report fold
// ---------------------------------------------------------------------------

describe("feedReconciliationReport", () => {
  test("folds a plan into the frozen report shape with preservedLocalActions pinned true", () => {
    const capture = snapshot([{ externalRef: "Wfx54Docu001", relationship: "playlist", sourceOrder: 0 }]);
    const plan = reconcileFeedSnapshot([], capture, scope);
    const report = feedReconciliationReport(plan, {
      importId: "wfximp_0000000000000000000000000A",
      appliedAt: "2026-09-19T10:00:05Z",
      method: "api",
    });
    expect(report.importId).toBe("wfximp_0000000000000000000000000A");
    expect(report.connectorId).toBe(CONNECTOR);
    expect(report.method).toBe("api");
    expect(report.capturedAt).toBe("2026-09-19T10:00:00Z");
    expect(report.appliedAt).toBe("2026-09-19T10:00:05Z");
    expect(report.added).toBe(1);
    expect(report.preservedLocalActions).toBe(true);
    expect(report.items).toBe(plan.decisions);
  });
});
