/**
 * @wfx/native-media — service boundary (WFX-004, Lane B).
 *
 * The SERVICE CONTRACT around the frozen `NativeMediaEngine` interface
 * (@wfx/domain). This module defines:
 *
 * - `ServiceResponse<T>` — the request/response envelope every operation
 *   returns: `{ ok: true; value }` or `{ ok: false; error: NativeMediaError }`.
 *   Engine failures are always surfaced as typed errors — never swallowed,
 *   never converted into fake success.
 * - `NativeMediaService` — the type-only boundary the engine adapter
 *   (WFX-014) and HTTP gateway (WFX-015) build on: open / control / status /
 *   range.
 * - `createNativeMediaService(engine)` — a PURE reference adapter that wraps
 *   ANY `NativeMediaEngine` implementation (including a test double) with
 *   validation, session-state enforcement, error mapping, and per-call
 *   deadline enforcement.
 *
 * Design decisions (documented for lead review):
 *
 * 1. COMMAND MAPPING. The frozen engine exposes exactly open/seek/
 *    prioritize/pause/resume/close — there is no `play` primitive. The
 *    service maps BOTH `play` and `resume` to `engine.resume` (the frozen
 *    interface's playback-start primitive), distinguishing them only in
 *    FSM bookkeeping: `play`/`resume` transition a `buffering` or
 *    `background` session to `playing`; on an already-`playing` session
 *    they are idempotent. `play` from `resolving` is rejected with
 *    INVALID_INPUT (the FSM forbids `resolving -> playing`).
 * 2. NO STATE FEEDBACK CHANNEL. All frozen engine control methods return
 *    `void` — there is no way to poll or observe engine-side state. The
 *    adapter therefore maintains the last-known snapshot built from
 *    `open()` plus the transitions it applies itself. WFX-014 is expected
 *    to extend the engine boundary with a state/event channel; the
 *    envelope here is ready for it.
 * 3. PAUSE IS NOT A STATE. The frozen state union has no `paused` member;
 *    `pause` is an engine-level operation that leaves the session state
 *    unchanged. Only FSM-legal transitions (see session.ts) change state.
 * 4. RANGE ACCESS IS AN OPTIONAL ENGINE EXTENSION. The frozen engine has
 *    no byte-range primitive, so the adapter probes (structurally, at
 *    runtime) for the optional `statMedia`/`readRange` extension defined
 *    here. Engines without it get a typed `UNSUPPORTED_SOURCE` error —
 *    explicit unsupported behavior, never a fake 200. The frozen engine
 *    contract itself is untouched.
 * 5. CLOSE BOOKKEEPING. `close` is not a session state; the adapter marks
 *    closed sessions internally. Terminal sessions (`complete`, `failed`)
 *    and closed sessions answer control with `SESSION_CLOSED`. `status`
 *    still reports `complete`/`failed` snapshots (closed ones answer
 *    `SESSION_CLOSED`), and `range` keeps serving `complete` sessions from
 *    the local cache but refuses `failed` ones.
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import {
  isNativeMediaError,
  NativeMediaError,
  type NativeMediaErrorOptions,
} from "./errors";
import {
  describeRange,
  makeRangeResponse,
  resolveRange,
  type RangeRequest,
  type RangeResponse,
} from "./range";
import {
  makeSession,
  transition,
  type MakeSessionInput,
} from "./session";

// ---------------------------------------------------------------------------
// Service envelope
// ---------------------------------------------------------------------------

/**
 * The result envelope for every native media service operation:
 * success carries `value`, failure carries a typed `NativeMediaError`.
 */
export type ServiceResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: NativeMediaError };

/**
 * A request to open a media session — structurally identical to the frozen
 * engine's `open()` input. At least one source must be present; providing
 * several is forwarded as-is and resolved by the engine.
 */
export interface OpenSessionRequest {
  magnet?: string;
  torrentBytes?: Uint8Array;
  localPath?: string;
}

/**
 * A playback command. `positionMs` is required for `seek` and optional for
 * `play` (start playback at a position); it is rejected for `pause`/
 * `resume` (strictly typed input beats silent ignoring).
 */
export type PlayCommand =
  | { kind: "play" | "pause" | "resume" | "seek"; positionMs?: number }
  | { kind: "prioritize"; deadlines: { piece: number; deadlineMs: number }[] }
  | { kind: "close" };

