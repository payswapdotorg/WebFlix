/**
 * @wfx/native-media — background completion + storage policy (WFX-024, Lane B).
 *
 * The PURE policy brain of background completion. It answers two questions
 * with typed, deterministic results (no I/O, no timers, no randomness — the
 * clock, the environment, and the cache accounting are always INJECTED):
 *
 * 1. `decideCompletion(session, policy, environment)` — when playback pauses
 *    or ends (a session moves to `background`), what happens to the ongoing
 *    download? The OS-constrained platform hints (`networkClass`, `charging`)
 *    are INPUTS supplied by the host — this module NEVER assumes them. A
 *    policy pause is always RESUMEABLE (never a cancel): the environment
 *    that caused it can change back.
 * 2. `decideEviction(tracker, incomingBytes, storage)` — which cache entries
 *    must be evicted to admit `incomingBytes` while respecting the
 *    `minFreeBytes` headroom and the NEVER-EVICT `protectedItems`? Impossible
 *    plans are TYPED REFUSALS with reasons — never fake success.
 *
 * Design decisions (documented for lead review):
 *
 * 1. TERMINAL-FIRST DECISIONS. `complete`/`failed` sessions cancel with a
 *    "nothing to do" reason regardless of mode/environment: the frozen FSM
 *    (WFX-004) makes them terminal — there is no completion left to drive.
 * 2. PAUSE, NEVER CANCEL, FOR ENVIRONMENT. `wifi-only` + cellular/offline
 *    and `charging-only` + discharging PAUSE (resumable). Only `mode:
 *    "never"` and terminal sessions cancel. Cancelling a live download
 *    because the network changed would destroy resumable work.
 * 3. CONCURRENCY IS DRIVER-OWNED STATE. `maxConcurrentCompletions` cannot be
 *    decided by the pure per-session `decideCompletion` (it has no view of
 *    other sessions); the completion driver (completion-driver.ts) enforces
 *    the cap and the FIFO release order. The pure function stays total over
 *    (session, policy, environment).
 * 4. MIN-FREE INTERPRETATION. `StoragePolicy.minFreeBytes` is headroom
 *    reserved INSIDE the cache ceiling: after any admission at least this
 *    many bytes must remain free under `maxCacheBytes`. The admission
 *    constraint is therefore `usedBytes - evicted + incoming <= maxCacheBytes
 *    - minFreeBytes` — WFX-014's `shouldAdmit` arithmetic tightened by the
 *    reserved headroom.
 * 5. WFX-014 LAYERING. Cache ACCOUNTING (entry order, `usedBytes`,
 *    eviction application) is the merged WFX-014 `CacheTracker`, imported —
 *    never reimplemented. WFX-024 layers policy on top: protected-entry
 *    immunity and the min-free headroom. The tracker's entry order (LRU or
 *    FIFO, maintained by `track`/`touch`) IS the eviction order walked here.
 * 6. PROTECTION IS A POLICY LIST. An entry is protected iff its key is in
 *    `StoragePolicy.protectedItems`. The governor (storage.ts) keys cache
 *    entries by ASSET id, so `protectedItems` is a list of asset ids and the
 *    same list decides persistence for completed downloads.
 * 7. SESSION SNAPSHOTS ARE STRICTLY VALIDATED. `validateBackgroundSession`
 *    requires every frozen field — `state` is REQUIRED (no default-filling:
 *    a snapshot without a state is corrupt, not "resolving").
 */

import type { NativeMediaSession } from "@wfx/domain";

import type { CacheTracker } from "../engine/cache";
import { NativeMediaError } from "../errors";
import { isSessionState } from "../session";

// ---------------------------------------------------------------------------
// Completion policy
// ---------------------------------------------------------------------------

/**
 * When playback pauses/ends, should the download keep running?
 * - `"always"`        — continue in every environment.
 * - `"wifi-only"`     — continue on wifi; PAUSE (resumable) otherwise.
 * - `"never"`         — cancel: background completion is disabled.
 * - `"charging-only"` — continue while charging; PAUSE (resumable) otherwise.
 */
export type CompletionMode = "always" | "wifi-only" | "never" | "charging-only";

/**
 * The background-completion policy. OS-constrained platform hints are NEVER
 * part of this policy — they are injected per decision as the
 * {@link BackgroundEnvironment}.
 */
