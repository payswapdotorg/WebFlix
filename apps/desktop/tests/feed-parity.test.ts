/**
 * R20-G — SHARED-SEMANTICS PARITY: the Desktop native path against the
 * REAL shared store (the strongest evidence available on this branch).
 *
 * The frozen `FeedPort` contract implemented over the REAL
 * `@wfx/persistence` `PostgresFeedImportStore` (PGlite — real Postgres,
 * the same migration 0012 SQL the server runs) and the REAL
 * `@wfx/domain` reconciliation engine, then driven through the Desktop
 * native import path (shell file dialog → read → preview → confirm) and
 * the Desktop feed surface.
 *
 * HONEST SCOPE (what is real vs what is the stand-in):
 * - REAL: the store's idempotent import (UNIQUE import key over real
 *   SQL), the mode truth, the provenance columns, the survival-law
 *   transitions, the reconciliation diff, and the separation law
 *   (library/history/intents untouched — asserted on the actual tables).
 * - STAND-IN: the export-artifact parser (the test's JSON format) and
 *   the fresh-capture script — in production both are the connector
 *   feed lane (Worker 1's R20-B); the frozen contract is this lane's
 *   seam, per the plan's "R20-F/G can start against frozen contract
 *   stubs" doctrine.
 *
 * This is the same store + the same domain engine the Web lane's server
 * API will bind — the parity law: Desktop and Web consume ONE shared
 * semantics; only the platform envelope differs.
 */

