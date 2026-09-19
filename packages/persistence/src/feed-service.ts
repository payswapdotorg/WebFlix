/**
 * @wfx/persistence — the BYOF feed import SERVICE (R20-C, Worker 1).
 *
 * The composition layer that makes Bring Your Own Feed real end-to-end:
 * connector capture → canonical identity resolution → preview staging →
 * idempotent confirm → incremental sync with honest state transitions.
 * R20-A built the contracts + the store; R20-B built the connector
 * capability; THIS module is the reconciliation composition the plan's
 * R20-C names: "snapshot import, incremental synchronization where
 * supported, deduplication, canonical identity resolution, stale/offline
 * semantics, and preservation of WebFlix-local actions".
 *
 * Layering: the service lives in @wfx/persistence and consumes the
 * connector through `FeedConnectorPort` — a narrow STRUCTURAL seam (the
 * same dependency-inversion pattern as @wfx/experience's `ConnectorPort`).
 * @wfx/connectors is a devDependency here (tests prove the real YouTube
 * connector satisfies the port); production hosts wire their connector
 * registry into the constructor. No @wfx/connectors runtime import.
 *
 * Laws this service enforces (docs/architecture/byof-architecture.md):
 *
 * - CANONICAL IDENTITY RESOLUTION, in priority order per captured item:
 *   (1) the EXISTING feed record for the same import key keeps its
 *   canonical identity (stable across syncs — provenance refreshes, the
 *   anchor never drifts);
 *   (2) a known source realization `(connectorId, externalRef)` maps to its
 *   canonical item — the strongest signal, the graph merge law ("one
 *   content identity, many realizations": the same video in "LL" and in a
 *   playlist resolves to ONE item with ONE realization);
 *   (3) otherwise the item is MINTED into the Entertainment Graph — a new
 *   canonical `wfxitm_` identity plus its `wfxsrc_` realization — but ONLY
 *   when the connector declares `feedItemCanonicalType` (the projection
 *   truth; a type is never guessed). Follow/subscription targets (channels,
 *   accounts) are NEVER minted into `entertainment_items`: a channel is NOT
 *   an EntertainmentItem (the WFX-054 projection law) — those records
 *   carry a DEFERRED canonical anchor (a minted `wfxitm_` identity with no
 *   content-type claim, marked `canonicalResolution: "deferred-follow"` in
 *   the record's metadata) so re-imports stay idempotent without
 *   fabricating a canonical type.
 *
 * - SYNC SCOPE DISCIPLINE (the remove-safety law): an incremental sync
 *   reconciles EXACTLY the scope the original request produced — the
 *   import's relationship filter (migration 0013) + container + method. A
 *   sync of a likes-only import can NEVER remove follow records that a
 *   different import owns; removal happens only for relationships inside
 *   the synced scope that the source no longer lists.
 *
 * - HONEST STATE TRANSITIONS: every capture failure folds through the
 *   domain's `nextSyncStateAfterSync` state machine — unauthorized →
 *   `reauthorization-required`, transport/provider failure → `stale` with
 *   prior records / `degraded` without — and the records SURVIVE (the
 *   source-disconnection survival law). Failed capture ATTEMPTS that
 *   never reached a preview still land their honest audit row
 *   (`recordFailedImport`), except static `unsupported`/`invalid-input`
 *   verdicts, which are request/capability truth, not transactions.
 *
 * - SNAPSHOT TRUTH: a capture is consumed as a snapshot; only a successful
 *   sync of a continuously re-readable route lands `live`. Confirm of a
 *   one-time route lands `snapshot`. Sync of a non-re-readable route is the
 *   typed `unsupported` verdict (re-import instead — never a fake refresh).
 *
 * - SEPARATION LAW: this service writes ONLY the feed_* table family and
 *   (for minted items) the Entertainment Graph tables. Library entries,
 *   watch history, intents, and recommendation state are structurally out
 *   of reach — a concentrated BYOF import cannot touch WebFlix-local
 *   identity (pinned by tests).
 *
 * Error-channel law (mirrors the repo convention): caller misuse and
 * domain verdicts are TYPED RESULTS (`FeedServiceResult` — never a thrown
 * generic error, never a fake success); persistence-layer degradation
 * keeps its own typed `PersistenceError` throw channel. The connector's
 * `ConnectorError` shape is accepted STRUCTURALLY (`FeedConnectorFailure`)
 * so the SDK result surface satisfies the port without an import.
 */

