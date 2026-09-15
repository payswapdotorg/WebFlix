/**
 * @wfx/connectors — the YouTube connector's typed failure taxonomy
 * (WFX-054, Lane B).
 *
 * The WFX-053 degradation contract applied to a provider API: every
 * operational failure is CLASSIFIED (typed) → SURFACED (a stable kind code
 * that survives the SDK mapping) → CONTAINED (no retry storms) → RECOVERED
 * (quota reset, credential refresh, or operator action). Raw HTTP bodies
 * and driver errors never leak upward.
 *
 * This module is the YouTube counterpart of @wfx/persistence's classify.ts:
 * a provider-local taxonomy that then maps onto the SDK's CLOSED
 * `ConnectorError` vocabulary (unsupported | unauthorized | transport |
 * invalid-input — packages/connectors/src/result.ts, deliberately NOT
 * extended by provider connectors). The mapping is total and observable:
 * every `YouTubeApiError` renders into the SDK surface with its stable
 * kind code embedded in the error detail (`youtube:<kind>:` prefix), so
 * hosts can classify degraded modes from receipts and results without
 * deep-importing this module.
 *
 * Quota semantics (the packet's typed quota-exceeded classification):
 * - `quota-exceeded` is the WFX-053 SUSPENSION family — the daily quota is
 *   exhausted, every costed call fails until the reset (midnight Pacific
 *   Time) or a quota-increase request. It maps to the SDK `transport`
 *   error (the operation did not complete against the source) with
 *   `retryable: true` and a detail that names the reset boundary; callers
 *   must NOT tight-loop retry.
 * - `rate-limit` (HTTP 429 / userRateLimitExceeded) is the REJECTION
 *   family — an individual operation refused; back off and retry later.
 */

import { invalidInput, transport, unauthorized, type ConnectorError } from "../result";

/** The closed failure taxonomy of the YouTube connector. */
export type YouTubeErrorKind =
  /** Daily quota exhausted (403, reason quotaExceeded / dailyLimitExceeded). */
  | "quota-exceeded"
  /** Per-user/per-minute rate limit (429, or 403 userRateLimitExceeded). */
  | "rate-limit"
  /** Google 5xx / network / timeout — the source is unreachable right now. */
  | "unavailable"
  /** 401 — the access token is missing, expired, or revoked. */
  | "unauthorized"
  /** 403 without a quota reason — forbidden (e.g. forbidden, forbiddenByOwner). */
  | "forbidden"
  /** 404 — the referenced resource does not exist. */
  | "not-found"
  /** 400 — the request we built was rejected (our bug or bad input). */
  | "bad-request"
  /** 2xx whose body does not match the documented API shape. */
  | "malformed-response";

/**
 * The typed, classified failure of one YouTube API interaction. Carries the
 * stable `kind` code plus everything known about the failure; never carries
 * response bodies verbatim (they can be large and are re-derivable).
 */
export class YouTubeApiError extends Error {
  /** The stable classification (the code hosts switch on). */
  public readonly kind: YouTubeErrorKind;
  /** HTTP status when a response arrived (undefined for network failures). */
  public readonly status: number | undefined;
  /** The provider's machine-readable reason (error.errors[0].reason). */
  public readonly reason: string | undefined;
  /**
   * Whether a LATER attempt can succeed (quota reset, backoff, credential
   * refresh). `false` for bad-request / malformed-response / unauthorized
   * (retrying the same request cannot fix those).
   */
  public readonly retryable: boolean;

  constructor(input: {
    kind: YouTubeErrorKind;
    detail: string;
    status?: number;
    reason?: string;
    retryable: boolean;
  }) {
    // exactOptionalPropertyTypes: never materialize undefined fields.
    const message =
      input.reason === undefined
        ? `${input.kind}: ${input.detail}`
        : `${input.kind} (${input.reason}): ${input.detail}`;
    super(message);
    this.name = "YouTubeApiError";
    this.kind = input.kind;
    this.status = input.status;
    this.reason = input.reason;
    this.retryable = input.retryable;
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** The documented Google error body (both the Data API and OAuth2 use it). */
export interface YouTubeErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: {
      message?: string;
      domain?: string;
      reason?: string;
      location?: string;
      locationType?: string;
    }[];
  };
}

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"]);
const RATE_REASONS = new Set([
  "userRateLimitExceeded",
  "rateLimitExceeded",
]);

/** Well-formedness check for values claimed to be a Google error body. */
export function isYouTubeErrorBody(value: unknown): value is YouTubeErrorBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const error = (value as { error?: unknown }).error;
  if (error === undefined) return false;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return false;
  return true;
}

function firstReason(body: YouTubeErrorBody | undefined): string | undefined {
  const errors = body?.error?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const reason = errors[0]?.reason;
  return typeof reason === "string" && reason.length > 0 ? reason : undefined;
}

