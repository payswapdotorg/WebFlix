/**
 * @wfx/app-api — `GET|POST /api/relay` — the outbox drain path (WFX-055A).
 *
 * The protected relay over the 052 transactional outbox: requeue stale
 * in-flight rows (crashed-relay recovery), then claim due pending rows
 * (`drainEventOutbox` — `FOR UPDATE SKIP LOCKED`) and deliver each
 * envelope through the REAL watch-history fold (`host/relay.ts`; the
 * non-watch event types are an honest documented no-op consumer).
 * AT-LEAST-ONCE, never lost, never fabricated.
 *
 * THE CRON_SECRET BEARER LAW (exactly as `host/config.ts` documents):
 * - `CRON_SECRET` SET ⇒ the route requires `Authorization: Bearer
 *   <CRON_SECRET>` (the header Vercel's cron sends when the env var is
 *   set on the project). Missing/mismatched ⇒ typed 401.
 * - `CRON_SECRET` UNSET **in production** (`NODE_ENV=production`) ⇒ typed
 *   500: the relay is a protected route and must not drift open.
 * - `CRON_SECRET` UNSET outside production ⇒ allowed (local draining
 *   without a secret).
 *
 * VERCEL CRON REALITY (hobby plan): only DAILY crons are allowed —
 * `apps/api/vercel.json` schedules this path once per day (03:00 UTC).
 * Everything finer is the opportunistic drain lane (`host/relay.ts`),
 * honestly best-effort on serverless. The daily cron is the guaranteed
 * delivery floor.
 *
 * The method is both GET (what the Vercel cron invokes) and POST (manual
 * or operator tooling), both under the same law.
 */

import { timingSafeEqual } from "node:crypto";

import { resolveApiConfig } from "@api/host/config";
import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { runRelayDrain } from "@api/host/relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Constant-time bearer comparison (never a string === on a secret). */
function bearerMatches(authorization: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const received = Buffer.from(authorization, "utf8");
  const candidate = Buffer.from(expected, "utf8");
  return received.length === candidate.length && timingSafeEqual(received, candidate);
}

async function handleRelay(request: Request): Promise<Response> {
  // The auth law needs only the (cheap, no-DB) config resolution — an
  // unauthenticated request must not trigger a persistence boot.
  let cronSecret: string | null;
  try {
    cronSecret = resolveApiConfig().cronSecret;
  } catch (thrown) {
    return bootFailure(thrown);
  }

  if (cronSecret !== null) {
    const authorization = request.headers.get("authorization");
    if (authorization === null || !bearerMatches(authorization, cronSecret)) {
      return unauthorized(
        "the relay requires 'Authorization: Bearer <CRON_SECRET>' (the Vercel cron convention)",
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json(
      {
        error: "relay-unconfigured",
        detail:
          "CRON_SECRET is unset in production — the protected relay must not drift open. " +
          "Set CRON_SECRET on the Vercel project (it may be any strong random string).",
      },
      { status: 500 },
    );
  }
  // CRON_SECRET unset outside production: allowed (documented local draining).

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("relay.boot", thrown);
    return upstreamFailure("relay-failed", "service boot failed");
  }

  try {
    // R02: the profile service rides the drain — the fold attributes
    // legacy/anonymous (NULL-profile) rows to the user's effective profile.
    // R04: the removal store rides the drain — the fold clears a removal
    // row when a new watch event arrives (re-materialize on re-watch).
    const result = await runRelayDrain(
      boot.persistence.db,
      boot.ports.clock,
      50,
      boot.profiles,
      boot.history.removalStore(),
    );
    return Response.json({
      ok: true,
      requeued: result.requeued,
      claimed: result.drain.claimed,
      delivered: result.drain.delivered,
      rescheduled: result.drain.rescheduled,
      failed: result.drain.failed,
    });
  } catch (thrown) {
    logDegradation("relay", thrown);
    return upstreamFailure("relay-failed", String(thrown));
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleRelay(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleRelay(request);
}
