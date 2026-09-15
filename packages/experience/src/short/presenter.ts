/**
 * @wfx/experience — the Short Feed presenter (WFX-028, Lane C).
 *
 * `createShortFeedPresenter(deps)` returns the view-model builder of the
 * Short Feed: `initial(page, context)` builds the initial stack from an OS
 * short-surface page (via `buildShortCards` — vertical-first ordering), and
 * the transition methods (`swipeNext`, `swipeBack`, `replaceCards`,
 * `insertCards`) expose TYPED STATE TRANSITIONS for the UI: every view
 * carries the CURRENT card, the NEXT card, and the transition that produced
 * it with NON-EMPTY reasons. Placeholder states (loading / error / empty)
 * are typed (`ShortFeedState`), never guessed. Framework-neutral core; the
 * react binding is the documented wiring in react.ts (react types are not
 * available in this package and the dispatch forbids new dependencies — the
 * WFX-026/027 note pattern).
 *
 * Presenter policy (typed, deterministic):
 *
 * - INITIAL BUILD: an OS page (or a typed page state) + the session context
 *   project into cards (vertical-first), then into a validated stack
 *   (`cursor 0`, the context's prefetch window). A loaded page with ZERO
 *   usable cards is the honest `"empty"` state — never a fabricated card.
 *   Unclassifiable / non-short-form / duplicate candidates are surfaced in
 *   the view's typed transparency lists, verbatim from the projection.
 * - TRANSITIONS: pure functions over views. On a NON-READY view (loading /
 *   error / empty) every transition is a TYPED NO-OP with a reason — the UI
 *   can race gestures against page loads without a crash, and the no-op is
 *   always explicit, never a silent success.
 * - REPLENISHMENT: `insertCards` appends into the ahead region (the
 *   stack-level law); OS re-supplies of items already in the stack are
 *   skipped with typed reasons (carried into the transition).
 * - REPLACEMENT: `replaceCards` applies a `ReplacementPlan` (from
 *   replacement.ts) through the stack's `replaceAt`; a plan whose indices
 *   do not fit this view's stack is caller misuse (typed throw).
 * - RE-RANKING FLOW (the session-aware loop, documented): the host calls
 *   `shouldRerank(sessionState, events)` (session-ranking.ts); on a positive
 *   decision it fetches a fresh OS page (the host owns fetching — this
 *   model is fetch-free), projects it with `buildShortCards`, and applies
 *   `planReplacement(stack, cards, sessionState)` through `replaceCards`.
 *   The presenter never re-ranks on its own.
 *
 * Determinism laws: no randomness, no hidden clock, no globals; every view
 * is a pure function of its inputs.
 */

import type { EntertainmentItem } from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";
import {
  buildShortCards,
  type BuildShortCardsOptions,
  type ShortCard,
  type ShortFeedPage,
} from "./card";
import type { ReplacementPlan } from "./replacement";
import {
  DEFAULT_PREFETCH_AHEAD,
  assertUsableShortFeedStack,
  createShortFeedStack,
  currentCard,
  insertAhead,
  nextCard,
  replaceAt,
  swipeBack as stackSwipeBack,
  swipeNext as stackSwipeNext,
  type ShortFeedStack,
  type StackEvent,
} from "./stack";

// ---------------------------------------------------------------------------
// Page state + context
// ---------------------------------------------------------------------------

/** The load state of the OS short page (typed placeholder input). */
export type ShortFeedPageState =
  | { kind: "loading" }
  | { kind: "failed"; detail: string }
  | { kind: "loaded"; page: ShortFeedPage };

/**
 * The session context of one short-feed build: identity, the optional
 * canonical-item join (host-supplied, authoritative over candidate
 * projections), and the prefetch window size.
 */
export interface ShortFeedContext {
  userId: string;
  sessionId: string;
  items?: readonly EntertainmentItem[];
  prefetchAhead?: number;
}

// ---------------------------------------------------------------------------
// The view + transitions
// ---------------------------------------------------------------------------

/** Every surface state of the Short Feed (typed placeholders included). */
export type ShortFeedState = "loading" | "error" | "empty" | "ready";

/** The transition kinds that produce views (typed). */
export type ShortFeedTransitionKind =
  | "initial"
  | "swipe-next"
  | "swipe-next-noop"
  | "swipe-back"
  | "swipe-back-noop"
  | "replace"
  | "insert-ahead"
  | "not-ready-noop";

/**
 * The typed transition that produced one view: its kind, NON-EMPTY reasons,
 * and the stack trail event verbatim when one produced the transition.
 */
