/**
 * @wfx/experience — the library presenter (WFX-029, Lane C).
 *
 * `createLibraryPresenter(deps)` assembles the unified `LibraryView` from
 * the three injected sources (framework-neutral core; a `react.ts` binding
 * is deliberately ABSENT — react types are not available in this package
 * and the dispatch forbids new dependencies, the same rule WFX-026/027/028
 * were held to).
 *
 * Policy (typed, deterministic):
 *
 * - SECTION ORDER: Continue first, then Saved, Downloads, Finished
 *   (`LIBRARY_SECTION_ORDER` — resume beats everything).
 * - EMPTY-SECTION SUPPRESSION: a section whose backing source is LOADED and
 *   yields zero rows is OMITTED from `view.sections` (an empty section is
 *   the absence of a section). Sections whose source is still `loading` or
 *   `failed` are NOT suppressed — they render as typed placeholders
 *   (`SectionStatus.state`, `errorDetail`), because a missing section and
 *   an unloaded section are different truths.
 * - COMPOSITE SECTIONS: the Finished section draws from TWO sources (watch
 *   history + completions). Its status is `ready` when at least one
 *   contributor is loaded (rows reflect the loaded contributors only),
 *   `error` when every contributor failed (details joined), `loading`
 *   otherwise. Documented — partial finished data is honest, not hidden.
 * - PLACEHOLDER STATES (typed, per the packet): the overall
 *   `LibraryPresentation.state` is:
 *     `loading` — no source has produced data yet and at least one may
 *                 still load (no view; failure details surface as soon as
 *                 data lands or everything fails);
 *     `error`   — every source failed (no view; failures listed);
 *     `partial` — some data + at least one loading-or-failed source (view);
 *     `empty`   — all sources loaded, zero rows and zero conflicts (view
 *                 with all sections suppressed);
 *     `ready`   — everything loaded with rows and/or conflicts (view).
 * - A11Y ON EVERY ROW: every row of every section (and every conflict row)
 *   carries non-empty `a11y.label` + `a11y.description` (continue rows also
 *   carry `a11y.progress` when the ratio is known). Deterministic strings.
 * - ROW ORDERING: continue/finished rows by last-touched desc, itemId asc;
 *   saved groups by listName asc (codepoint) with rows by last-touched desc,
 *   itemId asc; download rows by completedAt desc, rowId asc.
 *
 * Purity: `present()` is a pure function of the deps (no clock, no
 * randomness, no mutation — injected inputs are only read). The presenter
 * is re-invoked by the host whenever a source state changes.
 *
 * Error channel: malformed deps (unknown state kinds, non-array data)
 * throw the typed `ExperienceError` (the package's caller-misuse channel).
 */

import { ExperienceError } from "../ports";
import { mergeLibraryViews } from "./merge";
import type { MergedRow } from "./merge";
import {
  LIBRARY_SECTION_ORDER,
  SECTION_TITLES,
  type ConnectorLibraryEntry,
  type ContinueRow,
  type DownloadCompletionInput,
  type DownloadRow,
  type FinishedRow,
  type LibrarySection,
  type LibraryView,
  type SavedGroup,
  type SavedRow,
  type WatchHistoryInput,
} from "./model";

// ---------------------------------------------------------------------------
// Source states (typed placeholders for the injected data seams)
// ---------------------------------------------------------------------------

/** The load state of one injected source (typed placeholder). */
export type SourceLoadState<T> =
  | { kind: "loading" }
  | { kind: "loaded"; data: T }
  | { kind: "failed"; detail: string };

/** The three sources the presenter consumes. */
export type LibrarySourceName = "connector-entries" | "watch-history" | "completions";

/** Every source name, in fixed order. */
export const LIBRARY_SOURCE_NAMES: readonly LibrarySourceName[] = [
  "connector-entries",
  "watch-history",
  "completions",
];

/** The presenter's dependency bundle: the three source states. */
export interface LibraryPresenterDeps {
  connectorEntries: SourceLoadState<readonly ConnectorLibraryEntry[]>;
  watchHistory: SourceLoadState<readonly WatchHistoryInput[]>;
  completions: SourceLoadState<readonly DownloadCompletionInput[]>;
}

/** The overall surface state (see the module doc for the exact policy). */
export type LibrarySurfaceState = "loading" | "error" | "partial" | "empty" | "ready";

/** One failed source, listed when the presentation state is `error`. */
export interface SourceFailure {
  source: LibrarySourceName;
  detail: string;
}

/**
 * The typed presentation result: the surface state plus the view (present
 * unless the state is `loading` or a total `error`) and the failure list
 * (present when any source failed).
 */
