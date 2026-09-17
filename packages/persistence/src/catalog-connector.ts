/**
 * @wfx/persistence — the WebFlix catalog `ConnectorPort` adapter (WFX-052).
 *
 * THE feed/candidate source seam of the spec: a real-SQL implementation of
 * `@wfx/experience`'s frozen `ConnectorPort` over the Entertainment Graph
 * tables (migration 0002) + the user library (0003) + the transactional
 * event outbox (0006). The Experience Core depends on the PORT it declared;
 * this class is what production injects as `Ports.connector` instead of
 * `makeFixturePorts().connector`.
 *
 * Connector identity: `webflix-catalog` — the platform's own durable catalog
 * (items + realizations reported by ingest), NOT an external provider. It
 * is a first-class source with the same plain surface as any connector.
 *
 * Capability truth (docs/architecture/product-boundaries.md):
 * - Declared: catalogSearch, metadata, the four play modes (resolve answers
 *   from STORED playback realizations — nothing is fabricated), libraryRead,
 *   libraryWrite, like, save.
 * - NOT declared: follow / comment / download / transform — the catalog has
 *   no durable store for them and the frozen event vocabulary has no
 *   follow/comment/download/transform type, so declaring them would be a
 *   lie. `executeAction` answers `status: "unsupported"` receipts for them
 *   (the WFX-003 degrade map, made structural).
 *
 * Transactional outbox wiring (the pattern's whole point):
 * - `writeLibrary(add)` commits the library row AND the `"save"` event in
 *   ONE transaction (`db.begin`): both-or-neither.
 * - `executeAction(like|save)` commits the event (the durable local record
 *   of the action) in its own transaction; a `save` also lands the library
 *   row in the SAME transaction.
 * - Library REMOVE mutates durable state without an event: the frozen event
 *   vocabulary has no unsave type (documented honestly here); library
 *   contents are projection truth, and outbound sync to EXTERNAL sources is
 *   @wfx/actions' outbox, a different layer.
 *
 * Identity law: every emitted event needs the CANONICAL item of the acted-on
 * reference (frozen `EntertainmentEvent.itemId` is a `wfxitm_` id). An
 * action against a ref with no catalog realization answers a `failed`
 * receipt — the catalog never invents canonical identities.
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  ConnectorDescriptor,
  EntertainmentEvent,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { isRecord, validatePlaybackRealization } from "@wfx/domain";

import type { Clock, ConnectorPort, IdGen } from "@wfx/experience";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { buildEnvelope, enqueueEvent } from "./outbox";
import { PostgresGraphStore } from "./graph";
import { PostgresLibraryStore } from "./library";
import { PostgresProfileService } from "./profiles";
import { epochMsToIso, type DbClient, type SqlClient } from "./sql";

/** The connector id of the WebFlix local catalog source. */
export const WEBFLIX_CATALOG_CONNECTOR_ID = "webflix-catalog";

/** Capabilities the catalog connector truthfully declares. */
export const WEBFLIX_CATALOG_CAPABILITIES: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
];

/** Action types the catalog durably supports (frozen UserAction subset). */
const SUPPORTED_ACTION_TYPES: ReadonlySet<UserAction["type"]> = new Set(["like", "save"]);

/** Constructor dependencies — all injected, all deterministic in tests. */
export interface CatalogConnectorOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

interface SearchJoinRow {
  id: string;
  canonical_type: string;
  canonical_title: string | null;
  duration_ms: unknown;
  orientation: string | null;
  external_ref: string;
}

interface MetadataJoinRow {
  item_id: string;
  canonical_type: string;
  canonical_title: string | null;
  duration_ms: unknown;
  orientation: string | null;
  external_ref: string;
  capabilities: unknown;
  availability: string;
}

interface RefItemRow {
  item_id: string;
}

/**
 * The WebFlix catalog connector. See the module docs; every SQL failure is
 * classified (`DataSourceUnavailable` / `WriteQuotaExceeded` /
 * `ConnectionTimeout` / …) — raw driver errors never escape.
 */
export class PostgresCatalogConnector implements ConnectorPort {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;
  private readonly graph: PostgresGraphStore;
  private readonly library: PostgresLibraryStore;
  private readonly profiles: PostgresProfileService;

  constructor(options: CatalogConnectorOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
    this.graph = new PostgresGraphStore(options.db);
    this.library = new PostgresLibraryStore({ db: options.db, clock: options.clock, ids: options.ids });
    this.profiles = new PostgresProfileService({ db: options.db, ids: options.ids, clock: options.clock });
  }

