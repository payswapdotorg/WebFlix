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
 * R32 — THE G4 RAIL JOIN (docs/parity-lab/r30/gap-captures/20260926-093102/
 * G4-CORPUS.md, the shorts action rail — the fourth-gap corpus, now
 * captured live): the current card's engagement actions render as the
 * captured RIGHT ACTION COLUMN (the 48px-wide rail hugging the viewport's
 * right edge, 48x48 buttons at the 78px vertical pitch, the count slot
 * under each icon, the channel avatar as the rail's 5th element below)
 * + the captured CHANNEL ROW (bottom-left, above the title): the sources
 *   model's own identity + the Subscribe pill through the REAL subscribe
 *   seam (the same POST /api/library the watch page's pill, the rail
 *   subscriptions, and the subscriptions feed use). THE HONEST-RAIL LAW:
 *   the rail binds to REAL capabilities only — comments and remix have no
 *   WebFlix surface (omitted — the typed absence) and the count slots
 *   bind ONLY to real data (like/save carry no like-count datum — the
 *   icon-only form; share carries its captured "Share" text label).
 *   §G3 (the home resume bar) stays PENDING — not this lane's surface.
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
  useState,
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
// R32 — the G4 channel row (the REAL subscribe seam's pill).
import { ShortsSubscribeRow, type ShortsSubscribeRowProps } from "@/components/shorts/ShortsSubscribeRow";

// ---------------------------------------------------------------------------
// R32 — the session channel truths (the G4 rail's identity joins)
// ---------------------------------------------------------------------------

/** The session's source-identity index key (the durable cross-load key). */
function sourceKeyOf(realization: { connectorId: string; externalRef: string }): string {
  return `${realization.connectorId}\u0000${realization.externalRef}`;
}

/** Seed the session's subscribed-record from the boot payload's library read. */
function seedSubscribedKeys(payload: ShortsBootPayload): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const key of payload.subscriptions.sourceKeys) {
    keys.add(sourceKeyOf(key));
  }
  for (const itemId of payload.subscriptions.itemIds) {
    keys.add(itemId);
  }
  return keys;
}

/** The rail's channel chrome: the current card's identity truth (or null). */
interface RailChannelTruth {
  /** The sources model's own display name (the honest fallback: the connector id). */
  readonly channelName: string;
  readonly connectorId: string;
  readonly externalRef: string;
}