/** The native media service boundary (type-only; see createNativeMediaService). */
export interface NativeMediaService {
  /** Open a session from a magnet, torrent bytes, or local path. */
  open(req: OpenSessionRequest): Promise<ServiceResponse<NativeMediaSession>>;
  /**
   * Send a playback command to a live session. Resolves with the session's
   * (possibly updated) snapshot; for `close` this is the final snapshot —
   * subsequent operations answer `SESSION_CLOSED`.
   */
  control(
    sessionId: string,
    command: PlayCommand,
  ): Promise<ServiceResponse<NativeMediaSession>>;
  /**
   * Read the adapter's last-known session snapshot. Does not call the
   * engine (the frozen interface has no status primitive — see module docs).
   */
  status(sessionId: string): Promise<ServiceResponse<NativeMediaSession>>;
  /** Read a byte range from the session's local cache. */
  range(req: RangeRequest): Promise<ServiceResponse<RangeResponse>>;
}

// ---------------------------------------------------------------------------
// Optional range-access engine extension (WFX-014 implements; probed here)
// ---------------------------------------------------------------------------

/**
 * OPTIONAL byte-range access an engine MAY expose in addition to the frozen
 * `NativeMediaEngine` surface. Detected structurally at runtime by
 * `createNativeMediaService`; engines that do not implement it answer range
 * requests with a typed `UNSUPPORTED_SOURCE` error. The frozen engine
 * contract in @wfx/domain is unchanged.
 */
export interface RangeAccessEngine {
  /** Report the cached media's size and content type for a session. */
  statMedia(sessionId: string): Promise<{ totalBytes: number; contentType: string }>;
  /** Read the inclusive byte interval `[startByte, endByte]` from the cache. */
  readRange(sessionId: string, startByte: number, endByte: number): Promise<Uint8Array>;
}

/** An engine that implements both the frozen surface and range access. */
export type RangeCapableEngine = NativeMediaEngine & RangeAccessEngine;

