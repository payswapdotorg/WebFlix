/**
 * @wfx/app-web — the BYOF view contracts + pure derivations (R20-D).
 *
 * Bring Your Own Feed on the Web adapter: the plain, serializable view
 * shapes the settings panel (the import flow: choose source → connect →
 * preview → confirm) and the Library feed region (the imported feed:
 * source-native order, freshness truth, follow summary, undo/disconnect)
 * render — plus the PURE derivation laws every BYOF surface obeys.
 *
 * This module is deliberately dependency-light (only `@wfx/domain` types +
 * `@wfx/persistence`'s ROW types (TYPE-ONLY — erased at compile time, the
 * fixtures-only closure law of `byof-host.ts` keeps holding) + this app's
 * own constants): the service-mode host, the fixtures host, the API route,
 * and the tests all consume the SAME contracts — one law, two transports
 * (the same pattern as the R07 ServerPort split).
 *
 * THE UI TRUTH LAWS ENCODED HERE (docs/architecture/byof-architecture.md
 * + the R20 dispatch):
 *
 * - MODE VISIBILITY: imported records are SOURCE-NATIVE order — the label
 *   vocabulary never calls them WebFlix-ranked. `byofOrderModeLabel` is
 *   the one place the mode sentence is derived from, so no surface can
 *   mislabel an imported feed.
 * - FRESHNESS SURFACE: the frozen `FeedSyncState` vocabulary renders
 *   through `byofSyncTruth` — a snapshot is NEVER labeled live, a stale
 *   capture says why, and a reauthorization gap names the recovery path.
 *   State is ALWAYS paired with text + tone (never color alone — the
 *   design-language law).
 * - USER DISCONNECT TRUTH: the frozen vocabulary has no "disconnected"
 *   state (escalated for lead ratification); the Web lane folds a user
 *   disconnect through the shared store's honest state-marking path as
 *   `reauthorization-required` carrying the `BYOF_DISCONNECTED_MARKER`
 *   prefix. `isByofUserDisconnect` is the DOCUMENTED derivation for the
 *   "Disconnected — records retained" presentation; a transport-induced
 *   reauthorization gap renders its own distinct truth.
 * - UNDO SEMANTICS: disconnect NEVER deletes — `byofSyncTruth`'s
 *   disconnect detail states the retention law, and deletion is always a
 *   SEPARATE explicit action (the components render it so).
 *
 * Determinism: pure functions only — no I/O, no clock, no store.
 */

import type { FeedRelationship, FeedSyncState } from "@wfx/domain";
import type { PersistedFeedImport, PersistedFeedRecord } from "@wfx/persistence";
import { FEED_USER_DISCONNECT_MARKER } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The typed failure channel (the BYOF port's error grammar)
// ---------------------------------------------------------------------------

/** The closed failure vocabulary of the web adapter's BYOF operations. */
export type ByofFailureKind =
  /** The user's grant for the feed route is missing — the recovery path is connect/reauthorize. */
  | "unauthorized"
  /** The route honestly cannot serve the request (capability truth — never faked). */
  | "unsupported"
  /** Transport with the source failed. */
  | "transport"
  /** The source answered a contract-violating payload. */
  | "provider"
  /** The addressed import/preview is unknown. */
  | "not-found"
  /** Malformed caller input (typed; never a throw). */
  | "invalid-input"
  /** The transport for this boot mode does not carry the operation (honest capability truth). */
  | "unavailable";

/** One typed BYOF failure (never a thrown generic error, never a fake success). */
export interface ByofFailure {
  readonly kind: ByofFailureKind;
  readonly detail: string;
  /** The import the failure involved, when one was addressed. */
  readonly importId?: string;
  /** The import's state after the honest failure fold, when one was involved. */
  readonly syncState?: FeedSyncState;
}

/** The result envelope of every BYOF operation. */
export type ByofResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ByofFailure };

// ---------------------------------------------------------------------------
// The user-disconnect fold (documented derivation — see module doc)
// ---------------------------------------------------------------------------

/**
 * The visible marker a user-initiated import disconnect carries in the
 * shared store's error field (the honest state-marking path: the import's
 * grant is missing BY USER CHOICE, the records are RETAINED). The frozen
 * `FeedSyncState` vocabulary has no "disconnected" state — this marker is
 * the Web lane's documented fold, flagged for lead ratification.
 */
// R20-H integration: the string contract lives in @wfx/domain now
// (FEED_USER_DISCONNECT_MARKER); this alias preserves the lane-local name.
export const BYOF_DISCONNECTED_MARKER = FEED_USER_DISCONNECT_MARKER;

