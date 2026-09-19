/**
 * @wfx/domain — BYOF feed contracts: constants, guards, and the idempotent
 * import key derivation (R20-A, Worker 1 shared feed/import lane).
 *
 * The TYPES are frozen in `contracts/frozen.ts` (generated from
 * docs/architecture/contracts.md — the "Bring Your Own Feed" section). This
 * module is the RUNTIME half of those contracts: the closed vocabularies as
 * constants, membership guards for untrusted input, and the deterministic
 * import-key derivation that makes re-imports idempotent.
 *
 * Laws encoded here (docs/architecture/byof-architecture.md):
 *
 * - The import-key law: one imported feed relationship is identified by
 *   (profile, source connector, relationship kind, container ref, external
 *   item ref). Re-importing the same relationship addresses the SAME record.
 *   The derivation is a pure JSON tuple — deterministic, order-stable, and
 *   collision-safe for all string inputs (JSON escaping handles separators).
 * - The ordering law: `sourceOrder` is SOURCE-NATIVE order metadata with
 *   provenance. Nothing in this module ever ranks, scores, or reorders items
 *   as WebFlix recommendations; ordering is carried as data.
 * - The snapshot law: a capture is a snapshot; the freshness/sync vocabulary
 *   is closed and honest (`live` is a state the sync state machine grants a
 *   continuously-synced route, not a label a capture self-assigns).
 *
 * Pure functions only — no I/O, no clock, no store (repo determinism law).
 */

import type {
  FeedImportKeyInput,
  FeedImportMethod,
  FeedRelationship,
  FeedSyncState,
} from "../contracts/frozen";
import { isIso8601, isRecord, previewValue } from "../validation";

// ---------------------------------------------------------------------------
// Closed vocabularies (runtime truth of the frozen unions)
// ---------------------------------------------------------------------------

/** Every valid `FeedImportMethod` (frozen union order). */
export const FEED_IMPORT_METHODS: readonly FeedImportMethod[] = [
  "api",
  "official-export",
  "user-file",
  "snapshot",
] as const;

/** Every valid `FeedSyncState` (frozen union order). */
export const FEED_SYNC_STATES: readonly FeedSyncState[] = [
  "live",
  "syncing",
  "snapshot",
  "stale",
  "reauthorization-required",
  "unsupported",
  "degraded",
] as const;

/** Every valid `FeedRelationship` (frozen union order). */
export const FEED_RELATIONSHIPS: readonly FeedRelationship[] = [
  "follow",
  "subscription",
  "playlist",
  "watchlist",
  "like",
  "save",
  "ranked-feed",
  "history",
  "unknown",
] as const;

// Compile-time: the constant tables cover the frozen unions exactly.
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? [Values[number]] extends [Union]
    ? true
    : { error: "constant table has members outside the frozen union" }
  : { error: "constant table misses members of the frozen union" };
const _methodsCover: Covers<FeedImportMethod, typeof FEED_IMPORT_METHODS> = true;
const _syncStatesCover: Covers<FeedSyncState, typeof FEED_SYNC_STATES> = true;
const _relationshipsCover: Covers<FeedRelationship, typeof FEED_RELATIONSHIPS> = true;

/** Membership guard for the frozen `FeedImportMethod` union. */
export function isFeedImportMethod(x: unknown): x is FeedImportMethod {
  return typeof x === "string" && (FEED_IMPORT_METHODS as readonly string[]).includes(x);
}

/** Membership guard for the frozen `FeedSyncState` union. */
export function isFeedSyncState(x: unknown): x is FeedSyncState {
  return typeof x === "string" && (FEED_SYNC_STATES as readonly string[]).includes(x);
}

