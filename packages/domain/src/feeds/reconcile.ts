/**
 * @wfx/domain — the BYOF feed reconciliation engine (R20-C, Worker 1).
 *
 * PURE policy: given the persisted feed records of one import scope and a
 * fresh authorized capture, decide — per import key — what the next sync
 * must do. The same canonicalization-discipline role the graph's dedupe
 * module (graph/dedupe.ts) plays for item identity: decisions are total,
 * deterministic, and lead-visible; the PERSISTENCE adapter applies them and
 * the composition layer owns I/O.
 *
 * Laws (docs/architecture/byof-architecture.md + the R20 truth laws):
 *
 * - IDEMPOTENCE: the diff is keyed by the deterministic import key
 *   (feeds/model.ts `feedImportKey`). A re-import of an unchanged capture
 *   produces `keep` for every item — zero adds, zero updates, zero removals.
 * - SOURCE TRUTH vs SURVIVAL: an item the source no longer lists is
 *   `remove`d (the RELATIONSHIP is gone — e.g. the user unliked the video
 *   at the source). This deletes ONLY the imported feed record. A FAILING
 *   source (auth/transport) never reaches this engine — it folds to
 *   `stale`/`reauthorization-required` in the sync state machine and the
 *   records SURVIVE (the source-disconnection survival law).
 * - WEBFLIX-LOCAL PRESERVATION: the engine has no write surface at all, and
 *   its decisions address feed records exclusively — library entries, watch
 *   history, intents, and recommendation policy are structurally out of
 *   scope (the report's `preservedLocalActions` is the pinned invariant).
 * - ORDERING TRUTH: `sourceOrder` changes are `update`s carrying the
 *   source's NATIVE order — data with provenance, never a WebFlix rank.
 * - SNAPSHOT TRUTH: a capture is consumed as a snapshot; nothing here
 *   labels data `live` (that state is granted by the sync state machine
 *   only to a successfully continuously-synced route).
 *
 * Determinism: no clock, no ids, no store — the report's `appliedAt` is
 * supplied by the caller (the store stamps it when it applies the plan).
 */

