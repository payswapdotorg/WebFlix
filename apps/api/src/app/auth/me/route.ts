/**
 * @wfx/app-api — `GET /auth/me` (R02 — identity and profiles).
 *
 * Requires `Authorization: Bearer wfxsess_…` →
 * `{ user, profiles, activeProfileId }` — the token's account (NEVER the
 * password hash), the account's profiles (the default materialized on
 * first read for pre-R02 accounts), and the request's EFFECTIVE profile
 * (the session's active selection or the default — resolved per-request).
 *
 * This is the cross-device continuity probe: any device with a valid token
 * sees the same server-side account/profile state. Typed 401s for
 * unknown/expired/revoked tokens (with the reason — actionable for the
 * client); 500 loud boot failures; 502 the degradation family.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { describeThrown } from "@wfx/experience";
import { resolveScopedIdentity } from "@api/host/session-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.me.boot", thrown);
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
      return unauthorized("authorization: a bearer session token is required");
    }

    // The profiles list (the default exists by construction in session mode).
    const profiles = await boot.profiles.listProfiles(resolved.identity.user.id);
    return Response.json({
      user: resolved.identity.user,
      profiles,
      activeProfileId: resolved.identity.profileId,
    });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.me", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }
}
