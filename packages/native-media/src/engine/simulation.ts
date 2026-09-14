/**
 * @wfx/native-media — IN-PROCESS SIMULATION ENGINE (WFX-014, Lane B).
 *
 * *** SIMULATION — TEST/DEV ONLY. NEVER WIRED AS A PRODUCTION ENGINE. ***
 *
 * `createSimulationEngine(config)` implements the FROZEN `NativeMediaEngine`
 * interface (plus the optional `RangeAccessEngine` extension probed by
 * createNativeMediaService, and a `status` accessor) with fully SIMULATED
 * behavior:
 *
 * - DETERMINISTIC BUFFERING: piece download is a pure function of the simulated
 *   clock — each `tick()` advances time by `tickIntervalMs` and grants the
 *   engine `bytesPerTick` of download budget. No I/O, no network, no wall
 *   clock, no entropy: the same command + tick sequence always yields the same
 *   session states. `autoTick: true` (the default) drives the same tick loop
 *   from a real timer for interactive dev use; tests pin determinism by
 *   passing `autoTick: false` and calling `tick()` themselves.
 * - PLUGGABLE FAKE ASSETS: a registry maps `magnet`/`localPath` to a simulated
 *   piece map (`pieceSize` × `totalBytes`), `durationMs`, and content type.
 *   Media CONTENT is a deterministic pure function of the asset and the byte
 *   offset ({@link simulationMediaByte}), so tests can predict served bytes
 *   independently of the engine.
 * - FSM-GOVERNED STATE: every state change goes through WFX-004's pure
 *   `transition()` (resolving → buffering on open; buffering → playing on
 *   resume; playing ⇄ background; playing/background → complete, including
 *   background completion). `pause` is a flag, not a state (WFX-004 decision).
 * - RANGE READS: `statMedia`/`readRange` serve the simulated piece buffer with
 *   exact byte offsets; spans covering not-yet-downloaded pieces answer with a
 *   typed retryable `IO_ERROR` (never fabricated bytes), and spans beyond the
 *   media size answer `RANGE_NOT_SATISFIABLE`.
 * - TYPED FAILURES: every failure is a `NativeMediaError` from the WFX-004
 *   taxonomy — unknown assets are `UNSUPPORTED_SOURCE`, unknown sessions
 *   `NOT_FOUND`, closed/terminal sessions `SESSION_CLOSED`, bad arguments
 *   `INVALID_INPUT`. No fake success paths.
 * - `torrentBytes` SOURCES ARE EXPLICITLY UNSUPPORTED (typed): parsing real
 *   torrent files is the real engine's job. Provide magnet/localPath fakes.
 *
 * The engine emits wire-shaped `EngineEvent`s (unsolicited kinds only) via
 * `onEngineEvent`, which the in-process process (./adapter.ts) forwards across
 * the JSON wire boundary.
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import { NativeMediaError } from "../errors";
import type { RangeAccessEngine } from "../service";
import {
  canTransition,
  makeSession,
  transition,
  type SessionState,
} from "../session";
import { PROTOCOL_VERSION, type EngineEvent } from "./process";

// ---------------------------------------------------------------------------
// Optional status extension (shared shape with the adapter)
// ---------------------------------------------------------------------------

/**
 * OPTIONAL session-status access an engine MAY expose in addition to the
 * frozen `NativeMediaEngine` surface: read the engine's last-known session
 * snapshot. The WFX-004 service envelope documents that engine-side state
 * observation is expected from WFX-014; this is that channel. Engines that do
 * not implement it simply do not offer the method.
 */
export interface StatusAccessEngine {
  /** Read the session's current snapshot; typed errors for unknown/closed. */
  status(sessionId: string): Promise<NativeMediaSession>;
}

// ---------------------------------------------------------------------------
// Fake assets
// ---------------------------------------------------------------------------

/**
 * A registered fake asset: the simulated piece map is derived from
 * `totalBytes` × `pieceSize` (piece i spans
 * `[i*pieceSize, min((i+1)*pieceSize, totalBytes))`).
 */
