/**
 * @wfx/app-api — `POST /auth/logout` (R02 — identity and profiles).
 *
 * Requires `Authorization: Bearer wfxsess_…`. REVOKES the session the token
 * belongs to (the idempotent `revoked_at` stamp — sign-out, auditable) and
 * answers `{ ok: true }`. An unknown/expired/revoked token is the typed 401
 * (there is nothing left to revoke); a malformed Authorization header is
 * likewise a 401 — presented-but-broken credentials are rejected, never
 * silently ignored.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { describeThrown } from "@wfx/experience";
import { resolveScopedIdentity } from "@api/host/session-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // No body is required (an empty one is tolerated — logout carries no payload).
  const body = await readJsonBody(request);
  if (!body.ok) return Response.json({ error: "invalid-request", detail: body.detail }, { status: 400 });

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.logout.boot", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        return upstreamFailure("auth-unavailable", resolved.detail);
      }
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized("authorization: a bearer session token is required to log out");
    }

    const revoked = await boot.sessions.revokeSession(resolved.identity.token);
    // `revoked: false` means it was ALREADY revoked (or raced) — idempotent
    // success either way: logout is safe to repeat.
    return Response.json({ ok: true, revoked });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.logout", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }
}
