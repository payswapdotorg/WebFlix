/**
 * @wfx/app-api — `POST /sources/:connectorId/reauthorize` (R03).
 *
 * Re-runs the auth flow for an EXPIRED/FAILED (or simply stale) account —
 * the "reconnect/reauthorize" user ability. The account row is PRESERVED:
 * completion upserts the credential in place (the store's one-row-per-
 * (user, connector) law keeps the account id stable).
 *
 * - `oauth` → a fresh authorization URL + state (the old pending is
 *   superseded server-side);
 * - `local` → the body's `{ token }` replaces the sealed credential
 *   directly;
 * - `none` → the honest no-op (nothing to reauthorize).
 *
 * Typed answers: 404 unknown-connector; 404 no-account (nothing to
 * reauthorize — connect first); the rest exactly the connect mapping.
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

  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  if (bearer.kind === "absent") {
    return unauthorized(
      "authorization: a bearer session token is required to reauthorize a source",
    );
  }

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
    logDegradation("sources.reauthorize.boot", thrown);
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
        logDegradation("sources.reauthorize.session", resolved.detail);
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

    const outcome = await boot.sources.reauthorize(resolved.identity.user.id, connectorId, {
      ...(token !== undefined ? { token } : {}),
    });
    if (!outcome.ok) return sourceFailureResponse(outcome.error);
    return Response.json(outcome.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.reauthorize", thrown);
    return Response.json(
      { error: "source-store-unavailable", detail: "the reauthorize flow failed (degraded)" },
      { status: 502 },
    );
  }
}
