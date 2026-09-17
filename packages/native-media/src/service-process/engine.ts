/**
 * @wfx/native-media — THE REAL ENGINE (R10, production).
 *
 * The production `NativeMediaEngine` + `RangeAccessEngine` implementation:
 * LOCAL-FILE-BACKED sessions over REAL bytes — real `stat` at open, real
 * reads for every accounted piece, real range serving from the source
 * file, and real digest verification against the asset store. It is the
 * service the R08 desktop binding speaks to through the frozen v1 DTO
 * wire (`engine/process.ts`); the SIMULATION (`engine/simulation.ts`)
 * remains the TEST/DEV behavioral reference and is never imported here
 * (enforced by the production import-guard test).
 *
 * HONESTY LAWS:
 *
 * 1. NO FAKE BUFFERING. `bufferedMs` advances ONLY as bytes actually land:
 *    a piece is accounted as buffered exclusively after its bytes have
 *    been READ from the source file (real I/O — the read-ahead budget is
 *    `floor(elapsedMs * readBytesPerSecond / 1000)`, the simulation's
 *    deterministic law, but every accounted piece performs a real read).
 *    The source file is the buffer's backing store; `readRange` serves
 *    the real bytes of any interval whose covering pieces are accounted.
 * 2. NOMINAL TIMELINE. The frozen DTO carries no media duration and no
 *    container parser exists in-lane (no new dependencies), so the
 *    byte↔time mapping is the documented NOMINAL law:
 *    `durationMs = totalBytes * 8 * 1000 / nominalBitrateBps` (bitrate
 *    injected by config). The mapping is monotone, deterministic, and
 *    identical for every observer — honest about what it measures.
 * 3. COMPLETE REQUIRES PROOF. A session may enter the terminal `complete`
 *    state ONLY after its asset was PERSISTED to the store AND the full
 *    stored hash matched the recorded digest (integrity `verified`) — the
 *    frozen law the R08 binding relies on (`complete ⇒ verified`). A
 *    persistence failure (quota/disk) or a digest mismatch fails the
 *    session honestly (`failed` with the typed detail; FSM-legal from
 *    both `playing` and `background`).
 * 4. STORE-BACKED SESSIONS VERIFY ON OPEN. Opening a path inside the
 *    store (`assets/<assetId>/content.bin`) re-hashes the stored bytes
 *    and compares against the recorded digest: `verified` ⇒ the session
 *    opens with the verdict; mismatch ⇒ open REJECTS with
 *    `VERIFICATION_FAILED` (the corrupt law — corrupt bytes are never
 *    served). Disk truth is re-checked on every `statMedia` (a source
 *    that changed size since open is refused with a typed `IO_ERROR`).
 * 5. PRIORITIZE GEOMETRY (documented for R12). Wire `piece` indices are
 *    ABSOLUTE indices into the session's piece geometry — the simulation's
 *    and the gateway hint's geometry: `pieceCount` equal-size pieces of
 *    `floor(totalBytes / pieceCount)` bytes (last piece absorbs the
 *    remainder). The service host translates the WFX-023 scheduler's
 *    playhead-RELATIVE ordinals onto this geometry at its wiring point.
 * 6. PAUSE IS NOT A STATE (the frozen union has no `paused`): `pause`
 *    freezes the playback clock; the read-ahead continues (that is the
 *    point of pausing a streaming download). `resume` (re)starts
 *    playback: `buffering -> playing` and `background -> playing` are
 *    the FSM-legal hops.
 * 7. BACKGROUND is engine-internal on the frozen surface (no v1 wire
 *    command reaches it): {@link RealEngine.enterBackground} performs the
 *    FSM-legal `playing -> background` hop for the service host's
 *    background-completion policy; a `background` session whose bytes all
 *    land completes through the same persist+verify law as playback end.
 */

