/**
 * @wfx/torrent-engine — the typed error/rejection taxonomy (R11).
 *
 * The closed error vocabulary of the torrent engine. Every failure that
 * crosses the engine's public boundary is a `TorrentEngineError` carrying a
 * `TorrentErrorCode`, an optional `detail`, the `sessionId` when known, and a
 * table-derived `retryable` flag — the same discipline as the R10
 * native-media taxonomy (`NativeMediaError`), deliberately mirrored so the
 * two native-media-lane packages read as one family.
 *
 * OPERATIONAL LAW (the remediation freeze):
 * - Failures are typed VALUES inside `TorrentResult` envelopes — never
 *   swallowed, never converted into fake success, never a bare warning.
 * - `PROVENANCE_REJECTED` is the invariant-5 code: an ingestion without
 *   authorization provenance is a TYPED REJECTION, structurally enforced
 *   (see provenance.ts) and re-validated at runtime on every ingest.
 * - `InvalidTorrentTransitionError` is deliberately NOT a
 *   `TorrentEngineError`: an illegal session-state hop is a programmer error
 *   in pure lifecycle logic (the R10 `InvalidTransitionError` precedent) and
 *   is thrown, not enveloped.
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * The closed set of torrent engine error codes.
 *
 * - `PROVENANCE_REJECTED` — invariant 5: the ingestion's provenance is
 *   missing, forged, or names a source that is not in the authorized-source
 *   registry. Authorized media only — never a warning.
 * - `INVALID_INPUT`        — the caller's arguments are malformed (registry
 *   construction, selection shape, ...).
 * - `INVALID_MAGNET`       — the magnet URI is malformed/unparseable.
 * - `INVALID_TORRENT_FILE` — the .torrent bytes are not valid bencoded
 *   metainfo (the mature library refused to decode them).
 * - `INVALID_SELECTION`    — the file selection is empty/out-of-range/
 *   duplicated, or unresolvable against the torrent's file list.
 * - `NOT_FOUND`            — the referenced session/ingestion does not exist
 *   (a stopped session answers this with the honest recovery hint).
 * - `SESSION_CLOSED`       — the session is terminal (`completed`/`failed`);
 *   no further lifecycle operations apply.
 * - `INVALID_STATE`        — the lifecycle command is illegal in the current
 *   state (e.g. pausing a completed session, a duplicate live session for
 *   the same infohash).
 * - `IO_ERROR`             — a local read/write failed (transient).
 * - `LIBRARY_ERROR`        — the mature protocol library reported a failure
 *   (peer loss, metadata failure, protocol error). Transient by default —
 *   the caller decides whether to stop or keep the session.
 * - `UNVERIFIED_RANGE`     — R12's ordered-read law: a byte-range read
 *   covers pieces that are not verified against the metainfo hashes yet;
 *   playback cannot consume unverified bytes, so the read is refused with
 *   the honest missing-piece list. Retryable: the same read may succeed
 *   once the swarm delivers and verifies the covering pieces.
 * - `INTERNAL`             — an unexpected internal fault (engine bug).
 */
export const TORRENT_ERROR_CODES = [
  "PROVENANCE_REJECTED",
  "INVALID_INPUT",
  "INVALID_MAGNET",
  "INVALID_TORRENT_FILE",
  "INVALID_SELECTION",
  "NOT_FOUND",
  "SESSION_CLOSED",
  "INVALID_STATE",
  "IO_ERROR",
  "LIBRARY_ERROR",
  "UNVERIFIED_RANGE",
  "INTERNAL",
] as const;

export type TorrentErrorCode = (typeof TORRENT_ERROR_CODES)[number];

/** Runtime guard for the closed code union. */
export function isTorrentErrorCode(x: unknown): x is TorrentErrorCode {
  return (
    typeof x === "string" &&
    (TORRENT_ERROR_CODES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Retryability table
// ---------------------------------------------------------------------------

/**
 * Codes for which retrying the same operation may plausibly succeed:
 * transient local I/O (`IO_ERROR`) and library-side failures
 * (`LIBRARY_ERROR` — peer/metadata/network conditions change). Every other
 * code describes a condition that will not change on retry (bad input,
 * unknown session, terminal session, provenance law, internal bug).
 */
export const RETRYABLE_TORRENT_ERROR_CODES: readonly TorrentErrorCode[] = [
  "IO_ERROR",
  "LIBRARY_ERROR",
  "UNVERIFIED_RANGE",
];

/** Is an error with this code retryable? (single source of truth) */
export function isRetryableTorrentError(code: TorrentErrorCode): boolean {
  return RETRYABLE_TORRENT_ERROR_CODES.includes(code);
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
  /** Underlying cause (e.g. the library's raw error), preserved for logs. */
  cause?: unknown;
}

/**
 * The typed error of the torrent engine boundary. Carries
 * `{ code, detail?, sessionId?, retryable }`; `retryable` is always derived
 * from the code table so the flag can never drift from the taxonomy.
 */
export class TorrentEngineError extends Error {
  readonly code: TorrentErrorCode;
  // `declare` keeps the optional fields truly ABSENT (not undefined slots)
  // until they are actually provided (exactOptionalPropertyTypes).
  declare readonly detail?: string;
  declare readonly sessionId?: string;
  readonly retryable: boolean;

  constructor(code: TorrentErrorCode, options: TorrentEngineErrorOptions = {}) {
    const { detail, sessionId, cause } = options;
    super(
      detail === undefined
        ? `TorrentEngineError: ${code}`
        : `TorrentEngineError: ${code}: ${detail}`,
      { cause },
    );
    this.name = "TorrentEngineError";
    this.code = code;
    this.retryable = isRetryableTorrentError(code);
    if (detail !== undefined) this.detail = detail;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/**
 * Narrow an unknown value to a {@link TorrentEngineError} (real instances
 * plus structurally valid lookalikes that crossed a boundary — the R10
 * `isNativeMediaError` precedent).
 */
export function isTorrentEngineError(x: unknown): x is TorrentEngineError {
  if (x instanceof TorrentEngineError) return true;
  if (typeof x !== "object" || x === null) return false;
  const candidate = x as Record<string, unknown>;
  if (candidate.name !== "TorrentEngineError") return false;
  if (!isTorrentErrorCode(candidate.code)) return false;
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
// The result envelope
// ---------------------------------------------------------------------------

/**
 * The result envelope for every torrent engine operation: success carries
 * `value`, failure carries a typed `TorrentEngineError` — the R10
 * `ServiceResponse` discipline (never a fake success, never a bare warning).
 */
export type TorrentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TorrentEngineError };

/** Internal helper: build a typed failure envelope. */
export function torrentError(
  code: TorrentErrorCode,
  options: TorrentEngineErrorOptions = {},
): TorrentResult<never> {
  return { ok: false, error: new TorrentEngineError(code, options) };
}

// ---------------------------------------------------------------------------
// InvalidTorrentTransitionError (lifecycle FSM programmer error)
// ---------------------------------------------------------------------------

/**
 * Thrown by the session state machine when a transition is not allowed
 * (unknown state or illegal hop). A programmer error in pure logic — never
 * an enveloped rejection (the R10 `InvalidTransitionError` precedent).
 * `from`/`to` are plain strings because runtime callers may pass garbage.
 */
export class InvalidTorrentTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `InvalidTorrentTransitionError: torrent session state '${from}' cannot transition to '${to}'`,
    );
    this.name = "InvalidTorrentTransitionError";
    this.from = from;
    this.to = to;
  }
}