import type {
  ConnectorContext,
  ConnectorDescriptor,
  EntertainmentItem,
  FeedImportMethod,
  FeedImportPreview,
  FeedImportRequest,
  FeedReconciliationReport,
  FeedRelationship,
  FeedSyncState,
  ConnectorFeedItem,
  ConnectorFeedSnapshot,
} from "@wfx/domain";
import {
  ENTERTAINMENT_ITEM_ID_PREFIX,
  FEED_IMPORT_METHODS,
  FEED_RELATIONSHIPS,
  FOLLOWING_RELATIONSHIPS,
  SOURCE_REALIZATION_ID_PREFIX,
  feedImportKey,
  feedReconciliationReport,
  isFeedImportMethod,
  isFeedRelationship,
  nextSyncStateAfterSync,
  reconcileFeedSnapshot,
  validateConnectorFeedSnapshot,
} from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";

import {
  PostgresFeedImportStore,
  type FeedRecordWriteInput,
  type PersistedFeedImport,
  type PersistedFeedRecord,
  type StageFeedItemInput,
} from "./feed-import";
import { PostgresGraphStore } from "./graph";
import { PersistenceError } from "./errors";
import type { DbClient } from "./sql";

// ---------------------------------------------------------------------------
// The connector seam (structural — no @wfx/connectors runtime import)
// ---------------------------------------------------------------------------

/**
 * The failure shape the connector result surface returns. A structural
 * mirror of the SDK's `ConnectorError` narrowed to what the feed surface
 * reads (the extra SDK fields — `capability`, `connectorId` — ride along
 * unnoticed; the `kind` + `detail` are the truth this service folds).
 */
export interface FeedConnectorFailure {
  readonly kind: "unsupported" | "unauthorized" | "transport" | "invalid-input";
  readonly detail?: string;
}

/** The result envelope the port's capture method returns. */
export type FeedConnectorSnapshotResult =
  | { readonly ok: true; readonly value: ConnectorFeedSnapshot }
  | { readonly ok: false; readonly error: FeedConnectorFailure };

/**
 * The authorized feed-import slice of a connector — the port this service
 * consumes. `BaseConnector.importFeedResult` (WFX-003 + R20-B) satisfies
 * it structurally: a real connector IS a `FeedConnectorPort`.
 *
 * `feedItemCanonicalType` is the connector's PROJECTION TRUTH — the
 * canonical type its feed ITEMS carry (the YouTube route's items are
 * videos). It is optional composition-level knowledge (the frozen
 * `ConnectorDescriptor` carries no such field — flagged for lead
 * ratification): absent, item relationships get DEFERRED canonicalization
 * (an honest absence — a canonical type is never guessed).
 */
export interface FeedConnectorPort {
  readonly descriptor: () => ConnectorDescriptor;
  readonly importFeedResult: (
    ctx: ConnectorContext,
    request: FeedImportRequest,
  ) => Promise<FeedConnectorSnapshotResult>;
  readonly feedItemCanonicalType?: EntertainmentItem["canonicalType"];
}

// ---------------------------------------------------------------------------
// The service result envelope
// ---------------------------------------------------------------------------

/** The closed failure vocabulary of the feed service. */
export type FeedServiceFailureKind =
  /** The connectorId is not wired in this host's registry. */
  | "unknown-connector"
  /** The connector/route honestly cannot serve the request. */
  | "unsupported"
  /** The user's grant is missing — the reauthorization recovery path. */
  | "unauthorized"
  /** Transport with the source failed. */
  | "transport"
  /** The connector returned a value that violates its own contract. */
  | "provider"
  /** Malformed caller input (typed; never a throw). */
  | "invalid-input"
  /** The addressed import is unknown. */
  | "not-found";

/** One typed service failure — the honest error channel. */
export interface FeedServiceFailure {
  readonly kind: FeedServiceFailureKind;
  readonly detail: string;
  /** The failed import's id when one was recorded (capture attempts). */
  readonly importId?: string;
  /** The import's state after the honest failure fold (when one was involved). */
  readonly syncState?: FeedSyncState;
}

/** The result envelope of every service method. */
export type FeedServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FeedServiceFailure };