import { relative, resolve as resolvePath } from "node:path";
import { isAbsolute } from "node:path";
import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import { NativeMediaError } from "../errors";
import type { RangeAccessEngine } from "../service";
import { makeSession, transition } from "../session";
import { NOMINAL_PIECE_BYTES } from "../scheduler/model";
import {
  assetIdForPath,
  createAssetStore,
  type AssetStore,
} from "./store";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options for {@link createRealEngine}. */
export interface RealEngineConfig {
  /** The store root (== the spawn `EngineConfig.cacheDir`). */
  readonly storeRoot: string;
  /** The store's policy byte budget (`EngineConfig.maxCacheBytes`). */
  readonly maxCacheBytes: number;
  /**
   * The read-ahead piece size in bytes. Also the session's piece geometry
   * base (`pieceCount = max(1, floor(totalBytes / readChunkBytes))`).
   * Default: 262144 (the WFX-023 nominal piece size).
   */
  readonly readChunkBytes?: number;
  /**
   * The read-ahead throughput budget, bytes/second (the deterministic
   * elapsed-time law; every accounted piece is still a REAL read).
   * Default: 16 MiB/s.
   */
  readonly readBytesPerSecond?: number;
  /** The read-ahead/playback tick, ms. Default: 25. */
  readonly tickMs?: number;
  /**
   * The NOMINAL media bitrate (bits/second) for the byte↔timeline mapping
   * (see module docs, law 2). Default: 2 Mbps.
   */
  readonly nominalBitrateBps?: number;
  /** Buffer lead required to (re)start playback, ms. Default: 250. */
  readonly rebufferLeadMs?: number;
  /** Content type reported by `statMedia` (the engine never sniffs containers). Default: "application/octet-stream". */
  readonly contentType?: string;
  /** Injected monotonic clock. Default: `performance.now`. */
  readonly clock?: () => number;
  /** Run the read-ahead/playback timer automatically. Default: `true`. */
  readonly autoTick?: boolean;
  /** Verify store-backed sources on open (full re-hash). Default: `true`. */
  readonly verifyStoredAssetsOnOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Engine surface (frozen + additive, engine-local)
// ---------------------------------------------------------------------------

/** A session snapshot notification (fired after every snapshot change). */
export type RealEngineUpdateListener = (session: NativeMediaSession) => void;

/**
 * The observable geometry of one live session — the honest wiring data
 * the service host's scheduler translation needs (see module docs, law 5):
 * absolute piece indices, the playhead's piece, and the nominal timeline.
 */
export interface SessionGeometryInfo {
  readonly totalBytes: number;
  readonly durationMs: number;
  readonly pieceCount: number;
  readonly pieceSize: number;
  /** The ABSOLUTE piece index containing the current playhead byte. */
  readonly playheadPiece: number;
}

/**
 * THE REAL ENGINE: the frozen `NativeMediaEngine`, the optional
 * `RangeAccessEngine` extension, and additive engine-local surfaces
 * (observability, background admission, recovery restore, deterministic
 * pumps). The extra members are NOT part of the frozen contract — they
 * exist for the service host (service.ts) and tests, mirroring the
 * simulation's engine-local surface.
 */
export interface RealEngine extends NativeMediaEngine, RangeAccessEngine {
  /** Brand: this object is the REAL production engine (never a simulation). */
  readonly isRealEngine: true;
  /** The asset store this engine persists completions into. */
  readonly store: AssetStore;
  /** Subscribe to session snapshot updates. Returns an unsubscribe. */
  onUpdate(listener: RealEngineUpdateListener): () => void;
  /** Current snapshot for a live session, else `undefined`. */
  snapshot(sessionId: string): NativeMediaSession | undefined;
  /** Structured evidence attached to the session's latest state change. */
  lastEvidence(sessionId: string): Readonly<Record<string, unknown>> | undefined;
  /** The observable geometry of one live session (undefined when unknown). */
  sessionGeometry(sessionId: string): SessionGeometryInfo | undefined;
  /**
   * The FSM-legal `playing -> background` hop (module docs, law 7): the
   * service host's background-completion admission trigger. Typed errors
   * like every control.
   */
  enterBackground(sessionId: string): Promise<NativeMediaSession>;
  /**
   * RECOVERY RESTORE: re-open a journaled session with its OWN id and its
   * journaled position (the documented paused-by-restart mapping: the
   * session re-enters as `buffering` at the control point, buffered
   * honestly reset to 0 — the in-memory buffer died with the previous
   * process). Throws the typed NOT_FOUND when the source bytes vanished.
   */
  restoreSession(input: {
    sessionId: string;
    sourcePath: string;
    positionMs: number;
    integrity?: "unknown" | "verified" | "failed";
  }): Promise<NativeMediaSession>;
  /**
   * RECOVERY TOMBSTONE: record a restored session whose source bytes
   * vanished as `failed` with the honest detail (the journal + wire
   * emission carry it; later control attempts answer SESSION_CLOSED).
   */
  markRestoredSessionFailed(input: {
    sessionId: string;
    assetId: string;
    fileId: string;
    detail: string;
  }): NativeMediaSession;
  /**
   * TEST/manual pump: read EXACTLY ONE pending piece (budget bypass) and
   * return the bytes read (0 when nothing was pending). Deterministic
   * byte-exact buffering assertions pump this; the timer path shares the
   * same piece-read primitive.
   */
  pumpOnce(sessionId?: string): Promise<number>;
  /**
   * One read-ahead + playback tick against the injected clock (the timer
   * calls the same internal). Deterministic with a manual clock.
   */
  tickOnce(): Promise<void>;
  /** Stop the timer and drop every session (idempotent). */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** The resolved geometry of one session's source file. */
interface Geometry {
  readonly totalBytes: number;
  readonly durationMs: number;
  readonly pieceCount: number;
  readonly pieceSize: number;
  readonly lastPieceBytes: number;
}

/** Everything the engine tracks for one live session. */
interface LiveSession {
  session: NativeMediaSession;
  /** The ABSOLUTE source path (a real file). */
  sourcePath: string;
  geometry: Geometry;
  downloaded: boolean[];
  pendingOrder: number[];
  downloadedBytes: number;
  paused: boolean;
  stalled: boolean;
  openedAtMs: number;
  lastTickMs: number;
  /** True when the source lives inside the asset store (`assets/<id>/content.bin`). */
  storeBacked: boolean;
  /** Structured evidence for the latest state change (completion/recovery). */
  evidence: Readonly<Record<string, unknown>> | undefined;
}

const DEFAULT_READ_BYTES_PER_SECOND = 16 * 1024 * 1024;
const DEFAULT_TICK_MS = 25;
const DEFAULT_REBUFFER_LEAD_MS = 250;
const DEFAULT_NOMINAL_BITRATE_BPS = 2_000_000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

class RealEngineImpl implements RealEngine {
  readonly isRealEngine = true as const;
  readonly store: AssetStore;
  private readonly readChunkBytes: number;
  private readonly readBytesPerSecond: number;
  private readonly tickMs: number;
  private readonly nominalBitrateBps: number;
  private readonly rebufferLeadMs: number;
  private readonly contentType: string;
  private readonly verifyStoredAssetsOnOpen: boolean;
  private readonly clock: () => number;
  private readonly sessions = new Map<string, LiveSession>();
  private readonly closedIds = new Set<string>();
  private readonly listeners = new Set<RealEngineUpdateListener>();
  private counter = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private disposed = false;

