/**
 * @wfx/native-media — SIMULATION ENGINE (WFX-014, Lane B).
 *
 * ⚠️ TEST/DEV ENGINE — NEVER PRODUCTION. ⚠️
 *
 * `createSimulationEngine` implements the FROZEN `NativeMediaEngine`
 * interface (plus the optional `RangeAccessEngine` extension from
 * WFX-004) with fully simulated behavior:
 *
 * - DETERMINISTIC, TIMER-DRIVEN BUFFERING — no network, no filesystem,
 *   no randomness. The downloaded byte budget is a pure function of
 *   elapsed time (`floor(elapsedMs * bytesPerSecond / 1000)`), so timer
 *   jitter can never change the result and identical wall-clock
 *   progressions produce identical states.
 * - PLUGGABLE FAKE ASSETS — a registry mapping magnet URIs / local paths
 *   to a simulated piece map (totalBytes, durationMs, pieceCount).
 * - SESSION FSM — every state change goes through WFX-004's `transition`
 *   (session.ts). `pause` is NOT a state (the playback clock simply
 *   freezes — see WFX-004 service docs); `resolving` is transient during
 *   the `open()` call, so sessions surface in `buffering` (same
 *   convention as the WFX-004 stub fixture).
 * - PIECE PRIORITIZATION — `seek` re-cursors the download at the seek
 *   point (deadline = playback order: pieces from the playhead forward
 *   first, then backfill); `prioritize` hoists explicit deadline pieces
 *   to the front of the pending queue ordered by deadline.
 * - RANGE READS — `readRange` serves the deterministic simulated content
 *   for any interval whose pieces are downloaded; intervals covering
 *   not-yet-downloaded pieces fail with a typed, retryable `IO_ERROR`.
 * - The simulated content is a pure function of the registry key and the
 *   byte offset (`simulatedAssetSeed` + `simulatedByte`) — no bytes are
 *   stored anywhere.
 *
 * Semantics defined here (documented for lead review):
 * - `bufferedMs` is the playback timestamp THROUGH WHICH contiguous
 *   media is available starting at `positionMs` (the player's
 *   buffered-through marker). At full download it equals `durationMs`.
 * - The engine cannot enter `background` through the frozen v1 surface
 *   (no such command); the FSM permits it for future protocol versions.
 * - Playback stalls are simulated by freezing the playhead at the buffer
 *   edge (the FSM forbids `playing -> buffering`, session.ts); playback
 *   resumes once the buffer lead reaches `rebufferLeadMs`.
 * - `close` releases the simulated piece buffer: further range access
 *   answers `SESSION_CLOSED`.
 * - `torrentBytes` sources are rejected with `UNSUPPORTED_SOURCE`: this
 *   simulation resolves registry-registered magnets and local paths only.
 * - The simulated piece map is bounded by the asset registry only; the
 *   EngineConfig cache budget is NOT enforced here (the real engine owns
 *   bytes and applies cache.ts policy — this simulation never touches a
 *   byte of storage).
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import { NativeMediaError } from "../errors";
import type { RangeAccessEngine } from "../service";
import {
  makeSession,
  transition,
} from "../session";

// ---------------------------------------------------------------------------
// Fake assets registry
// ---------------------------------------------------------------------------

/** A simulated media asset: the fake piece map the engine "downloads". */
export interface SimulatedAsset {
  /** Total size of the asset's single file in bytes (positive). */
  totalBytes: number;
  /** Playback duration in milliseconds (positive). */
  durationMs: number;
  /** Number of equal-size pieces (positive, <= totalBytes). */
  pieceCount: number;
  /** Content type reported by `statMedia`. Default: "application/octet-stream". */
  contentType?: string;
  /** Seed for the deterministic content generator. Default: hash of the key. */
  seed?: number;
}

/** The registry: magnet URIs and/or local paths mapped to fake assets. */
export type SimulatedAssetRegistry =
  | ReadonlyMap<string, SimulatedAsset>
  | Readonly<Record<string, SimulatedAsset>>;

// ---------------------------------------------------------------------------
// Simulation config
// ---------------------------------------------------------------------------

