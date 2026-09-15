/**
 * @wfx/experience — the Short Feed vertical card stack (WFX-028, Lane C).
 *
 * The stack model of the frozen Short Feed mode: `{ items, cursor,
 * prefetchAhead }` with TYPED, IMMUTABLE operations — every operation
 * returns the NEW stack plus a typed `StackEvent` for the trail (the
 * original is never mutated; the caller accumulates the events).
 *
 * Swipe semantics (the packet's law):
 * - `swipeNext()` advances the cursor by one; at the LAST card (or on an
 *   empty stack) it is a TYPED NO-OP with a reason — the feed never wraps
 *   forward either (replenishment is `insertAhead`'s job, the OS's to call).
 * - `swipeBack()` retreats the cursor by one and is BOUNDED: at the FIRST
 *   card (or on an empty stack) it is a TYPED NO-OP with reason
 *   "at-first-card" — backward swipe NEVER wraps around to the tail.
 * - `replaceAt(index, replacement)` is the rapid-candidate-replacement
 *   mechanism (the policy in replacement.ts decides WHICH slots; the stack
 *   applies it). The current card and the cursor are never moved by it.
 * - `insertAhead(cards)` replenishes the ahead-of-cursor region: cards are
 *   APPENDED at the end of the stack (the promised prefetch window near the
 *   cursor is never disturbed); cards whose item id already exists anywhere
 *   in the stack are SKIPPED with a typed reason in the event (the OS may
 *   legitimately re-supply an item — an honest skip, never a duplicate, and
 *   never a crash).
 *
 * Determinism / purity laws: no randomness, no hidden clock, no globals;
 * every operation is a pure function of its arguments. Duplicate item ids
 * inside one stack are a caller bug (`createShortFeedStack` and
 * `replaceAt` reject them with the typed `ExperienceError` — the misuse
 * channel; `insertAhead` skips OS re-supplies as documented above).
 */

import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";
import type { ShortCard } from "./card";

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

/** Default prefetch window: how many cards ahead of the cursor stay stable. */
export const DEFAULT_PREFETCH_AHEAD = 2;

/**
 * The Short Feed stack: the ordered cards, the 0-based cursor (the card on
 * screen), and the prefetch window size (cards ahead of the cursor the
 * replacement policy keeps stable; see replacement.ts).
 */
export interface ShortFeedStack {
  items: readonly ShortCard[];
  cursor: number;
  prefetchAhead: number;
}

// ---------------------------------------------------------------------------
// The trail events (typed)
// ---------------------------------------------------------------------------

/**
 * One typed trail event, produced by exactly one stack operation. The trail
 * is STRUCTURAL (no timestamps — no hidden clock); the app layer stamps the
 * engagement events it derives from these (see short/events.ts).
 */
export type StackEvent =
  | {
      kind: "swipe-next";
      fromCursor: number;
      toCursor: number;
      /** The card being left (the skip/complete emission target). */
      leftItemId: string;
      /** The card entering the screen; null at the last card. */
      enteredItemId: string | null;
    }
  | {
      kind: "swipe-next-noop";
      /** Why the swipe did not move: "at-last-card" | "empty-stack". */
      reason: "at-last-card" | "empty-stack";
      cursor: number;
    }
  | {
      kind: "swipe-back";
      fromCursor: number;
      toCursor: number;
      /** The card being left; null only on a malformed call (defensively typed). */
      leftItemId: string | null;
      /** The card re-entering the screen. */
      reEnteredItemId: string;
    }
  | {
      kind: "swipe-back-noop";
      /** Why the swipe did not move: "at-first-card" (bounded — never wraps) | "empty-stack". */
      reason: "at-first-card" | "empty-stack";
      cursor: number;
    }
  | {
      kind: "replace-at";
      /** The stack index whose card was replaced. */
      index: number;
      /** The canonical item id leaving the slot. */
      outItemId: string;
      /** The canonical item id taking the slot. */
      inItemId: string;
    }
  | {
      kind: "insert-ahead";
      fromCount: number;
      toCount: number;
      /** Item ids appended, in insertion order. */
      insertedItemIds: readonly string[];
      /** Item ids skipped (already in the stack) with the typed reason. */
      skipped: readonly { itemId: string; reason: string }[];
    };

