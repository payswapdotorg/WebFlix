/**
 * @wfx/experience — Short Feed tests (WFX-028, Lane C).
 *
 * Coverage required by the dispatch packet:
 * - Stack operations: swipe next/back bounds, replace, insert immutability +
 *   trail events (typed no-ops at the bounds; backward swipe NEVER wraps).
 * - Vertical-first ordering with typed-tailed non-vertical items.
 * - Replacement policy: watched/skipped ⇒ replaceable, unwatched within the
 *   prefetch window ⇒ kept; golden merge outputs.
 * - Rerank triggers: N-swipe, M-second, engagement-signal thresholds (from
 *   the frozen intent-graph policy vocabulary); decision payload = ADDITIVE
 *   intent inputs only (the exact WFX-011 inference output); no
 *   below-visibility demotion (the reorder scope is a permutation).
 * - Event emission: every interaction type → exact frozen event payloads
 *   (progress with payload percent, complete, skip, like, save, share),
 *   sessionId wired, validated by the WFX-002 validator.
 * - A11y labels on every card (and in the element tree).
 *
 * The OS page fixtures are the documented STRUCTURAL MIRROR of the WFX-021
 * `FeedPage` (see src/short/card.ts): every field is copied verbatim from
 * packages/recommendation/src/os/types.ts, so a real OS short page is
 * assignable to these fixtures. `@wfx/recommendation` is not a declared
 * dependency of this package (dependency honesty) and cannot be imported
 * here — the intent-update expectations are asserted against the real
 * `inferFromEvents` from `@wfx/domain` (byte-identical outputs).
 */

import { describe, expect, it } from "bun:test";
import type {
  EntertainmentEvent,
  EntertainmentItem,
  RecommendationPolicy,
} from "@wfx/domain";
import { inferFromEvents, validateEntertainmentEvent } from "@wfx/domain";

import {
  BALANCED_RERANK_ELAPSED_MS,
  BALANCED_RERANK_SWIPE_THRESHOLD,
  DEFAULT_PREFETCH_AHEAD,
  IMMERSIVE_RERANK_ELAPSED_MS,
  IMMERSIVE_RERANK_SWIPE_THRESHOLD,
  MINDFUL_RERANK_ELAPSED_MS,
  MINDFUL_RERANK_SWIPE_THRESHOLD,
  RERANK_THRESHOLDS,
  SHORT_ORIENTATION_TIERS,
  buildShortCards,
  cardActionRequest,
  createShortFeedPresenter,
  createShortFeedStack,
  currentCard,
  insertAhead,
  nextCard,
  planReplacement,
  replaceAt,
  shortCardTitle,
  shortFeedElementTree,
  shortFeedEvents,
  shouldRerank,
  swipeBack,
  swipeNext,
  type ShortCard,
  type ShortFeedCard,
  type ShortFeedPage,
  type ShortFeedStack,
  type ShortSessionState,
  type StackEvent,
} from "../src/index";
import { ExperienceError } from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

const USER = "user-1";
const SESSION = "session-1";
const STAMP_AT = "2026-09-13T12:00:00.000Z";
const NOW_MS = Date.parse(STAMP_AT);

/** Canonical item id: `wfxitm_` + zero-padded 26-char body (valid ULID grammar). */
function IT(n: number): string {
  return `wfxitm_${String(n).padStart(26, "0")}`;
}

/** Canonical source-realization id (`wfxsrc_` + 26-char body). */
function SRC(n: number): string {
  return `wfxsrc_${String(n).padStart(26, "0")}`;
}

/** A valid frozen policy for one attention mode (deterministic — no ULID minting). */
function policy(attentionMode: RecommendationPolicy["attentionMode"]): RecommendationPolicy {
  return {
    id: "wfxpol_fixture",
    userId: USER,
    objectives: [],
    exploration: 0.2,
    novelty: 0.2,
    socialInfluence: 0.1,
    attentionMode,
  };
}

/** One valid frozen engagement event. */
function event(
  type: EntertainmentEvent["type"],
  itemId: string,
  occurredAt = STAMP_AT,
): EntertainmentEvent {
  return {
    userId: USER,
    itemId,
    type,
    occurredAt,
    sessionId: SESSION,
  };
}

// ---------------------------------------------------------------------------
// OS page fixtures (the WFX-021 structural mirror)
// ---------------------------------------------------------------------------

interface OsCardSpec {
  item: number;
  orientation?: "vertical" | "horizontal" | "square" | "unknown";
  title?: string;
  durationMs?: number;
  topic?: string;
  /** Omit the canonicalType feature — the candidate cannot be classified. */
  unclassifiable?: boolean;
  /** Non-short-form canonical type (e.g. a long movie). */
  canonicalType?: string;
  capabilities?: string[];
}

function osCard(spec: OsCardSpec, position: number): ShortFeedCard {
  const features: Record<string, string | number | boolean> = {};
  if (!spec.unclassifiable) features["canonicalType"] = spec.canonicalType ?? "short";
  if (spec.orientation !== undefined) features["orientation"] = spec.orientation;
  if (spec.title !== undefined) features["canonicalTitle"] = spec.title;
  if (spec.durationMs !== undefined) features["durationMs"] = spec.durationMs;
  if (spec.topic !== undefined) features["topic"] = spec.topic;
  return {
    position,
    candidate: {
      itemId: IT(spec.item),
      realization: {
        connectorId: "shorts-source",
        externalRef: `ref-${spec.item}`,
        capabilities: spec.capabilities ?? ["playNative"],
        availability: "available",
      },
      features,
    },
    modelScore: 0.5,
    confidence: 0.5,
    explanations: ["fixture"],
    dominantObjective: null,
    positionReasons: ["fixture position"],
  };
}

function osPage(specs: readonly OsCardSpec[]): ShortFeedPage {
  return {
    surface: "short",
    userId: USER,
    sessionId: SESSION,
    cards: specs.map((spec, index) => osCard(spec, index)),
  };
}

/** Build ShortCards from specs (vertical-first, via the real projection). */
function cards(specs: readonly OsCardSpec[]): readonly ShortCard[] {
  return buildShortCards(osPage(specs)).cards;
}

