/**
 * @wfx/torrent-engine — the per-session playback scheduler (R12).
 *
 * THE CONTROLLER: owns one session's playback scheduling state (the FSM,
 * the playhead, the velocity, the seek target, the tracked range
 * requests), and turns the pure core (windows + truth + reads) into
 * library priorities and honest answers.
 *
 * LAWS (the dispatch, restated as invariants this class enforces):
 * - PLAYBACK-DRIVEN WHILE PLAYING: during active playback the piece
 *   priorities answer the player's next-needed ranges (startup window,
 *   steady runway, seek target, explicit range requests). Outside active
 *   windows (idle / background-completion) the priorities are CLEARED and
 *   the library's own completion order is the schedule. A paused torrent
 *   session keeps its priorities on the books — they apply on resume.
 * - NO HIDDEN TIMERS: plans refresh on commands, on range requests, on
 *   `tick()`, and on truth queries — never on a background clock (the
 *   R10 scheduler-drive precedent; the host owns cadence).
 * - FACT-DRIVEN TRANSITIONS: startup→steady happens only when the startup
 *   window's pieces are all VERIFIED; seeking→steady only when the burst
 *   is verified. Honest state, honest reasons.
 * - THE COMMAND LAWS: `start` only from idle/background-completion;
 *   `progress` only while active; `seek` from any live state (a re-seek
 *   re-anchors); `stop` only from an active state. Illegal host commands
 *   are typed `INVALID_STATE` rejections — never silently reinterpreted.
 * - SCHEDULING APPLIES TO ACQUIRED FILES: the playable file must be part
 *   of the session's selection (its pieces are being acquired); commands
 *   naming other files are typed refusals. Before metadata resolves
 *   there is no piece map — commands are refused honestly.
 */

import { torrentError, type TorrentResult } from "../errors";
import type { SelectionPlan } from "../selection";
import type { TorrentMetainfo } from "../metadata";
import type { LibraryPiecePriority, LibrarySessionSnapshot } from "../library/contract";
import type { TorrentSessionState } from "../session";
import { geometryForFile, type PlayableFileGeometry } from "./geometry";
import type { PlaybackSchedulerConfig } from "./config";
import {
  computePlaybackWindows,
  computeSeekWindows,
  computeStartupWindow,
  windowSatisfied,
  type PlaybackWindow,
  type TrackedRangeRequest,
} from "./windows";
import {
  PlaybackSchedulerFsm,
  canTransitionPlaybackSchedulerState,
  type PlaybackSchedulerState,
} from "./state-machine";
import { computePlaybackTruth, type PlaybackBufferingTruth } from "./truth";
import { readVerifiedFileRange } from "./reads";

// ---------------------------------------------------------------------------
// The session view (what the engine hands the controller)
// ---------------------------------------------------------------------------

/**
 * The live, engine-internal view of one torrent session. Every accessor
 * is FRESH per call (no caching — the honest-numbers law); the engine is
 * the only constructor of views (the R11 construction law carries over).
 */
export interface SchedulerSessionView {
  readonly sessionId: string;
  /** The R11 session state, live. */
  state(): TorrentSessionState;
  /** The resolved metainfo (undefined while metadata is undiscovered). */
  metainfo(): TorrentMetainfo | undefined;
  /** The applied selection plan (undefined until selection resolves). */
  plan(): SelectionPlan | undefined;
  /** Where the library owns the bytes. */
  readonly dataDir: string;
  /** The live library snapshot (undefined when no library session exists). */
  snapshot(): LibrarySessionSnapshot | undefined;
  /** R11's stall law, live: `stalled` + duration verbatim. */
  stallFacts(): { readonly stalled: boolean; readonly stallDurationMs?: number };
  /** Push piece priorities into the library session (R12 seam). */
  applyPiecePriorities(hints: readonly LibraryPiecePriority[]): TorrentResult<void>;
}

// ---------------------------------------------------------------------------
// Commands (the host's playback vocabulary)
// ---------------------------------------------------------------------------

/** One playback command. */
export type PlaybackCommand =
  /** Playback begins at `positionBytes` (first paint pending the startup window). */
  | { readonly kind: "start"; readonly positionBytes: number; readonly bytesPerSecond: number }
  /** A position/velocity update while playing (the playhead moved). */
  | { readonly kind: "progress"; readonly positionBytes: number; readonly bytesPerSecond: number }
  /** The player seeks to `positionBytes` (the new most-needed range). */
  | { readonly kind: "seek"; readonly positionBytes: number; readonly bytesPerSecond: number }
  /** Playback stopped (background completion takes over). */
  | { readonly kind: "stop" };

