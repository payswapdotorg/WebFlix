/**
 * @wfx/app-api — `GET`/`PUT /experience/policy` (R05 transport contract).
 *
 * The ACTIVE PROFILE's `RecommendationPolicy` — the frozen shape the
 * runtime's `readPolicy()`/`writePolicy()` ServerPort members (R02)
 * consume over the lead-ratified HTTP mapping, now REAL:
 *
 * - `GET` answers the stored policy, or `null` (JSON null, 200) when the
 *   profile never wrote one — the HONEST empty, never a fabricated
 *   default-as-if-configured (the runtime's default view is the client's).
 * - `PUT` writes the policy: the body is the frozen
 *   `RecommendationPolicyCommand` (attentionMode + exploration/novelty/
 *   socialInfluence dials), validated against the frozen `ATTENTION_MODES`
 *   vocabulary + the [0,1] dial ranges — typed 400s naming every problem.
 *   The stored policy's id and custom-mode objectives are preserved across
 *   updates. Answers the stored policy.
 *
 * Identity law (the R02 pattern): Bearer session → the session's ACTIVE
 * PROFILE; anonymous → the frozen `x-wfx-*` header law with the
 * default-profile fallback (the persistence layer resolves the effective
 * profile key). A presented-but-malformed Authorization is a 401.
 *
 * Degradation law (052 classify + WFX-003, the R04 precedent): a LOUD boot
 * failure answers a typed 500; the degradation family (DB down) answers
 * the honest empty for reads (`null` — logged, never a fake policy) and a
 * typed 503 for writes (a lost write is never a silent success).
 */

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
  RecommendationControlsError,
  type PolicyCommandInput,
} from "@api/host/recommendation-controls";

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
    return Response.json(null); // degrade law: read failure ⇒ the honest empty
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("policy.session", resolved.detail);
          return Response.json(null); // degrade law
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const policy = await boot.recommendation.readPolicy(resolved.identity.profileId);
      return Response.json(policy);
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const policy = await boot.recommendation.readPolicy(profileKey);
    return Response.json(policy);
  } catch (thrown) {
    logDegradation("policy", thrown);
    return Response.json(null); // degrade law: read failure ⇒ the honest empty
  }
}

export async function PUT(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  const command = body.value as PolicyCommandInput;
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    return badRequest("policy: expected a RecommendationPolicyCommand object");
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("policy.boot", thrown);
    return Response.json(
      { error: "policy-write-unavailable", detail: "the policy store is unavailable right now" },
      { status: 503 },
    );
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("policy.session", resolved.detail);
          return Response.json(
            { error: "policy-write-unavailable", detail: resolved.detail },
            { status: 503 },
          );
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const policy = await boot.recommendation.writePolicy({
        profileId: resolved.identity.profileId,
        userId: resolved.identity.ctx.userId,
        command,
      });
      return Response.json(policy);
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const policy = await boot.recommendation.writePolicy({
      profileId: profileKey,
      userId: anonymous.ctx.userId,
      command,
    });
    return Response.json(policy);
  } catch (thrown) {
    if (thrown instanceof RecommendationControlsError) {
      return Response.json(
        { error: "invalid-request", detail: thrown.problems.join("; ") },
        { status: 400 },
      );
    }
    logDegradation("policy.write", thrown);
    return Response.json(
      { error: "policy-write-unavailable", detail: "the policy store is unavailable right now" },
      { status: 503 },
    );
  }
}