import { beforeAll, describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { FixedClock, SequentialIdGen } from "@wfx/experience";
import { reconcileFeedSnapshot, type FeedPort } from "@wfx/domain";
import {
  PostgresFeedImportStore,
  runMigrations,
  type DbClient,
  type SqlRow,
  type StageFeedItemInput,
} from "@wfx/persistence";

import { createDesktopFeedSurface } from "../src/surface/feed-surface";
import { createShellStoragePort } from "../src/platform/storage";
import { SimShell } from "./shell-simulator";
import { parseTestExport, testExportArtifact, type TestFeedExport } from "./feed-port-double";

const CLOCK_START = Date.UTC(2026, 8, 19, 15, 0, 0);
const USER = "wfxusr_r20parity";
const T0 = "2026-09-19T15:00:00.000Z";

// ---------------------------------------------------------------------------
// The real-store FeedPort adapter (the frozen seam over PostgresFeedImportStore)
// ---------------------------------------------------------------------------

/** The store + clock bundle one adapter instance owns. */
interface RealStoreFixture {
  readonly port: FeedPort;
  readonly store: PostgresFeedImportStore;
  /** Script the NEXT sync's fresh capture (the connector-lane stand-in). */
  scriptNextCapture(capture: TestFeedExport | null): void;
  /** Script the NEXT sync's honest failure fold. */
  scriptNextFailure(failure: "authorization" | "transport" | undefined): void;
  /** Direct row count (assertion surface). */
  countFeedRecords(): Promise<number>;
}

function createRealStoreFixture(
  db: DbClient,
  clock: FixedClock,
  ids: SequentialIdGen,
  profile: string,
): RealStoreFixture {
  const store = new PostgresFeedImportStore({ db, clock, ids });
  let nextCapture: TestFeedExport | null = null;
  let nextFailure: "authorization" | "transport" | undefined;

  /** The artifact parser (the connector-lane stand-in) → staged items. */
  function stagedItems(export_: TestFeedExport, capturedAt: string): StageFeedItemInput[] {
    return export_.items.map((item) => ({
      externalRef: item.externalRef,
      relationship: item.relationship,
      ...(export_.sourceRef !== undefined ? { sourceRef: export_.sourceRef } : {}),
      sourceOrder: item.sourceOrder,
      capturedAt,
      ...(item.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
      ...(item.title !== undefined ? { title: item.title } : {}),
      // The canonical item resolution (in production the composition's
      // graph resolution; here the deterministic test mapping).
      entertainmentItemId: `wfxitm_parity_${item.externalRef}`,
    }));
  }

  const port: FeedPort = {
    async previewImport(input) {
      if (input.artifact === undefined) {
        throw new Error("the real-store adapter requires an artifact");
      }
      const export_ = parseTestExport(input.artifact);
      const started = await store.startPreview({
        userId: USER,
        profileId: profile,
        connectorId: input.connectorId,
        method: input.method ?? "user-file",
        continuousSync: export_.continuousSync,
        ...(export_.sourceRef !== undefined ? { sourceRef: export_.sourceRef } : {}),
        capturedAt: new Date(clock.now()).toISOString(),
        items: stagedItems(export_, new Date(clock.now()).toISOString()),
      });
      const preview = await store.readPreview(started.id);
      if (preview === null) throw new Error("the real store lost the preview it just staged");
      return preview;
    },

    confirmImport(importId: string) {
      return store.confirmImport(importId);
    },

    readFeed(input) {
      if (input.profileId !== profile) return Promise.resolve([]);
      return store.readFeed(input.profileId, input.mode).then((rows) => [...rows]);
    },

    async syncImport(importId: string) {
      const existing = await store.getImport(importId);
      if (existing === null) {
        throw new Error(`syncImport: unknown import '${importId}'`);
      }
      // The honest failure folds (the R20-C state machine the driver consumes).
      if (nextFailure === "authorization") {
        const updated = await store.markSyncOutcome(importId, {
          syncState: "reauthorization-required",
          error: "the source rejected the authorization (scripted)",
          at: new Date(clock.now()).toISOString(),
        });
        return {
          id: updated.id,
          connectorId: updated.connectorId,
          method: updated.method,
          status: "reauthorization-required",
          startedAt: updated.startedAt,
          ...(updated.error !== undefined ? { error: updated.error } : {}),
        };
      }
      if (nextFailure === "transport") {
        throw new Error("the transport to the source failed (scripted)");
      }

      // The REAL R20-C composition: read the scope, diff with the REAL
      // engine, apply with the REAL store.
      const capture = nextCapture ?? {
        continuousSync: existing.continuousSync,
        sourceRef: existing.sourceRef,
        items: (await store.readRecordsInScope({
          profileId: existing.profileId,
          connectorId: existing.connectorId,
          ...(existing.sourceRef !== undefined ? { sourceRef: existing.sourceRef } : {}),
        })).map((record) => ({
          externalRef: record.externalRef,
          relationship: record.provenance.relationship,
          sourceOrder: record.provenance.sourceOrder,
          ...(record.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: record.sourceUpdatedAt }
            : {}),
          ...(record.title !== undefined ? { title: record.title } : {}),
        })),
      };
      nextCapture = null;
      const capturedAt = new Date(clock.now()).toISOString();
      const snapshot = {
        connectorId: existing.connectorId,
        method: existing.method,
        capturedAt,
        continuousSync: existing.continuousSync,
        orderSemantics: "source-native" as const,
        ...(existing.sourceRef !== undefined ? { sourceRef: existing.sourceRef } : {}),
        syncState: "snapshot" as const,
        items: capture.items.map((item) => ({
          externalRef: item.externalRef,
          relationship: item.relationship,
          sourceOrder: item.sourceOrder,
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(item.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: item.sourceUpdatedAt }
            : {}),
        })),
      };
      const scope = {
        profileId: existing.profileId,
        connectorId: existing.connectorId,
        ...(existing.sourceRef !== undefined ? { sourceRef: existing.sourceRef } : {}),
      };
      const existingRecords = await store.readRecordsInScope(scope);
      const plan = reconcileFeedSnapshot(existingRecords, snapshot, scope);
      const outcome = await store.applyReconciliation(importId, {
        upserts: plan.upserts.map((upsert) => ({
          key: upsert.key,
          externalRef: upsert.item.externalRef,
          relationship: upsert.item.relationship,
          ...(upsert.item.title !== undefined ? { title: upsert.item.title } : {}),
          ...(upsert.item.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: upsert.item.sourceUpdatedAt }
            : {}),
          ...(existing.sourceRef !== undefined ? { sourceRef: existing.sourceRef } : {}),
          sourceOrder: upsert.item.sourceOrder,
          capturedAt,
          entertainmentItemId: `wfxitm_parity_${upsert.item.externalRef}`,
        })),
        removeKeys: plan.decisions
          .filter((decision) => decision.action === "remove")
          .map((decision) => decision.key),
        counts: plan.counts,
        syncState: existing.continuousSync ? "live" : "snapshot",
        capturedAt,
      });
      return {
        id: outcome.import.id,
        connectorId: outcome.import.connectorId,
        method: outcome.import.method,
        status: outcome.import.status,
        startedAt: outcome.import.startedAt,
        ...(outcome.import.completedAt !== undefined
          ? { completedAt: outcome.import.completedAt }
          : {}),
      };
    },
  };

  return {
    port,
    store,
    scriptNextCapture: (capture) => {
      nextCapture = capture;
    },
    scriptNextFailure: (failure) => {
      nextFailure = failure;
    },
    countFeedRecords: async () => {
      const rows = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM feed_records WHERE profile_id = $1`,
        [profile],
      );
      return Number((rows[0] as { count: number } | undefined)?.count ?? 0);
    },
  };
}

// ---------------------------------------------------------------------------
// The shared boot (PGlite is ~1-3s: ONE database for the file, isolated
// by per-test profile ids — the same determinism discipline as the
// persistence tests, scoped to parity's needs)
// ---------------------------------------------------------------------------

let db: DbClient;
let closeDb: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const pglite = new PGlite();
  const query = async <Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]> => {
    const result = await pglite.query(sqlText, params as unknown[]);
    return result.rows as unknown as Row[];
  };
  db = {
    query,
    begin: async <T>(work: (tx: { query: typeof query }) => Promise<T>): Promise<T> => {
      return pglite.transaction(async (tx) => {
        return work({
          query: async <Row extends object = SqlRow>(
            txText: string,
            txParams?: readonly unknown[],
          ): Promise<Row[]> => {
            const result = await tx.query(txText, txParams as unknown[]);
            return result.rows as unknown as Row[];
          },
        });
      });
    },
    close: async () => {
      await pglite.close();
    },
  };
  closeDb = db.close;
  const result = await runMigrations(db);
  if (result.applied.length === 0) {
    throw new Error(`parity harness: expected fresh migrations, applied none`);
  }
});

/** The desktop native surface over the REAL store (fresh per test; the seed keeps the id spaces disjoint in the shared database). */
let fixtureSeed = 0;
function realSurface(profile: string) {
  fixtureSeed += 1;
  const shell = new SimShell();
  const clock = new FixedClock(CLOCK_START);
  const ids = new SequentialIdGen(fixtureSeed * 10_000);
  const fixture = createRealStoreFixture(db, clock, ids, profile);
  const surface = createDesktopFeedSurface({
    shell,
    feedPort: fixture.port,
    storage: shellStoragePort(shell),
    now: () => new Date(clock.now()).toISOString(),
  });
  return { shell, clock, fixture, surface };
}

/** The shell's storage port for the cache (the real StoragePort over the SimShell KV). */
function shellStoragePort(shell: SimShell) {
  // The production composition uses capabilities.ports.storage — the
  // same createShellStoragePort binding; constructed directly here to
  // keep the parity fixture lean (the app-boot tests cover composition).
  return createShellStoragePort(shell);
}

const PLAYLIST_EXPORT = testExportArtifact({
  continuousSync: true,
  sourceRef: "PL_parity",
  items: [
    { externalRef: "vidA", relationship: "playlist" as const, sourceOrder: 0, title: "Alpha" },
    { externalRef: "vidB", relationship: "playlist" as const, sourceOrder: 1, title: "Beta" },
  ],
});

/** Pick the given artifact through the native dialog. */
function pick(shell: SimShell, artifact: Uint8Array, path = "/home/user/exports/feed.json"): void {
  shell.scriptFile(path, artifact);
  shell.nextFilePickOutcome = { picked: true, path };
}

// ---------------------------------------------------------------------------
// The parity laws
// ---------------------------------------------------------------------------

describe("R20-G — shared-semantics parity (the Desktop native path over the REAL store)", () => {
  it("the native import path lands real rows with full provenance (preview → confirm → feed view)", async () => {
    const { shell, fixture, surface } = realSurface("wfxusr_r20parity:a");
    pick(shell, PLAYLIST_EXPORT);

    const verdict = await surface.importFromFile({ connectorId: "youtube", method: "official-export" });
    expect(verdict.outcome).toBe("preview");
    if (verdict.outcome !== "preview") throw new Error("unreachable");
    expect(verdict.preview.itemCount).toBe(2);
    expect(verdict.preview.relationshipCounts).toEqual({ playlist: 2 });
    expect(verdict.preview.freshness).toBe("snapshot");

    const confirmed = await surface.confirmImport(verdict.preview.importId);
    expect(confirmed.status).toBe("complete");

    expect(await fixture.countFeedRecords()).toBe(2);
    const view = await surface.feedView({ profileId: "wfxusr_r20parity:a", mode: "byof" });
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.view.orderSemantics).toBe("source-native");
      expect(view.view.records).toHaveLength(2);
      const first = view.view.records[0];
      expect(first?.provenance.connectorId).toBe("youtube");
      expect(first?.provenance.importMethod).toBe("official-export");
      expect(first?.provenance.capturedAt).toBe(T0);
      expect(first?.provenance.relationship).toBe("playlist");
      expect(first?.provenance.sourceOrder).toBe(0);
      expect(first?.provenance.syncState).toBe("live"); // a continuous route confirmed
      expect(first?.entertainmentItemId).toBe("wfxitm_parity_vidA");
    }
  });

  it("IDEMPOTENT IMPORT on the native path — the REAL UNIQUE law (same file twice, no duplicates)", async () => {
    const { shell, fixture, surface } = realSurface("wfxusr_r20parity:b");
    pick(shell, PLAYLIST_EXPORT);

    const first = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(first.outcome).toBe("preview");
    await surface.confirmImport(first.outcome === "preview" ? first.preview.importId : "");
    expect(await fixture.countFeedRecords()).toBe(2);
    const firstRows = await surface.feedView({ profileId: "wfxusr_r20parity:b", mode: "byof" });
    const firstIds = firstRows.ok ? firstRows.view.records.map((record) => record.id) : [];

    // The SAME file again — a fresh pick, a fresh preview, a fresh confirm.
    pick(shell, PLAYLIST_EXPORT);
    const second = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(second.outcome).toBe("preview");
    await surface.confirmImport(second.outcome === "preview" ? second.preview.importId : "");

    // THE LAW: the real SQL's UNIQUE (profile_id, import_key) upsert — the
    // row count is UNCHANGED and the record identities are stable.
    expect(await fixture.countFeedRecords()).toBe(2);
    const secondRows = await surface.feedView({ profileId: "wfxusr_r20parity:b", mode: "byof" });
    const secondIds = secondRows.ok ? secondRows.view.records.map((record) => record.id) : [];
    expect([...secondIds].sort()).toEqual([...firstIds].sort());
  });

  it("MODE TRUTH through the real store: webflix EMPTY, following the follow subset, byof the source-native order", async () => {
    const { shell, surface } = realSurface("wfxusr_r20parity:c");
    pick(shell, PLAYLIST_EXPORT);
    const playlist = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    await surface.confirmImport(playlist.outcome === "preview" ? playlist.preview.importId : "");

    pick(shell, testExportArtifact({
      continuousSync: false,
      items: [{ externalRef: "chan1", relationship: "follow" as const, sourceOrder: 0 }],
    }), "/home/user/exports/follows.json");
    const follows = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    await surface.confirmImport(follows.outcome === "preview" ? follows.preview.importId : "");

    const webflix = await surface.feedView({ profileId: "wfxusr_r20parity:c", mode: "webflix" });
    expect(webflix.ok).toBe(true);
    if (webflix.ok) {
      expect(webflix.view.records).toEqual([]); // never re-labeled (the real store's law)
      expect(webflix.view.orderSemantics).toBe("webflix-ranked");
    }

    const following = await surface.feedView({ profileId: "wfxusr_r20parity:c", mode: "following" });
    expect(following.ok).toBe(true);
    if (following.ok) {
      expect(following.view.records).toHaveLength(1);
      expect(following.view.records[0]?.provenance.relationship).toBe("follow");
    }

    const byof = await surface.feedView({ profileId: "wfxusr_r20parity:c", mode: "byof" });
    expect(byof.ok).toBe(true);
    if (byof.ok) {
      // NULLS FIRST: the follow graph before the playlist (source-native).
      expect(byof.view.records.map((record) => record.provenance.relationship)).toEqual([
        "follow",
        "playlist",
        "playlist",
      ]);
    }
  });

  it("the REAL reconciliation engine drives the sync: a changed capture adds/removes; an unchanged one is a no-op", async () => {
    const { shell, fixture, surface } = realSurface("wfxusr_r20parity:d");
    pick(shell, PLAYLIST_EXPORT);
    const imported = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    const importId = imported.outcome === "preview" ? imported.preview.importId : "";
    await surface.confirmImport(importId);
    expect(await fixture.countFeedRecords()).toBe(2);

    // An unchanged capture: the diff is empty (idempotent sync).
    const unchanged = await surface.runSync({ importId });
    expect(unchanged.outcome).toBe("synced");
    expect(await fixture.countFeedRecords()).toBe(2);

    // A changed capture: vidB is gone at the source, vidC is new.
    fixture.scriptNextCapture({
      continuousSync: true,
      sourceRef: "PL_parity",
      items: [
        { externalRef: "vidA", relationship: "playlist", sourceOrder: 0, title: "Alpha" },
        { externalRef: "vidC", relationship: "playlist", sourceOrder: 1, title: "Gamma" },
      ],
    });
    const changed = await surface.runSync({ importId });
    expect(changed.outcome).toBe("synced");
    expect(await fixture.countFeedRecords()).toBe(2); // vidB removed, vidC added

    const records = await fixture.store.readFeed("wfxusr_r20parity:d", "byof");
    expect(records.map((record) => record.externalRef).sort()).toEqual(["vidA", "vidC"]);
  });

  it("THE SURVIVAL LAW through the real store: failing syncs retain rows; disconnect retains rows", async () => {
    const { shell, fixture, surface } = realSurface("wfxusr_r20parity:e");
    pick(shell, PLAYLIST_EXPORT);
    const imported = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    const importId = imported.outcome === "preview" ? imported.preview.importId : "";
    await surface.confirmImport(importId);
    expect(await fixture.countFeedRecords()).toBe(2);

    // DISCONNECT on a live task: cancel the scheduled sync; records retained.
    const scheduled = await surface.scheduleSync({ importId });
    expect(scheduled.accepted).toBe(true);
    const cancelled = await surface.cancelSync(importId);
    expect(cancelled).toBe(true);
    expect(await fixture.countFeedRecords()).toBe(2); // the disconnect kept the feed

    // Transport failure: records retained, task failed honestly.
    fixture.scriptNextFailure("transport");
    const transport = await surface.runSync({ importId });
    expect(transport.outcome).toBe("failed");
    expect(await fixture.countFeedRecords()).toBe(2);

    // Authorization expiry: records retained, the typed recovery verdict.
    fixture.scriptNextFailure("authorization");
    const reauth = await surface.runSync({ importId });
    expect(reauth.outcome).toBe("reauthorization-required");
    expect(await fixture.countFeedRecords()).toBe(2);

    // A finished task is honestly not cancellable (the registry's law) —
    // and the records are STILL there (deletion is only the explicit user path).
    expect(await surface.cancelSync(importId)).toBe(false);
    expect(await fixture.countFeedRecords()).toBe(2);
  });

  it("THE SEPARATION LAW: the import + sync never touch library/history/intents (the actual tables)", async () => {
    const { shell, fixture, surface } = realSurface("wfxusr_r20parity:f");
    pick(shell, PLAYLIST_EXPORT);
    const imported = await surface.importFromFile({ connectorId: "youtube", method: "user-file" });
    const importId = imported.outcome === "preview" ? imported.preview.importId : "";
    await surface.confirmImport(importId);

    fixture.scriptNextCapture({
      continuousSync: true,
      sourceRef: "PL_parity",
      items: [{ externalRef: "vidA", relationship: "playlist", sourceOrder: 0, title: "Alpha" }],
    });
    await surface.runSync({ importId });

    // A CONCENTRATED import + sync left WebFlix-local state untouched.
    for (const table of ["library_entries", "watch_history", "user_intents", "recommendation_state"]) {
      const rows = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
      expect(Number((rows[0] as { count: number } | undefined)?.count ?? 0)).toBe(0);
    }
  });
});

void closeDb;
