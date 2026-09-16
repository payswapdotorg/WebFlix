/**
 * @wfx/app-api — `POST /auth/login` (R02 — identity and profiles).
 *
 * Body: `{ email, password }` → `{ token, user, profiles, activeProfileId }`.
 *
 * The 052 anti-enumeration law, carried through the HTTP boundary: UNKNOWN
 * EMAIL and WRONG PASSWORD both answer the SAME typed 401
 * `{ error: "invalid-credentials" }` (the service burns one scrypt
 * derivation either way — no timing or shape oracle). A successful login
 * ensures the account's DEFAULT profile (the lazy migration fallback) and
 * mints a fresh session token (`wfxsess_` + ULID, shown exactly once,
 * stored hashed). The password NEVER appears in any answer or log.
 *
 * Typed answers: 400 invalid-request; 401 invalid-credentials; 500 loud
 * boot/config failures; 502 the 052 degradation family.
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
import { parseLoginBody } from "@api/host/validate";
import { describeThrown } from "@wfx/experience";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  const parsed = parseLoginBody(body.value);
  if (!parsed.ok) return badRequest(parsed.problems.join("; "));

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.login.boot", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }

  try {
    const authenticated = await boot.identity.authenticate(parsed.value);
    if (!authenticated.ok) {
      if (authenticated.reason === "invalid-input") {
        return badRequest(authenticated.details.join("; "));
      }
      // invalid-credentials — the one honest answer for both unknown email
      // and wrong password (no enumeration).
      return Response.json(
        { error: "invalid-credentials", detail: "email or password is incorrect" },
        { status: 401 },
      );
    }

    // The account's default profile (usually already there; ensured for
    // pre-R02 accounts on their first login — the lazy migration).
    const ensured = await boot.profiles.ensureDefaultProfile(authenticated.user.id);
    if (!ensured.ok) {
      return upstreamFailure("auth-unavailable", "the profile service refused the default-profile resolution");
    }

    // Cross-device continuity: any device logging in sees the SAME
    // server-side profiles — the token is the only per-device secret.
    const profiles = await boot.profiles.listProfiles(authenticated.user.id);
    const issued = await boot.sessions.createSession(authenticated.user.id);
    return Response.json({
      token: issued.token,
      user: authenticated.user,
      profiles,
      activeProfileId: issued.session.activeProfileId ?? ensured.profile.id,
    });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("auth.login", thrown);
    return upstreamFailure("auth-unavailable", describeThrown(thrown));
  }
}
