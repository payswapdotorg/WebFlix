/**
 * @wfx/client-runtime — library semantics (R01).
 *
 * Source-neutral, CANONICAL-ITEM-KEYED library semantics:
 *
 * 1. ONE KEY — saves key on the canonical item id (`wfxitm_...`), never on
 *    a source ref; the runtime joins to the source ref(s) it knows for the
 *    write-through (the cross-source realization seam R04 completes).
 * 2. LOCAL-FIRST, HONEST SYNC — a save appears immediately as `pending`
 *    and settles to `synced`/`failed`/`unsupported`/`conflict` by the
 *    frozen `ActionReceipt` mapping (`local-only` -> `conflict`: recorded
 *    at the source without external confirmation — the WFX-022 mirror
 *    vocabulary). A sync failure NEVER removes the local entry silently;
 *    it settles the entry's sync state honestly.
 * 3. WATCHLIST vs HISTORY — the watchlist is explicit saves; history is
 *    the session watch-state fold (positions, completion, labels). The
 *    `library()` read model assembles both, canonical-keyed, with typed
 *    section statuses (a failing server read is an ERROR section, never a
 *    fake empty one).
 * 4. UNKNOWN ITEMS CANNOT BE SAVED — a canonical id the runtime has no
 *    source realization for answers a typed `not-found` failure (there is
 *    nothing to write through) — never a fake local-only save.
 *
 * The sync-state vocabulary mirrors the WFX-022 outbox statuses (the same
 * closed mirror `@wfx/experience`'s library model uses — one law, shared).
 */

import type { ActionReceipt, LibraryCommand, LibraryEntry } from "@wfx/domain";
import { isEntertainmentItemId, previewValue } from "@wfx/domain";
import type { Unsubscribe } from "@wfx/platform-contracts";

import type { RuntimeClock } from "./runtime-seams";
import type { ProfileHistoryEntry, ServerFailure, ServerPort } from "./server-port";
import type { CanonicalItemRegistry } from "./registry";
import type { SessionWatchState, SessionWatchStatus, WatchStateEngine } from "./watch-state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The closed save-sync vocabulary (the WFX-022 mirror). */
export type LibrarySyncState =
  /** Present at the source; no pending ops. */
  | "synced"
  /** Recorded locally; the add/remove awaits delivery. */
  | "pending"
  /** The command settled terminally `failed`. */
  | "failed"
  /** The command settled terminally `unsupported`. */
  | "unsupported"
  /** A `local-only` receipt: recorded without external confirmation. */
  | "conflict";

/** Every value of `LibrarySyncState`, in union order. */
export const LIBRARY_SYNC_STATES: readonly LibrarySyncState[] = [
  "synced",
  "pending",
  "failed",
  "unsupported",
  "conflict",
];

/** One canonical-keyed watchlist (save) entry. */
export interface WatchlistEntry {
  /** The canonical item id (the key — law 1). */
  readonly itemId: string;
  /** Display title (the registered source title, never fabricated). */
  readonly title: string;
  /** The user list the save filed under (default `"Saved"`). */
  readonly listName: string;
  readonly sync: LibrarySyncState;
  /** ISO timestamp of the local save. */
  readonly savedAt: string;
  /** Honest failure/unsupported detail when settled. */
  readonly detail?: string;
}

/** The default list name for saves without one. */
export const DEFAULT_WATCHLIST_NAME = "Saved";

/** One history entry (the watch-state fold joined to its canonical item). */
export interface HistoryEntry {
  readonly itemId: string;
  readonly title: string;
  readonly watch: SessionWatchState;
}

/** The typed section status of a library read (never fake-empty). */
export interface LibrarySectionStatus {
  readonly state: "ready" | "error";
  /** Present iff `state === "error"`: what failed. */
  readonly errorDetail?: string;
}

/** The library read model (the sketch's `LibraryModel`). */
export interface LibraryModel {
  readonly watchlist: {
    readonly status: LibrarySectionStatus;
    readonly entries: readonly WatchlistEntry[];
  };
  readonly history: {
    readonly status: LibrarySectionStatus;
    readonly entries: readonly HistoryEntry[];
  };
}

