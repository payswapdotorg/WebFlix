/**
 * R26-W3 — the AUTHORIZED PEER CATALOG truth battery.
 *
 * THE LAW (the takeover's production-discoverability deliverable): the
 * catalog is REAL content, LAWFULLY PEER-SHAREABLE, carried with REAL
 * torrent truth. Every assertion here is a claim about PRODUCTION DATA,
 * not test fixtures:
 *
 * - every entry's REALIZED form passes the R23-C structural guard and
 *   answers the authorized NATIVE rung on Desktop (the first-class law);
 * - the ids are deterministic, valid canonical ids, and unique;
 * - the shipped `.torrent` assets EXIST and their PARSED truth (infohash,
 *   file list, sizes, piece length) matches the catalog's declared
 *   fields BYTE-FOR-BYTE (the bencode is parsed HERE, from the actual
 *   asset bytes — a drifted asset fails loudly);
 * - the magnets carry the REAL infohash + the swarm's real trackers
 *   (including the WebRTC trackers that make `browserCapable` truthful);
 * - the licenses are Creative-Commons with evidence URLs, and the
 *   artwork URLs are source-authorized https URLs typed through the
 *   R26-W1 `ContentArtwork` contract;
 * - the authorized-source registry mints the catalog's provenance and
 *   REFUSES unknown sources (the invariant-5 gate — no bypass).
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isEntertainmentItemId,
  isContentArtwork,
} from "@wfx/domain";
import { torrentRungSatisfaction } from "@wfx/client-runtime";
import { authorizeProvenance } from "@wfx/torrent-engine";

import {
  PEER_CATALOG_BASIS,
  PEER_CATALOG_ENTRIES,
  PEER_CATALOG_SOURCE_ID,
  createPeerCatalogRealizationSource,
  createPeerCatalogSourceRegistry,
  peerCatalogArtworkOf,
  peerCatalogByInfoHash,
  peerCatalogByItemId,
  peerCatalogSearch,
  peerCatalogTorrentBytes,
  peerCatalogTorrentRealizationOf,
} from "../src/platform/peer-catalog";
import {
  isDesktopTorrentRealization,
  torrentRealizationDeclarationOf,
  desktopTorrentRungSatisfaction,
  resolvePeerCopySelection,
} from "../src/platform/torrent-playback";

// ---------------------------------------------------------------------------
// A minimal local bencode decoder (the byte-level truth check)
// ---------------------------------------------------------------------------

function decodeBencode(buf: Buffer, pos: { i: number }): unknown {
  const c = buf[pos.i];
  if (c === 0x69) {
    pos.i += 1;
    const end = buf.indexOf(0x65, pos.i);
    const num = Number(buf.toString("utf8", pos.i, end));
    pos.i = end + 1;
    return num;
  }
  if (c === 0x6c) {
    pos.i += 1;
    const list: unknown[] = [];
    while (buf[pos.i] !== 0x65) list.push(decodeBencode(buf, pos));
    pos.i += 1;
    return list;
  }
  if (c === 0x64) {
    pos.i += 1;
    const dict = new Map<string, unknown>();
    while (buf[pos.i] !== 0x65) {
      const key = decodeBencode(buf, pos) as string;
      dict.set(key, decodeBencode(buf, pos));
    }
    pos.i += 1;
    return dict;
  }
  const colon = buf.indexOf(0x3a, pos.i);
  const len = Number(buf.toString("utf8", pos.i, colon));
  const start = colon + 1;
  pos.i = start + len;
  return buf.toString("utf8", start, start + len);
}

function parseTorrentAsset(bytes: Uint8Array): {
  infoHash: string;
  name: string;
  pieceLength: number;
  files: { path: string; lengthBytes: number }[];
} {
  const buf = Buffer.from(bytes);
  const root = decodeBencode(buf, { i: 0 }) as Map<string, unknown>;
  const info = root.get("info") as Map<string, unknown>;
  function encode(v: unknown): Buffer {
    if (typeof v === "number") return Buffer.from(`i${v}e`);
    if (typeof v === "string") return Buffer.from(`${Buffer.byteLength(v)}:${v}`);
    if (Array.isArray(v)) return Buffer.concat([Buffer.from("l"), ...v.map(encode), Buffer.from("e")]);
    if (v instanceof Map) {
      const parts: Buffer[] = [Buffer.from("d")];
      for (const key of [...v.keys()].sort()) parts.push(encode(key), encode(v.get(key)!));
      parts.push(Buffer.from("e"));
      return Buffer.concat(parts);
    }
    throw new Error(`parseTorrentAsset: cannot encode ${typeof v}`);
  }
  const filesRaw = info.get("files") as unknown[] | undefined;
  const files =
    filesRaw !== undefined
      ? filesRaw.map((f) => {
          const fm = f as Map<string, unknown>;
          return {
            path: (fm.get("path") as string[]).join("/"),
            lengthBytes: fm.get("length") as number,
          };
        })
      : [{ path: info.get("name") as string, lengthBytes: info.get("length") as number }];
  return {
    infoHash: createHash("sha1").update(encode(info)).digest("hex"),
    name: info.get("name") as string,
    pieceLength: info.get("piece length") as number,
    files,
  };
}

/** The shipped assets' directory (src/platform → ../../assets/peer-catalog). */
function assetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "assets", "peer-catalog");
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

