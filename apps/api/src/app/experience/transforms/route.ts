/**
 * @wfx/app-api — `POST`/`GET /experience/transforms` (R06 transport
 * contract).
 *
 * EXPLICIT AI media transformations (the architecture's law: explicit user
 * actions with progress and results — never implicit background magic).
 *
 * - `POST` — start ONE transformation: the body is
 *   `{ kind, input, timeoutMs? }`. The routing directive is resolved from
 *   the STORED model policy for the kind's fabric task (BYOM replacement
 *   applied) — a transform never bypasses the user's privacy/cost
 *   constraints. Validation and PERMISSION failures answer BEFORE any
 *   operation record exists:
 *   - 400 `invalid-request` — malformed command or task input (field-path
 *     problems, every one named);
 *   - 409 `permission-denied` — the J20 constrained truth: the media's
 *     provenance denies this transformation (unauthorized source, DRM, or
 *     the task's license flag); a constrained platform answers the typed
 *     constraint, NEVER a fake success.
 *   The 202 answer carries the operation record (state `queued` — or any
 *   later state the background runner already reached; the record tells
 *   the truth).
 * - `GET` — the profile's operations, newest first (the explicit history
 *   of AI actions taken on this profile).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502.
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
    return badRequest("body: expected { kind, input }");
  }
  const command = body.value as { kind?: unknown; input?: unknown; timeoutMs?: unknown };

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
      return submitAndAnswer(boot, resolved.identity.profileId, command);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    return submitAndAnswer(boot, profileKey, command);
  } catch (thrown) {
    logDegradation("transforms.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

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
      const operations = await boot.modelControls.listTransforms(
        resolved.identity.profileId,
      );
      return Response.json(operations);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const operations = await boot.modelControls.listTransforms(profileKey);
    return Response.json(operations);
  } catch (thrown) {
    logDegradation("transforms.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

/** Submit through the host and map the typed outcome to its HTTP answer. */
async function submitAndAnswer(
  boot: Awaited<ReturnType<typeof getApiBoot>>,
  profileKey: string,
  command: { kind?: unknown; input?: unknown; timeoutMs?: unknown },
): Promise<Response> {
  const submitted = await boot.modelControls.submitTransform(profileKey, {
    kind: command.kind as string,
    input: command.input,
    ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs as number } : {}),
  } as never);
  if (!submitted.ok) {
    const failure = submitted.failure;
    if (failure.kind === "validation") {
      return badRequest(
        failure.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; "),
      );
    }
    if (failure.kind === "permission") {
      // The J20 constrained truth — the typed constraint, never fake success.
      return Response.json(
        { error: "permission-denied", detail: failure.reason },
        { status: 409 },
      );
    }
    return Response.json({ ok: false, detail: failure.detail }, { status: 502 });
  }
  return Response.json(submitted.operation, { status: 202 });
}
