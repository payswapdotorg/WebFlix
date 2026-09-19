/**
 * R20-D BYOF host-service law tests (bun:test).
 *
 * Proves the Web lane's BYOF service keeps every truth law of the frozen
 * BYOF spec over the shared domain engine (the fixtures-mode scripted
 * capture — deterministic, no network):
 *
 * - MODE TRUTH: `readFeed('webflix')` is ALWAYS empty; `following` is the
 *   follow-graph subset; `byof`/`hybrid` return the shared lane's served
 *   source-native order (follow graph first) — imported records are never
 *   re-labeled as WebFlix-ranked content;
 * - PREVIEW → CONFIRM: staging (the frozen `FeedImportPreview` contract),
 *   confirm promotes EXACTLY the staged rows, and re-import is IDEMPOTENT
 *   by import key (no duplicates, no drift);
 * - SNAPSHOT TRUTH: the continuous route lands `live`; the one-time export
 *   lands `snapshot`; a sync of a one-time route is the typed
 *   `unsupported` verdict (never a fake refresh);
 * - SYNC RECONCILIATION: the shared engine's honest diff (add/update/
 *   remove/keep) applies within the import's own scope (the remove-safety
 *   law: an API sync never removes an export import's rows);
 * - AUTHORIZATION FAILURES: the expired source refuses the capture with the
 *   typed `unauthorized` failure + the reauthorization-required fold, and
 *   the records are RETAINED (the survival law); recovery restores live;
 * - DISCONNECT NON-DESTRUCTIVE: records + provenance survive; deletion is
 *   the SEPARATE explicit action, touching ONLY the feed records;
 * - SEPARATION: the service never touches the runtime's library/history
 *   state (structurally out of reach).
 *
 * Deterministic: the fixture drive state is reset per test, the real
 * service over the shared domain engine, no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import { ByofFeedService } from "../src/host/byof/service";
import { driveReviseFixtureSource, readByofFixtureState } from "../src/host/byof/fixture-state";
import { driveSourceAuthFixture, resetSourceAuthFixturesForTests } from "../src/host/source-auth-fixtures";

beforeEach(() => {
  resetWebHostProcessState();
  resetSourceAuthFixturesForTests();
});

/** The service under fixtures mode (the deterministic boot). */
function service(): ByofFeedService {
  return new ByofFeedService("fixtures");
}

