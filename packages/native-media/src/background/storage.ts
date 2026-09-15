/**
 * @wfx/native-media — storage governor (WFX-024, Lane B).
 *
 * `StorageGovernor` wraps the MERGED WFX-014 `CacheTracker` accounting
 * (imported — never reimplemented) with the WFX-024 `StoragePolicy`:
 * a byte ceiling, an eviction order, a NEVER-EVICT protected set, and a
 * `minFreeBytes` headroom reserved inside the ceiling.
 *
 * PURITY BOUNDARY: the governor owns POLICY + ACCOUNTING only. The real
 * engine owns the bytes (WFX-014's rule) — nothing here performs I/O,
 * reads the clock, or touches the network. Every operation is a
 * deterministic function of the injected policy and the recorded facts.
 *
 * Typed-result contract (never fake success):
 * - `admit(assetId, bytes)` — below the effective ceiling (`maxCacheBytes -
 *   minFreeBytes`) ⇒ admitted. Over it ⇒ an eviction plan is computed
 *   FIRST (`decideEviction`), applied typed, then the bytes are admitted.
 *   Impossible ⇒ a TYPED REFUSAL (kind `"over-ceiling"`, carrying the
 *   refused plan): the tracker is NEVER left silently over-ceiling.
 *   Re-admitting a tracked asset ⇒ a typed `"duplicate"` refusal.
 * - `release(sessionId)` — frees the cache of the asset bound to that
 *   session (cancel/failed path). Unknown session ⇒ typed refusal;
 *   protected asset ⇒ typed refusal (protected items are never released).
 * - `markPersistent(assetId)` — only assets listed in
 *   `StoragePolicy.protectedItems` can be marked persistent (completed
 *   downloads); anything else is a typed `"not-protected"` refusal.
 * - `stats()` — an observable snapshot: bytes used/free, per-asset bytes,
 *   eviction counters, protected + persistent assets, session bindings.
 *
 * Design decisions (documented for lead review):
 * - ENTRIES ARE KEYED BY ASSET ID: one tracked cache entry per asset, so
 *   `StoragePolicy.protectedItems` (asset ids) lines up exactly with the
 *   tracker keys `decideEviction` protects. The session→asset binding
 *   (`associate`) exists so `release(sessionId)` can find the cache to free.
 * - ADMISSION IS ONE-SHOT PER ASSET, mirroring WFX-014's `track` (duplicate
 *   keys are refused): a download is admitted once, at its full size.
 * - `touch(assetId)` re-exports WFX-014's LRU promotion so reads actually
 *   reorder eviction under `"lru"` (under `"fifo"` the clock advances but
 *   the order never changes — insertion order is the whole policy).
 * - Releasing a session whose asset has no tracked bytes is an OK no-op
 *   (`freedBytes: 0` + note): "free the session cache" is vacuously true.
 *   A session id that was never bound is a typed refusal, not a silent ok —
 *   that would hide host bugs.
 * - Multiple sessions may bind the same asset; the first `release` frees
 *   the entry, later ones become the OK no-op above.
 */

import {
  createCacheTracker,
  evict as cacheEvict,
  track as cacheTrack,
  touch as cacheTouch,
  type CacheTracker,
} from "../engine/cache";
import { NativeMediaError } from "../errors";
import {
  decideEviction,
  validateStoragePolicy,
  type EvictionPlan,
  type EvictionVictim,
  type StoragePolicy,
} from "./policy";

// ---------------------------------------------------------------------------
// Typed results
// ---------------------------------------------------------------------------

/** Why an admission was refused (typed — never a silent over-ceiling). */
export interface StorageAdmissionRefusal {
  /** `"over-ceiling"`: even the full eviction plan cannot make room. */
  readonly kind: "over-ceiling" | "duplicate";
  readonly reason: string;
  /** The refused eviction plan, when the refusal came from planning. */
  readonly plan?: EvictionPlan;
}

/** The result of `StorageGovernor.admit`. */
export type StorageAdmissionResult =
  | {
      readonly ok: true;
      readonly assetId: string;
      readonly admittedBytes: number;
      /** The eviction victims applied BEFORE the admission (possibly none). */
      readonly evicted: readonly EvictionVictim[];
      /** Free bytes under the ceiling AFTER the admission (>= minFreeBytes). */
      readonly freeBytesAfter: number;
    }
  | { readonly ok: false; readonly refusal: StorageAdmissionRefusal };

/** Why a release was refused. */
export interface StorageReleaseRefusal {
  /** `"unknown-session"`: no asset is bound to this session id. */
  readonly kind: "unknown-session" | "protected";
  readonly reason: string;
}

