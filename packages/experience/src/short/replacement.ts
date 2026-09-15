/**
 * @wfx/experience — Short Feed rapid candidate replacement policy (WFX-028, Lane C).
 *
 * `planReplacement(stack, osFeed, sessionState)` is the PURE policy that
 * decides WHICH cards the OS's fresh short-surface page replaces when it
 * arrives (the frozen architecture's "rapid candidate replacement"): it
 * produces a typed `ReplacementPlan` — a list of replacements + reasons —
 * and the STACK applies it (stack.ts `replaceAt`; the presenter's
 * `replaceCards`). This module never mutates anything.
 *
 * THE POLICY (typed laws):
 *
 * 1. Beyond the cursor only. Slots at or behind the cursor are NEVER
 *    replaced: the card on screen is not swapped mid-view, and the session's
 *    navigation history behind the cursor is never rewritten.
 * 2. Watched / skipped ⇒ REPLACEABLE. A card beyond the cursor whose
 *    canonical item was WATCHED (completed) or SKIPPED this session (the
 *    session state's evidence lists) is stale runway — the freshest OS
 *    candidate takes its slot (rapid replacement).
 * 3. Unwatched within the prefetch window ⇒ KEPT. A card beyond the cursor
 *    that has NOT been engaged with and sits within the prefetch window
 *    (`index <= cursor + prefetchAhead`) is the OS's promised runway — it
 *    stays (stability near the cursor; the window is a promise).
 * 4. Unwatched beyond the prefetch window ⇒ REPLACEABLE. Far runway is
 *    refreshable: the OS's fresh page is better-informed than the old
 *    composition that far ahead.
 * 5. Deterministic merge order. Replacements are listed in stack-index
 *    ascending order; incoming OS cards are consumed in the order supplied
 *    (the page's vertical-first order — buildShortCards output). One card
 *    per canonical item: an incoming card whose item id is already in the
 *    stack is NEVER a replacement (it lands in `unusedIncoming` with the
 *    typed reason); leftover incoming cards after the replaceable slots run
 *    out land there too.
 *
 * Determinism / purity: no randomness, no clock, no globals; the plan is a
 * pure function of (stack, osFeed, sessionState). Malformed input throws
 * the typed `ExperienceError` (the package's misuse channel).
 */

import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";
import type { ShortCard } from "./card";
import type { ShortSessionState } from "./session-ranking";
import type { ShortFeedStack } from "./stack";
import { assertUsableShortFeedStack } from "./stack";

// ---------------------------------------------------------------------------
// The plan (typed data — the stack applies it)
// ---------------------------------------------------------------------------

/** One planned replacement: the stack slot, the card leaving, the card arriving, and why. */
export interface CardReplacement {
  /** The stack index whose card is replaced out (index > cursor by law 1). */
  index: number;
  /** The canonical item id leaving the slot. */
  outItemId: string;
  /** The incoming card taking the slot (from the fresh OS page). */
  card: ShortCard;
  /** NON-EMPTY reason: why this slot was replaceable (laws 2 / 4). */
  reason: string;
}

/** One kept slot with its typed reason (laws 1 / 3). */
export interface KeptSlot {
  index: number;
  itemId: string;
  /** NON-EMPTY reason: why this slot is kept. */
  reason: string;
}

/** One incoming OS card not used as a replacement, with its typed reason (law 5). */
export interface UnusedIncoming {
  itemId: string;
  /** NON-EMPTY reason: "already in stack" | "no replaceable slot remaining". */
  reason: string;
}

/**
 * The typed replacement plan: every slot's disposition (replaced or kept,
 * each with a non-empty reason) and every incoming card's fate (used or
 * unused, each with a typed reason). Nothing is silently dropped — the plan
 * accounts for the whole stack and the whole incoming page.
 */
