/**
 * @wfx/app-api — `GET /experience/actions/sync-state` (R15 transport
 * contract; golden journey J10's readback surface).
 *
 * The caller's durable action-sync records with their HONEST states:
 * `pending` (recorded, sync pending — with the retry detail when one is
 * scheduled), `in-flight` (a dispatch attempt is executing), `delivered`
 * (provider-confirmed), `unsupported`, `failed` (terminal), `conflict`
 * (recorded here and at the source without external confirmation). These
 * are DIFFERENT states and the surface never conflates them —
 * WebFlix-confirmed (recorded) is not provider-confirmed (delivered).
 *
 * - Bearer session → the session user's records; anonymous → the
 *   `x-wfx-user-id` header identity (a request may not read another
 *   identity's records).
 * - Filters (all optional): `connectorId`, `action` (one of the frozen
 *   verbs), `externalRef`; `limit` bounds the read (default 25, max 100).
 * - The read nudges the bounded opportunistic sync lane (pending records
 *   with scheduled retries get their next attempt; the relay.ts pattern —
 *   never blocking the response).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502 (an ERROR STATE — the adapters
 * map 5xx → `unavailable`), never a fake empty record set.
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

import { getActionSync, scheduleOpportunisticSync, syncStateViewOf } from "../sync-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The closed action-verb filter vocabulary (mirror of the frozen union). */
const ACTION_VERBS: ReadonlySet<string> = new Set([
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
]);

export async function GET(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("actions.sync-state.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  // Optional filters (typed 400s for garbage — one answer naming problems).
  const problems: string[] = [];
  const url = new URL(request.url);
  const connectorIdParam = url.searchParams.get("connectorId");
  const actionParam = url.searchParams.get("action") ?? undefined;
  const externalRefParam = url.searchParams.get("externalRef");
  const connectorId = connectorIdParam === null || connectorIdParam.length === 0 ? undefined : connectorIdParam;
  const externalRef = externalRefParam === null || externalRefParam.length === 0 ? undefined : externalRefParam;
  let limit = 25;
  const limitRaw = url.searchParams.get("limit");
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      problems.push("limit: expected an integer in 1..100");
    } else {
      limit = parsed;
    }
  }
  if (actionParam !== undefined && !ACTION_VERBS.has(actionParam)) {
    problems.push(`action: expected one of ${[...ACTION_VERBS].join(" | ")}`);
  }
  if (problems.length > 0) return badRequest(problems.join("; "));

  try {
    let userId: string;
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("actions.sync-state.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      userId = resolved.identity.ctx.userId;
    } else {
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      userId = anonymous.ctx.userId;
    }

    const lane = getActionSync(boot);
    const records = await lane.outbox.syncStatesForUser(userId, {
      ...(connectorId !== undefined && connectorId.length > 0 ? { connectorId } : {}),
      ...(actionParam !== undefined ? { actionType: actionParam as "like" } : {}),
      ...(externalRef !== undefined && externalRef.length > 0 ? { externalRef } : {}),
      limit,
    });
    // The bounded opportunistic lane (fire-and-forget; never blocks).
    scheduleOpportunisticSync(boot);
    return Response.json(records.map(syncStateViewOf));
  } catch (thrown) {
    logDegradation("actions.sync-state.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
