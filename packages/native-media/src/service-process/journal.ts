/**
 * @wfx/native-media — the session journal (R10, persistent sessions).
 *
 * THE APPEND-ONLY CRASH RECOVERY LOG under the store root
 * (`<root>/journal.ndjson`): one JSON object per line, every record
 * stamped with a MONOTONIC sequence number (`seq`), a wall clock `at`
 * timestamp, and a record type:
 *
 * - `open`     — a session was opened (its source path + identity).
 * - `control`  — a control command was applied (seek/pause/resume/
 *                prioritize/close/enter-background) with the position it
 *                produced — the RECOVERY CONTROL POINTS.
 * - `state`    — an observed session state (with optional structured
 *                `evidence` — recovery decisions, completion verdicts,
 *                failure details).
 * - `evidence` — service-level facts that are not session state (startup,
 *                recovery reports, completion events, shutdown).
 *
 * DESIGN DECISIONS (documented for lead review):
 *
 * 1. CONTROL-POINT JOURNAL, NOT A TELEMETRY LOG. Every control command is
 *    journaled with its resulting position/buffered values, and every
 *    STATE TRANSITION (FSM state changes only) is journaled. Buffered-ms
 *    ticks and playback-clock drift between control points are NOT
 *    journaled: recovery resumes from the last JOURNALED control point —
 *    the honest last-known-PERSISTED position. Unjournaled playback drift
 *    is lost by design (documented in the README; deepening it is R13's
 *    persistence item).
 * 2. TORN-TAIL TOLERANCE. A crash mid-append can leave a partial final
 *    line. `readAll` drops a torn tail (and any malformed line) instead
 *    of failing — the journal replays every record that provably landed.
 * 3. RECOVERY EXTRACTION IS PURE. `extractRecoverableSessions` is a pure
 *    function of the record list: a session is recoverable iff it was
 *    opened, was NOT closed, and its last known state is non-terminal
 *    (`complete`/`failed` are terminal and stay terminal across
 *    restarts — the frozen FSM has no exit from them).
 * 4. SEQUENCE NUMBERS SURVIVE RESTARTS. The in-memory counter is seeded
 *    from the file's maximum `seq`, so a restarted service continues the
 *    sequence without reuse (gaps from torn appends are tolerated).
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { NativeMediaError } from "../errors";
import type { SessionState } from "../session";
import { isSessionState } from "../session";

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/** The `open` record: a session entered the engine. */
export interface JournalOpenRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "open";
  readonly sessionId: string;
  readonly assetId: string;
  readonly fileId: string;
  /** The ABSOLUTE source path the session reads (recovery re-stats it). */
  readonly sourcePath: string;
  readonly state: SessionState;
  readonly positionMs: number;
}

/** The control commands the journal records (the frozen six + background). */
export type JournalControlKind =
  | "seek"
  | "pause"
  | "resume"
  | "prioritize"
  | "close"
  | "enter-background";

/** The `control` record: a control command was applied to a session. */
export interface JournalControlRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "control";
  readonly sessionId: string;
  readonly kind: JournalControlKind;
  /** The command's argument, when it had one (seek position, deadline count). */
  readonly detail?: string;
  /** The resulting position after the command (the recovery control point). */
  readonly positionMs: number;
  /** The session state after the command. */
  readonly state: SessionState;
}

