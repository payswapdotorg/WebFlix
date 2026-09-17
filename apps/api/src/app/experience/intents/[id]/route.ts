/**
 * @wfx/app-api — `DELETE /experience/intents/:id` (R05 transport contract).
 *
 * REVERSIBILITY (the undo law): every control that shapes recommendations
 * can be undone. Removing an explicit intent is as real as recording it —
 * the row leaves the store (no soft-delete theater), and the next
 * `GET /experience/intents` no longer carries it.
 *
 * PROFILE ISOLATION: the id must belong to the caller's effective profile —
 * a miss answers 404 (never a leak of whether the id exists elsewhere).
 *
 * Identity law: the R02 pattern (Bearer session → the active profile;
 * anonymous → the header law + the effective-profile fallback). A
 * presented-but-malformed Authorization is a 401.
 */

import { isIntentId } from "@wfx/domain";

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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const { id } = await context.params;
  if (typeof id !== "string" || !isIntentId(id)) {
    return badRequest("id: expected a canonical intent id (wfxint_ + 26-char ULID body)");
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intents.delete.boot", thrown);
    return Response.json(
      { error: "intent-delete-unavailable", detail: "the intent store is unavailable right now" },
      { status: 503 },
    );
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.delete.session", resolved.detail);
          return Response.json(
            { error: "intent-delete-unavailable", detail: resolved.detail },
            { status: 503 },
          );
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const removed = await boot.recommendation.deleteIntent(
        resolved.identity.profileId,
        id,
      );
      if (!removed) {
        return Response.json(
          { error: "unknown-intent", detail: `no intent '${id}' in the active profile` },
          { status: 404 },
        );
      }
      return Response.json({ ok: true });
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const removed = await boot.recommendation.deleteIntent(profileKey, id);
    if (!removed) {
      return Response.json(
        { error: "unknown-intent", detail: `no intent '${id}' in the active profile` },
        { status: 404 },
      );
    }
    return Response.json({ ok: true });
  } catch (thrown) {
    logDegradation("intents.delete", thrown);
    return Response.json(
      { error: "intent-delete-unavailable", detail: "the intent store is unavailable right now" },
      { status: 503 },
    );
  }
}