export interface CompletionPolicy {
  readonly mode: CompletionMode;
  /**
   * Maximum simultaneously CONTINUING background completions. Enforced by
   * the completion driver (cross-session state); safe integer >= 1 — a cap
   * of 0 could never let anything complete and is rejected as a
   * configuration error.
   */
  readonly maxConcurrentCompletions: number;
}

/** Validated defaults: conservative (wifi-only, one completion at a time). */
export const DEFAULT_COMPLETION_POLICY: CompletionPolicy = {
  mode: "wifi-only",
  maxConcurrentCompletions: 1,
};

/** Runtime guard for {@link CompletionMode}. */
export function isCompletionMode(x: unknown): x is CompletionMode {
  return (
    x === "always" || x === "wifi-only" || x === "never" || x === "charging-only"
  );
}

/** Runtime guard for a well-formed {@link CompletionPolicy} value. */
export function isCompletionPolicy(x: unknown): x is CompletionPolicy {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    isCompletionMode(p.mode) &&
    typeof p.maxConcurrentCompletions === "number" &&
    Number.isSafeInteger(p.maxConcurrentCompletions) &&
    p.maxConcurrentCompletions >= 1
  );
}

function invalidInput(detail: string): NativeMediaError {
  return new NativeMediaError("INVALID_INPUT", { detail });
}

/**
 * Validate a COMPLETE {@link CompletionPolicy}; returns a fresh copy. Throws
 * a typed `INVALID_INPUT` error on a malformed policy — never a fake
 * default-filled one.
 */
export function validateCompletionPolicy(policy: unknown): CompletionPolicy {
  if (typeof policy !== "object" || policy === null) {
    throw invalidInput("CompletionPolicy: expected an object");
  }
  const p = policy as Record<string, unknown>;
  if (!isCompletionMode(p.mode)) {
    throw invalidInput(
      `CompletionPolicy: mode must be 'always' | 'wifi-only' | 'never' | 'charging-only' (got ${String(p.mode)})`,
    );
  }
  const cap = p.maxConcurrentCompletions;
  if (
    typeof cap !== "number" ||
    !Number.isSafeInteger(cap) ||
    cap < 1
  ) {
    throw invalidInput(
      `CompletionPolicy: maxConcurrentCompletions must be a safe integer >= 1 (got ${String(cap)}) — a cap of 0 could never let any completion run`,
    );
  }
  return { mode: p.mode, maxConcurrentCompletions: cap };
}

/**
 * Merge a partial {@link CompletionPolicy} over {@link
 * DEFAULT_COMPLETION_POLICY} and validate. Omitted / undefined fields use
 * the defaults; runtime garbage (strings, arrays, null) is rejected — it
 * must never silently resolve to the defaults.
 */
export function resolveCompletionPolicy(
  input?: Partial<CompletionPolicy>,
): CompletionPolicy {
  if (
    input !== undefined &&
    (typeof input !== "object" || input === null || Array.isArray(input))
  ) {
    throw invalidInput(
      `CompletionPolicy: input must be an object when provided (got ${String(input)})`,
    );
  }
  const i = (input ?? {}) as Partial<CompletionPolicy>;
  return validateCompletionPolicy({
    mode: i.mode ?? DEFAULT_COMPLETION_POLICY.mode,
    maxConcurrentCompletions:
      i.maxConcurrentCompletions ??
      DEFAULT_COMPLETION_POLICY.maxConcurrentCompletions,
  });
}

// ---------------------------------------------------------------------------
// Storage policy
// ---------------------------------------------------------------------------

/**
 * The local storage policy for background downloads. The byte ACCOUNTING is
 * the merged WFX-014 `CacheTracker` this policy governs (see module docs,
 * design decisions 4-6).
 */
export interface StoragePolicy {
  /** Total cache byte ceiling (non-negative safe integer). */
  readonly maxCacheBytes: number;
  /**
   * Asset ids whose cache entries are NEVER evicted and NEVER released.
   * Completed downloads for these assets are marked persistent.
   */
  readonly protectedItems: readonly string[];
  /** `"lru"` evicts least-recently-used first; `"fifo"` oldest-insert first. */
  readonly evictOrder: "lru" | "fifo";
  /**
   * Headroom reserved INSIDE the ceiling: after any admission at least this
   * many bytes must remain free under `maxCacheBytes`. Must be <=
   * `maxCacheBytes` (an unsatisfiable policy is rejected at validation).
   */
  readonly minFreeBytes: number;
}

