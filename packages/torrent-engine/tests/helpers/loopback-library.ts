/**
 * TEST-ONLY deterministic loopback double of the mature-library seam (R11).
 *
 * THE NO-SWARM LAW (the dispatch's testing contract): "a LOOPBACK double
 * of the mature library (or its documented testing mode) driving
 * start/pause/resume/stop + piece-state observability — NO live peers in
 * tests, ever." This is that double: no network, no peers, no timers —
 * progression happens ONLY when the test calls `advance()`, so every test
 * is deterministic.
 *
 * What is REAL here (not faked):
 * - PARSING goes through the REAL parse-torrent (webtorrent's own pinned
 *   parser) — the same offline, deterministic code the production binding
 *   uses.
 * - BYTES are real: pieces are written to real files on disk as they
 *   "arrive", and each piece is VERIFIED by SHA-1 against the fixture's
 *   metainfo-derived hashes before it counts (a scripted corruption fails
 *   honestly).
 * - verify-existing-data re-verifies the bytes ACTUALLY ON DISK against the
 *   expected piece hashes (the resume path's honest behavior).
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

import {
  torrentError,
  type LibraryPiecePriority,
  type LibrarySession,
  type LibrarySessionEvent,
  type LibrarySessionSnapshot,
  type LibrarySessionSpec,
  type ParsedMetainfo,
  type TorrentLibrary,
  type TorrentResult,
} from "@wfx/torrent-engine";
import {
  fixtureConcatenated,
  fixtureContent,
  fixtureDiskPath,
  fixtureInfoHash,
  type FixtureSpec,
} from "./fixtures";

// ---------------------------------------------------------------------------
// The script (how tests shape behavior deterministically)
// ---------------------------------------------------------------------------

/** How a scripted loopback session behaves. */
export interface LoopbackScript {
  /** Magnet metadata resolves after this many advances (default 1). */
  readonly metadataResolveAdvances?: number;
  /** Pieces verified per advance while downloading (default 2). */
  readonly piecesPerAdvance?: number;
  /** Honest connected-peer count per advance index (default () => 3). */
  readonly peersAt?: (advanceIndex: number) => number;
  /** Corrupt this file's bytes as they "arrive" (piece hash mismatch path). */
  readonly corruptFilePath?: string;
  /** Rate basis for honest speed computation (default 1000 ms per advance). */
  readonly advanceIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// The library double
// ---------------------------------------------------------------------------

export class LoopbackTorrentLibrary implements TorrentLibrary {
  readonly implementation = "loopback-double";

  private readonly fixturesByInfoHash = new Map<string, FixtureSpec>();
  private readonly live: LoopbackSession[] = [];

  /** Register a fixture so magnet/metainfo sessions can resolve it. */
  registerFixture(spec: FixtureSpec): void {
    this.fixturesByInfoHash.set(fixtureInfoHash(spec), spec);
  }

  /**
   * THE DETERMINISTIC DRIVE: advance every live session by one tick.
   * Tests call this (no timers, no network — the suite stays deterministic).
   */
  advanceAll(): void {
    for (const session of this.live) session.advance();
  }

  /** The live sessions (for targeted advances + assertions). */
  liveSessionCount(): number {
    return this.live.length;
  }

  /** The live loopback sessions (test assertions: priorities, snapshots). */
  liveSessions(): readonly LoopbackSession[] {
    return this.live.slice();
  }

  async parseMagnet(uri: string): Promise<TorrentResult<{ infoHash: string; displayName?: string; trackers: readonly string[] }>> {
    // REAL parser (webtorrent's own, offline-deterministic).
    const parsed = await realParse(uri);
    if (!parsed.ok) return parsed;
    return parsed;
  }

  async parseTorrentFile(bytes: Uint8Array): Promise<TorrentResult<ParsedMetainfo>> {
    // REAL parser (webtorrent's own, offline-deterministic).
    return realParseTorrentFile(bytes);
  }