/** Membership guard for the frozen `FeedRelationship` union. */
export function isFeedRelationship(x: unknown): x is FeedRelationship {
  return typeof x === "string" && (FEED_RELATIONSHIPS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// The idempotent import key
// ---------------------------------------------------------------------------

/**
 * The relationship kinds that address the user's follow graph (the
 * "Following / Native" feed-mode subset of imported records).
 */
export const FOLLOWING_RELATIONSHIPS: readonly FeedRelationship[] = [
  "follow",
  "subscription",
] as const;

/**
 * The `feedImportKey` input with `sourceRef` widened for
 * `exactOptionalPropertyTypes` callers (reading an optional property off a
 * record yields `string | undefined`; the frozen type's `?: string` without
 * `undefined` would reject it at every call site).
 */
export type FeedImportKeyLike = Omit<FeedImportKeyInput, "sourceRef"> & {
  sourceRef?: string | undefined;
};

/**
 * Derive the deterministic import key of one feed relationship.
 *
 * The key is the JSON tuple `[profileId, connectorId, relationship,
 * sourceRef ?? "", externalRef]` — a stable, collision-safe string identity
 * for the RELATIONSHIP (not the item): the same (profile, source, container,
 * external item) always maps to the same key, so re-imports address the same
 * record (the idempotent import law). The empty string is the canonical
 * "no container" component (the SQL key column is NOT NULL; follows address
 * the user's subscription graph itself and carry no container).
 */
export function feedImportKey(input: FeedImportKeyLike): string {
  return JSON.stringify([
    input.profileId,
    input.connectorId,
    input.relationship,
    input.sourceRef ?? "",
    input.externalRef,
  ]);
}

/**
 * The key components of an existing (persisted) feed record — the frozen
 * `FeedRecord` plus the store's `externalRef` column — round-trips
 * `feedImportKey`. The provenance subset is structural: the reconciliation
 * engine's narrower inputs satisfy it.
 */
export function feedRecordKeyInput(record: {
  profileId: string;
  externalRef: string;
  provenance: {
    connectorId: string;
    relationship: FeedRelationship;
    sourceRef?: string | undefined;
  };
}): FeedImportKeyInput {
  return {
    profileId: record.profileId,
    connectorId: record.provenance.connectorId,
    relationship: record.provenance.relationship,
    ...(record.provenance.sourceRef !== undefined
      ? { sourceRef: record.provenance.sourceRef }
      : {}),
    externalRef: record.externalRef,
  };
}

// ---------------------------------------------------------------------------
// Sync-state truth helpers
// ---------------------------------------------------------------------------

/** Why a sync attempt failed (the closed failure taxonomy of the fold below). */
export type FeedSyncFailureKind = "authorization" | "transport" | "provider" | "unsupported";

/**
 * The next feed sync state after a sync attempt — the honest state-machine
 * fold (pure; the store applies it):
 *
 * - success + `continuousSync` → `live` (the route is being kept current);
 * - success + one-time route → `snapshot` (a fresh capture, nothing more);
 * - authorization failure → `reauthorization-required` (records are RETAINED
 *   — only the user's grant is missing; never a deletion);
 * - transport/provider failure with prior records → `stale` (the capture
 *   ages; records are NEVER erased by a failing source — the survival law);
 * - transport/provider failure with no records yet → `degraded` (an import
 *   with nothing honest to show);
 * - route not actually supported → `unsupported`.
 */
export function nextSyncStateAfterSync(
  outcome:
    | { ok: true; continuousSync: boolean }
    | { ok: false; failure: FeedSyncFailureKind; hasRecords: boolean },
): FeedSyncState {
  if (outcome.ok) {
    return outcome.continuousSync ? "live" : "snapshot";
  }
  switch (outcome.failure) {
    case "authorization":
      return "reauthorization-required";
    case "unsupported":
      return "unsupported";
    case "transport":
    case "provider":
      return outcome.hasRecords ? "stale" : "degraded";
  }
}

// ---------------------------------------------------------------------------
// Runtime validators (untrusted input; the persistence adapters call these)
// ---------------------------------------------------------------------------

/**
 * Validation failure: `ok:false` carries human-readable problems. Mirrors
 * the validation.ts convention so adapters report the same shape. Never
 * throws on untrusted input; extra unknown fields are accepted (structural
 * typing, forward compatibility — the repo-wide validator law).
 */
export interface FeedValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/** Validate a frozen `FeedProvenance` (identity, order, freshness laws). */
export function validateFeedProvenance(value: unknown): FeedValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["provenance: expected an object"] };
  }
  if (!isNonEmptyString(value.connectorId)) {
    errors.push("provenance.connectorId: expected a non-empty string");
  }
  if (!isFeedImportMethod(value.importMethod)) {
    errors.push(
      `provenance.importMethod: expected one of ${FEED_IMPORT_METHODS.join(" | ")}, got ${previewValue(value.importMethod)}`,
    );
  }
  if (value.sourceRef !== undefined && !isNonEmptyString(value.sourceRef)) {
    errors.push("provenance.sourceRef: expected a non-empty string when present");
  }
  if (!isIso8601(value.capturedAt)) {
    errors.push("provenance.capturedAt: expected a full ISO 8601 timestamp");
  }
  if (!isFeedSyncState(value.syncState)) {
    errors.push(
      `provenance.syncState: expected one of ${FEED_SYNC_STATES.join(" | ")}, got ${previewValue(value.syncState)}`,
    );
  }
  if (
    typeof value.sourceOrder !== "number" ||
    !Number.isInteger(value.sourceOrder) ||
    value.sourceOrder < 0
  ) {
    errors.push("provenance.sourceOrder: expected a non-negative integer");
  }
  if (!isFeedRelationship(value.relationship)) {
    errors.push(
      `provenance.relationship: expected one of ${FEED_RELATIONSHIPS.join(" | ")}, got ${previewValue(value.relationship)}`,
    );
  }
  return { ok: errors.length === 0, errors };
}

