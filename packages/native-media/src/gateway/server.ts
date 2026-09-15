/**
 * @wfx/native-media — local HTTP range/media gateway server (WFX-015, Lane B).
 *
 * `createGatewayServer(engine, opts)` builds the TRANSPORT-AGNOSTIC core of
 * the local media gateway: `handle(req: GatewayHttpRequest)` answers a
 * typed {@link GatewayHttpResponse} with media bytes served with byte-range
 * semantics, so standard players (video elements, embeds) can stream. The
 * HTTP wire itself is bound by transport glue (see test-server.ts for the
 * Bun.serve test binding; binding the gateway to the REAL engine process
 * is a later integration step).
 *
 * Per request, `handle`:
 * 1. validates the method (GET only — anything else answers a typed 405
 *    with `Allow: GET`, never a fake success),
 * 2. resolves the request path to an asset spec (`opts.assets`, or the
 *    default path==localPath mapping; unresolvable paths answer a typed
 *    404),
 * 3. parses the headers with `parseRangeRequest` (typed malformed /
 *    multi-range-unsupported failures, never a silent full-file fallback),
 * 4. reuses-or-opens ONE engine session per asset (single-flight, so
 *    concurrent requests share one `open`),
 * 5. stats the media through the engine's optional `RangeAccessEngine`
 *    extension (the WFX-004 service envelope exposes no stat operation —
 *    see the note below),
 * 6. computes the pure verdict with `buildRangeResponse` (200/206/304/416),
 * 7. resolves the verdict's body descriptor by reading the inclusive byte
 *    interval from the session through the MERGED WFX-004 service envelope
 *    (`service.range`), and
 * 8. serializes status + headers + bytes (error verdicts carry a
 *    machine-readable JSON error envelope with a human message).
 *
 * Error mapping (closed table, {@link ERROR_STATUS}): the WFX-004 taxonomy
 * maps EXACTLY to `NOT_FOUND -> 404`, `RANGE_NOT_SATISFIABLE -> 416`, and
 * every engine-failure code (`IO_ERROR`, `ENGINE_TIMEOUT`, `INTERNAL`,
 * `UNSUPPORTED_SOURCE`, `SESSION_CLOSED`, `VERIFICATION_FAILED`, and
 * `INVALID_INPUT` surfacing from the gateway's own engine-call
 * construction) -> `503`. 416s carry `Content-Range: bytes *\/total`; 503s
 * carry the typed JSON error body.
 *
 * Deadline-aware pull (never blocks forever): a range read that fails with
 * a RETRYABLE engine error (e.g. the simulation's `IO_ERROR` "piece not
 * downloaded yet") sends the engine a `prioritize` hint for the pieces
 * covering the requested interval (reusing the frozen engine's
 * `prioritize(deadlines)` surface via `service.control`), then retries
 * while buffering progresses — until `readDeadlineMs` elapses. A missed
 * deadline answers a typed 503 (`ENGINE_TIMEOUT`) whose JSON body carries
 * the hint that was sent (`prioritizeHint`) or, when no hint could be sent
 * (unknown piece geometry, or hint delivery failed), a typed
 * `hintOmitted: true` marker. The loop is bounded BOTH by the injected
 * clock and by a derived attempt cap, so a non-advancing injected clock can
 * never hang the gateway.
 *
 * Idle sessions: one session per asset is reused across requests; entries
 * idle for `idleTimeoutMs` (against the INJECTED clock — deterministic,
 * no hidden globals) are closed through `service.control({kind:"close"})`
 * on the lazy per-request sweep and on the explicit
 * `sweepIdleSessions()`.
 *
 * NOTE ON STATS: the merged WFX-004 `NativeMediaService` exposes
 * open/control/status/range but NO stat operation, while range serving
 * needs the media size and content type up front (416 verdicts, ETags,
 * Content-Length). The gateway therefore probes the engine structurally
 * for the optional `RangeAccessEngine` extension (the same probe
 * `createNativeMediaService` applies internally) and calls `statMedia`
 * directly. An engine WITHOUT the extension (e.g. the merged WFX-014
 * process adapter, whose v1 wire has no stat/read commands) answers EVERY
 * request with a typed 503 `UNSUPPORTED_SOURCE` — explicit unsupported
 * behavior, never a fake 200.
 *
 * NOTE ON SEEK: the frozen engine maps `seek` to PLAYBACK positions
 * (milliseconds), and the gateway owns no byte<->position mapping (the
 * media stat exposes no duration), so the gateway never seeks — the
 * deadline-aware pull is the packet-specified pull surface (`prioritize`).
 */

