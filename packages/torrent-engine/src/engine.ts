/**
 * @wfx/torrent-engine — the engine facade (R11).
 *
 * THE ASSEMBLY: authorized ingestion (invariant 5 — the branded
 * `AuthorizedProvenance` is structurally required and re-validated at
 * runtime) -> metadata + file selection (J22) -> sessions over the mature
 * library seam (invariant 6) -> honest status/stall (J21) -> integrity
 * verdicts (piece hashes + whole-asset SHA-256, the R10 contract) ->
 * persistent recovery (the journal) -> the native-media adapter (the seam
 * R12/R13/R14 consume).
 *
 * CONSTRUCTION LAW: the ONLY way product code obtains an engine is
 * `createTorrentEngine({ library, dataRoot, sources, ... })` — the library
 * is INJECTED (production: the pinned webtorrent binding; tests: the
 * deterministic loopback double). The engine itself never names webtorrent.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { TorrentEngineError, torrentError, type TorrentResult } from "./errors";
import { createTorrentSessionJournal, type TorrentSessionJournal } from "./journal";
import {
  extractExposedAssets,
  offlineReadyIdentityKey,
  schedulerRearmInputsFromRecord,
  type ExposedTorrentExposure,
} from "./persistence";
import {
  metainfoFromLibrary,
  type TorrentMetainfo,
  type TorrentFileEntry,
} from "./metadata";
import {
  authorizeProvenance,
  revalidateProvenance,
  type AuthorizedProvenance,
  type AuthorizedSourceRegistry,
} from "./provenance";
import {
  planSelection,
  validateSelection,
  type SelectionPlan,
} from "./selection";
import {
  TorrentEngineSession,
  countBits,
  type TorrentEngineSessionInputs,
  type SessionProvenance,
  type TorrentFailureReason,
  type TorrentSelectionRequest,
  type TorrentSessionState,
  type TorrentSessionStatus,
} from "./session";
import type { ParsedMetainfo, TorrentLibrary } from "./library/contract";
import { PlaybackSessionScheduler } from "./scheduler/session-scheduler";
import type { SchedulerSessionView } from "./scheduler/session-scheduler";
import { validatePlaybackSchedulerConfig } from "./scheduler/config";
import type {
  PlaybackBufferingTruth,
  PlaybackCommand,
  PlaybackRangeRequest,
  PlaybackSchedulerConfig,
  PlaybackSchedulerConfigInput,
  PlaybackSchedulerState,
  PlaybackSchedulerStatus,
  PlaybackWindow,
} from "./scheduler";

// The session status type travels WITH the engine surface (consumers read
// statuses through the engine; the type is defined in session.ts).
export type { TorrentSessionStatus, TorrentSelectionRequest } from "./session";
// The R12 playback-scheduler vocabulary travels WITH the engine surface
// too (the barrel owns the definitions; consumers import from
// "@wfx/torrent-engine" — the lane law).
export type {
  PlaybackCommand,
  PlaybackRangeRequest,
  PlaybackSchedulerStatus,
  PlaybackSchedulerState,
  PlaybackBufferingTruth,
  PlaybackWindow,
  PlaybackSchedulerConfig,
  PlaybackSchedulerConfigInput,
  PlayableFileGeometry,
  PieceSpan,
  PlaybackDeadlineRisk,
  PlaybackStallKind,
  PlaybackAvailability,
  TrackedRangeRequest,
  PlaybackWindowKind,
  PlaybackPlanInput,
  PlaybackWindowMode,
} from "./scheduler";

// ---------------------------------------------------------------------------
// Ingestion (the public handle)
// ---------------------------------------------------------------------------

/** An authorized ingestion: what the engine parsed, with its provenance. */
export interface TorrentIngestion {
  /** The ingestion's id (engine-assigned, monotonic). */
  readonly id: string;
  /** How the torrent entered the engine. */
  readonly kind: "magnet" | "torrent-file";
  /** v1 infohash, lowercase hex. */
  readonly infoHash: string;
  /** The authorization provenance (invariant 5). */
  readonly provenance: AuthorizedProvenance;
  /** The torrent's name, when known (magnet `dn` hint or metainfo name). */
  readonly displayName?: string;
  /**
   * The file list for SELECTION before any data transfer (J22). EMPTY for
   * magnet ingestions until a session resolves the metadata.
   */
  readonly files: readonly TorrentFileEntry[];
  /** The magnet URI (magnet kind). */
  readonly magnetUri?: string;
  /** Full metainfo (torrent-file kind). */
  readonly metainfo?: TorrentMetainfo;
}

/** Internal ingestion record (carries the seam shapes + raw bytes). */
interface InternalIngestion {
  readonly public: TorrentIngestion;
  /** The seam metainfo (torrent-file kind) — the session spec input. */
  readonly seamMetainfo?: ParsedMetainfo;
  /** The raw `.torrent` bytes (torrent-file kind) — the journal input. */
  readonly rawBytes?: Uint8Array;
}

// ---------------------------------------------------------------------------
// The session handle
// ---------------------------------------------------------------------------

/** The public handle of one torrent session. */
export interface TorrentSessionHandle {
  readonly sessionId: string;
  readonly infoHash: string;
  status(): TorrentSessionStatus;
}

// ---------------------------------------------------------------------------
// Recovery report
// ---------------------------------------------------------------------------

/** One restored live session (the paused-by-restart mapping). */
export interface RecoveredTorrentSession {
  readonly sessionId: string;
  /** `seeding-paused` — the single paused state; resume continues it. */
  readonly state: "seeding-paused";
  /** What `resume()` returns to. */
  readonly resumeTarget: TorrentSessionState;
  /** The journaled verified-piece count at the control point (the PROOF). */
  readonly verifiedPieces: number;
  /**
   * R13: the pieces the library RE-VERIFIED from the bytes actually on
   * disk at recovery (the disk truth — piece-map reuse, not a claim).
   */
  readonly diskVerifiedPieces: number;
  /** R13: the resume reuses proved pieces (journal proof + disk truth). */
  readonly pieceMapReused: boolean;
}

/** One terminal session restored from the journal (terminal stays terminal). */
export interface TerminalRestoredSession {
  readonly sessionId: string;
  readonly state: "completed" | "failed";
  readonly reason?: TorrentFailureReason;
}

/** One re-armed playback scheduler (R13 — the persisted intent restored). */
export interface RearmedScheduler {
  readonly sessionId: string;
  readonly schedulerState: PlaybackSchedulerState;
  readonly positionBytes?: number;
  readonly bytesPerSecond?: number;
  readonly playableFile?:
    | { readonly fileIndex: number; readonly path: string; readonly lengthBytes: number }
    | undefined;
}

/** The honest report of a recovery pass. */
export interface TorrentRecoveryReport {
  /** Live sessions restored paused. */
  readonly recovered: readonly RecoveredTorrentSession[];
  /** Terminal sessions restored as terminal records. */
  readonly terminal: readonly TerminalRestoredSession[];
  /** Sessions the journal PROVED had progress but the data vanished. */
  readonly failed: readonly {
    readonly sessionId: string;
    readonly reason: "data-vanished";
    readonly detail: string;
  }[];
  /** Sessions already live (idempotent recovery — the R10 law). */
  readonly skipped: readonly { readonly sessionId: string }[];
  /** R13: playback schedulers re-armed from persisted checkpoints. */
  readonly rearmed: readonly RearmedScheduler[];
  /** R13: persisted scheduler checkpoints that could NOT re-arm (honest). */
  readonly rearmRefused: readonly { readonly sessionId: string; readonly detail: string }[];
}

