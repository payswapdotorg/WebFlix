/**
 * @wfx/app-web — `PUT /api/auth/select-profile` (R21-B): the real profile switch.
 *
 * Body: `{ profileId }`. Service mode: proxies the Experience API's
 * `PUT /profiles/:id/select` (the SESSION's active profile changes
 * server-side; ownership-checked there — another account's profile
 * answers the same honest 404 as an unknown id). The next request boots
 * the new identity's host (the per-identity host map re-keys).
 *
 * Fixtures mode: the loud dev persona's profile-select drive (the two
 * scripted profiles).
 *
 * Honesty: an unknown/foreign profile answers the typed 404 (never a
 * silent no-op); a transport failure answers the typed 502 family.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { authSelectProfile } from "@/host/auth-transport";
import { driveFixtureSelectProfile } from "@/host/auth-fixtures";
import { sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "body: expected a JSON object" }, { status: 400 });
  }
  const profileId = (body as { profileId?: unknown }).profileId;
  if (typeof profileId !== "string" || profileId.length === 0) {
    return Response.json({ error: "profileId: expected a non-empty string" }, { status: 400 });
  }

  const token = sessionTokenFromRequest(request);
  if (token === null) {
    return Response.json(
      { error: "unauthorized", detail: "signing in is required before selecting a profile" },
      { status: 401 },
    );
  }

  const host = await getWebRuntimeHost();
  const config = host.config;

  // Fixtures mode: the loud dev persona's profile drive.
  if (config.mode === "fixtures") {
    const driven = driveFixtureSelectProfile(profileId);
    if (!driven.ok) {
      return Response.json(
        { error: "not-found", detail: `no profile '${profileId}' on this account` },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, session: driven.session });
  }

  // Service mode: the REAL selection.
  const result = await authSelectProfile({ apiBase: config.apiBase }, token, profileId);
  if (!result.ok) {
    const status =
      result.failure.kind === "not-found" ? 404 :
      result.failure.kind === "unauthorized" ? 401 :
      result.failure.kind === "network" || result.failure.kind === "unavailable" ? 502 :
      400;
    return Response.json(
      { error: result.failure.kind, detail: result.failure.detail },
      { status },
    );
  }
  return Response.json({ ok: true, session: result.value });
}
