/**
 * @wfx/torrent-engine — metadata (R11, mature-library boundary).
 *
 * The parsing surface for magnet URIs and `.torrent` metainfo files. The
 * BitTorrent protocol lives INSIDE the wrapper (invariant 6: WebFlix does
 * NOT reimplement BitTorrent in product-core TypeScript): the parsing
 * primitives come from the MATURE library `parse-torrent` (MIT, the
 * parsing sub-package of `webtorrent` — the primary candidate evaluated
 * for the engine; see the README for the evaluation + version pin). This
 * module wraps the library's outputs behind WebFlix types — no
 * wire-protocol types leak into the package's public surface.
 *
 * WHAT THIS MODULE OWNS:
 *
 * 1. PARSE MAGNETS. `parseMagnetUri(uri)` → {@link TorrentMetadata}
 *    (infohash, name, trackers, DHT flag, length-unknown). Magnet URIs
 *    carry no piece hashes — the swarm must acquire metadata via the
 *    protocol (BEP-9 ut_metadata); the engine's loopback backend
 *    short-circuits that with a deterministic fixture metadata for tests,
 *    and the production backend wraps webtorrent's swarm for the live
 *    metadata exchange.
 * 2. PARSE .TORRENT FILES. `parseTorrentFile(bytes)` →
 *    {@link TorrentMetadata} + {@link TorrentFileMetadata}[] (the file
 *    list for SELECTION before any data transfer — the J21–J25 "choose
 *    file" step).
 * 3. PARSE FAILURE IS TYPED. A malformed magnet/torrent is a typed
 *    `METADATA_FAILED` error (never a fabricated metadata object).
 * 4. RUNTIME GUARDS. Every output is validated by a runtime guard before
 *    it leaves this module — wire/library data is never trusted.
 *
 * INTEGRITY GEOMETRY: the `pieces` field on {@link TorrentMetadata}
 * exposes the RAW piece hashes (as concatenated SHA-1 buffers per BEP-3,
 * the BitTorrent spec) for the engine's piece-hash verification. The
 * final whole-asset digest (SHA-256, compatible with the native-media
 * asset store's content hashing) is computed by the engine at completion
 * (engine.ts), over the real selected-file bytes — never over the
 * library's claims. The two are NOT the same: piece hashes verify the
 * SWARM's integrity; the asset-store digest verifies WebFlix's local
 * landing.
 */

import parseTorrent from "parse-torrent";

import { invalidInput, TorrentEngineError } from "./errors";

// ---------------------------------------------------------------------------
// Public metadata shapes (WebFlix types — no library types leak)
// ---------------------------------------------------------------------------

/** One file in a torrent's metadata (the J21–J25 "choose file" entry). */
export interface TorrentFileMetadata {
  /** The file's path (relative to the torrent root; multi-segment for nested dirs). */
  readonly path: string;
  /** The file's length in bytes. */
  readonly lengthBytes: number;
  /** The file's byte offset within the torrent's overall byte stream. */
  readonly offsetBytes: number;
  /**
   * A heuristic hint that the file is a playable media container (mp4,
   * mkv, webm, mp3, …). The engine never sniffs container contents; the
   * hint drives the default file selection (the J22 "choose playable
   * file" step's default candidate).
   */
  readonly playableHint: boolean;
}

/**
 * The metadata of a torrent — the parsed view of a magnet URI or a
 * `.torrent` file. Magnet URIs carry no piece hashes (the swarm acquires
 * metadata via BEP-9); `.torrent` files carry the full info dictionary
 * (piece hashes + file list). The `pieces`/`files` fields are `[]` for
 * magnet sources (the engine acquires them through the swarm — the
 * production backend wraps webtorrent's `torrent.files`/`torrent.pieces`).
 */
