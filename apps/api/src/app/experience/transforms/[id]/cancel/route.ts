/**
 * @wfx/app-api — `POST /experience/transforms/:id/cancel` (R06 transport
 * contract).
 *
 * Cancel a queued/running transform operation (the explicit cancellation
 * path — never a silent drop). Succeeded/failed/cancelled operations are
 * terminal and reject (400). Returns the updated operation record on
 * success; 404 when the operation does not exist or is not owned by this
 * profile.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family (DB down) answers the typed 502.
 */

import { previewValue } from "@wfx/domain";

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

function validateOperationId(id: string): boolean {
  return typeof id === "string" && id.startsWith("wfxtx_") && id.length > "wfxtx_".length;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!validateOperationId(id)) {
    return badRequest(
      `id: expected a transform operation ID (wfxtx_ prefix), got ${previewValue(id)}`,
    );
  }

  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("transforms.cancel.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transforms.cancel.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const result = await boot.modelControls.cancelTransform(
        id,
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
      );
      if (!result.ok) {
        const status = result.reason === "not-found" ? 404 : 400;
        return Response.json({ error: result.reason, detail: result.detail }, { status });
      }
      return Response.json(result.operation);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const result = await boot.modelControls.cancelTransform(
      id,
      anonymous.ctx.userId,
      profileKey,
    );
    if (!result.ok) {
      const status = result.reason === "not-found" ? 404 : 400;
      return Response.json({ error: result.reason, detail: result.detail }, { status });
    }
    return Response.json(result.operation);
  } catch (thrown) {
    logDegradation("transforms.cancel", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
