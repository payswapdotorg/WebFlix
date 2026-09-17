/**
 * @wfx/app-api — `POST /sources/:connectorId/connect` (R03 — source
 * management).
 *
 * Requires `Authorization: Bearer wfxsess_…` (connecting a source is an
 * ACCOUNT action — the anonymous transition has no sources to connect).
 *
 * Starts the connector's auth flow:
 * - `oauth` → `{ kind: "oauth", authorizationUrl, state, expiresAt }` — the
 *   caller (the web/desktop adapter UX) redirects the user; the flow
 *   completes at `GET /sources/callback/:state`. The pending authorization
 *   (state + expiry) is stored SERVER-SIDE; the state token is the only
 *   flow artifact that ever appears in a URL (the OAuth contract itself).
 * - `device` → `{ kind: "device", verificationUrl, pollIntervalSeconds,
 *   state, expiresAt }` — the device-code instructions.
 * - `local` → connects DIRECTLY: the optional body `{ credential }` is
 *   sealed (envelope-encrypted) and the account lands signedIn.
 * - `none` → connects directly with nothing to authorize (an honest no-op
 *   success — the source requires no authorization).
 *
 * Typed answers: 200 (the flow answer); 400 (garbage body / wrong-flow
 * credential); 401 (session law); 404 unknown-connector; 409 flow-missing
 * (this deployment has no wiring — never an invented URL); 500 loud; 502
 * degraded.
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
    // An EMPTY body is the oauth/device norm — readJsonBody rejects it, so
    // tolerate the empty case explicitly (only garbage JSON is a 400).
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
    logDegradation("sources.connect.boot", thrown);
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

    const answer = await boot.sourceManagement.beginConnect(
      resolved.identity.user.id,
      connectorId,
      parsed.value.credential,
    );
    if (!answer.ok) return sourceFailureResponse(answer.failure);
    return Response.json(answer.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.connect", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }
}