  constructor(config: RealEngineConfig) {
    if (typeof config !== "object" || config === null) {
      throw invalidInput("createRealEngine: config must be an object");
    }
    this.store = createAssetStore({
      root: config.storeRoot,
      maxBytes: config.maxCacheBytes,
    });
    this.readChunkBytes = config.readChunkBytes ?? NOMINAL_PIECE_BYTES;
    if (!Number.isSafeInteger(this.readChunkBytes) || this.readChunkBytes <= 0) {
      throw invalidInput("createRealEngine: readChunkBytes must be a positive safe integer");
    }
    this.readBytesPerSecond =
      config.readBytesPerSecond ?? DEFAULT_READ_BYTES_PER_SECOND;
    if (!Number.isFinite(this.readBytesPerSecond) || this.readBytesPerSecond <= 0) {
      throw invalidInput("createRealEngine: readBytesPerSecond must be a finite number > 0");
    }
    this.tickMs = config.tickMs ?? DEFAULT_TICK_MS;
    if (!Number.isSafeInteger(this.tickMs) || this.tickMs <= 0) {
      throw invalidInput("createRealEngine: tickMs must be a positive safe integer");
    }
    this.nominalBitrateBps = config.nominalBitrateBps ?? DEFAULT_NOMINAL_BITRATE_BPS;
    if (!Number.isFinite(this.nominalBitrateBps) || this.nominalBitrateBps <= 0) {
      throw invalidInput("createRealEngine: nominalBitrateBps must be a finite number > 0");
    }
    this.rebufferLeadMs = config.rebufferLeadMs ?? DEFAULT_REBUFFER_LEAD_MS;
    if (!Number.isFinite(this.rebufferLeadMs) || this.rebufferLeadMs < 0) {
      throw invalidInput("createRealEngine: rebufferLeadMs must be a finite number >= 0");
    }
    this.contentType = config.contentType ?? "application/octet-stream";
    if (typeof this.contentType !== "string" || this.contentType.trim().length === 0) {
      throw invalidInput("createRealEngine: contentType must be a non-empty string");
    }
    this.verifyStoredAssetsOnOpen = config.verifyStoredAssetsOnOpen ?? true;
    this.clock = config.clock ?? (() => performance.now());
    if (typeof this.clock !== "function") {
      throw invalidInput("createRealEngine: clock must be a function () => number");
    }
    if (config.autoTick ?? true) {
      this.timer = setInterval(() => {
        void this.tick();
      }, this.tickMs);
    }
  }

  // --- observability ---------------------------------------------------------