/** The controller's status answer after a command/replan. */
export interface PlaybackSchedulerStatus {
  readonly sessionId: string;
  readonly schedulerState: PlaybackSchedulerState;
  readonly positionBytes?: number;
  readonly bytesPerSecond?: number;
  /** The playable file being scheduled (path + bounds). */
  readonly playableFile?:
    | { readonly fileIndex: number; readonly path: string; readonly lengthBytes: number }
    | undefined;
  /** The window plan currently applied to the library (empty = completion order). */
  readonly windows: readonly PlaybackWindow[];
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/** One session's playback scheduler. Constructed by the engine, never by product code. */
export class PlaybackSessionScheduler {
  private readonly fsm = new PlaybackSchedulerFsm();
  private readonly config: PlaybackSchedulerConfig;
  private readonly clock: () => number;

  private positionBytes: number | undefined;
  private bytesPerSecond: number | undefined;
  private seekTargetBytes: number | undefined;
  private fileIndex: number | undefined;
  private geometry: PlayableFileGeometry | undefined;
  private rangeRequests: TrackedRangeRequest[] = [];
  private currentWindows: readonly PlaybackWindow[] = [];

  constructor(config: PlaybackSchedulerConfig, clock: () => number) {
    this.config = config;
    this.clock = clock;
  }

  /** The current scheduler state (diagnostics). */
  schedulerState(): PlaybackSchedulerState {
    return this.fsm.state();
  }

  /** The window plan last applied (diagnostics; empty = completion order). */
  windows(): readonly PlaybackWindow[] {
    return this.currentWindows;
  }

  // --- commands ----------------------------------------------------------------

  /**
   * Apply a playback command. Typed refusals: `INVALID_STATE` (no piece
   * map yet, illegal command/state combination, file outside the
   * selection), `INVALID_INPUT` (malformed numbers), and any typed
   * library-priority push failure (surfaced, never swallowed).
   */
  command(
    view: SchedulerSessionView,
    command: PlaybackCommand,
    fileIndex?: number,
  ): TorrentResult<PlaybackSchedulerStatus> {
    if (typeof command !== "object" || command === null || typeof command.kind !== "string") {
      return torrentError("INVALID_INPUT", {
        sessionId: view.sessionId,
        detail: "command: a playback command must be an object with a kind",
      });
    }
    if (command.kind === "stop") {
      return this.stop(view);
    }
    const { positionBytes, bytesPerSecond } = command;
    if (
      typeof positionBytes !== "number" ||
      !Number.isSafeInteger(positionBytes) ||
      positionBytes < 0
    ) {
      return torrentError("INVALID_INPUT", {
        sessionId: view.sessionId,
        detail: `command (${command.kind}): positionBytes must be a non-negative safe integer (got ${String(positionBytes)})`,
      });
    }
    if (
      typeof bytesPerSecond !== "number" ||
      !Number.isFinite(bytesPerSecond) ||
      bytesPerSecond <= 0
    ) {
      return torrentError("INVALID_INPUT", {
        sessionId: view.sessionId,
        detail: `command (${command.kind}): bytesPerSecond must be a finite number > 0 — the scheduler maps seconds of playback to bytes through the real consumption velocity, and a non-positive velocity maps nothing (got ${String(bytesPerSecond)})`,
      });
    }
    if (command.kind === "start") {
      const state = this.fsm.state();
      if (state !== "idle" && state !== "background-completion") {
        return torrentError("INVALID_STATE", {
          sessionId: view.sessionId,
          detail: `command (start): the scheduler is ${state} — start is legal from idle (never played) or background-completion (playback stopped); use progress while playing or seek to move the playhead`,
        });
      }
      const bound = this.bindPlayableFile(view, fileIndex);
      if (!bound.ok) return bound;
      this.fsm.transitionTo("startup");
      this.positionBytes = positionBytes;
      this.bytesPerSecond = bytesPerSecond;
      this.seekTargetBytes = undefined;
      this.rangeRequests = [];
      return this.replanAndAnswer(view);
    }
    if (command.kind === "progress") {
      const state = this.fsm.state();
      if (state !== "startup" && state !== "steady" && state !== "seeking") {
        return torrentError("INVALID_STATE", {
          sessionId: view.sessionId,
          detail: `command (progress): the scheduler is ${state} — position updates apply while playback is active (start it first)`,
        });
      }
      const bound = this.bindPlayableFile(view, fileIndex);
      if (!bound.ok) return bound;
      this.positionBytes = positionBytes;
      this.bytesPerSecond = bytesPerSecond;
      return this.replanAndAnswer(view);
    }
    // seek: legal from ANY live scheduler state — the seek target is now
    // the most-needed range (rapid scrubbing re-anchors, honestly).
    const bound = this.bindPlayableFile(view, fileIndex);
    if (!bound.ok) return bound;
    this.fsm.transitionTo("seeking");
    this.positionBytes = positionBytes;
    this.bytesPerSecond = bytesPerSecond;
    this.seekTargetBytes = positionBytes;
    return this.replanAndAnswer(view);
  }

