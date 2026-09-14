/**
 * @wfx/native-media — engine process boundary / wire contract (WFX-014, Lane B).
 *
 * THE WIRE CONTRACT a real native engine subprocess (Rust, a later deliverable)
 * will speak. This module defines, purely and without I/O:
 *
 * - `PROTOCOL_VERSION` — the version of the command/event wire protocol. Every
 *   {@link EngineCommand} and {@link EngineEvent} carries it and every parse
 *   rejects a mismatch, so a protocol skew between adapter and engine is
 *   detected, never silently misinterpreted.
 * - `EngineConfig` — how to locate/configure the engine process (socket or
 *   binary path, cache directory, cache byte budget).
 * - `EngineCommand` / `EngineEvent` — JSON-serializable DTOs covering the
 *   frozen `NativeMediaEngine` surface (open/seek/prioritize/pause/resume/
 *   close) plus the asynchronous event vocabulary (progress/buffered/
 *   state-changed/error) and process lifecycle (exit).
 * - `serializeCommand` / `parseCommand` / `serializeEvent` / `parseEvent` —
 *   the exact JSON encoding of the wire. A real Rust engine that emits and
 *   consumes these byte-for-byte is wire-compatible with this adapter.
 * - `NativeEngineProcess` / `EngineHandle` — the transport-neutral process
 *   boundary: `spawn(config)` returns a handle with `send` (request/response),
 *   `onEvent` (unsolicited events), and `terminate`.
 *
 * Design decisions (documented for lead review):
 *
 * 1. SOLICITED vs UNSOLICITED events. `send(command)` resolves with THE event
 *    answering that command (`opened` for open, `acked` for the void-returning
 *    control commands, `error` for a failed command — correlated by
 *    `requestId`). `onEvent` carries only UNSOLICITED events: `progress`,
 *    `buffered`, `state-changed`, session-scoped `error`, and `exit`. A
 *    response is never duplicated onto `onEvent`.
 * 2. SNAPSHOTS ON EVERY SESSION EVENT. Every session-bearing event carries a
 *    full `EngineSessionSnapshot` (the JSON form of `NativeMediaSession`), so
 *    the adapter can maintain last-known state without polling and without
 *    trusting partial updates.
 * 3. TORRENT BYTES AND RANGE DATA TRAVEL AS BASE64. `Uint8Array` is not JSON;
 *    the wire form of `open`'s `torrentBytes` input is `torrentBase64` and the
 *    wire form of a range read is `dataBase64` (see {@link encodeBase64} /
 *    {@link decodeBase64}). `magnet` and `localPath` are plain strings.
 * 4. ERROR CODES ARE THE WFX-004 TAXONOMY. The wire `error` event carries a
 *    `code` from the closed `NativeMediaErrorCode` vocabulary, so typed
 *    failures survive the process boundary unchanged.
 * 5. RANGE-EXTENSION COMMANDS ARE MARKED AS SUCH. Besides the frozen six
 *    commands, the protocol carries `stat`/`read` — the wire form of the
 *    OPTIONAL `RangeAccessEngine` extension (service.ts, probed structurally
 *    above the wire). The adapter proxies them so an adapter-wrapped engine is
 *    behaviorally identical to a directly-used one (the work item's
 *    equivalence requirement); an engine that does not implement the extension
 *    answers them with a typed error, never a fake success.
 */

import {
  isNativeMediaErrorCode,
  type NativeMediaErrorCode,
} from "../errors";
import { isSessionState, type SessionState } from "../session";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

/** The wire protocol version this module speaks. Bump ONLY via lead review. */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Engine configuration
// ---------------------------------------------------------------------------

/**
 * How to locate and configure the engine process. `socketPath`/`binaryPath`
 * describe the transport/launch target a REAL engine subprocess needs; the
 * in-process simulation records them but does not use them. `cacheDir` and
 * `maxCacheBytes` are the local cache policy inputs (see ./cache.ts).
 */
export interface EngineConfig {
  /** Unix-domain (or named-pipe) socket the engine listens on. */
  socketPath?: string;
  /** Path to the engine binary to launch. */
  binaryPath?: string;
  /** Directory the engine owns for its local media cache. Required. */
  cacheDir: string;
  /** Maximum bytes the engine may keep in the cache. Required. */
  maxCacheBytes: number;
}

/**
 * Validate an {@link EngineConfig}: non-empty `cacheDir`, a positive safe
 * integer `maxCacheBytes`, and non-empty optional path strings. Returns the
 * config unchanged on success; throws a plain `Error` otherwise (this is
 * programmer-facing spawn validation — adapters map it to typed errors).
 */
