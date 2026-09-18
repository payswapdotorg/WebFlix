/**
 * @wfx/torrent-engine — the session journal (R11, persistent recovery).
 *
 * THE APPEND-ONLY CRASH RECOVERY LOG (the R10 discipline, adapted):
 * `<dataRoot>/torrent-journal.ndjson` — one JSON object per line, every
 * record stamped with a MONOTONIC sequence number (`seq`, seeded from the
 * file so the sequence survives restarts without reuse) and a wall clock
 * `at` timestamp:
 *
 * - `session-started`  — the recovery basis: identity, AUTHORIZATION
 *   PROVENANCE, data directory, selection, and the source (magnet URI or
 *   the full metainfo, base64) needed to re-create the library session.
 * - `metadata-resolved`— the magnet path's file list (so a restart knows
 *   the selection geometry without the swarm).
 * - `state-changed`    — an observed session state transition.
 * - `progress-checkpoint` — the RECOVERY CONTROL POINT: the verified-piece
 *   bitfield at the time it landed (written on pause/stop/completion and
 *   every N verified pieces — `checkpointEveryPieces`).
 * - `session-completed`— terminal success WITH the per-file SHA-256
 *   digests computed over the real landed bytes (the R10 integrity
 *   contract handed to the adapter).
 * - `session-failed`   — terminal failure with the honest typed reason.
 * - `session-stopped`  — the user stopped the live session (a control
 *   point; the session stays RECOVERABLE — restart restores it paused).
 * - `engine-evidence`  — engine-level facts (startup, recovery verdicts).
 *
 * R13 EXTENSIONS (the persistence/recovery item — same crash-safety law):
 * - `scheduler-checkpoint` — the R12 playback scheduler's PERSISTED control
 *   point: the scheduler state + the inputs that deterministically
 *   reproduce its plan (playhead, velocity, seek target, the playable file,
 *   the tracked range requests) + the piece-priority projection last
 *   applied (the "persisted priorities" the resume path re-arms). Written
 *   on every scheduler-input-changing operation (commands, range demand,
 *   fact-driven transitions) — control points, not telemetry; the
 *   mid-tick playhead drift between checkpoints is recovered from the last
 *   checkpoint (the R10 discipline, deepened as R13's charter names).
 * - `asset-exposed`   — ONE library-exposure batch: the verified assets of
 *   a completed session handed to the Library as offline-ready entries,
 *   with the provenance read from the JOURNALED session record (never
 *   caller-supplied — authorization survives restarts as a fact) and the
 *   optional R04 canonical identity composition.
 * - `compact()`       — the journal ROTATION (the R13 "append/rotate"
 *   law): an ATOMIC REWRITE (full temporary file + rename — a crash leaves
 *   either the original or the complete compacted journal, never a torn
 *   hybrid) that keeps every recovery-relevant record (terminal facts,
 *   exposure audit trail, session bases) and the LATEST of each per-session
 *   mutable record (checkpoints, states, metadata, selection), dropping
 *   superseded history + engine evidence. Fold-equivalence is a tested
 *   property: `extractJournalSessions(compact(x)) === extractJournalSessions(x)`
 *   and the same for the R13 exposure fold.
 *
 * DESIGN DECISIONS (documented for lead review — the R10 precedent):
 *
 * 1. CONTROL-POINT JOURNAL, NOT A TELEMETRY LOG: recovery replays the last
 *    JOURNALED bitfield. Un-journaled piece progress between checkpoints
 *    is re-verified against the metainfo piece hashes on resume (the mature
 *    library's own verification) — progress is never FABRICATED beyond the
 *    checkpoint, and never silently restarted from zero when the journal
 *    proves pieces landed (the vanished-data law below).
 * 2. TORN-TAIL TOLERANCE: a crash mid-append leaves a partial final line;
 *    `readAll` drops it (and any malformed line) — the journal replays every
 *    record that provably landed.
 * 3. RECOVERY EXTRACTION IS PURE: `extractJournalSessions` is a pure
 *    function of the record list; `completed`/`failed` are TERMINAL and
 *    stay terminal across restarts (the R10 law).
 * 4. VANISHED DATA IS A FAILURE, NEVER A RESET: whether data vanished is
 *    decided by the ENGINE at recovery time (it must stat the disk); the
 *    journal supplies the PROOF OF PROGRESS (the bitfield) that makes the
 *    honest `data-vanished` failure — rather than a silent restart from
 *    zero pretending continuity — the only legal outcome.
 */

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { TorrentEngineError } from "./errors";
import type { AuthorizedProvenanceBasis } from "./provenance";
import type { TorrentFileEntry } from "./metadata";
import type { TorrentSessionState, TorrentFailureReason } from "./session";
import { isPlaybackSchedulerState, type PlaybackSchedulerState } from "./scheduler/state-machine";

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/** The `session-started` record: the recovery basis of one session. */
export interface JournalSessionStartedRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "session-started";
  readonly sessionId: string;
  /** How the torrent entered the engine: a magnet URI or a .torrent file. */
  readonly ingestionKind: "magnet" | "torrent-file";
  readonly infoHash: string;
  /** The authorization provenance (invariant 5) — journaled for the record. */
  readonly provenance: {
    readonly sourceId: string;
    readonly basis: AuthorizedProvenanceBasis;
  };
  /** Where the library owns the bytes (ABSOLUTE; recovery re-stats it). */
  readonly dataDir: string;
  /** The file selection (indexes into the torrent's file list). */
  readonly selection: readonly number[];
  /** The magnet URI (magnet kind) — recovery re-creates the session from it. */
  readonly magnetUri?: string;
  /** The full .torrent bytes, base64 (torrent-file kind). */
  readonly metainfoB64?: string;
  /** The torrent's display name, when known at start. */
  readonly torrentName?: string;
}

