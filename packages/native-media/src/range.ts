/**
 * @wfx/native-media — local HTTP range contract (WFX-004, Lane B).
 *
 * The byte-range vocabulary the native media service exposes for local
 * cache access, consumed by the HTTP gateway (WFX-015). It follows the
 * standard single-range semantics of RFC 9110 §14 ("Range"):
 *
 * - `bytes=a-b` — inclusive closed interval
 * - `bytes=a-`  — from `a` through the end of the media
 * - `bytes=-n`  — the LAST `n` bytes (suffix form)
 *
 * SUFFIX ENCODING: `parseRangeHeader` cannot resolve `bytes=-n` to a
 * concrete start byte without the media size, so a parsed suffix range is
 * encoded as a NEGATIVE `startByte` (e.g. `bytes=-500` -> `{ startByte:
 * -500 }`). `satisfiable` / `resolveRange` / `makeRangeResponse` resolve
 * the negative form against `totalBytes`. This convention is documented on
 * {@link RangeRequest.startByte} and is part of the contract.
 *
 * Everything here is pure: no I/O, no session state, no engine access.
 * Malformed input is either `null` (parse/satisfy predicates) or a typed
 * `NativeMediaError` (`INVALID_INPUT` / `RANGE_NOT_SATISFIABLE`) from the
 * response builders — never a fake success.
 */

import { NativeMediaError } from "./errors";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A parsed single byte-range: `bytes=a-b`, `bytes=a-`, or `bytes=-n`. */
export interface ParsedRangeHeader {
  /** Inclusive start byte; negative when the header was the suffix form. */
  startByte: number;
  /** Inclusive end byte; absent for `bytes=a-` and `bytes=-n`. */
  endByte?: number;
}

/**
 * A range request against a media session's local cache.
 * The HTTP gateway builds this from `parseRangeHeader` output.
 */
export interface RangeRequest {
  sessionId: string;
  /**
   * Inclusive start byte. NEGATIVE values encode the suffix form
   * ("the last |startByte| bytes"), as produced by
   * `parseRangeHeader("bytes=-n")`; they are resolved against `totalBytes`
   * by `satisfiable` / `resolveRange` / `makeRangeResponse`.
   */
  startByte: number;
  /** Inclusive end byte; omit for "through the end of the media". */
  endByte?: number;
}

/** A fully resolved range response, ready for HTTP serialization. */
export interface RangeResponse {
  sessionId: string;
  /** Inclusive first byte actually served (always resolved, never negative). */
  startByte: number;
  /** Inclusive last byte actually served (truncated to the media size). */
  endByte: number;
  /** Total size of the underlying media in bytes. */
  totalBytes: number;
  /** Media content type, e.g. `video/mp4`. */
  contentType: string;
  /** The served bytes. Passed through by reference — treat as immutable. */
  data: Uint8Array;
}

/** The media content backing a range response. */
export interface RangeContent {
  totalBytes: number;
  contentType: string;
  data: Uint8Array;
}

/** A concrete, resolved byte interval. */
export interface ResolvedRange {
  startByte: number;
  endByte: number;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Single-range header pattern: optional whitespace is tolerated, the unit
 * is matched case-insensitively, and both integer sides may be empty.
 * Multi-range headers (`bytes=0-1,5-9`) fail the pattern and parse to null.
 */
const RANGE_HEADER_PATTERN = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i;

/**
 * Parse a standard single-range `Range` header value.
 *
 * - `"bytes=0-499"` -> `{ startByte: 0, endByte: 499 }`
 * - `"bytes=500-"`  -> `{ startByte: 500 }`
 * - `"bytes=-500"`  -> `{ startByte: -500 }` (suffix form; last 500 bytes)
 * - anything malformed (wrong unit, reversed interval, `bytes=-`, `bytes=-0`,
 *   multi-range, non-integers, out-of-safe-range integers) -> `null`
 */
export function parseRangeHeader(header: string): ParsedRangeHeader | null {
  if (typeof header !== "string") return null;
  const match = RANGE_HEADER_PATTERN.exec(header.trim());
  if (match === null) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") return null; // "bytes=-" is not a range
  if (startText === "") {
    // Suffix form "bytes=-n": the last n bytes. Encoded as negative startByte.
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { startByte: -suffixLength };
  }
  const startByte = Number(startText);
  if (!Number.isSafeInteger(startByte) || startByte < 0) return null;
  if (endText === "") return { startByte };
  const endByte = Number(endText);
  if (!Number.isSafeInteger(endByte) || endByte < 0) return null;
  if (endByte < startByte) return null; // "bytes=10-5" is syntactically invalid
  return { startByte, endByte };
}

// ---------------------------------------------------------------------------
// Well-formedness / satisfiability
// ---------------------------------------------------------------------------

/**
 * Runtime shape check for a {@link RangeRequest}: non-empty `sessionId`,
 * safe-integer `startByte`, and (when present) a safe non-negative
 * `endByte` that is >= `startByte` and not combined with a suffix form.
 */
function isWellFormedRangeRequest(request: unknown): request is RangeRequest {
  if (typeof request !== "object" || request === null) return false;
  const r = request as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || r.sessionId.trim().length === 0) {
    return false;
  }
  if (!Number.isSafeInteger(r.startByte)) return false;
  const startByte = r.startByte as number;
  if (r.endByte === undefined) return true;
  if (!Number.isSafeInteger(r.endByte)) return false;
  const endByte = r.endByte as number;
  if (endByte < 0) return false;
  if (startByte < 0) return false; // suffix form must not carry an endByte
  return endByte >= startByte;
}

