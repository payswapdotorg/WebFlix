/**
 * @wfx/experience — library/history client view model TYPES (WFX-029, Lane C).
 *
 * The client-facing "My Stuff" VIEW MODEL over three injected sources:
 * (a) connector-synced library entries (WFX-022 outbox state mirrored by the
 *     host), (b) local watch history derived from the frozen event stream
 *     (history.ts), (c) background-completed downloads (WFX-024 completion
 *     seam). PURE TYPES + pure helpers only — no persistence, no network, no
 *     provider calls, no mutation. Everything is assembled from data the host
 *     injects (the frozen architecture's "Experience Core" boundary).
 *
 * Dependency honesty (lead-visible decisions):
 * - `@wfx/actions` (WFX-022) is NOT a declared dependency of this package
 *   (packages/experience depends on @wfx/domain only) and this work item may
 *   not edit package.json. The outbox status vocabulary is therefore a
 *   CLOSED LOCAL MIRROR (`LibraryOutboxStatus`, `EntrySyncState`) of the
 *   published WFX-022 state machine (pending / in-flight / delivered /
 *   failed / unsupported / conflict). The host maps real `OutboxRecord`s
 *   onto these shapes; the view model never fabricates sync state.
 * - WFX-024 (native-media background completion) is NOT merged at the
 *   dispatch base (783f7e8): `@wfx/native-media` exposes no background module
 *   or `CompletionEvent` type, and it is not a dependency of this package
 *   either. `DownloadCompletion` is the view-model SEAM for that work: when
 *   WFX-024 lands, its completion adapter maps into this shape (id, itemId,
 *   connectorId, completedAt, optional size/path). No fake download data is
 *   ever invented here.
 * - User collections/lists ride on `LibraryEntry.metadata` (the frozen
 *   extension type carries no list field): the view convention is
 *   `metadata.list: string` and/or `metadata.lists: string[]` (see
 *   `resolveListNames`). Entries without list metadata land in the default
 *   group (`DEFAULT_LIST_NAME`).
 *
 * Determinism laws (same as the rest of @wfx/experience):
 * - No randomness, no hidden clock, no globals. All ordering is by explicit
 *   timestamps with documented tie-breaks (codepoint order for ids).
 */

import type {
  EntertainmentItem,
  LibraryEntry,
  PlaybackMode,
  PlaybackRealization,
  PlaybackSession,
  SourceRealization,
} from "@wfx/domain";
import { isRecord } from "@wfx/domain";

import type { WatchState, WatchStatus } from "./history";

// ---------------------------------------------------------------------------
// WFX-022 mirrors (closed vocabulary — see module doc)
// ---------------------------------------------------------------------------

/**
 * Closed mirror of the WFX-022 outbox status vocabulary
 * (`OutboxStatus` in packages/actions/src/sync/outbox.ts). The host maps the
 * real statuses verbatim; the view model adds no states of its own.
 */
export type LibraryOutboxStatus =
  | "pending"
  | "in-flight"
  | "delivered"
  | "failed"
  | "unsupported"
  | "conflict";

/** Every `LibraryOutboxStatus`, in union order. */
export const LIBRARY_OUTBOX_STATUSES: readonly LibraryOutboxStatus[] = [
  "pending",
  "in-flight",
  "delivered",
  "failed",
  "unsupported",
  "conflict",
];

/** Statuses a WFX-022 record can never leave (the dispatcher's terminal answers). */
export const TERMINAL_LIBRARY_OUTBOX_STATUSES: readonly LibraryOutboxStatus[] = [
  "delivered",
  "failed",
  "unsupported",
  "conflict",
];

/** The add/remove op vocabulary of the frozen `LibraryCommand`. */
export type LibraryCommandOp = "add" | "remove";

