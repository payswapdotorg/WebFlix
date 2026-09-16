/**
 * @wfx/app-api — `POST /experience/actions` (WFX-055A transport contract;
 * R02: profile scoping).
 *
 * Body: a `UserAction` JSON object → `ActionReceipt`.
 * Identity rides as headers (see `host/identity.ts`).
 *
 * R02 — THE SESSION UPGRADE (the anonymous transition preserved): with
 * `Authorization: Bearer wfxsess_…`, the action executes PROFILE-SCOPED to
 * the session's active profile (a `save` lands in THAT profile's library;
 * the action's event is attributed to it). Anonymous requests keep the
 * exact pre-R02 behavior (the default-profile fallback resolves inside the
 * persistence layer). A presented-but-malformed Authorization is a 401;
 * both channels present must agree.
 *
 * Typed 400s for garbage bodies (one answer naming every problem); a
 * well-formed but UNROUTABLE action (unknown connector id, undeclared
 * capability) is NOT garbage — it flows to the fan-out connector, which
 * answers the honest `failed`/`unsupported` receipt (HTTP 200: a failed
 * action is never a fabricated success and never a thrown crash).
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers
 * a typed 500; the degradation family (DB down) answers a `failed`
 * receipt whose `detail` names the failure — the exact shape the frozen
 * client's own transport-failure path produces.
 */

import type { ActionReceipt } from "@wfx/domain";
import { describeThrown, isUsableReceipt } from "@wfx/experience";

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  degradedReceiptOccurredAt,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import { parseUserAction } from "@api/host/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stamp a receipt from the booted clock (never a hidden wall clock). */
function receiptOccurredAt(boot: ApiBoot): string {
  return new Date(boot.ports.clock.now()).toISOString();
}

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  const parsed = parseUserAction(body.value);
  if (!parsed.ok) return badRequest(parsed.problems.join("; "));

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("actions.boot", thrown);
    return Response.json({
      status: "failed",
      detail: `service boot failed (${describeThrown(thrown)})`,
      occurredAt: degradedReceiptOccurredAt(),
    } satisfies ActionReceipt);
  }

  try {
    let receipt: ActionReceipt;
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("actions.session", resolved.detail);
          return Response.json({
            status: "failed",
            detail: `the session service is unavailable (${resolved.detail})`,
            occurredAt: receiptOccurredAt(boot),
          } satisfies ActionReceipt);
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      receipt = await boot.connector.executeActionForProfile(
        resolved.identity.ctx,
        resolved.identity.profileId,
        parsed.value,
      );
    } else {
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      receipt = await boot.connector.executeAction(anonymous.ctx, parsed.value);
    }

    if (isUsableReceipt(receipt)) return Response.json(receipt);
    logDegradation("actions", "the connector answered a malformed ActionReceipt");
    return Response.json({
      status: "failed",
      detail: "the connector answered a malformed ActionReceipt",
      occurredAt: receiptOccurredAt(boot),
    } satisfies ActionReceipt);
  } catch (thrown) {
    logDegradation("actions", thrown);
    return Response.json({
      status: "failed",
      detail: describeThrown(thrown),
      occurredAt: receiptOccurredAt(boot),
    } satisfies ActionReceipt);
  }
}