// ---------------------------------------------------------------------------
// Engine options + surface
// ---------------------------------------------------------------------------

/** Options for {@link createTorrentEngine}. */
export interface TorrentEngineOptions {
  /** The mature BitTorrent library seam (injected — never named here). */
  readonly library: TorrentLibrary;
  /** Where the engine owns its bytes + journal (`<root>/sessions/<id>/data`). */
  readonly dataRoot: string;
  /** The authorized-source registry (invariant 5; injected). */
  readonly sources: AuthorizedSourceRegistry;
  /** Wall clock; injectable for tests. Default: Date.now. */
  readonly clock?: () => number;
  /**
   * The stall threshold: a `downloading` session with ZERO connected peers
   * this long answers `stalled: true` with the honest numbers. Default
   * 60 000 ms.
   */
  readonly stallThresholdMs?: number;
  /**
   * R17 — the metadata deadline: a `discovering-metadata` session whose
   * magnet metadata has not resolved within this many milliseconds of
   * ACTIVE discovery fails with the typed `metadata-failed` reason (the
   * named error state — no hang, no invented metadata). Paused discovery
   * does not accrue; resuming re-arms the deadline. `0` disables the
   * deadline (the R11 behavior). Default 120 000 ms.
   */
  readonly metadataTimeoutMs?: number;
  /** Journal a progress checkpoint every N verified pieces. Default 16. */
  readonly checkpointEveryPieces?: number;
  /**
   * R12: the playback scheduler's configuration (partial — validated,
   * omitted fields fall back to the exported defaults). Malformed values
   * fail engine construction honestly.
   */
  readonly schedulerConfig?: PlaybackSchedulerConfigInput;
}

// ---------------------------------------------------------------------------
// The playback surface (R12)
// ---------------------------------------------------------------------------

/** Which file a playback operation schedules/reads (default: the first SELECTED file). */
export interface PlaybackFileOptions {
  /** Index into the torrent's file list; must be part of the session's selection. */
  readonly fileIndex?: number;
}

/**
 * R12 — the playback-aware scheduler surface: the player's byte-range
 * deadlines mapped onto torrent piece priorities, with truthful buffering
 * and ordered integrity-gated reads. THE integration point the R10
 * native-media range gateway consumes: player -> range gateway ->
 * `playback.command`/`playback.noteRangeRequests` (deadline mapping) ->
 * piece priorities -> swarm; gateway reads flow through
 * `readVerifiedRange` (integrity-gated, watch-order-capable).
 */
export interface TorrentPlaybackSurface {
  /** The validated scheduler configuration (inspectable — no hidden magic). */
  readonly config: PlaybackSchedulerConfig;

  /**
   * Submit a playback command (`start`/`progress`/`seek`/`stop`) for a
   * session's playable file. The command drives the scheduler state
   * machine and re-applies piece priorities to the live library session.
   */
  command(
    sessionId: string,
    command: PlaybackCommand,
    options?: PlaybackFileOptions,
  ): TorrentResult<PlaybackSchedulerStatus>;

  /**
   * Note the player's explicit byte-range requests (the range gateway's
   * observed demand): each becomes a CRITICAL piece window carrying its
   * deadline. The latest batch replaces the previous one. Requests are
   * FILE-RELATIVE to the session's scheduled playable file (the file the
   * playback commands bound).
   */
  noteRangeRequests(
    sessionId: string,
    requests: readonly PlaybackRangeRequest[],
  ): TorrentResult<PlaybackSchedulerStatus>;

  /**
   * THE TRUTHFUL BUFFERING ANSWER: verified runway seconds, deadlines at
   * risk (with the honest arithmetic), the stall kind (slow swarm vs no
   * completion path), and the piece-availability horizon. Nothing
   * unverified is ever reported playable.
   */
  truth(sessionId: string): TorrentResult<PlaybackBufferingTruth>;

  /**
   * THE ORDERED INTEGRITY-GATED READ: real bytes of the playable file,
   * served only when every covering piece is verified (R11's verdict
   * discipline gates what the player consumes). `UNVERIFIED_RANGE` names
   * the missing pieces; the same read succeeds once they verify.
   */
  readVerifiedRange(
    sessionId: string,
    request: { readonly offsetBytes: number; readonly lengthBytes: number },
    options?: PlaybackFileOptions,
  ): Promise<TorrentResult<Uint8Array>>;

  /**
   * Refresh every scheduled session's plan against the live piece state
   * (no hidden timers — the host owns cadence). Fact-driven transitions
   * (startup window satisfied, seek burst satisfied) are evaluated here.
   */
  tick(): TorrentResult<{ readonly replanned: number }>;

  /** The scheduler state of one session (diagnostics). */
  state(sessionId: string): TorrentResult<PlaybackSchedulerState>;

  /** The current window plan of one session (diagnostics). */
  windows(sessionId: string): TorrentResult<readonly PlaybackWindow[]>;
}

/** The torrent engine's public surface (WebFlix types only). */
export interface TorrentEngine {
  /** The wrapped library's identity (inspectable — invariant 10). */
  readonly libraryImplementation: string;
  readonly dataRoot: string;
  readonly journalPath: string;

  /** Ingest an authorized magnet URI (typed PROVENANCE_REJECTED without one). */
  ingestMagnet(
    uri: string,
    provenance: AuthorizedProvenance,
  ): Promise<TorrentResult<TorrentIngestion>>;
  /** Ingest authorized `.torrent` bytes (typed PROVENANCE_REJECTED without one). */
  ingestTorrentFile(
    bytes: Uint8Array,
    provenance: AuthorizedProvenance,
  ): Promise<TorrentResult<TorrentIngestion>>;
  /** The live ingestions (selection surfaces — J22). */
  ingestions(): readonly TorrentIngestion[];

  /**
   * Create a session for an ingestion. Selection: file indexes (torrent-file
   * kind), file paths (magnet kind — resolved at metadata), or the default
   * (every file). Rejects a duplicate LIVE session for the same infohash.
   */
  createSession(
    ingestionId: string,
    options?: { selection?: TorrentSelectionRequest },
  ): Promise<TorrentResult<TorrentSessionHandle>>;

  /** Live + restored session ids. */
  sessions(): readonly string[];
  /** The honest status answer (typed NOT_FOUND for unknown/stopped ids). */
  status(sessionId: string): TorrentResult<TorrentSessionStatus>;
  pause(sessionId: string): TorrentResult<void>;
  resume(sessionId: string): TorrentResult<void>;
  /** Stop the live session (recoverable — restart restores it paused). */
  stop(sessionId: string): Promise<TorrentResult<void>>;

  /**
   * R12 — the playback-aware scheduler surface: deadline mapping onto
   * piece priorities, truthful buffering, and ordered integrity-gated
   * reads. See {@link TorrentPlaybackSurface}.
   */
  readonly playback: TorrentPlaybackSurface;

