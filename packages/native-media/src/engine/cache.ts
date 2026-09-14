/**
 * @wfx/native-media — local cache policy (WFX-014, Lane B).
 *
 * PURE ACCOUNTING for the engine's local media cache: which byte ranges may be
 * admitted and which tracked entries must be evicted to make room. This module
 * performs NO I/O and owns NO bytes — the real engine (a later Rust
 * deliverable) executes the decisions against its storage; this module only
 * computes policy, so it is fully deterministic and unit-testable in isolation.
 *
 * Model:
 * - A {@link CacheTracker} is an IMMUTABLE value: every operation
 *   (`trackPiece`, `touchEntry`, `forgetEntry`) returns a NEW tracker and never
 *   mutates its input (the same discipline as the session FSM in ../session.ts).
 * - Ordering uses a LOGICAL CLOCK (a monotonically increasing counter), never
 *   wall time — determinism, no entropy, replayable decisions.
 * - `evictOrder: 'lru'` orders victims by ascending `lastUsedAt`;
 *   `'fifo'` orders by ascending `admittedAt` (touching does not save an
 *   entry from FIFO eviction).
 *
 * The canonical admission protocol (documented on both predicates):
 *
 * ```text
 * if (shouldAdmit(tracker, n))            // fits as-is, no eviction needed
 *   trackPiece(tracker, entry)            // admit
 * else {
 *   const victims = evictList(tracker, n) // ordered ids whose eviction makes room
 *   if (victims.length === 0) refuse      // n exceeds maxBytes — never cacheable
 *   evict victims (engine executes), forgetEntry each, then trackPiece
 * }
 * ```
 *
 * `evictList` returns `[]` in exactly two cases — the bytes already fit, or
 * the bytes can NEVER fit (`incomingBytes > policy.maxBytes`, where even an
 * empty cache cannot hold them). Callers distinguish the two with
 * {@link shouldAdmit} after applying the (empty) plan; refusing is the honest
 * outcome, never a silent drop.
 */

import { NativeMediaError } from "../errors";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** The cache policy: a byte budget plus an eviction ordering. */
export interface CachePolicy {
  /** Maximum total bytes the cache may hold. Zero = admit nothing. */
  maxBytes: number;
  /** Victim ordering: least-recently-used first, or first-in-first-out. */
  evictOrder: "lru" | "fifo";
}

/** One tracked cache entry (accounting only — no bytes are held here). */
export interface CacheEntry {
  /** Caller-chosen identity (e.g. `session:piece`). */
  id: string;
  /** Bytes the entry occupies against the budget. */
  bytes: number;
  /** Logical clock reading when the entry was admitted. */
  admittedAt: number;
  /** Logical clock reading of the most recent use (equals `admittedAt` until touched). */
  lastUsedAt: number;
}

/**
 * The immutable cache accounting state: a policy, a logical clock, and the
 * tracked entries. Treat it as a value — use the pure operations below.
 */
