/**
 * @wfx/app-web — `POST /api/auth/login` (R21-B): the real sign-in path.
 *
 * Service mode: proxies the Experience API's `POST /auth/login` — the
 * typed answer (token + user + profiles + activeProfileId) sets the
 * httpOnly `wfx_session` cookie; the token NEVER reaches the response
 * body for the client (the cookie IS the carrier; the body answers the
 * session VIEW only).
 *
 * Fixtures mode: the loud dev persona (`dev@webflix.local` /
 * `dev-password-1`) — the scripted identity lifecycle the same machinery
 * feeds (the same law the source-auth fixtures follow for J28).
 *
 * Honesty laws:
 * - the anti-enumeration answer is preserved verbatim (unknown email and
 *   wrong password answer the SAME typed 401 `invalid-credentials`);
 * - a transport failure answers the typed 502 family (never a fake
 *   session);
 * - the password never appears in any answer or log.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { authLogin } from "@/host/auth-transport";
import { driveFixtureLogin } from "@/host/auth-fixtures";
import { sessionCookieFor } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

interface LoginBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "body: expected a JSON object" }, { status: 400 });
  }
  const { email, password } = body as LoginBody;
  if (typeof email !== "string" || email.trim().length === 0) {
    return Response.json({ error: "email: expected a non-empty string" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length === 0) {
    return Response.json({ error: "password: expected a non-empty string" }, { status: 400 });
  }

  const host = await getWebRuntimeHost();
  const config = host.config;

  // Fixtures mode: the loud dev persona (never a production claim).
  if (config.mode === "fixtures") {
    const driven = driveFixtureLogin(email, password);
    if (!driven.ok) {
      // The same honest anti-enumeration answer.
      return Response.json(
        { error: "invalid-credentials", detail: "email or password is incorrect" },
        { status: 401 },
      );
    }
    return Response.json(
      { session: { user: driven.session.user, profiles: driven.session.profiles, activeProfileId: driven.session.activeProfileId } },
      { status: 200, headers: { "set-cookie": sessionCookieFor(driven.token) } },
    );
  }

  // Service mode: the REAL transport.
  const result = await authLogin({ apiBase: config.apiBase }, { email, password });
  if (!result.ok) {
    const status =
      result.failure.kind === "invalid-credentials" ? 401 :
      result.failure.kind === "invalid-input" ? 400 :
      result.failure.kind === "network" || result.failure.kind === "unavailable" ? 502 :
      400;
    return Response.json(
      { error: result.failure.kind, detail: result.failure.detail },
      { status },
    );
  }
  return Response.json(
    { session: result.value.session },
    { status: 200, headers: { "set-cookie": sessionCookieFor(result.value.token) } },
  );
}
