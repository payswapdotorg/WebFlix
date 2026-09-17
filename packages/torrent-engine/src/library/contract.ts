/**
 * @wfx/torrent-engine — the mature-library seam (invariant 6, FROZEN).
 *
 * THE BOUNDARY LAW (docs/architecture/webflix-remediation-architecture.md,
 * invariant 6): "Torrent protocol internals remain behind the native-media
 * boundary and use a mature protocol implementation; WebFlix does not
 * reimplement BitTorrent in product-core TypeScript."
 *
 * This module defines the seam TYPES the engine speaks to ANY mature
 * BitTorrent implementation. The protocol (wire format, DHT, piece
 * exchange, choking, handshake, bencode parsing) lives ENTIRELY behind
 * implementations of `TorrentLibrary`:
 *
 * - `src/library/webtorrent.ts` — the PRODUCTION binding: webtorrent@3.0.21
 *   (+ its own pinned parser, parse-torrent@11.0.24). See that module for
 *   the evaluation record and the version pins.
 * - `tests/helpers/loopback-library.ts` — the deterministic TEST double
 *   (no network, no peers, scripted progression) used by every test.
 *
 * The seam speaks WEBFLIX shapes only: every type below is defined here, in
 * this package, and no webtorrent/parse-torrent type ever crosses it. The
 * engine's public surface (sessions, selections, verdicts) is a separate
 * vocabulary (metadata.ts/session.ts) — the seam is deliberately NOT part
 * of the public surface so the wrapped library can change without touching
 * product code.
 */

import type { TorrentResult } from "../errors";

// ---------------------------------------------------------------------------
// Metainfo (as answered by the library's parser)
// ---------------------------------------------------------------------------

/** One file inside a torrent, positioned in the torrent's byte stream. */
export interface LibraryFileMeta {
  /** Path RELATIVE to the torrent's download root (may contain '/'). */
  readonly path: string;
  /** The file's base name (last path segment). */
  readonly name: string;
  /** The file's length in bytes. */
  readonly lengthBytes: number;
  /** The file's start offset within the torrent's concatenated byte stream. */
  readonly offsetBytes: number;
}

/** A fully parsed torrent metainfo (.torrent decode result). */
export interface ParsedMetainfo {
  /** The v1 infohash, lowercase hex. */
  readonly infoHash: string;
  /** The torrent's name (top-level folder / single file name). */
  readonly name: string;
  /** Bytes per piece (the `piece length` metainfo field). */
  readonly pieceLengthBytes: number;
  /** Total concatenated content size across all files. */
  readonly totalBytes: number;
  /** Number of pieces (ceil(totalBytes / pieceLengthBytes), min 1). */
  readonly pieceCount: number;
  /** The file list, ordered by offset. */
  readonly files: readonly LibraryFileMeta[];
  /** Announce URLs (the announce + announce-list union, deduped in order). */
  readonly trackers: readonly string[];
  /** Whether the torrent is private (DHT/PEX disallowed by its metainfo). */
  readonly isPrivate: boolean;
}

/** A parsed magnet URI (what the URI itself carries, pre-metadata). */
export interface ParsedMagnet {
  /** The v1 infohash, lowercase hex. */
  readonly infoHash: string;
  /** The `dn` display name, when the URI carried one. */
  readonly displayName?: string;
  /** The `tr` tracker URLs. */
  readonly trackers: readonly string[];
}

// ---------------------------------------------------------------------------
// Sessions (the live library session)
// ---------------------------------------------------------------------------

