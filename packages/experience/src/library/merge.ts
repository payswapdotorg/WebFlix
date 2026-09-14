/**
 * @wfx/experience — library view unification (WFX-029, Lane C).
 *
 * `mergeLibraryViews(connectorEntries, watchHistory, completions)` is the
 * pure unification of the three "My Stuff" sources into per-item MERGED
 * rows + typed conflict rows:
 *
 * - ONE CANONICAL ITEM = ONE ROW: the same `EntertainmentItem.id` appearing
 *   in multiple sources (saved on several connectors, watched locally,
 *   downloaded in the background) merges into a single `MergedRow` whose
 *   source icons and realization badges are the UNION across sources
 *   (deterministic first-appearance order: connector entries, then watch
 *   history, then completions). The canonical identity is the item id —
 *   "One content identity, many realizations" (frozen invariant 8); the
 *   host's item join is authoritative, external refs are realizations.
 * - CONFLICTS ARE TYPED, NEVER SILENT, NEVER AUTO-RESOLVED: when a connector
 *   entry carries the `removed-remotely` sync state (the source's library
 *   read no longer lists it — the reconcile drift signal) while local watch
 *   state exists for the same item, a `ConflictRow` is emitted with the
 *   typed detail and THREE explicit suggestions (keep-local / re-save /
 *   dismiss). Nothing is dropped and nothing is decided here: the choice
 *   belongs to the user. A `removed-remotely` entry with NO local watch
 *   state is not a conflict — there is nothing local to conflict with — and
 *   the stale row is simply omitted (the entry remains queryable through
 *   the injected input; the omission is documented, not silent data loss).
 * - LAST-TOUCHED time is the max epoch across every contributing timestamp
 *   (entry addedAt + sync timestamps, watch lastWatchedAt, download
 *   completedAt); ties keep the first-collected timestamp (evaluation order
 *   fixed: entries → watch → downloads) — deterministic.
 *
 * Purity: no mutation of the injected inputs (rows REFERENCE them), no
 * clock, no randomness. Rows are ordered last-touched desc, itemId asc
 * (codepoint).
 *
 * Error channel: malformed input (non-arrays; entries whose declared
 * connectorId does not match `entry.connectorId`; duplicate completion ids —
 * row identity violation) throws the typed `ExperienceError` (the package's
 * caller-misuse channel). Item/event/session shapes are validated upstream
 * (history.ts validates the fold inputs; merge checks identity coherence).
 */

import type { EntertainmentItem, PlaybackMode } from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";
import {
  resolveListNames,
  resolveRowTitle,
  type ConflictRow,
  type ConflictSuggestion,
  type ConnectorLibraryEntry,
  type DownloadCompletionInput,
  type RealizationBadge,
  type SavedSource,
  type SourceIcon,
  type WatchHistoryInput,
} from "./model";
import type { WatchState } from "./history";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One completed download joined with its display-name, as carried on a row. */
export interface DownloadInfo {
  /** The WFX-024 seam completion (view-model input shape). */
  completion: DownloadCompletionInput["completion"];
  displayName: string;
}

/** The unified saved info of one item across every connector that saved it. */
export interface SavedInfo {
  sources: readonly SavedSource[];
}

/**
 * One merged "My Stuff" row: the canonical item with everything the three
 * sources know about it. The presenter projects these rows into sections.
 */
export interface MergedRow {
  itemId: string;
  item: EntertainmentItem;
  title: string;
  /** Union of source icons across sources (first-appearance order). */
  sources: readonly SourceIcon[];
  /** Union of realization badges across sources (first-appearance order). */
  realizations: readonly RealizationBadge[];
  lastTouchedAt: string;
  saved?: SavedInfo;
  watch?: WatchState;
  /** 0..n completed downloads for the item (input order). */
  downloads: readonly DownloadInfo[];
}