/** The `metadata-resolved` record: the magnet path's file list. */
export interface JournalMetadataRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "metadata-resolved";
  readonly sessionId: string;
  readonly name: string;
  readonly pieceLengthBytes: number;
  readonly totalBytes: number;
  readonly pieceCount: number;
  readonly files: readonly TorrentFileEntry[];
}

/** The `selection-applied` record: the RESOLVED selection (J22's "choose file"). */
export interface JournalSelectionRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "selection-applied";
  readonly sessionId: string;
  /** The resolved file indexes (ascending) the session transfers. */
  readonly fileIndexes: readonly number[];
}

/** The `state-changed` record: an observed transition. */
export interface JournalStateRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "state-changed";
  readonly sessionId: string;
  readonly from: TorrentSessionState;
  readonly to: TorrentSessionState;
  readonly detail?: string;
}

/** The `progress-checkpoint` record: the recovery control point. */
export interface JournalCheckpointRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "progress-checkpoint";
  readonly sessionId: string;
  /** The verified-piece bitfield, base64 (1 bit per piece, MSB-first). */
  readonly bitfieldB64: string;
  readonly verifiedPieces: number;
  readonly downloadedBytes: number;
}

/** One landed file's digest in a `session-completed` record. */
export interface JournalCompletedFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** The `session-completed` record: terminal success with real digests. */
export interface JournalCompletedRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "session-completed";
  readonly sessionId: string;
  readonly files: readonly JournalCompletedFile[];
}

/** The `session-failed` record: terminal failure, honestly typed. */
export interface JournalFailedRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "session-failed";
  readonly sessionId: string;
  readonly reason: TorrentFailureReason;
  readonly detail: string;
}

/** The `session-stopped` record: the user stopped the live session. */
export interface JournalStoppedRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "session-stopped";
  readonly sessionId: string;
}

/** The `engine-evidence` record: engine-level facts (startup, recovery). */
export interface JournalEvidenceRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "engine-evidence";
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** One tracked range request as the journal persists it (R13). */
export interface JournalSchedulerRangeRequest {
  /** File-relative byte offset of the requested range. */
  readonly offsetBytes: number;
  /** Length in bytes of the requested range (>= 1). */
  readonly lengthBytes: number;
  /** The request's deadline (finite number; the windows module's law). */
  readonly deadlineMs: number;
  /** Wall-clock epoch ms when the gateway reported the request. */
  readonly receivedAtMs: number;
}

/** One persisted piece-priority hint (the plan projection — R13). */
export interface JournalSchedulerPriority {
  /** First piece of the inclusive range (absolute index). */
  readonly fromPiece: number;
  /** Last piece of the inclusive range (absolute index). */
  readonly toPiece: number;
  /** The urgency ladder value (0..5). */
  readonly urgency: number;
}

/**
 * The `scheduler-checkpoint` record (R13): the playback scheduler's
 * persisted control point — everything the resume path needs to re-arm the
 * R12 scheduler deterministically (the plan is RECOMPUTED from these inputs
 * by the same pure functions; the `priorities` projection is the journaled
 * EVIDENCE of what was last applied to the library).
 */
export interface JournalSchedulerCheckpointRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "scheduler-checkpoint";
  readonly sessionId: string;
  /** The scheduler FSM state at the checkpoint. `idle` = intent cleared. */
  readonly schedulerState: PlaybackSchedulerState;
  /** The playable file the plan was bound to (index into the file list). */
  readonly fileIndex?: number;
  /** The playhead, in file-relative bytes. */
  readonly positionBytes?: number;
  /** The playback consumption velocity (bytes/sec). */
  readonly bytesPerSecond?: number;
  /** The pending seek target, in file-relative bytes (seeking state). */
  readonly seekTargetBytes?: number;
  /** The tracked range requests (the gateway's observed demand). */
  readonly rangeRequests?: readonly JournalSchedulerRangeRequest[];
  /** The piece-priority plan last applied (evidence; recomputed on re-arm). */
  readonly priorities?: readonly JournalSchedulerPriority[];
  /** Why the checkpoint landed (command kind / fact / stop). */
  readonly reason: string;
}

/** One landed asset file in an `asset-exposed` batch (R13). */
export interface JournalExposedAssetFile {
  /** The R10 store's asset identity (path-derived, deterministic). */
  readonly assetId: string;
  /** The torrent-relative source path that was landed. */
  readonly sourcePath: string;
  /** Where the store owns the bytes (absolute content path). */
  readonly contentPath: string;
  /** Size in bytes as recorded at exposure. */
  readonly sizeBytes: number;
  /** SHA-256 hex digest (matches the session's completed-digest record). */
  readonly sha256: string;
  /** The recorded content type, when one was given. */
  readonly contentType?: string;
}

/**
 * The `asset-exposed` record (R13): ONE library-exposure batch — the
 * verified assets of a completed session presented to the Library as
 * offline-ready entries. The provenance + infohash are the JOURNALED
 * session's own (recorded at `session-started` — authorization is a
 * durable fact, never re-supplied by the caller). The optional `library`
 * identity composes with R04's canonical-key discipline: one offline-ready
 * entry per (effective profile, canonical item).
 */
export interface JournalAssetExposedRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "asset-exposed";
  readonly sessionId: string;
  /** v1 infohash (lowercase hex) — from the journaled session. */
  readonly infoHash: string;
  /** The authorization provenance — from the journaled session. */
  readonly provenance: {
    readonly sourceId: string;
    readonly basis: AuthorizedProvenanceBasis;
  };
  /** The R04 canonical-identity composition, when the caller supplied it. */
  readonly library?: {
    readonly profileKey: string;
    readonly canonicalItemId: string;
  };
  /** The exposure batch: every landed file of this exposure (atomic). */
  readonly assets: readonly JournalExposedAssetFile[];
}

