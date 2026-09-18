/**
 * @wfx/app-api — `POST /experience/transforms` (R06 transport contract).
 *
 * Submit one explicit transformation: validate the request, INSERT a
 * `queued` operation, run the fabric pipeline ASYNCHRONOUSLY (the
 * controller answers the queued record immediately; the pipeline's
 * outcome transitions the operation's state through
 * queued → running → succeeded | failed | cancelled — the EXPLICIT
 * state machine the R06 spec mandates, never implicit background magic).
 *
 * The body is the validated `TransformSubmitCommandWire`:
 *   { kind, input, options? }
 * where `kind` is one of the closed transform vocabulary, `input` is the
 * task's validated input shape, and `options` carries privacy class +
 * provider hints + cost ceiling + timeout.
 *
 * Permission enforcement: the fabric's `TransformationPermissions`
 * authority is consulted BEFORE the pipeline runs — a denial creates a
 * `failed` operation record (typed error_detail) and NEVER invokes the
 * fabric (J20's "Constrained" truth: a constrained platform answers the
 * typed constraint, never a fake success).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family (DB down) answers the typed 502.
 */

import { isRecord } from "@wfx/domain";

import { getApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import {
  transformSubmitCommandProblems,
  type TransformSubmitCommandWire,
} from "@api/host/model-controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  if (!isRecord(body.value)) {
    return badRequest("body: expected a TransformSubmitCommandWire object");
  }
  const command = body.value as unknown as TransformSubmitCommandWire;
  const problems = [...transformSubmitCommandProblems(command)];
  if (problems.length > 0) {
    return badRequest(problems.join("; "));
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("transforms.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("transforms.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const result = await boot.modelControls.submitTransform(
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
        command,
      );
      return Response.json(result, { status: result.ok ? 200 : 400 });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const result = await boot.modelControls.submitTransform(
      anonymous.ctx.userId,
      profileKey,
      command,
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (thrown) {
    logDegradation("transforms.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