  descriptor(): ConnectorDescriptor {
    return {
      id: WEBFLIX_CATALOG_CONNECTOR_ID,
      version: "1.0.0",
      displayName: "WebFlix Catalog",
      capabilities: [...WEBFLIX_CATALOG_CAPABILITIES],
      auth: "none",
    };
  }

  async search(_ctx: ConnectorContext, query: string): Promise<SearchResult[]> {
    if (typeof query !== "string" || query.trim().length === 0) return [];
    const needle = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    let rows: SearchJoinRow[];
    try {
      rows = await this.db.query<SearchJoinRow>(
        `SELECT DISTINCT ON (i.id)
            i.id, i.canonical_type, i.canonical_title, i.duration_ms, i.orientation,
            r.external_ref
         FROM entertainment_items i
         JOIN source_realizations r
           ON r.entertainment_item_id = i.id AND r.connector_id = $1
         WHERE i.canonical_title IS NOT NULL AND lower(i.canonical_title) LIKE lower($2)
         ORDER BY i.id, r.id
         LIMIT 100`,
        [WEBFLIX_CATALOG_CONNECTOR_ID, needle],
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "catalog.search");
    }
    // Deterministic (title, externalRef) order by CODEPOINT comparison —
    // never localeCompare (locale-dependent = non-deterministic).
    const hits = rows.map((row) => this.mapSearchHit(row));
    hits.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.externalRef < b.externalRef ? -1 : 1));
    return hits;
  }

  async metadata(_ctx: ConnectorContext, ref: string): Promise<SourceItem | null> {
    if (typeof ref !== "string" || ref.length === 0) return null;
    let row: MetadataJoinRow | undefined;
    try {
      const rows = await this.db.query<MetadataJoinRow>(
        `SELECT i.id AS item_id, i.canonical_type, i.canonical_title, i.duration_ms,
                i.orientation, r.external_ref, r.capabilities, r.availability
         FROM source_realizations r
         JOIN entertainment_items i ON i.id = r.entertainment_item_id
         WHERE r.connector_id = $1 AND r.external_ref = $2`,
        [WEBFLIX_CATALOG_CONNECTOR_ID, ref],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "catalog.metadata");
    }
    if (row === undefined) return null;
    const item: SourceItem = {
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: row.external_ref,
      title: row.canonical_title ?? row.external_ref,
      availability: row.availability as SourceItem["availability"],
      capabilities: (row.capabilities ?? []) as string[],
    };
    if (row.canonical_type !== null) {
      item.canonicalType = row.canonical_type as NonNullable<SourceItem["canonicalType"]>;
    }
    if (row.duration_ms !== null) item.durationMs = Number(row.duration_ms);
    if (row.orientation !== null) {
      item.orientation = row.orientation as NonNullable<SourceItem["orientation"]>;
    }
    return item;
  }

  async resolve(_ctx: ConnectorContext, ref: string): Promise<PlaybackRealization[]> {
    const realization = await this.graph.realizationByRef(WEBFLIX_CATALOG_CONNECTOR_ID, ref);
    if (realization === null) return [];
    // Honest guard: only rows that still pass the frozen validator are
    // handed out — a drifted stored row is skipped, never repaired.
    return realization.playback.filter((candidate) => validatePlaybackRealization(candidate).ok);
  }

  async executeAction(ctx: ConnectorContext, action: UserAction): Promise<ActionReceipt> {
    const occurredAt = epochMsToIso(this.clock.now());
    if (!isRecord(action) || typeof action.type !== "string") {
      return {
        status: "failed",
        detail: "action: expected a UserAction object",
        occurredAt,
      };
    }
    if (action.connectorId !== WEBFLIX_CATALOG_CONNECTOR_ID) {
      // The WFX-003 plain-surface law, mirrored from the SDK's BaseConnector:
      // an action sent to the wrong connector is a failed receipt, never an
      // error thrown into the use-case layer.
      return {
        status: "failed",
        detail: `action targets connector '${action.connectorId}' but was sent to '${WEBFLIX_CATALOG_CONNECTOR_ID}'`,
        occurredAt,
      };
    }
    if (!SUPPORTED_ACTION_TYPES.has(action.type as UserAction["type"])) {
      return {
        status: "unsupported",
        detail: `capability for '${action.type}' is not declared by '${WEBFLIX_CATALOG_CONNECTOR_ID}'`,
        occurredAt,
      };
    }
    if (typeof action.externalRef !== "string" || action.externalRef.length === 0) {
      return {
        status: "failed",
        detail: "action.externalRef: expected a non-empty string",
        occurredAt,
      };
    }

    const nowMs = this.clock.now();
    try {
      // R02: the frozen ctx carries no profile — resolve the user's
      // effective profile key (the default-profile fallback) so the save
      // and its event are attributed.
      const profileId = await this.profiles.resolveEffectiveProfileKey(ctx.userId);
      await this.db.begin(async (tx: SqlClient) => {
        const itemId = await this.requireItemIdForRef(tx, action.externalRef);
        if (action.type === "save") {
          await this.library.addWithin(tx, {
            userId: ctx.userId,
            profileId,
            connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
            command: { op: "add", externalRef: action.externalRef },
          });
        }
        const event = this.actionEvent(ctx.userId, itemId, action);
        await enqueueEvent(tx, buildEnvelope(event, this.ids), nowMs, profileId);
      });
    } catch (thrown) {
      if (isUnknownRef(thrown)) {
        return { status: "failed", detail: thrown.message, occurredAt };
      }
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "catalog.executeAction");
    }
    return { status: "confirmed", occurredAt };
  }

  /**
   * R02: `executeAction` with an EXPLICIT profile key (a session's active
   * profile) — the save lands in THAT profile's library and the event is
   * attributed to it. Semantics otherwise identical to `executeAction`.
   */
  async executeActionForProfile(
    ctx: ConnectorContext,
    profileId: string,
    action: UserAction,
  ): Promise<ActionReceipt> {
    const occurredAt = epochMsToIso(this.clock.now());
    if (!isRecord(action) || typeof action.type !== "string") {
      return {
        status: "failed",
        detail: "action: expected a UserAction object",
        occurredAt,
      };
    }
    if (action.connectorId !== WEBFLIX_CATALOG_CONNECTOR_ID) {
      return {
        status: "failed",
        detail: `action targets connector '${action.connectorId}' but was sent to '${WEBFLIX_CATALOG_CONNECTOR_ID}'`,
        occurredAt,
      };
    }
    if (!SUPPORTED_ACTION_TYPES.has(action.type as UserAction["type"])) {
      return {
        status: "unsupported",
        detail: `capability for '${action.type}' is not declared by '${WEBFLIX_CATALOG_CONNECTOR_ID}'`,
        occurredAt,
      };
    }
    if (typeof action.externalRef !== "string" || action.externalRef.length === 0) {
      return {
        status: "failed",
        detail: "action.externalRef: expected a non-empty string",
        occurredAt,
      };
    }

    const nowMs = this.clock.now();
    try {
      await this.db.begin(async (tx: SqlClient) => {
        const itemId = await this.requireItemIdForRef(tx, action.externalRef);
        if (action.type === "save") {
          await this.library.addWithin(tx, {
            userId: ctx.userId,
            profileId,
            connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
            command: { op: "add", externalRef: action.externalRef },
          });
        }
        const event = this.actionEvent(ctx.userId, itemId, action);
        await enqueueEvent(tx, buildEnvelope(event, this.ids), nowMs, profileId);
      });
    } catch (thrown) {
      if (isUnknownRef(thrown)) {
        return { status: "failed", detail: thrown.message, occurredAt };
      }
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "catalog.executeActionForProfile");
    }
    return { status: "confirmed", occurredAt };
  }

  async readLibrary(ctx: ConnectorContext): Promise<LibraryEntry[]> {
    const entries = await this.library.list(ctx.userId, WEBFLIX_CATALOG_CONNECTOR_ID);
    return [...entries];
  }

  /**
   * R02/R04: the PROFILE-scoped library read (the explicit form). Returns
   * ALL rows in the profile — the canonical-keyed library (R04 migration
   * 0009) stores ONE row per (profile, item); the primary realization
   * reference (connector_id + external_ref) updates to the LATEST save
   * (the cross-source replacement law), but the WebFlix-owned service
   * library owns ALL rows saved via the service, regardless of which
   * realization source the user saved from.
   */
  async readLibraryForProfile(profileId: string): Promise<LibraryEntry[]> {
    const entries = await this.library.listAllForProfile(profileId);
    return [...entries];
  }

  async writeLibrary(ctx: ConnectorContext, command: LibraryCommand): Promise<ActionReceipt> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(ctx.userId);
    return this.writeLibraryForProfile(ctx, profileId, command);
  }

  /**
   * R02: `writeLibrary` with an EXPLICIT profile key — the row and its
   * `"save"` event land in THAT profile's bucket, in one transaction.
   */
  async writeLibraryForProfile(
    ctx: ConnectorContext,
    profileId: string,
    command: LibraryCommand,
  ): Promise<ActionReceipt> {
    const occurredAt = epochMsToIso(this.clock.now());
    if (command.op !== "add" && command.op !== "remove") {
      return {
        status: "failed",
        detail: "command.op: expected 'add' or 'remove'",
        occurredAt,
      };
    }
    if (typeof command.externalRef !== "string" || command.externalRef.length === 0) {
      return {
        status: "failed",
        detail: "command.externalRef: expected a non-empty string",
        occurredAt,
      };
    }

    const nowMs = this.clock.now();
    try {
      if (command.op === "add") {
        // Library row + "save" event in ONE transaction — both or neither.
        await this.db.begin(async (tx: SqlClient) => {
          const itemId = await this.requireItemIdForRef(tx, command.externalRef);
          await this.library.addWithin(tx, {
            userId: ctx.userId,
            profileId,
            connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
            command,
          });
          await enqueueEvent(
            tx,
            buildEnvelope(this.saveEvent(ctx.userId, itemId), this.ids),
            nowMs,
            profileId,
          );
        });
        return { status: "confirmed", occurredAt };
      }

      // remove: durable state mutation only (see module docs — no unsave
      // event type exists in the frozen vocabulary).
      const removed = await this.library.removeWithin(this.db, {
        userId: ctx.userId,
        profileId,
        connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
        externalRef: command.externalRef,
      });
      return removed
        ? { status: "confirmed", occurredAt }
        : { status: "failed", detail: "entry not present in the library", occurredAt };
    } catch (thrown) {
      if (isUnknownRef(thrown)) {
        return { status: "failed", detail: thrown.message, occurredAt };
      }
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "catalog.writeLibrary");
    }
  }

  // --- internals --------------------------------------------------------------

  /**
   * Resolve the canonical item id of a catalog realization INSIDE the open
   * transaction. Throws the typed `unknown-ref` marker error when the ref is
   * not part of the catalog (converted to a `failed` receipt by the callers)
   * — the catalog never invents canonical identities.
   */
  private async requireItemIdForRef(tx: SqlClient, externalRef: string): Promise<string> {
    let row: RefItemRow | undefined;
    try {
      const rows = await tx.query<RefItemRow>(
        `SELECT r.entertainment_item_id AS item_id
         FROM source_realizations r
         WHERE r.connector_id = $1 AND r.external_ref = $2`,
        [WEBFLIX_CATALOG_CONNECTOR_ID, externalRef],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "catalog.requireItemIdForRef");
    }
    if (row === undefined) {
      throw new PersistenceError(
        "invalid-input",
        `externalRef '${externalRef}' has no catalog realization — the catalog ` +
          "never invents canonical identities (ingest the item first)",
        { operation: "catalog.requireItemIdForRef" },
      );
    }
    return row.item_id;
  }

  private actionEvent(userId: string, itemId: string, action: UserAction): EntertainmentEvent {
    const event: EntertainmentEvent = {
      userId,
      itemId,
      type: action.type === "like" ? "like" : "save",
      occurredAt: epochMsToIso(this.clock.now()),
      sessionId: `${WEBFLIX_CATALOG_CONNECTOR_ID}:${action.connectorId}:${userId}`,
    };
    if (action.payload !== undefined) event.payload = { ...action.payload };
    return event;
  }

  private saveEvent(userId: string, itemId: string): EntertainmentEvent {
    return {
      userId,
      itemId,
      type: "save",
      occurredAt: epochMsToIso(this.clock.now()),
      sessionId: `${WEBFLIX_CATALOG_CONNECTOR_ID}:library:${userId}`,
    };
  }

  private mapSearchHit(row: SearchJoinRow): SearchResult {
    const hit: SearchResult = {
      connectorId: WEBFLIX_CATALOG_CONNECTOR_ID,
      externalRef: row.external_ref,
      title: row.canonical_title ?? row.external_ref,
    };
    if (row.canonical_type !== null) {
      hit.canonicalType = row.canonical_type as NonNullable<SearchResult["canonicalType"]>;
    }
    if (row.duration_ms !== null) hit.durationMs = Number(row.duration_ms);
    if (row.orientation !== null) {
      hit.orientation = row.orientation as NonNullable<SearchResult["orientation"]>;
    }
    return hit;
  }
}

/** Marker check for the internal unknown-ref error (converted to receipts). */
function isUnknownRef(thrown: unknown): thrown is PersistenceError {
  return (
    thrown instanceof PersistenceError &&
    thrown.kind === "invalid-input" &&
    thrown.operation === "catalog.requireItemIdForRef"
  );
}
