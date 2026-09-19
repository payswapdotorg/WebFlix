/**
 * @wfx/app-web — the BYOF view pipelines (R20-D): SERVICE STATE → view models.
 *
 * Pure projections of the BYOF host service's typed results into the plain
 * serializable view models the Bring-Your-Feed surfaces render (the same
 * law `host/view-models.ts` keeps for every other surface): NO product
 * logic here — preview/confirm/sync/disconnect semantics are the service's;
 * this module maps them and preserves the typed statuses verbatim (an
 * error fold renders as the error state with its recovery path, never as
 * a fake empty list).
 *
 * THE MODE-VIEW TRUTH (the J33 law): the BYOF surface's mode selector maps
 * the frozen product modes to visibly distinct views:
 * - `byof`      — the imported records in SOURCE-NATIVE order, labeled;
 * - `following` — the follow/subscription subset, source-native order;
 * - `webflix`   — NEVER the imported records (the service's mode-truth law
 *   pins the empty read): WebFlix's own discovery composition renders,
 *   plainly labeled as WebFlix-ranked, plus the explicit note that
 *   WebFlix never re-ranks the imported feed;
 * - `hybrid`    — the source-native records PLUS WebFlix discovery
 *   candidates, each labeled distinctly (source item vs WebFlix pick).
 *
 * The discovery candidates come from the SAME seeded composition Home
 * renders (the runtime's search over the wired sources — the honest
 * seeded browse rows until the R05 personal ranking lands), so the
 * WebFlix-mode view is never a fabricated list.
 */

import type { WebRuntimeHost } from "../web-host";
import type {
  ByofFailure,
  ByofImportView,
  ByofRecordView,
  ByofSourceChoice,
} from "./service";
import { ByofFeedService, type ByofFeedMode } from "./service";
import { FOR_YOU_QUERY, type CardView, cardsFromModel } from "../view-models";

// ---------------------------------------------------------------------------
// The mode vocabulary (the surface's labels — the visible distinction)
// ---------------------------------------------------------------------------

/** One mode tab: the id, its plain-language label, and its order truth. */
export interface ByofModeChoice {
  readonly id: ByofFeedMode;
  readonly label: string;
  readonly note: string;
}

/** The mode tabs, in selector order (the frozen product-mode vocabulary). */
export const BYOF_MODES: readonly ByofModeChoice[] = [
  {
    id: "byof",
    label: "Your imports",
    note: "Exactly the order your source lists — WebFlix does not rank this list.",
  },
  {
    id: "following",
    label: "Following",
    note: "The channels and subscriptions you follow, in your source's own order.",
  },
  {
    id: "webflix",
    label: "WebFlix picks",
    note: "WebFlix-ranked discovery — your imported feed is never re-ranked or re-labeled as WebFlix picks.",
  },
  {
    id: "hybrid",
    label: "Imports + WebFlix picks",
    note: "Your source-native imports first, then WebFlix's own discovery candidates — each labeled.",
  },
];

// ---------------------------------------------------------------------------
// The view shapes
// ---------------------------------------------------------------------------

/** The wizard's staged-preview view (what the user confirms). */
export interface ByofPreviewView {
  readonly importId: string;
  readonly connectorId: string;
  readonly method: string;
  readonly itemCount: number;
  readonly relationshipCounts: Readonly<Record<string, number>>;
  /** The honest snapshot/live truth of THIS import route. */
  readonly continuousSync: boolean;
  /** The plain-language freshness truth (the snapshot-never-live law). */
  readonly freshnessNote: string;
  /** The sample rows in SOURCE-NATIVE order (the order truth made visible). */
  readonly sample: readonly {
    readonly title: string | null;
    readonly relationship: string;
    readonly sourceOrder: number;
    readonly sourceRef: string | null;
  }[];
}

/** One relationship count row (the imported follow/subscription summary). */
export interface ByofRelationshipSummaryRow {
  readonly relationship: string;
  readonly label: string;
  readonly count: number;
}

/** The relationship labels (plain language, the summary's vocabulary). */
const RELATIONSHIP_LABELS: Readonly<Record<string, string>> = {
  follow: "Channels followed",
  subscription: "Subscriptions",
  playlist: "Playlist items",
  watchlist: "Watch-later items",
  like: "Liked items",
  save: "Saved items",
  "ranked-feed": "Ranked-feed items",
  history: "History items",
  unknown: "Other items",
};

/** The relationship display order (the summary's stable order). */
const RELATIONSHIP_ORDER: readonly string[] = [
  "follow",
  "subscription",
  "playlist",
  "watchlist",
  "like",
  "save",
  "ranked-feed",
  "history",
  "unknown",
];

/** The freshness labels (the live/snapshot truth — first-class UI). */
export const FEED_FRESHNESS_LABELS: Readonly<Record<string, string>> = {
  live: "Live — kept current while connected",
  syncing: "Syncing",
  snapshot: "Snapshot — imported as of a moment in time",
  stale: "Stale — the last capture could not be refreshed",
  "reauthorization-required": "Needs reconnect — the source's authorization expired",
  unsupported: "Not supported on this route",
  degraded: "Degraded — the source could not be read",
};