/** Whether an import's error detail marks a USER-initiated disconnect. */
export function isByofUserDisconnect(errorDetail: string | undefined): boolean {
  return errorDetail !== undefined && errorDetail.startsWith(BYOF_DISCONNECTED_MARKER);
}

// ---------------------------------------------------------------------------
// Freshness truth (the frozen vocabulary → plain language + tone)
// ---------------------------------------------------------------------------

/** The tone families of the design language's semantic state colors. */
export type ByofTone = "ok" | "warn" | "error" | "neutral";

/** The rendered truth of one sync state: label + detail + tone (never color alone). */
export interface ByofSyncTruth {
  /** The short chip label (plain language, never jargon). */
  readonly label: string;
  /** The one-sentence explanation (the honesty law). */
  readonly detail: string;
  /** The semantic tone (paired with the label — never standalone color). */
  readonly tone: ByofTone;
}

/**
 * The freshness truth of one import, derived from its sync state + the
 * user-disconnect fold. A snapshot is never labeled live; a live route
 * says what "live" means; every non-healthy state names its own recovery
 * path. `lastSyncedAt`/`errorDetail` ride along for the full sentence.
 */
export function byofSyncTruth(input: {
  readonly syncState: FeedSyncState | string;
  readonly disconnectedByUser: boolean;
  readonly lastSyncedAt?: string;
  readonly errorDetail?: string;
}): ByofSyncTruth {
  if (input.disconnectedByUser) {
    return {
      label: "Disconnected — records retained",
      detail:
        "You disconnected this import. Your imported items and where they came from are kept; " +
        "WebFlix stopped syncing this feed. Deleting the imported records is a separate, explicit action.",
      tone: "neutral",
    };
  }
  switch (input.syncState) {
    case "live":
      return {
        label: "Live — kept current",
        detail: input.lastSyncedAt !== undefined
          ? `This import syncs from its source; last synced ${byofFormatTimestamp(input.lastSyncedAt)}.`
          : "This import syncs from its source.",
        tone: "ok",
      };
    case "snapshot":
      return {
        label: "Snapshot — imported once",
        detail:
          "This capture is a point-in-time snapshot of your feed. It is not live: the source does not " +
          "support automatic re-reads here, so refreshing means importing again.",
        tone: "neutral",
      };
    case "syncing":
      return {
        label: "Syncing…",
        detail: "A sync with this source is in progress.",
        tone: "warn",
      };
    case "stale":
      return {
        label: "Stale — last sync failed",
        detail:
          `The last sync with this source failed${input.errorDetail !== undefined ? ` (${input.errorDetail})` : ""}. ` +
          "Your last good capture is kept — nothing was deleted.",
        tone: "warn",
      };
    case "reauthorization-required":
      return {
        label: "Authorization needed",
        detail:
          "The connection to this source needs your authorization again. Your imported items are kept " +
          "while you reconnect — nothing is deleted by a failing sync.",
        tone: "warn",
      };
    case "unsupported":
      return {
        label: "Sync not supported",
        detail: "This import route cannot be re-read automatically — import again to refresh it.",
        tone: "neutral",
      };
    case "degraded":
      return {
        label: "Degraded — nothing captured",
        detail:
          "An import was attempted from this source but never captured anything. " +
          "Reconnect the source and import again.",
        tone: "error",
      };
    default:
      return {
        label: String(input.syncState),
        detail: input.errorDetail ?? "The sync state of this import.",
        tone: "neutral",
      };
  }
}

// ---------------------------------------------------------------------------
// Mode + relationship + method vocabulary (plain language, one derivation)
// ---------------------------------------------------------------------------

/**
 * The mode sentence every BYOF feed surface carries (the MODE VISIBILITY
 * law): source-native order is visibly distinct from WebFlix-ranked
 * discovery. One derivation point — no surface may reword it into a
 * WebFlix-ranking claim.
 */
export function byofOrderModeLabel(sourceDisplayName: string): string {
  return `Source-native order — as ${sourceDisplayName} lists it (not a WebFlix ranking)`;
}

/** The relationship labels (plain language, the frozen vocabulary's order). */
const RELATIONSHIP_LABELS: Readonly<Record<string, string>> = {
  follow: "Channels you follow",
  subscription: "Subscriptions",
  playlist: "Playlists",
  watchlist: "Watch Later",
  like: "Liked videos",
  save: "Saved videos",
  "ranked-feed": "Your source's ranked feed",
  history: "Watch history",
  unknown: "Other items",
};

