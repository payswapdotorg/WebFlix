/**
 * @wfx/app-web — `POST /api/auth/logout` (R21-B): the real sign-out path.
 *
 * Service mode: proxies the Experience API's `POST /auth/logout` (the
 * session token is REVOKED server-side) and clears the httpOnly
 * `wfx_session` cookie — the cookie clears even when the transport call
 * fails (a stale cookie must not outlive the user's sign-out intent;
 * the typed failure still answers in the body).
 *
 * Fixtures mode: the loud dev persona's sign-out drive + the cookie
 * clear.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { authLogout } from "@/host/auth-transport";
import { driveFixtureLogout } from "@/host/auth-fixtures";
import { clearedSessionCookie, sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const host = await getWebRuntimeHost();
  const config = host.config;
  const token = sessionTokenFromRequest(request);

  // No session cookie: the honest idempotent sign-out (already signed out).
  if (token === null) {
    return Response.json({ ok: true, revoked: false }, { status: 200, headers: { "set-cookie": clearedSessionCookie() } });
  }

  // Fixtures mode: the loud dev persona's sign-out.
  if (config.mode === "fixtures") {
    driveFixtureLogout();
    return Response.json({ ok: true, revoked: true }, { status: 200, headers: { "set-cookie": clearedSessionCookie() } });
  }

  // Service mode: the REAL revocation (the cookie clears either way).
  const result = await authLogout({ apiBase: config.apiBase }, token);
  const headers = { "set-cookie": clearedSessionCookie() };
  if (!result.ok) {
    const status =
      result.failure.kind === "network" || result.failure.kind === "unavailable" ? 502 :
      result.failure.kind === "unauthorized" ? 401 :
      400;
    // The cookie is STILL cleared (a token the service just rejected is
    // not worth keeping); the typed failure answers honestly.
    return Response.json({ error: result.failure.kind, detail: result.failure.detail }, { status, headers });
  }
  return Response.json({ ok: true, revoked: result.value.revoked }, { status: 200, headers });
}