/**
 * The sync state of ONE connector-side library entry, as injected by the
 * host. A faithful projection of the WFX-022 outbox + reconciliation onto
 * library semantics:
 *
 * - `synced`           — present at the source, no pending ops.
 * - `pending`          — an add/remove command is recorded locally and awaits
 *                        delivery (outbox `pending` / `in-flight`).
 * - `failed`           — the command settled terminally `failed`.
 * - `unsupported`      — the command settled terminally `unsupported`
 *                        (the source cannot perform it — never retried).
 * - `conflict`         — the command settled terminally `conflict`
 *                        (a `local-only` receipt: recorded at the source
 *                        without external confirmation).
 * - `removed-remotely` — the source's library read no longer lists the entry
 *                        (reconciliation drift — the source says "removed").
 */
export type EntrySyncState =
  | { kind: "synced"; lastSyncedAt?: string }
  | { kind: "pending"; command: LibraryCommandOp; since: string }
  | { kind: "failed"; command: LibraryCommandOp; detail: string }
  | { kind: "unsupported"; command: LibraryCommandOp; detail: string }
  | { kind: "conflict"; command: LibraryCommandOp; detail: string }
  | { kind: "removed-remotely"; observedAt: string };

/** Every `EntrySyncState` kind, in union order. */
export const ENTRY_SYNC_KINDS: readonly EntrySyncState["kind"][] = [
  "synced",
  "pending",
  "failed",
  "unsupported",
  "conflict",
  "removed-remotely",
];

// ---------------------------------------------------------------------------
// Badges, icons, a11y
// ---------------------------------------------------------------------------

/** A connector's identity as displayed on a row (the "source icon"). */
export interface SourceIcon {
  connectorId: string;
  /** The connector's `displayName` (host-supplied from its descriptor). */
  displayName: string;
}

/**
 * One playback realization badge: where and how the item can play. Built from
 * watch-session realizations (frozen `PlaybackRealization`), entry
 * realizations (`SourceRealization` — mode derived from capabilities by the
 * frozen precedence order), and completed downloads (local `native` media).
 */
export interface RealizationBadge {
  connectorId: string;
  mode: PlaybackMode;
  externalRef?: string;
  /** Deterministic human label, e.g. `"Fake Source (native)"`. */
  label: string;
}

/**
 * Accessibility labels carried by EVERY row of every section (and by conflict
 * rows). `label` is the row's accessible name; `description` its role text;
 * `progress` (when present) is the resume announcement for continue rows.
 */
export interface RowA11y {
  label: string;
  description: string;
  progress?: string;
}

// ---------------------------------------------------------------------------
// Injected inputs (the three sources — pure data seams)
// ---------------------------------------------------------------------------

/**
 * One connector-synced library entry, injected by the host: the frozen
 * `LibraryEntry` data, the canonical item the host joined it to, the
 * connector's display identity, and the entry's mirrored WFX-022 sync state.
 */
export interface ConnectorLibraryEntry {
  connectorId: string;
  displayName: string;
  entry: LibraryEntry;
  /** The canonical item this entry realizes (host join — authoritative). */
  item: EntertainmentItem;
  sync: EntrySyncState;
  /** Graph realizations of the entry, when the host knows them. */
  realizations?: readonly SourceRealization[];
}

/**
 * One local watch-history input: the `WatchState` derived by
 * `deriveWatchHistory`, the canonical item, and the host's optional joins
 * (session realizations, the last playback session, connector display names
 * for the realization connectors — a missing name falls back to the
 * connectorId, never a fabricated display name).
 */
export interface WatchHistoryInput {
  state: WatchState;
  item: EntertainmentItem;
  realizations?: readonly PlaybackRealization[];
  /** The newest playback session for the item (resume target), when known. */
  lastSession?: PlaybackSession;
  /** connectorId → displayName for the realization connectors. */
  displayNames?: Readonly<Record<string, string>>;
}

/**
 * The WFX-024 seam: one background-completed download joined to its item.
 * WFX-024 is NOT merged at the dispatch base — this is the typed hole its
 * future completion adapter fills. `connectorId` is the source the download
 * came from; `id` is the completion's own identity (unique per input).
 */
export interface DownloadCompletion {
  id: string;
  itemId: string;
  connectorId: string;
  /** ISO 8601 completion timestamp. */
  completedAt: string;
  fileSizeBytes?: number;
  localPath?: string;
}