/** Options for {@link createSimulationEngine}. */
export interface SimulationConfig {
  /** Fake asset registry. Default: empty (every open misses → NOT_FOUND). */
  assets?: SimulatedAssetRegistry;
  /** Simulated download throughput, bytes/second. Default: 1_000_000. */
  bytesPerSecond?: number;
  /** Simulated clock tick, milliseconds. Default: 25. */
  tickMs?: number;
  /** Buffer lead required to (re)start playback, milliseconds. Default: 250. */
  rebufferLeadMs?: number;
}

// ---------------------------------------------------------------------------
// Deterministic content generator (pure, exported for tests)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash — the default seed derivation for a registry key. */
export function simulatedAssetSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The simulated content byte at `index`: `(seed + index * 131) % 251`. */
export function simulatedByte(seed: number, index: number): number {
  return (seed + index * 131) % 251;
}

// ---------------------------------------------------------------------------
// Simulation engine surface
// ---------------------------------------------------------------------------

/** A session snapshot notification (fired after every snapshot change). */
export type SimulationUpdateListener = (session: NativeMediaSession) => void;

/**
 * The SIMULATION engine surface: the frozen `NativeMediaEngine`, the
 * optional `RangeAccessEngine` extension, and simulation-local
 * observability/disposal hooks. The extra methods are NOT part of the
 * frozen contract and never will be — they exist so the in-process
 * process pipe (adapter.ts) and tests can observe the simulated state.
 */
export interface SimulationEngine extends NativeMediaEngine, RangeAccessEngine {
  /** Brand: this object is a SIMULATION, never a production engine. */
  readonly isSimulation: true;
  /** Subscribe to session snapshot updates. Returns an unsubscribe. */
  onUpdate(listener: SimulationUpdateListener): () => void;
  /** Current snapshot for a live session, else `undefined`. */
  snapshot(sessionId: string): NativeMediaSession | undefined;
  /** Stop the simulation clock and release every session. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** A validated, fully resolved registry asset. */
interface ResolvedAsset {
  readonly key: string;
  readonly seed: number;
  readonly totalBytes: number;
  readonly durationMs: number;
  readonly pieceCount: number;
  readonly pieceSize: number;
  readonly lastPieceBytes: number;
  readonly contentType: string;
}

/** Everything the simulation tracks for one live session. */
interface SimSession {
  session: NativeMediaSession;
  asset: ResolvedAsset;
  downloaded: boolean[];
  pendingOrder: number[];
  downloadedBytes: number;
  paused: boolean;
  stalled: boolean;
  openedAtMs: number;
  lastTickMs: number;
}

const DEFAULT_BYTES_PER_SECOND = 1_000_000;
const DEFAULT_TICK_MS = 25;
const DEFAULT_REBUFFER_LEAD_MS = 250;

// ---------------------------------------------------------------------------
// Validation helpers (typed INVALID_INPUT — never fake defaults)
// ---------------------------------------------------------------------------

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

function validateAsset(key: string, asset: SimulatedAsset): ResolvedAsset {
  if (typeof asset !== "object" || asset === null) {
    throw invalidInput(`simulation asset '${key}' must be an object`);
  }
  const { totalBytes, durationMs, pieceCount } = asset;
  if (
    typeof totalBytes !== "number" ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= 0
  ) {
    throw invalidInput(
      `simulation asset '${key}': totalBytes must be a positive safe integer`,
    );
  }
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw invalidInput(
      `simulation asset '${key}': durationMs must be a finite number > 0`,
    );
  }
  if (
    typeof pieceCount !== "number" ||
    !Number.isSafeInteger(pieceCount) ||
    pieceCount <= 0 ||
    pieceCount > totalBytes
  ) {
    throw invalidInput(
      `simulation asset '${key}': pieceCount must be a positive safe integer <= totalBytes`,
    );
  }
  const contentType =
    asset.contentType === undefined
      ? "application/octet-stream"
      : asset.contentType;
  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    throw invalidInput(
      `simulation asset '${key}': contentType must be a non-empty string when present`,
    );
  }
  const seed = asset.seed === undefined ? simulatedAssetSeed(key) : asset.seed;
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0) {
    throw invalidInput(
      `simulation asset '${key}': seed must be a non-negative safe integer when present`,
    );
  }
  const pieceSize = Math.floor(totalBytes / pieceCount);
  const lastPieceBytes = totalBytes - pieceSize * (pieceCount - 1);
  return {
    key,
    seed,
    totalBytes,
    durationMs,
    pieceCount,
    pieceSize,
    lastPieceBytes,
    contentType,
  };
}