export interface FakeAsset {
  /** Registry key: magnet URI (must start with `magnet:`). */
  magnet?: string;
  /** Registry key: local path. */
  localPath?: string;
  assetId: string;
  fileId: string;
  /** Total media size in bytes (positive safe integer). */
  totalBytes: number;
  /** Media duration in milliseconds (positive finite number). */
  durationMs: number;
  /** Simulated piece size in bytes (positive safe integer). */
  pieceSize: number;
  /** Served by `statMedia`. Default: `"video/mp4"`. */
  contentType?: string;
}

/** The default fake asset used when `createSimulationEngine()` gets none. */
export const DEFAULT_SIMULATION_ASSET: FakeAsset = {
  magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
  localPath: "/webflix/simulation/default-asset.mkv",
  assetId: "sim-asset-1",
  fileId: "sim-file-1",
  totalBytes: 1_048_576, // 1 MiB
  durationMs: 600_000, // 10 minutes
  pieceSize: 16_384, // 16 KiB -> 64 pieces
  contentType: "video/mp4",
};

/** Deterministic content seed for an asset (sum of assetId char codes mod 251). */
function assetSeed(assetId: string): number {
  let seed = 0;
  for (let i = 0; i < assetId.length; i += 1) {
    seed += assetId.charCodeAt(i);
  }
  return seed % 251;
}

/**
 * The simulated media byte at `offset` — a PURE, deterministic function so
 * tests can predict `readRange` output independently. Throws typed
 * `INVALID_INPUT` for an out-of-domain offset.
 */
export function simulationMediaByte(asset: FakeAsset, offset: number): number {
  if (
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= asset.totalBytes
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `simulationMediaByte: offset must be a safe integer in [0, ${asset.totalBytes}) (got ${String(offset)})`,
    });
  }
  return (offset + assetSeed(asset.assetId)) % 251;
}

/** Internal validated/derived asset view. */
interface ResolvedAsset {
  readonly assetId: string;
  readonly fileId: string;
  readonly totalBytes: number;
  readonly durationMs: number;
  readonly pieceSize: number;
  readonly contentType: string;
  readonly magnet: string | undefined;
  readonly localPath: string | undefined;
  readonly pieceCount: number;
  readonly seed: number;
}

/** Bytes occupied by piece `p` of a resolved asset. */
function pieceBytesOf(asset: ResolvedAsset, p: number): number {
  return Math.min(asset.pieceSize, asset.totalBytes - p * asset.pieceSize);
}

