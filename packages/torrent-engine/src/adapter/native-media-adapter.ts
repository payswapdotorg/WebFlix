/**
 * @wfx/torrent-engine — the native-media adapter (R11, THE NARROW SEAM;
 * R13 — the library-exposure extension).
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
 * R13 — THE LIBRARY EXPOSURE SEAM (the same narrow path, extended):
 * - `exposeCompletedSelection` — the VERIFIED-BEFORE-READY gate: only a
 *   completed session's assets are exposed; every file imports + digest-
 *   cross-checks FIRST (atomic — a partial import never journals); ONE
 *   exposure batch then lands in the engine's journal (provenance from the
 *   JOURNALED session, the R04 canonical identity when the caller composed
 *   one), making the offline-ready entry DURABLE across restarts;
 * - `listOfflineReady` — the Library's read: the journal's offline-ready
 *   exposures (one per canonical identity — no duplicate identity ever)
 *   composed with the store's LIVE verdicts (recorded integrity + disk
 *   truth per asset);
 * - `verifyOfflineReadyEntry` — the full re-hash re-verification of one
 *   entry's asset (the retry/audit path: `Ready offline` is EARNED, and
 *   re-earning it is always possible).
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
import {
  offlineReadyIdentityKey,
  type ExposedTorrentExposure,
} from "../persistence";

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

/**
 * R13 — the R04 canonical-identity composition input: the caller (the
 * desktop composition root) derives both from the R04 library discipline —
 * the effective profile key (R04's `COALESCE(profile_id, 'user:' || user_id)`)
 * and the canonical item id the torrent realizes (R04's `item_id`).
 */
export interface LibraryIdentityInput {
  /** R04's effective-profile key of the owning profile. */
  readonly profileKey: string;
  /** R04's canonical item id this torrent realizes. */
  readonly canonicalItemId: string;
}

/** One verified asset exposed to the Library as offline-ready (R13). */
export interface OfflineReadyTorrentAsset {
  /** The engine session that produced the bytes. */
  readonly sessionId: string;
  /** v1 infohash of the source torrent. */
  readonly infoHash: string;
  /** The torrent-relative file path that was landed. */
  readonly sourcePath: string;
  /** The R10 store's asset identity. */
  readonly assetId: string;
  /** Where the store owns the bytes (absolute content path). */
  readonly contentPath: string;
  /** Size in bytes of the landed asset. */
  readonly sizeBytes: number;
  /** SHA-256 of the landed bytes (engine + store + journal all agree). */
  readonly sha256: string;
  /** The recorded content type, when one was given. */
  readonly contentType?: string;
  /** The acquisition provenance (invariant 5 — always inspectable). */
  readonly provenance: { readonly sourceId: string; readonly basis: string };
  /** The R04 canonical identity the exposure was composed with. */
  readonly library?: { readonly profileKey: string; readonly canonicalItemId: string };
  /** When the exposure landed (wall-clock epoch ms). */
  readonly exposedAt: number;
  /** EARNED at exposure: the store's import verification passed. */
  readonly integrity: "verified";
}

/** One asset of an offline-ready entry, with its LIVE store verdict (R13). */
export interface OfflineReadyAsset {
  readonly assetId: string;
  readonly sourcePath: string;
  readonly contentPath: string;
  /** Size in bytes as recorded at exposure. */
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly contentType?: string;
  /**
   * The LIVE verdict: the store's recorded integrity, or `vanished` when
   * the content is gone from disk (bytes deleted after exposure).
   */
  readonly integrity: "verified" | "failed" | "unknown" | "vanished";
  /** The CURRENT disk size (null when the content file is gone). */
  readonly sizeOnDisk: number | null;
}

/** One offline-ready Library entry (R13 — the `Ready offline` surface). */
export interface OfflineReadyEntry {
  /** The offline-ready identity key (canonical or session-scoped). */
  readonly key: string;
  /** The R04 canonical identity, when the exposure composed one. */
  readonly library?: { readonly profileKey: string; readonly canonicalItemId: string };
  /** The engine session that produced this realization. */
  readonly sessionId: string;
  /** v1 infohash of the source torrent. */
  readonly infoHash: string;
  /** The acquisition provenance (invariant 5 — always inspectable). */
  readonly provenance: { readonly sourceId: string; readonly basis: string };
  /** Every landed asset of this realization (latest exposure wins). */
  readonly assets: readonly OfflineReadyAsset[];
  /** When this exposure landed (wall-clock epoch ms). */
  readonly exposedAt: number;
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

