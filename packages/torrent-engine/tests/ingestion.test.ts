/**
 * R11 — authorized ingestion tests (invariant 5, the provenance law).
 *
 * Magnet + `.torrent` parsing through the mature library (the loopback
 * double delegates parsing to the REAL parse-torrent), and the STRUCTURAL
 * + RUNTIME provenance enforcement: an ingestion without authorized
 * provenance is a TYPED REJECTION, never a warning, never a fallback.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  authorizeProvenance,
  createAuthorizedSourceRegistry,
} from "../src/provenance";
import { createTorrentEngine } from "../src/engine";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";
import {
  AUTHORIZED_ARCHIVE_V1,
  SINGLE_FILE_DOCUMENT,
  fixtureMagnetUri,
  fixtureTorrentBytes,
} from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-ingestion");

let sources: ReturnType<typeof createAuthorizedSourceRegistry> & {
  register: (s: never) => unknown;
};
let library: LoopbackTorrentLibrary;

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  sources = createAuthorizedSourceRegistry({
    sources: [
      { sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" },
      { sourceId: "source:creative-commons", basis: "creative-commons", label: "CC archive" },
    ],
  }) as never;
  library = new LoopbackTorrentLibrary();
  library.registerFixture(AUTHORIZED_ARCHIVE_V1);
  library.registerFixture(SINGLE_FILE_DOCUMENT);
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function newEngine() {
  return createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${Math.random().toString(36).slice(2)}`),
    sources,
  });
}

describe("R11 — authorized ingestion: the provenance law (invariant 5)", () => {
  it("authorizeProvenance mints the brand ONLY for registered sources; unknown sources are typed rejections", () => {
    const ok = authorizeProvenance(sources, "vault:family-media");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.sourceId).toBe("vault:family-media");
      expect(ok.value.basis).toBe("user-owned");
    }
    const missing = authorizeProvenance(sources, "totally-unknown-source");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("PROVENANCE_REJECTED");
      expect(missing.error.detail).toContain("authorized-source registry");
    }
    const empty = authorizeProvenance(sources, "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error.code).toBe("PROVENANCE_REJECTED");
    }
  });

  it("a forged provenance (as-any with an unknown source) is REJECTED at ingest time (defense in depth)", async () => {
    const engine = newEngine();
    const forged = {
      sourceId: "not-in-the-registry",
      basis: "licensed",
    } as never;
    const result = await engine.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PROVENANCE_REJECTED");
      expect(result.error.detail).toContain("invariant 5");
    }
  });

  it("ingestMagnet with an unregistered source is a TYPED REJECTION — invariant 5 enforced at the API", () => {
    const bad = authorizeProvenance(sources, "who-is-this");
    expect(bad.ok).toBe(false); // the mint itself refuses
    if (!bad.ok) {
      expect(bad.error.code).toBe("PROVENANCE_REJECTED");
      expect(bad.error.detail).toContain("authorized-source registry");
    }
  });

  it("ingestMagnet parses an authorized magnet (infohash, display name, trackers)", async () => {
    const engine = newEngine();
    const provenance = authorizeProvenance(sources, "vault:family-media");
    if (!provenance.ok) throw new Error("fixture provenance must mint");
    const result = await engine.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), provenance.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("magnet");
    expect(result.value.infoHash).toBe(
      (await import("./helpers/fixtures")).fixtureInfoHash(AUTHORIZED_ARCHIVE_V1),
    );
    expect(result.value.displayName).toBe(AUTHORIZED_ARCHIVE_V1.name);
    expect(result.value.files).toEqual([]);
    expect(result.value.magnetUri).toBe(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1));
  });

  it("ingestMagnet rejects a malformed magnet with a typed INVALID_MAGNET", async () => {
    const engine = newEngine();
    const provenance = authorizeProvenance(sources, "vault:family-media");
    if (!provenance.ok) throw new Error("fixture provenance must mint");
    const result = await engine.ingestMagnet("magnet:?xt=urn:btih:not-a-real-hash", provenance.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_MAGNET");
    }
  });

  it("ingestTorrentFile parses a committed fixture (.torrent) with the file list for SELECTION before any transfer", async () => {
    const engine = newEngine();
    const provenance = authorizeProvenance(sources, "source:creative-commons");
    if (!provenance.ok) throw new Error("fixture provenance must mint");
    const result = await engine.ingestTorrentFile(
      fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1),
      provenance.value,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("torrent-file");
    expect(result.value.metainfo).toBeDefined();
    const meta = result.value.metainfo!;
    // Piece geometry: (16384*5 + 7000) + 4000 + 250 = 93170 bytes / 16384
    expect(meta.totalBytes).toBe(93_170);
    expect(meta.pieceCount).toBe(6);
    expect(meta.pieceLengthBytes).toBe(16_384);
    // The J22 file list (name, length, offset) — answered BEFORE any transfer.
    expect(meta.files.map((f) => [f.path, f.lengthBytes, f.offsetBytes])).toEqual([
      ["authorized-archive-v1/feature-presentation.mkv", 88_920, 0],
      ["authorized-archive-v1/coverart.jpg", 4_000, 88_920],
      ["authorized-archive-v1/credits.txt", 250, 92_920],
    ]);
    expect(meta.trackers).toEqual(AUTHORIZED_ARCHIVE_V1.trackers);
    expect(meta.isPrivate).toBe(false);
    expect(meta.dhtEligible).toBe(true);
    expect(result.value.files.length).toBe(3);
  });

  it("ingestTorrentFile rejects garbage bytes with a typed INVALID_TORRENT_FILE", async () => {
    const engine = newEngine();
    const provenance = authorizeProvenance(sources, "vault:family-media");
    if (!provenance.ok) throw new Error("fixture provenance must mint");
    const result = await engine.ingestTorrentFile(new Uint8Array([1, 2, 3, 4, 5]), provenance.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TORRENT_FILE");
    }
  });

  it("ingestTorrentFile rejects EMPTY bytes as typed invalid input", async () => {
    const engine = newEngine();
    const provenance = authorizeProvenance(sources, "vault:family-media");
    if (!provenance.ok) throw new Error("fixture provenance must mint");
    const result = await engine.ingestTorrentFile(new Uint8Array(0), provenance.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TORRENT_FILE");
    }
  });

  it("the single-file fixture parses with exact geometry (one file, no folder)", async () => {
    const engine = newEngine();
    const provenance = authorizeProvenance(sources, "vault:family-media");
    if (!provenance.ok) throw new Error("fixture provenance must mint");
    const result = await engine.ingestTorrentFile(
      fixtureTorrentBytes(SINGLE_FILE_DOCUMENT),
      provenance.value,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const meta = result.value.metainfo!;
    expect(meta.files.length).toBe(1);
    expect(meta.files[0]?.path).toBe("single-file-document.pdf");
    expect(meta.files[0]?.offsetBytes).toBe(0);
    expect(meta.totalBytes).toBe(17_618);
    expect(meta.pieceCount).toBe(3);
  });
});
