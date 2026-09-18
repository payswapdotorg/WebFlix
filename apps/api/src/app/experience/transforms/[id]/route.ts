/**
 * @wfx/app-api — `GET`/`DELETE /experience/transforms/:id` (R06 transport
 * contract).
 *
 * - `GET` — one operation's current state + the append-only state history.
 *   The history is honest audit truth (every transition recorded, never
 *   overwritten). The 404 is the honest miss (not owned by this profile,
 *   or never existed).
 * - `DELETE` — DELETE the result of a SUCCEEDED transform (the spec's
 *   "DELETE for result cleanup where applicable"). Transitions the
 *   operation to cancelled, clears the result_ref, appends the cleanup
 *   to history. Rejects (400) when the operation is not in the succeeded
 *   state — DELETE never silently overrides a terminal state.
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

export async function GET(
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
    logDegradation("transforms.get.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transforms.get.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const result = await boot.modelControls.readTransform(
        id,
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
      );
      if (!result.ok) {
        return Response.json(
          { error: "not-found", detail: `transform '${id}' not found` },
          { status: 404 },
        );
      }
      const history = await boot.modelControls.readTransformHistory(id);
      return Response.json({
        operation: result.operation,
        history: history.ok ? [...history.history] : [],
      });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const result = await boot.modelControls.readTransform(
      id,
      anonymous.ctx.userId,
      profileKey,
    );
    if (!result.ok) {
      return Response.json(
        { error: "not-found", detail: `transform '${id}' not found` },
        { status: 404 },
      );
    }
    const history = await boot.modelControls.readTransformHistory(id);
    return Response.json({
      operation: result.operation,
      history: history.ok ? [...history.history] : [],
    });
  } catch (thrown) {
    logDegradation("transforms.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

export async function DELETE(
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
    logDegradation("transforms.delete.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transforms.delete.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const result = await boot.modelControls.clearTransformResult(
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
    const result = await boot.modelControls.clearTransformResult(
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
    logDegradation("transforms.delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