/** The result of `StorageGovernor.release`. */
export type StorageReleaseResult =
  | {
      readonly ok: true;
      readonly assetId: string;
      readonly freedBytes: number;
      /** Present when the bound asset had no tracked bytes (vacuous free). */
      readonly note?: string;
    }
  | { readonly ok: false; readonly refusal: StorageReleaseRefusal };

/** The result of `StorageGovernor.touch` (LRU read promotion). */
export type StorageTouchResult =
  | { readonly ok: true; readonly assetId: string }
  | {
      readonly ok: false;
      readonly refusal: { readonly kind: "unknown-asset"; readonly reason: string };
    };

/** The result of `StorageGovernor.markPersistent`. */
export type StorageMarkPersistentResult =
  | { readonly ok: true; readonly assetId: string }
  | {
      readonly ok: false;
      readonly refusal: { readonly kind: "not-protected"; readonly reason: string };
    };

/** The observable storage snapshot (telemetry / tests). */
export interface StorageStats {
  /** Tracked bytes (WFX-014 `usedBytes`). */
  readonly usedBytes: number;
  /** `maxCacheBytes - usedBytes` (may be negative only for foreign trackers). */
  readonly freeBytes: number;
  readonly maxCacheBytes: number;
  readonly minFreeBytes: number;
  /** Tracked bytes per asset id (eviction order preserved). */
  readonly perAsset: ReadonlyMap<string, number>;
  /** Number of tracked cache entries. */
  readonly entryCount: number;
  /** Cumulative count of evicted entries. */
  readonly evictions: number;
  /** Cumulative bytes reclaimed by eviction. */
  readonly evictedBytes: number;
  /** The policy's protected asset ids (fresh copy). */
  readonly protectedAssets: readonly string[];
  /** Assets that completed while protected (persistent downloads). */
  readonly persistentAssets: readonly string[];
  /** Number of live session→asset bindings. */
  readonly sessionBindings: number;
}

// ---------------------------------------------------------------------------
// Governor surface + factory
// ---------------------------------------------------------------------------

/** The storage governor: WFX-014 accounting governed by a WFX-024 policy. */
export interface StorageGovernor {
  /**
   * Bind a session to its asset so `release(sessionId)` can find the cache
   * to free. Re-binding a session overwrites the previous binding. Throws
   * a typed `INVALID_INPUT` error on malformed ids.
   */
  associate(sessionId: string, assetId: string): void;
  /**
   * Admit `bytes` for `assetId`: below the effective ceiling ⇒ ok; over ⇒
   * plan evictions first (`decideEviction`), apply them typed, then admit;
   * impossible ⇒ typed refusal. Never silently over-ceiling.
   */
  admit(assetId: string, bytes: number): StorageAdmissionResult;
  /**
   * Record a read of the asset (LRU promotion via WFX-014 `touch`).
   * Unknown asset ⇒ typed refusal.
   */
  touch(assetId: string): StorageTouchResult;
  /**
   * Free the session cache of the asset bound to `sessionId` (cancel/failed
   * path). Protected assets are NEVER released — typed refusal.
   */
  release(sessionId: string): StorageReleaseResult;
  /**
   * Mark a completed asset persistent. Only assets listed in
   * `StoragePolicy.protectedItems` can be persisted — typed refusal
   * otherwise.
   */
  markPersistent(assetId: string): StorageMarkPersistentResult;
  /** Is this asset protected by the policy (never evicted / released)? */
  isProtected(assetId: string): boolean;
  /** A defensive snapshot of the storage state (fresh copies each call). */
  stats(): StorageStats;
}

/**
 * Create a storage governor over a validated {@link StoragePolicy}. The
 * underlying tracker is a MERGED WFX-014 `CacheTracker` (`maxBytes` =
 * `maxCacheBytes`, `evictOrder` = the policy's order) — the accounting is
 * imported, never reimplemented. Throws a typed `INVALID_INPUT` error on a
 * malformed policy.
 */
export function createStorageGovernor(policy: StoragePolicy): StorageGovernor {
  const validated = validateStoragePolicy(policy);
  return new StorageGovernorImpl(validated);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function requireAssetId(assetId: string): string {
  if (typeof assetId !== "string" || assetId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "assetId must be a non-empty string",
    });
  }
  return assetId;
}

function requireSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "sessionId must be a non-empty string",
    });
  }
  return sessionId;
}

function requirePositiveBytes(bytes: number): number {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `bytes must be a positive safe integer (got ${String(bytes)})`,
    });
  }
  return bytes;
}

class StorageGovernorImpl implements StorageGovernor {
  /** The WFX-014 accounting substrate (immutable; ops return new trackers). */
  private tracker: CacheTracker;
  /** sessionId -> assetId bindings (insertion ordered). */
  private readonly sessions = new Map<string, string>();
  /** Completed + protected assets (persistent downloads). */
  private readonly persistent = new Set<string>();
  private evictionCount = 0;
  private evictedBytesTotal = 0;