/** Validate a persisted feed record row (the `FeedRecord` shape plus the store's `externalRef`/`title` columns). */
export function validateFeedRecord(value: unknown): FeedValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["record: expected an object"] };
  }
  if (!isNonEmptyString(value.id)) {
    errors.push("record.id: expected a non-empty string");
  }
  if (!isNonEmptyString(value.userId)) {
    errors.push("record.userId: expected a non-empty string");
  }
  if (!isNonEmptyString(value.profileId)) {
    errors.push("record.profileId: expected a non-empty string");
  }
  if (!isNonEmptyString(value.entertainmentItemId)) {
    errors.push("record.entertainmentItemId: expected a non-empty string");
  }
  if (!isNonEmptyString(value.externalRef)) {
    errors.push("record.externalRef: expected a non-empty string");
  }
  if (!isIso8601(value.importedAt)) {
    errors.push("record.importedAt: expected a full ISO 8601 timestamp");
  }
  if (value.sourceUpdatedAt !== undefined && !isIso8601(value.sourceUpdatedAt)) {
    errors.push("record.sourceUpdatedAt: expected a full ISO 8601 timestamp when present");
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    errors.push("record.title: expected a string when present");
  }
  const provenance = validateFeedProvenance(value.provenance);
  if (!provenance.ok) {
    errors.push(...provenance.errors.map((e) => `record.${e}`));
  }
  return { ok: errors.length === 0, errors };
}

/** Validate a `ConnectorFeedItem` (the connector-supplied capture row). */
export function validateConnectorFeedItem(value: unknown): FeedValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["item: expected an object"] };
  }
  if (!isNonEmptyString(value.externalRef)) {
    errors.push("item.externalRef: expected a non-empty string");
  }
  if (!isFeedRelationship(value.relationship)) {
    errors.push(
      `item.relationship: expected one of ${FEED_RELATIONSHIPS.join(" | ")}, got ${previewValue(value.relationship)}`,
    );
  }
  if (
    typeof value.sourceOrder !== "number" ||
    !Number.isInteger(value.sourceOrder) ||
    value.sourceOrder < 0
  ) {
    errors.push("item.sourceOrder: expected a non-negative integer");
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    errors.push("item.title: expected a string when present");
  }
  if (value.sourceUpdatedAt !== undefined && !isIso8601(value.sourceUpdatedAt)) {
    errors.push("item.sourceUpdatedAt: expected a full ISO 8601 timestamp when present");
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    errors.push("item.metadata: expected an object when present");
  }
  return { ok: errors.length === 0, errors };
}

/** Validate a `ConnectorFeedSnapshot` (the whole authorized capture). */
export function validateConnectorFeedSnapshot(value: unknown): FeedValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["snapshot: expected an object"] };
  }
  if (!isNonEmptyString(value.connectorId)) {
    errors.push("snapshot.connectorId: expected a non-empty string");
  }
  if (!isFeedImportMethod(value.method)) {
    errors.push(
      `snapshot.method: expected one of ${FEED_IMPORT_METHODS.join(" | ")}, got ${previewValue(value.method)}`,
    );
  }
  if (!isIso8601(value.capturedAt)) {
    errors.push("snapshot.capturedAt: expected a full ISO 8601 timestamp");
  }
  if (typeof value.continuousSync !== "boolean") {
    errors.push("snapshot.continuousSync: expected a boolean");
  }
  if (value.orderSemantics !== "source-native" && value.orderSemantics !== "unknown") {
    errors.push("snapshot.orderSemantics: expected 'source-native' or 'unknown'");
  }
  if (value.sourceRef !== undefined && !isNonEmptyString(value.sourceRef)) {
    errors.push("snapshot.sourceRef: expected a non-empty string when present");
  }
  if (!isFeedSyncState(value.syncState)) {
    errors.push(
      `snapshot.syncState: expected one of ${FEED_SYNC_STATES.join(" | ")}, got ${previewValue(value.syncState)}`,
    );
  }
  if (!Array.isArray(value.items)) {
    errors.push("snapshot.items: expected an array");
    return { ok: false, errors };
  }
  (value.items as unknown[]).forEach((item, index) => {
    const result = validateConnectorFeedItem(item);
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `snapshot.items[${index}].${e}`));
    }
  });
  return { ok: errors.length === 0, errors };
}
