/**
 * @wfx/experience — Short Feed engagement event emission contract (WFX-028, Lane C).
 *
 * `shortFeedEvents(stack, interaction)` produces the EXACT frozen
 * `EntertainmentEvent`s the app layer should emit through the WFX-005
 * EventSink for one Short Feed engagement — TYPED, NOT FIRED (this module
 * touches no sink; emitting is the app layer's job).
 *
 * The closed interaction → event map (the packet's law):
 *
 * - progress → `"progress"` with payload `{ percent }` (the watched percent,
 *   validated to [0, 100] — carried verbatim, never coerced),
 * - complete → `"complete"`,
 * - skip     → `"skip"`     (a forward swipe past an unwatched card is the
 *                            skip interaction — the mapping is the app
 *                            layer's one decision),
 * - like     → `"like"`,
 * - save     → `"save"`,
 * - share    → `"share"`.
 *
 * HONEST ABSENCE: a BACKWARD swipe emits NOTHING — the frozen event
 * vocabulary has no "unskip"/navigation event, and none is invented here
 * (frozen-contract drift). The module doc maps the gestures; the type system
 * keeps the vocabulary closed.
 *
 * Session identity and time belong to the CALLER (the EventSink law — same
 * as WFX-005's `composeExperienceEvent` and WFX-027's `planResume`): the
 * interaction carries its own stamp (`userId`, `sessionId`, ISO `occurredAt`
 * — no hidden clock). The engaged card MUST be in the supplied stack: its
 * canonical item id grounds the event, and the optional canonical
 * `sourceRealizationId` (host-supplied — the OS page's candidate realization
 * carries no canonical `wfxsrc_` id) rides along when present. Every
 * composed event is validated with the WFX-002 validator before it leaves
 * this module — a malformed event can never leak downstream.
 */

import type { EntertainmentEvent } from "@wfx/domain";
import {
  isEntertainmentItemId,
  isIso8601,
  isRecord,
  isSourceRealizationId,
  previewValue,
  validateEntertainmentEvent,
} from "@wfx/domain";

import { ExperienceError } from "../ports";
import type { ShortFeedStack } from "./stack";
import { assertUsableShortFeedStack } from "./stack";

// ---------------------------------------------------------------------------
// The stamp + the interaction (typed)
// ---------------------------------------------------------------------------

/**
 * The caller-supplied event stamp: who, in which EXPERIENCE session, at what
 * instant the emitted event is stamped with. The caller owns identity and
 * time (the EventSink law); this module never hides a clock.
 */
export interface ShortFeedEventStamp {
  userId: string;
  /** The EXPERIENCE session id (fills `EntertainmentEvent.sessionId`). */
  sessionId: string;
  /** ISO 8601 instant with an explicit offset. */
  occurredAt: string;
}

/**
 * One engagement action on one card (discriminated, closed vocabulary).
 * `percent` is REQUIRED for progress and FORBIDDEN elsewhere (the payload
 * law); `sourceRealizationId` is the optional canonical realization id
 * (host-supplied — see the module doc).
 */
export type ShortFeedAction =
  | { kind: "progress"; itemId: string; percent: number; sourceRealizationId?: string }
  | { kind: "complete"; itemId: string; sourceRealizationId?: string }
  | { kind: "skip"; itemId: string; sourceRealizationId?: string }
  | { kind: "like"; itemId: string; sourceRealizationId?: string }
  | { kind: "save"; itemId: string; sourceRealizationId?: string }
  | { kind: "share"; itemId: string; sourceRealizationId?: string };

