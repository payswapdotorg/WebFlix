/**
 * @wfx/app-desktop — the deterministic FeedPort double for the Desktop
 * BYOF surface tests (R20-F/R20-G). ⚠️ TESTS ONLY ⚠️
 *
 * An in-memory implementation of the FROZEN `FeedPort` contract
 * (contracts.md "Bring Your Own Feed") whose SEMANTICS are the real
 * shared ones — the deterministic import key, the closed vocabularies,
 * the mode truth, and the reconciliation diff all come from the REAL
 * `@wfx/domain` engine (the same law the server-side store enforces
 * with SQL). Only the ARTIFACT PARSING (JSON test-export format) is the
 * double's own — in production that is the connector feed lane (R20-B,
 * Worker 1), and the parity tests (feed-parity.test.ts) bind the REAL
 * `@wfx/persistence` store instead of this double.
 *
 * The test export format:
 * ```json
 * {
 *   "continuousSync": true,
 *   "sourceRef": "PL_test",
 *   "items": [
 *     { "externalRef": "vid1", "relationship": "playlist",
 *       "sourceOrder": 0, "title": "First" }
 *   ]
 * }
 * ```
 */

import type {
  ConnectorFeedItem,
  FeedImport,
  FeedImportMethod,
  FeedImportPreview,
  FeedPort,
  FeedRecord,
  FeedRelationship,
  FeedSyncState,
} from "@wfx/domain";
import {
  feedImportKey,
  reconcileFeedSnapshot,
  validateConnectorFeedItem,
  type ReconcileFeedRecordInput,
} from "@wfx/domain";

/** The test export file's parsed shape. */
export interface TestFeedExport {
  readonly continuousSync: boolean;
  readonly sourceRef?: string;
  readonly items: readonly {
    externalRef: string;
    relationship: FeedRelationship;
    sourceOrder: number;
    title?: string;
    sourceUpdatedAt?: string;
  }[];
}

/** Parse + validate the artifact bytes as the test export format. */
export function parseTestExport(artifact: Uint8Array): TestFeedExport {
  const text = new TextDecoder().decode(artifact);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed.continuousSync !== "boolean") {
    throw new Error("test export: continuousSync must be a boolean");
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error("test export: items must be an array");
  }
  const items = parsed.items.map((item, index) => {
    const result = validateConnectorFeedItem(item);
    if (!result.ok) {
      throw new Error(`test export item ${index}: ${result.errors.join("; ")}`);
    }
    return item as TestFeedExport["items"][number];
  });
  return {
    continuousSync: parsed.continuousSync,
    ...(typeof parsed.sourceRef === "string" ? { sourceRef: parsed.sourceRef } : {}),
    items,
  };
}

/** One import the double tracks (its staged capture + its confirmed state). */
interface TrackedImport {
  readonly id: string;
  readonly connectorId: string;
  readonly method: FeedImportMethod;
  readonly continuousSync: boolean;
  readonly sourceRef?: string;
  readonly capturedAt: string;
  status: FeedImport["status"];
  syncState: FeedSyncState;
  items: readonly ConnectorFeedItem[];
  error?: string;
}

/**
 * The double's record row: the frozen `FeedRecord` plus the store-style
 * external-identity columns (the same shape `PersistedFeedRecord` answers —
 * extra fields are the established forward-compatibility pattern).
 */
interface DoubleRecord extends FeedRecord {
  readonly importKey: string;
  readonly externalRef: string;
}

/** Options for {@link createFeedPortDouble}. */
export interface FeedPortDoubleOptions {
  /** The profile the double serves (the server-side session's profile). */
  readonly profileId: string;
  /** The user id the double serves. */
  readonly userId: string;
  /** The deterministic clock ("now" in ISO — the double's stamps). */
  readonly now: () => string;
  /** The deterministic id source (record/import ids). */
  readonly nextId: () => string;
}

/**
 * The deterministic FeedPort double. `nextSyncCapture` scripts what the
 * NEXT `syncImport` sees (the "fresh capture" the connector lane would
 * return); `nextSyncFailure` scripts the honest failure class.
 */
