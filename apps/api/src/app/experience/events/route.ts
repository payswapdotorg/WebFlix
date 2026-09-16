/**
 * @wfx/app-api — `POST /experience/events` (WFX-055A transport contract).
 *
 * Body: an `EntertainmentEvent` JSON object → 2xx `{ ok: true }` (the
 * frozen client only checks ok + JSON).
 *
 * DURABILITY LAW: the event sink is the 052 TRANSACTIONAL OUTBOX
 * (`PostgresEventSink` → `event_outbox`) — one atomic single-statement
 * insert, so the event is DURABLE the very moment this endpoint answers
 * 2xx (the answering transaction and the enqueue are the same statement).
 * Delivery to the watch-history projection happens in the relay lanes
 * (`host/relay.ts`): the daily Vercel cron + the bounded opportunistic
 * drain nudged below — at-least-once, never lost.
 *
 * Validation: the body must pass the frozen `validateEntertainmentEvent`
 * (the SAME validator the outbox applies — typed 400 naming every
 * problem), and the event's identity must be CONSISTENT with the request
 * headers (the frozen client sends `x-wfx-user-id: event.userId` and
 * `x-wfx-session-id: event.sessionId`; a mismatch is garbage ⇒ 400, an
 * event may not claim another header identity).
 *
 * Degradation law (052 classify + WFX-003): a lost watch-state event is
 * NEVER a silent success — a LOUD boot failure answers a typed 500, and
 * any failure to durably enqueue answers a typed 502 (the client throws
 * `HostTransportError` on non-2xx, which is exactly the EventSink
 * contract).
 */

import { validateEntertainmentEvent } from "@wfx/domain";
import { describeThrown } from "@wfx/experience";

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  upstreamFailure,
} from "@api/host/http";
import { readConnectorContext, SESSION_ID_HEADER } from "@api/host/identity";
import { scheduleOpportunisticDrain } from "@api/host/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const identity = readConnectorContext(request.headers);
  if (!identity.ok) return badRequest(identity.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  // The frozen domain validator — the same one the outbox applies.
  const validated = validateEntertainmentEvent(body.value);
  if (!validated.ok) {
    return badRequest(`event: ${validated.errors.join("; ")}`);
  }
  const event = validated.value;

  // Identity consistency: the event may not claim another header identity.
  if (event.userId !== identity.ctx.userId) {
    return badRequest("event.userId does not match the x-wfx-user-id header");
  }
  const headerSession = request.headers.get(SESSION_ID_HEADER);
  if (headerSession !== null && headerSession.trim() !== event.sessionId) {
    return badRequest("event.sessionId does not match the x-wfx-session-id header");
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("events.boot", thrown);
    return upstreamFailure("event-sink-unavailable", describeThrown(thrown));
  }

  try {
    // One atomic outbox insert — durable the moment this answers 2xx.
    await boot.ports.events.emit(event);
    // The bounded best-effort delivery lane (the cron is the floor).
    scheduleOpportunisticDrain(boot.persistence.db, boot.ports.clock);
    return Response.json({ ok: true });
  } catch (thrown) {
    logDegradation("events", thrown);
    return upstreamFailure("event-sink-unavailable", describeThrown(thrown));
  }
}
