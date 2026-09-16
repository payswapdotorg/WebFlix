/**
 * @wfx/app-api — `POST /auth/register` (R02 — identity and profiles).
 *
 * Body: `{ email, password, displayName? }` →
 * `{ token, user, profiles, activeProfileId }`.
 *
 * The account law: the email/password are the 052 identity service's (scrypt
 * envelope at rest; the password NEVER appears in any answer or log); the
 * account's DEFAULT profile is created eagerly (the lazy materialization in
 * `profiles.ts` is the fallback for accounts created outside this route);
 * the first session token (`wfxsess_` + ULID, stored hashed, expiry +
 * revocation) is minted and returned EXACTLY ONCE — register auto-logs-in.
 *
 * Typed answers: 400 invalid-request (garbage body — one answer naming
 * every problem); 409 email-taken (the unique constraint's honest answer);
 * 500 loud boot/config failures; 502 the 052 degradation family (DB down —
 * auth never falls back to a fake account).
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  upstreamFailure,
} from "@api/host/http";
import { parseRegisterBody } from "@api/host/validate";
import { describeThrown } from "@wfx/experience";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  const parsed = parseRegisterBody(body.value);
  if (!parsed.ok) return badRequest(parsed.problems.join("; "));

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.register.boot", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }

  try {
    const registered = await boot.identity.register(parsed.value);
    if (!registered.ok) {
      if (registered.reason === "email-taken") {
        return Response.json(
          { error: "email-taken", detail: "an account with this email already exists" },
          { status: 409 },
        );
      }
      return badRequest(registered.details.join("; "));
    }

    // The account's default profile (eager — see the module doc).
    const ensured = await boot.profiles.ensureDefaultProfile(registered.user.id);
    if (!ensured.ok) {
      // The account row exists (just registered); this cannot honestly
      // happen — loud, never a fake profile list.
      return upstreamFailure("auth-unavailable", "the profile service refused the default-profile creation");
    }

    // The first session — the token is shown exactly once, never stored raw.
    const issued = await boot.sessions.createSession(registered.user.id);
    return Response.json({
      token: issued.token,
      user: registered.user,
      profiles: [ensured.profile],
      activeProfileId: ensured.profile.id,
    });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.register", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }
}