/**
 * Validated defaults: a 2 GiB ceiling with a 64 MiB reserved headroom, LRU
 * eviction, nothing protected.
 */
export const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  maxCacheBytes: 2 * 1024 * 1024 * 1024,
  protectedItems: [],
  evictOrder: "lru",
  minFreeBytes: 64 * 1024 * 1024,
};

/**
 * Validate a COMPLETE {@link StoragePolicy}; returns a fresh copy
 * (`protectedItems` is copied). Throws a typed `INVALID_INPUT` error on
 * malformed values — including a `minFreeBytes` larger than the ceiling.
 */
export function validateStoragePolicy(policy: unknown): StoragePolicy {
  if (typeof policy !== "object" || policy === null) {
    throw invalidInput("StoragePolicy: expected an object");
  }
  const p = policy as Record<string, unknown>;
  const maxCacheBytes = p.maxCacheBytes;
  if (
    typeof maxCacheBytes !== "number" ||
    !Number.isSafeInteger(maxCacheBytes) ||
    maxCacheBytes < 0
  ) {
    throw invalidInput(
      `StoragePolicy: maxCacheBytes must be a non-negative safe integer (got ${String(maxCacheBytes)})`,
    );
  }
  const protectedItems = p.protectedItems;
  if (!Array.isArray(protectedItems)) {
    throw invalidInput(
      "StoragePolicy: protectedItems must be an array of asset ids",
    );
  }
  const seen = new Set<string>();
  for (const item of protectedItems) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw invalidInput(
        `StoragePolicy: protectedItems entries must be non-empty strings (got ${String(item)})`,
      );
    }
    if (seen.has(item)) {
      throw invalidInput(
        `StoragePolicy: duplicate protectedItems entry '${item}'`,
      );
    }
    seen.add(item);
  }
  const evictOrder = p.evictOrder;
  if (evictOrder !== "lru" && evictOrder !== "fifo") {
    throw invalidInput(
      `StoragePolicy: evictOrder must be 'lru' | 'fifo' (got ${String(evictOrder)})`,
    );
  }
  const minFreeBytes = p.minFreeBytes;
  if (
    typeof minFreeBytes !== "number" ||
    !Number.isSafeInteger(minFreeBytes) ||
    minFreeBytes < 0
  ) {
    throw invalidInput(
      `StoragePolicy: minFreeBytes must be a non-negative safe integer (got ${String(minFreeBytes)})`,
    );
  }
  if (minFreeBytes > maxCacheBytes) {
    throw invalidInput(
      `StoragePolicy: minFreeBytes (${minFreeBytes}) exceeds maxCacheBytes (${maxCacheBytes}) — the policy could never admit anything`,
    );
  }
  return {
    maxCacheBytes,
    protectedItems: [...protectedItems],
    evictOrder,
    minFreeBytes,
  };
}

/**
 * Merge a partial {@link StoragePolicy} over {@link DEFAULT_STORAGE_POLICY}
 * and validate. Omitted / undefined fields use the defaults; runtime garbage
 * is rejected outright.
 */
export function resolveStoragePolicy(
  input?: Partial<StoragePolicy>,
): StoragePolicy {
  if (
    input !== undefined &&
    (typeof input !== "object" || input === null || Array.isArray(input))
  ) {
    throw invalidInput(
      `StoragePolicy: input must be an object when provided (got ${String(input)})`,
    );
  }
  const i = (input ?? {}) as Partial<StoragePolicy>;
  return validateStoragePolicy({
    maxCacheBytes: i.maxCacheBytes ?? DEFAULT_STORAGE_POLICY.maxCacheBytes,
    protectedItems: i.protectedItems ?? DEFAULT_STORAGE_POLICY.protectedItems,
    evictOrder: i.evictOrder ?? DEFAULT_STORAGE_POLICY.evictOrder,
    minFreeBytes: i.minFreeBytes ?? DEFAULT_STORAGE_POLICY.minFreeBytes,
  });
}

