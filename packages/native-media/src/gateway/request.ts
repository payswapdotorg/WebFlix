/**
 * @wfx/native-media — gateway request parsing (WFX-015, Lane B).
 *
 * `parseRangeRequest(headers)` turns the transport-level header record of
 * an incoming media GET into a typed {@link ParsedRangeRequest}:
 *
 * - `Range` — SINGLE byte ranges only, reusing the MERGED WFX-004 parser
 *   (`parseRangeHeader`) — its types already cover this, so nothing is
 *   duplicated here. The parsed selection is:
 *   - `bytes=0-1023` -> `{ kind: "range", start: 0, end: 1023 }`
 *   - `bytes=0-`     -> `{ kind: "range", start: 0 }` (end absent = through EOF)
 *   - `bytes=-500`   -> `{ kind: "range", start: -500 }` (NEGATIVE start is
 *     the merged WFX-004 suffix encoding: "the last 500 bytes", resolved
 *     against the media size by the merged `satisfiable`/`resolveRange`).
 *   - absent `Range` -> `{ kind: "full" }`.
 * - MULTI-RANGE headers (`bytes=0-1,5-9`) are a DELIBERATE SCOPE CUT: the
 *   gateway serves single ranges only, so a multi-range header answers with
 *   a typed `RangeHeaderError` with reason `"unsupported"` — never a silent
 *   single-range truncation and never a full-file fallback.
 * - `If-Range` is DELIBERATELY IGNORED (same scope cut family): when
 *   present, its exact value is carried in `ignoredIfRange` so the
 *   non-handling is typed and observable, never silent.
 * - `If-None-Match` and `If-Modified-Since` are parsed and passed through
 *   for the response builder (304 verdicts are ETag-based; see response.ts).
 *
 * MALFORMED `Range` headers (`bytes=abc`, inverted `bytes=10-5`,
 * zero-length suffix `bytes=-0`, empty `bytes=-`, wrong units, unsafe
 * integers) answer with a typed `RangeHeaderError` with reason
 * `"malformed"` carrying the EXACT offending header value. The gateway
 * NEVER silently falls back to a full-file 200 for a malformed range —
 * players rely on status semantics.
 *
 * This module is pure: no I/O, no clocks, no randomness. Header lookup is
 * case-insensitive (transport glue normalizes keys to lowercase, but a
 * mixed-case record is still handled correctly).
 */

import { parseRangeHeader } from "../range";

// ---------------------------------------------------------------------------
// Header record
// ---------------------------------------------------------------------------

/**
 * The transport-level header record of one request. Keys SHOULD be
 * lowercase (the normal form every transport glue produces); lookup is
 * case-insensitive regardless. One value per name — transport glue must
 * combine repeated headers (e.g. two `Range` lines) with commas, which
 * then parses as a multi-range and answers with the typed scope cut.
 */
export type GatewayRequestHeaders = Readonly<Record<string, string>>;

/** Case-insensitive single header lookup; `undefined` when absent. */
export function headerValue(
  headers: GatewayRequestHeaders,
  name: string,
): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const lower = name.toLowerCase();
  const direct = headers[lower];
  if (direct !== undefined) return direct;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Typed range-header error (value inside the parse result — never thrown)
// ---------------------------------------------------------------------------

/** Why a `Range` header could not be honored. */
export type RangeHeaderErrorReason =
  /** The header is syntactically invalid (not a single well-formed byte range). */
  | "malformed"
  /** The header is well-formed but outside the gateway's single-range scope. */
  | "unsupported";

/**
 * A typed `Range` header failure. Named `RangeHeaderError` (not the packet's
 * literal `RangeError`) to avoid colliding with the JavaScript built-in of
 * that name. Carried as a VALUE inside `ParseRangeRequestResult` — external
 * input failures are operational results in this codebase (the envelope
 * style of the WFX-004 service), never thrown across module boundaries.
 */
export class RangeHeaderError extends Error {
  readonly reason: RangeHeaderErrorReason;
  /** The EXACT offending header value, preserved verbatim for the 416 body. */
  readonly header: string;

  constructor(reason: RangeHeaderErrorReason, header: string) {
    super(
      `RangeHeaderError: ${reason} Range header '${header}'` +
        (reason === "unsupported"
          ? " (the gateway serves single byte ranges only — multi-range is a documented scope cut)"
          : ""),
    );
    this.name = "RangeHeaderError";
    this.reason = reason;
    this.header = header;
  }
}

// ---------------------------------------------------------------------------
// Parsed shapes
// ---------------------------------------------------------------------------

/**
 * The range selection of a request:
 * - `{ kind: "full" }` — no `Range` header: the whole asset.
 * - `{ kind: "range", start, end? }` — one byte range. `start` is the
 *   inclusive start byte; a NEGATIVE `start` is the merged WFX-004 suffix
 *   encoding (`bytes=-n`, the last `n` bytes). `end` is the inclusive end
 *   byte and is ABSENT for `bytes=a-` and `bytes=-n` (through end of file).
 */
export type RangeSelection =
  | { kind: "full" }
  | { kind: "range"; start: number; end?: number };