  async createSession(spec: LibrarySessionSpec): Promise<TorrentResult<LibrarySession>> {
    if (spec.magnetUri !== undefined) {
      const parsed = await realParse(spec.magnetUri);
      if (!parsed.ok) return parsed;
      const fixture = this.fixturesByInfoHash.get(parsed.value.infoHash);
      if (fixture === undefined) {
        return torrentError("LIBRARY_ERROR", {
          detail:
            `loopback: no fixture is registered for infohash ${parsed.value.infoHash} — ` +
            "the double has no metadata source (an honest refusal, never invented data)",
        });
      }
      const session = new LoopbackSession(fixture, spec, { magnetKind: true });
      this.live.push(session);
      return { ok: true, value: session };
    }
    if (spec.metainfo !== undefined) {
      const fixture = this.fixturesByInfoHash.get(spec.metainfo.infoHash);
      if (fixture === undefined) {
        return torrentError("LIBRARY_ERROR", {
          detail:
            `loopback: no fixture is registered for infohash ${spec.metainfo.infoHash} — ` +
            "the double has no bytes source (an honest refusal, never invented data)",
        });
      }
      const session = new LoopbackSession(fixture, spec, { magnetKind: false });
      this.live.push(session);
      return { ok: true, value: session };
    }
    return torrentError("INVALID_INPUT", {
      detail: "loopback: the spec carries neither a magnet URI nor metainfo",
    });
  }

  async destroy(): Promise<void> {
    this.live.length = 0;
  }
}

// ---------------------------------------------------------------------------
// The session double
// ---------------------------------------------------------------------------

/** The deterministic session double (exported for direct test assertions). */
export class LoopbackSession implements LibrarySession {
  readonly infoHash: string;

  private readonly spec: FixtureSpec;
  private readonly sessionSpec: LibrarySessionSpec;
  private readonly magnetKind: boolean;
  private readonly pieceLength: number;
  private readonly totalBytes: number;
  private readonly pieceCount: number;
  private readonly pieceHashes: string[] = [];
  private readonly concatenated: Uint8Array;
  private readonly content: Map<string, Uint8Array>;
  private readonly dataDir: string;

  private readonly handlers = new Set<(event: LibrarySessionEvent) => void>();
  private pendingEvents: LibrarySessionEvent[] = [];
  private bitfield: Uint8Array;
  private selectedIndexes = new Set<number>([]);
  /** R12: the engine's piece-priority hints (inspectable via appliedPriorities). */
  private priorityHints: readonly LibraryPiecePriority[] = [];
  private paused = false;
  private destroyed = false;
  private metadataEmitted = false;
  private doneEmitted = false;
  private advanceIndex = 0;
  private lastPeerActivityAt: number | undefined;
  private verifiedBytes = 0;
  private lastAdvanceAt: number | undefined;
  /**
   * Bytes verified during the MOST RECENT advance (the honest
   * instantaneous rate of a scripted double: the last tick's throughput
   * over the scripted interval). Bookkept BEFORE the landing loop so a
   * snapshot right after an advance reports the advance's own throughput,
   * not an always-zero delta.
   */
  private lastAdvanceDeltaBytes = 0;

  constructor(spec: FixtureSpec, sessionSpec: LibrarySessionSpec, flags: { magnetKind: boolean }) {
    this.spec = spec;
    this.sessionSpec = sessionSpec;
    this.magnetKind = flags.magnetKind;
    this.pieceLength = spec.pieceLengthBytes;
    this.totalBytes = spec.files.reduce((sum, f) => sum + f.sizeBytes, 0);
    this.pieceCount = Math.max(1, Math.ceil(this.totalBytes / this.pieceLength));
    this.bitfield = new Uint8Array(Math.ceil(this.pieceCount / 8));
    this.dataDir = sessionSpec.dataDir;
    this.concatenated = fixtureConcatenated(spec);
    this.content = fixtureContent(spec);
    this.infoHash = fixtureInfoHash(spec);
    for (let i = 0; i < this.pieceCount; i += 1) {
      const start = i * this.pieceLength;
      const end = Math.min(start + this.pieceLength, this.totalBytes);
      this.pieceHashes.push(
        Bun.CryptoHasher.hash("sha1", this.concatenated.subarray(start, end), "hex"),
      );
    }
    this.selectedIndexes = new Set(sessionSpec.selectedFileIndexes);

    if (!this.magnetKind) {
      // Metainfo kind: the file list is known immediately. The event is
      // QUEUED so whichever subscriber arrives first receives it.
      this.pendingEvents.push({
        kind: "metadata",
        metainfo: this.seamMetainfo(),
      });
    }
    if (sessionSpec.verifyExistingData) {
      this.verifyExistingDiskData();
    }
  }

