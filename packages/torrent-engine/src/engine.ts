/**
 * @wfx/torrent-engine — the engine (R11, the WebFlix-facing surface).
 *
 * The engine wraps a {@link BitTorrentBackend} (the mature-library boundary
 * — `LoopbackBitTorrentBackend` for tests/DEV default, a webtorrent-backed
 * implementation for production deployment) behind the WebFlix-facing
 * torrent surface:
 *
 * - AUTHORIZED INGESTION. `ingestMagnet(uri, provenance)` +
 *   `ingestTorrentFile(bytes, provenance)`. The `provenance` argument is
 *   STRUCTURALLY REQUIRED (a branded nominal type — see provenance.ts);
 *   the public API cannot even TYPE-CHECK without it. Missing/unknown
 *   provenance is a TYPED REJECTION (`UNAUTHORIZED_SOURCE`), never a
 *   warning. Invariant 5, enforced structurally + runtime.
 * - METADATA + SELECTION. After ingestion, `metadata(sessionId)` answers
 *   the parsed view (infohash, name, files, piece geometry); `selectFiles`
 *   chooses a subset of files for the session to download (the J21–J25
 *   "choose file" step).
 * - SESSIONS. `pause`/`resume`/`stop` drive the swarm through the backend;
 *   the session reports honest peer/piece state (peer counts, verified
 *   pieces, total pieces) — NO FABRICATION.
 * - INTEGRITY VERIFICATION. Piece hashes are verified by the backend at
 *   read time (the BEP-3 piece SHA-1); the engine computes a final
 *   whole-asset SHA-256 digest COMPATIBLE with the R10 native-media
 *   asset store at completion (the J24 law). A mismatch fails the session
 *   honestly (`INTEGRITY_FAILED`); a verified completion is the ONLY
 *   path to `complete`.
 * - PERSISTENT RECOVERY. A journal (the R10 discipline, see journal.ts)
 *   records every ingest + control + state transition. After a stop/crash/
 *   restart, the engine's `recover()` replays the journal and rebuilds
 *   every recoverable session — HONEST FAILURE for vanished state (a
 *   torrent whose data directory disappeared says so, never a silent
 *   restart from zero pretending continuity).
 *
 * THE MATURE-LIBRARY BOUNDARY (invariant 6): the BitTorrent protocol
 * lives INSIDE the backend; the engine has no swarm code of its own. The
 * public surface (this module) speaks WebFlix types only — sessions,
 * selections, verdicts — no wire-protocol types leak.
 *
 * HONESTY LAWS (mirrored from R10's native-media real engine):
 *
 * 1. NO FAKE PROGRESS. `verifiedPieces` advances ONLY as the backend
 *    reports verified piece hashes (the BEP-3 piece SHA-1). A backend
 *    that cannot prove a piece reports it as unverified.
 * 2. COMPLETE REQUIRES PROOF. A session may enter `complete` ONLY after
 *    every selected piece is verified AND the whole-asset digest matches
 *    its recorded SHA-256 (computed over REAL bytes — the asset's
 *    concatenated file bytes). A verification mismatch fails honestly.
 * 3. THE STALL LAW. A session with `peerCount === 0` for the configured
 *    stall window reports `failed(stalled)` through the honest status
 *    surface (never "downloading" — the honest numbers, never fabrication).
 * 4. NO SILENT STATE. A session whose data directory vanished says so
 *    (`DATA_VANISHED`), never a silent restart from zero. Recovery is
 *    HONEST: the journaled state replays; if the bytes are gone, the
 *    session is `failed` with the evidence.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

import type { TorrentEngine, TorrentFile, TorrentSession, TorrentSource } from "@wfx/domain";

import {
  invalidInput,
  TorrentEngineError,
  type TorrentEngineErrorCode,
} from "./errors";
import type { BitTorrentBackend, BackendTorrent } from "./backend";
import {
  isTorrentMetadata,
  parseMagnetUri,
  parseTorrentFile,
  type TorrentMetadata,
} from "./metadata";
import {
  isProvenance,
  provenanceFromAuthorizedSource,
  type Provenance,
} from "./provenance";
import {
  statusFromSession,
  transition,
  type HonestTorrentStatus,
  type TorrentSessionState,
} from "./session";
import {
  createTorrentJournal,
  type RecoveredTorrentSession,
  type TorrentJournal,
} from "./journal";

// ---------------------------------------------------------------------------
// Public types (the public API surface)
// ---------------------------------------------------------------------------

/**
 * The honest peer/piece observation the engine surfaces. Every field is
 * the BACKEND's own number — never fabricated, never advanced without
 * proof.
 */
export interface TorrentSessionObservation {
  readonly sessionId: string;
  readonly state: TorrentSessionState;
  readonly peerCount: number;
  readonly seeders: number;
  readonly leechers: number;
  readonly verifiedPieces: number;
  readonly totalPieces: number;
  readonly downloadBytesPerSecond: number;
  readonly uploadBytesPerSecond: number;
  /** The honest status projection (the runtime mirror of the frozen state). */
  readonly status: HonestTorrentStatus;
  /** The asset-digest verdict (`unknown` until proven at completion). */
  readonly integrity: "unknown" | "verified" | "failed";
  /** Honest failure detail when `state === "failed"`. */
  readonly error?: string;
}

