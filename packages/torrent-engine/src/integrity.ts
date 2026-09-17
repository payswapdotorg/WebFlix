/**
 * @wfx/torrent-engine — integrity verification (R11).
 *
 * TWO verification layers, both over REAL bytes (the R10 integrity
 * contract):
 *
 * 1. PIECE HASHES PER THE METAINFO — the mature library's own verification
 *    (invariant 6: the engine never reimplements the piece-hash critical
 *    path). The library reports `piece-verified` events; the engine
 *    journals them and derives honest progress. The deterministic loopback
 *    double performs the equivalent check (SHA-1 per piece against the
 *    fixture metainfo) so the test suite exercises the same contract.
 *
 * 2. THE FINAL WHOLE-ASSET DIGEST — SHA-256 over the landed bytes, using
 *    the SAME primitive and algorithm as the R10 native-media asset store
 *    (`Bun.CryptoHasher("sha256")`, hex — see
 *    packages/native-media/src/service-process/store.ts, `sha256Hex`). An
 *    asset that lands in the store therefore carries a verdict derived from
 *    bytes both sides hashed independently: the engine's recorded digest and
 *    the store's import-time digest MUST agree (the adapter asserts the
 *    cross-check).
 */

import { TorrentEngineError, torrentError, type TorrentResult } from "./errors";

// ---------------------------------------------------------------------------
// The digest primitive (R10-compatible)
// ---------------------------------------------------------------------------

/** The whole-asset digest algorithm (kept aligned with the R10 store). */
export const ASSET_DIGEST_ALGORITHM = "sha256" as const;

/**
 * SHA-256 hex digest of a byte buffer — the SAME primitive the R10 asset
 * store streams over content (`Bun.CryptoHasher` — a Bun builtin, no new
 * dependency). The compatibility law: `torrentSha256Hex(bytes) ===
 * sha256Hex(bytes)` from `@wfx/native-media`'s store module, byte for byte.
 */
export function torrentSha256Hex(data: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

/** A computed whole-asset digest over real bytes. */
export interface AssetDigest {
  /** The algorithm (always "sha256" — the R10 store's). */
  readonly algorithm: typeof ASSET_DIGEST_ALGORITHM;
  /** Lowercase hex digest of the file's real bytes. */
  readonly hex: string;
  /** The file's size on disk when hashed (real stat, not the metainfo). */
  readonly sizeBytes: number;
}

/**
 * Stream a REAL file from disk through SHA-256 — every byte is read (no
 * caching, no trust): the digest is derived from the bytes that are
 * actually there. Typed `IO_ERROR` on read failures (never a fabricated
 * digest).
 */
export async function digestFileAtPath(path: string): Promise<TorrentResult<AssetDigest>> {
  if (typeof path !== "string" || path.trim().length === 0) {
    return torrentError("INVALID_INPUT", {
      detail: "digestFileAtPath: path must be a non-empty string",
    });
  }
  try {
    const hasher = new Bun.CryptoHasher("sha256");
    let sizeBytes = 0;
    const file = Bun.file(path);
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      hasher.update(value);
      sizeBytes += value.byteLength;
    }
    return {
      ok: true,
      value: { algorithm: ASSET_DIGEST_ALGORITHM, hex: hasher.digest("hex"), sizeBytes },
    };
  } catch (e) {
    return torrentError("IO_ERROR", {
      detail: `digestFileAtPath: reading '${path}' failed: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

/** Type guard: is this a structurally valid {@link AssetDigest}? */
export function isAssetDigest(x: unknown): x is AssetDigest {
  if (typeof x !== "object" || x === null) return false;
  const candidate = x as Record<string, unknown>;
  return (
    candidate.algorithm === "sha256" &&
    typeof candidate.hex === "string" &&
    /^[0-9a-f]{64}$/.test(candidate.hex) &&
    typeof candidate.sizeBytes === "number" &&
    Number.isSafeInteger(candidate.sizeBytes) &&
    candidate.sizeBytes >= 0
  );
}

/** Re-exported for the adapter's cross-checks (typed error access). */
export { TorrentEngineError };