// ---------------------------------------------------------------------------
// Sync outcome
// ---------------------------------------------------------------------------

/** What one successful sync produced: the import's new truth + the report. */
export interface FeedSyncOutcome {
  readonly import: PersistedFeedImport;
  readonly report: FeedReconciliationReport;
}

// ---------------------------------------------------------------------------
// Canonical resolution (the R20-C identity discipline)
// ---------------------------------------------------------------------------

/** How one captured item's canonical identity was resolved (lead-visible diagnostics). */
export type FeedCanonicalResolution =
  | "existing-record"
  | "known-realization"
  | "minted-item"
  | "deferred-follow"
  | "deferred-untyped";

/** The metadata marker a deferred record carries (visible, never silent). */
export const FEED_DEFERRED_RESOLUTION_MARKER = "canonicalResolution";

/** The relationships whose targets are the user's follow graph (not EntertainmentItems). */
const FOLLOW_LIKE_RELATIONSHIPS: ReadonlySet<FeedRelationship> = new Set(FOLLOWING_RELATIONSHIPS);

/** One resolved staging row: the store's input + the resolution diagnostic. */
interface ResolvedItem {
  readonly stage: StageFeedItemInput;
  readonly resolution: FeedCanonicalResolution;
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/** A request to import a feed (the typed result-surface twin of the frozen `FeedPort.previewImport`). */
export interface FeedImportRequestInput {
  readonly userId: string;
  readonly profileId: string;
  readonly ctx: ConnectorContext;
  readonly connectorId: string;
  /** Defaults to `'api'` (the authorized-API route). */
  readonly method?: FeedImportMethod;
  /** Restrict the capture to these relationships (undefined = the route's full set). */
  readonly relationships?: readonly FeedRelationship[];
  /** Restrict the capture to one container (a playlist id, where the route supports it). */
  readonly sourceRef?: string;
  /** A user-supplied export artifact (methods `official-export` / `user-file`). */
  readonly artifact?: Uint8Array;
}

/** Options for the service (the injected seams — repo determinism law). */
export interface FeedImportServiceOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The host's connector registry: connectorId → the authorized feed-import port. */
  readonly connectors: (connectorId: string) => FeedConnectorPort | undefined;
}

// ---------------------------------------------------------------------------
// Input validation (typed failures — never a throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidInput(detail: string): FeedServiceFailure {
  return { kind: "invalid-input", detail };
}

