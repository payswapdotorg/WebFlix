/**
 * @wfx/app-api — `GET /sources/callback/:state` (R03 — the OAuth redirect).
 *
 * The documented OAuth redirect target: the provider sends the user back
 * with `?code=…&state=…` (or `?error=…` when they denied consent). NO
 * identity headers are required — the redirect arrives from the PROVIDER's
 * side; the pending authorization (persisted server-side at connect time)
 * binds the state token to its user and connector.
 *
 * - With `code`: load the pending by state (typed 404 unknown / 410
 *   expired), exchange the code through the connector's DOCUMENTED token
 *   endpoint + transport, seal the credential (AES-256-GCM) in the account
 *   store (upsert — the account row is preserved across reauthorizations),
 *   consume the pending, and answer the signedIn truth. The authorization
 *   code travels ONLY in the provider's redirect + the outbound exchange
 *   call — never logged, never persisted.
 * - With `error`: abandon the pending (consumed) and answer the typed 400
 *   naming the provider's error — never a fabricated success.
 *
 * The `state` path segment is the opaque token connect minted — it is NOT
 * identity (identity never rides in URLs; the pending holds it
 * server-side).
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
} from "@api/host/http";
import { sourceFailureResponse } from "@api/host/sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ state: string }> },
): Promise<Response> {
  const { state } = await context.params;
  if (typeof state !== "string" || state.trim().length === 0) {
    return badRequest("state: expected the callback's opaque state token");
  }

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.callback.boot", thrown);
    return Response.json(
      {
        error: "source-store-unavailable",
        detail: "the service could not reach its persistence layer right now",
      },
      { status: 502 },
    );
  }

  try {
    // The provider redirected back with an error (e.g. access_denied): the
    // pending is consumed and the denial is answered honestly.
    if (providerError !== null) {
      const abandoned = await boot.sources.abandonPending(state, providerError);
      if (!abandoned.ok) return sourceFailureResponse(abandoned.error);
      return Response.json(
        {
          error: "provider-denied",
          detail: `the provider redirected back with error '${providerError}' — the connection was not completed`,
          connectorId: abandoned.value.connectorId,
        },
        { status: 400 },
      );
    }

    if (code === null || code.length === 0) {
      return badRequest(
        "code: the callback carries neither an authorization code nor a provider error — nothing to complete",
      );
    }

    const outcome = await boot.sources.completeOAuthCallback(state, code);
    if (!outcome.ok) return sourceFailureResponse(outcome.error);
    return Response.json(outcome.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.callback", thrown);
    return Response.json(
      { error: "source-store-unavailable", detail: "the callback could not complete (degraded)" },
      { status: 502 },
    );
  }
}