  /**
   * Replay the journal after a restart/crash: live sessions return PAUSED
   * with their journaled control points, terminal sessions stay terminal,
   * and VANISHED DATA (progress proved but bytes gone) is an honest
   * `data-vanished` failure — never a silent restart from zero.
   * R13: the playback scheduler of every restored live session is RE-ARMED
   * from its persisted checkpoint (state + playhead + priorities — honestly
   * resuming, never fresh), and the journal is compacted (the atomic
   * rotation) so a restart also bounds the journal's growth.
   * Idempotent.
   */
  recover(): Promise<TorrentResult<TorrentRecoveryReport>>;

  /**
   * R13 — the durable library-exposure truth: every offline-ready exposure
   * the journal proves (a pure fold; one exposure per identity key, the
   * R04 canonical composition winning duplicates). Survives restarts.
   */
  exposedAssets(): readonly ExposedTorrentExposure[];

  /**
   * R13 — record ONE verified-asset exposure (the adapter's seam). The
   * engine validates the VERIFIED-BEFORE-READY law against the journal
   * itself: the session must be recorded `completed` and every asset's
   * digest must match the journaled completion digests — a typed refusal
   * otherwise (never an exposure of unverified bytes). The provenance and
   * infohash come from the JOURNALED session record, never the caller.
   */
  recordAssetExposure(input: {
    sessionId: string;
    assets: readonly {
      assetId: string;
      sourcePath: string;
      contentPath: string;
      sizeBytes: number;
      sha256: string;
      contentType?: string;
    }[];
    /** The R04 canonical-identity composition, when the caller has one. */
    library?: { profileKey: string; canonicalItemId: string };
  }): TorrentResult<ExposedTorrentExposure>;