/** The union of every journal record. */
export type TorrentJournalRecord =
  | JournalSessionStartedRecord
  | JournalMetadataRecord
  | JournalSelectionRecord
  | JournalStateRecord
  | JournalCheckpointRecord
  | JournalCompletedRecord
  | JournalFailedRecord
  | JournalStoppedRecord
  | JournalEvidenceRecord
  | JournalSchedulerCheckpointRecord
  | JournalAssetExposedRecord;

// ---------------------------------------------------------------------------
// Pure recovery extraction
// ---------------------------------------------------------------------------

/** One session's view, as extracted from the journal (pure). */
export interface JournalSessionView {
  readonly sessionId: string;
  readonly started: JournalSessionStartedRecord;
  readonly metadata?: JournalMetadataRecord;
  /** The RESOLVED selection (post-metadata for magnets). */
  readonly appliedSelection?: readonly number[];
  /** Terminal outcome, when the journal recorded one. */
  readonly terminal:
    | { readonly kind: "completed"; readonly files: readonly JournalCompletedFile[] }
    | { readonly kind: "failed"; readonly reason: TorrentFailureReason; readonly detail: string }
    | undefined;
  /** The last observed live state (undefined when only `started` landed). */
  readonly lastState: TorrentSessionState | undefined;
  /** The last progress checkpoint (the recovery control point). */
  readonly checkpoint?: {
    readonly bitfield: Uint8Array;
    readonly verifiedPieces: number;
    readonly downloadedBytes: number;
  };
  /** Whether the live session was stopped (still recoverable). */
  readonly stopped: boolean;
  /** The LAST scheduler checkpoint (R13 — the re-arm control point). */
  readonly schedulerCheckpoint?: JournalSchedulerCheckpointRecord;
}

/**
 * PURE: fold the journal into per-session views. Later records win; file
 * order breaks ties. Sessions are returned in journal (insertion) order.
 */
export function extractJournalSessions(
  records: readonly TorrentJournalRecord[],
): JournalSessionView[] {
  const tracked = new Map<string, JournalSessionView>();
  for (const record of records) {
    switch (record.type) {
      case "session-started": {
        tracked.set(record.sessionId, {
          sessionId: record.sessionId,
          started: record,
          terminal: undefined,
          lastState: undefined,
          stopped: false,
        });
        break;
      }
      case "metadata-resolved": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, { ...view, metadata: record });
        }
        break;
      }
      case "selection-applied": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, { ...view, appliedSelection: record.fileIndexes });
        }
        break;
      }
      case "state-changed": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, { ...view, lastState: record.to });
        }
        break;
      }
      case "progress-checkpoint": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, {
            ...view,
            checkpoint: {
              bitfield: bitfieldFromBase64(record.bitfieldB64),
              verifiedPieces: record.verifiedPieces,
              downloadedBytes: record.downloadedBytes,
            },
          });
        }
        break;
      }
      case "session-completed": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, {
            ...view,
            terminal: { kind: "completed", files: record.files },
            lastState: "completed",
          });
        }
        break;
      }
      case "session-failed": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, {
            ...view,
            terminal: { kind: "failed", reason: record.reason, detail: record.detail },
            lastState: "failed",
          });
        }
        break;
      }
      case "session-stopped": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          tracked.set(record.sessionId, { ...view, stopped: true });
        }
        break;
      }
      case "scheduler-checkpoint": {
        const view = tracked.get(record.sessionId);
        if (view !== undefined) {
          // The LATEST checkpoint wins (fold order = journal order).
          tracked.set(record.sessionId, { ...view, schedulerCheckpoint: record });
        }
        break;
      }
      case "asset-exposed":
      case "engine-evidence":
        break; // engine-level, not session state
    }
  }
  return [...tracked.values()];
}

// ---------------------------------------------------------------------------
// Bitfield <-> base64 (the wire form used by the journal)
// ---------------------------------------------------------------------------

/** Encode a 1-bit-per-piece bitfield (MSB-first within each byte) as base64. */
export function bitfieldToBase64(bitfield: Uint8Array): string {
  return Buffer.from(bitfield.buffer, bitfield.byteOffset, bitfield.byteLength).toString("base64");
}

/** Decode a journal bitfield; answers an EMPTY bitfield for garbage. */
export function bitfieldFromBase64(b64: string): Uint8Array {
  try {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return new Uint8Array(0);
  }
}

// ---------------------------------------------------------------------------
// The journal surface
// ---------------------------------------------------------------------------