/** Structural probe: does this engine expose the range-access extension? */
function asRangeCapable(engine: NativeMediaEngine): RangeCapableEngine | null {
  const candidate = engine as Partial<RangeAccessEngine>;
  if (typeof candidate.statMedia === "function" && typeof candidate.readRange === "function") {
    return engine as RangeCapableEngine;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Engine error mapping
// ---------------------------------------------------------------------------

/** Build error options, materializing `sessionId` only when known. */
function errorOptions(
  detail: string,
  sessionId: string | undefined,
  cause: unknown,
): NativeMediaErrorOptions {
  const options: NativeMediaErrorOptions = { detail, cause };
  if (sessionId !== undefined) options.sessionId = sessionId;
  return options;
}

/**
 * Map an arbitrary engine failure onto the typed taxonomy:
 * - a `NativeMediaError` keeps its code/detail/sessionId (cause preserved),
 * - `TimeoutError`/`AbortError`-named errors map to retryable `ENGINE_TIMEOUT`,
 * - anything else maps to `INTERNAL` (not retryable — an engine bug).
 * Exported because WFX-014's real adapter will reuse this exact mapping.
 */
export function mapEngineError(err: unknown, sessionId?: string): NativeMediaError {
  if (isNativeMediaError(err)) {
    const options: NativeMediaErrorOptions = { cause: err };
    if (err.detail !== undefined) options.detail = err.detail;
    const sid = err.sessionId ?? sessionId;
    if (sid !== undefined) options.sessionId = sid;
    return new NativeMediaError(err.code, options);
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new NativeMediaError("ENGINE_TIMEOUT", errorOptions(err.message, sessionId, err));
  }
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return new NativeMediaError("INTERNAL", errorOptions(detail, sessionId, err));
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function ok<T>(value: T): ServiceResponse<T> {
  return { ok: true, value };
}

function err<T>(error: NativeMediaError): ServiceResponse<T> {
  return { ok: false, error };
}

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

/** Validate an open request: at least one well-formed source must be present. */
function validateOpenRequest(req: OpenSessionRequest): NativeMediaError | null {
  if (typeof req !== "object" || req === null) {
    return invalidInput("open: request must be an object");
  }
  const r = req as Record<string, unknown>;
  const hasSource =
    r.magnet !== undefined || r.torrentBytes !== undefined || r.localPath !== undefined;
  if (!hasSource) {
    return invalidInput(
      "open: at least one source is required (magnet, torrentBytes, or localPath)",
    );
  }
  if (r.magnet !== undefined) {
    if (typeof r.magnet !== "string" || r.magnet.trim().length === 0) {
      return invalidInput("open: magnet must be a non-empty string");
    }
    if (!r.magnet.startsWith("magnet:")) {
      return invalidInput(
        `open: magnet must be a magnet URI ('magnet:?xt=...'), got '${r.magnet.slice(0, 32)}'`,
      );
    }
  }
  if (r.torrentBytes !== undefined) {
    if (!(r.torrentBytes instanceof Uint8Array) || r.torrentBytes.length === 0) {
      return invalidInput("open: torrentBytes must be a non-empty Uint8Array");
    }
  }
  if (r.localPath !== undefined) {
    if (typeof r.localPath !== "string" || r.localPath.trim().length === 0) {
      return invalidInput("open: localPath must be a non-empty string");
    }
  }
  return null;
}

/** A normalized, fully validated playback command. */
type NormalizedCommand =
  | { kind: "play"; positionMs: number | undefined }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "seek"; positionMs: number }
  | { kind: "prioritize"; deadlines: { piece: number; deadlineMs: number }[] }
  | { kind: "close" };

function validatePositionMs(command: Record<string, unknown>, kind: string): number | undefined {
  const positionMs = command.positionMs;
  if (positionMs === undefined) return undefined;
  if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
    throw invalidInput(
      `control: positionMs must be a finite number >= 0 for '${kind}' (got ${String(positionMs)})`,
    );
  }
  return positionMs;
}

/** Validate and normalize a playback command; throws INVALID_INPUT on bad shape. */
function validateCommand(command: PlayCommand): NormalizedCommand {
  if (typeof command !== "object" || command === null) {
    throw invalidInput("control: command must be an object");
  }
  const c = command as Record<string, unknown>;
  switch (c.kind) {
    case "play":
      return { kind: "play", positionMs: validatePositionMs(c, "play") };
    case "pause":
    case "resume":
      if (c.positionMs !== undefined) {
        throw invalidInput(
          `control: positionMs is not valid for '${String(c.kind)}' (only 'play' and 'seek' accept it)`,
        );
      }
      return c.kind === "pause" ? { kind: "pause" } : { kind: "resume" };
    case "seek": {
      const positionMs = validatePositionMs(c, "seek");
      if (positionMs === undefined) {
        throw invalidInput("control: 'seek' requires positionMs");
      }
      return { kind: "seek", positionMs };
    }
    case "prioritize": {
      const deadlines = c.deadlines;
      if (!Array.isArray(deadlines)) {
        throw invalidInput("control: 'prioritize' requires a deadlines array");
      }
      const normalized = deadlines.map((entry: unknown, index: number) => {
        if (typeof entry !== "object" || entry === null) {
          throw invalidInput(`control: deadlines[${index}] must be an object`);
        }
        const d = entry as Record<string, unknown>;
        if (
          typeof d.piece !== "number" ||
          !Number.isSafeInteger(d.piece) ||
          d.piece < 0
        ) {
          throw invalidInput(
            `control: deadlines[${index}].piece must be a non-negative safe integer`,
          );
        }
        if (
          typeof d.deadlineMs !== "number" ||
          !Number.isFinite(d.deadlineMs) ||
          d.deadlineMs < 0
        ) {
          throw invalidInput(
            `control: deadlines[${index}].deadlineMs must be a finite number >= 0`,
          );
        }
        return { piece: d.piece, deadlineMs: d.deadlineMs };
      });
      return { kind: "prioritize", deadlines: normalized };
    }
    case "close":
      return { kind: "close" };
    default:
      throw invalidInput(`control: unknown command kind '${String(c.kind)}'`);
  }
}

function requireSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw invalidInput("sessionId must be a non-empty string");
  }
  return sessionId;
}

