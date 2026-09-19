/**
 * @wfx/app-web — the DEV-ONLY BYOF fixtures host (R20-D).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * This module exists ONLY in fixtures mode (`WFX_DEV_FIXTURES=1` — the loud
 * dev badge; `byof-host.ts` loads it through a dynamic import the service
 * path never evaluates): it is how the J33 web journey (Bring Your Own
 * Feed: import → preview → confirm → sync → provenance → disconnect) is
 * browser-validated against the REAL shared BYOF surface BEFORE the
 * service-side feed routes exist. It composes, unchanged, the exact
 * seam Worker 1 shipped:
 *
 * - `FeedImportService` (@wfx/persistence, R20-C) — the reconciliation
 *   composition: connector capture → canonical identity resolution →
 *   preview staging → idempotent confirm → incremental sync with honest
 *   state transitions;
 * - `PostgresFeedImportStore` (@wfx/persistence, R20-A) — the durable
 *   feed-import store over the REAL migration set;
 * - the REAL YouTube connector (@wfx/connectors, R20-B) — the first real
 *   provider path (`importFeedResult`), over its documented recorded
 *   fixtures through the connector's own injectable HTTP seam.
 *
 * Nothing here re-implements a shared law: the FIXTURE is the transport +
 * the grant, exactly the layers the persistence tests script
 * (`feed-service.test.ts` part 2 — the same composition, the same
 * honesty). In service mode NOTHING here runs (the surfaces render the
 * honest typed unavailable state — a fixture is never silently presented
 * as production capability, frozen invariant 10).
 *
 * THE DEV-SERVER SPLIT-MODULE REALITY (why the runtime is globalThis
 * cached): the Turbopack dev server compiles every route as its own
 * module graph — the settings page's module instance and the /api/byof
 * route's module instance are SEPARATE copies of this file. The BYOF
 * runtime (PGlite + service + connector wiring) is therefore cached on
 * `globalThis` (process-wide, shared by every module graph) — the same
 * law the acquisition/source-auth fixtures solve with a shared state
 * FILE; a database handle cannot be file-backed, so the process global
 * is the honest equivalent. A fresh dev process starts pristine; the
 * journey's `dev-reset` drive restores pristine state deterministically.
 *
 * HONESTY LAWS KEPT HERE:
 * - READS NEVER ADVANCE THE SCRIPT: page renders only read the store;
 *   only the typed POST actions (and the clearly-labeled dev drives)
 *   move the connector wiring or the data phase.
 * - THE STATE IS DATA: every view is derived from the REAL store's rows
 *   (the same rows the production service would serve).
 * - THE SCRIPTED SOURCE IS LAWFUL: the transport answers the documented
 *   endpoint URLs with the recorded fixture bodies; an unknown URL is a
 *   LOUD transport failure (never a fabricated answer).
 * - THE GRANT IS THE FIXTURE'S OWN: the YouTube connector's credential
 *   source is the in-memory dev source — `connected` is the truthful
 *   presence of the (fixture) token set, and an absent grant answers the
 *   typed `unauthorized` verdict the real connector would answer.
 *
 * ADAPTER-SIDE TABLE STATEMENTS (documented, minimal): the shared store
 * intentionally exposes no preview-discard and no staged-row read
 * (confirm-only, the frozen FeedPort surface). This host makes exactly
 * two adapter-side statements over the SAME tables the store owns — the
 * preview-discard DELETE and the staged-sample SELECT — each documented
 * at its site, never touching `feed_records` or any non-BYOF table.
 *
 * Determinism: PGlite + FixedClock + SequentialIdGen; the connector clock
 * is fixed inside the fixtures' recorded timestamp world; no network.
 */

import { PGlite } from "@electric-sql/pglite";