import type { NativeMediaEngine, NativeMediaSession } from "@wfx/domain";

import {
  isNativeMediaErrorCode,
  isRetryable,
  NativeMediaError,
  type NativeMediaErrorCode,
} from "../errors";
import {
  createNativeMediaService,
  mapEngineError,
  type NativeMediaService,
  type RangeAccessEngine,
  type RangeCapableEngine,
  type ServiceResponse,
} from "../service";

import { unsatisfiableContentRange, etagFor } from "./bytes";
import {
  parseRangeRequest,
  type GatewayRequestHeaders,
  type RangeHeaderErrorReason,
} from "./request";
import {
  buildRangeResponse,
  type GatewayAsset,
  type GatewayMediaRequest,
  type GatewayResponse,
} from "./response";

// ---------------------------------------------------------------------------
// Transport-agnostic request/response shapes
// ---------------------------------------------------------------------------

/** One incoming media request, normalized by transport glue. */
export interface GatewayHttpRequest {
  /** HTTP method (case-insensitive; only GET serves media). */
  method: string;
  /** URL pathname (query strings are transport concerns, already stripped). */
  path: string;
  /** Header names SHOULD be lowercase; lookup is case-insensitive anyway. */
  headers: GatewayRequestHeaders;
}

/** The status vocabulary of the gateway (success + typed failures). */
export type GatewayStatus = 200 | 206 | 304 | 404 | 405 | 416 | 503;