function normalizeRegistry(assets: SimulatedAssetRegistry | undefined): Map<string, ResolvedAsset> {
  const registry = new Map<string, ResolvedAsset>();
  if (assets === undefined) return registry;
  if (assets instanceof Map) {
    for (const [key, asset] of assets) {
      if (typeof key !== "string" || key.trim().length === 0) {
        throw invalidInput("simulation registry keys must be non-empty strings");
      }
      registry.set(key, validateAsset(key, asset));
    }
    return registry;
  }
  if (typeof assets !== "object" || assets === null) {
    throw invalidInput("simulation assets registry must be a Map or an object");
  }
  for (const [key, asset] of Object.entries(assets)) {
    if (key.trim().length === 0) {
      throw invalidInput("simulation registry keys must be non-empty strings");
    }
    registry.set(key, validateAsset(key, asset));
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SimulationEngineImpl implements SimulationEngine {
  readonly isSimulation = true as const;
  private readonly assets: Map<string, ResolvedAsset>;
  private readonly bytesPerSecond: number;
  private readonly tickMs: number;
  private readonly rebufferLeadMs: number;
  private readonly sessions = new Map<string, SimSession>();
  private readonly closedIds = new Set<string>();
  private readonly listeners = new Set<SimulationUpdateListener>();
  private counter = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(config: SimulationConfig) {
    if (typeof config !== "object" || config === null) {
      throw invalidInput("createSimulationEngine: config must be an object");
    }
    this.assets = normalizeRegistry(config.assets);
    this.bytesPerSecond =
      config.bytesPerSecond ?? DEFAULT_BYTES_PER_SECOND;
    if (
      !Number.isFinite(this.bytesPerSecond) ||
      this.bytesPerSecond <= 0
    ) {
      throw invalidInput(
        "createSimulationEngine: bytesPerSecond must be a finite number > 0",
      );
    }
    this.tickMs = config.tickMs ?? DEFAULT_TICK_MS;
    if (!Number.isSafeInteger(this.tickMs) || this.tickMs <= 0) {
      throw invalidInput(
        "createSimulationEngine: tickMs must be a positive safe integer",
      );
    }
    this.rebufferLeadMs =
      config.rebufferLeadMs ?? DEFAULT_REBUFFER_LEAD_MS;
    if (
      !Number.isFinite(this.rebufferLeadMs) ||
      this.rebufferLeadMs < 0
    ) {
      throw invalidInput(
        "createSimulationEngine: rebufferLeadMs must be a finite number >= 0",
      );
    }
  }

  // --- observability -------------------------------------------------------

  onUpdate(listener: SimulationUpdateListener): () => void {
    this.requireLive("onUpdate");
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(sessionId: string): NativeMediaSession | undefined {
    const sim = this.sessions.get(sessionId);
    return sim === undefined ? undefined : { ...sim.session };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimer();
    this.sessions.clear();
    this.listeners.clear();
  }

  // --- frozen NativeMediaEngine surface -------------------------------------

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
          "open: torrentBytes sources are unsupported by the simulation engine (register a magnet or localPath asset instead)",
      });
    }
    const tried: string[] = [];
    if (input.magnet !== undefined) {
      if (typeof input.magnet !== "string" || input.magnet.trim().length === 0) {
        throw invalidInput("open: magnet must be a non-empty string");
      }
      if (!input.magnet.startsWith("magnet:")) {
        throw invalidInput(
          `open: magnet must be a magnet URI ('magnet:?xt=...'), got '${input.magnet.slice(0, 32)}'`,
        );
      }
      tried.push(input.magnet);
    }
    if (input.localPath !== undefined) {
      if (typeof input.localPath !== "string" || input.localPath.trim().length === 0) {
        throw invalidInput("open: localPath must be a non-empty string");
      }
      tried.push(input.localPath);
    }
    if (tried.length === 0) {
      throw invalidInput(
        "open: at least one source is required (magnet, torrentBytes, or localPath)",
      );
    }
    let asset: ResolvedAsset | undefined;
    for (const key of tried) {
      const found = this.assets.get(key);
      if (found !== undefined) {
        asset = found;
        break;
      }
    }
    if (asset === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `open: no simulated asset registered for ${tried.map((k) => `'${k}'`).join(" or ")}`,
      });
    }
    this.counter += 1;
    const session = makeSession({
      id: `sim-session-${this.counter}`,
      assetId: `sim-asset-${asset.seed.toString(16)}`,
      fileId: `sim-file-${asset.seed.toString(16)}`,
      state: "buffering",
      bufferedMs: 0,
      positionMs: 0,
    });
    const now = this.now();
    this.sessions.set(session.id, {
      session,
      asset,
      downloaded: new Array<boolean>(asset.pieceCount).fill(false),
      pendingOrder: sequentialOrder(0, asset.pieceCount),
      downloadedBytes: 0,
      paused: false,
      stalled: false,
      openedAtMs: now,
      lastTickMs: now,
    });
    this.ensureTimer();
    this.notify(session.id);
    return { ...session };
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    const sim = this.requireControllable("seek", sessionId);
    if (
      typeof positionMs !== "number" ||
      !Number.isFinite(positionMs) ||
      positionMs < 0 ||
      positionMs > sim.asset.durationMs
    ) {
      throw invalidInput(
        `seek: positionMs must be a finite number in [0, ${sim.asset.durationMs}] (got ${String(positionMs)})`,
      );
    }
    const seekByte = Math.min(
      sim.asset.totalBytes - 1,
      Math.floor((positionMs / sim.asset.durationMs) * sim.asset.totalBytes),
    );
    const seekPiece = pieceIndexOf(seekByte, sim.asset);
    // Deadline-aware re-cursor: pending pieces from the seek point forward
    // first (their playback deadline is nearest), then the earlier pending
    // pieces as backfill. Already-downloaded pieces never re-enter the queue.
    const pendingSet = new Set(sim.pendingOrder);
    const forward: number[] = [];
    const backward: number[] = [];
    for (let piece = 0; piece < sim.asset.pieceCount; piece += 1) {
      if (!pendingSet.has(piece)) continue;
      if (piece >= seekPiece) forward.push(piece);
      else backward.push(piece);
    }
    sim.pendingOrder = [...forward, ...backward];
    sim.session = { ...sim.session, positionMs };
    sim.stalled =
      sim.session.bufferedMs - positionMs < this.rebufferLeadMs;
    sim.lastTickMs = this.now();
    this.ensureTimer();
    this.notify(sessionId);
  }

  async prioritize(
    sessionId: string,
    deadlines: { piece: number; deadlineMs: number }[],
  ): Promise<void> {
    const sim = this.requireControllable("prioritize", sessionId);
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
        piece >= sim.asset.pieceCount
      ) {
        throw invalidInput(
          `prioritize: piece must be a safe integer in [0, ${sim.asset.pieceCount - 1}] (got ${String(piece)})`,
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
    // Deadline-aware order: pending pieces WITH deadlines first (ascending
    // deadline, piece index as tiebreak), then the remaining pending pieces
    // in their current relative order.
    const withDeadlines = [...deadlineMap.keys()]
      .filter((piece) => sim.pendingOrder.includes(piece))
      .sort((a, b) => {
        const da = deadlineMap.get(a) ?? 0;
        const db = deadlineMap.get(b) ?? 0;
        return da === db ? a - b : da - db;
      });
    const withSet = new Set(withDeadlines);
    const rest = sim.pendingOrder.filter((piece) => !withSet.has(piece));
    sim.pendingOrder = [...withDeadlines, ...rest];
    // No session snapshot field changes: piece priorities are engine-internal.
    // The command acknowledgment (see process.ts) carries the unchanged
    // snapshot; no update notification fires.
  }

  async pause(sessionId: string): Promise<void> {
    const sim = this.requireControllable("pause", sessionId);
    // Pause is NOT a state (the frozen union has no `paused`): the playback
    // clock simply freezes. Downloading continues (that is the point of
    // pausing a streaming download).
    sim.paused = true;
    sim.lastTickMs = this.now();
  }

  async resume(sessionId: string): Promise<void> {
    const sim = this.requireControllable("resume", sessionId);
    sim.paused = false;
    sim.lastTickMs = this.now();
    if (sim.session.state === "buffering") {
      // FSM: buffering -> playing (the frozen interface's playback-start
      // primitive is `resume`; there is no `play` — see WFX-004 service docs).
      sim.session = transition(sim.session, "playing");
    }
    sim.stalled =
      sim.session.bufferedMs - sim.session.positionMs < this.rebufferLeadMs;
    this.ensureTimer();
    this.notify(sessionId);
  }

  async close(sessionId: string): Promise<void> {
    this.requireLive("close");
    if (this.closedIds.has(sessionId)) {
      return; // idempotent double-close, mirroring the WFX-004 stub fixture
    }
    const sim = this.sessions.get(sessionId);
    if (sim === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `close: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    this.sessions.delete(sessionId);
    this.closedIds.add(sessionId);
    if (!this.hasWork()) this.stopTimer();
  }

  // --- optional RangeAccessEngine extension ----------------------------------

  async statMedia(
    sessionId: string,
  ): Promise<{ totalBytes: number; contentType: string }> {
    const sim = this.requireRangable("statMedia", sessionId);
    return {
      totalBytes: sim.asset.totalBytes,
      contentType: sim.asset.contentType,
    };
  }

  async readRange(
    sessionId: string,
    startByte: number,
    endByte: number,
  ): Promise<Uint8Array> {
    const sim = this.requireRangable("readRange", sessionId);
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
    if (startByte >= sim.asset.totalBytes || endByte >= sim.asset.totalBytes) {
      throw new NativeMediaError("RANGE_NOT_SATISFIABLE", {
        detail: `readRange: [${startByte}, ${endByte}] is not satisfiable against ${sim.asset.totalBytes} bytes`,
        sessionId,
      });
    }
    const firstPiece = pieceIndexOf(startByte, sim.asset);
    const lastPiece = pieceIndexOf(endByte, sim.asset);
    for (let piece = firstPiece; piece <= lastPiece; piece += 1) {
      if (!sim.downloaded[piece]) {
        throw new NativeMediaError("IO_ERROR", {
          detail: `readRange: bytes ${startByte}-${endByte} cover piece ${piece}, which is not downloaded yet (piece map ${sim.downloadedBytes}/${sim.asset.totalBytes} bytes) — retry while buffering progresses`,
          sessionId,
        });
      }
    }
    const out = new Uint8Array(endByte - startByte + 1);
    for (let i = startByte; i <= endByte; i += 1) {
      out[i - startByte] = simulatedByte(sim.asset.seed, i);
    }
    return out;
  }

  // --- internals --------------------------------------------------------------

  private requireLive(op: string): void {
    if (this.disposed) {
      throw invalidInput(`${op}: simulation engine is disposed`);
    }
  }

  /** A session that may still receive control commands. */
  private requireControllable(op: string, sessionId: string): SimSession {
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
    const sim = this.sessions.get(sessionId);
    if (sim === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `${op}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (sim.session.state === "complete" || sim.session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is '${sim.session.state}' (terminal) — no further control`,
        sessionId,
      });
    }
    return sim;
  }

  /** A session whose simulated piece buffer may serve range reads. */
  private requireRangable(op: string, sessionId: string): SimSession {
    this.requireLive(op);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidInput(`${op}: sessionId must be a non-empty string`);
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is closed — the simulated piece buffer was released`,
        sessionId,
      });
    }
    const sim = this.sessions.get(sessionId);
    if (sim === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `${op}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (sim.session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is 'failed' — the cache entry is unusable`,
        sessionId,
      });
    }
    return sim;
  }

  private notify(sessionId: string): void {
    const sim = this.sessions.get(sessionId);
    if (sim === undefined || this.listeners.size === 0) return;
    const snapshot = { ...sim.session };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /** Monotonic clock — elapsed-time math must never run backwards. */
  private now(): number {
    return performance.now();
  }

  private hasWork(): boolean {
    for (const sim of this.sessions.values()) {
      if (sim.pendingOrder.length > 0) return true;
      if (sim.session.state === "playing") return true;
    }
    return false;
  }

  private ensureTimer(): void {
    if (this.disposed || this.timer !== undefined || !this.hasWork()) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One simulated clock tick: download budget, buffer edge, playback. */
  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const sim of this.sessions.values()) {
      const before = { ...sim.session };
      const dtMs = Math.max(0, now - sim.lastTickMs);
      sim.lastTickMs = now;

      // 1. Download: the byte budget is a pure function of elapsed time.
      const budgetBytes = Math.floor(
        ((now - sim.openedAtMs) * this.bytesPerSecond) / 1000,
      );
      const target = Math.min(budgetBytes, sim.asset.totalBytes);
      while (sim.downloadedBytes < target && sim.pendingOrder.length > 0) {
        const piece = sim.pendingOrder.shift();
        if (piece === undefined) break;
        if (sim.downloaded[piece]) continue;
        sim.downloaded[piece] = true;
        sim.downloadedBytes += pieceByteSize(piece, sim.asset);
      }

      // 2. Buffered-through marker: contiguous coverage from the playhead.
      const positionByte = Math.min(
        sim.asset.totalBytes - 1,
        Math.floor(
          (sim.session.positionMs / sim.asset.durationMs) *
            sim.asset.totalBytes,
        ),
      );
      const contiguousEnd = contiguousEndByteFrom(positionByte, sim);
      const bufferedMs =
        (contiguousEnd / sim.asset.totalBytes) * sim.asset.durationMs;
      if (bufferedMs !== sim.session.bufferedMs) {
        sim.session = { ...sim.session, bufferedMs };
      }

      // 3. Playback clock (playing sessions only; pause freezes it).
      if (sim.session.state === "playing" && !sim.paused) {
        if (sim.stalled) {
          if (sim.session.bufferedMs - sim.session.positionMs >= this.rebufferLeadMs) {
            sim.stalled = false;
          }
        }
        if (
          !sim.stalled &&
          sim.session.bufferedMs > sim.session.positionMs &&
          sim.session.positionMs < sim.asset.durationMs
        ) {
          const candidate = sim.session.positionMs + dtMs;
          const advanced = Math.min(
            candidate,
            sim.session.bufferedMs,
            sim.asset.durationMs,
          );
          sim.session = { ...sim.session, positionMs: advanced };
          if (advanced >= sim.session.bufferedMs && advanced < sim.asset.durationMs) {
            sim.stalled = true; // hit the buffer edge: freeze (no re-buffer state)
          }
        }
        if (sim.session.positionMs >= sim.asset.durationMs) {
          // FSM: playing -> complete (background completion is the other
          // legal route, unreachable through the frozen v1 surface).
          sim.session = transition(sim.session, "complete");
          sim.stalled = false;
        }
      }

      if (sessionChanged(before, sim.session)) {
        this.notify(sim.session.id);
      }
    }
    if (!this.hasWork()) this.stopTimer();
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Pieces `from, from+1, ..., pieceCount-1, 0, ..., from-1`. */
function sequentialOrder(from: number, pieceCount: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < pieceCount; i += 1) {
    order.push((from + i) % pieceCount);
  }
  return order;
}

