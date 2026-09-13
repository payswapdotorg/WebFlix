/**
 * @wfx/experience — shared event composition (WFX-005, Lane C).
 *
 * Every frozen `EntertainmentEvent` this shell emits is built here and
 * validated with the WFX-002 validator (`validateEntertainmentEvent`) BEFORE
 * it reaches the EventSink — a malformed event can never leak downstream.
 *
 * Field policy:
 * - `userId` and `sessionId` come from the `ExperienceContext`: the session
 *   identity is supplied by the caller (the EventSink contract — "envelope /
 *   sessionId handled by caller or a wrapper"), and the composition root
 *   wraps events in `EventEnvelope`s if it needs canonical `wfxevt_` ids.
 * - `occurredAt` is stamped from the injected `Clock` — never `Date.now()`.
 * - `sourceRealizationId` is set only when the caller can name one.
 * - `payload` is set only when the caller supplies one; playback events
 *   carry the `playbackSessionId` correlation key (and `positionMs` for
 *   progress) so watch state can be reconstructed from the event stream.
 *
 * The defensive validation failure cannot happen after caller-side input
 * validation (every event field is pre-checked by the use-cases); if it ever
 * fires, it fails loudly with the typed `ExperienceError` instead of
 * emitting garbage.
 */

import type { EntertainmentEvent } from "@wfx/domain";
import { validateEntertainmentEvent } from "@wfx/domain";

import { ExperienceError, type Clock, type ExperienceContext } from "../ports";

/** Typed input for `composeExperienceEvent`. */
export interface ExperienceEventSpec {
  /** Canonical entertainment-item ID (`wfxitm_...`). */
  itemId: string;
  type: EntertainmentEvent["type"];
  /** Canonical source-realization ID (`wfxsrc_...`) when the event ties to one. */
  sourceRealizationId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Compose and validate one frozen `EntertainmentEvent` from the context, the
 * injected clock, and the caller's spec. Pure: touches no sink, no store.
 *
 * Throws `ExperienceError` (defensive — unreachable after caller-side input
 * validation) when the composed event fails the WFX-002 validator.
 */
export function composeExperienceEvent(
  clock: Clock,
  ctx: ExperienceContext,
  spec: ExperienceEventSpec,
): EntertainmentEvent {
  const event: EntertainmentEvent = {
    userId: ctx.userId,
    itemId: spec.itemId,
    type: spec.type,
    occurredAt: new Date(clock.now()).toISOString(),
    sessionId: ctx.sessionId,
  };
  if (spec.sourceRealizationId !== undefined) event.sourceRealizationId = spec.sourceRealizationId;
  if (spec.payload !== undefined) event.payload = spec.payload;

  const checked = validateEntertainmentEvent(event);
  if (!checked.ok) {
    throw new ExperienceError(checked.errors.map((message) => `event: ${message}`));
  }
  return checked.value;
}
