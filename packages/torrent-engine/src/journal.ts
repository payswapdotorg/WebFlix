/**
 * @wfx/torrent-engine — the session journal (R11, the R10 recovery discipline).
 *
 * THE APPEND-ONLY CRASH RECOVERY LOG under the engine's data root
 * (`<root>/journal.ndjson`): one JSON object per line, every record
 * stamped with a MONOTONIC sequence number (`seq`), a wall clock `at`
 * timestamp, and a record type:
 *
 * - `ingest`   — an ingestion event (the authorized source + the magnet
 *                or .torrent infohash + the file selection).
 * - `control`  — a control command was applied (pause/resume/stop) with
 *                the resulting piece-verified count — the RECOVERY
 *                CONTROL POINTS.
 * - `state`    — an observed session state (with optional structured
 *                `evidence` — recovery decisions, completion verdicts,
 *                failure details).
 * - `evidence` — engine-level facts that are not session state (startup,
 *                recovery reports, completion events, shutdown).
 *
 * DESIGN DECISIONS (mirrored from R10's native-media journal, law-for-law):
 *
 * 1. CONTROL-POINT JOURNAL, NOT A TELEMETRY LOG. Every control command is
 *    journaled with its resulting verified-piece count, and every STATE
 *    TRANSITION is journaled. Per-piece download ticks are NOT journaled:
 *    recovery resumes from the last JOURNALED control point — the honest
 *    last-known-PERSISTED verified count. Unjournaled piece-progress drift
 *    is lost by design (the loopback re-establishes the piece map from
 *    its fixture on restart; the production backend re-hashes the local
 *    piece store against the recorded piece hashes).
 * 2. TORN-TAIL TOLERANCE. A crash mid-append can leave a partial final
 *    line. `readAll` drops a torn tail (and any malformed line) instead
 *    of failing — the journal replays every record that provably landed.
 * 3. RECOVERY EXTRACTION IS PURE. `extractRecoverableSessions` is a pure
 *    function of the record list: a session is recoverable iff it was
 *    ingested, was NOT stopped, and its last known state is non-terminal
 *    (`complete`/`failed` are terminal and stay terminal across restarts).
 * 4. SEQUENCE NUMBERS SURVIVE RESTARTS. The in-memory counter is seeded
 *    from the file's maximum `seq`, so a restarted engine continues the
 *    sequence without reuse.
 * 5. HONEST FAILURE FOR VANISHED STATE (the R10 law, mirrored). A
 *    session whose data directory disappeared is NOT silently restarted
 *    from zero pretending continuity — recovery reports the session as
 *    `failed` with the `DATA_VANISHED` evidence. The engine surfaces the
 *    honest detail; the caller decides whether to re-ingest.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { TorrentEngineError } from "./errors";
import type { TorrentMetadata } from "./metadata";
import type { Provenance } from "./provenance";
import { isProvenance } from "./provenance";
import type { TorrentSessionState } from "./session";
import { isTorrentSessionState } from "./session";

// ---------------------------------------------------------------------------
// Provenance mirror (the journal stores the structural fields, not the brand)
// ---------------------------------------------------------------------------

/** The journal's serializable view of a {@link Provenance}. */
export interface JournalProvenance {
  readonly sourceId: string;
  readonly authorizationKind: string;
  readonly context?: Readonly<Record<string, string>>;
}

/** Serialize a {@link Provenance} for the journal (drops the brand). */
export function journalProvenance(p: Provenance): JournalProvenance {
  return {
    sourceId: p.sourceId,
    authorizationKind: p.authorizationKind,
    ...(p.context !== undefined ? { context: p.context } : {}),
  };
}