export interface ShortFeedTransition {
  kind: ShortFeedTransitionKind;
  /** NON-EMPTY explainability reasons (why this transition happened / was refused). */
  reasons: readonly string[];
  /** The stack-level trail event, verbatim (absent for the initial build). */
  event?: StackEvent;
}

/**
 * The presentable Short Feed view: the typed surface state, the stack
 * snapshot (present iff ready), the CURRENT and NEXT cards (present iff
 * ready and existing), the producing transition, the error detail (iff
 * error), and the projection transparency lists (unresolved / non-short-form
 * / duplicate candidate ids — nothing is silently dropped).
 */
export interface ShortFeedView {
  surface: "short";
  state: ShortFeedState;
  /** Present iff `state` is "ready". */
  stack: ShortFeedStack | null;
  /** The card at the cursor; null when not ready or the stack is empty. */
  current: ShortCard | null;
  /** The card after the cursor (the prefetch preview); null when none. */
  next: ShortCard | null;
  /** The transition that produced this view (always present). */
  transition: ShortFeedTransition;
  /** Present iff `state` is "error": what failed. */
  errorDetail?: string;
  /** Candidate ids that could not be canonically classified (no card fabricated). */
  unresolvedItemIds: readonly string[];
  /** Candidate ids excluded because they are not short-form candidates. */
  nonShortFormItemIds: readonly string[];
  /** Candidate ids dropped as duplicates (one card per canonical item). */
  duplicateItemIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Deps + the presenter surface
// ---------------------------------------------------------------------------

/** The presenter's dependency bundle (injected seams — never fetched). */
export interface ShortFeedPresenterDeps {
  /** connectorId → displayName for realization badges; missing names fall back to the connectorId. */
  displayNames?: Readonly<Record<string, string>>;
}

/** The presenter surface: every method is pure over (deps, arguments). */
export interface ShortFeedPresenter {
  /** Build the initial view from an OS short page (or a typed page state). */
  initial(page: ShortFeedPage | ShortFeedPageState, context: ShortFeedContext): ShortFeedView;
  /** Swipe forward (typed no-op with reasons at the last card / non-ready views). */
  swipeNext(view: ShortFeedView): ShortFeedView;
  /** Swipe back — bounded (typed no-op at the first card; never wraps). */
  swipeBack(view: ShortFeedView): ShortFeedView;
  /** Apply a replacement plan (rapid candidate replacement). */
  replaceCards(view: ShortFeedView, plan: ReplacementPlan): ShortFeedView;
  /** Replenish the ahead region from a fresh OS page projection. */
  insertCards(view: ShortFeedView, cards: readonly ShortCard[]): ShortFeedView;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Type guard that preserves the declared type (unlike a raw index-signature guard). */
function isOptionsObject<T extends object>(value: T | null | undefined): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural guard for connectorId → displayName records. */
function isDisplayNameRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((name) => typeof name === "string");
}

function assertUsableContext(context: ShortFeedContext): void {
  if (!isRecord(context)) {
    throw new ExperienceError("context: expected a ShortFeedContext object");
  }
  const problems: string[] = [];
  if (!isNonEmptyString(context.userId)) {
    problems.push(
      `context.userId: expected a non-empty string, got ${previewValue(context.userId)}`,
    );
  }
  if (!isNonEmptyString(context.sessionId)) {
    problems.push(
      `context.sessionId: expected a non-empty string, got ${previewValue(context.sessionId)}`,
    );
  }
  if (context.items !== undefined && !Array.isArray(context.items)) {
    problems.push(
      `context.items: expected an array of EntertainmentItem when present, got ${previewValue(context.items)}`,
    );
  }
  if (
    context.prefetchAhead !== undefined &&
    (typeof context.prefetchAhead !== "number" ||
      !Number.isFinite(context.prefetchAhead) ||
      !Number.isInteger(context.prefetchAhead) ||
      context.prefetchAhead < 0)
  ) {
    problems.push(
      `context.prefetchAhead: expected a non-negative integer when present, got ${previewValue(context.prefetchAhead)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertUsableView(view: ShortFeedView): void {
  if (!isRecord(view) || view.surface !== "short" || typeof view.state !== "string") {
    throw new ExperienceError(
      `view: expected a ShortFeedView produced by this presenter, got ${previewValue(view)}`,
    );
  }
  if (view.state === "ready") {
    if (view.stack === null || view.stack === undefined) {
      throw new ExperienceError("view: a ready view must carry its stack");
    }
    assertUsableShortFeedStack(view.stack);
  }
}

/** The projection transparency lists carried across transitions (never clobbered). */
function transparencyOf(view: ShortFeedView): Pick<
  ShortFeedView,
  "unresolvedItemIds" | "nonShortFormItemIds" | "duplicateItemIds"
> {
  return {
    unresolvedItemIds: view.unresolvedItemIds,
    nonShortFormItemIds: view.nonShortFormItemIds,
    duplicateItemIds: view.duplicateItemIds,
  };
}

/**
 * Re-derive a view from a (new) stack, carrying ONLY the transparency lists
 * from the producing view (explicit field copies — a whole-view spread would
 * clobber the new stack/transition with stale values).
 */
function viewFromStack(
  stack: ShortFeedStack,
  transition: ShortFeedTransition,
  transparency: Pick<
    ShortFeedView,
    "unresolvedItemIds" | "nonShortFormItemIds" | "duplicateItemIds"
  >,
): ShortFeedView {
  const state: ShortFeedState = stack.items.length === 0 ? "empty" : "ready";
  return {
    surface: "short",
    state,
    stack,
    current: currentCard(stack),
    next: nextCard(stack),
    transition,
    unresolvedItemIds: transparency.unresolvedItemIds,
    nonShortFormItemIds: transparency.nonShortFormItemIds,
    duplicateItemIds: transparency.duplicateItemIds,
  };
}

// ---------------------------------------------------------------------------
// The presenter
// ---------------------------------------------------------------------------

/**
 * Build the Short Feed presenter over the injected deps. Every method is
 * pure: it derives a new view and never mutates its inputs.
 */
export function createShortFeedPresenter(deps: ShortFeedPresenterDeps = {}): ShortFeedPresenter {
  if (!isOptionsObject(deps)) {
    throw new ExperienceError(
      `deps: expected a ShortFeedPresenterDeps object, got ${previewValue(deps)}`,
    );
  }
  if (deps.displayNames !== undefined && !isDisplayNameRecord(deps.displayNames)) {
    throw new ExperienceError(
      `deps.displayNames: expected a record of connectorId -> displayName when present, got ${previewValue(deps.displayNames)}`,
    );
  }

  const buildOptions: BuildShortCardsOptions = {};
  if (deps.displayNames !== undefined) {
    buildOptions.displayNames = deps.displayNames;
  }

  return {
    initial(page, context) {
      assertUsableContext(context);

      // --- typed placeholder dispatch ---------------------------------------
      let loaded: ShortFeedPage;
      if (
        isRecord(page) &&
        (page.kind === "loading" || page.kind === "failed" || page.kind === "loaded")
      ) {
        if (page.kind === "loading") {
          return {
            surface: "short",
            state: "loading",
            stack: null,
            current: null,
            next: null,
            transition: {
              kind: "initial",
              reasons: Object.freeze(["the OS short page is loading"]),
            },
            unresolvedItemIds: Object.freeze([]),
            nonShortFormItemIds: Object.freeze([]),
            duplicateItemIds: Object.freeze([]),
          };
        }
        if (page.kind === "failed") {
          if (typeof page.detail !== "string" || page.detail.length === 0) {
            throw new ExperienceError(
              `page.detail: expected a non-empty string for a failed page state, got ${previewValue(page.detail)}`,
            );
          }
          return {
            surface: "short",
            state: "error",
            stack: null,
            current: null,
            next: null,
            transition: {
              kind: "initial",
              reasons: Object.freeze(["the OS short page failed to load"]),
            },
            errorDetail: page.detail,
            unresolvedItemIds: Object.freeze([]),
            nonShortFormItemIds: Object.freeze([]),
            duplicateItemIds: Object.freeze([]),
          };
        }
        loaded = page.page;
      } else {
        loaded = page as ShortFeedPage;
      }

      const projection = buildShortCards(loaded, {
        ...buildOptions,
        ...(context.items !== undefined ? { items: context.items } : {}),
      });
      const transparency = {
        unresolvedItemIds: projection.unresolvedItemIds,
        nonShortFormItemIds: projection.nonShortFormItemIds,
        duplicateItemIds: projection.duplicateItemIds,
      };

      if (projection.cards.length === 0) {
        return {
          surface: "short",
          state: "empty",
          stack: null,
          current: null,
          next: null,
          transition: {
            kind: "initial",
            reasons: Object.freeze([
              "the OS short page supplied no usable cards (unresolved or non-short-form candidates are listed in the transparency fields)",
            ]),
          },
          ...transparency,
        };
      }

      const stack = createShortFeedStack(projection.cards, {
        cursor: 0,
        prefetchAhead: context.prefetchAhead ?? DEFAULT_PREFETCH_AHEAD,
      });
      return viewFromStack(
        stack,
        {
          kind: "initial",
          reasons: Object.freeze([
            `built the initial stack: ${stack.items.length} card(s), vertical-first, cursor 0, prefetch window ${stack.prefetchAhead}`,
          ]),
        },
        transparency,
      );
    },

    swipeNext(view) {
      assertUsableView(view);
      if (view.state !== "ready" || view.stack === null) {
        return {
          ...view,
          transition: {
            kind: "not-ready-noop",
            reasons: Object.freeze([
              `swipe ignored: the feed is ${view.state === "empty" ? "empty" : view.state} — no cards to swipe`,
            ]),
          },
        };
      }
      const { stack, event } = stackSwipeNext(view.stack);
      if (event.kind === "swipe-next-noop") {
        return {
          ...view,
          transition: {
            kind: "swipe-next-noop",
            reasons: Object.freeze([
              event.reason === "at-last-card"
                ? "at the last card — the feed never wraps forward; the OS replenishes via insertCards"
                : "the stack is empty — nothing to swipe",
            ]),
            event,
          },
        };
      }
      return viewFromStack(
        stack,
        {
          kind: "swipe-next",
          reasons: Object.freeze([
            `swiped forward from card ${event.fromCursor + 1} to card ${event.toCursor + 1} (left '${event.leftItemId}', entered '${event.enteredItemId ?? "none"}')`,
          ]),
          event,
        },
        transparencyOf(view),
      );
    },

    swipeBack(view) {
      assertUsableView(view);
      if (view.state !== "ready" || view.stack === null) {
        return {
          ...view,
          transition: {
            kind: "not-ready-noop",
            reasons: Object.freeze([
              `swipe ignored: the feed is ${view.state === "empty" ? "empty" : view.state} — no cards to swipe`,
            ]),
          },
        };
      }
      const { stack, event } = stackSwipeBack(view.stack);
      if (event.kind === "swipe-back-noop") {
        return {
          ...view,
          transition: {
            kind: "swipe-back-noop",
            reasons: Object.freeze([
              event.reason === "at-first-card"
                ? "at the first card — backward swipe is bounded and never wraps"
                : "the stack is empty — nothing to swipe",
            ]),
            event,
          },
        };
      }
      return viewFromStack(
        stack,
        {
          kind: "swipe-back",
          reasons: Object.freeze([
            `swiped back from card ${event.fromCursor + 1} to card ${event.toCursor + 1} (re-entered '${event.reEnteredItemId}')`,
          ]),
          event,
        },
        transparencyOf(view),
      );
    },

    replaceCards(view, plan) {
      assertUsableView(view);
      if (view.state !== "ready" || view.stack === null) {
        return {
          ...view,
          transition: {
            kind: "not-ready-noop",
            reasons: Object.freeze([
              `replacement ignored: the feed is ${view.state === "empty" ? "empty" : view.state} — no stack to replace into`,
            ]),
          },
        };
      }
      if (!isRecord(plan) || !Array.isArray(plan.replacements)) {
        throw new ExperienceError(
          `plan: expected a ReplacementPlan from planReplacement, got ${previewValue(plan)}`,
        );
      }

      let stack = view.stack;
      const applied: string[] = [];
      for (const replacement of plan.replacements) {
        const result = replaceAt(stack, replacement.index, replacement.card);
        stack = result.stack;
        applied.push(`index ${replacement.index}: '${replacement.outItemId}' -> '${replacement.card.item.id}' (${replacement.reason})`);
      }
      const reasons =
        applied.length > 0
          ? [`applied ${applied.length} replacement(s)`, ...applied]
          : ["the plan replaced nothing — every slot was kept (see the plan's kept reasons)"];
      return viewFromStack(
        stack,
        {
          kind: "replace",
          reasons: Object.freeze(reasons),
        },
        transparencyOf(view),
      );
    },

    insertCards(view, cards) {
      assertUsableView(view);
      if (view.state !== "ready" || view.stack === null) {
        return {
          ...view,
          transition: {
            kind: "not-ready-noop",
            reasons: Object.freeze([
              `replenishment ignored: the feed is ${view.state === "empty" ? "empty" : view.state} — build the initial stack first`,
            ]),
          },
        };
      }
      const { stack, event } = insertAhead(view.stack, cards);
      const reasons =
        event.insertedItemIds.length > 0
          ? [
              `replenished ${event.insertedItemIds.length} card(s) into the ahead region (${event.fromCount} -> ${event.toCount})`,
            ]
          : ["replenishment supplied no new cards (duplicates are skipped, one card per item)"];
      if (event.skipped.length > 0) {
        reasons.push(
          ...event.skipped.map((skip) => `skipped '${skip.itemId}': ${skip.reason}`),
        );
      }
      return viewFromStack(
        stack,
        {
          kind: "insert-ahead",
          reasons: Object.freeze(reasons),
          event,
        },
        transparencyOf(view),
      );
    },
  };
}
