/**
 * @wfx/native-media — engine adapter + in-process process pipe (WFX-014, Lane B).
 *
 * THE ADAPTER LAYER that bridges the frozen `NativeMediaEngine` interface to
 * the process/transport boundary defined in ./process.ts:
 *
 * - `createEngineAdapter(process, config?, options?)` adapts ANY
 *   `NativeEngineProcess` (including a future real Rust subprocess) to the
 *   frozen engine interface plus the optional `RangeAccessEngine` and
 *   `StatusAccessEngine` extensions:
 *     - COMMAND MARSHALLING: every method becomes a versioned, JSON-serializable
 *       `EngineCommand` (torrent bytes as base64) with a deterministic
 *       correlation id; responses are structurally validated (`isEngineEvent`)
 *       and matched by `requestId` — a malformed or mismatched response is a
 *       typed `INTERNAL` error, never interpreted data.
 *     - EVENT → STATE MAPPING: unsolicited `progress`/`buffered`/
 *       `state-changed` events update the adapter's last-known session
 *       snapshots; a session-scoped `error` fails that session; a fatal
 *       `error` or an `exit` event fails ALL live sessions (`failed`, via the
 *       WFX-004 FSM) and every later operation answers a typed `INTERNAL`
 *       error — process death is never a fake success.
 *     - TIMEOUTS: every `send` races a per-call deadline; a missed deadline is
 *       a typed retryable `ENGINE_TIMEOUT` (late responses are discarded
 *       safely, mirroring the WFX-004 service's `invoke` discipline).
 *     - ERROR MAPPING: reuses WFX-004's exported `mapEngineError` verbatim —
 *       typed engine errors keep their code, timeouts map to ENGINE_TIMEOUT,
 *       anything unknown maps to INTERNAL.
 * - `createInProcessEngineProcess(options?)` — a `NativeEngineProcess` backed
 *   by the SIMULATION engine (./simulation.ts), piped IN-PROCESS with NO
 *   subprocess: every command and event crosses the real JSON wire boundary
 *   (`serializeCommand` → `parseCommand`, `serializeEvent` → `parseEvent`),
 *   proving the wire contract round-trips. The adapter over this process must
 *   behave identically to the simulation engine used directly (the package
 *   tests assert exactly that). Its simulation defaults to `autoTick: false`
 *   for determinism; tests drive time via `handles[i].simulation.tick()`.
 *
 * DESIGN NOTE — RANGE ACCESS OVER THE WIRE: the wire protocol carries the
 * optional range extension (`stat`/`read` commands, `stat`/`data` events,
 * base64 payloads) so an adapter-wrapped engine is behaviorally identical to
 * a directly-used one. An engine that does not implement the extension
 * answers those commands with a typed `error` event, which surfaces unchanged
 * — explicit unsupported behavior, never a fabricated response.
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import { NativeMediaError, type NativeMediaErrorOptions } from "../errors";
import { mapEngineError, type RangeAccessEngine } from "../service";
import { canTransition, makeSession, transition } from "../session";
import {
  decodeBase64,
  encodeBase64,
  isEngineEvent,
  parseCommand,
  parseEvent,
  PROTOCOL_VERSION,
  serializeCommand,
  serializeEvent,
  validateEngineConfig,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EngineHandle,
  type EngineSessionSnapshot,
  type EngineSource,
  type NativeEngineProcess,
} from "./process";
import {
  createSimulationEngine,
  type FakeAsset,
  type SimulationEngine,
  type SimulationEngineConfig,
  type StatusAccessEngine,
} from "./simulation";

// ---------------------------------------------------------------------------
// Adapter surface
// ---------------------------------------------------------------------------

/**
 * The adapter's engine surface: the frozen `NativeMediaEngine` contract plus
 * the optional range and status extensions (probed structurally by
 * createNativeMediaService, exactly like the simulation engine's).
 */
export type EngineAdapter = NativeMediaEngine &
  RangeAccessEngine &
  StatusAccessEngine;

