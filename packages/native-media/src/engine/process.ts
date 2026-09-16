/**
 * @wfx/native-media — engine process boundary (WFX-014, Lane B).
 *
 * THE WIRE CONTRACT a real native engine (a Rust subprocess, a later
 * deliverable) will speak. This module defines only DATA and the process
 * seam — no spawning, no sockets, no I/O:
 *
 * - `NativeEngineProcess` — the boundary interface: `spawn(config)` yields
 *   an `EngineHandle` with `send(command)`, `onEvent(handler)`,
 *   `terminate()`.
 * - `EngineCommand` / `EngineEvent` — JSON-serializable DTOs. EVERY value
 *   that crosses the process boundary is one of these DTOs, stamped with
 *   `protocolVersion`. Binary payloads (`torrentBytes`) are deliberately
 *   NOT transportable in v1 — engines typed `UNSUPPORTED_SOURCE` (see
 *   adapter.ts).
 * - Runtime guards (`isEngineCommand`, `isEngineEvent`,
 *   `isEngineSessionDto`) and mapping helpers (`sessionToDto`,
 *   `sessionFromDto`, `validateEngineConfig`) shared by every
 *   implementation of the boundary.
 *
 * PROTOCOL SEMANTICS (v1), documented for the Rust implementer:
 *
 * 1. REQUEST/RESPONSE. `send(command)` resolves with the event answering
 *    the command or REJECTS with a `NativeMediaError`. In v1 every
 *    successfully applied command is answered with a `state-changed` event
 *    carrying the post-command authoritative session snapshot (for
 *    `close`, the final snapshot before the engine forgets the session).
 *    `state-changed` therefore doubles as the command acknowledgment.
 * 2. SPONTANEOUS TELEMETRY. `onEvent` handlers receive progress/buffered
 *    updates and state changes the engine emits on its own (download
 *    ticks, playback clock). Command responses are NEVER re-delivered
 *    through `onEvent`.
 * 3. FAILURES. A command that cannot be applied crosses the wire as an
 *    `error` event DTO and surfaces from `send()` as a rejection with the
 *    corresponding typed `NativeMediaError` (code, detail, sessionId and
 *    the table-derived `retryable` flag all survive the round trip). An
 *    `error` event arriving through `onEvent` means the PROCESS has
 *    failed (crash/exit): v1 treats it as fatal for every live session.
 * 4. VERSIONING. `PROTOCOL_VERSION` is stamped on every DTO. Wire data
 *    with a different version (or any malformed shape) fails the runtime
 *    guards and is rejected with a typed `INTERNAL` error — never parsed
 *    optimistically.
 *
 * This module contains no simulation and no subprocess: it is the frozen
 * seam BOTH sides compile against.
 */

import type { NativeMediaSession } from "@wfx/domain";

import {
  isNativeMediaErrorCode,
  NativeMediaError,
  type NativeMediaErrorCode,
} from "../errors";
import { isSessionState } from "../session";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

/** Wire protocol version. Bump ONLY on a breaking DTO/semantic change. */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration for spawning an engine process.
 *
 * - `socketPath` / `binaryPath` — how to reach/start the real engine. The
 *   in-process implementation (adapter.ts) validates but ignores them.
 * - `cacheDir` — where the engine owns its bytes (never touched here).
 * - `maxCacheBytes` — the cache budget the engine enforces (see cache.ts
 *   for the pure policy; the real engine owns the actual bytes).
 */
export interface EngineConfig {
  socketPath?: string;
  binaryPath?: string;
  cacheDir: string;
  maxCacheBytes: number;
}

/**
 * Validate an {@link EngineConfig}. Throws a typed `INVALID_INPUT`
 * `NativeMediaError` on any malformed field — shared by every
 * `NativeEngineProcess` implementation so config errors are uniform.
 */
export function validateEngineConfig(config: unknown): asserts config is EngineConfig {
  if (typeof config !== "object" || config === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "EngineConfig must be an object",
    });
  }
  const c = config as Record<string, unknown>;
  for (const optional of ["socketPath", "binaryPath"] as const) {
    const value = c[optional];
    if (value !== undefined) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new NativeMediaError("INVALID_INPUT", {
          detail: `EngineConfig.${optional} must be a non-empty string when present`,
        });
      }
    }
  }
  if (typeof c.cacheDir !== "string" || c.cacheDir.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "EngineConfig.cacheDir must be a non-empty string",
    });
  }
  if (
    typeof c.maxCacheBytes !== "number" ||
    !Number.isSafeInteger(c.maxCacheBytes) ||
    c.maxCacheBytes < 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "EngineConfig.maxCacheBytes must be a non-negative safe integer",
    });
  }
}