/** The plain-language label of one imported relationship kind. */
export function byofRelationshipLabel(relationship: FeedRelationship | string): string {
  return RELATIONSHIP_LABELS[relationship] ?? "Other items";
}

/** The import-method labels (how the capture was taken — provenance truth). */
const METHOD_LABELS: Readonly<Record<string, string>> = {
  api: "the authorized API",
  "official-export": "an official export file",
  "user-file": "a file you provided",
  snapshot: "a point-in-time snapshot",
};

/** The plain-language label of one import method. */
export function byofMethodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

// ---------------------------------------------------------------------------
// Timestamp rendering (deterministic: fixed locale + UTC)
// ---------------------------------------------------------------------------

/** The deterministic formatter (en-US, UTC — stable across environments). */
const UTC_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** Render one ISO timestamp as a stable human sentence (UTC, en-US). */
export function byofFormatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return UTC_FORMATTER.format(date);
}

// ---------------------------------------------------------------------------
// The view shapes (what the surfaces render)
// ---------------------------------------------------------------------------

/** One importable source of the BYOF panel (the "choose source" step). */
export interface ByofSourceOptionView {
  readonly connectorId: string;
  readonly displayName: string;
  /** The feed-route authorization truth (the connect step's state). */
  readonly connected: boolean;
  /** Whether the route supports continuous sync (the live/snapshot truth). */
  readonly continuousSync: boolean;
  /** The relationships this source can import (the capability truth). */
  readonly importable: readonly FeedRelationship[];
  /** The honest absences this source cannot expose, with their reasons. */
  readonly unavailable: readonly { readonly relationship: FeedRelationship; readonly reason: string }[];
}

/** One imported record row (identity + provenance display truth). */
export interface ByofRecordView {
  readonly externalRef: string;
  readonly title: string;
  readonly sourceOrder: number;
  readonly entertainmentItemId: string;
  readonly capturedAt: string;
  readonly relationship: FeedRelationship;
  readonly sourceRef?: string;
}

/** One source-native record group of the imported feed (the read order). */
export interface ByofRecordGroupView {
  readonly relationship: FeedRelationship;
  readonly records: readonly ByofRecordView[];
}

/** One import's card (the durable state; the honest attempt trail included). */
export interface ByofImportView {
  readonly importId: string;
  readonly connectorId: string;
  readonly displayName: string;
  readonly method: string;
  readonly status: string;
  readonly syncState: FeedSyncState;
  readonly disconnectedByUser: boolean;
  readonly continuousSync: boolean;
  readonly itemCount: number;
  readonly capturedAt?: string;
  readonly importedAt?: string;
  readonly lastSyncedAt?: string;
  readonly errorDetail?: string;
}

/** The Library feed region's view (the imported feed surface). */
export interface ByofFeedView {
  readonly state: "ready" | "unavailable";
  /** The typed unavailable detail (service mode's honest transport truth). */
  readonly detail?: string;
  /** The imported feeds, one entry per confirmed import still owning records. */
  readonly imports: readonly ByofImportFeedView[];
  /** The follow/subscription summary count (the "Following" subset). */
  readonly followingCount: number;
  /** Per-relationship counts of the imported records. */
  readonly relationshipCounts: Readonly<Record<string, number>>;
}

/** One imported feed entry: the import's durable truth + its source-native records. */
export interface ByofImportFeedView {
  readonly import: ByofImportView;
  /** The import's records in the store's source-native read order, grouped. */
  readonly groups: readonly ByofRecordGroupView[];
}

/** The staged preview view (the "preview before you confirm" step). */
export interface ByofPreviewView {
  readonly importId: string;
  readonly connectorId: string;
  readonly displayName: string;
  readonly itemCount: number;
  readonly relationshipCounts: Readonly<Record<string, number>>;
  /** The capture's freshness (a capture is a snapshot — never labeled live). */
  readonly freshness: FeedSyncState;
  readonly continuousSync: boolean;
  /** The sample rows the user is confirming, in the capture's own order. */
  readonly sample: readonly ByofRecordView[];
}

/** The settings panel's view (the whole BYOF flow entry). */
export interface ByofPanelView {
  readonly state: "ready" | "unavailable";
  /** The typed unavailable detail (service mode's honest transport truth). */
  readonly detail?: string;
  /** The importable sources (the choose-source step). */
  readonly sources: readonly ByofSourceOptionView[];
  /** Every import's durable state (honest attempt trail, newest first). */
  readonly imports: readonly ByofImportView[];
  /** The staged preview to render (the `?byof=preview&import=` step). */
  readonly preview: ByofPreviewView | null;
}

