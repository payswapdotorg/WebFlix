/**
 * @wfx/app-api — the BYOF feed-import host composition (R20-H).
 *
 * The service-side composition the `/feeds/**` routes answer against: the
 * REAL `FeedImportService` (@wfx/persistence, R20-C — the named seam,
 * consumed AS-IS) plus the host wiring the web fixtures host
 * (`apps/web/src/host/byof/byof-fixtures.ts`) documented as the LAW:
 *
 * - the REAL YouTube connector (@wfx/connectors, R20-B) satisfies the
 *   structural `FeedConnectorPort`, and the PROJECTION TRUTH
 *   (`feedItemCanonicalType: "video"`) rides on the WIRING, not the frozen
 *   descriptor — the composition Worker 1 documented;
 * - `initialize()` is awaited at wiring time (the lifecycle law — a
 *   registered-not-initialized connector would answer a thrown
 *   LifecycleError, which is a wiring bug, never an honest verdict);
 * - the documented feed truth (which relationships the route can import,
 *   which it honestly cannot and why) rides on the wiring exactly like the
 *   projection truth.
 *
 * THE ESCALATION-4 STATEMENTS (add-only; frozen contracts untouched): the
 * shared store intentionally exposes no preview-discard and no staged-row
 * display read (confirm-only, the frozen `FeedPort` surface). The WEB
 * fixtures host answered this with exactly two documented adapter-side
 * table statements over the SAME tables the store owns — the staged-sample
 * SELECT (title/externalRef display columns) and the preview-discard
 * DELETE. This host carries the SAME two statements, now service-side
 * where the store lives, so the HTTP surface can serve them: each is
 * documented at its site, touches only `feed_imports` /
 * `feed_preview_items`, and NEVER touches `feed_records` or any non-BYOF
 * table.
 *
 * THE USER-DISCONNECT FOLD (ratified by the lead — "stays exactly as W2
 * shipped it"): the frozen `FeedSyncState` vocabulary has no "disconnected"
 * state, so a user-initiated disconnect folds through the shared store's
 * honest state-marking path — `reauthorization-required` carrying the
 * `Import disconnected by the user` marker prefix (the string
 * `apps/web/src/host/byof/byof-view.ts` derives the "Disconnected —
 * records retained" presentation from; the cross-adapter string contract
 * is flagged for lead ratification, hoisting to a shared package later),
 * records RETAINED (`markSyncOutcome` never deletes — the survival law),
 * with the record-ownership precondition W2 shipped.
 *
 * Determinism: no clock/randomness of its own — every timestamp and id
 * flows from the injected seams the boot composes.
 */

import type { ConnectorResult } from "@wfx/connectors";
import type {
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorFeedSnapshot,
  EntertainmentItem,
  FeedImportRequest,
  FeedRelationship,
} from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";
import {
  FeedImportService,
  PostgresFeedImportStore,
  toIsoTimestamp,
  type DbClient,
  type FeedConnectorPort,
  type FeedServiceFailure,
  type PersistedFeedImport,
  type PersistedFeedRecord,
  type PostgresConnectorAccountStore,
} from "@wfx/persistence";

import { deriveAuthState } from "./source-management";
import { FEED_USER_DISCONNECT_MARKER } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The connector wiring (the registry law the fixtures host documented)
// ---------------------------------------------------------------------------

/**
 * The structural shape of a real connector the wiring accepts. The YouTube
 * connector satisfies it; the host wraps it into the port (the projection
 * truth rides on the wiring — see the module doc).
 */
export interface FeedWiredConnector {
  readonly initialize: () => Promise<void>;
  readonly descriptor: () => ConnectorDescriptor;
  readonly importFeedResult: (
    ctx: ConnectorContext,
    request: FeedImportRequest,
  ) => Promise<ConnectorResult<ConnectorFeedSnapshot>>;
}

/** The feed-route truth one wired connector contributes (documented provider facts). */
export interface FeedConnectorWiring {
  /**
   * The REAL connector instance. `initialize()` is awaited by the host's
   * boot (the lifecycle law) — the shared instance stays initialized for
   * every later call.
   */
  readonly connector: FeedWiredConnector;
  /** The relationships the route can import (the request-filter truth). */
  readonly importable: readonly FeedRelationship[];
  /** The honest absences this route cannot expose, with their reasons. */
  readonly unavailable: readonly {
    readonly relationship: FeedRelationship;
    readonly reason: string;
  }[];
  /** Whether the route is continuously re-readable (the live/snapshot truth). */
  readonly continuousSync: boolean;
  /** The connector's projection truth (a canonical type is never guessed). */
  readonly feedItemCanonicalType?: EntertainmentItem["canonicalType"];
}

