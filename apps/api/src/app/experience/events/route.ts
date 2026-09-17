/**
 * @wfx/app-api — `POST /experience/events` (WFX-055A transport contract;
 * R02: profile-attributed ingest).
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
 * R02 — PROFILE-ATTRIBUTED INGEST: with `Authorization: Bearer wfxsess_…`,
 * the outbox row carries the session's ACTIVE PROFILE
 * (`emitForProfile`), so the relay folds the event into THAT profile's
 * watch history — not the default-profile fallback. Anonymous events keep
 * the exact pre-R02 path (NULL attribution; the relay resolves the
 * effective profile at delivery). The frozen `EntertainmentEvent` shape is
 * NEVER edited — attribution lives on the outbox ROW.
 *
 * Validation: the body must pass the frozen `validateEntertainmentEvent`
 * (the SAME validator the outbox applies — typed 400 naming every
 * problem), and the event's identity must be CONSISTENT with the request
 * (the event's `userId` matches the resolved identity — header or session;
 * `x-wfx-session-id`, when present, matches `event.sessionId`; a mismatch
 * is garbage ⇒ 400, an event may not claim another identity).
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
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { readBearerToken, readConnectorContext, SESSION_ID_HEADER } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import { scheduleOpportunisticDrain } from "@api/host/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  // The frozen domain validator — the same one the outbox applies.
  const validated = validateEntertainmentEvent(body.value);
  if (!validated.ok) {
    return badRequest(`event: ${validated.errors.join("; ")}`);
  }
  const event = validated.value;

  // The x-wfx-session-id consistency check (both channels — the header is
  // the frozen transport's, independent of the bearer session).
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
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("events.session", resolved.detail);
          return upstreamFailure("event-sink-unavailable", resolved.detail);
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      // Identity consistency: the event may not claim another identity.
      if (event.userId !== resolved.identity.ctx.userId) {
        return badRequest("event.userId does not match the bearer session's user");
      }
      // PROFILE-ATTRIBUTED durability: the row records the active profile.
      await boot.profileEvents.emitForProfile(event, resolved.identity.profileId);
      scheduleOpportunisticDrain(
        boot.persistence.db,
        boot.ports.clock,
        boot.profiles,
        boot.history.removalStore(),
      );
      return Response.json({ ok: true });
    }

    // The anonymous transition — the exact pre-R02 ingest path.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    if (event.userId !== anonymous.ctx.userId) {
      return badRequest("event.userId does not match the x-wfx-user-id header");
    }
    // One atomic outbox insert — durable the moment this answers 2xx.
    await boot.ports.events.emit(event);
    // The bounded best-effort delivery lane (the cron is the floor).
    scheduleOpportunisticDrain(
      boot.persistence.db,
      boot.ports.clock,
      boot.profiles,
      boot.history.removalStore(),
    );
    return Response.json({ ok: true });
  } catch (thrown) {
    logDegradation("events", thrown);
    return upstreamFailure("event-sink-unavailable", describeThrown(thrown));
  }
}