export interface ReplacementPlan {
  /** The replacements to apply, stack-index ascending (deterministic merge order). */
  replacements: readonly CardReplacement[];
  /** The kept slots (current, behind-cursor, and prefetch-window), index ascending. */
  kept: readonly KeptSlot[];
  /** Incoming cards not used, in incoming order, with typed reasons. */
  unusedIncoming: readonly UnusedIncoming[];
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isUsableCard(value: unknown): value is ShortCard {
  return (
    isRecord(value) &&
    isRecord(value.item) &&
    typeof value.item.id === "string" &&
    value.item.id.length > 0
  );
}

function assertUsableOsFeed(osFeed: readonly ShortCard[]): void {
  if (!Array.isArray(osFeed)) {
    throw new ExperienceError(
      `osFeed: expected an array of ShortCard (the fresh OS page, projected by buildShortCards), got ${previewValue(osFeed)}`,
    );
  }
  const problems: string[] = [];
  osFeed.forEach((card, index) => {
    if (!isUsableCard(card)) {
      problems.push(
        `osFeed[${index}]: expected a ShortCard with a canonical item id, got ${previewValue(card)}`,
      );
    }
  });
  if (problems.length === 0) {
    const seen = new Set<string>();
    osFeed.forEach((card, index) => {
      if (seen.has(card.item.id)) {
        problems.push(
          `osFeed[${index}]: duplicate canonical item id '${card.item.id}' — the OS supplies one card per item`,
        );
      }
      seen.add(card.item.id);
    });
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertUsableReplacementSessionState(sessionState: ShortSessionState): void {
  if (!isRecord(sessionState)) {
    throw new ExperienceError("sessionState: expected a ShortSessionState object");
  }
  const problems: string[] = [];
  if (typeof sessionState.userId !== "string" || sessionState.userId.trim().length === 0) {
    problems.push(
      `sessionState.userId: expected a non-empty string, got ${previewValue(sessionState.userId)}`,
    );
  }
  if (typeof sessionState.sessionId !== "string" || sessionState.sessionId.trim().length === 0) {
    problems.push(
      `sessionState.sessionId: expected a non-empty string, got ${previewValue(sessionState.sessionId)}`,
    );
  }
  if (!isRecord(sessionState.policy)) {
    problems.push(
      `sessionState.policy: expected a RecommendationPolicy object, got ${previewValue(sessionState.policy)}`,
    );
  }
  const idLists: readonly (keyof ShortSessionState)[] = [
    "watchedItemIds",
    "skippedItemIds",
    "aheadOfCursorItemIds",
  ];
  for (const field of idLists) {
    const value = sessionState[field] as unknown;
    if (!Array.isArray(value)) {
      problems.push(
        `sessionState.${field}: expected an array of item ids, got ${previewValue(value)}`,
      );
      continue;
    }
    value.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.length === 0) {
        problems.push(
          `sessionState.${field}[${index}]: expected a non-empty string, got ${previewValue(entry)}`,
        );
      }
    });
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// planReplacement
// ---------------------------------------------------------------------------

/**
 * Plan the rapid candidate replacement for one fresh OS page (pure — see
 * the module doc for every law).
 *
 * @param stack        the current Short Feed stack (validated; never mutated).
 * @param osFeed       the fresh OS short-surface page, already projected into
 *                     ordered `ShortCard`s by `buildShortCards`
 *                     (vertical-first order preserved — the deterministic
 *                     merge order).
 * @param sessionState the session state (identity, policy, and the
 *                     watched/skipped evidence that marks slots replaceable).
 * @returns the typed `ReplacementPlan` — replacements + kept slots + unused
 *          incoming, every entry carrying a non-empty reason.
 * @throws `ExperienceError` on malformed input (stack, osFeed, or session state).
 */
export function planReplacement(
  stack: ShortFeedStack,
  osFeed: readonly ShortCard[],
  sessionState: ShortSessionState,
): ReplacementPlan {
  assertUsableShortFeedStack(stack);
  assertUsableOsFeed(osFeed);
  assertUsableReplacementSessionState(sessionState);

  const watched = new Set(sessionState.watchedItemIds);
  const skipped = new Set(sessionState.skippedItemIds);
  const inStack = new Set(stack.items.map((card) => card.item.id));

  // --- classify every stack slot (replaceable vs kept, with reasons) ------
  const replaceable: { index: number; outItemId: string; reason: string }[] = [];
  const kept: KeptSlot[] = [];
  stack.items.forEach((card, index) => {
    const itemId = card.item.id;
    if (index < stack.cursor) {
      kept.push({
        index,
        itemId,
        reason: "behind the cursor — session navigation history is never rewritten",
      });
      return;
    }
    if (index === stack.cursor) {
      kept.push({
        index,
        itemId,
        reason: "the current card — never swapped mid-view",
      });
      return;
    }
    if (watched.has(itemId)) {
      replaceable.push({
        index,
        outItemId: itemId,
        reason: "watched (completed) this session — stale runway, replaced with a fresh candidate",
      });
      return;
    }
    if (skipped.has(itemId)) {
      replaceable.push({
        index,
        outItemId: itemId,
        reason: "skipped this session — stale runway, replaced with a fresh candidate",
      });
      return;
    }
    if (index <= stack.cursor + stack.prefetchAhead) {
      kept.push({
        index,
        itemId,
        reason: `unwatched within the prefetch window (index ${index} <= cursor ${stack.cursor} + ${stack.prefetchAhead}) — the promised runway stays`,
      });
      return;
    }
    replaceable.push({
      index,
      outItemId: itemId,
      reason: `unwatched beyond the prefetch window (index ${index} > cursor ${stack.cursor} + ${stack.prefetchAhead}) — far runway is refreshable`,
    });
  });

  // --- deterministic merge: incoming in order, one card per item ----------
  const incomingTaken = new Set<string>();
  const replacements: CardReplacement[] = [];
  const unusedIncoming: UnusedIncoming[] = [];
  let slotCursor = 0; // replaceable slots are consumed in index-ascending order
  for (const card of osFeed) {
    const itemId = card.item.id;
    if (inStack.has(itemId)) {
      unusedIncoming.push({
        itemId,
        reason: "already present in the stack — one card per canonical item",
      });
      continue;
    }
    if (incomingTaken.has(itemId)) {
      // Defensive: assertUsableOsFeed already rejects duplicates; unreachable.
      unusedIncoming.push({
        itemId,
        reason: "duplicate in the incoming page — one card per canonical item",
      });
      continue;
    }
    const slot = replaceable[slotCursor];
    if (slot === undefined) {
      unusedIncoming.push({
        itemId,
        reason: "no replaceable slot remaining — every beyond-cursor slot is kept runway",
      });
      continue;
    }
    slotCursor += 1;
    incomingTaken.add(itemId);
    replacements.push({
      index: slot.index,
      outItemId: slot.outItemId,
      card,
      reason: slot.reason,
    });
  }

  // Kept slots include the replaceable ones that found no incoming card:
  // an unfilled replaceable slot simply keeps its card (honest — never
  // removed, never fabricated).
  const replacedIndexes = new Set(replacements.map((entry) => entry.index));
  for (const slot of replaceable) {
    if (!replacedIndexes.has(slot.index)) {
      kept.push({
        index: slot.index,
        itemId: slot.outItemId,
        reason: `${slot.reason} — but the fresh page supplied no new candidate for this slot, so the card stays`,
      });
    }
  }
  kept.sort((a, b) => a.index - b.index);

  return {
    replacements: Object.freeze(replacements),
    kept: Object.freeze(kept),
    unusedIncoming: Object.freeze(unusedIncoming),
  };
}