/** Options for {@link createEngineAdapter}. */
export interface EngineAdapterOptions {
  /**
   * Deadline for a single engine command, in milliseconds. A command that
   * exceeds it fails with a retryable `ENGINE_TIMEOUT` error. Use `0` to
   * disable. Default: 30000.
   */
  callTimeoutMs?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** Build error options, materializing `sessionId` only when known. */
function errOpts(detail: string, sessionId: string | undefined): NativeMediaErrorOptions {
  const options: NativeMediaErrorOptions = { detail };
  if (sessionId !== undefined) options.sessionId = sessionId;
  return options;
}

/**
 * Default engine config used when the caller provides none. `cacheDir` /
 * `maxCacheBytes` are real inputs for a real engine process; the in-process
 * simulation records them informationally.
 */
const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  cacheDir: ".webflix/engine-cache",
  maxCacheBytes: 1_073_741_824, // 1 GiB
};

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

class EngineAdapterImpl implements EngineAdapter {
  private readonly handle: EngineHandle;
  private readonly callTimeoutMs: number;
  private readonly sessions = new Map<string, NativeMediaSession>();
  private readonly closedIds = new Set<string>();
  /** Set when the engine process dies (fatal error / exit); the reason. */
  private crashed: string | null = null;
  private requestCounter = 0;

