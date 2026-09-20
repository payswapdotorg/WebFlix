"use client";

/**
 * @wfx/app-web — the Short Feed stack (WFX-051, client).
 *
 * The WFX-028 surface as a real vertical card stack: swipe (touch), arrow
 * keys, and buttons all drive the SAME frozen presenter
 * (`createShortFeedPresenter` — typed state transitions, bounded back-swipe,
 * honest no-ops with reasons), and the rendering projects the framework-
 * neutral element tree (`shortFeedElementTree`) — the documented wiring
 * contract of packages/experience (a11y labels verbatim from the frozen
 * view model).
 *
 * THE FROZEN LAWS, honored here:
 * - Replacement: on a re-rank decision (`shouldRerank` — swipe count /
 *   elapsed / engagement triggers, thresholds from the session policy's
 *   attention mode) the shell fetches a FRESH OS page and applies
 *   `planReplacement` — beyond-cursor slots only, the prefetch window kept,
 *   the current card never swapped mid-view. The plan is RECOMPUTED against
 *   the current stack at apply time (swipes during the fetch are never
 *   clobbered; a superseded plan cannot misfit).
 * - Events: a forward swipe past an unwatched card emits the frozen `skip`
 *   event (the app layer's one documented decision); a BACKWARD swipe
 *   emits NOTHING (no frozen navigation event — honest absence). Share is
 *   event-only. Like/save go through the ACTION route — the engagement
 *   mirror fires when the source confirms, never before.
 * - Honesty: NO progress ticking — this shell cannot observe real playback
 *   inside a provider embed, so it never fabricates percentages. Absent
 *   like/save capabilities render no control (typed absence — the tree
 *   omits them). Emission failures surface visibly; nothing is swallowed.
 *
 * Determinism seams (tests inject both): `now` (the clock — production
 * reads real time, the documented client-side seam; every DECISION consumes
 * the injected value) and `fetchPage` (the fresh-page source — production
 * fetches `/api/shorts`).
 */

import {
  useCallback,
  useReducer,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type JSX,
  type TouchEvent as ReactTouchEvent,
} from "react";

import type { EntertainmentEvent, RecommendationPolicy } from "@wfx/domain";
import {
  buildShortCards,
  createShortFeedPresenter,
  planReplacement,
  shortFeedElementTree,
  shortFeedEvents,
  shouldRerank,
  type ShortCard,
  type ShortFeedElement,
  type ShortFeedPage,
  type ShortFeedPresenter,
  type ShortFeedView,
  type ShortSessionState,
} from "@wfx/experience";

import type { ShortsBootPayload } from "@/host/shorts";
import { Icon } from "@/components/shell/Icon";
import { placeholderArt, placeholderMonogram } from "@/components/ui/format";

// ---------------------------------------------------------------------------
// The session reducer (pure, exported for the composition tests)
// ---------------------------------------------------------------------------

/**
 * The external share outcome (the F7 usable-share fix): the platform share
 * sheet when the browser provides one, else the honest clipboard fallback
 * (the item's link copied — share it anywhere). Never a fabricated success:
 * when neither channel works, the note names the fallback honestly.
 */
async function shareExternally(
  title: string,
  url: string | null,
): Promise<{ readonly ok: boolean; readonly note: string }> {
  const nav = navigator as Navigator & {
    share?: (data: { readonly title?: string; readonly url?: string }) => Promise<void>;
  };
  if (url !== null && typeof nav.share === "function") {
    try {
      await nav.share({ title, url });
      return { ok: true, note: "Shared — the link is in the share you chose." };
    } catch {
      // The user dismissed the sheet (or the platform refused): fall
      // through to the clipboard — the share intent still gets its link.
    }
  }
  if (url !== null && typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true, note: "Link copied — share it anywhere." };
    } catch {
      // fall through to the honest note
    }
  }
  return {
    ok: false,
    note: "The link could not be copied here — open this short's page and copy its address.",
  };
}

/** One like/save control state (optimistic + receipt-truth + rollback). */
interface CardActionState {
  readonly optimistic: boolean;
  readonly settled: "idle" | "confirmed" | "local-only";
  readonly failure: string | null;
  readonly pending: boolean;
}