/** One interaction ready for emission: the action plus its stamp. */
export interface ShortFeedInteraction {
  stamp: ShortFeedEventStamp;
  action: ShortFeedAction;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const ACTION_KINDS = ["progress", "complete", "skip", "like", "save", "share"] as const;

function actionProblems(interaction: ShortFeedInteraction): string[] {
  const problems: string[] = [];
  if (!isRecord(interaction.action)) {
    return [`interaction.action: expected a ShortFeedAction object, got ${previewValue(interaction.action)}`];
  }
  const action = interaction.action;
  if (
    typeof action.kind !== "string" ||
    !(ACTION_KINDS as readonly string[]).includes(action.kind)
  ) {
    problems.push(
      `interaction.action.kind: expected one of ${ACTION_KINDS.join(" | ")}, got ${previewValue(action.kind)}`,
    );
    return problems;
  }
  if (typeof action.itemId !== "string" || !isEntertainmentItemId(action.itemId)) {
    problems.push(
      `interaction.action.itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(action.itemId)}`,
    );
  }
  if (action.kind === "progress") {
    if (
      typeof action.percent !== "number" ||
      !Number.isFinite(action.percent) ||
      action.percent < 0 ||
      action.percent > 100
    ) {
      problems.push(
        `interaction.action.percent: expected a finite number in [0, 100] for a progress action, got ${previewValue(action.percent)}`,
      );
    }
  }
  if (
    action.sourceRealizationId !== undefined &&
    (typeof action.sourceRealizationId !== "string" || !isSourceRealizationId(action.sourceRealizationId))
  ) {
    problems.push(
      `interaction.action.sourceRealizationId: expected a canonical source-realization ID (wfxsrc_ prefix + 26-char Crockford Base32 ULID body) when present, got ${previewValue(action.sourceRealizationId)}`,
    );
  }
  return problems;
}

function assertUsableInteraction(interaction: ShortFeedInteraction): void {
  if (!isRecord(interaction)) {
    throw new ExperienceError("interaction: expected a ShortFeedInteraction object");
  }
  const problems: string[] = [];
  if (!isRecord(interaction.stamp)) {
    problems.push(
      `interaction.stamp: expected a ShortFeedEventStamp object, got ${previewValue(interaction.stamp)}`,
    );
  } else {
    if (!isNonEmptyString(interaction.stamp.userId)) {
      problems.push(
        `interaction.stamp.userId: expected a non-empty string, got ${previewValue(interaction.stamp.userId)}`,
      );
    }
    if (!isNonEmptyString(interaction.stamp.sessionId)) {
      problems.push(
        `interaction.stamp.sessionId: expected a non-empty string, got ${previewValue(interaction.stamp.sessionId)}`,
      );
    }
    if (typeof interaction.stamp.occurredAt !== "string" || !isIso8601(interaction.stamp.occurredAt)) {
      problems.push(
        `interaction.stamp.occurredAt: expected an ISO 8601 datetime string with explicit offset, got ${previewValue(interaction.stamp.occurredAt)}`,
      );
    }
  }
  problems.push(...actionProblems(interaction));
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// shortFeedEvents
// ---------------------------------------------------------------------------

/**
 * Compose the exact frozen `EntertainmentEvent`s for one Short Feed
 * engagement (typed, not fired — see the module doc for the closed map).
 *
 * The engaged card MUST be present in the supplied stack (its canonical
 * item id grounds the event; an interaction referencing a card that is not
 * in the feed is caller misuse and fails loudly with the typed
 * `ExperienceError` — never a fabricated event for an unknown card).
 *
 * @returns a single-element array — the sink-ready batch. Exactly one event
 *          per interaction (the array form is the batch contract; nothing
 *          in this module ever emits more or fewer).
 * @throws `ExperienceError` on malformed input (stack, stamp, or action).
 */
export function shortFeedEvents(
  stack: ShortFeedStack,
  interaction: ShortFeedInteraction,
): readonly EntertainmentEvent[] {
  assertUsableShortFeedStack(stack);
  assertUsableInteraction(interaction);

  const action = interaction.action;
  const card = stack.items.find((entry) => entry.item.id === action.itemId);
  if (card === undefined) {
    throw new ExperienceError(
      `interaction.action.itemId: '${action.itemId}' is not a card in this stack — engagement events are emitted for live stack cards only`,
    );
  }

  const event: EntertainmentEvent = {
    userId: interaction.stamp.userId,
    itemId: action.itemId,
    type: action.kind,
    occurredAt: interaction.stamp.occurredAt,
    sessionId: interaction.stamp.sessionId,
  };
  if (action.sourceRealizationId !== undefined) {
    event.sourceRealizationId = action.sourceRealizationId;
  }
  if (action.kind === "progress") {
    event.payload = { percent: action.percent };
  }

  const checked = validateEntertainmentEvent(event);
  if (!checked.ok) {
    // Defensive: unreachable after the validation above.
    throw new ExperienceError(checked.errors.map((message) => `event: ${message}`));
  }
  return Object.freeze([checked.value]);
}
