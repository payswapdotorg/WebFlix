/**
 * @wfx/app-api — `DELETE /experience/history/exclusions/:itemId` (R04).
 *
 * Removes an exclusion (re-include the item in history-derived surfaces).
 * The item's recorded events STAY RECORDED throughout (audit truth — the
 * event_outbox is NEVER touched); only the exclusion projection row is
 * removed. Returns 200 with `{ ok, removed }` (removed=false is the
 * idempotent case — the exclusion was already absent).
 *
 * Identity law: Bearer session → profile-scoped; anonymous → the pre-R02
 * anonymous transition. The `itemId` path parameter must be `wfxitm_…`.
 */

import { isEntertainmentItemId } from "@wfx/domain";

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
  context: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const { itemId } = await context.params;
  if (!isEntertainmentItemId(itemId)) {
    return badRequest(
      `itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${JSON.stringify(itemId)}`,
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
    logDegradation("history-exclusion-delete.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("history-exclusion-delete.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const removed = await boot.history.removeExclusion(resolved.identity.profileId, itemId);
      return Response.json({ ok: true, itemId, removed });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.history.watchStore().effectiveProfileKey(anonymous.ctx.userId);
    // The legacy pseudo bucket ('user:<userId>') has no profile-scoped
    // exclusion rows — anonymous exclusion-removal is a no-op answer.
    if (profileKey.startsWith("user:")) {
      return Response.json({ ok: true, itemId, removed: false });
    }
    const removed = await boot.history.removeExclusion(profileKey, itemId);
    return Response.json({ ok: true, itemId, removed });
  } catch (thrown) {
    logDegradation("history-exclusion-delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