/** The wiring map: connectorId → the wiring entry. */
export type FeedWiringMap = ReadonlyMap<string, FeedConnectorWiring>;

// ---------------------------------------------------------------------------
// The staged-preview read (escalation 4 — the display columns)
// ---------------------------------------------------------------------------

/** One staged preview row with its display truth (what the user confirms). */
export interface StagedFeedItem {
  readonly externalRef: string;
  readonly relationship: FeedRelationship;
  readonly sourceRef?: string;
  readonly sourceOrder: number;
  readonly capturedAt: string;
  readonly title?: string;
  readonly entertainmentItemId: string;
}

/** The staged preview answer: the frozen preview shape + the display columns. */
export interface StagedPreviewView {
  readonly importId: string;
  readonly connectorId: string;
  readonly method: string;
  readonly itemCount: number;
  readonly relationshipCounts: Readonly<Record<string, number>>;
  readonly freshness: string;
  readonly continuousSync: boolean;
  /** The staged rows IN THE CAPTURE'S OWN ORDER, with display columns (escalation 4). */
  readonly items: readonly StagedFeedItem[];
}

// ---------------------------------------------------------------------------
// The sources view (the choose-source step's truth)
// ---------------------------------------------------------------------------

/** One importable source of the feed panel (over HTTP). */
export interface FeedSourceOption {
  readonly connectorId: string;
  readonly displayName: string;
  /** The feed-route authorization truth (the connect step's state). */
  readonly connected: boolean;
  /** Whether the route supports continuous sync (the live/snapshot truth). */
  readonly continuousSync: boolean;
  /** The relationships this source can import (the capability truth). */
  readonly importable: readonly FeedRelationship[];
  /** The honest absences this source cannot expose, with their reasons. */
  readonly unavailable: readonly {
    readonly relationship: FeedRelationship;
    readonly reason: string;
  }[];
}

// ---------------------------------------------------------------------------
// The user-disconnect fold (W2's law, verbatim — see module doc)
// ---------------------------------------------------------------------------

/**
 * The visible marker a user-initiated import disconnect carries in the
 * shared store's error field. THE SAME STRING
 * `apps/web/src/host/byof/byof-view.ts` derives the "Disconnected —
 * records retained" presentation from (`BYOF_DISCONNECTED_MARKER` — the
 * ratified fold; the cross-adapter string contract is flagged for lead
 * ratification).
 */
// R20-H integration: the string contract lives in @wfx/domain now
// (FEED_USER_DISCONNECT_MARKER); this alias preserves the lane-local name.
export const FEED_DISCONNECTED_MARKER = FEED_USER_DISCONNECT_MARKER;

/** The typed outcome of the host's own operations (the honest channel). */
export type FeedImportHostResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: FeedServiceFailure };

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Options for the host composition (the injected seams). */
export interface FeedImportHostOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The durable connector-account store (the authorization truth source). */
  readonly accounts: PostgresConnectorAccountStore;
  /** The connector wiring registry (empty = this deployment serves no feed-import source). */
  readonly wirings: FeedWiringMap;
}

/** One staged preview row's SQL shape (the store's own table). */
interface PreviewItemSqlRow {
  readonly external_ref: string;
  readonly relationship: string;
  readonly source_ref: string | null;
  readonly source_order: number;
  readonly captured_at: unknown;
  readonly title: string | null;
  readonly canonical_item_id: string;
}

/** The BYOF feed-import host the /feeds routes answer against. */
export class FeedImportHost {
  private readonly db: DbClient;
  private readonly store: PostgresFeedImportStore;
  private readonly service: FeedImportService;
  private readonly accounts: PostgresConnectorAccountStore;
  private readonly clock: Clock;
  private readonly ports: ReadonlyMap<string, FeedConnectorPort>;
  private readonly wirings: FeedWiringMap;
  private readonly displayNames: ReadonlyMap<string, string>;

  private constructor(options: FeedImportHostOptions, ports: ReadonlyMap<string, FeedConnectorPort>) {
    this.db = options.db;
    this.store = new PostgresFeedImportStore({ db: options.db, clock: options.clock, ids: options.ids });
    this.accounts = options.accounts;
    this.clock = options.clock;
    this.wirings = options.wirings;
    this.ports = ports;
    this.displayNames = new Map(
      [...options.wirings.entries()].map(([id, wiring]) => [id, wiring.connector.descriptor().displayName]),
    );
    this.service = new FeedImportService({
      db: options.db,
      clock: options.clock,
      ids: options.ids,
      connectors: (connectorId) => this.ports.get(connectorId),
    });
  }