// ---------------------------------------------------------------------------
// DTOs — commands
// ---------------------------------------------------------------------------

/** A piece deadline on the wire: piece index + playback deadline. */
export interface EnginePieceDeadline {
  piece: number;
  deadlineMs: number;
}

/**
 * The open source as transportable in v1: magnet URI or local path.
 * `torrentBytes` cannot cross a JSON wire and has no v1 form.
 */
export interface EngineOpenSource {
  magnet?: string;
  localPath?: string;
}

/** A command DTO. Exactly the six frozen `NativeMediaEngine` operations. */
export type EngineCommand =
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "open";
      source: EngineOpenSource;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "seek";
      sessionId: string;
      positionMs: number;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "prioritize";
      sessionId: string;
      deadlines: EnginePieceDeadline[];
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "pause";
      sessionId: string;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "resume";
      sessionId: string;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "close";
      sessionId: string;
    };

// ---------------------------------------------------------------------------
// DTOs — events
// ---------------------------------------------------------------------------

/** A session snapshot on the wire (field-for-field the frozen session). */
export interface EngineSessionDto {
  id: string;
  assetId: string;
  fileId: string;
  state:
    | "resolving"
    | "buffering"
    | "playing"
    | "background"
    | "complete"
    | "failed";
  bufferedMs: number;
  positionMs: number;
}

/**
 * An event DTO. `progress`/`buffered` are spontaneous telemetry deltas;
 * `state-changed` carries an authoritative full snapshot (and is the v1
 * command acknowledgment — see module docs); `error` is the failure form.
 */
export type EngineEvent =
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "progress";
      sessionId: string;
      positionMs: number;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "buffered";
      sessionId: string;
      bufferedMs: number;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "state-changed";
      session: EngineSessionDto;
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      kind: "error";
      code: NativeMediaErrorCode;
      detail?: string;
      sessionId?: string;
    };

// ---------------------------------------------------------------------------
// Runtime guards (never trust wire data)
// ---------------------------------------------------------------------------

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isNonNegativeFinite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

function isNonNegativeSafeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

/** Runtime guard for {@link EngineSessionDto}. */
export function isEngineSessionDto(x: unknown): x is EngineSessionDto {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  return (
    isNonEmptyString(d.id) &&
    isNonEmptyString(d.assetId) &&
    isNonEmptyString(d.fileId) &&
    isSessionState(d.state) &&
    isNonNegativeFinite(d.bufferedMs) &&
    isNonNegativeFinite(d.positionMs)
  );
}

/** Runtime guard for {@link EngineCommand} (checks `protocolVersion`). */
export function isEngineCommand(x: unknown): x is EngineCommand {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  if (c.protocolVersion !== PROTOCOL_VERSION) return false;
  switch (c.kind) {
    case "open": {
      const source = c.source;
      if (typeof source !== "object" || source === null) return false;
      const s = source as Record<string, unknown>;
      if (s.magnet !== undefined && typeof s.magnet !== "string") return false;
      if (s.localPath !== undefined && typeof s.localPath !== "string") {
        return false;
      }
      return s.magnet !== undefined || s.localPath !== undefined;
    }
    case "seek":
      return isNonEmptyString(c.sessionId) && isNonNegativeFinite(c.positionMs);
    case "prioritize": {
      if (!isNonEmptyString(c.sessionId)) return false;
      if (!Array.isArray(c.deadlines)) return false;
      return c.deadlines.every((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) return false;
        const d = entry as Record<string, unknown>;
        return (
          isNonNegativeSafeInteger(d.piece) && isNonNegativeFinite(d.deadlineMs)
        );
      });
    }
    case "pause":
    case "resume":
    case "close":
      return isNonEmptyString(c.sessionId);
    default:
      return false;
  }
}

