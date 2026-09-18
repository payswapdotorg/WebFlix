/**
 * R13 — the Library exposure tests (verified-before-ready + the seam).
 *
 * THE LAW: `Ready offline` is EARNED, never assumed — only
 * integrity-verified complete assets (R11 verdicts + R10 hashing, proved
 * again by the store's own import re-hash + the digest cross-checks) may
 * present the offline-ready state. Partial assets present honest
 * in-progress states; failures are typed errors with retry paths — never
 * silent partials.
 *
 * These tests run against the REAL R10 asset store (`createAssetStore`
 * from `@wfx/native-media` — the actual production store code, not a
 * mock), real bytes on disk, and the real journal — the same discipline
 * as the R11 adapter tests.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createAssetStore, type AssetStore } from "@wfx/native-media";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import {
  createTorrentEngineAdapter,
  type TorrentEngineAdapter,
} from "../src/adapter/native-media-adapter";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";
import { statusOf, waitFor } from "./helpers/status";
import {
  AUTHORIZED_ARCHIVE_V1,
  PLAYBACK_FEATURE,
  fixtureTorrentBytes,
} from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-exposure");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

let counter = 0;
function freshRoots(): { engineRoot: string; storeRoot: string } {
  counter += 1;
  return {
    engineRoot: join(TMP, `engine-${counter}`),
    storeRoot: join(TMP, `store-${counter}`),
  };
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Drive one fixture torrent to a COMPLETED engine session. */
async function completedSession(
  spec: typeof AUTHORIZED_ARCHIVE_V1,
  fileIndexes: readonly number[],
): Promise<{
  engine: TorrentEngine;
  adapter: TorrentEngineAdapter;
  library: LoopbackTorrentLibrary;
  store: AssetStore;
  sessionId: string;
}> {
  const { engineRoot, storeRoot } = freshRoots();
  const library = new LoopbackTorrentLibrary();
  library.registerFixture(spec);
  const engine = createTorrentEngine({ library, dataRoot: engineRoot, sources });
  const store = createAssetStore({ root: storeRoot });
  const adapter = createTorrentEngineAdapter({ engine, store });
  const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(spec), PROVENANCE);
  if (!ingested.ok) throw new Error("ingestion must succeed");
  const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes } });
  if (!created.ok) throw new Error("session must create");
  for (let i = 0; i < 30; i += 1) library.advanceAll();
  await waitFor(() => statusOf(engine, created.value.sessionId).state === "completed");
  return { engine, adapter, library, store, sessionId: created.value.sessionId };
}

