/**
 * @wfx/app-desktop — the Desktop BYOF feed cache (R20-G).
 *
 * THE "richer local cache where supported" the frozen BYOF platform
 * model names for Desktop: the feed view's PRESENTATION cache over the
 * shell's filesystem KV area, so a restarted Desktop can render the
 * user's imported feed instantly (labeled as cached) before the first
 * fresh read completes.
 *
 * THE CACHE LAW (non-negotiable, the frozen architecture's reject rule
 * "local storage replacing canonical server persistence"):
 * - The canonical truth of imported feed records is the shared
 *   `FeedPort` (the server-side store behind it). This cache is a
 *   PRESENTATION cache — every entry carries `savedAt` (when the cache
 *   was written) and `capturedAt` (the feed's own capture truth) and is
 *   NEVER presented as live: the surface labels cached views honestly
 *   and refreshes through the port.
 * - The cache NEVER silently substitutes for a port read: it answers
 *   `null` when empty and never fabricates records.
 * - Eviction is explicit (`clear`) — no silent eviction, no quota
 *   theater beyond the storage port's own disk-truth law.
 */

import type { FeedImport, FeedRecord } from "@wfx/domain";

import type { StoragePort } from "@wfx/platform-contracts";

// ---------------------------------------------------------------------------
// The mode vocabulary (the frozen FeedPort.readFeed modes, platform-typed)
// ---------------------------------------------------------------------------

/**
 * The feed modes — the frozen `FeedPort.readFeed` mode union verbatim
 * (`'webflix' | 'following' | 'byof' | 'hybrid'`), typed on the platform
 * side so the cache and the surface share ONE vocabulary (the surface
 * re-exports it). The SEMANTICS are the shared contract's.
 */
export type DesktopFeedMode = "webflix" | "following" | "byof" | "hybrid";

/** Every valid mode (union order). */
export const DESKTOP_FEED_MODES: readonly DesktopFeedMode[] = [
  "webflix",
  "following",
  "byof",
  "hybrid",
];

// ---------------------------------------------------------------------------
// The cached entry
// ---------------------------------------------------------------------------


/** The cached snapshot of one feed view (every field honest about its age). */
export interface DesktopFeedCacheEntry {
  /** The profile the view belongs to. */
  readonly profileId: string;
  /** The feed mode the view was read under (the frozen readFeed modes). */
  readonly mode: DesktopFeedMode;
  /**
   * When THIS CACHE was written (the adapter's clock) — the label that
   * keeps a cached view from masquerading as fresh.
   */
  readonly savedAt: string;
  /**
   * The feed's own capture truth (the newest `provenance.capturedAt`
   * among the cached records) — the snapshot's age, distinct from
   * `savedAt`.
   */
  readonly capturedAt: string;
  /** The cached records, in the order the port answered (source-native order is data with provenance). */
  readonly records: readonly FeedRecord[];
  /** The cached import-session states (the desktop surface's own session truth). */
  readonly imports: readonly FeedImport[];
}

/** The cache's KV key for one profile + mode. */
function cacheKey(profileId: string, mode: DesktopFeedMode): string {
  return `wfx-feed-cache/${profileId}/${mode}`;
}

/** The clock seam (the adapter session's clock — injected, deterministic in tests). */
export interface DesktopFeedCacheOptions {
  /** The shell's storage port (the filesystem KV area). */
  readonly storage: StoragePort;
  /** The adapter's clock (ISO timestamp of "now" for `savedAt`). */
  readonly now: () => string;
}

/**
 * Build the Desktop BYOF feed cache over the shell's filesystem storage.
 * Pure presentation cache — the port stays canonical.
 */
export function createDesktopFeedCache(options: DesktopFeedCacheOptions) {
  const { storage, now } = options;

  return {
    /**
     * Cache one feed view (the honest entry: savedAt + capturedAt + the
     * records exactly as the port answered them).
     */
    async save(input: {
      readonly profileId: string;
      readonly mode: DesktopFeedMode;
      readonly records: readonly FeedRecord[];
      readonly imports: readonly FeedImport[];
    }): Promise<void> {
      // The feed's own capture truth: the newest provenance.capturedAt.
      const capturedAt = input.records.reduce<string>((newest, record) => {
        const at = record.provenance.capturedAt;
        return at > newest ? at : newest;
      }, input.records[0]?.provenance.capturedAt ?? "");

      const entry: DesktopFeedCacheEntry = {
        profileId: input.profileId,
        mode: input.mode,
        savedAt: now(),
        capturedAt,
        records: [...input.records],
        imports: [...input.imports],
      };
      await storage.set(cacheKey(input.profileId, input.mode), JSON.stringify(entry));
    },

    /**
     * The cached entry (null when none) — VERBATIM records with their age
     * labels; the caller (the surface) renders the cached truth honestly.
     */
    async load(profileId: string, mode: DesktopFeedMode): Promise<DesktopFeedCacheEntry | null> {
      const raw = await storage.get(cacheKey(profileId, mode));
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as DesktopFeedCacheEntry;
        if (
          typeof parsed?.savedAt !== "string" ||
          typeof parsed?.capturedAt !== "string" ||
          !Array.isArray(parsed?.records) ||
          !Array.isArray(parsed?.imports) ||
          parsed.profileId !== profileId ||
          parsed.mode !== mode
        ) {
          return null; // a malformed cache is an honest miss, never a fabricated view
        }
        return parsed;
      } catch {
        return null; // unreadable cache = miss (the port is canonical)
      }
    },

    /** Clear every cached mode of one profile (the explicit eviction path). */
    async clear(profileId: string): Promise<void> {
      const keys = await storage.keys(`wfx-feed-cache/${profileId}/`);
      for (const key of keys) {
        await storage.remove(key);
      }
    },
  };
}

/** The cache's type (the surface composes it). */
export type DesktopFeedCache = ReturnType<typeof createDesktopFeedCache>;