/** The library query (section inclusion; defaults to both). */
export interface LibraryQuery {
  readonly includeWatchlist?: boolean;
  readonly includeHistory?: boolean;
}

/** The typed result of a library write. */
export type LibraryWriteResult =
  | { readonly ok: true; readonly entry: WatchlistEntry }
  | { readonly ok: false; readonly kind: "not-found" | "network" | "unauthorized" | "unavailable" | "invalid-input"; readonly detail: string };

/** Listener for watchlist changes. */
export type WatchlistListener = (entries: readonly WatchlistEntry[]) => void;

/** The library operations surface (exposed via the runtime). */
export interface LibraryOperations {
  /** Save one canonical item (local-first; typed result — law 2). */
  save(input: { itemId: string; listName?: string }): Promise<LibraryWriteResult>;
  /** Remove one canonical item's save (typed result — law 2). */
  remove(itemId: string): Promise<LibraryWriteResult>;
  /** The current watchlist (local view). */
  entries(): readonly WatchlistEntry[];
  /** Observe watchlist changes. */
  subscribe(listener: WatchlistListener): Unsubscribe;
}

// ---------------------------------------------------------------------------
// Receipt mapping (the frozen statuses -> the sync vocabulary)
// ---------------------------------------------------------------------------

/** Narrow a transport failure to the library write result kinds. */
function libraryFailureKind(failure: ServerFailure): "network" | "unauthorized" | "unavailable" {
  switch (failure.kind) {
    case "network":
      return "network";
    case "unauthorized":
      return "unauthorized";
    default:
      return "unavailable";
  }
}