/** A simple vertical short card fixture. */
function shortCard(item: number, title?: string): ShortCard {
  const built = cards([
    {
      item,
      orientation: "vertical" as const,
      durationMs: 15_000,
      ...(title !== undefined ? { title } : {}),
    },
  ]);
  if (built.length !== 1) throw new Error("fixture setup failed");
  return built[0]!;
}

/** The session state fixture (deterministic). */
function sessionState(overrides: Partial<ShortSessionState> = {}): ShortSessionState {
  return {
    userId: USER,
    sessionId: SESSION,
    policy: policy("balanced"),
    watchedItemIds: [],
    skippedItemIds: [],
    swipesSinceRerank: 0,
    msSinceRerank: 0,
    nowMs: NOW_MS,
    aheadOfCursorItemIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stack operations
// ---------------------------------------------------------------------------

describe("ShortFeedStack operations", () => {
  function stackOf(count: number, cursor = 0): ShortFeedStack {
    const specs = Array.from({ length: count }, (_, i) => ({ item: i + 1, orientation: "vertical" as const }));
    return createShortFeedStack(cards(specs), { cursor });
  }

  it("swipeNext advances the cursor and returns the typed trail event", () => {
    const stack = stackOf(3);
    const { stack: next, event } = swipeNext(stack);
    expect(next.cursor).toBe(1);
    expect(next.items).toHaveLength(3);
    expect(event).toEqual({
      kind: "swipe-next",
      fromCursor: 0,
      toCursor: 1,
      leftItemId: IT(1),
      enteredItemId: IT(2),
    });
  });

  it("swipeNext is immutable: the original stack is untouched", () => {
    const stack = stackOf(3);
    const snapshot = JSON.stringify(stack);
    const { stack: next } = swipeNext(stack);
    expect(next).not.toBe(stack);
    expect(next.items).not.toBe(stack.items);
    expect(JSON.stringify(stack)).toBe(snapshot); // original unchanged
    expect(stack.cursor).toBe(0);
  });

  it("swipeNext at the last card is a typed no-op — the feed never wraps forward", () => {
    const stack = stackOf(2, 1);
    const { stack: next, event } = swipeNext(stack);
    expect(next).toBe(stack); // no-op returns the same (immutable) stack
    expect(event).toEqual({ kind: "swipe-next-noop", reason: "at-last-card", cursor: 1 });
  });

  it("swipeBack retreats the cursor with a typed trail event", () => {
    const stack = stackOf(3, 2);
    const { stack: back, event } = swipeBack(stack);
    expect(back.cursor).toBe(1);
    expect(event).toEqual({
      kind: "swipe-back",
      fromCursor: 2,
      toCursor: 1,
      leftItemId: IT(3),
      reEnteredItemId: IT(2),
    });
  });

  it("swipeBack at the FIRST card is a typed no-op — backward swipe NEVER wraps", () => {
    const stack = stackOf(3, 0);
    const { stack: back, event } = swipeBack(stack);
    expect(back).toBe(stack);
    expect(back.cursor).toBe(0);
    expect(back.items[0]!.item.id).toBe(IT(1)); // order untouched — no wrap to the tail
    expect(event).toEqual({ kind: "swipe-back-noop", reason: "at-first-card", cursor: 0 });
  });

  it("an empty stack yields typed no-ops for both swipes", () => {
    const empty = createShortFeedStack([]);
    expect(swipeNext(empty).event).toEqual({
      kind: "swipe-next-noop",
      reason: "empty-stack",
      cursor: 0,
    });
    expect(swipeBack(empty).event).toEqual({
      kind: "swipe-back-noop",
      reason: "empty-stack",
      cursor: 0,
    });
  });

  it("replaceAt swaps the slot, keeps the cursor, and reports the trail event", () => {
    const stack = stackOf(3);
    const replacement = shortCard(99, "Fresh");
    const { stack: replaced, event } = replaceAt(stack, 1, replacement);
    expect(replaced.cursor).toBe(0);
    expect(replaced.items.map((card) => card.item.id)).toEqual([IT(1), IT(99), IT(3)]);
    expect(event).toEqual({
      kind: "replace-at",
      index: 1,
      outItemId: IT(2),
      inItemId: IT(99),
    });
    // Immutability: the original stack is untouched.
    expect(stack.items[1]!.item.id).toBe(IT(2));
  });

  it("replaceAt throws the typed ExperienceError on an out-of-bounds index", () => {
    const stack = stackOf(3);
    expect(() => replaceAt(stack, 3, shortCard(99))).toThrow(ExperienceError);
    expect(() => replaceAt(stack, -1, shortCard(99))).toThrow(ExperienceError);
  });

  it("replaceAt refuses a replacement that would duplicate an item elsewhere in the stack", () => {
    const stack = stackOf(3);
    expect(() => replaceAt(stack, 0, shortCard(3))).toThrow(ExperienceError);
    // Replacing a slot with the SAME item id is allowed (view-data refresh).
    expect(() => replaceAt(stack, 1, shortCard(2))).not.toThrow();
  });

  it("insertAhead appends into the ahead region without moving the cursor", () => {
    const stack = stackOf(2);
    const { stack: grown, event } = insertAhead(stack, [shortCard(10), shortCard(11)]);
    expect(grown.cursor).toBe(0);
    expect(grown.items.map((card) => card.item.id)).toEqual([IT(1), IT(2), IT(10), IT(11)]);
    expect(event.kind).toBe("insert-ahead");
    if (event.kind === "insert-ahead") {
      expect(event.fromCount).toBe(2);
      expect(event.toCount).toBe(4);
      expect(event.insertedItemIds).toEqual([IT(10), IT(11)]);
      expect(event.skipped).toEqual([]);
    }
    // Immutability: the original stack is untouched.
    expect(stack.items).toHaveLength(2);
  });

  it("insertAhead skips OS re-supplies of items already in the stack (typed reason, no duplicate)", () => {
    const stack = stackOf(2);
    const { stack: grown, event } = insertAhead(stack, [shortCard(2), shortCard(10), shortCard(1)]);
    expect(grown.items.map((card) => card.item.id)).toEqual([IT(1), IT(2), IT(10)]);
    expect(event.kind).toBe("insert-ahead");
    if (event.kind === "insert-ahead") {
      expect(event.insertedItemIds).toEqual([IT(10)]);
      expect(event.skipped).toEqual([
        { itemId: IT(2), reason: "already present in the stack — one card per canonical item" },
        { itemId: IT(1), reason: "already present in the stack — one card per canonical item" },
      ]);
    }
  });

  it("createShortFeedStack rejects duplicate item ids, bad cursors, and negative prefetch", () => {
    const two = [shortCard(1), shortCard(1)];
    expect(() => createShortFeedStack(two)).toThrow(ExperienceError);
    expect(() => createShortFeedStack([shortCard(1)], { cursor: 1 })).toThrow(ExperienceError);
    expect(() => createShortFeedStack([shortCard(1)], { prefetchAhead: -1 })).toThrow(
      ExperienceError,
    );
    expect(() => createShortFeedStack([shortCard(1)], { cursor: -1 })).toThrow(ExperienceError);
  });

  it("currentCard / nextCard expose the cursor and the prefetch preview (null-safe)", () => {
    const stack = createShortFeedStack(cards([{ item: 1 }, { item: 2 }]), { cursor: 0 });
    expect(currentCard(stack)!.item.id).toBe(IT(1));
    expect(nextCard(stack)!.item.id).toBe(IT(2));
    expect(nextCard(swipeNext(stack).stack)).toBe(null);
    expect(DEFAULT_PREFETCH_AHEAD).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Vertical-first ordering (card view model)
// ---------------------------------------------------------------------------

describe("vertical-first ordering", () => {
  it("ranks vertical items ahead; non-vertical items are typed-tailed with a reason", () => {
    const specs: OsCardSpec[] = [
      { item: 1, orientation: "horizontal", title: "Wide Clip" }, // tier 2
      { item: 2, orientation: "vertical", title: "Dance" }, // tier 0
      { item: 3, orientation: "square", title: "Square Bit" }, // tier 1
      { item: 4, orientation: "vertical", title: "Skate" }, // tier 0
      { item: 5, title: "Unknown Orient" }, // orientation absent ⇒ unknown, tier 1
    ];
    const projection = buildShortCards(osPage(specs));
    expect(projection.cards.map((card) => card.item.id)).toEqual([
      IT(2), // vertical (OS order preserved within the tier)
      IT(4), // vertical
      IT(3), // square — mid tier
      IT(5), // unknown — mid tier
      IT(1), // horizontal — tail tier
    ]);

    const byId = new Map(projection.cards.map((card) => [card.item.id, card]));
    const vertical = byId.get(IT(2))!;
    expect(vertical.orientation.kind).toBe("vertical");
    expect(vertical.orientation.tier).toBe(SHORT_ORIENTATION_TIERS.vertical);
    expect(vertical.orientation.tailReason).toBeNull(); // vertical leads — no tail reason

    for (const id of [IT(3), IT(5), IT(1)]) {
      const card = byId.get(id)!;
      expect(card.orientation.tailReason).toBeTruthy(); // typed-tailed with a reason
      expect(card.orientation.tailReason!.length).toBeGreaterThan(0);
    }
    expect(byId.get(IT(3))!.orientation.tier).toBe(SHORT_ORIENTATION_TIERS.square);
    expect(byId.get(IT(1))!.orientation.tier).toBe(SHORT_ORIENTATION_TIERS.horizontal);
  });

  it("never fabricates cards: unclassifiable candidates land in unresolvedItemIds", () => {
    const projection = buildShortCards(
      osPage([{ item: 1, orientation: "vertical" }, { item: 2, unclassifiable: true }]),
    );
    expect(projection.cards.map((card) => card.item.id)).toEqual([IT(1)]);
    expect(projection.unresolvedItemIds).toEqual([IT(2)]);
  });

  it("excludes non-short-form candidates with typed transparency (content decides the surface)", () => {
    const projection = buildShortCards(
      osPage([
        { item: 1, orientation: "vertical" },
        { item: 2, canonicalType: "movie", orientation: "horizontal", durationMs: 7_200_000 },
      ]),
    );
    expect(projection.cards.map((card) => card.item.id)).toEqual([IT(1)]);
    expect(projection.nonShortFormItemIds).toEqual([IT(2)]);
  });

  it("keeps one card per canonical item — duplicates are reported, not repeated", () => {
    const projection = buildShortCards(
      osPage([
        { item: 1, orientation: "vertical" },
        { item: 1, orientation: "vertical" },
      ]),
    );
    expect(projection.cards).toHaveLength(1);
    expect(projection.duplicateItemIds).toEqual([IT(1)]);
  });

  it("host item joins are authoritative over candidate feature projections", () => {
    const joined: EntertainmentItem[] = [
      { id: IT(1), canonicalType: "short", orientation: "horizontal" }, // join says horizontal
    ];
    const projection = buildShortCards(
      osPage([{ item: 1, orientation: "vertical" }]), // features say vertical
      { items: joined },
    );
    expect(projection.cards[0]!.orientation.kind).toBe("horizontal"); // the join wins
    expect(projection.cards[0]!.orientation.tier).toBe(SHORT_ORIENTATION_TIERS.horizontal);
  });

  it("overlay data: deterministic title + typed-absent topic", () => {
    const [titled, untitled, withTopic] = cards([
      { item: 1, title: "Dance", topic: "dance" },
      { item: 2 }, // no title, no topic
      { item: 3, title: "Skate", topic: "  " }, // blank topic ⇒ typed-absent
    ]);
    expect(titled!.overlay.title).toBe("Dance");
    expect(titled!.overlay.topic).toBe("dance");
    expect(untitled!.overlay.title).toBe(IT(2)); // id fallback — never blank, never fabricated
    expect(untitled!.overlay.topic).toBeNull();
    expect(withTopic!.overlay.topic).toBeNull();
    expect(shortCardTitle({ id: IT(9), canonicalType: "short" })).toBe(IT(9));
  });

  it("durationMs is carried or typed-null (never faked)", () => {
    const [known, unknown] = cards([
      { item: 1, durationMs: 42_000 },
      { item: 2 },
    ]);
    expect(known!.durationMs).toBe(42_000);
    expect(unknown!.durationMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Engagement affordances (mapped to the WFX-005 action inputs)
// ---------------------------------------------------------------------------

describe("engagement affordances", () => {
  it("like/save map to the EXACT WFX-005 ActionRequest inputs when the realization declares them", () => {
    const [card] = cards([
      { item: 1, capabilities: ["playEmbed", "like", "save"] },
    ]);
    expect(card!.affordances.like).not.toBeNull();
    expect(card!.affordances.save).not.toBeNull();
    expect(cardActionRequest(card!.affordances.like!)).toEqual({
      type: "like",
      connectorId: "shorts-source",
      externalRef: "ref-1",
      itemId: IT(1),
    });
    expect(cardActionRequest(card!.affordances.save!)).toEqual({
      type: "save",
      connectorId: "shorts-source",
      externalRef: "ref-1",
      itemId: IT(1),
    });
  });

  it("absent like/save capabilities are typed-null (never greyed-out lies)", () => {
    const [card] = cards([{ item: 1, capabilities: ["playNative"] }]);
    expect(card!.affordances.like).toBeNull();
    expect(card!.affordances.save).toBeNull();
  });

  it("share is ALWAYS present and honestly typed as event-only (no frozen UserAction type)", () => {
    const [card] = cards([{ item: 1, capabilities: [] }]);
    expect(card!.affordances.share).toEqual({
      kind: "share",
      itemId: IT(1),
      channel: "event",
      detail: expect.stringContaining("no frozen UserAction type"),
    });
  });

  it("the realization badge derives the play mode by the frozen precedence (or is honestly null)", () => {
    const [embed, none] = cards([
      { item: 1, capabilities: ["playExternal", "playEmbed"] }, // embed wins over external
      { item: 2, capabilities: ["like"] }, // no play capability ⇒ no badge
    ]);
    expect(embed!.realizationBadge).toEqual({
      connectorId: "shorts-source",
      mode: "embed",
      externalRef: "ref-1",
      label: "shorts-source (embed)",
    });
    expect(none!.realizationBadge).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Replacement policy
// ---------------------------------------------------------------------------

describe("replacement policy", () => {
  /** 8 vertical shorts, cursor 2, prefetch window 2 (indices 3–4). */
  function scenario() {
    const specs = Array.from({ length: 8 }, (_, i) => ({ item: i + 1, orientation: "vertical" as const }));
    const stack = createShortFeedStack(cards(specs), { cursor: 2, prefetchAhead: 2 });
    return stack;
  }

  it("watched/skipped beyond the cursor are replaceable; unwatched prefetch window is kept", () => {
    const stack = scenario();
    const state = sessionState({
      skippedItemIds: [IT(6)], // stack index 5
      watchedItemIds: [IT(7)], // stack index 6
    });
    const incoming = cards([{ item: 20 }, { item: 21 }, { item: 22 }]);
    const plan = planReplacement(stack, incoming, state);

    // Golden merge: replaceable slots (5 watched/skipped, 7 beyond-window) in
    // index-ascending order; incoming consumed in page order.
    expect(plan.replacements.map((r) => [r.index, r.outItemId, r.card.item.id])).toEqual([
      [5, IT(6), IT(20)],
      [6, IT(7), IT(21)],
      [7, IT(8), IT(22)], // unwatched beyond the prefetch window — refreshable
    ]);
    // Every replacement carries a non-empty typed reason.
    for (const replacement of plan.replacements) {
      expect(replacement.reason.length).toBeGreaterThan(0);
    }
    expect(plan.replacements[0]!.reason).toContain("skipped this session");
    expect(plan.replacements[1]!.reason).toContain("watched (completed) this session");
    expect(plan.replacements[2]!.reason).toContain("beyond the prefetch window");

    // Kept: behind-cursor history (0–1), the current card (2), the prefetch window (3–4).
    expect(plan.kept.map((k) => [k.index, k.itemId])).toEqual([
      [0, IT(1)],
      [1, IT(2)],
      [2, IT(3)],
      [3, IT(4)],
      [4, IT(5)],
    ]);
    expect(plan.kept[0]!.reason).toContain("behind the cursor");
    expect(plan.kept[2]!.reason).toContain("current card");
    expect(plan.kept[3]!.reason).toContain("prefetch window");
    expect(plan.unusedIncoming).toEqual([]);
  });

  it("incoming items already in the stack are NEVER replacements (one card per item)", () => {
    const stack = scenario();
    const state = sessionState({ skippedItemIds: [IT(6)] }); // one replaceable slot (index 5)
    const incoming = cards([{ item: 4 }, { item: 20 }]); // IT(4) is already stack index 3
    const plan = planReplacement(stack, incoming, state);
    // IT(4) is unused (already present); IT(20) takes the replaceable slot.
    expect(plan.replacements.map((r) => [r.index, r.outItemId, r.card.item.id])).toEqual([
      [5, IT(6), IT(20)],
    ]);
    expect(plan.unusedIncoming).toEqual([
      { itemId: IT(4), reason: expect.stringContaining("already present in the stack") },
    ]);
  });

  it("leftover incoming cards after the replaceable slots run out are typed-unused", () => {
    // 4 items, cursor 0, prefetch window 2 (indices 1–2): ONE replaceable slot
    // — the skipped card at index 3.
    const specs = Array.from({ length: 4 }, (_, i) => ({ item: i + 1, orientation: "vertical" as const }));
    const stack = createShortFeedStack(cards(specs), { cursor: 0, prefetchAhead: 2 });
    const state = sessionState({ skippedItemIds: [IT(4)] });
    const incoming = cards([{ item: 20 }, { item: 21 }, { item: 22 }]);
    const plan = planReplacement(stack, incoming, state);
    expect(plan.replacements.map((r) => [r.index, r.outItemId, r.card.item.id])).toEqual([
      [3, IT(4), IT(20)],
    ]);
    expect(plan.unusedIncoming).toEqual([
      { itemId: IT(21), reason: expect.stringContaining("no replaceable slot remaining") },
      { itemId: IT(22), reason: expect.stringContaining("no replaceable slot remaining") },
    ]);
  });

  it("an unfilled replaceable slot keeps its card (honest — never removed, never fabricated)", () => {
    const stack = scenario();
    const state = sessionState({ skippedItemIds: [IT(6), IT(7)] }); // two replaceable slots
    const plan = planReplacement(stack, cards([{ item: 20 }]), state); // one incoming card
    expect(plan.replacements).toHaveLength(1);
    const keptIndex6 = plan.kept.find((k) => k.index === 6)!;
    expect(keptIndex6.itemId).toBe(IT(7));
    expect(keptIndex6.reason).toContain("the fresh page supplied no new candidate");
  });

  it("the plan applies through the stack: cursor and kept positions untouched", () => {
    const stack = scenario();
    const state = sessionState({ watchedItemIds: [IT(7)] });
    const plan = planReplacement(stack, cards([{ item: 20 }]), state);
    // Replaceable slots in index-ascending order: 5 (unwatched beyond the
    // window), 6 (watched), 7 (unwatched beyond the window). The single
    // incoming card takes the FIRST slot (deterministic merge order).
    expect(plan.replacements.map((r) => [r.index, r.outItemId])).toEqual([[5, IT(6)]]);
    let applied = stack;
    for (const replacement of plan.replacements) {
      applied = replaceAt(applied, replacement.index, replacement.card).stack;
    }
    expect(applied.cursor).toBe(2);
    expect(applied.items.map((card) => card.item.id)).toEqual([
      IT(1), IT(2), IT(3), IT(4), IT(5), IT(20), IT(7), IT(8),
    ]);
  });

  it("malformed input throws the typed ExperienceError", () => {
    const stack = scenario();
    expect(() => planReplacement(stack, null as never, sessionState())).toThrow(ExperienceError);
    expect(() =>
      planReplacement(stack, [shortCard(20), shortCard(20)], sessionState()),
    ).toThrow(ExperienceError); // duplicate incoming
    expect(() =>
      planReplacement(stack, [shortCard(20)], sessionState({ userId: "" })),
    ).toThrow(ExperienceError);
  });
});

// ---------------------------------------------------------------------------
// Session-aware re-ranking triggers
// ---------------------------------------------------------------------------

describe("rerank triggers", () => {
  it("no trigger below every threshold — typed negative decision with a reason", () => {
    const decision = shouldRerank(sessionState(), []);
    expect(decision.rerank).toBe(false);
    expect(decision.triggers).toEqual([]);
    expect(decision.reasons).toHaveLength(1);
    expect(decision.reasons[0]).toContain("no re-rank trigger");
    expect(decision.scope).toBeUndefined();
    expect(decision.attentionMode).toBe("balanced");
  });

  it("N-SWIPE trigger: swipesSinceRerank reaches the policy threshold", () => {
    const decision = shouldRerank(
      sessionState({ swipesSinceRerank: BALANCED_RERANK_SWIPE_THRESHOLD }),
      [],
    );
    expect(decision.rerank).toBe(true);
    expect(decision.triggers).toEqual(["swipe-count"]);
    expect(decision.reasons[0]).toContain("swipe threshold reached");
  });

  it("M-SECOND trigger: elapsed time reaches the policy threshold", () => {
    const decision = shouldRerank(
      sessionState({ msSinceRerank: BALANCED_RERANK_ELAPSED_MS }),
      [],
    );
    expect(decision.rerank).toBe(true);
    expect(decision.triggers).toEqual(["elapsed-ms"]);
    expect(decision.reasons[0]).toContain("time threshold reached");
  });

  it("ENGAGEMENT-SIGNAL trigger: one like event fires even at zero swipes and zero elapsed", () => {
    const decision = shouldRerank(sessionState(), [event("like", IT(1))]);
    expect(decision.rerank).toBe(true);
    expect(decision.triggers).toEqual(["engagement-signal"]);
    expect(decision.reasons[0]).toContain("engagement signal");
  });

  it("a save event is an engagement signal; a complete event is evidence but NOT a trigger", () => {
    expect(shouldRerank(sessionState(), [event("save", IT(1))]).triggers).toEqual([
      "engagement-signal",
    ]);
    const completeOnly = shouldRerank(sessionState(), [event("complete", IT(1))]);
    expect(completeOnly.rerank).toBe(false); // evidence, not a trigger
    expect(completeOnly.intentUpdates).toHaveLength(1); // still carried (additive)
  });

  it("all three triggers at once fire in the fixed order", () => {
    const decision = shouldRerank(
      sessionState({ swipesSinceRerank: 99, msSinceRerank: 999_999 }),
      [event("like", IT(1)), event("save", IT(2))],
    );
    expect(decision.triggers).toEqual(["swipe-count", "elapsed-ms", "engagement-signal"]);
  });

  it("thresholds come from the frozen policy vocabulary (attention modes differ; mindful is freshest)", () => {
    // The attention-policy law: mindful is the most attention-protective mode —
    // it re-ranks MOST often; immersive is the most stable. No mode's
    // thresholds optimize for session length.
    expect(MINDFUL_RERANK_SWIPE_THRESHOLD).toBeLessThan(BALANCED_RERANK_SWIPE_THRESHOLD);
    expect(BALANCED_RERANK_SWIPE_THRESHOLD).toBeLessThan(IMMERSIVE_RERANK_SWIPE_THRESHOLD);
    expect(MINDFUL_RERANK_ELAPSED_MS).toBeLessThan(BALANCED_RERANK_ELAPSED_MS);
    expect(BALANCED_RERANK_ELAPSED_MS).toBeLessThan(IMMERSIVE_RERANK_ELAPSED_MS);

    const mindful = shouldRerank(
      sessionState({
        policy: policy("mindful"),
        swipesSinceRerank: MINDFUL_RERANK_SWIPE_THRESHOLD,
      }),
      [],
    );
    expect(mindful.rerank).toBe(true);
    expect(mindful.attentionMode).toBe("mindful"); // carried verbatim — never altered

    // The same swipe count under immersive policy does NOT fire (stability).
    const immersive = shouldRerank(
      sessionState({
        policy: policy("immersive"),
        swipesSinceRerank: MINDFUL_RERANK_SWIPE_THRESHOLD,
        msSinceRerank: MINDFUL_RERANK_ELAPSED_MS,
      }),
      [],
    );
    expect(immersive.rerank).toBe(false);

    // Custom delegates to explicit objectives: the neutral balanced thresholds.
    expect(RERANK_THRESHOLDS.custom).toEqual(RERANK_THRESHOLDS.balanced);
  });

  it("decision payload = ADDITIVE intent inputs only (the exact WFX-011 inference output)", () => {
    const events = [
      event("like", IT(1)),
      event("complete", IT(2)),
      event("progress", IT(3)), // not intent evidence — no update
      event("skip", IT(4)), // not intent evidence — no update
    ];
    const decision = shouldRerank(
      sessionState({ swipesSinceRerank: BALANCED_RERANK_SWIPE_THRESHOLD }),
      events,
    );
    // Byte-identical to the real WFX-011 inference on the same events.
    expect(decision.intentUpdates).toEqual(inferFromEvents(USER, events, NOW_MS));
    expect(decision.intentUpdates).toHaveLength(2); // like + complete only

    // ADDITIVE ONLY: every update is a positive, inferred, create-or-reinforce
    // bump — no update ever deletes, down-ranks, or narrows (anti-tunnel-vision).
    for (const update of decision.intentUpdates) {
      expect(update.provenance).toBe("inferred");
      expect(update.weight).toBeGreaterThan(0);
      expect(update.confidence).toBeGreaterThan(0);
      expect(update.scope).toBe("temporary"); // like/complete infer temporary scope
      expect([`item:${IT(1)}`, `item:${IT(2)}`]).toContain(update.objective);
    }
    const like = decision.intentUpdates.find((u) => u.signal === "like")!;
    expect(like.weight).toBe(0.15);
    expect(like.confidence).toBe(0.15);
    const complete = decision.intentUpdates.find((u) => u.signal === "complete")!;
    expect(complete.weight).toBe(0.05); // a watch is ONE weak signal — never an identity
  });

  it("NO below-visibility demotion: the scope is an ahead-of-cursor permutation", () => {
    const ahead = [IT(5), IT(6), IT(7)];
    const decision = shouldRerank(
      sessionState({
        swipesSinceRerank: BALANCED_RERANK_SWIPE_THRESHOLD,
        aheadOfCursorItemIds: ahead,
      }),
      [],
    );
    expect(decision.rerank).toBe(true);
    expect(decision.scope).toBeDefined();
    expect(decision.scope!.window).toBe("ahead-of-cursor");
    expect(decision.scope!.demotionFloor).toBe("visible");
    // The eligible set is EXACTLY the ahead-of-cursor window — a permutation
    // input: same length, same ids, nothing removed, nothing added.
    expect(decision.scope!.eligibleItemIds).toEqual(ahead);
    expect(new Set(decision.scope!.eligibleItemIds).size).toBe(ahead.length);
  });

  it("malformed input throws the typed ExperienceError", () => {
    expect(() => shouldRerank(sessionState({ policy: null as never }), [])).toThrow(
      ExperienceError,
    );
    expect(() =>
      shouldRerank(sessionState({ swipesSinceRerank: -1 }), []),
    ).toThrow(ExperienceError);
    expect(() => shouldRerank(sessionState(), null as never)).toThrow(ExperienceError);
    expect(() => shouldRerank(sessionState(), [{ ...event("like", IT(1)), itemId: "nope" }])).toThrow(
      ExperienceError,
    );
    expect(() =>
      shouldRerank(sessionState(), [{ ...event("like", IT(1)), userId: "someone-else" }]),
    ).toThrow(ExperienceError); // foreign events are a caller bug — never silently skipped
  });
});

// ---------------------------------------------------------------------------
// Engagement event emission
// ---------------------------------------------------------------------------

describe("event emission", () => {
  const stack = createShortFeedStack(cards([{ item: 1 }, { item: 2 }]));
  const stamp = { userId: USER, sessionId: SESSION, occurredAt: STAMP_AT };

  it("progress → the frozen progress event with payload percent", () => {
    const [emitted] = shortFeedEvents(stack, {
      stamp,
      action: { kind: "progress", itemId: IT(1), percent: 42 },
    });
    expect(emitted).toEqual({
      userId: USER,
      itemId: IT(1),
      type: "progress",
      occurredAt: STAMP_AT,
      sessionId: SESSION,
      payload: { percent: 42 },
    });
  });

  it("complete / skip / like / save / share → the exact frozen events (no payload)", () => {
    const cases: [EntertainmentEvent["type"], string][] = [
      ["complete", IT(1)],
      ["skip", IT(1)],
      ["like", IT(1)],
      ["save", IT(2)],
      ["share", IT(2)],
    ];
    for (const [type, itemId] of cases) {
      const [emitted] = shortFeedEvents(stack, {
        stamp,
        action: { kind: type as "complete", itemId },
      });
      expect(emitted).toEqual({
        userId: USER,
        itemId,
        type,
        occurredAt: STAMP_AT,
        sessionId: SESSION,
      });
      expect("payload" in emitted! && emitted!.payload !== undefined).toBe(false);
      expect("sourceRealizationId" in emitted!).toBe(false);
    }
  });

  it("every emitted event passes the WFX-002 validator (ready for the WFX-005 EventSink)", () => {
    const kinds: ("progress" | "complete" | "skip" | "like" | "save" | "share")[] = [
      "progress",
      "complete",
      "skip",
      "like",
      "save",
      "share",
    ];
    for (const kind of kinds) {
      const [emitted] = shortFeedEvents(stack, {
        stamp,
        action:
          kind === "progress"
            ? { kind, itemId: IT(1), percent: 99 }
            : { kind, itemId: IT(1) },
      });
      const checked = validateEntertainmentEvent(emitted!);
      expect(checked.ok).toBe(true);
      expect(emitted!.sessionId).toBe(SESSION); // sessionId wired
    }
  });

  it("the optional canonical sourceRealizationId rides along when supplied", () => {
    const [emitted] = shortFeedEvents(stack, {
      stamp,
      action: { kind: "like", itemId: IT(1), sourceRealizationId: SRC(7) },
    });
    expect(emitted!.sourceRealizationId).toBe(SRC(7));
  });

  it("returns exactly one event per interaction (the sink-ready batch)", () => {
    const emitted = shortFeedEvents(stack, {
      stamp,
      action: { kind: "skip", itemId: IT(1) },
    });
    expect(emitted).toHaveLength(1);
  });

  it("malformed input throws the typed ExperienceError (no fabricated events)", () => {
    expect(() =>
      shortFeedEvents(stack, {
        stamp,
        action: { kind: "progress", itemId: IT(1), percent: 101 },
      }),
    ).toThrow(ExperienceError);
    expect(() =>
      shortFeedEvents(stack, {
        stamp,
        action: { kind: "progress", itemId: IT(1), percent: -1 },
      }),
    ).toThrow(ExperienceError);
    expect(() =>
      shortFeedEvents(stack, {
        stamp,
        action: { kind: "like", itemId: "not-an-item-id" },
      }),
    ).toThrow(ExperienceError);
    expect(() =>
      shortFeedEvents(stack, {
        stamp: { ...stamp, occurredAt: "not-a-date" },
        action: { kind: "like", itemId: IT(1) },
      }),
    ).toThrow(ExperienceError);
    // Engaging with a card that is NOT in the stack is caller misuse.
    expect(() =>
      shortFeedEvents(stack, { stamp, action: { kind: "like", itemId: IT(99) } }),
    ).toThrow(ExperienceError);
  });
});

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

describe("presenter", () => {
  const presenter = createShortFeedPresenter({ displayNames: { "shorts-source": "Shorts" } });
  const context = { userId: USER, sessionId: SESSION };

  it("typed placeholder states: loading / error / empty", () => {
    const loading = presenter.initial({ kind: "loading" }, context);
    expect(loading.state).toBe("loading");
    expect(loading.stack).toBeNull();
    expect(loading.transition.reasons.length).toBeGreaterThan(0);

    const failed = presenter.initial({ kind: "failed", detail: "os down" }, context);
    expect(failed.state).toBe("error");
    expect(failed.errorDetail).toBe("os down");

    const empty = presenter.initial(osPage([{ item: 1, unclassifiable: true }]), context);
    expect(empty.state).toBe("empty");
    expect(empty.unresolvedItemIds).toEqual([IT(1)]);
    expect(empty.transition.reasons[0]).toContain("no usable cards");
  });

  it("builds the initial stack from an OS page: current + next + transition reasons", () => {
    const view = presenter.initial(
      osPage([
        { item: 1, orientation: "horizontal" },
        { item: 2, orientation: "vertical" },
        { item: 3, orientation: "vertical" },
      ]),
      context,
    );
    expect(view.state).toBe("ready");
    expect(view.stack!.cursor).toBe(0);
    expect(view.stack!.prefetchAhead).toBe(DEFAULT_PREFETCH_AHEAD);
    // Vertical-first: IT(2) leads, IT(3) next, IT(1) (horizontal) typed-tailed.
    expect(view.current!.item.id).toBe(IT(2));
    expect(view.next!.item.id).toBe(IT(3));
    expect(view.transition.kind).toBe("initial");
    expect(view.transition.reasons[0]).toContain("vertical-first");
    // The realization badge uses the injected display name.
    expect(view.current!.realizationBadge!.label).toBe("Shorts (native)");
  });

  it("swipe transitions carry reasons; bounds are typed no-ops (never wraps)", () => {
    const view = presenter.initial(
      osPage([
        { item: 1, orientation: "vertical" },
        { item: 2, orientation: "vertical" },
      ]),
      context,
    );
    const next = presenter.swipeNext(view);
    expect(next.transition.kind).toBe("swipe-next");
    expect(next.current!.item.id).toBe(IT(2));
    expect(next.transition.reasons[0]).toContain("swiped forward");

    const back = presenter.swipeBack(next);
    expect(back.transition.kind).toBe("swipe-back");
    expect(back.current!.item.id).toBe(IT(1));

    const bounded = presenter.swipeBack(back); // at the first card
    expect(bounded.transition.kind).toBe("swipe-back-noop");
    expect(bounded.transition.reasons[0]).toContain("never wraps");
    expect(bounded.current!.item.id).toBe(IT(1));

    const atLast = presenter.swipeNext(presenter.swipeNext(bounded));
    expect(atLast.transition.kind).toBe("swipe-next-noop");
    expect(atLast.transition.reasons[0]).toContain("never wraps forward");
  });

  it("transitions on non-ready views are typed no-ops with reasons (no crash on UI races)", () => {
    for (const state of ["loading", "error", "empty"] as const) {
      const view =
        state === "loading"
          ? presenter.initial({ kind: "loading" }, context)
          : state === "error"
            ? presenter.initial({ kind: "failed", detail: "x" }, context)
            : presenter.initial(osPage([{ item: 1, unclassifiable: true }]), context);
      const swiped = presenter.swipeNext(view);
      expect(swiped.state).toBe(state); // unchanged
      expect(swiped.transition.kind).toBe("not-ready-noop");
      expect(swiped.transition.reasons[0]).toContain("swipe ignored");
    }
  });

  it("replaceCards applies a replacement plan; insertCards replenishes", () => {
    const specs = Array.from({ length: 4 }, (_, i) => ({ item: i + 1, orientation: "vertical" as const }));
    const view = presenter.initial(osPage(specs), context);
    const plan = planReplacement(
      view.stack!,
      cards([{ item: 20 }]),
      sessionState({ skippedItemIds: [IT(4)] }), // stack index 3, beyond the prefetch window edge
    );
    const replaced = presenter.replaceCards(view, plan);
    expect(replaced.current!.item.id).toBe(IT(1)); // cursor untouched
    expect(replaced.stack!.items.map((card) => card.item.id)).toEqual([
      IT(1), IT(2), IT(3), IT(20),
    ]);
    expect(replaced.transition.kind).toBe("replace");
    expect(replaced.transition.reasons[0]).toContain("applied 1 replacement");

    const replenished = presenter.insertCards(replaced, cards([{ item: 30 }, { item: 1 }]));
    expect(replenished.stack!.items.map((card) => card.item.id)).toEqual([
      IT(1), IT(2), IT(3), IT(20), IT(30),
    ]);
    expect(replenished.transition.kind).toBe("insert-ahead");
    expect(
      replenished.transition.reasons.some((reason) => reason.includes(`skipped '${IT(1)}'`)),
    ).toBe(true);
  });

  it("malformed input throws the typed ExperienceError", () => {
    expect(() => presenter.initial({ kind: "loading" }, { userId: "", sessionId: SESSION })).toThrow(
      ExperienceError,
    );
    expect(() =>
      presenter.initial({ kind: "failed", detail: "" }, context),
    ).toThrow(ExperienceError);
    expect(() => presenter.swipeNext({} as never)).toThrow(ExperienceError);
    expect(() =>
      createShortFeedPresenter({ displayNames: { src: 42 as never } }),
    ).toThrow(ExperienceError);
  });
});

// ---------------------------------------------------------------------------
// The React wiring (element tree)
// ---------------------------------------------------------------------------

describe("element tree (the documented React wiring)", () => {
  const presenter = createShortFeedPresenter();
  const context = { userId: USER, sessionId: SESSION };

  it("placeholder states render typed placeholders", () => {
    expect(shortFeedElementTree(presenter.initial({ kind: "loading" }, context))).toEqual([
      { type: "placeholder", key: "short-feed-loading", state: "loading" },
    ]);
    expect(
      shortFeedElementTree(presenter.initial({ kind: "failed", detail: "os down" }, context)),
    ).toEqual([{ type: "placeholder", key: "short-feed-error", state: "error", detail: "os down" }]);
    expect(
      shortFeedElementTree(presenter.initial(osPage([{ item: 1, unclassifiable: true }]), context)),
    ).toEqual([{ type: "placeholder", key: "short-feed-empty", state: "empty" }]);
  });

  it("a ready view renders the current card (+ actions) and the next-card preview, a11y verbatim", () => {
    const view = presenter.initial(
      osPage([
        { item: 1, orientation: "vertical", title: "Dance", topic: "dance", capabilities: ["playNative", "like"] },
        { item: 2, orientation: "vertical", title: "Skate", capabilities: ["playNative", "save"] },
      ]),
      context,
    );
    const tree = shortFeedElementTree(view);
    const current = tree[0]!;
    expect(current.type).toBe("card");
    if (current.type === "card") {
      expect(current.role).toBe("current");
      expect(current.key).toBe(`card:current:${IT(1)}`);
      expect(current.overlayTitle).toBe("Dance");
      expect(current.overlayTopic).toBe("dance");
      expect(current.badgeText).toBe("shorts-source (native)");
      expect(current.a11y).toEqual(view.current!.a11y); // a11y verbatim
      const actions = current.children.filter((child) => child.type === "action");
      expect(actions.map((action) => (action as { action: string }).action)).toEqual([
        "like", // present (capability declared)
        "share", // always present (event-only)
      ]); // save omitted — the realization does not declare it (typed-absent, no dead button)
    }
    const next = tree[1]!;
    expect(next.type).toBe("card");
    if (next.type === "card") {
      expect(next.role).toBe("next");
      expect(next.key).toBe(`card:next:${IT(2)}`);
      expect(next.children.every((child) => child.type !== "action")).toBe(true); // preview is not interactive
    }
  });
});

// ---------------------------------------------------------------------------
// A11y on EVERY card
// ---------------------------------------------------------------------------

describe("a11y labels on every card", () => {
  it("every built card carries a complete, non-empty typed a11y label", () => {
    const projection = buildShortCards(
      osPage([
        { item: 1, orientation: "vertical", title: "Dance" },
        { item: 2, orientation: "horizontal", title: "Wide" },
        { item: 3, orientation: "square" },
        { item: 4 }, // unknown orientation, no title
        { item: 5, orientation: "vertical", capabilities: ["like"] },
        { item: 6, orientation: "vertical", capabilities: ["save"] },
      ]),
    );
    expect(projection.cards).toHaveLength(6);
    for (const card of projection.cards) {
      expect(card.a11y.title.length).toBeGreaterThan(0);
      expect(card.a11y.position.length).toBeGreaterThan(0);
      expect(card.a11y.action.length).toBeGreaterThan(0);
      expect(card.a11y.affordances.length).toBeGreaterThan(0);
      expect(card.a11y.title).toContain(card.overlay.title); // the accessible name names the card
    }
    // The affordances announcement reflects the honest capability truth.
    const byId = new Map(projection.cards.map((card) => [card.item.id, card]));
    expect(byId.get(IT(5))!.a11y.affordances).toContain("like available");
    expect(byId.get(IT(5))!.a11y.affordances).toContain("save unavailable");
    expect(byId.get(IT(6))!.a11y.affordances).toContain("save available");
    expect(byId.get(IT(6))!.a11y.affordances).toContain("like unavailable");
    expect(byId.get(IT(6))!.a11y.affordances).toContain("share available");
  });

  it("stack trail events stay typed data across every operation kind", () => {
    const stack = createShortFeedStack(cards([{ item: 1 }, { item: 2 }, { item: 3 }]));
    const events: StackEvent[] = [];
    let current = stack;
    const next1 = swipeNext(current);
    events.push(next1.event);
    current = next1.stack;
    const back = swipeBack(current);
    events.push(back.event);
    current = back.stack;
    const replaced = replaceAt(current, 2, shortCard(9));
    events.push(replaced.event);
    current = replaced.stack;
    const inserted = insertAhead(current, [shortCard(10)]);
    events.push(inserted.event);
    current = inserted.stack;
    events.push(swipeBack(current).event); // at the first card — bounded noop
    expect(events.map((e) => e.kind)).toEqual([
      "swipe-next",
      "swipe-back",
      "replace-at",
      "insert-ahead",
      "swipe-back-noop",
    ]);
    expect(current.items.map((card) => card.item.id)).toEqual([
      IT(1), IT(2), IT(9), IT(10),
    ]);
    expect(current.cursor).toBe(0);
  });
});
