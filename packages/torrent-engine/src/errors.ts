/**
 * @wfx/torrent-engine — error taxonomy (R11).
 *
 * The closed error vocabulary of the torrent engine boundary. Every failure
 * that crosses the public API is a `TorrentEngineError` carrying a
 * `TorrentEngineErrorCode`, an optional `detail`, the `sessionId` when
 * known, and a table-derived `retryable` flag. Operational failures are
 * typed VALUES surfaced through the API (and through the recovery
 * journal's `evidence` channel); they are never swallowed and never
 * converted into fake success.
 *
 * COVERAGE (one code per honest failure mode):
 * - `UNAUTHORIZED_SOURCE`     — invariant 5: the ingestion carried no
 *   provenance, or the provenance did not name a known authorized source/vault.
 *   STRUCTURAL — the public `ingestMagnet`/`ingestTorrentFile` API requires
 *   a `provenance` argument so the call site cannot even TYPE-CHECK without
 *   one. This code is the runtime mirror for provenances that resolve to
 *   `unknown` (a typed rejection, never a warning).
 * - `INVALID_INPUT`           — the caller's arguments are malformed (bad
 *   magnet URI, malformed .torrent bytes, bad session id, …).
 * - `UNSUPPORTED_SOURCE`      — the engine cannot handle this source shape
 *   (e.g. a v1 .torrent with no `info` dictionary).
 * - `NOT_FOUND`               — the referenced session/metadata/file does
 *   not exist.
 * - `METADATA_FAILED`         — the mature library could not parse the
 *   magnet/.torrent metadata (the J21–J25 "metadata" step's honest failure).
 * - `INTEGRITY_FAILED`        — piece hash verification or the final
 *   whole-asset digest mismatched (the J24 "integrity verification" failure).
 * - `DATA_VANISHED`           — the persisted data directory for a session
 *   disappeared (the honest failure of a vanished state, never a silent
 *   restart from zero — the R10 recovery law, mirrored here).
 * - `IO_ERROR`                — a read/write against local storage failed
 *   (transient — disk full, EACCES, ENOSPC, …).
 * - `SESSION_CLOSED`          — the session is closed/terminal; no further
 *   operations.
 * - `INTERNAL`                — an unexpected internal fault (engine bug,
 *   malformed internal state).
 *
 * The taxonomy is the torrent-engine-LOCAL mirror of the R10 native-media
 * `NativeMediaError` codes: the adapter (adapter.ts) maps these onto the
 * native-media vocabulary before landing assets in the store, so the
 * native-media-facing surface stays coherent.
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const TORRENT_ENGINE_ERROR_CODES = [
  "UNAUTHORIZED_SOURCE",
  "INVALID_INPUT",
  "UNSUPPORTED_SOURCE",
  "NOT_FOUND",
  "METADATA_FAILED",
  "INTEGRITY_FAILED",
  "DATA_VANISHED",
  "IO_ERROR",
  "SESSION_CLOSED",
  "INTERNAL",
] as const;

export type TorrentEngineErrorCode = (typeof TORRENT_ENGINE_ERROR_CODES)[number];

/** Runtime guard for the closed code union. */
export function isTorrentEngineErrorCode(x: unknown): x is TorrentEngineErrorCode {
  return (
    typeof x === "string" &&
    (TORRENT_ENGINE_ERROR_CODES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Retryability table
// ---------------------------------------------------------------------------

/**
 * Codes for which retrying the same operation may plausibly succeed:
 * transient transport failures (`IO_ERROR`). Every other code describes a
 * condition that will not change on retry (unauthorized source, bad input,
 * missing metadata, integrity failure, vanished data, closed session,
 * unsupported source, or an internal bug).
 *
 * `METADATA_FAILED` is NOT retryable: the mature library's parse verdict
 * is deterministic for the same input — a re-parse will return the same
 * failure (the operation is a pure function of the bytes). A network-based
 * metadata fetch (magnet → metadata via DHT/trackers) would be retryable,
 * but the loopback production path does not exercise that path; the
 * production deployment may revise the verdict at R12.
 */
export const RETRYABLE_ERROR_CODES: readonly TorrentEngineErrorCode[] = ["IO_ERROR"];

/** Is an error with this code retryable? The single source of truth. */
export function isRetryable(code: TorrentEngineErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(code);
}

// ---------------------------------------------------------------------------
// TorrentEngineError
// ---------------------------------------------------------------------------

/** Construction options for {@link TorrentEngineError}. */
export interface TorrentEngineErrorOptions {
  /** Human-readable context; never a stack trace. */
  detail?: string;
  /** The torrent session the error concerns, when known. */
  sessionId?: string;
  /** Underlying cause (e.g. the raw library error), preserved for logs. */
  cause?: unknown;
}

/**
 * The typed error of the torrent engine boundary. Carries
 * `{ code, detail?, sessionId?, retryable }`; `retryable` is always derived
 * from the code table so the flag can never drift from the taxonomy.
 */
export class TorrentEngineError extends Error {
  readonly code: TorrentEngineErrorCode;
  // `declare` keeps the optional fields truly ABSENT (not undefined slots)
  // until they are actually provided.
  declare readonly detail?: string;
  declare readonly sessionId?: string;
  readonly retryable: boolean;

  constructor(code: TorrentEngineErrorCode, options: TorrentEngineErrorOptions = {}) {
    const { detail, sessionId, cause } = options;
    super(
      detail === undefined
        ? `TorrentEngineError: ${code}`
        : `TorrentEngineError: ${code}: ${detail}`,
      { cause },
    );
    this.name = "TorrentEngineError";
    this.code = code;
    this.retryable = isRetryable(code);
    // exactOptionalPropertyTypes: never materialize `detail: undefined`.
    if (detail !== undefined) this.detail = detail;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/**
 * Narrow an unknown value to a {@link TorrentEngineError}. Accepts real
 * instances and structurally valid lookalikes (errors that crossed a
 * serialization/worker boundary). Rejects plain `Error`s, impostor
 * objects, and non-objects.
 */
export function isTorrentEngineError(x: unknown): x is TorrentEngineError {
  if (x instanceof TorrentEngineError) return true;
  if (typeof x !== "object" || x === null) return false;
  const candidate = x as Record<string, unknown>;
  if (candidate.name !== "TorrentEngineError") return false;
  if (!isTorrentEngineErrorCode(candidate.code)) return false;
  if (typeof candidate.retryable !== "boolean") return false;
  if (candidate.detail !== undefined && typeof candidate.detail !== "string") {
    return false;
  }
  if (
    candidate.sessionId !== undefined &&
    typeof candidate.sessionId !== "string"
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------

/** A typed `INVALID_INPUT` error (the most common programmer error). */
export function invalidInput(detail: string): TorrentEngineError {
  return new TorrentEngineError("INVALID_INPUT", { detail });
}

/** A typed `UNAUTHORIZED_SOURCE` error (invariant 5's runtime mirror). */
export function unauthorizedSource(detail: string): TorrentEngineError {
  return new TorrentEngineError("UNAUTHORIZED_SOURCE", { detail });
}

// ---------------------------------------------------------------------------
// InvalidTransitionError (session FSM programmer error)
// ---------------------------------------------------------------------------

/**
 * Thrown by the torrent session state machine when a transition is not
 * allowed (unknown state or illegal hop). A programmer error in pure
 * logic — never an engine-envelope error. Mirrors the R10 native-media
 * `InvalidTransitionError` precedent.
 */
export class InvalidTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `InvalidTransitionError: torrent session state '${from}' cannot transition to '${to}'`,
    );
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}