import type {
  ConnectorFeedItem,
  ConnectorFeedSnapshot,
  FeedImportMethod,
  FeedReconciliationItem,
  FeedReconciliationReport,
  FeedRelationship,
} from "../contracts/frozen";
import { feedImportKey, feedRecordKeyInput } from "./model";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One persisted feed record as the engine consumes it: the frozen
 * `FeedRecord` fields the diff needs plus the store's `externalRef` column
 * (the frozen record identifies the CANONICAL item; the import key needs
 * the SOURCE's external identity — the persistence row carries both).
 */
export interface ReconcileFeedRecordInput {
  readonly profileId: string;
  readonly externalRef: string;
  readonly provenance: {
    readonly connectorId: string;
    readonly relationship: FeedRelationship;
    readonly sourceRef?: string | undefined;
    readonly sourceOrder: number;
    readonly capturedAt: string;
  };
  readonly sourceUpdatedAt?: string | undefined;
  readonly title?: string | undefined;
}

/** The import scope the diff runs over (connector + optional container/relationship filter). */
export interface ReconcileScope {
  readonly profileId: string;
  readonly connectorId: string;
  /** Restrict the diff to these relationship kinds (undefined = all the snapshot carries). */
  readonly relationships?: readonly FeedRelationship[];
  /** Restrict the diff to one container (undefined = every container). */
  readonly sourceRef?: string;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** One add/update decision's payload: the materialization input the store applies. */
export interface FeedRecordUpsertPlan {
  readonly key: string;
  readonly item: ConnectorFeedItem;
}

/** The reconciliation plan: decisions + materialization payloads + honest counts. */
export interface FeedReconciliationPlan {
  readonly scope: ReconcileScope;
  readonly capturedAt: string;
  readonly decisions: readonly FeedReconciliationItem[];
  /** Materialization payloads for `add`/`update` decisions, in source-native order. */
  readonly upserts: readonly FeedRecordUpsertPlan[];
  readonly counts: {
    readonly added: number;
    readonly updated: number;
    readonly removed: number;
    readonly kept: number;
    readonly deduplicated: number;
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Whether a persisted record is inside the diff scope. */
function inScope(record: ReconcileFeedRecordInput, scope: ReconcileScope): boolean {
  if (record.provenance.connectorId !== scope.connectorId) return false;
  if (record.profileId !== scope.profileId) return false;
  if (scope.relationships !== undefined && !scope.relationships.includes(record.provenance.relationship)) {
    return false;
  }
  if (scope.sourceRef !== undefined && record.provenance.sourceRef !== scope.sourceRef) {
    return false;
  }
  return true;
}

/** Whether a captured item is inside the diff scope. */
function itemInScope(
  item: ConnectorFeedItem,
  scope: ReconcileScope,
): boolean {
  if (scope.relationships !== undefined && !scope.relationships.includes(item.relationship)) {
    return false;
  }
  if (scope.sourceRef !== undefined && item.sourceRef !== scope.sourceRef) {
    return false;
  }
  return true;
}

/**
 * Diff one authorized capture against the persisted records of its scope.
 *
 * Decision table (per deterministic import key):
 *
 * | source has | store has | when                             | decision |
 * |------------|-----------|----------------------------------|----------|
 * | yes        | no        | —                                | add      |
 * | yes        | yes       | sourceUpdatedAt/title changed    | update (source-changed) |
 * | yes        | yes       | sourceOrder changed              | update (order-changed) |
 * | yes        | yes       | nothing changed                  | keep     |
 * | no         | yes       | —                                | remove (source-removed) |
 *
 * Intra-capture duplicates (the same import key twice in ONE capture — e.g.
 * a video at two positions of the same playlist) collapse to the first
 * occurrence in source-native order; later occurrences count as
 * `deduplicated` (the feed record models the RELATIONSHIP, and the frozen
 * `FeedRecord.provenance.sourceOrder` is a single number — the contract
 * itself decides the collapse; documented + test-pinned).
 *
 * Items OUTSIDE the scope are ignored: a capture of playlist P never
 * removes records that belong to playlist Q or to the follow graph — a
 * scoped sync is only ever scoped truth.
 */
export function reconcileFeedSnapshot(
  existing: readonly ReconcileFeedRecordInput[],
  snapshot: ConnectorFeedSnapshot,
  scope: ReconcileScope,
): FeedReconciliationPlan {
  const decisions: FeedReconciliationItem[] = [];
  const upserts: FeedRecordUpsertPlan[] = [];
  const seen = new Set<string>();
  const existingByKey = new Map<string, ReconcileFeedRecordInput>();
  for (const record of existing) {
    if (!inScope(record, scope)) continue;
    existingByKey.set(feedImportKey(feedRecordKeyInput(record)), record);
  }

  let deduplicated = 0;
  for (const item of snapshot.items) {
    if (snapshot.connectorId !== scope.connectorId) break; // foreign capture: nothing is in scope
    if (!itemInScope(item, scope)) continue;
    const key = feedImportKey({
      profileId: scope.profileId,
      connectorId: snapshot.connectorId,
      relationship: item.relationship,
      sourceRef: item.sourceRef,
      externalRef: item.externalRef,
    });
    if (seen.has(key)) {
      // Intra-capture duplicate: the relationship is already addressed by
      // an earlier (source-native earlier) item in THIS capture.
      deduplicated += 1;
      continue;
    }
    seen.add(key);
    const prior = existingByKey.get(key);
    if (prior === undefined) {
      decisions.push({
        key,
        externalRef: item.externalRef,
        relationship: item.relationship,
        ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
        action: "add",
        reason: "new-item",
      });
      upserts.push({ key, item });
      continue;
    }
    existingByKey.delete(key);
    // Symmetric difference: a newly-reported (or newly-absent) source
    // timestamp/title is a knowledge change — the record's provenance
    // refreshes. Both absent = unchanged.
    const sourceChanged = (item.sourceUpdatedAt ?? undefined) !== (prior.sourceUpdatedAt ?? undefined);
    const titleChanged = (item.title ?? undefined) !== (prior.title ?? undefined);
    if (sourceChanged || titleChanged) {
      decisions.push({
        key,
        externalRef: item.externalRef,
        relationship: item.relationship,
        ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
        action: "update",
        reason: "source-changed",
      });
      upserts.push({ key, item });
      continue;
    }
    if (item.sourceOrder !== prior.provenance.sourceOrder) {
      decisions.push({
        key,
        externalRef: item.externalRef,
        relationship: item.relationship,
        ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
        action: "update",
        reason: "order-changed",
      });
      upserts.push({ key, item });
      continue;
    }
    decisions.push({
      key,
      externalRef: item.externalRef,
      relationship: item.relationship,
      ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
      action: "keep",
      reason: "unchanged",
    });
  }

  // Everything still in existingByKey was NOT in the capture: the source
  // reports the relationship as gone. Removal deletes the FEED RECORD only.
  for (const [key, prior] of existingByKey) {
    decisions.push({
      key,
      externalRef: prior.externalRef,
      relationship: prior.provenance.relationship,
      ...(prior.provenance.sourceRef !== undefined
        ? { sourceRef: prior.provenance.sourceRef }
        : {}),
      action: "remove",
      reason: "source-removed",
    });
  }

  const count = (action: FeedReconciliationItem["action"]): number =>
    decisions.filter((decision) => decision.action === action).length;

  return {
    scope,
    capturedAt: snapshot.capturedAt,
    decisions,
    upserts,
    counts: {
      added: count("add"),
      updated: count("update"),
      removed: count("remove"),
      kept: count("keep"),
      deduplicated,
    },
  };
}

// ---------------------------------------------------------------------------
// Report assembly (the store/applier folds a plan into the frozen report)
// ---------------------------------------------------------------------------

/**
 * Fold an applied plan into the frozen `FeedReconciliationReport`.
 * `appliedAt` is supplied by the applier (the store's clock stamp);
 * `preservedLocalActions` is pinned `true` — reconciliation has no write
 * surface beyond feed records/imports, so the law holds by construction and
 * the persistence tests pin it against the actual tables.
 */
export function feedReconciliationReport(
  plan: FeedReconciliationPlan,
  input: {
    importId: string;
    appliedAt: string;
    method: FeedImportMethod;
  },
): FeedReconciliationReport {
  return {
    importId: input.importId,
    connectorId: plan.scope.connectorId,
    method: input.method,
    capturedAt: plan.capturedAt,
    appliedAt: input.appliedAt,
    added: plan.counts.added,
    updated: plan.counts.updated,
    removed: plan.counts.removed,
    kept: plan.counts.kept,
    deduplicated: plan.counts.deduplicated,
    preservedLocalActions: true,
    items: plan.decisions,
  };
}