export function createFeedPortDouble(options: FeedPortDoubleOptions) {
  const imports = new Map<string, TrackedImport>();
  const records = new Map<string, DoubleRecord>();
  let importCounter = 0;

  /** Scripted fresh capture for the next sync (default: the import's own items). */
  let scriptedCapture: TestFeedExport | null = null;
  /** Scripted sync failure: 'authorization' | 'transport' | undefined. */
  let scriptedFailure: "authorization" | "transport" | undefined;

  /** The records as the reconcile engine consumes them. */
  function reconcileInputs(): ReconcileFeedRecordInput[] {
    return [...records.values()].map((record) => ({
      profileId: record.profileId,
      externalRef: record.externalRef,
      provenance: {
        connectorId: record.provenance.connectorId,
        relationship: record.provenance.relationship,
        sourceRef: record.provenance.sourceRef,
        sourceOrder: record.provenance.sourceOrder,
        capturedAt: record.provenance.capturedAt,
      },
    }));
  }

  const double: FeedPort = {
    async previewImport(input): Promise<FeedImportPreview> {
      if (input.artifact === undefined) {
        throw new Error("the double requires an artifact (the file import path always carries one)");
      }
      const export_ = parseTestExport(input.artifact);
      const connectorId = input.connectorId;
      const method = input.method ?? "user-file";
      const capturedAt = options.now();
      importCounter += 1;
      const importId = `wfximp_double_${importCounter}`;
      const tracked: TrackedImport = {
        id: importId,
        connectorId,
        method,
        continuousSync: export_.continuousSync,
        ...(export_.sourceRef !== undefined ? { sourceRef: export_.sourceRef } : {}),
        capturedAt,
        status: "preview",
        syncState: "snapshot",
        items: export_.items,
      };
      imports.set(importId, tracked);

      // The preview's sample records (the shape the port contract answers).
      const relationshipCounts: Record<string, number> = {};
      const sample: FeedRecord[] = [];
      export_.items.forEach((item, index) => {
        relationshipCounts[item.relationship] = (relationshipCounts[item.relationship] ?? 0) + 1;
        if (index < 5) {
          sample.push({
            id: `wfxfeed_double_${importCounter}_${index}`,
            userId: options.userId,
            profileId: options.profileId,
            entertainmentItemId: `wfxitm_double_${item.externalRef}`,
            provenance: {
              connectorId,
              importMethod: method,
              ...(export_.sourceRef !== undefined ? { sourceRef: export_.sourceRef } : {}),
              capturedAt,
              syncState: "snapshot",
              sourceOrder: item.sourceOrder,
              relationship: item.relationship,
            },
            importedAt: capturedAt,
          });
        }
      });
      return {
        importId,
        connectorId,
        method,
        itemCount: export_.items.length,
        relationshipCounts,
        freshness: "snapshot",
        sample,
      };
    },

    async confirmImport(importId: string): Promise<FeedImport> {
      const tracked = imports.get(importId);
      if (tracked === undefined) {
        throw new Error(`confirmImport: unknown import '${importId}'`);
      }
      tracked.status = "complete";
      // The IDEMPOTENT upsert (the import-key law — the REAL domain key).
      for (const item of tracked.items) {
        const key = feedImportKey({
          profileId: options.profileId,
          connectorId: tracked.connectorId,
          relationship: item.relationship,
          ...(tracked.sourceRef !== undefined ? { sourceRef: tracked.sourceRef } : {}),
          externalRef: item.externalRef,
        });
        const existing = records.get(key);
        const record: DoubleRecord = {
          id: existing?.id ?? `wfxfeed_double_${options.nextId()}`,
          userId: options.userId,
          profileId: options.profileId,
          entertainmentItemId: `wfxitm_double_${item.externalRef}`,
          importKey: key,
          externalRef: item.externalRef,
          provenance: {
            connectorId: tracked.connectorId,
            importMethod: tracked.method,
            ...(tracked.sourceRef !== undefined ? { sourceRef: tracked.sourceRef } : {}),
            capturedAt: tracked.capturedAt,
            syncState: tracked.continuousSync ? "live" : "snapshot",
            sourceOrder: item.sourceOrder,
            relationship: item.relationship,
          },
          importedAt: existing?.importedAt ?? options.now(),
          ...(item.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: item.sourceUpdatedAt }
            : {}),
        };
        records.set(key, record);
      }
      tracked.syncState = tracked.continuousSync ? "live" : "snapshot";
      return {
        id: tracked.id,
        connectorId: tracked.connectorId,
        method: tracked.method,
        status: tracked.status,
        startedAt: tracked.capturedAt,
        completedAt: options.now(),
      };
    },

    async readFeed(input): Promise<FeedRecord[]> {
      if (input.profileId !== options.profileId) return [];
      if (input.mode === "webflix") return []; // the mode-truth law
      const filtered: FeedRecord[] = [...records.values()].filter((record) => {
        if (input.mode === "following") {
          return record.provenance.relationship === "follow" || record.provenance.relationship === "subscription";
        }
        return true;
      });
      // The source-native order: per container, then sourceOrder.
      filtered.sort((a, b) => {
        const refA = a.provenance.sourceRef ?? "";
        const refB = b.provenance.sourceRef ?? "";
        if (refA !== refB) return refA < refB ? -1 : 1;
        if (a.provenance.relationship !== b.provenance.relationship) {
          return a.provenance.relationship < b.provenance.relationship ? -1 : 1;
        }
        return a.provenance.sourceOrder - b.provenance.sourceOrder;
      });
      return filtered;
    },

    async syncImport(importId: string): Promise<FeedImport> {
      const tracked = imports.get(importId);
      if (tracked === undefined) {
        throw new Error(`syncImport: unknown import '${importId}'`);
      }
      if (scriptedFailure === "authorization") {
        tracked.status = "reauthorization-required";
        tracked.error = "the source rejected the authorization";
        tracked.syncState = "reauthorization-required";
        return {
          id: tracked.id,
          connectorId: tracked.connectorId,
          method: tracked.method,
          status: "reauthorization-required",
          startedAt: tracked.capturedAt,
          error: tracked.error,
        };
      }
      if (scriptedFailure === "transport") {
        throw new Error("the transport to the source failed (scripted)");
      }

      // The REAL reconciliation engine: diff the fresh capture against the
      // records of this import's scope, then apply the plan.
      const capture = scriptedCapture ?? {
        continuousSync: tracked.continuousSync,
        sourceRef: tracked.sourceRef,
        items: tracked.items,
      };
      const snapshot = {
        connectorId: tracked.connectorId,
        method: tracked.method,
        capturedAt: options.now(),
        continuousSync: tracked.continuousSync,
        orderSemantics: "source-native" as const,
        ...(tracked.sourceRef !== undefined ? { sourceRef: tracked.sourceRef } : {}),
        syncState: "snapshot" as FeedSyncState,
        items: capture.items.map((item) => ({
          externalRef: item.externalRef,
          relationship: item.relationship,
          sourceOrder: item.sourceOrder,
          ...(item.title !== undefined ? { title: item.title } : {}),
          ...(item.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: item.sourceUpdatedAt }
            : {}),
        })),
      };
      const scope = {
        profileId: options.profileId,
        connectorId: tracked.connectorId,
        ...(tracked.sourceRef !== undefined ? { sourceRef: tracked.sourceRef } : {}),
      };
      const plan = reconcileFeedSnapshot(
        reconcileInputs().filter((record) =>
          record.provenance.connectorId === tracked.connectorId &&
          (scope.sourceRef === undefined || record.provenance.sourceRef === scope.sourceRef),
        ),
        snapshot,
        scope,
      );
      for (const upsert of plan.upserts) {
        const key = upsert.key;
        const existing = records.get(key);
        records.set(key, {
          id: existing?.id ?? `wfxfeed_double_${options.nextId()}`,
          userId: options.userId,
          profileId: options.profileId,
          entertainmentItemId: `wfxitm_double_${upsert.item.externalRef}`,
          importKey: key,
          externalRef: upsert.item.externalRef,
          provenance: {
            connectorId: tracked.connectorId,
            importMethod: tracked.method,
            ...(tracked.sourceRef !== undefined ? { sourceRef: tracked.sourceRef } : {}),
            capturedAt: snapshot.capturedAt,
            syncState: tracked.continuousSync ? "live" : "snapshot",
            sourceOrder: upsert.item.sourceOrder,
            relationship: upsert.item.relationship,
          },
          importedAt: existing?.importedAt ?? options.now(),
          ...(upsert.item.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: upsert.item.sourceUpdatedAt }
            : {}),
        });
      }
      for (const decision of plan.decisions) {
        if (decision.action === "remove") records.delete(decision.key);
      }
      scriptedCapture = null; // a capture is consumed once (deterministic)
      tracked.status = "complete";
      tracked.syncState = tracked.continuousSync ? "live" : "snapshot";
      return {
        id: tracked.id,
        connectorId: tracked.connectorId,
        method: tracked.method,
        status: "complete",
        startedAt: tracked.capturedAt,
        completedAt: options.now(),
      };
    },
  };

  return {
    port: double,
    /** Script the NEXT sync's fresh capture (null = the import's own items). */
    scriptNextSyncCapture(capture: TestFeedExport | null): void {
      scriptedCapture = capture;
    },
    /** Script the NEXT sync's honest failure class. */
    scriptNextSyncFailure(failure: "authorization" | "transport" | undefined): void {
      scriptedFailure = failure;
    },
    /** The records map (assertion surface; keyed by the REAL import key). */
    recordCount(): number {
      return records.size;
    },
    /** One record by its import key (assertion surface). */
    recordByKey(key: string): FeedRecord | undefined {
      return records.get(key);
    },
    /** Every record, readFeed-ordered (assertion surface; carries the external-identity columns). */
    async allRecords(): Promise<readonly DoubleRecord[]> {
      return double.readFeed({ profileId: options.profileId, mode: "byof" }) as Promise<DoubleRecord[]>;
    },
  };
}

/** Build a deterministic export artifact (bytes) from items. */
export function testExportArtifact(input: {
  continuousSync: boolean;
  sourceRef?: string;
  items: readonly {
    externalRef: string;
    relationship: FeedRelationship;
    sourceOrder: number;
    title?: string;
    sourceUpdatedAt?: string;
  }[];
}): Uint8Array {
  const payload: Record<string, unknown> = {
    continuousSync: input.continuousSync,
    items: input.items,
  };
  if (input.sourceRef !== undefined) payload.sourceRef = input.sourceRef;
  return new TextEncoder().encode(JSON.stringify(payload));
}