// ---------------------------------------------------------------------------
// Background policy (composite)
// ---------------------------------------------------------------------------

/** The full WFX-024 policy: completion decisions + storage governance. */
export interface BackgroundPolicy {
  readonly completion: CompletionPolicy;
  readonly storage: StoragePolicy;
}

/**
 * Validate a {@link BackgroundPolicy}; returns a fresh deeply-validated
 * copy. Throws a typed `INVALID_INPUT` error when either half is malformed.
 */
export function validateBackgroundPolicy(policy: unknown): BackgroundPolicy {
  if (typeof policy !== "object" || policy === null) {
    throw invalidInput("BackgroundPolicy: expected an object");
  }
  const p = policy as Record<string, unknown>;
  return {
    completion: validateCompletionPolicy(p.completion),
    storage: validateStoragePolicy(p.storage),
  };
}

// ---------------------------------------------------------------------------
// Environment (injected platform hints — never assumed)
// ---------------------------------------------------------------------------

/** The network class the host reports. */
export type NetworkClass = "wifi" | "cellular" | "offline";

/**
 * The OS-constrained platform hints, INJECTED by the host for every
 * decision. No module in `background/` may read real network or battery
 * state — these are the only truth.
 */
export interface BackgroundEnvironment {
  readonly networkClass: NetworkClass;
  readonly charging: boolean;
}

/**
 * Validate a {@link BackgroundEnvironment}; returns a fresh copy. Throws a
 * typed `INVALID_INPUT` error on a malformed environment.
 */
export function validateBackgroundEnvironment(
  environment: unknown,
): BackgroundEnvironment {
  if (typeof environment !== "object" || environment === null) {
    throw invalidInput("BackgroundEnvironment: expected an object");
  }
  const e = environment as Record<string, unknown>;
  if (
    e.networkClass !== "wifi" &&
    e.networkClass !== "cellular" &&
    e.networkClass !== "offline"
  ) {
    throw invalidInput(
      `BackgroundEnvironment: networkClass must be 'wifi' | 'cellular' | 'offline' (got ${String(e.networkClass)})`,
    );
  }
  if (typeof e.charging !== "boolean") {
    throw invalidInput(
      `BackgroundEnvironment: charging must be a boolean (got ${String(e.charging)})`,
    );
  }
  return { networkClass: e.networkClass, charging: e.charging };
}

// ---------------------------------------------------------------------------
// Session snapshot validation
// ---------------------------------------------------------------------------

/**
 * Strictly validate a {@link NativeMediaSession} snapshot: EVERY frozen
 * field must be present and well-formed (`state` is required — unlike
 * `makeSession` there is no default). Returns a fresh six-field copy; the
 * input is never mutated nor retained. Throws a typed `INVALID_INPUT`
 * error on any malformation.
 */
export function validateBackgroundSession(
  session: unknown,
): NativeMediaSession {
  if (typeof session !== "object" || session === null) {
    throw invalidInput("session snapshot: expected an object");
  }
  const s = session as Record<string, unknown>;
  const { id, assetId, fileId, state, bufferedMs, positionMs } = s;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw invalidInput("session snapshot: 'id' must be a non-empty string");
  }
  if (typeof assetId !== "string" || assetId.trim().length === 0) {
    throw invalidInput("session snapshot: 'assetId' must be a non-empty string");
  }
  if (typeof fileId !== "string" || fileId.trim().length === 0) {
    throw invalidInput("session snapshot: 'fileId' must be a non-empty string");
  }
  if (!isSessionState(state)) {
    throw invalidInput(
      `session snapshot: state '${String(state)}' is not a session state (required — a snapshot must carry its FSM state)`,
    );
  }
  if (typeof bufferedMs !== "number" || !Number.isFinite(bufferedMs) || bufferedMs < 0) {
    throw invalidInput(
      `session snapshot: 'bufferedMs' must be a finite number >= 0 (got ${String(bufferedMs)})`,
    );
  }
  if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
    throw invalidInput(
      `session snapshot: 'positionMs' must be a finite number >= 0 (got ${String(positionMs)})`,
    );
  }
  return {
    id,
    assetId,
    fileId,
    state,
    bufferedMs,
    positionMs,
  integrity: "unknown",
  };
}