/** Runtime guard for {@link JournalProvenance}. */
export function isJournalProvenance(x: unknown): x is JournalProvenance {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  if (typeof p.sourceId !== "string" || p.sourceId.length === 0) return false;
  if (typeof p.authorizationKind !== "string" || p.authorizationKind.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/** The `ingest` record: an authorized ingestion was started. */
export interface JournalIngestRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "ingest";
  readonly sessionId: string;
  readonly infoHash: string;
  readonly sourceKind: "magnet" | "torrent-file";
  readonly provenance: JournalProvenance;
  /** The resolved metadata at ingestion time (the J21 "metadata" step's evidence). */
  readonly metadata: {
    name: string;
    pieceLengthBytes: number;
    pieceCount: number;
    totalBytes: number;
    files: Array<{ path: string; lengthBytes: number; offsetBytes: number; playableHint: boolean }>;
    trackers: string[];
  };
  /** The data directory the engine owns for this session's pieces. */
  readonly dataDir: string;
  /** The initial state (always `metadata` — the J21 entry). */
  readonly state: TorrentSessionState;
  /** The total pieces the engine expects to verify. */
  readonly totalPieces: number;
}

/** The control commands the journal records. */
export type JournalControlKind = "pause" | "resume" | "stop" | "select-files";

/** The `control` record: a control command was applied to a session. */
export interface JournalControlRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "control";
  readonly sessionId: string;
  readonly kind: JournalControlKind;
  /** The command's argument, when it had one (selected files, comma-separated). */
  readonly detail?: string;
  /** The resulting verified-piece count after the command (the recovery control point). */
  readonly verifiedPieces: number;
  /** The session state after the command. */
  readonly state: TorrentSessionState;
}

/** The `state` record: an observed session state (with optional evidence). */
export interface JournalStateRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "state";
  readonly sessionId: string;
  readonly state: TorrentSessionState;
  readonly verifiedPieces: number;
  readonly totalPieces: number;
  readonly peerCount: number;
  /** The asset-digest verdict (`unknown` until verified; `verified`/`failed` at completion). */
  readonly integrity: "unknown" | "verified" | "failed";
  /** Structured evidence: recovery decisions, completion verdicts, failure details. */
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/** The `evidence` record: engine-level facts (startup, recovery, shutdown). */
export interface JournalEvidenceRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "evidence";
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The union of every journal record. */
export type JournalRecord =
  | JournalIngestRecord
  | JournalControlRecord
  | JournalStateRecord
  | JournalEvidenceRecord;

// ---------------------------------------------------------------------------
// Recovery extraction (pure)
// ---------------------------------------------------------------------------

/** One recoverable session, as extracted from the journal. */
export interface RecoveredTorrentSession {
  readonly sessionId: string;
  readonly infoHash: string;
  readonly sourceKind: "magnet" | "torrent-file";
  readonly provenance: JournalProvenance;
  readonly metadata: JournalIngestRecord["metadata"];
  readonly dataDir: string;
  /** The last journaled non-terminal state. */
  readonly lastState: TorrentSessionState;
  /** The last journaled verified-piece count (the recovery control point). */
  readonly verifiedPieces: number;
  readonly totalPieces: number;
  readonly peerCount: number;
  /** The last journaled integrity verdict. */
  readonly integrity: "unknown" | "verified" | "failed";
  /** The last journaled selected-files list, when any. */
  readonly selectedFiles: readonly string[];
}

/**
 * PURE: extract the recoverable sessions from journal records. A session
 * is recoverable iff it was ingested, never stopped, and its last known
 * state is non-terminal. Deterministic: later records win, file order
 * breaks ties.
 */