function errorMessage(body: YouTubeErrorBody | undefined, fallback: string): string {
  const message = body?.error?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/**
 * Classify a completed HTTP exchange with the Data API / OAuth2 endpoints.
 * `bodyText` is parsed leniently: an unparseable error body degrades to the
 * status-based classification, never to a thrown JSON error.
 */
export function classifyYouTubeHttpStatus(
  status: number,
  bodyText: string,
): YouTubeApiError {
  let body: YouTubeErrorBody | undefined;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isYouTubeErrorBody(parsed)) body = parsed;
  } catch {
    // Not JSON — classify on status alone.
  }
  const reason = firstReason(body);
  const message = errorMessage(body, `HTTP ${status}`);

  if (status === 400) {
    return new YouTubeApiError({
      kind: "bad-request",
      detail: message,
      status,
      ...(reason !== undefined ? { reason } : {}),
      retryable: false,
    });
  }
  if (status === 401) {
    return new YouTubeApiError({
      kind: "unauthorized",
      detail: message,
      status,
      ...(reason !== undefined ? { reason } : {}),
      retryable: false,
    });
  }
  if (status === 403) {
    if (reason !== undefined && QUOTA_REASONS.has(reason)) {
      return new YouTubeApiError({
        kind: "quota-exceeded",
        detail:
          `${message} — daily quota exhausted; the default quota resets at midnight ` +
          `Pacific Time. No costed call will succeed until the reset; do not retry in a loop.`,
        status,
        reason,
        retryable: true,
      });
    }
    if (reason !== undefined && RATE_REASONS.has(reason)) {
      return new YouTubeApiError({
        kind: "rate-limit",
        detail: `${message} — back off and retry later.`,
        status,
        reason,
        retryable: true,
      });
    }
    return new YouTubeApiError({
      kind: "forbidden",
      detail: message,
      status,
      ...(reason !== undefined ? { reason } : {}),
      retryable: false,
    });
  }
  if (status === 404) {
    return new YouTubeApiError({
      kind: "not-found",
      detail: message,
      status,
      ...(reason !== undefined ? { reason } : {}),
      retryable: false,
    });
  }
  if (status === 429) {
    return new YouTubeApiError({
      kind: "rate-limit",
      detail: `${message} — back off and retry later.`,
      status,
      ...(reason !== undefined ? { reason } : {}),
      retryable: true,
    });
  }
  if (status >= 500) {
    return new YouTubeApiError({
      kind: "unavailable",
      detail: `${message} — the YouTube API is temporarily unavailable (backend error).`,
      status,
      ...(reason !== undefined ? { reason } : {}),
      retryable: true,
    });
  }
  // Any other non-2xx: an unexpected contract break — treat as unavailable
  // (retryable) and name the status so the drift is visible.
  return new YouTubeApiError({
    kind: "unavailable",
    detail: `unexpected HTTP ${status}: ${message}`,
    status,
    ...(reason !== undefined ? { reason } : {}),
    retryable: true,
  });
}

/**
 * Classify a transport-level failure (fetch rejection, timeout, abort) —
 * the WFX-053 DataSourceUnavailable family for a provider API.
 */
export function classifyYouTubeTransportFailure(thrown: unknown): YouTubeApiError {
  const detail =
    thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  return new YouTubeApiError({
    kind: "unavailable",
    detail: `network failure reaching the YouTube API: ${detail}`,
    retryable: true,
  });
}

/**
 * Build the typed malformed-response error for a 2xx body that does not
 * satisfy the documented API shape.
 */
export function youTubeMalformedResponse(detail: string): YouTubeApiError {
  return new YouTubeApiError({
    kind: "malformed-response",
    detail,
    retryable: false,
  });
}

// ---------------------------------------------------------------------------
// Mapping onto the SDK's closed ConnectorError vocabulary
// ---------------------------------------------------------------------------

/**
 * Map a classified YouTube failure onto the SDK's closed error vocabulary.
 *
 * | YouTube kind          | SDK kind        | rationale                                    |
 * |-----------------------|-----------------|----------------------------------------------|
 * | unauthorized          | unauthorized    | the operation needs credentials we lack      |
 * | bad-request           | invalid-input   | the caller-visible request shape is wrong    |
 * | quota-exceeded        | transport       | operation did not complete; kind code in the |
 * | rate-limit            | transport       |   detail (`youtube:<kind>: …`) so hosts can  |
 * | unavailable           | transport       |   surface degraded modes without deep imports|
 * | forbidden             | transport       |                                              |
 * | not-found             | transport       | (misses are handled BEFORE mapping — see the |
 * | malformed-response    | transport       |  connector's not-found paths)                 |
 *
 * The stable kind code always leads the SDK detail string, so a degraded
 * receipt/result names its cause: `youtube:quota-exceeded: …`.
 */
export function toConnectorError(error: YouTubeApiError): ConnectorError {
  switch (error.kind) {
    case "unauthorized":
      return unauthorized("youtube");
    case "bad-request":
      return invalidInput(`youtube:bad-request: ${error.message}`);
    default:
      return transport("youtube", `youtube:${error.kind}: ${error.message}`);
  }
}

/** Extract the stable `youtube:<kind>:` code from an SDK error detail, if present. */
export function youTubeKindFromDetail(detail: string): YouTubeErrorKind | null {
  const match = /^youtube:([a-z-]+):/.exec(detail);
  if (match === null) return null;
  const candidate = match[1] ?? "";
  const kinds: YouTubeErrorKind[] = [
    "quota-exceeded",
    "rate-limit",
    "unavailable",
    "unauthorized",
    "forbidden",
    "not-found",
    "bad-request",
    "malformed-response",
  ];
  return (kinds as string[]).includes(candidate) ? (candidate as YouTubeErrorKind) : null;
}