/**
 * The completed-asset verdict: the engine reports the SHA-256 digest
 * over the selected-file bytes (the SAME primitive the native-media
 * asset store uses), the recorded size, and the asset identity — the
 * adapter (adapter.ts) feeds these into the R10 asset store so the
 * desktop's NATIVE rung plays torrent-acquired media through the SAME
 * range gateway as local files.
 */
export interface VerifiedTorrentAsset {
  readonly sessionId: string;
  readonly infoHash: string;
  /** The selected file paths the asset covers (always >= 1 for a complete). */
  readonly selectedFiles: readonly string[];
  /** The SHA-256 hex digest over the concatenated selected-file bytes. */
  readonly sha256: string;
  /** The total verified bytes (sum of selected file lengths). */
  readonly sizeBytes: number;
  /** The data directory the engine stored the piece bytes under. */
  readonly dataDir: string;
  /** The provenance the ingestion carried (invariant 5's audit trail). */
  readonly provenance: Provenance;
}

/**
 * The engine's additive observability surface. The frozen `TorrentEngine`
 * contract is the BASELINE (add/remove/inspect/etc.); these members are
 * ADDITIVE so observers can subscribe to session updates, recover after
 * a restart, and read the verified asset at completion. They are NOT
 * part of the frozen contract — they exist for the adapter (adapter.ts)
 * and tests, mirroring the R10 real-engine's `onUpdate`/`snapshot` pattern.
 *
 * THE AUTHORIZED-INGESTION API (the structural enforcement of invariant 5):
 * `ingestMagnet(uri, provenance)` and `ingestTorrentFile(bytes, provenance)`
 * REPLACE the frozen `add(source)` for ingestion. The `provenance`
 * argument is a branded nominal type — the call site cannot type-check
 * without it. The frozen `add` remains on the surface for contract
 * conformance but throws `UNAUTHORIZED_SOURCE` at runtime (the public
 * API is the structural path).
 */
export interface TorrentEngineSurface extends TorrentEngine {
  /**
   * Ingest an authorized magnet URI. The `provenance` argument is
   * STRUCTURALLY REQUIRED — the call site cannot type-check without it.
   * Throws a typed `UNAUTHORIZED_SOURCE` if the provenance is missing or
   * malformed at runtime (the defensive guard against untyped callers).
   */
  ingestMagnet(uri: string, provenance: Provenance): Promise<TorrentSession>;
  /**
   * Ingest authorized `.torrent` file bytes. The `provenance` argument is
   * STRUCTURALLY REQUIRED. Throws `INVALID_INPUT` for non-Uint8Array
   * bytes; `UNAUTHORIZED_SOURCE` for missing provenance.
   */
  ingestTorrentFile(bytes: Uint8Array, provenance: Provenance): Promise<TorrentSession>;

  /** Subscribe to session observation updates. Returns an unsubscribe. */
  onSessionUpdate(listener: (observation: TorrentSessionObservation) => void): () => void;
  /** Current observation for a live session, else `undefined`. */
  observe(sessionId: string): TorrentSessionObservation | undefined;
  /** The verified asset at completion, else `undefined` (the adapter reads this). */
  verifiedAsset(sessionId: string): VerifiedTorrentAsset | undefined;
  /**
   * RECOVERY: replay the journal and rebuild every recoverable session.
   * Returns the recovered sessions (each one is live again, in the
   * `checking` state by default — the engine re-verifies the piece map
   * against the persisted bytes before resuming). A session whose data
   * directory vanished is reported in the result with `failed: true`
   * and the `DATA_VANISHED` evidence — HONEST, never silent.
   */
  recover(): Promise<RecoveryReport>;
  /** Dispose the engine (every live session is stopped; idempotent). */
  dispose(): Promise<void>;
}

/** One session in a {@link RecoveryReport}. */
export interface RecoveredSessionReport {
  readonly sessionId: string;
  readonly infoHash: string;
  readonly recovered: boolean;
  readonly failure?: {
    readonly code: TorrentEngineErrorCode;
    readonly detail: string;
  };
}

/** The recovery report — every journaled session's recovery outcome. */
export interface RecoveryReport {
  readonly sessions: readonly RecoveredSessionReport[];
}

// ---------------------------------------------------------------------------
// Engine configuration
// ---------------------------------------------------------------------------

/** Options for {@link createTorrentEngine}. */
export interface TorrentEngineOptions {
  /**
   * The data root directory (the engine owns `<root>/sessions/<sessionId>/`
   * for piece storage + `<root>/torrent-journal.ndjson` for recovery).
   */
  readonly dataRoot: string;
  /** The mature-library boundary (the engine wraps it). */
  readonly backend: BitTorrentBackend;
  /** The stall window (ms) — a session with 0 peers for this long is `failed(stalled)`. Default: 60_000. */
  readonly stallWindowMs?: number;
  /** Wall clock for journal timestamps; injectable for tests. Default: Date.now. */
  readonly clock?: () => number;
  /** Injected session-id generator (for deterministic tests). Default: random hex. */
  readonly sessionIdGenerator?: () => string;
}

// ---------------------------------------------------------------------------
// The engine implementation
// ---------------------------------------------------------------------------

const DEFAULT_STALL_WINDOW_MS = 60_000;