  onUpdate(listener: RealEngineUpdateListener): () => void {
    this.requireLive("onUpdate");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(sessionId: string): NativeMediaSession | undefined {
    const live = this.sessions.get(sessionId);
    return live === undefined ? undefined : { ...live.session };
  }

  lastEvidence(sessionId: string): Readonly<Record<string, unknown>> | undefined {
    const live = this.sessions.get(sessionId);
    return live === undefined ? undefined : live.evidence;
  }

  sessionGeometry(sessionId: string): SessionGeometryInfo | undefined {
    const live = this.sessions.get(sessionId);
    if (live === undefined) return undefined;
    const positionByte = Math.min(
      live.geometry.totalBytes - 1,
      Math.floor(
        (live.session.positionMs / live.geometry.durationMs) * live.geometry.totalBytes,
      ),
    );
    return {
      totalBytes: live.geometry.totalBytes,
      durationMs: live.geometry.durationMs,
      pieceCount: live.geometry.pieceCount,
      pieceSize: live.geometry.pieceSize,
      playheadPiece: pieceIndexOf(positionByte, live.geometry),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.sessions.clear();
    this.listeners.clear();
  }

  // --- frozen NativeMediaEngine surface --------------------------------------

  async open(input: {
    magnet?: string;
    torrentBytes?: Uint8Array;
    localPath?: string;
  }): Promise<NativeMediaSession> {
    this.requireLive("open");
    if (typeof input !== "object" || input === null) {
      throw invalidInput("open: input must be an object");
    }
    if (input.torrentBytes !== undefined) {
      throw new NativeMediaError("UNSUPPORTED_SOURCE", {
        detail:
          "open: torrentBytes sources cannot cross the v1 JSON wire (R11's torrent lane will pre-stage assets and hand the engine a localPath)",
      });
    }
    if (input.magnet !== undefined) {
      if (typeof input.magnet !== "string" || input.magnet.trim().length === 0) {
        throw invalidInput("open: magnet must be a non-empty string");
      }
      throw new NativeMediaError("UNSUPPORTED_SOURCE", {
        detail:
          "open: magnet sources are R11's torrent-engine lane; the R10 production engine serves local files and stored assets (localPath)",
      });
    }
    if (typeof input.localPath !== "string" || input.localPath.trim().length === 0) {
      throw invalidInput("open: localPath must be a non-empty string");
    }
    const sourcePath = resolvePath(input.localPath);
    const resolved = await this.resolveSource(sourcePath);
    this.counter += 1;
    const session = makeSession({
      id: `real-session-${this.counter}`,
      assetId: resolved.assetId,
      fileId: `file-${resolved.assetId.slice("asset-".length)}`,
      state: "buffering",
      bufferedMs: 0,
      positionMs: 0,
      ...(resolved.integrity !== undefined ? { integrity: resolved.integrity } : {}),
    });
    const now = this.now();
    this.sessions.set(session.id, {
      session,
      sourcePath,
      geometry: resolved.geometry,
      downloaded: new Array<boolean>(resolved.geometry.pieceCount).fill(false),
      pendingOrder: sequentialOrder(0, resolved.geometry.pieceCount),
      downloadedBytes: 0,
      paused: false,
      stalled: true,
      openedAtMs: now,
      lastTickMs: now,
      storeBacked: resolved.storeBacked,
      evidence: undefined,
    });
    this.notify(session.id);
    return { ...session };
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    const live = this.requireControllable("seek", sessionId);
    if (
      typeof positionMs !== "number" ||
      !Number.isFinite(positionMs) ||
      positionMs < 0 ||
      positionMs > live.geometry.durationMs
    ) {
      throw invalidInput(
        `seek: positionMs must be a finite number in [0, ${live.geometry.durationMs}] (got ${String(positionMs)})`,
      );
    }
    const seekByte = Math.min(
      live.geometry.totalBytes - 1,
      Math.floor((positionMs / live.geometry.durationMs) * live.geometry.totalBytes),
    );
    const seekPiece = pieceIndexOf(seekByte, live.geometry);
    // Deadline-aware re-cursor: pending pieces from the seek point forward
    // first, then the earlier pending pieces as backfill (the simulation
    // law — the behavioral reference).
    const pendingSet = new Set(live.pendingOrder);
    const forward: number[] = [];
    const backward: number[] = [];
    for (let piece = 0; piece < live.geometry.pieceCount; piece += 1) {
      if (!pendingSet.has(piece)) continue;
      if (piece >= seekPiece) forward.push(piece);
      else backward.push(piece);
    }
    live.pendingOrder = [...forward, ...backward];
    live.session = { ...live.session, positionMs };
    live.stalled = live.session.bufferedMs - positionMs < this.rebufferLeadMs;
    live.lastTickMs = this.now();
    this.notify(sessionId);
  }

  async prioritize(
    sessionId: string,
    deadlines: { piece: number; deadlineMs: number }[],
  ): Promise<void> {
    const live = this.requireControllable("prioritize", sessionId);
    if (!Array.isArray(deadlines)) {
      throw invalidInput("prioritize: deadlines must be an array");
    }
    const deadlineMap = new Map<number, number>();
    for (const entry of deadlines) {
      if (typeof entry !== "object" || entry === null) {
        throw invalidInput("prioritize: each deadline must be an object");
      }
      const { piece, deadlineMs } = entry;
      if (
        typeof piece !== "number" ||
        !Number.isSafeInteger(piece) ||
        piece < 0 ||
        piece >= live.geometry.pieceCount
      ) {
        throw invalidInput(
          `prioritize: piece must be a safe integer in [0, ${live.geometry.pieceCount - 1}] (got ${String(piece)}) — ABSOLUTE piece indices (module docs, law 5)`,
        );
      }
      if (
        typeof deadlineMs !== "number" ||
        !Number.isFinite(deadlineMs) ||
        deadlineMs < 0
      ) {
        throw invalidInput(
          `prioritize: deadlineMs must be a finite number >= 0 (got ${String(deadlineMs)})`,
        );
      }
      const previous = deadlineMap.get(piece);
      if (previous === undefined || deadlineMs < previous) {
        deadlineMap.set(piece, deadlineMs);
      }
    }
    // Hoist pending pieces with deadlines (ascending deadline, piece index
    // as tiebreak) to the front of the read order (the simulation law).
    const withDeadlines = [...deadlineMap.keys()]
      .filter((piece) => live.pendingOrder.includes(piece))
      .sort((a, b) => {
        const da = deadlineMap.get(a) ?? 0;
        const db = deadlineMap.get(b) ?? 0;
        return da === db ? a - b : da - db;
      });
    const withSet = new Set(withDeadlines);
    const rest = live.pendingOrder.filter((piece) => !withSet.has(piece));
    live.pendingOrder = [...withDeadlines, ...rest];
    // No snapshot field changes: piece priorities are engine-internal; the
    // command acknowledgment carries the unchanged snapshot.
  }

  async pause(sessionId: string): Promise<void> {
    const live = this.requireControllable("pause", sessionId);
    // Pause is NOT a state (the frozen union has no `paused`): the
    // playback clock freezes; the read-ahead continues (module docs, law 6).
    live.paused = true;
    live.lastTickMs = this.now();
  }

  async resume(sessionId: string): Promise<void> {
    const live = this.requireControllable("resume", sessionId);
    live.paused = false;
    live.lastTickMs = this.now();
    if (live.session.state === "buffering" || live.session.state === "background") {
      // FSM-legal playback-start hops (the frozen interface's playback
      // primitive is `resume` — WFX-004 service docs).
      live.session = transition(live.session, "playing");
    }
    live.stalled = live.session.bufferedMs - live.session.positionMs < this.rebufferLeadMs;
    this.notify(sessionId);
  }

  async close(sessionId: string): Promise<void> {
    this.requireLive("close");
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput("close: sessionId must be a non-empty string");
    }
    if (this.closedIds.has(sessionId)) return; // idempotent double-close
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `close: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    this.sessions.delete(sessionId);
    this.closedIds.add(sessionId);
  }

  // --- optional RangeAccessEngine extension -----------------------------------

  async statMedia(
    sessionId: string,
  ): Promise<{ totalBytes: number; contentType: string }> {
    const live = this.requireRangable("statMedia", sessionId);
    // DISK TRUTH: re-stat the source; a file that changed size since open
    // is a stale session view — refuse honestly, never serve a mixed view.
    const size = await statFileSize(live.sourcePath);
    if (size === null || size !== live.geometry.totalBytes) {
      throw new NativeMediaError("IO_ERROR", {
        detail:
          `statMedia: the source file '${live.sourcePath}' ${size === null ? "no longer exists" : `changed size (open said ${live.geometry.totalBytes}, disk says ${size})`} — the session's view is stale; re-open the session`,
        sessionId,
      });
    }
    let contentType = this.contentType;
    if (live.storeBacked) {
      const assetId = assetIdOfContentPath(live.sourcePath, this.store);
      const meta = assetId === null ? undefined : this.store.getAsset(assetId);
      if (meta !== undefined) contentType = meta.contentType;
    }
    return { totalBytes: live.geometry.totalBytes, contentType };
  }