/** The append-only torrent session journal. */
export interface TorrentSessionJournal {
  /** The journal file path (absolute). */
  readonly path: string;
  /** The next sequence number that will be assigned. */
  nextSeq(): number;
  appendSessionStarted(input: {
    sessionId: string;
    ingestionKind: "magnet" | "torrent-file";
    infoHash: string;
    provenance: { sourceId: string; basis: AuthorizedProvenanceBasis };
    dataDir: string;
    selection: readonly number[];
    magnetUri?: string;
    metainfoB64?: string;
    torrentName?: string;
  }): JournalSessionStartedRecord;
  appendMetadata(input: {
    sessionId: string;
    name: string;
    pieceLengthBytes: number;
    totalBytes: number;
    pieceCount: number;
    files: readonly TorrentFileEntry[];
  }): JournalMetadataRecord;
  appendSelection(input: {
    sessionId: string;
    fileIndexes: readonly number[];
  }): JournalSelectionRecord;
  appendState(input: {
    sessionId: string;
    from: TorrentSessionState;
    to: TorrentSessionState;
    detail?: string;
  }): JournalStateRecord;
  appendCheckpoint(input: {
    sessionId: string;
    bitfield: Uint8Array;
    verifiedPieces: number;
    downloadedBytes: number;
  }): JournalCheckpointRecord;
  appendCompleted(input: {
    sessionId: string;
    files: readonly JournalCompletedFile[];
  }): JournalCompletedRecord;
  appendFailed(input: {
    sessionId: string;
    reason: TorrentFailureReason;
    detail: string;
  }): JournalFailedRecord;
  appendStopped(sessionId: string): JournalStoppedRecord;
  appendEvidence(
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ): JournalEvidenceRecord;
  /**
   * R13: append the playback scheduler's persisted control point (state +
   * re-arm inputs + the piece-priority projection last applied).
   */
  appendSchedulerCheckpoint(input: {
    sessionId: string;
    schedulerState: PlaybackSchedulerState;
    fileIndex?: number;
    positionBytes?: number;
    bytesPerSecond?: number;
    seekTargetBytes?: number;
    rangeRequests?: readonly JournalSchedulerRangeRequest[];
    priorities?: readonly JournalSchedulerPriority[];
    reason: string;
  }): JournalSchedulerCheckpointRecord;
  /**
   * R13: append ONE library-exposure batch (the adapter's verified-asset
   * handoff — every landed file of the exposure, atomically).
   */
  appendAssetExposure(input: {
    sessionId: string;
    infoHash: string;
    provenance: { sourceId: string; basis: AuthorizedProvenanceBasis };
    library?: { profileKey: string; canonicalItemId: string };
    assets: readonly JournalExposedAssetFile[];
  }): JournalAssetExposedRecord;
  /** Every record that provably landed (torn tail + malformed lines dropped). */
  readAll(): TorrentJournalRecord[];
  /** The per-session views (pure extraction over `readAll`). */
  sessions(): JournalSessionView[];
  /**
   * R13: rotate the journal — an ATOMIC rewrite (temp file + rename; a
   * crash leaves either the original or the complete compacted journal,
   * never a torn hybrid) that drops superseded per-session history and
   * engine evidence while keeping every recovery-relevant fact. Fold
   * equivalence is a tested property (see `selectCompactionKeepers`).
   */
  compact(): { readonly kept: number; readonly dropped: number };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function invalidInput(detail: string): TorrentEngineError {
  return new TorrentEngineError("INVALID_INPUT", { detail });
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`torrent-journal: '${field}' must be a non-empty string`);
  }
  return value;
}

function requireSafeNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(
      `torrent-journal: '${field}' must be a non-negative safe integer (got ${String(value)})`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const JOURNAL_FILE = "torrent-journal.ndjson";

class TorrentSessionJournalImpl implements TorrentSessionJournal {
  readonly path: string;
  private readonly clock: () => number;
  private seq: number;

  constructor(root: string, clock: () => number) {
    this.path = join(resolve(root), JOURNAL_FILE);
    this.clock = clock;
    mkdirSync(resolve(root), { recursive: true });
    // Seed the sequence from what provably landed (restart continuity).
    this.seq = 0;
    for (const record of this.readAll()) {
      if (record.seq > this.seq) this.seq = record.seq;
    }
  }

  nextSeq(): number {
    return this.seq + 1;
  }

  appendSessionStarted(input: {
    sessionId: string;
    ingestionKind: "magnet" | "torrent-file";
    infoHash: string;
    provenance: { sourceId: string; basis: AuthorizedProvenanceBasis };
    dataDir: string;
    selection: readonly number[];
    magnetUri?: string;
    metainfoB64?: string;
    torrentName?: string;
  }): JournalSessionStartedRecord {
    if (input.ingestionKind !== "magnet" && input.ingestionKind !== "torrent-file") {
      throw invalidInput(
        `torrent-journal: ingestionKind must be 'magnet' or 'torrent-file' (got ${String(input.ingestionKind)})`,
      );
    }
    if (!Array.isArray(input.selection)) {
      throw invalidInput("torrent-journal: selection must be an array of file indexes");
    }
    const record: JournalSessionStartedRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "session-started",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      ingestionKind: input.ingestionKind,
      infoHash: requireNonEmpty(input.infoHash, "infoHash"),
      provenance: {
        sourceId: requireNonEmpty(input.provenance.sourceId, "provenance.sourceId"),
        basis: input.provenance.basis,
      },
      dataDir: resolve(requireNonEmpty(input.dataDir, "dataDir")),
      selection: input.selection.slice(),
      ...(input.magnetUri !== undefined ? { magnetUri: input.magnetUri } : {}),
      ...(input.metainfoB64 !== undefined ? { metainfoB64: input.metainfoB64 } : {}),
      ...(input.torrentName !== undefined ? { torrentName: input.torrentName } : {}),
    };
    this.write(record);
    return record;
  }

  appendMetadata(input: {
    sessionId: string;
    name: string;
    pieceLengthBytes: number;
    totalBytes: number;
    pieceCount: number;
    files: readonly TorrentFileEntry[];
  }): JournalMetadataRecord {
    if (!Array.isArray(input.files)) {
      throw invalidInput("torrent-journal: files must be an array");
    }
    const record: JournalMetadataRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "metadata-resolved",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      name: requireNonEmpty(input.name, "name"),
      pieceLengthBytes: requireSafeNonNegative(input.pieceLengthBytes, "pieceLengthBytes"),
      totalBytes: requireSafeNonNegative(input.totalBytes, "totalBytes"),
      pieceCount: requireSafeNonNegative(input.pieceCount, "pieceCount"),
      files: input.files.slice(),
    };
    this.write(record);
    return record;
  }

  appendSelection(input: {
    sessionId: string;
    fileIndexes: readonly number[];
  }): JournalSelectionRecord {
    if (!Array.isArray(input.fileIndexes)) {
      throw invalidInput("torrent-journal: fileIndexes must be an array");
    }
    const record: JournalSelectionRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "selection-applied",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      fileIndexes: input.fileIndexes.slice(),
    };
    this.write(record);
    return record;
  }

  appendState(input: {
    sessionId: string;
    from: TorrentSessionState;
    to: TorrentSessionState;
    detail?: string;
  }): JournalStateRecord {
    const record: JournalStateRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "state-changed",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      from: input.from,
      to: input.to,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    };
    this.write(record);
    return record;
  }

  appendCheckpoint(input: {
    sessionId: string;
    bitfield: Uint8Array;
    verifiedPieces: number;
    downloadedBytes: number;
  }): JournalCheckpointRecord {
    if (!(input.bitfield instanceof Uint8Array)) {
      throw invalidInput("torrent-journal: bitfield must be a Uint8Array");
    }
    const record: JournalCheckpointRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "progress-checkpoint",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      bitfieldB64: bitfieldToBase64(input.bitfield),
      verifiedPieces: requireSafeNonNegative(input.verifiedPieces, "verifiedPieces"),
      downloadedBytes: requireSafeNonNegative(input.downloadedBytes, "downloadedBytes"),
    };
    this.write(record);
    return record;
  }

  appendCompleted(input: {
    sessionId: string;
    files: readonly JournalCompletedFile[];
  }): JournalCompletedRecord {
    if (!Array.isArray(input.files)) {
      throw invalidInput("torrent-journal: files must be an array");
    }
    const record: JournalCompletedRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "session-completed",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      files: input.files.slice(),
    };
    this.write(record);
    return record;
  }

  appendFailed(input: {
    sessionId: string;
    reason: TorrentFailureReason;
    detail: string;
  }): JournalFailedRecord {
    const record: JournalFailedRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "session-failed",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      reason: input.reason,
      detail: requireNonEmpty(input.detail, "detail"),
    };
    this.write(record);
    return record;
  }

  appendStopped(sessionId: string): JournalStoppedRecord {
    const record: JournalStoppedRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "session-stopped",
      sessionId: requireNonEmpty(sessionId, "sessionId"),
    };
    this.write(record);
    return record;
  }

  appendEvidence(
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ): JournalEvidenceRecord {
    const record: JournalEvidenceRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "engine-evidence",
      message: requireNonEmpty(message, "message"),
      ...(data !== undefined ? { data } : {}),
    };
    this.write(record);
    return record;
  }

  appendSchedulerCheckpoint(input: {
    sessionId: string;
    schedulerState: PlaybackSchedulerState;
    fileIndex?: number;
    positionBytes?: number;
    bytesPerSecond?: number;
    seekTargetBytes?: number;
    rangeRequests?: readonly JournalSchedulerRangeRequest[];
    priorities?: readonly JournalSchedulerPriority[];
    reason: string;
  }): JournalSchedulerCheckpointRecord {
    if (!isPlaybackSchedulerState(input.schedulerState)) {
      throw invalidInput(
        `torrent-journal: schedulerState must be a playback scheduler state (got ${String(input.schedulerState)})`,
      );
    }
    if (input.fileIndex !== undefined) {
      requireSafeNonNegative(input.fileIndex, "fileIndex");
    }
    if (input.positionBytes !== undefined) {
      requireSafeNonNegative(input.positionBytes, "positionBytes");
    }
    if (input.bytesPerSecond !== undefined) {
      if (
        typeof input.bytesPerSecond !== "number" ||
        !Number.isFinite(input.bytesPerSecond) ||
        input.bytesPerSecond <= 0
      ) {
        throw invalidInput(
          `torrent-journal: bytesPerSecond must be a finite number > 0 (got ${String(input.bytesPerSecond)})`,
        );
      }
    }
    if (input.seekTargetBytes !== undefined) {
      requireSafeNonNegative(input.seekTargetBytes, "seekTargetBytes");
    }
    if (input.rangeRequests !== undefined) {
      if (!Array.isArray(input.rangeRequests)) {
        throw invalidInput("torrent-journal: rangeRequests must be an array");
      }
      for (const request of input.rangeRequests) {
        if (!isSchedulerRangeRequest(request)) {
          throw invalidInput(
            "torrent-journal: each range request must be { offsetBytes >= 0, lengthBytes >= 1, deadlineMs finite, receivedAtMs finite }",
          );
        }
      }
    }
    if (input.priorities !== undefined) {
      if (!Array.isArray(input.priorities)) {
        throw invalidInput("torrent-journal: priorities must be an array");
      }
      for (const priority of input.priorities) {
        if (
          typeof priority !== "object" || priority === null ||
          !Number.isSafeInteger(priority.fromPiece) || priority.fromPiece < 0 ||
          !Number.isSafeInteger(priority.toPiece) || priority.toPiece < priority.fromPiece ||
          !Number.isSafeInteger(priority.urgency) || priority.urgency < 0 || priority.urgency > 5
        ) {
          throw invalidInput(
            "torrent-journal: each priority must be { fromPiece >= 0, toPiece >= fromPiece, urgency in [0, 5] }",
          );
        }
      }
    }
    const record: JournalSchedulerCheckpointRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "scheduler-checkpoint",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      schedulerState: input.schedulerState,
      ...(input.fileIndex !== undefined ? { fileIndex: input.fileIndex } : {}),
      ...(input.positionBytes !== undefined ? { positionBytes: input.positionBytes } : {}),
      ...(input.bytesPerSecond !== undefined
        ? { bytesPerSecond: input.bytesPerSecond }
        : {}),
      ...(input.seekTargetBytes !== undefined
        ? { seekTargetBytes: input.seekTargetBytes }
        : {}),
      ...(input.rangeRequests !== undefined
        ? { rangeRequests: input.rangeRequests.slice() }
        : {}),
      ...(input.priorities !== undefined ? { priorities: input.priorities.slice() } : {}),
      reason: requireNonEmpty(input.reason, "reason"),
    };
    this.write(record);
    return record;
  }

  appendAssetExposure(input: {
    sessionId: string;
    infoHash: string;
    provenance: { sourceId: string; basis: AuthorizedProvenanceBasis };
    library?: { profileKey: string; canonicalItemId: string };
    assets: readonly JournalExposedAssetFile[];
  }): JournalAssetExposedRecord {
    if (!Array.isArray(input.assets) || input.assets.length === 0) {
      throw invalidInput(
        "torrent-journal: assets must be a non-empty array (an exposure batch with no assets is not an exposure)",
      );
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
        throw invalidInput(
          "torrent-journal: each exposed asset must be { assetId, sourcePath, contentPath non-empty; sizeBytes a positive safe integer; sha256 64 lowercase hex }",
        );
      }
      if (asset.contentType !== undefined && typeof asset.contentType !== "string") {
        throw invalidInput("torrent-journal: contentType must be a string when present");
      }
    }
    if (input.library !== undefined) {
      if (
        typeof input.library !== "object" || input.library === null ||
        typeof input.library.profileKey !== "string" ||
        input.library.profileKey.trim().length === 0 ||
        typeof input.library.canonicalItemId !== "string" ||
        input.library.canonicalItemId.trim().length === 0
      ) {
        throw invalidInput(
          "torrent-journal: library identity must be { profileKey, canonicalItemId } non-empty strings",
        );
      }
    }
    const record: JournalAssetExposedRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "asset-exposed",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      infoHash: requireNonEmpty(input.infoHash, "infoHash"),
      provenance: {
        sourceId: requireNonEmpty(input.provenance.sourceId, "provenance.sourceId"),
        basis: input.provenance.basis,
      },
      ...(input.library !== undefined ? { library: input.library } : {}),
      assets: input.assets.slice(),
    };
    this.write(record);
    return record;
  }

  readAll(): TorrentJournalRecord[] {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return []; // no journal yet — nothing provably landed
    }
    const out: TorrentJournalRecord[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      const record = parseRecord(line);
      if (record !== undefined) out.push(record);
    }
    return out;
  }

  sessions(): JournalSessionView[] {
    return extractJournalSessions(this.readAll());
  }

  compact(): { readonly kept: number; readonly dropped: number } {
    const records = this.readAll();
    const keepers = selectCompactionKeepers(records);
    if (keepers.length === records.length) {
      return { kept: keepers.length, dropped: 0 }; // nothing superseded — no rewrite
    }
    // THE ATOMIC REWRITE: the compacted journal lands COMPLETE in a temp
    // file first; `rename` is atomic on POSIX — a crash mid-compact leaves
    // either the ORIGINAL journal (tmp discarded on the next attempt) or
    // the COMPLETE compacted journal. A torn hybrid is impossible.
    const tmp = `${this.path}.compact.tmp`;
    writeFileSync(tmp, keepers.map((record) => JSON.stringify(record)).join("\n") + "\n");
    renameSync(tmp, this.path);
    return { kept: keepers.length, dropped: records.length - keepers.length };
  }

  // --- internals -------------------------------------------------------------

  private takeSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /** Append one JSON line (sync: a record is either landed or not). */
  private write(record: TorrentJournalRecord): void {
    // TORN-TAIL REPAIR: if the file does not end with a newline (a previous
    // crash mid-append), close the partial line FIRST so this record lands
    // on its own line — the fragment is then dropped by the reader as a
    // malformed line, and the new record provably lands intact.
    if (!this.fileEndsWithNewline()) {
      appendFileSync(this.path, "\n");
    }
    appendFileSync(this.path, `${JSON.stringify(record)}\n`);
  }

  private fileEndsWithNewline(): boolean {
    try {
      const stat = statSync(this.path);
      if (stat.size === 0) return true;
      const fd = openSync(this.path, "r");
      try {
        const buffer = Buffer.alloc(1);
        readSync(fd, buffer, 0, 1, stat.size - 1);
        return buffer[0] === 0x0a;
      } finally {
        closeSync(fd);
      }
    } catch {
      return true; // no file yet — nothing to repair
    }
  }
}

