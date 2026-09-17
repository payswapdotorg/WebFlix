/**
 * @wfx/app-api — `POST /experience/history/exclusions` (R04 transport contract).
 *
 * Exclusion: the item never appears in history-derived surfaces (Continue
 * Watching, recommendations' already-watched signals) while the underlying
 * events STAY RECORDED (audit truth — the event_outbox is NEVER touched).
 * Unlike a REMOVAL, an exclusion PERSISTS across re-watches — the user's
 * explicit choice stays until removed (`DELETE /experience/history/exclusions/:itemId`).
 *
 * Body: `{ itemId: string }` (the canonical `wfxitm_…` id).
 *
 * Identity law: Bearer session → profile-scoped exclusion; anonymous → the
 * pre-R02 anonymous transition. The idempotent law: excluding an item
 * that's already excluded is a 200 (the result state is the desired state).
 *
 * Degradation law: a LOUD boot failure answers a typed 500; the degradation
 * family answers the typed `failed` receipt.
 */

import { isEntertainmentItemId, isRecord } from "@wfx/domain";

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

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  if (!isRecord(body.value) || typeof body.value.itemId !== "string") {
    return badRequest("body: expected { itemId: string }");
  }
  const itemId = body.value.itemId;
  if (!isEntertainmentItemId(itemId)) {
    return badRequest(
      `itemId: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${JSON.stringify(itemId)}`,
    );
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("history-exclude.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("history-exclude.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      await boot.history.excludeFromHistory({
        userId: resolved.identity.ctx.userId,
        itemId,
        profileId: resolved.identity.profileId,
      });
      return Response.json({ ok: true, itemId });
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.history.watchStore().effectiveProfileKey(anonymous.ctx.userId);
    const profileId = profileKey.startsWith("user:") ? undefined : profileKey;
    await boot.history.excludeFromHistory({
      userId: anonymous.ctx.userId,
      itemId,
      ...(profileId !== undefined ? { profileId } : {}),
    });
    return Response.json({ ok: true, itemId });
  } catch (thrown) {
    logDegradation("history-exclude", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