  constructor(private readonly policy: StoragePolicy) {
    this.tracker = createCacheTracker({
      maxBytes: policy.maxCacheBytes,
      evictOrder: policy.evictOrder,
    });
  }

  associate(sessionId: string, assetId: string): void {
    requireSessionId(sessionId);
    requireAssetId(assetId);
    this.sessions.set(sessionId, assetId);
  }

  admit(assetId: string, bytes: number): StorageAdmissionResult {
    requireAssetId(assetId);
    requirePositiveBytes(bytes);
    if (this.tracker.entries.some((entry) => entry.key === assetId)) {
      return {
        ok: false,
        refusal: {
          kind: "duplicate",
          reason:
            `asset '${assetId}' is already tracked (${String(this.tracker.entries.find((entry) => entry.key === assetId)?.bytes ?? 0)} bytes) — ` +
            "release it before re-admitting (admission is one-shot per asset, mirroring WFX-014 track)",
        },
      };
    }
    const plan = decideEviction(this.tracker, bytes, this.policy);
    if (!plan.ok) {
      return {
        ok: false,
        refusal: { kind: "over-ceiling", reason: plan.reason, plan },
      };
    }
    if (plan.victims.length > 0) {
      // Apply exactly what the typed plan named, then account the admission.
      this.tracker = cacheEvict(this.tracker, plan.victims.map((v) => v.key));
      this.evictionCount += plan.victims.length;
      this.evictedBytesTotal += plan.freedBytes;
    }
    this.tracker = cacheTrack(this.tracker, assetId, bytes);
    return {
      ok: true,
      assetId,
      admittedBytes: bytes,
      evicted: plan.victims,
      freeBytesAfter: plan.freeBytesAfter,
    };
  }

  touch(assetId: string): StorageTouchResult {
    requireAssetId(assetId);
    if (!this.tracker.entries.some((entry) => entry.key === assetId)) {
      return {
        ok: false,
        refusal: {
          kind: "unknown-asset",
          reason: `touch: asset '${assetId}' is not tracked`,
        },
      };
    }
    this.tracker = cacheTouch(this.tracker, assetId);
    return { ok: true, assetId };
  }

  release(sessionId: string): StorageReleaseResult {
    requireSessionId(sessionId);
    const assetId = this.sessions.get(sessionId);
    if (assetId === undefined) {
      return {
        ok: false,
        refusal: {
          kind: "unknown-session",
          reason: `release: session '${sessionId}' is not associated with any cached asset`,
        },
      };
    }
    if (this.isProtected(assetId)) {
      return {
        ok: false,
        refusal: {
          kind: "protected",
          reason:
            `release: asset '${assetId}' is protected by StoragePolicy.protectedItems — protected items are never released`,
        },
      };
    }
    this.sessions.delete(sessionId);
    const entry = this.tracker.entries.find((e) => e.key === assetId);
    if (entry === undefined) {
      return {
        ok: true,
        assetId,
        freedBytes: 0,
        note: `no cached bytes tracked for asset '${assetId}'`,
      };
    }
    this.tracker = cacheEvict(this.tracker, [assetId]);
    return { ok: true, assetId, freedBytes: entry.bytes };
  }

  markPersistent(assetId: string): StorageMarkPersistentResult {
    requireAssetId(assetId);
    if (!this.policy.protectedItems.includes(assetId)) {
      return {
        ok: false,
        refusal: {
          kind: "not-protected",
          reason:
            `markPersistent: asset '${assetId}' is not in StoragePolicy.protectedItems — ` +
            "only protected assets can be marked persistent",
        },
      };
    }
    this.persistent.add(assetId);
    return { ok: true, assetId };
  }

  isProtected(assetId: string): boolean {
    return this.policy.protectedItems.includes(assetId);
  }

  stats(): StorageStats {
    const perAsset = new Map<string, number>();
    for (const entry of this.tracker.entries) {
      perAsset.set(entry.key, entry.bytes);
    }
    return {
      usedBytes: this.tracker.usedBytes,
      freeBytes: this.policy.maxCacheBytes - this.tracker.usedBytes,
      maxCacheBytes: this.policy.maxCacheBytes,
      minFreeBytes: this.policy.minFreeBytes,
      perAsset,
      entryCount: this.tracker.entries.length,
      evictions: this.evictionCount,
      evictedBytes: this.evictedBytesTotal,
      protectedAssets: [...this.policy.protectedItems],
      persistentAssets: [...this.persistent],
      sessionBindings: this.sessions.size,
    };
  }
}
