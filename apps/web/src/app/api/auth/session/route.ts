/**
 * @wfx/app-web — `GET /api/auth/session` (R21-B): the session read path.
 *
 * The session-menu island's probe: answers the CURRENT session truth —
 * `{ signedIn: false }` for the anonymous/signed-out request (the honest
 * answer, never a fake profile), or `{ signedIn: true, session }` (the
 * account view: user + profiles + activeProfileId) for a valid cookie.
 *
 * Service mode: the REAL `GET /auth/me` (the cross-device continuity
 * probe) through the auth transport; a rejected token answers the typed
 * 401 with its reason (the surfaces render the signed-out state and can
 * name WHY — expired/revoked/unknown — never a silent failure).
 *
 * Fixtures mode: the loud dev persona's state (the scripted truth).
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { authReadSession } from "@/host/auth-transport";
import { FIXTURE_AUTH_TOKEN, fixtureSessionView, readFixtureAuthState } from "@/host/auth-fixtures";
import { sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const host = await getWebRuntimeHost();
  const config = host.config;
  const token = sessionTokenFromRequest(request);

  // No session cookie: the honest signed-out truth.
  if (token === null) {
    return Response.json({ signedIn: false });
  }

  // Fixtures mode: the loud dev persona's state.
  if (config.mode === "fixtures") {
    if (token !== FIXTURE_AUTH_TOKEN || readFixtureAuthState().signedIn !== true) {
      return Response.json({ signedIn: false });
    }
    return Response.json({ signedIn: true, session: fixtureSessionView() });
  }

  // Service mode: the REAL continuity probe.
  const result = await authReadSession({ apiBase: config.apiBase }, token);
  if (!result.ok) {
    if (result.failure.kind === "unauthorized") {
      // The typed reason rides the body (the surface names WHY the stored
      // sign-in was not accepted — never a silent signed-out).
      return Response.json(
        { signedIn: false, reason: "rejected", detail: result.failure.detail },
        { status: 401 },
      );
    }
    const status =
      result.failure.kind === "network" || result.failure.kind === "unavailable" ? 502 : 400;
    return Response.json(
      { signedIn: false, reason: result.failure.kind, detail: result.failure.detail },
      { status },
    );
  }
  return Response.json({ signedIn: true, session: result.value });
}