/** The piece containing byte `offset`. */
function pieceForByte(asset: ResolvedAsset, offset: number): number {
  return Math.floor(offset / asset.pieceSize);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options for {@link createSimulationEngine}. */
export interface SimulationEngineConfig {
  /** Fake asset registry. Default: `[DEFAULT_SIMULATION_ASSET]`. */
  assets?: FakeAsset[];
  /**
   * Drive the tick loop from a real timer (interactive dev use). Default:
   * `true`. Tests that need exact determinism pass `false` and call `tick()`.
   */
  autoTick?: boolean;
  /** Simulated milliseconds per tick. Default: 250. */
  tickIntervalMs?: number;
  /** Download budget granted per tick, in bytes. Default: 262144 (256 KiB). */
  bytesPerTick?: number;
  /**
   * Recorded from the engine config (see ./process.ts). INFORMATIONAL in the
   * simulation: the real engine owns cache bytes; this engine owns none.
   */
  cacheDir?: string;
  /** See {@link SimulationEngineConfig.cacheDir}. */
  maxCacheBytes?: number;
}

const DEFAULT_TICK_INTERVAL_MS = 250;
const DEFAULT_BYTES_PER_TICK = 262_144;

// ---------------------------------------------------------------------------
// Engine surface
// ---------------------------------------------------------------------------

/**
 * The simulation engine surface: the frozen `NativeMediaEngine` contract, the
 * optional `RangeAccessEngine` extension, the optional status extension, plus
 * SIMULATION-ONLY affordances (`tick`, `goBackground`, event subscription,
 * `terminate`). The `isSimulation: true` brand marks it as TEST/DEV only —
 * never production.
 */
export interface SimulationEngine
  extends NativeMediaEngine,
    RangeAccessEngine,
    StatusAccessEngine {
  /** Brand: this object is a SIMULATION, never a production engine. */
  readonly isSimulation: true;
  /** The configuration the engine was built from. */
  readonly config: SimulationEngineConfig;
  /** Live sessions (including terminal ones until `close`), by id. */
  readonly sessions: ReadonlyMap<string, NativeMediaSession>;
  /**
   * Advance the simulated clock by `elapsedMs`, executing
   * `floor(elapsedMs / tickIntervalMs)` deterministic ticks. Returns the
   * number of ticks executed.
   */
  tick(elapsedMs: number): number;
  /**
   * SIMULATION-ONLY: move a `playing` session to `background` (the frozen
   * engine surface has no background primitive; the OS would trigger this).
   * Typed `INVALID_INPUT` when the FSM forbids the hop.
   */
  goBackground(sessionId: string): void;
  /**
   * Subscribe to unsolicited wire-shaped engine events (`progress`,
   * `buffered`, `state-changed`). The in-process process forwards these
   * across the JSON wire.
   */
  onEngineEvent(handler: (event: EngineEvent) => void): void;
  /**
   * SIMULATION-ONLY lifecycle: stop the engine permanently (clears timers and
   * sessions). Subsequent operations answer typed `INTERNAL` errors. Used by
   * the in-process process on terminate/crash.
   */
  terminate(): void;
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface SimSession {
  session: NativeMediaSession;
  asset: ResolvedAsset;
  /** Fully downloaded piece indices. */
  completed: Set<number>;
  /** Partially downloaded piece byte counts (piece -> bytes held). */
  partial: Map<number, number>;
  /** Incomplete pieces in download-priority order (head = next). */
  order: number[];
  /** Pause flag — NOT a state (WFX-004 decision #3). */
  paused: boolean;
}

/** Total bytes held by a session's simulated buffer. */
function downloadedBytes(sim: SimSession): number {
  let total = 0;
  for (const piece of sim.completed) total += pieceBytesOf(sim.asset, piece);
  for (const bytes of sim.partial.values()) total += bytes;
  return total;
}

/** Media-time mapping of held bytes (documented linear simplification). */
function bufferedMsOf(sim: SimSession): number {
  const held = downloadedBytes(sim);
  return Math.min(
    sim.asset.durationMs,
    Math.floor((held / sim.asset.totalBytes) * sim.asset.durationMs),
  );
}

/** Sequential incomplete-piece order starting at `fromPiece` (wrapping). */
function sequentialOrder(asset: ResolvedAsset, completed: Set<number>, fromPiece: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < asset.pieceCount; i += 1) {
    const piece = (fromPiece + i) % asset.pieceCount;
    if (!completed.has(piece)) order.push(piece);
  }
  return order;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SimulationEngineImpl implements SimulationEngine {
  readonly isSimulation = true as const;
  readonly config: SimulationEngineConfig;

  private readonly live = new Map<string, SimSession>();
  private readonly closedIds = new Set<string>();
  private readonly handlers: ((event: EngineEvent) => void)[] = [];
  private readonly registry: ResolvedAsset[];
  private readonly tickIntervalMs: number;
  private readonly bytesPerTick: number;
  private readonly autoTick: boolean;
  private counter = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(config: SimulationEngineConfig) {
    this.config = config;
    this.tickIntervalMs = config.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.bytesPerTick = config.bytesPerTick ?? DEFAULT_BYTES_PER_TICK;
    this.autoTick = config.autoTick !== false;
    this.registry = (config.assets ?? [DEFAULT_SIMULATION_ASSET]).map(validateAsset);
    validateNoDuplicateKeys(this.registry);
  }

  get sessions(): ReadonlyMap<string, NativeMediaSession> {
    const view = new Map<string, NativeMediaSession>();
    for (const [id, sim] of this.live) view.set(id, { ...sim.session });
    return view;
  }

  // --- frozen NativeMediaEngine surface -----------------------------------

  async open(input: {
    magnet?: string;
    torrentBytes?: Uint8Array;
    localPath?: string;
  }): Promise<NativeMediaSession> {
    this.requireNotStopped();
    if (typeof input !== "object" || input === null) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "simulation.open: input must be an object",
      });
    }
    const hasSource =
      input.magnet !== undefined || input.torrentBytes !== undefined || input.localPath !== undefined;
    if (!hasSource) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "simulation.open: at least one source is required (magnet, torrentBytes, or localPath)",
      });
    }
    if (input.magnet !== undefined) {
      if (typeof input.magnet !== "string" || input.magnet.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "simulation.open: magnet must be a non-empty string",
        });
      }
      if (!input.magnet.startsWith("magnet:")) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `simulation.open: magnet must be a magnet URI ('magnet:?xt=...'), got '${input.magnet.slice(0, 32)}'`,
        });
      }
    }
    if (input.localPath !== undefined) {
      if (typeof input.localPath !== "string" || input.localPath.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "simulation.open: localPath must be a non-empty string",
        });
      }
    }
    if (input.torrentBytes !== undefined) {
      if (!(input.torrentBytes instanceof Uint8Array) || input.torrentBytes.length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "simulation.open: torrentBytes must be a non-empty Uint8Array",
        });
      }
    }

    // Source resolution: magnet first, then localPath. A torrent-bytes-only
    // source is explicitly unsupported — typed, never a fake success.
    const asset = this.resolveAsset(input.magnet, input.localPath);

    this.counter += 1;
    const session = makeSession({
      id: `sim-session-${this.counter}`,
      assetId: asset.assetId,
      fileId: asset.fileId,
      state: "resolving",
    });
    const sim: SimSession = {
      session,
      asset,
      completed: new Set(),
      partial: new Map(),
      order: sequentialOrder(asset, new Set(), 0),
      paused: false,
    };
    this.live.set(session.id, sim);
    // The open call itself resolves the metadata: resolving -> buffering.
    this.applyTransition(sim, "buffering");
    this.reconcileTimer();
    return { ...sim.session };
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    const sim = this.requireLiveSession("seek", sessionId);
    if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.seek: positionMs must be a finite number >= 0 (got ${String(positionMs)})`,
        sessionId,
      });
    }
    if (positionMs > sim.asset.durationMs) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.seek: positionMs ${positionMs} is beyond the asset duration ${sim.asset.durationMs}ms`,
        sessionId,
      });
    }
    sim.session = { ...sim.session, positionMs };
    // Refocus the download on the seek target (sequential from its piece).
    const byteOffset = Math.min(
      sim.asset.totalBytes - 1,
      Math.floor((positionMs / sim.asset.durationMs) * sim.asset.totalBytes),
    );
    sim.order = sequentialOrder(sim.asset, sim.completed, pieceForByte(sim.asset, byteOffset));
  }

  async prioritize(
    sessionId: string,
    deadlines: { piece: number; deadlineMs: number }[],
  ): Promise<void> {
    const sim = this.requireLiveSession("prioritize", sessionId);
    if (!Array.isArray(deadlines)) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "simulation.prioritize: deadlines must be an array",
        sessionId,
      });
    }
    const seen = new Set<number>();
    const normalized: { piece: number; deadlineMs: number }[] = [];
    for (let i = 0; i < deadlines.length; i += 1) {
      const entry: unknown = deadlines[i];
      if (typeof entry !== "object" || entry === null) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `simulation.prioritize: deadlines[${i}] must be an object`,
          sessionId,
        });
      }
      const d = entry as Record<string, unknown>;
      if (
        typeof d.piece !== "number" ||
        !Number.isSafeInteger(d.piece) ||
        d.piece < 0 ||
        d.piece >= sim.asset.pieceCount
      ) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `simulation.prioritize: deadlines[${i}].piece must be a safe integer in [0, ${sim.asset.pieceCount}) (got ${String(d.piece)})`,
          sessionId,
        });
      }
      if (typeof d.deadlineMs !== "number" || !Number.isFinite(d.deadlineMs) || d.deadlineMs < 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `simulation.prioritize: deadlines[${i}].deadlineMs must be a finite number >= 0`,
          sessionId,
        });
      }
      if (seen.has(d.piece)) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `simulation.prioritize: piece ${d.piece} appears more than once — one deadline per piece`,
          sessionId,
        });
      }
      seen.add(d.piece);
      normalized.push({ piece: d.piece, deadlineMs: d.deadlineMs });
    }
    // Deadline-ordered (soonest first, ties by piece index) incomplete pieces
    // first; the remaining incomplete pieces keep their current order.
    normalized.sort((a, b) => a.deadlineMs - b.deadlineMs || a.piece - b.piece);
    const prioritized = normalized
      .map((d) => d.piece)
      .filter((piece) => !sim.completed.has(piece));
    const prioritizedSet = new Set(prioritized);
    const rest = sim.order.filter((piece) => !prioritizedSet.has(piece));
    sim.order = [...prioritized, ...rest];
  }

  async pause(sessionId: string): Promise<void> {
    const sim = this.requireLiveSession("pause", sessionId);
    sim.paused = true; // pause is a flag, NOT a state (WFX-004 decision #3)
  }

  async resume(sessionId: string): Promise<void> {
    const sim = this.requireLiveSession("resume", sessionId);
    sim.paused = false;
    if (sim.session.state === "buffering" || sim.session.state === "background") {
      this.applyTransition(sim, "playing");
    }
    // On an already-playing session resume is an idempotent un-pause.
  }

  async close(sessionId: string): Promise<void> {
    this.requireNotStopped();
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `simulation.close: session '${sessionId}' is already closed`,
        sessionId,
      });
    }
    if (!this.live.has(sessionId)) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `simulation.close: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    this.live.delete(sessionId);
    this.closedIds.add(sessionId);
    this.reconcileTimer();
  }

  // --- optional RangeAccessEngine extension --------------------------------

  async statMedia(
    sessionId: string,
  ): Promise<{ totalBytes: number; contentType: string }> {
    const sim = this.requireRangableSession("statMedia", sessionId);
    return { totalBytes: sim.asset.totalBytes, contentType: sim.asset.contentType };
  }

  async readRange(sessionId: string, startByte: number, endByte: number): Promise<Uint8Array> {
    const sim = this.requireRangableSession("readRange", sessionId);
    if (
      !Number.isSafeInteger(startByte) ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 ||
      endByte < startByte
    ) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.readRange: require safe integers with 0 <= startByte <= endByte (got ${String(startByte)}..${String(endByte)})`,
        sessionId,
      });
    }
    if (startByte >= sim.asset.totalBytes || endByte >= sim.asset.totalBytes) {
      throw new NativeMediaError("RANGE_NOT_SATISFIABLE", {
        detail: `simulation.readRange: [${startByte}, ${endByte}] is not satisfiable against ${sim.asset.totalBytes} bytes`,
        sessionId,
      });
    }
    const firstPiece = pieceForByte(sim.asset, startByte);
    const lastPiece = pieceForByte(sim.asset, endByte);
    for (let piece = firstPiece; piece <= lastPiece; piece += 1) {
      if (!sim.completed.has(piece)) {
        throw new NativeMediaError("IO_ERROR", {
          detail: `simulation.readRange: piece ${piece} (covering bytes [${startByte}, ${endByte}]) is not buffered yet — retry after buffering progresses`,
          sessionId,
        });
      }
    }
    const out = new Uint8Array(endByte - startByte + 1);
    for (let offset = startByte; offset <= endByte; offset += 1) {
      out[offset - startByte] = (offset + sim.asset.seed) % 251;
    }
    return out;
  }

  // --- optional status extension --------------------------------------------

  async status(sessionId: string): Promise<NativeMediaSession> {
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `simulation.status: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const sim = this.live.get(sessionId);
    if (sim === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `simulation.status: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    return { ...sim.session };
  }

  // --- simulation-only affordances -------------------------------------------

  tick(elapsedMs: number): number {
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.tick: elapsedMs must be a finite number >= 0 (got ${String(elapsedMs)})`,
      });
    }
    const ticks = Math.floor(elapsedMs / this.tickIntervalMs);
    for (let i = 0; i < ticks; i += 1) this.doTick();
    return ticks;
  }

  goBackground(sessionId: string): void {
    const sim = this.requireLiveSession("goBackground", sessionId);
    if (!canTransition(sim.session.state, "background")) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.goBackground: session '${sessionId}' is '${sim.session.state}' — only a playing session can move to background`,
        sessionId,
      });
    }
    this.applyTransition(sim, "background");
  }

  onEngineEvent(handler: (event: EngineEvent) => void): void {
    if (typeof handler !== "function") {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "simulation.onEngineEvent: handler must be a function",
      });
    }
    this.handlers.push(handler);
  }

  terminate(): void {
    this.stopped = true;
    this.live.clear();
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // --- internals ---------------------------------------------------------------

  private requireNotStopped(): void {
    if (this.stopped) {
      throw new NativeMediaError("INTERNAL", {
        detail: "simulation: engine was terminated",
      });
    }
  }

  /** A session that may still receive control commands. */
  private requireLiveSession(what: string, sessionId: string): SimSession {
    this.requireNotStopped();
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.${what}: sessionId must be a non-empty string`,
      });
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `simulation.${what}: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const sim = this.live.get(sessionId);
    if (sim === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `simulation.${what}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (sim.session.state === "complete" || sim.session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `simulation.${what}: session '${sessionId}' is '${sim.session.state}' (terminal) — no further control`,
        sessionId,
      });
    }
    return sim;
  }

  /**
   * A session whose simulated cache may serve range reads: closed and
   * `failed` sessions refuse; `complete` sessions keep serving (the cache
   * persists after background completion) — mirroring the WFX-004 service.
   */
  private requireRangableSession(what: string, sessionId: string): SimSession {
    this.requireNotStopped();
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `simulation.${what}: sessionId must be a non-empty string`,
      });
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `simulation.${what}: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const sim = this.live.get(sessionId);
    if (sim === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `simulation.${what}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (sim.session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `simulation.${what}: session '${sessionId}' is 'failed' — the cache entry is unusable`,
        sessionId,
      });
    }
    return sim;
  }

  /** Resolve a source against the fake registry (magnet first, then localPath). */
  private resolveAsset(magnet: string | undefined, localPath: string | undefined): ResolvedAsset {
    if (magnet !== undefined) {
      const found = this.registry.find((a) => a.magnet === magnet);
      if (found !== undefined) return found;
      throw new NativeMediaError("UNSUPPORTED_SOURCE", {
        detail: `simulation: no fake asset is registered for magnet '${magnet.slice(0, 48)}'`,
      });
    }
    if (localPath !== undefined) {
      const found = this.registry.find((a) => a.localPath === localPath);
      if (found !== undefined) return found;
      throw new NativeMediaError("UNSUPPORTED_SOURCE", {
        detail: `simulation: no fake asset is registered for localPath '${localPath}'`,
      });
    }
    throw new NativeMediaError("UNSUPPORTED_SOURCE", {
      detail:
        "simulation: torrent-bytes-only sources are unsupported — register magnet/localPath fake assets (the real engine parses torrent files)",
    });
  }

  /** Apply an FSM transition and emit the wire-shaped state-changed event. */
  private applyTransition(sim: SimSession, to: SessionState): void {
    const from = sim.session.state;
    sim.session = transition(sim.session, to);
    this.emit({
      protocol: PROTOCOL_VERSION,
      kind: "state-changed",
      sessionId: sim.session.id,
      from,
      to,
      session: { ...sim.session },
    });
  }

  /** One deterministic tick: download budget, then playback progression. */
  private doTick(): void {
    for (const sim of this.live.values()) {
      if (sim.session.state === "complete" || sim.session.state === "failed") continue;

      // 1. Download: spend the byte budget on the priority-ordered pieces.
      let budget = this.bytesPerTick;
      let bytesChanged = false;
      while (budget > 0 && sim.order.length > 0) {
        const head = sim.order[0];
        if (head === undefined) break;
        const held = sim.partial.get(head) ?? 0;
        const remaining = pieceBytesOf(sim.asset, head) - held;
        const take = Math.min(budget, remaining);
        if (take > 0) {
          sim.partial.set(head, held + take);
          budget -= take;
          bytesChanged = true;
        }
        if (held + take >= pieceBytesOf(sim.asset, head)) {
          sim.completed.add(head);
          sim.partial.delete(head);
          sim.order.shift();
        } else {
          break;
        }
      }
      if (bytesChanged) {
        const bufferedMs = bufferedMsOf(sim);
        if (bufferedMs !== sim.session.bufferedMs) {
          sim.session = { ...sim.session, bufferedMs };
          this.emit({
            protocol: PROTOCOL_VERSION,
            kind: "buffered",
            sessionId: sim.session.id,
            bufferedMs,
            session: { ...sim.session },
          });
        }
      }

      // 2. Playback: advance position while playing and unpaused. Position
      //    never runs past the buffer; completion requires the END of a fully
      //    downloaded asset (so a seek to the end waits for the buffer).
      if (sim.session.state === "playing" && !sim.paused) {
        const { positionMs, bufferedMs } = sim.session;
        if (positionMs < bufferedMs && positionMs < sim.asset.durationMs) {
          const next = Math.min(positionMs + this.tickIntervalMs, bufferedMs, sim.asset.durationMs);
          sim.session = { ...sim.session, positionMs: next };
          this.emit({
            protocol: PROTOCOL_VERSION,
            kind: "progress",
            sessionId: sim.session.id,
            positionMs: next,
            bufferedMs: sim.session.bufferedMs,
            session: { ...sim.session },
          });
        }
        if (
          sim.session.positionMs >= sim.asset.durationMs &&
          downloadedBytes(sim) >= sim.asset.totalBytes
        ) {
          this.applyTransition(sim, "complete");
        }
      }

      // 3. Background completion: the download finishes while backgrounded.
      if (sim.session.state === "background" && downloadedBytes(sim) >= sim.asset.totalBytes) {
        this.applyTransition(sim, "complete");
      }
    }
    // A tick may have completed every session — stop idling when idle.
    this.reconcileTimer();
  }

  /** Emit an unsolicited event to every subscriber, synchronously. */
  private emit(event: EngineEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  /** Start/stop the auto-tick timer to match live progressable sessions. */
  private reconcileTimer(): void {
    const progressable =
      this.autoTick &&
      !this.stopped &&
      [...this.live.values()].some(
        (sim) => sim.session.state !== "complete" && sim.session.state !== "failed",
      );
    if (progressable && this.timer === undefined) {
      this.timer = setInterval(() => {
        this.tick(this.tickIntervalMs);
      }, this.tickIntervalMs);
    } else if (!progressable && this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Asset validation
// ---------------------------------------------------------------------------

function invalidAsset(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

function validateAsset(asset: FakeAsset): ResolvedAsset {
  if (typeof asset !== "object" || asset === null) {
    throw invalidAsset("createSimulationEngine: every asset must be an object");
  }
  if (typeof asset.assetId !== "string" || asset.assetId.trim().length === 0) {
    throw invalidAsset("createSimulationEngine: asset.assetId must be a non-empty string");
  }
  if (typeof asset.fileId !== "string" || asset.fileId.trim().length === 0) {
    throw invalidAsset("createSimulationEngine: asset.fileId must be a non-empty string");
  }
  if (
    typeof asset.totalBytes !== "number" ||
    !Number.isSafeInteger(asset.totalBytes) ||
    asset.totalBytes <= 0
  ) {
    throw invalidAsset(
      `createSimulationEngine: asset '${asset.assetId}' totalBytes must be a positive safe integer`,
    );
  }
  if (
    typeof asset.durationMs !== "number" ||
    !Number.isFinite(asset.durationMs) ||
    asset.durationMs <= 0
  ) {
    throw invalidAsset(
      `createSimulationEngine: asset '${asset.assetId}' durationMs must be a positive finite number`,
    );
  }
  if (
    typeof asset.pieceSize !== "number" ||
    !Number.isSafeInteger(asset.pieceSize) ||
    asset.pieceSize <= 0
  ) {
    throw invalidAsset(
      `createSimulationEngine: asset '${asset.assetId}' pieceSize must be a positive safe integer`,
    );
  }
  let magnet: string | undefined;
  if (asset.magnet !== undefined) {
    if (typeof asset.magnet !== "string" || !asset.magnet.startsWith("magnet:")) {
      throw invalidAsset(
        `createSimulationEngine: asset '${asset.assetId}' magnet must be a magnet URI ('magnet:?xt=...')`,
      );
    }
    magnet = asset.magnet;
  }
  let localPath: string | undefined;
  if (asset.localPath !== undefined) {
    if (typeof asset.localPath !== "string" || asset.localPath.trim().length === 0) {
      throw invalidAsset(
        `createSimulationEngine: asset '${asset.assetId}' localPath must be a non-empty string`,
      );
    }
    localPath = asset.localPath;
  }
  if (magnet === undefined && localPath === undefined) {
    throw invalidAsset(
      `createSimulationEngine: asset '${asset.assetId}' needs at least one registry key (magnet or localPath)`,
    );
  }
  let contentType = "video/mp4";
  if (asset.contentType !== undefined) {
    if (typeof asset.contentType !== "string" || asset.contentType.trim().length === 0) {
      throw invalidAsset(
        `createSimulationEngine: asset '${asset.assetId}' contentType must be a non-empty string`,
      );
    }
    contentType = asset.contentType;
  }
  return {
    assetId: asset.assetId,
    fileId: asset.fileId,
    totalBytes: asset.totalBytes,
    durationMs: asset.durationMs,
    pieceSize: asset.pieceSize,
    contentType,
    magnet,
    localPath,
    pieceCount: Math.ceil(asset.totalBytes / asset.pieceSize),
    seed: assetSeed(asset.assetId),
  };
}

function validateNoDuplicateKeys(registry: ResolvedAsset[]): void {
  const magnets = new Set<string>();
  const paths = new Set<string>();
  for (const asset of registry) {
    if (asset.magnet !== undefined) {
      if (magnets.has(asset.magnet)) {
        throw invalidAsset(
          `createSimulationEngine: duplicate registry magnet '${asset.magnet}'`,
        );
      }
      magnets.add(asset.magnet);
    }
    if (asset.localPath !== undefined) {
      if (paths.has(asset.localPath)) {
        throw invalidAsset(
          `createSimulationEngine: duplicate registry localPath '${asset.localPath}'`,
        );
      }
      paths.add(asset.localPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the IN-PROCESS SIMULATION engine (TEST/DEV ONLY — never production).
 * Deterministic, no I/O: buffering is a pure function of the simulated clock
 * (see `tick`), state changes go through the WFX-004 session FSM, and every
 * failure is a typed `NativeMediaError`.
 */
export function createSimulationEngine(
  config: SimulationEngineConfig = {},
): SimulationEngine {
  if (typeof config !== "object" || config === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createSimulationEngine: config must be an object",
    });
  }
  if (
    config.tickIntervalMs !== undefined &&
    (typeof config.tickIntervalMs !== "number" ||
      !Number.isFinite(config.tickIntervalMs) ||
      config.tickIntervalMs <= 0)
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createSimulationEngine: tickIntervalMs must be a positive finite number",
    });
  }
  if (
    config.bytesPerTick !== undefined &&
    (typeof config.bytesPerTick !== "number" ||
      !Number.isSafeInteger(config.bytesPerTick) ||
      config.bytesPerTick <= 0)
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createSimulationEngine: bytesPerTick must be a positive safe integer",
    });
  }
  if (config.autoTick !== undefined && typeof config.autoTick !== "boolean") {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createSimulationEngine: autoTick must be a boolean",
    });
  }
  if (config.assets !== undefined && !Array.isArray(config.assets)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createSimulationEngine: assets must be an array of fake assets",
    });
  }
  return new SimulationEngineImpl(config);
}