// ---------------------------------------------------------------------------
// Record parsing (torn-tail tolerant, total for garbage)
// ---------------------------------------------------------------------------

function isSessionState(x: unknown): x is TorrentSessionState {
  return (
    x === "discovering-metadata" ||
    x === "selecting" ||
    x === "downloading" ||
    x === "seeding-paused" ||
    x === "verifying" ||
    x === "completed" ||
    x === "failed"
  );
}

function isFailureReason(x: unknown): x is TorrentFailureReason {
  return (
    x === "metadata-failed" ||
    x === "corruption-detected" ||
    x === "data-vanished" ||
    x === "io-error" ||
    x === "library-error" ||
    x === "verification-failed"
  );
}

function isProvenanceBasis(x: unknown): x is AuthorizedProvenanceBasis {
  return (
    x === "user-owned" ||
    x === "licensed" ||
    x === "public-domain" ||
    x === "creative-commons" ||
    x === "other-authorized"
  );
}

function isFileEntries(x: unknown): x is readonly TorrentFileEntry[] {
  return (
    Array.isArray(x) &&
    x.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        typeof (f as TorrentFileEntry).path === "string" &&
        typeof (f as TorrentFileEntry).name === "string" &&
        typeof (f as TorrentFileEntry).lengthBytes === "number" &&
        typeof (f as TorrentFileEntry).offsetBytes === "number",
    )
  );
}

function isCompletedFiles(x: unknown): x is readonly JournalCompletedFile[] {
  return (
    Array.isArray(x) &&
    x.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        typeof (f as JournalCompletedFile).path === "string" &&
        typeof (f as JournalCompletedFile).sizeBytes === "number" &&
        typeof (f as JournalCompletedFile).sha256 === "string",
    )
  );
}

/**
 * Parse one journal line into a typed record. `undefined` for a torn tail,
 * a blank line, or malformed content — only what PROVABLY landed replays.
 */