  /** Tear the engine down (destroys library sessions; journal persists). */
  destroy(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_STALL_THRESHOLD_MS = 60_000;
const DEFAULT_METADATA_TIMEOUT_MS = 120_000;
const DEFAULT_CHECKPOINT_EVERY_PIECES = 16;

class TorrentEngineImpl implements TorrentEngine {
  readonly libraryImplementation: string;
  readonly dataRoot: string;
  readonly playback: TorrentPlaybackSurface;

  private readonly library: TorrentLibrary;
  private readonly sources: AuthorizedSourceRegistry;
  private readonly journal: TorrentSessionJournal;
  private readonly clock: () => number;
  private readonly stallThresholdMs: number;
  private readonly metadataTimeoutMs: number;
  private readonly checkpointEveryPieces: number;
  private readonly schedulerConfig: PlaybackSchedulerConfig;
  private readonly sessionsById = new Map<string, TorrentEngineSession>();
  private readonly schedulersBySession = new Map<string, PlaybackSessionScheduler>();
  private readonly ingestionsById = new Map<string, InternalIngestion>();
  private nextIngestionNumber: number;

  constructor(options: TorrentEngineOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail: "createTorrentEngine: options must be an object",
      });
    }
    if (typeof options.library !== "object" || options.library === null) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail: "createTorrentEngine: a TorrentLibrary must be injected (invariant 6 — the engine wraps a mature implementation, it never implements the protocol)",
      });
    }
    if (typeof options.dataRoot !== "string" || options.dataRoot.trim().length === 0) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail: "createTorrentEngine: dataRoot must be a non-empty string",
      });
    }
    if (typeof options.sources !== "object" || options.sources === null) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail: "createTorrentEngine: an AuthorizedSourceRegistry must be injected (invariant 5 — the engine never invents authorization)",
      });
    }
    const schedulerValidated = validatePlaybackSchedulerConfig(options.schedulerConfig);
    if (!schedulerValidated.ok) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail: `createTorrentEngine: the playback scheduler config is malformed: ${schedulerValidated.error.detail}`,
      });
    }
    this.library = options.library;
    this.libraryImplementation = options.library.implementation;
    this.dataRoot = options.dataRoot;
    this.sources = options.sources;
    this.clock = options.clock ?? (() => Date.now());
    this.stallThresholdMs =
      options.stallThresholdMs === undefined
        ? DEFAULT_STALL_THRESHOLD_MS
        : options.stallThresholdMs;
    if (
      options.metadataTimeoutMs !== undefined &&
      (!Number.isFinite(options.metadataTimeoutMs) || options.metadataTimeoutMs < 0)
    ) {
      throw new TorrentEngineError("INVALID_INPUT", {
        detail: `createTorrentEngine: metadataTimeoutMs must be a finite number >= 0 (0 disables the deadline), got ${String(options.metadataTimeoutMs)}`,
      });
    }
    this.metadataTimeoutMs =
      options.metadataTimeoutMs === undefined
        ? DEFAULT_METADATA_TIMEOUT_MS
        : options.metadataTimeoutMs;
    this.checkpointEveryPieces =
      options.checkpointEveryPieces === undefined
        ? DEFAULT_CHECKPOINT_EVERY_PIECES
        : options.checkpointEveryPieces;
    this.schedulerConfig = schedulerValidated.value;
    this.journal = createTorrentSessionJournal(options.dataRoot, { clock: this.clock });
    this.nextIngestionNumber = 1;
    this.playback = this.buildPlaybackSurface();
  }

  get journalPath(): string {
    return this.journal.path;
  }

  // --- ingestion -------------------------------------------------------------

  async ingestMagnet(
    uri: string,
    provenance: AuthorizedProvenance,
  ): Promise<TorrentResult<TorrentIngestion>> {
    const provenanceCheck = revalidateProvenance(this.sources, provenance);
    if (!provenanceCheck.ok) return provenanceCheck;
    if (typeof uri !== "string" || uri.trim().length === 0) {
      return torrentError("INVALID_MAGNET", {
        detail: "ingestMagnet: uri must be a non-empty magnet URI string",
      });
    }
    const parsed = await this.library.parseMagnet(uri);
    if (!parsed.ok) return parsed;
    const ingestion: TorrentIngestion = {
      id: `ing-${this.nextIngestionNumber++}`,
      kind: "magnet",
      infoHash: parsed.value.infoHash,
      provenance,
      files: [],
      ...(parsed.value.displayName !== undefined
        ? { displayName: parsed.value.displayName }
        : {}),
      magnetUri: uri,
    };
    this.ingestionsById.set(ingestion.id, { public: ingestion });
    return { ok: true, value: ingestion };
  }

  async ingestTorrentFile(
    bytes: Uint8Array,
    provenance: AuthorizedProvenance,
  ): Promise<TorrentResult<TorrentIngestion>> {
    const provenanceCheck = revalidateProvenance(this.sources, provenance);
    if (!provenanceCheck.ok) return provenanceCheck;
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return torrentError("INVALID_TORRENT_FILE", {
        detail: "ingestTorrentFile: bytes must be a non-empty Uint8Array of .torrent metainfo",
      });
    }
    const parsed = await this.library.parseTorrentFile(bytes);
    if (!parsed.ok) return parsed;
    const metainfo = metainfoFromLibrary(parsed.value);
    const ingestion: TorrentIngestion = {
      id: `ing-${this.nextIngestionNumber++}`,
      kind: "torrent-file",
      infoHash: metainfo.infoHash,
      provenance,
      files: metainfo.files,
      displayName: metainfo.name,
      metainfo,
    };
    this.ingestionsById.set(ingestion.id, {
      public: ingestion,
      seamMetainfo: parsed.value,
      rawBytes: bytes,
    });
    return { ok: true, value: ingestion };
  }

  ingestions(): readonly TorrentIngestion[] {
    return [...this.ingestionsById.values()].map((entry) => entry.public);
  }

  // --- sessions ---------------------------------------------------------------

  async createSession(
    ingestionId: string,
    options: { selection?: TorrentSelectionRequest } = {},
  ): Promise<TorrentResult<TorrentSessionHandle>> {
    const entry = this.ingestionsById.get(ingestionId);
    if (entry === undefined) {
      return torrentError("NOT_FOUND", {
        detail: `createSession: no ingestion '${ingestionId}' exists (ingest first)`,
      });
    }
    const ingestion = entry.public;
    const selection = options.selection ?? {};
    // Input validation FIRST (a malformed selection is rejected regardless
    // of session state — input laws precede state laws).
    if (selection.fileIndexes !== undefined && ingestion.kind === "magnet") {
      return torrentError("INVALID_SELECTION", {
        detail:
          "createSession: a magnet's file list is unknown until metadata resolves — select by filePaths or accept the default (every file)",
      });
    }
    if (this.hasLiveSessionFor(ingestion.infoHash)) {
      return torrentError("INVALID_STATE", {
        detail: `createSession: a live session already exists for infohash ${ingestion.infoHash} (the mature library's duplicate law — stop it first)`,
      });
    }
    if (ingestion.kind === "torrent-file" && ingestion.metainfo !== undefined) {
      if (selection.fileIndexes !== undefined) {
        const validated = validateSelection(
          ingestion.metainfo.files,
          selection.fileIndexes,
        );
        if (!validated.ok) return validated;
      }
      if (selection.filePaths !== undefined && selection.filePaths.length > 0) {
        const indexes = selection.filePaths.map((wanted) =>
          ingestion.metainfo!.files.findIndex(
            (f) => f.path === wanted || f.name === wanted,
          ),
        );
        if (indexes.some((i) => i === -1)) {
          return torrentError("INVALID_SELECTION", {
            detail: "createSession: the selection names a file that is not in the torrent's file list",
          });
        }
      }
    }

    const sessionId = `ts-${this.nextSessionNumber()}`;
    const dataDir = join(this.dataRoot, "sessions", sessionId, "data");
    this.journal.appendSessionStarted({
      sessionId,
      ingestionKind: ingestion.kind,
      infoHash: ingestion.infoHash,
      provenance: {
        sourceId: ingestion.provenance.sourceId,
        basis: ingestion.provenance.basis,
      },
      dataDir,
      selection:
        ingestion.kind === "torrent-file" && selection.fileIndexes === undefined
          ? (ingestion.metainfo?.files ?? []).map((_, index) => index)
          : (selection.fileIndexes ?? []),
      ...(ingestion.magnetUri !== undefined ? { magnetUri: ingestion.magnetUri } : {}),
      ...(entry.rawBytes !== undefined
        ? { metainfoB64: Buffer.from(entry.rawBytes).toString("base64") }
        : {}),
      ...(ingestion.displayName !== undefined
        ? { torrentName: ingestion.displayName }
        : {}),
    });

    const spec =
      ingestion.kind === "magnet"
        ? {
            dataDir,
            ...(ingestion.magnetUri !== undefined ? { magnetUri: ingestion.magnetUri } : {}),
            selectedFileIndexes: [] as readonly number[],
            verifyExistingData: false,
          }
        : {
            dataDir,
            metainfo: entry.seamMetainfo!,
            ...(entry.rawBytes !== undefined ? { metainfoBytes: entry.rawBytes } : {}),
            selectedFileIndexes: resolveInitialSelection(
              ingestion.metainfo!.files,
              selection,
            ),
            verifyExistingData: false,
          };
    const librarySession = await this.library.createSession(spec);
    if (!librarySession.ok) {
      this.journal.appendFailed({
        sessionId,
        reason: "library-error",
        detail: `the library refused to create the session: ${librarySession.error.detail}`,
      });
      return librarySession;
    }

    const session = TorrentEngineSession.createLive(
      {
        sessionId,
        ingestionKind: ingestion.kind,
        infoHash: ingestion.infoHash,
        provenance: ingestion.provenance,
        dataDir,
        ...(ingestion.magnetUri !== undefined ? { magnetUri: ingestion.magnetUri } : {}),
        ...(ingestion.metainfo !== undefined ? { metainfo: ingestion.metainfo } : {}),
        selectionRequest: selection,
        library: this.library,
        journal: this.journal,
        clock: this.clock,
        stallThresholdMs: this.stallThresholdMs,
        metadataTimeoutMs: this.metadataTimeoutMs,
        checkpointEveryPieces: this.checkpointEveryPieces,
      },
      librarySession.value,
    );
    this.sessionsById.set(sessionId, session);
    return { ok: true, value: { sessionId, infoHash: session.infoHash, status: () => session.status() } };
  }

  sessions(): readonly string[] {
    return [...this.sessionsById.keys()];
  }

  status(sessionId: string): TorrentResult<TorrentSessionStatus> {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined) {
      return torrentError("NOT_FOUND", {
        sessionId,
        detail:
          "status: no such session is live (it may have been stopped — its persisted state is recoverable on engine restart via recover())",
      });
    }
    return { ok: true, value: session.status() };
  }

  pause(sessionId: string): TorrentResult<void> {
    const session = this.requireSession(sessionId, "pause");
    if (!session.ok) return session;
    return session.value.pause();
  }

  resume(sessionId: string): TorrentResult<void> {
    const session = this.requireSession(sessionId, "resume");
    if (!session.ok) return session;
    return session.value.resume();
  }

  async stop(sessionId: string): Promise<TorrentResult<void>> {
    const session = this.requireSession(sessionId, "stop");
    if (!session.ok) return session;
    const stopped = await session.value.stop();
    if (stopped.ok) {
      // R13: the user STOPPED the session — the playback intent honestly
      // ends with it (the R11 law). A final `idle` checkpoint lands so a
      // restart restores the session paused WITHOUT re-arming a plan the
      // user abandoned (a fresh playback command starts a fresh plan).
      const scheduler = this.schedulersBySession.get(sessionId);
      if (scheduler !== undefined) {
        this.journal.appendSchedulerCheckpoint({
          sessionId,
          schedulerState: "idle",
          rangeRequests: [],
          priorities: [],
          reason: "session-stopped",
        });
      }
      this.sessionsById.delete(sessionId);
      // The scheduler slot detaches with the session (a crash mid-STOP —
      // before the idle checkpoint — still recovers the last real plan).
      this.schedulersBySession.get(sessionId)?.detach();
      this.schedulersBySession.delete(sessionId);
    }
    return stopped;
  }

  // --- R12: the playback scheduler surface -------------------------------------

  /** The engine-internal live view of one session (fresh accessors only). */
  private schedulerViewFor(session: TorrentEngineSession): SchedulerSessionView {
    return {
      sessionId: session.sessionId,
      state: () => session.currentState(),
      metainfo: () => session.resolvedMetainfo(),
      plan: () => session.selectionPlan(),
      dataDir: session.dataDir,
      snapshot: () => session.librarySnapshot(),
      stallFacts: () => session.stallFacts(),
      applyPiecePriorities: (hints) => session.applyPiecePriorities(hints),
    };
  }

  /** The per-session scheduler (created on first playback contact). */
  private schedulerFor(sessionId: string): TorrentResult<{
    session: TorrentEngineSession;
    scheduler: PlaybackSessionScheduler;
  }> {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined) {
      return torrentError("NOT_FOUND", {
        sessionId,
        detail:
          "playback: no such session is live (it may have been stopped — its persisted state is recoverable on engine restart via recover())",
      });
    }
    let scheduler = this.schedulersBySession.get(sessionId);
    if (scheduler === undefined) {
      scheduler = new PlaybackSessionScheduler(this.schedulerConfig, this.clock, {
        persist: (payload) => this.persistSchedulerCheckpoint(sessionId, payload),
      });
      this.schedulersBySession.set(sessionId, scheduler);
    }
    return { ok: true, value: { session, scheduler } };
  }

  /** R13: the journal hook every scheduler checkpoint flows through. */
  private persistSchedulerCheckpoint(
    sessionId: string,
    payload: {
      schedulerState: PlaybackSchedulerState;
      fileIndex?: number;
      positionBytes?: number;
      bytesPerSecond?: number;
      seekTargetBytes?: number;
      rangeRequests: readonly {
        offsetBytes: number;
        lengthBytes: number;
        deadlineMs: number;
        receivedAtMs: number;
      }[];
      priorities: readonly { fromPiece: number; toPiece: number; urgency: number }[];
      reason: string;
    },
  ): void {
    this.journal.appendSchedulerCheckpoint({
      sessionId,
      schedulerState: payload.schedulerState,
      ...(payload.fileIndex !== undefined ? { fileIndex: payload.fileIndex } : {}),
      ...(payload.positionBytes !== undefined ? { positionBytes: payload.positionBytes } : {}),
      ...(payload.bytesPerSecond !== undefined
        ? { bytesPerSecond: payload.bytesPerSecond }
        : {}),
      ...(payload.seekTargetBytes !== undefined
        ? { seekTargetBytes: payload.seekTargetBytes }
        : {}),
      rangeRequests: payload.rangeRequests,
      priorities: payload.priorities,
      reason: payload.reason,
    });
  }

  private buildPlaybackSurface(): TorrentPlaybackSurface {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the surface's closures must outlive method scope; a WeakMap-free, allocation-free alias is the honest tool (the R10 binding's precedent)
    const engine = this;
    return {
      get config(): PlaybackSchedulerConfig {
        return engine.schedulerConfig;
      },

      command(
        sessionId: string,
        command: PlaybackCommand,
        options?: PlaybackFileOptions,
      ): TorrentResult<PlaybackSchedulerStatus> {
        const resolved = engine.schedulerFor(sessionId);
        if (!resolved.ok) return resolved;
        return resolved.value.scheduler.command(
          engine.schedulerViewFor(resolved.value.session),
          command,
          options?.fileIndex,
        );
      },

      noteRangeRequests(
        sessionId: string,
        requests: readonly PlaybackRangeRequest[],
      ): TorrentResult<PlaybackSchedulerStatus> {
        const resolved = engine.schedulerFor(sessionId);
        if (!resolved.ok) return resolved;
        return resolved.value.scheduler.noteRangeRequests(
          engine.schedulerViewFor(resolved.value.session),
          requests,
        );
      },

      truth(sessionId: string): TorrentResult<PlaybackBufferingTruth> {
        const resolved = engine.schedulerFor(sessionId);
        if (!resolved.ok) return resolved;
        return {
          ok: true,
          value: resolved.value.scheduler.truth(
            engine.schedulerViewFor(resolved.value.session),
          ),
        };
      },

      async readVerifiedRange(
        sessionId: string,
        request: { readonly offsetBytes: number; readonly lengthBytes: number },
        options?: PlaybackFileOptions,
      ): Promise<TorrentResult<Uint8Array>> {
        const resolved = engine.schedulerFor(sessionId);
        if (!resolved.ok) return resolved;
        return resolved.value.scheduler.readVerifiedRange(
          engine.schedulerViewFor(resolved.value.session),
          request,
          options?.fileIndex,
        );
      },

      tick(): TorrentResult<{ readonly replanned: number }> {
        let replanned = 0;
        for (const [sessionId, scheduler] of engine.schedulersBySession) {
          const session = engine.sessionsById.get(sessionId);
          if (session === undefined) continue; // detached racing a stop
          const outcome = scheduler.replan(engine.schedulerViewFor(session));
          if (!outcome.ok) return outcome;
          if (outcome.value) replanned += 1;
        }
        return { ok: true, value: { replanned } };
      },

      state(sessionId: string): TorrentResult<PlaybackSchedulerState> {
        const resolved = engine.schedulerFor(sessionId);
        if (!resolved.ok) return resolved;
        return { ok: true, value: resolved.value.scheduler.schedulerState() };
      },

      windows(sessionId: string): TorrentResult<readonly PlaybackWindow[]> {
        const resolved = engine.schedulerFor(sessionId);
        if (!resolved.ok) return resolved;
        return { ok: true, value: resolved.value.scheduler.windows() };
      },
    };
  }

  // --- recovery ----------------------------------------------------------------

  async recover(): Promise<TorrentResult<TorrentRecoveryReport>> {
    const recovered: RecoveredTorrentSession[] = [];
    const terminal: TerminalRestoredSession[] = [];
    const failed: {
      sessionId: string;
      reason: "data-vanished";
      detail: string;
    }[] = [];
    const skipped: { sessionId: string }[] = [];
    const rearmed: RearmedScheduler[] = [];
    const rearmRefused: { sessionId: string; detail: string }[] = [];
    for (const view of this.journal.sessions()) {
      const sessionId = view.sessionId;
      if (this.sessionsById.has(sessionId)) {
        skipped.push({ sessionId });
        continue; // already live — idempotent recovery
      }
      const started = view.started;

      // INVARIANT 5 SURVIVES RESTARTS: re-mint the provenance against the
      // CURRENT registry. A source that is no longer authorized cannot
      // have its session resumed — it fails honestly, typed.
      const reminted = authorizeProvenance(this.sources, started.provenance.sourceId);
      const context = await this.restoreContext(view);
      if (!reminted.ok) {
        const detail =
          `recovery: the session's authorized source '${started.provenance.sourceId}' is no longer in the registry — ` +
          "invariant 5 survives restarts; the session is failed, never resumed without authorization.";
        this.journal.appendFailed({ sessionId, reason: "provenance-revoked", detail });
        // The tombstone carries the JOURNALED provenance (the historical
        // fact) — inspectable, honestly un-resumable.
        const session = TorrentEngineSession.createRestoredTerminal(
          this.sessionInputsFor(view, started.provenance, context.metainfo, context.selectionIndexes),
          { kind: "failed", reason: "provenance-revoked", detail },
          { metainfo: context.metainfo, plan: context.plan, verifiedPieces: view.checkpoint?.verifiedPieces ?? 0 },
        );
        this.sessionsById.set(sessionId, session);
        failed.push({ sessionId, reason: "data-vanished", detail });
        continue;
      }
      const provenance = reminted.value;

      if (view.terminal !== undefined) {
        // Terminal stays terminal (the R10 law).
        const session =
          view.terminal.kind === "completed"
            ? TorrentEngineSession.createRestoredTerminal(
                this.sessionInputsFor(view, provenance, context.metainfo, context.selectionIndexes),
                { kind: "completed", files: view.terminal.files },
                {
                  metainfo: context.metainfo,
                  plan: context.plan,
                  verifiedPieces: view.checkpoint?.verifiedPieces ?? 0,
                },
              )
            : TorrentEngineSession.createRestoredTerminal(
                this.sessionInputsFor(view, provenance, context.metainfo, context.selectionIndexes),
                { kind: "failed", reason: view.terminal.reason, detail: view.terminal.detail },
                {
                  metainfo: context.metainfo,
                  plan: context.plan,
                  verifiedPieces: view.checkpoint?.verifiedPieces ?? 0,
                },
              );
        this.sessionsById.set(sessionId, session);
        terminal.push({
          sessionId,
          state: view.terminal.kind === "completed" ? "completed" : "failed",
          ...(view.terminal.kind === "failed" ? { reason: view.terminal.reason } : {}),
        });
        continue;
      }

      // Live session: check the DATA before promising continuity.
      const persistedPieces = view.checkpoint?.verifiedPieces ?? 0;
      if (persistedPieces > 0 && !directoryHasFiles(started.dataDir)) {
        const detail =
          `recovery: the journal proves ${persistedPieces} verified piece(s) for '${sessionId}' ` +
          `but the data directory '${started.dataDir}' contains no bytes — the data vanished. ` +
          "Restarting from zero while claiming continuity would be dishonest; the session is failed. " +
          "(Re-ingest and start a fresh session to re-acquire.)";
        this.journal.appendFailed({
          sessionId,
          reason: "data-vanished",
          detail,
        });
        const session = TorrentEngineSession.createRestoredTerminal(
          this.sessionInputsFor(view, provenance, context.metainfo, context.selectionIndexes),
          { kind: "failed", reason: "data-vanished", detail },
          { metainfo: context.metainfo, plan: context.plan, verifiedPieces: 0 },
        );
        this.sessionsById.set(sessionId, session);
        failed.push({ sessionId, reason: "data-vanished", detail });
        continue;
      }

      // Honest resume: restore PAUSED at the journaled control point.
      const resumeTarget = normalizeResumeTarget(view.lastState);
      const journaledBytes =
        started.metainfoB64 !== undefined
          ? new Uint8Array(Buffer.from(started.metainfoB64, "base64"))
          : undefined;
      // R13 — PIECE-MAP-AWARE MAGNET RESUME: when the journal holds the
      // magnet session's resolved metadata + selection, the library session
      // is re-created with the JOURNALED selection and DISK RE-VERIFICATION —
      // the piece map is rebuilt from the bytes that provably landed (no
      // redownload-from-zero). Without journaled metadata there are no piece
      // hashes to verify against yet — the honest pre-metadata restart.
      const magnetMetadataKnown =
        started.ingestionKind === "magnet" &&
        view.metadata !== undefined &&
        context.selectionIndexes.length > 0;
      const spec =
        started.ingestionKind === "magnet"
          ? {
              dataDir: started.dataDir,
              ...(started.magnetUri !== undefined ? { magnetUri: started.magnetUri } : {}),
              selectedFileIndexes: magnetMetadataKnown
                ? context.selectionIndexes
                : ([] as readonly number[]),
              verifyExistingData: magnetMetadataKnown,
            }
          : {
              dataDir: started.dataDir,
              metainfo: context.seamMetainfo!,
              ...(journaledBytes !== undefined ? { metainfoBytes: journaledBytes } : {}),
              selectedFileIndexes: started.selection,
              verifyExistingData: true,
            };
      const librarySession = await this.library.createSession(spec);
      if (!librarySession.ok) {
        const detail = `recovery could not re-create the library session: ${librarySession.error.detail}`;
        this.journal.appendFailed({
          sessionId,
          reason: "library-error",
          detail,
        });
        const session = TorrentEngineSession.createRestoredTerminal(
          this.sessionInputsFor(view, provenance, context.metainfo, context.selectionIndexes),
          { kind: "failed", reason: "library-error", detail },
          { metainfo: context.metainfo, plan: context.plan, verifiedPieces: 0 },
        );
        this.sessionsById.set(sessionId, session);
        failed.push({ sessionId, reason: "data-vanished", detail });
        continue;
      }
      const session = TorrentEngineSession.createRestoredPaused(
        this.sessionInputsFor(view, provenance, context.metainfo, context.selectionIndexes),
        {
          metainfo: context.metainfo,
          plan: context.plan,
          verifiedPieces: persistedPieces,
          resumeTarget,
        },
        librarySession.value,
      );
      this.sessionsById.set(sessionId, session);
      // R13 — the piece-map reuse truth: what the library RE-VERIFIED from
      // the bytes actually on disk, right now, with ZERO transfers (the
      // disk truth alongside the journal's control-point proof).
      const totalPieces = context.metainfo?.pieceCount ?? 0;
      const diskVerifiedPieces = countBits(
        librarySession.value.snapshot().bitfield,
        totalPieces,
      );
      recovered.push({
        sessionId,
        state: "seeding-paused",
        resumeTarget,
        verifiedPieces: persistedPieces,
        diskVerifiedPieces,
        pieceMapReused: persistedPieces > 0 && diskVerifiedPieces > 0,
      });

      // R13 — RE-ARM the playback scheduler from the persisted checkpoint:
      // the session restores PAUSED (the paused law: completion priority,
      // hints cleared); the scheduler reconstructs its persisted state so
      // the next tick/command after resume continues the SAME plan —
      // honestly resuming, never fresh. An `idle` checkpoint (a session the
      // user stopped) carries no intent and is skipped by design.
      const checkpoint = view.schedulerCheckpoint;
      if (checkpoint !== undefined && checkpoint.schedulerState !== "idle") {
        const inputs = schedulerRearmInputsFromRecord(checkpoint);
        if (!inputs.ok) {
          rearmRefused.push({
            sessionId,
            detail: `the persisted scheduler checkpoint is malformed and was not re-armed: ${inputs.error.detail}`,
          });
        } else {
          const scheduler = new PlaybackSessionScheduler(
            this.schedulerConfig,
            this.clock,
            { persist: (payload) => this.persistSchedulerCheckpoint(sessionId, payload) },
          );
          const outcome = scheduler.rearm(this.schedulerViewFor(session), inputs.value);
          if (!outcome.ok) {
            rearmRefused.push({
              sessionId,
              detail: `the persisted scheduler checkpoint could not re-arm: ${outcome.error.detail}`,
            });
          } else {
            this.schedulersBySession.set(sessionId, scheduler);
            rearmed.push({
              sessionId,
              schedulerState: outcome.value.schedulerState,
              ...(outcome.value.positionBytes !== undefined
                ? { positionBytes: outcome.value.positionBytes }
                : {}),
              ...(outcome.value.bytesPerSecond !== undefined
                ? { bytesPerSecond: outcome.value.bytesPerSecond }
                : {}),
              ...(outcome.value.playableFile !== undefined
                ? { playableFile: outcome.value.playableFile }
                : {}),
            });
          }
        }
      }
    }
    // R13 — the journal rotation: compact ATOMICALLY (fold-equivalent; the
    // exposure audit trail + terminal facts + latest control points stay)
    // so a restart also bounds the journal's growth. THEN the evidence lands
    // (evidence records are dropped by the NEXT compaction — diagnostics,
    // never recovery state).
    const compaction = this.journal.compact();
    const report: TorrentRecoveryReport = {
      recovered,
      terminal,
      failed,
      skipped,
      rearmed,
      rearmRefused,
    };
    this.journal.appendEvidence("recovery-complete", {
      recovered: report.recovered.length,
      terminal: report.terminal.length,
      failed: report.failed.length,
      skipped: report.skipped.length,
      rearmed: report.rearmed.length,
      rearmRefused: report.rearmRefused.length,
      journalCompacted: compaction,
    });
    return { ok: true, value: report };
  }

  // --- R13: the library-exposure surface ---------------------------------------

  exposedAssets(): readonly ExposedTorrentExposure[] {
    return extractExposedAssets(this.journal.readAll());
  }

  recordAssetExposure(input: {
    sessionId: string;
    assets: readonly {
      assetId: string;
      sourcePath: string;
      contentPath: string;
      sizeBytes: number;
      sha256: string;
      contentType?: string;
    }[];
    library?: { profileKey: string; canonicalItemId: string };
  }): TorrentResult<ExposedTorrentExposure> {
    if (typeof input !== "object" || input === null) {
      return torrentError("INVALID_INPUT", {
        detail: "recordAssetExposure: input must be an object",
      });
    }
    if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      return torrentError("INVALID_INPUT", {
        detail: "recordAssetExposure: sessionId must be a non-empty string",
      });
    }
    if (!Array.isArray(input.assets) || input.assets.length === 0) {
      return torrentError("INVALID_INPUT", {
        detail:
          "recordAssetExposure: assets must be a non-empty array (an exposure batch with no assets is not an exposure)",
      });
    }
    for (const asset of input.assets) {
      if (
        typeof asset !== "object" || asset === null ||
        typeof asset.assetId !== "string" || asset.assetId.trim().length === 0 ||
        typeof asset.sourcePath !== "string" || asset.sourcePath.trim().length === 0 ||
        typeof asset.contentPath !== "string" || asset.contentPath.trim().length === 0 ||
        typeof asset.sizeBytes !== "number" || !Number.isSafeInteger(asset.sizeBytes) ||
        asset.sizeBytes <= 0 ||
        typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256)
      ) {
        return torrentError("INVALID_INPUT", {
          sessionId: input.sessionId,
          detail:
            "recordAssetExposure: each asset must be { assetId, sourcePath, contentPath non-empty; sizeBytes a positive safe integer; sha256 64 lowercase hex }",
        });
      }
      if (asset.contentType !== undefined && typeof asset.contentType !== "string") {
        return torrentError("INVALID_INPUT", {
          sessionId: input.sessionId,
          detail: "recordAssetExposure: contentType must be a string when present",
        });
      }
    }
    if (
      input.library !== undefined &&
      (typeof input.library !== "object" || input.library === null ||
        typeof input.library.profileKey !== "string" || input.library.profileKey.trim().length === 0 ||
        typeof input.library.canonicalItemId !== "string" ||
        input.library.canonicalItemId.trim().length === 0)
    ) {
      return torrentError("INVALID_INPUT", {
        sessionId: input.sessionId,
        detail:
          "recordAssetExposure: the library identity must be { profileKey, canonicalItemId } non-empty strings (the R04 canonical composition)",
      });
    }

    // THE VERIFIED-BEFORE-READY LAW (enforced against the JOURNAL itself —
    // the engine refuses to record an exposure the journal cannot prove):
    // the session must be recorded TERMINAL-COMPLETED with per-file
    // digests, and every exposed asset must match the journaled digest.
    const view = this.journal
      .sessions()
      .find((candidate) => candidate.sessionId === input.sessionId);
    if (view === undefined) {
      return torrentError("NOT_FOUND", {
        sessionId: input.sessionId,
        detail: "recordAssetExposure: the journal holds no such session",
      });
    }
    if (view.terminal === undefined || view.terminal.kind !== "completed") {
      return torrentError("INVALID_STATE", {
        sessionId: input.sessionId,
        detail:
          "recordAssetExposure: verified-before-ready — the journal does not prove this session " +
          "completed integrity verification, so its assets may not be exposed as offline-ready " +
          "(only a `completed` session's digests are exposure-grade evidence)",
      });
    }
    for (const asset of input.assets) {
      const digest = view.terminal.files.find((file) => file.path === asset.sourcePath);
      if (digest === undefined) {
        return torrentError("INVALID_STATE", {
          sessionId: input.sessionId,
          detail:
            `recordAssetExposure: the completed session's digest record does not name '${asset.sourcePath}' — ` +
            "an asset that was not part of the verified selection may not be exposed",
        });
      }
      if (digest.sha256 !== asset.sha256 || digest.sizeBytes !== asset.sizeBytes) {
        return torrentError("INVALID_STATE", {
          sessionId: input.sessionId,
          detail:
            `recordAssetExposure: digest cross-check FAILED for '${asset.sourcePath}': the exposure claims ` +
            `${asset.sha256} (${asset.sizeBytes} bytes) but the journal's completion record proves ` +
            `${digest.sha256} (${digest.sizeBytes} bytes) — the bytes changed between verification and exposure`,
        });
      }
    }

    // The provenance + infohash come from the JOURNALED session record —
    // authorization is a durable fact, never re-supplied by the caller.
    const started = view.started;
    const record = this.journal.appendAssetExposure({
      sessionId: input.sessionId,
      infoHash: started.infoHash,
      provenance: {
        sourceId: started.provenance.sourceId,
        basis: started.provenance.basis,
      },
      ...(input.library !== undefined ? { library: input.library } : {}),
      assets: input.assets.map((asset) => ({
        assetId: asset.assetId,
        sourcePath: asset.sourcePath,
        contentPath: asset.contentPath,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        ...(asset.contentType !== undefined ? { contentType: asset.contentType } : {}),
      })),
    });
    const exposures = extractExposedAssets(this.journal.readAll());
    const exposure = exposures.find(
      (candidate) =>
        offlineReadyIdentityKey(candidate) === offlineReadyIdentityKey(record),
    );
    if (exposure === undefined) {
      return torrentError("INTERNAL", {
        sessionId: input.sessionId,
        detail:
          "recordAssetExposure: the exposure record landed but the fold cannot see it — the journal is inconsistent",
      });
    }
    return { ok: true, value: exposure };
  }

  async destroy(): Promise<void> {
    for (const session of this.sessionsById.values()) {
      await session.destroy();
    }
    for (const scheduler of this.schedulersBySession.values()) {
      scheduler.detach();
    }
    this.sessionsById.clear();
    this.schedulersBySession.clear();
    await this.library.destroy();
  }

  // --- internals -----------------------------------------------------------------

  private requireSession(
    sessionId: string,
    operation: string,
  ): TorrentResult<TorrentEngineSession> {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined) {
      return torrentError("NOT_FOUND", {
        sessionId,
        detail: `${operation}: no such session is live (it may have been stopped — its persisted state is recoverable on engine restart via recover())`,
      });
    }
    return { ok: true, value: session };
  }

  private hasLiveSessionFor(infoHash: string): boolean {
    for (const session of this.sessionsById.values()) {
      // R17: TERMINAL sessions (completed/failed) never block a fresh
      // attempt — the duplicate law guards the mature library's LIVE
      // sessions; a failed session must not make retry impossible (the
      // named `metadata-failed` state offers re-ingestion as its recovery).
      const state = session.currentState();
      if (state === "completed" || state === "failed") continue;
      if (session.infoHash === infoHash) return true;
    }
    return false;
  }

  private nextSessionNumber(): number {
    let max = 0;
    for (const record of this.journal.readAll()) {
      if (record.type !== "session-started") continue;
      const match = /^ts-(\d+)$/.exec(record.sessionId);
      if (match !== null) {
        const n = Number(match[1]);
        if (Number.isSafeInteger(n) && n > max) max = n;
      }
    }
    return max + 1;
  }

  /** Rebuild the metainfo/plan context of a journaled session (async). */
  private async restoreContext(view: {
    sessionId: string;
    started: {
      infoHash: string;
      ingestionKind: "magnet" | "torrent-file";
      selection: readonly number[];
      metainfoB64?: string;
    };
    metadata?: {
      name: string;
      pieceLengthBytes: number;
      totalBytes: number;
      pieceCount: number;
      files: readonly TorrentFileEntry[];
    };
    appliedSelection?: readonly number[];
  }): Promise<{
    metainfo?: TorrentMetainfo;
    plan?: SelectionPlan;
    seamMetainfo?: ParsedMetainfo;
    selectionIndexes: readonly number[];
  }> {
    let metainfo: TorrentMetainfo | undefined;
    let seamMetainfo: ParsedMetainfo | undefined;
    if (view.started.metainfoB64 !== undefined) {
      // Deterministic offline re-parse of the journaled .torrent bytes
      // through the SAME mature library that ingested them.
      const bytes = new Uint8Array(Buffer.from(view.started.metainfoB64, "base64"));
      const parsed = await this.library.parseTorrentFile(bytes);
      if (parsed.ok) {
        seamMetainfo = parsed.value;
        metainfo = metainfoFromLibrary(parsed.value);
      }
    }
    if (metainfo === undefined && view.metadata !== undefined) {
      // Magnet sessions: the metadata-resolved journal record is the file
      // list (trackers/privacy were never the record's job).
      metainfo = {
        infoHash: view.started.infoHash,
        name: view.metadata.name,
        pieceLengthBytes: view.metadata.pieceLengthBytes,
        totalBytes: view.metadata.totalBytes,
        pieceCount: view.metadata.pieceCount,
        files: view.metadata.files,
        trackers: [],
        isPrivate: false,
        dhtEligible: true,
      };
    }
    let plan: SelectionPlan | undefined;
    // The journaled selection (the RESOLVED record wins; the started
    // record carries the torrent-file kind's initial form).
    const indexes = view.appliedSelection ?? view.started.selection;
    if (metainfo !== undefined) {
      if (indexes.length > 0) {
        const validated = validateSelection(metainfo.files, indexes);
        if (validated.ok) {
          const planned = planSelection(
            metainfo.files,
            validated.value,
            metainfo.pieceLengthBytes,
            metainfo.totalBytes,
          );
          if (planned.ok) plan = planned.value;
        }
      }
    }
    return {
      ...(metainfo !== undefined ? { metainfo } : {}),
      ...(plan !== undefined ? { plan } : {}),
      ...(seamMetainfo !== undefined ? { seamMetainfo } : {}),
      selectionIndexes: indexes,
    };
  }

  private sessionInputsFor(
    view: {
      sessionId: string;
      started: {
        ingestionKind: "magnet" | "torrent-file";
        infoHash: string;
        dataDir: string;
        magnetUri?: string;
      };
    },
    provenance: SessionProvenance,
    metainfo: TorrentMetainfo | undefined,
    selectionIndexes: readonly number[],
  ): TorrentEngineSessionInputs {
    const started = view.started;
    return {
      sessionId: view.sessionId,
      ingestionKind: started.ingestionKind,
      infoHash: started.infoHash,
      provenance,
      dataDir: started.dataDir,
      ...(started.magnetUri !== undefined ? { magnetUri: started.magnetUri } : {}),
      ...(metainfo !== undefined ? { metainfo } : {}),
      // The JOURNALED selection is the restored session's request (never
      // the silent all-files default — continuity is the recovery law).
      selectionRequest:
        selectionIndexes.length > 0 ? { fileIndexes: selectionIndexes } : {},
      library: this.library,
      journal: this.journal,
      clock: this.clock,
      stallThresholdMs: this.stallThresholdMs,
      metadataTimeoutMs: this.metadataTimeoutMs,
      checkpointEveryPieces: this.checkpointEveryPieces,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a torrent-file session's initial selection (indexes or all). */
function resolveInitialSelection(
  files: readonly TorrentFileEntry[],
  selection: TorrentSelectionRequest,
): readonly number[] {
  if (selection.fileIndexes !== undefined) {
    return selection.fileIndexes;
  }
  if (selection.filePaths !== undefined && selection.filePaths.length > 0) {
    const indexes = selection.filePaths
      .map((wanted) => files.findIndex((f) => f.path === wanted || f.name === wanted))
      .filter((i) => i !== -1);
    if (indexes.length > 0) return indexes.sort((a, b) => a - b);
  }
  return files.map((_, index) => index);
}

/** The resume target of a restored session (never another paused state). */
function normalizeResumeTarget(state: TorrentSessionState | undefined): TorrentSessionState {
  if (state === undefined || state === "seeding-paused") return "downloading";
  return state;
}

/** Does the directory exist and contain at least one non-empty file? */
function directoryHasFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const walk = (current: string): boolean => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (walk(path)) return true;
      } else if (entry.isFile()) {
        try {
          if (statSync(path).size > 0) return true;
        } catch {
          // unreadable — keep looking
        }
      }
    }
    return false;
  };
  return walk(dir);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the torrent engine. The library is INJECTED (invariant 6): pass
 * the pinned production binding (`createWebTorrentLibrary`) in product
 * wiring, or a deterministic double in tests — the engine never names the
 * implementation.
 */
export function createTorrentEngine(options: TorrentEngineOptions): TorrentEngine {
  return new TorrentEngineImpl(options);
}