/** Validate a range request; throws INVALID_INPUT on malformed shape. */
function validateRangeRequest(req: RangeRequest): RangeRequest {
  if (typeof req !== "object" || req === null) {
    throw invalidInput("range: request must be an object");
  }
  const r = req as unknown as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || r.sessionId.trim().length === 0) {
    throw invalidInput("range: sessionId must be a non-empty string");
  }
  if (!Number.isSafeInteger(r.startByte)) {
    throw invalidInput(
      "range: startByte must be a safe integer (negative values encode the suffix form)",
    );
  }
  const startByte = r.startByte as number;
  if (r.endByte !== undefined) {
    if (!Number.isSafeInteger(r.endByte) || (r.endByte as number) < 0) {
      throw invalidInput("range: endByte must be a non-negative safe integer");
    }
    const endByte = r.endByte as number;
    if (startByte < 0) {
      throw invalidInput("range: suffix-form startByte cannot carry an endByte");
    }
    if (endByte < startByte) {
      throw invalidInput("range: endByte must be >= startByte");
    }
  }
  return req;
}

// ---------------------------------------------------------------------------
// Engine result validation (never trust, never fake success)
// ---------------------------------------------------------------------------

/**
 * Validate an engine-returned session: EVERY frozen field must be present
 * and well-formed (no default-filling — that would fabricate data). Throws
 * `INTERNAL` (the engine's fault, not the caller's) on any malformation.
 */
function validateEngineSession(raw: unknown): NativeMediaSession {
  if (typeof raw !== "object" || raw === null) {
    throw new NativeMediaError("INTERNAL", {
      detail: "engine.open returned a non-object session",
    });
  }
  const r = raw as Record<string, unknown>;
  for (const field of ["id", "assetId", "fileId", "state", "bufferedMs", "positionMs"] as const) {
    if (r[field] === undefined) {
      throw new NativeMediaError("INTERNAL", {
        detail: `engine.open returned a session missing '${field}'`,
      });
    }
  }
  try {
    return makeSession(r as unknown as MakeSessionInput);
  } catch (e) {
    const detail = e instanceof NativeMediaError ? (e.detail ?? e.message) : String(e);
    throw new NativeMediaError("INTERNAL", {
      detail: `engine.open returned a malformed session: ${detail}`,
      cause: e,
    });
  }
}

// ---------------------------------------------------------------------------
// Reference adapter
// ---------------------------------------------------------------------------

/** Options for {@link createNativeMediaService}. */
export interface NativeMediaServiceOptions {
  /**
   * Deadline for a single engine call, in milliseconds. A call that exceeds
   * it fails with a retryable `ENGINE_TIMEOUT` error. Use `0` to disable.
   * Default: 30000.
   */
  callTimeoutMs?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

class NativeMediaServiceImpl implements NativeMediaService {
  private readonly sessions = new Map<string, NativeMediaSession>();
  private readonly closed = new Set<string>();
  private readonly callTimeoutMs: number;
  private readonly rangeEngine: RangeCapableEngine | null;

  constructor(
    private readonly engine: NativeMediaEngine,
    options: NativeMediaServiceOptions,
  ) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.rangeEngine = asRangeCapable(engine);
  }

  async open(req: OpenSessionRequest): Promise<ServiceResponse<NativeMediaSession>> {
    try {
      const invalid = validateOpenRequest(req);
      if (invalid !== null) return err(invalid);
      const raw = await this.invoke("engine.open", undefined, () => this.engine.open(req));
      const session = validateEngineSession(raw);
      if (this.sessions.has(session.id) || this.closed.has(session.id)) {
        throw new NativeMediaError("INTERNAL", {
          detail: `engine.open returned duplicate session id '${session.id}'`,
        });
      }
      this.sessions.set(session.id, session);
      return ok({ ...session });
    } catch (e) {
      return err(mapEngineError(e));
    }
  }