  constructor(
    engineProcess: NativeEngineProcess,
    config: EngineConfig,
    options: EngineAdapterOptions,
  ) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    let handle: EngineHandle;
    try {
      handle = engineProcess.spawn(config);
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      throw new NativeMediaError("INTERNAL", {
        detail: `createEngineAdapter: engine process failed to spawn (${detail})`,
        cause: e,
      });
    }
    const candidate = handle as Partial<EngineHandle> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.send !== "function" ||
      typeof candidate.onEvent !== "function" ||
      typeof candidate.terminate !== "function"
    ) {
      throw new NativeMediaError("INTERNAL", {
        detail: "createEngineAdapter: spawn returned an object that is not an EngineHandle",
      });
    }
    this.handle = handle;
    this.handle.onEvent((event) => this.onUnsolicitedEvent(event));
  }

  // --- frozen NativeMediaEngine surface -----------------------------------

  async open(input: {
    magnet?: string;
    torrentBytes?: Uint8Array;
    localPath?: string;
  }): Promise<NativeMediaSession> {
    this.requireAlive("open", undefined);
    if (typeof input !== "object" || input === null) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "engine adapter open: input must be an object",
      });
    }
    if (
      input.magnet === undefined &&
      input.torrentBytes === undefined &&
      input.localPath === undefined
    ) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "engine adapter open: at least one source is required (magnet, torrentBytes, or localPath)",
      });
    }
    if (input.magnet !== undefined) {
      if (typeof input.magnet !== "string" || input.magnet.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "engine adapter open: magnet must be a non-empty string",
        });
      }
      if (!input.magnet.startsWith("magnet:")) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `engine adapter open: magnet must be a magnet URI ('magnet:?xt=...'), got '${input.magnet.slice(0, 32)}'`,
        });
      }
    }
    if (input.torrentBytes !== undefined) {
      if (!(input.torrentBytes instanceof Uint8Array) || input.torrentBytes.length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "engine adapter open: torrentBytes must be a non-empty Uint8Array",
        });
      }
    }
    if (input.localPath !== undefined) {
      if (typeof input.localPath !== "string" || input.localPath.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "engine adapter open: localPath must be a non-empty string",
        });
      }
    }

    const source: EngineSource = {};
    if (input.magnet !== undefined) source.magnet = input.magnet;
    if (input.localPath !== undefined) source.localPath = input.localPath;
    if (input.torrentBytes !== undefined) {
      source.torrentBase64 = encodeBase64(input.torrentBytes);
    }
    const command = this.command("open", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "open",
      requestId,
      source,
    }));
    const event = await this.roundTrip(command, undefined);
    if (event.kind !== "opened") {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter open: unexpected '${event.kind}' response to an open command`,
      });
    }
    const session = this.adopt(event.session, "open");
    if (this.sessions.has(session.id) || this.closedIds.has(session.id)) {
      // Should be unreachable (we just adopted it) — defensive invariant.
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter open: duplicate session id '${session.id}'`,
        sessionId: session.id,
      });
    }
    this.sessions.set(session.id, session);
    return { ...session };
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    const id = this.requireControllable("seek", sessionId);
    if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `engine adapter seek: positionMs must be a finite number >= 0 (got ${String(positionMs)})`,
        sessionId: id,
      });
    }
    const command = this.command("seek", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "seek",
      requestId,
      sessionId: id,
      positionMs,
    }));
    const event = await this.roundTrip(command, id);
    this.expectAck(event, "seek", id);
  }

  async prioritize(
    sessionId: string,
    deadlines: { piece: number; deadlineMs: number }[],
  ): Promise<void> {
    const id = this.requireControllable("prioritize", sessionId);
    if (!Array.isArray(deadlines)) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "engine adapter prioritize: deadlines must be an array",
        sessionId: id,
      });
    }
    for (let i = 0; i < deadlines.length; i += 1) {
      const entry: unknown = deadlines[i];
      if (typeof entry !== "object" || entry === null) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `engine adapter prioritize: deadlines[${i}] must be an object`,
          sessionId: id,
        });
      }
      const d = entry as Record<string, unknown>;
      if (
        typeof d.piece !== "number" ||
        !Number.isSafeInteger(d.piece) ||
        d.piece < 0
      ) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `engine adapter prioritize: deadlines[${i}].piece must be a non-negative safe integer`,
          sessionId: id,
        });
      }
      if (
        typeof d.deadlineMs !== "number" ||
        !Number.isFinite(d.deadlineMs) ||
        d.deadlineMs < 0
      ) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `engine adapter prioritize: deadlines[${i}].deadlineMs must be a finite number >= 0`,
          sessionId: id,
        });
      }
    }
    const command = this.command("prioritize", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "prioritize",
      requestId,
      sessionId: id,
      deadlines,
    }));
    const event = await this.roundTrip(command, id);
    this.expectAck(event, "prioritize", id);
  }

  async pause(sessionId: string): Promise<void> {
    const id = this.requireControllable("pause", sessionId);
    const command = this.command("pause", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "pause",
      requestId,
      sessionId: id,
    }));
    const event = await this.roundTrip(command, id);
    this.expectAck(event, "pause", id);
  }

  async resume(sessionId: string): Promise<void> {
    const id = this.requireControllable("resume", sessionId);
    const command = this.command("resume", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "resume",
      requestId,
      sessionId: id,
    }));
    const event = await this.roundTrip(command, id);
    this.expectAck(event, "resume", id);
  }

  async close(sessionId: string): Promise<void> {
    this.requireAlive("close", sessionId);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "engine adapter close: sessionId must be a non-empty string",
      });
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `engine adapter close: session '${sessionId}' is already closed`,
        sessionId,
      });
    }
    if (!this.sessions.has(sessionId)) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `engine adapter close: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    const command = this.command("close", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "close",
      requestId,
      sessionId,
    }));
    const event = await this.roundTrip(command, sessionId);
    this.expectAck(event, "close", sessionId);
    this.sessions.delete(sessionId);
    this.closedIds.add(sessionId);
  }

  // --- optional RangeAccessEngine extension --------------------------------

  async statMedia(
    sessionId: string,
  ): Promise<{ totalBytes: number; contentType: string }> {
    const id = this.requireRangable("statMedia", sessionId);
    const command = this.command("stat", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "stat",
      requestId,
      sessionId: id,
    }));
    const event = await this.roundTrip(command, id);
    if (event.kind !== "stat") {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter statMedia: unexpected '${event.kind}' response to a stat command`,
        sessionId: id,
      });
    }
    if (event.sessionId !== id) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter statMedia: response names session '${event.sessionId}' instead of '${id}'`,
        sessionId: id,
      });
    }
    return { totalBytes: event.totalBytes, contentType: event.contentType };
  }

  async readRange(sessionId: string, startByte: number, endByte: number): Promise<Uint8Array> {
    const id = this.requireRangable("readRange", sessionId);
    if (
      !Number.isSafeInteger(startByte) ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 ||
      endByte < startByte
    ) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `engine adapter readRange: require safe integers with 0 <= startByte <= endByte (got ${String(startByte)}..${String(endByte)})`,
        sessionId: id,
      });
    }
    const command = this.command("read", (requestId) => ({
      protocol: PROTOCOL_VERSION,
      kind: "read",
      requestId,
      sessionId: id,
      startByte,
      endByte,
    }));
    const event = await this.roundTrip(command, id);
    if (event.kind !== "data") {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter readRange: unexpected '${event.kind}' response to a read command`,
        sessionId: id,
      });
    }
    if (event.sessionId !== id || event.startByte !== startByte || event.endByte !== endByte) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter readRange: response echo mismatch (got session '${event.sessionId}' bytes ${event.startByte}-${event.endByte}, asked '${id}' bytes ${startByte}-${endByte})`,
        sessionId: id,
      });
    }
    const data = decodeBase64(event.dataBase64);
    if (data === null) {
      throw new NativeMediaError("INTERNAL", {
        detail: "engine adapter readRange: response dataBase64 is not valid base64",
        sessionId: id,
      });
    }
    const span = endByte - startByte + 1;
    if (data.length !== span) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter readRange: response carried ${data.length} bytes for a ${span}-byte span`,
        sessionId: id,
      });
    }
    return data;
  }

  // --- optional status extension --------------------------------------------

  async status(sessionId: string): Promise<NativeMediaSession> {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "engine adapter status: sessionId must be a non-empty string",
      });
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `engine adapter status: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `engine adapter status: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    return { ...session };
  }

  // --- command plumbing ------------------------------------------------------

  /** Deterministic request ids — no entropy, replayable command logs. */
  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }

  private command<K extends EngineCommand["kind"]>(
    _kind: K,
    build: (requestId: string) => EngineCommand,
  ): EngineCommand {
    return build(this.nextRequestId());
  }

  /**
   * Send a command and await its response with deadline enforcement, wire
   * validation, and `requestId` correlation. A typed `error` response throws
   * the mapped `NativeMediaError`; anything malformed throws `INTERNAL`.
   */
  private async roundTrip(
    command: EngineCommand,
    sessionId: string | undefined,
  ): Promise<Exclude<EngineEvent, { kind: "error" }>> {
    this.requireAlive(command.kind, sessionId);
    let pending: Promise<EngineEvent>;
    try {
      pending = this.handle.send(command);
    } catch (e) {
      throw mapEngineError(e, sessionId);
    }
    // Attach a no-op rejection handler so a LATE engine rejection (after the
    // timeout already won the race) never surfaces as unhandled — the same
    // discipline as the WFX-004 service's `invoke`.
    const _suppressLateRejection: Promise<unknown> = pending.then(undefined, () => {});
    let event: EngineEvent;
    try {
      if (this.callTimeoutMs > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          event = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(
                  new NativeMediaError(
                    "ENGINE_TIMEOUT",
                    errOpts(
                      `engine adapter: '${command.kind}' (request ${command.requestId}) exceeded the ${this.callTimeoutMs}ms call deadline`,
                      sessionId,
                    ),
                  ),
                );
              }, this.callTimeoutMs);
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      } else {
        event = await pending;
      }
    } catch (e) {
      // An engine rejection — sync throw, async reject, or missed deadline —
      // always leaves this method as a typed NativeMediaError. The timeout's
      // own NativeMediaError passes through mapEngineError unchanged.
      throw mapEngineError(e, sessionId);
    }
    if (!isEngineEvent(event)) {
      throw new NativeMediaError(
        "INTERNAL",
        errOpts(
          `engine adapter: '${command.kind}' (request ${command.requestId}) returned a response that fails wire validation`,
          sessionId,
        ),
      );
    }
    if (event.kind === "error") {
      if (event.requestId !== command.requestId) {
        throw new NativeMediaError(
          "INTERNAL",
          errOpts(
            `engine adapter: error response for request ${String(event.requestId)} does not answer request ${command.requestId}`,
            sessionId,
          ),
        );
      }
      throw new NativeMediaError(event.code, errOpts(event.message, event.sessionId ?? sessionId));
    }
    // Only a SOLICITED kind may answer a command; an unsolicited event in a
    // response slot is a protocol violation.
    switch (event.kind) {
      case "opened":
      case "acked":
      case "stat":
      case "data":
        break;
      default:
        throw new NativeMediaError(
          "INTERNAL",
          errOpts(
            `engine adapter: unsolicited '${event.kind}' event answered a '${command.kind}' command`,
            sessionId,
          ),
        );
    }
    if (event.requestId !== command.requestId) {
      throw new NativeMediaError(
        "INTERNAL",
        errOpts(
          `engine adapter: '${event.kind}' response for request ${event.requestId} does not answer request ${command.requestId}`,
          sessionId,
        ),
      );
    }
    return event;
  }

  /** Validate an `acked` response and adopt the fresh snapshot it carries. */
  private expectAck(
    event: Exclude<EngineEvent, { kind: "error" }>,
    what: string,
    sessionId: string,
  ): void {
    if (event.kind !== "acked") {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter ${what}: unexpected '${event.kind}' response`,
        sessionId,
      });
    }
    if (event.session.id !== sessionId) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter ${what}: response names session '${event.session.id}' instead of '${sessionId}'`,
        sessionId,
      });
    }
    this.sessions.set(sessionId, { ...event.session });
  }

  /** Adopt a wire snapshot into the session table (re-validated via WFX-004). */
  private adopt(snapshot: EngineSessionSnapshot, what: string): NativeMediaSession {
    try {
      return makeSession(snapshot);
    } catch (e) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine adapter ${what}: engine returned a malformed session snapshot`,
        cause: e,
      });
    }
  }

  // --- unsolicited event handling --------------------------------------------

  private onUnsolicitedEvent(event: EngineEvent): void {
    if (!isEngineEvent(event)) {
      // Fail closed: a malformed unsolicited event is a protocol violation —
      // an engine bug — and proceeding with unknown state would be fake success.
      this.failAllSessions("malformed unsolicited engine event (protocol violation)");
      return;
    }
    switch (event.kind) {
      case "progress":
      case "buffered":
      case "state-changed": {
        // Track only sessions this adapter opened; events for other ids
        // (another client of the same engine) are not ours to bookkeep.
        if (this.closedIds.has(event.sessionId) || !this.sessions.has(event.sessionId)) {
          return;
        }
        this.sessions.set(event.sessionId, { ...event.session });
        return;
      }
      case "error": {
        if (event.fatal === true) {
          this.failAllSessions(`fatal engine error: ${event.message}`);
          return;
        }
        if (event.sessionId !== undefined && this.sessions.has(event.sessionId)) {
          this.failSession(event.sessionId, event.message);
        }
        return; // requestId-scoped errors are delivered through send()
      }
      case "exit": {
        this.failAllSessions(`engine process exited: ${event.reason}`);
        return;
      }
      case "opened":
      case "acked":
      case "stat":
      case "data":
        return; // solicited kinds travel through send(); ignore here
    }
  }

  /** Process death: every live session → `failed` (FSM-legal), forever. */
  private failAllSessions(reason: string): void {
    if (this.crashed !== null) return;
    this.crashed = reason;
    for (const [id, session] of this.sessions) {
      if (canTransition(session.state, "failed")) {
        this.sessions.set(id, transition(session, "failed"));
      }
    }
  }

  /** A session-scoped engine error fails that one session (FSM-legal only). */
  private failSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    if (canTransition(session.state, "failed")) {
      this.sessions.set(sessionId, transition(session, "failed"));
    }
    void reason; // retained for future diagnostics; state change is the effect
  }

  // --- session guards ----------------------------------------------------------

  private requireAlive(what: string, sessionId: string | undefined): void {
    if (this.crashed !== null) {
      throw new NativeMediaError(
        "INTERNAL",
        errOpts(`engine adapter ${what}: engine process is down (${this.crashed})`, sessionId),
      );
    }
  }

  private requireSessionId(what: string, sessionId: string): string {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `engine adapter ${what}: sessionId must be a non-empty string`,
      });
    }
    return sessionId;
  }

  /** A session that may still receive control commands (mirrors the service). */
  private requireControllable(what: string, sessionId: string): string {
    this.requireAlive(what, sessionId);
    const id = this.requireSessionId(what, sessionId);
    if (this.closedIds.has(id)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `engine adapter ${what}: session '${id}' is closed`,
        sessionId: id,
      });
    }
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `engine adapter ${what}: session '${id}' does not exist`,
        sessionId: id,
      });
    }
    if (session.state === "complete" || session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `engine adapter ${what}: session '${id}' is '${session.state}' (terminal) — no further control`,
        sessionId: id,
      });
    }
    return id;
  }

  /** A session whose cache may serve range reads (mirrors the service). */
  private requireRangable(what: string, sessionId: string): string {
    this.requireAlive(what, sessionId);
    const id = this.requireSessionId(what, sessionId);
    if (this.closedIds.has(id)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `engine adapter ${what}: session '${id}' is closed`,
        sessionId: id,
      });
    }
    const session = this.sessions.get(id);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `engine adapter ${what}: session '${id}' does not exist`,
        sessionId: id,
      });
    }
    if (session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `engine adapter ${what}: session '${id}' is 'failed' — the cache entry is unusable`,
        sessionId: id,
      });
    }
    return id;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the engine adapter around ANY `NativeEngineProcess`. The adapter
 * spawns the engine eagerly (a spawn failure is a typed `INTERNAL` error),
 * subscribes to unsolicited events, and enforces per-command deadlines.
 */
export function createEngineAdapter(
  engineProcess: NativeEngineProcess,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
  options: EngineAdapterOptions = {},
): EngineAdapter {
  if (typeof engineProcess !== "object" || engineProcess === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineAdapter: engineProcess must be an object",
    });
  }
  if (typeof engineProcess.spawn !== "function") {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineAdapter: engineProcess is missing the 'spawn' method required by the NativeEngineProcess contract",
    });
  }
  try {
    validateEngineConfig(config);
  } catch (e) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `createEngineAdapter: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
  if (
    options.callTimeoutMs !== undefined &&
    (typeof options.callTimeoutMs !== "number" ||
      !Number.isFinite(options.callTimeoutMs) ||
      options.callTimeoutMs < 0)
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineAdapter: callTimeoutMs must be a finite number >= 0",
    });
  }
  return new EngineAdapterImpl(engineProcess, config, options);
}

