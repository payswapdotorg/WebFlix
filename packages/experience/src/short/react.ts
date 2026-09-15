/**
 * @wfx/experience — Short Feed React wiring (WFX-028, Lane C).
 *
 * REACT TYPES ARE NOT AVAILABLE in this workspace (verified at the dispatch
 * base ecdeff7: no `react` and no `@types/react` in any package.json or
 * node_modules of the monorepo — the same finding WFX-026/027 recorded), and
 * the dispatch FORBIDS adding dependencies to packages/experience. A React
 * component therefore cannot live in this package — this module is the
 * DOCUMENTED WIRING instead (the WFX-026/027 note pattern). It is pure data
 * + a pure function: no react import, no JSX, no runtime dependency.
 *
 * WHAT THIS MODULE PROVIDES
 * -------------------------
 * `shortFeedElementTree(view)` renders any `ShortFeedView` into a typed,
 * framework-neutral ELEMENT TREE (`ShortFeedElement`): the current card
 * (overlay + badge + engagement actions, a11y verbatim), the next-card
 * preview, and the typed placeholders (loading / error / empty). Every
 * interactive element carries its a11y label verbatim and a stable
 * React-ready `key`. The tree is a faithful, total projection of the view —
 * the app shell renders it, this package never does.
 *
 * THE WIRING CONTRACT FOR THE APP SHELL
 * -------------------------------------
 * 1. Data flow (the host owns fetching — this model is fetch-free):
 *      OS short FeedPage + session context
 *        -> presenter.initial(page | { kind: "loading" | "failed" }, context)
 *        -> ShortFeedView
 *        -> shortFeedElementTree(view)
 *        -> the shell's React components
 *    While the OS page is in flight, build with `{ kind: "loading" }`; on
 *    failure, build with `{ kind: "failed", detail }`. Re-invoke after every
 *    transition; the presenter methods are pure.
 *
 * 2. Element mapping (each node maps to one React element):
 *    - `card` (role "current") -> the full-screen vertical card `<article>`:
 *      `aria-label={\`${a11y.title}. ${a11y.position}. ${a11y.action}. ${a11y.affordances}\`}`;
 *      `overlayTitle` / `overlayTopic` (null ⇒ no topic line — typed-absent,
 *      never a placeholder lie); `badgeText` (null ⇒ no badge rendered);
 *      `children` carry the engagement actions.
 *    - `card` (role "next") -> the next-card preview (the peek behind the
 *      swipe): the same aria-label composition; no action children (the
 *      preview is not interactive).
 *    - `action` -> one engagement control: `like` / `save` fire the WFX-005
 *      use-case `runUserAction(ports, ctx, cardActionRequest(affordance))`
 *      with the card's affordance (see card.ts — absent affordances are
 *      OMITTED, never greyed-out lies); `share` is EVENT-ONLY: the shell
 *      emits the frozen "share" event via `shortFeedEvents` (share has no
 *      frozen UserAction — see card.ts's `CardShareAffordance`).
 *    - `placeholder` -> the loading/error/empty surface; `detail` renders
 *      the failure text.
 *    Every element's `key` is the React list key VERBATIM (stable across
 *    rebuilds — deterministic ids, no array indices).
 *
 * 3. Gestures (the UI layer owns gesture capture — this model never does):
 *    swipe-up/forward -> `presenter.swipeNext(view)`; swipe-down/back ->
 *    `presenter.swipeBack(view)` (bounded — the view transition says so).
 *    On a `swipe-next` transition with a stack event, the shell emits the
 *    left card's engagement event through `shortFeedEvents` — a "skip"
 *    action when the card was dismissed unwatched, a "complete" action when
 *    it was watched to the end (the app layer's one decision); a backward
 *    swipe emits NOTHING (the frozen event vocabulary has no navigation
 *    event — honest absence, see short/events.ts).
 *
 * 4. Watch-state ticking: while a card is on screen, the shell reports
 *    progress with `shortFeedEvents(stack, { stamp, action: { kind:
 *    "progress", itemId, percent } })` — the frozen "progress" event with
 *    payload `{ percent }`, sessionId wired, ready for the WFX-005 EventSink.
 *
 * 5. The re-rank loop (session-aware ranking — the host orchestrates):
 *    accumulate events + swipe counters; on `shouldRerank(...)` returning
 *    `rerank: true`, fetch a fresh OS short page, project it with
 *    `buildShortCards`, plan with `planReplacement(stack, cards,
 *    sessionState)`, and apply with `presenter.replaceCards(view, plan)`.
 *    The decision's scope is reorder-only (ahead-of-cursor, nothing demoted
 *    below visibility) — the shell must honor it (it is typed data).
 *
 * 6. When react types land in this workspace (a lead decision), the adapter
 *    is a thin `React.createElement` walk over this tree — nothing in the
 *    view model or the presenter changes.
 */