  /**
   * R13 — THE VERIFIED-BEFORE-READY GATE + the durable Library exposure:
   * a completed session's verified assets become offline-ready entries.
   * Every file imports into the R10 store (stream-copy + SHA-256 + the
   * store's full re-hash) and digest-cross-checks FIRST — a failure at
   * any step refuses the WHOLE exposure (nothing journals; retry after
   * resolving the cause). Only then does ONE exposure batch land in the
   * engine's journal (durable across restarts; provenance from the
   * journaled session; the optional R04 canonical identity composes the
   * entry's Library key — one entry per canonical identity, duplicates
   * latest-wins).
   */
  exposeCompletedSelection(input: {
    sessionId: string;
    /** Content type to record on the exposed assets (default: octet-stream). */
    contentType?: string;
    /** The R04 canonical-identity composition (the Library's row key). */
    library?: LibraryIdentityInput;
  }): Promise<TorrentResult<OfflineReadyTorrentAsset[]>>;

  /**
   * R13 — the Library's offline-ready read: every journaled exposure (one
   * entry per identity key — no duplicate canonical identity), each asset
   * composed with the store's LIVE verdict (recorded integrity + disk
   * truth). Entries whose bytes vanished after exposure are surfaced
   * honestly (`integrity: "vanished"`) — never silently dropped.
   */
  listOfflineReady(): TorrentResult<readonly OfflineReadyEntry[]>;

  /**
   * R13 — the full re-hash re-verification of one exposed asset (the
   * retry/audit path): re-reads every stored byte and answers the FRESH
   * integrity verdict. `Ready offline` is EARNED — and re-earnable.
   */
  verifyOfflineReadyEntry(assetId: string): Promise<TorrentResult<{
    readonly assetId: string;
    readonly integrity: "verified" | "failed";
    readonly digest: string;
    readonly recordedDigest: string;
  }>>;

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

    async exposeCompletedSelection(input: {
      sessionId: string;
      contentType?: string;
      library?: LibraryIdentityInput;
    }): Promise<TorrentResult<OfflineReadyTorrentAsset[]>> {
      if (typeof input !== "object" || input === null) {
        return torrentError("INVALID_INPUT", {
          detail: "exposeCompletedSelection: input must be an object",
        });
      }
      if (input.library !== undefined) {
        if (
          typeof input.library.profileKey !== "string" ||
          input.library.profileKey.trim().length === 0 ||
          typeof input.library.canonicalItemId !== "string" ||
          input.library.canonicalItemId.trim().length === 0
        ) {
          return torrentError("INVALID_INPUT", {
            detail:
              "exposeCompletedSelection: the library identity must be { profileKey, canonicalItemId } non-empty strings (the R04 canonical composition)",
          });
        }
      }
      // GATE 1 — the verified-before-ready law: only a COMPLETED session's
      // assets may ever be presented as offline-ready (the state answers
      // from the live engine; the journal re-proves it at GATE 4).
      const status: TorrentResult<TorrentSessionStatus> = options.engine.status(input.sessionId);
      if (!status.ok) return status;
      if (status.value.state !== "completed") {
        return torrentError("INVALID_STATE", {
          sessionId: input.sessionId,
          detail:
            `exposeCompletedSelection: session '${input.sessionId}' is ${status.value.state}, not completed — ` +
            "`Ready offline` is EARNED by full integrity verification, never assumed: " +
            "partial assets present honest in-progress states (retry once the session completes)",
        });
      }
      const digests = status.value.digests ?? [];
      if (digests.length === 0) {
        return torrentError("INTERNAL", {
          sessionId: input.sessionId,
          detail:
            `exposeCompletedSelection: completed session '${input.sessionId}' records no digests — the integrity contract is broken; refusing to expose`,
        });
      }
      // GATES 2+3 — every file imports (stream-copy + SHA-256 + the store's
      // full re-hash) AND digest-cross-checks BEFORE anything journals: a
      // failure anywhere refuses the WHOLE exposure (atomic — no silent
      // partial exposure, retryable once the cause is resolved).
      const proven: {
        digest: (typeof digests)[number];
        asset: StoredAsset;
      }[] = [];
      for (const digest of digests) {
        const sourceDiskPath = `${status.value.dataDir}/${digest.path}`;
        const imported = await store.importAsset({
          sourcePath: sourceDiskPath,
          ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        });
        if (!imported.ok) {
          return torrentError(mapStoreCode(imported.error), {
            sessionId: input.sessionId,
            detail:
              `exposeCompletedSelection: importing '${digest.path}' into the native-media store failed: ${imported.error.detail} ` +
              "(nothing was exposed — resolve the store failure and retry; the exposure is atomic)",
            cause: imported.error,
          });
        }
        if (imported.asset.meta.sha256 !== digest.sha256) {
          return torrentError("INTERNAL", {
            sessionId: input.sessionId,
            detail:
              `exposeCompletedSelection: digest cross-check FAILED for '${digest.path}': the engine recorded ` +
              `${digest.sha256} but the store imported ${imported.asset.meta.sha256} — the bytes changed between ` +
              "verification and exposure; the exposure is refused (nothing was journaled; re-verify and retry)",
          });
        }
        proven.push({ digest, asset: imported.asset });
      }
      // GATE 4 — the engine journals ONE exposure batch, re-validating the
      // completed state + every digest against the JOURNAL's own records
      // (defense in depth: even a rogue adapter cannot expose unverified
      // bytes through the engine's persistence).
      const recorded = options.engine.recordAssetExposure({
        sessionId: input.sessionId,
        assets: proven.map(({ digest, asset }) => ({
          assetId: asset.meta.assetId,
          sourcePath: digest.path,
          contentPath: asset.contentPath,
          sizeBytes: digest.sizeBytes,
          sha256: digest.sha256,
          ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
        })),
        ...(input.library !== undefined ? { library: input.library } : {}),
      });
      if (!recorded.ok) return recorded;
      // The answer: the journal's exposure view (the durable truth), mapped
      // onto the per-asset offline-ready shape (integrity EARNED through
      // the import verification + the cross-checks above).
      return {
        ok: true,
        value: recorded.value.assets.map((asset) => ({
          sessionId: recorded.value.sessionId,
          infoHash: recorded.value.infoHash,
          sourcePath: asset.sourcePath,
          assetId: asset.assetId,
          contentPath: asset.contentPath,
          sizeBytes: asset.sizeBytes,
          sha256: asset.sha256,
          ...(asset.contentType !== undefined ? { contentType: asset.contentType } : {}),
          provenance: {
            sourceId: recorded.value.provenance.sourceId,
            basis: recorded.value.provenance.basis,
          },
          ...(recorded.value.library !== undefined
            ? { library: recorded.value.library }
            : {}),
          exposedAt: recorded.value.exposedAt,
          integrity: "verified" as const,
        })),
      };
    },