// ---------------------------------------------------------------------------
// In-process process pipe (TEST/DEV transport — no subprocess)
// ---------------------------------------------------------------------------

/** Options for {@link createInProcessEngineProcess}. */
export interface InProcessEngineProcessOptions {
  /** Fake asset registry forwarded to the backing simulation. */
  assets?: FakeAsset[];
  /**
   * Auto-tick the backing simulation from a real timer. Default: `false` —
   * the in-process pipe is deterministic by default; drive time explicitly
   * through `handles[i].simulation.tick()` (interactive dev may opt in).
   */
  autoTick?: boolean;
  /** Simulated milliseconds per tick (forwarded to the simulation). */
  tickIntervalMs?: number;
  /** Download budget per tick in bytes (forwarded to the simulation). */
  bytesPerTick?: number;
}

/**
 * The in-process engine handle: the wire `EngineHandle` plus TEST/DEV
 * affordances — the backing simulation (for deterministic time control) and
 * a `crash()` hook that simulates an engine process crash.
 */
export interface InProcessEngineHandle extends EngineHandle {
  /** The backing simulation engine (TEST/DEV control surface). */
  readonly simulation: SimulationEngine;
  /**
   * TEST/DEV: simulate an engine process crash — emits a fatal `error` and an
   * `exit` event, rejects pending sends, and stops the simulation.
   */
  crash(reason: string): void;
}