/** The `state` record: an observed session state (with optional evidence). */
export interface JournalStateRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "state";
  readonly sessionId: string;
  readonly state: SessionState;
  readonly bufferedMs: number;
  readonly positionMs: number;
  readonly integrity: "unknown" | "verified" | "failed";
  /** Structured evidence: recovery decisions, completion verdicts, failure details. */
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/** The `evidence` record: service-level facts (startup, recovery, shutdown). */
export interface JournalEvidenceRecord {
  readonly seq: number;
  readonly at: number;
  readonly type: "evidence";
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The union of every journal record. */
export type JournalRecord =
  | JournalOpenRecord
  | JournalControlRecord
  | JournalStateRecord
  | JournalEvidenceRecord;

// ---------------------------------------------------------------------------
// Recovery extraction (pure)
// ---------------------------------------------------------------------------

/** One recoverable session, as extracted from the journal. */
export interface RecoveredSession {
  readonly sessionId: string;
  readonly assetId: string;
  readonly fileId: string;
  /** The ABSOLUTE source path (re-stat on recovery). */
  readonly sourcePath: string;
  /** The last journaled non-terminal state. */
  readonly lastState: SessionState;
  /** The last journaled position (the recovery control point). */
  readonly positionMs: number;
  /** The last journaled integrity verdict. */
  readonly integrity: "unknown" | "verified" | "failed";
  /** The last journaled buffered value (context for evidence, reset on recovery). */
  readonly bufferedMs: number;
}

/**
 * PURE: extract the recoverable sessions from journal records. A session
 * is recoverable iff it was opened, never closed, and its last known
 * state is non-terminal. Deterministic: later records win, file order
 * breaks ties.
 */
export function extractRecoverableSessions(
  records: readonly JournalRecord[],
): RecoveredSession[] {
  interface Track {
    open?: JournalOpenRecord;
    state?: SessionState;
    positionMs: number;
    bufferedMs: number;
    integrity: "unknown" | "verified" | "failed";
    closed: boolean;
  }
  const tracked = new Map<string, Track>();
  for (const record of records) {
    switch (record.type) {
      case "open": {
        tracked.set(record.sessionId, {
          open: record,
          state: record.state,
          positionMs: record.positionMs,
          bufferedMs: 0,
          integrity: "unknown",
          closed: false,
        });
        break;
      }
      case "control": {
        const track = tracked.get(record.sessionId);
        if (track === undefined) break;
        if (record.kind === "close") {
          track.closed = true;
          break;
        }
        track.state = record.state;
        track.positionMs = record.positionMs;
        break;
      }
      case "state": {
        const track = tracked.get(record.sessionId);
        if (track === undefined) break;
        track.state = record.state;
        track.positionMs = record.positionMs;
        track.bufferedMs = record.bufferedMs;
        track.integrity = record.integrity;
        break;
      }
      case "evidence":
        break; // service-level, not session state
    }
  }
  const out: RecoveredSession[] = [];
  for (const [sessionId, track] of tracked) {
    if (track.closed || track.open === undefined) continue;
    if (track.state === undefined) continue;
    if (track.state === "complete" || track.state === "failed") continue; // terminal stays terminal
    out.push({
      sessionId,
      assetId: track.open.assetId,
      fileId: track.open.fileId,
      sourcePath: track.open.sourcePath,
      lastState: track.state,
      positionMs: track.positionMs,
      bufferedMs: track.bufferedMs,
      integrity: track.integrity,
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
  state: SessionState;
  bufferedMs: number;
  positionMs: number;
  integrity: "unknown" | "verified" | "failed";
  evidence?: Readonly<Record<string, unknown>>;
}

/** The append-only session journal. */
export interface SessionJournal {
  /** The journal file path (absolute). */
  readonly path: string;
  /** The next sequence number that will be assigned (monotonic across restarts). */
  nextSeq(): number;
  /** Append an `open` record; returns the record with its assigned `seq`. */
  appendOpen(input: {
    sessionId: string;
    assetId: string;
    fileId: string;
    sourcePath: string;
    state: SessionState;
    positionMs: number;
  }): JournalOpenRecord;
  /** Append a `control` record. */
  appendControl(input: {
    sessionId: string;
    kind: JournalControlKind;
    positionMs: number;
    state: SessionState;
    detail?: string;
  }): JournalControlRecord;
  /** Append a `state` record (with optional structured evidence). */
  appendState(input: AppendStateInput): JournalStateRecord;
  /** Append an `evidence` record (service-level facts). */
  appendEvidence(message: string, data?: Readonly<Record<string, unknown>>): JournalEvidenceRecord;
  /** Every record that provably landed (torn tail + malformed lines dropped). */
  readAll(): JournalRecord[];
  /** The recoverable sessions (pure extraction over `readAll`). */
  recoverableSessions(): RecoveredSession[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidInput(`journal: '${field}' must be a non-empty string`);
  }
  return value;
}

function requireState(value: unknown, field: string): SessionState {
  if (!isSessionState(value)) {
    throw invalidInput(`journal: '${field}' must be a session state (got ${String(value)})`);
  }
  return value;
}

function requireNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidInput(`journal: '${field}' must be a finite number >= 0 (got ${String(value)})`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SessionJournalImpl implements SessionJournal {
  readonly path: string;
  private readonly clock: () => number;
  private seq: number;

  constructor(root: string, clock: () => number) {
    this.path = join(resolve(root), "journal.ndjson");
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

  appendOpen(input: {
    sessionId: string;
    assetId: string;
    fileId: string;
    sourcePath: string;
    state: SessionState;
    positionMs: number;
  }): JournalOpenRecord {
    const record: JournalOpenRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "open",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      assetId: requireNonEmpty(input.assetId, "assetId"),
      fileId: requireNonEmpty(input.fileId, "fileId"),
      sourcePath: resolve(requireNonEmpty(input.sourcePath, "sourcePath")),
      state: requireState(input.state, "state"),
      positionMs: requireNonNegative(input.positionMs, "positionMs"),
    };
    this.write(record);
    return record;
  }

  appendControl(input: {
    sessionId: string;
    kind: JournalControlKind;
    positionMs: number;
    state: SessionState;
    detail?: string;
  }): JournalControlRecord {
    const record: JournalControlRecord = {
      seq: this.takeSeq(),
      at: this.clock(),
      type: "control",
      sessionId: requireNonEmpty(input.sessionId, "sessionId"),
      kind: input.kind,
      positionMs: requireNonNegative(input.positionMs, "positionMs"),
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
      bufferedMs: requireNonNegative(input.bufferedMs, "bufferedMs"),
      positionMs: requireNonNegative(input.positionMs, "positionMs"),
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

  recoverableSessions(): RecoveredSession[] {
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
    case "open": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.assetId !== "string" ||
        typeof r.fileId !== "string" ||
        typeof r.sourcePath !== "string" ||
        !isSessionState(r.state) ||
        typeof r.positionMs !== "number"
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "open",
        sessionId: r.sessionId,
        assetId: r.assetId,
        fileId: r.fileId,
        sourcePath: r.sourcePath,
        state: r.state,
        positionMs: r.positionMs,
      };
    }
    case "control": {
      if (
        typeof r.sessionId !== "string" ||
        typeof r.kind !== "string" ||
        !isSessionState(r.state) ||
        typeof r.positionMs !== "number"
      ) {
        return undefined;
      }
      const kind = r.kind as JournalControlKind;
      if (
        kind !== "seek" &&
        kind !== "pause" &&
        kind !== "resume" &&
        kind !== "prioritize" &&
        kind !== "close" &&
        kind !== "enter-background"
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "control",
        sessionId: r.sessionId,
        kind,
        positionMs: r.positionMs,
        state: r.state,
        ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
      };
    }
    case "state": {
      if (
        typeof r.sessionId !== "string" ||
        !isSessionState(r.state) ||
        typeof r.bufferedMs !== "number" ||
        typeof r.positionMs !== "number" ||
        (r.integrity !== "unknown" &&
          r.integrity !== "verified" &&
          r.integrity !== "failed")
      ) {
        return undefined;
      }
      return {
        seq,
        at,
        type: "state",
        sessionId: r.sessionId,
        state: r.state,
        bufferedMs: r.bufferedMs,
        positionMs: r.positionMs,
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

/** Options for {@link createSessionJournal}. */
export interface SessionJournalOptions {
  /** Wall clock for record timestamps; injectable for tests. Default: Date.now. */
  readonly clock?: () => number;
}

/**
 * Create the append-only session journal under `root`
 * (`<root>/journal.ndjson`). The root directory is created when absent;
 * the sequence counter is seeded from the existing file so a restarted
 * service continues the sequence without reuse.
 */
export function createSessionJournal(
  root: string,
  options: SessionJournalOptions = {},
): SessionJournal {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw invalidInput("createSessionJournal: root must be a non-empty string");
  }
  if (typeof options !== "object" || options === null) {
    throw invalidInput("createSessionJournal: options must be an object");
  }
  return new SessionJournalImpl(root, options.clock ?? (() => Date.now()));
}