export interface LibraryPresentation {
  state: LibrarySurfaceState;
  /** Present unless `state` is `"loading"` or `"error"`. */
  view?: LibraryView;
  /** Present when the state is `"error"`: every source failure. */
  failures?: readonly SourceFailure[];
}

/** The presenter surface: `present()` is pure over the deps given at construction. */
export interface LibraryPresenter {
  present(): LibraryPresentation;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function assertValidSource<T>(
  source: SourceLoadState<T>,
  name: LibrarySourceName,
): void {
  if (!isRecord(source) || typeof source.kind !== "string") {
    throw new ExperienceError(
      `deps.${name}: expected a SourceLoadState (loading | loaded | failed), got ${JSON.stringify(source) ?? String(source)}`,
    );
  }
  if (source.kind === "loaded" && !Array.isArray(source.data)) {
    throw new ExperienceError(
      `deps.${name}.data: expected an array when the source is loaded, got ${String(source.data)}`,
    );
  }
  if (source.kind === "failed" && typeof source.detail !== "string") {
    throw new ExperienceError(
      `deps.${name}.detail: expected a string when the source is failed, got ${String(source.detail)}`,
    );
  }
}

function loadedData<T>(source: SourceLoadState<T>): T | undefined {
  return source.kind === "loaded" ? source.data : undefined;
}

function failureDetail(source: SourceLoadState<unknown>): string | undefined {
  return source.kind === "failed" ? source.detail : undefined;
}

/** Format a ratio as a deterministic percent announcement ("45% watched"). */
function percentText(ratio: number | null): string | undefined {
  if (ratio === null) return undefined;
  return `${Math.round(ratio * 100)}% watched`;
}

/** ISO epoch (NaN-safe: malformed timestamps sort last, never crash). */
function epochOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

// ---------------------------------------------------------------------------
// Row projection (merged rows → section rows, with a11y on every row)
// ---------------------------------------------------------------------------

function continueRowOf(row: MergedRow): ContinueRow {
  if (row.watch === undefined) {
    // Unreachable: only rows with watch state project to Continue.
    throw new ExperienceError(`internal: continue projection of a watch-less row '${row.itemId}'`);
  }
  const progress = percentText(row.watch.completionRatio);
  const statusText =
    row.watch.status === "skipped" ? "skipped, resumable" : "in progress";
  const a11y = {
    label: `Continue watching: ${row.title}`,
    description: `${statusText}; last touched ${row.lastTouchedAt}.`,
    ...(progress !== undefined ? { progress } : {}),
  };
  const projected: ContinueRow = {
    kind: "continue",
    rowId: `continue:${row.itemId}`,
    itemId: row.itemId,
    item: row.item,
    title: row.title,
    sources: row.sources,
    realizations: row.realizations,
    lastTouchedAt: row.lastTouchedAt,
    positionMs: row.watch.lastPositionMs,
    completionRatio: row.watch.completionRatio,
    // Only "in-progress" and "skipped" watch states project here (the
    // caller filters completed rows out before projecting).
    watchStatus: row.watch.status === "completed" ? "in-progress" : row.watch.status,
    a11y,
  };
  return projected;
}

function savedRowsOf(row: MergedRow): SavedRow[] {
  if (row.saved === undefined) return [];
  const listNames: string[] = [];
  for (const source of row.saved.sources) {
    if (!listNames.includes(source.listName)) listNames.push(source.listName);
  }
  return listNames.map((listName) => {
    const syncKinds = row.saved?.sources.map((source) => source.sync.kind).join(", ") ?? "";
    const projected: SavedRow = {
      kind: "saved",
      rowId: `saved:${listName}:${row.itemId}`,
      itemId: row.itemId,
      item: row.item,
      title: row.title,
      sources: row.sources,
      realizations: row.realizations,
      lastTouchedAt: row.lastTouchedAt,
      listName,
      savedSources: row.saved?.sources ?? [],
      a11y: {
        label: `Saved: ${row.title}`,
        description: `In list ${listName}; sync state ${syncKinds}; last touched ${row.lastTouchedAt}.`,
      },
    };
    return projected;
  });
}

function downloadRowsOf(row: MergedRow): DownloadRow[] {
  return row.downloads.map((info) => {
    const projected: DownloadRow = {
      kind: "download",
      rowId: `download:${info.completion.id}`,
      itemId: row.itemId,
      item: row.item,
      title: row.title,
      sources: row.sources,
      realizations: row.realizations,
      lastTouchedAt: row.lastTouchedAt,
      completedAt: info.completion.completedAt,
      ...(info.completion.fileSizeBytes !== undefined
        ? { fileSizeBytes: info.completion.fileSizeBytes }
        : {}),
      ...(info.completion.localPath !== undefined
        ? { localPath: info.completion.localPath }
        : {}),
      a11y: {
        label: `Downloaded: ${row.title}`,
        description: `Completed ${info.completion.completedAt} from ${info.displayName}; last touched ${row.lastTouchedAt}.`,
      },
    };
    return projected;
  });
}

function finishedRowOf(row: MergedRow): FinishedRow | undefined {
  const watched = row.watch !== undefined && row.watch.status === "completed";
  const downloaded = row.downloads.length > 0;
  if (!watched && !downloaded) return undefined;
  const via: ("watched" | "downloaded")[] = [];
  if (watched) via.push("watched");
  if (downloaded) via.push("downloaded");
  let finishedAt = watched && row.watch !== undefined ? row.watch.lastWatchedAt : "";
  for (const info of row.downloads) {
    if (epochOf(info.completion.completedAt) > epochOf(finishedAt)) {
      finishedAt = info.completion.completedAt;
    }
  }
  return {
    kind: "finished",
    rowId: `finished:${row.itemId}`,
    itemId: row.itemId,
    item: row.item,
    title: row.title,
    sources: row.sources,
    realizations: row.realizations,
    lastTouchedAt: row.lastTouchedAt,
    finishedVia: via,
    finishedAt,
    a11y: {
      label: `Finished: ${row.title}`,
      description: `Finished via ${via.join(" + ")}; finished ${finishedAt}.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Section assembly
// ---------------------------------------------------------------------------

function statusOf(
  contributors: readonly { loaded: boolean; failed?: string }[],
): { state: "loading" | "error" | "ready"; errorDetail?: string } {
  const loaded = contributors.some((contributor) => contributor.loaded);
  if (loaded) return { state: "ready" };
  const failures = contributors.filter((contributor) => contributor.failed !== undefined);
  if (failures.length === contributors.length && contributors.length > 0) {
    return { state: "error", errorDetail: failures.map((f) => f.failed).join("; ") };
  }
  return { state: "loading" };
}

// ---------------------------------------------------------------------------
// The presenter
// ---------------------------------------------------------------------------

/**
 * Build the library presenter over the three injected source states.
 * `present()` is pure: it re-runs the merge + projection on every call and
 * never mutates the deps. See the module doc for every policy.
 */
export function createLibraryPresenter(deps: LibraryPresenterDeps): LibraryPresenter {
  assertValidSource(deps.connectorEntries, "connector-entries");
  assertValidSource(deps.watchHistory, "watch-history");
  assertValidSource(deps.completions, "completions");

  return {
    present(): LibraryPresentation {
      const entries = loadedData(deps.connectorEntries);
      const history = loadedData(deps.watchHistory);
      const completions = loadedData(deps.completions);
      const entriesFailure = failureDetail(deps.connectorEntries);
      const historyFailure = failureDetail(deps.watchHistory);
      const completionsFailure = failureDetail(deps.completions);

      const loadedCount =
        (entries !== undefined ? 1 : 0) +
        (history !== undefined ? 1 : 0) +
        (completions !== undefined ? 1 : 0);
      const failedCount =
        (entriesFailure !== undefined ? 1 : 0) +
        (historyFailure !== undefined ? 1 : 0) +
        (completionsFailure !== undefined ? 1 : 0);
      const anyBad = failedCount > 0;
      const anyLoading = 3 - loadedCount - failedCount > 0;
      const allFailed = failedCount === 3;

      // Zero data so far: while any source may still load, "loading" is the
      // honest state (the failure details are not lost — they live in the
      // deps and surface as soon as data lands or everything fails).
      if (loadedCount === 0 && !allFailed) return { state: "loading" };
      if (loadedCount === 0 && allFailed) {
        const failures: SourceFailure[] = [];
        if (entriesFailure !== undefined) {
          failures.push({ source: "connector-entries", detail: entriesFailure });
        }
        if (historyFailure !== undefined) {
          failures.push({ source: "watch-history", detail: historyFailure });
        }
        if (completionsFailure !== undefined) {
          failures.push({ source: "completions", detail: completionsFailure });
        }
        return { state: "error", failures };
      }

      // Merge whatever is loaded (the pure unification handles the rest).
      const merged = mergeLibraryViews(
        entries ?? [],
        history ?? [],
        completions ?? [],
      );

      // Continue section — resume candidates (in-progress + skipped).
      const continueRows: ContinueRow[] = merged.rows
        .filter((row) => row.watch !== undefined && row.watch.status !== "completed")
        .map(continueRowOf);
      continueRows.sort(
        (a, b) =>
          epochOf(b.lastTouchedAt) - epochOf(a.lastTouchedAt) || compareCodepoint(a.itemId, b.itemId),
      );

      // Saved section — entries grouped by user lists.
      const savedRows = merged.rows.flatMap((row) => savedRowsOf(row));
      savedRows.sort(
        (a, b) =>
          epochOf(b.lastTouchedAt) - epochOf(a.lastTouchedAt) || compareCodepoint(a.itemId, b.itemId),
      );
      const groupNames: string[] = [];
      for (const row of savedRows) {
        if (!groupNames.includes(row.listName)) groupNames.push(row.listName);
      }
      groupNames.sort(compareCodepoint);
      const savedGroups: SavedGroup[] = groupNames.map((listName) => ({
        listName,
        rows: savedRows.filter((row) => row.listName === listName),
      }));

      // Downloads section — one row per completed download.
      const downloadRows = merged.rows.flatMap((row) => downloadRowsOf(row));
      downloadRows.sort(
        (a, b) =>
          epochOf(b.completedAt) - epochOf(a.completedAt) || compareCodepoint(a.rowId, b.rowId),
      );

      // Finished section — completed watches + completed downloads.
      const finishedRows = merged.rows
        .map((row) => finishedRowOf(row))
        .filter((row): row is FinishedRow => row !== undefined);
      finishedRows.sort(
        (a, b) =>
          epochOf(b.lastTouchedAt) - epochOf(a.lastTouchedAt) || compareCodepoint(a.itemId, b.itemId),
      );

      // Section statuses (placeholders for unloaded/failed sources).
      const savedStatus = statusOf([
        { loaded: entries !== undefined, ...(entriesFailure !== undefined ? { failed: entriesFailure } : {}) },
      ]);
      const continueStatus = statusOf([
        { loaded: history !== undefined, ...(historyFailure !== undefined ? { failed: historyFailure } : {}) },
      ]);
      const downloadsStatus = statusOf([
        {
          loaded: completions !== undefined,
          ...(completionsFailure !== undefined ? { failed: completionsFailure } : {}),
        },
      ]);
      const finishedStatus = statusOf([
        { loaded: history !== undefined, ...(historyFailure !== undefined ? { failed: historyFailure } : {}) },
        {
          loaded: completions !== undefined,
          ...(completionsFailure !== undefined ? { failed: completionsFailure } : {}),
        },
      ]);

      const sectionsByKind = new Map<LibrarySection["kind"], LibrarySection>();
      sectionsByKind.set("continue", {
        kind: "continue",
        title: SECTION_TITLES["continue"],
        status: continueStatus,
        rows: continueStatus.state === "ready" ? continueRows : [],
      });
      sectionsByKind.set("saved", {
        kind: "saved",
        title: SECTION_TITLES["saved"],
        status: savedStatus,
        groups: savedStatus.state === "ready" ? savedGroups : [],
      });
      sectionsByKind.set("downloads", {
        kind: "downloads",
        title: SECTION_TITLES["downloads"],
        status: downloadsStatus,
        rows: downloadsStatus.state === "ready" ? downloadRows : [],
      });
      sectionsByKind.set("finished", {
        kind: "finished",
        title: SECTION_TITLES["finished"],
        status: finishedStatus,
        rows: finishedStatus.state === "ready" ? finishedRows : [],
      });

      // Ordered sections with EMPTY-SECTION SUPPRESSION: a ready section
      // with zero rows is omitted; loading/error sections stay (typed
      // placeholders — see the module doc).
      const sections: LibrarySection[] = [];
      for (const kind of LIBRARY_SECTION_ORDER) {
        const section = sectionsByKind.get(kind);
        if (section === undefined) continue;
        const isEmpty =
          section.status.state === "ready" &&
          (section.kind === "saved"
            ? section.groups.length === 0
            : section.rows.length === 0);
        if (isEmpty) continue;
        sections.push(section);
      }

      const totalRows =
        continueRows.length + savedRows.length + downloadRows.length + finishedRows.length;
      const state: LibrarySurfaceState =
        anyBad || anyLoading
          ? "partial"
          : totalRows === 0 && merged.conflicts.length === 0
            ? "empty"
            : "ready";

      const view: LibraryView = { sections, conflicts: merged.conflicts };
      const failures: SourceFailure[] | undefined = anyBad
        ? [
            ...(entriesFailure !== undefined
              ? [{ source: "connector-entries" as const, detail: entriesFailure }]
              : []),
            ...(historyFailure !== undefined
              ? [{ source: "watch-history" as const, detail: historyFailure }]
              : []),
            ...(completionsFailure !== undefined
              ? [{ source: "completions" as const, detail: completionsFailure }]
              : []),
          ]
        : undefined;

      return {
        state,
        view,
        ...(failures !== undefined ? { failures } : {}),
      };
    },
  };
}
