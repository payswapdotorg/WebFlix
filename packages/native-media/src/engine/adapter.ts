/**
 * @wfx/native-media — engine adapter (WFX-014, Lane B).
 *
 * `createEngineAdapter` adapts ANY `NativeEngineProcess` (the WFX-014
 * process boundary — including a future real Rust engine process) to the
 * FROZEN `NativeMediaEngine` interface:
 *
 * - COMMAND MARSHALLING — every operation becomes a versioned
 *   `EngineCommand` DTO; responses are validated `EngineEvent` DTOs.
 * - EVENT → SESSION STATE MAPPING — spontaneous `progress`/`buffered`
 *   events patch the tracked snapshots; `state-changed` events adopt the
 *   authoritative snapshot.
 * - TIMEOUTS — every send is deadline-enforced; a missed deadline
 *   rejects with a typed, retryable `ENGINE_TIMEOUT` error (the session
 *   is NOT failed: the deadline may have raced a late success).
 * - PROCESS CRASH DETECTION — an `error` event (or a malformed event)
 *   arriving through `onEvent` is process-fatal in v1: every live
 *   session is marked `failed` with a typed `INTERNAL` error (surfaced
 *   through `onSessionUpdate` and on every subsequent operation), and
 *   the handle is terminated. No fake success ever crosses the seam.
 *
 * `createInProcessEngineProcess` ships a `NativeEngineProcess` backed by
 * the SIMULATION engine: an in-process pipe — NO SUBPROCESS — that
 * marshals every command and event through `JSON.parse(JSON.stringify(
 * ...))` and the runtime guards, proving the wire contract round-trips.
 *
 * Explicitly UNSUPPORTED (typed, never silent):
 * - `torrentBytes` sources: binary payloads cannot cross the v1 JSON
 *   wire — `open` rejects with `UNSUPPORTED_SOURCE` before marshalling.
 * - Byte-range access: the v1 wire has no `stat`/`read` commands, so the
 *   adapter does NOT implement the optional `RangeAccessEngine`
 *   extension. The WFX-004 service's structural probe therefore answers
 *   `range()` with a typed `UNSUPPORTED_SOURCE`. Range commands are the
 *   v2 candidate once the real engine defines a byte-transport framing.
 *
 * Adapter-local observability (`onSessionUpdate`, `snapshot`) extends
 * the frozen surface ADDITIVELY so consumers can observe the event →
 * state mapping and crash failures; it is not part of the frozen engine
 * contract and not part of the wire protocol.
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import {
  isNativeMediaError,
  NativeMediaError,
  type NativeMediaErrorCode,
  type NativeMediaErrorOptions,
} from "../errors";
import { mapEngineError } from "../service";
import {
  errorFromEvent,
  errorToEvent,
  isEngineCommand,
  isEngineEvent,
  PROTOCOL_VERSION,
  sessionFromDto,
  sessionToDto,
  validateEngineConfig,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EngineEventHandler,
  type EngineHandle,
  type EngineOpenSource,
  type NativeEngineProcess,
} from "./process";
import {
  createSimulationEngine,
  type SimulationConfig,
  type SimulationEngine,
} from "./simulation";

// ---------------------------------------------------------------------------
// Adapter types
// ---------------------------------------------------------------------------

/** Options for {@link createEngineAdapter}. */
export interface EngineAdapterOptions {
  /**
   * Deadline for a single wire command, in milliseconds. A command that
   * exceeds it rejects with a retryable `ENGINE_TIMEOUT` error. Use `0`
   * to disable. Default: 30000.
   */
  callTimeoutMs?: number;
}

/**
 * One adapter session update. `failure` is present exactly when this
 * update failed the session (a process crash marks every live session
 * `failed` with a typed `INTERNAL` error).
 */
export interface EngineAdapterSessionUpdate {
  session: NativeMediaSession;
  failure?: NativeMediaError;
}

/**
 * The adapter surface: the frozen `NativeMediaEngine` plus adapter-local
 * observability and disposal. The extra members are ADDITIVE — the
 * adapter remains a valid `NativeMediaEngine` for the WFX-004 service.
 */
