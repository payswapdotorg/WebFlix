/**
 * @wfx/app-api — `GET /experience/model-providers` (R06 transport contract).
 *
 * The provider registry view for the ACTIVE profile: first-party,
 * BYOM-bound, and local rows with PER-TASK capability truth (declared |
 * not-declared + declared cost + privacy), and the honest LOCAL-MODEL
 * support report per task ("local model where supported" — support is
 * reported, never assumed; a task with no local provider says so).
 *
 * Anonymous answers the same registry truth with ZERO bound BYOM rows
 * (the anonymous user has no bindings — never a fake one).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502 — never a fake empty catalog.
 */

import { getApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  // Anonymous requests keep the frozen header law verbatim (absent bearer).
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("model-providers.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("model-providers.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const catalog = await boot.modelControls.readModelProviders(
        resolved.identity.profileId,
      );
      return Response.json(catalog);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const catalog = await boot.modelControls.readModelProviders(profileKey);
    return Response.json(catalog);
  } catch (thrown) {
    logDegradation("model-providers.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
