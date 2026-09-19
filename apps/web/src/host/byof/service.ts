/**
 * @wfx/app-web — the BYOF feed-import HOST SERVICE (R20-D, the Web lane).
 *
 * The Web product surface's composition over the SHARED feed capability
 * seam (Worker 1's R20-A/B/C): it CONSUMES the shared domain engine as-is —
 * `validateConnectorFeedSnapshot` (the contract guard), `feedImportKey`
 * (the idempotent import-key law), `reconcileFeedSnapshot` (the R20-C
 * reconciliation engine), `nextSyncStateAfterSync` (the honest sync-state
 * fold), and the frozen `FeedPort` operation vocabulary
 * (preview/confirm/readFeed/sync) — and binds them to the fixtures-mode
 * scripted capture (host/byof/fixture-state.ts). It does NOT re-implement
 * any shared-lane logic and does NOT import `@wfx/persistence` (postgres
 * drivers never enter the web closure — the WFX-050 transport law); the
 * production service transport is the lead's R20-H wiring step and answers
 * the honest `unavailable` failure until then (never a fake import).
 *
 * THE LAWS THIS SERVICE KEEPS (docs/architecture/byof-architecture.md,
 * mirrored one-for-one from the shared lane's semantics):
 *
 * - MODE TRUTH: `readFeed('webflix')` is ALWAYS empty — imported
 *   source-native records are never re-labeled as WebFlix-ranked content.
 *   `following` is the follow-graph subset; `byof`/`hybrid` return the
 *   SOURCE-NATIVE order (the capture's own array order, never re-ranked
 *   here).
 * - PREVIEW → CONFIRM: a capture is STAGED (`stagedItems` — the shared
 *   lane's `feed_preview_items` law); confirm promotes EXACTLY what the
 *   user saw into records by IDEMPOTENT IMPORT KEY (the shared lane's
 *   `upsertRecordRow` law: an existing key's row is updated in place —
 *   no duplicates, no drift; confirm never re-fetches).
 * - SNAPSHOT TRUTH: confirm of a continuously re-readable route lands
 *   `live`; a one-time artifact lands `snapshot` (never presented as
 *   live). A sync of a one-time route is the typed `unsupported` verdict —
 *   re-import through a fresh preview instead of a fake refresh.
 * - CANONICAL RESOLUTION (mirroring the shared lane's order): an EXISTING
 *   record's identity is kept (stable across re-imports and syncs — the
 *   prior deferred marker carries forward, never silently dropped);
 *   follow/subscription targets NEVER claim EntertainmentItem typing (the
 *   WFX-054 law — the anchor is DEFERRED and visibly marked); item
 *   relationships mint the deterministic persisted identity.
 * - HONEST FAILURE FOLDS: an unauthorized capture answers the typed
 *   `unauthorized` failure and lands the import `reauthorization-required`
 *   with its records RETAINED (the survival law); transport/provider
 *   failures fold through `nextSyncStateAfterSync` (stale with records,
 *   degraded without).
 * - DISCONNECT IS NON-DESTRUCTIVE: disconnecting an import stops syncing
 *   and marks the import `disconnected`; the imported records and their
 *   provenance SURVIVE (deletion is the SEPARATE explicit user action —
 *   `deleteImportedRecords`, which touches ONLY feed records).
 * - SEPARATION: this service writes ONLY the BYOF fixture drive state —
 *   the runtime's library, history, intents, and recommendation state are
 *   structurally out of reach (pinned by tests).
 *
 * Error-channel law (the repo convention): caller misuse and verdicts are
 * TYPED RESULTS (`ByofServiceResult` — never a thrown generic error, never
 * a fake success). The failure vocabulary mirrors the shared lane's
 * `FeedServiceFailureKind` plus this host's honest `unavailable` (the
 * service transport is not wired — the R20-H integration step).
 */

import type {
  ConnectorFeedItem,
  FeedImportMethod,
  FeedImportPreview,
  FeedRecord,
  FeedReconciliationReport,
  FeedSyncState,
} from "@wfx/domain";
import {
  FOLLOWING_RELATIONSHIPS,
  feedImportKey,
  feedReconciliationReport,
  isFeedImportMethod,
  nextSyncStateAfterSync,
  reconcileFeedSnapshot,
  validateConnectorFeedSnapshot,
} from "@wfx/domain";

import type {
  ByofFixtureImport,
  ByofFixtureRecord,
  ByofFixtureState,
} from "./fixture-state";
import {
  captureFixtureFeedSnapshot,
  readByofFixtureState,
  writeByofFixtureState,
} from "./fixture-state";

// ---------------------------------------------------------------------------
// The service result envelope (the typed honest error channel)
// ---------------------------------------------------------------------------

/** The closed failure vocabulary of the web BYOF host service. */
export type ByofFailureKind =
  /** The connectorId is not a wired BYOF source in this host. */
  | "unknown-connector"
  /** The route honestly cannot serve the request (a one-time sync, a disconnected import). */
  | "unsupported"
  /** The user's grant is missing/expired — the reauthorization recovery path. */
  | "unauthorized"
  /** The capture failed with the source. */
  | "transport"
  /** The connector returned a value that violates its own contract. */
  | "provider"
  /** Malformed caller input (typed; never a throw). */
  | "invalid-input"
  /** The addressed import is unknown. */
  | "not-found"
  /** The service-mode transport for BYOF is not wired (the lead's R20-H step). */
  | "unavailable";

