/**
 * @wfx/client-runtime — the canonical item registry (R01; R04 server-id
 * adoption).
 *
 * Source-neutral, CANONICAL-ITEM-KEYED identity: search/metadata/shorts
 * results are source-keyed (`connectorId` + `externalRef`); the runtime
 * joins them to stable canonical `wfxitm_` item ids so library, watch
 * state, and navigation key on ONE identity regardless of source. The same
 * stopgap discipline as `@wfx/experience`'s feed use-case (canonical ids
 * minted from the injected `IdGen` until the Entertainment Graph owns
 * item identity) — with the stability guarantee the runtime needs: a
 * source key maps to the SAME canonical id for the whole runtime session
 * (documented; cross-session/server-side identity is R02/R04 scope).
 *
 * R04 — DURABLE SERVER-SOURCED CANONICAL IDS (the spec §4 law):
 *
 * Server-provided canonical ids WIN: when the server's library/history
 * answers carry canonical item ids (`ProfileHistoryEntry.itemId` directly;
 * `LibraryEntry.metadata.canonicalItemId` on library rows), the registry
 * ADOPTS them (durable, cross-session). Session-local ULID minting
 * (`register`) retires to the fallback for genuinely-unseen items (search
 * hits the server has no row for yet). The `reconcileBySourceKey` method
 * re-points an existing source-keyed entry to the server-sourced id when
 * the locally-minted id was a placeholder; `registerCanonical` registers a
 * server-sourced id directly when no source key is known (history rows
 * whose realization the runtime hasn't seen yet).
 *
 * The local-first fold stays intact (R07's surface story): local saves
 * render immediately; the server merge reconciles ids on the next read.
 */

import { ENTERTAINMENT_ITEM_ID_PREFIX, isEntertainmentItemId } from "@wfx/domain";
import type { EntertainmentItem, SearchResult, SourceItem } from "@wfx/domain";

import type { RuntimeIdGen } from "./runtime-seams";

/** The canonical item view the runtime keeps for one source key. */
export interface RegisteredItem {
  readonly item: EntertainmentItem;
  /** The source key the item was first registered from. */
  readonly connectorId: string;
  readonly externalRef: string;
  /** The source's title (fallback display). */
  readonly title: string;
}

/** The registry key of one source-keyed result. */
function sourceKey(connectorId: string, externalRef: string): string {
  return `${connectorId}:${externalRef}`;
}

/** Shape-check one search hit (defensive; mirrors the feed use-case's guard). */
function isUsableSearchHit(hit: unknown): hit is SearchResult {
  if (typeof hit !== "object" || hit === null) return false;
  const record = hit as Record<string, unknown>;
  return (
    typeof record.connectorId === "string" &&
    record.connectorId.length > 0 &&
    typeof record.externalRef === "string" &&
    record.externalRef.length > 0 &&
    typeof record.title === "string"
  );
}

/**
 * The canonical item registry: source-keyed results in, stable canonical
 * items out. Pure bookkeeping (no clock, no network); ids come from the
 * injected seam.
 */
export class CanonicalItemRegistry {
  private readonly bySourceKey = new Map<string, RegisteredItem>();
  private readonly byItemId = new Map<string, RegisteredItem>();

  constructor(private readonly ids: RuntimeIdGen) {}

  /**
   * Register one search hit (or metadata item); returns the CANONICAL item.
   * Re-registration of the same source key updates metadata but KEEPS the
   * canonical id (the stability law).
   */
  register(hit: SearchResult | SourceItem): EntertainmentItem {
    if (!isUsableSearchHit(hit)) {
      throw new Error(
        "registry.register: expected a usable SearchResult/SourceItem (non-empty connectorId/externalRef, string title)",
      );
    }
    const key = sourceKey(hit.connectorId, hit.externalRef);
    const existing = this.bySourceKey.get(key);
    const itemId = existing?.item.id ?? ENTERTAINMENT_ITEM_ID_PREFIX + this.ids.next();
    const item: EntertainmentItem = {
      id: itemId,
      // The neutral vocabulary member for hits without a type claim — the
      // canonical type is presentation metadata, never a fabricated
      // 'movie'/'series' claim (documented law).
      canonicalType: hit.canonicalType ?? "video",
      canonicalTitle: hit.title,
      ...(hit.durationMs !== undefined ? { durationMs: hit.durationMs } : {}),
      ...(hit.orientation !== undefined ? { orientation: hit.orientation } : {}),
    };
    const registered: RegisteredItem = {
      item,
      connectorId: hit.connectorId,
      externalRef: hit.externalRef,
      title: hit.title,
    };
    this.bySourceKey.set(key, registered);
    if (!this.byItemId.has(itemId)) this.byItemId.set(itemId, registered);
    return item;
  }

