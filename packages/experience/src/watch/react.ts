/**
 * @wfx/experience — Watch Feed React wiring (WFX-027, Lane C).
 *
 * REACT TYPES ARE NOT AVAILABLE in this workspace (verified at the dispatch
 * base f095877: no `react` and no `@types/react` in any package.json or
 * node_modules of the monorepo), and the dispatch FORBIDS adding
 * dependencies to packages/experience. A React component therefore cannot
 * live in this package — this module is the DOCUMENTED WIRING instead (the
 * WFX-026 note pattern; the exact same decision WFX-029's library presenter
 * recorded). It is pure data + a pure function: no react import, no JSX, no
 * runtime dependency.
 *
 * WHAT THIS MODULE PROVIDES
 * -------------------------
 * `watchFeedElementTree(view)` renders any `WatchFeedView` into a typed,
 * framework-neutral ELEMENT TREE (`WatchFeedElement`): hero, row headers,
 * cards, text, and typed placeholders. Every interactive element (hero,
 * card) carries its `A11yLabel` verbatim and a stable React-ready `key`.
 * The tree is a faithful, total projection of the view — the app shell
 * renders it, this package never does.
 *
 * THE WIRING CONTRACT FOR THE APP SHELL (WFX-026 browser surface et al.)
 * ---------------------------------------------------------------------
 * 1. Data flow (the host owns fetching — this model is fetch-free):
 *      OS FeedPage + session context
 *        -> presenter.build(page | { kind: "loading" | "failed" }, context)
 *        -> WatchFeedView
 *        -> watchFeedElementTree(view)
 *        -> the shell's React components
 *    While the OS page is in flight, build with `{ kind: "loading" }`; on
 *    failure, build with `{ kind: "failed", detail }` — both render their
 *    typed placeholders below. Re-invoke `build` whenever the page, the
 *    context, or the relations port answer changes; it is pure.
 *
 * 2. Element mapping (each node maps to one React element):
 *    - `hero`    -> a prominent `<article>` (or `<button>`) with
 *      `aria-label={\`${a11y.title}. ${a11y.position}. ${a11y.action}\`}`;
 *      `badgeText` renders as the realization badge.
 *    - `row-header` -> the row's `<h2>`/`<section>` header: `title` visible,
 *      `reason` as `aria-description` (explainability is announced).
 *    - `card`    -> a focusable card element with the same aria-label
 *      composition; `badgeText` (null ⇒ no badge is rendered — a typed-absent
 *      badge is never a greyed-out lie).
 *    - `text`    -> plain text content.
 *    - `placeholder` -> the loading/error/empty state surface; `detail`
 *      renders the failure text.
 *    Every element's `key` is the React list key VERBATIM (stable across
 *    rebuilds — deterministic ids, no array indices).
 *
 * 3. Resume activation: on hero/card activation the shell calls the WFX-005
 *    playback use-case with a `PlaybackIntent` built from the entry
 *    (`itemId`, the chosen realization, `resumePositionMs`); resume.ts's
 *    `planResume` produces the typed event the use-case emits.
 *
 * 4. When react types land in this workspace (a lead decision), the adapter
 *    is a thin `React.createElement` walk over this tree — nothing in the
 *    view model or the presenter changes.
 */

import type {
  A11yLabel,
  ContinueWatchingRow,
  EpisodicRow,
  FeedRow,
  TopicRow,
  WatchFeedView,
} from "./view";

// ---------------------------------------------------------------------------
// The element tree (framework-neutral, React-ready keys, a11y verbatim)
// ---------------------------------------------------------------------------

/** One node of the framework-neutral Watch Feed element tree. */
export type WatchFeedElement =
  | {
      type: "hero";
      /** React list key (verbatim). */
      key: string;
      /** The interactive element's accessibility label. */
      a11y: A11yLabel;
      /** The realization badge label; null ⇒ render no badge. */
      badgeText: string | null;
      children: readonly WatchFeedElement[];
    }
  | {
      type: "row-header";
      key: string;
      /** The visible row header text. */
      title: string;
      /** The row's explainability reason (announce as description). */
      reason: string;
    }
  | {
      type: "card";
      key: string;
      a11y: A11yLabel;
      badgeText: string | null;
      children: readonly WatchFeedElement[];
    }
  | { type: "text"; key: string; text: string }
  | {
      type: "placeholder";
      key: string;
      state: "loading" | "error" | "empty";
      /** Present iff `state` is "error": the failure text. */
      detail?: string;
    };