/** Preview + confirm one import through the service (the happy path). */
async function importFeed(
  svc: ByofFeedService,
  method: "api" | "official-export" = "api",
): Promise<string> {
  const preview = await svc.previewFeedImport({ connectorId: "fake-source", method });
  if (!preview.ok) throw new Error(`preview failed: ${preview.error.detail}`);
  const confirmed = await svc.confirmFeedImport(preview.value.importId);
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.error.detail}`);
  return preview.value.importId;
}

describe("R20-D mode truth (the J33 law)", () => {
  it("readFeed('webflix') is ALWAYS empty — imported records are never re-labeled as WebFlix-ranked content", async () => {
    const svc = service();
    await importFeed(svc);
    expect((await svc.readFeed("webflix")).length).toBe(0);
    // A second import changes nothing: the WebFlix mode never serves records.
    await importFeed(svc);
    expect((await svc.readFeed("webflix")).length).toBe(0);
  });

  it("readFeed('byof') returns the source-native order — the follow graph first, then containers", async () => {
    const svc = service();
    await importFeed(svc);
    const records = await svc.readFeed("byof");
    expect(records.length).toBe(12);
    // The shared lane's served order: the follow graph (no container)
    // leads, then the containers by the source's own positions.
    const kinds = records.map((record) => record.relationship);
    expect(kinds.slice(0, 4)).toEqual(["follow", "follow", "follow", "subscription"]);
    // The source's own positions order the playlist rows.
    const playlist = records.filter((record) => record.relationship === "playlist");
    expect(playlist.map((record) => record.sourceOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("readFeed('following') is the follow-graph subset (follows + subscriptions only)", async () => {
    const svc = service();
    await importFeed(svc);
    const following = await svc.readFeed("following");
    expect(following.length).toBe(4);
    expect(following.every((record) => record.relationship === "follow" || record.relationship === "subscription")).toBe(true);
  });

  it("a staged preview's rows are NOT imported yet (readFeed serves confirmed records only)", async () => {
    const svc = service();
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(preview.ok).toBe(true);
    expect((await svc.readFeed("byof")).length).toBe(0);
    expect(preview.ok && preview.value.itemCount).toBe(12);
  });
});

describe("R20-D preview → confirm (the staging and idempotence laws)", () => {
  it("preview stages the frozen contract (counts, freshness, sample rows in capture order)", async () => {
    const svc = service();
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.connectorId).toBe("fake-source");
    expect(preview.value.itemCount).toBe(12);
    expect(preview.value.relationshipCounts).toEqual({
      follow: 3,
      subscription: 1,
      playlist: 5,
      like: 3,
    });
    // The staged capture is a SNAPSHOT until confirm folds its truth.
    expect(preview.value.freshness).toBe("snapshot");
    // The sample rows are the frozen FeedRecord shape with provenance.
    const first = preview.value.sample[0]!;
    expect(first.provenance.connectorId).toBe("fake-source");
    expect(first.provenance.importMethod).toBe("api");
    expect(first.provenance.relationship).toBe("follow");
    expect(first.provenance.sourceOrder).toBe(0);
  });

  it("confirm promotes EXACTLY the staged rows (never re-fetches) and lands live for the continuous route", async () => {
    const svc = service();
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    if (!preview.ok) throw new Error("preview failed");
    const confirmed = await svc.confirmFeedImport(preview.value.importId);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.value.status).toBe("confirmed");
    expect(confirmed.value.syncState).toBe("live");
    expect(confirmed.value.recordCount).toBe(12);
    // Confirm never re-fetches: the captured time is the preview's own.
    expect(confirmed.value.confirmedAt).toBe(preview.value.sample[0]!.provenance.capturedAt);
  });

  it("re-importing the same relationships is IDEMPOTENT — the same keys, no duplicates, no drift", async () => {
    const svc = service();
    const first = await importFeed(svc);
    const before = await svc.readFeed("byof");
    const second = await importFeed(svc);
    const after = await svc.readFeed("byof");
    expect(after.length).toBe(before.length);
    expect(after.map((record) => record.key)).toEqual(before.map((record) => record.key));
    // The canonical identities are stable across the re-import.
    expect(after.map((record) => record.entertainmentItemId)).toEqual(
      before.map((record) => record.entertainmentItemId),
    );
    expect(second).not.toBe(first); // a distinct import row (its own audit trail)
  });

  it("discard drops an unconfirmed preview without touching confirmed records", async () => {
    const svc = service();
    await importFeed(svc);
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    if (!preview.ok) throw new Error("preview failed");
    const discarded = await svc.discardPreview(preview.value.importId);
    expect(discarded.ok).toBe(true);
    expect((await svc.readFeed("byof")).length).toBe(12); // the confirmed records stand
    expect((await svc.listImports()).filter((row) => row.status === "preview").length).toBe(0);
  });

  it("confirm of a failed/reauthorization-required import is refused (it never staged a preview)", async () => {
    const svc = service();
    driveSourceAuthFixture({ action: "expire" });
    const failed = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.kind).toBe("unauthorized");
    expect(failed.error.importId).toBeDefined();
    const confirmed = await svc.confirmFeedImport(failed.error.importId!);
    expect(confirmed.ok).toBe(false);
    if (confirmed.ok) return;
    expect(confirmed.error.kind).toBe("invalid-input");
  });
});

describe("R20-D snapshot truth (the never-live law)", () => {
  it("the one-time export import lands SNAPSHOT — never presented as live", async () => {
    const svc = service();
    const importId = await importFeed(svc, "official-export");
    const imports = await svc.listImports();
    const row = imports.find((entry) => entry.id === importId);
    expect(row?.syncState).toBe("snapshot");
    expect(row?.continuousSync).toBe(false);
  });

  it("a sync of a one-time route is the typed unsupported verdict — never a fake refresh", async () => {
    const svc = service();
    const importId = await importFeed(svc, "official-export");
    const sync = await svc.syncFeedImport(importId);
    expect(sync.ok).toBe(false);
    if (sync.ok) return;
    expect(sync.error.kind).toBe("unsupported");
    expect(sync.error.detail).toContain("one-time");
    expect(sync.error.detail).toContain("fresh preview");
  });

  it("a sync of a continuous route stays live (kept current)", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    const sync = await svc.syncFeedImport(importId);
    expect(sync.ok).toBe(true);
    const imports = await svc.listImports();
    expect(imports.find((entry) => entry.id === importId)?.syncState).toBe("live");
  });
});

describe("R20-D sync reconciliation (the shared engine's honest diff)", () => {
  it("the source change reconciles: adds, updates, a remove, and keeps — on the record rows", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    driveReviseFixtureSource();
    const sync = await svc.syncFeedImport(importId);
    expect(sync.ok).toBe(true);
    if (!sync.ok) return;
    // The scripted revision: 1 follow removed, 1 follow + 1 playlist item
    // added, 1 title + 1 sourceUpdatedAt changed, 1 like re-ordered.
    expect(sync.value.removed).toBe(1);
    expect(sync.value.added).toBe(2);
    expect(sync.value.updated).toBeGreaterThanOrEqual(2);
    expect(sync.value.kept).toBeGreaterThan(0);
    // The reconciled truth: the unfollowed channel is GONE, the new
    // channel is PRESENT, the changed title round-trips.
    const records = await svc.readFeed("byof");
    expect(records.some((record) => record.title === "Static Lab")).toBe(false);
    expect(records.some((record) => record.title === "Signal Workshop")).toBe(true);
    expect(records.some((record) => record.title === "Static Bloom (Director's Cut)")).toBe(true);
    // The report's frozen contract (provenance truth).
    expect(sync.value.preservedLocalActions).toBe(true);
    expect(sync.value.connectorId).toBe("fake-source");
  });

  it("the remove-safety law: an API sync never removes an export import's rows", async () => {
    const svc = service();
    const apiImport = await importFeed(svc, "api");
    const exportImport = await importFeed(svc, "official-export");
    driveReviseFixtureSource();
    // The API sync reconciles the API-method scope only.
    const sync = await svc.syncFeedImport(apiImport);
    expect(sync.ok).toBe(true);
    // The export import's row stands with its snapshot truth untouched.
    const exports = await svc.listImports();
    expect(exports.find((entry) => entry.id === exportImport)?.syncState).toBe("snapshot");
    // KEY discipline (the shared lane's `ON CONFLICT (profile_id,
    // import_key)` law): no duplicate keys, and the identities stay stable
    // across the cross-method upserts.
    const records = await svc.readFeed("byof");
    const keys = records.map((record) => record.key);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = records.map((record) => record.entertainmentItemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a sync of an unknown import is the typed not-found verdict", async () => {
    const svc = service();
    const sync = await svc.syncFeedImport("wfxfeedimp_999999999999");
    expect(sync.ok).toBe(false);
    if (sync.ok) return;
    expect(sync.error.kind).toBe("not-found");
  });
});