  /**
   * R04: Reconcile a SERVER-SOURCED canonical id with the local source-keyed
   * view. When the same source key is already registered with a DIFFERENT
   * (locally-minted) id, the SERVER id WINS — the source-keyed view is
   * RE-POINTED to the server id, and the local id's `byItemId` entry is
   * REMOVED (it was a placeholder; the registry reconciles to the durable
   * id). When the server id matches an existing entry (already reconciled),
   * the source key is added if missing. When neither view knows the id,
   * register a server-sourced entry directly.
   *
   * The `title` is the server-sourced title (the canonical catalog's claim);
   * pass the server's title verbatim. When the server title is unknown,
   * pass the existing local title (no fabricated name).
   */
  reconcileBySourceKey(
    connectorId: string,
    externalRef: string,
    itemId: string,
    title: string,
  ): EntertainmentItem {
    if (!isEntertainmentItemId(itemId)) {
      throw new Error(
        `registry.reconcileBySourceKey: expected a canonical entertainment-item ID, got ${JSON.stringify(itemId)}`,
      );
    }
    const key = sourceKey(connectorId, externalRef);
    const existingByKey = this.bySourceKey.get(key);
    const existingById = this.byItemId.get(itemId);

    if (existingByKey !== undefined && existingByKey.item.id === itemId) {
      // Already reconciled — refresh the title (the server's claim wins).
      const refreshed: RegisteredItem = {
        ...existingByKey,
        title,
        item: { ...existingByKey.item, canonicalTitle: title },
      };
      this.bySourceKey.set(key, refreshed);
      this.byItemId.set(itemId, refreshed);
      return refreshed.item;
    }

    if (existingByKey !== undefined && existingByKey.item.id !== itemId) {
      // The source key was registered with a LOCALLY-MINTED id; the server
      // id WINS. Remove the local id's view; re-point the source key.
      this.byItemId.delete(existingByKey.item.id);
      const item: EntertainmentItem = {
        id: itemId,
        canonicalType: existingByKey.item.canonicalType,
        canonicalTitle: title,
        ...(existingByKey.item.durationMs !== undefined
          ? { durationMs: existingByKey.item.durationMs }
          : {}),
        ...(existingByKey.item.orientation !== undefined
          ? { orientation: existingByKey.item.orientation }
          : {}),
      };
      const registered: RegisteredItem = {
        item,
        connectorId,
        externalRef,
        title,
      };
      this.bySourceKey.set(key, registered);
      this.byItemId.set(itemId, registered);
      return item;
    }

    if (existingById !== undefined) {
      // The server id is already registered (e.g. a different source key
      // already adopted it). Add THIS source key to the existing entry.
      const registered: RegisteredItem = {
        ...existingById,
        connectorId,
        externalRef,
        title,
      };
      this.bySourceKey.set(key, registered);
      // Keep the existing byItemId entry UNLESS the source key now has a
      // fresher title (the server's claim wins).
      this.byItemId.set(itemId, registered);
      return registered.item;
    }

    // Neither view knows this id — register a server-sourced entry directly.
    const item: EntertainmentItem = {
      id: itemId,
      canonicalType: "video",
      canonicalTitle: title,
    };
    const registered: RegisteredItem = {
      item,
      connectorId,
      externalRef,
      title,
    };
    this.bySourceKey.set(key, registered);
    this.byItemId.set(itemId, registered);
    return item;
  }

  /**
   * R04: Register a server-sourced canonical id DIRECTLY (no source key).
   * Used for history rows whose realization the runtime hasn't seen yet —
   * the server's canonical id is the durable identity. The title is the
   * server's claim verbatim (never fabricated).
   *
   * TITLE LAW: when the id is ALREADY registered (e.g. from a search hit
   * that has a real title), the EXISTING title is KEPT — the history fold's
   * placeholder (the itemId itself) is never a better title than what the
   * registry already has. The id adoption is the durable effect; the title
   * stays honest.
   */
  registerCanonical(itemId: string, title: string): EntertainmentItem {
    if (!isEntertainmentItemId(itemId)) {
      throw new Error(
        `registry.registerCanonical: expected a canonical entertainment-item ID, got ${JSON.stringify(itemId)}`,
      );
    }
    const existing = this.byItemId.get(itemId);
    if (existing !== undefined) {
      // The id is already registered — KEEP the existing title (it's at
      // least as good as the placeholder; the id adoption is the durable
      // effect). Re-stamp the source-keyed view if it exists.
      if (existing.connectorId.length > 0) {
        this.bySourceKey.set(sourceKey(existing.connectorId, existing.externalRef), existing);
      }
      return existing.item;
    }
    const item: EntertainmentItem = {
      id: itemId,
      canonicalType: "video",
      canonicalTitle: title,
    };
    const registered: RegisteredItem = {
      item,
      connectorId: "",
      externalRef: "",
      title,
    };
    this.byItemId.set(itemId, registered);
    return item;
  }

  /** The registered view of one canonical item id (undefined when unknown). */
  get(itemId: string): RegisteredItem | undefined {
    return this.byItemId.get(itemId);
  }

  /** Is this a canonical item id the runtime knows? */
  has(itemId: string): boolean {
    return this.byItemId.has(itemId);
  }

  /**
   * The source references registered for one canonical item (every source
   * key that mapped to it — the cross-source realization seam for R04).
   */
  sourceRefsOf(itemId: string): readonly { connectorId: string; externalRef: string }[] {
    const primary = this.byItemId.get(itemId);
    if (primary === undefined) return [];
    const refs: { connectorId: string; externalRef: string }[] = [];
    if (primary.connectorId.length > 0 && primary.externalRef.length > 0) {
      refs.push({ connectorId: primary.connectorId, externalRef: primary.externalRef });
    }
    for (const registered of this.bySourceKey.values()) {
      if (registered.item.id === itemId) {
        const already = refs.some(
          (ref) => ref.connectorId === registered.connectorId && ref.externalRef === registered.externalRef,
        );
        if (!already && registered.connectorId.length > 0 && registered.externalRef.length > 0) {
          refs.push({ connectorId: registered.connectorId, externalRef: registered.externalRef });
        }
      }
    }
    return refs;
  }

  /** Validate + resolve a claimed canonical item id to its registered view. */
  require(itemId: string): RegisteredItem {
    if (!isEntertainmentItemId(itemId)) {
      throw new Error(
        `registry.require: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${JSON.stringify(itemId)}`,
      );
    }
    const registered = this.byItemId.get(itemId);
    if (registered === undefined) {
      throw new Error(`registry.require: item '${itemId}' has not been registered by this runtime session`);
    }
    return registered;
  }
}