/** The honest per-poll numbers a library session must answer. */
export interface LibrarySessionSnapshot {
  /** Connected peers RIGHT NOW (0 when none — never fabricated). */
  readonly connectedPeers: number;
  /**
   * The verified-piece bitfield: bit `i` is 1 iff piece `i` is verified
   * against its metainfo hash. One bit per piece, MSB-first within each
   * byte (the BitTorrent bitfield convention), `ceil(pieceCount / 8)` bytes.
   */
  readonly bitfield: Uint8Array;
  /** Bytes of verified content so far (the honest "downloaded"). */
  readonly verifiedBytes: number;
  /** Instantaneous honest rates; 0 when nothing is transferring. */
  readonly downloadBytesPerSec: number;
  readonly uploadBytesPerSec: number;
  /**
   * Wall-clock epoch ms of the last time a peer was connected; `undefined`
   * when no peer was ever seen (the stall clock then starts at session
   * start — the honest interpretation).
   */
  readonly lastPeerActivityAt?: number;
}

/** Spontaneous library events the engine subscribes to. */
export type LibrarySessionEvent =
  /** Metadata resolved (magnet path): the full file list is now known. */
  | { readonly kind: "metadata"; readonly metainfo: ParsedMetainfo }
  /** One piece verified against its metainfo hash (the library's check). */
  | { readonly kind: "piece-verified"; readonly piece: number }
  /** All selected pieces are present and verified. */
  | { readonly kind: "done" }
  /** The library failed (piece hash mismatch, protocol error, ...). */
  | {
    readonly kind: "error";
    readonly message: string;
    /** `true` when the session cannot continue (engine fails the session). */
    readonly fatal: boolean;
  };

/** A live library session handle (no protocol types on the surface). */
export interface LibrarySession {
  /** The session's infohash (lowercase hex). */
  readonly infoHash: string;
  /** Subscribe to events; returns the unsubscribe function. */
  onEvent(handler: (event: LibrarySessionEvent) => void): () => void;
  /** The honest numbers, read live (never cached by the engine). */
  snapshot(): LibrarySessionSnapshot;
  /**
   * Apply a file selection: the session transfers ONLY the pieces covering
   * the given file indexes (the mature library's own file selection). An
   * empty selection transfers nothing.
   */
  selectFiles(fileIndexes: readonly number[]): void;
  /** Pause the session (no transfer; state preserved). */
  pause(): void;
  /** Resume a paused session. */
  resume(): void;
  /** Destroy the library session (leaves any on-disk bytes in place). */
  destroy(): Promise<void>;
}

/** How the engine asks the library for a session. */
export interface LibrarySessionSpec {
  /** Where the bytes live / will land (the library owns this directory). */
  readonly dataDir: string;
  /** The magnet URI (magnet kind). */
  readonly magnetUri?: string;
  /** The parsed metainfo (metainfo kind). */
  readonly metainfo?: ParsedMetainfo;
  /** The ORIGINAL `.torrent` bytes (metainfo kind), when the engine has them. */
  readonly metainfoBytes?: Uint8Array;
  /** The initially selected file indexes (resolved for metainfo kind). */
  readonly selectedFileIndexes: readonly number[];
  /**
   * Re-verify existing on-disk bytes against the metainfo piece hashes
   * before transferring (the resume path — the library's own check).
   */
  readonly verifyExistingData: boolean;
}

// ---------------------------------------------------------------------------
// The library boundary
// ---------------------------------------------------------------------------

/** The mature BitTorrent library boundary the engine wraps. */
export interface TorrentLibrary {
  /**
   * Identifies the implementation (e.g. `"webtorrent@3.0.21"` or
   * `"loopback-double"`); surfaces in engine evidence and journals so the
   * wrapped stack is always inspectable — a fixture is never silently
   * presented as production capability (invariant 10).
   */
  readonly implementation: string;
  /** Parse a magnet URI (offline, deterministic). */
  parseMagnet(uri: string): Promise<TorrentResult<ParsedMagnet>>;
  /** Decode `.torrent` bytes into full metainfo (offline, deterministic). */
  parseTorrentFile(bytes: Uint8Array): Promise<TorrentResult<ParsedMetainfo>>;
  /** Create a live session for the spec (protocol work starts here). */
  createSession(spec: LibrarySessionSpec): Promise<TorrentResult<LibrarySession>>;
  /** Tear the library down (all sessions). */
  destroy(): Promise<void>;
}