import type {
  ConnectorContext,
  FeedRelationship,
  FeedSyncState,
} from "@wfx/domain";
import { FixedClock, SequentialIdGen } from "@wfx/experience";
import {
  FeedImportService,
  PostgresFeedImportStore,
  runMigrations,
  toIsoTimestamp,
  type DbClient,
  type FeedConnectorPort,
  type FeedServiceFailure,
  type PersistedFeedImport,
  type PersistedFeedRecord,
  type SqlClient,
  type SqlRow,
} from "@wfx/persistence";
import {
  FIXTURE_PLAYLISTS_MINE,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_PLAYLIST_ITEMS_RAIN,
  FIXTURE_PLAYLIST_ITEMS_WATCH_LATER,
  FIXTURE_SUBSCRIPTIONS,
  YOUTUBE_CONNECTOR_ID,
  YOUTUBE_FEED_RELATIONSHIPS,
  createInMemoryYouTubeCredentialSource,
  createYouTubeConnector,
  type YouTubeHttpTransport,
  type YouTubePlaylistItemListResponse,
  type YouTubeSubscriptionListResponse,
  type YouTubeTokenSet,
} from "@wfx/connectors";

import { ANONYMOUS_USER_ID } from "@/host/session";
import {
  BYOF_DISCONNECTED_MARKER,
  isByofUserDisconnect,
  type ByofFailure,
  type ByofFailureKind,
  type ByofFeedView,
  type ByofImportFeedView,
  type ByofImportView,
  type ByofPanelView,
  type ByofPreviewView,
  type ByofRecordGroupView,
  type ByofRecordView,
  type ByofResult,
  type ByofSourceOptionView,
  type ByofSyncReportView,
} from "./byof-view";

// ---------------------------------------------------------------------------
// Identity (the dev-harness profile — the anonymous web user, fixed)
// ---------------------------------------------------------------------------

/**
 * The fixtures-mode BYOF profile: the anonymous web user's dev profile.
 * The dev boot is one anonymous session per process; the fixed profile id
 * keeps every module graph addressing the SAME rows (the same stability
 * law the acquisition fixtures get from the fixture catalog's refs).
 */
export const BYOF_FIXTURES_PROFILE = "wfx-anonymous:web";

/** The connector context every fixtures capture is stamped with. */
const BYOF_CTX: ConnectorContext = { userId: ANONYMOUS_USER_ID, locale: "en", region: "US" };

// ---------------------------------------------------------------------------
// Deterministic seams (the fixtures law: no real clock, no random ids)
// ---------------------------------------------------------------------------

/** The service clock — fixed inside the fixtures' timestamp world. */
const SERVICE_CLOCK_START = Date.UTC(2026, 8, 20, 10, 0, 0);

/** The connector clock — fixed inside the recorded fixtures' world. */
const YT_CLOCK_NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

/** The fixture grant (valid while stored — the connect drive stores it). */
function byofFixtureTokens(): YouTubeTokenSet {
  return {
    accessToken: "fixture-access-token-r20d-web",
    refreshToken: "fixture-refresh-token-r20d-web",
    tokenType: "Bearer",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    expiresAtMs: YT_CLOCK_NOW + 3600 * 1000,
    obtainedAtMs: YT_CLOCK_NOW,
  };
}

// ---------------------------------------------------------------------------
// The scripted source (the documented endpoint URLs → recorded fixtures)
// ---------------------------------------------------------------------------

/** The exact URLs the connector's API layer issues for a full capture. */
const SUBS_URL =
  "https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50";
const LIKED_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=LL&maxResults=50";
const WATCH_LATER_URL =
  "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=WL&maxResults=50";
const PLAYLISTS_URL =
  "https://www.googleapis.com/youtube/v3/playlists?part=snippet%2CcontentDetails&mine=true&maxResults=25";
