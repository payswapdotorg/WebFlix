/**
 * WFX-051 short feed surface composition tests (bun:test).
 *
 * Proves the WFX-028 vertical surface through the SAME frozen presenter
 * the client island uses:
 *
 * - boot payload + initial render: the fixture shorts page renders the
 *   current card, position, share control, and HONEST ABSENT like/save
 *   controls (the fixture shorts declare no like/save capabilities — the
 *   tree omits them, never a greyed-out lie);
 * - a source that DOES declare like/save renders the controls;
 * - the REPLACEMENT LAW smoke (the packet's acceptance criterion): driving
 *   the exported session reducer with scripted pages applies
 *   `planReplacement` — beyond-cursor slots only, the prefetch window
 *   kept, the current card never swapped mid-view, and a plan computed at
 *   APPLY time so swipes during the fetch are never clobbered;
 * - the honest-action law: an optimistic like/save is ROLLED BACK on a
 *   failed / unsupported receipt (never fake success), and stands on a
 *   confirmed one;
 * - the re-rank decision input: five forward swipes reach the balanced
 *   attention mode's swipe threshold.
 *
 * Deterministic: injected clock (`now`), scripted page source, fixture
 * ports. No network, no real time.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { EntertainmentEvent, EntertainmentItem } from "@wfx/domain";
import {
  DEFAULT_PREFETCH_AHEAD,
  FIXTURE_CLOCK_START_MS,
  buildShortCards,
  createShortFeedPresenter,
  makeFixturePorts,
  shortFeedEvents,
  type FeedCard,
  type ShortCard,
} from "@wfx/experience";

import { ShortsFeed, shortsSessionReducer, type ShortsSession } from "../src/components/shorts/ShortsFeed";
import { AppShell } from "../src/components/shell/AppShell";
import { bootWebClient } from "../src/main";
import { EXPERIENCE_CONTEXT, SESSION_POLICY } from "../src/host/experience";
import { projectShortsPage } from "../src/host/shorts";
import { withWatchStateRecording } from "../src/host/watch-state";

/** Run an async `body` with a controlled environment, restoring the real one after. */
async function withEnv(overrides: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const names = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV"];
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
    await body();
  } finally {
    for (const name of names) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** A canonical `wfxitm_` id for a small counter (valid ULID body by grammar). */
function itemIdOf(counter: number): string {
  return `wfxitm_${String(counter).padStart(26, "0")}`;
}

/** One hand-built vertical short-form feed card (deterministic, fixture-shaped). */
function scriptedCard(counter: number, title: string): FeedCard {
  const id = itemIdOf(counter);
  const item: EntertainmentItem = {
    id,
    canonicalType: "short",
    canonicalTitle: title,
    durationMs: 30_000,
    orientation: "vertical",
  };
  return {
    item,
    realization: {
      id: `wfxsrc_${String(counter).padStart(26, "0")}`,
      entertainmentItemId: id,
      connectorId: "fake-source",
      externalRef: `fake:scripted-${counter}`,
      capabilities: ["playEmbed", "like", "save"],
      availability: "available",
    },
  };
}

/** Project scripted cards into the OS page shape (the host projection). */
function scriptedPage(cards: readonly FeedCard[]): ReturnType<typeof projectShortsPage> {
  return projectShortsPage([...cards]);
}

/** Build the initial session from scripted cards (the component's initializer). */
function scriptedSession(cards: readonly FeedCard[]): ShortsSession {
  const presenter = createShortFeedPresenter();
  const view = presenter.initial(scriptedPage(cards), {
    userId: EXPERIENCE_CONTEXT.userId,
    sessionId: EXPERIENCE_CONTEXT.sessionId,
    prefetchAhead: DEFAULT_PREFETCH_AHEAD,
  });
  return {
    view,
    policy: SESSION_POLICY,
    userId: EXPERIENCE_CONTEXT.userId,
    sessionId: EXPERIENCE_CONTEXT.sessionId,
    swipesSinceRerank: 0,
    lastRerankAtMs: FIXTURE_CLOCK_START_MS,
    skippedItemIds: [],
    events: [],
    rerankNotes: [],
    rerankBusy: false,
    actionStates: {},
    emitError: null,
  };
}

/** The frozen presenter — one instance per scripted scenario. */
const presenter = createShortFeedPresenter();

/** Swipe the scripted session forward, returning the new session (skip event composed like the component does). */
function swipeNextScripted(session: ShortsSession): ShortsSession {
  const nowMs = session.lastRerankAtMs + 1_000;
  const view = presenter.swipeNext(session.view);
  let skipEvent: EntertainmentEvent | null = null;
  const trail = view.transition.event;
  if (
    view.transition.kind === "swipe-next" &&
    trail !== undefined &&
    trail.kind === "swipe-next" &&
    view.stack !== null
  ) {
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
  return shortsSessionReducer(session, {
    kind: "swipe",
    direction: "next",
    view,
    skipEvent,
    nowMs,
  });
}

describe("WFX-051 short feed surface (frozen presenter + session reducer)", () => {
  it("initial render: fixture shorts render with honestly-absent like/save controls", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = {
        mode: "fixtures" as const,
        client: bootWebClient({ ports: withWatchStateRecording(makeFixturePorts()) }),
      };
      const payload = await import("../src/host/shorts").then((m) => m.loadShortsPayload(host));
      expect(payload.policy.attentionMode).toBe("balanced");
      expect(payload.prefetchAhead).toBe(2);
      expect(
        payload.page.cards.map((card) => card.candidate.features.canonicalTitle),
      ).toEqual(["Neon Rain", "Midnight Scoop", "Rain Check"]);

      const markup = renderToStaticMarkup(
        createElement(AppShell, {
          mode: "fixtures",
          active: "/shorts",
          mainClass: "wfx-main--flush",
          children: createElement(ShortsFeed, {
            payload,
            now: () => FIXTURE_CLOCK_START_MS, // the injected clock seam
            fetchPage: async () => payload.page, // the scripted page seam
          }),
        }),
      );

      expect(markup).toContain("data-wfx-surface=\"shorts\"");
      expect(markup).toContain("Neon Rain"); // the current card
      expect(markup).toContain("1 / 3"); // the position readout
      expect(markup).toContain("data-wfx-shorts-action=\"share\""); // share is event-only — always present
      // The fixture shorts declare NO like/save capabilities: the controls
      // are omitted (typed absence), never rendered as greyed-out lies.
      expect(markup).not.toContain("data-wfx-shorts-action=\"like\"");
      expect(markup).not.toContain("data-wfx-shorts-action=\"save\"");
    });
  });

  it("a source that declares like/save renders the controls on the current card", async () => {
    const cards = [scriptedCard(900, "Sunset Nine")];
    const session = scriptedSession(cards);
    const payload = {
      page: scriptedPage(cards),
      policy: SESSION_POLICY,
      userId: EXPERIENCE_CONTEXT.userId,
      sessionId: EXPERIENCE_CONTEXT.sessionId,
      seedQuery: "n",
      prefetchAhead: DEFAULT_PREFETCH_AHEAD,
    };
    const markup = renderToStaticMarkup(
      createElement(ShortsFeed, {
        payload,
        now: () => FIXTURE_CLOCK_START_MS,
        fetchPage: async () => payload.page,
      }),
    );
    expect(session.view.current?.item.id).toBe(itemIdOf(900));
    expect(markup).toContain("data-wfx-shorts-action=\"like\"");
    expect(markup).toContain("data-wfx-shorts-action=\"save\"");
  });

  it("the replacement law: a fresh page replaces beyond-window slots only, never the current card", () => {
    // 8 scripted cards, cursor 0, prefetch window 2.
    const stack = scriptedSession([1, 2, 3, 4, 5, 6, 7, 8].map((n) => scriptedCard(n, `Short ${n}`)));
    // Two forward swipes: cursor 2, items 1+2 skipped.
    let session = swipeNextScripted(swipeNextScripted(stack));
    expect(session.view.stack?.cursor).toBe(2);
    expect(session.skippedItemIds).toEqual([itemIdOf(1), itemIdOf(2)]);

    // A fresh page with three NEW candidates (ids 101-103).
    const fresh: readonly ShortCard[] = buildShortCards(
      scriptedPage([101, 102, 103].map((n) => scriptedCard(n, `Fresh ${n}`))),
      {},
    ).cards;

    session = shortsSessionReducer(session, {
      kind: "rerank-applied",
      freshCards: fresh,
      notes: ["test: swipe threshold reached"],
      nowMs: session.lastRerankAtMs + 10_000,
    });

    const items = session.view.stack?.items ?? [];
    // Nothing removed, nothing added beyond the replaced far-runway slots.
    expect(items).toHaveLength(8);
    // The current card is NEVER swapped mid-view.
    expect(items[2]?.item.id).toBe(itemIdOf(3));
    // Behind-cursor history and the prefetch window stay.
    expect(items.slice(0, 5).map((card) => card.item.id)).toEqual([
      itemIdOf(1),
      itemIdOf(2),
      itemIdOf(3),
      itemIdOf(4),
      itemIdOf(5),
    ]);
    // The three beyond-window slots (6, 7, 8) received the fresh candidates.
    expect(items.slice(5).map((card) => card.item.id)).toEqual([itemIdOf(101), itemIdOf(102), itemIdOf(103)]);
    // The counters reset and the explainability note is carried.
    expect(session.swipesSinceRerank).toBe(0);
    expect(session.rerankNotes.join(" ")).toContain("3 replacement(s)");
    // The re-rank resets the decision window.
    expect(session.events).toEqual([]);
  });

  it("the replacement plan is recomputed at apply time — swipes during the fetch are never clobbered", () => {
    const stack = scriptedSession([1, 2, 3, 4, 5, 6, 7, 8].map((n) => scriptedCard(n, `Short ${n}`)));
    let session = swipeNextScripted(swipeNextScripted(stack)); // cursor 2
    session = shortsSessionReducer(session, { kind: "rerank-begin" }); // the fetch starts
    session = swipeNextScripted(session); // the user swipes DURING the fetch → cursor 3

    const fresh: readonly ShortCard[] = buildShortCards(
      scriptedPage([101, 102, 103].map((n) => scriptedCard(n, `Fresh ${n}`))),
      {},
    ).cards;
    session = shortsSessionReducer(session, {
      kind: "rerank-applied",
      freshCards: fresh,
      notes: ["test"],
      nowMs: session.lastRerankAtMs + 10_000,
    });

    const items = session.view.stack?.items ?? [];
    // The plan fit the CURRENT stack (cursor 3, window ≤ 5): slots 6+7
    // replaced, the user's position kept, the current card untouched.
    expect(items).toHaveLength(8);
    expect(session.view.stack?.cursor).toBe(3);
    expect(items[3]?.item.id).toBe(itemIdOf(4));
    expect(items.slice(0, 6).map((card) => card.item.id)).toEqual([
      itemIdOf(1),
      itemIdOf(2),
      itemIdOf(3),
      itemIdOf(4),
      itemIdOf(5),
      itemIdOf(6),
    ]);
    expect(items.slice(6).map((card) => card.item.id)).toEqual([itemIdOf(101), itemIdOf(102)]);
  });

  it("five forward swipes reach the balanced attention mode's re-rank threshold", () => {
    const stack = scriptedSession([1, 2, 3].map((n) => scriptedCard(n, `Short ${n}`)));
    let session = stack;
    for (let index = 0; index < 5; index += 1) {
      session = swipeNextScripted(session); // includes typed no-ops at the last card
    }
    expect(session.swipesSinceRerank).toBe(5);
  });

  it("honest actions: a failed receipt rolls the optimistic state back; a confirmed one stands", () => {
    const session = scriptedSession([1].map((n) => scriptedCard(n, "Short 1")));
    const key = `action:like:${itemIdOf(1)}`;

    const begun = shortsSessionReducer(session, { kind: "action-begin", key });
    expect(begun.actionStates[key]?.optimistic).toBeTrue();

    // The source DECLINED (failed receipt with detail) → rollback + message.
    const failed = shortsSessionReducer(begun, {
      kind: "action-receipt",
      key,
      status: "failed",
      detail: "quota exceeded",
      event: null,
    });
    expect(failed.actionStates[key]?.optimistic).toBeFalse();
    expect(failed.actionStates[key]?.settled).toBe("idle");
    expect(failed.actionStates[key]?.failure).toContain("The source declined: quota exceeded");

    // The capability is ABSENT (unsupported receipt) → rollback + the typed note.
    const unsupported = shortsSessionReducer(begun, {
      kind: "action-receipt",
      key,
      status: "unsupported",
      event: null,
    });
    expect(unsupported.actionStates[key]?.settled).toBe("idle");
    expect(unsupported.actionStates[key]?.failure).toContain(
      "This source does not support that action.",
    );

    // A CONFIRMED receipt stands (never rolled back), and the engagement
    // event joins the re-rank decision input.
    const confirmed = shortsSessionReducer(begun, {
      kind: "action-receipt",
      key,
      status: "confirmed",
      event: {
        userId: session.userId,
        itemId: itemIdOf(1),
        type: "like",
        occurredAt: new Date(FIXTURE_CLOCK_START_MS).toISOString(),
        sessionId: session.sessionId,
      },
    });
    expect(confirmed.actionStates[key]?.settled).toBe("confirmed");
    expect(confirmed.actionStates[key]?.failure).toBeNull();
    expect(confirmed.events.map((event) => event.type)).toEqual(["like"]);
  });

  it("an emit failure is surfaced, never swallowed (the sink honesty law)", () => {
    const session = scriptedSession([1].map((n) => scriptedCard(n, "Short 1")));
    const failed = shortsSessionReducer(session, {
      kind: "emit-error",
      message: "Watch state was NOT recorded (502).",
    });
    expect(failed.emitError).toContain("NOT recorded");
    const recovered = shortsSessionReducer(failed, { kind: "emit-ok" });
    expect(recovered.emitError).toBeNull();
  });
});
