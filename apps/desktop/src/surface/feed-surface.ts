/**
 * @wfx/app-desktop — the Desktop BYOF feed surface (R20-G).
 *
 * THE Desktop projection of Bring Your Own Feed: the frozen shared feed
 * runtime seam (`FeedPort`, contracts.md "Bring Your Own Feed") bound to
 * the Desktop platform envelope — the native file-import surface
 * (R20-F's binding), the full background-work sync executor (R20-F's
 * driver), and the richer filesystem cache — with the SAME semantics the
 * Web lane renders. This module PROJECTS; the semantics are the shared
 * contract's:
 *
 * - MODE TRUTH (shared, never forked): the frozen `readFeed` modes —
 *   `byof`/`hybrid` answer the imported records in SOURCE-NATIVE order
 *   (the order the source gave — data with provenance, NEVER a WebFlix
 *   rank); `following` answers the follow-graph subset; `webflix`
 *   answers EMPTY (the imported source-native records are never
 *   re-labeled as WebFlix-ranked content — the WebFlix feed is the
 *   Recommendation OS's).
 * - FRESHNESS/SYNC TRUTH: every record carries its `provenance.syncState`
 *   (the closed `FeedSyncState` vocabulary); a snapshot is NEVER
 *   presented as live (`live` is granted only by the sync state machine
 *   to a successfully continuously-synced route).
 * - PROVENANCE SURVIVAL: every view shows each record's provenance
 *   (connector, import method, captured-at, source-native order,
 *   relationship) and a failing source never erases the view — the sync
 *   driver retains records on every failure fold.
 * - IDEMPOTENT IMPORT: re-importing the same relationship addresses the
 *   same record (the shared port's deterministic import key — proven on
 *   the native path by the parity tests against the real store).
 * - CACHE TRUTH (the Desktop envelope's richer capability): the cached
 *   view is labeled with its own `savedAt`/`capturedAt` age and is never
 *   live; the port stays canonical.
 *
 * The `bound` flag is the honest capability truth: when the composition
 * root did not bind the feed block (no FeedPort transport), every read
 * answers the TYPED `unbound` verdict — never a silent empty feed, never
 * a fixture fallback (the acquisition-surface pattern).
 */

import type {
  FeedImport,
  FeedPort,
  FeedRecord,
  FeedSyncState,
} from "@wfx/domain";
import { FEED_SYNC_STATES } from "@wfx/domain";
import type { StoragePort, Unsubscribe } from "@wfx/platform-contracts";

import type { ShellIpc, ShellTaskStatus } from "../platform/shell-ipc";
import type {
  DesktopFeedImportBinding,
  DesktopFeedImportInput,
  DesktopFeedImportResult,
  DesktopFileImportCapability,
} from "../platform/feed-import";
import { createDesktopFeedImportBinding } from "../platform/feed-import";
import type { DesktopFeedSyncDriver, DesktopFeedSyncOutcome } from "../platform/feed-sync";
import { createDesktopFeedSyncDriver } from "../platform/feed-sync";
import type { DesktopFeedCache, DesktopFeedCacheEntry, DesktopFeedMode } from "../platform/feed-cache";
import { createDesktopFeedCache } from "../platform/feed-cache";

// The mode vocabulary is the platform layer's typing of the frozen
// FeedPort.readFeed modes (one vocabulary, shared with the cache).
export type { DesktopFeedMode } from "../platform/feed-cache";
export { DESKTOP_FEED_MODES } from "../platform/feed-cache";

// ---------------------------------------------------------------------------
// The feed view (the projection's truth)
// ---------------------------------------------------------------------------

/** The ordering truth of one view — never a WebFlix rank in disguise. */
export type DesktopFeedOrderSemantics =
  | "source-native"
  | "webflix-ranked";

/** One projected feed view: the records + the mode/order/freshness truth. */
export interface DesktopFeedView {
  /** The mode the view was read under (the frozen vocabulary). */
  readonly mode: DesktopFeedMode;
  /**
   * The ordering truth: `source-native` for the imported-record modes
   * (the order is DATA WITH PROVENANCE — the source's own order, never
   * a WebFlix recommendation score); `webflix-ranked` only for the
   * WebFlix mode (whose imported-record answer is empty by law).
   */
  readonly orderSemantics: DesktopFeedOrderSemantics;
  /** The records, exactly as the shared port ordered them. */
  readonly records: readonly FeedRecord[];
  /** The freshness states present in this view (the closed FeedSyncState vocabulary, deduplicated). */
  readonly freshness: readonly FeedSyncState[];
  /**
   * The WebFlix-mode truth, stated: when `mode === "webflix"`, why the
   * imported-record answer is empty (the honest note — imported
   * source-native records are never re-labeled WebFlix-ranked content).
   */
  readonly note: string | null;
}

