/**
 * Event envelope for the frozen EntertainmentEvent contract (WFX-002).
 *
 * `EventEnvelope` wraps a frozen `EntertainmentEvent` with delivery-neutral
 * metadata: an envelope schema version, a canonical event identity
 * (`wfxevt_` + ULID), and the ISO 8601 occurrence timestamp.
 *
 * Design decisions (lead-visible):
 * - `makeEvent` is a typed constructor: it fills `eventId`, `occurredAt`, and
 *   (when omitted) `sessionId`, and trusts the types of caller-supplied
 *   fields. Runtime validation of untrusted data belongs to
 *   `validateEntertainmentEvent` / `envelopeFromRaw`.
 * - The canonical ID scheme defines exactly one session-scoped prefix
 *   (`wfxpses_`), so an auto-generated session ID uses it. Callers with their
 *   own session identifiers should pass `sessionId` explicitly.
 * - `envelope.eventId` is minted at wrap time: wrapping the same event twice
 *   produces two distinct envelope identities for the same payload.
 * - `envelopeFromRaw` is a safe parse for untrusted input. It only accepts the
 *   current `SCHEMA_VERSION`; other versions are rejected explicitly rather
 *   than guessed at (no fake success paths).
 */

import type { EntertainmentEvent } from "./contracts/frozen";
import { type EventId, isEventId, newEventId, newPlaybackSessionId } from "./ids";
import {
  type ValidationResult,
  isIso8601,
  isRecord,
  previewValue,
  validateEntertainmentEvent,
} from "./validation";

/** Event envelope schema version. Bump when the envelope shape changes incompatibly. */
export const SCHEMA_VERSION = 1;

/** Event type union mirrored from the frozen `EntertainmentEvent` for convenience. */
export type EntertainmentEventType = EntertainmentEvent["type"];

/** Envelope wrapping a frozen `EntertainmentEvent` with canonical identity and timing. */
export interface EventEnvelope {
  /** Envelope schema version; always `SCHEMA_VERSION` for envelopes produced here. */
  schemaVersion: number;
  /** Canonical event identity: `wfxevt_` prefix + 26-char ULID body (see ids.ts). */
  eventId: EventId;
  /** ISO 8601 occurrence timestamp; mirrors `event.occurredAt` for envelopes produced here. */
  occurredAt: string;
  /** The frozen EntertainmentEvent payload. */
  event: EntertainmentEvent;
}

/** Typed input for `makeEvent`; omit `sessionId` to have one generated. */
export interface MakeEventInput {
  userId: string;
  /** Canonical entertainment-item ID (`wfxitm_...`). */
  itemId: string;
  type: EntertainmentEventType;
  /** Omit to auto-generate a fresh `wfxpses_`-scoped session ID. */
  sessionId?: string;
  /** Canonical source-realization ID (`wfxsrc_...`) when the event ties to one. */
  sourceRealizationId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Construct an `EventEnvelope` from typed input: fills the event identity
 * (`wfxevt_`), the occurrence timestamp (now, ISO 8601 UTC), and the session
 * ID (fresh `wfxpses_` ULID) when the caller does not supply one.
 */
export function makeEvent(input: MakeEventInput): EventEnvelope {
  const occurredAt = new Date().toISOString();
  const sessionId = input.sessionId ?? newPlaybackSessionId();

  const event: EntertainmentEvent = {
    userId: input.userId,
    itemId: input.itemId,
    type: input.type,
    occurredAt,
    sessionId,
  };
  if (input.sourceRealizationId !== undefined) event.sourceRealizationId = input.sourceRealizationId;
  if (input.payload !== undefined) event.payload = input.payload;

  return envelope(event);
}

/**
 * Wrap an existing frozen `EntertainmentEvent` in an envelope: mints a fresh
 * canonical event ID and stamps the envelope's `occurredAt` from the event.
 */
export function envelope(event: EntertainmentEvent): EventEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: newEventId(),
    occurredAt: event.occurredAt,
    event,
  };
}

/**
 * Safe-parse untrusted input into an `EventEnvelope`.
 *
 * Accepts only the current `SCHEMA_VERSION`, requires a canonical `wfxevt_`
 * event ID and a full ISO 8601 `occurredAt`, and validates the inner event
 * with `validateEntertainmentEvent`. Returns every collected problem on
 * failure — never throws, never coerces.
 */
export function envelopeFromRaw(raw: unknown): ValidationResult<EventEnvelope> {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["EventEnvelope: expected an object"] };
  }
  const errors: string[] = [];

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${SCHEMA_VERSION}, got ${previewValue(raw.schemaVersion)}`);
  }

  let eventId: EventId | undefined;
  if (isEventId(raw.eventId)) {
    eventId = raw.eventId;
  } else {
    errors.push(
      `eventId: expected an event ID (wfxevt_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(raw.eventId)}`,
    );
  }

  let occurredAt: string | undefined;
  if (isIso8601(raw.occurredAt)) {
    occurredAt = raw.occurredAt;
  } else {
    errors.push(
      `occurredAt: expected an ISO 8601 datetime string with explicit offset, got ${previewValue(raw.occurredAt)}`,
    );
  }

  const event = validateEntertainmentEvent(raw.event);
  if (!event.ok) {
    errors.push(...event.errors.map((message) => `event.${message}`));
  }

  if (eventId === undefined || occurredAt === undefined || !event.ok || errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { schemaVersion: SCHEMA_VERSION, eventId, occurredAt, event: event.value },
  };
}