    listOfflineReady(): TorrentResult<readonly OfflineReadyEntry[]> {
      const exposures: readonly ExposedTorrentExposure[] = options.engine.exposedAssets();
      const entries: OfflineReadyEntry[] = exposures.map((exposure) => ({
        key: offlineReadyIdentityKey(exposure),
        ...(exposure.library !== undefined ? { library: exposure.library } : {}),
        sessionId: exposure.sessionId,
        infoHash: exposure.infoHash,
        provenance: {
          sourceId: exposure.provenance.sourceId,
          basis: exposure.provenance.basis,
        },
        assets: exposure.assets.map((asset) => {
          const meta = store.getAsset(asset.assetId);
          const stat = store.statAsset(asset.assetId);
          const integrity: OfflineReadyAsset["integrity"] =
            meta === undefined || stat === null
              ? "vanished"
              : meta.integrity;
          return {
            assetId: asset.assetId,
            sourcePath: asset.sourcePath,
            contentPath: asset.contentPath,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
            ...(asset.contentType !== undefined ? { contentType: asset.contentType } : {}),
            integrity,
            sizeOnDisk: stat === null ? null : stat.sizeBytes,
          };
        }),
        exposedAt: exposure.exposedAt,
      }));
      return { ok: true, value: entries };
    },

    async verifyOfflineReadyEntry(assetId: string): Promise<TorrentResult<{
      readonly assetId: string;
      readonly integrity: "verified" | "failed";
      readonly digest: string;
      readonly recordedDigest: string;
    }>> {
      if (typeof assetId !== "string" || assetId.trim().length === 0) {
        return torrentError("INVALID_INPUT", {
          detail: "verifyOfflineReadyEntry: assetId must be a non-empty string",
        });
      }
      const verified = await store.verifyAsset(assetId);
      if (!verified.ok) {
        return torrentError(mapStoreCode(verified.error), {
          detail:
            `verifyOfflineReadyEntry: re-verifying '${assetId}' failed: ${verified.error.detail}`,
          cause: verified.error,
        });
      }
      return {
        ok: true,
        value: {
          assetId: verified.assetId,
          integrity: verified.integrity === "failed" ? "failed" : "verified",
          digest: verified.digest,
          recordedDigest: verified.recordedDigest,
        },
      };
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
