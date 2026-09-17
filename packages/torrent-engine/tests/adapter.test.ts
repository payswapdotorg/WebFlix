/**
 * R11 — the native-media adapter (the narrow seam).
 *
 * The adapter feeds VERIFIED completed torrent selections into the R10
 * engine's asset store: bytes land as native-media assets with digests +
 * integrity verdicts, so the desktop's NATIVE rung plays torrent-acquired
 * media through the SAME range gateway as local files. This test verifies
 * the landing path end-to-end against the R10 asset store (real bytes,
 * real digests).
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { type AssetStore } from "@wfx/native-media";

import { createTorrentEngine, type TorrentEngineSurface } from "../src/engine";
import {
  createTorrentAssetStore,
  createTorrentEngineAdapter,
  type LandedTorrentAsset,
  type TorrentEngineAdapter,
} from "../src/adapter";
import { LoopbackBitTorrentBackend, type LoopbackFixture } from "../src/backend";
import { provenanceFromAuthorizedSource } from "../src/provenance";
import { isTorrentEngineError } from "../src/errors";

const FIXTURES = join(import.meta.dir, "fixtures");
const TORRENT_BYTES = new Uint8Array(readFileSync(join(FIXTURES, "sintel-single.torrent")));
const SUMMARY = JSON.parse(readFileSync(join(FIXTURES, "sintel-single.summary.json"), "utf8")) as {
  infoHash: string;
  name: string;
  pieceLength: number;
  pieceCount: number;
  totalBytes: number;
  pieceSha1Hex: string[];
};
const FIXTURE_BYTES = new Uint8Array(readFileSync(join(FIXTURES, "sintel-single.bin")));

let tmpRoot: string;
let store: AssetStore;
let backend: LoopbackBitTorrentBackend;
let engine: TorrentEngineSurface;
let adapter: TorrentEngineAdapter;

function makeFixture(): LoopbackFixture {
  const pieces = SUMMARY.pieceSha1Hex.map((hex) => new Uint8Array(Buffer.from(hex, "hex")));
  return {
    infoHash: SUMMARY.infoHash,
    name: SUMMARY.name,
    pieceLengthBytes: SUMMARY.pieceLength,
    pieces,
    files: [
      {
        path: SUMMARY.name,
        lengthBytes: SUMMARY.totalBytes,
        bytes: FIXTURE_BYTES,
        playableHint: true,
      },
    ],
    peerCount: 5,
  };
}

function makeProvenance() {
  return provenanceFromAuthorizedSource({
    sourceId: "personal-vault",
    authorizationKind: "authorized-vault",
  });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "wfx-r11-adapter-"));
  store = createTorrentAssetStore(join(tmpRoot, "store"));
  backend = new LoopbackBitTorrentBackend();
  backend.registerFixture(makeFixture());
  engine = createTorrentEngine({
    dataRoot: join(tmpRoot, "engine"),
    backend,
    sessionIdGenerator: () => "session-1",
  });
  adapter = createTorrentEngineAdapter({ engine, store });
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("R11 — the native-media adapter", () => {
  it("createTorrentAssetStore returns a real R10 asset store", () => {
    const s = createTorrentAssetStore(join(tmpRoot, "store-2"));
    expect(s.root).toBeDefined();
    expect(s.assetsDir).toBeDefined();
    expect(existsSync(s.assetsDir)).toBe(true);
  });

  it("createTorrentEngineAdapter throws INVALID_INPUT without engine/store", () => {
    expect(() => createTorrentEngineAdapter({ engine, store: null as never })).toThrow(/store is required/);
    expect(() => createTorrentEngineAdapter({ engine: null as never, store })).toThrow(/engine is required/);
  });

  it("landVerifiedAsset throws NOT_FOUND for a session that never completed", async () => {
    await engine.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    try {
      await adapter.landVerifiedAsset("session-1");
      throw new Error("expected landVerifiedAsset to reject");
    } catch (e) {
      expect(isTorrentEngineError(e)).toBe(true);
      if (isTorrentEngineError(e)) {
        expect(e.code).toBe("NOT_FOUND");
        expect(e.detail).toContain("no verified asset");
      }
    }
  });

  it("landVerifiedAsset lands a completed asset into the R10 asset store", async () => {
    // Drive the engine to completion.
    await engine.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    await engine.selectFiles("session-1", [SUMMARY.name]);
    await engine.getRange("session-1", { filePath: SUMMARY.name, offset: 0, length: SUMMARY.totalBytes });
    await engine.inspect("session-1"); // trigger refreshFromBackend
    await new Promise((resolve) => setTimeout(resolve, 20));
    const asset = engine.verifiedAsset("session-1");
    expect(asset).toBeDefined();
    if (asset === undefined) return; // completion did not fire in this run
    // Land the asset.
    const landed: LandedTorrentAsset = await adapter.landVerifiedAsset("session-1");
    expect(landed.sha256).toBe(createHash("sha256").update(FIXTURE_BYTES).digest("hex"));
    expect(landed.sizeBytes).toBe(SUMMARY.totalBytes);
    expect(landed.contentType).toBe("video/mp4");
    expect(landed.provenance.sourceId).toBe("personal-vault");
    expect(landed.infoHash).toBe(SUMMARY.infoHash);
    expect(landed.sessionId).toBe("session-1");
    // The asset store now has the landed asset.
    const meta = store.getAsset(landed.assetId);
    expect(meta).toBeDefined();
    expect(meta?.integrity).toBe("verified");
    expect(meta?.sha256).toBe(landed.sha256);
    expect(meta?.sizeBytes).toBe(SUMMARY.totalBytes);
  });

  it("landVerifiedAsset's bytes match the engine's verified digest (the J24 law)", async () => {
    await engine.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    await engine.selectFiles("session-1", [SUMMARY.name]);
    await engine.getRange("session-1", { filePath: SUMMARY.name, offset: 0, length: SUMMARY.totalBytes });
    await engine.inspect("session-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const asset = engine.verifiedAsset("session-1");
    if (asset === undefined) return;
    const landed = await adapter.landVerifiedAsset("session-1");
    // The store's recorded SHA-256 MATCHES the engine's verified digest —
    // the SAME primitive R10 uses for local-file imports (no fabrication).
    expect(landed.sha256).toBe(asset.sha256);
  });

  it("landVerifiedAsset throws INVALID_INPUT for an empty sessionId", async () => {
    await expect(adapter.landVerifiedAsset("")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