/** One typed service failure. */
export interface ByofFailure {
  readonly kind: ByofFailureKind;
  readonly detail: string;
  /** The import's id when one was involved. */
  readonly importId?: string;
  /** The import's state after the honest failure fold (when one was involved). */
  readonly syncState?: FeedSyncState;
}

/** The result envelope of every service method. */
export type ByofServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ByofFailure };

// ---------------------------------------------------------------------------
// The BYOF source catalog (this host's wired import sources)
// ---------------------------------------------------------------------------

/** One wired BYOF import source (the capability truth the chooser renders). */
export interface ByofSourceChoice {
  readonly connectorId: string;
  readonly displayName: string;
  /** The import methods this source honestly serves. */
  readonly methods: readonly {
    readonly method: FeedImportMethod;
    /** Plain-language truth of what the method gives (the snapshot/live law). */
    readonly note: string;
    readonly continuousSync: boolean;
  }[];
}

/**
 * The wired BYOF sources. Fixtures mode: the fixture catalog's own source
 * (its authorization truth is the SHARED scripted source-auth lifecycle).
 * Service mode: the same row renders with the honest not-wired note until
 * the R20-H service transport lands (never a fabricated source).
 */
export const BYOF_SOURCES: readonly ByofSourceChoice[] = [
  {
    connectorId: "fake-source",
    displayName: "Fake Source (TEST FIXTURE — never production)",
    methods: [
      {
        method: "api",
        note: "Reads your follows, playlists, and likes through the authorized connection. WebFlix can keep this feed current while the source stays connected.",
        continuousSync: true,
      },
      {
        method: "official-export",
        note: "Imports a one-time official export file from the source. It is a snapshot of that moment — it will never be shown as live, and WebFlix will not silently refresh it.",
        continuousSync: false,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// The public view shapes (what the surfaces render)
// ---------------------------------------------------------------------------

/** The feed modes the surface offers (the frozen product-mode vocabulary). */
export type ByofFeedMode = "webflix" | "following" | "byof" | "hybrid";

/** One import row as the surfaces render it (the summary + freshness truth). */
export interface ByofImportView {
  readonly id: string;
  readonly connectorId: string;
  readonly method: FeedImportMethod;
  readonly status: ByofFixtureImport["status"];
  readonly continuousSync: boolean;
  readonly capturedAt: string;
  readonly confirmedAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly syncState: FeedSyncState;
  readonly error: string | null;
  readonly recordCount: number;
  readonly relationshipCounts: Readonly<Record<string, number>>;
  readonly lastReport?: ByofFixtureImport["lastReport"];
}

/** One imported feed record as the surfaces render it (source-native order). */
export interface ByofRecordView {
  readonly importId: string;
  readonly key: string;
  readonly externalRef: string;
  readonly relationship: string;
  readonly sourceRef: string | null;
  readonly sourceOrder: number;
  readonly title: string | null;
  readonly capturedAt: string;
  readonly sourceUpdatedAt: string | null;
  readonly importedAt: string;
  readonly entertainmentItemId: string;
  readonly deferredResolution: string | null;
  readonly syncState: FeedSyncState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalidInput(detail: string): ByofFailure {
  return { kind: "invalid-input", detail };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** The deterministic import id (stable in the state file). */
function nextImportIdOf(state: ByofFixtureState): string {
  return `wfxfeedimp_${String(state.nextImportId).padStart(12, "0")}`;
}

/** The deterministic canonical id (stable in the state file; decimal digits are Crockford-legal). */
function nextItemIdOf(state: ByofFixtureState): string {
  return `wfxitm_${String(state.nextItemId).padStart(26, "0")}`;
}

/** The dev fixture's identity scope (loudly the fixture drive's own marker). */
const FIXTURE_USER_ID = "wfxdev-fixture-user";
const FIXTURE_PROFILE_ID = "wfxdev-fixture-profile";
const FIXTURE_CONNECTOR_ID = "fake-source";

/**
 * Resolve one captured item's canonical identity (the shared lane's order,
 * mirrored): existing record → keep the identity (the prior deferred marker
 * carries forward); follow/subscription target → DEFERRED anchor (WFX-054);
 * item → the deterministic persisted identity. The staged row carries the
 * CAPTURE INDEX (the source-native order the feed renders).
 */
function resolveCanonicalIdentity(
  item: ConnectorFeedItem,
  captureIndex: number,
  importId: string,
  capturedAt: string,
  existingByKey: ReadonlyMap<string, ByofFixtureRecord>,
  minted: { nextItemId: number },
): ByofFixtureRecord {
  const key = feedImportKey({
    profileId: FIXTURE_PROFILE_ID,
    connectorId: FIXTURE_CONNECTOR_ID,
    relationship: item.relationship,
    ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
    externalRef: item.externalRef,
  });
  const existing = existingByKey.get(key);
  if (existing !== undefined) {
    // The identity is stable; the provenance refreshes to the newest
    // capture. The prior DEFERRED marker survives (visible, never silent).
    return {
      importId,
      key,
      externalRef: item.externalRef,
      relationship: item.relationship,
      ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
      sourceOrder: item.sourceOrder,
      captureIndex,
      capturedAt,
      importedAt: existing.importedAt,
      entertainmentItemId: existing.entertainmentItemId,
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
      ...(existing.deferredResolution !== undefined
        ? { deferredResolution: existing.deferredResolution }
        : {}),
    };
  }
  const isFollowTarget = (FOLLOWING_RELATIONSHIPS as readonly string[]).includes(item.relationship);
  const id = nextItemIdOf({ nextItemId: minted.nextItemId } as ByofFixtureState);
  minted.nextItemId += 1;
  return {
    importId,
    key,
    externalRef: item.externalRef,
    relationship: item.relationship,
    ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
    sourceOrder: item.sourceOrder,
    captureIndex,
    capturedAt,
    importedAt: capturedAt,
    entertainmentItemId: id,
    ...(item.title !== undefined ? { title: item.title } : {}),
    ...(item.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
    ...(isFollowTarget ? { deferredResolution: "deferred-follow" } : {}),
  };
}

/** The relationship counts of one record set (the imported follow/subscription summary). */
function relationshipCountsOf(records: readonly ByofFixtureRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.relationship] = (counts[record.relationship] ?? 0) + 1;
  }
  return counts;
}

/** Project one import row + its records into the view shape. */
function importViewOf(
  row: ByofFixtureImport,
  records: readonly ByofFixtureRecord[],
): ByofImportView {
  return {
    id: row.id,
    connectorId: row.connectorId,
    method: row.method,
    status: row.status,
    continuousSync: row.continuousSync,
    capturedAt: row.capturedAt,
    confirmedAt: row.completedAt ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
    syncState: row.syncState,
    error: row.error ?? null,
    recordCount: records.length,
    relationshipCounts: relationshipCountsOf(records),
    ...(row.lastReport !== undefined ? { lastReport: row.lastReport } : {}),
  };
}

/** Project one record row into the view shape. */
function recordViewOf(record: ByofFixtureRecord, syncState: FeedSyncState): ByofRecordView {
  return {
    importId: record.importId,
    key: record.key,
    externalRef: record.externalRef,
    relationship: record.relationship,
    sourceRef: record.sourceRef ?? null,
    sourceOrder: record.sourceOrder,
    title: record.title ?? null,
    capturedAt: record.capturedAt,
    sourceUpdatedAt: record.sourceUpdatedAt ?? null,
    importedAt: record.importedAt,
    entertainmentItemId: record.entertainmentItemId,
    deferredResolution: record.deferredResolution ?? null,
    syncState,
  };
}

/** The frozen `FeedRecord` projection of one record row (the shared contract shape). */
function frozenRecordOf(record: ByofFixtureRecord, row: ByofFixtureImport): FeedRecord {
  return {
    id: record.key,
    userId: FIXTURE_USER_ID,
    profileId: FIXTURE_PROFILE_ID,
    entertainmentItemId: record.entertainmentItemId,
    provenance: {
      connectorId: row.connectorId,
      importMethod: row.method,
      ...(record.sourceRef !== undefined ? { sourceRef: record.sourceRef } : {}),
      capturedAt: record.capturedAt,
      syncState: row.syncState,
      sourceOrder: record.sourceOrder,
      relationship: record.relationship,
    },
    importedAt: record.importedAt,
    ...(record.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: record.sourceUpdatedAt } : {}),
  };
}

/**
 * The shared lane's served record order (`source_ref ASC NULLS FIRST,
 * relationship ASC, source_order ASC, imported_at ASC`) — the SOURCE-NATIVE
 * order the feed renders, never re-ranked here.
 */
function recordOrdering(a: ByofFixtureRecord, b: ByofFixtureRecord): number {
  const aRef = a.sourceRef ?? "";
  const bRef = b.sourceRef ?? "";
  if (aRef !== bRef) {
    // NULLS FIRST: the follow graph (no container) leads.
    if (aRef === "") return -1;
    if (bRef === "") return 1;
    return aRef < bRef ? -1 : 1;
  }
  if (a.relationship !== b.relationship) return a.relationship < b.relationship ? -1 : 1;
  if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
  return a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * The web BYOF host service. Every public method returns a typed
 * `ByofServiceResult`. Fixtures mode drives the scripted capture; service
 * mode answers the honest `unavailable` failure for every capture/action
 * (reads answer the honest empty truth) until the R20-H transport lands.
 */
export class ByofFeedService {
  constructor(private readonly mode: "fixtures" | "service") {}

  // -------------------------------------------------------------------------
  // The source catalog
  // -------------------------------------------------------------------------

  /** The wired BYOF sources (the chooser's truth). */
  sources(): readonly ByofSourceChoice[] {
    return BYOF_SOURCES;
  }

  // -------------------------------------------------------------------------
  // previewImport
  // -------------------------------------------------------------------------

  /**
   * Capture the feed from the chosen source and STAGE it as a preview the
   * user confirms (the shared lane's `feed_preview_items` law). Staged rows
   * are keyed by the domain's idempotent import key; existing records keep
   * their canonical identity (re-imports never mint duplicates).
   */
  async previewFeedImport(input: {
    readonly connectorId: string;
    readonly method?: FeedImportMethod;
    readonly artifact?: Uint8Array;
  }): Promise<ByofServiceResult<FeedImportPreview>> {
    if (!isNonEmptyString(input.connectorId)) {
      return { ok: false, error: invalidInput("preview: connectorId: expected a non-empty string") };
    }
    if (input.method !== undefined && !isFeedImportMethod(input.method)) {
      return {
        ok: false,
        error: invalidInput(`preview: method: unknown import method '${String(input.method)}'`),
      };
    }
    const method = input.method ?? "api";
    // The artifact law: an export/file import needs the user-supplied
    // artifact — EXCEPT in fixtures mode, where the scripted source
    // supplies its OWN takeout file (the same dev-harness substitution the
    // scripted OAuth'd source itself is; loudly noted in the capture's
    // metadata, never presented as a user upload).
    if (
      (method === "official-export" || method === "user-file") &&
      input.artifact === undefined &&
      this.mode !== "fixtures"
    ) {
      return {
        ok: false,
        error: invalidInput(`preview: an '${method}' import needs the user-supplied artifact`),
      };
    }

    const source = BYOF_SOURCES.find((entry) => entry.connectorId === input.connectorId);
    if (source === undefined) {
      return {
        ok: false,
        error: {
          kind: "unknown-connector",
          detail: `preview: source '${input.connectorId}' is not wired for feed imports in this host`,
        },
      };
    }
    if (!source.methods.some((entry) => entry.method === method)) {
      return {
        ok: false,
        error: {
          kind: "unsupported",
          detail: `preview: source '${input.connectorId}' does not serve '${method}' imports (${source.methods.map((m) => m.method).join(" | ")})`,
        },
      };
    }

    // The service-mode capability truth: the BYOF service transport is the
    // lead's R20-H wiring step — this host answers the honest failure,
    // never a fake import.
    if (this.mode !== "fixtures") {
      return {
        ok: false,
        error: {
          kind: "unavailable",
          detail:
            "feed imports run against the configured WebFlix service — this host's BYOF transport is not wired yet (the service-lane integration step)",
        },
      };
    }

    const captured = captureFixtureFeedSnapshot({ method });
    if (!captured.ok) {
      return this.foldFailedCapture(method, captured.failure.kind, captured.failure.detail);
    }

    // The contract guard (the shared domain validator — never a guessed row).
    const validated = validateConnectorFeedSnapshot(captured.snapshot);
    if (!validated.ok) {
      return {
        ok: false,
        error: {
          kind: "provider",
          detail: `the capture violated the feed contract: ${validated.errors.join("; ")}`,
        },
      };
    }
    const snapshot = captured.snapshot;

    const state = readByofFixtureState();
    const importId = nextImportIdOf(state);
    const minted = { nextItemId: state.nextItemId };

    // Canonical resolution over the user's EXISTING records (re-imports keep
    // prior identities stable — the shared lane's resolution order).
    const existingByKey = new Map<string, ByofFixtureRecord>();
    for (const record of state.records) {
      existingByKey.set(record.key, record);
    }
    const staged: ByofFixtureRecord[] = snapshot.items.map((item, index) =>
      resolveCanonicalIdentity(item, index, importId, snapshot.capturedAt, existingByKey, minted),
    );

    const importRow: ByofFixtureImport = {
      id: importId,
      connectorId: snapshot.connectorId,
      method,
      status: "preview",
      continuousSync: snapshot.continuousSync,
      capturedAt: snapshot.capturedAt,
      startedAt: snapshot.capturedAt,
      // The staged capture is a SNAPSHOT until confirm folds its truth.
      syncState: "snapshot",
    };

    // An unconfirmed preview REPLACES this source's prior staged preview
    // (only ONE staged preview per source — the wizard's honest state).
    const imports = state.imports.filter(
      (row) => !(row.connectorId === snapshot.connectorId && row.status === "preview"),
    );
    const stagedItems = state.stagedItems.filter((row) =>
      imports.some((row2) => row2.id === row.importId),
    );

    writeByofFixtureState({
      ...state,
      imports: [...imports, importRow],
      stagedItems: [...stagedItems, ...staged],
      nextImportId: state.nextImportId + 1,
      nextItemId: minted.nextItemId,
    });

    const preview: FeedImportPreview = {
      importId,
      connectorId: snapshot.connectorId,
      method,
      itemCount: staged.length,
      relationshipCounts: relationshipCountsOf(staged),
      freshness: importRow.syncState,
      sample: staged.slice(0, 20).map((record) => frozenRecordOf(record, importRow)),
    };
    return { ok: true, value: preview };
  }

  // -------------------------------------------------------------------------
  // confirmImport
  // -------------------------------------------------------------------------

  /**
   * Confirm a staged preview: promote EXACTLY what the user saw into
   * records by IDEMPOTENT IMPORT KEY (an existing key's row updates in
   * place — no duplicates, no drift; the shared lane's `upsertRecordRow`
   * law). A continuously re-readable route lands `live`; a one-time
   * artifact lands `snapshot` — never presented as live. Confirm never
   * re-fetches.
   */
  async confirmFeedImport(importId: string): Promise<ByofServiceResult<ByofImportView>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("confirm: importId: expected a non-empty string") };
    }
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) {
      return {
        ok: false,
        error: { kind: "not-found", detail: `confirm: feed import '${importId}' is unknown` },
      };
    }
    if (row.status === "failed" || row.status === "reauthorization-required") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `confirm: feed import '${importId}' is '${row.status}' — it never staged a preview to confirm`,
        },
      };
    }
    if (row.status !== "preview") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `confirm: feed import '${importId}' is already '${row.status}'`,
        },
      };
    }
    const staged = state.stagedItems.filter((record) => record.importId === importId);

    const syncState: FeedSyncState = row.continuousSync ? "live" : "snapshot";
    const confirmed: ByofFixtureImport = {
      ...row,
      status: "confirmed",
      syncState,
      completedAt: row.capturedAt,
      lastSyncedAt: row.capturedAt,
    };

    // The idempotent promotion: staged rows land on their import keys. An
    // existing record with the same key is UPDATED in place (its identity
    // and provenance refresh — no duplicate row); a new key inserts.
    const promotedByKey = new Map(staged.map((record) => [record.key, record]));
    const nextRecords: ByofFixtureRecord[] = [];
    for (const record of state.records) {
      const promoted = promotedByKey.get(record.key);
      if (promoted === undefined) {
        nextRecords.push(record); // another import's record — untouched
        continue;
      }
      // The confirming import owns the row now (the shared lane's
      // `upsertRecordRow` attribution; the identity is the promoted one's).
      nextRecords.push({
        ...promoted,
        importId,
        importedAt: record.importedAt,
        capturedAt: promoted.capturedAt,
      });
      promotedByKey.delete(record.key);
    }
    for (const promoted of promotedByKey.values()) {
      nextRecords.push({ ...promoted, importId }); // a brand-new relationship
    }

    const imports = state.imports.map((entry) => (entry.id === importId ? confirmed : entry));
    // The staged rows are CONSUMED by the promotion (a re-confirm of an
    // already-confirmed import stays allowed: it re-applies the same staged
    // rows onto the same keys — the R20-A idempotence law).
    const stagedItems = state.stagedItems;
    writeByofFixtureState({ ...state, imports, records: nextRecords, stagedItems });

    const importRecords = nextRecords.filter((record) => record.importId === importId);
    return { ok: true, value: importViewOf(confirmed, importRecords) };
  }

  // -------------------------------------------------------------------------
  // discardPreview (the wizard's cancel — non-destructive)
  // -------------------------------------------------------------------------

  /**
   * Discard a STAGED preview (the wizard's cancel): the unconfirmed rows
   * are dropped; no confirmed record is ever touched.
   */
  async discardPreview(importId: string): Promise<ByofServiceResult<{ discarded: true }>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("discard: importId: expected a non-empty string") };
    }
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) {
      return { ok: false, error: { kind: "not-found", detail: `discard: feed import '${importId}' is unknown` } };
    }
    if (row.status !== "preview") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `discard: feed import '${importId}' is '${row.status}' — only a staged preview can be discarded`,
        },
      };
    }
    const imports = state.imports.filter((entry) => entry.id !== importId);
    const stagedItems = state.stagedItems.filter((record) => record.importId !== importId);
    writeByofFixtureState({ ...state, imports, stagedItems });
    return { ok: true, value: { discarded: true } };
  }

  // -------------------------------------------------------------------------
  // readPreview (the staged preview the wizard confirms)
  // -------------------------------------------------------------------------

  /**
   * Read one staged preview (the frozen `FeedImportPreview` contract: item
   * count, per-relationship counts, freshness, and the sample rows in
   * SOURCE-NATIVE order). `null` when the import is unknown — the caller's
   * UI state, not an error.
   */
  async readPreview(importId: string): Promise<FeedImportPreview | null> {
    if (!isNonEmptyString(importId)) return null;
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) return null;
    const staged = state.stagedItems.filter((record) => record.importId === importId);
    return {
      importId,
      connectorId: row.connectorId,
      method: row.method,
      itemCount: staged.length,
      relationshipCounts: relationshipCountsOf(staged),
      freshness: row.syncState,
      sample: staged.slice(0, 20).map((record) => frozenRecordOf(record, row)),
    };
  }

  /**
   * Read one import's records as the surface views them (titles included —
   * the wizard's sample and the feed rows render the source's own titles).
   * A STAGED preview's rows render in the CAPTURE's array order (the
   * shared lane's `ORDER BY position`); a confirmed import's rows render
   * in the shared lane's served order (source_ref, relationship,
   * source_order — see `readFeed`). Empty when the import is unknown.
   */
  async readImportRecords(importId: string): Promise<readonly ByofRecordView[]> {
    if (!isNonEmptyString(importId)) return [];
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) return [];
    if (row.status === "preview") {
      const staged = state.stagedItems
        .filter((record) => record.importId === importId)
        .sort((a, b) => a.captureIndex - b.captureIndex);
      return staged.map((record) => recordViewOf(record, row.syncState));
    }
    const records = state.records
      .filter((record) => record.importId === importId)
      .sort(recordOrdering);
    return records.map((record) => recordViewOf(record, row.syncState));
  }

  // -------------------------------------------------------------------------
  // readFeed (the mode-truth law)
  // -------------------------------------------------------------------------

  /**
   * Read the imported feed records under a mode:
   * `webflix` is ALWAYS empty (imported records are never re-labeled as
   * WebFlix-ranked content); `following` is the follow-graph subset;
   * `byof`/`hybrid` return the SOURCE-NATIVE order — the shared lane's
   * served order (`source_ref ASC NULLS FIRST, relationship ASC,
   * source_order ASC, imported_at ASC`), never re-ranked here.
   */
  async readFeed(mode: ByofFeedMode): Promise<readonly ByofRecordView[]> {
    if (mode !== "webflix" && mode !== "following" && mode !== "byof" && mode !== "hybrid") {
      throw new Error(`readFeed: unknown mode '${String(mode)}'`);
    }
    // THE MODE-TRUTH LAW: the WebFlix mode never serves imported records.
    if (mode === "webflix") return [];

    const state = readByofFixtureState();
    const syncStateByImport = new Map(state.imports.map((row) => [row.id, row.syncState]));
    const visible = state.records.filter((record) => {
      const row = state.imports.find((entry) => entry.id === record.importId);
      if (row === undefined) return false;
      // The feed view serves confirmed + reauthorization-required + stale +
      // disconnected imports (the survival law: records are retained); a
      // staged (unconfirmed) preview's rows are NOT imported yet.
      return (
        row.status === "confirmed" ||
        row.status === "reauthorization-required" ||
        row.status === "disconnected"
      );
    });
    const filtered =
      mode === "following"
        ? visible.filter((record) =>
            (FOLLOWING_RELATIONSHIPS as readonly string[]).includes(record.relationship),
          )
        : visible;
    const sorted = [...filtered].sort(recordOrdering);
    return sorted.map((record) =>
      recordViewOf(record, syncStateByImport.get(record.importId) ?? "snapshot"),
    );
  }

  // -------------------------------------------------------------------------
  // The imports read (the management view)
  // -------------------------------------------------------------------------

  /** Every import row (the summaries + freshness truth). */
  async listImports(): Promise<readonly ByofImportView[]> {
    const state = readByofFixtureState();
    return state.imports.map((row) => {
      const rows =
        row.status === "preview"
          ? state.stagedItems.filter((record) => record.importId === row.id)
          : state.records.filter((record) => record.importId === row.id);
      return importViewOf(row, rows);
    });
  }

  // -------------------------------------------------------------------------
  // syncImport (the R20-C reconciliation composition)
  // -------------------------------------------------------------------------

  /**
   * Incrementally synchronize one import: re-capture, diff against the
   * import's OWN records through the shared domain engine
   * (`reconcileFeedSnapshot`), apply the plan idempotently, and fold the
   * honest state machine (`nextSyncStateAfterSync`).
   */
  async syncFeedImport(importId: string): Promise<ByofServiceResult<FeedReconciliationReport>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("sync: importId: expected a non-empty string") };
    }
    if (this.mode !== "fixtures") {
      return {
        ok: false,
        error: {
          kind: "unavailable",
          detail:
            "feed syncs run against the configured WebFlix service — this host's BYOF transport is not wired yet (the service-lane integration step)",
        },
      };
    }
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) {
      return { ok: false, error: { kind: "not-found", detail: `sync: feed import '${importId}' is unknown` } };
    }
    if (row.status === "preview") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `sync: feed import '${importId}' is still a preview — confirm it before syncing (nothing is imported yet)`,
        },
      };
    }
    if (row.status === "disconnected") {
      return {
        ok: false,
        error: {
          kind: "unsupported",
          detail: `sync: feed import '${importId}' is disconnected — its records are kept; re-import through a fresh preview to resume syncing`,
        },
      };
    }
    if (!row.continuousSync) {
      return {
        ok: false,
        error: {
          kind: "unsupported",
          detail: `sync: feed import '${importId}' captured a one-time artifact — re-import through a fresh preview instead of a fake refresh`,
        },
      };
    }

    const captured = captureFixtureFeedSnapshot({ method: row.method });
    if (!captured.ok) {
      return this.foldFailedSync(state, row, captured.failure.kind, captured.failure.detail);
    }
    const validated = validateConnectorFeedSnapshot(captured.snapshot);
    if (!validated.ok) {
      return this.foldFailedSync(
        state,
        row,
        "provider",
        `the capture violated the feed contract: ${validated.errors.join("; ")}`,
      );
    }
    const snapshot = captured.snapshot;

    // The import's OWN scope (the shared lane's remove-safety law): the
    // relationship filter + container the request produced, and only
    // records the same METHOD captured (a file import's records survive an
    // API sync) — NOT a mere import-attribution slice, so a re-import that
    // re-attributed rows stays inside the reconciled truth.
    const methodByImport = new Map(state.imports.map((entry) => [entry.id, entry.method]));
    const inScope = state.records.filter((record) => {
      const connectorRow = state.imports.find((entry) => entry.id === record.importId);
      if (connectorRow === undefined) return false;
      if (connectorRow.connectorId !== row.connectorId) return false;
      if (methodByImport.get(record.importId) !== row.method) return false;
      if (
        row.relationships !== undefined &&
        !(row.relationships as readonly string[]).includes(record.relationship)
      ) {
        return false;
      }
      if (row.sourceRef !== undefined && (record.sourceRef ?? "") !== row.sourceRef) {
        return false;
      }
      return true;
    });
    const existingInputs = inScope.map((record) => ({
      profileId: FIXTURE_PROFILE_ID,
      externalRef: record.externalRef,
      provenance: {
        connectorId: row.connectorId,
        relationship: record.relationship,
        ...(record.sourceRef !== undefined ? { sourceRef: record.sourceRef } : {}),
        sourceOrder: record.sourceOrder,
        capturedAt: record.capturedAt,
      },
      ...(record.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: record.sourceUpdatedAt } : {}),
      ...(record.title !== undefined ? { title: record.title } : {}),
    }));

    const plan = reconcileFeedSnapshot(existingInputs, snapshot, {
      profileId: FIXTURE_PROFILE_ID,
      connectorId: row.connectorId,
    });

    // Apply the plan idempotently (the domain's own decisions). THE SHARED
    // LANE'S APPLY LAWS, mirrored:
    // - upserts and removes are KEY-scoped across the profile+connector
    //   (`ON CONFLICT (profile_id, import_key)` / `DELETE ... WHERE
    //   import_key`) — a row lands on its key wherever it lives, and the
    //   writing import re-attributes it;
    // - the canonical IDENTITY resolution consults the connector's WHOLE
    //   record set (the shared lane's graph-realization lookup — identity
    //   stability across imports and methods), while the DIFF's
    //   existing-side is the method/relationship/container-scoped slice
    //   (the remove-safety law).
    const removedKeys = new Set(
      plan.decisions.filter((decision) => decision.action === "remove").map((decision) => decision.key),
    );
    const upsertsByKey = new Map(plan.upserts.map((upsert) => [upsert.key, upsert]));
    const minted = { nextItemId: state.nextItemId };
    const captureIndexByItem = new Map<string, number>();
    snapshot.items.forEach((item, index) => {
      captureIndexByItem.set(
        `${item.relationship}\u0000${item.sourceRef ?? ""}\u0000${item.externalRef}`,
        index,
      );
    });
    // The identity-resolution map: EVERY record of this connector (the
    // identity stability law — an add whose key exists under another
    // import/method keeps that row's identity).
    const identityByKey = new Map(
      state.records
        .filter((record) => {
          const owner = state.imports.find((entry) => entry.id === record.importId);
          return owner !== undefined && owner.connectorId === row.connectorId;
        })
        .map((record) => [record.key, record]),
    );
    const nextRecords: ByofFixtureRecord[] = [];
    const touchedKeys = new Set<string>();
    for (const record of state.records) {
      if (removedKeys.has(record.key)) continue; // the source no longer lists it
      const upsert = upsertsByKey.get(record.key);
      if (upsert === undefined) {
        nextRecords.push(record); // kept or out-of-scope — untouched
        continue;
      }
      // The upsert lands on the EXISTING row (key-scoped): the newest
      // capture's provenance, re-attributed to the syncing import; the
      // identity and the prior DEFERRED marker survive (visible, never
      // silent).
      touchedKeys.add(record.key);
      nextRecords.push({
        ...record,
        importId,
        capturedAt: snapshot.capturedAt,
        ...(upsert.item.title !== undefined ? { title: upsert.item.title } : {}),
        ...(upsert.item.sourceUpdatedAt !== undefined
          ? { sourceUpdatedAt: upsert.item.sourceUpdatedAt }
          : {}),
      });
    }
    for (const upsert of plan.upserts) {
      if (touchedKeys.has(upsert.key)) continue; // an update, already applied above
      const staged = resolveCanonicalIdentity(
        upsert.item,
        captureIndexByItem.get(
          `${upsert.item.relationship}\u0000${upsert.item.sourceRef ?? ""}\u0000${upsert.item.externalRef}`,
        ) ?? 0,
        importId,
        snapshot.capturedAt,
        identityByKey,
        minted,
      );
      nextRecords.push({ ...staged, importId });
    }

    const syncState = nextSyncStateAfterSync({ ok: true, continuousSync: snapshot.continuousSync });
    const appliedAt = snapshot.capturedAt;
    // A successful sync clears the prior error (the shared lane's
    // markSyncOutcome law: `error = $4` with the success's null).
    const { error: _priorError, ...rowWithoutError } = row;
    const synced: ByofFixtureImport = {
      ...rowWithoutError,
      status: "confirmed",
      syncState,
      lastSyncedAt: appliedAt,
      capturedAt: snapshot.capturedAt,
      lastReport: {
        appliedAt,
        added: plan.counts.added,
        updated: plan.counts.updated,
        removed: plan.counts.removed,
        kept: plan.counts.kept,
      },
    };
    const imports = state.imports.map((entry) => (entry.id === importId ? synced : entry));

    // Convergence: stamp every record attributed to the import (kept rows
    // included) with the folded state (the shared lane's
    // `UPDATE feed_records SET sync_state WHERE import_id` law).
    const converged = nextRecords.map((record) =>
      record.importId === importId ? { ...record, capturedAt: snapshot.capturedAt } : record,
    );

    writeByofFixtureState({
      ...state,
      imports,
      records: converged,
      nextItemId: minted.nextItemId,
    });

    const report = feedReconciliationReport(plan, { importId, appliedAt, method: row.method });
    return { ok: true, value: report };
  }

  // -------------------------------------------------------------------------
  // disconnect (the NON-DESTRUCTIVE undo/disconnect law)
  // -------------------------------------------------------------------------

  /**
   * Disconnect an import: syncing STOPS, the import is marked disconnected,
   * and the imported records + provenance SURVIVE (the survival law).
   * Deletion is the SEPARATE explicit user action.
   */
  async disconnectImport(importId: string): Promise<ByofServiceResult<ByofImportView>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("disconnect: importId: expected a non-empty string") };
    }
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) {
      return { ok: false, error: { kind: "not-found", detail: `disconnect: feed import '${importId}' is unknown` } };
    }
    if (row.status === "preview") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `disconnect: feed import '${importId}' is still a preview — discard it instead (nothing is imported yet)`,
        },
      };
    }
    if (row.status === "disconnected") {
      const records = state.records.filter((record) => record.importId === importId);
      return { ok: true, value: importViewOf(row, records) }; // idempotent
    }
    const disconnected: ByofFixtureImport = {
      ...row,
      status: "disconnected",
      // The records are retained; their freshness truth is the honest
      // disconnected state (never presented as live).
      syncState: "snapshot",
    };
    const imports = state.imports.map((entry) => (entry.id === importId ? disconnected : entry));
    writeByofFixtureState({ ...state, imports });
    const records = state.records.filter((record) => record.importId === importId);
    return { ok: true, value: importViewOf(disconnected, records) };
  }

  // -------------------------------------------------------------------------
  // reconnectImport (resume syncing after a disconnect)
  // -------------------------------------------------------------------------

  /**
   * Reconnect a disconnected import: a FRESH capture is staged as a preview
   * (the user re-confirms what the source now reports — reconnection never
   * silently re-imports). The disconnected row's records are retained.
   */
  async reconnectImport(importId: string): Promise<ByofServiceResult<FeedImportPreview>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("reconnect: importId: expected a non-empty string") };
    }
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) {
      return { ok: false, error: { kind: "not-found", detail: `reconnect: feed import '${importId}' is unknown` } };
    }
    if (row.status !== "disconnected") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `reconnect: feed import '${importId}' is '${row.status}' — only a disconnected import can reconnect`,
        },
      };
    }
    // A reconnect is a fresh preview through the same route.
    return this.previewFeedImport({ connectorId: row.connectorId, method: row.method });
  }

  // -------------------------------------------------------------------------
  // deleteImportedRecords (the EXPLICIT destructive path)
  // -------------------------------------------------------------------------

  /**
   * DELETE the imported feed records — the explicit user-deletion path ONLY.
   * Touches ONLY this state file's record rows (the fixture drive's own
   * feed records — structurally nothing else: the runtime's library,
   * history, and recommendation state are out of reach).
   */
  async deleteImportedRecords(importId: string): Promise<ByofServiceResult<{ deleted: number }>> {
    if (!isNonEmptyString(importId)) {
      return { ok: false, error: invalidInput("delete-records: importId: expected a non-empty string") };
    }
    const state = readByofFixtureState();
    const row = state.imports.find((entry) => entry.id === importId);
    if (row === undefined) {
      return { ok: false, error: { kind: "not-found", detail: `delete-records: feed import '${importId}' is unknown` } };
    }
    const before = state.records.length;
    const records = state.records.filter((record) => record.importId !== importId);
    const deleted = before - records.length;
    writeByofFixtureState({ ...state, records });
    return { ok: true, value: { deleted } };
  }

  // -------------------------------------------------------------------------
  // Internals — the honest failure folds
  // -------------------------------------------------------------------------

  /** Fold a failed FIRST capture (preview): honest audit row + typed failure. */
  private foldFailedCapture(
    method: FeedImportMethod,
    kind: "unauthorized" | "unsupported" | "invalid-input",
    detail: string,
  ): ByofServiceResult<FeedImportPreview> {
    if (kind === "unsupported" || kind === "invalid-input") {
      // Static request/capability truth — no transaction happened.
      return {
        ok: false,
        error: { kind: kind === "invalid-input" ? "provider" : "unsupported", detail },
      };
    }
    const state = readByofFixtureState();
    const importId = nextImportIdOf(state);
    const syncState: FeedSyncState = "reauthorization-required";
    const failed: ByofFixtureImport = {
      id: importId,
      connectorId: FIXTURE_CONNECTOR_ID,
      method,
      status: "reauthorization-required",
      continuousSync: method === "api",
      capturedAt: "",
      startedAt: "",
      syncState,
      error: detail,
    };
    writeByofFixtureState({
      ...state,
      imports: [...state.imports, failed],
      nextImportId: state.nextImportId + 1,
    });
    return {
      ok: false,
      error: { kind: "unauthorized", detail, importId, syncState },
    };
  }

  /** Fold a failed SYNC: the survival law — records retained, state honest. */
  private foldFailedSync(
    state: ByofFixtureState,
    row: ByofFixtureImport,
    kind: "unauthorized" | "unsupported" | "invalid-input" | "transport" | "provider",
    detail: string,
  ): ByofServiceResult<FeedReconciliationReport> {
    const failure: "authorization" | "unsupported" | "provider" =
      kind === "unauthorized" ? "authorization" : kind === "unsupported" ? "unsupported" : "provider";
    const inScope = state.records.filter((record) => record.importId === row.id);
    const syncState = nextSyncStateAfterSync({
      ok: false,
      failure,
      hasRecords: inScope.length > 0,
    });
    const status: ByofFixtureImport["status"] =
      syncState === "reauthorization-required"
        ? "reauthorization-required"
        : row.status === "disconnected"
          ? "disconnected"
          : row.status;
    const updated: ByofFixtureImport = {
      ...row,
      status,
      syncState,
      error: detail,
    };
    const imports = state.imports.map((entry) => (entry.id === row.id ? updated : entry));
    writeByofFixtureState({ ...state, imports });
    return {
      ok: false,
      error: {
        kind: kind === "invalid-input" ? "provider" : kind,
        detail,
        importId: row.id,
        syncState,
      },
    };
  }
}
