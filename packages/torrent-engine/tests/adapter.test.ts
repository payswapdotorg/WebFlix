/**
 * R11 — the native-media adapter tests (the narrow seam).
 *
 * A completed, piece-verified selection lands in the REAL R10 asset store
 * (`createAssetStore` from `@wfx/native-media` — the actual production
 * store code, not a mock): bytes land with digests + verified integrity
 * verdicts, serve range reads over the real bytes, and non-completed
 * sessions are refused typed.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createAssetStore } from "@wfx/native-media";

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
  fixtureContent,
  fixtureTorrentBytes,
} from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-adapter");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

let counter = 0;
beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A full engine + adapter stack over the loopback library. */
async function newStack(): Promise<{
  engine: TorrentEngine;
  adapter: TorrentEngineAdapter;
  store: ReturnType<typeof createAssetStore>;
  library: LoopbackTorrentLibrary;
}> {
  counter += 1;
  const library = new LoopbackTorrentLibrary();
  library.registerFixture(AUTHORIZED_ARCHIVE_V1);
  const engine = createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${counter}`),
    sources,
  });
  const store = createAssetStore({ root: join(TMP, `store-${counter}`) });
  const adapter = createTorrentEngineAdapter({ engine, store });
  return { engine, adapter, store, library };
}

describe("R11 — the native-media adapter (the narrow seam)", () => {
  it("a completed selection lands in the REAL R10 asset store with digests + a verified verdict", async () => {
    const { engine, adapter, library } = await newStack();
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0, 2] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    for (let i = 0; i < 10; i += 1) library.advanceAll();
    await waitFor(() =>
      statusOf(engine, sessionId).state === "completed",
    );

    const landed = await adapter.landCompletedSelection({ sessionId, contentType: "video/x-matroska" });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    expect(landed.value.length).toBe(2);

    // File 0 (the .mkv): landed with the ENGINE's digest, and the STORE's
    // own import+verify verdict (digest + integrity derived from REAL bytes).
    const first = landed.value[0]!;
    expect(first.sourcePath).toBe("authorized-archive-v1/feature-presentation.mkv");
    expect(first.asset.meta.integrity).toBe("verified");
    expect(first.asset.meta.sha256).toBe(first.engineSha256);
    expect(first.asset.meta.contentType).toBe("video/x-matroska");
    expect(first.asset.meta.sizeBytes).toBe(88_920);
    // The digest is independently reproducible from the fixture content.
    expect(first.asset.meta.sha256).toBe(
      (await import("../src/integrity")).torrentSha256Hex(
        fixtureContent(AUTHORIZED_ARCHIVE_V1).get("authorized-archive-v1/feature-presentation.mkv")!,
      ),
    );
    // File 2 (credits.txt) landed too (the whole selection).
    expect(landed.value[1]?.sourcePath).toBe("authorized-archive-v1/credits.txt");
    await engine.destroy();
  });

  it("landed assets serve RANGE READS over the real bytes through the store (gateway compatibility)", async () => {
    const { engine, adapter, library, store } = await newStack();
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    for (let i = 0; i < 10; i += 1) library.advanceAll();
    await waitFor(() =>
      statusOf(engine, sessionId).state === "completed",
    );
    const landed = await adapter.landCompletedSelection({ sessionId });
    if (!landed.ok) return;
    const asset = landed.value[0]!.asset;

    // The R10 store's range read serves the REAL landed bytes.
    const bytes = await store.readAssetRange(asset.meta.assetId, 0, 255);
    expect(bytes.byteLength).toBe(256);
    const expected = fixtureContent(AUTHORIZED_ARCHIVE_V1).get(
      "authorized-archive-v1/feature-presentation.mkv",
    )!;
    expect(Buffer.from(bytes).equals(Buffer.from(expected.subarray(0, 256)))).toBe(true);

    // And the store's own verifyAsset re-proves the verdict.
    const verify = await store.verifyAsset(asset.meta.assetId);
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.integrity).toBe("verified");
      expect(verify.digest).toBe(landed.value[0]!.engineSha256);
    }
    await engine.destroy();
  });

  it("landing is REFUSED for a non-completed session (typed INVALID_STATE — only proven bytes land)", async () => {
    const { engine, adapter, library } = await newStack();
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library.advanceAll(); // partially downloaded
    const landed = await adapter.landCompletedSelection({ sessionId: created.value.sessionId });
    expect(landed.ok).toBe(false);
    if (!landed.ok) {
      expect(landed.error.code).toBe("INVALID_STATE");
      expect(landed.error.detail).toContain("piece-verified");
    }
    await engine.destroy();
  });

  it("landing an unknown session is a typed NOT_FOUND", async () => {
    const { engine, adapter } = await newStack();
    const landed = await adapter.landCompletedSelection({ sessionId: "ts-nope" });
    expect(landed.ok).toBe(false);
    if (!landed.ok) {
      expect(landed.error.code).toBe("NOT_FOUND");
    }
    await engine.destroy();
  });

  it("the adapter accepts an EXISTING R10 store instance (sharing the engine service's store)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    counter += 1;
    const engine = createTorrentEngine({
      library,
      dataRoot: join(TMP, `engine-${counter}`),
      sources,
    });
    const store = createAssetStore({ root: join(TMP, `shared-store-${counter}`), maxBytes: 1_000_000 });
    const adapter = createTorrentEngineAdapter({ engine, store });
    expect(adapter.storeRoot).toBe(store.root);
    await engine.destroy();
  });
});
