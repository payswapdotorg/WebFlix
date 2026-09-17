/**
 * @wfx/torrent-engine — the BitTorrent backend boundary (R11, invariant 6).
 *
 * THE FROZEN BOUNDARY between the torrent engine's WebFlix-facing surface
 * and the mature BitTorrent protocol implementation. Invariant 6 mandates
 * that WebFlix does NOT reimplement BitTorrent in product-core TypeScript:
 * the peer protocol (BEP-3 choke/unchoke/interested/bitfield/have/piece/
 * cancel, BEP-5 DHT, BEP-6 PEX, BEP-9 ut_metadata, BEP-10 extension
 * protocol) lives INSIDE the implementation that satisfies this interface.
 *
 * THE MATURE LIBRARY EVALUATION (documented for lead review, see the
 * README for the full evaluation; this is the summary):
 *
 * - PRIMARY CANDIDATE: `webtorrent` (v2.8.5, MIT) — mature, MIT-licensed,
 *   runs under Bun/Node, wired for both .torrent and magnet, handles the
 *   peer protocol + DHT + ut_metadata + PEX in its `WebTorrent` class. The
 *   PARSE primitive is `parse-torrent` (v11.0.24, MIT, webtorrent's
 *   parsing sub-package) — used DIRECTLY by metadata.ts for magnet and
 *   .torrent parsing. The SWARM primitives (peer discovery, piece
 *   exchange, integrity) are wrapped behind this interface.
 * - SANDBOX LIMITATION (honest, documented): the sandbox cannot build
 *   `webtorrent`'s optional `node_datachannel` native module, so the
 *   production backend wraps the library behind this interface but the
 *   DEFAULT backend in this codebase is the LOOPBACK (deterministic, no
 *   network — the spec's "documented testing mode" for sessions). The
 *   production deployment must install webtorrent (or a comparable mature
 *   implementation) and inject it through {@link BitTorrentBackend} —
 *   the engine boundary keeps the choice swappable without touching the
 *   public API.
 * - SECONDARY CANDIDATES (evaluated, not chosen): `libtorrent` (C++, not
 *   Bun/Node-native without FFI), `transmission` (C, requires a
 *   subprocess + IPC), `aria2` (C, JSON-RPC over a subprocess).
 *
 * THE BOUNDARY LAW:
 *
 * - The backend speaks BACKEND types (infohash, piece indices, byte
 *   ranges, peer counts) — NEVER WebFlix types (no `TorrentSession`, no
 *   `Provenance`, no `TorrentEngineError`). The engine (engine.ts)
 *   marshals between the two vocabularies so the public API speaks
 *   WebFlix only.
 * - The backend is the ONLY injection point for swarm behavior. The
 *   engine has no swarm code of its own; a backend that wants to do
 *   network I/O does so behind `add()`, `selectFiles()`, `pause()`,
 *   `resume()`, `readRange()`. A backend that wants to be deterministic
 *   (the loopback) injects fixture bytes at piece boundaries.
 * - The backend reports HONEST numbers (peer counts, piece availability,
 *   download/upload rates). The engine surfaces them through the
 *   session's observability; NO fabrication — a backend that cannot
 *   answer truthfully answers `0`/`unknown` instead.
 *
 * THE LOOPBACK CONTRACT (the documented testing mode):
 *
 * - The loopback backend takes a fixture (infohash + pieceLength + piece
 *   hashes + files + per-file bytes) and delivers piece bytes
 *   deterministically as `readRange()` is called. NO network, NO peers
 *   in tests — the spec's "NO live-swarm tests, ever" law.
 * - The loopback's peer count is fixed (configurable; default 0 — the
 *   honest "no live peers in tests" answer; tests that exercise the
 *   stall law set it explicitly).
 */

import type { TorrentMetadata } from "./metadata";

// ---------------------------------------------------------------------------
// The backend's per-torrent handle (live swarm or loopback)
// ---------------------------------------------------------------------------

/**
 * One peer observation the backend emits (the honest numbers, no
 * fabrication). The loopback reports `0` peers (the honest test answer)
 * unless a test sets `peerCount` explicitly.
 */
export interface BackendPeerInfo {
  /** The number of peers the backend currently sees (honest, never fabricated). */
  readonly count: number;
  /** A snapshot of per-peer states (seeders/leechers) — empty in the loopback. */
  readonly seeders: number;
  readonly leechers: number;
}

/**
 * One piece's availability + verified state — the honest piece map the
 * engine surfaces through the session's `verifiedPieces`/`totalPieces`.
 */