/** The typed result of a feed read — an unbound/failed read is NEVER a silent empty view. */
export type DesktopFeedViewResult =
  | { readonly ok: true; readonly view: DesktopFeedView }
  | { readonly ok: false; readonly code: "unbound" | "unavailable"; readonly detail: string };

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** The composition-root block: the frozen shared feed port + the platform envelope. */
export interface DesktopFeedSurfaceOptions {
  /** The live native shell (file dialog + task registry). */
  readonly shell: ShellIpc;
  /** The frozen shared feed port (the canonical seam — server-backed in production wiring). */
  readonly feedPort: FeedPort;
  /** The shell's storage port (the feed cache's filesystem KV area). */
  readonly storage: StoragePort;
  /** The adapter session's clock (ISO "now" — the cache's savedAt stamp). */
  readonly now: () => string;
}

/** The Desktop BYOF feed surface (the projection the webview UI renders). */
export interface DesktopFeedSurface {
  /** Whether the BYOF feed block is bound (the honest capability truth). */
  readonly bound: boolean;
  /** The shell's file-import capability truth (typed unsupported verdict). */
  fileImportCapability(): Promise<DesktopFileImportCapability>;
  /** The first-class native import path (dialog → read → preview). */
  importFromFile(input: DesktopFeedImportInput): Promise<DesktopFeedImportResult>;
  /** Confirm a previewed import (idempotent; the user confirmed what they saw). */
  confirmImport(importId: string): Promise<FeedImport>;
  /** The feed view under a mode (the shared mode-truth law; source-native order is data, never a rank). */
  feedView(input: { readonly profileId: string; readonly mode: DesktopFeedMode }): Promise<DesktopFeedViewResult>;
  /**
   * The CACHED feed view (the Desktop envelope's richer local cache) —
   * honest `savedAt`/`capturedAt` age labels, never live; null when no
   * cache exists. The port stays canonical.
   */
  cachedFeedView(input: {
    readonly profileId: string;
    readonly mode: DesktopFeedMode;
  }): Promise<DesktopFeedCacheEntry | null>;
  /**
   * Refresh the feed view through the port and update the cache (the
   * host-owned cadence call — no hidden timers). Answers the same typed
   * result as `feedView`.
   */
  refreshFeedView(input: {
    readonly profileId: string;
    readonly mode: DesktopFeedMode;
  }): Promise<DesktopFeedViewResult>;
  /** Run one background sync pass (the R20-F executor; host-owned cadence). */
  runSync(input: { readonly importId: string }): Promise<DesktopFeedSyncOutcome>;
  /**
   * Schedule the import's background sync task (the sync INTENT — the
   * tracked task the executor drives on the host's cadence). Idempotent
   * per import; typed rejection when the registry refuses.
   */
  scheduleSync(input: {
    readonly importId: string;
    readonly label?: string;
  }): Promise<
    | { readonly accepted: true; readonly taskId: string }
    | { readonly accepted: false; readonly reason: string; readonly detail: string }
  >;
  /**
   * Stop synchronizing one import (the honest disconnect half): the task
   * is cancelled, the imported records are RETAINED (deletion is only
   * the explicit user path — the survival law).
   */
  cancelSync(importId: string): Promise<boolean>;
  /** The import's background sync task status (the registry's truth). */
  syncStatus(importId: string): Promise<ShellTaskStatus | null>;
  /** Observe background sync task transitions (the shell's task channel). */
  observeSync(listener: (status: ShellTaskStatus) => void): Unsubscribe;
  /** Clear the Desktop feed cache of one profile (the explicit eviction path). */
  clearCache(profileId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// The view fold (pure — the mode/order/freshness truth)
// ---------------------------------------------------------------------------

const WEBFLIX_MODE_NOTE =
  "the WebFlix feed is chosen by the WebFlix Recommendation OS; imported source-native records are never re-labeled as WebFlix-ranked content";

/** Fold the port's records into the projected view (pure; the mode-truth law). */
export function feedViewFromRecords(
  mode: DesktopFeedMode,
  records: readonly FeedRecord[],
): DesktopFeedView {
  if (mode === "webflix") {
    // The WebFlix mode's imported-record answer is empty BY LAW: the
    // WebFlix feed is the Recommendation OS's (the Web lane renders the
    // same mode truth — the parity tests pin it against the real store).
    return {
      mode,
      orderSemantics: "webflix-ranked",
      records: [],
      freshness: [],
      note: WEBFLIX_MODE_NOTE,
    };
  }
  const freshness: FeedSyncState[] = [];
  for (const record of records) {
    const state = record.provenance.syncState;
    if (FEED_SYNC_STATES.includes(state) && !freshness.includes(state)) freshness.push(state);
  }
  return {
    mode,
    orderSemantics: "source-native",
    records: [...records],
    freshness,
    note: null,
  };
}

// ---------------------------------------------------------------------------
// The unbound surface (the honest capability truth)
// ---------------------------------------------------------------------------

/** The honest UNBOUND surface: every operation answers the typed verdict — never a fake feed. */
export function createUnboundFeedSurface(): DesktopFeedSurface {
  const unboundDetail =
    "the BYOF feed block is not bound in this build — no shared feed port was provided at composition (never a fixture fallback, never a silent empty feed)";
  return {
    bound: false,
    fileImportCapability: async () => ({ supported: false, reason: "unsupported", detail: unboundDetail }),
    importFromFile: async () => ({ outcome: "unsupported", detail: unboundDetail }),
    confirmImport: async () => {
      throw new Error(unboundDetail);
    },
    feedView: async () => ({ ok: false, code: "unbound", detail: unboundDetail }),
    cachedFeedView: async () => null, // no cache exists — the capability is unbound (honest absence)
    refreshFeedView: async () => ({ ok: false, code: "unbound", detail: unboundDetail }),
    runSync: async () => ({ outcome: "unsupported", detail: unboundDetail }),
    scheduleSync: async () => ({
      accepted: false,
      reason: "unsupported",
      detail: unboundDetail,
    }),
    cancelSync: async () => false,
    syncStatus: async () => null,
    observeSync: () => () => undefined,
    clearCache: async () => undefined,
  };
}

// ---------------------------------------------------------------------------
// The bound surface
// ---------------------------------------------------------------------------

/**
 * Project the Desktop BYOF feed surface over the booted runtime's
 * platform envelope + the frozen shared feed port. Composes the R20-F
 * import binding, the R20-F sync driver, and the R20-G filesystem cache.
 */
export function createDesktopFeedSurface(options: DesktopFeedSurfaceOptions): DesktopFeedSurface {
  const importBinding: DesktopFeedImportBinding = createDesktopFeedImportBinding({
    shell: options.shell,
    feedPort: options.feedPort,
  });
  const syncDriver: DesktopFeedSyncDriver = createDesktopFeedSyncDriver({
    shell: options.shell,
    feedPort: options.feedPort,
  });
  const cache: DesktopFeedCache = createDesktopFeedCache({
    storage: options.storage,
    now: options.now,
  });

  // The surface's session truth: the imports confirmed through THIS
  // surface (the frozen FeedImport objects the port answered — cached
  // with the view, honestly labeled).
  const sessionImports: FeedImport[] = [];

  return {
    bound: true,

    fileImportCapability: () => importBinding.fileImportCapability(),

    importFromFile: (input) => importBinding.importFromFile(input),

    confirmImport(importId: string) {
      return importBinding.confirmImport(importId).then((imported) => {
        sessionImports.push(imported);
        return imported;
      });
    },

    async feedView(input) {
      try {
        const records = await options.feedPort.readFeed({
          profileId: input.profileId,
          mode: input.mode,
        });
        return { ok: true, view: feedViewFromRecords(input.mode, records) };
      } catch (thrown) {
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        return { ok: false, code: "unavailable", detail };
      }
    },

    async cachedFeedView(input) {
      return cache.load(input.profileId, input.mode);
    },

    async refreshFeedView(input) {
      const result = await this.feedView(input);
      if (result.ok) {
        await cache.save({
          profileId: input.profileId,
          mode: input.mode,
          records: result.view.records,
          imports: sessionImports,
        });
      }
      return result;
    },

    runSync: (input) => syncDriver.runSync(input),
    scheduleSync: (input) => syncDriver.scheduleSync(input),
    cancelSync: (importId) => syncDriver.cancelSync(importId),
    syncStatus: (importId) => syncDriver.syncStatus(importId),
    observeSync: (listener) => syncDriver.observeSync(listener),

    clearCache: (profileId) => cache.clear(profileId),
  };
}