// ---------------------------------------------------------------------------
// The session reducer (pure, exported for the composition tests)
// ---------------------------------------------------------------------------

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
  | { kind: "emit-ok" };

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
  /**
   * R32 — the G4 rail's channel chrome (the current card's identity truth):
   * the sources-model name for the avatar monogram (the monogram law), or
   * null when the current card carries no joined source identity (the
   * avatar honestly renders no element — never a fabricated channel).
   */
  channel: { readonly name: string } | null;
  /**
   * R32 — the G4 channel row's serialized input (the subscribe seam's own
   * props, the controlled truth included), or null when the current card
   * carries no source identity.
   */
  subscribe: ShortsSubscribeRowProps | null;
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
        // R32 — THE G4 RAIL CELL (G4-CORPUS.md "THE ACTION RAIL": the 48x48
        // button at the 78px vertical pitch, the count label under the
        // icon, the 24px icon — g4-rail-full.json's yt-icon measure).
        // The tree's keys are `action:${type}:${itemId}` — the control key.
        const state = ctx.actionStates[element.key] ?? IDLE_ACTION;
        const active = state.optimistic || state.settled !== "idle";
        const iconName = element.action === "like" ? "like" : element.action === "save" ? "save" : "share";
        // THE COUNT-SLOT LAW (the honest-rail law): count labels bind ONLY
        // to real WebFlix data. Like/save carry NO like-count datum (the
        // actionStates seam settles a receipt, never a count) — the
        // icon-only form, never a fabricated "176K". Share carries its
        // captured "Share" TEXT label (the corpus's own no-count form).
        return (
          <div key={element.key} className="wfx-shortrail__cell" data-wfx-shortrail-cell={element.action}>
            <button
              type="button"
              className={`wfx-shortrail__btn${active ? " wfx-shortrail__btn--active" : ""}`}
              onClick={() => {
                ctx.onAction(element.action);
              }}
              aria-label={element.a11yLabel}
              {...(element.action === "share" ? {} : { "aria-pressed": active })}
              disabled={state.pending}
              data-wfx-shorts-action={element.action}
            >
              <Icon name={iconName} size={24} />
            </button>
            {element.action === "share" ? (
              <span className="wfx-shortrail__count" data-wfx-shortrail-count="share">
                Share
              </span>
            ) : null}
          </div>
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
              {/* R32 — THE G4 CHANNEL ROW (G4-CORPUS.md "THE CHANNEL ROW
                  (bottom-left)": the @handle slot + the Subscribe pill,
                  above the title). WebFlix's identity truth: the sources
                  model's own display name (never a fabricated @handle);
                  the pill writes through the REAL subscribe seam. The
                  row is keyed by the current card so a swipe remounts it
                  on the new card's own truth (the feed owns the session
                  record — see the component body). */}
              {isCurrent && ctx.subscribe !== null ? (
                <ShortsSubscribeRow key={`subscribe:${element.key}`} {...ctx.subscribe} />
              ) : null}
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
              <div
                className="wfx-shortrail"
                data-wfx-shortrail
                data-wfx-shortrail-absent="comments remix"
                role="group"
                aria-label="Short actions"
              >
                {/* The tree's action elements (present affordances only —
                    like/save/share through the frozen wiring + the
                    actionStates seam) rendered at the captured grammar. */}
                {renderElements(
                  element.children.filter((child) => child.type === "action"),
                  ctx,
                )}
                {/* R32 — THE RAIL'S 5TH ELEMENT (G4-CORPUS.md: the channel
                    avatar BELOW the actions): the monogram law (the rail
                    subscriptions' 24x24 pattern — the channel identity's
                    own first mark). NO LINK: WebFlix has no channel
                    destination (the honest absence — never a fabricated
                    link); the identity renders in the channel row. */}
                {ctx.channel !== null ? (
                  <span className="wfx-shortrail__avatar" aria-hidden="true" data-wfx-shortrail-avatar>
                    {ctx.channel.name.length > 0 ? ctx.channel.name[0]!.toUpperCase() : "W"}
                  </span>
                ) : null}
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

  // R32 — THE SESSION REALIZATION INDEX (the G4 rail's identity source):
  // itemId → the card's source realization (connectorId + externalRef),
  // seeded from the boot page and extended by every fresh re-rank page —
  // so a re-ranked current card keeps its channel row + subscribe write
  // (the boot page alone cannot answer for cards it never carried; the
  // index is the session's own record, never a second source of truth —
  // every entry comes from a real page the runtime composed).
  const realizationIndexRef = useRef<Map<string, { connectorId: string; externalRef: string }>>(
    new Map(),
  );
  if (realizationIndexRef.current.size === 0) {
    for (const card of payload.page.cards) {
      const realization = card.candidate?.realization;
      if (
        typeof card.candidate?.itemId === "string" &&
        typeof realization?.connectorId === "string" &&
        typeof realization?.externalRef === "string"
      ) {
        realizationIndexRef.current.set(card.candidate.itemId, {
          connectorId: realization.connectorId,
          externalRef: realization.externalRef,
        });
      }
    }
  }

  // R32 — THE SESSION SUBSCRIBED-RECORD (the subscribe pill's controlled
  // truth): seeded from the boot payload's library read (the stored
  // rows' source identities — the durable cross-load key — + the local
  // fold's canonical item ids), kept current by the pill's writes. A
  // swipe away and back renders the CURRENT card's own truth.
  const [subscribedKeys, setSubscribedKeys] = useState<ReadonlySet<string>>(() =>
    seedSubscribedKeys(payload),
  );

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
      // R32 — index the fresh page's realizations (the session record the
      // rail's channel row reads; never a second source of identity — the
      // page is the runtime's own composition).
      for (const card of page.cards) {
        const realization = card.candidate?.realization;
        if (
          typeof card.candidate?.itemId === "string" &&
          typeof realization?.connectorId === "string" &&
          typeof realization?.externalRef === "string"
        ) {
          realizationIndexRef.current.set(card.candidate.itemId, {
            connectorId: realization.connectorId,
            externalRef: realization.externalRef,
          });
        }
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
        // Share is EVENT-ONLY (no frozen UserAction type — typed absence).
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
        if (shareEvent !== undefined) await emitEvent(shareEvent);
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
    [emitEvent, maybeRerank, realNow, session],
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

  // R32 — THE G4 RAIL'S CHANNEL TRUTHS (the current card's own): the
  // realization join through the session index, the sources-model display
  // name (the honest fallback: the connector id — never a fabricated
  // @handle), and the controlled subscribed truth for the channel row.
  // No joined source identity ⇒ null (the avatar + the row render no
  // element — honest).
  const currentRealization = current !== null ? realizationIndexRef.current.get(current.item.id) : undefined;
  const railChannel: RailChannelTruth | null =
    current !== null && currentRealization !== undefined
      ? {
          channelName:
            payload.sourceNames[currentRealization.connectorId] ?? currentRealization.connectorId,
          connectorId: currentRealization.connectorId,
          externalRef: currentRealization.externalRef,
        }
      : null;
  /** The pill's write settles: the session record adopts both keys. */
  const onRailSubscribedChange = useCallback(
    (nextSubscribed: boolean): void => {
      if (current === null || currentRealization === undefined) return;
      const itemId = current.item.id;
      const sourceKey = sourceKeyOf(currentRealization);
      setSubscribedKeys((previous) => {
        const record = new Set(previous);
        if (nextSubscribed) {
          record.add(itemId);
          record.add(sourceKey);
        } else {
          record.delete(itemId);
          record.delete(sourceKey);
        }
        return record;
      });
    },
    [current, currentRealization],
  );
  const railSubscribe: ShortsSubscribeRowProps | null =
    current !== null && railChannel !== null
      ? {
          channelName: railChannel.channelName,
          itemId: current.item.id,
          title: current.overlay.title,
          connectorId: railChannel.connectorId,
          externalRef: railChannel.externalRef,
          subscribed:
            subscribedKeys.has(sourceKeyOf(railChannel)) || subscribedKeys.has(current.item.id),
          onSubscribedChange: onRailSubscribedChange,
        }
      : null;

  // R24-W2 — THE SHORTS PARITY CONTROLS (the R24-C Shorts rows: speed
  // controls / clear-screen viewing / inline feedback / the source link).
  // View-state + the same seams the long-form surfaces use: the session
  // rate (applied where a stage media element exists), the distraction-
  // free presentation, the J15 feedback vocabulary through /api/feedback,
  // and the canonical source chip.
  const [shortsRate, setShortsRate] = useState(1);
  const [clearScreen, setClearScreen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackOutcome, setFeedbackOutcome] = useState<string | null>(null);

  /** Apply the shorts stage rate (the same session-rate seam as the chrome). */
  const applyShortsRate = useCallback((nextRate: number): void => {
    setShortsRate(nextRate);
    const viewport = document.querySelector<HTMLElement>("[data-wfx-shorts-viewport]");
    const media = viewport?.querySelectorAll("video, audio");
    if (media !== undefined && media !== null) {
      for (const element of Array.from(media)) {
        (element as HTMLMediaElement).playbackRate = nextRate;
      }
    }
  }, []);

  /** Submit one inline feedback record through the same J15 seam. */
  const submitShortsFeedback = useCallback(async (kind: "more-like-this" | "not-interested"): Promise<void> => {
    if (current === null) return;
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, target: current.item.id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setFeedbackOutcome(`Feedback was NOT recorded (${response.status}${body?.error !== undefined ? `: ${body.error}` : ""}).`);
        return;
      }
      setFeedbackOutcome(kind === "not-interested" ? "Recorded — you'll see less like this." : "Recorded — you'll see more like this.");
      setFeedbackOpen(false);
    } catch {
      setFeedbackOutcome("Feedback could not reach the host — nothing was recorded.");
    }
  }, [current]);

  return (
    <div className="wfx-shorts" data-wfx-surface="shorts" data-wfx-shorts-state={view.state}>
      <div
        className={`wfx-shorts__viewport${clearScreen ? " wfx-shorts__viewport--clear" : ""}`}
        role="region"
        aria-label="Short feed — swipe up for the next short, down to go back"
        tabIndex={0}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onKeyDown={onKeyDown}
        data-wfx-shorts-viewport
        data-wfx-shorts-clearscreen={clearScreen ? "true" : "false"}
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
          // R32 — the G4 rail's channel chrome (the current card's own
          // truth): the realization join (the session index — boot page +
          // every fresh re-rank page), the sources-model display name (the
          // honest fallback: the connector id), and the controlled
          // subscribed truth for the subscribe row. No joined identity ⇒
          // no avatar + no channel row (honest — never a fabricated
          // channel).
          channel:
            current !== null && railChannel !== null ? { name: railChannel.channelName } : null,
          subscribe: railSubscribe,
        })}
        {position !== null ? (
          <span className="wfx-shorts__position" data-wfx-shorts-position>
            {position}
          </span>
        ) : null}
        {/* R24-W2 — THE SHORTS PARITY CONTROL ROW (speed / clear screen /
            inline feedback / the source link — the same vocabulary the
            long-form surfaces carry, at the Shorts card's own placement).
            The clear-screen state hides the overlay chrome (the controls
            stay reachable — the toggle brings it back). */}
        {current !== null ? (
          <div className="wfx-shorts__controls" data-wfx-shorts-controls>
            {/* The source chip: the canonical source identity from the boot
                page's OWN card for this item (the same realization truth the
                feed composed — never a second source of identity). */}
            {(() => {
              const pageCard = payload.page.cards.find(
                (card) => card.candidate?.itemId === current.item.id,
              );
              const sourceId = pageCard?.candidate?.realization?.connectorId;
              return typeof sourceId === "string" && sourceId.length > 0 ? (
                <span className="wfx-capchip" data-wfx-shorts-source>
                  From {sourceId}
                </span>
              ) : null;
            })()}
            <label className="wfx-shorts__speed" data-wfx-shorts-speed>
              <span className="wfx-sr-only">Playback speed</span>
              <select
                value={shortsRate}
                onChange={(event) => {
                  applyShortsRate(Number(event.target.value));
                }}
                data-wfx-shorts-speed-select
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((step) => (
                  <option key={step} value={step}>
                    {step === 1 ? "Normal" : `${step}×`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="wfx-chrome__btn"
              onClick={() => {
                setClearScreen((currentValue) => !currentValue);
              }}
              aria-pressed={clearScreen}
              aria-label={clearScreen ? "Show the card overlay" : "Clear screen (hide the overlay)"}
              data-wfx-shorts-clearscreen-toggle
            >
              <Icon name="miniplayer" size={18} />
            </button>
            <div className="wfx-shorts__feedback" data-wfx-shorts-feedback>
              <button
                type="button"
                className="wfx-chrome__btn"
                onClick={() => {
                  setFeedbackOpen((currentValue) => !currentValue);
                }}
                aria-expanded={feedbackOpen}
                aria-label="Recommendation feedback for this short"
                data-wfx-shorts-feedback-toggle
              >
                <Icon name="sparkle" size={18} />
              </button>
              {feedbackOpen ? (
                <div className="wfx-shorts__feedbackmenu" role="menu" data-wfx-shorts-feedback-menu>
                  <button
                    type="button"
                    className="wfx-share__row"
                    onClick={() => {
                      void submitShortsFeedback("more-like-this");
                    }}
                    data-wfx-shorts-feedback-kind="more-like-this"
                  >
                    More like this
                  </button>
                  <button
                    type="button"
                    className="wfx-share__row"
                    onClick={() => {
                      void submitShortsFeedback("not-interested");
                    }}
                    data-wfx-shorts-feedback-kind="not-interested"
                  >
                    Not interested
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {feedbackOutcome !== null ? (
          <span className="wfx-shorts__hint" role="status" data-wfx-shorts-feedback-status>
            {feedbackOutcome}
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