function validateImportRequest(input: FeedImportRequestInput): FeedServiceFailure | null {
  if (typeof input !== "object" || input === null) {
    return invalidInput("request: expected a FeedImportRequestInput object");
  }
  if (!isNonEmptyString(input.userId)) return invalidInput("request.userId: expected a non-empty string");
  if (!isNonEmptyString(input.profileId)) return invalidInput("request.profileId: expected a non-empty string");
  if (!isNonEmptyString(input.connectorId)) {
    return invalidInput("request.connectorId: expected a non-empty string");
  }
  const ctx = input.ctx as unknown;
  if (typeof ctx !== "object" || ctx === null || !isNonEmptyString((ctx as { userId?: unknown }).userId)) {
    return invalidInput("request.ctx: expected a ConnectorContext with a non-empty userId");
  }
  if (input.method !== undefined && !isFeedImportMethod(input.method)) {
    return invalidInput(
      `request.method: expected one of ${FEED_IMPORT_METHODS.join(" | ")}, got '${String(input.method)}'`,
    );
  }
  if (input.relationships !== undefined) {
    if (!Array.isArray(input.relationships) || input.relationships.length === 0) {
      return invalidInput("request.relationships: expected a non-empty array when present");
    }
    for (const relationship of input.relationships) {
      if (!isFeedRelationship(relationship)) {
        return invalidInput(
          `request.relationships: expected members of ${FEED_RELATIONSHIPS.join(" | ")}, got '${String(relationship)}'`,
        );
      }
    }
  }
  if (input.sourceRef !== undefined && !isNonEmptyString(input.sourceRef)) {
    return invalidInput("request.sourceRef: expected a non-empty string when present");
  }
  if (input.artifact !== undefined && !(input.artifact instanceof Uint8Array)) {
    return invalidInput("request.artifact: expected a Uint8Array when present");
  }
  if (
    (input.method === "official-export" || input.method === "user-file") &&
    input.artifact === undefined
  ) {
    return invalidInput(
      `request.artifact: required for method '${input.method}' (an export/file import needs the user-supplied artifact)`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * The BYOF feed import service — the R20-C composition. See the module
 * header for the law map. Every public method returns a typed
 * `FeedServiceResult`; persistence-layer degradation keeps its typed
 * `PersistenceError` throw channel (the WFX-052 convention).
 */
export class FeedImportService {
  private readonly store: PostgresFeedImportStore;
  private readonly graph: PostgresGraphStore;
  private readonly connectors: (connectorId: string) => FeedConnectorPort | undefined;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: FeedImportServiceOptions) {
    this.store = new PostgresFeedImportStore({ db: options.db, clock: options.clock, ids: options.ids });
    this.graph = new PostgresGraphStore(options.db);
    this.connectors = options.connectors;
    this.clock = options.clock;
    this.ids = options.ids;
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  // -------------------------------------------------------------------------
  // previewImport
  // -------------------------------------------------------------------------

  /**
   * Capture the user's feed from the authorized connector and stage it as a
   * preview the user confirms (J33: choose source → connect/import →
   * preview). The staged rows are the CAPTURE verbatim — canonical identity
   * is resolved per item (see the module header's resolution order), and
   * the import row records the request's scope for later syncs.
   *
   * Failure truth: `unsupported` (the route cannot serve the request —
   * static capability truth, no row), `unauthorized` / `transport` /
   * `provider` (the attempt lands its honest audit row), `unknown-connector`
   * (not wired in this host), `invalid-input` (malformed request).
   */
  async previewFeedImport(input: FeedImportRequestInput): Promise<FeedServiceResult<FeedImportPreview>> {
    const invalid = validateImportRequest(input);
    if (invalid !== null) return { ok: false, error: invalid };

    const connector = this.connectors(input.connectorId);
    if (connector === undefined) {
      return {
        ok: false,
        error: {
          kind: "unknown-connector",
          detail: `previewFeedImport: connector '${input.connectorId}' is not wired in this host's feed-import registry`,
        },
      };
    }

    const request: FeedImportRequest = {
      method: input.method ?? "api",
      ...(input.relationships !== undefined ? { relationships: input.relationships } : {}),
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      ...(input.artifact !== undefined ? { artifact: input.artifact } : {}),
    };

    let captured: FeedConnectorSnapshotResult;
    try {
      captured = await connector.importFeedResult(input.ctx, request);
    } catch (thrown) {
      // A port that throws violated its own result contract — fold it as a
      // transport failure (never a crash, never a fabricated preview).
      captured = {
        ok: false,
        error: {
          kind: "transport",
          detail: `the connector threw instead of answering a typed result: ${String(thrown)}`,
        },
      };
    }

    if (!captured.ok) {
      return this.foldFailedCapture(input, request, captured.error);
    }

    const snapshotValidated = validateConnectorFeedSnapshot(captured.value);
    if (!snapshotValidated.ok) {
      return this.foldFailedCapture(input, request, {
        kind: "transport",
        detail: `the connector returned a malformed capture: ${snapshotValidated.errors.join("; ")}`,
      });
    }
    const snapshot = captured.value;
    if (snapshot.connectorId !== connector.descriptor().id) {
      return this.foldFailedCapture(input, request, {
        kind: "transport",
        detail:
          `the connector returned a capture claiming connector '${snapshot.connectorId}' ` +
          `but serves '${connector.descriptor().id}'`,
      });
    }

    // Canonical resolution over the user's EXISTING records of this
    // connector (re-imports keep the prior canonical identities stable).
    const existing = await this.store.readRecordsInScope({
      profileId: input.profileId,
      connectorId: input.connectorId,
    });
    const existingByKey = new Map<string, PersistedFeedRecord>();
    for (const record of existing) {
      existingByKey.set(
        feedImportKey({
          profileId: record.profileId,
          connectorId: record.provenance.connectorId,
          relationship: record.provenance.relationship,
          sourceRef: record.provenance.sourceRef,
          externalRef: record.externalRef,
        }),
        record,
      );
    }

    const resolved: ResolvedItem[] = [];
    for (const item of snapshot.items) {
      const decision = await this.resolveCanonicalIdentity(
        connector,
        item,
        input.profileId,
        snapshot.capturedAt,
        existingByKey,
      );
      resolved.push(decision);
    }

    const started = await this.store.startPreview({
      userId: input.userId,
      profileId: input.profileId,
      connectorId: input.connectorId,
      method: snapshot.method,
      continuousSync: snapshot.continuousSync,
      ...(snapshot.sourceRef !== undefined || input.sourceRef !== undefined
        ? { sourceRef: snapshot.sourceRef ?? input.sourceRef }
        : {}),
      ...(input.relationships !== undefined ? { relationships: input.relationships } : {}),
      capturedAt: snapshot.capturedAt,
      items: resolved.map((row) => row.stage),
    });

    const preview = await this.store.readPreview(started.id);
    if (preview === null) {
      return {
        ok: false,
        error: {
          kind: "provider",
          detail: `previewFeedImport: the staged preview '${started.id}' could not be read back`,
        },
      };
    }
    return { ok: true, value: preview };
  }

  /**
   * Read one staged preview (the import + item counts + samples). `null`
   * when the import is unknown — the caller's UI state, not an error.
   */
  async readPreview(importId: string): Promise<FeedImportPreview | null> {
    return this.store.readPreview(importId);
  }

  // -------------------------------------------------------------------------
  // confirmImport
  // -------------------------------------------------------------------------

  /**
   * Confirm a preview: promote the staged capture into idempotent feed
   * records (the user confirmed WHAT THEY SAW — confirm never re-fetches).
   * A continuously re-readable route lands `live`; a one-time capture
   * lands `snapshot` — never presented as live.
   */
  async confirmFeedImport(importId: string): Promise<FeedServiceResult<PersistedFeedImport>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("confirmFeedImport: importId: expected a non-empty string") };
    }
    const existing = await this.store.getImport(importId);
    if (existing === null) {
      return {
        ok: false,
        error: { kind: "not-found", detail: `confirmFeedImport: feed import '${importId}' is unknown` },
      };
    }
    if (existing.status === "failed" || existing.status === "reauthorization-required") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail:
            `confirmFeedImport: feed import '${importId}' is '${existing.status}' — ` +
            `it never staged a preview to confirm`,
        },
      };
    }
    const confirmed = await this.store.confirmImport(importId);
    return { ok: true, value: confirmed };
  }

  // -------------------------------------------------------------------------
  // readFeed
  // -------------------------------------------------------------------------

  /**
   * Read the imported feed records under a mode — the mode-truth law:
   * `webflix` is ALWAYS empty (imported source-native records are never
   * re-labeled as WebFlix-ranked content); `following` is the follow-graph
   * subset; `byof`/`hybrid` return the source-native order.
   */
  async readFeed(
    profileId: string,
    mode: "webflix" | "following" | "byof" | "hybrid",
  ): Promise<readonly PersistedFeedRecord[]> {
    if (!isNonEmptyString(profileId)) {
      throw new PersistenceError("invalid-input", "readFeed: profileId: expected a non-empty string", {
        operation: "readFeed",
      });
    }
    return this.store.readFeed(profileId, mode);
  }

  // -------------------------------------------------------------------------
  // syncImport (the R20-C reconciliation composition)
  // -------------------------------------------------------------------------

  /**
   * Incrementally synchronize one import: re-capture through the connector,
   * diff against the persisted records of the import's OWN scope
   * (`reconcileFeedSnapshot` — the domain engine), apply the plan
   * idempotently, and fold the honest state machine.
   *
   * - Success of a continuously re-readable route → the import and its
   *   records land `live`; the returned `FeedReconciliationReport` carries
   *   the honest per-item decisions (add/update/remove/keep + deduplicated).
   * - `unauthorized` → `reauthorization-required` (records RETAINED — the
   *   survival law; the typed failure names the recovery path).
   * - `transport` / `provider` → `stale` with prior records, `degraded`
   *   without (records retained either way).
   * - A non-re-readable route (one-time capture) → `unsupported`: re-import
   *   through a fresh preview instead of a fake refresh.
   * - Scope discipline: only records the import's request produced (its
   *   relationship filter + container + method) are reconciled.
   */
  async syncFeedImport(importId: string): Promise<FeedServiceResult<FeedSyncOutcome>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("syncFeedImport: importId: expected a non-empty string") };
    }
    const record = await this.store.getImport(importId);
    if (record === null) {
      return {
        ok: false,
        error: { kind: "not-found", detail: `syncFeedImport: feed import '${importId}' is unknown` },
      };
    }
    if (record.status === "preview") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail:
            `syncFeedImport: feed import '${importId}' is still a preview — ` +
            `confirm it before syncing (nothing is imported yet)`,
        },
      };
    }
    if (!record.continuousSync) {
      return {
        ok: false,
        error: {
          kind: "unsupported",
          detail:
            `syncFeedImport: feed import '${importId}' captured a one-time route ` +
            `(continuousSync = false) — re-import through a fresh preview instead of a fake refresh`,
        },
      };
    }
    const connector = this.connectors(record.connectorId);
    if (connector === undefined) {
      return {
        ok: false,
        error: {
          kind: "unknown-connector",
          detail:
            `syncFeedImport: connector '${record.connectorId}' is not wired in this host's ` +
            `feed-import registry (the import and its records are retained)`,
        },
      };
    }

    const request: FeedImportRequest = {
      method: record.method,
      ...(record.relationships !== undefined ? { relationships: record.relationships } : {}),
      ...(record.sourceRef !== undefined ? { sourceRef: record.sourceRef } : {}),
    };

    let captured: FeedConnectorSnapshotResult;
    try {
      captured = await connector.importFeedResult(
        { userId: record.userId, locale: "en", region: "US" },
        request,
      );
    } catch (thrown) {
      captured = {
        ok: false,
        error: { kind: "transport", detail: `the connector threw instead of answering: ${String(thrown)}` },
      };
    }
    if (!captured.ok) {
      return this.foldFailedSync(record, captured.error);
    }

    const snapshotValidated = validateConnectorFeedSnapshot(captured.value);
    if (!snapshotValidated.ok) {
      return this.foldFailedSync(record, {
        kind: "transport",
        detail: `the connector returned a malformed capture: ${snapshotValidated.errors.join("; ")}`,
      });
    }
    const snapshot = captured.value;
    if (snapshot.connectorId !== connector.descriptor().id) {
      return this.foldFailedSync(record, {
        kind: "transport",
        detail:
          `the connector returned a capture claiming connector '${snapshot.connectorId}' ` +
          `but serves '${connector.descriptor().id}'`,
      });
    }

    // The import's OWN scope (migration 0013 discipline): the relationship
    // filter + container the request produced, and only records the same
    // METHOD captured (a file import's records survive an API sync).
    const scope = {
      profileId: record.profileId,
      connectorId: record.connectorId,
      ...(record.relationships !== undefined ? { relationships: record.relationships } : {}),
      ...(record.sourceRef !== undefined ? { sourceRef: record.sourceRef } : {}),
    };
    const inScope = (await this.store.readRecordsInScope(scope)).filter(
      (row) => row.provenance.importMethod === record.method,
    );

    const plan = reconcileFeedSnapshot(inScope, snapshot, scope);
    const existingByKey = new Map<string, PersistedFeedRecord>();
    for (const row of inScope) {
      existingByKey.set(
        feedImportKey({
          profileId: row.profileId,
          connectorId: row.provenance.connectorId,
          relationship: row.provenance.relationship,
          sourceRef: row.provenance.sourceRef,
          externalRef: row.externalRef,
        }),
        row,
      );
    }

    const upserts: FeedRecordWriteInput[] = [];
    for (const upsert of plan.upserts) {
      const decision = await this.resolveCanonicalIdentity(
        connector,
        upsert.item,
        record.profileId,
        snapshot.capturedAt,
        existingByKey,
      );
      upserts.push({
        key: upsert.key,
        externalRef: upsert.item.externalRef,
        relationship: upsert.item.relationship,
        ...(upsert.item.sourceRef !== undefined ? { sourceRef: upsert.item.sourceRef } : {}),
        sourceOrder: upsert.item.sourceOrder,
        capturedAt: snapshot.capturedAt,
        ...(upsert.item.sourceUpdatedAt !== undefined
          ? { sourceUpdatedAt: upsert.item.sourceUpdatedAt }
          : {}),
        ...(upsert.item.title !== undefined ? { title: upsert.item.title } : {}),
        ...(decision.stage.metadata !== undefined ? { metadata: decision.stage.metadata } : {}),
        entertainmentItemId: decision.stage.entertainmentItemId,
      });
    }

    const syncState = nextSyncStateAfterSync({ ok: true, continuousSync: snapshot.continuousSync });
    await this.store.applyReconciliation(importId, {
      upserts,
      removeKeys: plan.decisions
        .filter((decision) => decision.action === "remove")
        .map((decision) => decision.key),
      counts: {
        added: plan.counts.added,
        updated: plan.counts.updated,
        removed: plan.counts.removed,
        kept: plan.counts.kept,
      },
      syncState,
      capturedAt: snapshot.capturedAt,
    });

    // Convergence: stamp every record of the import (kept rows included)
    // with the folded state and clear any prior error (the WFX-A store law).
    const converged = await this.store.markSyncOutcome(importId, {
      syncState,
      at: this.nowIso(),
    });

    const report = feedReconciliationReport(plan, {
      importId,
      appliedAt: converged.completedAt ?? this.nowIso(),
      method: record.method,
    });
    return { ok: true, value: { import: converged, report } };
  }

  // -------------------------------------------------------------------------
  // The explicit deletion path
  // -------------------------------------------------------------------------

  /**
   * DELETE imported feed records — the EXPLICIT user-deletion path ONLY
   * (J33: disconnect/re-authorize never deletes; it marks state). Never
   * touches any table outside `feed_records`.
   */
  async deleteImportedRecords(
    profileId: string,
    scope: { connectorId?: string; importId?: string },
  ): Promise<number> {
    return this.store.deleteFeedRecords(profileId, scope);
  }

  // -------------------------------------------------------------------------
  // Internals — canonical identity resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve one captured item's canonical identity (the module-header
   * order): existing record → known realization → mint (typed) → deferred.
   * Returns the store's staging row with the resolution riding in
   * `metadata.canonicalResolution` for deferred cases (visible, never
   * silent).
   */
  private async resolveCanonicalIdentity(
    connector: FeedConnectorPort,
    item: ConnectorFeedItem,
    profileId: string,
    capturedAt: string,
    existingByKey: ReadonlyMap<string, PersistedFeedRecord>,
  ): Promise<ResolvedItem> {
    const existing = existingByKey.get(
      feedImportKey({
        profileId,
        connectorId: connector.descriptor().id,
        relationship: item.relationship,
        sourceRef: item.sourceRef,
        externalRef: item.externalRef,
      }),
    );

    const base: StageFeedItemInput = {
      externalRef: item.externalRef,
      relationship: item.relationship,
      ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
      sourceOrder: item.sourceOrder,
      capturedAt,
      ...(item.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.metadata !== undefined ? { metadata: { ...item.metadata } } : {}),
      entertainmentItemId: "",
    };

    if (existing !== undefined) {
      return {
        stage: { ...base, entertainmentItemId: existing.entertainmentItemId },
        resolution: "existing-record",
      };
    }

    const known = await this.graph.realizationByRef(connector.descriptor().id, item.externalRef);
    if (known !== null) {
      return {
        stage: { ...base, entertainmentItemId: known.entertainmentItemId },
        resolution: "known-realization",
      };
    }

    const isFollowTarget = FOLLOW_LIKE_RELATIONSHIPS.has(item.relationship);
    if (isFollowTarget) {
      // A channel/account is NOT an EntertainmentItem (WFX-054): a
      // canonical type is never fabricated. The record carries a DEFERRED
      // anchor — a minted identity with no content claim, marked visibly.
      return {
        stage: {
          ...base,
          entertainmentItemId: `${ENTERTAINMENT_ITEM_ID_PREFIX}${this.ids.next()}`,
          metadata: {
            ...item.metadata,
            [FEED_DEFERRED_RESOLUTION_MARKER]: "deferred-follow",
          },
        },
        resolution: "deferred-follow",
      };
    }

    const canonicalType = connector.feedItemCanonicalType;
    if (canonicalType === undefined) {
      // The connector's projection truth is not wired: no type is guessed.
      return {
        stage: {
          ...base,
          entertainmentItemId: `${ENTERTAINMENT_ITEM_ID_PREFIX}${this.ids.next()}`,
          metadata: {
            ...item.metadata,
            [FEED_DEFERRED_RESOLUTION_MARKER]: "deferred-untyped",
          },
        },
        resolution: "deferred-untyped",
      };
    }

    // Mint: a new canonical item + its realization (the graph accumulates
    // the identity; enrichment — duration, orientation — belongs to later
    // metadata passes, never a guess here).
    const now = this.nowIso();
    const itemId = `${ENTERTAINMENT_ITEM_ID_PREFIX}${this.ids.next()}`;
    const descriptor = connector.descriptor();
    await this.graph.upsertItem({
      id: itemId,
      canonicalType,
      ...(item.title !== undefined ? { canonicalTitle: item.title } : {}),
      creators: [],
      topics: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.graph.upsertRealization({
      id: `${SOURCE_REALIZATION_ID_PREFIX}${this.ids.next()}`,
      entertainmentItemId: itemId,
      connectorId: descriptor.id,
      externalRef: item.externalRef,
      capabilities: [...descriptor.capabilities],
      availability: "unknown",
      playback: [],
      createdAt: now,
      updatedAt: now,
    });
    return {
      stage: { ...base, entertainmentItemId: itemId },
      resolution: "minted-item",
    };
  }

  // -------------------------------------------------------------------------
  // Internals — the honest failure folds
  // -------------------------------------------------------------------------

  /** Fold a failed FIRST capture (preview): honest audit row where due + typed failure. */
  private async foldFailedCapture(
    input: FeedImportRequestInput,
    request: FeedImportRequest,
    error: FeedConnectorFailure,
  ): Promise<FeedServiceResult<FeedImportPreview>> {
    const detail = describeConnectorFailure(input.connectorId, error);
    if (error.kind === "unsupported" || error.kind === "invalid-input") {
      // Static request/capability truth — no transaction happened.
      return {
        ok: false,
        error: {
          kind: error.kind === "invalid-input" ? "provider" : "unsupported",
          detail,
        },
      };
    }
    const syncState: FeedSyncState =
      error.kind === "unauthorized" ? "reauthorization-required" : "degraded";
    const failed = await this.store.recordFailedImport({
      userId: input.userId,
      profileId: input.profileId,
      connectorId: input.connectorId,
      method: request.method,
      ...(request.sourceRef !== undefined ? { sourceRef: request.sourceRef } : {}),
      ...(request.relationships !== undefined ? { relationships: request.relationships } : {}),
      syncState,
      error: detail,
    });
    return {
      ok: false,
      error: { kind: error.kind, detail, importId: failed.id, syncState: failed.syncState },
    };
  }

  /** Fold a failed SYNC: the survival law — records retained, state honest. */
  private async foldFailedSync(
    record: PersistedFeedImport,
    error: FeedConnectorFailure,
  ): Promise<FeedServiceResult<FeedSyncOutcome>> {
    const detail = describeConnectorFailure(record.connectorId, error);
    const failure =
      error.kind === "unauthorized"
        ? "authorization"
        : error.kind === "unsupported"
          ? "unsupported"
          : error.kind === "invalid-input"
            ? "provider"
            : "transport";
    const inScope = await this.store.readRecordsInScope({
      profileId: record.profileId,
      connectorId: record.connectorId,
      ...(record.relationships !== undefined ? { relationships: record.relationships } : {}),
      ...(record.sourceRef !== undefined ? { sourceRef: record.sourceRef } : {}),
    });
    const hasRecords = inScope.length > 0;
    const syncState = nextSyncStateAfterSync({ ok: false, failure, hasRecords });
    const updated = await this.store.markSyncOutcome(record.id, {
      syncState,
      error: detail,
      at: this.nowIso(),
    });
    return {
      ok: false,
      error: { kind: error.kind, detail, importId: record.id, syncState: updated.syncState },
    };
  }
}

// ---------------------------------------------------------------------------
// Failure rendering
// ---------------------------------------------------------------------------

/** One honest line for a connector failure (the service's error detail). */
function describeConnectorFailure(connectorId: string, error: FeedConnectorFailure): string {
  switch (error.kind) {
    case "unsupported":
      return error.detail ?? `connector '${connectorId}' cannot serve this feed request`;
    case "unauthorized":
      return `connector '${connectorId}' has no valid credentials for this feed request`;
    case "transport":
      return error.detail ?? `connector '${connectorId}' failed transport with its source`;
    case "invalid-input":
      return `connector '${connectorId}' rejected the request: ${error.detail ?? "malformed"}`;
  }
}
