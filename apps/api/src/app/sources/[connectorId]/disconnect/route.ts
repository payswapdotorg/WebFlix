/**
 * @wfx/app-api — `POST /sources/:connectorId/disconnect` (R03).
 *
 * Disconnects one source: the account row is DELETED (the sealed credential
 * goes with it — the store's delete discipline), every live pending for
 * the pair is evicted, and the state is honestly `signedOut`.
 *
 * IDEMPOTENT: disconnecting an already-disconnected source is a SUCCESS
 * (`deletedAccount: false` — the honest "there was nothing to delete").
 *
 * Typed answers: 404 unknown-connector (never for a merely-absent account);
 * 401 anonymous/malformed bearer; 500 loud boot failures; 502 the
 * degradation family.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
} from "@api/host/http";
import { readBearerToken } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import { sourceFailureResponse } from "@api/host/sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ connectorId: string }> },
): Promise<Response> {
  const { connectorId } = await context.params;
  if (typeof connectorId !== "string" || connectorId.trim().length === 0) {
    return badRequest("connectorId: expected a connector id path segment");
  }

  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  if (bearer.kind === "absent") {
    return unauthorized(
      "authorization: a bearer session token is required to disconnect a source",
    );
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.disconnect.boot", thrown);
    return Response.json(
      {
        error: "source-store-unavailable",
        detail: "the service could not reach its persistence layer right now",
      },
      { status: 502 },
    );
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        logDegradation("sources.disconnect.session", resolved.detail);
        return Response.json(
          { error: "source-store-unavailable", detail: resolved.detail },
          { status: 502 },
        );
      }
      if (resolved.failure === "bad-request") return badRequest(resolved.detail);
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized("authorization: a bearer session token is required");
    }

    const outcome = await boot.sources.disconnect(resolved.identity.user.id, connectorId);
    if (!outcome.ok) return sourceFailureResponse(outcome.error);
    return Response.json(outcome.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.disconnect", thrown);
    return Response.json(
      { error: "source-store-unavailable", detail: "the disconnect failed (degraded)" },
      { status: 502 },
    );
  }
}
