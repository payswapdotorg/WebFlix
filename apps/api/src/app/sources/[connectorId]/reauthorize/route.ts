/**
 * @wfx/app-api — `POST /sources/:connectorId/reauthorize` (R03 — source
 * management).
 *
 * Requires `Authorization: Bearer wfxsess_…`. Re-runs the auth flow for an
 * EXISTING connection (the user ability "reconnect/reauthorize"): the
 * account row is PRESERVED — the completion upserts on (userId,
 * connectorId), keeping the account id + created_at stable while the fresh
 * authorization replaces the credential and refreshes authorized_at.
 *
 * The answer shapes are the connect shapes (oauth URL + state / device
 * instructions / local direct completion with `{ credential }`). Typed
 * answers: 200; 400 (garbage body / wrong-flow); 401; 404 unknown-connector
 * OR no-account (reauthorize is for existing connections — connect is the
 * fresh path); 409 flow-missing; 500 loud; 502 degraded.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  sourceFailureResponse,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { describeThrown } from "@wfx/experience";
import { resolveScopedIdentity } from "@api/host/session-identity";
import { parseSourceConnectBody } from "@api/host/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ connectorId: string }> },
): Promise<Response> {
  const { connectorId } = await context.params;
  if (typeof connectorId !== "string" || connectorId.trim().length === 0) {
    return Response.json(
      { error: "invalid-request", detail: "connector id: expected a non-empty path segment" },
      { status: 400 },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    const text = await request.text().catch(() => "\u0000nonempty-sentinel");
    if (text.trim().length !== 0) {
      return Response.json({ error: "invalid-request", detail: body.detail }, { status: 400 });
    }
  }
  const parsed = parseSourceConnectBody(body.ok ? body.value : undefined);
  if (!parsed.ok) {
    return Response.json({ error: "invalid-request", detail: parsed.problems.join("; ") }, { status: 400 });
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.reauthorize.boot", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        return upstreamFailure("sources-unavailable", resolved.detail);
      }
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized(
        "authorization: a bearer session token is required — source connections belong to an account",
      );
    }

    const answer = await boot.sourceManagement.beginReauthorize(
      resolved.identity.user.id,
      connectorId,
      parsed.value.credential,
    );
    if (!answer.ok) return sourceFailureResponse(answer.failure);
    return Response.json(answer.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.reauthorize", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }
}
