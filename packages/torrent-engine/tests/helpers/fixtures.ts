/**
 * TEST-ONLY deterministic fixtures (R11).
 *
 * The COMMITTED metainfo test data (tests/fixtures/*.torrent) is generated
 * from these specs: deterministic PRNG content (a seeded xorshift — no
 * crypto randomness, no clock), piece hashes computed over the
 * CONCATENATED file bytes (BitTorrent's actual geometry), and the infohash
 * derived as SHA-1 of the bencoded info dict (the metainfo's own law).
 *
 * Determinism law: regenerating a fixture from its spec reproduces
 * BYTE-IDENTICAL .torrent files (fixed bencode key order — see
 * tests/fixtures/generate.ts and the drift test in fixtures.test.ts).
 * The fixtures' validity is proven by parsing them with the REAL
 * parse-torrent in the suite.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bencode, sha1Hex, type BencodeValue } from "./bencode";

// ---------------------------------------------------------------------------
// Fixture specs
// ---------------------------------------------------------------------------

/** One file in a fixture spec. */
export interface FixtureFileSpec {
  /** Path RELATIVE to the torrent download root (includes the top folder). */
  readonly path: string;
  readonly sizeBytes: number;
}

/** A fixture torrent's complete specification. */
export interface FixtureSpec {
  readonly key: string;
  /** The torrent's name (the top-level folder for multi-file layouts). */
  readonly name: string;
  /** The metainfo layout (single `length` vs `files[]` — the real formats). */
  readonly layout: "single-file" | "multi-file";
  readonly pieceLengthBytes: number;
  readonly files: readonly FixtureFileSpec[];
  readonly trackers: readonly string[];
  readonly isPrivate: boolean;
}

/**
 * The DISK-relative path of one fixture file (the convention BOTH the
 * mature library and the engine use: multi-file torrents live under a
 * folder named after the torrent; single-file torrents are the file).
 */
export function fixtureDiskPath(spec: FixtureSpec, file: FixtureFileSpec): string {
  return spec.layout === "multi-file" ? `${spec.name}/${file.path}` : file.path;
}

/**
 * The primary fixture: a three-file "authorized archive" whose sizes force
 * multi-piece coverage, piece-spanning files, and non-trivial selection
 * geometry (a 5.4-piece file, a sub-piece file, a tiny tail file).
 */
export const AUTHORIZED_ARCHIVE_V1: FixtureSpec = {
  key: "authorized-archive-v1",
  name: "authorized-archive-v1",
  layout: "multi-file",
  pieceLengthBytes: 16384,
  files: [
    { path: "feature-presentation.mkv", sizeBytes: 16384 * 5 + 7000 },
    { path: "coverart.jpg", sizeBytes: 4000 },
    { path: "credits.txt", sizeBytes: 250 },
  ],
  trackers: ["udp://tracker.example.org:1337/announce", "https://tracker.example.org/announce"],
  isPrivate: false,
};

/** A single-file fixture (one file, no folder nesting). */
export const SINGLE_FILE_DOCUMENT: FixtureSpec = {
  key: "single-file-document",
  name: "single-file-document.pdf",
  layout: "single-file",
  pieceLengthBytes: 8192,
  files: [{ path: "single-file-document.pdf", sizeBytes: 8192 * 2 + 1234 }],
  trackers: [],
  isPrivate: false,
};

/** A private-tracker fixture (DHT ineligible — the honest flag path). */
export const PRIVATE_ARCHIVE: FixtureSpec = {
  key: "private-archive",
  name: "private-archive",
  layout: "multi-file",
  pieceLengthBytes: 16384,
  files: [{ path: "main.bin", sizeBytes: 16384 * 3 }],
  trackers: ["https://private.example.org/announce"],
  isPrivate: true,
};

export const ALL_FIXTURES: readonly FixtureSpec[] = [
  AUTHORIZED_ARCHIVE_V1,
  SINGLE_FILE_DOCUMENT,
  PRIVATE_ARCHIVE,
];

// ---------------------------------------------------------------------------
// Deterministic content
// ---------------------------------------------------------------------------

/** A seeded xorshift32 PRNG — deterministic bytes, no crypto, no clock. */
function seededBytes(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 0x9e3779b9;
  for (let i = 0; i < length; i += 4) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    for (let j = 0; j < 4 && i + j < length; j += 1) {
      out[i + j] = (state >>> (j * 8)) & 0xff;
    }
  }
  return out;
}

