/**
 * @wfx/app-api — `POST /experience/transforms/:id/cancel` (R06 transport
 * contract).
 *
 * The user's UNDO while work is in flight: legal from `queued` AND
 * `running`; a run that completes after the cancel DISCARDS its result
 * (cancelled is terminal). Terminal states answer the typed 409
 * invalid-state refusal — an operation that already finished is never
 * silently rewritten. Unknown/not-owned ids answer the honest 404.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502.
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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (typeof id !== "string" || id.length === 0) {
    return badRequest("id: expected a transform operation id in the path");
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
    logDegradation("transform-cancel.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transform-cancel.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      return cancelAndAnswer(boot, resolved.identity.profileId, id);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    return cancelAndAnswer(boot, profileKey, id);
  } catch (thrown) {
    logDegradation("transform-cancel.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

/** Cancel through the host and map the typed outcome to its HTTP answer. */
async function cancelAndAnswer(
  boot: Awaited<ReturnType<typeof getApiBoot>>,
  profileKey: string,
  id: string,
): Promise<Response> {
  const cancelled = await boot.modelControls.cancelTransform(profileKey, id);
  if (cancelled.ok) {
    return Response.json(cancelled.operation);
  }
  const failure = cancelled.failure;
  if (failure.kind === "not-found") {
    return Response.json(
      { error: "unknown-transform", detail: failure.detail },
      { status: 404 },
    );
  }
  return Response.json(
    {
      error: "invalid-state",
      detail: failure.detail,
      ...(failure.state !== undefined ? { state: failure.state } : {}),
    },
    { status: 409 },
  );
}