function parseRecord(line: string): TorrentJournalRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined; // torn tail or garbage
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const { seq, at, type } = r;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0) {
    return undefined;
  }
  if (typeof at !== "number" || !Number.isFinite(at)) return undefined;
  switch (type) {
    case "session-started": {
      const provenance = r.provenance as Record<string, unknown> | undefined;
      if (
        typeof r.sessionId !== "string" ||
        (r.ingestionKind !== "magnet" && r.ingestionKind !== "torrent-file") ||
        typeof r.infoHash !== "string" ||
        typeof provenance !== "object" ||
        provenance === null ||
        typeof provenance.sourceId !== "string" ||
        !isProvenanceBasis(provenance.basis) ||
        typeof r.dataDir !== "string" ||
        !Array.isArray(r.selection)
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "session-started",
        sessionId: r.sessionId,
        ingestionKind: r.ingestionKind,
        infoHash: r.infoHash,
        provenance: {
          sourceId: provenance.sourceId,
          basis: provenance.basis,
        },
        dataDir: r.dataDir,
        selection: r.selection,
        ...(typeof r.magnetUri === "string" ? { magnetUri: r.magnetUri } : {}),
        ...(typeof r.metainfoB64 === "string" ? { metainfoB64: r.metainfoB64 } : {}),
        ...(typeof r.torrentName === "string" ? { torrentName: r.torrentName } : {}),
      };
    }
    case "metadata-resolved": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.name !== "string" ||
        typeof r.pieceLengthBytes !== "number" ||
        typeof r.totalBytes !== "number" ||
        typeof r.pieceCount !== "number" ||
        !isFileEntries(r.files)
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "metadata-resolved",
        sessionId: r.sessionId,
        name: r.name,
        pieceLengthBytes: r.pieceLengthBytes,
        totalBytes: r.totalBytes,
        pieceCount: r.pieceCount,
        files: r.files,
      };
    }
    case "selection-applied": {
      if (
        typeof r.sessionId !== "string" ||
        !Array.isArray(r.fileIndexes) ||
        !r.fileIndexes.every(
          (i: unknown) => typeof i === "number" && Number.isSafeInteger(i) && i >= 0,
        )
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "selection-applied",
        sessionId: r.sessionId,
        fileIndexes: r.fileIndexes,
      };
    }
    case "state-changed": {
      if (
        typeof r.sessionId !== "string" ||
        !isSessionState(r.from) ||
        !isSessionState(r.to)
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "state-changed",
        sessionId: r.sessionId,
        from: r.from,
        to: r.to,
        ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
      };
    }
    case "progress-checkpoint": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.bitfieldB64 !== "string" ||
        typeof r.verifiedPieces !== "number" ||
        typeof r.downloadedBytes !== "number"
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "progress-checkpoint",
        sessionId: r.sessionId,
        bitfieldB64: r.bitfieldB64,
        verifiedPieces: r.verifiedPieces,
        downloadedBytes: r.downloadedBytes,
      };
    }
    case "session-completed": {
      if (typeof r.sessionId !== "string" || !isCompletedFiles(r.files)) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "session-completed",
        sessionId: r.sessionId,
        files: r.files,
      };
    }
    case "session-failed": {
      if (
        typeof r.sessionId !== "string" ||
        !isFailureReason(r.reason) ||
        typeof r.detail !== "string"
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "session-failed",
        sessionId: r.sessionId,
        reason: r.reason,
        detail: r.detail,
      };
    }
    case "session-stopped": {
      if (typeof r.sessionId !== "string") return undefined;
      return { seq, at, type: "session-stopped", sessionId: r.sessionId };
    }
    case "engine-evidence": {
      if (typeof r.message !== "string" || r.message.length === 0) return undefined;
      return {
        seq,
        at,
        type: "engine-evidence",
        message: r.message,
        ...(isPlainObject(r.data) ? { data: r.data } : {}),
      };
    }
    case "scheduler-checkpoint": {
      if (
        typeof r.sessionId !== "string" ||
        !isPlaybackSchedulerState(r.schedulerState) ||
        typeof r.reason !== "string" ||
        r.reason.length === 0
      ) {
        return undefined;
      }
      if (
        (r.fileIndex !== undefined && typeof r.fileIndex !== "number") ||
        (r.positionBytes !== undefined && typeof r.positionBytes !== "number") ||
        (r.bytesPerSecond !== undefined && typeof r.bytesPerSecond !== "number") ||
        (r.seekTargetBytes !== undefined && typeof r.seekTargetBytes !== "number")
      ) {
        return undefined;
      }
      if (r.rangeRequests !== undefined && !isSchedulerRangeRequestArray(r.rangeRequests)) {
        return undefined;
      }
      if (r.priorities !== undefined && !isSchedulerPriorityArray(r.priorities)) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "scheduler-checkpoint",
        sessionId: r.sessionId,
        schedulerState: r.schedulerState,
        ...(typeof r.fileIndex === "number" ? { fileIndex: r.fileIndex } : {}),
        ...(typeof r.positionBytes === "number" ? { positionBytes: r.positionBytes } : {}),
        ...(typeof r.bytesPerSecond === "number"
          ? { bytesPerSecond: r.bytesPerSecond }
          : {}),
        ...(typeof r.seekTargetBytes === "number"
          ? { seekTargetBytes: r.seekTargetBytes }
          : {}),
        ...(isSchedulerRangeRequestArray(r.rangeRequests)
          ? { rangeRequests: r.rangeRequests }
          : {}),
        ...(isSchedulerPriorityArray(r.priorities) ? { priorities: r.priorities } : {}),
        reason: r.reason,
      };
    }
    case "asset-exposed": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.infoHash !== "string" ||
        typeof r.provenance !== "object" ||
        r.provenance === null ||
        typeof (r.provenance as Record<string, unknown>).sourceId !== "string" ||
        !isProvenanceBasis((r.provenance as Record<string, unknown>).basis) ||
        !isExposedAssetFileArray(r.assets)
      ) {
        return undefined;
      }
      const library = r.library as Record<string, unknown> | undefined;
      if (
        library !== undefined &&
        (typeof library !== "object" ||
          library === null ||
          typeof library.profileKey !== "string" ||
          typeof library.canonicalItemId !== "string")
      ) {
        return undefined;
      }
      const provenance = r.provenance as { sourceId: string; basis: AuthorizedProvenanceBasis };
      return {
        seq,
        at,
        type: "asset-exposed",
        sessionId: r.sessionId,
        infoHash: r.infoHash,
        provenance: { sourceId: provenance.sourceId, basis: provenance.basis },
        ...(library !== undefined
          ? {
              library: {
                profileKey: (library as { profileKey: string }).profileKey,
                canonicalItemId: (library as { canonicalItemId: string }).canonicalItemId,
              },
            }
          : {}),
        assets: r.assets as JournalExposedAssetFile[],
      };
    }
    default:
      return undefined;
  }
}