import type { ShortCardA11y, ShortCard } from "./card";
import type { ShortFeedView } from "./presenter";

// ---------------------------------------------------------------------------
// The element tree (framework-neutral, React-ready keys, a11y verbatim)
// ---------------------------------------------------------------------------

/** One node of the framework-neutral Short Feed element tree. */
export type ShortFeedElement =
  | {
      type: "card";
      /** React list key (verbatim). */
      key: string;
      /** "current" — the on-screen card; "next" — the swipe preview. */
      role: "current" | "next";
      /** The interactive element's accessibility label. */
      a11y: ShortCardA11y;
      /** The realization badge label; null ⇒ render no badge. */
      badgeText: string | null;
      /** The overlay title text (deterministic, never blank). */
      overlayTitle: string;
      /** The overlay topic; null ⇒ render no topic line. */
      overlayTopic: string | null;
      children: readonly ShortFeedElement[];
    }
  | {
      type: "action";
      key: string;
      /** Which engagement affordance this control fires. */
      action: "like" | "save" | "share";
      /** The visible control label. */
      label: string;
      /** The control's accessibility label (non-empty). */
      a11yLabel: string;
    }
  | { type: "text"; key: string; text: string }
  | {
      type: "placeholder";
      key: string;
      state: "loading" | "error" | "empty";
      /** Present iff `state` is "error": the failure text. */
      detail?: string;
    };

/** The engagement action elements of one card (present affordances only). */
function cardActions(card: ShortCard): readonly ShortFeedElement[] {
  const actions: ShortFeedElement[] = [];
  if (card.affordances.like !== null) {
    actions.push({
      type: "action",
      key: `action:like:${card.item.id}`,
      action: "like",
      label: "Like",
      a11yLabel: `Like '${card.overlay.title}' on its source`,
    });
  }
  if (card.affordances.save !== null) {
    actions.push({
      type: "action",
      key: `action:save:${card.item.id}`,
      action: "save",
      label: "Save",
      a11yLabel: `Save '${card.overlay.title}' to its source library`,
    });
  }
  actions.push({
    type: "action",
    key: `action:share:${card.item.id}`,
    action: "share",
    label: "Share",
    a11yLabel: `Share '${card.overlay.title}' (emits the share engagement event)`,
  });
  return actions;
}

/** One card's element subtree (overlay text + engagement actions). */
function cardElement(card: ShortCard, role: "current" | "next"): ShortFeedElement {
  const children: ShortFeedElement[] = [
    {
      type: "text",
      key: `overlay:${card.item.id}`,
      text:
        card.overlay.topic !== null
          ? `${card.overlay.title} — ${card.overlay.topic}`
          : card.overlay.title,
    },
  ];
  if (role === "current") {
    children.push(...cardActions(card));
  }
  return {
    type: "card",
    key: `card:${role}:${card.item.id}`,
    role,
    a11y: card.a11y,
    badgeText: card.realizationBadge !== null ? card.realizationBadge.label : null,
    overlayTitle: card.overlay.title,
    overlayTopic: card.overlay.topic,
    children: Object.freeze(children),
  };
}

/**
 * Render one `ShortFeedView` into the framework-neutral element tree (see
 * the module doc for the wiring contract). Pure and total: every view state
 * maps to a non-empty tree (placeholders for loading/error/empty; the
 * current card + next-card preview for ready views).
 */
export function shortFeedElementTree(view: ShortFeedView): readonly ShortFeedElement[] {
  if (view.state === "loading") {
    return [{ type: "placeholder", key: "short-feed-loading", state: "loading" }];
  }
  if (view.state === "error") {
    return [
      {
        type: "placeholder",
        key: "short-feed-error",
        state: "error",
        ...(view.errorDetail !== undefined ? { detail: view.errorDetail } : {}),
      },
    ];
  }
  if (view.state === "empty") {
    return [{ type: "placeholder", key: "short-feed-empty", state: "empty" }];
  }

  const elements: ShortFeedElement[] = [];
  if (view.current !== null) {
    elements.push(cardElement(view.current, "current"));
  }
  if (view.next !== null) {
    elements.push(cardElement(view.next, "next"));
  }
  if (elements.length === 0) {
    // Defensive: a "ready" view always carries a current card in practice.
    return [{ type: "placeholder", key: "short-feed-empty", state: "empty" }];
  }
  return elements;
}
