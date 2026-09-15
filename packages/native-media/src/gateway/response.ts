/**
 * @wfx/native-media — gateway response builder (WFX-015, Lane B).
 *
 * `buildRangeResponse(asset, request)` is the PURE verdict stage of the
 * local HTTP range/media gateway: it turns a media asset descriptor plus a
 * parsed request into a typed {@link GatewayResponse} — status, headers,
 * and a body DESCRIPTOR (`{ assetId, offset, length }`) — with NO socket
 * I/O and no byte materialization (the transport-agnostic handler in
 * server.ts resolves the descriptor into actual bytes through the engine
 * service envelope).
 *
 * Verdicts (RFC 9110 semantics):
 * - FULL request (no Range) -> `200` with `Content-Length: total`,
 *   `Accept-Ranges: bytes`, a deterministic `ETag` (FNV-1a of
 *   assetId+version, see bytes.ts) and the `Content-Type` from asset
 *   metadata.
 * - Satisfiable single range -> `206` with
 *   `Content-Range: bytes s-e/total` and `Content-Length: span`. Open
 *   (`bytes=a-`) and suffix (`bytes=-n`) forms are resolved against
 *   `totalBytes` by the MERGED WFX-004 `satisfiable`/`resolveRange` —
 *   reuse, not duplication; an end byte past EOF truncates; a suffix
 *   longer than the media resolves to the whole media.
 * - `If-None-Match` matching the current ETag -> `304` typed verdict with
 *   the ETag and NO body (weak comparison; `If-Modified-Since` is
 *   pass-through only — the gateway owns no last-modified timestamp).
 * - Range beyond EOF (unsatisfiable against the media size) -> `416` typed
 *   verdict with `Content-Range: bytes *\/total` and a machine-readable
 *   `detail` reason.
 *
 * Malformed arguments (garbage asset, malformed selection) throw a typed
 * `INVALID_INPUT` `NativeMediaError` — the merged `range.ts`
 * never-fabricate discipline. This is a programmer-error path: header-level
 * malformed ranges are caught earlier by `parseRangeRequest` (request.ts)
 * and never reach this builder.
 */

import { NativeMediaError } from "../errors";
import { resolveRange, satisfiable, type RangeRequest } from "../range";

import { contentRange, etagFor, unsatisfiableContentRange } from "./bytes";
import {
  ifNoneMatchMatches,
  type ParsedRangeRequest,
  type RangeSelection,
} from "./request";

// ---------------------------------------------------------------------------
// Asset + request shapes
// ---------------------------------------------------------------------------

/**
 * The media asset descriptor the verdict stage reasons over. `assetId` and
 * the media stat come from the engine (session + statMedia); `version` is
 * the representation version the caller derives deterministically (the
 * frozen engine surface exposes no version primitive — see server.ts for
 * the derivation and its documented limits).
 */
export interface GatewayAsset {
  /** The engine session's asset identity (e.g. `sim-asset-<seed>`). */
  assetId: string;
  /** Representation version token — changes when the bytes change. */
  version: string;
  /** Total size of the asset in bytes (positive safe integer). */
  totalBytes: number;
  /** Media content type from asset metadata (e.g. `video/mp4`). */
  contentType: string;
}

/**
 * A session-scoped media request: the parsed request plus the engine
 * session the asset is served through. The session id is required because
 * range resolution REUSES the merged WFX-004 `RangeRequest` shape
 * (`{ sessionId, startByte, endByte? }`) verbatim — no parallel typing.
 */
export interface GatewayMediaRequest extends ParsedRangeRequest {
  /** The engine session serving this asset. */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** Plain string-valued response headers (lowercase names). */
export type GatewayHeaders = Record<string, string>;

/**
 * WHERE the response body comes from — not the bytes themselves. The
 * transport-agnostic handler resolves the descriptor by reading
 * `[offset, offset + length - 1]` from the engine session's range reads.
 */
export interface GatewayBodyDescriptor {
  /** The asset the bytes are read from. */
  assetId: string;
  /** Inclusive-first-byte offset into the asset. */
  offset: number;
  /** Body length in bytes (`end - start + 1`). */
  length: number;
}

/**
 * The pure verdict of the response builder. Every variant carries the
 * exact headers the transport must serialize; `200`/`206` carry a body
 * descriptor, `304` carries no body, and `416` carries a typed
 * machine-readable detail (no body descriptor — no byte can be served).
 */
export type GatewayResponse =
  | { status: 200; headers: GatewayHeaders; body: GatewayBodyDescriptor }
  | { status: 206; headers: GatewayHeaders; body: GatewayBodyDescriptor }
  | { status: 304; headers: GatewayHeaders }
  | { status: 416; headers: GatewayHeaders; detail: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate an asset descriptor; throws typed `INVALID_INPUT` on garbage. */
function validateAsset(asset: GatewayAsset): void {
  if (typeof asset !== "object" || asset === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: asset must be an object",
    });
  }
  if (typeof asset.assetId !== "string" || asset.assetId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: assetId must be a non-empty string",
    });
  }
  if (typeof asset.version !== "string" || asset.version.length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: version must be a non-empty string",
    });
  }
  if (!Number.isSafeInteger(asset.totalBytes) || asset.totalBytes <= 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `buildRangeResponse: totalBytes must be a positive safe integer (got ${String(asset.totalBytes)})`,
    });
  }
  if (typeof asset.contentType !== "string" || asset.contentType.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: contentType must be a non-empty string",
    });
  }
}