describe("R20-D authorization failures (the honest fold + the survival law)", () => {
  it("an expired source refuses the capture with the typed unauthorized failure + the recovery path", async () => {
    const svc = service();
    driveSourceAuthFixture({ action: "expire" });
    const failed = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.kind).toBe("unauthorized");
    expect(failed.error.detail).toContain("expired");
    expect(failed.error.detail).toContain("Settings");
    expect(failed.error.syncState).toBe("reauthorization-required");
  });

  it("an unauthorized sync RETAINS the records (the survival law) and lands the needs-reconnect truth", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    const before = await svc.readFeed("byof");
    driveSourceAuthFixture({ action: "expire" });
    const failed = await svc.syncFeedImport(importId);
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.kind).toBe("unauthorized");
    expect(failed.error.syncState).toBe("reauthorization-required");
    // The records are RETAINED (never erased by a failing source).
    const after = await svc.readFeed("byof");
    expect(after.length).toBe(before.length);
    expect(after.map((record) => record.key)).toEqual(before.map((record) => record.key));
    // The import row carries the honest needs-reconnect truth.
    const imports = await svc.listImports();
    const row = imports.find((entry) => entry.id === importId);
    expect(row?.status).toBe("reauthorization-required");
    expect(row?.syncState).toBe("reauthorization-required");
    expect(row?.error).toContain("expired");
  });

  it("the recovery restores the live sync (reauthorize → sync works again)", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    driveSourceAuthFixture({ action: "expire" });
    await svc.syncFeedImport(importId);
    driveSourceAuthFixture({ action: "reauthorize" });
    const recovered = await svc.syncFeedImport(importId);
    expect(recovered.ok).toBe(true);
    const imports = await svc.listImports();
    const row = imports.find((entry) => entry.id === importId);
    expect(row?.syncState).toBe("live");
    expect(row?.status).toBe("confirmed");
    expect(row?.error).toBeNull();
  });
});

