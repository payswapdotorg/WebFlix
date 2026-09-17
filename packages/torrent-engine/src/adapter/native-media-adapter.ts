/**
 * @wfx/torrent-engine — the native-media adapter (R11, THE NARROW SEAM).
 *
 * THE ONLY import path from torrent-engine into native-media-facing code.
 * The freeze's layering law puts the Torrent Engine BEHIND the native-media
 * boundary; R10's README names the contract: "R11's torrent engine becomes
 * an ASSET PRODUCER for this service: torrent downloads pre-stage their
 * bytes into the SAME store layout and hand the engine a `localPath`."
 *
 * What this adapter does (and nothing more):
 * - takes a COMPLETED, piece-verified session (state `completed` — the
 *   library verified every selected piece against the metainfo hashes, and
 *   the engine recorded per-file SHA-256 digests over the REAL bytes);
 * - imports each selected file into the R10 asset store via the store's own
 *   `importAsset` (stream-copy + SHA-256 + full re-hash verification);
 * - CROSS-CHECKS the engine's recorded digest against the store's own —
 *   both were computed over real bytes by the same algorithm; a mismatch
 *   is a typed failure, never a silent landing;
 * - returns the landed assets (assetId + contentPath + verdict) so the
 *   desktop's NATIVE rung plays torrent-acquired media through the SAME
 *   range gateway as local files.
 *
 * The boundary guard (tests/import-guard.test.ts) enforces that
 * `src/adapter/**` is the ONLY place in this package (and the only place
 * anywhere) where `@wfx/native-media` and torrent engine code meet.
 */

import {
  createAssetStore,
  isNativeMediaError,
  type AssetStore,
  type StoredAsset,
} from "@wfx/native-media";

import {
  TorrentEngineError,
  torrentError,
  type TorrentErrorCode,
  type TorrentResult,
} from "../errors";
import type { TorrentSessionStatus } from "../session";
import type { TorrentEngine } from "../engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One landed asset: what the native-media side now owns. */
export interface LandedTorrentAsset {
  /** The engine session that produced the bytes. */
  readonly sessionId: string;
  /** The torrent-relative file path that was landed. */
  readonly sourcePath: string;
  /** The stored asset (R10 store shape: meta + real content path). */
  readonly asset: StoredAsset;
  /** The digest the ENGINE recorded for these bytes (pre-landing). */
  readonly engineSha256: string;
}

/** The adapter's public surface. */
export interface TorrentEngineAdapter {
  /**
   * Land a completed session's selected files into the R10 asset store.
   * Typed refusals: unknown session (`NOT_FOUND`), non-completed session
   * (`INVALID_STATE` — bytes are only landed PROVEN), store failures
   * (mapped typed errors), and digest cross-check mismatch (`INTERNAL`
   * with the honest detail — the bytes changed between verification and
   * landing).
   */
  landCompletedSelection(input: {
    sessionId: string;
    /** Content type to record on the landed assets (default: octet-stream). */
    contentType?: string;
  }): Promise<TorrentResult<LandedTorrentAsset[]>>;

  /** The store's root (inspection; the engine never writes it directly). */
  readonly storeRoot: string;
}

/** Options for {@link createTorrentEngineAdapter}. */
export interface TorrentEngineAdapterOptions {
  /** The torrent engine whose completed sessions land in the store. */
  readonly engine: TorrentEngine;
  /**
   * The R10 asset store the bytes land in. Accepts an existing store
   * (share the engine service's store) or `{ storeRoot, maxBytes? }` to
   * construct one.
   */
  readonly store: AssetStore | { readonly root: string; readonly maxBytes?: number };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isAssetStore(x: unknown): x is AssetStore {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as AssetStore).importAsset === "function" &&
    typeof (x as AssetStore).contentPath === "function"
  );
}

function invalidAdapterInput(detail: string): TorrentEngineError {
  return new TorrentEngineError("INVALID_INPUT", { detail });
}

