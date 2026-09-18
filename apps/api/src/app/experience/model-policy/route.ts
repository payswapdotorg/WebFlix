/**
 * @wfx/app-api — `GET`/`PUT /experience/model-policy` (R06 transport
 * contract).
 *
 * The ACTIVE profile's `ModelPolicy` (preferred provider + fallback chain
 * + privacy class + cost ceiling, per ModelTask) — the lead-ratified HTTP
 * mapping the runtime's `writeModelPolicy`/`readModelPolicy` operations
 * speak against:
 *
 * - `GET` — the stored policy for `?task=<ModelTask>`, or the HONEST `null`
 *   when unset (an anonymous/first-read profile never sees a fabricated
 *   default-as-if-configured — the R06 honesty law, carried verbatim from
 *   R05). Bearer session → the active profile; anonymous → the R02
 *   default-profile fallback (the x-wfx-user-id pseudo bucket).
 * - `PUT` — write the policy: the body is the validated
 *   `ModelPolicyCommandWire` (`task` + `fallbackProviders` + `privacy` +
 *   optional `preferredProvider` + optional `maxCostPerOperation`).
 *   Validation is TOTAL: the typed 400 names EVERY problem (the closed
 *   ModelTask + privacy vocabularies + non-empty fallback list + cost
 *   ceiling >= 0 when present). The write MERGES: stable policy id,
 *   preserved preferred provider/fallbacks, dials defaulting to the
 *   stored value (the same law as R05 policy).
 *
 * Degradation law (carried from R05): a LOUD boot failure answers the
 * typed 500; the degradation family (DB down) answers the typed 502 —
 * a model-policy read/write failure is an ERROR STATE (the adapters map
 * 5xx → `unavailable`), never a fake "no policy configured".
 */

import { isRecord, previewValue } from "@wfx/domain";

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
  modelPolicyCommandProblems,
  type ModelPolicyCommandWire,
} from "@api/host/model-controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The closed `task` query vocabulary (mirrors the frozen ModelTask union). */
const TASKS = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
] as const;

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  // Anonymous requests keep the frozen header law verbatim (absent bearer).
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const url = new URL(request.url);
  const task = url.searchParams.get("task");
  if (task === null || !TASKS.includes(task as (typeof TASKS)[number])) {
    return badRequest(
      `task: expected one of ${TASKS.join(" | ")}, got ${previewValue(task)}`,
    );
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
      const policy = await boot.modelControls.readModelPolicy(
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
        task as never,
      );
      return Response.json(policy); // the honest null when unset — never fabricated
    }
    // The anonymous transition — the persistence layer resolves the
    // default-profile fallback per store.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const policy = await boot.modelControls.readModelPolicy(
      anonymous.ctx.userId,
      profileKey,
      task as never,
    );
    return Response.json(policy);
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
    return badRequest("body: expected a ModelPolicyCommandWire object");
  }
  const command = body.value as unknown as ModelPolicyCommandWire;
  const problems = [...modelPolicyCommandProblems(command)];
  if (problems.length > 0) {
    return badRequest(problems.join("; "));
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
      const policy = await boot.modelControls.writeModelPolicy(
        resolved.identity.ctx.userId,
        resolved.identity.profileId,
        command,
      );
      return Response.json(policy);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const policy = await boot.modelControls.writeModelPolicy(
      anonymous.ctx.userId,
      profileKey,
      command,
    );
    return Response.json(policy);
  } catch (thrown) {
    logDegradation("model-policy.put", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