/** A `DownloadCompletion` plus the host's item and display-name joins. */
export interface DownloadCompletionInput {
  completion: DownloadCompletion;
  item: EntertainmentItem;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Fields shared by every row of every section (and by conflict rows). */
export interface LibraryRowBase {
  /** Deterministic row identity: `"<kind>:<key>"` (documented per kind). */
  rowId: string;
  itemId: string;
  item: EntertainmentItem;
  /** Resolved display title (see `resolveRowTitle`). */
  title: string;
  /** Union of source icons across every source that contributed the item. */
  sources: readonly SourceIcon[];
  /** Union of realization badges across sources. */
  realizations: readonly RealizationBadge[];
  /** Last-touched timestamp (ISO) — the max across contributing sources. */
  lastTouchedAt: string;
  a11y: RowA11y;
}

/** One connector's saved-source projection on a `SavedRow`. */
export interface SavedSource {
  connectorId: string;
  displayName: string;
  externalRef: string;
  /** The entry's own title (the connector's name for the item). */
  title: string;
  addedAt?: string;
  /** The list this source files the entry under (default `"Saved"`). */
  listName: string;
  sync: EntrySyncState;
}

/** A row of the Saved section: one item under one list. */
export interface SavedRow extends LibraryRowBase {
  kind: "saved";
  /** rowId: `"saved:<listName>:<itemId>"`. */
  /** The user list this row is grouped under. */
  listName: string;
  /** Every connector source that saved the item (sync badges live here). */
  savedSources: readonly SavedSource[];
}

/** A resume candidate row of the Continue section. */
export interface ContinueRow extends LibraryRowBase {
  kind: "continue";
  /** rowId: `"continue:<itemId>"`. */
  /** Resume position in milliseconds (>= 0). */
  positionMs: number;
  /** position/duration clamped to [0,1]; `null` when duration is unknown. */
  completionRatio: number | null;
  /** `"skipped"` rows are resumable (skip = skipped-but-resumable). */
  watchStatus: Exclude<WatchStatus, "completed">;
  /** The playback session to resume, when the fold could associate one. */
  resumeSessionId?: string;
}

/** A row of the Downloads section: one completed download. */
export interface DownloadRow extends LibraryRowBase {
  kind: "download";
  /** rowId: `"download:<completionId>"`. */
  completedAt: string;
  fileSizeBytes?: number;
  localPath?: string;
}

/** A row of the Finished section: completed watches and completed downloads. */
export interface FinishedRow extends LibraryRowBase {
  kind: "finished";
  /** rowId: `"finished:<itemId>"`. */
  /** How the item finished — union of the available signals. */
  finishedVia: readonly ("watched" | "downloaded")[];
  /** The newest finish timestamp (ISO) across the signals. */
  finishedAt: string;
}

/** One explicit resolution suggestion on a conflict row — never auto-applied. */
export interface ConflictSuggestion {
  action: "keep-local" | "re-save" | "dismiss";
  label: string;
  detail: string;
}

/**
 * A typed conflict row: the remote says an entry was removed while local
 * watch state exists for the same item. Never silently dropped, never
 * auto-resolved — the row carries the typed conflict detail and explicit
 * suggestions; the CHOICE belongs to the user.
 */
export interface ConflictRow extends LibraryRowBase {
  kind: "conflict";
  /** rowId: `"conflict:<itemId>"`. */
  /** Human-readable, deterministic conflict explanation. */
  detail: string;
  /** When the removal was observed (ISO) — the max across removed sources. */
  observedAt: string;
  suggestions: readonly ConflictSuggestion[];
}

/** Every row kind the view model produces. */
export type LibraryRow = SavedRow | ContinueRow | DownloadRow | FinishedRow | ConflictRow;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** The placeholder state of one section's backing source(s). */
export type SectionState = "loading" | "error" | "ready";

/** Per-section status: `ready` carries rows; `loading`/`error` are typed placeholders. */
export interface SectionStatus {
  state: SectionState;
  /** Present iff `state === "error"`: what failed. */
  errorDetail?: string;
}

const CONTINUE_TITLE = "Continue watching";
const SAVED_TITLE = "Saved";
const DOWNLOADS_TITLE = "Downloads";
const FINISHED_TITLE = "Finished";

/** The Continue section: resume candidates, most recently touched first. */
export interface ContinueSection {
  kind: "continue";
  title: string;
  status: SectionStatus;
  rows: readonly ContinueRow[];
}

/** One user-list group inside the Saved section. */
export interface SavedGroup {
  listName: string;
  rows: readonly SavedRow[];
}

/** The Saved section: entries grouped by user collections/lists. */
export interface SavedSection {
  kind: "saved";
  title: string;
  status: SectionStatus;
  groups: readonly SavedGroup[];
}

/** The Downloads section: WFX-024 completion events joined to items. */
export interface DownloadSection {
  kind: "downloads";
  title: string;
  status: SectionStatus;
  rows: readonly DownloadRow[];
}

/** The Finished section: completed watches + completed downloads. */
export interface FinishedSection {
  kind: "finished";
  title: string;
  status: SectionStatus;
  rows: readonly FinishedRow[];
}

/** Every section of the unified view. */
export type LibrarySection =
  | ContinueSection
  | SavedSection
  | DownloadSection
  | FinishedSection;

/**
 * The section ordering POLICY (WFX-029): Continue first (resume beats
 * everything), then Saved, then Downloads, then Finished.
 */
export const LIBRARY_SECTION_ORDER: readonly LibrarySection["kind"][] = [
  "continue",
  "saved",
  "downloads",
  "finished",
];

/** Deterministic section titles (a11y-ready header text). */
export const SECTION_TITLES: Readonly<Record<LibrarySection["kind"], string>> = {
  continue: CONTINUE_TITLE,
  saved: SAVED_TITLE,
  downloads: DOWNLOADS_TITLE,
  finished: FINISHED_TITLE,
};

/** The unified "My Stuff" view: ordered sections + surfaced conflicts. */
export interface LibraryView {
  /** Sections in `LIBRARY_SECTION_ORDER` order; empty ones are suppressed. */
  sections: readonly LibrarySection[];
  /** Typed conflict rows — always surfaced, never auto-resolved. */
  conflicts: readonly ConflictRow[];
}

// ---------------------------------------------------------------------------
// Pure helpers: list resolution + title resolution
// ---------------------------------------------------------------------------

/** The group name for entries with no list metadata. */
export const DEFAULT_LIST_NAME = SAVED_TITLE;

/**
 * Resolve the user list names of one `LibraryEntry`'s metadata (the view
 * convention: `metadata.list: string` and/or `metadata.lists: string[]`).
 * Non-string / blank entries are ignored — never coerced into group names.
 * An entry with no list metadata resolves to `[DEFAULT_LIST_NAME]`.
 * Deterministic order: `list` first, then `lists` in array order, de-duped.
 */
export function resolveListNames(metadata?: Record<string, unknown>): readonly string[] {
  const names: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0 && !names.includes(value)) {
      names.push(value);
    }
  };
  if (isRecord(metadata)) {
    push(metadata.list);
    if (Array.isArray(metadata.lists)) {
      for (const candidate of metadata.lists) push(candidate);
    }
  }
  return names.length > 0 ? names : [DEFAULT_LIST_NAME];
}

/**
 * Resolve a row's display title: the canonical title when the item carries
 * one, else the first non-blank fallback (connector entry titles), else the
 * item id. Deterministic; never fabricated — a row whose title is unknown
 * shows the canonical id.
 */
export function resolveRowTitle(
  item: EntertainmentItem,
  fallbackTitles: readonly string[],
): string {
  if (typeof item.canonicalTitle === "string" && item.canonicalTitle.trim().length > 0) {
    return item.canonicalTitle;
  }
  for (const fallback of fallbackTitles) {
    if (typeof fallback === "string" && fallback.trim().length > 0) return fallback;
  }
  return item.id;
}
