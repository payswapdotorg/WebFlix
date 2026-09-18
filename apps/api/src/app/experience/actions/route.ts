/**
 * @wfx/app-api — `POST /experience/actions` (WFX-055A transport contract;
 * R02 profile scoping; R15 external/social action synchronization).
 *
 * Body: a `UserAction` JSON object → `ActionReceipt`. Identity rides as
 * headers (see `host/identity.ts`); the OPTIONAL `x-wfx-action-request-token`
 * header is the caller's idempotency token — re-POSTing the SAME action
 * with the SAME token answers the EXISTING record's current truth (typed
 * duplicate; never double-executed). Without a token each POST is a fresh
 * action (a minted token).
 *
 * THE R15 LAW (local-first action truth — golden journey J10):
 * 1. RECORD FIRST: the action is recorded in the DURABLE ACTION OUTBOX in
 *    ONE transaction with its local audit row (WebFlix-confirmed the
 *    moment this endpoint can answer at all). The recording happens BEFORE
 *    any sync attempt — the ordering is the law.
 * 2. SYNC AFTERWARDS, OFFICIALLY: one bounded dispatcher tick attempts
 *    outbound synchronization through REGISTERED official connectors'
 *    DECLARED capabilities only (the drivers seam); an undeclared
 *    capability is a typed `unsupported` outcome — never attempted.
 * 3. ANSWER THE DIFFERENTIATED TRUTH (J10): the receipt maps the record's
 *    honest state — `confirmed` (provider-confirmed: delivered) vs
 *    `local-only` (WebFlix-confirmed: recorded, external sync pending —
 *    including the failed-with-retry detail) vs `unsupported` / `failed`
 *    (never rendered as success). A re-POST of the same identity answers
 *    the record's CURRENT state (idempotent).
 *
 * Typed 400s for garbage bodies (one answer naming every problem); a typed
 * 409 when the same idempotency identity arrives with DIFFERENT content
 * (the store never silently overwrites). A well-formed but UNROUTABLE
 * action (unknown connector id) is NOT garbage — it is recorded and its
 * sync honestly pends (the wiring-gap retry path, bounded by the attempts
 * cap; the state is visible in GET /experience/actions/sync-state).
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers a
 * typed 500; the degradation family (DB down) answers a `failed` receipt
 * whose `detail` names the failure — the action was NOT recorded, and that
 * is the honest answer (never a fabricated success). If the RECORDING
 * succeeded but the sync tick itself failed, the receipt is `local-only`
 * with the recording truth: the action IS WebFlix-confirmed, the sync
 * retry is durable.
 */

import type { ActionReceipt, UserAction } from "@wfx/domain";
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

import { getActionSync, receiptForRecord } from "./sync-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The optional idempotency-token header (the caller's retry identity). */
const ACTION_REQUEST_TOKEN_HEADER = "x-wfx-action-request-token";

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
  const action: UserAction = parsed.value;

  // The optional caller idempotency token: present-but-garbage is a 400
  // (a whitespace-only token is a client bug, never silently re-minted).
  const headerToken = request.headers.get(ACTION_REQUEST_TOKEN_HEADER);
  if (headerToken !== null && headerToken.trim().length === 0) {
    return badRequest(`${ACTION_REQUEST_TOKEN_HEADER}: expected a non-empty token when present`);
  }

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

  // Resolve the request identity (both channels) BEFORE any recording: the
  // outbox row is attributed to the session's active profile (R02) or the
  // anonymous header identity, and the recording needs the locale/region.
  let userId: string;
  let profileId: string | undefined;
  let locale: string;
  let region: string | undefined;
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
    userId = resolved.identity.ctx.userId;
    profileId = resolved.identity.profileId;
    locale = resolved.identity.ctx.locale;
    region = resolved.identity.ctx.region;
  } else {
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    userId = anonymous.ctx.userId;
    locale = anonymous.ctx.locale;
    region = anonymous.ctx.region;
  }

  const lane = getActionSync(boot);
  const nowIso = receiptOccurredAt(boot);

  // 1. RECORD FIRST — the transactional outbox write (with the local audit
  //    row, one transaction). Failures here answer the failed receipt: the
  //    action was NOT recorded, and that is the honest answer.
  let recorded;
  try {
    recorded = await lane.outbox.enqueue({
      userId,
      connectorId: action.connectorId,
      action: action.type,
      externalRef: action.externalRef,
      clientRequestToken: headerToken?.trim() ?? `wfxreq_${boot.ports.ids.next()}`,
      ...(action.payload !== undefined ? { payload: action.payload } : {}),
      locale,
      ...(region !== undefined ? { region } : {}),
      ...(profileId !== undefined ? { profileId } : {}),
    });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("actions.record", thrown);
    return Response.json({
      status: "failed",
      detail: `the action could not be recorded (${describeThrown(thrown)})`,
      occurredAt: nowIso,
    } satisfies ActionReceipt);
  }

  // Same identity, DIFFERENT content: the store never silently overwrites.
  if (recorded.outcome === "conflict") {
    return Response.json(
      {
        error: "idempotency-conflict",
        detail:
          "this action identity (same request token) was already recorded with different content — " +
          `the stored record is untouched (differences: ${recorded.differences.join("; ")})`,
      },
      { status: 409 },
    );
  }
  const recordId = recorded.record.id;

  // 2. SYNC AFTERWARDS — one bounded dispatcher tick through the official
  //    connectors' declared capabilities. The action is ALREADY recorded:
  //    a tick failure never fails the request — the durable retry (and the
  //    opportunistic lane) owns the next attempt, and the receipt answers
  //    the recording truth.
  try {
    await lane.dispatcher.tick(boot.ports.clock.now());
  } catch (thrown) {
    logDegradation("actions.sync", thrown);
  }

  // 3. ANSWER THE DIFFERENTIATED TRUTH — the record's CURRENT state (J10).
  let record = recorded.record;
  try {
    const current = await lane.outbox.get(recordId);
    if (current !== undefined) record = current;
  } catch (thrown) {
    logDegradation("actions.readback", thrown);
  }
  const receipt = receiptForRecord(record, nowIso, lane.retryPolicy.maxAttempts);
  if (!isUsableReceipt(receipt)) {
    // Unreachable (the mapping always answers the frozen vocabulary), kept
    // honest: a malformed receipt is never served.
    logDegradation("actions", "the receipt mapping answered a malformed ActionReceipt");
    return Response.json({
      status: "failed",
      detail: "the receipt mapping answered a malformed ActionReceipt",
      occurredAt: nowIso,
    } satisfies ActionReceipt);
  }
  return Response.json(receipt);
}