/** Validate a session-scoped request; throws typed `INVALID_INPUT` on garbage. */
function validateMediaRequest(request: GatewayMediaRequest): void {
  if (typeof request !== "object" || request === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: request must be an object",
    });
  }
  if (typeof request.sessionId !== "string" || request.sessionId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: sessionId must be a non-empty string",
    });
  }
  if (typeof request.selection !== "object" || request.selection === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "buildRangeResponse: selection must be an object",
    });
  }
}

// ---------------------------------------------------------------------------
// Selection -> merged WFX-004 RangeRequest
// ---------------------------------------------------------------------------

/**
 * Convert the parsed selection into the MERGED WFX-004 `RangeRequest`
 * shape, reusing the merged suffix/open-range encoding (negative start =
 * suffix; absent end = through EOF). Returns `null` when the selection
 * carries values no parse could have produced (e.g. a suffix form with an
 * explicit end byte, or non-safe integers) — a programmer error surfaced
 * as a typed `INVALID_INPUT` by the caller.
 */
function selectionToMergedRange(
  selection: RangeSelection,
  sessionId: string,
): RangeRequest | null {
  if (selection.kind !== "range") return null;
  if (!Number.isSafeInteger(selection.start)) return null;
  if (selection.end !== undefined) {
    if (!Number.isSafeInteger(selection.end)) return null;
    if (selection.start < 0) return null; // suffix form never carries an end
    if (selection.end < selection.start) return null;
    return { sessionId, startByte: selection.start, endByte: selection.end };
  }
  return { sessionId, startByte: selection.start };
}

// ---------------------------------------------------------------------------
// buildRangeResponse
// ---------------------------------------------------------------------------

/**
 * Build the pure response verdict for one media request. See the module
 * docs for the 200/206/304/416 semantics. Throws a typed `INVALID_INPUT`
 * `NativeMediaError` for malformed asset/request arguments — never
 * fabricates a success.
 */
export function buildRangeResponse(
  asset: GatewayAsset,
  request: GatewayMediaRequest,
): GatewayResponse {
  validateAsset(asset);
  validateMediaRequest(request);

  const etag = etagFor(asset.assetId, asset.version);

  // 304 verdict first: a matching If-None-Match short-circuits range
  // evaluation (If-Range is deliberately ignored — typed pass-through in
  // request.ts — so the range is simply not applied).
  if (
    request.ifNoneMatch !== undefined &&
    ifNoneMatchMatches(request.ifNoneMatch, etag)
  ) {
    return { status: 304, headers: { ETag: etag } };
  }

  // Full request: 200 with the whole asset.
  if (request.selection.kind === "full") {
    return {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.totalBytes),
        "Accept-Ranges": "bytes",
        ETag: etag,
      },
      body: { assetId: asset.assetId, offset: 0, length: asset.totalBytes },
    };
  }

  // Single range: resolve through the MERGED WFX-004 helpers.
  const merged = selectionToMergedRange(request.selection, request.sessionId);
  if (merged === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `buildRangeResponse: selection ${JSON.stringify(request.selection)} is not a parseable single byte range`,
      sessionId: request.sessionId,
    });
  }
  if (!satisfiable(merged, asset.totalBytes)) {
    return {
      status: 416,
      headers: {
        "Content-Range": unsatisfiableContentRange(asset.totalBytes),
        "Accept-Ranges": "bytes",
        ETag: etag,
      },
      detail: `range ${JSON.stringify(request.selection)} is not satisfiable against ${asset.totalBytes} bytes`,
    };
  }
  const resolved = resolveRange(merged, asset.totalBytes);
  if (resolved === null) {
    // Unreachable: satisfiable() passed. Guard anyway — never fabricate.
    throw new NativeMediaError("INTERNAL", {
      detail: `buildRangeResponse: resolveRange returned null for a satisfiable range`,
      sessionId: request.sessionId,
    });
  }

  const length = resolved.endByte - resolved.startByte + 1;
  return {
    status: 206,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(length),
      "Content-Range": contentRange(resolved.startByte, resolved.endByte, asset.totalBytes),
      "Accept-Ranges": "bytes",
      ETag: etag,
    },
    body: {
      assetId: asset.assetId,
      offset: resolved.startByte,
      length,
    },
  };
}