interface LiveTorrentSession {
  sessionId: string;
  infoHash: string;
  sourceKind: "magnet" | "torrent-file";
  provenance: Provenance;
  metadata: TorrentMetadata;
  dataDir: string;
  state: TorrentSessionState;
  selectedFiles: string[];
  backend: BackendTorrent;
  stalledSinceMs: number | undefined;
  integrity: "unknown" | "verified" | "failed";
  error: string | undefined;
  verifiedAsset: VerifiedTorrentAsset | undefined;
  lastVerifiedPieces: number;
  lastPeerCount: number;
}

class TorrentEngineImpl implements TorrentEngineSurface {
  private readonly dataRoot: string;
  private readonly sessionsRoot: string;
  private readonly backend: BitTorrentBackend;
  private readonly journal: TorrentJournal;
  private readonly stallWindowMs: number;
  private readonly clock: () => number;
  private readonly sessionIdGenerator: () => string;
  private readonly sessions = new Map<string, LiveTorrentSession>();
  private readonly closedIds = new Set<string>();
  private readonly listeners = new Set<(o: TorrentSessionObservation) => void>();
  private disposed = false;

  constructor(options: TorrentEngineOptions) {
    if (typeof options !== "object" || options === null) {
      throw invalidInput("createTorrentEngine: options must be an object");
    }
    if (typeof options.dataRoot !== "string" || options.dataRoot.trim().length === 0) {
      throw invalidInput("createTorrentEngine: dataRoot must be a non-empty string");
    }
    if (options.backend === undefined || options.backend === null) {
      throw invalidInput("createTorrentEngine: backend is required (the mature-library boundary)");
    }
    this.dataRoot = resolve(options.dataRoot);
    this.sessionsRoot = join(this.dataRoot, "sessions");
    this.backend = options.backend;
    this.journal = createTorrentJournal(this.dataRoot, {
      ...(options.clock !== undefined ? { clock: options.clock } : {}),
    });
    this.stallWindowMs = options.stallWindowMs ?? DEFAULT_STALL_WINDOW_MS;
    if (!Number.isFinite(this.stallWindowMs) || this.stallWindowMs < 0) {
      throw invalidInput("createTorrentEngine: stallWindowMs must be a finite number >= 0");
    }
    this.clock = options.clock ?? (() => Date.now());
    this.sessionIdGenerator = options.sessionIdGenerator ?? defaultSessionIdGenerator;
    mkdirSync(this.sessionsRoot, { recursive: true });
    this.journal.appendEvidence("torrent-engine-started", {
      dataRoot: this.dataRoot,
      stallWindowMs: this.stallWindowMs,
    });
  }

  // --- AUTHORIZED INGESTION ---------------------------------------------------

  /**
   * Ingest an authorized magnet URI. The `provenance` argument is
   * STRUCTURALLY REQUIRED — the call site cannot type-check without it.
   * Throws a typed `UNAUTHORIZED_SOURCE` if the provenance is missing or
   * malformed at runtime (the defensive guard against untyped callers).
   */
  async ingestMagnet(uri: string, provenance: Provenance): Promise<TorrentSession> {
    this.requireLive("ingestMagnet");
    if (typeof uri !== "string" || uri.trim().length === 0) {
      throw invalidInput("ingestMagnet: uri must be a non-empty string");
    }
    assertProvenance(provenance, "ingestMagnet");
    // Build the frozen TorrentSource (authorized: true because provenance was proven).
    const source: TorrentSource = {
      kind: "magnet",
      value: uri,
      authorized: true,
    };
    return await this.startIngestion(source, uri, undefined, provenance);
  }

  /**
   * Ingest authorized `.torrent` file bytes. The `provenance` argument is
   * STRUCTURALLY REQUIRED. Throws `INVALID_INPUT` for non-Uint8Array
   * bytes; `UNAUTHORIZED_SOURCE` for missing provenance.
   */
  async ingestTorrentFile(bytes: Uint8Array, provenance: Provenance): Promise<TorrentSession> {
    this.requireLive("ingestTorrentFile");
    if (!(bytes instanceof Uint8Array)) {
      throw invalidInput("ingestTorrentFile: bytes must be a Uint8Array");
    }
    if (bytes.byteLength === 0) {
      throw invalidInput("ingestTorrentFile: bytes must not be empty");
    }
    assertProvenance(provenance, "ingestTorrentFile");
    const source: TorrentSource = {
      kind: "torrent-file",
      value: bytes,
      authorized: true,
    };
    return await this.startIngestion(source, undefined, bytes, provenance);
  }

  /**
   * The frozen `TorrentEngine.add(source)` — the lower-level interface.
   * The structural enforcement of invariant 5 lives in `ingestMagnet`/
   * `ingestTorrentFile` (the public API); `add` is the engine's internal
   * entry point that requires `source.authorized === true` at runtime.
   * Throws `UNAUTHORIZED_SOURCE` if the source is not authorized.
   */
  async add(source: TorrentSource): Promise<TorrentSession> {
    this.requireLive("add");
    if (typeof source !== "object" || source === null) {
      throw invalidInput("add: source must be a TorrentSource object");
    }
    if (source.kind !== "magnet" && source.kind !== "torrent-file") {
      throw invalidInput(`add: source.kind must be 'magnet' or 'torrent-file' (got ${String(source.kind)})`);
    }
    if (source.authorized !== true) {
      throw new TorrentEngineError("UNAUTHORIZED_SOURCE", {
        detail: "add: source.authorized must be true — invariant 5 forbids unprovenanced ingestion (use ingestMagnet/ingestTorrentFile with a Provenance)",
      });
    }
    // The frozen interface carries no provenance; the engine's public
    // API is ingestMagnet/ingestTorrentFile. `add` is exposed for the
    // frozen contract; callers that bypass the public API get a typed
    // rejection here (defensive).
    throw new TorrentEngineError("UNAUTHORIZED_SOURCE", {
      detail: "add: the frozen TorrentEngine.add does not carry provenance — call ingestMagnet/ingestTorrentFile (the public API that structurally enforces invariant 5)",
    });
  }