describe("R13 — verified-before-ready (no offline-ready without the integrity pass)", () => {
  it("a DOWNLOADING session is refused typed INVALID_STATE — partial assets are never offline-ready", async () => {
    const { engineRoot, storeRoot } = freshRoots();
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = createTorrentEngine({ library, dataRoot: engineRoot, sources });
    const store = createAssetStore({ root: storeRoot });
    const adapter = createTorrentEngineAdapter({ engine, store });
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library.advanceAll(); // downloading — 2 of 6 pieces

    const outcome = await adapter.exposeCompletedSelection({ sessionId: created.value.sessionId });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("INVALID_STATE");
    expect(outcome.error.detail).toContain("EARNED");
    // NOTHING landed: no exposure journaled, no store assets, no listing.
    expect(engine.exposedAssets()).toEqual([]);
    expect(store.listAssets().length).toBe(0);
    const listing = adapter.listOfflineReady();
    expect(listing.ok && listing.value.length).toBe(0);
    await engine.destroy();
  });

  it("a PAUSED session is refused the same way (honest in-progress state)", async () => {
    const { engineRoot, storeRoot } = freshRoots();
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = createTorrentEngine({ library, dataRoot: engineRoot, sources });
    const store = createAssetStore({ root: storeRoot });
    const adapter = createTorrentEngineAdapter({ engine, store });
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library.advanceAll();
    engine.pause(created.value.sessionId);

    const outcome = await adapter.exposeCompletedSelection({ sessionId: created.value.sessionId });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("INVALID_STATE");
    await engine.destroy();
  });

  it("a COMPLETED session exposes with EARNED integrity + durable journal records", async () => {
    const { engine, adapter, store, sessionId } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const status = statusOf(engine, sessionId);
    const digest = status.digests?.[0];
    expect(digest).toBeDefined();
    if (digest === undefined) return;

    const exposed = await adapter.exposeCompletedSelection({
      sessionId,
      contentType: "video/x-matroska",
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    expect(exposed.value.length).toBe(1);
    const asset = exposed.value[0]!;
    expect(asset.integrity).toBe("verified"); // EARNED
    expect(asset.sourcePath).toBe(digest.path);
    expect(asset.sha256).toBe(digest.sha256); // engine == journal == store
    expect(asset.sizeBytes).toBe(digest.sizeBytes);
    expect(asset.provenance).toEqual({ sourceId: "vault:family-media", basis: "user-owned" });
    expect(asset.library).toEqual({ profileKey: "user:42", canonicalItemId: "item-7" });
    // The exposure is DURABLE (the journal's fold) and the store holds the bytes.
    expect(engine.exposedAssets().length).toBe(1);
    expect(store.getAsset(asset.assetId)?.integrity).toBe("verified");
    await engine.destroy();
  });
});

describe("R13 — the Library read (canonical identity, live verdicts, durability)", () => {
  it("listOfflineReady composes the journal's exposures with the store's LIVE verdicts", async () => {
    const { engine, adapter, sessionId } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0, 2]);
    const exposed = await adapter.exposeCompletedSelection({
      sessionId,
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;

    const listing = adapter.listOfflineReady();
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.length).toBe(1); // ONE entry per canonical identity
    const entry = listing.value[0]!;
    expect(entry.key).toBe("canonical:user:42::item-7");
    expect(entry.sessionId).toBe(sessionId);
    expect(entry.assets.length).toBe(2); // the whole verified selection
    for (const asset of entry.assets) {
      expect(asset.integrity).toBe("verified");
      expect(asset.sizeOnDisk).toBe(asset.sizeBytes); // disk truth agrees
    }
    await engine.destroy();
  });

  it("RE-EXPOSURE of the same canonical identity REPLACES (no duplicate identity — R04's law)", async () => {
    const { engine, adapter, sessionId } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const first = await adapter.exposeCompletedSelection({
      sessionId,
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(first.ok).toBe(true);
    const second = await adapter.exposeCompletedSelection({
      sessionId,
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(second.ok).toBe(true);
    const listing = adapter.listOfflineReady();
    expect(listing.ok && listing.value.length).toBe(1); // still ONE entry
    // A DIFFERENT profile's identity is a different Library row.
    const other = await completedSession(PLAYBACK_FEATURE, [0]);
    const third = await other.adapter.exposeCompletedSelection({
      sessionId: other.sessionId,
      library: { profileKey: "user:42", canonicalItemId: "item-7" }, // SAME canonical item
    });
    expect(third.ok).toBe(true);
    const listing2 = other.adapter.listOfflineReady();
    expect(listing2.ok && listing2.value.length).toBe(1);
    // The LATEST realization wins (the cross-source replacement analog).
    expect(listing2.ok && listing2.value[0]?.sessionId).toBe(other.sessionId);
    expect(listing2.ok && listing2.value[0]?.assets.length).toBe(1);
    await engine.destroy();
    await other.engine.destroy();
  });

  it("an exposure without a library identity keys by session (honest separation, no silent merge)", async () => {
    const { engine, adapter, sessionId } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const exposed = await adapter.exposeCompletedSelection({ sessionId });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    expect(exposed.value[0]?.library).toBeUndefined();
    const listing = adapter.listOfflineReady();
    expect(listing.ok && listing.value[0]?.key).toBe(`session:${sessionId}`);
    await engine.destroy();
  });

  it("the offline-ready set SURVIVES the restart (journal truth + store truth)", async () => {
    const { engine, adapter, sessionId, library, store } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const exposed = await adapter.exposeCompletedSelection({
      sessionId,
      contentType: "video/x-matroska",
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    const engineRoot = engine.dataRoot;
    await engine.destroy();
    void library;

    // RESTART: a fresh engine + adapter over the SAME roots.
    const library2 = new LoopbackTorrentLibrary();
    library2.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine2 = createTorrentEngine({ library: library2, dataRoot: engineRoot, sources });
    const adapter2 = createTorrentEngineAdapter({ engine: engine2, store });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.terminal.length).toBe(1); // terminal stays terminal
    const listing = adapter2.listOfflineReady();
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.length).toBe(1);
    const entry = listing.value[0]!;
    expect(entry.key).toBe("canonical:user:42::item-7");
    expect(entry.assets[0]?.integrity).toBe("verified"); // live store verdict
    expect(entry.assets[0]?.contentType).toBe("video/x-matroska");
    await engine2.destroy();
  });
});

describe("R13 — failure typing + retry paths (never silent partials)", () => {
  it("bytes that CHANGE between completion and exposure fail the digest cross-check — typed, nothing exposed, retryable", async () => {
    const { engine, adapter, sessionId } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const status = statusOf(engine, sessionId);
    const digest = status.digests?.[0];
    if (digest === undefined) return;
    // CORRUPTION AFTER COMPLETION: the landed bytes change on disk.
    const diskPath = join(status.dataDir, digest.path);
    const original = new Uint8Array(readFileSync(diskPath));
    writeFileSync(diskPath, new Uint8Array(original.length).fill(0xde));

    const outcome = await adapter.exposeCompletedSelection({ sessionId });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("INTERNAL");
    expect(outcome.error.detail).toContain("digest cross-check FAILED");
    // NOTHING was exposed (atomic — never a silent partial).
    expect(engine.exposedAssets()).toEqual([]);

    // THE RETRY PATH: restore the real bytes, re-expose — it succeeds.
    writeFileSync(diskPath, original);
    const retried = await adapter.exposeCompletedSelection({ sessionId });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value[0]?.sha256).toBe(digest.sha256);
    expect(engine.exposedAssets().length).toBe(1);
    await engine.destroy();
  });

  it("bytes that VANISH after exposure surface honestly (`vanished`), and re-verification is the audit path", async () => {
    const { engine, adapter, sessionId, store } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const exposed = await adapter.exposeCompletedSelection({ sessionId });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    const assetId = exposed.value[0]!.assetId;

    // TAMPER AFTER EXPOSURE: same-length bytes, different content.
    const contentPath = store.contentPath(assetId);
    const stored = new Uint8Array(readFileSync(contentPath));
    writeFileSync(contentPath, new Uint8Array(stored.length).fill(0xad));

    // The cheap listing still reports the RECORDED verdict + disk size
    // agreement (honest numbers — it never re-hashes by itself).
    const listing = adapter.listOfflineReady();
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value[0]?.assets[0]?.integrity).toBe("verified");
    expect(listing.value[0]?.assets[0]?.sizeOnDisk).toBe(stored.length);

    // THE AUDIT PATH: the full re-hash REFUSES to bless the tampered bytes.
    const verified = await adapter.verifyOfflineReadyEntry(assetId);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.integrity).toBe("failed");
    expect(verified.value.digest).not.toBe(verified.value.recordedDigest);
    // And the listing now reports the FRESH failed verdict.
    const relisting = adapter.listOfflineReady();
    expect(relisting.ok && relisting.value[0]?.assets[0]?.integrity).toBe("failed");
    await engine.destroy();
  });

  it("an entry whose CONTENT FILE was deleted surfaces as `vanished` (never silently dropped)", async () => {
    const { engine, adapter, sessionId, store } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const exposed = await adapter.exposeCompletedSelection({ sessionId });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    const assetId = exposed.value[0]!.assetId;
    rmSync(store.contentPath(assetId), { force: true });

    const listing = adapter.listOfflineReady();
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    const asset = listing.value[0]?.assets[0];
    expect(asset?.integrity).toBe("vanished");
    expect(asset?.sizeOnDisk).toBeNull();
    await engine.destroy();
  });

  it("malformed exposure inputs are typed rejections (never journal garbage)", async () => {
    const { engine, adapter, sessionId } = await completedSession(AUTHORIZED_ARCHIVE_V1, [0]);
    const badIdentity = await adapter.exposeCompletedSelection({
      sessionId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the guard must reject runtime garbage
      library: { profileKey: "", canonicalItemId: "x" } as any,
    });
    expect(badIdentity.ok).toBe(false);
    if (badIdentity.ok) return;
    expect(badIdentity.error.code).toBe("INVALID_INPUT");
    const unknownSession = await adapter.exposeCompletedSelection({ sessionId: "ts-nope" });
    expect(unknownSession.ok).toBe(false);
    if (unknownSession.ok) return;
    expect(unknownSession.error.code).toBe("NOT_FOUND");
    const badVerify = await adapter.verifyOfflineReadyEntry("  ");
    expect(badVerify.ok).toBe(false);
    if (badVerify.ok) return;
    expect(badVerify.error.code).toBe("INVALID_INPUT");
    expect(engine.exposedAssets()).toEqual([]);
    await engine.destroy();
  });
});
