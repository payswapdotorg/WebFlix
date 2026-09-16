/**
 * @wfx/client-runtime — the canonical item registry (R01).
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
    const refs: { connectorId: string; externalRef: string }[] = [
      { connectorId: primary.connectorId, externalRef: primary.externalRef },
    ];
    for (const registered of this.bySourceKey.values()) {
      if (registered.item.id === itemId) {
        const already = refs.some(
          (ref) => ref.connectorId === registered.connectorId && ref.externalRef === registered.externalRef,
        );
        if (!already) {
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