  async control(
    sessionId: string,
    command: PlayCommand,
  ): Promise<ServiceResponse<NativeMediaSession>> {
    // Tracked separately so the catch can attach it to mapped errors.
    let errorSessionId: string | undefined;
    try {
      const id = requireSessionId(sessionId);
      errorSessionId = id;
      const cmd = validateCommand(command);
      const session = this.requireControllableSession(id);

      // FSM precheck: playback cannot begin while the session is resolving.
      if ((cmd.kind === "play" || cmd.kind === "resume") && session.state === "resolving") {
        throw invalidInput(
          `control: cannot '${cmd.kind}' while session '${id}' is 'resolving' (the FSM forbids resolving -> playing)`,
        );
      }

      let next: NativeMediaSession = session;
      switch (cmd.kind) {
        case "play":
        case "resume": {
          // `play` may seek first (start at a position); both map to the
          // frozen engine's playback-start primitive `resume`.
          const position = cmd.kind === "play" ? cmd.positionMs : undefined;
          if (position !== undefined) {
            await this.invoke(`engine.seek(${id})`, id, () => this.engine.seek(id, position));
            next = { ...next, positionMs: position };
          }
          await this.invoke(`engine.resume(${id})`, id, () => this.engine.resume(id));
          if (session.state === "buffering" || session.state === "background") {
            next = transition(next, "playing");
          }
          break;
        }
        case "seek":
          await this.invoke(`engine.seek(${id})`, id, () => this.engine.seek(id, cmd.positionMs));
          next = { ...next, positionMs: cmd.positionMs };
          break;
        case "pause":
          await this.invoke(`engine.pause(${id})`, id, () => this.engine.pause(id));
          break;
        case "prioritize":
          await this.invoke(`engine.prioritize(${id})`, id, () =>
            this.engine.prioritize(id, cmd.deadlines),
          );
          break;
        case "close":
          await this.invoke(`engine.close(${id})`, id, () => this.engine.close(id));
          this.sessions.delete(id);
          this.closed.add(id);
          break;
      }
      if (next !== session) this.sessions.set(id, next);
      return ok({ ...next });
    } catch (e) {
      return err(mapEngineError(e, errorSessionId));
    }
  }

  async status(sessionId: string): Promise<ServiceResponse<NativeMediaSession>> {
    // Tracked separately so the catch can attach it to mapped errors.
    let errorSessionId: string | undefined;
    try {
      const id = requireSessionId(sessionId);
      errorSessionId = id;
      if (this.closed.has(id)) {
        throw new NativeMediaError("SESSION_CLOSED", {
          detail: `status: session '${id}' is closed`,
          sessionId: id,
        });
      }
      const session = this.sessions.get(id);
      if (session === undefined) {
        throw new NativeMediaError("NOT_FOUND", {
          detail: `status: session '${id}' does not exist`,
          sessionId: id,
        });
      }
      return ok({ ...session });
    } catch (e) {
      return err(mapEngineError(e, errorSessionId));
    }
  }

  async range(req: RangeRequest): Promise<ServiceResponse<RangeResponse>> {
    // Tracked separately so the catch can attach it to mapped errors.
    let errorSessionId: string | undefined;
    try {
      const request = validateRangeRequest(req);
      errorSessionId = request.sessionId;
      this.requireRangableSession(request.sessionId);
      const rangeEngine = this.rangeEngine;
      if (rangeEngine === null) {
        throw new NativeMediaError("UNSUPPORTED_SOURCE", {
          detail:
            "range: engine does not expose the range-access extension (statMedia/readRange); byte-range access is unavailable for this engine",
          sessionId: request.sessionId,
        });
      }
      const stats = await this.invoke(
        `engine.statMedia(${request.sessionId})`,
        request.sessionId,
        () => rangeEngine.statMedia(request.sessionId),
      );
      if (typeof stats !== "object" || stats === null) {
        throw new NativeMediaError("INTERNAL", {
          detail: "engine.statMedia returned non-object media stats",
          sessionId: request.sessionId,
        });
      }
      const { totalBytes: rawTotalBytes, contentType: rawContentType } = stats as Record<
        string,
        unknown
      >;
      if (
        typeof rawTotalBytes !== "number" ||
        !Number.isSafeInteger(rawTotalBytes) ||
        rawTotalBytes <= 0
      ) {
        throw new NativeMediaError("INTERNAL", {
          detail: "engine.statMedia returned a malformed totalBytes",
          sessionId: request.sessionId,
        });
      }
      if (
        typeof rawContentType !== "string" ||
        rawContentType.trim().length === 0
      ) {
        throw new NativeMediaError("INTERNAL", {
          detail: "engine.statMedia returned a malformed contentType",
          sessionId: request.sessionId,
        });
      }
      const totalBytes = rawTotalBytes;
      const contentType = rawContentType;
      const resolved = resolveRange(request, totalBytes);
      if (resolved === null) {
        throw new NativeMediaError("RANGE_NOT_SATISFIABLE", {
          detail: `range: ${describeRange(request)} is not satisfiable against ${totalBytes} bytes`,
          sessionId: request.sessionId,
        });
      }
      const data = await this.invoke(
        `engine.readRange(${request.sessionId})`,
        request.sessionId,
        () => rangeEngine.readRange(request.sessionId, resolved.startByte, resolved.endByte),
      );
      if (!(data instanceof Uint8Array)) {
        throw new NativeMediaError("INTERNAL", {
          detail: "engine.readRange returned non-Uint8Array data",
          sessionId: request.sessionId,
        });
      }
      const span = resolved.endByte - resolved.startByte + 1;
      if (data.length !== span) {
        throw new NativeMediaError("INTERNAL", {
          detail: `engine.readRange returned ${data.length} bytes for a ${span}-byte span (bytes ${resolved.startByte}-${resolved.endByte})`,
          sessionId: request.sessionId,
        });
      }
      const response = makeRangeResponse(request, { totalBytes, contentType, data });
      return ok(response);
    } catch (e) {
      return err(mapEngineError(e, errorSessionId));
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** A session that may still receive control commands. */
  private requireControllableSession(sessionId: string): NativeMediaSession {
    if (this.closed.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `control: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `control: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (session.state === "failed" || session.state === "complete") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `control: session '${sessionId}' is '${session.state}' (terminal) — no further control`,
        sessionId,
      });
    }
    return session;
  }