/** The method labels (the import route's plain name). */
export const FEED_METHOD_LABELS: Readonly<Record<string, string>> = {
  api: "Authorized connection",
  "official-export": "Official export file",
  "user-file": "Your file",
  snapshot: "Snapshot",
};

/** The whole BYOF feed view (the surface's data). */
export interface ByofFeedViewModel {
  readonly mode: ByofFeedMode;
  readonly modeLabel: string;
  readonly modeNote: string;
  readonly bootMode: "fixtures" | "service";
  readonly imports: readonly ByofImportView[];
  readonly records: readonly ByofRecordView[];
  /** WebFlix's own discovery candidates (webflix/hybrid modes only — never imported records). */
  readonly discoveryCards: readonly CardView[];
  readonly stagedPreview: ByofPreviewView | null;
  readonly sources: readonly ByofSourceChoice[];
  /** The honest typed failure of the LAST capture/sync attempt, when one folded. */
  readonly lastCaptureFailure: ByofFailure | null;
}

// ---------------------------------------------------------------------------
// The loaders
// ---------------------------------------------------------------------------

/** Project a staged import row + its sample records into the preview view. */
function previewViewOf(
  row: ByofImportView,
  sample: readonly ByofRecordView[],
): ByofPreviewView {
  return {
    importId: row.id,
    connectorId: row.connectorId,
    method: row.method,
    itemCount: row.recordCount,
    relationshipCounts: row.relationshipCounts,
    continuousSync: row.continuousSync,
    freshnessNote: row.continuousSync
      ? "WebFlix can keep this feed current while the source stays connected — its live status will be shown and nothing will be presented as live until it is."
      : "This is a one-time snapshot of your source right now — it will never be shown as live, and WebFlix will not silently refresh it.",
    sample: sample.slice(0, 20).map((record) => ({
      title: record.title,
      relationship: record.relationship,
      sourceOrder: record.sourceOrder,
      sourceRef: record.sourceRef,
    })),
  };
}

/**
 * Load the whole BYOF feed view. The discovery candidates load ONLY for
 * the webflix/hybrid modes (the modes that render WebFlix's own picks —
 * the honest seeded browse composition Home renders).
 */
export async function loadByofFeedView(
  host: WebRuntimeHost,
  rawMode: string | undefined,
): Promise<ByofFeedViewModel> {
  const byof = new ByofFeedService(host.mode);
  const mode: ByofFeedMode =
    rawMode === "webflix" || rawMode === "following" || rawMode === "hybrid" ? rawMode : "byof";
  const modeChoice = BYOF_MODES.find((entry) => entry.id === mode) ?? BYOF_MODES[0]!;

  const [imports, records] = await Promise.all([byof.listImports(), byof.readFeed(mode)]);

  // The staged preview (the wizard's confirm step): the most recent
  // unconfirmed preview row of any wired source, with its sample rows
  // (titles included — the user confirms WHAT THEY SEE).
  const stagedRow = imports.find((row) => row.status === "preview") ?? null;
  const stagedSample = stagedRow === null ? [] : await byof.readImportRecords(stagedRow.id);

  // The last capture failure fold (the authorization-failure truth — the
  // reauthorization-required row with its recovery path).
  const failureRow = imports.find(
    (row) => (row.status === "reauthorization-required" || row.status === "failed") && row.error !== null,
  );

  // WebFlix's own discovery candidates: ONLY the webflix/hybrid modes load
  // them (never the imported records — the mode-truth law).
  let discoveryCards: readonly CardView[] = [];
  if (mode === "webflix" || mode === "hybrid") {
    const model = await host.runtime.search({ query: FOR_YOU_QUERY });
    discoveryCards = cardsFromModel(model);
  }

  return {
    mode,
    modeLabel: modeChoice.label,
    modeNote: modeChoice.note,
    bootMode: host.mode,
    imports,
    records,
    discoveryCards,
    stagedPreview: stagedRow !== null ? previewViewOf(stagedRow, stagedSample) : null,
    sources: byof.sources(),
    lastCaptureFailure:
      failureRow === undefined
        ? null
        : {
            kind: "unauthorized",
            detail: failureRow.error ?? "the source's authorization needs attention",
            importId: failureRow.id,
            syncState: failureRow.syncState,
          },
  };
}

/** The relationship summary rows of one import (the follow/subscription summary). */
export function relationshipSummaryOf(
  counts: Readonly<Record<string, number>>,
): ByofRelationshipSummaryRow[] {
  return RELATIONSHIP_ORDER.filter((relationship) => (counts[relationship] ?? 0) > 0).map(
    (relationship) => ({
      relationship,
      label: RELATIONSHIP_LABELS[relationship] ?? relationship,
      count: counts[relationship] ?? 0,
    }),
  );
}

/** The plain-language label of one import method. */
export function methodLabelOf(method: string): string {
  return FEED_METHOD_LABELS[method] ?? method;
}

/** The freshness label of one sync state (paired with text — never color alone). */
export function freshnessLabelOf(syncState: string): string {
  return FEED_FRESHNESS_LABELS[syncState] ?? syncState;
}
