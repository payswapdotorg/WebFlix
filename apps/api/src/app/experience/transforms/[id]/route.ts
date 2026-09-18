/**
 * @wfx/app-api — `GET`/`DELETE /experience/transforms/:id` (R06 transport
 * contract).
 *
 * - `GET` — one operation's CURRENT TRUTH: the explicit state
 *   (`queued | running | succeeded | failed | cancelled`), the append-only
 *   state history, progress where the fabric reported it, the error detail
 *   on failure, and the RESULT REFERENCE on success. Ownership law: the
 *   operation must live under the REQUESTER's effective profile (two
 *   profiles never see each's other's operations — the honest 404).
 * - `DELETE` — RESULT CLEANUP: clears the result material (payload +
 *   reference + progress) from a `succeeded` operation, KEEPING the record
 *   + state history (audit truth — the append-only history is never
 *   rewritten). 404 when the operation is unknown; 409 when there is no
 *   result to clean (not succeeded, or already cleaned).
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

export async function GET(
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
    logDegradation("transform-get.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transform-get.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const operation = await boot.modelControls.readTransform(
        resolved.identity.profileId,
        id,
      );
      if (operation === null) {
        return Response.json(
          {
            error: "unknown-transform",
            detail: `no transform operation '${id}' in this profile`,
          },
          { status: 404 },
        );
      }
      return Response.json(operation);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const operation = await boot.modelControls.readTransform(profileKey, id);
    if (operation === null) {
      return Response.json(
        {
          error: "unknown-transform",
          detail: `no transform operation '${id}' in this profile`,
        },
        { status: 404 },
      );
    }
    return Response.json(operation);
  } catch (thrown) {
    logDegradation("transform-get.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

export async function DELETE(
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
    logDegradation("transform-delete.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transform-delete.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      return clearResultAndAnswer(boot, resolved.identity.profileId, id);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    return clearResultAndAnswer(boot, profileKey, id);
  } catch (thrown) {
    logDegradation("transform-delete.delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

/** Clear the result material and map the outcome to its typed HTTP answer. */
async function clearResultAndAnswer(
  boot: Awaited<ReturnType<typeof getApiBoot>>,
  profileKey: string,
  id: string,
): Promise<Response> {
  const operation = await boot.modelControls.readTransform(profileKey, id);
  if (operation === null) {
    return Response.json(
      { error: "unknown-transform", detail: `no transform operation '${id}' in this profile` },
      { status: 404 },
    );
  }
  const cleaned = await boot.modelControls.clearTransformResult(profileKey, id);
  if (!cleaned) {
    return Response.json(
      {
        error: "no-result",
        detail: `transform operation '${id}' has no result material to clean (state '${operation.state}')`,
      },
      { status: 409 },
    );
  }
  return Response.json({ ok: true, id });
}