function pieceIndexOf(byte: number, asset: ResolvedAsset): number {
  return Math.min(asset.pieceCount - 1, Math.floor(byte / asset.pieceSize));
}

function pieceByteSize(piece: number, asset: ResolvedAsset): number {
  return piece === asset.pieceCount - 1
    ? asset.lastPieceBytes
    : asset.pieceSize;
}

/**
 * The exclusive end byte of the contiguous downloaded run starting at
 * the piece containing `from`. If that piece is missing the run is empty
 * and `from` itself is returned (zero coverage ahead of the playhead).
 */
function contiguousEndByteFrom(from: number, sim: SimSession): number {
  const { asset } = sim;
  let piece = pieceIndexOf(from, asset);
  if (!sim.downloaded[piece]) return from;
  let end = pieceEndByte(piece, asset);
  while (piece + 1 < asset.pieceCount && sim.downloaded[piece + 1]) {
    piece += 1;
    end = pieceEndByte(piece, asset);
  }
  return end;
}

/** The exclusive end byte of `piece` (exact — the last piece may be larger). */
function pieceEndByte(piece: number, asset: ResolvedAsset): number {
  return piece === asset.pieceCount - 1
    ? asset.totalBytes
    : (piece + 1) * asset.pieceSize;
}

function sessionChanged(a: NativeMediaSession, b: NativeMediaSession): boolean {
  return (
    a.state !== b.state ||
    a.bufferedMs !== b.bufferedMs ||
    a.positionMs !== b.positionMs
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the SIMULATION engine (TEST/DEV ONLY — NEVER PRODUCTION).
 * Implements the frozen `NativeMediaEngine` interface plus the optional
 * `RangeAccessEngine` extension, with deterministic timer-driven
 * buffering over a pluggable fake asset registry. All failures surface as
 * typed `NativeMediaError`s from the WFX-004 taxonomy.
 */
export function createSimulationEngine(
  config: SimulationConfig = {},
): SimulationEngine {
  return new SimulationEngineImpl(config);
}
