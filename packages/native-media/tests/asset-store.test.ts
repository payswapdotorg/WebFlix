/**
 * R10 — the asset store tests.
 *
 * The production local storage: layout (`assets/<id>/{content.bin,
 * meta.json}`), REAL sha256 digests recorded at import and PROVEN by a
 * full re-hash (`verified` only on match, `failed` on mismatch, `unknown`
 * until proven), byte-exact range reads over the real stored bytes, the
 * policy quota as a typed refusal BEFORE any write, and NO partial
 * silent state on any failure (staging discarded, directory removed).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { NativeMediaError } from "../src/errors";
import {
  assetIdForPath,
  createAssetStore,
  sha256Hex,
  type AssetStore,
} from "../src/service-process/store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TMP_ROOT = join(import.meta.dir, "tmp-store-test");

/** A deterministic real media fixture of n bytes (byte[i] = (i * 7 + 3) % 251). */
function writeMediaFile(name: string, size: number): string {
  const path = join(TMP_ROOT, name);
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = (i * 7 + 3) % 251;
  }
  writeFileSync(path, bytes);
  return path;
}

function readMetaFile(store: AssetStore, assetId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(store.assetsDir, assetId, "meta.json"), "utf8"),
  ) as Record<string, unknown>;
}

let storeCounter = 0;
function newStore(maxBytes?: number): { store: AssetStore; root: string } {
  storeCounter += 1;
  const root = join(TMP_ROOT, `store-${storeCounter}`);
  const store = createAssetStore({ root, ...(maxBytes !== undefined ? { maxBytes } : {}) });
  return { store, root };
}

beforeAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R10 — the asset store", () => {
  it("creates the layout eagerly; an empty store is honestly empty", () => {
    const { store } = newStore();
    expect(existsSync(store.assetsDir)).toBe(true);
    expect(store.listAssets()).toEqual([]);
    expect(store.usedBytes()).toBe(0);
  });

  it("imports a real file: byte-exact content, recorded digest, verified verdict", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-1.bin", 4_096);
    const result = await store.importAsset({ sourcePath: source });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const { meta, contentPath } = result.asset;

    // The layout law: assets/<assetId>/{content.bin, meta.json}.
    expect(contentPath).toBe(join(store.assetsDir, meta.assetId, "content.bin"));
    expect(existsSync(join(store.assetsDir, meta.assetId, "meta.json"))).toBe(true);

    // The digest is the REAL sha256 of the source bytes (computed
    // independently here), and the verdict is PROVEN (import re-hashes).
    const sourceBytes = new Uint8Array(readFileSync(source));
    expect(meta.sha256).toBe(sha256Hex(sourceBytes));
    expect(meta.sizeBytes).toBe(4_096);
    expect(meta.integrity).toBe("verified");

    // The stored bytes are byte-exact.
    const stored = new Uint8Array(readFileSync(contentPath));
    expect(Array.from(stored)).toEqual(Array.from(sourceBytes));
  });

  it("derives a deterministic assetId from the absolute source path", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-2.bin", 1_000);
    const a = await store.importAsset({ sourcePath: source });
    const b = await store.importAsset({ sourcePath: source });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(a.asset.meta.assetId).toBe(b.asset.meta.assetId);
    expect(a.asset.meta.assetId).toBe(assetIdForPath(source));
  });

  it("re-import REPLACES the content and re-proves the verdict", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-3.bin", 512);
    const first = await store.importAsset({ sourcePath: source });
    expect(first.ok && first.asset.meta.integrity).toBe("verified");

    // The source CHANGES: re-import overwrites, digest follows the bytes.
    writeFileSync(source, new Uint8Array(512).fill(0xab));
    const second = await store.importAsset({ sourcePath: source });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.asset.meta.integrity).toBe("verified");
    expect(second.asset.meta.sha256).toBe(sha256Hex(new Uint8Array(512).fill(0xab)));
    expect(store.listAssets()).toHaveLength(1);
  });

  it("verifyAsset: intact ⇒ verified; a corrupted byte ⇒ failed (recorded, never thrown)", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-4.bin", 2_048);
    const imported = await store.importAsset({ sourcePath: source });
    if (!imported.ok) throw new Error("unreachable");
    const assetId = imported.asset.meta.assetId;

    const intact = await store.verifyAsset(assetId);
    expect(intact.ok).toBe(true);
    if (!intact.ok) throw new Error("unreachable");
    expect(intact.integrity).toBe("verified");

    // Corrupt ONE stored byte behind the store's back.
    const contentPath = store.contentPath(assetId);
    const bytes = new Uint8Array(readFileSync(contentPath));
    bytes[42] = (bytes[42]! + 1) % 251;
    writeFileSync(contentPath, bytes);

    const corrupt = await store.verifyAsset(assetId);
    expect(corrupt.ok).toBe(true);
    if (!corrupt.ok) throw new Error("unreachable");
    expect(corrupt.integrity).toBe("failed");
    expect(corrupt.digest).not.toBe(corrupt.recordedDigest);
    // The verdict is recorded DATA in the sidecar.
    expect(readMetaFile(store, assetId).integrity).toBe("failed");
  });

  it("verifyAsset typed refusals: unknown asset, missing digest", async () => {
    const { store } = newStore();
    const unknown = await store.verifyAsset("asset-doesnotexist");
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("unreachable");
    expect(unknown.error.code).toBe("NOT_FOUND");

    // A hand-crafted sidecar without a digest cannot be verified — the
    // typed refusal says so (never a fabricated verdict).
    const assetId = "asset-manual";
    mkdirSync(join(store.assetsDir, assetId), { recursive: true });
    writeFileSync(join(store.assetsDir, assetId, "content.bin"), new Uint8Array(16));
    writeFileSync(
      join(store.assetsDir, assetId, "meta.json"),
      JSON.stringify({
        assetId,
        contentType: "application/octet-stream",
        sizeBytes: 16,
        integrity: "unknown",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const noDigest = await store.verifyAsset(assetId);
    expect(noDigest.ok).toBe(false);
    if (noDigest.ok) throw new Error("unreachable");
    expect(noDigest.error.code).toBe("INVALID_INPUT");
  });

  it("readAssetRange serves byte-exact REAL slices; typed bounds failures", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-5.bin", 3_000);
    const imported = await store.importAsset({ sourcePath: source });
    if (!imported.ok) throw new Error("unreachable");
    const assetId = imported.asset.meta.assetId;
    const all = new Uint8Array(readFileSync(source));

    const head = await store.readAssetRange(assetId, 0, 99);
    expect(Array.from(head)).toEqual(Array.from(all.slice(0, 100)));
    const middle = await store.readAssetRange(assetId, 1_500, 1_599);
    expect(Array.from(middle)).toEqual(Array.from(all.slice(1_500, 1_600)));
    const tail = await store.readAssetRange(assetId, 2_999, 2_999);
    expect(Array.from(tail)).toEqual([all[2_999]!]);

    await expect(store.readAssetRange(assetId, 0, 3_000)).rejects.toMatchObject({
      code: "RANGE_NOT_SATISFIABLE",
    });
    await expect(store.readAssetRange(assetId, 3_000, 3_500)).rejects.toMatchObject({
      code: "RANGE_NOT_SATISFIABLE",
    });
    await expect(store.readAssetRange(assetId, -1, 5)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(store.readAssetRange("asset-none", 0, 5)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("statAsset is DISK TRUTH (a truncated content file reports its live size)", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-6.bin", 2_000);
    const imported = await store.importAsset({ sourcePath: source });
    if (!imported.ok) throw new Error("unreachable");
    const assetId = imported.asset.meta.assetId;
    expect(store.statAsset(assetId)).toEqual({ sizeBytes: 2_000 });

    // The file shrinks behind the store's back: the LIVE stat reports it.
    writeFileSync(store.contentPath(assetId), new Uint8Array(64));
    expect(store.statAsset(assetId)).toEqual({ sizeBytes: 64 });
    // ...while the RECORDED sidecar keeps the import-time size.
    expect(store.getAsset(assetId)?.sizeBytes).toBe(2_000);
  });

  it("the policy quota refuses BEFORE any write (typed IO_ERROR, detail carries numbers)", async () => {
    const { store } = newStore(1_024);
    const source = writeMediaFile("media-7.bin", 2_048);
    const refused = await store.importAsset({ sourcePath: source });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error).toBeInstanceOf(NativeMediaError);
    expect(refused.error.code).toBe("IO_ERROR");
    expect(refused.error.detail).toContain("2_048".replace("_", ""));
    expect(refused.error.detail).toContain("quota");
    // NO partial silent state: nothing was stored.
    expect(store.listAssets()).toEqual([]);
    expect(store.usedBytes()).toBe(0);
  });

  it("a real write failure leaves NO partial silent state (typed IO_ERROR, staging discarded)", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-8.bin", 128);
    // Sabotage the target asset dir: a FILE blocks the directory creation,
    // so the staged write must fail with a real filesystem error.
    const assetId = assetIdForPath(source);
    writeFileSync(join(store.assetsDir, assetId), "not a directory");

    const failed = await store.importAsset({ sourcePath: source });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("unreachable");
    expect(failed.error.code).toBe("IO_ERROR");
    expect(failed.error.detail).toContain("no partial state was kept");
    // The store is unchanged: the blocking file remains (we never delete
    // foreign data), but no asset metadata was recorded.
    expect(store.getAsset(assetId)).toBeUndefined();
    expect(store.listAssets()).toEqual([]);
  });

  it("a missing source is a typed NOT_FOUND; a non-file source likewise", async () => {
    const { store } = newStore();
    const missing = await store.importAsset({ sourcePath: join(TMP_ROOT, "nope.bin") });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.error.code).toBe("NOT_FOUND");

    const dir = join(TMP_ROOT, "a-directory");
    mkdirSync(dir, { recursive: true });
    const notAFile = await store.importAsset({ sourcePath: dir });
    expect(notAFile.ok).toBe(false);
    if (notAFile.ok) throw new Error("unreachable");
    expect(notAFile.error.code).toBe("NOT_FOUND");
  });

  it("removeAsset is explicit and typed; usedBytes tracks the recorded sizes", async () => {
    const { store } = newStore();
    const source = writeMediaFile("media-9.bin", 777);
    const imported = await store.importAsset({ sourcePath: source });
    if (!imported.ok) throw new Error("unreachable");
    const assetId = imported.asset.meta.assetId;
    expect(store.usedBytes()).toBe(777);

    const removed = store.removeAsset(assetId);
    expect(removed.ok).toBe(true);
    expect(store.getAsset(assetId)).toBeUndefined();
    expect(store.statAsset(assetId)).toBeNull();
    expect(store.usedBytes()).toBe(0);
    expect(store.removeAsset(assetId).ok).toBe(false);
  });

  it("constructor typed validation", () => {
    expect(() => createAssetStore({ root: "" })).toThrow(NativeMediaError);
    expect(() => createAssetStore({ root: "x", maxBytes: -1 })).toThrow(NativeMediaError);
    expect(() => createAssetStore({ root: "x", maxBytes: 1.5 })).toThrow(NativeMediaError);
  });
});
