/**
 * @wfx/native-media — local cache policy (WFX-014, Lane B).
 *
 * PURE ACCOUNTING — NO I/O, EVER. The real engine owns the bytes; this
 * module only computes the POLICY decisions over a `CacheTracker`:
 *
 * - `shouldAdmit(tracker, incomingBytes)` — do `incomingBytes` fit under
 *   the budget WITHOUT evicting anything?
 * - `evictList(tracker, incomingBytes)` — the ordered entries to evict
 *   to make room (least valuable first; LRU or FIFO per policy).
 *
 * The intended admission flow for the real engine:
 *
 * ```text
 * if (shouldAdmit(tracker, bytes))            -> admit, track(...)
 * else if ((list = evictList(tracker, bytes)) fits after eviction
 *      && bytes <= policy.maxBytes)           -> evict(list), admit, track(...)
 * else                                        -> REJECT (typed at the engine)
 * ```
 *
 * Design decisions (documented for lead review):
 * - TRACKING IS UNENFORCED BY DESIGN: `track` records an admission the
 *   caller already decided on. It does not police the budget — policy
 *   queries (`shouldAdmit`/`evictList`) stay pure arithmetic over
 *   recorded facts, so an over-budget tracker still answers honestly.
 * - LRU ordering uses a monotonic LOGICAL clock (`tracker.clock`), not
 *   wall time: eviction order is a pure function of the operation
 *   sequence, never of when it ran.
 * - `touch` records a read: under `lru` it promotes the entry to
 *   most-recently-used; under `fifo` it is accepted but does NOT reorder
 *   (insertion order is the whole policy).
 * - Zero-budget policies reject every positive admission (`maxBytes: 0`
 *   admits only nothing). An `incomingBytes` larger than `maxBytes` can
 *   never fit — `evictList` then names every entry, and the caller's
 *   re-check of `shouldAdmit` still fails: honest rejection, no fake
 *   eviction "success".
 *
 * Everything here is immutable: every operation returns a NEW tracker.
 */

import { NativeMediaError } from "../errors";

// ---------------------------------------------------------------------------
// Policy & tracker shapes
// ---------------------------------------------------------------------------

/** The eviction order a cache policy enforces. */
export type CacheEvictOrder = "lru" | "fifo";

/** The local cache policy: a byte budget plus an eviction order. */
export interface CachePolicy {
  /** Total byte budget (non-negative safe integer). */
  maxBytes: number;
  /** `"lru"` evicts least-recently-used first; `"fifo"` oldest-insert first. */
  evictOrder: CacheEvictOrder;
}

/** One tracked cache entry (an identity, a size, and its recency rank). */
export interface CacheEntry {
  /** Cache entry identity (e.g. `asset:file`). */
  key: string;
  /** Entry size in bytes (positive safe integer). */
  bytes: number;
}

/**
 * Pure cache accounting state. `entries` is listed in EVICTION order —
 * the least valuable entry first — so `evictList` is always a prefix.
 * `clock` is the monotonic logical clock used for LRU recency.
 */
export interface CacheTracker {
  readonly policy: CachePolicy;
  /** Entries in eviction order (least valuable first). */
  readonly entries: readonly CacheEntry[];
  /** Sum of every entry's bytes. */
  readonly usedBytes: number;
  /** Monotonic logical clock; advances on every `track`/`touch`. */
  readonly clock: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

function isCacheEvictOrder(x: unknown): x is CacheEvictOrder {
  return x === "lru" || x === "fifo";
}

/** Runtime guard for {@link CachePolicy}. */
export function isCachePolicy(x: unknown): x is CachePolicy {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.maxBytes === "number" &&
    Number.isSafeInteger(p.maxBytes) &&
    p.maxBytes >= 0 &&
    isCacheEvictOrder(p.evictOrder)
  );
}

function requireKey(key: string): string {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw invalidInput("cache key must be a non-empty string");
  }
  return key;
}

function requirePositiveBytes(bytes: number): number {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw invalidInput(
      `cache entry bytes must be a positive safe integer (got ${String(bytes)})`,
    );
  }
  return bytes;
}