  async readRange(
    sessionId: string,
    startByte: number,
    endByte: number,
  ): Promise<Uint8Array> {
    const live = this.requireRangable("readRange", sessionId);
    if (
      typeof startByte !== "number" ||
      !Number.isSafeInteger(startByte) ||
      typeof endByte !== "number" ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 ||
      endByte < startByte
    ) {
      throw invalidInput(
        `readRange: [${String(startByte)}, ${String(endByte)}] is not a well-formed inclusive byte interval`,
      );
    }
    if (
      startByte >= live.geometry.totalBytes ||
      endByte >= live.geometry.totalBytes
    ) {
      throw new NativeMediaError("RANGE_NOT_SATISFIABLE", {
        detail: `readRange: [${startByte}, ${endByte}] is not satisfiable against ${live.geometry.totalBytes} bytes`,
        sessionId,
      });
    }
    const firstPiece = pieceIndexOf(startByte, live.geometry);
    const lastPiece = pieceIndexOf(endByte, live.geometry);
    for (let piece = firstPiece; piece <= lastPiece; piece += 1) {
      if (!live.downloaded[piece]) {
        throw new NativeMediaError("IO_ERROR", {
          detail: `readRange: bytes ${startByte}-${endByte} cover piece ${piece}, which is not read yet (${live.downloadedBytes}/${live.geometry.totalBytes} bytes accounted) — retry while the read-ahead progresses`,
          sessionId,
        });
      }
    }
    // REAL bytes from the source file (the buffer's backing store).
    try {
      const buffer = await Bun.file(live.sourcePath)
        .slice(startByte, endByte + 1)
        .arrayBuffer();
      return new Uint8Array(buffer);
    } catch (e) {
      throw new NativeMediaError("IO_ERROR", {
        detail: `readRange: reading bytes ${startByte}-${endByte} from '${live.sourcePath}' failed: ${e instanceof Error ? e.message : String(e)}`,
        sessionId,
      });
    }
  }

  // --- additive engine-local surface -------------------------------------------

  async enterBackground(sessionId: string): Promise<NativeMediaSession> {
    const live = this.requireControllable("enterBackground", sessionId);
    if (live.session.state !== "playing") {
      throw invalidInput(
        `enterBackground: session '${sessionId}' is '${live.session.state}' — only a playing session can background (FSM: playing -> background)`,
      );
    }
    live.session = transition(live.session, "background");
    live.paused = false; // background completion keeps reading (law 7)
    this.notify(sessionId);
    return { ...live.session };
  }