export function extractRecoverableSessions(
  records: readonly JournalRecord[],
): RecoveredTorrentSession[] {
  interface Track {
    ingest?: JournalIngestRecord;
    state?: TorrentSessionState;
    verifiedPieces: number;
    totalPieces: number;
    peerCount: number;
    integrity: "unknown" | "verified" | "failed";
    selectedFiles: string[];
    stopped: boolean;
  }
  const tracked = new Map<string, Track>();
  for (const record of records) {
    switch (record.type) {
      case "ingest": {
        tracked.set(record.sessionId, {
          ingest: record,
          state: record.state,
          verifiedPieces: 0,
          totalPieces: record.totalPieces,
          peerCount: 0,
          integrity: "unknown",
          selectedFiles: [],
          stopped: false,
        });
        break;
      }
      case "control": {
        const track = tracked.get(record.sessionId);
        if (track === undefined) break;
        if (record.kind === "stop") {
          track.stopped = true;
          break;
        }
        if (record.kind === "select-files" && record.detail !== undefined) {
          track.selectedFiles = record.detail.split(",").filter((s) => s.length > 0);
        }
        track.state = record.state;
        track.verifiedPieces = record.verifiedPieces;
        break;
      }
      case "state": {
        const track = tracked.get(record.sessionId);
        if (track === undefined) break;
        track.state = record.state;
        track.verifiedPieces = record.verifiedPieces;
        track.totalPieces = record.totalPieces;
        track.peerCount = record.peerCount;
        track.integrity = record.integrity;
        break;
      }
      case "evidence":
        break; // engine-level, not session state
    }
  }
  const out: RecoveredTorrentSession[] = [];
  for (const [sessionId, track] of tracked) {
    if (track.stopped || track.ingest === undefined) continue;
    if (track.state === undefined) continue;
    if (track.state === "complete" || track.state === "failed") continue; // terminal
    out.push({
      sessionId,
      infoHash: track.ingest.infoHash,
      sourceKind: track.ingest.sourceKind,
      provenance: track.ingest.provenance,
      metadata: track.ingest.metadata,
      dataDir: track.ingest.dataDir,
      lastState: track.state,
      verifiedPieces: track.verifiedPieces,
      totalPieces: track.totalPieces,
      peerCount: track.peerCount,
      integrity: track.integrity,
      selectedFiles: track.selectedFiles,
    });
  }
  // Deterministic order: journal (insertion) order of the sessions.
  return out;
}

// ---------------------------------------------------------------------------
// The journal surface
// ---------------------------------------------------------------------------

/** Input for one `appendState` call. */
export interface AppendStateInput {
  sessionId: string;
  state: TorrentSessionState;
  verifiedPieces: number;
  totalPieces: number;
  peerCount: number;
  integrity: "unknown" | "verified" | "failed";
  evidence?: Readonly<Record<string, unknown>>;
}

/** The append-only torrent session journal. */
export interface TorrentJournal {
  /** The journal file path (absolute). */
  readonly path: string;
  /** The next sequence number that will be assigned (monotonic across restarts). */
  nextSeq(): number;
  /** Append an `ingest` record; returns the record with its assigned `seq`. */
  appendIngest(input: {
    sessionId: string;
    infoHash: string;
    sourceKind: "magnet" | "torrent-file";
    provenance: Provenance;
    metadata: TorrentMetadata;
    dataDir: string;
    totalPieces: number;
  }): JournalIngestRecord;
  /** Append a `control` record. */
  appendControl(input: {
    sessionId: string;
    kind: JournalControlKind;
    verifiedPieces: number;
    state: TorrentSessionState;
    detail?: string;
  }): JournalControlRecord;
  /** Append a `state` record (with optional structured evidence). */
  appendState(input: AppendStateInput): JournalStateRecord;
  /** Append an `evidence` record (engine-level facts). */
  appendEvidence(message: string, data?: Readonly<Record<string, unknown>>): JournalEvidenceRecord;
  /** Every record that provably landed (torn tail + malformed lines dropped). */
  readAll(): JournalRecord[];
  /** The recoverable sessions (pure extraction over `readAll`). */
  recoverableSessions(): RecoveredTorrentSession[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function invalidInput(detail: string): TorrentEngineError {
  return new TorrentEngineError("INVALID_INPUT", { detail });
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`torrent journal: '${field}' must be a non-empty string`);
  }
  return value;
}

function requireState(value: unknown, field: string): TorrentSessionState {
  if (!isTorrentSessionState(value)) {
    throw invalidInput(`torrent journal: '${field}' must be a session state (got ${String(value)})`);
  }
  return value;
}

function requireNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidInput(`torrent journal: '${field}' must be a finite number >= 0 (got ${String(value)})`);
  }
  return value;
}

function requireSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`torrent journal: '${field}' must be a safe integer >= 0 (got ${String(value)})`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TorrentJournalImpl implements TorrentJournal {
  readonly path: string;
  private readonly clock: () => number;
  private seq: number;

  constructor(root: string, clock: () => number) {
    this.path = join(resolve(root), "torrent-journal.ndjson");
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

  appendIngest(input: {
    sessionId: string;
    infoHash: string;
    sourceKind: "magnet" | "torrent-file";
    provenance: Provenance;
    metadata: TorrentMetadata;
    dataDir: string;
    totalPieces: number;
  }): JournalIngestRecord {
    if (!isProvenance(input.provenance)) {
      throw invalidInput("torrent journal.appendIngest: provenance must be a Provenance");
    }
    const prov = journalProvenance(input.provenance);
    const record: JournalIngestRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "ingest",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      infoHash: requireNonEmpty(input.infoHash, "infoHash"),
      sourceKind: input.sourceKind,
      provenance: prov,
      metadata: {
        name: requireNonEmpty(input.metadata.name, "metadata.name"),
        pieceLengthBytes: requireSafeInteger(input.metadata.pieceLengthBytes, "metadata.pieceLengthBytes"),
        pieceCount: requireSafeInteger(input.metadata.pieceCount, "metadata.pieceCount"),
        totalBytes: requireSafeInteger(input.metadata.totalBytes, "metadata.totalBytes"),
        files: input.metadata.files.map((f) => ({
          path: requireNonEmpty(f.path, "metadata.files[].path"),
          lengthBytes: requireSafeInteger(f.lengthBytes, "metadata.files[].lengthBytes"),
          offsetBytes: requireSafeInteger(f.offsetBytes, "metadata.files[].offsetBytes"),
          playableHint: typeof f.playableHint === "boolean" ? f.playableHint : false,
        })),
        trackers: input.metadata.trackers.filter((t): t is string => typeof t === "string"),
      },
      dataDir: resolve(requireNonEmpty(input.dataDir, "dataDir")),
      state: "metadata",
      totalPieces: requireSafeInteger(input.totalPieces, "totalPieces"),
    };
    this.write(record);
    return record;
  }

  appendControl(input: {
    sessionId: string;
    kind: JournalControlKind;
    verifiedPieces: number;
    state: TorrentSessionState;
    detail?: string;
  }): JournalControlRecord {
    const record: JournalControlRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "control",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      kind: input.kind,
      verifiedPieces: requireNonNegative(input.verifiedPieces, "verifiedPieces"),
      state: requireState(input.state, "state"),
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    };
    this.write(record);
    return record;
  }

  appendState(input: AppendStateInput): JournalStateRecord {
    const record: JournalStateRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "state",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      state: requireState(input.state, "state"),
      verifiedPieces: requireNonNegative(input.verifiedPieces, "verifiedPieces"),
      totalPieces: requireNonNegative(input.totalPieces, "totalPieces"),
      peerCount: requireNonNegative(input.peerCount, "peerCount"),
      integrity:
        input.integrity === "verified" || input.integrity === "failed"
          ? input.integrity
          : "unknown",
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
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
      type: "evidence",
      message: requireNonEmpty(message, "message"),
      ...(data !== undefined ? { data } : {}),
    };
    this.write(record);
    return record;
  }

  readAll(): JournalRecord[] {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return []; // no journal yet — nothing provably landed
    }
    const out: JournalRecord[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      const record = parseRecord(line);
      if (record !== undefined) out.push(record);
    }
    return out;
  }

  recoverableSessions(): RecoveredTorrentSession[] {
    return extractRecoverableSessions(this.readAll());
  }

  // --- internals ---------------------------------------------------------------

  private takeSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /** Append one JSON line (sync: a record is either landed or not). */
  private write(record: JournalRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Record parsing (torn-tail tolerant, total for garbage)
// ---------------------------------------------------------------------------

/**
 * Parse one journal line into a typed record. `undefined` for a torn tail,
 * a blank line, or any malformed content — the journal only replays what
 * PROVABLY landed.
 */
function parseRecord(line: string): JournalRecord | undefined {
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
    case "ingest": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.infoHash !== "string" ||
        (r.sourceKind !== "magnet" && r.sourceKind !== "torrent-file") ||
        !isJournalProvenance(r.provenance) ||
        typeof r.dataDir !== "string" ||
        !isTorrentSessionState(r.state) ||
        typeof r.totalPieces !== "number"
      ) {
        return undefined;
      }
      const meta = r.metadata as Record<string, unknown> | undefined;
      if (meta === undefined || typeof meta !== "object") return undefined;
      const files = Array.isArray(meta.files) ? meta.files : undefined;
      if (!Array.isArray(files)) return undefined;
      for (const f of files) {
        if (typeof f !== "object" || f === null) return undefined;
        const fo = f as Record<string, unknown>;
        if (
          typeof fo.path !== "string" ||
          typeof fo.lengthBytes !== "number" ||
          typeof fo.offsetBytes !== "number" ||
          typeof fo.playableHint !== "boolean"
        ) {
          return undefined;
        }
      }
      return {
        seq,
        at,
        type: "ingest",
        sessionId: r.sessionId,
        infoHash: r.infoHash,
        sourceKind: r.sourceKind,
        provenance: r.provenance,
        metadata: {
          name: (meta.name as string) ?? "",
          pieceLengthBytes: (meta.pieceLengthBytes as number) ?? 0,
          pieceCount: (meta.pieceCount as number) ?? 0,
          totalBytes: (meta.totalBytes as number) ?? 0,
          files: files.map((f) => {
            const fo = f as Record<string, unknown>;
            return {
              path: fo.path as string,
              lengthBytes: fo.lengthBytes as number,
              offsetBytes: fo.offsetBytes as number,
              playableHint: fo.playableHint as boolean,
            };
          }),
          trackers: Array.isArray(meta.trackers) ? (meta.trackers as string[]) : [],
        },
        dataDir: r.dataDir,
        state: r.state,
        totalPieces: r.totalPieces,
      };
    }
    case "control": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.kind !== "string" ||
        !isTorrentSessionState(r.state) ||
        typeof r.verifiedPieces !== "number"
      ) {
        return undefined;
      }
      const kind = r.kind as JournalControlKind;
      if (kind !== "pause" && kind !== "resume" && kind !== "stop" && kind !== "select-files") {
        return undefined;
      }
      return {
        seq,
        at,
        type: "control",
        sessionId: r.sessionId,
        kind,
        verifiedPieces: r.verifiedPieces,
        state: r.state,
        ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
      };
    }
    case "state": {
      if (
        typeof r.sessionId !== "string" ||
        !isTorrentSessionState(r.state) ||
        typeof r.verifiedPieces !== "number" ||
        typeof r.totalPieces !== "number" ||
        typeof r.peerCount !== "number" ||
        (r.integrity !== "unknown" && r.integrity !== "verified" && r.integrity !== "failed")
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "state",
        sessionId: r.sessionId,
        state: r.state,
        verifiedPieces: r.verifiedPieces,
        totalPieces: r.totalPieces,
        peerCount: r.peerCount,
        integrity: r.integrity,
        ...(isEvidence(r.evidence) ? { evidence: r.evidence } : {}),
      };
    }
    case "evidence": {
      if (typeof r.message !== "string" || r.message.length === 0) return undefined;
      return {
        seq,
        at,
        type: "evidence",
        message: r.message,
        ...(isEvidence(r.data) ? { data: r.data } : {}),
      };
    }
    default:
      return undefined;
  }
}

function isEvidence(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Options for {@link createTorrentJournal}. */
export interface TorrentJournalOptions {
  /** Wall clock for record timestamps; injectable for tests. Default: Date.now. */
  readonly clock?: () => number;
}

/**
 * Create the append-only torrent session journal under `root`
 * (`<root>/torrent-journal.ndjson`). The root directory is created when
 * absent; the sequence counter is seeded from the existing file so a
 * restarted engine continues the sequence without reuse.
 */
export function createTorrentJournal(
  root: string,
  options: TorrentJournalOptions = {},
): TorrentJournal {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw invalidInput("createTorrentJournal: root must be a non-empty string");
  }
  if (typeof options !== "object" || options === null) {
    throw invalidInput("createTorrentJournal: options must be an object");
  }
  return new TorrentJournalImpl(root, options.clock ?? (() => Date.now()));
}
