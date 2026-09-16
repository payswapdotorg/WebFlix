/**
 * @wfx/app-desktop — the native-media service binding, THE R10 SEAM (R08).
 *
 * A REAL `NativeMediaPort` implementation over the frozen
 * `@wfx/native-media` engine process boundary (`engine/process.ts`):
 * the binding SPAWNS/ATTACHES the engine process (through the injected
 * `NativeEngineProcess` — the shell-backed production implementation or a
 * test double), speaks the v1 DTO protocol (`EngineCommand` in,
 * `EngineEvent` out, `PROTOCOL_VERSION` stamped, runtime guards on every
 * wire value), and maps sessions and observations onto the port's frozen
 * vocabulary — HONESTLY:
 *
 * - INTEGRITY COMES FROM THE ENGINE'S REPORTS, NEVER FABRICATED:
 *   - the v1 `EngineSessionDto` carries no integrity field; the ONLY
 *     engine-sourced verdicts a binding can derive are (a) a session the
 *     engine reports `complete` — the frozen law says `complete` REQUIRES
 *     verified integrity, so the engine's complete report IS its verified
 *     verdict — mapped to `integrity: "verified"`; and (b) an engine
 *     failure with code `VERIFICATION_FAILED`, mapped to
 *     `integrity: "failed"` on the affected session. EVERYTHING ELSE
 *     answers `"unknown"` — no verdict is invented. (ESCALATION: recommend
 *     the lead extend the v1 DTO with an explicit integrity field when R10
 *     productionizes the service; see the adapter README.)
 * - NO FAKE PROGRESS: `bufferedMs`/`positionMs` in snapshots and events
 *   are the engine's own numbers, verbatim from its DTOs; `occurredAtMs`
 *   is the binding's clock stamp of when the engine's report ARRIVED
 *   (the v1 DTOs carry no timestamps — the documented, honest
 *   approximation of the service clock).
 * - THE CRASH LAW (the v1 protocol's rule 3): an `error` event arriving
 *   through the spontaneous channel — or any MALFORMED event — means the
 *   PROCESS failed: every live session is failed (observation event with
 *   the honest detail), the handle is terminated, and every subsequent
 *   operation rejects with the typed `unavailable` failure. No fake
 *   success ever crosses the seam.
 * - TYPED FAILURES: engine `NativeMediaError` codes map onto the port's
 *   closed vocabulary (see {@link portErrorFromEngineError}); every port
 *   method rejects with a `NativeMediaPortError`.
 *
 * PRODUCTION LAW: this binding NEVER references `stubEngine()` or any
 * fixture — the engine process is injected (`NativeEngineProcess`), the
 * production implementation being the shell-backed spawn/attach wiring of
 * `shell-engine-process.ts`. The stub remains testing-only inside
 * `@wfx/native-media`'s fixtures module.
 *
 * SEAMS R10/R12 PLUG INTO (documented, injectable, honest-by-default):
 * - `rangeAccess` — the byte-range read channel. The v1 wire protocol has
 *   NO read command (the documented WFX-014 gap), so without a channel
 *   `readRange` rejects with the typed `unavailable` failure naming the
 *   R10 extension — NEVER fabricated bytes. R10's productionized service
 *   binds the real range gateway here.
 * - `deadlineMapper` — the byte-range → piece-deadline translator. The
 *   port's `MediaDeadline` is byte-offset based; the engine's v1
 *   `prioritize` command is PIECE based. Mapping bytes to pieces requires
 *   the piece map (R12's playback-aware scheduler lane), so without a
 *   mapper `prioritize` rejects with the typed `unavailable` failure
 *   naming the R12 seam — NEVER a fabricated piece index.
 */

import {
  NativeMediaPortError,
  type MediaDeadline,
  type NativeMediaErrorCode,
  type NativeMediaIntegrity,
  type NativeMediaOpenInput,
  type NativeMediaPort,
  type NativeMediaSessionEvent,
  type NativeMediaSessionSnapshot,
  type Unsubscribe,
} from "@wfx/platform-contracts";
import {
  isEngineCommand,
  isEngineEvent,
  NativeMediaError,
  sessionFromDto,
  type EngineCommand,
  type EngineConfig,
  type EngineEvent,
  type EnginePieceDeadline,
  type EngineSessionDto,
  type NativeEngineProcess,
  type EngineHandle,
} from "@wfx/native-media";

import type { RuntimeClock } from "@wfx/client-runtime";

// ---------------------------------------------------------------------------
// Options + the binding surface
// ---------------------------------------------------------------------------

