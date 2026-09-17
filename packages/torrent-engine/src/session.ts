/**
 * @wfx/torrent-engine — the session state machine + status surface (R11).
 *
 * THE HONEST STATE MACHINE (the R11 vocabulary, the remediation freeze's
 * torrent lifecycle):
 *
 * ```text
 *   discovering-metadata ──> selecting ──> downloading ──> verifying ──> completed
 *            │                   │             │              │            │
 *            └────────────┬──────┴──────┬───────┴──────┬───────┘            │
 *                         ▼             ▼              ▼                     │
 *                    seeding-paused (the user-paused state; resume returns   │
 *                    to the recorded pre-pause state)                        │
 *            (every live state may transition to `failed`)                  │
 * ```
 *
 * - `discovering-metadata` — a magnet session whose metainfo the library has
 *   not resolved yet (no file list exists — selection cannot happen yet).
 * - `selecting` — the file list is known; the selection is applied (the
 *   J21-J25 "choose file" step).
 * - `downloading` — the library transfers ONLY the selected pieces' ranges.
 * - `seeding-paused` — the user-paused state (the vocabulary's single
 *   paused state; it covers pausing mid-download, mid-verify, and during
 *   metadata discovery — the name is the frozen vocabulary's own).
 * - `verifying` — all selected pieces are present; the final whole-asset
 *   digests are computed over the REAL bytes on disk.
 * - `completed` — TERMINAL: piece hashes verified by the mature library AND
 *   per-file SHA-256 digests recorded (the R10 integrity contract).
 * - `failed(reason)` — TERMINAL, honestly typed.
 *
 * THE HONESTY LAWS (invariant 10/12 — no fabricated anything):
 * - THE STALL LAW: a `downloading` session with zero connected peers for
 *   longer than the stall threshold answers `stalled: true` with the honest
 *   numbers (peers.connected === 0, rates, stall duration) — NEVER a bare
 *   "downloading" that implies progress. The stall clock starts at session
 *   start when no peer was ever seen.
 * - Every number in `TorrentSessionStatus` comes from the library's live
 *   snapshot (or the journaled/cached terminal record) — nothing is
 *   extrapolated, smoothed, or invented.
 * - `integrity` uses the R10 verdict vocabulary: `unknown` until the
 *   library verified every selected piece, `verified` on completion,
 *   `failed` on corruption.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  InvalidTorrentTransitionError,
  torrentError,
  type TorrentResult,
} from "./errors";
import type { TorrentSessionJournal } from "./journal";
import { digestFileAtPath } from "./integrity";
import type { TorrentMetainfo, TorrentFileEntry } from "./metadata";
import type { AuthorizedProvenance } from "./provenance";
import {
  planSelection,
  validateSelection,
  type SelectionPlan,
} from "./selection";
import type { LibrarySession, TorrentLibrary } from "./library/contract";

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The honest session states, in lifecycle order. */
export const TORRENT_SESSION_STATES = [
  "discovering-metadata",
  "selecting",
  "downloading",
  "seeding-paused",
  "verifying",
  "completed",
  "failed",
] as const;

export type TorrentSessionState = (typeof TORRENT_SESSION_STATES)[number];

/** Runtime guard for the state union. */
export function isTorrentSessionState(x: unknown): x is TorrentSessionState {
  return (
    typeof x === "string" &&
    (TORRENT_SESSION_STATES as readonly string[]).includes(x)
  );
}

/**
 * The closed transition graph. Terminal states (`completed`, `failed`) have
 * no outgoing transitions (the R10 terminal law). `seeding-paused` may
 * resume to any live state — the engine additionally restricts the target
 * to the RECORDED pre-pause state (see `resumeFromPause`).
 */
export const ALLOWED_SESSION_TRANSITIONS: Readonly<
  Record<TorrentSessionState, readonly TorrentSessionState[]>