/** The unification result: merged rows + typed conflict rows. */
export interface MergedLibrary {
  rows: readonly MergedRow[];
  conflicts: readonly ConflictRow[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The frozen Media Surface precedence order (native → embed → browser → external). */
const MODE_PRECEDENCE: readonly PlaybackMode[] = ["native", "embed", "browser", "external"];

/** The capability that produces each playback mode. */
const CAPABILITY_FOR_MODE: Readonly<Record<PlaybackMode, string>> = {
  native: "playNative",
  embed: "playEmbed",
  browser: "playBrowser",
  external: "playExternal",
};

/**
 * The best playback mode a realization's capabilities admit, by the frozen
 * precedence order — `undefined` when the realization carries no play
 * capability (honestly badge-less, never guessed).
 */
function preferredMode(capabilities: readonly string[]): PlaybackMode | undefined {
  for (const mode of MODE_PRECEDENCE) {
    if (capabilities.includes(CAPABILITY_FOR_MODE[mode])) return mode;
  }
  return undefined;
}

/** Codepoint string comparison (locale-independent, deterministic). */
function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableItem(value: unknown): value is EntertainmentItem {
  return isRecord(value) && isNonEmptyString(value.id);
}

/** Track a max-timestamp (epoch) and the ISO string that produced it. */
class LatestTimestamp {
  private epochMs = Number.NEGATIVE_INFINITY;
  private iso = "";

  /** Offer one ISO candidate; ties keep the first-collected value. */
  offer(iso: string | undefined): void {
    if (iso === undefined) return;
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return; // malformed timestamps never win (defensive)
    if (at > this.epochMs) {
      this.epochMs = at;
      this.iso = iso;
    }
  }

  value(): string {
    return this.iso;
  }
}

/** Union accumulator for icons and badges (first-appearance order, keyed dedupe). */
class UnionAccumulator<T> {
  private readonly items: T[] = [];
  private readonly keys = new Set<string>();

  offer(key: string, item: T): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.items.push(item);
  }

  values(): readonly T[] {
    return this.items;
  }
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function assertValidConnectorEntries(entries: readonly ConnectorLibraryEntry[]): void {
  if (!Array.isArray(entries)) {
    throw new ExperienceError("connectorEntries: expected an array of ConnectorLibraryEntry");
  }
  entries.forEach((input, index) => {
    if (!isRecord(input)) {
      throw new ExperienceError(
        `connectorEntries[${index}]: expected a ConnectorLibraryEntry object`,
      );
    }
    const problems: string[] = [];
    if (!isNonEmptyString(input.connectorId)) {
      problems.push(
        `connectorEntries[${index}].connectorId: expected a non-empty string, got ${previewValue(input.connectorId)}`,
      );
    }
    if (!isNonEmptyString(input.displayName)) {
      problems.push(
        `connectorEntries[${index}].displayName: expected a non-empty string, got ${previewValue(input.displayName)}`,
      );
    }
    if (!isRecord(input.entry)) {
      problems.push(
        `connectorEntries[${index}].entry: expected a LibraryEntry object, got ${previewValue(input.entry)}`,
      );
    } else {
      if (input.entry.connectorId !== input.connectorId) {
        problems.push(
          `connectorEntries[${index}].entry.connectorId: '${String(input.entry.connectorId)}' does not match the declared connectorId '${String(input.connectorId)}'`,
        );
      }
      if (!isNonEmptyString(input.entry.externalRef)) {
        problems.push(
          `connectorEntries[${index}].entry.externalRef: expected a non-empty string, got ${previewValue(input.entry.externalRef)}`,
        );
      }
      if (!isNonEmptyString(input.entry.title)) {
        problems.push(
          `connectorEntries[${index}].entry.title: expected a non-empty string, got ${previewValue(input.entry.title)}`,
        );
      }
    }
    if (!isUsableItem(input.item)) {
      problems.push(
        `connectorEntries[${index}].item: expected an EntertainmentItem with a non-empty id, got ${previewValue(input.item)}`,
      );
    }
    if (!isRecord(input.sync) || typeof input.sync.kind !== "string") {
      problems.push(
        `connectorEntries[${index}].sync: expected an EntrySyncState, got ${previewValue(input.sync)}`,
      );
    }
    if (problems.length > 0) throw new ExperienceError(problems);
  });
}

function assertValidWatchHistory(history: readonly WatchHistoryInput[]): void {
  if (!Array.isArray(history)) {
    throw new ExperienceError("watchHistory: expected an array of WatchHistoryInput");
  }
  history.forEach((input, index) => {
    if (!isRecord(input)) {
      throw new ExperienceError(`watchHistory[${index}]: expected a WatchHistoryInput object`);
    }
    if (!isRecord(input.state) || !isNonEmptyString(input.state.itemId)) {
      throw new ExperienceError(
        `watchHistory[${index}].state: expected a WatchState with a non-empty itemId, got ${previewValue(input.state)}`,
      );
    }
    if (!isUsableItem(input.item)) {
      throw new ExperienceError(
        `watchHistory[${index}].item: expected an EntertainmentItem with a non-empty id, got ${previewValue(input.item)}`,
      );
    }
    if (input.state.itemId !== input.item.id) {
      throw new ExperienceError(
        `watchHistory[${index}]: state.itemId '${input.state.itemId}' does not match item.id '${input.item.id}'`,
      );
    }
  });
}

function assertValidCompletions(completions: readonly DownloadCompletionInput[]): void {
  if (!Array.isArray(completions)) {
    throw new ExperienceError("completions: expected an array of DownloadCompletionInput");
  }
  const seenIds = new Set<string>();
  completions.forEach((input, index) => {
    if (!isRecord(input)) {
      throw new ExperienceError(
        `completions[${index}]: expected a DownloadCompletionInput object`,
      );
    }
    const problems: string[] = [];
    if (!isRecord(input.completion) || !isNonEmptyString(input.completion.id)) {
      problems.push(
        `completions[${index}].completion: expected a DownloadCompletion with a non-empty id, got ${previewValue(input.completion)}`,
      );
    } else {
      if (seenIds.has(input.completion.id)) {
        problems.push(
          `completions[${index}].completion.id: duplicate download completion id '${input.completion.id}' (row identity violation)`,
        );
      } else {
        seenIds.add(input.completion.id);
      }
      if (!isNonEmptyString(input.completion.itemId)) {
        problems.push(
          `completions[${index}].completion.itemId: expected a non-empty string, got ${previewValue(input.completion.itemId)}`,
        );
      }
      if (!isNonEmptyString(input.completion.connectorId)) {
        problems.push(
          `completions[${index}].completion.connectorId: expected a non-empty string, got ${previewValue(input.completion.connectorId)}`,
        );
      }
      if (typeof input.completion.completedAt !== "string") {
        problems.push(
          `completions[${index}].completion.completedAt: expected an ISO 8601 string, got ${previewValue(input.completion.completedAt)}`,
        );
      }
    }
    if (!isNonEmptyString(input.displayName)) {
      problems.push(
        `completions[${index}].displayName: expected a non-empty string, got ${previewValue(input.displayName)}`,
      );
    }
    if (!isUsableItem(input.item)) {
      problems.push(
        `completions[${index}].item: expected an EntertainmentItem with a non-empty id, got ${previewValue(input.item)}`,
      );
    }
    if (
      isRecord(input.completion) &&
      isUsableItem(input.item) &&
      input.completion.itemId !== input.item.id
    ) {
      problems.push(
        `completions[${index}]: completion.itemId '${String(input.completion.itemId)}' does not match item.id '${input.item.id}'`,
      );
    }
    if (problems.length > 0) throw new ExperienceError(problems);
  });
}

// ---------------------------------------------------------------------------
// Conflict suggestions (deterministic, explicit — never auto-applied)
// ---------------------------------------------------------------------------

function conflictSuggestions(
  removedDisplayNames: readonly string[],
): readonly ConflictSuggestion[] {
  const where = removedDisplayNames.length > 0 ? removedDisplayNames.join(", ") : "the source";
  return [
    {
      action: "keep-local",
      label: "Keep in My Stuff",
      detail: `The local row and its watch state stay; ${where} stays without the entry.`,
    },
    {
      action: "re-save",
      label: "Save again",
      detail: `Plan a new save command for ${where} through the library pipeline (a fresh client request token).`,
    },
    {
      action: "dismiss",
      label: "Remove from My Stuff",
      detail: "Drop the local row; the watch history stays queryable through the fold.",
    },
  ];
}

// ---------------------------------------------------------------------------
// The unification
// ---------------------------------------------------------------------------

/**
 * Merge the three sources into per-item rows + typed conflict rows (see the
 * module doc). Pure: the injected inputs are never mutated; the returned
 * rows reference them.
 */
export function mergeLibraryViews(
  connectorEntries: readonly ConnectorLibraryEntry[],
  watchHistory: readonly WatchHistoryInput[],
  completions: readonly DownloadCompletionInput[],
): MergedLibrary {
  assertValidConnectorEntries(connectorEntries);
  assertValidWatchHistory(watchHistory);
  assertValidCompletions(completions);

  interface Bucket {
    itemId: string;
    item: EntertainmentItem;
    fallbackTitles: string[];
    icons: UnionAccumulator<SourceIcon>;
    badges: UnionAccumulator<RealizationBadge>;
    latest: LatestTimestamp;
    savedSources: SavedSource[];
    watch?: WatchState;
    watchResumeSessionId?: string;
    downloads: DownloadInfo[];
    removedRemotely: { displayName: string; observedAt: string }[];
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (item: EntertainmentItem): Bucket => {
    const existing = buckets.get(item.id);
    if (existing !== undefined) return existing;
    const fresh: Bucket = {
      itemId: item.id,
      item,
      fallbackTitles: [],
      icons: new UnionAccumulator<SourceIcon>(),
      badges: new UnionAccumulator<RealizationBadge>(),
      latest: new LatestTimestamp(),
      savedSources: [],
      downloads: [],
      removedRemotely: [],
    };
    buckets.set(item.id, fresh);
    return fresh;
  };

  // (a) connector entries — saved sources, icons, entry badges.
  for (const input of connectorEntries) {
    const bucket = bucketFor(input.item);
    bucket.icons.offer(input.connectorId, {
      connectorId: input.connectorId,
      displayName: input.displayName,
    });
    bucket.fallbackTitles.push(input.entry.title);
    for (const name of resolveListNames(input.entry.metadata)) {
      const source: SavedSource = {
        connectorId: input.connectorId,
        displayName: input.displayName,
        externalRef: input.entry.externalRef,
        title: input.entry.title,
        listName: name,
        sync: input.sync,
      };
      if (input.entry.addedAt !== undefined) source.addedAt = input.entry.addedAt;
      bucket.savedSources.push(source);
    }
    // Sync timestamps feed last-touched.
    if (input.entry.addedAt !== undefined) bucket.latest.offer(input.entry.addedAt);
    const sync = input.sync;
    switch (sync.kind) {
      case "synced":
        bucket.latest.offer(sync.lastSyncedAt);
        break;
      case "pending":
        bucket.latest.offer(sync.since);
        break;
      case "failed":
      case "unsupported":
      case "conflict":
        // Terminal command states carry no timestamp in the mirror; the
        // entry's addedAt (offered above) remains the row's evidence.
        break;
      case "removed-remotely":
        bucket.latest.offer(sync.observedAt);
        bucket.removedRemotely.push({ displayName: input.displayName, observedAt: sync.observedAt });
        break;
      default:
        break;
    }
    // Entry realizations (SourceRealization): badge mode from capabilities.
    if (input.realizations !== undefined) {
      for (const realization of input.realizations) {
        if (!isRecord(realization) || !isNonEmptyString(realization.connectorId)) continue;
        const mode = preferredMode(realization.capabilities ?? []);
        if (mode === undefined) continue;
        const key = `${realization.connectorId}|${mode}|${String(realization.externalRef ?? "")}`;
        bucket.badges.offer(key, {
          connectorId: realization.connectorId,
          mode,
          ...(realization.externalRef !== undefined ? { externalRef: realization.externalRef } : {}),
          label: `${input.displayName} (${mode})`,
        });
      }
    }
  }

  // (b) watch history — state, session badges, icons from known names.
  for (const input of watchHistory) {
    const bucket = bucketFor(input.item);
    bucket.watch = input.state;
    if (input.lastSession !== undefined) {
      bucket.watchResumeSessionId = input.lastSession.id;
    }
    bucket.latest.offer(input.state.lastWatchedAt);
    if (input.realizations !== undefined) {
      for (const realization of input.realizations) {
        if (!isRecord(realization) || !isNonEmptyString(realization.connectorId)) continue;
        const displayNames = input.displayNames ?? {};
        const known = displayNames[realization.connectorId];
        const displayName =
          typeof known === "string" ? known : realization.connectorId; // honest fallback — never fabricated
        bucket.icons.offer(realization.connectorId, {
          connectorId: realization.connectorId,
          displayName,
        });
        const key = `${realization.connectorId}|${realization.mode}|${String(realization.externalRef ?? "")}`;
        bucket.badges.offer(key, {
          connectorId: realization.connectorId,
          mode: realization.mode,
          ...(realization.externalRef !== undefined ? { externalRef: realization.externalRef } : {}),
          label: `${displayName} (${realization.mode})`,
        });
      }
    }
  }

  // (c) completions — downloads, icons, native badges.
  for (const input of completions) {
    const bucket = bucketFor(input.item);
    const completion = input.completion;
    bucket.icons.offer(completion.connectorId, {
      connectorId: completion.connectorId,
      displayName: input.displayName,
    });
    const key = `${completion.connectorId}|native|${completion.id}`;
    bucket.badges.offer(key, {
      connectorId: completion.connectorId,
      mode: "native",
      label: `${input.displayName} (native download)`,
    });
    bucket.latest.offer(completion.completedAt);
    bucket.downloads.push({ completion, displayName: input.displayName });
  }

  // Project buckets into merged rows.
  const rows: MergedRow[] = [];
  for (const bucket of buckets.values()) {
    // A removed-remotely entry with NO local watch state and nothing else is
    // omitted (documented: not a conflict — nothing local to conflict with).
    const hasLocalEvidence =
      bucket.watch !== undefined || bucket.downloads.length > 0;
    const onlyStaleSaved =
      bucket.savedSources.length > 0 &&
      bucket.savedSources.every((source) => source.sync.kind === "removed-remotely") &&
      !hasLocalEvidence;
    if (onlyStaleSaved) continue;

    const row: MergedRow = {
      itemId: bucket.itemId,
      item: bucket.item,
      title: resolveRowTitle(bucket.item, bucket.fallbackTitles),
      sources: bucket.icons.values(),
      realizations: bucket.badges.values(),
      lastTouchedAt: bucket.latest.value(),
      downloads: bucket.downloads,
    };
    if (bucket.savedSources.length > 0) {
      row.saved = { sources: bucket.savedSources };
    }
    if (bucket.watch !== undefined) {
      row.watch = bucket.watch;
    }
    rows.push(row);
  }

  rows.sort((a, b) => {
    const aMs = Date.parse(a.lastTouchedAt);
    const bMs = Date.parse(b.lastTouchedAt);
    return bMs - aMs || compareCodepoint(a.itemId, b.itemId);
  });

  // Conflict rows: remote says removed + local watch state exists.
  const conflicts: ConflictRow[] = [];
  for (const row of rows) {
    if (row.watch === undefined) continue;
    const removed = row.saved?.sources.filter((source) => source.sync.kind === "removed-remotely") ?? [];
    if (removed.length === 0) continue;
    const observed = new LatestTimestamp();
    for (const source of removed) {
      if (source.sync.kind === "removed-remotely") observed.offer(source.sync.observedAt);
    }
    const names = removed.map((source) => source.displayName);
    const ratioText =
      row.watch.completionRatio !== null
        ? `${Math.round(row.watch.completionRatio * 100)}% watched`
        : "watched";
    const detail =
      `Removed at ${names.join(", ")} but locally ${row.watch.status} (${ratioText}, ` +
      `last watched ${row.watch.lastWatchedAt}). Choose an action — nothing is auto-resolved.`;
    const conflict: ConflictRow = {
      kind: "conflict",
      rowId: `conflict:${row.itemId}`,
      itemId: row.itemId,
      item: row.item,
      title: row.title,
      sources: row.sources,
      realizations: row.realizations,
      lastTouchedAt: row.lastTouchedAt,
      detail,
      observedAt: observed.value(),
      suggestions: conflictSuggestions(names),
      a11y: {
        label: `Library conflict: ${row.title}`,
        description: detail,
      },
    };
    conflicts.push(conflict);
  }

  conflicts.sort((a, b) => compareCodepoint(a.itemId, b.itemId));
  return { rows, conflicts };
}