const IDLE_ACTION: CardActionState = {
  optimistic: false,
  settled: "idle",
  failure: null,
  pending: false,
};

/** The full client session of the short feed. */
export interface ShortsSession {
  readonly view: ShortFeedView;
  readonly policy: RecommendationPolicy;
  readonly userId: string;
  readonly sessionId: string;
  /** Forward swipes since the last re-rank decision. */
  readonly swipesSinceRerank: number;
  /** Epoch ms of the last re-rank decision (session start initially). */
  readonly lastRerankAtMs: number;
  /** Canonical ids skipped this session (replacement evidence). */
  readonly skippedItemIds: readonly string[];
  /** Events accumulated since the last re-rank (the decision input). */
  readonly events: readonly EntertainmentEvent[];
  /** The last re-rank decision's reasons (typed explainability, visible). */
  readonly rerankNotes: readonly string[];
  /** True while a fresh page is being fetched for a re-rank. */
  readonly rerankBusy: boolean;
  /** Like/save control states, keyed `action:${type}:${itemId}` (the tree's keys). */
  readonly actionStates: Readonly<Record<string, CardActionState>>;
  /** The last emission failure (visible; null when the last emit succeeded). */
  readonly emitError: string | null;
  /** The last share outcome note (the visible confirmation — the F7 usable-share fix). */
  readonly shareNote: string | null;
}

type ShortsAction =
  | {
      kind: "swipe";
      direction: "next" | "back";
      view: ShortFeedView;
      skipEvent: EntertainmentEvent | null;
      nowMs: number;
    }
  | { kind: "rerank-begin" }
  | { kind: "rerank-applied"; freshCards: readonly ShortCard[]; notes: readonly string[]; nowMs: number }
  | { kind: "rerank-failed"; error: string; nowMs: number }
  | { kind: "action-begin"; key: string }
  | {
      kind: "action-receipt";
      key: string;
      status: "confirmed" | "local-only" | "unsupported" | "failed";
      detail?: string;
      event: EntertainmentEvent | null;
    }
  | { kind: "action-error"; key: string; message: string }
  | { kind: "emit-error"; message: string }
  | { kind: "emit-ok" }
  | { kind: "share-note"; note: string | null };

/** The session-state projection `shouldRerank`/`planReplacement` consume. */
function sessionStateOf(session: ShortsSession, nowMs: number): ShortSessionState {
  const stack = session.view.stack;
  return {
    userId: session.userId,
    sessionId: session.sessionId,
    policy: session.policy,
    watchedItemIds: [],
    skippedItemIds: [...session.skippedItemIds],
    swipesSinceRerank: session.swipesSinceRerank,
    msSinceRerank: Math.max(0, nowMs - session.lastRerankAtMs),
    nowMs,
    aheadOfCursorItemIds:
      stack !== null ? stack.items.slice(stack.cursor + 1).map((card) => card.item.id) : [],
  };
}

/**
 * The pure session reducer. Exported for the composition tests (the
 * replacement-law smoke drives it directly with scripted pages).
 */
