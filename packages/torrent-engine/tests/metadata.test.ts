/**
 * R11 — metadata parsing (magnet + .torrent) via the mature library.
 *
 * The mature-library boundary: `parse-torrent` (v11.0.24, MIT, the parsing
 * sub-package of webtorrent) handles magnet URIs and `.torrent` files.
 * This test exercises the wrapper's outputs against FIXTURE metainfo
 * committed as test data (the J21 "metadata" step's honest evidence).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildMagnetUri,
  isTorrentMetadata,
  parseMagnetUri,
  parseTorrentFile,
} from "../src/metadata";
import { isTorrentEngineError, TorrentEngineError } from "../src/errors";

const FIXTURES = join(import.meta.dir, "fixtures");
const TORRENT_BYTES = new Uint8Array(readFileSync(join(FIXTURES, "sintel-single.torrent")));
const MAGNET_URI = readFileSync(join(FIXTURES, "sintel-single.magnet.txt"), "utf8").trim();
const SUMMARY = JSON.parse(readFileSync(join(FIXTURES, "sintel-single.summary.json"), "utf8")) as {
  infoHash: string;
  name: string;
  pieceLength: number;
  pieceCount: number;
  totalBytes: number;
  files: Array<{ path: string; lengthBytes: number; playableHint: boolean }>;
  pieceSha1Hex: string[];
};

describe("R11 — metadata parsing via the mature library", () => {
  it("the fixture is well-formed (committed test data)", () => {
    expect(TORRENT_BYTES.byteLength).toBeGreaterThan(100);
    expect(MAGNET_URI).toMatch(/^magnet:\?xt=urn:btih:[0-9a-f]{40}/);
    expect(SUMMARY.infoHash).toMatch(/^[0-9a-f]{40}$/);
    expect(SUMMARY.pieceCount).toBe(4);
    expect(SUMMARY.pieceLength).toBe(16 * 1024);
    expect(SUMMARY.totalBytes).toBe(SUMMARY.pieceLength * SUMMARY.pieceCount);
  });

  it("parseTorrentFile parses the .torrent into the expected metadata", async () => {
    const meta = await parseTorrentFile(TORRENT_BYTES);
    expect(isTorrentMetadata(meta)).toBe(true);
    expect(meta.infoHash).toBe(SUMMARY.infoHash);
    expect(meta.name).toBe(SUMMARY.name);
    expect(meta.pieceLengthBytes).toBe(SUMMARY.pieceLength);
    expect(meta.pieceCount).toBe(SUMMARY.pieceCount);
    expect(meta.totalBytes).toBe(SUMMARY.totalBytes);
    expect(meta.sourceKind).toBe("torrent-file");
    expect(meta.files.length).toBe(1);
    expect(meta.files[0]?.path).toBe(SUMMARY.files[0]?.path);
    expect(meta.files[0]?.lengthBytes).toBe(SUMMARY.totalBytes);
    expect(meta.files[0]?.offsetBytes).toBe(0);
    expect(meta.files[0]?.playableHint).toBe(true);
    expect(meta.pieces.length).toBe(SUMMARY.pieceCount);
    // Each piece hash is 20 bytes (BEP-3 SHA-1).
    for (const piece of meta.pieces) {
      expect(piece).toBeInstanceOf(Uint8Array);
      expect(piece.byteLength).toBe(20);
    }
    expect(meta.trackers).toEqual(["udp://tracker.example:1337"]);
  });

  it("parseMagnetUri parses the magnet into the magnet-source metadata", async () => {
    const meta = await parseMagnetUri(MAGNET_URI);
    expect(isTorrentMetadata(meta)).toBe(true);
    expect(meta.infoHash).toBe(SUMMARY.infoHash);
    expect(meta.name).toBe(SUMMARY.name);
    expect(meta.sourceKind).toBe("magnet");
    // Magnet sources carry NO piece hashes / file list — they are [] / 0
    // until the swarm acquires metadata via BEP-9 ut_metadata.
    expect(meta.pieceLengthBytes).toBe(0);
    expect(meta.pieceCount).toBe(0);
    expect(meta.pieces.length).toBe(0);
    expect(meta.totalBytes).toBe(0);
    expect(meta.files.length).toBe(0);
    expect(meta.trackers).toEqual(["udp://tracker.example:1337"]);
  });

  it("parseMagnetUri throws INVALID_INPUT for non-string/empty input", async () => {
    await expect(parseMagnetUri("")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(parseMagnetUri("   ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(parseMagnetUri(42 as any)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("parseTorrentFile throws INVALID_INPUT for non-Uint8Array input", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(parseTorrentFile("not bytes" as any)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(parseTorrentFile(new Uint8Array(0))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("parseTorrentFile throws METADATA_FAILED for malformed bytes", async () => {
    const bad = new Uint8Array([0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74]); // "default" — not bencode
    try {
      await parseTorrentFile(bad);
      throw new Error("expected parseTorrentFile to reject");
    } catch (e) {
      expect(isTorrentEngineError(e)).toBe(true);
      if (isTorrentEngineError(e)) {
        expect(e.code === "METADATA_FAILED" || e.code === "UNSUPPORTED_SOURCE").toBe(true);
      }
    }
  });

  it("buildMagnetUri constructs the honest magnet format", () => {
    const uri = buildMagnetUri({
      infoHash: SUMMARY.infoHash,
      name: SUMMARY.name,
      trackers: ["udp://tracker.example:1337"],
    });
    expect(uri).toMatch(/^magnet:\?xt=urn:btih:[0-9a-f]{40}/);
    expect(uri).toContain(`dn=${encodeURIComponent(SUMMARY.name)}`);
    expect(uri).toContain(`tr=${encodeURIComponent("udp://tracker.example:1337")}`);
  });

  it("buildMagnetUri throws INVALID_INPUT for malformed infohash", () => {
    expect(() => buildMagnetUri({ infoHash: "not-a-hash" })).toThrow(/40-char hex SHA-1/);
    expect(() => buildMagnetUri({ infoHash: SUMMARY.infoHash, name: "" })).toThrow(/non-empty string/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => buildMagnetUri({ infoHash: SUMMARY.infoHash, trackers: "x" as any })).toThrow(/array/);
  });

  it("isTorrentMetadata rejects every non-shape value (library data is never trusted)", () => {
    expect(isTorrentMetadata(null)).toBe(false);
    expect(isTorrentMetadata(undefined)).toBe(false);
    expect(isTorrentMetadata("not an object")).toBe(false);
    expect(isTorrentMetadata({})).toBe(false);
    expect(isTorrentMetadata({ infoHash: "x" })).toBe(false);
    // A well-formed metadata passes the guard.
    return parseTorrentFile(TORRENT_BYTES).then((meta) => {
      expect(isTorrentMetadata(meta)).toBe(true);
    });
  });

  it("the typed error carries the closed code + retryable table", () => {
    const err = new TorrentEngineError("METADATA_FAILED", { detail: "test" });
    expect(err.code).toBe("METADATA_FAILED");
    expect(err.retryable).toBe(false); // METADATA_FAILED is not retryable per the table
    expect(err.name).toBe("TorrentEngineError");
  });
});
