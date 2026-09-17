/**
 * @wfx/app-api — `GET`/`POST /experience/intents` (R05 transport contract).
 *
 * The ACTIVE PROFILE's intent set — the frozen `IntentRecord` shape the
 * runtime's `readIntents()`/`writeIntent()` ServerPort members (R02)
 * consume over the lead-ratified HTTP mapping, now REAL:
 *
 * - `GET` answers the ACTIVE intents — the R01 LIVE-EXPIRY law, server
 *   side: expired temporary intents are filtered at read time (they stay
 *   stored as audit truth). Heaviest first.
 * - `POST` submits one `UserIntentCommand` with the R01 SCOPE TRUTH
 *   enforced server-side: `temporary` REQUIRES a future ISO expiry; the
 *   one-objective-per-scope discipline is a deterministic update-in-place
 *   (the store's unique key keeps the canonical `wfxint_` id stable and
 *   never duplicates). Answers the stored record (201).
 *
 * Identity law (the R02 pattern): Bearer session → the session's ACTIVE
 * PROFILE; anonymous → the frozen `x-wfx-*` header law with the
 * default-profile fallback. A presented-but-malformed Authorization is a
 * 401. Typed 400s name every problem.
 *
 * Degradation law: reads degrade to the honest empty array (logged); a
 * lost intent write is NEVER a silent success (typed 503).
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
  type IntentCommandInput,
  type IntentWireRecord,
} from "@api/host/recommendation-controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intents.boot", thrown);
    return Response.json([] as IntentWireRecord[]); // degrade law: read failure ⇒ empty
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.session", resolved.detail);
          return Response.json([] as IntentWireRecord[]); // degrade law
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const intents = await boot.recommendation.readActiveIntents(resolved.identity.profileId);
      return Response.json([...intents]);
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const intents = await boot.recommendation.readActiveIntents(profileKey);
    return Response.json([...intents]);
  } catch (thrown) {
    logDegradation("intents", thrown);
    return Response.json([] as IntentWireRecord[]); // degrade law
  }
}

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  const command = body.value as IntentCommandInput;
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    return badRequest("intent: expected a UserIntentCommand object");
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intents.boot", thrown);
    return Response.json(
      { error: "intent-write-unavailable", detail: "the intent store is unavailable right now" },
      { status: 503 },
    );
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.session", resolved.detail);
          return Response.json(
            { error: "intent-write-unavailable", detail: resolved.detail },
            { status: 503 },
          );
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const record = await boot.recommendation.submitIntent({
        profileId: resolved.identity.profileId,
        userId: resolved.identity.ctx.userId,
        command,
      });
      return Response.json(record, { status: 201 });
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const record = await boot.recommendation.submitIntent({
      profileId: profileKey,
      userId: anonymous.ctx.userId,
      command,
    });
    return Response.json(record, { status: 201 });
  } catch (thrown) {
    if (thrown instanceof RecommendationControlsError) {
      return Response.json(
        { error: "invalid-request", detail: thrown.problems.join("; ") },
        { status: 400 },
      );
    }
    logDegradation("intents.write", thrown);
    return Response.json(
      { error: "intent-write-unavailable", detail: "the intent store is unavailable right now" },
      { status: 503 },
    );
  }
}