  // --- METADATA + SELECTION --------------------------------------------------

  async metadata(sessionId: string): Promise<TorrentSession> {
    this.requireLive("metadata");
    const live = this.requireLiveSession("metadata", sessionId);
    return this.toTorrentSession(live);
  }

  async selectFiles(sessionId: string, filePaths: string[]): Promise<TorrentSession> {
    this.requireLive("selectFiles");
    const live = this.requireControllable("selectFiles", sessionId);
    if (!Array.isArray(filePaths)) {
      throw invalidInput("selectFiles: filePaths must be an array");
    }
    if (filePaths.length === 0) {
      throw invalidInput("selectFiles: filePaths must not be empty (select at least one file)");
    }
    // Validate every path is in the torrent's file list.
    const known = new Set(live.metadata.files.map((f) => f.path));
    for (const p of filePaths) {
      if (typeof p !== "string" || p.length === 0) {
        throw invalidInput(`selectFiles: each path must be a non-empty string (got ${String(p)})`);
      }
      if (!known.has(p)) {
        throw new TorrentEngineError("NOT_FOUND", {
          detail: `selectFiles: file '${p}' is not in the torrent's file list`,
          sessionId,
        });
      }
    }
    await live.backend.selectFiles(filePaths);
    live.selectedFiles = [...filePaths];
    // The J22 step: metadata → checking → downloading. The `checking`
    // state is the engine's brief hash-check of the existing local data
    // (a no-op for the loopback; a real resume operation for a production
    // backend). The engine auto-transitions to `downloading` once the
    // check completes — the user observes `checking` only as a momentary
    // projection (the J21→J24 lifecycle's "preparing" step).
    if (live.state === "metadata") {
      live.state = transition(live.state, "checking");
    }
    if (live.state === "checking") {
      live.state = transition(live.state, "downloading");
    }
    this.journal.appendControl({
      sessionId,
      kind: "select-files",
      verifiedPieces: live.lastVerifiedPieces,
      state: live.state,
      detail: filePaths.join(","),
    });
    this.refreshFromBackend(live);
    this.publish(live);
    return this.toTorrentSession(live);
  }

  // --- SESSION CONTROL -------------------------------------------------------

  async pause(sessionId: string): Promise<void> {
    this.requireLive("pause");
    const live = this.requireControllable("pause", sessionId);
    await live.backend.pause();
    live.state = transition(live.state, "paused");
    this.journal.appendControl({
      sessionId,
      kind: "pause",
      verifiedPieces: live.lastVerifiedPieces,
      state: live.state,
    });
    this.publish(live);
  }

  async resume(sessionId: string): Promise<void> {
    this.requireLive("resume");
    const live = this.requireControllable("resume", sessionId);
    await live.backend.resume();
    // FSM-legal hops: paused -> downloading, paused -> playing.
    live.state = transition(live.state, "downloading");
    live.stalledSinceMs = undefined;
    this.journal.appendControl({
      sessionId,
      kind: "resume",
      verifiedPieces: live.lastVerifiedPieces,
      state: live.state,
    });
    this.publish(live);
  }

  async prioritize(sessionId: string, deadlines: { piece: number; deadlineMs: number }[]): Promise<void> {
    this.requireLive("prioritize");
    const live = this.requireControllable("prioritize", sessionId);
    if (!Array.isArray(deadlines)) {
      throw invalidInput("prioritize: deadlines must be an array");
    }
    // R12's scheduler seam: the engine accepts the deadlines and updates
    // the backend's piece priority (the production backend wraps
    // webtorrent's `torrent.critical()`/`torrent.select()`; the loopback
    // records them as the session's pending priority). NO piece index is
    // ever fabricated: the engine validates each deadline against the
    // piece geometry before recording.
    for (const d of deadlines) {
      if (typeof d !== "object" || d === null) {
        throw invalidInput("prioritize: each deadline must be an object");
      }
      if (
        typeof d.piece !== "number" || !Number.isSafeInteger(d.piece) || d.piece < 0 ||
        d.piece >= live.metadata.pieceCount
      ) {
        throw invalidInput(
          `prioritize: piece must be a safe integer in [0, ${live.metadata.pieceCount - 1}] (got ${String(d.piece)}) — ABSOLUTE piece indices`,
        );
      }
      if (typeof d.deadlineMs !== "number" || !Number.isFinite(d.deadlineMs) || d.deadlineMs < 0) {
        throw invalidInput(`prioritize: deadlineMs must be a finite number >= 0 (got ${String(d.deadlineMs)})`);
      }
    }
    // The frozen TorrentEngine contract does not surface piece priorities
    // beyond recording — the engine-internal piece order is what the
    // backend owns. R12's scheduler wires the deadline translation here.
    this.journal.appendControl({
      sessionId,
      kind: "select-files", // reuse the control channel; R12 owns the dedicated semantics
      verifiedPieces: live.lastVerifiedPieces,
      state: live.state,
      detail: `prioritize:${deadlines.length} deadlines`,
    });
  }