export function shortsSessionReducer(session: ShortsSession, action: ShortsAction): ShortsSession {
  switch (action.kind) {
    case "swipe": {
      return {
        ...session,
        view: action.view,
        swipesSinceRerank:
          action.direction === "next" ? session.swipesSinceRerank + 1 : session.swipesSinceRerank,
        skippedItemIds:
          action.direction === "next" && action.skipEvent !== null
            ? [...session.skippedItemIds, action.skipEvent.itemId]
            : session.skippedItemIds,
        events: action.skipEvent !== null ? [...session.events, action.skipEvent] : session.events,
        emitError: null,
      };
    }
    case "rerank-begin":
      return { ...session, rerankBusy: true };
    case "rerank-applied": {
      // The plan is recomputed against the CURRENT stack at apply time —
      // swipes during the fetch are never clobbered, and a plan can never
      // misfit (replacement beyond-cursor only, prefetch window kept).
      if (session.view.state !== "ready" || session.view.stack === null) {
        return {
          ...session,
          rerankBusy: false,
          swipesSinceRerank: 0,
          lastRerankAtMs: action.nowMs,
          events: [],
          rerankNotes: [...action.notes, "re-rank ignored: the feed is no longer ready"],
        };
      }
      const plan = planReplacement(
        session.view.stack,
        action.freshCards,
        sessionStateOf(session, action.nowMs),
      );
      const presenter = createShortFeedPresenter();
      const view = presenter.replaceCards(session.view, plan);
      const notes = [
        ...action.notes,
        plan.replacements.length > 0
          ? `applied ${plan.replacements.length} replacement(s); ${plan.kept.length} slot(s) kept`
          : "the fresh page replaced nothing — every slot is kept runway (typed reasons in the plan)",
      ];
      return {
        ...session,
        view,
        rerankBusy: false,
        swipesSinceRerank: 0,
        lastRerankAtMs: action.nowMs,
        events: [],
        rerankNotes: notes,
      };
    }
    case "rerank-failed":
      return {
        ...session,
        rerankBusy: false,
        swipesSinceRerank: 0,
        lastRerankAtMs: action.nowMs,
        events: [],
        rerankNotes: [...session.rerankNotes, `re-rank failed: ${action.error}`],
      };
    case "action-begin": {
      const current = session.actionStates[action.key] ?? IDLE_ACTION;
      return {
        ...session,
        actionStates: {
          ...session.actionStates,
          [action.key]: { ...current, optimistic: true, failure: null, pending: true },
        },
      };
    }
    case "action-receipt": {
      const current = session.actionStates[action.key] ?? IDLE_ACTION;
      if (action.status === "confirmed" || action.status === "local-only") {
        return {
          ...session,
          actionStates: {
            ...session.actionStates,
            [action.key]: {
              optimistic: false,
              settled: action.status,
              failure: null,
              pending: false,
            },
          },
          events: action.event !== null ? [...session.events, action.event] : session.events,
        };
      }
      // unsupported / failed ⇒ ROLLBACK (never fake success).
      return {
        ...session,
        actionStates: {
          ...session.actionStates,
          [action.key]: {
            ...current,
            optimistic: false,
            pending: false,
            failure:
              action.status === "unsupported"
                ? "This source does not support that action."
                : action.detail !== undefined && action.detail.length > 0
                  ? `The source declined: ${action.detail}`
                  : "The source declined the action.",
          },
        },
      };
    }
    case "action-error": {
      const current = session.actionStates[action.key] ?? IDLE_ACTION;
      return {
        ...session,
        actionStates: {
          ...session.actionStates,
          [action.key]: { ...current, optimistic: false, pending: false, failure: action.message },
        },
      };
    }
    case "emit-error":
      return { ...session, emitError: action.message };
    case "emit-ok":
      return { ...session, emitError: null };
    case "share-note":
      return { ...session, shareNote: action.note };
  }
}

// ---------------------------------------------------------------------------
// The element-tree renderer (the documented wiring contract)
// ---------------------------------------------------------------------------

/** The renderer context: action wiring + control states + card art. */
interface RenderContext {
  onAction: (action: "like" | "save" | "share") => void;
  actionStates: Readonly<Record<string, CardActionState>>;
  /** Placeholder art per role (deterministic per item id — no provider branding). */
  art: { readonly current: string | null; readonly next: string | null };
  /** Monogram per role (decorative). */
  monogram: { readonly current: string | null; readonly next: string | null };
}