/** Runtime guard for {@link EngineEvent} (checks `protocolVersion`). */
export function isEngineEvent(x: unknown): x is EngineEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  if (e.protocolVersion !== PROTOCOL_VERSION) return false;
  switch (e.kind) {
    case "progress":
      return isNonEmptyString(e.sessionId) && isNonNegativeFinite(e.positionMs);
    case "buffered":
      return isNonEmptyString(e.sessionId) && isNonNegativeFinite(e.bufferedMs);
    case "state-changed":
      return isEngineSessionDto(e.session);
    case "error":
      if (!isNativeMediaErrorCode(e.code)) return false;
      if (e.detail !== undefined && typeof e.detail !== "string") return false;
      if (e.sessionId !== undefined && typeof e.sessionId !== "string") {
        return false;
      }
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// DTO <-> domain mapping
// ---------------------------------------------------------------------------

/**
 * Map a {@link NativeMediaSession} to its wire DTO. Throws a typed
 * `INTERNAL` error if the session is malformed (never fabricates a DTO).
 */
export function sessionToDto(session: NativeMediaSession): EngineSessionDto {
  if (typeof session !== "object" || session === null) {
    throw new NativeMediaError("INTERNAL", {
      detail: "sessionToDto: session must be an object",
    });
  }
  const s = session as unknown as Record<string, unknown>;
  if (
    !isNonEmptyString(s.id) ||
    !isNonEmptyString(s.assetId) ||
    !isNonEmptyString(s.fileId) ||
    !isSessionState(s.state) ||
    !isNonNegativeFinite(s.bufferedMs) ||
    !isNonNegativeFinite(s.positionMs)
  ) {
    throw new NativeMediaError("INTERNAL", {
      detail: "sessionToDto: malformed session (missing or invalid frozen fields)",
    });
  }
  return {
    id: s.id,
    assetId: s.assetId,
    fileId: s.fileId,
    state: s.state,
    bufferedMs: s.bufferedMs,
    positionMs: s.positionMs,
  };
}

/**
 * Map a wire DTO back to a {@link NativeMediaSession}. Throws a typed
 * `INTERNAL` error on any malformed shape — wire data is never trusted
 * and never default-filled.
 */
export function sessionFromDto(dto: unknown): NativeMediaSession {
  if (!isEngineSessionDto(dto)) {
    throw new NativeMediaError("INTERNAL", {
      detail: "sessionFromDto: malformed EngineSessionDto on the wire",
    });
  }
  return {
    id: dto.id,
    assetId: dto.assetId,
    fileId: dto.fileId,
    state: dto.state,
    bufferedMs: dto.bufferedMs,
    positionMs: dto.positionMs,
    integrity: "unknown",
  };
}

// ---------------------------------------------------------------------------
// Error event <-> NativeMediaError
// ---------------------------------------------------------------------------

/**
 * Render a typed {@link NativeMediaError} as its wire `error` event DTO.
 * Non-`NativeMediaError` failures are first mapped through WFX-004's
 * `mapEngineError` by callers that own the mapping (see adapter.ts).
 */
export function errorToEvent(
  error: NativeMediaError,
): Extract<EngineEvent, { kind: "error" }> {
  const event: {
    protocolVersion: typeof PROTOCOL_VERSION;
    kind: "error";
    code: NativeMediaErrorCode;
    detail?: string;
    sessionId?: string;
  } = { protocolVersion: PROTOCOL_VERSION, kind: "error", code: error.code };
  if (error.detail !== undefined) event.detail = error.detail;
  if (error.sessionId !== undefined) event.sessionId = error.sessionId;
  return event;
}

/**
 * Rebuild a typed {@link NativeMediaError} from a wire `error` event DTO.
 * The `retryable` flag is re-derived from the WFX-004 code table, so it
 * can never drift across the wire.
 */
export function errorFromEvent(
  event: Extract<EngineEvent, { kind: "error" }>,
): NativeMediaError {
  const options: { detail?: string; sessionId?: string } = {};
  if (event.detail !== undefined) options.detail = event.detail;
  if (event.sessionId !== undefined) options.sessionId = event.sessionId;
  return new NativeMediaError(event.code, options);
}

// ---------------------------------------------------------------------------
// The process boundary
// ---------------------------------------------------------------------------

/** Handler for spontaneous engine events (see module docs, rule 2). */
export type EngineEventHandler = (event: EngineEvent) => void;

/**
 * A live connection to one spawned engine. `send` is the synchronous
 * request/response channel; `onEvent` the spontaneous telemetry channel;
 * `terminate` is best-effort synchronous teardown (graceful drain is a
 * future protocol concern — v2 candidate command). After `terminate`,
 * `send` rejects with a typed `INVALID_INPUT` error.
 */
export interface EngineHandle {
  send(command: EngineCommand): Promise<EngineEvent>;
  onEvent(handler: EngineEventHandler): () => void;
  terminate(): void;
}

/**
 * The process boundary a real engine (Rust subprocess over a Unix socket,
 * later) implements. `spawn` validates the config (typed
 * `INVALID_INPUT` on malformed values) and yields a live handle.
 */
export interface NativeEngineProcess {
  spawn(config: EngineConfig): EngineHandle;
}