export function validateEngineConfig(config: EngineConfig): EngineConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("validateEngineConfig: config must be an object");
  }
  const c = config as unknown as Record<string, unknown>;
  if (typeof c.cacheDir !== "string" || c.cacheDir.trim().length === 0) {
    throw new Error("validateEngineConfig: cacheDir must be a non-empty string");
  }
  if (
    typeof c.maxCacheBytes !== "number" ||
    !Number.isSafeInteger(c.maxCacheBytes) ||
    c.maxCacheBytes <= 0
  ) {
    throw new Error(
      `validateEngineConfig: maxCacheBytes must be a positive safe integer (got ${String(c.maxCacheBytes)})`,
    );
  }
  for (const field of ["socketPath", "binaryPath"] as const) {
    const value = c[field];
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      throw new Error(
        `validateEngineConfig: ${field} must be a non-empty string when present`,
      );
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Wire DTOs — commands
// ---------------------------------------------------------------------------

/** The wire form of the frozen engine's `open` source union (base64 bytes). */
export interface EngineSource {
  magnet?: string;
  /** Base64-encoded torrent file bytes (see {@link encodeBase64}). */
  torrentBase64?: string;
  localPath?: string;
}

/**
 * A single wire command from the adapter to the engine. `requestId` correlates
 * the response event; `protocol` must equal {@link PROTOCOL_VERSION}.
 *
 * The core six kinds (`open`/`seek`/`prioritize`/`pause`/`resume`/`close`)
 * mirror the frozen `NativeMediaEngine` surface one-to-one. `stat`/`read` are
 * the wire form of the optional `RangeAccessEngine` extension.
 */
export type EngineCommand =
  | {
      protocol: number;
      kind: "open";
      requestId: string;
      source: EngineSource;
    }
  | {
      protocol: number;
      kind: "seek";
      requestId: string;
      sessionId: string;
      positionMs: number;
    }
  | {
      protocol: number;
      kind: "prioritize";
      requestId: string;
      sessionId: string;
      deadlines: { piece: number; deadlineMs: number }[];
    }
  | {
      protocol: number;
      kind: "pause";
      requestId: string;
      sessionId: string;
    }
  | {
      protocol: number;
      kind: "resume";
      requestId: string;
      sessionId: string;
    }
  | {
      protocol: number;
      kind: "close";
      requestId: string;
      sessionId: string;
    }
  | {
      protocol: number;
      kind: "stat";
      requestId: string;
      sessionId: string;
    }
  | {
      protocol: number;
      kind: "read";
      requestId: string;
      sessionId: string;
      startByte: number;
      endByte: number;
    };

/** Command kinds: the frozen core six first, then the range-extension two. */
export const ENGINE_COMMAND_KINDS = [
  "open",
  "seek",
  "prioritize",
  "pause",
  "resume",
  "close",
  "stat",
  "read",
] as const;

export type EngineCommandKind = (typeof ENGINE_COMMAND_KINDS)[number];

/** The frozen core command kinds (one-to-one with `NativeMediaEngine`). */
export const CORE_COMMAND_KINDS: readonly EngineCommandKind[] = [
  "open",
  "seek",
  "prioritize",
  "pause",
  "resume",
  "close",
];

/** The range-extension command kinds (wire form of `RangeAccessEngine`). */
export const RANGE_COMMAND_KINDS: readonly EngineCommandKind[] = ["stat", "read"];

// ---------------------------------------------------------------------------
// Wire DTOs — events
// ---------------------------------------------------------------------------

/**
 * The JSON wire form of a `NativeMediaSession` (from @wfx/domain). Structurally
 * identical by contract; declared separately so the wire schema is
 * self-contained and a future frozen-domain change cannot silently skew it.
 */
export interface EngineSessionSnapshot {
  id: string;
  assetId: string;
  fileId: string;
  state: SessionState;
  bufferedMs: number;
  positionMs: number;
}

/** Wire error code vocabulary: the WFX-004 taxonomy, verbatim. */
export type EngineErrorCode = NativeMediaErrorCode;

/**
 * A single wire event. Solicited kinds (`opened`, `acked`, `stat`, `data`,
 * `error` with a `requestId`) answer a `send`; unsolicited kinds (`progress`,
 * `buffered`, `state-changed`, session-scoped `error`, `exit`) arrive via
 * `onEvent`.
 */
export type EngineEvent =
  | { protocol: number; kind: "opened"; requestId: string; session: EngineSessionSnapshot }
  | { protocol: number; kind: "acked"; requestId: string; session: EngineSessionSnapshot }
  | {
      protocol: number;
      kind: "stat";
      requestId: string;
      sessionId: string;
      totalBytes: number;
      contentType: string;
    }
  | {
      protocol: number;
      kind: "data";
      requestId: string;
      sessionId: string;
      startByte: number;
      endByte: number;
      /** Base64-encoded served bytes for `[startByte, endByte]` inclusive. */
      dataBase64: string;
    }
  | {
      protocol: number;
      kind: "progress";
      sessionId: string;
      positionMs: number;
      bufferedMs: number;
      session: EngineSessionSnapshot;
    }
  | {
      protocol: number;
      kind: "buffered";
      sessionId: string;
      bufferedMs: number;
      session: EngineSessionSnapshot;
    }
  | {
      protocol: number;
      kind: "state-changed";
      sessionId: string;
      from: SessionState;
      to: SessionState;
      session: EngineSessionSnapshot;
    }
  | {
      protocol: number;
      kind: "error";
      code: EngineErrorCode;
      message: string;
      sessionId?: string;
      requestId?: string;
      /** A fatal error kills the engine (all sessions fail). */
      fatal?: boolean;
    }
  | { protocol: number; kind: "exit"; reason: string };

/** Event kinds: session-bearing and lifecycle vocabulary. */
export const ENGINE_EVENT_KINDS = [
  "opened",
  "acked",
  "stat",
  "data",
  "progress",
  "buffered",
  "state-changed",
  "error",
  "exit",
] as const;

export type EngineEventKind = (typeof ENGINE_EVENT_KINDS)[number];

/** The solicited event kinds — the only valid answers to a `send`. */
export const SOLICITED_EVENT_KINDS: readonly EngineEventKind[] = [
  "opened",
  "acked",
  "stat",
  "data",
];

/** The unsolicited event kinds — the only kinds delivered via `onEvent`. */
export const UNSOLICITED_EVENT_KINDS: readonly EngineEventKind[] = [
  "progress",
  "buffered",
  "state-changed",
  "error",
  "exit",
];

// ---------------------------------------------------------------------------
// Base64 helpers (bytes across the JSON wire)
// ---------------------------------------------------------------------------

/** Encode bytes as standard base64 (chunked; safe for large inputs). */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode standard base64 to bytes. Returns null for malformed input. */
export function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isFiniteNonNegative(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

function isWireSessionSnapshot(x: unknown): x is EngineSessionSnapshot {
  if (!isPlainObject(x)) return false;
  if (!isNonEmptyString(x.id) || !isNonEmptyString(x.assetId) || !isNonEmptyString(x.fileId)) {
    return false;
  }
  if (!isSessionState(x.state)) return false;
  return isFiniteNonNegative(x.bufferedMs) && isFiniteNonNegative(x.positionMs);
}

function isEngineSource(x: unknown): x is EngineSource {
  if (!isPlainObject(x)) return false;
  if (x.magnet !== undefined && !isNonEmptyString(x.magnet)) return false;
  if (x.torrentBase64 !== undefined && !isNonEmptyString(x.torrentBase64)) return false;
  if (x.localPath !== undefined && !isNonEmptyString(x.localPath)) return false;
  return x.magnet !== undefined || x.torrentBase64 !== undefined || x.localPath !== undefined;
}

function isDeadlineList(x: unknown): x is { piece: number; deadlineMs: number }[] {
  if (!Array.isArray(x)) return false;
  return x.every((entry) => {
    if (!isPlainObject(entry)) return false;
    return (
      typeof entry.piece === "number" &&
      Number.isSafeInteger(entry.piece) &&
      entry.piece >= 0 &&
      isFiniteNonNegative(entry.deadlineMs)
    );
  });
}

/** Structural guard for {@link EngineCommand} (protocol version included). */
export function isEngineCommand(x: unknown): x is EngineCommand {
  if (!isPlainObject(x)) return false;
  if (x.protocol !== PROTOCOL_VERSION) return false;
  if (!isNonEmptyString(x.requestId)) return false;
  switch (x.kind) {
    case "open":
      return isEngineSource(x.source);
    case "seek":
      return isNonEmptyString(x.sessionId) && isFiniteNonNegative(x.positionMs);
    case "prioritize":
      return isNonEmptyString(x.sessionId) && isDeadlineList(x.deadlines);
    case "pause":
    case "resume":
    case "close":
    case "stat":
      return isNonEmptyString(x.sessionId);
    case "read":
      return (
        isNonEmptyString(x.sessionId) &&
        typeof x.startByte === "number" &&
        typeof x.endByte === "number" &&
        Number.isSafeInteger(x.startByte) &&
        x.startByte >= 0 &&
        Number.isSafeInteger(x.endByte) &&
        x.endByte >= x.startByte
      );
    default:
      return false;
  }
}

/** Structural guard for {@link EngineEvent} (protocol version included). */
export function isEngineEvent(x: unknown): x is EngineEvent {
  if (!isPlainObject(x)) return false;
  if (x.protocol !== PROTOCOL_VERSION) return false;
  switch (x.kind) {
    case "opened":
    case "acked":
      return isNonEmptyString(x.requestId) && isWireSessionSnapshot(x.session);
    case "stat":
      return (
        isNonEmptyString(x.requestId) &&
        isNonEmptyString(x.sessionId) &&
        typeof x.totalBytes === "number" &&
        Number.isSafeInteger(x.totalBytes) &&
        x.totalBytes > 0 &&
        isNonEmptyString(x.contentType)
      );
    case "data":
      return (
        isNonEmptyString(x.requestId) &&
        isNonEmptyString(x.sessionId) &&
        typeof x.startByte === "number" &&
        typeof x.endByte === "number" &&
        Number.isSafeInteger(x.startByte) &&
        x.startByte >= 0 &&
        Number.isSafeInteger(x.endByte) &&
        x.endByte >= x.startByte &&
        isNonEmptyString(x.dataBase64)
      );
    case "progress":
      return (
        isNonEmptyString(x.sessionId) &&
        isFiniteNonNegative(x.positionMs) &&
        isFiniteNonNegative(x.bufferedMs) &&
        isWireSessionSnapshot(x.session)
      );
    case "buffered":
      return (
        isNonEmptyString(x.sessionId) &&
        isFiniteNonNegative(x.bufferedMs) &&
        isWireSessionSnapshot(x.session)
      );
    case "state-changed":
      return (
        isNonEmptyString(x.sessionId) &&
        isSessionState(x.from) &&
        isSessionState(x.to) &&
        isWireSessionSnapshot(x.session)
      );
    case "error":
      if (!isNativeMediaErrorCode(x.code)) return false;
      if (typeof x.message !== "string") return false;
      if (x.sessionId !== undefined && !isNonEmptyString(x.sessionId)) return false;
      if (x.requestId !== undefined && !isNonEmptyString(x.requestId)) return false;
      return x.fatal === undefined || typeof x.fatal === "boolean";
    case "exit":
      return typeof x.reason === "string" && x.reason.length > 0;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// JSON wire encoding
// ---------------------------------------------------------------------------

/** Encode a command to its exact wire JSON (one line, no whitespace). */
export function serializeCommand(command: EngineCommand): string {
  return JSON.stringify(command);
}

/** Parse wire JSON back into a command; null for anything malformed. */
export function parseCommand(json: string): EngineCommand | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return isEngineCommand(raw) ? raw : null;
}

/** Encode an event to its exact wire JSON (one line, no whitespace). */
export function serializeEvent(event: EngineEvent): string {
  return JSON.stringify(event);
}

/** Parse wire JSON back into an event; null for anything malformed. */
export function parseEvent(json: string): EngineEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return isEngineEvent(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Process boundary interfaces
// ---------------------------------------------------------------------------

/**
 * A live connection to an engine instance. `send` resolves with the event
 * answering the command (correlated by `requestId`); `onEvent` receives
 * unsolicited events; `terminate` ends the engine (idempotent).
 */
export interface EngineHandle {
  /** Send one command; resolves with its response event. */
  send(command: EngineCommand): Promise<EngineEvent>;
  /** Subscribe to unsolicited events (progress/buffered/state-changed/error/exit). */
  onEvent(handler: (event: EngineEvent) => void): void;
  /** Terminate the engine. Pending sends reject; an `exit` event is emitted. */
  terminate(): void;
}

/**
 * The boundary a real engine subprocess (Rust, later) implements: spawn an
 * engine instance from a config and hand back its handle. The adapter
 * (./adapter.ts) talks ONLY to this interface, so swapping the in-process
 * simulation pipe for a real subprocess changes nothing above the wire.
 */
export interface NativeEngineProcess {
  spawn(config: EngineConfig): EngineHandle;
}
