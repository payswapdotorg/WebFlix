/**
 * @wfx/app-api — `POST /sources/:connectorId/disconnect` (R03 — source
 * management).
 *
 * Requires `Authorization: Bearer wfxsess_…`. Deletes the connected
 * account: the sealed credential envelope row AND any pending handshake for
 * the (user, connector) go together (the store's delete discipline — the
 * ciphertext/iv/authTag row is removed, never left orphaned). The derived
 * auth state returns to signedOut.
 *
 * IDEMPOTENT: disconnecting a source with no connection is a SUCCESS
 * (`{ connectorId, authState: "signedOut", hadAccount: false }`) — the user
 * ability lands in one tap, twice. Typed 404s for unknown connectors; 401
 * for the session law; 500 loud; 502 degraded.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  sourceFailureResponse,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { describeThrown } from "@wfx/experience";
import { resolveScopedIdentity } from "@api/host/session-identity";

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

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.disconnect.boot", thrown);
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

    const answer = await boot.sourceManagement.disconnect(
      resolved.identity.user.id,
      connectorId,
    );
    if (!answer.ok) return sourceFailureResponse(answer.failure);
    return Response.json(answer.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.disconnect", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }
}