  /**
   * Note the player's explicit byte-range requests (the R10 range
   * gateway's demand). The LATEST batch replaces the previous one — the
   * gateway reports what the player needs NOW, not history. Malformed
   * requests are typed `INVALID_INPUT` rejections (nothing is silently
   * dropped); noting requests before playback is declared is a typed
   * `INVALID_STATE` refusal (the scheduler never INFERS playback from
   * reads — the host declares it).
   */
  noteRangeRequests(
    view: SchedulerSessionView,
    requests: readonly unknown[],
  ): TorrentResult<PlaybackSchedulerStatus> {
    if (!Array.isArray(requests)) {
      return torrentError("INVALID_INPUT", {
        sessionId: view.sessionId,
        detail: "noteRangeRequests: requests must be an array",
      });
    }
    const state = this.fsm.state();
    if (state === "idle" || state === "background-completion") {
      return torrentError("INVALID_STATE", {
        sessionId: view.sessionId,
        detail: `noteRangeRequests: the scheduler is ${state} — range demand applies to declared playback (start playback first; the scheduler never infers playback from reads)`,
      });
    }
    const nowMs = this.clock();
    const tracked: TrackedRangeRequest[] = [];
    for (const request of requests) {
      if (typeof request !== "object" || request === null) {
        return torrentError("INVALID_INPUT", {
          sessionId: view.sessionId,
          detail: "noteRangeRequests: each request must be an object",
        });
      }
      const { offsetBytes, lengthBytes, deadlineMs } = request as {
        offsetBytes?: unknown;
        lengthBytes?: unknown;
        deadlineMs?: unknown;
      };
      if (typeof offsetBytes !== "number" || !Number.isSafeInteger(offsetBytes) || offsetBytes < 0) {
        return torrentError("INVALID_INPUT", {
          sessionId: view.sessionId,
          detail: `noteRangeRequests: offsetBytes must be a non-negative safe integer (got ${String(offsetBytes)})`,
        });
      }
      if (typeof lengthBytes !== "number" || !Number.isSafeInteger(lengthBytes) || lengthBytes < 1) {
        return torrentError("INVALID_INPUT", {
          sessionId: view.sessionId,
          detail: `noteRangeRequests: lengthBytes must be a safe integer >= 1 (got ${String(lengthBytes)})`,
        });
      }
      if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs)) {
        return torrentError("INVALID_INPUT", {
          sessionId: view.sessionId,
          detail: `noteRangeRequests: deadlineMs must be a finite number (got ${String(deadlineMs)})`,
        });
      }
      tracked.push({ offsetBytes, lengthBytes, deadlineMs, receivedAtMs: nowMs });
    }
    this.rangeRequests = tracked;
    return this.replanAndAnswer(view);
  }

  /** The tracked range requests (diagnostics). */
  rangeDemand(): readonly TrackedRangeRequest[] {
    return this.rangeRequests.slice();
  }

  // --- the honest surfaces -------------------------------------------------------

  /**
   * THE TRUTHFUL BUFFERING ANSWER (fresh facts, evaluated now — the query
   * itself may complete a fact-driven transition, e.g. startup→steady
   * once the window's pieces verified, and the window set is recomputed
   * for the answer; the LIBRARY push stays the tick/command side — a
   * query never acts on the swarm).
   */
  truth(view: SchedulerSessionView): PlaybackBufferingTruth {
    this.evaluateFacts(view);
    this.currentWindows = this.computeWindowsForState(this.fsm.state());
    const snapshot = view.snapshot();
    const stall = view.stallFacts();
    return computePlaybackTruth({
      sessionId: view.sessionId,
      schedulerState: this.fsm.state(),
      geometry: this.geometry,
      positionBytes: this.positionBytes,
      bytesPerSecond: this.bytesPerSecond,
      windows: this.currentWindows,
      bitfield: snapshot?.bitfield,
      sessionCompleted: view.state() === "completed",
      sessionPaused: view.state() === "seeding-paused",
      connectedPeers: snapshot?.connectedPeers ?? 0,
      downloadBytesPerSec: snapshot?.downloadBytesPerSec ?? 0,
      sessionStalled: stall.stalled,
      stallDurationMs: stall.stallDurationMs,
      nowMs: this.clock(),
      rangeRequests: this.rangeRequests,
    });
  }

  /**
   * THE ORDERED INTEGRITY-GATED READ: real bytes of the playable file,
   * served only when every covering piece is verified. Composes with
   * watch-order arrival — a seek burst that landed makes the seek range
   * readable long before the file completes.
   */
  async readVerifiedRange(
    view: SchedulerSessionView,
    request: { readonly offsetBytes: number; readonly lengthBytes: number },
    fileIndex?: number,
  ): Promise<TorrentResult<Uint8Array>> {
    const bound = this.resolveGeometry(view, fileIndex ?? this.fileIndex);
    if (!bound.ok) return bound;
    const state = view.state();
    if (
      state !== "downloading" &&
      state !== "seeding-paused" &&
      state !== "verifying" &&
      state !== "completed"
    ) {
      return torrentError("INVALID_STATE", {
        sessionId: view.sessionId,
        detail: `readVerifiedRange: the session is ${state} — bytes exist to read once the session is transferring (or paused mid-transfer, verifying, or completed)`,
      });
    }
    const snapshot = view.snapshot();
    return readVerifiedFileRange({
      geometry: bound.value,
      dataDir: view.dataDir,
      bitfield: snapshot?.bitfield,
      sessionCompleted: state === "completed",
      offsetBytes: request.offsetBytes,
      lengthBytes: request.lengthBytes,
    });
  }

  /**
   * Refresh the plan for this session (the tick/command/query path) and
   * push it onto the library. Returns the push outcome so callers can
   * surface typed failures honestly.
   *
   * THE PAUSED LAW (the dispatch): paused sessions keep COMPLETION
   * priority — a seeding-paused torrent session has its hints CLEARED
   * (the library's own selection order is the schedule); the playback
   * plan is restored automatically by the next tick/command after resume
   * (self-healing, no hidden timers).
   */
  replan(view: SchedulerSessionView): TorrentResult<boolean> {
    this.evaluateFacts(view);
    const state = this.fsm.state();
    this.currentWindows = this.computeWindowsForState(state);
    const sessionState = view.state();
    if (sessionState === "seeding-paused") {
      const cleared = view.applyPiecePriorities([]);
      if (!cleared.ok) return cleared;
      return { ok: true, value: false };
    }
    if (sessionState !== "downloading") {
      // No transfer surface accepts priorities (verifying/completed/failed/
      // discovering). The recorded plan stays for diagnostics; nothing is
      // pushed — and nothing NEEDS pushing: there is no active window.
      return { ok: true, value: false };
    }
    const hints: LibraryPiecePriority[] = this.currentWindows.map((window) => ({
      fromPiece: window.fromPiece,
      toPiece: window.toPiece,
      urgency: window.urgency,
    }));
    const applied = view.applyPiecePriorities(hints);
    if (!applied.ok) return applied;
    return { ok: true, value: true };
  }

  /** Detach (engine teardown) — the slot returns to idle, plans cleared. */
  detach(): void {
    if (canTransitionPlaybackSchedulerState(this.fsm.state(), "idle")) {
      this.fsm.transitionTo("idle");
    }
    this.positionBytes = undefined;
    this.bytesPerSecond = undefined;
    this.seekTargetBytes = undefined;
    this.rangeRequests = [];
    this.currentWindows = [];
  }

  // --- internals -------------------------------------------------------------------

  private stop(view: SchedulerSessionView): TorrentResult<PlaybackSchedulerStatus> {
    const state = this.fsm.state();
    if (state !== "startup" && state !== "steady" && state !== "seeking") {
      return torrentError("INVALID_STATE", {
        sessionId: view.sessionId,
        detail: `command (stop): the scheduler is ${state} — there is no active playback to stop`,
      });
    }
    this.fsm.transitionTo("background-completion");
    this.rangeRequests = [];
    return this.replanAndAnswer(view);
  }

  /** Bind the playable file (sticky; explicit index or the first selected file). */
  private bindPlayableFile(
    view: SchedulerSessionView,
    fileIndex: number | undefined,
  ): TorrentResult<void> {
    const resolved = this.resolveGeometry(view, fileIndex ?? this.fileIndex);
    if (!resolved.ok) return resolved as TorrentResult<void>;
    this.fileIndex = resolved.value.fileIndex;
    this.geometry = resolved.value;
    return { ok: true, value: undefined };
  }

  /**
   * Resolve the playable file's geometry. Requires resolved metadata (a
   * piece map) and — when a plan exists — a file inside the selection
   * (scheduling applies to acquired bytes). Default: the FIRST selected
   * file (J22's "choose file"); an explicit index overrides.
   */
  private resolveGeometry(
    view: SchedulerSessionView,
    fileIndex: number | undefined,
  ): TorrentResult<PlayableFileGeometry> {
    const metainfo = view.metainfo();
    if (metainfo === undefined) {
      return torrentError("INVALID_STATE", {
        sessionId: view.sessionId,
        detail:
          "the session's metadata has not resolved — no piece map exists to map playback bytes onto pieces; retry once the session reaches selecting/downloading",
      });
    }
    const plan = view.plan();
    let index = fileIndex;
    if (index === undefined) {
      if (plan !== undefined && plan.selectedFiles.length > 0) {
        index = metainfo.files.indexOf(plan.selectedFiles[0]!);
      } else {
        index = 0;
      }
    }
    if (plan !== undefined && !plan.selection.fileIndexes.includes(index)) {
      return torrentError("INVALID_STATE", {
        sessionId: view.sessionId,
        detail: `file index ${String(index)} ('${metainfo.files[index]?.path ?? "?"}') is not in the session's selection — the scheduler prioritizes acquired bytes; schedule one of the selected files (${plan.selection.fileIndexes.map((i) => metainfo.files[i]?.path ?? String(i)).join(", ")})`,
      });
    }
    return geometryForFile(
      metainfo.files,
      index,
      metainfo.pieceLengthBytes,
      metainfo.pieceCount,
    );
  }

  /** Fact-driven transitions: startup→steady, seeking→steady. */
  private evaluateFacts(view: SchedulerSessionView): void {
    const state = this.fsm.state();
    const bitfield = view.snapshot()?.bitfield;
    if (bitfield === undefined) return;
    if (state === "startup") {
      if (this.geometry === undefined || this.positionBytes === undefined || this.bytesPerSecond === undefined) return;
      const startup = computeStartupWindow(
        this.geometry,
        this.positionBytes,
        this.bytesPerSecond,
        this.config,
      );
      if (startup !== null && windowSatisfied(startup, bitfield)) {
        this.fsm.transitionTo("steady");
      }
      return;
    }
    if (state === "seeking") {
      if (this.geometry === undefined || this.seekTargetBytes === undefined) return;
      const burst = computeSeekWindows(this.geometry, this.seekTargetBytes, 1, this.config).burst;
      if (burst !== null && windowSatisfied(burst, bitfield)) {
        this.fsm.transitionTo("steady");
      }
    }
  }

  /** The window plan for a scheduler state (the mode mapping). */
  private computeWindowsForState(state: PlaybackSchedulerState): readonly PlaybackWindow[] {
    if (
      this.geometry === undefined ||
      this.positionBytes === undefined ||
      this.bytesPerSecond === undefined ||
      state === "idle" ||
      state === "background-completion"
    ) {
      return []; // completion priority: the library's own selection order
    }
    const mode = state === "startup" ? "startup" : state === "steady" ? "steady" : "seeking";
    const plan = computePlaybackWindows({
      geometry: this.geometry,
      config: this.config,
      mode,
      positionBytes: this.positionBytes,
      bytesPerSecond: this.bytesPerSecond,
      ...(mode === "seeking" && this.seekTargetBytes !== undefined
        ? { seekTargetBytes: this.seekTargetBytes }
        : {}),
      ...(this.rangeRequests.length > 0 ? { rangeRequests: this.rangeRequests } : {}),
    });
    return plan.ok ? plan.value : [];
  }

  private replanAndAnswer(view: SchedulerSessionView): TorrentResult<PlaybackSchedulerStatus> {
    const replanned = this.replan(view);
    if (!replanned.ok) return replanned;
    return {
      ok: true,
      value: {
        sessionId: view.sessionId,
        schedulerState: this.fsm.state(),
        ...(this.positionBytes !== undefined ? { positionBytes: this.positionBytes } : {}),
        ...(this.bytesPerSecond !== undefined ? { bytesPerSecond: this.bytesPerSecond } : {}),
        ...(this.geometry !== undefined
          ? {
              playableFile: {
                fileIndex: this.geometry.fileIndex,
                path: this.geometry.filePath,
                lengthBytes: this.geometry.fileLengthBytes,
              },
            }
          : {}),
        windows: this.currentWindows,
      },
    };
  }
}
