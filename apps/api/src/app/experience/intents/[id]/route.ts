/**
 * @wfx/app-api — `DELETE /experience/intents/:id` (R05 transport contract).
 *
 * REVERSIBILITY — the undo law: every control that shapes recommendations
 * can be undone. Deleting an intent removes it from the profile's durable
 * intent set (a REAL delete — no soft-delete theater), so the next
 * composition no longer considers it.
 *
 * Ownership law: the intent must live under the REQUESTER's effective
 * profile (two profiles never see — or delete — each other's controls);
 * an unknown or foreign id answers the honest 404.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502.
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
  const { id } = await context.params;
  if (!isIntentId(id)) {
    return badRequest(
      `id: expected a canonical intent ID (wfxint_ prefix + 26-char Crockford Base32 ULID body), got ${JSON.stringify(id)}`,
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
    logDegradation("intent-delete.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intent-delete.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const deleted = await boot.controls.deleteIntent(resolved.identity.profileId, id);
      if (deleted === null) {
        return Response.json(
          { error: "unknown-intent", detail: `no intent '${id}' in this profile` },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, intent: deleted });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const deleted = await boot.controls.deleteIntent(profileKey, id);
    if (deleted === null) {
      return Response.json(
        { error: "unknown-intent", detail: `no intent '${id}' in this profile` },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, intent: deleted });
  } catch (thrown) {
    logDegradation("intent-delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