/**
 * Create the narrow native-media adapter. The store is the R10 asset store
 * (`createAssetStore` from `@wfx/native-media`) — bytes land through the
 * store's OWN import/verify path, so every landed asset carries a digest
 * and an integrity verdict derived from real bytes on both sides.
 */
export function createTorrentEngineAdapter(
  options: TorrentEngineAdapterOptions,
): TorrentEngineAdapter {
  if (typeof options !== "object" || options === null) {
    throw invalidAdapterInput("createTorrentEngineAdapter: options must be an object");
  }
  if (typeof options.engine !== "object" || options.engine === null) {
    throw invalidAdapterInput("createTorrentEngineAdapter: an engine must be provided");
  }
  const store: AssetStore = isAssetStore(options.store)
    ? options.store
    : createAssetStore({ root: options.store.root, ...(options.store.maxBytes !== undefined ? { maxBytes: options.store.maxBytes } : {}) });

  return {
    storeRoot: store.root,

    async landCompletedSelection(input: {
      sessionId: string;
      contentType?: string;
    }): Promise<TorrentResult<LandedTorrentAsset[]>> {
      if (typeof input !== "object" || input === null) {
        return torrentError("INVALID_INPUT", {
          detail: "landCompletedSelection: input must be an object",
        });
      }
      const status: TorrentResult<TorrentSessionStatus> = options.engine.status(input.sessionId);
      if (!status.ok) return status;
      if (status.value.state !== "completed") {
        return torrentError("INVALID_STATE", {
          sessionId: input.sessionId,
          detail:
            `landCompletedSelection: session '${input.sessionId}' is ${status.value.state}, not completed — ` +
            "only piece-verified completed selections land in the native-media store (never unproven bytes)",
        });
      }
      const digests = status.value.digests ?? [];
      if (digests.length === 0) {
        return torrentError("INTERNAL", {
          sessionId: input.sessionId,
          detail:
            `landCompletedSelection: completed session '${input.sessionId}' records no digests — the integrity contract is broken; refusing to land`,
        });
      }
      const landed: LandedTorrentAsset[] = [];
      for (const digest of digests) {
        const sourceDiskPath = `${status.value.dataDir}/${digest.path}`;
        // The store import: stream-copy + SHA-256 as the bytes land + a
        // full re-hash verification (the store's own law).
        const imported = await store.importAsset({
          sourcePath: sourceDiskPath,
          ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        });
        if (!imported.ok) {
          return torrentError(mapStoreCode(imported.error), {
            sessionId: input.sessionId,
            detail:
              `landCompletedSelection: importing '${digest.path}' into the native-media store failed: ${imported.error.detail}`,
            cause: imported.error,
          });
        }
        // THE CROSS-CHECK: the engine's digest (computed over the bytes on
        // disk at completion) vs the store's (computed as the bytes landed).
        // Both are SHA-256 over real bytes — they MUST agree.
        if (imported.asset.meta.sha256 !== digest.sha256) {
          return torrentError("INTERNAL", {
            sessionId: input.sessionId,
            detail:
              `landCompletedSelection: digest cross-check FAILED for '${digest.path}': the engine recorded ` +
              `${digest.sha256} but the store imported ${imported.asset.meta.sha256} — the bytes changed between ` +
              "verification and landing; the landing is refused (nothing about this asset may be trusted)",
          });
        }
        landed.push({
          sessionId: input.sessionId,
          sourcePath: digest.path,
          asset: imported.asset,
          engineSha256: digest.sha256,
        });
      }
      return { ok: true, value: landed };
    },
  };
}

/** Map a native-media store error onto the engine's closed vocabulary. */
function mapStoreCode(error: unknown): TorrentErrorCode {
  if (isNativeMediaError(error)) {
    if (error.code === "NOT_FOUND") return "NOT_FOUND";
    if (error.code === "INVALID_INPUT") return "INVALID_INPUT";
  }
  // The store's quota/disk/write failures are IO_ERROR (its catch-all for
  // real write failures); the original error rides along as `cause`.
  return "IO_ERROR";
}