/**
 * The byte-range read channel R10 plugs in: serves the byte range
 * `[offset, offset + length - 1]` of a session's playable file, or
 * rejects (typed) when the range cannot be served VERIFIED.
 */
export type EngineRangeChannel = (
  sessionId: string,
  request: { readonly offset: number; readonly length: number },
) => Promise<Uint8Array>;

/**
 * The byte→piece deadline translator R12 plugs in: maps the port's
 * byte-range deadlines onto the engine's piece deadlines, or answers a
 * typed `NativeMediaPortError` when the mapping cannot be made honestly.
 */
export type DeadlineMapper = (
  deadlines: readonly MediaDeadline[],
) => readonly EnginePieceDeadline[] | NativeMediaPortError;

/** Options for {@link createNativeMediaBinding}. */
export interface NativeMediaBindingOptions {
  /** The engine process boundary to spawn/attach through. */
  readonly process: NativeEngineProcess;
  /** The spawn configuration (cache dir + budget, binary/socket paths). */
  readonly config: EngineConfig;
  /** The binding's clock (event arrival stamps; never a hidden wall clock). */
  readonly clock: RuntimeClock;
  /**
   * Deadline for a single engine command, in milliseconds (default
   * 30 000; `0` disables). A silent engine rejects with the typed
   * `deadline-missed` failure — the session is NOT failed (the deadline
   * may have raced a late success; the engine-adapter precedent).
   */
  readonly callTimeoutMs?: number;
  /** The R10 range channel (see module doc). Optional; honest default. */
  readonly rangeAccess?: EngineRangeChannel;
  /** The R12 deadline mapper (see module doc). Optional; honest default. */
  readonly deadlineMapper?: DeadlineMapper;
}