// ---------------------------------------------------------------------------
// decideCompletion — the pure decision matrix
// ---------------------------------------------------------------------------

/** The action the driver applies to a backgrounded session. */
export type CompletionAction = "continue" | "pause" | "cancel";

/**
 * The typed decision for one backgrounded session: what to do, and the
 * deterministic human-readable reason (golden-tested). A `pause` is always
 * RESUMEABLE — the environment that caused it can change back.
 */
export interface CompletionDecision {
  readonly action: CompletionAction;
  readonly reason: string;
}

/**
 * Decide what happens to a session's ongoing download when playback pauses
 * or ends. PURE and DETERMINISTIC: a total function of (session, policy,
 * environment). Terminal sessions (`complete`/`failed`) cancel — there is
 * nothing to complete. `mode: "never"` cancels. Environment-gated modes
 * (`wifi-only`, `charging-only`) PAUSE when the injected environment does
 * not allow continuing — never cancel (resumable work is preserved).
 *
 * Throws a typed `INVALID_INPUT` error on a malformed session, policy, or
 * environment (host programmer errors — never fake default-filled inputs).
 */
export function decideCompletion(
  session: NativeMediaSession,
  policy: CompletionPolicy,
  environment: BackgroundEnvironment,
): CompletionDecision {
  const s = validateBackgroundSession(session);
  const p = validateCompletionPolicy(policy);
  const e = validateBackgroundEnvironment(environment);

  if (s.state === "complete" || s.state === "failed") {
    return {
      action: "cancel",
      reason: `session '${s.id}' is already ${s.state}: nothing to complete`,
    };
  }
  switch (p.mode) {
    case "never":
      return {
        action: "cancel",
        reason:
          'completion mode "never": background completion is disabled by policy',
      };
    case "always":
      return {
        action: "continue",
        reason:
          'completion mode "always": background completion continues in every environment',
      };
    case "wifi-only":
      return e.networkClass === "wifi"
        ? {
            action: "continue",
            reason:
              'completion mode "wifi-only": networkClass is wifi — continuing',
          }
        : {
            action: "pause",
            reason: `completion mode "wifi-only": networkClass is ${e.networkClass} — pausing (resumable)`,
          };
    case "charging-only":
      return e.charging
        ? {
            action: "continue",
            reason:
              'completion mode "charging-only": device is charging — continuing',
          }
        : {
            action: "pause",
            reason:
              'completion mode "charging-only": device is not charging — pausing (resumable)',
          };
  }
}

// ---------------------------------------------------------------------------
// decideEviction — the pure eviction planner
// ---------------------------------------------------------------------------

/** One planned eviction victim: the cache key (asset id) and its bytes. */
export interface EvictionVictim {
  readonly key: string;
  readonly bytes: number;
}

/**
 * The typed eviction plan for admitting `incomingBytes`:
 *
 * - `ok: true` — the ordered victim list (least valuable first, per the
 *   tracker's WFX-014-maintained eviction order, protected entries
 *   skipped), the bytes they free, and the free bytes remaining under the
 *   ceiling AFTER the admission (`>= minFreeBytes` by construction).
 * - `ok: false` — a TYPED REFUSAL: evicting every non-protected entry
 *   still cannot satisfy the min-free headroom (or the incoming bytes
 *   alone exceed the effective ceiling). Nothing is applied; the refusal
 *   names the shortfall, the maximum freeable bytes, and the protected
 *   keys that blocked the plan. Never a fake partial success.
 */
export type EvictionPlan =
  | {
      readonly ok: true;
      readonly victims: readonly EvictionVictim[];
      readonly freedBytes: number;
      readonly freeBytesAfter: number;
    }
  | {
      readonly ok: false;
      readonly victims: readonly [];
      readonly freedBytes: 0;
      readonly shortfallBytes: number;
      readonly maxFreeableBytes: number;
      readonly protectedKeys: readonly string[];
      readonly reason: string;
    };

/**
 * Plan the evictions needed to admit `incomingBytes` under the storage
 * policy. PURE and DETERMINISTIC: a total function of (tracker,
 * incomingBytes, storage). The tracker provides the FACTS (entries in
 * WFX-014 eviction order, `usedBytes`); the storage policy is authoritative
 * for the ceiling, the protected set, and the min-free headroom.
 *
 * Throws a typed `INVALID_INPUT` error for a malformed tracker, incoming
 * bytes, or storage policy — never a garbage-in plan.
 */