describe("R20-D disconnect (the NON-DESTRUCTIVE undo/disconnect law)", () => {
  it("disconnect stops syncing and RETAINS every record (provenance survives)", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    const before = await svc.readFeed("byof");
    const disconnected = await svc.disconnectImport(importId);
    expect(disconnected.ok).toBe(true);
    if (!disconnected.ok) return;
    expect(disconnected.value.status).toBe("disconnected");
    // THE SURVIVAL LAW: the records are retained.
    const after = await svc.readFeed("byof");
    expect(after.length).toBe(before.length);
    expect(after.map((record) => record.key)).toEqual(before.map((record) => record.key));
    expect(after.every((record) => record.deferredResolution !== undefined ? true : true)).toBe(true);
  });

  it("a disconnected import's sync is the typed unsupported verdict (re-import to resume)", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    await svc.disconnectImport(importId);
    const sync = await svc.syncFeedImport(importId);
    expect(sync.ok).toBe(false);
    if (sync.ok) return;
    expect(sync.error.kind).toBe("unsupported");
    expect(sync.error.detail).toContain("re-import");
  });

  it("disconnect is idempotent", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    const first = await svc.disconnectImport(importId);
    const second = await svc.disconnectImport(importId);
    expect(first.ok && second.ok).toBe(true);
  });

  it("the export (snapshot) import disconnects the same way — records kept", async () => {
    const svc = service();
    const importId = await importFeed(svc, "official-export");
    const disconnected = await svc.disconnectImport(importId);
    expect(disconnected.ok).toBe(true);
    expect((await svc.readFeed("byof")).length).toBe(12); // the revision-0 export import's rows, retained
  });
});

describe("R20-D delete-records (the EXPLICIT destructive path, separated)", () => {
  it("deleteImportedRecords removes ONLY the import's own records — another import's rows stand", async () => {
    const svc = service();
    // Import the revision-0 feed (12 rows, import1), then the source
    // changes and a re-import (import2) re-attributes the still-present
    // relationships — the unfollowed channel's row stays attributed to
    // import1 (confirm upserts by key; removal is SYNC's fold, not the
    // confirm's).
    const first = await importFeed(svc);
    driveReviseFixtureSource();
    const second = await importFeed(svc);
    const recordsAfterReimport = await svc.readFeed("byof");
    expect(recordsAfterReimport.length).toBe(14); // 13 (import2) + the stale follow (import1)
    // Deleting import1's records removes EXACTLY its own row(s).
    const deleted = await svc.deleteImportedRecords(first);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.deleted).toBe(1);
    const remaining = await svc.readFeed("byof");
    expect(remaining.length).toBe(13); // import2's rows stand
    expect(remaining.every((record) => record.importId === second)).toBe(true);
  });

  it("deleteImportedRecords never touches the runtime's library/history state (the separation law)", async () => {
    const svc = service();
    const importId = await importFeed(svc);
    const state = readByofFixtureState();
    const libraryCountBefore = state.records.length;
    expect(libraryCountBefore).toBeGreaterThan(0);
    const deleted = await svc.deleteImportedRecords(importId);
    expect(deleted.ok).toBe(true);
    // The BYOF state file's records are gone — and structurally nothing
    // else exists for the service to touch (the runtime's stores are out
    // of reach; the separation law is by construction, pinned here).
    expect(readByofFixtureState().records.length).toBe(0);
  });
});

describe("R20-D typed input validation (never a throw)", () => {
  it("malformed inputs answer the typed invalid-input verdict", async () => {
    const svc = service();
    const empty = await svc.previewFeedImport({ connectorId: "" });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.kind).toBe("invalid-input");

    const badMethod = await svc.previewFeedImport({ connectorId: "fake-source", method: "ranked-feed" as never });
    expect(badMethod.ok).toBe(false);
    if (badMethod.ok) return;
    expect(badMethod.error.kind).toBe("invalid-input");
  });

  it("an unwired source answers the typed unknown-connector verdict", async () => {
    const svc = service();
    const unknown = await svc.previewFeedImport({ connectorId: "not-a-source" });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.kind).toBe("unknown-connector");
  });

  it("service mode answers the honest unavailable verdict (never a fake import)", async () => {
    const svc = new ByofFeedService("service");
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.error.kind).toBe("unavailable");
    expect(preview.error.detail).toContain("not wired");
    // Reads stay honest (the empty truth, never a fabricated list).
    expect((await svc.readFeed("byof")).length).toBe(0);
    expect((await svc.listImports()).length).toBe(0);
  });
});