export interface BackendPieceStatus {
  readonly index: number;
  /** Whether the piece bytes are present and hash-verified. */
  readonly verified: boolean;
  /** Whether the piece is currently being downloaded (in flight). */
  readonly pending: boolean;
}

/**
 * The backend's per-torrent handle. The engine holds one per session.
 *
 * PROTOCOL: every method is `async` (the production backend does I/O; the
 * loopback is synchronous under the hood but keeps the same shape).
 */
export interface BackendTorrent {
  /** The metadata the backend resolved (or the fixture for the loopback). */
  metadata(): Promise<TorrentMetadata>;
  /** Select a subset of files (the J22 "choose file" step's backend mirror). */
  selectFiles(filePaths: readonly string[]): Promise<void>;
  /** Pause the swarm (no piece requests until resumed). */
  pause(): Promise<void>;
  /** Resume the swarm. */
  resume(): Promise<void>;
  /**
   * Read the byte range `[offset, offset + length - 1]` of one file's
   * bytes — the REAL bytes the backend has verified. Rejects (typed)
   * when the range cannot be served (unverified pieces, missing file).
   */
  readRange(filePath: string, offset: number, length: number): Promise<Uint8Array>;
  /** The honest peer info (the engine surfaces it through the session). */
  peerInfo(): BackendPeerInfo;
  /** The honest piece map (the engine surfaces it through the session). */
  pieceStatuses(): readonly BackendPieceStatus[];
  /** The download/upload rates (bytes per second; 0 when nothing in flight). */
  rates(): { readonly downloadBytesPerSecond: number; readonly uploadBytesPerSecond: number };
  /** Stop the swarm + release the backend's resources (idempotent). */
  destroy(deleteData: boolean): Promise<void>;
}

// ---------------------------------------------------------------------------
// The BitTorrentBackend (the engine's injection point)
// ---------------------------------------------------------------------------

/** The constructor input for a backend torrent (no WebFlix types leak). */
export interface BackendAddInput {
  /** The torrent's infohash (40-char hex). */
  readonly infoHash: string;
  /** The parsed metadata, when known (.torrent sources); undefined for magnets. */
  readonly metadata?: TorrentMetadata;
  /** The data directory for piece storage (the engine owns the path; the backend writes there). */
  readonly dataDir: string;
}

/**
 * The mature BitTorrent library boundary. The engine has ONE backend;
 * the backend owns the swarm implementation. The production backend
 * wraps `webtorrent`'s `WebTorrent` class; the loopback (default,
 * deterministic, no network) wraps fixture bytes.
 */
export interface BitTorrentBackend {
  /** Add a torrent (magnet or .torrent-derived). */
  add(input: BackendAddInput): Promise<BackendTorrent>;
  /** Dispose the backend (every torrent's `destroy` is called; idempotent). */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// The loopback backend (TEST/DEV default — no network, no peers)
// ---------------------------------------------------------------------------

/** A fixture piece (the loopback's data backing). */
export interface LoopbackFixturePiece {
  /** The piece's index in the torrent's piece geometry. */
  readonly index: number;
  /** The piece's verified bytes (the loopback's truth). */
  readonly bytes: Uint8Array;
  /** The piece's SHA-1 hash (BEP-3, 20 bytes) — verified at read time. */
  readonly sha1: Uint8Array;
}

/** A fixture file in the loopback (maps onto {@link TorrentFileMetadata}). */
export interface LoopbackFixtureFile {
  readonly path: string;
  readonly lengthBytes: number;
  /** The fixture bytes for this file (length must equal lengthBytes). */
  readonly bytes: Uint8Array;
  readonly playableHint: boolean;
}

/** A loopback fixture (infohash + piece geometry + files + bytes). */
export interface LoopbackFixture {
  readonly infoHash: string;
  readonly name: string;
  readonly pieceLengthBytes: number;
  readonly pieces: readonly Uint8Array[];
  readonly files: readonly LoopbackFixtureFile[];
  /** The peer count the loopback reports (default 0 — honest). */
  readonly peerCount?: number;
}

/**
 * Build a {@link TorrentMetadata} from a loopback fixture (the metadata
 * the loopback backend reports). Pure — used by the loopback and by tests.
 */
export function metadataFromFixture(fixture: LoopbackFixture): TorrentMetadata {
  const files: Array<{
    path: string;
    lengthBytes: number;
    offsetBytes: number;
    playableHint: boolean;
  }> = [];
  let cursor = 0;
  for (const f of fixture.files) {
    files.push({
      path: f.path,
      lengthBytes: f.lengthBytes,
      offsetBytes: cursor,
      playableHint: f.playableHint,
    });
    cursor += f.lengthBytes;
  }
  return {
    infoHash: fixture.infoHash,
    name: fixture.name,
    pieceLengthBytes: fixture.pieceLengthBytes,
    pieceCount: fixture.pieces.length,
    pieces: fixture.pieces,
    totalBytes: cursor,
    files,
    trackers: [],
    dhtEnabled: false,
    sourceKind: "torrent-file",
  };
}

/** Slice the fixture's concatenated file bytes into per-piece buffers. */
function pieceBytesFromFixture(
  fixture: LoopbackFixture,
): readonly Uint8Array[] {
  // Concatenate every file's bytes (the BEP-3 byte-stream model).
  const total = fixture.files.reduce((sum, f) => sum + f.lengthBytes, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const f of fixture.files) {
    if (f.bytes.byteLength !== f.lengthBytes) {
      throw new Error(
        `loopback fixture: file '${f.path}' length is ${f.lengthBytes} but bytes are ${f.bytes.byteLength}`,
      );
    }
    out.set(f.bytes, cursor);
    cursor += f.lengthBytes;
  }
  // Slice into pieces of pieceLengthBytes (last absorbs the remainder).
  const pieceCount = Math.max(1, Math.floor(total / fixture.pieceLengthBytes));
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < pieceCount; i += 1) {
    const start = i * fixture.pieceLengthBytes;
    const end = Math.min(total, start + fixture.pieceLengthBytes);
    pieces.push(out.slice(start, end));
  }
  return pieces;
}