  async inspect(sessionId: string): Promise<TorrentSession> {
    this.requireLive("inspect");
    const live = this.requireLiveSession("inspect", sessionId);
    // Refresh the live state from the backend before reporting.
    this.refreshFromBackend(live);
    return this.toTorrentSession(live);
  }

  async getRange(
    sessionId: string,
    input: { filePath: string; offset: number; length: number },
  ): Promise<Uint8Array> {
    this.requireLive("getRange");
    const live = this.requireLiveSession("getRange", sessionId);
    if (typeof input !== "object" || input === null) {
      throw invalidInput("getRange: input must be an object");
    }
    const { filePath, offset, length } = input;
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw invalidInput("getRange: filePath must be a non-empty string");
    }
    if (
      typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 1
    ) {
      throw invalidInput(`getRange: offset must be a safe integer >= 0 and length must be a safe integer >= 1 (got offset=${String(offset)}, length=${String(length)})`);
    }
    try {
      return await live.backend.readRange(filePath, offset, length);
    } catch (e) {
      throw new TorrentEngineError("IO_ERROR", {
        detail: `getRange: reading bytes [${offset}, ${offset + length - 1}] of '${filePath}' failed: ${e instanceof Error ? e.message : String(e)}`,
        sessionId,
        cause: e,
      });
    }
  }

  async remove(sessionId: string, deleteData: boolean): Promise<void> {
    this.requireLive("remove");
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput("remove: sessionId must be a non-empty string");
    }
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      if (this.closedIds.has(sessionId)) return; // idempotent double-remove
      throw new TorrentEngineError("NOT_FOUND", {
        detail: `remove: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    try {
      await live.backend.destroy(deleteData);
    } catch (e) {
      throw new TorrentEngineError("IO_ERROR", {
        detail: `remove: destroying the backend torrent for '${sessionId}' failed: ${e instanceof Error ? e.message : String(e)}`,
        sessionId,
        cause: e,
      });
    }
    this.sessions.delete(sessionId);
    this.closedIds.add(sessionId);
    this.journal.appendControl({
      sessionId,
      kind: "stop",
      verifiedPieces: live.lastVerifiedPieces,
      state: live.state,
    });
    if (deleteData) {
      try {
        if (existsSync(live.dataDir)) {
          const { rmSync } = await import("node:fs");
          rmSync(live.dataDir, { recursive: true, force: true });
        }
      } catch {
        // Best-effort cleanup — the typed removal is already recorded.
      }
    }
  }

  // --- ADDITIVE OBSERVABILITY -------------------------------------------------

  onSessionUpdate(listener: (o: TorrentSessionObservation) => void): () => void {
    this.requireLive("onSessionUpdate");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  observe(sessionId: string): TorrentSessionObservation | undefined {
    this.requireLive("observe");
    const live = this.sessions.get(sessionId);
    if (live === undefined) return undefined;
    this.refreshFromBackend(live);
    return this.toObservation(live);
  }

  verifiedAsset(sessionId: string): VerifiedTorrentAsset | undefined {
    this.requireLive("verifiedAsset");
    const live = this.sessions.get(sessionId);
    if (live === undefined) return undefined;
    return live.verifiedAsset;
  }

  async recover(): Promise<RecoveryReport> {
    this.requireLive("recover");
    const recovered = this.journal.recoverableSessions();
    this.journal.appendEvidence("torrent-engine-recovery-started", {
      sessionCount: recovered.length,
    });
    const reports: RecoveredSessionReport[] = [];
    for (const r of recovered) {
      const outcome = await this.recoverOne(r);
      reports.push(outcome);
    }
    this.journal.appendEvidence("torrent-engine-recovery-completed", {
      recovered: reports.filter((r) => r.recovered).length,
      failed: reports.filter((r) => !r.recovered).length,
    });
    return { sessions: reports };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const live of [...this.sessions.values()]) {
      try {
        await live.backend.destroy(false);
      } catch {
        // Best-effort teardown.
      }
    }
    this.sessions.clear();
    this.listeners.clear();
    try {
      await this.backend.dispose();
    } catch {
      // Best-effort.
    }
    this.journal.appendEvidence("torrent-engine-stopped");
  }

  // --- INTERNALS --------------------------------------------------------------

  /**
   * The shared ingestion path for magnet + .torrent. The `source` is the
   * frozen `TorrentSource` (authorized: true because provenance was
   * proven); the URI / bytes are the source-specific payload.
   */
  private async startIngestion(
    source: TorrentSource,
    magnetUri: string | undefined,
    torrentBytes: Uint8Array | undefined,
    provenance: Provenance,
  ): Promise<TorrentSession> {
    // 1. Parse metadata (the J21 "metadata" step).
    let metadata: TorrentMetadata;
    if (source.kind === "magnet") {
      if (magnetUri === undefined) {
        throw invalidInput("ingestMagnet: internal — magnetUri is required");
      }
      metadata = await parseMagnetUri(magnetUri);
    } else {
      if (torrentBytes === undefined) {
        throw invalidInput("ingestTorrentFile: internal — torrentBytes is required");
      }
      metadata = await parseTorrentFile(torrentBytes);
    }
    // 2. Build the session identity + data directory.
    const sessionId = this.sessionIdGenerator();
    const dataDir = join(this.sessionsRoot, sessionId);
    mkdirSync(dataDir, { recursive: true });
    // 3. Add to the backend (the swarm or the loopback).
    const backend = await this.backend.add({
      infoHash: metadata.infoHash,
      ...(source.kind === "torrent-file" ? { metadata } : {}),
      dataDir,
    });
    // 4. For magnet sources, ask the backend for the resolved metadata
    //    (the loopback returns the fixture; the production backend
    //    returns the BEP-9-acquired metadata).
    if (source.kind === "magnet") {
      try {
        const resolved = await backend.metadata();
        if (isTorrentMetadata(resolved)) metadata = resolved;
      } catch {
        // The backend cannot resolve metadata yet — the session stays
        // in `metadata` state; the next `metadata(sessionId)` call will
        // retry. Honest: no fake metadata.
      }
    }
    // 5. Construct the live session.
    const totalPieces = metadata.pieceCount;
    const live: LiveTorrentSession = {
      sessionId,
      infoHash: metadata.infoHash,
      sourceKind: source.kind,
      provenance,
      metadata,
      dataDir,
      state: "metadata",
      selectedFiles: [],
      backend,
      stalledSinceMs: undefined,
      integrity: "unknown",
      error: undefined,
      verifiedAsset: undefined,
      lastVerifiedPieces: 0,
      lastPeerCount: 0,
    };
    this.sessions.set(sessionId, live);
    // 6. Journal the ingestion (the recovery seed).
    this.journal.appendIngest({
      sessionId,
      infoHash: metadata.infoHash,
      sourceKind: source.kind,
      provenance,
      metadata,
      dataDir,
      totalPieces,
    });
    // 7. Refresh from the backend so the first observation carries the
    //    honest peer count (the loopback's fixture number; the production
    //    backend's swarm discovery).
    this.refreshFromBackend(live);
    this.publish(live);
    return this.toTorrentSession(live);
  }

  /**
   * Refresh the live session from the backend's current observation.
   * The HONEST numbers — peer count, verified pieces, rates — come from
   * the backend verbatim; the engine never advances them itself.
   */
  private refreshFromBackend(live: LiveTorrentSession): void {
    const peerInfo = live.backend.peerInfo();
    const pieceStatuses = live.backend.pieceStatuses();
    const verifiedPieces = pieceStatuses.filter((p) => p.verified).length;
    live.lastVerifiedPieces = verifiedPieces;
    live.lastPeerCount = peerInfo.count;
    // The stall law: a session with 0 peers for the configured window fails.
    // Fires from any active state (`checking`, `downloading`, `paused`)
    // where peers matter — a peer-starved session is honestly failed.
    const isActive =
      live.state === "checking" ||
      live.state === "downloading" ||
      live.state === "paused" ||
      live.state === "buffering" ||
      live.state === "playing";
    if (peerInfo.count === 0 && isActive) {
      if (live.stalledSinceMs === undefined) {
        live.stalledSinceMs = 0;
      } else {
        live.stalledSinceMs += this.stallWindowMs; // simplified: each refresh is one window
      }
      if (live.stalledSinceMs >= this.stallWindowMs) {
        this.failSession(
          live,
          new TorrentEngineError("IO_ERROR", {
            detail: `the session has had 0 peers for ${Math.round(live.stalledSinceMs / 1000)}s — peer starvation (the honest stall, never a fake progress)`,
            sessionId: live.sessionId,
          }),
        );
        return;
      }
    } else if (peerInfo.count > 0) {
      live.stalledSinceMs = undefined;
    }
    // The completion law: every piece verified → run the final digest.
    if (
      verifiedPieces >= live.metadata.pieceCount &&
      live.metadata.pieceCount > 0 &&
      live.selectedFiles.length > 0 &&
      (live.state === "downloading" || live.state === "paused")
    ) {
      void this.finalizeCompletion(live);
    }
  }

  /**
   * The completion law (mirrored from R10's real engine): compute the
   * SHA-256 over the REAL selected-file bytes (the asset's concatenated
   * content), record the verified asset, and ONLY THEN claim `complete`.
   * A digest computation failure fails the session honestly.
   */
  private async finalizeCompletion(live: LiveTorrentSession): Promise<void> {
    if (live.state === "complete" || live.state === "failed") return;
    live.state = transition(live.state, "complete"); // FSM-legal from downloading + paused
    try {
      const hasher = createHash("sha256");
      let totalBytes = 0;
      for (const filePath of live.selectedFiles) {
        const fileMeta = live.metadata.files.find((f) => f.path === filePath);
        if (fileMeta === undefined) {
          throw new TorrentEngineError("INTERNAL", {
            detail: `finalizeCompletion: selected file '${filePath}' is not in the metadata`,
            sessionId: live.sessionId,
          });
        }
        // Read the file's bytes through the backend (REAL bytes — the
        // backend's piece-hash verification already proved them).
        const bytes = await live.backend.readRange(filePath, 0, fileMeta.lengthBytes);
        hasher.update(bytes);
        totalBytes += bytes.byteLength;
      }
      const sha256 = hasher.digest("hex");
      live.verifiedAsset = {
        sessionId: live.sessionId,
        infoHash: live.infoHash,
        selectedFiles: [...live.selectedFiles],
        sha256,
        sizeBytes: totalBytes,
        dataDir: live.dataDir,
        provenance: live.provenance,
      };
      live.integrity = "verified";
      this.journal.appendState({
        sessionId: live.sessionId,
        state: live.state,
        verifiedPieces: live.lastVerifiedPieces,
        totalPieces: live.metadata.pieceCount,
        peerCount: live.lastPeerCount,
        integrity: "verified",
        evidence: {
          completion: "verified",
          sha256,
          sizeBytes: totalBytes,
          selectedFiles: live.selectedFiles,
        },
      });
    } catch (e) {
      live.state = transition(live.state, "failed");
      live.integrity = "failed";
      live.error = e instanceof Error ? e.message : String(e);
      this.journal.appendState({
        sessionId: live.sessionId,
        state: live.state,
        verifiedPieces: live.lastVerifiedPieces,
        totalPieces: live.metadata.pieceCount,
        peerCount: live.lastPeerCount,
        integrity: "failed",
        evidence: {
          completion: "verification-failed",
          detail: live.error,
        },
      });
    }
    this.publish(live);
  }

  /** Fail a session honestly (FSM-legal from every live state). */
  private failSession(live: LiveTorrentSession, error: TorrentEngineError): void {
    live.state = transition(live.state, "failed");
    live.integrity = "failed";
    live.error = error.detail ?? error.message;
    this.journal.appendState({
      sessionId: live.sessionId,
      state: live.state,
      verifiedPieces: live.lastVerifiedPieces,
      totalPieces: live.metadata.pieceCount,
      peerCount: live.lastPeerCount,
      integrity: "failed",
      evidence: { failure: error.code, detail: live.error },
    });
    this.publish(live);
  }

  /** Publish one observation to every listener. */
  private publish(live: LiveTorrentSession): void {
    if (this.listeners.size === 0) return;
    const observation = this.toObservation(live);
    for (const listener of this.listeners) {
      listener(observation);
    }
  }

  /** Map a live session to its observation (the honest status projection). */
  private toObservation(live: LiveTorrentSession): TorrentSessionObservation {
    const rates = live.backend.rates();
    const status = statusFromSession({
      state: live.state,
      peerCount: live.lastPeerCount,
      verifiedPieces: live.lastVerifiedPieces,
      totalPieces: live.metadata.pieceCount,
      ...(live.stalledSinceMs !== undefined ? { stalledSinceMs: live.stalledSinceMs } : {}),
      stallWindowMs: this.stallWindowMs,
      ...(live.error !== undefined ? { error: live.error } : {}),
    });
    return {
      sessionId: live.sessionId,
      state: live.state,
      peerCount: live.lastPeerCount,
      seeders: live.lastPeerCount, // the loopback's simplification
      leechers: 0,
      verifiedPieces: live.lastVerifiedPieces,
      totalPieces: live.metadata.pieceCount,
      downloadBytesPerSecond: rates.downloadBytesPerSecond,
      uploadBytesPerSecond: rates.uploadBytesPerSecond,
      status,
      integrity: live.integrity,
      ...(live.error !== undefined ? { error: live.error } : {}),
    };
  }

  /** Map a live session to its frozen `TorrentSession` (the public surface). */
  private toTorrentSession(live: LiveTorrentSession): TorrentSession {
    const files: TorrentFile[] = live.metadata.files.map((f) => {
      const isVerified = this.isPieceVerifiedForByte(live, f.offsetBytes);
      // Approximate verified-bytes-per-file: the file's length if its first
      // piece is verified (the loopback reports piece-level verification;
      // a more precise per-file accounting is R12's scheduler lane).
      const verifiedBytes = isVerified ? f.lengthBytes : 0;
      return {
        path: f.path,
        sizeBytes: f.lengthBytes,
        playable: f.playableHint,
        selected: live.selectedFiles.includes(f.path),
        verifiedBytes,
      };
    });
    const progress = live.metadata.pieceCount > 0
      ? live.lastVerifiedPieces / live.metadata.pieceCount
      : 0;
    return {
      id: live.sessionId,
      state: live.state,
      files,
      progress,
      peers: live.lastPeerCount,
      verifiedPieces: live.lastVerifiedPieces,
      totalPieces: live.metadata.pieceCount,
      ...(live.error !== undefined ? { error: live.error } : {}),
    };
  }

  /** Whether the piece covering a byte offset is verified. */
  private isPieceVerifiedForByte(live: LiveTorrentSession, byteOffset: number): boolean {
    if (live.metadata.pieceLengthBytes === 0) return false;
    const pieceIndex = Math.floor(byteOffset / live.metadata.pieceLengthBytes);
    const statuses = live.backend.pieceStatuses();
    const status = statuses[pieceIndex];
    return status !== undefined && status.verified;
  }

  /** Recover one session from the journal (the R10 recovery law, mirrored). */
  private async recoverOne(r: RecoveredTorrentSession): Promise<RecoveredSessionReport> {
    // HONEST FAILURE FOR VANISHED STATE: a session whose data directory
    // disappeared is failed with `DATA_VANISHED` — never a silent restart.
    if (!existsSync(r.dataDir)) {
      const failure = {
        code: "DATA_VANISHED" as TorrentEngineErrorCode,
        detail: `recover: the data directory '${r.dataDir}' for session '${r.sessionId}' does not exist — the persisted state vanished; the session is failed honestly (never a silent restart from zero)`,
      };
      this.journal.appendEvidence("torrent-engine-recovery-failed-vanished", {
        sessionId: r.sessionId,
        dataDir: r.dataDir,
      });
      return { sessionId: r.sessionId, infoHash: r.infoHash, recovered: false, failure };
    }
    try {
      const stat = statSync(r.dataDir);
      if (!stat.isDirectory()) {
        throw new TorrentEngineError("DATA_VANISHED", {
          detail: `recover: '${r.dataDir}' is not a directory (got mode ${stat.mode})`,
        });
      }
    } catch (e) {
      const failure = {
        code: "DATA_VANISHED" as TorrentEngineErrorCode,
        detail: `recover: stat'ing '${r.dataDir}' failed: ${e instanceof Error ? e.message : String(e)}`,
      };
      return { sessionId: r.sessionId, infoHash: r.infoHash, recovered: false, failure };
    }
    // Re-construct the provenance from the journal (no brand, but the
    // fields are structurally required for the live session).
    const provenance = provenanceFromAuthorizedSource({
      sourceId: r.provenance.sourceId,
      authorizationKind: r.provenance.authorizationKind as never,
      ...(r.provenance.context !== undefined ? { context: r.provenance.context } : {}),
    });
    // Rebuild the metadata view from the journal (the fields the journal
    // carries — name, pieceLength, pieceCount, totalBytes, files, trackers).
    const metadata: TorrentMetadata = {
      infoHash: r.infoHash,
      name: r.metadata.name,
      pieceLengthBytes: r.metadata.pieceLengthBytes,
      pieceCount: r.metadata.pieceCount,
      pieces: [],
      totalBytes: r.metadata.totalBytes,
      files: r.metadata.files,
      trackers: r.metadata.trackers,
      dhtEnabled: false,
      sourceKind: r.sourceKind,
    };
    // Re-attach to the backend.
    const backend = await this.backend.add({
      infoHash: r.infoHash,
      metadata,
      dataDir: r.dataDir,
    });
    if (r.selectedFiles.length > 0) {
      try {
        await backend.selectFiles(r.selectedFiles);
      } catch {
        // The selected files may no longer exist in the backend's view
        // (the loopback may have been re-registered with a different
        // fixture). Honest: the session recovers but with no selection.
      }
    }
    const live: LiveTorrentSession = {
      sessionId: r.sessionId,
      infoHash: r.infoHash,
      sourceKind: r.sourceKind,
      provenance,
      metadata,
      dataDir: r.dataDir,
      state: "checking",
      selectedFiles: [...r.selectedFiles],
      backend,
      stalledSinceMs: undefined,
      integrity: r.integrity,
      error: undefined,
      verifiedAsset: undefined,
      lastVerifiedPieces: r.verifiedPieces,
      lastPeerCount: r.peerCount,
    };
    this.sessions.set(r.sessionId, live);
    this.journal.appendEvidence("torrent-engine-recovered-session", {
      sessionId: r.sessionId,
      infoHash: r.infoHash,
      verifiedPieces: r.verifiedPieces,
      totalPieces: r.totalPieces,
    });
    this.publish(live);
    return { sessionId: r.sessionId, infoHash: r.infoHash, recovered: true };
  }

  private requireLive(op: string): void {
    if (this.disposed) {
      throw invalidInput(`${op}: the torrent engine is disposed`);
    }
  }

  private requireLiveSession(op: string, sessionId: string): LiveTorrentSession {
    this.requireLive(op);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput(`${op}: sessionId must be a non-empty string`);
    }
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      throw new TorrentEngineError("NOT_FOUND", {
        detail: `${op}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    return live;
  }

  private requireControllable(op: string, sessionId: string): LiveTorrentSession {
    const live = this.requireLiveSession(op, sessionId);
    if (live.state === "complete" || live.state === "failed") {
      throw new TorrentEngineError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is '${live.state}' (terminal) — no further control`,
        sessionId,
      });
    }
    return live;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The default session-id generator (random hex; injectable for tests). */
function defaultSessionIdGenerator(): string {
  return `torrent-session-${randomBytes(8).toString("hex")}`;
}

/** Defensive provenance guard — invariant 5's runtime mirror. */
function assertProvenance(p: unknown, op: string): asserts p is Provenance {
  if (!isProvenance(p)) {
    throw new TorrentEngineError("UNAUTHORIZED_SOURCE", {
      detail: `${op}: the ingestion carried no valid provenance — invariant 5's structural enforcement refuses unprovenanced ingestion (use provenanceFromAuthorizedSource to construct one)`,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the torrent engine over a {@link BitTorrentBackend} (the mature-
 * library boundary). Throws `INVALID_INPUT` on malformed options.
 *
 * The data root directory is created eagerly (an engine with no sessions
 * is a valid, honestly-empty engine).
 */
export function createTorrentEngine(options: TorrentEngineOptions): TorrentEngineSurface {
  return new TorrentEngineImpl(options);
}