export interface TorrentMetadata {
  /** The 40-char hex SHA-1 infohash (BEP-3). */
  readonly infoHash: string;
  /** The display name (magnet `dn` or .torrent `info.name`). */
  readonly name: string;
  /** The declared piece length in bytes (0 for magnet sources). */
  readonly pieceLengthBytes: number;
  /** The number of pieces (0 for magnet sources until metadata arrives). */
  readonly pieceCount: number;
  /**
   * The concatenated SHA-1 piece hashes (BEP-3, 20 bytes per piece) —
   * empty for magnet sources until the swarm acquires metadata.
   */
  readonly pieces: readonly Uint8Array[];
  /** The total torrent length (sum of files; 0 for magnet sources). */
  readonly totalBytes: number;
  /** The file list (empty for magnet sources until metadata arrives). */
  readonly files: readonly TorrentFileMetadata[];
  /** The trackers the swarm would announce to (the magnet `tr` or .torrent `announce-list`). */
  readonly trackers: readonly string[];
  /** Whether DHT is enabled (magnet `dht` flag or .torrent info private absence). */
  readonly dhtEnabled: boolean;
  /** Whether this metadata came from a magnet (no piece hashes) or a .torrent file (full). */
  readonly sourceKind: "magnet" | "torrent-file";
}

// ---------------------------------------------------------------------------
// Runtime guards (library data is never trusted)
// ---------------------------------------------------------------------------

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isNonNegativeSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

function isStringArray(x: unknown): x is readonly string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

/** Runtime guard for {@link TorrentFileMetadata}. */
export function isTorrentFileMetadata(x: unknown): x is TorrentFileMetadata {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return (
    isNonEmptyString(f.path) &&
    isNonNegativeSafeInteger(f.lengthBytes) &&
    isNonNegativeSafeInteger(f.offsetBytes) &&
    typeof f.playableHint === "boolean"
  );
}

