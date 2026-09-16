/**
 * @wfx/app-api — `POST /experience/actions` (WFX-055A transport contract).
 *
 * Body: a `UserAction` JSON object → `ActionReceipt`.
 * Identity rides as headers (see `host/identity.ts`).
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
} from "@api/host/http";
import { readConnectorContext } from "@api/host/identity";
import { parseUserAction } from "@api/host/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stamp a receipt from the booted clock (never a hidden wall clock). */
function receiptOccurredAt(boot: ApiBoot): string {
  return new Date(boot.ports.clock.now()).toISOString();
}

export async function POST(request: Request): Promise<Response> {
  const identity = readConnectorContext(request.headers);
  if (!identity.ok) return badRequest(identity.detail);

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
    const receipt = await boot.connector.executeAction(identity.ctx, parsed.value);
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