/** The card text of one continue entry (title + progress, deterministic). */
function continueCardTexts(row: ContinueWatchingRow): readonly WatchFeedElement[] {
  return row.entries.map((entry) => ({
    type: "text" as const,
    key: `text:${row.rowId}:${entry.item.id}`,
    text:
      entry.completionRatio !== null
        ? `${entry.title} — ${Math.round(entry.completionRatio * 100)}% watched`
        : `${entry.title} — position ${Math.floor(entry.resumePositionMs / 1000)}s`,
  }));
}

/** The card texts of one episodic row (coordinates + markers, deterministic). */
function episodicCardTexts(row: EpisodicRow): readonly WatchFeedElement[] {
  return row.entries.map((entry) => ({
    type: "text" as const,
    key: `text:${row.rowId}:${entry.item.id}`,
    text:
      entry.newSeason !== undefined
        ? `S${entry.season}E${entry.episode} ${entry.title} — New season`
        : `S${entry.season}E${entry.episode} ${entry.title}`,
  }));
}

/** The card texts of one topic row. */
function topicCardTexts(row: TopicRow): readonly WatchFeedElement[] {
  return row.entries.map((entry) => ({
    type: "text" as const,
    key: `text:${row.rowId}:${entry.item.id}`,
    text: entry.title,
  }));
}

/** One row's element subtree: header + cards (a11y on every card). */
function rowElements(row: FeedRow): readonly WatchFeedElement[] {
  const header: WatchFeedElement = {
    type: "row-header",
    key: `row-header:${row.rowId}`,
    title: row.title,
    reason: row.reason,
  };

  const texts: readonly WatchFeedElement[] =
    row.kind === "continue"
      ? continueCardTexts(row)
      : row.kind === "episodic"
        ? episodicCardTexts(row)
        : topicCardTexts(row);

  const entries: readonly { a11y: A11yLabel; itemId: string; badgeText: string | null }[] =
    row.kind === "continue"
      ? row.entries.map((entry) => ({
          a11y: entry.a11y,
          itemId: entry.item.id,
          badgeText: entry.realizationBadge !== null ? entry.realizationBadge.label : null,
        }))
      : row.kind === "episodic"
        ? row.entries.map((entry) => ({
            a11y: entry.a11y,
            itemId: entry.item.id,
            badgeText: null,
          }))
        : row.entries.map((entry) => ({ a11y: entry.a11y, itemId: entry.item.id, badgeText: null }));

  const cards: WatchFeedElement[] = entries.map((entry, index) => ({
    type: "card",
    key: `card:${row.rowId}:${entry.itemId}`,
    a11y: entry.a11y,
    badgeText: entry.badgeText,
    children: [
      texts[index] ?? {
        type: "text",
        key: `text:${row.rowId}:${entry.itemId}`,
        text: entry.a11y.title,
      },
    ],
  }));
  return [header, ...cards];
}

/**
 * Render one `WatchFeedView` into the framework-neutral element tree (see
 * the module doc for the wiring contract). Pure and total: every view state
 * maps to a non-empty tree (placeholders for loading/error/empty).
 */
export function watchFeedElementTree(view: WatchFeedView): readonly WatchFeedElement[] {
  if (view.state === "loading") {
    return [{ type: "placeholder", key: "watch-feed-loading", state: "loading" }];
  }
  if (view.state === "error") {
    return [
      {
        type: "placeholder",
        key: "watch-feed-error",
        state: "error",
        ...(view.errorDetail !== undefined ? { detail: view.errorDetail } : {}),
      },
    ];
  }
  if (view.state === "empty") {
    return [{ type: "placeholder", key: "watch-feed-empty", state: "empty" }];
  }

  const elements: WatchFeedElement[] = [];
  if (view.hero !== undefined) {
    elements.push({
      type: "hero",
      key: `hero:${view.hero.item.id}`,
      a11y: view.hero.a11y,
      badgeText: view.hero.realizationBadge !== null ? view.hero.realizationBadge.label : null,
      children: [
        {
          type: "text",
          key: `hero-text:${view.hero.item.id}`,
          text:
            view.hero.kind === "resume"
              ? `${view.hero.title} — ${view.hero.completionRatio !== null ? `${Math.round(view.hero.completionRatio * 100)}% watched` : "in progress"}`
              : view.hero.title,
        },
      ],
    });
  }
  for (const row of view.rows) {
    elements.push(...rowElements(row));
  }
  if (elements.length === 0) {
    // Defensive: a "ready" view with neither hero nor rows renders the empty
    // placeholder — the tree is never empty for a ready view in practice.
    return [{ type: "placeholder", key: "watch-feed-empty", state: "empty" }];
  }
  return elements;
}