function requireIncomingBytes(bytes: number): number {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw invalidInput(
      `incomingBytes must be a non-negative safe integer (got ${String(bytes)})`,
    );
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an empty tracker under a validated {@link CachePolicy}. Throws
 * a typed `INVALID_INPUT` error on a malformed policy.
 */
export function createCacheTracker(policy: CachePolicy): CacheTracker {
  if (!isCachePolicy(policy)) {
    throw invalidInput(
      "createCacheTracker: policy must be { maxBytes: non-negative safe integer, evictOrder: 'lru' | 'fifo' }",
    );
  }
  return { policy, entries: [], usedBytes: 0, clock: 0 };
}

// ---------------------------------------------------------------------------
// Accounting operations (pure — each returns a NEW tracker)
// ---------------------------------------------------------------------------

/**
 * Record an admitted entry. The caller decides admission
 * (`shouldAdmit`/`evictList`); this only records the fact. Throws a
 * typed `INVALID_INPUT` error for a malformed or duplicate key, or a
 * non-positive size.
 */
export function track(tracker: CacheTracker, key: string, bytes: number): CacheTracker {
  if (typeof tracker !== "object" || tracker === null) {
    throw invalidInput("track: tracker must be a CacheTracker");
  }
  requireKey(key);
  requirePositiveBytes(bytes);
  if (tracker.entries.some((entry) => entry.key === key)) {
    throw invalidInput(`track: key '${key}' is already tracked`);
  }
  return {
    policy: tracker.policy,
    entries: [...tracker.entries, { key, bytes }],
    usedBytes: tracker.usedBytes + bytes,
    clock: tracker.clock + 1,
  };
}

/**
 * Record a read of `key` (LRU recency). Under `"lru"` the entry is
 * promoted to most-recently-used; under `"fifo"` the clock advances but
 * the order does not change. Throws a typed `INVALID_INPUT` error for an
 * unknown key.
 */
export function touch(tracker: CacheTracker, key: string): CacheTracker {
  if (typeof tracker !== "object" || tracker === null) {
    throw invalidInput("touch: tracker must be a CacheTracker");
  }
  requireKey(key);
  const index = tracker.entries.findIndex((entry) => entry.key === key);
  if (index < 0) {
    throw invalidInput(`touch: key '${key}' is not tracked`);
  }
  if (tracker.policy.evictOrder !== "lru") {
    return { ...tracker, clock: tracker.clock + 1 };
  }
  const entry = tracker.entries[index];
  if (entry === undefined) {
    throw invalidInput(`touch: inconsistent tracker state for '${key}'`);
  }
  const entries = [...tracker.entries];
  entries.splice(index, 1);
  entries.push(entry);
  return {
    policy: tracker.policy,
    entries,
    usedBytes: tracker.usedBytes,
    clock: tracker.clock + 1,
  };
}

/**
 * Apply evictions (the keys `evictList` named). Throws a typed
 * `INVALID_INPUT` error for unknown or duplicate keys — callers evict
 * exactly what the policy computed.
 */
export function evict(tracker: CacheTracker, keys: readonly string[]): CacheTracker {
  if (typeof tracker !== "object" || tracker === null) {
    throw invalidInput("evict: tracker must be a CacheTracker");
  }
  if (!Array.isArray(keys)) {
    throw invalidInput("evict: keys must be an array");
  }
  const requested = new Set<string>();
  for (const key of keys) {
    requireKey(key);
    if (requested.has(key)) {
      throw invalidInput(`evict: duplicate key '${key}'`);
    }
    requested.add(key);
  }
  const kept: CacheEntry[] = [];
  let evictedBytes = 0;
  for (const entry of tracker.entries) {
    if (requested.has(entry.key)) {
      evictedBytes += entry.bytes;
    } else {
      kept.push(entry);
    }
  }
  if (evictedBytes === 0 && requested.size > 0) {
    // Every requested key was unknown (a zero-byte entry cannot exist).
    const first = keys[0] ?? "";
    throw invalidInput(`evict: key '${first}' is not tracked`);
  }
  return {
    policy: tracker.policy,
    entries: kept,
    usedBytes: tracker.usedBytes - evictedBytes,
    clock: tracker.clock,
  };
}

// ---------------------------------------------------------------------------
// Policy decisions
// ---------------------------------------------------------------------------

/**
 * Do `incomingBytes` fit under the budget WITHOUT evicting anything?
 * Pure arithmetic: `usedBytes + incomingBytes <= maxBytes`. This is the
 * first half of the admission decision; the second half is evicting
 * `evictList(...)` and re-checking.
 */
export function shouldAdmit(tracker: CacheTracker, incomingBytes: number): boolean {
  if (typeof tracker !== "object" || tracker === null) {
    throw invalidInput("shouldAdmit: tracker must be a CacheTracker");
  }
  requireIncomingBytes(incomingBytes);
  return tracker.usedBytes + incomingBytes <= tracker.policy.maxBytes;
}

/**
 * The ordered keys to evict so that `incomingBytes` fit: the minimal
 * prefix of the eviction order whose bytes bring the tracker under
 * budget. When `incomingBytes` can NEVER fit (larger than `maxBytes`),
 * every entry is named — the caller's post-eviction `shouldAdmit`
 * re-check still fails, so the rejection stays honest.
 */
export function evictList(tracker: CacheTracker, incomingBytes: number): readonly string[] {
  if (typeof tracker !== "object" || tracker === null) {
    throw invalidInput("evictList: tracker must be a CacheTracker");
  }
  requireIncomingBytes(incomingBytes);
  const keys: string[] = [];
  let freed = 0;
  for (const entry of tracker.entries) {
    if (tracker.usedBytes - freed + incomingBytes <= tracker.policy.maxBytes) {
      break;
    }
    keys.push(entry.key);
    freed += entry.bytes;
  }
  return keys;
}
