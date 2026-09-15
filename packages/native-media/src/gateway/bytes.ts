/**
 * @wfx/native-media — gateway byte helpers (WFX-015, Lane B).
 *
 * Pure helpers shared by the local HTTP range/media gateway:
 * - `contentRange(start, end, total)` — render a `Content-Range` header
 *   value for a served interval (`bytes s-e/total`).
 * - `unsatisfiableContentRange(total)` — the RFC 9110 §14.5.2 form a 416
 *   response carries when no byte of the representation can be served
 *   (`bytes *\/total`).
 * - `etagFor(assetId, version)` — the DETERMINISTIC entity tag for a media
 *   asset: a 32-bit FNV-1a hash over `assetId` + version, rendered as the
 *   quoted opaque tag `"wfx-<hex>"`. No crypto dependency, no randomness —
 *   the same asset identity always yields the same validator.
 * - `validateRangeBounds(start, end, total)` — predicate for a concrete
 *   inclusive interval against a media size.
 *
 * Everything here is pure: no I/O, no clocks, no randomness. Malformed
 * arguments to the RENDERING helpers throw a typed `INVALID_INPUT`
 * `NativeMediaError` (the WFX-004 taxonomy) — the same never-fabricate
 * discipline as the merged `range.ts` header renderer. Note: the FNV-1a
 * implementation here is intentionally gateway-local; the WFX-014
 * simulation's `simulatedAssetSeed` is a frozen engine-internal seed
 * derivation and must not be coupled to gateway validators.
 */

import { NativeMediaError } from "../errors";

// ---------------------------------------------------------------------------
// FNV-1a (32-bit) — deterministic, dependency-free
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit hash of a UTF-16 string (code units), unsigned. The same
 * construction the WFX-014 simulation uses for registry keys, kept local
 * so gateway validators never depend on engine internals.
 */
export function fnv1a32(input: string): number {
  if (typeof input !== "string") {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "fnv1a32: input must be a string",
    });
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Entity tags
// ---------------------------------------------------------------------------

/** The separator joining asset identity and version inside the ETag input. */
const ETAG_INPUT_SEPARATOR = "\u0000";

/**
 * The deterministic entity tag for a media asset: FNV-1a over
 * `assetId + "\u0000" + version`, rendered as a strong (quoted) opaque tag
 * `"wfx-<8 hex digits>"`. Deterministic: identical `(assetId, version)`
 * pairs always produce identical tags, and any change to either input
 * changes the tag with overwhelming likelihood.
 */
export function etagFor(assetId: string, version: string): string {
  if (typeof assetId !== "string" || assetId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "etagFor: assetId must be a non-empty string",
    });
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "etagFor: version must be a non-empty string",
    });
  }
  const hash = fnv1a32(`${assetId}${ETAG_INPUT_SEPARATOR}${version}`);
  return `"wfx-${hash.toString(16).padStart(8, "0")}"`;
}

// ---------------------------------------------------------------------------
// Content-Range rendering
// ---------------------------------------------------------------------------

/**
 * Render the `Content-Range` value for a served inclusive interval:
 * `bytes <start>-<end>/<total>`. Throws `INVALID_INPUT` for a malformed
 * interval (non-safe integers, reversed bounds, end beyond the media) —
 * the header is never fabricated.
 */
export function contentRange(start: number, end: number, total: number): string {
  if (!validateRangeBounds(start, end, total)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `contentRange: [${String(start)}, ${String(end)}] is not a valid inclusive interval against ${String(total)} bytes`,
    });
  }
  return `bytes ${start}-${end}/${total}`;
}

/**
 * Render the `Content-Range` value a 416 response carries when the request
 * cannot be satisfied at all: `bytes *\/<total>`. Throws `INVALID_INPUT` for
 * a non-positive/non-safe-integer total.
 */
export function unsatisfiableContentRange(total: number): string {
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `unsatisfiableContentRange: total must be a positive safe integer (got ${String(total)})`,
    });
  }
  return `bytes */${total}`;
}

// ---------------------------------------------------------------------------
// Bounds validation
// ---------------------------------------------------------------------------

/**
 * Predicate: is `[start, end]` a concrete, satisfiable inclusive byte
 * interval against a media of `total` bytes? True iff all three are safe
 * integers, `total > 0`, `0 <= start <= end < total`. Total and safe for
 * runtime garbage.
 */
export function validateRangeBounds(start: number, end: number, total: number): boolean {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) {
    return false;
  }
  if (total <= 0) return false;
  if (start < 0 || end < start || end >= total) return false;
  return true;
}
