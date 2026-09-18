/**
 * @wfx/app-api — `GET`/`PUT /experience/model-policy` (R06 transport
 * contract).
 *
 * The ACTIVE profile's model policy for ONE task (the frozen `ModelPolicy`
 * is per-task: `?task=` selects it). Bearer session → the active profile;
 * anonymous → the R02 default-profile fallback (the x-wfx-user-id pseudo
 * bucket).
 *
 * - `GET` — the HONEST view: the stored policy or `null` when unset (an
 *   anonymous/first-read profile never sees a fabricated
 *   default-as-if-configured — the R05 honesty law, applied to model
 *   policy), ALONGSIDE the fail-closed DEFAULTS visibly labeled as
 *   defaults (`defaults.source: "default"`) and the per-task capability
 *   truth of every provider (local availability included — the "see
 *   actual capabilities" law applied to models).
 * - `PUT` — write the policy: the body is the frozen `ModelPolicy` shape,
 *   validated against the FROZEN contract (privacy class vocabulary,
 *   non-empty fallback list, cost ceiling >= 0 when present). The typed
 *   400 names EVERY problem; the write is profile-scoped.
 *
 * Degradation law (the R05 policy-route law, verbatim): a LOUD boot
 * failure answers the typed 500; the degradation family answers the typed
 * 502 — a controls read/write failure is an ERROR STATE, never a fake
 * "no policy configured".
 */

import { isRecord, type ModelTask } from "@wfx/domain";
import { isModelTask, MODEL_TASKS } from "@wfx/model-fabric";

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

/** Read the `?task=` query parameter (typed 400 when absent/invalid). */
function readTaskQuery(
  request: Request,
): { ok: true; task: ModelTask } | { ok: false; detail: string } {
  const url = new URL(request.url);
  const task = url.searchParams.get("task");
  if (task === null || task.length === 0) {
    return {
      ok: false,
      detail: `task: the model policy is per-task — pass ?task= (${MODEL_TASKS.join(" | ")})`,
    };
  }
  if (!isModelTask(task)) {
    return {
      ok: false,
      detail: `task: expected one of ${MODEL_TASKS.join(" | ")}, got ${JSON.stringify(task)}`,
    };
  }
  return { ok: true, task };
}

export async function GET(request: Request): Promise<Response> {
  const taskQuery = readTaskQuery(request);
  if (!taskQuery.ok) return badRequest(taskQuery.detail);

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
    logDegradation("model-policy.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("model-policy.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const view = await boot.modelControls.readModelPolicy(
        resolved.identity.profileId,
        taskQuery.task,
      );
      return Response.json(view); // the honest null policy — never fabricated
    }
    // The anonymous transition — the persistence layer resolves the
    // default-profile fallback per store.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const view = await boot.modelControls.readModelPolicy(profileKey, taskQuery.task);
    return Response.json(view);
  } catch (thrown) {
    logDegradation("model-policy.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  if (!isRecord(body.value)) {
    return badRequest("body: expected a ModelPolicy object");
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("model-policy.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("model-policy.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const written = await boot.modelControls.writeModelPolicy(
        resolved.identity.profileId,
        body.value,
      );
      if (!written.ok) {
        // Typed 400 naming EVERY problem (the total-validation channel).
        return badRequest(written.problems.join("; "));
      }
      return Response.json(written.policy);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const written = await boot.modelControls.writeModelPolicy(profileKey, body.value);
    if (!written.ok) {
      return badRequest(written.problems.join("; "));
    }
    return Response.json(written.policy);
  } catch (thrown) {
    logDegradation("model-policy.put", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
