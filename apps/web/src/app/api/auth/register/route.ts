/**
 * @wfx/app-web — `POST /api/auth/register` (R21-B): the real account-creation path.
 *
 * Service mode: proxies the Experience API's `POST /auth/register` — the
 * auto-logged-in session (token + view) sets the httpOnly `wfx_session`
 * cookie; the body answers the session VIEW only.
 *
 * Fixtures mode: the loud dev persona answers the fixture session (any
 * valid body signs the persona in — register/login are the same dev
 * double; loudly labeled, never a production claim).
 *
 * Honesty laws: 409 `email-taken` is the unique constraint's honest
 * answer; a transport failure answers the typed 502 family (never a
 * fake session); the password never appears in any answer or log.
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { authRegister } from "@/host/auth-transport";
import { driveFixtureLogin, FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD } from "@/host/auth-fixtures";
import { sessionCookieFor } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

interface RegisterBody {
  readonly email?: unknown;
  readonly password?: unknown;
  readonly displayName?: unknown;
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
  const { email, password, displayName } = body as RegisterBody;
  if (typeof email !== "string" || email.trim().length === 0) {
    return Response.json({ error: "email: expected a non-empty string" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length === 0) {
    return Response.json({ error: "password: expected a non-empty string" }, { status: 400 });
  }
  if (displayName !== undefined && typeof displayName !== "string") {
    return Response.json({ error: "displayName: expected a string when present" }, { status: 400 });
  }

  const host = await getWebRuntimeHost();
  const config = host.config;

  // Fixtures mode: the loud dev persona (register == the dev sign-in).
  if (config.mode === "fixtures") {
    const driven = driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
    if (!driven.ok) {
      return Response.json({ error: "unavailable", detail: "the dev persona could not sign in" }, { status: 502 });
    }
    return Response.json(
      { session: { user: driven.session.user, profiles: driven.session.profiles, activeProfileId: driven.session.activeProfileId } },
      { status: 200, headers: { "set-cookie": sessionCookieFor(driven.token) } },
    );
  }

  // Service mode: the REAL transport.
  const result = await authRegister(
    { apiBase: config.apiBase },
    {
      email,
      password,
      ...(typeof displayName === "string" && displayName.trim().length > 0
        ? { displayName: displayName.trim() }
        : {}),
    },
  );
  if (!result.ok) {
    const status =
      result.failure.kind === "email-taken" ? 409 :
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