/**
 * The in-process engine process: a `NativeEngineProcess` whose spawned
 * handles are backed by the SIMULATION engine over an in-process JSON pipe
 * (no subprocess). TEST/DEV transport — the same boundary a real Rust
 * subprocess will implement later.
 */
export interface InProcessEngineProcess extends NativeEngineProcess {
  /** Every handle spawned so far, in spawn order (dead ones included). */
  readonly handles: readonly InProcessEngineHandle[];
  /** TEST/DEV: crash every spawned handle (fatal error + exit events). */
  crash(reason: string): void;
  /** TEST/DEV: terminate every spawned handle (cleanup; emits `exit`). */
  dispose(): void;
}

class InProcessEngineHandleImpl implements InProcessEngineHandle {
  readonly simulation: SimulationEngine;

  private readonly handlers: ((event: EngineEvent) => void)[] = [];
  private readonly pendingRejections = new Set<(error: NativeMediaError) => void>();
  private dead = false;
  private deadReason = "";

  constructor(
    private readonly processOptions: InProcessEngineProcessOptions,
    config: EngineConfig,
  ) {
    this.simulation = createSimulationEngine(buildSimulationConfig(processOptions, config));
    // Forward every unsolicited simulation event across the JSON wire.
    this.simulation.onEngineEvent((event) => {
      if (this.dead) return;
      const forwarded = parseEvent(serializeEvent(event));
      if (forwarded === null) {
        // Invariant break: a simulation event that fails wire validation.
        // Fail closed with a typed fatal error — never silently drop it.
        this.deliver({
          protocol: PROTOCOL_VERSION,
          kind: "error",
          code: "INTERNAL",
          message: "in-process engine: unsolicited event failed wire validation",
          fatal: true,
        });
        return;
      }
      this.deliver(forwarded);
    });
  }

