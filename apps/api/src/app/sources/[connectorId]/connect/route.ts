/**
 * @wfx/app-api — `POST /sources/:connectorId/connect` (R03).
 *
 * Starts the auth flow for one source (a Bearer session is REQUIRED — the
 * credential attaches to the account):
 *
 * - `oauth` connectors → `{ flowKind: "oauth", authorizationUrl, state,
 *   expiresAt }` — the provider's documented authorization URL (the
 *   connector's own builder, never an invented endpoint) plus the opaque
 *   state; the pending authorization (user, connector, flow, expiry) is
 *   stored SERVER-SIDE, never in URLs. The flow continues via
 *   `GET /sources/callback/:state`.
 * - `device` connectors → the device-code instructions (the verification
 *   URL + poll cadence the flow descriptor carries).
 * - `local` connectors → connect DIRECTLY with the body's `{ token }`
 *   (sealed AES-256-GCM at rest); no handshake.
 * - `none` connectors → connect directly (no credential exists; the source
 *   is always usable).
 *
 * Typed answers: 404 unknown-connector; 503 flow-missing (the operator did
 * not provision the oauth client wiring); 400 invalid bodies (a local
 * connect without a token, garbage JSON); 401 anonymous/malformed bearer;
 * 500 loud boot failures; 502 the degradation family.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
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

  // A session is REQUIRED: the credential attaches to the account.
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  if (bearer.kind === "absent") {
    return unauthorized(
      "authorization: a bearer session token is required to connect a source (credentials attach to an account)",
    );
  }

  // The body is optional (local flows carry { token }; the rest carry none).
  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  const token =
    body.value !== null && typeof body.value === "object" && "token" in body.value
      ? (body.value as { token?: unknown }).token
      : undefined;
  if (token !== undefined && (typeof token !== "string" || token.length === 0)) {
    return badRequest("token: expected a non-empty string when present");
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.connect.boot", thrown);
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
        logDegradation("sources.connect.session", resolved.detail);
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

    const outcome = await boot.sources.connect(resolved.identity.user.id, connectorId, {
      ...(token !== undefined ? { token } : {}),
    });
    if (!outcome.ok) return sourceFailureResponse(outcome.error);
    return Response.json(outcome.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.connect", thrown);
    return Response.json(
      { error: "source-store-unavailable", detail: "the connect flow failed (degraded)" },
      { status: 502 },
    );
  }
}
