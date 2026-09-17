/**
 * @wfx/app-api — `GET /sources/callback/:state` (R03 — source management).
 *
 * The documented OAuth redirect route: the PROVIDER redirects the user's
 * browser here with `?code=…&state=…` (or `?error=…` for a denial). The
 * `:state` path segment is the host-minted CSRF token the connect endpoint
 * issued — it keys the SERVER-SIDE pending authorization (the pending
 * record itself never appears in a URL; the state token is the OAuth
 * contract's own binding).
 *
 * NO BEARER REQUIRED, by design: the callback arrives as a browser redirect
 * from the provider, not an API call — the state token IS the binding (the
 * pending record carries the userId). The completion:
 *
 * 1. resolves the pending by state (404 unknown / 410 expired — dead is
 *    dead);
 * 2. exchanges the code through the connector's DOCUMENTED token endpoint
 *    (its typed transport — the exchange seam is injected at boot; tests
 *    stub it; no invented endpoints);
 * 3. seals the token set in the envelope-encrypted account store (the
 *    secret exists only inside this path — never logged, never in a
 *    response body);
 * 4. marks the account signedIn and answers the completion view
 *    (`{ connectorId, authState, accountId, authorizedAt }`).
 *
 * A provider denial (`?error=access_denied`) consumes the pending and
 * answers the typed 403. A transport-shaped exchange failure keeps the
 * pending (the callback is retryable while the code lives) and answers
 * 502; a definitive rejection (invalid_grant, …) consumes it and answers
 * 409.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  sourceFailureResponse,
  upstreamFailure,
} from "@api/host/http";
import { describeThrown } from "@wfx/experience";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bounds on the provider's redirect parameters (garbage stays bounded). */
const MAX_PARAM_LENGTH = 2048;

function readParam(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  if (raw.length === 0) return undefined;
  if (raw.length > MAX_PARAM_LENGTH) {
    throw new ParamTooLongError(name);
  }
  return raw;
}

class ParamTooLongError extends Error {
  constructor(name: string) {
    super(`the provider's '${name}' redirect parameter exceeds ${MAX_PARAM_LENGTH} characters`);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ state: string }> },
): Promise<Response> {
  const { state } = await context.params;
  if (typeof state !== "string" || state.trim().length === 0 || state.length > 128) {
    return Response.json(
      { error: "invalid-request", detail: "state: expected the CSRF token path segment the connect endpoint issued" },
      { status: 400 },
    );
  }

  let code: string | undefined;
  let error: string | undefined;
  let errorDescription: string | undefined;
  try {
    const url = new URL(request.url);
    code = readParam(url, "code");
    error = readParam(url, "error");
    errorDescription = readParam(url, "error_description");
  } catch (thrown) {
    if (thrown instanceof ParamTooLongError) {
      return Response.json({ error: "invalid-request", detail: thrown.message }, { status: 400 });
    }
    return Response.json({ error: "invalid-request", detail: "callback: the URL is malformed" }, { status: 400 });
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.callback.boot", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }

  try {
    const answer = await boot.sourceManagement.completeCallback(state, {
      ...(code !== undefined ? { code } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(errorDescription !== undefined ? { errorDescription } : {}),
    });
    if (!answer.ok) return sourceFailureResponse(answer.failure);
    return Response.json(answer.value);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.callback", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }
}
