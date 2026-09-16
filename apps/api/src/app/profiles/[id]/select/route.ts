/**
 * @wfx/app-api — `PUT /profiles/:id/select` (R02 — identity and profiles).
 *
 * Requires `Authorization: Bearer wfxsess_…`. Sets the SESSION's active
 * profile (`sessions.active_profile_id`, ownership-checked in the UPDATE
 * itself — another account's profile answers the same honest 404 as an
 * unknown id) → `{ ok: true, profile, activeProfileId }`.
 *
 * The per-session selection law: selection is a property of the SESSION,
 * not the account — device A may run the Kids profile while device B runs
 * the default; every profile-scoped read/write of the session's requests
 * resolves through THIS selection until it changes. No body is required
 * (an empty one is tolerated).
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // No body is required (an empty one is tolerated — selection carries no payload).
  const body = await readJsonBody(request);
  if (!body.ok) return Response.json({ error: "invalid-request", detail: body.detail }, { status: 400 });

  const { id } = await context.params;
  if (typeof id !== "string" || id.trim().length === 0) {
    return Response.json(
      { error: "invalid-request", detail: "profile id: expected a non-empty path segment" },
      { status: 400 },
    );
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("profiles.select.boot", thrown);
    return upstreamFailure("profiles-unavailable", describeThrown(thrown));
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        return upstreamFailure("profiles-unavailable", resolved.detail);
      }
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized("authorization: a bearer session token is required");
    }

    const selected = await boot.sessions.setActiveProfile({
      token: resolved.identity.token,
      profileId: id.trim(),
    });
    if (!selected.ok) {
      if (selected.reason === "unknown-profile") {
        return Response.json(
          { error: "profile-not-found", detail: "no such profile under this account" },
          { status: 404 },
        );
      }
      // unknown-token | expired | revoked — the session died mid-flight.
      return unauthorized(`authorization: session token rejected (${selected.reason})`);
    }
    const profile = await boot.profiles.getProfile(id.trim());
    return Response.json({
      ok: true,
      activeProfileId: selected.session.activeProfileId,
      profile,
    });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("profiles.select", thrown);
    return upstreamFailure("profiles-unavailable", describeThrown(thrown));
  }
}
