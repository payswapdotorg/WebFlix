/**
 * @wfx/app-api — `DELETE /experience/history/:itemId` (R04 transport contract).
 *
 * Removal: the item leaves the history READ MODEL (and Continue Watching) while
 * the underlying events REMAIN RECORDED (audit truth — the event_outbox is
 * NEVER touched). A re-watch (a new watch-state event arriving through the
 * relay) DELETES the removal row — the item re-materializes in history.
 *
 * Identity law: Bearer session → profile-scoped removal; anonymous → the
 * pre-R02 anonymous transition (the persistence layer resolves the default-
 * profile fallback per store). A presented-but-malformed Authorization is
 * a 401. The `itemId` path parameter must be a canonical `wfxitm_…` id.
 *
 * Degradation law: a LOUD boot failure answers a typed 500; the degradation
 * family answers the typed `failed` receipt — never a silent 5xx, never a
 * fake success. The idempotent law: removing an item that's already removed
 * is a 200 (the result state is the desired state — idempotent).
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
    logDegradation("history-delete.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("history-delete.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      await boot.history.removeFromHistory({
        userId: resolved.identity.ctx.userId,
        itemId,
        profileId: resolved.identity.profileId,
      });
      return Response.json({ ok: true, itemId });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    // Anonymous: resolve the effective profile key (the legacy pseudo
    // bucket — no profile-scoped removal filtering, but the removal row
    // still records the user's intent for the projection filter).
    const profileKey = await boot.history.watchStore().effectiveProfileKey(anonymous.ctx.userId);
    const profileId = profileKey.startsWith("user:") ? undefined : profileKey;
    await boot.history.removeFromHistory({
      userId: anonymous.ctx.userId,
      itemId,
      ...(profileId !== undefined ? { profileId } : {}),
    });
    return Response.json({ ok: true, itemId });
  } catch (thrown) {
    logDegradation("history-delete", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