  // --- the seam surface --------------------------------------------------------

  onEvent(handler: (event: LibrarySessionEvent) => void): () => void {
    this.handlers.add(handler);
    // Deliver queued events to the new subscriber (deterministic order).
    const queue = this.pendingEvents;
    this.pendingEvents = [];
    for (const event of queue) handler(event);
    return () => this.handlers.delete(handler);
  }

  snapshot(): LibrarySessionSnapshot {
    const peers = this.paused || this.destroyed ? 0 : livePeersAt(this.sessionSpec, this.advanceIndex);
    if (peers > 0) this.lastPeerActivityAt = Date.now();
    const advanceIntervalMs = sessionScript(this.sessionSpec).advanceIntervalMs ?? 1000;
    const rate =
      this.lastAdvanceAt !== undefined && !this.paused && !this.destroyed
        ? (this.lastAdvanceDeltaBytes * 1000) / advanceIntervalMs
        : 0;
    return {
      connectedPeers: peers,
      bitfield: this.bitfield.slice(),
      verifiedBytes: this.verifiedBytes,
      downloadBytesPerSec: rate,
      uploadBytesPerSec: 0, // the loopback never uploads — honest zero
      ...(this.lastPeerActivityAt !== undefined ? { lastPeerActivityAt: this.lastPeerActivityAt } : {}),
    };
  }

  selectFiles(fileIndexes: readonly number[]): void {
    this.selectedIndexes = new Set(fileIndexes);
    this.checkDone();
  }

  prioritizePieces(priorities: readonly LibraryPiecePriority[]): void {
    // Mirrors the production binding's semantics: the hints layer ON TOP
    // of the file selection (the selection stays the completion fallback).
    this.priorityHints = priorities.slice();
  }

  /** The currently applied piece-priority hints (TEST ASSERTIONS). */
  appliedPriorities(): readonly LibraryPiecePriority[] {
    return this.priorityHints.slice();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.handlers.clear();
    this.pendingEvents = [];
  }

  /** Whether this session is still live (test assertions). */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // --- the deterministic drive (tests call this) -------------------------------

  /**
   * Advance the simulated transfer by one tick: maybe resolve metadata,
   * then verify up to `piecesPerAdvance` pieces in PRIORITY ORDER — hint
   * windows first (urgency descending, ascending pieces within a window,
   * mirroring webtorrent's priority-sorted selection list), then the
   * remaining selection in ascending order (the completion fallback).
   * Writes REAL bytes to disk and SHA-1-verifies each piece. Emits
   * `piece-verified` per piece, `done` when the selection is complete,
   * and a FATAL error on a scripted corruption.
   */
  advance(): void {
    if (this.destroyed) return;
    this.advanceIndex += 1;
    if (!this.metadataEmitted) {
      const metadataAdvancesNeeded = sessionScript(this.sessionSpec).metadataResolveAdvances ?? 1;
      if (this.magnetKind && this.advanceIndex >= metadataAdvancesNeeded) {
        this.metadataEmitted = true;
        this.emit({ kind: "metadata", metainfo: this.seamMetainfo() });
      } else if (!this.magnetKind) {
        this.metadataEmitted = true; // queued at construction
      }
    }
    if (!this.metadataEmitted || this.paused) return;
    const script = sessionScript(this.sessionSpec);
    const perAdvance = script.piecesPerAdvance ?? 2;
    const startVerifiedBytes = this.verifiedBytes;
    let verified = 0;
    for (const piece of this.candidatePieceOrder()) {
      if (verified >= perAdvance) break;
      if (this.bitHas(piece)) continue;
      this.landPiece(piece, script);
      verified += 1;
    }
    this.lastAdvanceAt = Date.now();
    this.lastAdvanceDeltaBytes = this.verifiedBytes - startVerifiedBytes;
    this.checkDone();
  }