export interface EngineAdapter extends NativeMediaEngine {
  /**
   * Subscribe to session snapshot updates (state changes, telemetry
   * patches, crash failures). Returns an unsubscribe function.
   */
  onSessionUpdate(
    listener: (update: EngineAdapterSessionUpdate) => void,
  ): () => void;
  /** The adapter's current tracked snapshot, or `undefined` if unknown. */
  snapshot(sessionId: string): NativeMediaSession | undefined;
  /** Terminate the underlying engine process. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** Build error options, materializing `sessionId` only when known. */
function errorOptions(
  detail: string,
  sessionId: string | undefined,
  cause?: unknown,
): NativeMediaErrorOptions {
  const options: NativeMediaErrorOptions = { detail, cause };
  if (sessionId !== undefined) options.sessionId = sessionId;
  return options;
}

class EngineAdapterImpl implements EngineAdapter {
  private readonly handle: EngineHandle;
  private readonly callTimeoutMs: number;
  private readonly sessions = new Map<string, NativeMediaSession>();
  private readonly closedIds = new Set<string>();
  private readonly listeners = new Set<(update: EngineAdapterSessionUpdate) => void>();
  private crash: NativeMediaError | undefined;
  private disposed = false;

  constructor(
    process: NativeEngineProcess,
    config: EngineConfig,
    options: EngineAdapterOptions,
  ) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    if (
      !Number.isFinite(this.callTimeoutMs) ||
      this.callTimeoutMs < 0
    ) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "createEngineAdapter: callTimeoutMs must be a finite number >= 0",
      });
    }
    try {
      validateEngineConfig(config);
    } catch (e) {
      // spawn() would validate identically; surface it as the spawn failure.
      throw mapEngineError(e);
    }
    let handle: EngineHandle;
    try {
      handle = process.spawn(config);
    } catch (e) {
      throw mapEngineError(e);
    }
    this.handle = handle;
    handle.onEvent((event) => this.onEngineEvent(event));
  }

  // --- adapter-local observability -----------------------------------------

  onSessionUpdate(
    listener: (update: EngineAdapterSessionUpdate) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(sessionId: string): NativeMediaSession | undefined {
    const session = this.sessions.get(sessionId);
    return session === undefined ? undefined : { ...session };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handle.terminate();
  }

  // --- frozen NativeMediaEngine surface --------------------------------------

  async open(input: {
    magnet?: string;
    torrentBytes?: Uint8Array;
    localPath?: string;
  }): Promise<NativeMediaSession> {
    this.requireUsable("open", undefined);
    if (typeof input !== "object" || input === null) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "open: input must be an object",
      });
    }
    if (input.torrentBytes !== undefined) {
      // Never silently drop caller data: binary sources cannot cross the
      // v1 JSON wire — explicit, typed unsupported behavior.
      throw new NativeMediaError("UNSUPPORTED_SOURCE", {
        detail:
          "open: torrentBytes sources cannot cross the engine wire protocol v1 (JSON DTOs only); pass a magnet or localPath",
      });
    }
    const source: EngineOpenSource = {};
    if (input.magnet !== undefined) {
      if (typeof input.magnet !== "string" || input.magnet.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "open: magnet must be a non-empty string",
        });
      }
      source.magnet = input.magnet;
    }
    if (input.localPath !== undefined) {
      if (typeof input.localPath !== "string" || input.localPath.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: "open: localPath must be a non-empty string",
        });
      }
      source.localPath = input.localPath;
    }
    if (source.magnet === undefined && source.localPath === undefined) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "open: at least one source is required (magnet or localPath)",
      });
    }
    const ack = await this.send({ protocolVersion: PROTOCOL_VERSION, kind: "open", source });
    const session = sessionFromDto(ack.session);
    if (this.sessions.has(session.id) || this.closedIds.has(session.id)) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine returned duplicate session id '${session.id}'`,
        sessionId: session.id,
      });
    }
    this.applySnapshot(session);
    return { ...session };
  }

  async seek(sessionId: string, positionMs: number): Promise<void> {
    const id = this.requireControllable("seek", sessionId);
    const ack = await this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: "seek",
      sessionId: id,
      positionMs,
    });
    this.adoptSnapshot(ack);
  }

  async prioritize(
    sessionId: string,
    deadlines: { piece: number; deadlineMs: number }[],
  ): Promise<void> {
    const id = this.requireControllable("prioritize", sessionId);
    const ack = await this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: "prioritize",
      sessionId: id,
      deadlines,
    });
    this.adoptSnapshot(ack);
  }

  async pause(sessionId: string): Promise<void> {
    const id = this.requireControllable("pause", sessionId);
    const ack = await this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: "pause",
      sessionId: id,
    });
    this.adoptSnapshot(ack);
  }

  async resume(sessionId: string): Promise<void> {
    const id = this.requireControllable("resume", sessionId);
    const ack = await this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: "resume",
      sessionId: id,
    });
    this.adoptSnapshot(ack);
  }

  async close(sessionId: string): Promise<void> {
    this.requireUsable("close", undefined);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "close: sessionId must be a non-empty string",
      });
    }
    if (this.closedIds.has(sessionId)) return; // idempotent double-close
    if (!this.sessions.has(sessionId)) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `close: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    await this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: "close",
      sessionId,
    });
    this.sessions.delete(sessionId);
    this.closedIds.add(sessionId);
  }

  // --- internals ---------------------------------------------------------------

  /** The adapter must be usable: not disposed, not crashed. */
  private requireUsable(op: string, sessionId: string | undefined): void {
    if (this.disposed) {
      throw new NativeMediaError(
        "INVALID_INPUT",
        errorOptions(`${op}: engine adapter is disposed`, sessionId),
      );
    }
    if (this.crash !== undefined) {
      throw new NativeMediaError(
        "INTERNAL",
        errorOptions(
          `${op}: engine process failed earlier (${this.crash.detail ?? this.crash.code}); every live session was marked failed`,
          sessionId,
          this.crash,
        ),
      );
    }
  }

  /** Resolve the session id a control command may be sent to. */
  private requireControllable(op: string, sessionId: string): string {
    this.requireUsable(op, sessionId);
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `${op}: sessionId must be a non-empty string`,
      });
    }
    if (this.closedIds.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `${op}: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (session.state === "complete" || session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `${op}: session '${sessionId}' is '${session.state}' (terminal) — no further control`,
        sessionId,
      });
    }
    return sessionId;
  }

  /**
   * Send a command with deadline enforcement. The response must be a
   * well-formed `state-changed` acknowledgment; anything else (malformed
   * DTO, wrong event kind, an `error` event response, a crash that
   * happened mid-flight) rejects with a typed `NativeMediaError`.
   */
  private async send(command: EngineCommand): Promise<Extract<EngineEvent, { kind: "state-changed" }>> {
    let wireCommand: EngineCommand;
    try {
      // Marshal through the same JSON transform a real transport applies.
      wireCommand = jsonRoundTrip(command);
      if (!isEngineCommand(wireCommand)) {
        throw new NativeMediaError("INTERNAL", {
          detail: `send: command '${command.kind}' failed wire validation after marshalling`,
        });
      }
    } catch (e) {
      throw mapEngineError(e);
    }
    let promise: Promise<EngineEvent>;
    try {
      promise = this.handle.send(wireCommand);
    } catch (e) {
      throw mapEngineError(e);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.callTimeoutMs > 0) {
        // Attach a no-op rejection handler so a LATE engine rejection
        // (after the timeout already won the race) never surfaces as
        // unhandled — same pattern as the WFX-004 service adapter.
        const _suppressLateRejection: Promise<unknown> = promise.then(
          undefined,
          () => {},
        );
      }
      const response = await (this.callTimeoutMs > 0
        ? Promise.race([
            promise,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(
                  new NativeMediaError("ENGINE_TIMEOUT", {
                    detail: `engine command '${command.kind}' exceeded the ${this.callTimeoutMs}ms wire deadline`,
                  }),
                );
              }, this.callTimeoutMs);
            }),
          ])
        : promise);
      if (this.crash !== undefined) {
        // The process failed while the command was in flight: its fate is
        // unknown — never report success.
        throw new NativeMediaError("INTERNAL", {
          detail: `engine command '${command.kind}' raced a process failure (${this.crash.detail ?? this.crash.code})`,
          cause: this.crash,
        });
      }
      if (response.kind === "error") {
        throw errorFromEvent(response);
      }
      if (response.kind !== "state-changed") {
        throw new NativeMediaError("INTERNAL", {
          detail: `engine command '${command.kind}' was answered by an unexpected '${response.kind}' event (v1 acknowledges with 'state-changed')`,
        });
      }
      return response;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Adopt a `state-changed` acknowledgment as the new authoritative
   * snapshot for its session and notify listeners.
   */
  private adoptSnapshot(
    ack: Extract<EngineEvent, { kind: "state-changed" }>,
  ): NativeMediaSession {
    const session = sessionFromDto(ack.session);
    this.applySnapshot(session);
    return session;
  }

  /** Store a snapshot as authoritative and notify listeners. */
  private applySnapshot(session: NativeMediaSession): void {
    this.sessions.set(session.id, session);
    this.emit({ session: { ...session } });
  }

  /** Spontaneous-event handling: telemetry, snapshots, crash detection. */
  private onEngineEvent(event: EngineEvent): void {
    // The in-process pipe delivers pre-validated events; a malformed or
    // wrong-version event from a real transport is process-fatal (never
    // trust wire data, never ignore it silently).
    if (!isEngineEvent(event)) {
      this.failAll(
        new NativeMediaError("INTERNAL", {
          detail: "engine process delivered a malformed event (failed wire validation)",
        }),
      );
      return;
    }
    if (this.crash !== undefined || this.disposed) return;
    switch (event.kind) {
      case "progress": {
        const session = this.sessions.get(event.sessionId);
        // Telemetry for unknown sessions is ignored: it either precedes
        // the open acknowledgment or follows a close — the authoritative
        // snapshot arrives through the ack/state-changed channel.
        if (session === undefined) return;
        if (event.positionMs === session.positionMs) return;
        const next = { ...session, positionMs: event.positionMs };
        this.sessions.set(next.id, next);
        this.emit({ session: { ...next } });
        return;
      }
      case "buffered": {
        const session = this.sessions.get(event.sessionId);
        if (session === undefined) return;
        if (event.bufferedMs === session.bufferedMs) return;
        const next = { ...session, bufferedMs: event.bufferedMs };
        this.sessions.set(next.id, next);
        this.emit({ session: { ...next } });
        return;
      }
      case "state-changed": {
        const session = sessionFromDto(event.session);
        // Snapshots for unknown sessions are ignored: they either precede
        // the open acknowledgment or follow a close. The authoritative
        // registration happens on the open acknowledgment path.
        if (!this.sessions.has(session.id)) return;
        this.applySnapshot(session);
        return;
      }
      case "error":
        // v1 semantics: an error event on the spontaneous channel means
        // the PROCESS failed. Every live session fails with a typed
        // INTERNAL error; the handle is terminated.
        this.failAll(
          new NativeMediaError("INTERNAL", {
            detail: `engine process error event (code ${event.code})${event.detail === undefined ? "" : `: ${event.detail}`}`,
            cause: errorFromEvent(event),
          }),
        );
        return;
    }
  }

  /** Mark every live session failed with `failure` and stop the engine. */
  private failAll(failure: NativeMediaError): void {
    if (this.crash !== undefined) return; // already crashed
    this.crash = failure;
    for (const session of this.sessions.values()) {
      if (session.state === "complete" || session.state === "failed") continue;
      const failed = { ...session, state: "failed" as const };
      this.sessions.set(failed.id, failed);
      this.emit({ session: { ...failed }, failure });
    }
    this.handle.terminate();
  }

  private emit(update: EngineAdapterSessionUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}

// ---------------------------------------------------------------------------
// JSON transport helpers
// ---------------------------------------------------------------------------

/**
 * The exact transform a real socket transport applies: serialize to text
 * and parse back. Proves every DTO is JSON-round-trippable.
 */
function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Adapt ANY `NativeEngineProcess` to the frozen `NativeMediaEngine`
 * interface. The process is spawned immediately; config and spawn
 * failures throw typed `NativeMediaError`s. See the module docs for the
 * v1 timeout, crash, and unsupported-behavior semantics.
 */
export function createEngineAdapter(
  process: NativeEngineProcess,
  config: EngineConfig,
  options: EngineAdapterOptions = {},
): EngineAdapter {
  if (typeof process !== "object" || process === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineAdapter: process must be an object",
    });
  }
  if (typeof process.spawn !== "function") {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createEngineAdapter: process is missing the 'spawn' method required by the NativeEngineProcess contract",
    });
  }
  return new EngineAdapterImpl(process, config, options);
}

// ---------------------------------------------------------------------------
// In-process engine process (SIMULATION-backed pipe — TEST/DEV, no subprocess)
// ---------------------------------------------------------------------------

/** Options for {@link createInProcessEngineProcess}. */
export interface InProcessEngineProcessOptions {
  /** Configuration for the backing SIMULATION engine. Default: `{}`. */
  simulation?: SimulationConfig;
}

/** The in-process pipe handle, exposing its backing simulation for tests. */
export interface InProcessEngineHandle extends EngineHandle {
  /** The SIMULATION engine backing this pipe (test/inspection surface). */
  readonly simulation: SimulationEngine;
}

/** The in-process `NativeEngineProcess` (TEST/DEV — never production). */
export interface InProcessEngineProcess extends NativeEngineProcess {
  /**
   * TEST HOOK — simulate the wire form of a subprocess crash: every live
   * handle receives an `error` event. Never call from production code.
   */
  simulateCrash(detail?: string): void;
}

/**
 * Create a `NativeEngineProcess` backed by the SIMULATION engine: an
 * IN-PROCESS PIPE, NO SUBPROCESS, that marshals every command through
 * `JSON.parse(JSON.stringify(...))` and the runtime guards and every
 * response/telemetry event back through the same transform. Combined
 * with `createEngineAdapter` this proves the wire contract round-trips:
 * the pair behaves identically to the simulation engine used directly.
 *
 * TEST/DEV ONLY — the real Rust engine process is a later deliverable.
 */
export function createInProcessEngineProcess(
  options: InProcessEngineProcessOptions = {},
): InProcessEngineProcess {
  if (typeof options !== "object" || options === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "createInProcessEngineProcess: options must be an object",
    });
  }
  const handles = new Set<InProcessHandleImpl>();
  return {
    spawn(config: EngineConfig): EngineHandle {
      validateEngineConfig(config);
      const simulation = createSimulationEngine(options.simulation ?? {});
      const handle = new InProcessHandleImpl(simulation);
      handles.add(handle);
      return handle;
    },
    simulateCrash(detail?: string): void {
      const event: {
        protocolVersion: typeof PROTOCOL_VERSION;
        kind: "error";
        code: NativeMediaErrorCode;
        detail?: string;
      } = { protocolVersion: PROTOCOL_VERSION, kind: "error", code: "INTERNAL" };
      if (detail !== undefined) event.detail = detail;
      const wire = jsonRoundTrip(event) as EngineEvent;
      for (const handle of handles) {
        handle.deliver(wire);
      }
    },
  };
}

/** One live in-process pipe: simulation engine + event fan-out. */
class InProcessHandleImpl implements InProcessEngineHandle {
  readonly simulation: SimulationEngine;
  private readonly handlers = new Set<EngineEventHandler>();
  /** Last snapshot seen per session — the telemetry diff baseline. */
  private readonly lastSeen = new Map<string, NativeMediaSession>();
  private terminated = false;

  constructor(simulation: SimulationEngine) {
    this.simulation = simulation;
    simulation.onUpdate((session) => this.onSimulationUpdate(session));
  }

  async send(command: EngineCommand): Promise<EngineEvent> {
    if (this.terminated) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "send: engine handle is terminated",
      });
    }
    // Inbound wire: JSON transform + runtime guard, exactly what a real
    // transport does before trusting the bytes.
    let wire: unknown;
    try {
      wire = jsonRoundTrip(command);
    } catch (e) {
      throw mapEngineError(e);
    }
    if (!isEngineCommand(wire)) {
      throw new NativeMediaError("INTERNAL", {
        detail: "in-process engine: command failed wire validation",
      });
    }
    try {
      switch (wire.kind) {
        case "open": {
          const input: {
            magnet?: string;
            torrentBytes?: Uint8Array;
            localPath?: string;
          } = {};
          if (wire.source.magnet !== undefined) input.magnet = wire.source.magnet;
          if (wire.source.localPath !== undefined) input.localPath = wire.source.localPath;
          const session = await this.simulation.open(input);
          this.lastSeen.set(session.id, { ...session });
          return this.wireEvent(session);
        }
        case "seek": {
          await this.simulation.seek(wire.sessionId, wire.positionMs);
          return this.ackSnapshot(wire.sessionId);
        }
        case "prioritize": {
          await this.simulation.prioritize(wire.sessionId, wire.deadlines);
          return this.ackSnapshot(wire.sessionId);
        }
        case "pause": {
          await this.simulation.pause(wire.sessionId);
          return this.ackSnapshot(wire.sessionId);
        }
        case "resume": {
          await this.simulation.resume(wire.sessionId);
          return this.ackSnapshot(wire.sessionId);
        }
        case "close": {
          // The final snapshot before the engine forgets the session.
          const ack = this.ackSnapshot(wire.sessionId);
          await this.simulation.close(wire.sessionId);
          this.lastSeen.delete(wire.sessionId);
          return ack;
        }
        default: {
          // Exhaustiveness: the guard already narrowed every v1 kind.
          const exhaustive: never = wire;
          throw new NativeMediaError("INTERNAL", {
            detail: `in-process engine: unhandled command kind '${String((exhaustive as { kind?: string }).kind)}'`,
          });
        }
      }
    } catch (e) {
      // Outbound failure: the error crosses the wire as an `error` event
      // DTO (JSON transform included) and rejects the pending command as
      // a rebuilt typed NativeMediaError.
      const mapped = isNativeMediaError(e) ? e : mapEngineError(e);
      const event = jsonRoundTrip(errorToEvent(mapped));
      if (!isEngineEvent(event)) {
        throw new NativeMediaError("INTERNAL", {
          detail: "in-process engine: error event failed wire validation",
          cause: mapped,
        });
      }
      throw errorFromEvent(event);
    }
  }

  onEvent(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.simulation.dispose();
  }

  /** Deliver a (wire-form) event to every subscriber. TEST HOOK route. */
  deliver(event: EngineEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  /** A `state-changed` acknowledgment carrying the post-command snapshot. */
  private ackSnapshot(sessionId: string): EngineEvent {
    const snapshot = this.simulation.snapshot(sessionId);
    if (snapshot === undefined) {
      throw new NativeMediaError("INTERNAL", {
        detail: `in-process engine: session '${sessionId}' vanished during a command`,
        sessionId,
      });
    }
    return this.wireEvent(snapshot);
  }

  /** Serialize a snapshot to the wire `state-changed` event form. */
  private wireEvent(session: NativeMediaSession): EngineEvent {
    const event: EngineEvent = {
      protocolVersion: PROTOCOL_VERSION,
      kind: "state-changed",
      session: sessionToDto(session),
    };
    const wire = jsonRoundTrip(event);
    if (!isEngineEvent(wire)) {
      throw new NativeMediaError("INTERNAL", {
        detail: "in-process engine: state-changed event failed wire validation",
        sessionId: session.id,
      });
    }
    return wire;
  }

  /**
   * Simulation update → spontaneous telemetry: `state-changed` when the
   * state moved, then `buffered`/`progress` deltas for the fields that
   * changed. The diff baseline is updated at the end.
   */
  private onSimulationUpdate(session: NativeMediaSession): void {
    if (this.terminated) return;
    const previous = this.lastSeen.get(session.id);
    if (previous === undefined) return; // pre-acknowledgment update: the open ack is authoritative
    const events: EngineEvent[] = [];
    if (previous.state !== session.state) {
      events.push(this.wireEvent(session));
    }
    if (previous.bufferedMs !== session.bufferedMs) {
      events.push({
        protocolVersion: PROTOCOL_VERSION,
        kind: "buffered",
        sessionId: session.id,
        bufferedMs: session.bufferedMs,
      });
    }
    if (previous.positionMs !== session.positionMs) {
      events.push({
        protocolVersion: PROTOCOL_VERSION,
        kind: "progress",
        sessionId: session.id,
        positionMs: session.positionMs,
      });
    }
    this.lastSeen.set(session.id, { ...session });
    for (const event of events) {
      const wire = jsonRoundTrip(event);
      if (!isEngineEvent(wire)) continue; // unreachable: telemetry DTOs are plain
      this.deliver(wire);
    }
  }
}