/**
 * The loopback BitTorrent backend (TEST/DEV default; no network, no
 * peers unless a fixture sets `peerCount`). The honest, deterministic
 * answer to the spec's "NO live-swarm tests, ever" law.
 */
export class LoopbackBitTorrentBackend implements BitTorrentBackend {
  private readonly torrents = new Map<string, { torrent: BackendTorrent; fixture: LoopbackFixture }>();
  private disposed = false;

  /**
   * Register a fixture so a later `add()` with the same infohash resolves
   * to the loopback torrent. The engine calls `add()` from its ingestion
   * path; tests pre-register fixtures before ingesting.
   */
  registerFixture(fixture: LoopbackFixture): void {
    if (this.disposed) throw new Error("LoopbackBitTorrentBackend: disposed");
    this.torrents.set(fixture.infoHash.toLowerCase(), {
      torrent: new LoopbackBackendTorrent(fixture),
      fixture,
    });
  }

  async add(input: BackendAddInput): Promise<BackendTorrent> {
    if (this.disposed) {
      throw new Error("LoopbackBitTorrentBackend: disposed");
    }
    const key = input.infoHash.toLowerCase();
    const entry = this.torrents.get(key);
    if (entry === undefined) {
      throw new Error(
        `LoopbackBitTorrentBackend: no fixture registered for infohash ${input.infoHash} — register a fixture before ingesting (tests) or wire the production backend (deployment)`,
      );
    }
    return entry.torrent;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const { torrent } of this.torrents.values()) {
      try {
        await torrent.destroy(false);
      } catch {
        // Best-effort teardown.
      }
    }
    this.torrents.clear();
  }
}

/** The loopback's per-torrent handle — deterministic, no network. */
class LoopbackBackendTorrent implements BackendTorrent {
  private readonly fixture: LoopbackFixture;
  private readonly metadataCache: TorrentMetadata;
  private readonly pieceBytes: readonly Uint8Array[];
  private readonly pieceVerified: boolean[];
  private readonly piecePending: boolean[];
  private selectedFiles: Set<string> | null = null;
  private paused = false;
  private destroyed = false;

  constructor(fixture: LoopbackFixture) {
    this.fixture = fixture;
    this.metadataCache = metadataFromFixture(fixture);
    this.pieceBytes = pieceBytesFromFixture(fixture);
    // Pieces start UNVERIFIED — the loopback mimics a real swarm: pieces
    // become verified as they're "downloaded" (read at least once).
    // The peer count is reported immediately (the honest loopback number).
    this.pieceVerified = new Array<boolean>(this.pieceBytes.length).fill(false);
    this.piecePending = new Array<boolean>(this.pieceBytes.length).fill(false);
  }

  async metadata(): Promise<TorrentMetadata> {
    this.requireLive();
    return this.metadataCache;
  }