export function decideEviction(
  tracker: CacheTracker,
  incomingBytes: number,
  storage: StoragePolicy,
): EvictionPlan {
  if (typeof tracker !== "object" || tracker === null) {
    throw invalidInput("decideEviction: tracker must be a CacheTracker");
  }
  if (!Array.isArray(tracker.entries)) {
    throw invalidInput("decideEviction: tracker.entries must be an array");
  }
  if (
    typeof tracker.usedBytes !== "number" ||
    !Number.isSafeInteger(tracker.usedBytes) ||
    tracker.usedBytes < 0
  ) {
    throw invalidInput(
      `decideEviction: tracker.usedBytes must be a non-negative safe integer (got ${String(tracker.usedBytes)})`,
    );
  }
  for (const entry of tracker.entries) {
    if (typeof entry !== "object" || entry === null) {
      throw invalidInput("decideEviction: tracker entries must be objects");
    }
    if (typeof entry.key !== "string" || entry.key.trim().length === 0) {
      throw invalidInput(
        `decideEviction: tracker entry key must be a non-empty string (got ${String(entry.key)})`,
      );
    }
    if (
      typeof entry.bytes !== "number" ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0
    ) {
      throw invalidInput(
        `decideEviction: tracker entry '${entry.key}' bytes must be a positive safe integer (got ${String(entry.bytes)})`,
      );
    }
  }
  if (
    typeof incomingBytes !== "number" ||
    !Number.isSafeInteger(incomingBytes) ||
    incomingBytes < 0
  ) {
    throw invalidInput(
      `decideEviction: incomingBytes must be a non-negative safe integer (got ${String(incomingBytes)})`,
    );
  }
  const s = validateStoragePolicy(storage);

  // Effective ceiling: maxCacheBytes with the min-free headroom reserved.
  const ceiling = s.maxCacheBytes - s.minFreeBytes;
  const usedBytes = tracker.usedBytes;

  // Fast path: the admission already fits without evicting anything.
  if (usedBytes + incomingBytes <= ceiling) {
    return {
      ok: true,
      victims: [],
      freedBytes: 0,
      freeBytesAfter: s.maxCacheBytes - usedBytes - incomingBytes,
    };
  }

  // Walk the WFX-014 eviction order (least valuable first), skipping
  // protected entries, until the headroom constraint is satisfied.
  const protectedSet = new Set(s.protectedItems);
  const victims: EvictionVictim[] = [];
  const protectedPresent: string[] = [];
  let freed = 0;
  let maxFreeable = 0;
  for (const entry of tracker.entries) {
    if (protectedSet.has(entry.key)) {
      protectedPresent.push(entry.key);
      continue;
    }
    maxFreeable += entry.bytes;
    if (usedBytes - freed + incomingBytes <= ceiling) {
      break;
    }
    victims.push({ key: entry.key, bytes: entry.bytes });
    freed += entry.bytes;
  }

  if (usedBytes - freed + incomingBytes > ceiling) {
    // Impossible: even evicting every non-protected entry cannot satisfy
    // the min-free headroom. TYPED REFUSAL — nothing is applied.
    const shortfall = usedBytes - freed + incomingBytes - ceiling;
    return {
      ok: false,
      victims: [],
      freedBytes: 0,
      shortfallBytes: shortfall,
      maxFreeableBytes: maxFreeable,
      protectedKeys: protectedPresent,
      reason:
        `eviction impossible: admitting ${incomingBytes} byte(s) still exceeds the effective ceiling ` +
        `(maxCacheBytes ${s.maxCacheBytes} - minFreeBytes ${s.minFreeBytes} = ${ceiling}) by ${shortfall} byte(s) ` +
        `after evicting every non-protected entry (${maxFreeable} byte(s) freeable); ` +
        `protected entries are never evicted` +
        (protectedPresent.length > 0 ? `: ${protectedPresent.join(", ")}` : ""),
    };
  }
  return {
    ok: true,
    victims,
    freedBytes: freed,
    freeBytesAfter: s.maxCacheBytes - (usedBytes - freed + incomingBytes),
  };
}