/** One outgoing gateway response, ready for transport serialization. */
export interface GatewayHttpResponse {
  status: GatewayStatus;
  headers: Record<string, string>;
  /**
   * Present for 200/206 (media bytes) and for typed JSON error bodies
   * (404/405/416/503); absent for 304 (no body by definition).
   */
  body?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** How one URL path resolves to an engine source + piece geometry. */
export interface GatewayAssetSpec {
  /** The engine open() source for this asset (magnet and/or localPath). */
  source: { magnet?: string; localPath?: string };
  /**
   * Number of equal-size pieces the engine divides this asset into —
   * REQUIRED for the deadline-aware `prioritize` hint (byte->piece
   * mapping). When absent, reads that need buffering still wait for the
   * deadline but CANNOT hint the engine (typed `hintOmitted` in the 503).
   */
  pieceCount?: number;
}

/** Options for {@link createGatewayServer}. */
export interface GatewayOptions {
  /**
   * URL path -> asset spec map (or record). When provided, unknown paths
   * answer a typed 404. When absent, every path resolves to the engine
   * source `{ localPath: path }` (the engine then answers NOT_FOUND itself
   * for unregistered paths).
   */
  assets?: ReadonlyMap<string, GatewayAssetSpec> | Readonly<Record<string, GatewayAssetSpec>>;
  /** Idle timeout for per-asset sessions, ms. Default: 30000. Use 0 to disable. */
  idleTimeoutMs?: number;
  /**
   * Deadline for deadline-aware pulls (retryable read failures awaiting
   * engine buffering progress), ms. Default: 5000. Use 0 to disable
   * (a retryable failure answers the mapped 503 immediately).
   */
  readDeadlineMs?: number;
  /** Poll interval of the deadline-aware pull, ms. Default: 25. */
  pollIntervalMs?: number;
  /** Per-call engine deadline forwarded to the service adapter, ms. Default: the service's own. */
  callTimeoutMs?: number;
  /**
   * INJECTED CLOCK (monotonic milliseconds) — the single time source for
   * idle-timeout and read-deadline math. Default: `performance.now`.
   * Deterministic tests inject their own.
   */
  clock?: () => number;
}

// ---------------------------------------------------------------------------
// Error mapping (closed table — the task's exact mapping)
// ---------------------------------------------------------------------------

/**
 * The closed WFX-004 taxonomy -> HTTP status table:
 * `NOT_FOUND -> 404`, `RANGE_NOT_SATISFIABLE -> 416`, everything else
 * (engine failures, unsupported engines, closed sessions, internal faults)
 * -> `503`.
 */
export const ERROR_STATUS: Readonly<Record<NativeMediaErrorCode, 404 | 416 | 503>> = {
  INVALID_INPUT: 503,
  UNSUPPORTED_SOURCE: 503,
  NOT_FOUND: 404,
  IO_ERROR: 503,
  VERIFICATION_FAILED: 503,
  RANGE_NOT_SATISFIABLE: 416,
  SESSION_CLOSED: 503,
  ENGINE_TIMEOUT: 503,
  INTERNAL: 503,
};

/** Gateway-own error codes beyond the WFX-004 taxonomy (typed, documented). */
export type GatewayErrorCode =
  | NativeMediaErrorCode
  /** Malformed `Range` header (typed 416 with the exact header value). */
  | "INVALID_RANGE_HEADER"
  /** Well-formed multi-range header — deliberate single-range scope cut (typed 416). */
  | "MULTI_RANGE_UNSUPPORTED"
  /** Non-GET method (typed 405 with `Allow: GET`). */
  | "METHOD_NOT_ALLOWED";

/** One `prioritize` deadline entry of a deadline-aware pull hint. */
export interface PieceDeadline {
  piece: number;
  deadlineMs: number;
}

/** The machine-readable JSON error body of gateway failure responses. */
export interface GatewayErrorBody {
  ok: false;
  error: {
    /** Machine-readable code (WFX-004 taxonomy or gateway-own). */
    code: GatewayErrorCode;
    /** Human-readable message (never a stack trace). */
    message: string;
    /** Present iff a taxonomy code: derived from the retryability table. */
    retryable?: boolean;
    /** The engine session concerned, when known. */
    sessionId?: string;
    /** Present for range-header failures: the EXACT offending header value. */
    header?: string;
    /** Present for range-header failures: "malformed" | "unsupported". */
    reason?: RangeHeaderErrorReason;
    /**
     * Present on deadline-aware-pull timeouts: the `prioritize` hint that
     * was sent to the engine for the requested range.
     */
    prioritizeHint?: readonly PieceDeadline[];
    /** Present when no hint could be sent (piece geometry unknown or delivery failed). */
    hintOmitted?: true;
  };
}

// ---------------------------------------------------------------------------
// Idle sweep + read outcome shapes
// ---------------------------------------------------------------------------

/** The typed result of an idle sweep. */
export interface IdleSweepResult {
  /** Session ids this sweep closed through the service envelope. */
  closed: readonly string[];
  /** Sessions whose close failed (kept for the next sweep — never swallowed). */
  failures: readonly {
    sourceKey: string;
    sessionId: string;
    error: NativeMediaError;
  }[];
}

/** The typed outcome of resolving a body descriptor into bytes. */
export type GatewayReadResult =
  | { ok: true; data: Uint8Array }
  | {
      ok: false;
      error: NativeMediaError;
      /** The prioritize hint sent for the requested range, when one was sent. */
      prioritizeHint?: readonly PieceDeadline[];
      /** True when no hint could be sent (piece geometry unknown or delivery failed). */
      hintOmitted?: true;
    };

// ---------------------------------------------------------------------------
// Gateway server surface
// ---------------------------------------------------------------------------

/** The transport-agnostic gateway server surface. */
export interface GatewayServer {
  /** Handle one normalized media request. Never throws. */
  handle(req: GatewayHttpRequest): Promise<GatewayHttpResponse>;
  /** Close sessions idle beyond `idleTimeoutMs` (typed result). */
  sweepIdleSessions(): Promise<IdleSweepResult>;
  /** Number of live (reused) per-asset sessions — observability for tests. */
  sessionCount(): number;
  /** Close every session and drop all bookkeeping. Idempotent. */
  dispose(): Promise<IdleSweepResult>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_READ_DEADLINE_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

/** Structural probe — mirrors the WFX-004 service's internal probe. */
function probeRangeAccess(engine: NativeMediaEngine): RangeCapableEngine | null {
  const candidate = engine as Partial<RangeAccessEngine>;
  if (
    typeof candidate.statMedia === "function" &&
    typeof candidate.readRange === "function"
  ) {
    return engine as RangeCapableEngine;
  }
  return null;
}

function ok<T>(value: T): ServiceResponse<T> {
  return { ok: true, value };
}

/** One reused per-asset session. */
interface SessionEntry {
  sourceKey: string;
  session: NativeMediaSession;
  lastUsedAt: number;
}

/**
 * The pieces covering the inclusive byte interval `[startByte, endByte]`
 * under equal-size piece geometry (`pieceSize = max(1, floor(total /
 * pieceCount))`, last piece absorbing the remainder — the simulation
 * engine's documented geometry, asserted by the caller via `pieceCount`).
 */
function piecesCovering(
  startByte: number,
  endByte: number,
  totalBytes: number,
  pieceCount: number,
): number[] {
  const pieceSize = Math.max(1, Math.floor(totalBytes / pieceCount));
  const first = Math.min(pieceCount - 1, Math.floor(startByte / pieceSize));
  const last = Math.min(pieceCount - 1, Math.floor(endByte / pieceSize));
  const pieces: number[] = [];
  for (let piece = first; piece <= last; piece += 1) {
    pieces.push(piece);
  }
  return pieces;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const JSON_ENCODER = new TextEncoder();

function encodeErrorBody(
  code: GatewayErrorCode,
  message: string,
  extra: {
    sessionId?: string;
    header?: string;
    reason?: RangeHeaderErrorReason;
    prioritizeHint?: readonly PieceDeadline[];
    hintOmitted?: true;
  } = {},
): Uint8Array {
  const error: GatewayErrorBody["error"] = { code, message };
  if (isNativeMediaErrorCode(code)) error.retryable = isRetryable(code);
  if (extra.sessionId !== undefined) error.sessionId = extra.sessionId;
  if (extra.header !== undefined) error.header = extra.header;
  if (extra.reason !== undefined) error.reason = extra.reason;
  if (extra.prioritizeHint !== undefined) error.prioritizeHint = extra.prioritizeHint;
  if (extra.hintOmitted !== undefined) error.hintOmitted = true;
  const body: GatewayErrorBody = { ok: false, error };
  return JSON_ENCODER.encode(JSON.stringify(body));
}

class GatewayServerImpl implements GatewayServer {
  private readonly rangeEngine: RangeCapableEngine | null;
  private readonly service: NativeMediaService;
  private readonly assets: ReadonlyMap<string, GatewayAssetSpec> | null;
  private readonly idleTimeoutMs: number;
  private readonly readDeadlineMs: number;
  private readonly pollIntervalMs: number;
  private readonly clock: () => number;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly opening = new Map<
    string,
    Promise<ServiceResponse<NativeMediaSession>>
  >();
  private disposed = false;

  constructor(engine: NativeMediaEngine, options: GatewayOptions) {
    if (typeof engine !== "object" || engine === null) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "createGatewayServer: engine must be an object",
      });
    }
    if (typeof options !== "object" || options === null) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "createGatewayServer: options must be an object",
      });
    }
    this.rangeEngine = probeRangeAccess(engine);
    this.service = createNativeMediaService(
      engine,
      options.callTimeoutMs === undefined
        ? {}
        : { callTimeoutMs: options.callTimeoutMs },
    );
    this.assets = normalizeAssets(options.assets);
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.readDeadlineMs = options.readDeadlineMs ?? DEFAULT_READ_DEADLINE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.clock = options.clock ?? (() => performance.now());
    if (!Number.isFinite(this.idleTimeoutMs) || this.idleTimeoutMs < 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "createGatewayServer: idleTimeoutMs must be a finite number >= 0",
      });
    }
    if (!Number.isFinite(this.readDeadlineMs) || this.readDeadlineMs < 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "createGatewayServer: readDeadlineMs must be a finite number >= 0",
      });
    }
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs <= 0) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: "createGatewayServer: pollIntervalMs must be a positive safe integer",
      });
    }
  }

  // --- surface -------------------------------------------------------------

  async handle(req: GatewayHttpRequest): Promise<GatewayHttpResponse> {
    // 0. Disposed gateway: honest typed failure, never a silent reopen.
    if (this.disposed) {
      return {
        status: 503,
        headers: { "Content-Type": "application/json" },
        body: encodeErrorBody(
          "INVALID_INPUT",
          "the gateway server is disposed — no further requests are served",
        ),
      };
    }

    // 1. Engine without range access: every request answers the typed
    //    unsupported verdict (no session is opened — nothing could be read).
    if (this.rangeEngine === null) {
      return {
        status: 503,
        headers: { "Content-Type": "application/json" },
        body: encodeErrorBody(
          "UNSUPPORTED_SOURCE",
          "the engine does not expose the range-access extension (statMedia/readRange); the gateway cannot serve media bytes from this engine",
        ),
      };
    }

    // 2. Request shape: transport glue must hand us a well-formed request.
    if (
      typeof req !== "object" ||
      req === null ||
      typeof req.method !== "string" ||
      typeof req.path !== "string" ||
      typeof req.headers !== "object" ||
      req.headers === null
    ) {
      return {
        status: 503,
        headers: { "Content-Type": "application/json" },
        body: encodeErrorBody(
          "INTERNAL",
          "malformed gateway request (transport glue bug)",
        ),
      };
    }

    // 3. Method: GET only — typed 405, never a fake success.
    if (req.method.toUpperCase() !== "GET") {
      return {
        status: 405,
        headers: { Allow: "GET", "Content-Type": "application/json" },
        body: encodeErrorBody(
          "METHOD_NOT_ALLOWED",
          `method '${req.method}' is not supported (the media gateway serves GET only)`,
        ),
      };
    }

    // 4. Path -> asset spec (unknown paths answer the typed 404).
    const resolved = this.resolveSpec(req.path);
    if (resolved === null) {
      return {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: encodeErrorBody(
          "NOT_FOUND",
          `no asset is mapped for path '${req.path}'`,
        ),
      };
    }
    const { sourceKey, spec } = resolved;

    // 5. Header parsing happens before the session; the typed 416 needs
    //    the media stat, so the failure is applied after the stat below.
    const parsed = parseRangeRequest(req.headers);

    // 6. Lazy idle sweep (deterministic against the injected clock).
    await this.sweepIdleSessions();

    // 7. Reuse-or-open ONE session per asset (single-flight).
    const session = await this.obtainSession(sourceKey, spec);
    if (!session.ok) {
      return this.errorFromNativeMediaError(session.error);
    }
    const sessionId = session.value.id;

    // 8. Media stat through the engine's range-access extension.
    const stat = await this.statMedia(sessionId);
    if (!stat.ok) {
      return this.errorFromNativeMediaError(stat.error);
    }
    const asset: GatewayAsset = {
      assetId: session.value.assetId,
      // The frozen engine surface exposes no version primitive; the version
      // is derived deterministically from the media stat so representation
      // changes that alter the stat invalidate the ETag (documented limit).
      version: `${stat.value.totalBytes}:${stat.value.contentType}`,
      totalBytes: stat.value.totalBytes,
      contentType: stat.value.contentType,
    };

    // 9. Typed range-header failure: 416 with `Content-Range: bytes */total`
    //    (the stat is known now) and the exact offending header value.
    if (!parsed.ok) {
      return {
        status: 416,
        headers: {
          "Content-Range": unsatisfiableContentRange(asset.totalBytes),
          "Accept-Ranges": "bytes",
          ETag: etagFor(asset.assetId, asset.version),
          "Content-Type": "application/json",
        },
        body: encodeErrorBody(
          parsed.error.reason === "unsupported"
            ? "MULTI_RANGE_UNSUPPORTED"
            : "INVALID_RANGE_HEADER",
          parsed.error.message,
          { header: parsed.error.header, reason: parsed.error.reason, sessionId },
        ),
      };
    }

    // 10. Pure verdict (200/206/304/416). Programmer-error throws surface
    //     as typed 503s via the merged error mapping — never an unhandled
    //     rejection.
    let verdict: GatewayResponse;
    try {
      const mediaRequest: GatewayMediaRequest = { ...parsed.request, sessionId };
      verdict = buildRangeResponse(asset, mediaRequest);
    } catch (e) {
      return this.errorFromNativeMediaError(mapEngineError(e, sessionId));
    }

    // 11. Serialize the verdict.
    if (verdict.status === 304) {
      return { status: 304, headers: { ...verdict.headers } };
    }
    if (verdict.status === 416) {
      return {
        status: 416,
        headers: { ...verdict.headers, "Content-Type": "application/json" },
        body: encodeErrorBody("RANGE_NOT_SATISFIABLE", verdict.detail, {
          sessionId,
        }),
      };
    }

    // 12. Resolve the body descriptor into bytes (deadline-aware pull).
    const read = await this.readWithDeadline(
      sessionId,
      verdict.body.offset,
      verdict.body.length,
      spec.pieceCount,
      asset.totalBytes,
    );
    if (read.ok) {
      return {
        status: verdict.status,
        headers: { ...verdict.headers },
        body: read.data,
      };
    }
    if (read.error.code === "RANGE_NOT_SATISFIABLE") {
      // A race between the stat and the read (the media shrank): the 416
      // verdict with the stat we hold is the honest answer.
      return {
        status: 416,
        headers: {
          "Content-Range": unsatisfiableContentRange(asset.totalBytes),
          "Accept-Ranges": "bytes",
          ETag: etagFor(asset.assetId, asset.version),
          "Content-Type": "application/json",
        },
        body: encodeErrorBody(
          "RANGE_NOT_SATISFIABLE",
          read.error.detail ?? read.error.message,
          { sessionId },
        ),
      };
    }
    return {
      status: ERROR_STATUS[read.error.code],
      headers: { "Content-Type": "application/json" },
      body: encodeErrorBody(read.error.code, read.error.message, {
        sessionId,
        ...(read.prioritizeHint === undefined
          ? {}
          : { prioritizeHint: read.prioritizeHint }),
        ...(read.hintOmitted === undefined ? {} : { hintOmitted: true }),
      }),
    };
  }

  async sweepIdleSessions(): Promise<IdleSweepResult> {
    if (this.idleTimeoutMs <= 0 || this.sessions.size === 0) {
      return { closed: [], failures: [] };
    }
    const now = this.clock();
    const closed: string[] = [];
    const failures: { sourceKey: string; sessionId: string; error: NativeMediaError }[] = [];
    for (const [sourceKey, entry] of [...this.sessions]) {
      if (now - entry.lastUsedAt < this.idleTimeoutMs) continue;
      const response = await this.service.control(entry.session.id, { kind: "close" });
      if (response.ok) {
        this.sessions.delete(sourceKey);
        closed.push(entry.session.id);
        continue;
      }
      const code = response.error.code;
      if (code === "NOT_FOUND" || code === "SESSION_CLOSED") {
        // The session is already gone: drop the stale entry (the next
        // request re-opens). Not a failure — nothing was left dangling.
        this.sessions.delete(sourceKey);
        continue;
      }
      // Close failed for an engine-side reason: keep the entry so the next
      // sweep retries, and report the typed failure (never swallowed).
      failures.push({ sourceKey, sessionId: entry.session.id, error: response.error });
    }
    return { closed, failures };
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  async dispose(): Promise<IdleSweepResult> {
    const result = await this.closeAllSessions();
    this.disposed = true;
    this.opening.clear();
    return result;
  }

  // --- internals -------------------------------------------------------------

  private async closeAllSessions(): Promise<IdleSweepResult> {
    const closed: string[] = [];
    const failures: { sourceKey: string; sessionId: string; error: NativeMediaError }[] = [];
    for (const [sourceKey, entry] of [...this.sessions]) {
      const response = await this.service.control(entry.session.id, { kind: "close" });
      this.sessions.delete(sourceKey);
      if (response.ok) {
        closed.push(entry.session.id);
      } else {
        failures.push({ sourceKey, sessionId: entry.session.id, error: response.error });
      }
    }
    return { closed, failures };
  }

  /** Path -> (sourceKey, spec); null when no asset is mapped. */
  private resolveSpec(
    path: string,
  ): { sourceKey: string; spec: GatewayAssetSpec } | null {
    if (this.assets !== null) {
      const spec = this.assets.get(path);
      if (spec === undefined) return null;
      return { sourceKey: path, spec };
    }
    // Default mapping: the path IS the engine's local path.
    return { sourceKey: path, spec: { source: { localPath: path } } };
  }

  /** Reuse-or-open ONE session per asset, single-flight across requests. */
  private async obtainSession(
    sourceKey: string,
    spec: GatewayAssetSpec,
  ): Promise<ServiceResponse<NativeMediaSession>> {
    const existing = this.sessions.get(sourceKey);
    if (existing !== undefined) {
      existing.lastUsedAt = this.clock();
      return ok({ ...existing.session });
    }
    let opened = this.opening.get(sourceKey);
    if (opened === undefined) {
      opened = this.service.open(spec.source).then(
        (response) => response,
        (rejection: unknown): ServiceResponse<NativeMediaSession> => ({
          ok: false,
          error: mapEngineError(rejection),
        }),
      );
      this.opening.set(sourceKey, opened);
    }
    const settled = await opened;
    this.opening.delete(sourceKey);
    if (settled.ok) {
      this.sessions.set(sourceKey, {
        sourceKey,
        session: settled.value,
        lastUsedAt: this.clock(),
      });
    }
    return settled;
  }

  /** Stat the media through the range-access extension (typed envelope). */
  private async statMedia(
    sessionId: string,
  ): Promise<ServiceResponse<{ totalBytes: number; contentType: string }>> {
    const engine = this.rangeEngine;
    if (engine === null) {
      // Unreachable (handle short-circuits), kept for totality.
      return {
        ok: false,
        error: new NativeMediaError("UNSUPPORTED_SOURCE", {
          detail: "statMedia: engine does not expose the range-access extension",
          sessionId,
        }),
      };
    }
    try {
      const stats = await engine.statMedia(sessionId);
      if (
        typeof stats !== "object" ||
        stats === null ||
        !Number.isSafeInteger(stats.totalBytes) ||
        stats.totalBytes <= 0 ||
        typeof stats.contentType !== "string" ||
        stats.contentType.trim().length === 0
      ) {
        return {
          ok: false,
          error: new NativeMediaError("INTERNAL", {
            detail: "statMedia: engine returned malformed media stats",
            sessionId,
          }),
        };
      }
      return ok({ totalBytes: stats.totalBytes, contentType: stats.contentType });
    } catch (e) {
      return { ok: false, error: mapEngineError(e, sessionId) };
    }
  }

  /**
   * Resolve `[offset, offset+length-1]` into bytes through the service
   * envelope's session range reads, with the deadline-aware pull for
   * retryable failures: send ONE `prioritize` hint for the covering
   * pieces, then retry while progress may be arriving, until the deadline
   * (injected clock) or the derived attempt cap expires — whichever comes
   * first, so a frozen injected clock can never hang the loop.
   */
  private async readWithDeadline(
    sessionId: string,
    offset: number,
    length: number,
    pieceCount: number | undefined,
    totalBytes: number,
  ): Promise<GatewayReadResult> {
    const endByte = offset + length - 1;
    const deadlineMs = this.readDeadlineMs;
    const pollMs = this.pollIntervalMs;
    const startedAt = this.clock();
    const maxAttempts =
      deadlineMs <= 0 ? 1 : Math.max(1, Math.ceil(deadlineMs / pollMs));
    let hint: PieceDeadline[] | undefined;
    let hintOmitted: true | undefined;
    let hintSent = false;

    for (let attempt = 1; ; attempt += 1) {
      const response = await this.service.range({
        sessionId,
        startByte: offset,
        endByte: endByte,
      });
      if (response.ok) {
        return { ok: true, data: response.value.data };
      }
      const error = response.error;
      if (!error.retryable || deadlineMs <= 0) {
        return { ok: false, error };
      }

      const remaining = deadlineMs - (this.clock() - startedAt);
      if (attempt >= maxAttempts || remaining <= 0) {
        // Deadline-aware pull exhausted: typed ENGINE_TIMEOUT 503 carrying
        // the hint that was sent (or the typed omission marker).
        const timedOut = new NativeMediaError("ENGINE_TIMEOUT", {
          detail: `range read of bytes ${offset}-${endByte} did not complete within the ${deadlineMs}ms read deadline while awaiting engine buffering progress`,
          sessionId,
          cause: error,
        });
        if (hint !== undefined) {
          return { ok: false, error: timedOut, prioritizeHint: hint };
        }
        if (hintOmitted === true) {
          return { ok: false, error: timedOut, hintOmitted: true };
        }
        return { ok: false, error: timedOut };
      }

      if (!hintSent) {
        hintSent = true;
        if (
          pieceCount !== undefined &&
          Number.isSafeInteger(pieceCount) &&
          pieceCount > 0
        ) {
          const pieces = piecesCovering(offset, endByte, totalBytes, pieceCount);
          const deadlines: PieceDeadline[] = pieces.map((piece) => ({
            piece,
            deadlineMs: Math.max(0, Math.round(remaining)),
          }));
          // Send the hint through the merged service envelope. A failed
          // hint does not fail the read: buffering may still progress, and
          // the next read attempt surfaces any session failure honestly.
          const control = await this.service.control(sessionId, {
            kind: "prioritize",
            deadlines,
          });
          if (control.ok) {
            hint = deadlines;
          } else {
            // Hint could not be delivered (typed omission on timeout).
            hintOmitted = true;
          }
        } else {
          // No piece geometry: the pull still waits, but cannot hint —
          // typed omission in the eventual timeout body.
          hintOmitted = true;
        }
      }

      await sleep(pollMs);
    }
  }

  /** Serialize a taxonomy error with the closed status table. */
  private errorFromNativeMediaError(error: NativeMediaError): GatewayHttpResponse {
    return {
      status: ERROR_STATUS[error.code],
      headers: { "Content-Type": "application/json" },
      body: encodeErrorBody(error.code, error.message, {
        ...(error.sessionId === undefined ? {} : { sessionId: error.sessionId }),
      }),
    };
  }
}

/** Normalize the assets option to a lookup map (null = default mapping). */
function normalizeAssets(
  assets: GatewayOptions["assets"],
): ReadonlyMap<string, GatewayAssetSpec> | null {
  if (assets === undefined) return null;
  if (assets instanceof Map) return assets;
  if (typeof assets === "object" && assets !== null) {
    return new Map(Object.entries(assets));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the transport-agnostic local HTTP range/media gateway server
 * around ANY `NativeMediaEngine`. Engines without the optional
 * `RangeAccessEngine` extension answer every request with a typed 503
 * `UNSUPPORTED_SOURCE` (explicit unsupported behavior, never a fake 200).
 * `handle` never throws: every failure is a typed
 * {@link GatewayHttpResponse}.
 */
export function createGatewayServer(
  engine: NativeMediaEngine,
  options: GatewayOptions = {},
): GatewayServer {
  return new GatewayServerImpl(engine, options);
}