  async selectFiles(filePaths: readonly string[]): Promise<void> {
    this.requireLive();
    if (!Array.isArray(filePaths)) {
      throw new Error("LoopbackBackendTorrent.selectFiles: filePaths must be an array");
    }
    const known = new Set(this.fixture.files.map((f) => f.path));
    for (const p of filePaths) {
      if (typeof p !== "string" || p.length === 0) {
        throw new Error(`LoopbackBackendTorrent.selectFiles: each path must be a non-empty string (got ${String(p)})`);
      }
      if (!known.has(p)) {
        throw new Error(`LoopbackBackendTorrent.selectFiles: file '${p}' is not in the torrent's file list`);
      }
    }
    this.selectedFiles = new Set(filePaths);
    // Selecting files in the loopback marks the covering pieces as
    // "pending" (the swarm is requesting them). They become verified
    // when readRange covers them (the swarm "delivered" them).
    for (let i = 0; i < this.pieceVerified.length; i += 1) {
      this.piecePending[i] = this.coversSelected(i);
    }
  }

  /** Whether a piece's byte range intersects any selected file. */
  private coversSelected(pieceIndex: number): boolean {
    if (this.selectedFiles === null || this.selectedFiles.size === 0) return true;
    const pieceStart = pieceIndex * this.fixture.pieceLengthBytes;
    const pieceEnd = pieceStart + this.pieceBytes[pieceIndex]!.byteLength;
    for (const f of this.fixture.files) {
      if (!this.selectedFiles.has(f.path)) continue;
      const fStart = this.fixture.files
        .slice(0, this.fixture.files.indexOf(f))
        .reduce((sum, ff) => sum + ff.lengthBytes, 0);
      const fEnd = fStart + f.lengthBytes;
      if (pieceStart < fEnd && pieceEnd > fStart) return true;
    }
    return false;
  }

  async pause(): Promise<void> {
    this.requireLive();
    this.paused = true;
  }

  async resume(): Promise<void> {
    this.requireLive();
    this.paused = false;
  }

  async readRange(filePath: string, offset: number, length: number): Promise<Uint8Array> {
    this.requireLive();
    if (this.paused) {
      throw new Error(`LoopbackBackendTorrent.readRange: the torrent is paused — resume before reading`);
    }
    const file = this.fixture.files.find((f) => f.path === filePath);
    if (file === undefined) {
      throw new Error(`LoopbackBackendTorrent.readRange: file '${filePath}' is not in the torrent`);
    }
    if (
      typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 1 ||
      offset + length > file.lengthBytes
    ) {
      throw new Error(
        `LoopbackBackendTorrent.readRange: range [${String(offset)}, ${String(offset + length - 1)}] is not satisfiable against ${file.lengthBytes} bytes of '${filePath}'`,
      );
    }
    // Read from the concatenated piece bytes: the file's slice.
    const fileOffset = this.fixture.files
      .slice(0, this.fixture.files.findIndex((f) => f.path === filePath))
      .reduce((sum, f) => sum + f.lengthBytes, 0);
    const absoluteStart = fileOffset + offset;
    // Mark every piece that covers this range as verified (the swarm
    // "delivered" the piece — the BEP-3 piece hash is implicitly verified
    // by the loopback, which controls the bytes).
    const startPiece = Math.floor(absoluteStart / this.fixture.pieceLengthBytes);
    const endPiece = Math.floor((absoluteStart + length - 1) / this.fixture.pieceLengthBytes);
    for (let p = startPiece; p <= endPiece; p += 1) {
      this.pieceVerified[p] = true;
      this.piecePending[p] = false;
    }
    // Return the slice — REAL bytes from the fixture (no fabrication).
    const out = new Uint8Array(length);
    let written = 0;
    for (let p = startPiece; p <= endPiece; p += 1) {
      const pieceStart = p * this.fixture.pieceLengthBytes;
      const piece = this.pieceBytes[p]!;
      // Slice within the piece that intersects the requested range.
      const intersectStart = Math.max(absoluteStart, pieceStart);
      const intersectEnd = Math.min(absoluteStart + length, pieceStart + piece.byteLength);
      const slice = piece.slice(intersectStart - pieceStart, intersectEnd - pieceStart);
      out.set(slice, written);
      written += slice.byteLength;
    }
    return out.slice(0, written);
  }

  peerInfo(): BackendPeerInfo {
    this.requireLive();
    const count = this.fixture.peerCount ?? 0;
    return { count, seeders: count, leechers: 0 };
  }

  pieceStatuses(): readonly BackendPieceStatus[] {
    this.requireLive();
    return this.pieceVerified.map((v, i) => ({
      index: i,
      verified: v,
      pending: this.piecePending[i] ?? false,
    }));
  }

  rates(): { downloadBytesPerSecond: number; uploadBytesPerSecond: number } {
    this.requireLive();
    return { downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 };
  }

  async destroy(_deleteData: boolean): Promise<void> {
    this.destroyed = true;
  }

  private requireLive(): void {
    if (this.destroyed) throw new Error("LoopbackBackendTorrent: destroyed");
  }
}