/** Runtime guard for {@link TorrentMetadata}. */
export function isTorrentMetadata(x: unknown): x is TorrentMetadata {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (
    !isNonEmptyString(m.infoHash) ||
    !isNonEmptyString(m.name) ||
    !isNonNegativeSafeInteger(m.pieceLengthBytes) ||
    !isNonNegativeSafeInteger(m.pieceCount) ||
    !isNonNegativeSafeInteger(m.totalBytes) ||
    typeof m.dhtEnabled !== "boolean" ||
    (m.sourceKind !== "magnet" && m.sourceKind !== "torrent-file")
  ) {
    return false;
  }
  if (!Array.isArray(m.pieces)) return false;
  for (const p of m.pieces) {
    if (!(p instanceof Uint8Array)) return false;
  }
  if (!Array.isArray(m.files)) return false;
  for (const f of m.files) {
    if (!isTorrentFileMetadata(f)) return false;
  }
  if (!isStringArray(m.trackers)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Parsing primitives (wrapped behind mature library calls)
// ---------------------------------------------------------------------------

/** The known playable-media extensions (the playable hint vocabulary). */
const PLAYABLE_EXTENSIONS = [
  ".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v",
  ".mp3", ".aac", ".flac", ".ogg", ".wav", ".m4a",
  ".ts", ".m3u8",
] as const;

function isPlayable(path: string): boolean {
  const lower = path.toLowerCase();
  for (const ext of PLAYABLE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/** Format a library error as a typed `METADATA_FAILED`. */
function metadataFailed(kind: string, cause: unknown): TorrentEngineError {
  const detail = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : String(cause);
  return new TorrentEngineError("METADATA_FAILED", {
    detail: `parse-${kind}: the mature library rejected the input (${detail})`,
    cause,
  });
}

/**
 * Parse a magnet URI into {@link TorrentMetadata}. Magnet sources carry
 * the infohash but NOT the piece hashes or file list — those fields are
 * `[]`/`0` until the swarm acquires the metadata (BEP-9 ut_metadata).
 *
 * Throws a typed `INVALID_INPUT` for a non-string/empty URI; a typed
 * `METADATA_FAILED` if the library rejects the URI.
 */
export async function parseMagnetUri(uri: string): Promise<TorrentMetadata> {
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw invalidInput("parseMagnetUri: uri must be a non-empty string");
  }
  let parsed: ReturnType<typeof parseTorrent> extends Promise<infer T> ? T : never;
  try {
    parsed = (await parseTorrent(uri)) as typeof parsed;
  } catch (e) {
    throw metadataFailed("magnet", e);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new TorrentEngineError("METADATA_FAILED", {
      detail: "parseMagnetUri: the mature library returned no metadata",
    });
  }
  const infoHash = parsed.infoHash;
  if (typeof infoHash !== "string" || infoHash.length === 0) {
    throw new TorrentEngineError("METADATA_FAILED", {
      detail: "parseMagnetUri: the mature library returned no infoHash",
    });
  }
  const name = typeof parsed.name === "string" && parsed.name.length > 0
    ? parsed.name
    : `<magnet:${infoHash.slice(0, 12)}…>`;
  const trackers = Array.isArray(parsed.announce)
    ? parsed.announce.filter((t): t is string => typeof t === "string")
    : [];
  const dhtEnabled = parsed.urlList === undefined || !Array.isArray(parsed.urlList);
  return {
    infoHash,
    name,
    pieceLengthBytes: 0,
    pieceCount: 0,
    pieces: [],
    totalBytes: 0,
    files: [],
    trackers,
    dhtEnabled,
    sourceKind: "magnet",
  };
}

/**
 * Parse a `.torrent` file's bytes into {@link TorrentMetadata} + the
 * file list for SELECTION. Throws a typed `INVALID_INPUT` if `bytes` is
 * not a Uint8Array/ArrayBuffer or is empty; a typed `METADATA_FAILED` if
 * the library rejects the bytes; a typed `UNSUPPORTED_SOURCE` if the
 * parsed metadata has no `info` dictionary (the v1 .torrent contract
 * requires one) or no piece hashes.
 */
export async function parseTorrentFile(
  bytes: Uint8Array | ArrayBuffer,
): Promise<TorrentMetadata> {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    throw invalidInput("parseTorrentFile: bytes must be a Uint8Array or ArrayBuffer");
  }
  if ((bytes instanceof Uint8Array && bytes.byteLength === 0) ||
      (bytes instanceof ArrayBuffer && bytes.byteLength === 0)) {
    throw invalidInput("parseTorrentFile: bytes must not be empty");
  }
  let parsed: ReturnType<typeof parseTorrent> extends Promise<infer T> ? T : never;
  try {
    // parse-torrent accepts a Buffer or Uint8Array; we normalize.
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    parsed = (await parseTorrent(Buffer.from(input))) as typeof parsed;
  } catch (e) {
    throw metadataFailed("torrent-file", e);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new TorrentEngineError("METADATA_FAILED", {
      detail: "parseTorrentFile: the mature library returned no metadata",
    });
  }
  const infoHash = parsed.infoHash;
  if (typeof infoHash !== "string" || infoHash.length === 0) {
    throw new TorrentEngineError("METADATA_FAILED", {
      detail: "parseTorrentFile: the mature library returned no infoHash",
    });
  }
  const pieceLength = typeof parsed.pieceLength === "number" ? parsed.pieceLength : 0;
  if (pieceLength <= 0) {
    throw new TorrentEngineError("UNSUPPORTED_SOURCE", {
      detail: `parseTorrentFile: the .torrent has no pieceLength (got ${String(parsed.pieceLength)}) — v1 .torrent sources require an info.dictionary with piece length`,
    });
  }
  // The mature library returns `pieces` in one of three shapes:
  //   - A concatenated Buffer/Uint8Array of 20-byte SHA-1 hashes
  //     (older versions of parse-torrent).
  //   - An Array of 40-char hex SHA-1 strings (newer versions).
  //   - An Array of 20-byte Buffers.
  // All three are normalized here into the BEP-3 piece-hashes view.
  const pieceHashes: Uint8Array[] = [];
  const rawPieces = parsed.pieces;
  if (rawPieces instanceof Uint8Array || Buffer.isBuffer(rawPieces)) {
    const buf = rawPieces instanceof Uint8Array ? rawPieces : new Uint8Array(rawPieces);
    if (buf.byteLength % 20 !== 0) {
      throw new TorrentEngineError("UNSUPPORTED_SOURCE", {
        detail: `parseTorrentFile: the .torrent's pieces buffer is ${buf.byteLength} bytes (not a multiple of 20) — malformed BEP-3 info.pieces`,
      });
    }
    const count = Math.floor(buf.byteLength / 20);
    for (let i = 0; i < count; i += 1) {
      pieceHashes.push(buf.slice(i * 20, (i + 1) * 20));
    }
  } else if (Array.isArray(rawPieces)) {
    for (const entry of rawPieces) {
      if (typeof entry === "string") {
        // 40-char hex SHA-1 string.
        if (entry.length !== 40 || !/^[0-9a-fA-F]{40}$/.test(entry)) {
          throw new TorrentEngineError("UNSUPPORTED_SOURCE", {
            detail: `parseTorrentFile: the .torrent's piece hash '${entry.slice(0, 16)}…' is not a 40-char hex SHA-1`,
          });
        }
        pieceHashes.push(new Uint8Array(Buffer.from(entry, "hex")));
      } else if (entry instanceof Uint8Array || Buffer.isBuffer(entry)) {
        const buf = entry instanceof Uint8Array ? entry : new Uint8Array(entry);
        if (buf.byteLength !== 20) {
          throw new TorrentEngineError("UNSUPPORTED_SOURCE", {
            detail: `parseTorrentFile: the .torrent's piece hash is ${buf.byteLength} bytes (expected 20) — malformed BEP-3 piece hash`,
          });
        }
        pieceHashes.push(buf);
      } else {
        throw new TorrentEngineError("UNSUPPORTED_SOURCE", {
          detail: `parseTorrentFile: the .torrent's piece hash is an unsupported shape (${typeof entry}) — malformed BEP-3 piece hash`,
        });
      }
    }
  } else {
    throw new TorrentEngineError("UNSUPPORTED_SOURCE", {
      detail: "parseTorrentFile: the .torrent has no pieces buffer — v1 .torrent sources require an info.dictionary with pieces",
    });
  }
  const pieceCount = pieceHashes.length;
  const name = typeof parsed.name === "string" && parsed.name.length > 0
    ? parsed.name
    : `<torrent:${infoHash.slice(0, 12)}…>`;
  const trackers = Array.isArray(parsed.announce)
    ? parsed.announce.filter((t): t is string => typeof t === "string")
    : [];
  const files: TorrentFileMetadata[] = [];
  const rawFiles = Array.isArray(parsed.files) ? parsed.files : [];
  let cursor = 0;
  for (const f of rawFiles) {
    if (f === null || typeof f !== "object") continue;
    const fObj = f as unknown as Record<string, unknown>;
    const length = fObj.length;
    const path = fObj.path;
    const pathStr = typeof path === "string"
      ? path
      : Array.isArray(path) && path.every((s) => typeof s === "string")
        ? path.join("/")
        : "";
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) continue;
    if (pathStr.length === 0) continue;
    files.push({
      path: pathStr,
      lengthBytes: length,
      offsetBytes: cursor,
      playableHint: isPlayable(pathStr),
    });
    cursor += length;
  }
  return {
    infoHash,
    name,
    pieceLengthBytes: pieceLength,
    pieceCount,
    pieces: pieceHashes,
    totalBytes: cursor,
    files,
    trackers,
    dhtEnabled: parsed.private !== true,
    sourceKind: "torrent-file",
  };
}

// ---------------------------------------------------------------------------
// Magnet URI construction (test + adapter helper)
// ---------------------------------------------------------------------------

/**
 * Construct a magnet URI from an infohash + name + trackers. The honest
 * format: `magnet:?xt=urn:btih:<infoHash>&dn=<name>&tr=<tracker>…`.
 * Throws `INVALID_INPUT` on bad input. Used by tests to construct fixture
 * magnets and by the adapter to round-trip a metadata view into a magnet
 * for the loopback backend.
 */
export function buildMagnetUri(input: {
  infoHash: string;
  name?: string;
  trackers?: readonly string[];
}): string {
  if (typeof input !== "object" || input === null) {
    throw invalidInput("buildMagnetUri: input must be an object");
  }
  const { infoHash, name, trackers } = input;
  if (typeof infoHash !== "string" || !/^[0-9a-fA-F]{40}$/.test(infoHash)) {
    throw invalidInput(`buildMagnetUri: infoHash must be a 40-char hex SHA-1 (got ${String(infoHash)})`);
  }
  const parts = [`magnet:?xt=urn:btih:${infoHash.toLowerCase()}`];
  if (name !== undefined) {
    if (typeof name !== "string" || name.length === 0) {
      throw invalidInput("buildMagnetUri: name must be a non-empty string when present");
    }
    parts.push(`dn=${encodeURIComponent(name)}`);
  }
  if (trackers !== undefined) {
    if (!Array.isArray(trackers)) {
      throw invalidInput("buildMagnetUri: trackers must be an array when present");
    }
    for (const t of trackers) {
      if (typeof t !== "string" || t.length === 0) {
        throw invalidInput("buildMagnetUri: each tracker must be a non-empty string");
      }
      parts.push(`tr=${encodeURIComponent(t)}`);
    }
  }
  return parts.join("&");
}