/** Render the framework-neutral element tree with the shell's components. */
function renderElements(elements: readonly ShortFeedElement[], ctx: RenderContext): JSX.Element[] {
  return elements.map((element) => {
    switch (element.type) {
      case "text":
        return <span key={element.key}>{element.text}</span>;
      case "placeholder":
        return (
          <div key={element.key} className="wfx-shortcard__placeholder" data-wfx-shorts-state={element.state}>
            <span>
              {element.state === "loading"
                ? "Loading the short feed…"
                : element.state === "error"
                  ? `The short feed failed to load${element.detail !== undefined ? `: ${element.detail}` : ""}`
                  : "No shorts yet — the source answered with no short-form content."}
            </span>
          </div>
        );
      case "action": {
        // The tree's keys are `action:${type}:${itemId}` — the control key.
        const state = ctx.actionStates[element.key] ?? IDLE_ACTION;
        const active = state.optimistic || state.settled !== "idle";
        const iconName = element.action === "like" ? "like" : element.action === "save" ? "save" : "share";
        const label =
          element.action === "like"
            ? state.optimistic
              ? "Liking…"
              : state.settled === "confirmed"
                ? "Liked"
                : "Like"
            : element.action === "save"
              ? state.optimistic
                ? "Saving…"
                : state.settled === "confirmed"
                  ? "Saved"
                  : "Save"
              : state.optimistic
                ? "Sharing…"
                : state.settled === "confirmed"
                  ? "Shared"
                  : "Share";
        return (
          <button
            key={element.key}
            type="button"
            className={`wfx-roundbtn${active ? " wfx-roundbtn--active" : ""}`}
            onClick={() => {
              ctx.onAction(element.action);
            }}
            aria-label={element.a11yLabel}
            aria-pressed={active}
            disabled={state.pending}
            data-wfx-shorts-action={element.action}
          >
            <Icon name={iconName} size={20} />
            <span className="wfx-roundbtn__label">{label}</span>
          </button>
        );
      }
      case "card": {
        const isCurrent = element.role === "current";
        const art = isCurrent ? ctx.art.current : ctx.art.next;
        const monogram = isCurrent ? ctx.monogram.current : ctx.monogram.next;
        return (
          <article
            key={element.key}
            className={`wfx-shortcard${isCurrent ? " wfx-shortcard--current" : " wfx-shortcard--next"}`}
            aria-label={`${element.a11y.title}. ${element.a11y.position}. ${element.a11y.action}. ${element.a11y.affordances}.`}
            data-wfx-shorts-card={element.role}
            style={art !== null ? { background: art } : undefined}
          >
            {monogram !== null ? (
              <span className="wfx-shortcard__monogram" aria-hidden="true">
                {monogram}
              </span>
            ) : null}
            <div className="wfx-shortcard__overlay">
              <h2 className="wfx-shortcard__title">{element.overlayTitle}</h2>
              {element.overlayTopic !== null ? (
                <p className="wfx-shortcard__meta">{element.overlayTopic}</p>
              ) : null}
              {element.badgeText !== null ? (
                <p className="wfx-shortcard__meta">
                  <span className="wfx-capchip">{element.badgeText}</span>
                </p>
              ) : null}
            </div>
            {isCurrent ? (
              <div className="wfx-shortcard__actions">
                {renderElements(
                  element.children.filter((child) => child.type === "action"),
                  ctx,
                )}
              </div>
            ) : null}
          </article>
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

/** The Short Feed client island. */
export function ShortsFeed({
  payload,
  now,
  fetchPage,
}: {
  /** The server-composed boot payload (OS page + policy + identity). */
  readonly payload: ShortsBootPayload;
  /**
   * The clock seam (epoch ms). Production default: real time — the
   * documented client-side seam (every DECISION consumes the injected
   * value; tests inject a fixed clock for determinism).
   */
  readonly now?: () => number;
  /**
   * The fresh-page seam (the re-rank loop's fetch). Production default:
   * `GET /api/shorts`. Tests inject a scripted page source.
   */
  readonly fetchPage?: () => Promise<ShortFeedPage | null>;
}): JSX.Element {
  const realNow = now ?? (() => Date.now());
  const loadFreshPage =
    fetchPage ??
    (async () => {
      try {
        const response = await fetch("/api/shorts", { method: "GET" });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null) return null;
        const page = (body as { page?: unknown }).page;
        if (typeof page !== "object" || page === null) return null;
        return page as ShortFeedPage;
      } catch {
        return null;
      }
    });

  const presenterRef = useRef<ShortFeedPresenter | null>(null);
  if (presenterRef.current === null) presenterRef.current = createShortFeedPresenter();
  const presenter = presenterRef.current;

  const [session, dispatch] = useReducer(shortsSessionReducer, payload, (boot) => ({
    view: presenter.initial(boot.page, {
      userId: boot.userId,
      sessionId: boot.sessionId,
      prefetchAhead: boot.prefetchAhead,
    }),
    policy: boot.policy,
    userId: boot.userId,
    sessionId: boot.sessionId,
    swipesSinceRerank: 0,
    lastRerankAtMs: realNow(),
    skippedItemIds: [],
    events: [],
    rerankNotes: [],
    rerankBusy: false,
    actionStates: {},
    emitError: null,
    shareNote: null,
  }));

  /** Emit one composed frozen event to the sink route (honest failures). */
  const emitEvent = useCallback(async (event: EntertainmentEvent): Promise<void> => {
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: event.itemId, type: event.type, payload: event.payload }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        dispatch({
          kind: "emit-error",
          message: `Watch state was NOT recorded (${response.status}${
            body !== null && typeof body.error === "string" ? `: ${body.error}` : ""
          }).`,
        });
        return;
      }
      dispatch({ kind: "emit-ok" });
    } catch {
      dispatch({ kind: "emit-error", message: "Network failure — the event was NOT recorded." });
    }
  }, []);

  /** The re-rank loop (the frozen session-aware law — see the module doc). */
  const maybeRerank = useCallback(
    async (start: ShortsSession): Promise<void> => {
      const nowMs = realNow();
      const decision = shouldRerank(sessionStateOf(start, nowMs), start.events);
      if (!decision.rerank) return;
      dispatch({ kind: "rerank-begin" });
      const page = await loadFreshPage();
      if (page === null) {
        dispatch({
          kind: "rerank-failed",
          error: "the fresh short page could not be loaded",
          nowMs,
        });
        return;
      }
      const projection = buildShortCards(page, {});
      dispatch({
        kind: "rerank-applied",
        freshCards: projection.cards,
        notes: decision.reasons,
        nowMs,
      });
    },
    [loadFreshPage, realNow],
  );

  /** Swipe forward/back — the frozen presenter decides; skip is emitted. */
  const swipe = useCallback(
    (direction: "next" | "back") => {
      const nowMs = realNow();
      const view =
        direction === "next"
          ? presenter.swipeNext(session.view)
          : presenter.swipeBack(session.view);
      let skipEvent: EntertainmentEvent | null = null;
      const trail = view.transition.event;
      if (
        direction === "next" &&
        view.transition.kind === "swipe-next" &&
        trail !== undefined &&
        trail.kind === "swipe-next" &&
        view.stack !== null
      ) {
        // The app layer's one documented decision: a forward swipe past an
        // (unwatched) card is the skip interaction.
        const [event] = shortFeedEvents(view.stack, {
          stamp: {
            userId: session.userId,
            sessionId: session.sessionId,
            occurredAt: new Date(nowMs).toISOString(),
          },
          action: { kind: "skip", itemId: trail.leftItemId },
        });
        skipEvent = event ?? null;
      }
      const action: ShortsAction = { kind: "swipe", direction, view, skipEvent, nowMs };
      dispatch(action);
      if (skipEvent !== null) {
        void emitEvent(skipEvent);
      }
      // The re-rank decision consumes the post-swipe session (pure reducer).
      void maybeRerank(shortsSessionReducer(session, action));
    },
    [emitEvent, maybeRerank, presenter, realNow, session],
  );

  /** Fire one like/save/share affordance of the current card. */
  const fireAction = useCallback(
    async (action: "like" | "save" | "share"): Promise<void> => {
      const current = session.view.current;
      if (current === null) return;
      const nowMs = realNow();
      if (action === "share") {
        // Share is EVENT-ONLY (no frozen UserAction type — typed absence)
        // and EXTERNAL (the social lane — never the watch-state lane:
        // /api/events refuses `share` by its own frozen law, so the click
        // must NOT claim a watch-state write — the F7 fix). The composed
        // frozen `share` EntertainmentEvent rides the session's local
        // trail; the USER outcome is the platform's share
        // (`navigator.share`) with the honest clipboard fallback: the
        // item's link lands in the user's hand — share it anywhere.
        const stack = session.view.stack;
        if (stack === null) return;
        const [shareEvent] = shortFeedEvents(stack, {
          stamp: {
            userId: session.userId,
            sessionId: session.sessionId,
            occurredAt: new Date(nowMs).toISOString(),
          },
          action: { kind: "share", itemId: current.item.id },
        });
        const key = `action:share:${current.item.id}`;
        dispatch({ kind: "action-begin", key });
        dispatch({ kind: "share-note", note: null });
        const candidate = payload.page.cards[current.osPosition]?.candidate;
        // The share link: the item route's own query grammar (the same
        // `id/connector/ref/title/type` params every item link carries —
        // inlined here because the routing module is a server-side import
        // the client chunk must not pull).
        const shareUrl =
          typeof window !== "undefined" && candidate !== undefined
            ? `${window.location.origin}/item?${new URLSearchParams({
                id: current.item.id,
                connector: candidate.realization.connectorId,
                ref: candidate.realization.externalRef ?? current.item.id,
                title: current.overlay.title,
                type: current.item.canonicalType,
              }).toString()}`
            : null;
        const outcome = await shareExternally(current.overlay.title, shareUrl);
        if (outcome.ok) {
          dispatch({
            kind: "action-receipt",
            key,
            status: "confirmed",
            event: shareEvent ?? null,
          });
          dispatch({ kind: "share-note", note: outcome.note });
        } else {
          // The link could not be handed over (no share sheet, no
          // clipboard): the engagement still records (local-only), and the
          // honest note names the fallback — never a silent failure.
          dispatch({
            kind: "action-receipt",
            key,
            status: "local-only",
            event: shareEvent ?? null,
          });
          dispatch({ kind: "share-note", note: outcome.note });
        }
        return;
      }
      const affordance = action === "like" ? current.affordances.like : current.affordances.save;
      if (affordance === null) return; // typed-absent — the control never rendered
      const key = `action:${action}:${current.item.id}`;
      dispatch({ kind: "action-begin", key });
      try {
        const response = await fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: action,
            connectorId: affordance.connectorId,
            externalRef: affordance.externalRef,
            itemId: affordance.itemId,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || typeof body !== "object" || body === null) {
          dispatch({
            kind: "action-error",
            key,
            message: `The action could not reach the host (${response.status}) — not applied.`,
          });
          return;
        }
        const status = (body as { status?: unknown }).status;
        const detail = (body as { detail?: unknown }).detail;
        if (typeof status !== "string") {
          dispatch({
            kind: "action-error",
            key,
            message: "The host answered without a receipt — not applied.",
          });
          return;
        }
        // A confirmed like/save mirrors the engagement event SERVER-side
        // (the action use-case); the client accumulates the same frozen
        // event for the re-rank decision — pure data, no fabrication.
        let event: EntertainmentEvent | null = null;
        if (status === "confirmed" && session.view.stack !== null) {
          const [mirror] = shortFeedEvents(session.view.stack, {
            stamp: {
              userId: session.userId,
              sessionId: session.sessionId,
              occurredAt: new Date(nowMs).toISOString(),
            },
            action: { kind: action, itemId: current.item.id },
          });
          event = mirror ?? null;
        }
        const receiptAction: ShortsAction = {
          kind: "action-receipt",
          key,
          status: status as "confirmed" | "local-only" | "unsupported" | "failed",
          ...(typeof detail === "string" ? { detail } : {}),
          event,
        };
        dispatch(receiptAction);
        void maybeRerank(shortsSessionReducer(session, receiptAction));
      } catch {
        dispatch({
          kind: "action-error",
          key,
          message: "Network failure — the action was not applied.",
        });
      }
    },
    [emitEvent, maybeRerank, payload, realNow, session],
  );

  /** Touch swipe capture (the UI layer owns gestures — the model never does). */
  const touchStartY = useRef<number | null>(null);
  const onTouchStart = useCallback((event: ReactTouchEvent) => {
    touchStartY.current = event.touches[0]?.clientY ?? null;
  }, []);
  const onTouchEnd = useCallback(
    (event: ReactTouchEvent) => {
      const start = touchStartY.current;
      touchStartY.current = null;
      if (start === null) return;
      const end = event.changedTouches[0]?.clientY;
      if (end === undefined) return;
      const delta = start - end; // positive = finger moved up = next
      if (delta > 48) swipe("next");
      else if (delta < -48) swipe("back");
    },
    [swipe],
  );

  /** Keyboard: ArrowUp/PageUp = next, ArrowDown/PageDown = back. */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        swipe("next");
      } else if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        swipe("back");
      }
    },
    [swipe],
  );

  const view = session.view;
  const current = view.current;
  const next = view.next;
  const position =
    view.stack !== null ? `${view.stack.cursor + 1} / ${view.stack.items.length}` : null;
  const likeState =
    current !== null ? session.actionStates[`action:like:${current.item.id}`] : undefined;
  const saveState =
    current !== null ? session.actionStates[`action:save:${current.item.id}`] : undefined;

  return (
    <div className="wfx-shorts" data-wfx-surface="shorts" data-wfx-shorts-state={view.state}>
      <div
        className="wfx-shorts__viewport"
        role="region"
        aria-label="Short feed — swipe up for the next short, down to go back"
        tabIndex={0}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onKeyDown={onKeyDown}
        data-wfx-shorts-viewport
      >
        {renderElements(shortFeedElementTree(view), {
          onAction: (action) => {
            void fireAction(action);
          },
          actionStates: session.actionStates,
          art: {
            current: current !== null ? placeholderArt(current.item.id) : null,
            next: next !== null ? placeholderArt(next.item.id) : null,
          },
          monogram: {
            current: current !== null ? placeholderMonogram(current.overlay.title) : null,
            next: next !== null ? placeholderMonogram(next.overlay.title) : null,
          },
        })}
        {position !== null ? (
          <span className="wfx-shorts__position" data-wfx-shorts-position>
            {position}
          </span>
        ) : null}
        <span className="wfx-shorts__hint">Swipe, use ↑ ↓, or the buttons</span>
      </div>
      <div className="wfx-shorts__nav">
        <button
          type="button"
          className="wfx-roundbtn"
          onClick={() => {
            swipe("next");
          }}
          aria-label="Next short"
          data-wfx-shorts-next
        >
          <Icon name="arrowUp" size={22} />
          <span className="wfx-roundbtn__label">Next</span>
        </button>
        <button
          type="button"
          className="wfx-roundbtn"
          onClick={() => {
            swipe("back");
          }}
          aria-label="Previous short (bounded — never wraps)"
          data-wfx-shorts-back
        >
          <Icon name="arrowDown" size={22} />
          <span className="wfx-roundbtn__label">Back</span>
        </button>
      </div>
      {current !== null && current.orientation.tailReason !== null ? (
        <p className="wfx-shortcard__tailreason" data-wfx-shorts-tailreason>
          {current.orientation.tailReason}
        </p>
      ) : null}
      {session.emitError !== null ? (
        <p
          className="wfx-actionbar__status wfx-actionbar__status--error"
          role="alert"
          data-wfx-shorts-emit-error
        >
          {session.emitError}
        </p>
      ) : null}
      {session.shareNote !== null ? (
        <p className="wfx-actionbar__status" data-wfx-shorts-share-note>
          {session.shareNote}
        </p>
      ) : null}
      {likeState !== undefined && likeState.failure !== null ? (
        <p className="wfx-actionbar__status wfx-actionbar__status--error" role="alert">
          {likeState.failure}
        </p>
      ) : null}
      {saveState !== undefined && saveState.failure !== null ? (
        <p className="wfx-actionbar__status wfx-actionbar__status--error" role="alert">
          {saveState.failure}
        </p>
      ) : null}
      {session.rerankNotes.length > 0 ? (
        <p className="wfx-shorts__hint" data-wfx-shorts-rerank>
          {session.rerankNotes[session.rerankNotes.length - 1]}
        </p>
      ) : null}
    </div>
  );
}