/** What one successful sync changed (the server's own honest report). */
export interface ByofSyncReportView {
  readonly importId: string;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly kept: number;
  readonly syncState: FeedSyncState;
}

// ---------------------------------------------------------------------------
// R20-H — the SHARED row→view derivations (one law, two transports)
// ---------------------------------------------------------------------------

/**
 * The pure derivations both transports compose their views from (the
 * R20-H seam-swap law): the fixtures host (over the local store's rows)
 * and the service-mode transport (over the same row shapes fetched from
 * the service's feed-import routes) derive IDENTICAL views from
 * IDENTICAL rows — no transport may re-implement (or re-word) these.
 *
 * `PersistedFeedImport`/`PersistedFeedRecord` are the shared store's own
 * row shapes (plain, serializable) — the service serves them verbatim,
 * so the derivations are transport-blind. Determinism: pure functions.
 */

/** Derive one imported record's view row (title fallback: the external ref). */
export function byofRecordViewOf(record: PersistedFeedRecord): ByofRecordView {
  return {
    externalRef: record.externalRef,
    title: record.title ?? record.externalRef,
    sourceOrder: record.provenance.sourceOrder,
    entertainmentItemId: record.entertainmentItemId,
    capturedAt: record.provenance.capturedAt,
    relationship: record.provenance.relationship,
    ...(record.provenance.sourceRef !== undefined ? { sourceRef: record.provenance.sourceRef } : {}),
  };
}

/**
 * Group one import's records into consecutive same-relationship groups
 * (the store's source-native read order, kept — order is DATA, never a
 * WebFlix rank).
 */
export function byofRecordGroupsOf(
  records: readonly PersistedFeedRecord[],
): readonly ByofRecordGroupView[] {
  const groups: { relationship: FeedRelationship; records: ByofRecordView[] }[] = [];
  for (const record of records) {
    const view = byofRecordViewOf(record);
    const last = groups.at(-1);
    if (last !== undefined && last.relationship === record.provenance.relationship) {
      last.records.push(view);
    } else {
      groups.push({ relationship: record.provenance.relationship, records: [view] });
    }
  }
  return groups;
}

/**
 * Derive one import's card (the durable truth): the LIVE record count for
 * confirmed imports (never the possibly-stale column — a deleted import
 * renders its truth: zero items left); the staged count for a preview row
 * (its own truth); the user-disconnect fold's distinct presentation flag;
 * the newest capture timestamp across the import's own records.
 */
export function byofImportViewOf(
  row: PersistedFeedImport,
  ownRecords: readonly PersistedFeedRecord[],
  displayName: string,
): ByofImportView {
  const capturedAt =
    ownRecords.length > 0
      ? ownRecords.map((record) => record.provenance.capturedAt).sort().at(-1)
      : undefined;
  return {
    importId: row.id,
    connectorId: row.connectorId,
    displayName,
    method: row.method,
    status: row.status,
    syncState: row.syncState,
    disconnectedByUser: isByofUserDisconnect(row.error),
    continuousSync: row.continuousSync,
    itemCount: row.status === "preview" ? row.itemCount : ownRecords.length,
    ...(capturedAt !== undefined ? { capturedAt } : {}),
    importedAt: row.startedAt,
    ...(row.lastSyncedAt !== undefined ? { lastSyncedAt: row.lastSyncedAt } : {}),
    ...(row.error !== undefined ? { errorDetail: row.error } : {}),
  };
}

/** The staged preview's assembly input (the frozen fields + display rows). */
export interface ByofPreviewAssembly {
  readonly importId: string;
  readonly connectorId: string;
  readonly itemCount: number;
  readonly relationshipCounts: Readonly<Record<string, number>>;
  /** The capture's freshness (a capture is a snapshot — never labeled live). */
  readonly freshness: FeedSyncState;
  readonly continuousSync: boolean;
  readonly displayName: string;
  /** The sample rows the user is confirming, in the staged-read order. */
  readonly sample: readonly ByofRecordView[];
}

/** Derive the staged preview's view (the "preview before you confirm" step). */
export function byofPreviewViewOf(assembly: ByofPreviewAssembly): ByofPreviewView {
  return {
    importId: assembly.importId,
    connectorId: assembly.connectorId,
    displayName: assembly.displayName,
    itemCount: assembly.itemCount,
    relationshipCounts: assembly.relationshipCounts,
    freshness: assembly.freshness,
    continuousSync: assembly.continuousSync,
    sample: assembly.sample,
  };
}