  async send(command: EngineCommand): Promise<EngineEvent> {
    if (this.dead) {
      throw new NativeMediaError("INTERNAL", {
        detail: `in-process engine: handle is ${this.deadReason}`,
      });
    }
    // WIRE HOP (inbound): the command must survive its own JSON encoding.
    const parsed = parseCommand(serializeCommand(command));
    if (parsed === null) {
      throw new NativeMediaError("INTERNAL", {
        detail: "in-process engine: command failed wire validation on the inbound hop",
      });
    }
    // Register a rejection hook so a crash/terminate can fail in-flight sends.
    let settle!: (error: NativeMediaError) => void;
    const guard = new Promise<never>((_, reject) => {
      settle = reject;
    });
    this.pendingRejections.add(settle);
    try {
      const response = await Promise.race([this.dispatch(parsed), guard]);
      // WIRE HOP (outbound): the response must survive its own JSON encoding.
      const wire = parseEvent(serializeEvent(response));
      if (wire === null) {
        throw new NativeMediaError("INTERNAL", {
          detail: "in-process engine: response failed wire validation on the outbound hop",
        });
      }
      return wire;
    } finally {
      this.pendingRejections.delete(settle);
    }
  }

  onEvent(handler: (event: EngineEvent) => void): void {
    if (typeof handler !== "function") {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "in-process engine: onEvent handler must be a function",
      });
    }
    this.handlers.push(handler);
  }

  terminate(): void {
    if (this.dead) return;
    this.dead = true;
    this.deadReason = "terminated";
    this.simulation.terminate();
    this.rejectPending(
      new NativeMediaError("INTERNAL", {
        detail: "in-process engine: engine process was terminated",
      }),
    );
    this.deliver({ protocol: PROTOCOL_VERSION, kind: "exit", reason: "terminated" });
  }

  crash(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.deadReason = `crashed: ${reason}`;
    this.deliver({
      protocol: PROTOCOL_VERSION,
      kind: "error",
      code: "INTERNAL",
      message: `engine process crashed: ${reason}`,
      fatal: true,
    });
    this.simulation.terminate();
    this.rejectPending(
      new NativeMediaError("INTERNAL", {
        detail: `in-process engine: engine process crashed: ${reason}`,
      }),
    );
    this.deliver({ protocol: PROTOCOL_VERSION, kind: "exit", reason: `crashed: ${reason}` });
  }

  // --- internals -------------------------------------------------------------

  /** Execute one wire command against the simulation (typed error events). */
  private async dispatch(command: EngineCommand): Promise<EngineEvent> {
    try {
      switch (command.kind) {
        case "open": {
          const source: { magnet?: string; torrentBytes?: Uint8Array; localPath?: string } = {};
          if (command.source.magnet !== undefined) source.magnet = command.source.magnet;
          if (command.source.localPath !== undefined) source.localPath = command.source.localPath;
          if (command.source.torrentBase64 !== undefined) {
            const bytes = decodeBase64(command.source.torrentBase64);
            if (bytes === null) {
              throw new NativeMediaError("INVALID_INPUT", {
                detail: "in-process engine: open source torrentBase64 is not valid base64",
              });
            }
            source.torrentBytes = bytes;
          }
          const session = await this.simulation.open(source);
          return {
            protocol: PROTOCOL_VERSION,
            kind: "opened",
            requestId: command.requestId,
            session: snapshotOf(session),
          };
        }
        case "seek": {
          await this.simulation.seek(command.sessionId, command.positionMs);
          return this.ack(command);
        }
        case "prioritize": {
          await this.simulation.prioritize(command.sessionId, command.deadlines);
          return this.ack(command);
        }
        case "pause": {
          await this.simulation.pause(command.sessionId);
          return this.ack(command);
        }
        case "resume": {
          await this.simulation.resume(command.sessionId);
          return this.ack(command);
        }
        case "close": {
          // The ack carries the LAST-KNOWN snapshot (pre-close), the same
          // bookkeeping the WFX-004 service performs for its final snapshot.
          const last = await this.simulation.status(command.sessionId);
          await this.simulation.close(command.sessionId);
          return {
            protocol: PROTOCOL_VERSION,
            kind: "acked",
            requestId: command.requestId,
            session: snapshotOf(last),
          };
        }
        case "stat": {
          const stats = await this.simulation.statMedia(command.sessionId);
          return {
            protocol: PROTOCOL_VERSION,
            kind: "stat",
            requestId: command.requestId,
            sessionId: command.sessionId,
            totalBytes: stats.totalBytes,
            contentType: stats.contentType,
          };
        }
        case "read": {
          const data = await this.simulation.readRange(
            command.sessionId,
            command.startByte,
            command.endByte,
          );
          return {
            protocol: PROTOCOL_VERSION,
            kind: "data",
            requestId: command.requestId,
            sessionId: command.sessionId,
            startByte: command.startByte,
            endByte: command.endByte,
            dataBase64: encodeBase64(data),
          };
        }
      }
    } catch (e) {
      // Typed passthrough; anything unknown is INTERNAL — never fake success.
      if (e instanceof NativeMediaError) {
        const event: EngineEvent = {
          protocol: PROTOCOL_VERSION,
          kind: "error",
          code: e.code,
          message: e.detail ?? e.message,
          requestId: command.requestId,
          ...(e.sessionId !== undefined ? { sessionId: e.sessionId } : {}),
        };
        return event;
      }
      const err = e instanceof Error ? e : new Error(String(e));
      return {
        protocol: PROTOCOL_VERSION,
        kind: "error",
        code: "INTERNAL",
        message: `${err.name}: ${err.message}`,
        requestId: command.requestId,
      };
    }
  }

  /** Build an `acked` response from the simulation's current snapshot. */
  private async ack(command: Extract<EngineCommand, { sessionId: string }>): Promise<EngineEvent> {
    const session = await this.simulation.status(command.sessionId);
    return {
      protocol: PROTOCOL_VERSION,
      kind: "acked",
      requestId: command.requestId,
      session: snapshotOf(session),
    };
  }

  private deliver(event: EngineEvent): void {
    for (const handler of [...this.handlers]) handler(event);
  }

  private rejectPending(error: NativeMediaError): void {
    const pending = [...this.pendingRejections];
    this.pendingRejections.clear();
    for (const reject of pending) reject(error);
  }
}

