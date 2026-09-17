/**
 * @wfx/app-api — `DELETE /experience/feedback/:id` (R05 transport contract).
 *
 * REVERSIBILITY — the undo law: every control that shapes recommendations
 * can be undone. Deleting a feedback control is a REAL delete (the row and
 * its composition effect vanish together — no soft-delete theater), so the
 * next candidate composition restores the pre-control behavior.
 *
 * Ownership law: the control must live under the REQUESTER's effective
 * profile (two profiles never see — or delete — each other's controls);
 * an unknown or foreign id answers the honest 404.
 *
 * THE EVENT-SINK LAW (R04, preserved): deleting feedback never touches
 * recorded viewing events — `event_outbox` stays immutable audit truth.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502.
 */

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
  if (typeof id !== "string" || !id.startsWith("wfxfb_") || id.length <= "wfxfb_".length) {
    return badRequest(
      `id: expected a feedback control ID (wfxfb_ prefix), got ${JSON.stringify(id)}`,
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
    logDegradation("feedback-delete.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("feedback-delete.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const deleted = await boot.controls.deleteFeedback(resolved.identity.profileId, id);
      if (deleted === null) {
        return Response.json(
          { error: "unknown-feedback", detail: `no feedback control '${id}' in this profile` },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, feedback: deleted });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const deleted = await boot.controls.deleteFeedback(profileKey, id);
    if (deleted === null) {
      return Response.json(
        { error: "unknown-feedback", detail: `no feedback control '${id}' in this profile` },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, feedback: deleted });
  } catch (thrown) {
    logDegradation("feedback-delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