> = {
  "discovering-metadata": ["selecting", "seeding-paused", "failed"],
  selecting: ["downloading", "seeding-paused", "failed"],
  downloading: ["verifying", "seeding-paused", "failed"],
  "seeding-paused": [
    "discovering-metadata",
    "selecting",
    "downloading",
    "verifying",
    "failed",
  ],
  verifying: ["completed", "seeding-paused", "failed"],
  completed: [],
  failed: [],
};

/** Predicate: may a session in `from` move to `to`? Total for garbage. */
export function canTransitionTorrentState(
  from: TorrentSessionState,
  to: TorrentSessionState,
): boolean {
  if (!isTorrentSessionState(from) || !isTorrentSessionState(to)) return false;
  const allowed = ALLOWED_SESSION_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Failure reasons
// ---------------------------------------------------------------------------

/**
 * The closed set of typed session failure reasons.
 *
 * - `metadata-failed`      — the magnet's metadata could not be resolved.
 * - `corruption-detected`  — a piece hash mismatched its metainfo hash (the
 *   library's verification failed on real bytes).
 * - `data-vanished`        — recovery found the journaled progress but the
 *   data directory/bytes had disappeared (NEVER a silent restart from zero).
 * - `io-error`             — a local read/write failed.
 * - `library-error`        — the mature library failed otherwise.
 * - `verification-failed`  — the final whole-asset digest pass failed.
 * - `provenance-revoked`   — recovery found the authorized source no longer
 *   in the registry (invariant 5 survives restarts — the session is failed,
 *   never resumed without authorization).
 */
export const TORRENT_FAILURE_REASONS = [
  "metadata-failed",
  "corruption-detected",
  "data-vanished",
  "io-error",
  "library-error",
  "verification-failed",
  "provenance-revoked",
] as const;

export type TorrentFailureReason = (typeof TORRENT_FAILURE_REASONS)[number];

/** Runtime guard for the failure reason union. */
export function isTorrentFailureReason(x: unknown): x is TorrentFailureReason {
  return (
    typeof x === "string" &&
    (TORRENT_FAILURE_REASONS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The status surface
// ---------------------------------------------------------------------------

/** Peer observability (honest numbers). */
export interface TorrentPeerStats {
  /** Connected peers RIGHT NOW. */
  readonly connected: number;
}

/** Piece observability (whole-torrent truth from the library). */
export interface TorrentPieceStats {
  /** Total pieces in the torrent. */
  readonly total: number;
  /** Verified pieces (against metainfo hashes). */
  readonly verified: number;
}

/** Selection-relative progress (the honest denominator). */
export interface TorrentProgressStats {
  /** Pieces covering the selected files. */
  readonly selectedPieces: number;
  /** Verified pieces among the selection. */
  readonly verifiedSelectedPieces: number;
  /** Total bytes of the selected files. */
  readonly selectedBytes: number;
  /** Verified bytes within the selection (piece-quantized, honest). */
  readonly verifiedSelectedBytes: number;
  /** `verifiedSelectedPieces / selectedPieces` in [0, 1]. */
  readonly fraction: number;
}

/** One file as the status answers it (selection-aware). */
export interface TorrentSessionFile extends TorrentFileEntry {
  /** Whether this file is part of the session's selection. */
  readonly selected: boolean;
}

/** A recorded per-file digest of a completed session. */
export interface TorrentSessionDigest {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** The honest, total status answer for one session. */
export interface TorrentSessionStatus {
  readonly sessionId: string;
  readonly infoHash: string;
  readonly state: TorrentSessionState;
  /**
   * The stall law: `true` iff `state === "downloading"` AND the library
   * reports ZERO connected peers AND the stall threshold has elapsed since
   * the last peer contact (or session start when none was ever seen).
   */
  readonly stalled: boolean;
  /** How long the session has been stalled (present iff `stalled`). */
  readonly stallDurationMs?: number;
  readonly peers: TorrentPeerStats;
  readonly pieces: TorrentPieceStats;
  readonly progress: TorrentProgressStats;
  readonly rates: {
    readonly downloadBytesPerSec: number;
    readonly uploadBytesPerSec: number;
  };
  /** The file list (post-metadata), each marked selected or not. */
  readonly files: readonly TorrentSessionFile[];
  /** The authorization provenance (invariant 5 — always inspectable). */
  readonly provenance: {
    readonly sourceId: string;
    readonly basis: AuthorizedProvenance["basis"];
  };
  /** Where the library owns the bytes. */
  readonly dataDir: string;
  /** The R10-compatible integrity verdict. */
  readonly integrity: "unknown" | "verified" | "failed";
  /** The typed failure (present iff `state === "failed"`). */
  readonly failure?: { readonly reason: TorrentFailureReason; readonly detail: string };
  /** Per-file digests (present iff `state === "completed"`). */
  readonly digests?: readonly TorrentSessionDigest[];
}

// ---------------------------------------------------------------------------
// Session inputs
// ---------------------------------------------------------------------------

/** How the caller chooses files (indexes for known metainfo, paths for magnets). */
export interface TorrentSelectionRequest {
  /** Indexes into the (known) file list — torrent-file kind. */
  readonly fileIndexes?: readonly number[];
  /**
   * Paths to match against the file list once metadata resolves — the
   * magnet-kind selection (pre-metadata).
   */
  readonly filePaths?: readonly string[];
}

/**
 * The provenance a session carries: either a live re-minted
 * `AuthorizedProvenance` or the JOURNALED record (recovery tombstones —
 * the historical fact of what the session was authorized under, kept
 * inspectable even when the source has since left the registry).
 */
export type SessionProvenance =
  | AuthorizedProvenance
  | { readonly sourceId: string; readonly basis: AuthorizedProvenance["basis"] };

/** Constructor inputs for {@link TorrentEngineSession}. */
export interface TorrentEngineSessionInputs {
  readonly sessionId: string;
  readonly ingestionKind: "magnet" | "torrent-file";
  readonly infoHash: string;
  readonly provenance: SessionProvenance;
  readonly dataDir: string;
  readonly magnetUri?: string;
  /** The metainfo when known at construction (undefined for magnets). */
  readonly metainfo?: TorrentMetainfo | undefined;
  readonly selectionRequest: TorrentSelectionRequest;
  readonly library: TorrentLibrary;
  readonly journal: TorrentSessionJournal;
  readonly clock: () => number;
  readonly stallThresholdMs: number;
  readonly checkpointEveryPieces: number;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/**
 * One torrent session: the honest lifecycle + observability over a live
 * library session. Constructed by the engine; never by product code
 * directly (the engine is the only construction path — see engine.ts).
 */
export class TorrentEngineSession {
  readonly sessionId: string;
  readonly infoHash: string;
  readonly dataDir: string;
  readonly provenance: SessionProvenance;
  readonly ingestionKind: "magnet" | "torrent-file";
  readonly magnetUri: string | undefined;

  private state: TorrentSessionState;
  private pausedFrom: TorrentSessionState | undefined;
  private metainfo: TorrentMetainfo | undefined;
  private plan: SelectionPlan | undefined;
  private selectionRequest: TorrentSelectionRequest;
  private librarySession: LibrarySession | undefined;
  private unsubscribe: (() => void) | undefined;
  private failure: { reason: TorrentFailureReason; detail: string } | undefined;
  private digests: readonly TorrentSessionDigest[] | undefined;
  private lastPeerContactAt: number | undefined;
  private readonly startedAt: number;
  private verifiedPieceEvents = 0;
  private piecesSinceCheckpoint = 0;
  private stopped = false;

  private readonly library: TorrentLibrary;
  private readonly journal: TorrentSessionJournal;
  private readonly clock: () => number;
  private readonly stallThresholdMs: number;
  private readonly checkpointEveryPieces: number;

  private constructor(inputs: TorrentEngineSessionInputs) {
    this.sessionId = inputs.sessionId;
    this.infoHash = inputs.infoHash;
    this.dataDir = inputs.dataDir;
    this.provenance = inputs.provenance;
    this.ingestionKind = inputs.ingestionKind;
    this.magnetUri = inputs.magnetUri;
    this.metainfo = inputs.metainfo;
    this.selectionRequest = inputs.selectionRequest;
    this.library = inputs.library;
    this.journal = inputs.journal;
    this.clock = inputs.clock;
    this.stallThresholdMs = inputs.stallThresholdMs;
    this.checkpointEveryPieces = Math.max(1, inputs.checkpointEveryPieces);
    this.startedAt = this.clock();
    this.state =
      inputs.metainfo === undefined ? "discovering-metadata" : "selecting";
    mkdirSync(inputs.dataDir, { recursive: true });
  }

  /** Construct a live session and adopt its library session (engine-internal). */
  static createLive(
    inputs: TorrentEngineSessionInputs,
    librarySession: LibrarySession,
  ): TorrentEngineSession {
    const session = new TorrentEngineSession(inputs);
    session.adopt(librarySession);
    if (session.metainfo !== undefined) {
      // Torrent-file kind: metadata is known from ingestion. Resolve the
      // selection (journaling it) and start downloading.
      session.applySelection();
      if (session.state === "selecting") {
        session.transitionTo("downloading", "selection applied");
      }
    }
    return session;
  }

  /**
   * Construct a TERMINAL restored view (recovery of a completed/failed
   * session — terminal stays terminal, the R10 law). Answers journaled
   * data; no library session exists.
   */
  static createRestoredTerminal(
    inputs: TorrentEngineSessionInputs,
    terminal:
      | { kind: "completed"; files: readonly TorrentSessionDigest[] }
      | { kind: "failed"; reason: TorrentFailureReason; detail: string },
    context: {
      metainfo: TorrentMetainfo | undefined;
      plan: SelectionPlan | undefined;
      verifiedPieces: number;
    },
  ): TorrentEngineSession {
    const session = new TorrentEngineSession({
      ...inputs,
      metainfo: inputs.metainfo ?? context.metainfo,
    });
    session.metainfo = inputs.metainfo ?? context.metainfo;
    session.plan = context.plan;
    if (terminal.kind === "completed") {
      session.state = "completed";
      session.digests = terminal.files;
    } else {
      session.state = "failed";
      session.failure = { reason: terminal.reason, detail: terminal.detail };
    }
    session.verifiedPieceEvents = context.verifiedPieces;
    return session;
  }

  /** Construct a PAUSED restored session (the paused-by-restart mapping). */
  static createRestoredPaused(
    inputs: TorrentEngineSessionInputs,
    context: {
      metainfo: TorrentMetainfo | undefined;
      plan: SelectionPlan | undefined;
      verifiedPieces: number;
      resumeTarget: TorrentSessionState;
    },
    librarySession: LibrarySession,
  ): TorrentEngineSession {
    const session = new TorrentEngineSession({
      ...inputs,
      metainfo: inputs.metainfo ?? context.metainfo,
    });
    session.metainfo = inputs.metainfo ?? context.metainfo;
    session.plan = context.plan;
    session.verifiedPieceEvents = context.verifiedPieces;
    session.state = "seeding-paused";
    session.pausedFrom = context.resumeTarget;
    session.adopt(librarySession);
    // The restored library session must learn the selection again (the
    // engine stays seeding-paused — resume continues it).
    if (session.metainfo !== undefined) session.applySelection();
    return session;
  }

  // --- lifecycle ------------------------------------------------------------

  /** The current state (engine-internal reads). */
  currentState(): TorrentSessionState {
    return this.state;
  }

  /** Pause the live session (idempotent-protected by INVALID_STATE). */
  pause(): TorrentResult<void> {
    if (this.state === "completed" || this.state === "failed") {
      return torrentError("SESSION_CLOSED", {
        sessionId: this.sessionId,
        detail: `pause: session '${this.sessionId}' is terminal (${this.state}) — completed and failed sessions accept no lifecycle commands`,
      });
    }
    if (this.state === "seeding-paused") {
      return torrentError("INVALID_STATE", {
        sessionId: this.sessionId,
        detail: `pause: session '${this.sessionId}' is already seeding-paused`,
      });
    }
    this.transitionTo("seeding-paused", "user pause");
    this.librarySession?.pause();
    this.writeCheckpoint();
    return { ok: true, value: undefined };
  }

  /** Resume a paused session; returns to the RECORDED pre-pause state. */
  resume(): TorrentResult<void> {
    if (this.state === "completed" || this.state === "failed") {
      return torrentError("SESSION_CLOSED", {
        sessionId: this.sessionId,
        detail: `resume: session '${this.sessionId}' is terminal (${this.state})`,
      });
    }
    if (this.state !== "seeding-paused") {
      return torrentError("INVALID_STATE", {
        sessionId: this.sessionId,
        detail: `resume: session '${this.sessionId}' is ${this.state}, not seeding-paused`,
      });
    }
    const target = this.pausedFrom ?? "downloading";
    this.transitionTo(target, "user resume");
    this.librarySession?.resume();
    return { ok: true, value: undefined };
  }

  /**
   * Stop the session: journal the control point, destroy the library
   * session (bytes stay on disk). The engine then drops the handle — the
   * session is RECOVERABLE (restart restores it paused).
   */
  async stop(): Promise<TorrentResult<void>> {
    if (this.state === "completed" || this.state === "failed") {
      return torrentError("SESSION_CLOSED", {
        sessionId: this.sessionId,
        detail: `stop: session '${this.sessionId}' is terminal (${this.state}); its record persists in the journal`,
      });
    }
    if (this.stopped) {
      return torrentError("INVALID_STATE", {
        sessionId: this.sessionId,
        detail: `stop: session '${this.sessionId}' is already stopped`,
      });
    }
    this.stopped = true;
    this.writeCheckpoint();
    this.journal.appendStopped(this.sessionId);
    if (this.unsubscribe !== undefined) this.unsubscribe();
    try {
      await this.librarySession?.destroy();
    } catch (e) {
      return torrentError("LIBRARY_ERROR", {
        sessionId: this.sessionId,
        detail: `stop: the library session failed to destroy: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
    return { ok: true, value: undefined };
  }

  /** Destroy the engine-side session (engine teardown; journals nothing). */
  async destroy(): Promise<void> {
    if (this.unsubscribe !== undefined) this.unsubscribe();
    try {
      await this.librarySession?.destroy();
    } catch {
      // Teardown is best-effort; the journal is the truth.
    }
  }

  // --- the honest status ------------------------------------------------------

  status(): TorrentSessionStatus {
    const now = this.clock();
    const snap = this.librarySession?.snapshot();
    if (snap !== undefined && snap.connectedPeers > 0) {
      this.lastPeerContactAt = now;
    }
    const peers: TorrentPeerStats = {
      connected: snap?.connectedPeers ?? 0,
    };
    const totalPieces = this.plan?.totalPieces ?? this.metainfo?.pieceCount ?? 0;
    const verifiedTotal =
      snap !== undefined ? countBits(snap.bitfield, totalPieces) : this.verifiedPieceEvents;
    const selectedPieces = this.plan?.selectedPieces.length ?? 0;
    const verifiedSelected =
      snap !== undefined && this.plan !== undefined
        ? countBitsInRange(snap.bitfield, this.plan.selectedPieces)
        : this.terminalVerifiedSelected();
    const pieceLength = this.metainfo?.pieceLengthBytes ?? 0;
    const verifiedSelectedBytes =
      this.state === "completed"
        ? (this.plan?.selectedBytes ?? 0)
        : verifiedSelected * pieceLength;
    const stallSince = this.lastPeerContactAt ?? this.startedAt;
    const stalled =
      this.state === "downloading" &&
      peers.connected === 0 &&
      now - stallSince >= this.stallThresholdMs;
    const integrity: TorrentSessionStatus["integrity"] =
      this.state === "completed"
        ? "verified"
        : this.state === "failed" && this.failure?.reason === "corruption-detected"
          ? "failed"
          : "unknown";
    return {
      sessionId: this.sessionId,
      infoHash: this.infoHash,
      state: this.state,
      stalled,
      ...(stalled ? { stallDurationMs: now - stallSince } : {}),
      peers,
      pieces: { total: totalPieces, verified: verifiedTotal },
      progress: {
        selectedPieces,
        verifiedSelectedPieces: verifiedSelected,
        selectedBytes: this.plan?.selectedBytes ?? 0,
        verifiedSelectedBytes,
        fraction:
          selectedPieces === 0
            ? (this.state === "completed" ? 1 : 0)
            : Math.min(1, verifiedSelected / selectedPieces),
      },
      rates: {
        downloadBytesPerSec: snap?.downloadBytesPerSec ?? 0,
        uploadBytesPerSec: snap?.uploadBytesPerSec ?? 0,
      },
      files: this.statusFiles(),
      provenance: {
        sourceId: this.provenance.sourceId,
        basis: this.provenance.basis,
      },
      dataDir: this.dataDir,
      integrity,
      ...(this.failure !== undefined ? { failure: this.failure } : {}),
      ...(this.digests !== undefined ? { digests: this.digests } : {}),
    };
  }

  // --- library event wiring (engine-internal) --------------------------------

  private adopt(librarySession: LibrarySession): void {
    this.librarySession = librarySession;
    this.unsubscribe = librarySession.onEvent((event) => {
      switch (event.kind) {
        case "metadata":
          this.onLibraryMetadata(event.metainfo);
          break;
        case "piece-verified":
          this.onPieceVerified(event.piece);
          break;
        case "done":
          void this.onLibraryDone();
          break;
        case "error":
          this.onLibraryError(event.message, event.fatal);
          break;
      }
    });
  }

  private onLibraryMetadata(seamMeta: {
    infoHash: string;
    name: string;
    pieceLengthBytes: number;
    totalBytes: number;
    pieceCount: number;
    files: readonly {
      path: string;
      name: string;
      lengthBytes: number;
      offsetBytes: number;
    }[];
    trackers: readonly string[];
    isPrivate: boolean;
  }): void {
    if (this.metainfo !== undefined) {
      // Metadata already known (torrent-file ingestion): the library must
      // agree — an infohash mismatch is a deep inconsistency, failed
      // honestly, never papered over.
      if (seamMeta.infoHash !== this.metainfo.infoHash) {
        this.fail(
          "library-error",
          `the library resolved metadata for infohash ${seamMeta.infoHash} but the session was started for ${this.metainfo.infoHash}`,
        );
      }
      return;
    }
    // Magnet path: first metadata. Map to the public vocabulary, journal,
    // resolve the selection, then (when live) start downloading.
    this.metainfo = {
      infoHash: seamMeta.infoHash,
      name: seamMeta.name,
      pieceLengthBytes: seamMeta.pieceLengthBytes,
      totalBytes: seamMeta.totalBytes,
      pieceCount: seamMeta.pieceCount,
      files: seamMeta.files.map((f) => ({
        path: f.path,
        name: f.name,
        lengthBytes: f.lengthBytes,
        offsetBytes: f.offsetBytes,
      })),
      trackers: seamMeta.trackers.slice(),
      isPrivate: seamMeta.isPrivate,
      dhtEligible: !seamMeta.isPrivate,
    };
    this.journal.appendMetadata({
      sessionId: this.sessionId,
      name: this.metainfo.name,
      pieceLengthBytes: this.metainfo.pieceLengthBytes,
      totalBytes: this.metainfo.totalBytes,
      pieceCount: this.metainfo.pieceCount,
      files: this.metainfo.files,
    });
    if (this.state === "discovering-metadata") {
      this.transitionTo("selecting", "metadata resolved");
    }
    this.applySelection();
    if (this.state === "selecting") {
      this.transitionTo("downloading", "selection applied");
    }
  }

  /**
   * Resolve the selection request against the known metainfo, journal it,
   * and hand it to the library session — WITHOUT any state transition (a
   * paused session stays paused; the transitions are the caller's law).
   */
  private applySelection(): void {
    if (this.metainfo === undefined) return;
    const resolved = this.resolveSelectionIndexes(this.metainfo.files);
    if (!resolved.ok) {
      this.fail("library-error", `selection could not be applied: ${resolved.error.detail}`);
      return;
    }
    const plan = planSelection(
      this.metainfo.files,
      resolved.value,
      this.metainfo.pieceLengthBytes,
      this.metainfo.totalBytes,
    );
    if (!plan.ok) {
      this.fail("library-error", `selection could not be planned: ${plan.error.detail}`);
      return;
    }
    this.plan = plan.value;
    this.journal.appendSelection({
      sessionId: this.sessionId,
      fileIndexes: resolved.value.fileIndexes,
    });
    this.librarySession?.selectFiles(resolved.value.fileIndexes);
  }

  private onPieceVerified(_piece: number): void {
    this.verifiedPieceEvents += 1;
    this.piecesSinceCheckpoint += 1;
    if (this.piecesSinceCheckpoint >= this.checkpointEveryPieces) {
      this.piecesSinceCheckpoint = 0;
      this.writeCheckpoint();
    }
  }

  private async onLibraryDone(): Promise<void> {
    if (this.stopped) return; // a stopped session accepts no late completions
    if (this.state !== "downloading") return;
    this.transitionTo("verifying", "all selected pieces present");
    if (this.metainfo === undefined || this.plan === undefined) {
      this.fail(
        "verification-failed",
        "the library reported completion without the engine knowing the metainfo — nothing can be verified",
      );
      return;
    }
    // The final whole-asset digest pass: SHA-256 over the REAL bytes on
    // disk for every selected file (the R10 integrity contract).
    const digests: TorrentSessionDigest[] = [];
    for (const file of this.plan.selectedFiles) {
      if (this.stopped) return; // stop cancels the in-flight digest pass
      const path = join(this.dataDir, file.path);
      const result = await digestFileAtPath(path);
      if (!result.ok) {
        this.fail("io-error", `reading the landed bytes of '${file.path}' failed: ${result.error.detail}`);
        return;
      }
      if (result.value.sizeBytes !== file.lengthBytes) {
        this.fail(
          "verification-failed",
          `the landed bytes of '${file.path}' measure ${result.value.sizeBytes} but the metainfo says ${file.lengthBytes} — the selection is not faithfully complete`,
        );
        return;
      }
      digests.push({
        path: file.path,
        sizeBytes: result.value.sizeBytes,
        sha256: result.value.hex,
      });
    }
    if (this.stopped) return; // stop wins — no late journaling after it
    this.digests = digests;
    this.journal.appendCompleted({ sessionId: this.sessionId, files: digests });
    this.writeCheckpoint();
    this.transitionTo("completed", "verified: piece hashes + whole-asset digests recorded");
  }

  private onLibraryError(message: string, fatal: boolean): void {
    if (!fatal) return; // non-fatal library noise never changes session state
    const reason: TorrentFailureReason = message.includes("piece hash")
      ? "corruption-detected"
      : message.includes("metadata")
        ? "metadata-failed"
        : "library-error";
    this.fail(reason, `the mature library failed: ${message}`);
  }

  // --- internals ---------------------------------------------------------------

  private fail(reason: TorrentFailureReason, detail: string): void {
    if (this.state === "completed" || this.state === "failed") return; // terminal stays terminal
    this.journal.appendFailed({ sessionId: this.sessionId, reason, detail });
    this.failure = { reason, detail };
    this.state = "failed";
  }

  private transitionTo(to: TorrentSessionState, why: string): void {
    if (to === "seeding-paused") {
      this.pausedFrom = this.state;
    } else if (this.state === "seeding-paused" && to !== "failed") {
      this.pausedFrom = undefined;
    }
    if (!canTransitionTorrentState(this.state, to)) {
      throw new InvalidTorrentTransitionError(this.state, to);
    }
    const from = this.state;
    this.state = to;
    this.journal.appendState({ sessionId: this.sessionId, from, to, detail: why });
  }

  private resolveSelectionIndexes(
    files: readonly TorrentFileEntry[],
  ): TorrentResult<{ fileIndexes: readonly number[] }> {
    const request = this.selectionRequest;
    if (request.fileIndexes !== undefined) {
      const validated = validateSelection(files, request.fileIndexes);
      if (!validated.ok) return validated;
      return { ok: true, value: { fileIndexes: validated.value.fileIndexes } };
    }
    if (request.filePaths !== undefined) {
      if (request.filePaths.length === 0) {
        return torrentError("INVALID_SELECTION", {
          sessionId: this.sessionId,
          detail: "the selection names no files (an empty selection transfers nothing)",
        });
      }
      const indexes: number[] = [];
      for (const wanted of request.filePaths) {
        const index = files.findIndex((f) => f.path === wanted || f.name === wanted);
        if (index === -1) {
          return torrentError("INVALID_SELECTION", {
            sessionId: this.sessionId,
            detail: `the selection names file '${wanted}' which is not in the torrent's file list (${files.map((f) => f.path).join(", ")})`,
          });
        }
        if (!indexes.includes(index)) indexes.push(index);
      }
      return { ok: true, value: { fileIndexes: indexes.sort((a, b) => a - b) } };
    }
    // Default: the WHOLE torrent (every file selected).
    return { ok: true, value: { fileIndexes: files.map((_, index) => index) } };
  }

  private statusFiles(): readonly TorrentSessionFile[] {
    if (this.metainfo === undefined) return [];
    const selected = new Set(this.plan?.selection.fileIndexes ?? []);
    return this.metainfo.files.map((f, index) => ({
      ...f,
      selected: selected.has(index),
    }));
  }

  private terminalVerifiedSelected(): number {
    if (this.state === "completed") return this.plan?.selectedPieces.length ?? 0;
    return 0;
  }

  private writeCheckpoint(): void {
    const snap = this.librarySession?.snapshot();
    if (snap === undefined) return;
    this.journal.appendCheckpoint({
      sessionId: this.sessionId,
      bitfield: snap.bitfield,
      verifiedPieces: countBits(snap.bitfield, this.plan?.totalPieces ?? this.metainfo?.pieceCount ?? 0),
      downloadedBytes: snap.verifiedBytes,
    });
  }

  /** The selection plan (engine-internal: recovery + adapter reads). */
  selectionPlan(): SelectionPlan | undefined {
    return this.plan;
  }

  /** The resolved metainfo, when known (engine-internal). */
  resolvedMetainfo(): TorrentMetainfo | undefined {
    return this.metainfo;
  }
}

// ---------------------------------------------------------------------------
// Bitfield helpers (pure)
// ---------------------------------------------------------------------------

/** Count set bits among the first `totalPieces` pieces of a bitfield. */
export function countBits(bitfield: Uint8Array, totalPieces: number): number {
  const n = Math.min(totalPieces, bitfield.length * 8);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (bitHas(bitfield, i)) count += 1;
  }
  return count;
}

/** Count set bits at the given piece indexes. */
export function countBitsInRange(
  bitfield: Uint8Array,
  pieces: readonly number[],
): number {
  let count = 0;
  for (const piece of pieces) {
    if (bitHas(bitfield, piece)) count += 1;
  }
  return count;
}

/** Bit `i` of a bitfield (MSB-first within each byte; false when absent). */
export function bitHas(bitfield: Uint8Array, piece: number): boolean {
  const byte = bitfield[piece >> 3];
  if (byte === undefined) return false;
  return (byte & (0x80 >> (piece & 7))) !== 0;
}

/** Set bit `i` of a bitfield in place (MSB-first; grows nothing). */
export function bitSet(bitfield: Uint8Array, piece: number): void {
  const index = piece >> 3;
  if (index >= bitfield.length) return;
  bitfield[index]! |= 0x80 >> (piece & 7);
}