/** Derive a stable per-file seed from the fixture key + file path. */
function seedFor(key: string, path: string): number {
  const digest = createHash("sha256").update(`${key}:${path}`).digest();
  return digest.readUInt32BE(0);
}

/** The fixture's file contents (deterministic; keyed by DISK-relative path). */
export function fixtureContent(spec: FixtureSpec): Map<string, Uint8Array> {
  const content = new Map<string, Uint8Array>();
  for (const file of spec.files) {
    content.set(
      fixtureDiskPath(spec, file),
      seededBytes(seedFor(spec.key, file.path), file.sizeBytes),
    );
  }
  return content;
}

/** The fixture's CONCATENATED byte stream (the piece-hash domain). */
export function fixtureConcatenated(spec: FixtureSpec): Uint8Array {
  const total = spec.files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const file of spec.files) {
    const bytes = seededBytes(seedFor(spec.key, file.path), file.sizeBytes);
    out.set(bytes, offset);
    offset += file.sizeBytes;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metainfo construction
// ---------------------------------------------------------------------------

/**
 * The info dictionary's VALUE (the object the metainfo carries under
 * `info:` — the piece hashes are SHA-1 over the concatenated file bytes,
 * BitTorrent's actual geometry).
 */
export function fixtureInfoValue(spec: FixtureSpec): Record<string, BencodeValue> {
  const concatenated = fixtureConcatenated(spec);
  const pieces: Uint8Array[] = [];
  for (let offset = 0; offset < concatenated.byteLength; offset += spec.pieceLengthBytes) {
    const end = Math.min(offset + spec.pieceLengthBytes, concatenated.byteLength);
    // RAW 20-byte SHA-1 digests (the metainfo's binary form — hex would
    // double the length and violate the format).
    pieces.push(
      Buffer.from(sha1Hex(concatenated.subarray(offset, end)), "hex"),
    );
  }
  const isSingleFile = spec.layout === "single-file";
  const info: Record<string, BencodeValue> = isSingleFile
    ? {
        length: spec.files[0]!.sizeBytes,
        name: spec.name,
        "piece length": spec.pieceLengthBytes,
        pieces: Buffer.concat(pieces.map((p) => Buffer.from(p))),
      }
    : {
        files: spec.files.map((file) => ({
          length: file.sizeBytes,
          path: file.path.split("/"),
        })),
        name: spec.name,
        "piece length": spec.pieceLengthBytes,
        pieces: Buffer.concat(pieces.map((p) => Buffer.from(p))),
      };
  if (spec.isPrivate) info.private = 1;
  return info;
}

/** The bencoded `info` dictionary of a fixture (the infohash's input). */
export function fixtureInfoDict(spec: FixtureSpec): Uint8Array {
  return bencode(fixtureInfoValue(spec) as BencodeValue);
}

/** The fixture's v1 infohash (SHA-1 of the bencoded info dict). */
export function fixtureInfoHash(spec: FixtureSpec): string {
  return sha1Hex(fixtureInfoDict(spec));
}

/** The fixture's full `.torrent` bytes (deterministic bencode, fixed order). */
export function fixtureTorrentBytes(spec: FixtureSpec): Uint8Array {
  const metainfo: Record<string, BencodeValue> = {
    announce: spec.trackers[0] ?? "",
    ...(spec.trackers.length > 1
      ? { "announce-list": spec.trackers.map((t) => [t]) }
      : {}),
    "created by": "webflix-r11-fixture-generator (test data only)",
    "creation date": 1760000000,
    info: fixtureInfoValue(spec),
  };
  return bencode(metainfo as BencodeValue);
}

/** The fixture's magnet URI (infohash + display name + trackers). */
export function fixtureMagnetUri(spec: FixtureSpec): string {
  const params = [`xt=urn:btih:${fixtureInfoHash(spec)}`, `dn=${encodeURIComponent(spec.name)}`];
  for (const tracker of spec.trackers) {
    params.push(`tr=${encodeURIComponent(tracker)}`);
  }
  return `magnet:?${params.join("&")}`;
}

/** Write the fixture's data files into a directory (the "already landed" state). */
export function writeFixtureDataTo(dir: string, spec: FixtureSpec): void {
  const content = fixtureContent(spec);
  for (const [path, bytes] of content) {
    const target = join(dir, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, bytes);
  }
}