  /**
   * Boot the host: wire every connector into its `FeedConnectorPort`
   * (the projection truth riding on the wiring) and await `initialize()`
   * (the lifecycle law). Boot fails loudly if a connector cannot
   * initialize — an honest composition never wires a broken connector.
   */
  static async boot(options: FeedImportHostOptions): Promise<FeedImportHost> {
    const ports = new Map<string, FeedConnectorPort>();
    for (const [connectorId, wiring] of options.wirings) {
      await wiring.connector.initialize();
      const connector = wiring.connector;
      ports.set(connectorId, {
        descriptor: () => connector.descriptor(),
        importFeedResult: (ctx, request) => connector.importFeedResult(ctx, request),
        ...(wiring.feedItemCanonicalType !== undefined
          ? { feedItemCanonicalType: wiring.feedItemCanonicalType }
          : {}),
      });
    }
    return new FeedImportHost(options, ports);
  }

  /** The REAL R20-C service (the named seam, consumed AS-IS). */
  feedService(): FeedImportService {
    return this.service;
  }

  /** The shared durable store (the import trail + preview reads). */
  feedStore(): PostgresFeedImportStore {
    return this.store;
  }

  /** The plain display name of a wired connector (its descriptor's own). */
  displayNameOf(connectorId: string): string {
    return this.displayNames.get(connectorId) ?? connectorId;
  }

  // -- the sources view ------------------------------------------------------

  /**
   * The importable-source options for one user: every wired connector's
   * documented feed truth + the CURRENT authorization state derived from
   * the durable account store (the R03 derivation law — `deriveAuthState`
   * — the same truth the fan-out's auth gate reads).
   */
  async feedSourcesFor(userId: string): Promise<readonly FeedSourceOption[]> {
    const options: FeedSourceOption[] = [];
    for (const [connectorId, wiring] of this.wirings) {
      const descriptor = wiring.connector.descriptor();
      let connected = false;
      try {
        const records = await this.accounts.listForUser(userId);
        const pendings = await this.accounts.listPendingAuthorizationsForUser(userId);
        const row = records.find((record) => record.connectorId === connectorId) ?? null;
        const pending = pendings.find((p) => p.connectorId === connectorId) ?? null;
        connected = deriveAuthState(row, pending, this.clock.now()) === "signedIn";
      } catch {
        // A broken gate read degrades to the honest not-connected truth
        // (the same law the fan-out's auth gate keeps — never a throw).
        connected = false;
      }
      options.push({
        connectorId,
        displayName: descriptor.displayName,
        connected,
        continuousSync: wiring.continuousSync,
        importable: [...wiring.importable],
        unavailable: wiring.unavailable.map((entry) => ({ ...entry })),
      });
    }
    return options;
  }

  // -- the staged preview read (escalation 4) --------------------------------

  /**
   * Read one staged preview WITH its display columns (title/externalRef —
   * the user confirms WHAT THEY SAW). The frozen `FeedImportPreview`
   * carries identity + provenance only, so the staged rows' display truth
   * is read from the SAME staging table the store confirms from — the one
   * documented host-side SELECT (see the module doc; the identical
   * statement the web fixtures host documents). Only a preview-status
   * import answers; anything else is `null` (the caller's 404 truth).
   */
  async readStagedPreview(importId: string): Promise<StagedPreviewView | null> {
    const row = await this.store.getImport(importId);
    if (row === null || row.status !== "preview") return null;
    const preview = await this.service.readPreview(importId);
    if (preview === null) return null;
    const staged = await this.db.query<PreviewItemSqlRow>(
      `SELECT external_ref, relationship, source_ref, source_order, captured_at, title, canonical_item_id
         FROM feed_preview_items WHERE import_id = $1 ORDER BY position`,
      [importId],
    );
    const items: StagedFeedItem[] = staged.map((stagedRow) => ({
      externalRef: stagedRow.external_ref,
      relationship: stagedRow.relationship as FeedRelationship,
      ...(stagedRow.source_ref !== null ? { sourceRef: stagedRow.source_ref } : {}),
      sourceOrder: Number(stagedRow.source_order),
      capturedAt: toIsoTimestamp(stagedRow.captured_at),
      ...(stagedRow.title !== null ? { title: stagedRow.title } : {}),
      entertainmentItemId: stagedRow.canonical_item_id,
    }));
    return {
      importId: preview.importId,
      connectorId: preview.connectorId,
      method: preview.method,
      itemCount: preview.itemCount,
      relationshipCounts: { ...preview.relationshipCounts },
      freshness: preview.freshness,
      continuousSync: row.continuousSync,
      items,
    };
  }

  // -- the preview discard (escalation 4) ------------------------------------