/** Structural copy: a domain session IS the wire snapshot shape. */
function snapshotOf(session: NativeMediaSession): EngineSessionSnapshot {
  return {
    id: session.id,
    assetId: session.assetId,
    fileId: session.fileId,
    state: session.state,
    bufferedMs: session.bufferedMs,
    positionMs: session.positionMs,
  };
}

/**
 * Merge the process options and the wire engine config into a simulation
 * config, materializing optional fields only when present
 * (exactOptionalPropertyTypes discipline).
 */
function buildSimulationConfig(
  options: InProcessEngineProcessOptions,
  config: EngineConfig,
): SimulationEngineConfig {
  const simConfig: SimulationEngineConfig = {
    autoTick: options.autoTick === true,
    cacheDir: config.cacheDir,
    maxCacheBytes: config.maxCacheBytes,
  };
  if (options.assets !== undefined) simConfig.assets = options.assets;
  if (options.tickIntervalMs !== undefined) simConfig.tickIntervalMs = options.tickIntervalMs;
  if (options.bytesPerTick !== undefined) simConfig.bytesPerTick = options.bytesPerTick;
  return simConfig;
}

class InProcessEngineProcessImpl implements InProcessEngineProcess {
  private readonly spawned: InProcessEngineHandleImpl[] = [];

