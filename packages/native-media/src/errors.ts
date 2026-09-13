/**
 * @wfx/native-media — error taxonomy (WFX-004, Lane B).
 *
 * The closed error vocabulary of the native media service. Every failure
 * that crosses the service boundary is a `NativeMediaError` carrying a
 * `NativeMediaErrorCode`, an optional `detail`, the `sessionId` when known,
 * and a table-derived `retryable` flag. Operational failures are typed
 * VALUES inside `ServiceResponse` envelopes (see service.ts); they are
 * never swallowed and never converted into fake success.
 *
 * `InvalidTransitionError` is deliberately NOT a `NativeMediaError`: an
 * illegal session-state transition is a programmer error in pure session
 * logic (mirroring the Connector SDK's LifecycleError precedent) and is
 * thrown, not enveloped.
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * The closed set of native media error codes.
 *
 * - `INVALID_INPUT`        — the caller's arguments are malformed.
 * - `UNSUPPORTED_SOURCE`   — the engine/service cannot handle this media source.
 * - `NOT_FOUND`            — the referenced session/media does not exist.
 * - `IO_ERROR`             — a read/write against local storage failed (transient).
 * - `VERIFICATION_FAILED`  — integrity verification of media bytes failed.
 * - `RANGE_NOT_SATISFIABLE`— a byte range cannot be satisfied against the media size.
 * - `SESSION_CLOSED`       — the session is closed/terminal; no further operations.
 * - `ENGINE_TIMEOUT`       — the engine did not answer within its deadline (transient).
 * - `INTERNAL`             — an unexpected internal fault (engine bug, malformed engine data).
 */
export const NATIVE_MEDIA_ERROR_CODES = [
  "INVALID_INPUT",
  "UNSUPPORTED_SOURCE",
  "NOT_FOUND",
  "IO_ERROR",
  "VERIFICATION_FAILED",
  "RANGE_NOT_SATISFIABLE",
  "SESSION_CLOSED",
  "ENGINE_TIMEOUT",
  "INTERNAL",
] as const;

export type NativeMediaErrorCode = (typeof NATIVE_MEDIA_ERROR_CODES)[number];

/** Runtime guard for the closed code union. */
export function isNativeMediaErrorCode(x: unknown): x is NativeMediaErrorCode {
  return (
    typeof x === "string" &&
    (NATIVE_MEDIA_ERROR_CODES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Retryability table
// ---------------------------------------------------------------------------

/**
 * Codes for which retrying the same operation may plausibly succeed:
 * transient transport failures (`IO_ERROR`) and missed engine deadlines
 * (`ENGINE_TIMEOUT`). Every other code describes a condition that will not
 * change on retry (bad input, missing media, integrity failure, closed
 * session, unsupported source, or an internal bug).
 */
export const RETRYABLE_ERROR_CODES: readonly NativeMediaErrorCode[] = [
  "IO_ERROR",
  "ENGINE_TIMEOUT",
];

/**
 * Is an error with this code retryable? The single source of truth for the
 * `retryable` flag carried by every `NativeMediaError`.
 */
export function isRetryable(code: NativeMediaErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(code);
}

// ---------------------------------------------------------------------------
// NativeMediaError
// ---------------------------------------------------------------------------

/** Construction options for {@link NativeMediaError}. */
export interface NativeMediaErrorOptions {
  /** Human-readable context; never a stack trace. */
  detail?: string;
  /** The media session the error concerns, when known. */
  sessionId?: string;
  /** Underlying cause (e.g. the raw engine error), preserved for logs. */
  cause?: unknown;
}

/**
 * The typed error of the native media service boundary. Carries
 * `{ code, detail?, sessionId?, retryable }`; `retryable` is always derived
 * from the code table so the flag can never drift from the taxonomy.
 */
export class NativeMediaError extends Error {
  readonly code: NativeMediaErrorCode;
  // `declare` keeps the optional fields truly ABSENT (not undefined slots)
  // until they are actually provided.
  declare readonly detail?: string;
  declare readonly sessionId?: string;
  readonly retryable: boolean;

  constructor(code: NativeMediaErrorCode, options: NativeMediaErrorOptions = {}) {
    const { detail, sessionId, cause } = options;
    super(
      detail === undefined
        ? `NativeMediaError: ${code}`
        : `NativeMediaError: ${code}: ${detail}`,
      { cause },
    );
    this.name = "NativeMediaError";
    this.code = code;
    this.retryable = isRetryable(code);
    // exactOptionalPropertyTypes: never materialize `detail: undefined`.
    if (detail !== undefined) this.detail = detail;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/**
 * Narrow an unknown value to a {@link NativeMediaError}.
 *
 * Accepts real instances (fast path) and structurally valid lookalikes
 * (e.g. errors that crossed a serialization/worker boundary), mirroring the
 * runtime-shape guard style of the Connector SDK. Rejects plain `Error`s,
 * impostor objects, and non-objects.
 */
export function isNativeMediaError(x: unknown): x is NativeMediaError {
  if (x instanceof NativeMediaError) return true;
  if (typeof x !== "object" || x === null) return false;
  const candidate = x as Record<string, unknown>;
  if (candidate.name !== "NativeMediaError") return false;
  if (!isNativeMediaErrorCode(candidate.code)) return false;
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
// InvalidTransitionError (session FSM programmer error)
// ---------------------------------------------------------------------------

/**
 * Thrown by the session state machine when a transition is not allowed
 * (unknown state or illegal hop). A programmer error in pure logic — never
 * a service envelope error. `from`/`to` are plain strings because runtime
 * callers may pass garbage that is not a valid session state.
 */
export class InvalidTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `InvalidTransitionError: session state '${from}' cannot transition to '${to}'`,
    );
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}