  /**
   * Discard one staged preview. Presentation lifecycle only: a preview row
   * owns NO feed records (records exist solely after confirm — the store's
   * law), so this deletes the staged rows + their import transaction and
   * nothing else. It is the one documented host-side table DELETE (see the
   * module doc; the identical statement the web fixtures host documents);
   * it NEVER touches `feed_records` or any other table. Only a
   * preview-status import can be discarded — anything else is the typed
   * `invalid-input` refusal.
   */
  async discardPreview(importId: string): Promise<FeedImportHostResult<{ importId: string }>> {
    const row = await this.store.getImport(importId);
    if (row === null) {
      return {
        ok: false,
        failure: { kind: "not-found", detail: `discardPreview: feed import '${importId}' is unknown` },
      };
    }
    if (row.status !== "preview") {
      return {
        ok: false,
        failure: {
          kind: "invalid-input",
          detail: `discardPreview: feed import '${importId}' is '${row.status}' — only a staged preview can be discarded`,
        },
      };
    }
    await this.db.query(`DELETE FROM feed_imports WHERE id = $1`, [importId]);
    return { ok: true, value: { importId } };
  }

  // -- the user-disconnect fold (W2's law, verbatim — see module doc) --------

  /**
   * Disconnect one import — NON-destructive (records + provenance
   * retained). The precondition is RECORD OWNERSHIP, not the status
   * label: a confirmed import keeps its disconnect path through every
   * durable state (live, stale, and the reauthorization gap a failed sync
   * lands — the user may choose to end syncing without deleting). A
   * staged preview or a failed attempt owns no records — there is nothing
   * to retain, so the typed refusal names it. THE FOLD: the import's grant
   * is missing BY USER CHOICE (`reauthorization-required`), the marker
   * prefix drives the "Disconnected — records retained" presentation, and
   * the records are RETAINED (`markSyncOutcome` never deletes — the
   * survival law).
   */
  async disconnectImport(
    profileId: string,
    importId: string,
  ): Promise<FeedImportHostResult<{ importId: string }>> {
    const row = await this.store.getImport(importId);
    if (row === null) {
      return {
        ok: false,
        failure: { kind: "not-found", detail: `disconnect: feed import '${importId}' is unknown` },
      };
    }
    const inScope = await this.store.readRecordsInScope({
      profileId,
      connectorId: row.connectorId,
    });
    const ownsRecords = inScope.some((record) => record.importId === importId);
    if (!ownsRecords) {
      return {
        ok: false,
        failure: {
          kind: "invalid-input",
          detail:
            `disconnect: feed import '${importId}' is '${row.status}' and owns no imported records — ` +
            `only an import with retained records can be disconnected`,
        },
      };
    }
    await this.store.markSyncOutcome(importId, {
      syncState: "reauthorization-required",
      error:
        `${FEED_DISCONNECTED_MARKER} — imported records and their provenance are retained; ` +
        `WebFlix stopped syncing this feed. Deleting the imported records is a separate, explicit action.`,
    });
    return { ok: true, value: { importId } };
  }

  // -- the explicit destructive path -----------------------------------------

  /**
   * DELETE one import's records — the EXPLICIT user-deletion path ONLY
   * (disconnect/re-authorize never deletes; it marks state). The shared
   * service's own deletion (`feed_records` only; the separation law pins
   * every other table out of reach). This is the ONLY operation in the
   * whole feed surface that removes imported records.
   */
  async deleteImportRecords(
    profileId: string,
    importId: string,
  ): Promise<FeedImportHostResult<{ removed: number }>> {
    const row = await this.store.getImport(importId);
    if (row === null) {
      return {
        ok: false,
        failure: { kind: "not-found", detail: `deleteRecords: feed import '${importId}' is unknown` },
      };
    }
    const removed = await this.service.deleteImportedRecords(profileId, { importId });
    return { ok: true, value: { removed } };
  }

  // -- reads the panel/feed views compose over -------------------------------

  /** The import trail (newest first — the store's own read order). */
  async listImports(profileId: string): Promise<readonly PersistedFeedImport[]> {
    return this.store.listImports(profileId);
  }

  /**
   * The imported feed records under a frozen read mode (the mode-truth
   * law's read surface). `readFeed` throws `PersistenceError` on invalid
   * input — the route maps it to the typed 400 (the persistence layer's
   * own failure channel law).
   */
  async readFeed(
    profileId: string,
    mode: "webflix" | "following" | "byof" | "hybrid",
  ): Promise<readonly PersistedFeedRecord[]> {
    return this.service.readFeed(profileId, mode);
  }
}

/**
 * Compose the feed-import host. Never called per-request — the boot (and
 * the test harness) calls this once; routes read the booted instance.
 */
export async function createFeedImportHost(
  options: FeedImportHostOptions,
): Promise<FeedImportHost> {
  return FeedImportHost.boot(options);
}