/**
 * Every stack operation returns the NEW stack + its typed trail event. The
 * generic parameter is the SUBSET of `StackEvent` the operation can produce
 * (see `SwipeNextEvent` & co.) — consumers get precise narrowing, and every
 * `StackOperationResult<E>` is still a valid `StackOperationResult`.
 */
export interface StackOperationResult<E extends StackEvent = StackEvent> {
  stack: ShortFeedStack;
  event: E;
}

/** The trail events `swipeNext` can produce. */
export type SwipeNextEvent = Extract<StackEvent, { kind: "swipe-next" | "swipe-next-noop" }>;
/** The trail events `swipeBack` can produce. */
export type SwipeBackEvent = Extract<StackEvent, { kind: "swipe-back" | "swipe-back-noop" }>;
/** The trail event `replaceAt` produces. */
export type ReplaceAtEvent = Extract<StackEvent, { kind: "replace-at" }>;
/** The trail event `insertAhead` produces. */
export type InsertAheadEvent = Extract<StackEvent, { kind: "insert-ahead" }>;

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Type guard that preserves the declared type (unlike a raw index-signature guard). */
function isOptionsObject<T extends object>(value: T | null | undefined): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Assert a value is a usable stack (array items, cursor in bounds,
 * non-negative prefetch window, no duplicate item ids). Throws the typed
 * `ExperienceError` with aggregated field-level problems.
 */