/** A parsed `If-None-Match` header (RFC 9110 §13.1.2). */
export interface IfNoneMatch {
  /** `true` when the header was `*` (matches any current representation). */
  wildcard: boolean;
  /**
   * The parsed entity-tags with the weak prefix (`W/`) stripped, so list
   * comparison is the weak comparison HTTP requires for `If-None-Match` on
   * GET: `W/"x"` and `"x"` both match the current strong tag `"x"`.
   */
  etags: readonly string[];
}

/**
 * One fully parsed media request: the range selection plus the parsed
 * conditional (validation) headers, passed through to the response builder.
 */
export interface ParsedRangeRequest {
  /** The byte-range selection (full asset or a single range). */
  selection: RangeSelection;
  /** Parsed `If-None-Match`, when the header was present and parseable. */
  ifNoneMatch?: IfNoneMatch;
  /**
   * Parsed `If-Modified-Since` as epoch milliseconds, when the header was
   * present and held a parseable HTTP date. PASS-THROUGH ONLY: the gateway
   * owns no last-modified timestamp, so 304 verdicts are ETag-based
   * (`If-None-Match` wins per HTTP precedence anyway).
   */
  ifModifiedSince?: number;
  /**
   * The EXACT `If-Range` header value when present. `If-Range` is
   * DELIBERATELY IGNORED (single-range scope cut, documented): the value is
   * typed here so the non-handling is observable, never silent.
   */
  ignoredIfRange?: string;
}

/** The result of {@link parseRangeRequest}: typed success or typed failure. */
export type ParseRangeRequestResult =
  | { ok: true; request: ParsedRangeRequest }
  | { ok: false; error: RangeHeaderError };

// ---------------------------------------------------------------------------
// Conditional header parsing
// ---------------------------------------------------------------------------

/** Strip a leading weak marker (`W/`) for weak list comparison. */
function stripWeakPrefix(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/**
 * Parse an `If-None-Match` value. `*` -> wildcard; otherwise a
 * comma-separated entity-tag list (weak markers stripped for weak
 * comparison). An empty/garbage header answers `undefined` (absent — the
 * header is ignored, which is legal for unparseable validators).
 */
function parseIfNoneMatch(value: string): IfNoneMatch | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === "*") return { wildcard: true, etags: [] };
  const etags: string[] = [];
  for (const part of trimmed.split(",")) {
    const tag = stripWeakPrefix(part.trim());
    if (tag.length === 0) continue;
    etags.push(tag);
  }
  if (etags.length === 0) return undefined;
  return { wildcard: false, etags };
}

/**
 * Parse an `If-Modified-Since` HTTP date to epoch milliseconds. An
 * unparseable value answers `undefined` (recipients MAY ignore it).
 */
function parseHttpDate(value: string): number | undefined {
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Weak comparison of a parsed `If-None-Match` against the current entity
 * tag: `true` when the header was `*` or lists the tag (weakly). The
 * current tag is always a strong quoted tag produced by `etagFor`.
 */
export function ifNoneMatchMatches(inm: IfNoneMatch, etag: string): boolean {
  if (typeof etag !== "string" || etag.length === 0) return false;
  if (inm.wildcard) return true;
  return inm.etags.includes(etag);
}

// ---------------------------------------------------------------------------
// parseRangeRequest
// ---------------------------------------------------------------------------

/**
 * Parse the header record of a media GET into a typed
 * {@link ParsedRangeRequest}.
 *
 * - No `Range` header -> `{ kind: "full" }` plus parsed conditionals.
 * - A well-formed single range -> `{ kind: "range", ... }` (negative start
 *   = suffix form, absent end = through EOF — the merged WFX-004 encoding).
 * - A multi-range header (any comma in the value) -> typed `unsupported`
 *   failure with the exact header value (deliberate scope cut).
 * - A malformed header -> typed `malformed` failure with the exact header
 *   value — NEVER a silent full-file fallback.
 */
export function parseRangeRequest(
  headers: GatewayRequestHeaders,
): ParseRangeRequestResult {
  const range = headerValue(headers, "Range");
  let selection: RangeSelection = { kind: "full" };
  if (range !== undefined) {
    // A comma in a Range header value means a range-set with more than one
    // range (repeated header lines are combined with commas by transport
    // glue). Single-range-only scope cut: typed unsupported, never truncated.
    if (range.includes(",")) {
      return { ok: false, error: new RangeHeaderError("unsupported", range) };
    }
    // MERGED WFX-004 parser — its types already cover single ranges.
    const parsed = parseRangeHeader(range);
    if (parsed === null) {
      return { ok: false, error: new RangeHeaderError("malformed", range) };
    }
    selection =
      parsed.endByte === undefined
        ? { kind: "range", start: parsed.startByte }
        : { kind: "range", start: parsed.startByte, end: parsed.endByte };
  }

  const request: ParsedRangeRequest = { selection };

  const inm = headerValue(headers, "If-None-Match");
  if (inm !== undefined) {
    const parsed = parseIfNoneMatch(inm);
    if (parsed !== undefined) request.ifNoneMatch = parsed;
  }

  const ims = headerValue(headers, "If-Modified-Since");
  if (ims !== undefined) {
    const parsed = parseHttpDate(ims);
    if (parsed !== undefined) request.ifModifiedSince = parsed;
  }

  const ifRange = headerValue(headers, "If-Range");
  if (ifRange !== undefined) {
    // Deliberately ignored (typed, never silent) — see module docs.
    request.ignoredIfRange = ifRange;
  }

  return { ok: true, request };
}
