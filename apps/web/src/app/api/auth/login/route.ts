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

import { getWebRuntimeHost, getWebRuntimeHostForRequest } from "@/host/web-host";
import { authLogin } from "@/host/auth-transport";
import { driveFixtureLogin } from "@/host/auth-fixtures";
import { sessionCookieFor } from "@/host/session-cookie";
import { promoteAnonymousProgress } from "@/host/anonymous-truth";

export const dynamic = "force-dynamic";

interface LoginBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

/**
 * R23 web-A — THE LAWFUL POST-AUTHENTICATION PROMOTION (the R23-B
 * session-scoped progress law): when a viewer signs in, the anonymous
 * session's continue-watching positions are promoted into the identity's
 * watch-state `start` commands (the one lawful durable write — the shared
 * `promoteSessionProgressToDurable` outcome). Best-effort and honest: a
 * promotion failure never blocks the login itself, and NOTHING is ever
 * represented as durable identity BEFORE this point.
 */
async function promoteAnonymousSessionProgress(token: string): Promise<void> {
  try {
    const anonymousHost = await getWebRuntimeHost();
    const home = await anonymousHost.runtime.getHome();
    const inProgress = home.continueWatching.entries.filter(
      (entry) => entry.positionMs > 0 && entry.status === "in-progress",
    );
    if (inProgress.length === 0) return;
    const identityHost = await getWebRuntimeHostForRequest(token);
    if (identityHost === anonymousHost) return; // the token did not resolve an identity
    const sessionId = anonymousHost.session.context.sessionId;
    const promotedAt = new Date().toISOString();
    for (const entry of inProgress) {
      const outcome = promoteAnonymousProgress({
        sessionId,
        itemId: entry.itemId,
        positionMs: entry.positionMs,
        updatedAt: promotedAt,
      });
      if (outcome.kind === "promoted") {
        await identityHost.runtime.updateWatchState(outcome.command);
      }
    }
  } catch {
    // The promotion is the OPTIONAL durable upgrade — a failure here is
    // reported nowhere as success and never blocks the sign-in.
  }
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
    // R23 web-A: the lawful post-authentication promotion (best-effort).
    await promoteAnonymousSessionProgress(driven.token);
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
  // R23 web-A: the lawful post-authentication promotion (best-effort).
  await promoteAnonymousSessionProgress(result.value.token);
  return Response.json(
    { session: result.value.session },
    { status: 200, headers: { "set-cookie": sessionCookieFor(result.value.token) } },
  );
}