/** The binding: the frozen port plus disposal of the engine process. */
export interface NativeMediaBinding extends NativeMediaPort {
  /** Terminate the engine process binding (idempotent). */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Error mapping (engine taxonomy -> port taxonomy; closed on both sides)
// ---------------------------------------------------------------------------

/**
 * Map a typed `NativeMediaError` onto the port's closed vocabulary:
 * `INVALID_INPUT`/`UNSUPPORTED_SOURCE`/`RANGE_NOT_SATISFIABLE` →
 * `invalid-input`; `NOT_FOUND`/`SESSION_CLOSED` → `unknown-session`;
 * `VERIFICATION_FAILED` → `corrupt`; `ENGINE_TIMEOUT` → `deadline-missed`;
 * `IO_ERROR`/`INTERNAL` → `unavailable`.
 */
export function portErrorFromEngineError(error: NativeMediaError): NativeMediaPortError {
  switch (error.code) {
    case "INVALID_INPUT":
    case "UNSUPPORTED_SOURCE":
      return new NativeMediaPortError("invalid-input", error.message);
    case "NOT_FOUND":
    case "SESSION_CLOSED":
      return new NativeMediaPortError("unknown-session", error.message);
    case "VERIFICATION_FAILED":
      return new NativeMediaPortError("corrupt", error.message);
    case "ENGINE_TIMEOUT":
      return new NativeMediaPortError("deadline-missed", error.message);
    case "RANGE_NOT_SATISFIABLE":
      return new NativeMediaPortError("invalid-input", error.message);
    case "IO_ERROR":
    case "INTERNAL":
      return new NativeMediaPortError("unavailable", error.message);
  }
}

/** Map an arbitrary rejection onto the port's typed error (never bare). */
function portError(
  code: NativeMediaErrorCode,
  thrown: unknown,
  fallback: string,
): NativeMediaPortError {
  if (thrown instanceof NativeMediaPortError) return thrown;
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return new NativeMediaPortError(code, `${fallback}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Integrity law (engine-sourced verdicts ONLY)
// ---------------------------------------------------------------------------

/**
 * The integrity verdict derivable from the engine's report of one session
 * state: `complete` ⇒ `"verified"` (the frozen law — `complete` requires
 * verified integrity, so the engine's complete report IS its verified
 * verdict); every other state ⇒ `"unknown"` (no verdict claimed).
 */
export function integrityForState(state: NativeMediaSessionSnapshot["state"]): NativeMediaIntegrity {
  return state === "complete" ? "verified" : "unknown";
}

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/**
 * Build the Desktop `NativeMediaPort` over a spawned/attached engine
 * process. Throws the typed `NativeMediaPortError` (`unavailable`) when
 * the engine cannot be spawned — never boots a silent-failure binding.
 */
export function createNativeMediaBinding(options: NativeMediaBindingOptions): NativeMediaBinding {
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  if (!Number.isFinite(callTimeoutMs) || callTimeoutMs < 0) {
    throw new NativeMediaPortError(
      "invalid-input",
      `callTimeoutMs must be a finite number >= 0, got ${String(callTimeoutMs)}`,
    );
  }

  let handle: EngineHandle;
  try {
    handle = options.process.spawn(options.config);
  } catch (thrown) {
    throw portError("unavailable", thrown, "the engine process could not be spawned");
  }

  const sessions = new Map<string, NativeMediaSessionSnapshot>();
  const closedIds = new Set<string>();
  const listeners = new Set<(event: NativeMediaSessionEvent) => void>();
  let crashed = false;
  let crashDetail = "";
  let disposed = false;
  let eventUnsub: (() => void) | null = null;

  // -----------------------------------------------------------------------
  // Event ingestion (the spontaneous telemetry channel)
  // -----------------------------------------------------------------------

  eventUnsub = handle.onEvent((rawEvent: EngineEvent) => {
    // Wire data is never trusted: a malformed event is process-fatal (the
    // v1 protocol's rule 3 + the engine-adapter precedent).
    if (!isEngineEvent(rawEvent)) {
      crash("the engine emitted a malformed event (failed the runtime guard)");
      return;
    }
    if (rawEvent.kind === "error") {
      // An error on the spontaneous channel = the PROCESS failed (v1 law).
      crash(
        `the engine process failed (${rawEvent.code}${rawEvent.detail !== undefined ? `: ${rawEvent.detail}` : ""})`,
      );
      return;
    }
    ingest(rawEvent);
  });

  function now(): number {
    return options.clock.now();
  }

  /** Publish one tracked snapshot + observation to every listener. */
  function publish(snapshot: NativeMediaSessionSnapshot, detail?: string): void {
    sessions.set(snapshot.id, snapshot);
    const event: NativeMediaSessionEvent = {
      sessionId: snapshot.id,
      state: snapshot.state,
      bufferedMs: snapshot.bufferedMs,
      positionMs: snapshot.positionMs,
      integrity: snapshot.integrity,
      occurredAtMs: now(),
      ...(detail !== undefined ? { detail } : {}),
    };
    for (const listener of listeners) listener(event);
  }

  /** Ingest one well-formed spontaneous event (telemetry / state). */
  function ingest(event: EngineEvent): void {
    switch (event.kind) {
      case "progress": {
        const tracked = sessions.get(event.sessionId);
        if (tracked === undefined) return; // unknown session: not ours to invent
        publish({ ...tracked, positionMs: event.positionMs });
        return;
      }
      case "buffered": {
        const tracked = sessions.get(event.sessionId);
        if (tracked === undefined) return;
        publish({ ...tracked, bufferedMs: event.bufferedMs });
        return;
      }
      case "state-changed": {
        // The authoritative snapshot: adopt the engine's numbers verbatim,
        // with the engine-sourced integrity verdict.
        publish(snapshotFromDto(event.session));
        return;
      }
      case "error": {
        // Unreachable (handled above); kept total for the union.
        return;
      }
    }
  }

  /** The process-fatal crash law: fail every live session, terminate. */
  function crash(detail: string): void {
    if (crashed) return;
    crashed = true;
    crashDetail = detail;
    // Every live session fails with the honest detail (integrity keeps its
    // last engine-sourced verdict — a crash does not fabricate one).
    for (const snapshot of [...sessions.values()]) {
      publish({ ...snapshot, state: "failed" }, detail);
    }
    sessions.clear();
    if (eventUnsub !== null) {
      eventUnsub();
      eventUnsub = null;
    }
    try {
      handle.terminate();
    } catch {
      // Best-effort teardown of a dead process.
    }
  }

  /** Map a wire session DTO onto the port's snapshot (integrity law). */
  function snapshotFromDto(dto: EngineSessionDto): NativeMediaSessionSnapshot {
    const session = sessionFromDto(dto);
    return {
      id: session.id,
      assetId: session.assetId,
      fileId: session.fileId,
      state: session.state,
      bufferedMs: session.bufferedMs,
      positionMs: session.positionMs,
      integrity: integrityForState(session.state),
    };
  }

  function requireEngine(): void {
    if (crashed) {
      throw new NativeMediaPortError(
        "unavailable",
        `the native media engine process is not running: ${crashDetail}`,
      );
    }
  }

  /**
   * Send one command with the wire deadline enforced. Rejects typed:
   * engine rejections map onto the port vocabulary; a silent engine
   * rejects with `deadline-missed`; a non-`state-changed` answer rejects
   * with `unavailable` (protocol violation — the v1 ack IS state-changed).
   */
  async function sendCommand(
    command: EngineCommand,
  ): Promise<Extract<EngineEvent, { kind: "state-changed" }>> {
    if (crashed) {
      throw new NativeMediaPortError(
        "unavailable",
        `the native media engine process is not running: ${crashDetail}`,
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<null>((resolve) => {
      if (callTimeoutMs > 0) {
        timer = setTimeout(() => resolve(null), callTimeoutMs);
      }
    });
    try {
      const answer = await Promise.race([handle.send(command), timed]);
      if (answer === null) {
        throw new NativeMediaPortError(
          "deadline-missed",
          `the engine did not answer within ${callTimeoutMs}ms (command '${command.kind}')`,
        );
      }
      if (!isEngineEvent(answer)) {
        // The engine answered garbage: process-fatal (wire data untrusted).
        crash(`the engine answered a malformed event for command '${command.kind}'`);
        throw new NativeMediaPortError("unavailable", "the engine answered a malformed event");
      }
      if (answer.kind !== "state-changed") {
        // A well-formed but wrong-shaped answer is an engine bug: typed
        // rejection, no crash (the process may still be healthy).
        throw new NativeMediaPortError(
          "unavailable",
          `the engine answered '${answer.kind}' where the v1 protocol requires a state-changed acknowledgment (command '${command.kind}')`,
        );
      }
      return answer;
    } catch (thrown) {
      if (thrown instanceof NativeMediaPortError) throw thrown;
      if (thrown instanceof NativeMediaError) {
        // The integrity law's second engine-sourced verdict: a
        // VERIFICATION_FAILED rejection names a corrupt backing asset —
        // the tracked session's integrity becomes "failed" (the ENGINE
        // still owns the session state; the binding only mirrors the
        // verdict it was given, never inventing one).
        if (
          thrown.code === "VERIFICATION_FAILED" &&
          thrown.sessionId !== undefined &&
          sessions.has(thrown.sessionId)
        ) {
          const tracked = sessions.get(thrown.sessionId)!;
          publish({ ...tracked, integrity: "failed" }, thrown.message);
        }
        throw portErrorFromEngineError(thrown);
      }
      throw portError("unavailable", thrown, `engine command '${command.kind}' failed`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Adopt an ack's authoritative snapshot (verbatim + integrity law). */
  function adoptAck(
    ack: Extract<EngineEvent, { kind: "state-changed" }>,
  ): NativeMediaSessionSnapshot {
    const snapshot = snapshotFromDto(ack.session);
    publish(snapshot);
    return snapshot;
  }

  return {
    async open(input: NativeMediaOpenInput): Promise<NativeMediaSessionSnapshot> {
      requireEngine();
      // Input honesty: exactly one transportable source; `torrentBytes`
      // cannot cross the v1 JSON wire (the documented WFX-014 law); an
      // empty string is not a source.
      const magnet = input?.magnet;
      const localPath = input?.localPath;
      if ((magnet === undefined || magnet.length === 0) && (localPath === undefined || localPath.length === 0)) {
        if (input?.torrentBytes !== undefined) {
          throw new NativeMediaPortError(
            "invalid-input",
            "torrentBytes cannot cross the v1 engine wire protocol (JSON DTOs); R10's service extension owns binary ingestion",
          );
        }
        throw new NativeMediaPortError(
          "invalid-input",
          "open requires exactly one source: magnet or localPath",
        );
      }
      if (magnet !== undefined && magnet.length > 0 && localPath !== undefined && localPath.length > 0) {
        throw new NativeMediaPortError(
          "invalid-input",
          "open requires exactly one source (got both magnet and localPath)",
        );
      }
      const command: EngineCommand =
        magnet !== undefined && magnet.length > 0
          ? { protocolVersion: 1, kind: "open", source: { magnet } }
          : { protocolVersion: 1, kind: "open", source: { localPath: localPath! } };
      if (!isEngineCommand(command)) {
        throw new NativeMediaPortError("invalid-input", "the open command failed the wire guard");
      }
      const ack = await sendCommand(command);
      const snapshot = adoptAck(ack);
      closedIds.delete(snapshot.id);
      return { ...snapshot };
    },

    async close(sessionId: string): Promise<void> {
      // Idempotent for the service: closing an already-closed session is
      // a no-op (the engine forgot it; NOT_FOUND would be protocol noise).
      if (closedIds.has(sessionId)) return;
      requireEngine();
      const ack = await sendCommand({ protocolVersion: 1, kind: "close", sessionId });
      // The final snapshot before the engine forgets the session.
      adoptAck(ack);
      sessions.delete(sessionId);
      closedIds.add(sessionId);
    },

    async pause(sessionId: string): Promise<void> {
      requireEngine();
      await sendCommand({ protocolVersion: 1, kind: "pause", sessionId });
    },

    async resume(sessionId: string): Promise<void> {
      requireEngine();
      await sendCommand({ protocolVersion: 1, kind: "resume", sessionId });
    },

    async seek(sessionId: string, positionMs: number): Promise<void> {
      if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
        throw new NativeMediaPortError(
          "invalid-input",
          `seek.positionMs must be a finite non-negative number, got ${String(positionMs)}`,
        );
      }
      requireEngine();
      await sendCommand({ protocolVersion: 1, kind: "seek", sessionId, positionMs });
    },

    async prioritize(sessionId: string, deadlines: readonly MediaDeadline[]): Promise<void> {
      requireEngine();
      if (!Array.isArray(deadlines)) {
        throw new NativeMediaPortError("invalid-input", "prioritize.deadlines must be an array");
      }
      const mapper = options.deadlineMapper;
      if (mapper === undefined) {
        // The honest default: the byte→piece mapping is R12's scheduler
        // seam. No piece index is ever fabricated from byte offsets.
        throw new NativeMediaPortError(
          "unavailable",
          "the byte-range → piece-deadline mapper is not bound (R12's playback-aware scheduler seam); bind deadlineMapper to translate MediaDeadlines onto the engine's piece deadlines",
        );
      }
      const mapped = mapper(deadlines);
      if (mapped instanceof NativeMediaPortError) throw mapped;
      const command: EngineCommand = {
        protocolVersion: 1,
        kind: "prioritize",
        sessionId,
        deadlines: [...mapped],
      };
      if (!isEngineCommand(command)) {
        throw new NativeMediaPortError("invalid-input", "the prioritize command failed the wire guard");
      }
      await sendCommand(command);
    },

    async readRange(
      sessionId: string,
      request: { readonly offset: number; readonly length: number },
    ): Promise<Uint8Array> {
      requireEngine();
      if (
        typeof request?.offset !== "number" ||
        !Number.isFinite(request.offset) ||
        request.offset < 0 ||
        typeof request?.length !== "number" ||
        !Number.isFinite(request.length) ||
        request.length < 1
      ) {
        throw new NativeMediaPortError(
          "invalid-input",
          `readRange expects { offset >= 0, length >= 1 }, got ${String(request?.offset)}/${String(request?.length)}`,
        );
      }
      const channel = options.rangeAccess;
      if (channel === undefined) {
        // The honest default: the v1 wire protocol has NO read command.
        // NEVER fabricated bytes — the typed failure names the R10 seam.
        throw new NativeMediaPortError(
          "unavailable",
          "the engine range channel is not bound (the v1 engine wire protocol carries no byte-range command); R10's productionized service binds the real range gateway here",
        );
      }
      try {
        return await channel(sessionId, { offset: request.offset, length: request.length });
      } catch (thrown) {
        if (thrown instanceof NativeMediaPortError) throw thrown;
        if (thrown instanceof NativeMediaError) throw portErrorFromEngineError(thrown);
        throw portError("unavailable", thrown, "the engine range channel failed");
      }
    },

    async inspect(sessionId: string): Promise<NativeMediaSessionSnapshot> {
      // The tracked view is the binding's honest mirror of the engine's
      // own reports (authoritative state-changed snapshots + telemetry
      // patches). No command is minted to ask the engine again — the v1
      // protocol has no inspect command, and the cached engine-sourced
      // numbers are the truthful answer.
      requireEngine();
      const tracked = sessions.get(sessionId);
      if (tracked === undefined) {
        throw new NativeMediaPortError(
          "unknown-session",
          `no session '${sessionId}' is tracked by this binding`,
        );
      }
      return { ...tracked };
    },

    subscribe(listener: (event: NativeMediaSessionEvent) => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (eventUnsub !== null) {
        eventUnsub();
        eventUnsub = null;
      }
      try {
        handle.terminate();
      } catch {
        // Best-effort teardown.
      }
    },
  };
}