const RAIN_PLAYLIST_URL = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet%2CcontentDetails&playlistId=PLwfx54Fixture000000000000000001&maxResults=50`;

/** A synthetic third channel (24 chars, "UC" prefix — the fixture grammar). */
const AURORA_CHANNEL_ID = "UCWfx54Channel00000000000C";

/**
 * The ADVANCED source phase (the J33 sync step's changed source): a NEW
 * followed channel (added), one like removed at the source, everything
 * else unchanged. Built FROM the recorded fixtures — only the diff is
 * scripted, exactly as a real source would have changed.
 */
const FIXTURE_SUBSCRIPTIONS_ADVANCED: YouTubeSubscriptionListResponse = {
  ...FIXTURE_SUBSCRIPTIONS,
  etag: "fixture-etag-subs-advanced",
  pageInfo: { totalResults: 3, resultsPerPage: 50 },
  items: [
    {
      kind: "youtube#subscription",
      etag: "fixture-etag-sub-c",
      id: "FIXTURE_SUB_C",
      snippet: {
        publishedAt: "2026-09-18T09:00:00Z",
        title: "Aurora Nights",
        description: "A newly followed fixture channel (the advanced source phase).",
        channelId: AURORA_CHANNEL_ID,
        resourceId: { kind: "youtube#channel", channelId: AURORA_CHANNEL_ID },
      },
    },
    ...FIXTURE_SUBSCRIPTIONS.items,
  ],
};

const FIXTURE_PLAYLIST_ITEMS_LIKED_ADVANCED: YouTubePlaylistItemListResponse = {
  ...FIXTURE_PLAYLIST_ITEMS_LIKED,
  etag: "fixture-etag-pl-items-advanced",
  // The 45-second like was removed at the source; the documentary remains.
  items: [FIXTURE_PLAYLIST_ITEMS_LIKED.items[0]!],
};

/** One source phase: the URL → recorded-body map a capture reads. */
type SourcePhase = ReadonlyMap<string, unknown>;

/** The initial source phase (the recorded fixtures verbatim). */
const PHASE_INITIAL: SourcePhase = new Map<string, unknown>([
  [SUBS_URL, FIXTURE_SUBSCRIPTIONS],
  [LIKED_URL, FIXTURE_PLAYLIST_ITEMS_LIKED],
  [WATCH_LATER_URL, FIXTURE_PLAYLIST_ITEMS_WATCH_LATER],
  [PLAYLISTS_URL, FIXTURE_PLAYLISTS_MINE],
  [RAIN_PLAYLIST_URL, FIXTURE_PLAYLIST_ITEMS_RAIN],
]);

/** The advanced source phase (one follow added, one like removed). */
const PHASE_ADVANCED: SourcePhase = new Map<string, unknown>([
  [SUBS_URL, FIXTURE_SUBSCRIPTIONS_ADVANCED],
  [LIKED_URL, FIXTURE_PLAYLIST_ITEMS_LIKED_ADVANCED],
  [WATCH_LATER_URL, FIXTURE_PLAYLIST_ITEMS_WATCH_LATER],
  [PLAYLISTS_URL, FIXTURE_PLAYLISTS_MINE],
  [RAIN_PLAYLIST_URL, FIXTURE_PLAYLIST_ITEMS_RAIN],
]);

/**
 * The URL-keyed deterministic transport: every documented capture URL
 * answers its recorded fixture body, from any phase, as many times as the
 * host reads (a dev source is re-readable — the same truth the recorded
 * FIFO transport gives a scripted test, without the script running dry).
 * An unknown URL is a LOUD transport failure — never a fabricated answer.
 */
function createPhaseTransport(getPhase: () => SourcePhase): YouTubeHttpTransport {
  return {
    async request(request: { readonly url: string }): Promise<{ readonly status: number; readonly bodyText: string }> {
      const body = getPhase().get(request.url);
      if (body === undefined) {
        throw new Error(
          `byof fixtures transport: no scripted reply for '${request.url}' — an unscripted endpoint is a bug in the fixture, never a fabricated answer`,
        );
      }
      return { status: 200, bodyText: JSON.stringify(body) };
    },
  };
}

/** The fixed clock the YouTube connector's expiry checks read. */
class FixedYouTubeClock {
  now(): number {
    return YT_CLOCK_NOW;
  }
}

// ---------------------------------------------------------------------------
// The runtime (one per process, globalThis-cached)
// ---------------------------------------------------------------------------

/** The BYOF fixtures runtime's operation surface (typed results only). */
export interface ByofFixturesRuntime {
  /** The settings panel view (sources + import trail + staged preview). */
  panelView(previewImportId?: string): Promise<ByofPanelView>;
  /** The Library feed region view (the imported feed's durable truth). */
  feedView(): Promise<ByofFeedView>;
  /** Read the imported feed records under a frozen read mode (the mode-truth law's surface). */
  feedRecords(mode: "webflix" | "following" | "byof" | "hybrid"): Promise<readonly ByofRecordView[]>;
  /** Stage a preview capture from an importable source (the connect/import step). */
  startPreview(input: { connectorId: string }): Promise<ByofResult<{ importId: string }>>;
  /** Confirm a staged preview (the promote step — never re-fetches). */
  confirm(importId: string): Promise<ByofResult<{ importId: string; itemCount: number }>>;
  /** Incrementally sync one confirmed import (the honest reconciliation). */
  sync(importId: string): Promise<ByofResult<ByofSyncReportView>>;
  /** Disconnect one import — NON-destructive (records + provenance retained). */
  disconnect(importId: string): Promise<ByofResult<{ importId: string }>>;
  /** DELETE one import's records — the EXPLICIT destructive path only. */
  deleteRecords(importId: string): Promise<ByofResult<{ removed: number }>>;
  /** Discard a staged preview (presentation lifecycle — no records exist). */
  discardPreview(importId: string): Promise<ByofResult<{ importId: string }>>;
  /** The dev drives (fixtures-mode-only, clearly labeled — the J33 harness). */
  drive(action: ByofDevDriveAction): Promise<ByofResult<{ action: string }>>;
}

/** The dev drive actions (the scripted source lifecycle's typed controls). */
export type ByofDevDriveAction = "dev-reset" | "connect" | "expire-auth" | "advance-source";

/** The mutable wiring state the drives move (reads never advance it). */
interface WiringState {
  phase: SourcePhase;
  authorized: boolean;
}

/** One staged preview row (the display truth the frozen sample omits). */
interface StagedRow {
  readonly external_ref: string;
  readonly relationship: string;
  readonly source_ref: string | null;
  readonly source_order: number;
  readonly captured_at: unknown;
  readonly title: string | null;
  readonly canonical_item_id: string;
}

/** The concrete runtime (module-private; the globalThis cache holds it). */
class ByofFixturesRuntimeImpl implements ByofFixturesRuntime {
  private readonly db: DbClient;
  private readonly store: PostgresFeedImportStore;
  private readonly service: FeedImportService;
  private readonly wiring: WiringState = { phase: PHASE_INITIAL, authorized: false };
  private currentPort: FeedConnectorPort | null = null;

  private constructor(db: DbClient) {
    this.db = db;
    const clock = new FixedClock(SERVICE_CLOCK_START);
    const ids = new SequentialIdGen();
    this.store = new PostgresFeedImportStore({ db, clock, ids });
    // The HOST WIRING PATTERN (the composition Worker 1 documented — the
    // projection truth rides on the wiring, not the frozen descriptor):
    // the real connector satisfies the structural FeedConnectorPort.
    const connectors = (connectorId: string): FeedConnectorPort | undefined =>
      connectorId === YOUTUBE_CONNECTOR_ID ? this.currentPort ?? undefined : undefined;
    this.service = new FeedImportService({ db, clock, ids, connectors });
  }

  /** Finish boot: wire the first real connector (awaited — the lifecycle law). */
  private async initialize(): Promise<void> {
    await this.rebuildConnector();
  }

  /** The class's own boot (the private-constructor law kept). */
  static async boot(db: DbClient): Promise<ByofFixturesRuntime> {
    const runtime = new ByofFixturesRuntimeImpl(db);
    await runtime.initialize();
    return runtime;
  }

  /** (Re)build the real YouTube connector over the current wiring state. */
  private async rebuildConnector(): Promise<void> {
    const connector = createYouTubeConnector({
      transport: createPhaseTransport(() => this.wiring.phase),
      credentialSource: this.credentials(),
      clock: new FixedYouTubeClock(),
    });
    await connector.initialize();
    this.currentPort = {
      descriptor: () => connector.descriptor(),
      importFeedResult: (ctx, request) => connector.importFeedResult(ctx, request),
      feedItemCanonicalType: "video",
    };
  }

  /** The credential wiring for the current grant state (the fixture grant). */
  private credentials(): ReturnType<typeof createInMemoryYouTubeCredentialSource> {
    const source = createInMemoryYouTubeCredentialSource();
    if (this.wiring.authorized) {
      void source.store(ANONYMOUS_USER_ID, byofFixtureTokens());
    }
    return source;
  }

  // -- views ----------------------------------------------------------------

  async panelView(previewImportId?: string): Promise<ByofPanelView> {
    const imports = await this.store.listImports(BYOF_FIXTURES_PROFILE);
    const records = await this.service.readFeed(BYOF_FIXTURES_PROFILE, "byof");
    const preview =
      previewImportId !== undefined
        ? await this.readPreviewView(previewImportId)
        : await this.newestStagedPreview(imports);
    return {
      state: "ready",
      sources: this.sourceOptions(),
      imports: imports.map((row) => this.importView(row, records)),
      preview,
    };
  }

  async feedView(): Promise<ByofFeedView> {
    const imports = await this.store.listImports(BYOF_FIXTURES_PROFILE);
    const records = await this.service.readFeed(BYOF_FIXTURES_PROFILE, "byof");
    const following = await this.service.readFeed(BYOF_FIXTURES_PROFILE, "following");
    const relationshipCounts: Record<string, number> = {};
    for (const record of records) {
      const key = record.provenance.relationship;
      relationshipCounts[key] = (relationshipCounts[key] ?? 0) + 1;
    }
    // The feed region renders imports that still own records — the
    // records-driven rule: a confirmed import keeps rendering through
    // EVERY durable state (live, stale, reauthorization-required, and the
    // user-disconnect fold — the records are RETAINED, so the feed keeps
    // showing them with their provenance). An import whose records the
    // user explicitly deleted is ended — it stops rendering (its rows
    // remain as the store's audit trail); previews and failed attempts
    // own no records by construction and are the settings panel's honest
    // trail.
    const feedImports: ByofImportFeedView[] = [];
    for (const row of imports) {
      const own = records.filter((record) => record.importId === row.id);
      if (own.length === 0) continue;
      feedImports.push({ import: this.importView(row, records), groups: groupRecords(own) });
    }
    return {
      state: "ready",
      imports: feedImports,
      followingCount: following.length,
      relationshipCounts,
    };
  }

  /** Read the imported feed records under a frozen read mode (the mode-truth law). */
  async feedRecords(mode: "webflix" | "following" | "byof" | "hybrid"): Promise<readonly ByofRecordView[]> {
    const records = await this.service.readFeed(BYOF_FIXTURES_PROFILE, mode);
    return records.map((record) => ({
      externalRef: record.externalRef,
      title: record.title ?? record.externalRef,
      sourceOrder: record.provenance.sourceOrder,
      entertainmentItemId: record.entertainmentItemId,
      capturedAt: record.provenance.capturedAt,
      relationship: record.provenance.relationship,
      ...(record.provenance.sourceRef !== undefined ? { sourceRef: record.provenance.sourceRef } : {}),
    }));
  }

  /** The importable-source options (the choose-source step's truth). */
  private sourceOptions(): readonly ByofSourceOptionView[] {
    const descriptor = this.currentPort?.descriptor();
    if (descriptor === undefined) return [];
    return [
      {
        connectorId: descriptor.id,
        displayName: descriptor.displayName,
        connected: this.wiring.authorized,
        continuousSync: true,
        importable: [...YOUTUBE_FEED_RELATIONSHIPS],
        unavailable: [
          {
            relationship: "history",
            reason:
              "YouTube's watch history is only available in your Google Takeout export; the Data API does not serve it.",
          },
          {
            relationship: "ranked-feed",
            reason: "YouTube's personalized home feed has no exportable API.",
          },
        ],
      },
    ];
  }

  /** Map one persisted import row to its view (records for the live count). */
  private importView(
    row: PersistedFeedImport,
    allRecords: readonly PersistedFeedRecord[],
  ): ByofImportView {
    const own = allRecords.filter((record) => record.importId === row.id);
    const capturedAt =
      own.length > 0 ? own.map((record) => record.provenance.capturedAt).sort().at(-1) : undefined;
    return {
      importId: row.id,
      connectorId: row.connectorId,
      displayName: this.displayNameOf(row.connectorId),
      method: row.method,
      status: row.status,
      syncState: row.syncState,
      disconnectedByUser: isByofUserDisconnect(row.error),
      continuousSync: row.continuousSync,
      // The LIVE record count for confirmed imports (never the possibly
      // stale column — a deleted import renders its truth: zero items
      // left); the staged count for a preview row (its own truth).
      itemCount: row.status === "preview" ? row.itemCount : own.length,
      ...(capturedAt !== undefined ? { capturedAt } : {}),
      importedAt: row.startedAt,
      ...(row.lastSyncedAt !== undefined ? { lastSyncedAt: row.lastSyncedAt } : {}),
      ...(row.error !== undefined ? { errorDetail: row.error } : {}),
    };
  }

  /** The newest staged preview's view (the panel's default preview). */
  private async newestStagedPreview(
    imports: readonly PersistedFeedImport[],
  ): Promise<ByofPreviewView | null> {
    const staged = imports.find((row) => row.status === "preview");
    return staged === undefined ? null : this.readPreviewView(staged.id);
  }

  /** The staged preview's view (only for a preview-status import). */
  private async readPreviewView(importId: string): Promise<ByofPreviewView | null> {
    const row = await this.store.getImport(importId);
    if (row === null || row.status !== "preview") return null;
    const preview = await this.service.readPreview(importId);
    if (preview === null) return null;
    // The frozen `FeedImportPreview.sample` carries the frozen FeedRecord
    // shape (identity + provenance — no display columns). The staged rows'
    // display truth (title, external ref) is read from the SAME staging
    // table the store confirms from — the one documented adapter-side
    // SELECT (see the module doc): the user confirms WHAT THEY SAW.
    const staged = await this.db.query<StagedRow>(
      `SELECT external_ref, relationship, source_ref, source_order, captured_at, title, canonical_item_id
         FROM feed_preview_items WHERE import_id = $1 ORDER BY position`,
      [importId],
    );
    const sample: ByofRecordView[] = staged.map((stagedRow) => ({
      externalRef: stagedRow.external_ref,
      title: stagedRow.title ?? stagedRow.external_ref,
      sourceOrder: Number(stagedRow.source_order),
      entertainmentItemId: stagedRow.canonical_item_id,
      capturedAt: toIsoTimestamp(stagedRow.captured_at),
      relationship: stagedRow.relationship as FeedRelationship,
      ...(stagedRow.source_ref !== null ? { sourceRef: stagedRow.source_ref } : {}),
    }));
    return {
      importId: preview.importId,
      connectorId: preview.connectorId,
      displayName: this.displayNameOf(preview.connectorId),
      itemCount: preview.itemCount,
      relationshipCounts: preview.relationshipCounts,
      freshness: preview.freshness,
      continuousSync: row.continuousSync,
      sample,
    };
  }

  /** The plain display name of a wired connector (its descriptor's own). */
  private displayNameOf(connectorId: string): string {
    if (connectorId === YOUTUBE_CONNECTOR_ID && this.currentPort !== null) {
      return this.currentPort.descriptor().displayName;
    }
    return connectorId;
  }

  // -- operations -----------------------------------------------------------

  async startPreview(input: { connectorId: string }): Promise<ByofResult<{ importId: string }>> {
    const result = await this.service.previewFeedImport({
      userId: ANONYMOUS_USER_ID,
      profileId: BYOF_FIXTURES_PROFILE,
      ctx: BYOF_CTX,
      connectorId: input.connectorId,
      method: "api",
    });
    if (!result.ok) {
      return { ok: false, failure: mapServiceFailure(result.error) };
    }
    return { ok: true, value: { importId: result.value.importId } };
  }

  async confirm(importId: string): Promise<ByofResult<{ importId: string; itemCount: number }>> {
    const result = await this.service.confirmFeedImport(importId);
    if (!result.ok) {
      return { ok: false, failure: mapServiceFailure(result.error) };
    }
    return { ok: true, value: { importId, itemCount: result.value.itemCount } };
  }

  async sync(importId: string): Promise<ByofResult<ByofSyncReportView>> {
    const result = await this.service.syncFeedImport(importId);
    if (!result.ok) {
      return { ok: false, failure: mapServiceFailure(result.error) };
    }
    return {
      ok: true,
      value: {
        importId,
        added: result.value.report.added,
        updated: result.value.report.updated,
        removed: result.value.report.removed,
        kept: result.value.report.kept,
        syncState: result.value.import.syncState,
      },
    };
  }

  async disconnect(importId: string): Promise<ByofResult<{ importId: string }>> {
    const row = await this.store.getImport(importId);
    if (row === null) {
      return notFound(`disconnect: feed import '${importId}' is unknown`);
    }
    // The disconnect precondition is RECORD OWNERSHIP, not the status
    // label: a confirmed import keeps its disconnect path through every
    // durable state (live, stale, and the reauthorization gap a failed
    // sync lands — the user may choose to end syncing without deleting).
    // A staged preview or a failed attempt owns no records — there is
    // nothing to retain, so the typed refusal names it.
    const inScope = await this.store.readRecordsInScope({
      profileId: BYOF_FIXTURES_PROFILE,
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
    // THE DISCONNECT FOLD (documented; escalated for lead ratification):
    // the frozen FeedSyncState vocabulary has no "disconnected" state, so
    // the user's revocation folds through the shared store's honest
    // state-marking path — the import's grant is missing BY USER CHOICE
    // (`reauthorization-required`), the marker prefix drives the distinct
    // "Disconnected — records retained" presentation, and the records are
    // RETAINED (markSyncOutcome never deletes — the survival law).
    await this.store.markSyncOutcome(importId, {
      syncState: "reauthorization-required",
      error:
        `${BYOF_DISCONNECTED_MARKER} — imported records and their provenance are retained; ` +
        `WebFlix stopped syncing this feed. Deleting the imported records is a separate, explicit action.`,
    });
    return { ok: true, value: { importId } };
  }

  async deleteRecords(importId: string): Promise<ByofResult<{ removed: number }>> {
    const row = await this.store.getImport(importId);
    if (row === null) {
      return notFound(`deleteRecords: feed import '${importId}' is unknown`);
    }
    // The EXPLICIT destructive path — the shared service's own deletion
    // (feed_records only; the separation law pins every other table out
    // of reach). This is the ONLY action in the whole BYOF surface that
    // removes imported records, and it is never the disconnect path.
    const removed = await this.service.deleteImportedRecords(BYOF_FIXTURES_PROFILE, { importId });
    return { ok: true, value: { removed } };
  }

  async discardPreview(importId: string): Promise<ByofResult<{ importId: string }>> {
    const row = await this.store.getImport(importId);
    if (row === null) {
      return notFound(`discardPreview: feed import '${importId}' is unknown`);
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
    // Presentation lifecycle only: a preview row owns NO feed records
    // (records exist solely after confirm — the store's law), so this
    // discard deletes the staged rows + their import transaction and
    // nothing else. It is the one documented adapter-side table DELETE
    // (see the module doc) because the shared store intentionally exposes
    // no discard (confirm-only); it NEVER touches feed_records or any
    // other table.
    await this.db.query(`DELETE FROM feed_imports WHERE id = $1`, [importId]);
    return { ok: true, value: { importId } };
  }

  // -- dev drives (the scripted source lifecycle; reads never advance) ------

  async drive(action: ByofDevDriveAction): Promise<ByofResult<{ action: string }>> {
    switch (action) {
      case "dev-reset": {
        // Pristine BYOF state: every feed/import/graph row this harness
        // wrote is removed (the fixtures DB owns no other data), the
        // source returns to its initial phase, and the grant is absent.
        await this.db.query(`DELETE FROM feed_preview_items`);
        await this.db.query(`DELETE FROM feed_records`);
        await this.db.query(`DELETE FROM feed_imports`);
        await this.db.query(`DELETE FROM source_realizations`);
        await this.db.query(`DELETE FROM entertainment_items`);
        this.wiring.phase = PHASE_INITIAL;
        this.wiring.authorized = false;
        await this.rebuildConnector();
        return { ok: true, value: { action } };
      }
      case "connect": {
        // The fixture OAuth stand-in: the grant appears (the connect step).
        this.wiring.authorized = true;
        await this.rebuildConnector();
        return { ok: true, value: { action } };
      }
      case "expire-auth": {
        // The grant disappears (J33's authorization-failure drive): the
        // next capture answers the typed `unauthorized` verdict, which the
        // real service folds to `reauthorization-required` — records
        // retained, never deleted.
        this.wiring.authorized = false;
        await this.rebuildConnector();
        return { ok: true, value: { action } };
      }
      case "advance-source": {
        // The source changed (J33's sync step): one new follow, one like
        // removed. The NEXT sync reconciles the honest diff.
        this.wiring.phase = PHASE_ADVANCED;
        await this.rebuildConnector();
        return { ok: true, value: { action } };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// View helpers (pure)
// ---------------------------------------------------------------------------

/** Group one import's records (the store's source-native read order, kept). */
function groupRecords(records: readonly PersistedFeedRecord[]): readonly ByofRecordGroupView[] {
  const groups: { relationship: FeedRelationship; records: ByofRecordView[] }[] = [];
  for (const record of records) {
    const view: ByofRecordView = {
      externalRef: record.externalRef,
      title: record.title ?? record.externalRef,
      sourceOrder: record.provenance.sourceOrder,
      entertainmentItemId: record.entertainmentItemId,
      capturedAt: record.provenance.capturedAt,
      relationship: record.provenance.relationship,
      ...(record.provenance.sourceRef !== undefined ? { sourceRef: record.provenance.sourceRef } : {}),
    };
    const last = groups.at(-1);
    if (last !== undefined && last.relationship === record.provenance.relationship) {
      last.records.push(view);
    } else {
      groups.push({ relationship: record.provenance.relationship, records: [view] });
    }
  }
  return groups;
}

/** Map the shared service's failure vocabulary onto the port's grammar. */
function mapServiceFailure(error: FeedServiceFailure): ByofFailure {
  const kind: ByofFailureKind = (() => {
    switch (error.kind) {
      case "unknown-connector":
        return "unsupported";
      case "unsupported":
        return "unsupported";
      case "unauthorized":
        return "unauthorized";
      case "transport":
        return "transport";
      case "provider":
        return "provider";
      case "invalid-input":
        return "invalid-input";
      case "not-found":
        return "not-found";
    }
  })();
  return {
    kind,
    detail: error.detail,
    ...(error.importId !== undefined ? { importId: error.importId } : {}),
    ...(error.syncState !== undefined ? { syncState: error.syncState as FeedSyncState } : {}),
  };
}

/** The typed not-found failure. */
function notFound(detail: string): { ok: false; failure: ByofFailure } {
  return { ok: false, failure: { kind: "not-found", detail } };
}

// ---------------------------------------------------------------------------
// The boot (PGlite + the REAL migration set + the composition)
// ---------------------------------------------------------------------------

/** A PGlite-backed DbClient (the deterministic test-harness twin). */
function createPgLiteDbClient(pglite: PGlite): DbClient {
  const query = async <Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]> => {
    const result = await pglite.query(sqlText, params as unknown[]);
    return result.rows as unknown as Row[];
  };
  return {
    query,
    begin: async <T>(work: (tx: SqlClient) => Promise<T>): Promise<T> => {
      return pglite.transaction(async (tx) => {
        return work({
          async query<Row extends object = SqlRow>(
            txText: string,
            txParams?: readonly unknown[],
          ): Promise<Row[]> {
            const result = await tx.query(txText, txParams as unknown[]);
            return result.rows as unknown as Row[];
          },
        });
      });
    },
    close: async () => {
      await pglite.close();
    },
  };
}

/** Boot the BYOF fixtures runtime (PGlite + migrations + the real seams). */
async function bootByofFixturesRuntime(): Promise<ByofFixturesRuntime> {
  const pglite = new PGlite();
  const db = createPgLiteDbClient(pglite);
  const migrations = await runMigrations(db);
  if (migrations.applied.length === 0 && migrations.verified.length === 0) {
    throw new Error(
      `byof fixtures boot: expected the real migration set, applied none (total ${migrations.total})`,
    );
  }
  return ByofFixturesRuntimeImpl.boot(db);
}

// ---------------------------------------------------------------------------
// The process-global singleton (the dev split-module law — see module doc)
// ---------------------------------------------------------------------------

/** The globalThis key every module-graph copy of this file agrees on. */
const BYOF_GLOBAL_KEY = "__wfxWebByofFixturesRuntime";

/** The cached boot promise's global shape. */
type ByofGlobal = { [key: string]: unknown };

/**
 * The ONE BYOF fixtures runtime this process serves (boot promise cached
 * on `globalThis`, so the settings page, the Library page, and the /api/byof
 * route — separate Turbopack module graphs in the dev server — all share
 * the same PGlite, the same service, and the same wiring).
 */
export function getByofFixturesRuntime(): Promise<ByofFixturesRuntime> {
  const globals = globalThis as ByofGlobal;
  const existing = globals[BYOF_GLOBAL_KEY];
  if (existing !== undefined) {
    return existing as Promise<ByofFixturesRuntime>;
  }
  const boot = bootByofFixturesRuntime();
  globals[BYOF_GLOBAL_KEY] = boot;
  return boot;
}
