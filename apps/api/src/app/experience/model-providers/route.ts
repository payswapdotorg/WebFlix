/**
 * @wfx/app-api — `GET /experience/model-providers` (R06 transport contract).
 *
 * The provider registry view: first-party (the WFX model, local, cost 0),
 * BYOM-configured (cloud, the binding's declared cost), and local (where
 * supported) with per-task capability truth — the "see actual capabilities"
 * law applied to models. BYOM bindings are listed as secret-free
 * projections ONLY (the response NEVER contains key material — the R06
 * privacy law). Anonymous sessions answer the FIRST-PARTY providers
 * honestly (the BYOM list is empty for anonymous — never a fake one).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family (DB down) answers the typed 502 (a provider read
 * failure is an ERROR STATE, never a fake empty list).
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
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
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
      const providers = await boot.modelControls.listModelProviders(
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
      );
      return Response.json([...providers]);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const providers = await boot.modelControls.listModelProviders(
      anonymous.ctx.userId,
      profileKey,
    );
    return Response.json([...providers]);
  } catch (thrown) {
    logDegradation("model-providers.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