export interface CacheTracker {
  readonly policy: CachePolicy;
  /** Logical clock; every track/touch advances it by one. */
  readonly clock: number;
  readonly entries: ReadonlyMap<string, CacheEntry>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function invalid(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

function requirePositiveBytes(bytes: number, what: string): void {
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw invalid(`${what} must be a positive safe integer (got ${String(bytes)})`);
  }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build an empty tracker from a policy. Throws a typed `INVALID_INPUT` for a
 * malformed policy (non-safe/non-negative `maxBytes`, unknown `evictOrder`).
 */
export function createCacheTracker(policy: CachePolicy): CacheTracker {
  if (typeof policy !== "object" || policy === null) {
    throw invalid("createCacheTracker: policy must be an object");
  }
  if (
    typeof policy.maxBytes !== "number" ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes < 0
  ) {
    throw invalid(
      `createCacheTracker: maxBytes must be a non-negative safe integer (got ${String(policy.maxBytes)})`,
    );
  }
  if (policy.evictOrder !== "lru" && policy.evictOrder !== "fifo") {
    throw invalid(
      `createCacheTracker: evictOrder must be 'lru' or 'fifo' (got ${String(policy.evictOrder)})`,
    );
  }
  return { policy, clock: 0, entries: new Map() };
}

// ---------------------------------------------------------------------------
// Pure operations (immutable updates)
// ---------------------------------------------------------------------------

/**
 * Record a newly admitted entry. The caller is responsible for having made
 * room (see the module's admission protocol) — this operation only accounts.
 * Throws typed `INVALID_INPUT` for a malformed entry or a duplicate id.
 */
export function trackPiece(
  tracker: CacheTracker,
  entry: { id: string; bytes: number },
): CacheTracker {
  requireTracker(tracker, "trackPiece");
  if (typeof entry !== "object" || entry === null) {
    throw invalid("trackPiece: entry must be an object");
  }
  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    throw invalid("trackPiece: entry.id must be a non-empty string");
  }
  requirePositiveBytes(entry.bytes, "trackPiece: entry.bytes");
  if (tracker.entries.has(entry.id)) {
    throw invalid(`trackPiece: entry '${entry.id}' is already tracked`);
  }
  const clock = tracker.clock + 1;
  const record: CacheEntry = {
    id: entry.id,
    bytes: entry.bytes,
    admittedAt: clock,
    lastUsedAt: clock,
  };
  return {
    policy: tracker.policy,
    clock,
    entries: new Map(tracker.entries).set(entry.id, record),
  };
}

/**
 * Mark an entry as used (advances its LRU position). Throws typed
 * `NOT_FOUND` for an unknown id — touching an untracked entry is an
 * accounting bug, not a silent no-op.
 */
export function touchEntry(tracker: CacheTracker, id: string): CacheTracker {
  requireTracker(tracker, "touchEntry");
  const entry = tracker.entries.get(id);
  if (entry === undefined) {
    throw new NativeMediaError("NOT_FOUND", {
      detail: `touchEntry: no tracked entry '${id}'`,
    });
  }
  const clock = tracker.clock + 1;
  return {
    policy: tracker.policy,
    clock,
    entries: new Map(tracker.entries).set(id, { ...entry, lastUsedAt: clock }),
  };
}

/**
 * Remove an entry (the engine evicted or dropped its bytes). Throws typed
 * `NOT_FOUND` for an unknown id — double-forgetting is an accounting bug.
 */
export function forgetEntry(tracker: CacheTracker, id: string): CacheTracker {
  requireTracker(tracker, "forgetEntry");
  if (!tracker.entries.has(id)) {
    throw new NativeMediaError("NOT_FOUND", {
      detail: `forgetEntry: no tracked entry '${id}'`,
    });
  }
  const entries = new Map(tracker.entries);
  entries.delete(id);
  return { policy: tracker.policy, clock: tracker.clock, entries };
}

/** Total bytes currently tracked against the budget. */
export function usedBytes(tracker: CacheTracker): number {
  requireTracker(tracker, "usedBytes");
  let total = 0;
  for (const entry of tracker.entries.values()) total += entry.bytes;
  return total;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * Predicate: may `incomingBytes` be admitted WITHOUT evicting anything —
 * i.e. do they fit under the budget as-is? Malformed input answers `false`
 * (total predicate, safe for runtime garbage). Pair with {@link evictList}
 * for the over-budget case; see the module's admission protocol.
 */
export function shouldAdmit(tracker: CacheTracker, incomingBytes: number): boolean {
  if (!isTrackerLike(tracker)) return false;
  if (typeof incomingBytes !== "number" || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0) {
    return false;
  }
  return usedBytes(tracker) + incomingBytes <= tracker.policy.maxBytes;
}

/**
 * The ordered ids to evict so `incomingBytes` fit alongside the survivors:
 * victims are taken in policy order (`lru` = least recently used first,
 * `fifo` = oldest admission first) and only as many as needed. Returns `[]`
 * when the bytes already fit, and `[]` when the bytes can NEVER fit
 * (`incomingBytes > maxBytes`) — distinguish the two with
 * {@link shouldAdmit} after applying the plan. Malformed input answers `[]`.
 */
export function evictList(tracker: CacheTracker, incomingBytes: number): string[] {
  if (!isTrackerLike(tracker)) return [];
  if (typeof incomingBytes !== "number" || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0) {
    return [];
  }
  const { policy } = tracker;
  if (incomingBytes > policy.maxBytes) return []; // never cacheable — see docs
  let used = usedBytes(tracker);
  if (used + incomingBytes <= policy.maxBytes) return []; // already fits

  const victims = [...tracker.entries.values()].sort((a, b) => {
    const keyA = policy.evictOrder === "lru" ? a.lastUsedAt : a.admittedAt;
    const keyB = policy.evictOrder === "lru" ? b.lastUsedAt : b.admittedAt;
    return keyA - keyB;
  });

  const ids: string[] = [];
  for (const victim of victims) {
    ids.push(victim.id);
    used -= victim.bytes;
    if (used + incomingBytes <= policy.maxBytes) break;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Internal guards
// ---------------------------------------------------------------------------

function isTrackerLike(x: unknown): x is CacheTracker {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  const policy = t.policy as Record<string, unknown> | undefined;
  if (typeof policy !== "object" || policy === null) return false;
  if (typeof policy.maxBytes !== "number" || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0) {
    return false;
  }
  if (policy.evictOrder !== "lru" && policy.evictOrder !== "fifo") return false;
  return t.entries instanceof Map;
}

function requireTracker(tracker: CacheTracker, what: string): void {
  if (!isTrackerLike(tracker)) {
    throw invalid(`${what}: tracker must be a cache tracker (see createCacheTracker)`);
  }
}