  /**
   * A session whose local cache may serve range reads: closed and `failed`
   * sessions refuse; `complete` sessions keep serving (the cache persists
   * after background completion).
   */
  private requireRangableSession(sessionId: string): NativeMediaSession {
    if (this.closed.has(sessionId)) {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `range: session '${sessionId}' is closed`,
        sessionId,
      });
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new NativeMediaError("NOT_FOUND", {
        detail: `range: session '${sessionId}' does not exist`,
        sessionId,
      });
    }
    if (session.state === "failed") {
      throw new NativeMediaError("SESSION_CLOSED", {
        detail: `range: session '${sessionId}' is 'failed' — the cache entry is unusable`,
        sessionId,
      });
    }
    return session;
  }

  /**
   * Invoke an engine operation with deadline enforcement and typed error
   * mapping. Synchronous engine throws, rejections, and missed deadlines
   * all leave this method as a `NativeMediaError`.
   */
  private async invoke<T>(
    label: string,
    sessionId: string | undefined,
    op: () => Promise<T>,
  ): Promise<T> {
    let p: Promise<T>;
    try {
      p = op();
    } catch (e) {
      throw mapEngineError(e, sessionId);
    }
    if (this.callTimeoutMs > 0) {
      // Attach a no-op rejection handler so a LATE engine rejection (after
      // the timeout already won the race) never surfaces as unhandled.
      const _suppressLateRejection: Promise<unknown> = p.then(undefined, () => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          p,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new NativeMediaError(
                  "ENGINE_TIMEOUT",
                  errorOptions(
                    `${label} exceeded the ${this.callTimeoutMs}ms call deadline`,
                    sessionId,
                    undefined,
                  ),
                ),
              );
            }, this.callTimeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    return await p;
  }
}

/**
 * Create the reference native media service adapter around ANY
 * `NativeMediaEngine` implementation (including a test double). The adapter
 * is pure: no I/O of its own, no timers beyond the per-call deadline, and
 * all engine failures surface as typed errors inside the
 * `ServiceResponse` envelope.
 *
 * Range access requires the engine to implement the optional
 * `RangeAccessEngine` extension (probed structurally); otherwise `range`
 * answers with a typed `UNSUPPORTED_SOURCE` error.
 */
export function createNativeMediaService(
  engine: NativeMediaEngine,
  options: NativeMediaServiceOptions = {},
): NativeMediaService {
  if (typeof engine !== "object" || engine === null) {
    throw invalidInput("createNativeMediaService: engine must be an object");
  }
  for (const method of ["open", "seek", "prioritize", "pause", "resume", "close"] as const) {
    if (typeof (engine as unknown as Record<string, unknown>)[method] !== "function") {
      throw invalidInput(
        `createNativeMediaService: engine is missing the '${method}' method required by the frozen NativeMediaEngine contract`,
      );
    }
  }
  if (
    options.callTimeoutMs !== undefined &&
    (!Number.isFinite(options.callTimeoutMs) || options.callTimeoutMs < 0)
  ) {
    throw invalidInput(
      "createNativeMediaService: callTimeoutMs must be a finite number >= 0",
    );
  }
  return new NativeMediaServiceImpl(engine, options);
}