/** Map a frozen `ActionReceipt` to the library sync vocabulary. */
export function receiptToLibrarySync(
  receipt: ActionReceipt,
): { sync: LibrarySyncState; detail?: string } {
  switch (receipt.status) {
    case "confirmed":
      return { sync: "synced" };
    case "local-only":
      return {
        sync: "conflict",
        detail: receipt.detail ?? "recorded at the source without external confirmation",
      };
    case "unsupported":
      return { sync: "unsupported", detail: receipt.detail ?? "the source cannot perform this" };
    case "failed":
      return { sync: "failed", detail: receipt.detail ?? "the source reported a failure" };
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The library engine: canonical-keyed saves with honest sync + the
 * canonical-keyed history projection. Created by `createRuntime`.
 */
export class LibraryEngine {
  private readonly watchlist = new Map<string, WatchlistEntry>();
  private readonly listeners = new Set<WatchlistListener>();

  constructor(
    private readonly server: ServerPort,
    private readonly registry: CanonicalItemRegistry,
    private readonly watch: WatchStateEngine,
    private readonly clock: RuntimeClock,
  ) {}

  /** The operations surface. */
  operations(): LibraryOperations {
    return {
      save: (input) => this.save(input),
      remove: (itemId) => this.remove(itemId),
      entries: () => [...this.watchlist.values()],
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
  }

  private notify(): void {
    const entries = [...this.watchlist.values()];
    for (const listener of this.listeners) listener(entries);
  }

  private put(entry: WatchlistEntry): void {
    this.watchlist.set(entry.itemId, entry);
    this.notify();
  }

  /** Save one canonical item (law 1/2/4). */
  async save(input: { itemId: string; listName?: string }): Promise<LibraryWriteResult> {
    if (!isEntertainmentItemId(input?.itemId)) {
      return {
        ok: false,
        kind: "invalid-input",
        detail: `save.itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(input?.itemId)}`,
      };
    }
    const registered = this.registry.get(input.itemId);
    if (registered === undefined) {
      // Law 4: unknown items cannot be saved — nothing to write through.
      return {
        ok: false,
        kind: "not-found",
        detail: `item '${input.itemId}' has no known source realization in this session — save it after browsing/searching it`,
      };
    }
    const listName =
      typeof input.listName === "string" && input.listName.trim().length > 0
        ? input.listName
        : DEFAULT_WATCHLIST_NAME;
    const savedAt = new Date(this.clock.now()).toISOString();
    const pending: WatchlistEntry = {
      itemId: input.itemId,
      title: registered.title,
      listName,
      sync: "pending",
      savedAt,
    };
    this.put(pending); // local-first (law 2)

    const command: LibraryCommand = {
      op: "add",
      externalRef: registered.externalRef,
      title: registered.title,
      metadata: { list: listName, connectorId: registered.connectorId },
    };
    const result = await this.server.writeLibrary(command);
    if (!result.ok) {
      this.put({
        ...pending,
        sync: "failed",
        detail: `${result.failure.kind}: ${result.failure.detail}`,
      });
      return {
        ok: false,
        kind: libraryFailureKind(result.failure),
        detail: result.failure.detail,
      };
    }
    const mapped = receiptToLibrarySync(result.value);
    const settled: WatchlistEntry = {
      ...pending,
      sync: mapped.sync,
      ...(mapped.detail !== undefined ? { detail: mapped.detail } : {}),
    };
    this.put(settled);
    return { ok: true, entry: settled };
  }

  /** Remove one canonical item's save (law 2). */
  async remove(itemId: string): Promise<LibraryWriteResult> {
    if (!isEntertainmentItemId(itemId)) {
      return {
        ok: false,
        kind: "invalid-input",
        detail: `remove.itemId: expected a canonical entertainment-item ID, got ${previewValue(itemId)}`,
      };
    }
    const existing = this.watchlist.get(itemId);
    if (existing === undefined) {
      return {
        ok: false,
        kind: "not-found",
        detail: `item '${itemId}' is not in the local watchlist`,
      };
    }
    const registered = this.registry.get(itemId);
    if (registered === undefined) {
      return {
        ok: false,
        kind: "not-found",
        detail: `item '${itemId}' has no known source realization in this session`,
      };
    }
    const command: LibraryCommand = {
      op: "remove",
      externalRef: registered.externalRef,
      metadata: { connectorId: registered.connectorId },
    };
    const result = await this.server.writeLibrary(command);
    if (!result.ok) {
      this.put({
        ...existing,
        sync: "failed",
        detail: `${result.failure.kind}: ${result.failure.detail}`,
      });
      return { ok: false, kind: libraryFailureKind(result.failure), detail: result.failure.detail };
    }
    const mapped = receiptToLibrarySync(result.value);
    if (mapped.sync === "unsupported" || mapped.sync === "failed") {
      // The remote remove failed/unsupported: keep the local entry with the
      // honest sync state (never a silent drop — law 2).
      this.put({
        ...existing,
        sync: mapped.sync,
        ...(mapped.detail !== undefined ? { detail: mapped.detail } : {}),
      });
      return {
        ok: false,
        kind: "unavailable",
        detail: mapped.detail ?? "the remove settled without confirmation",
      };
    }
    this.watchlist.delete(itemId);
    this.notify();
    return { ok: true, entry: existing };
  }

  /** The library read model (the sketch's `library()` body). */
  async read(query?: LibraryQuery): Promise<LibraryModel> {
    const includeWatchlist = query?.includeWatchlist !== false;
    const includeHistory = query?.includeHistory !== false;

    // — R02: hydrate the PROFILE-SCOPED server state (cross-device) —
    // A failing server read is an ERROR section (never a fake empty one);
    // the local session state still renders when the server is unreachable.
    let serverHistory: readonly ProfileHistoryEntry[] = [];
    let historyError: string | undefined;
    if (includeHistory) {
      const result = await this.server.readHistory();
      if (result.ok) {
        serverHistory = result.value;
      } else {
        historyError = `${result.failure.kind}: ${result.failure.detail}`;
      }
    }

    let serverLibrary: readonly LibraryEntry[] = [];
    let watchlistError: string | undefined;
    if (includeWatchlist) {
      const result = await this.server.readProfileLibrary();
      if (result.ok) {
        serverLibrary = result.value;
      } else {
        watchlistError = `${result.failure.kind}: ${result.failure.detail}`;
      }
    }

    // Watchlist: local-first entries (their sync states are local truth) +
    // server profile entries the local view does not know (cross-device
    // saves), joined through the canonical registry.
    const localWatchlist = includeWatchlist
      ? [...this.watchlist.values()].sort((a, b) =>
          a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.itemId < b.itemId ? -1 : 1,
        )
      : ([] as readonly WatchlistEntry[]);
    const mergedWatchlist: WatchlistEntry[] = [...localWatchlist];
    if (includeWatchlist) {
      for (const entry of serverLibrary) {
        if (typeof entry?.externalRef !== "string" || entry.externalRef.length === 0) continue;
        const item = this.registry.register({
          connectorId: entry.connectorId,
          externalRef: entry.externalRef,
          title: entry.title ?? entry.externalRef,
        });
        if (this.watchlist.has(item.id)) continue; // local-first: local truth wins
        const metadata = entry.metadata as Record<string, unknown> | undefined;
        const list = metadata?.list;
        mergedWatchlist.push({
          itemId: item.id,
          title: entry.title ?? entry.externalRef,
          listName: typeof list === "string" && list.length > 0 ? list : DEFAULT_WATCHLIST_NAME,
          sync: "synced" as const, // server-sourced: present at the source
          // A server entry without addedAt renders as discovered-now (the
          // injected clock — never a fabricated historical instant).
          savedAt: entry.addedAt ?? new Date(this.clock.now()).toISOString(),
        });
      }
      mergedWatchlist.sort((a, b) =>
        a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : a.itemId < b.itemId ? -1 : 1,
      );
    }

    const watchlistSection = {
      status: watchlistError === undefined
        ? { state: "ready" as const }
        : { state: "error" as const, errorDetail: watchlistError },
      entries: mergedWatchlist,
    };

    if (!includeHistory) {
      return { watchlist: watchlistSection, history: { status: { state: "ready" }, entries: [] } };
    }

    // History: the session watch-state fold joined to canonical titles
    // (honest: unregistered items keep their id as the title — never a
    // fabricated name), MERGED with the server's profile-scoped history —
    // the session fold is the freshest local evidence and wins per item;
    // server-only entries fill the cross-device view.
    const watchStates = this.watch.operations().all();
    const sessionItemIds = new Set(watchStates.map((state) => state.itemId));
    const historyEntries: HistoryEntry[] = watchStates.map((state) => ({
      itemId: state.itemId,
      title: this.registry.get(state.itemId)?.title ?? state.itemId,
      watch: state,
    }));
    for (const entry of serverHistory) {
      if (typeof entry?.itemId !== "string" || entry.itemId.length === 0) continue;
      if (sessionItemIds.has(entry.itemId)) continue; // session evidence wins
      historyEntries.push({
        itemId: entry.itemId,
        title: this.registry.get(entry.itemId)?.title ?? entry.itemId,
        watch: serverHistoryToWatchState(entry),
      });
    }
    historyEntries.sort((a, b) => {
      const aMs = Date.parse(a.watch.lastWatchedAt);
      const bMs = Date.parse(b.watch.lastWatchedAt);
      const aTime = Number.isNaN(aMs) ? Number.NEGATIVE_INFINITY : aMs;
      const bTime = Number.isNaN(bMs) ? Number.NEGATIVE_INFINITY : bMs;
      return bTime - aTime || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
    });

    return {
      watchlist: watchlistSection,
      history: {
        status: historyError === undefined
          ? { state: "ready" as const }
          : { state: "error" as const, errorDetail: historyError },
        entries: historyEntries,
      },
    };
  }
}

/**
 * Project one server history entry into the session watch-state view (the
 * cross-device hydration of the R01 fold shape — honest: completion is 1
 * exactly when completed, `null` when the server reports no duration
 * basis, positions never fabricated).
 */
function serverHistoryToWatchState(entry: ProfileHistoryEntry): SessionWatchState {
  const status: SessionWatchStatus =
    entry.completed ? "completed" : entry.lastEventType === "skip" ? "skipped" : "in-progress";
  return {
    itemId: entry.itemId,
    lastPositionMs: entry.positionMs,
    highestPositionMs: entry.positionMs,
    completionRatio: entry.completed ? 1 : null,
    lastWatchedAt: entry.updatedAt,
    status,
  };
}