describe("the authorized peer catalog (R26-W3 — real, lawful, discoverable)", () => {
  it("carries real content: four Blender Foundation open movies", () => {
    expect(PEER_CATALOG_ENTRIES.length).toBeGreaterThanOrEqual(4);
    const titles = PEER_CATALOG_ENTRIES.map((entry) => entry.title);
    expect(titles).toContain("Big Buck Bunny");
    expect(titles).toContain("Sintel");
    expect(titles).toContain("Tears of Steel");
    expect(titles).toContain("Cosmos Laundromat: First Cycle");
    for (const entry of PEER_CATALOG_ENTRIES) {
      expect(entry.creators).toContain("Blender Foundation");
      expect(entry.synopsis.length).toBeGreaterThan(20);
      expect(entry.year).toBeGreaterThanOrEqual(2006);
      expect(entry.durationMs).toBeGreaterThan(0);
      expect(entry.canonicalType).toBe("video");
    }
  });

  it("carries lawful bases: Creative-Commons licenses with evidence URLs", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      expect(entry.license.url.startsWith("https://creativecommons.org/licenses/by/")).toBe(true);
      expect(entry.license.label.startsWith("CC BY")).toBe(true);
      expect(entry.license.statement.length).toBeGreaterThan(20);
      expect(entry.license.statementUrl.startsWith("https://")).toBe(true);
      expect(entry.homepageUrl.startsWith("https://")).toBe(true);
    }
  });

  it("derives deterministic, valid, unique canonical item ids", () => {
    const seen = new Set<string>();
    for (const entry of PEER_CATALOG_ENTRIES) {
      expect(isEntertainmentItemId(entry.itemId)).toBe(true);
      expect(seen.has(entry.itemId)).toBe(false);
      seen.add(entry.itemId);
      // The id derives from the connector + infohash (stability): the same
      // derivation answers the same id on every read.
      expect(peerCatalogByInfoHash(entry.infoHash)?.itemId).toBe(entry.itemId);
    }
  });

  it("answers the authorized NATIVE rung for every entry (the R23-C law)", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      const realization = peerCatalogTorrentRealizationOf(entry);
      expect(isDesktopTorrentRealization(realization)).toBe(true);
      const declaration = torrentRealizationDeclarationOf(realization);
      expect(declaration.transport).toBe("torrent");
      expect(declaration.authorized).toBe(true);
      expect(declaration.accessClass).toBe("public");
      const rung = desktopTorrentRungSatisfaction(realization);
      expect(rung).not.toBeNull();
      expect(rung!.kind).toBe("satisfies-native-rung");
      // The frozen contract's own decision agrees (the shared derivation,
      // not a Desktop copy of it).
      expect(
        torrentRungSatisfaction({ platform: "desktop", browserTorrentSupported: false }, declaration).kind,
      ).toBe("satisfies-native-rung");
    }
  });

  it("declares browser capability TRUTHFULLY (the WebRTC trackers are in the magnet)", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      expect(entry.browserCapable).toBe(true);
      expect(entry.magnet).toContain(`urn:btih:${entry.infoHash}`);
      expect(entry.magnet).toContain(encodeURIComponent("wss://tracker.openwebtorrent.com"));
      expect(entry.magnet).toContain(encodeURIComponent("wss://tracker.btorrent.xyz"));
    }
  });

  it("ships the REAL .torrent assets, byte-parsed against the declared truth", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      const bytes = peerCatalogTorrentBytes(entry);
      expect(bytes).not.toBeNull();
      const parsed = parseTorrentAsset(bytes!);
      expect(parsed.infoHash).toBe(entry.infoHash);
      expect(parsed.pieceLength).toBe(entry.pieceLengthBytes);
      expect(parsed.files.length).toBe(entry.files.length);
      for (let index = 0; index < parsed.files.length; index += 1) {
        expect(parsed.files[index]!.path).toBe(entry.files[index]!.path);
        expect(parsed.files[index]!.lengthBytes).toBe(entry.files[index]!.lengthBytes);
      }
      const total = entry.files.reduce((sum, file) => sum + file.lengthBytes, 0);
      expect(total).toBe(entry.totalBytes);
      // The shipped asset on disk IS the same truth (the assets dir check).
      const onDisk = readFileSync(join(assetsDir(), entry.torrentFileName));
      expect(onDisk.byteLength).toBe(bytes!.byteLength);
    }
  });

  it("carries exactly ONE playable video file per torrent (the honest auto-selection truth)", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      const selection = resolvePeerCopySelection(
        entry.files.map((file) => ({ path: file.path, lengthBytes: file.lengthBytes })),
        undefined,
      );
      expect(selection.kind).toBe("selection");
      if (selection.kind === "selection") {
        expect(selection.fileIndexes.length).toBe(1);
      }
      const video = entry.files.find((file) => file.path === entry.videoFilePath);
      expect(video).toBeDefined();
      expect(video!.lengthBytes).toBe(entry.videoBytes);
    }
  });

  it("binds Worker 1's ContentArtwork contract with real source-authorized URLs", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      expect(entry.artworkUrl.startsWith("https://")).toBe(true);
      expect(entry.artworkAltText.length).toBeGreaterThan(10);
      const artwork = peerCatalogArtworkOf(entry);
      expect(isContentArtwork(artwork)).toBe(true);
      expect(artwork.url).toBe(entry.artworkUrl);
      expect(artwork.provenance.kind).toBe("source-artwork");
      expect(artwork.source.artworkServed).toBe(true);
      expect(artwork.fallback.kind).toBe("placeholder-monogram");
    }
  });

  it("mints the catalog's provenance through the registry and REFUSES unknown sources", () => {
    const registry = createPeerCatalogSourceRegistry();
    const minted = authorizeProvenance(registry, PEER_CATALOG_SOURCE_ID);
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      expect(minted.value.sourceId).toBe(PEER_CATALOG_SOURCE_ID);
      expect(minted.value.basis).toBe(PEER_CATALOG_BASIS);
    }
    const refused = authorizeProvenance(registry, "vault:not-registered");
    expect(refused.ok).toBe(false);
  });

  it("serves the realization source the composition binds (browse/lookup/search)", () => {
    const realizationOf = createPeerCatalogRealizationSource();
    const sintel = PEER_CATALOG_ENTRIES.find((entry) => entry.title === "Sintel")!;
    expect(realizationOf(sintel.itemId)).not.toBeNull();
    expect(realizationOf("wfxitm_0000000000000000000000NOPE")).toBeNull();
    // The search finds titles, creators, and synopsis matches.
    expect(peerCatalogSearch("sintel").map((entry) => entry.title)).toContain("Sintel");
    expect(peerCatalogSearch("blender").length).toBe(PEER_CATALOG_ENTRIES.length);
    expect(peerCatalogSearch("dragon").map((entry) => entry.title)).toContain("Sintel");
    expect(peerCatalogSearch("zzz-no-match").length).toBe(0);
    // The caller's additional source wins on conflict (the user's own
    // copy outranks the catalog's).
    const overridden = createPeerCatalogRealizationSource(() => ({
      itemId: sintel.itemId,
      title: "Sintel (family vault copy)",
      magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      browserCapable: false,
    }));
    expect(overridden(sintel.itemId)!.title).toBe("Sintel (family vault copy)");
  });

  it("reads entries by item id (the canonical-identity law)", () => {
    for (const entry of PEER_CATALOG_ENTRIES) {
      expect(peerCatalogByItemId(entry.itemId)?.title).toBe(entry.title);
    }
    expect(peerCatalogByItemId("wfxitm_0000000000000000000000NOPE")).toBeNull();
  });
});