  constructor(private readonly options: InProcessEngineProcessOptions = {}) {}

  get handles(): readonly InProcessEngineHandle[] {
    return this.spawned;
  }

  spawn(config: EngineConfig): InProcessEngineHandle {
    try {
      validateEngineConfig(config);
    } catch (e) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `in-process engine spawn: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
    const handle = new InProcessEngineHandleImpl(this.options, config);
    this.spawned.push(handle);
    return handle;
  }

  crash(reason: string): void {
    for (const handle of [...this.spawned]) handle.crash(reason);
  }

  dispose(): void {
    for (const handle of [...this.spawned]) handle.terminate();
  }
}

/**
 * Create the IN-PROCESS engine process (TEST/DEV transport): a
 * `NativeEngineProcess` backed by the SIMULATION engine, piped through the
 * real JSON wire boundary with no subprocess. Pair with
 * {@link createEngineAdapter} to prove the wire contract round-trips.
 */
export function createInProcessEngineProcess(
  options: InProcessEngineProcessOptions = {},
): InProcessEngineProcess {
  if (typeof options !== "object" || options === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createInProcessEngineProcess: options must be an object",
    });
  }
  if (options.assets !== undefined && !Array.isArray(options.assets)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createInProcessEngineProcess: assets must be an array of fake assets",
    });
  }
  return new InProcessEngineProcessImpl(options);
}
