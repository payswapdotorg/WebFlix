/**
 * @wfx/app-api — `GET`/`PUT /experience/policy` (R05 transport contract).
 *
 * The ACTIVE profile's `RecommendationPolicy` (attention mode + dials) —
 * the lead-ratified HTTP mapping BOTH adapters already implement
 * (`GET+PUT /experience/policy`; the web adapter's
 * `isUsableRecommendationPolicy` guard IS the wire shape this route must
 * answer):
 *
 * - `GET` — the stored policy, or the HONEST `null` when unset (an
 *   anonymous/first-read profile never sees a fabricated
 *   default-as-if-configured — the R05 honesty law). Bearer session → the
 *   active profile; anonymous → the R02 default-profile fallback (the
 *   x-wfx-user-id pseudo bucket), so the anonymous transition keeps
 *   working exactly as before.
 * - `PUT` — write the policy: the body is the frozen
 *   `RecommendationPolicyCommand` (`attentionMode` + optional
 *   exploration/novelty/socialInfluence dials). Validation is TOTAL: the
 *   typed 400 names EVERY problem (the closed `ATTENTION_MODES`
 *   vocabulary + dial ranges [0,1]); a malformed Authorization answers the
 *   typed 401. The write MERGES: stable policy id, preserved objectives,
 *   dials defaulting to the stored value, else the balanced baseline.
 *
 * Degradation law (the honest-failure refinement of the R02 mapping): a
 * LOUD boot failure answers the typed 500; the degradation family (DB
 * down) answers the typed 502 — a controls read/write failure is an ERROR
 * STATE (the adapters map 5xx → `unavailable`), never a fake
 * "no policy configured" (a fake null would misrepresent the user's
 * configuration during an outage).
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
  policyCommandProblems,
  type RecommendationPolicyCommandWire,
} from "@api/host/controls";

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
    logDegradation("policy.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("policy.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const policy = await boot.controls.readPolicy(resolved.identity.profileId);
      return Response.json(policy); // the honest null when unset — never fabricated
    }
    // The anonymous transition — the persistence layer resolves the
    // default-profile fallback per store.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const policy = await boot.controls.readPolicy(profileKey);
    return Response.json(policy);
  } catch (thrown) {
    logDegradation("policy.get", thrown);
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
    return badRequest("body: expected a RecommendationPolicyCommand object");
  }
  const command = body.value as unknown as RecommendationPolicyCommandWire;
  const problems = [...policyCommandProblems(command)];
  if (problems.length > 0) {
    return badRequest(problems.join("; "));
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("policy.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("policy.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const policy = await boot.controls.writePolicy(
        resolved.identity.profileId,
        resolved.identity.ctx.userId,
        command,
      );
      return Response.json(policy);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const policy = await boot.controls.writePolicy(
      profileKey,
      anonymous.ctx.userId,
      command,
    );
    return Response.json(policy);
  } catch (thrown) {
    logDegradation("policy.put", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