export function assertUsableShortFeedStack(stack: ShortFeedStack): void {
  if (!isRecord(stack)) {
    throw new ExperienceError("stack: expected a ShortFeedStack object");
  }
  const problems: string[] = [];
  if (!Array.isArray(stack.items)) {
    problems.push(`stack.items: expected an array of ShortCard, got ${previewValue(stack.items)}`);
  } else {
    stack.items.forEach((card, index) => {
      if (!isRecord(card) || !isRecord(card.item) || typeof card.item.id !== "string" || card.item.id.length === 0) {
        problems.push(
          `stack.items[${index}]: expected a ShortCard with a canonical item id, got ${previewValue(card)}`,
        );
      }
    });
    if (problems.length === 0) {
      const seen = new Set<string>();
      for (const card of stack.items) {
        if (seen.has(card.item.id)) {
          problems.push(
            `stack.items: duplicate canonical item id '${card.item.id}' — one card per item in a stack`,
          );
          break;
        }
        seen.add(card.item.id);
      }
    }
  }
  if (
    typeof stack.cursor !== "number" ||
    !Number.isFinite(stack.cursor) ||
    !Number.isInteger(stack.cursor) ||
    stack.cursor < 0
  ) {
    problems.push(
      `stack.cursor: expected a non-negative integer, got ${previewValue(stack.cursor)}`,
    );
  } else if (Array.isArray(stack.items) && stack.cursor >= stack.items.length && stack.items.length > 0) {
    problems.push(
      `stack.cursor: ${stack.cursor} is out of bounds for ${stack.items.length} items`,
    );
  }
  if (!isNonNegativeFinite(stack.prefetchAhead) || !Number.isInteger(stack.prefetchAhead)) {
    problems.push(
      `stack.prefetchAhead: expected a non-negative integer, got ${previewValue(stack.prefetchAhead)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// Builder + accessors
// ---------------------------------------------------------------------------

/** Options of `createShortFeedStack`. */
export interface CreateShortFeedStackOptions {
  /** Initial cursor (default 0). Must be within bounds. */
  cursor?: number;
  /** Prefetch window size (default `DEFAULT_PREFETCH_AHEAD`). */
  prefetchAhead?: number;
}

/**
 * Build a validated, frozen stack from ordered cards. Empty input yields an
 * empty stack with cursor 0. Throws the typed `ExperienceError` on malformed
 * input (duplicate item ids, out-of-bounds cursor, negative prefetch).
 */
export function createShortFeedStack(
  items: readonly ShortCard[],
  options: CreateShortFeedStackOptions = {},
): ShortFeedStack {
  if (!Array.isArray(items)) {
    throw new ExperienceError(`items: expected an array of ShortCard, got ${previewValue(items)}`);
  }
  if (!isOptionsObject(options)) {
    throw new ExperienceError(
      `options: expected a CreateShortFeedStackOptions object, got ${previewValue(options)}`,
    );
  }
  const cursor = options.cursor ?? 0;
  const prefetchAhead = options.prefetchAhead ?? DEFAULT_PREFETCH_AHEAD;
  const stack: ShortFeedStack = {
    items: Object.freeze([...items]),
    cursor,
    prefetchAhead,
  };
  assertUsableShortFeedStack(stack);
  return Object.freeze(stack);
}

/** The card at the cursor; null on an empty stack. */
export function currentCard(stack: ShortFeedStack): ShortCard | null {
  return stack.items[stack.cursor] ?? null;
}

/** The card after the cursor (the prefetch preview); null when none exists. */
export function nextCard(stack: ShortFeedStack): ShortCard | null {
  return stack.items[stack.cursor + 1] ?? null;
}

/** A frozen defensive copy of the stack (shallow — cards are immutable data). */
function copyWith(
  stack: ShortFeedStack,
  items: readonly ShortCard[],
  cursor: number,
): ShortFeedStack {
  return Object.freeze({
    items: Object.freeze([...items]),
    cursor,
    prefetchAhead: stack.prefetchAhead,
  });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Swipe to the NEXT card: cursor + 1. At the last card (or on an empty
 * stack) a TYPED NO-OP with reason — the feed never wraps forward;
 * replenishment is `insertAhead` (the OS's call), not a wrap.
 */
export function swipeNext(stack: ShortFeedStack): StackOperationResult<SwipeNextEvent> {
  assertUsableShortFeedStack(stack);
  if (stack.items.length === 0) {
    return {
      stack,
      event: { kind: "swipe-next-noop", reason: "empty-stack", cursor: stack.cursor },
    };
  }
  if (stack.cursor >= stack.items.length - 1) {
    return {
      stack,
      event: { kind: "swipe-next-noop", reason: "at-last-card", cursor: stack.cursor },
    };
  }
  const toCursor = stack.cursor + 1;
  const next = copyWith(stack, stack.items, toCursor);
  return {
    stack: next,
    event: {
      kind: "swipe-next",
      fromCursor: stack.cursor,
      toCursor,
      leftItemId: stack.items[stack.cursor]!.item.id,
      enteredItemId: stack.items[toCursor]!.item.id,
    },
  };
}

/**
 * Swipe BACK to the previous card: cursor - 1. BOUNDED: at the first card
 * (or on an empty stack) a TYPED NO-OP with reason "at-first-card" — the
 * backward swipe NEVER wraps around to the tail.
 */
export function swipeBack(stack: ShortFeedStack): StackOperationResult<SwipeBackEvent> {
  assertUsableShortFeedStack(stack);
  if (stack.items.length === 0) {
    return {
      stack,
      event: { kind: "swipe-back-noop", reason: "empty-stack", cursor: stack.cursor },
    };
  }
  if (stack.cursor <= 0) {
    return {
      stack,
      event: { kind: "swipe-back-noop", reason: "at-first-card", cursor: stack.cursor },
    };
  }
  const toCursor = stack.cursor - 1;
  const back = copyWith(stack, stack.items, toCursor);
  return {
    stack: back,
    event: {
      kind: "swipe-back",
      fromCursor: stack.cursor,
      toCursor,
      leftItemId: stack.items[stack.cursor]!.item.id,
      reEnteredItemId: stack.items[toCursor]!.item.id,
    },
  };
}

/**
 * Replace the card at `index` with `replacement` (rapid candidate
 * replacement — the mechanism; replacement.ts's policy decides which
 * slots). The cursor and every other position are untouched; the operation
 * returns the NEW stack + a "replace-at" trail event.
 *
 * Throws the typed `ExperienceError` when `index` is out of bounds or the
 * replacement would duplicate a canonical item id already in the stack at a
 * DIFFERENT index (replacing a slot with the same item id is allowed — a
 * view-data refresh, not a duplicate).
 */
export function replaceAt(
  stack: ShortFeedStack,
  index: number,
  replacement: ShortCard,
): StackOperationResult<ReplaceAtEvent> {
  assertUsableShortFeedStack(stack);
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= stack.items.length
  ) {
    throw new ExperienceError(
      `index: expected an integer within [0, ${stack.items.length}) for this stack, got ${previewValue(index)}`,
    );
  }
  if (!isRecord(replacement) || !isRecord(replacement.item) || typeof replacement.item.id !== "string" || replacement.item.id.length === 0) {
    throw new ExperienceError(
      `replacement: expected a ShortCard with a canonical item id, got ${previewValue(replacement)}`,
    );
  }
  const inItemId = replacement.item.id;
  const clashIndex = stack.items.findIndex((card) => card.item.id === inItemId);
  if (clashIndex !== -1 && clashIndex !== index) {
    throw new ExperienceError(
      `replacement: item id '${inItemId}' already occupies stack index ${clashIndex} — one card per item in a stack`,
    );
  }

  const items = [...stack.items];
  const outItemId = items[index]!.item.id;
  items[index] = replacement;
  return {
    stack: copyWith(stack, items, stack.cursor),
    event: { kind: "replace-at", index, outItemId, inItemId },
  };
}

/**
 * Replenish the ahead-of-cursor region: cards are APPENDED at the end of
 * the stack (the near-cursor prefetch window is never disturbed; the
 * promised runway stays stable while it grows). Cards whose canonical item
 * id already exists anywhere in the stack are SKIPPED with a typed reason
 * in the event — the OS may re-supply an item; an honest skip, never a
 * duplicate, never a crash. The cursor never moves.
 */
export function insertAhead(
  stack: ShortFeedStack,
  cards: readonly ShortCard[],
): StackOperationResult<InsertAheadEvent> {
  assertUsableShortFeedStack(stack);
  if (!Array.isArray(cards)) {
    throw new ExperienceError(
      `cards: expected an array of ShortCard, got ${previewValue(cards)}`,
    );
  }
  for (const card of cards) {
    if (!isRecord(card) || !isRecord(card.item) || typeof card.item.id !== "string" || card.item.id.length === 0) {
      throw new ExperienceError(
        `cards: expected ShortCard entries with canonical item ids, got ${previewValue(card)}`,
      );
    }
  }

  const present = new Set(stack.items.map((card) => card.item.id));
  const inserted: string[] = [];
  const skipped: { itemId: string; reason: string }[] = [];
  const items = [...stack.items];
  for (const card of cards) {
    const id = card.item.id;
    if (present.has(id)) {
      skipped.push({
        itemId: id,
        reason: "already present in the stack — one card per canonical item",
      });
      continue;
    }
    present.add(id);
    items.push(card);
    inserted.push(id);
  }

  return {
    stack: copyWith(stack, items, stack.cursor),
    event: {
      kind: "insert-ahead",
      fromCount: stack.items.length,
      toCount: items.length,
      insertedItemIds: Object.freeze(inserted),
      skipped: Object.freeze(skipped.map((entry) => Object.freeze(entry))),
    },
  };
}