  async restoreSession(input: {
    sessionId: string;
    sourcePath: string;
    positionMs: number;
    integrity?: "unknown" | "verified" | "failed";
  }): Promise<NativeMediaSession> {
    this.requireLive("restoreSession");
    if (typeof input !== "object" || input === null) {
      throw invalidInput("restoreSession: input must be an object");
    }
    const sessionId = input.sessionId;
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput("restoreSession: sessionId must be a non-empty string");
    }
    if (this.sessions.has(sessionId) || this.closedIds.has(sessionId)) {
      throw invalidInput(
        `restoreSession: session '${sessionId}' already exists in this engine instance`,
      );
    }
    const sourcePath = resolvePath(input.sourcePath);
    // The journaled position is the control point; clamp into the CURRENT
    // geometry (the file may have changed — the clamp keeps it honest).
    const resolved = await this.resolveSource(sourcePath);
    const positionMs =
      typeof input.positionMs === "number" && Number.isFinite(input.positionMs)
        ? Math.min(Math.max(0, input.positionMs), resolved.geometry.durationMs)
        : 0;
    if (input.integrity === "failed") {
      // A journaled `failed` integrity verdict stays failed — the honest
      // tombstone (recovery of a corrupt asset never re-verifies green).
      const session = makeSession({
        id: sessionId,
        assetId: resolved.assetId,
        fileId: `file-${resolved.assetId.slice("asset-".length)}`,
        state: "failed",
        bufferedMs: 0,
        positionMs,
        integrity: "failed",
      });
      this.sessions.set(sessionId, {
        session,
        sourcePath,
        geometry: resolved.geometry,
        downloaded: new Array<boolean>(resolved.geometry.pieceCount).fill(false),
        pendingOrder: [],
        downloadedBytes: 0,
        paused: false,
        stalled: true,
        openedAtMs: this.now(),
        lastTickMs: this.now(),
        storeBacked: resolved.storeBacked,
        evidence: { recovered: true, reason: "integrity-failed-at-restore" },
      });
      this.notify(sessionId);
      return { ...session };
    }
    // The documented paused-by-restart mapping: `buffering` at the journaled
    // control point, buffered honestly 0, integrity from the verdict (a
    // store-backed source re-verifies on restore through resolveSource).
    const session = makeSession({
      id: sessionId,
      assetId: resolved.assetId,
      fileId: `file-${resolved.assetId.slice("asset-".length)}`,
      state: "buffering",
      bufferedMs: 0,
      positionMs,
      ...(resolved.integrity !== undefined ? { integrity: resolved.integrity } : {}),
    });
    const now = this.now();
    const seekByte = Math.min(
      resolved.geometry.totalBytes - 1,
      Math.floor((positionMs / resolved.geometry.durationMs) * resolved.geometry.totalBytes),
    );
    const seekPiece = pieceIndexOf(seekByte, resolved.geometry);
    this.sessions.set(sessionId, {
      session,
      sourcePath,
      geometry: resolved.geometry,
      downloaded: new Array<boolean>(resolved.geometry.pieceCount).fill(false),
      pendingOrder: sequentialOrder(seekPiece, resolved.geometry.pieceCount),
      downloadedBytes: 0,
      paused: false,
      stalled: true,
      openedAtMs: now,
      lastTickMs: now,
      storeBacked: resolved.storeBacked,
      evidence: {
        recovered: true,
        previousState: "journal",
        reason: "engine-restart",
        positionMs,
      },
    });
    this.notify(sessionId);
    return { ...session };
  }

  markRestoredSessionFailed(input: {
    sessionId: string;
    assetId: string;
    fileId: string;
    detail: string;
  }): NativeMediaSession {
    this.requireLive("markRestoredSessionFailed");
    const session = makeSession({
      id: input.sessionId,
      assetId: input.assetId,
      fileId: input.fileId,
      state: "failed",
      bufferedMs: 0,
      positionMs: 0,
      integrity: "unknown",
    });
    const now = this.now();
    this.sessions.set(input.sessionId, {
      session,
      sourcePath: "",
      geometry: { totalBytes: 0, durationMs: 0, pieceCount: 0, pieceSize: 0, lastPieceBytes: 0 },
      downloaded: [],
      pendingOrder: [],
      downloadedBytes: 0,
      paused: false,
      stalled: true,
      openedAtMs: now,
      lastTickMs: now,
      storeBacked: false,
      evidence: { recovered: true, reason: "source-bytes-vanished", detail: input.detail },
    });
    this.notify(input.sessionId);
    return { ...session };
  }

  async pumpOnce(sessionId?: string): Promise<number> {
    this.requireLive("pumpOnce");
    let live: LiveSession | undefined;
    if (sessionId !== undefined) {
      live = this.sessions.get(sessionId);
      if (live === undefined) {
        throw new NativeMediaError("NOT_FOUND", {
          detail: `pumpOnce: session '${sessionId}' does not exist`,
          sessionId,
        });
      }
    } else {
      for (const candidate of this.sessions.values()) {
        if (candidate.pendingOrder.length > 0) {
          live = candidate;
          break;
        }
      }
    }
    if (live === undefined || live.pendingOrder.length === 0) return 0;
    return await this.readNextPiece(live);
  }

  async tickOnce(): Promise<void> {
    await this.tick();
  }

  // --- internals -----------------------------------------------------------------

  private requireLive(op: string): void {
    if (this.disposed) {
      throw invalidInput(`${op}: the real engine is disposed`);
    }
  }

  /** A session that may still receive control commands. */
  private requireControllable(op: string, sessionId: string): LiveSession {
    this.requireLive(op);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput(`${op}: sessionId must be a non-empty string`);
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `${op}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (live.session.state === "complete" || live.session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is '${live.session.state}' (terminal) — no further control`,
        sessionId,
      });
    }
    return live;
  }

  /** A session whose source may serve range reads. */
  private requireRangable(op: string, sessionId: string): LiveSession {
    this.requireLive(op);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput(`${op}: sessionId must be a non-empty string`);
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const live = this.sessions.get(sessionId);
    if (live === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `${op}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (live.session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is 'failed' — the cache entry is unusable`,
        sessionId,
      });
    }
    return live;
  }

  /**
   * Resolve a source path into the session's geometry + identity: real
   * stat, store-backed detection (with optional digest verification), and
   * the nominal timeline. Typed failures: NOT_FOUND (no file / no stored
   * asset), INVALID_INPUT (empty file), VERIFICATION_FAILED (corrupt
   * stored asset), IO_ERROR (stat failure).
   */
  private async resolveSource(sourcePath: string): Promise<{
    geometry: Geometry;
    assetId: string;
    storeBacked: boolean;
    integrity: "unknown" | "verified" | undefined;
  }> {
    const stored = storeAssetIdOf(sourcePath, this.store);
    if (stored !== null) {
      const meta = this.store.getAsset(stored.assetId);
      if (meta === undefined) {
        throw new NativeMediaError("NOT_FOUND", {
          detail: `open: '${sourcePath}' points inside the asset store but no asset '${stored.assetId}' is recorded`,
        });
      }
      if (this.verifyStoredAssetsOnOpen) {
        const verify = await this.store.verifyAsset(stored.assetId);
        if (!verify.ok) {
          throw new NativeMediaError("IO_ERROR", {
            detail: `open: verifying the stored asset '${stored.assetId}' failed: ${verify.error.message}`,
            cause: verify.error,
          });
        }
        if (verify.integrity === "failed") {
          throw new NativeMediaError("VERIFICATION_FAILED", {
            detail:
              `open: the stored asset '${stored.assetId}' FAILED its digest check ` +
              `(recorded ${verify.recordedDigest.slice(0, 16)}…, stored bytes hash ${verify.digest.slice(0, 16)}…) — ` +
              "corrupt bytes are never served",
          });
        }
      }
      const size = this.store.statAsset(stored.assetId);
      if (size === null) {
        throw new NativeMediaError("NOT_FOUND", {
          detail: `open: the stored content of '${stored.assetId}' is missing from disk`,
        });
      }
      const verdict =
        this.verifyStoredAssetsOnOpen ? ("verified" as const) : meta.integrity === "verified" ? ("verified" as const) : undefined;
      return {
        geometry: geometryFor(size.sizeBytes, this.nominalBitrateBps, this.readChunkBytes),
        assetId: stored.assetId,
        storeBacked: true,
        integrity: verdict,
      };
    }
    const size = await statFileSize(sourcePath);
    if (size === null) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `open: no media file exists at '${sourcePath}'`,
      });
    }
    if (size <= 0) {
      throw invalidInput(`open: the media file at '${sourcePath}' is empty (0 bytes)`);
    }
    return {
      geometry: geometryFor(size, this.nominalBitrateBps, this.readChunkBytes),
      assetId: assetIdForPath(sourcePath),
      storeBacked: false,
      integrity: undefined,
    };
  }

  /**
   * Read the next pending piece — the ONE real-I/O primitive every path
   * (timer budget, manual pump) accounts through. A read failure fails
   * the session honestly (the source bytes became unreadable).
   */
  private async readNextPiece(live: LiveSession): Promise<number> {
    const piece = live.pendingOrder.shift();
    if (piece === undefined) return 0;
    if (live.downloaded[piece]) return 0; // never double-account
    const start = pieceStartByte(piece, live.geometry);
    const end = pieceEndByte(piece, live.geometry); // exclusive
    try {
      // REAL READ: the piece is accounted only after its bytes land.
      await Bun.file(live.sourcePath).slice(start, end).arrayBuffer();
    } catch (e) {
      live.pendingOrder.unshift(piece);
      this.failSession(live, new NativeMediaError("IO_ERROR", {
        detail: `reading piece ${piece} (bytes ${start}-${end - 1}) of '${live.sourcePath}' failed: ${e instanceof Error ? e.message : String(e)}`,
        sessionId: live.session.id,
      }));
      throw new NativeMediaError("IO_ERROR", {
        detail: `the read-ahead hit an unreadable source: ${e instanceof Error ? e.message : String(e)}`,
        sessionId: live.session.id,
      });
    }
    live.downloaded[piece] = true;
    live.downloadedBytes += pieceByteSize(piece, live.geometry);
    this.refreshBufferedThrough(live);
    if (live.downloadedBytes >= live.geometry.totalBytes && live.session.state === "background") {
      // Background completion: persist + verify before the terminal claim.
      await this.finalizeCompletion(live);
      return pieceByteSize(piece, live.geometry);
    }
    this.notify(live.session.id);
    return pieceByteSize(piece, live.geometry);
  }

  /**
   * One read-ahead + playback tick: the deterministic byte budget (real
   * reads per accounted piece), the buffered-through marker, and the
   * playback clock (pause freezes it; the stall law matches the
   * simulation's). Never runs concurrently with itself.
   */
  private async tick(): Promise<void> {
    if (this.disposed || this.ticking) return;
    this.ticking = true;
    try {
      for (const live of [...this.sessions.values()]) {
        if (live.session.state === "failed") continue;
        const before = { ...live.session };
        const now = this.now();
        const dtMs = Math.max(0, now - live.lastTickMs);
        live.lastTickMs = now;

        // 1. Read-ahead: the budget is a pure function of elapsed time
        //    (the simulation law); every accounted piece is a real read.
        const budgetBytes = Math.floor(
          ((now - live.openedAtMs) * this.readBytesPerSecond) / 1000,
        );
        const target = Math.min(budgetBytes, live.geometry.totalBytes);
        let failed = false;
        while (live.downloadedBytes < target && live.pendingOrder.length > 0) {
          try {
            const read = await this.readNextPiece(live);
            if (read === 0) break;
          } catch {
            failed = true; // readNextPiece failed the session honestly
            break;
          }
        }
        if (failed) continue;

        // 2. Buffered-through marker: contiguous coverage from the playhead.
        this.refreshBufferedThrough(live);

        // 3. Playback clock (playing sessions; pause freezes it).
        if (live.session.state === "playing" && !live.paused) {
          if (live.stalled) {
            if (live.session.bufferedMs - live.session.positionMs >= this.rebufferLeadMs) {
              live.stalled = false;
            }
          }
          if (
            !live.stalled &&
            live.session.bufferedMs > live.session.positionMs &&
            live.session.positionMs < live.geometry.durationMs
          ) {
            const candidate = live.session.positionMs + dtMs;
            const advanced = Math.min(
              candidate,
              live.session.bufferedMs,
              live.geometry.durationMs,
            );
            live.session = { ...live.session, positionMs: advanced };
            if (
              advanced >= live.session.bufferedMs &&
              advanced < live.geometry.durationMs
            ) {
              live.stalled = true; // hit the buffer edge: freeze (no re-buffer state)
            }
          }
          if (live.session.positionMs >= live.geometry.durationMs) {
            // Playback end: persist + verify before the terminal claim.
            await this.finalizeCompletion(live);
            continue;
          }
        }

        if (sessionChanged(before, live.session)) {
          this.notify(live.session.id);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Recompute `bufferedMs` from the contiguous downloaded run at the playhead. */
  private refreshBufferedThrough(live: LiveSession): void {
    if (live.geometry.totalBytes === 0) return;
    const positionByte = Math.min(
      live.geometry.totalBytes - 1,
      Math.floor(
        (live.session.positionMs / live.geometry.durationMs) * live.geometry.totalBytes,
      ),
    );
    const contiguousEnd = contiguousEndByteFrom(positionByte, live);
    const bufferedMs =
      (contiguousEnd / live.geometry.totalBytes) * live.geometry.durationMs;
    if (bufferedMs !== live.session.bufferedMs) {
      live.session = { ...live.session, bufferedMs };
    }
  }

  /**
   * The COMPLETION LAW (module docs, law 3): persist the asset, verify the
   * full stored hash against the recorded digest, and ONLY THEN claim the
   * terminal `complete` (with integrity `verified`). A persistence failure
   * or digest mismatch fails the session honestly instead — `complete` is
   * never reported without proof.
   */
  private async finalizeCompletion(live: LiveSession): Promise<void> {
    const sessionId = live.session.id;
    if (live.storeBacked) {
      // The bytes already live in the store: prove them.
      const assetId = assetIdOfContentPath(live.sourcePath, this.store);
      if (assetId === null) {
        this.failSession(
          live,
          new NativeMediaError("INTERNAL", {
            detail: `completion: the store-backed session '${sessionId}' lost its asset identity`,
            sessionId,
          }),
        );
        return;
      }
      const verify = await this.store.verifyAsset(assetId);
      if (!verify.ok) {
        this.failSession(live, verify.error);
        return;
      }
      if (verify.integrity === "failed") {
        live.evidence = {
          completion: "verification-failed",
          recordedDigest: verify.recordedDigest,
          digest: verify.digest,
        };
        live.session = {
          ...transition(live.session, "failed"),
          integrity: "failed",
        };
        this.notify(sessionId);
        return;
      }
      live.evidence = {
        completion: "verified",
        digest: verify.digest,
        assetId,
      };
      live.session = transition(live.session, "complete");
      this.notify(sessionId);
      return;
    }
    // A source-file session: IMPORT the bytes into the store (stream copy
    // + SHA-256 as they land), then the import's own verification decides.
    const imported = await this.store.importAsset({
      sourcePath: live.sourcePath,
      assetId: live.session.assetId,
      contentType: this.contentType,
    });
    if (!imported.ok) {
      this.failSession(live, imported.error);
      return;
    }
    if (imported.asset.meta.integrity !== "verified") {
      live.evidence = {
        completion: "verification-failed",
        assetId: imported.asset.meta.assetId,
      };
      live.session = {
        ...transition(live.session, "failed"),
        integrity: "failed",
      };
      this.notify(sessionId);
      return;
    }
    live.evidence = {
      completion: "verified",
      assetId: imported.asset.meta.assetId,
      digest: imported.asset.meta.sha256,
      sizeBytes: imported.asset.meta.sizeBytes,
    };
    live.session = {
      ...transition(live.session, "complete"),
      integrity: "verified",
    };
    this.notify(sessionId);
  }

  /** Fail a session honestly (FSM-legal from every live state) with evidence. */
  private failSession(live: LiveSession, error: NativeMediaError): void {
    live.evidence = {
      failure: error.code,
      detail: error.detail ?? error.message,
    };
    live.session = transition(live.session, "failed");
    this.notify(live.session.id);
  }

  private notify(sessionId: string): void {
    const live = this.sessions.get(sessionId);
    if (live === undefined || this.listeners.size === 0) return;
    const snapshot = { ...live.session };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /** Monotonic clock — elapsed-time math must never run backwards. */
  private now(): number {
    return this.clock();
  }
}

// ---------------------------------------------------------------------------
// Pure geometry + helpers
// ---------------------------------------------------------------------------

/**
 * The session geometry (module docs, law 5 — the simulation/gateway
 * formula): `pieceCount = max(1, floor(totalBytes / chunkBytes))` equal
 * pieces of `floor(totalBytes / pieceCount)` bytes, the last absorbing
 * the remainder; the nominal timeline derives from the bitrate.
 */
function geometryFor(
  totalBytes: number,
  nominalBitrateBps: number,
  chunkBytes: number,
): Geometry {
  const pieceCount = Math.max(1, Math.floor(totalBytes / chunkBytes));
  const pieceSize = Math.floor(totalBytes / pieceCount);
  const lastPieceBytes = totalBytes - pieceSize * (pieceCount - 1);
  return {
    totalBytes,
    durationMs: (totalBytes * 8 * 1000) / nominalBitrateBps,
    pieceCount,
    pieceSize,
    lastPieceBytes,
  };
}

/** Pieces `from, from+1, ..., pieceCount-1, 0, ..., from-1`. */
function sequentialOrder(from: number, pieceCount: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < pieceCount; i += 1) {
    order.push((from + i) % pieceCount);
  }
  return order;
}

function pieceIndexOf(byte: number, geometry: Geometry): number {
  return Math.min(geometry.pieceCount - 1, Math.floor(byte / geometry.pieceSize));
}

function pieceByteSize(piece: number, geometry: Geometry): number {
  return piece === geometry.pieceCount - 1
    ? geometry.lastPieceBytes
    : geometry.pieceSize;
}

/** The inclusive start byte of `piece`. */
function pieceStartByte(piece: number, geometry: Geometry): number {
  return piece * geometry.pieceSize;
}

/** The EXCLUSIVE end byte of `piece` (exact — the last piece may be larger). */
function pieceEndByte(piece: number, geometry: Geometry): number {
  return piece === geometry.pieceCount - 1
    ? geometry.totalBytes
    : (piece + 1) * geometry.pieceSize;
}

/**
 * The exclusive end byte of the contiguous downloaded run starting at the
 * piece containing `from`. If that piece is missing the run is empty and
 * `from` itself is returned (zero coverage ahead of the playhead).
 */
function contiguousEndByteFrom(from: number, live: LiveSession): number {
  const { geometry } = live;
  let piece = pieceIndexOf(from, geometry);
  if (!live.downloaded[piece]) return from;
  let end = pieceEndByte(piece, geometry);
  while (piece + 1 < geometry.pieceCount && live.downloaded[piece + 1]) {
    piece += 1;
    end = pieceEndByte(piece, geometry);
  }
  return end;
}

function sessionChanged(a: NativeMediaSession, b: NativeMediaSession): boolean {
  return (
    a.state !== b.state ||
    a.bufferedMs !== b.bufferedMs ||
    a.positionMs !== b.positionMs ||
    a.integrity !== b.integrity
  );
}

/** Real stat of a file's size; null when absent or not a regular file. */
async function statFileSize(path: string): Promise<number | null> {
  try {
    const st = await Bun.file(path).stat();
    return st.size;
  } catch {
    return null;
  }
}

/**
 * If `path` is a store content file (`<assetsDir>/<assetId>/content.bin`),
 * return that assetId; else null. Pure path reasoning (disk existence is
 * checked separately — disk truth).
 */
function storeAssetIdOf(path: string, store: AssetStore): { assetId: string } | null {
  if (!isAbsolute(path)) return null;
  const rel = relative(store.assetsDir, path);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return null;
  const segments = rel.split(/[\\/]/);
  if (segments.length !== 2 || segments[1] !== "content.bin") return null;
  const assetId = segments[0] ?? "";
  if (assetId.length === 0 || assetId === "." || assetId === "..") return null;
  return { assetId };
}

/** The store assetId of a session source path already known to be store-backed. */
function assetIdOfContentPath(path: string, store: AssetStore): string | null {
  const stored = storeAssetIdOf(path, store);
  return stored === null ? null : stored.assetId;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the REAL production engine (local files + the asset store; real
 * reads, real digests, real range bytes). The store is created under
 * `config.storeRoot` with the `config.maxCacheBytes` policy budget. All
 * failures surface as typed `NativeMediaError`s from the WFX-004
 * taxonomy — never fake success, never silent state.
 */
export function createRealEngine(config: RealEngineConfig): RealEngine {
  return new RealEngineImpl(config);
}
