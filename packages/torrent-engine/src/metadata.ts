/**
 * @wfx/torrent-engine — public metadata vocabulary (R11).
 *
 * The WEBFLIX-side torrent metadata types — deliberately a SEPARATE
 * vocabulary from the library seam (`src/library/contract.ts`): the engine
 * MAPS seam results onto these public types, so the wrapped mature library
 * can change without touching product code, and no wire-protocol type ever
 * leaks onto the public surface (the frozen boundary law).
 *
 * The mapping is total and explicit (`metainfoFromLibrary`): every public
 * field is derived from a seam field — nothing is invented, defaulted, or
 * fabricated. The file list (name, length, offset) is answered HERE, at
 * ingestion time for `.torrent` files, before ANY data transfer — the
 * J21-J25 "choose file" step happens on these types.
 */

import type {
  LibraryFileMeta,
  ParsedMetainfo,
  ParsedMagnet,
} from "./library/contract";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One file inside a torrent, as the product sees it. */
export interface TorrentFileEntry {
  /** Path relative to the torrent's download root (may contain '/'). */
  readonly path: string;
  /** The file's base name (last path segment). */
  readonly name: string;
  /** Length in bytes. */
  readonly lengthBytes: number;
  /** Start offset within the torrent's concatenated byte stream. */
  readonly offsetBytes: number;
}

/** Full torrent metadata, as the product sees it. */
export interface TorrentMetainfo {
  /** v1 infohash, lowercase hex. */
  readonly infoHash: string;
  /** The torrent's name. */
  readonly name: string;
  /** Bytes per piece. */
  readonly pieceLengthBytes: number;
  /** Total concatenated content size. */
  readonly totalBytes: number;
  /** Number of pieces. */
  readonly pieceCount: number;
  /** The file list, ordered by offset (the selection basis). */
  readonly files: readonly TorrentFileEntry[];
  /** Announce URLs. */
  readonly trackers: readonly string[];
  /** Whether the torrent's metainfo marks it private. */
  readonly isPrivate: boolean;
  /**
   * Whether DHT discovery is eligible (torrent is not private AND the
   * engine's library supports DHT — for magnets this is how metadata is
   * usually found). Honest: a private torrent answers `false`.
   */
  readonly dhtEligible: boolean;
}

/** Magnet-URI facts, as the product sees them (pre-metadata). */
export interface TorrentMagnetInfo {
  /** v1 infohash, lowercase hex. */
  readonly infoHash: string;
  /** The `dn` display name, when the URI carried one. */
  readonly displayName?: string;
  /** The `tr` tracker URLs. */
  readonly trackers: readonly string[];
}

/** Runtime guard: is this a valid infohash shape (40 lowercase hex)? */
export function isInfoHash(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{40}$/.test(x);
}

// ---------------------------------------------------------------------------
// The total seam -> public mapping
// ---------------------------------------------------------------------------

/** Map a public file entry from a seam file meta. Total, no invention. */
export function fileEntryFromLibrary(file: LibraryFileMeta): TorrentFileEntry {
  return {
    path: file.path,
    name: file.name,
    lengthBytes: file.lengthBytes,
    offsetBytes: file.offsetBytes,
  };
}

/** Map public metainfo from a seam metainfo. Total, no invention. */
export function metainfoFromLibrary(meta: ParsedMetainfo): TorrentMetainfo {
  return {
    infoHash: meta.infoHash,
    name: meta.name,
    pieceLengthBytes: meta.pieceLengthBytes,
    totalBytes: meta.totalBytes,
    pieceCount: meta.pieceCount,
    files: meta.files.map(fileEntryFromLibrary),
    trackers: meta.trackers.slice(),
    isPrivate: meta.isPrivate,
    // Honest: DHT is eligible iff the torrent is not private. (Whether the
    // LIBRARY has DHT enabled is the library binding's own documented
    // configuration — this flag answers the metainfo's permission only.)
    dhtEligible: !meta.isPrivate,
  };
}

/** Map public magnet facts from a seam magnet. Total, no invention. */
export function magnetInfoFromLibrary(magnet: ParsedMagnet): TorrentMagnetInfo {
  return {
    infoHash: magnet.infoHash,
    ...(magnet.displayName !== undefined
      ? { displayName: magnet.displayName }
      : {}),
    trackers: magnet.trackers.slice(),
  };
}

// ---------------------------------------------------------------------------
// Offset re-derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Re-derive file offsets from `(path, length)` entries: a pure fold that
 * assigns each file its cumulative offset in the torrent byte stream.
 * Used by journal replay (a persisted file list is re-trusted only after
 * this re-derivation matches its recorded offsets) and by the seam
 * implementations whose parser does not carry offsets.
 */
export function deriveFileOffsets(
  files: readonly { path: string; name: string; lengthBytes: number }[],
): TorrentFileEntry[] {
  let offset = 0;
  return files.map((file) => {
    const entry: TorrentFileEntry = {
      path: file.path,
      name: file.name,
      lengthBytes: file.lengthBytes,
      offsetBytes: offset,
    };
    offset += file.lengthBytes;
    return entry;
  });
}