/**
 * Predicate: can `request` be satisfied against a media of `totalBytes`?
 *
 * Total and safe for runtime garbage: malformed requests and non-positive
 * or non-integer sizes answer `false`. A suffix longer than the media is
 * satisfiable (it resolves to the whole media, per RFC 9110); an interval
 * that starts beyond the last byte is not.
 */
export function satisfiable(request: RangeRequest, totalBytes: number): boolean {
  if (!isWellFormedRangeRequest(request)) return false;
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return false;
  if (request.startByte < 0) return request.endByte === undefined;
  if (request.endByte !== undefined && request.endByte < request.startByte) {
    return false;
  }
  return request.startByte < totalBytes;
}

/**
 * Resolve a request to a concrete inclusive interval, or `null` when the
 * request is malformed or unsatisfiable. Open and suffix forms are resolved
 * against `totalBytes`; an end byte past the media size is truncated.
 * Suffixes longer than the media resolve to the whole media.
 */
export function resolveRange(request: RangeRequest, totalBytes: number): ResolvedRange | null {
  if (!satisfiable(request, totalBytes)) return null;
  if (request.startByte < 0) {
    const suffixLength = -request.startByte;
    const startByte = suffixLength >= totalBytes ? 0 : totalBytes - suffixLength;
    return { startByte, endByte: totalBytes - 1 };
  }
  const endByte =
    request.endByte === undefined
      ? totalBytes - 1
      : Math.min(request.endByte, totalBytes - 1);
  return { startByte: request.startByte, endByte };
}

/**
 * Render a request back to its canonical header-ish form for error details
 * (e.g. `bytes=100-199`, `bytes=100-`, `bytes=-500`).
 */
export function describeRange(request: RangeRequest): string {
  if (request.startByte < 0) return `bytes=-${-request.startByte}`;
  if (request.endByte === undefined) return `bytes=${request.startByte}-`;
  return `bytes=${request.startByte}-${request.endByte}`;
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

/**
 * Build a {@link RangeResponse} from a request and the backing content.
 *
 * Throws typed errors — never fabricates a success:
 * - `INVALID_INPUT` for a malformed request or content, or for `data` whose
 *   length does not match the resolved span.
 * - `RANGE_NOT_SATISFIABLE` when the request cannot be satisfied against
 *   `totalBytes`.
 *
 * The `data` buffer is passed through BY REFERENCE (no copy — media ranges
 * can be large); callers must treat it as immutable.
 */
export function makeRangeResponse(
  request: RangeRequest,
  content: RangeContent,
): RangeResponse {
  if (!isWellFormedRangeRequest(request)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "makeRangeResponse: malformed range request",
    });
  }
  if (typeof content !== "object" || content === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "makeRangeResponse: content must be an object",
    });
  }
  const { totalBytes, contentType, data } = content;
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `makeRangeResponse: totalBytes must be a positive safe integer (got ${String(totalBytes)})`,
    });
  }
  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "makeRangeResponse: contentType must be a non-empty string",
    });
  }
  if (!(data instanceof Uint8Array)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "makeRangeResponse: data must be a Uint8Array",
    });
  }
  const resolved = resolveRange(request, totalBytes);
  if (resolved === null) {
    throw new NativeMediaError("RANGE_NOT_SATISFIABLE", {
      detail: `makeRangeResponse: range ${describeRange(request)} is not satisfiable against ${totalBytes} bytes`,
      sessionId: request.sessionId,
    });
  }
  const span = resolved.endByte - resolved.startByte + 1;
  if (data.length !== span) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `makeRangeResponse: data length ${data.length} does not match the resolved span ${span} (bytes ${resolved.startByte}-${resolved.endByte})`,
      sessionId: request.sessionId,
    });
  }
  return {
    sessionId: request.sessionId,
    startByte: resolved.startByte,
    endByte: resolved.endByte,
    totalBytes,
    contentType,
    data,
  };
}

/**
 * Render the `Content-Range` header value for a response:
 * `bytes <startByte>-<endByte>/<totalBytes>`. Throws `INVALID_INPUT` for a
 * malformed response object (bad ints, reversed interval, end byte beyond
 * the media, empty strings, missing data) — the header is never fabricated.
 */
export function contentRangeHeaderValue(resp: RangeResponse): string {
  if (typeof resp !== "object" || resp === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: response must be an object",
    });
  }
  const r = resp as unknown as Record<string, unknown>;
  const { sessionId, startByte, endByte, totalBytes, contentType, data } = r;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: sessionId must be a non-empty string",
    });
  }
  if (!Number.isSafeInteger(startByte) || (startByte as number) < 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: startByte must be a safe integer >= 0",
    });
  }
  if (
    !Number.isSafeInteger(endByte) ||
    (endByte as number) < (startByte as number)
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: endByte must be a safe integer >= startByte",
    });
  }
  if (
    !Number.isSafeInteger(totalBytes) ||
    (totalBytes as number) <= (endByte as number)
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: totalBytes must be a safe integer > endByte",
    });
  }
  if (typeof contentType !== "string" || (contentType as string).trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: contentType must be a non-empty string",
    });
  }
  if (!(data instanceof Uint8Array)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "contentRangeHeaderValue: data must be a Uint8Array",
    });
  }
  return `bytes ${(startByte as number)}-${(endByte as number)}/${(totalBytes as number)}`;
}