  /**
   * The deterministic piece-fetch order: hint windows (urgency DESC, then
   * fromPiece ASC — the stable webtorrent-mirroring order), then the whole
   * selection ascending. Deduplicated. With no hints this is EXACTLY the
   * pre-R12 ascending order (every existing test's behavior unchanged).
   */
  private candidatePieceOrder(): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    const push = (piece: number): void => {
      if (piece < 0 || piece >= this.pieceCount) return;
      if (seen.has(piece)) return;
      if (!this.pieceIsSelected(piece)) return; // the selection is the law
      seen.add(piece);
      out.push(piece);
    };
    const sortedHints = [...this.priorityHints].sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      if (a.fromPiece !== b.fromPiece) return a.fromPiece - b.fromPiece;
      return a.toPiece - b.toPiece;
    });
    for (const hint of sortedHints) {
      for (let piece = hint.fromPiece; piece <= hint.toPiece; piece += 1) push(piece);
    }
    for (let piece = 0; piece < this.pieceCount; piece += 1) push(piece);
    return out;
  }

  // --- internals -----------------------------------------------------------------

  private emit(event: LibrarySessionEvent): void {
    if (this.handlers.size === 0) {
      this.pendingEvents.push(event);
      return;
    }
    for (const handler of this.handlers) handler(event);
  }

  private seamMetainfo(): ParsedMetainfo {
    let offset = 0;
    const files = this.spec.files.map((file) => {
      const diskPath = fixtureDiskPath(this.spec, file);
      const entry = {
        path: diskPath,
        name: diskPath.split("/").pop() ?? diskPath,
        lengthBytes: file.sizeBytes,
        offsetBytes: offset,
      };
      offset += file.sizeBytes;
      return entry;
    });
    return {
      infoHash: this.infoHash,
      name: this.spec.name,
      pieceLengthBytes: this.pieceLength,
      totalBytes: this.totalBytes,
      pieceCount: this.pieceCount,
      files,
      trackers: this.spec.trackers.slice(),
      isPrivate: this.spec.isPrivate,
    };
  }

  /** Is this piece covered by the current file selection? */
  private pieceIsSelected(piece: number): boolean {
    if (this.selectedIndexes.size === 0) return false; // no selection: nothing transfers
    const start = piece * this.pieceLength;
    const end = Math.min(start + this.pieceLength, this.totalBytes);
    let offset = 0;
    let index = 0;
    for (const file of this.spec.files) {
      const fileStart = offset;
      const fileEnd = offset + file.sizeBytes;
      if (this.selectedIndexes.has(index) && fileStart < end && fileEnd > start) {
        return true;
      }
      offset = fileEnd;
      index += 1;
    }
    return false;
  }

  /** "Download" one piece: write its REAL bytes to disk, then SHA-1 verify. */
  private landPiece(piece: number, script: LoopbackScript): void {
    const start = piece * this.pieceLength;
    const end = Math.min(start + this.pieceLength, this.totalBytes);
    // Write the piece's bytes into every file it spans (real disk writes).
    let offset = 0;
    for (const file of this.spec.files) {
      const fileStart = offset;
      const fileEnd = offset + file.sizeBytes;
      const overlapStart = Math.max(start, fileStart);
      const overlapEnd = Math.min(end, fileEnd);
      if (overlapStart < overlapEnd) {
        const localStart = overlapStart - fileStart;
        const localEnd = overlapEnd - fileStart;
        const expected = this.content.get(fixtureDiskPath(this.spec, file))!;
        const slice = expected.subarray(localStart, localEnd);
        const bytes = script.corruptFilePath === file.path
          ? new Uint8Array(slice.byteLength).fill(0xde) // the scripted corruption
          : slice;
        this.writeToDisk(fixtureDiskPath(this.spec, file), localStart, bytes);
      }
      offset = fileEnd;
    }
    // Verify the piece against the metainfo hash (reading the REAL bytes
    // back from disk — never trusting the in-memory copy).
    const onDisk = this.readFromDisk(start, end);
    const hash = Bun.CryptoHasher.hash("sha1", onDisk, "hex");
    if (hash !== this.pieceHashes[piece]) {
      this.emit({
        kind: "error",
        message: `piece hash mismatch at piece ${piece} (expected ${this.pieceHashes[piece]}, landed ${hash}) — the metainfo verification failed on real bytes`,
        fatal: true,
      });
      return;
    }
    this.bitfield[piece >> 3]! |= 0x80 >> (piece & 7);
    this.verifiedBytes += end - start;
    this.emit({ kind: "piece-verified", piece });
  }

  /** The resume path: verify the bytes ACTUALLY on disk, piece by piece. */
  private verifyExistingDiskData(): void {
    if (!existsSync(this.dataDir)) return;
    for (let piece = 0; piece < this.pieceCount; piece += 1) {
      if (!this.pieceIsSelectedInitial(piece)) continue;
      const start = piece * this.pieceLength;
      const end = Math.min(start + this.pieceLength, this.totalBytes);
      const onDisk = this.readFromDisk(start, end);
      if (onDisk.byteLength !== end - start) continue; // incomplete on disk
      const hash = Bun.CryptoHasher.hash("sha1", onDisk, "hex");
      if (hash === this.pieceHashes[piece]) {
        this.bitfield[piece >> 3]! |= 0x80 >> (piece & 7);
        this.verifiedBytes += end - start;
      }
    }
  }

  /** The INITIAL selection (the spec's), used by the resume verification. */
  private pieceIsSelectedInitial(piece: number): boolean {
    if (this.sessionSpec.selectedFileIndexes.length === 0) return false;
    return this.coversIndexes(piece, new Set(this.sessionSpec.selectedFileIndexes));
  }

  private coversIndexes(piece: number, indexes: Set<number>): boolean {
    const start = piece * this.pieceLength;
    const end = Math.min(start + this.pieceLength, this.totalBytes);
    let offset = 0;
    let index = 0;
    for (const file of this.spec.files) {
      const fileStart = offset;
      const fileEnd = offset + file.sizeBytes;
      if (indexes.has(index) && fileStart < end && fileEnd > start) return true;
      offset = fileEnd;
      index += 1;
    }
    return false;
  }

  private checkDone(): void {
    if (this.doneEmitted || !this.metadataEmitted) return;
    if (this.selectedIndexes.size === 0) return;
    for (let piece = 0; piece < this.pieceCount; piece += 1) {
      if (this.coversIndexes(piece, this.selectedIndexes) && !this.bitHas(piece)) return;
    }
    this.doneEmitted = true;
    this.emit({ kind: "done" });
  }

  private bitHas(piece: number): boolean {
    const byte = this.bitfield[piece >> 3];
    return byte !== undefined && (byte & (0x80 >> (piece & 7))) !== 0;
  }

  /** Read the concatenated byte range from the REAL files on disk. */
  private readFromDisk(start: number, end: number): Uint8Array {
    const out = new Uint8Array(end - start);
    let offset = 0;
    for (const file of this.spec.files) {
      const fileStart = offset;
      const fileEnd = offset + file.sizeBytes;
      const overlapStart = Math.max(start, fileStart);
      const overlapEnd = Math.min(end, fileEnd);
      if (overlapStart < overlapEnd) {
        const path = join(this.dataDir, fixtureDiskPath(this.spec, file));
        try {
          const disk = readFileSync(path);
          const local = disk.subarray(
            overlapStart - fileStart,
            overlapEnd - fileStart,
          );
          out.set(local, overlapStart - start);
        } catch {
          // absent file — zero-filled (the verification below decides)
        }
      }
      offset = fileEnd;
    }
    return out;
  }

  /** Write bytes at a local offset of one file (real disk write). */
  private writeToDisk(path: string, localOffset: number, bytes: Uint8Array): void {
    const target = join(this.dataDir, path);
    mkdirSync(join(target, ".."), { recursive: true });
    let fd: number | undefined;
    try {
      const existed = existsSync(target);
      if (!existed) {
        // Create the file at its full final size (a one-byte write at the
        // final offset extends it) so positional writes land correctly
        // regardless of piece order.
        const size = this.spec.files.find(
          (f) => fixtureDiskPath(this.spec, f) === path,
        )!.sizeBytes;
        fd = openSync(target, "w");
        if (size > 0) {
          writeSync(fd, new Uint8Array(1), 0, 1, size - 1);
        }
      } else {
        fd = openSync(target, "r+");
      }
      writeSync(fd, bytes, 0, bytes.byteLength, localOffset);
      closeSync(fd);
      fd = undefined;
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // best-effort close
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The script (carried through the seam's dataDir — see createLoopbackSpec)
// ---------------------------------------------------------------------------

/**
 * The per-session script. Because `LibrarySessionSpec` is the frozen seam
 * (no script field), tests pass the script via a side-channel map keyed by
 * dataDir — the test owns the dataDir, so it is a unique, deterministic key.
 */
const scriptsByDataDir = new Map<string, LoopbackScript>();

/** Attach a script to a dataDir BEFORE creating the session with it. */
export function scriptLoopbackSession(dataDir: string, script: LoopbackScript): void {
  scriptsByDataDir.set(dataDir, script);
}

function sessionScript(spec: LibrarySessionSpec): LoopbackScript {
  return scriptsByDataDir.get(spec.dataDir) ?? {};
}

/** The LIVE peer schedule (scripts may be attached after creation). */
function livePeersAt(spec: LibrarySessionSpec, advanceIndex: number): number {
  return (sessionScript(spec).peersAt ?? (() => 3))(advanceIndex);
}

// ---------------------------------------------------------------------------
// REAL parsing through webtorrent's own pinned parser (test evidence)
// ---------------------------------------------------------------------------

async function realParse(uri: string): Promise<TorrentResult<{ infoHash: string; displayName?: string; trackers: readonly string[] }>> {
  const parsed = await realParseRaw(uri);
  if (!parsed.ok) return parsed;
  const value = parsed.value as { infoHash?: string; name?: string; announce?: string[] };
  if (typeof value.infoHash !== "string") {
    return torrentError("INVALID_MAGNET", {
      detail: `parseMagnet: '${uri}' did not carry a usable btih infohash`,
    });
  }
  return {
    ok: true,
    value: {
      infoHash: value.infoHash,
      ...(typeof value.name === "string" && value.name.length > 0
        ? { displayName: value.name }
        : {}),
      trackers: value.announce ?? [],
    },
  };
}

interface RawParsed {
  infoHash?: string;
  name?: string;
  pieceLength?: number;
  length?: number;
  files?: { path: string; name: string; length: number }[];
  announce?: string[];
  private?: boolean;
}

async function realParseRaw(input: string | Uint8Array): Promise<TorrentResult<RawParsed>> {
  try {
    const module = (await import("parse-torrent")) as {
      default: (input: string | Uint8Array) => Promise<RawParsed>;
    };
    return { ok: true, value: await module.default(input) };
  } catch (e) {
    const isTorrentFile = typeof input !== "string";
    return torrentError(isTorrentFile ? "INVALID_TORRENT_FILE" : "INVALID_MAGNET", {
      detail: `${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

async function realParseTorrentFile(bytes: Uint8Array): Promise<TorrentResult<ParsedMetainfo>> {
  const parsed = await realParseRaw(bytes);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (
    typeof value.infoHash !== "string" ||
    typeof value.name !== "string" ||
    typeof value.pieceLength !== "number" ||
    typeof value.length !== "number"
  ) {
    return torrentError("INVALID_TORRENT_FILE", {
      detail: "parseTorrentFile: the bytes did not decode into complete metainfo",
    });
  }
  let offset = 0;
  const files = (value.files ?? []).map((file) => {
    const entry = {
      path: file.path,
      name: file.name,
      lengthBytes: file.length,
      offsetBytes: offset,
    };
    offset += file.length;
    return entry;
  });
  const trackers: string[] = [];
  for (const url of value.announce ?? []) {
    if (!trackers.includes(url)) trackers.push(url);
  }
  return {
    ok: true,
    value: {
      infoHash: value.infoHash,
      name: value.name,
      pieceLengthBytes: value.pieceLength,
      totalBytes: value.length,
      pieceCount: Math.max(1, Math.ceil(value.length / value.pieceLength)),
      files,
      trackers,
      isPrivate: value.private === true,
    },
  };
}