function isPlainObject(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isSchedulerRangeRequest(x: unknown): x is JournalSchedulerRangeRequest {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.offsetBytes === "number" && Number.isSafeInteger(r.offsetBytes) && r.offsetBytes >= 0 &&
    typeof r.lengthBytes === "number" && Number.isSafeInteger(r.lengthBytes) && r.lengthBytes >= 1 &&
    typeof r.deadlineMs === "number" && Number.isFinite(r.deadlineMs) &&
    typeof r.receivedAtMs === "number" && Number.isFinite(r.receivedAtMs)
  );
}

function isSchedulerRangeRequestArray(x: unknown): x is readonly JournalSchedulerRangeRequest[] {
  return Array.isArray(x) && x.every(isSchedulerRangeRequest);
}

function isSchedulerPriority(x: unknown): x is JournalSchedulerPriority {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.fromPiece === "number" && Number.isSafeInteger(p.fromPiece) && p.fromPiece >= 0 &&
    typeof p.toPiece === "number" && Number.isSafeInteger(p.toPiece) &&
    (p.toPiece as number) >= (p.fromPiece as number) &&
    typeof p.urgency === "number" && Number.isSafeInteger(p.urgency) &&
    (p.urgency as number) >= 0 && (p.urgency as number) <= 5
  );
}

function isSchedulerPriorityArray(x: unknown): x is readonly JournalSchedulerPriority[] {
  return Array.isArray(x) && x.every(isSchedulerPriority);
}

function isExposedAssetFile(x: unknown): x is JournalExposedAssetFile {
  if (typeof x !== "object" || x === null) return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.assetId === "string" && a.assetId.length > 0 &&
    typeof a.sourcePath === "string" && a.sourcePath.length > 0 &&
    typeof a.contentPath === "string" && a.contentPath.length > 0 &&
    typeof a.sizeBytes === "number" && Number.isSafeInteger(a.sizeBytes) && a.sizeBytes > 0 &&
    typeof a.sha256 === "string" && /^[0-9a-f]{64}$/.test(a.sha256) &&
    (a.contentType === undefined || typeof a.contentType === "string")
  );
}

function isExposedAssetFileArray(x: unknown): x is readonly JournalExposedAssetFile[] {
  return Array.isArray(x) && x.length > 0 && x.every(isExposedAssetFile);
}

// ---------------------------------------------------------------------------
// Compaction (the R13 rotation — PURE selection)
// ---------------------------------------------------------------------------

/**
 * PURE: select the records a compaction keeps. The fold-equivalence law
 * (tested): `extractJournalSessions(selectCompactionKeepers(x))` and
 * `extractExposedAssets(selectCompactionKeepers(x))` produce the same views
 * as over `x` itself.
 *
 * - KEEP ALL: `session-started` (the recovery basis), `session-completed` /
 *   `session-failed` / `session-stopped` (terminal + stop facts), and
 *   `asset-exposed` (the library-exposure audit trail — provenance facts
 *   stay inspectable forever).
 * - KEEP THE LATEST PER (session, type): `metadata-resolved`,
 *   `selection-applied`, `state-changed`, `progress-checkpoint`,
 *   `scheduler-checkpoint` (the folds' latest-wins semantics make the
 *   superseded copies dead weight).
 * - DROP: `engine-evidence` (diagnostics, never recovery state).
 */
export function selectCompactionKeepers(
  records: readonly TorrentJournalRecord[],
): TorrentJournalRecord[] {
  const latestPerSessionType = new Map<string, number>(); // `${sessionId}:${type}` -> index
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    switch (record.type) {
      case "metadata-resolved":
      case "selection-applied":
      case "state-changed":
      case "progress-checkpoint":
      case "scheduler-checkpoint":
        latestPerSessionType.set(`${record.sessionId}:${record.type}`, i);
        break;
      default:
        break; // keep-all / drop kinds decided below
    }
  }
  const keep = new Set<number>(latestPerSessionType.values());
  const out: TorrentJournalRecord[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    switch (record.type) {
      case "engine-evidence":
        continue; // diagnostics — never recovery state
      case "metadata-resolved":
      case "selection-applied":
      case "state-changed":
      case "progress-checkpoint":
      case "scheduler-checkpoint":
        if (keep.has(i)) out.push(record);
        continue;
      default:
        out.push(record); // session-started / terminal / stopped / asset-exposed
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Options for {@link createTorrentSessionJournal}. */
export interface TorrentSessionJournalOptions {
  /** Wall clock for record timestamps; injectable for tests. Default: Date.now. */
  readonly clock?: () => number;
}

/**
 * Create the append-only torrent session journal under `root`
 * (`<root>/torrent-journal.ndjson`). The root directory is created when
 * absent; the sequence counter is seeded from the existing file so a
 * restarted engine continues the sequence without reuse.
 */
export function createTorrentSessionJournal(
  root: string,
  options: TorrentSessionJournalOptions = {},
): TorrentSessionJournal {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw invalidInput("createTorrentSessionJournal: root must be a non-empty string");
  }
  if (typeof options !== "object" || options === null) {
    throw invalidInput("createTorrentSessionJournal: options must be an object");
  }
  return new TorrentSessionJournalImpl(root, options.clock ?? (() => Date.now()));
}
