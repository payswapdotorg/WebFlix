/**
 * @wfx/app-api — `POST /experience/actions/reconcile` (R15 transport
 * contract; REPORT-ONLY reconciliation).
 *
 * Compares the LOCAL belief (the durable action outbox) against the
 * service connector's remote library state and REPORTS the drift as typed
 * entries with resolution SUGGESTIONS ("re-enqueue" | "accept-remote" |
 * "manual"). THE LAW: reconciliation NEVER auto-mutates — no record is
 * created, settled, or re-enqueued by this endpoint; resolution is caller
 * policy (the operator decides; R17's recovery hardening consumes this
 * report). The outbox is provably untouched (test-enforced).
 *
 * Body: `{}` (reconcile the service composite — the wired sources' merged
 * library view, i.e. the records recorded under the service connector id)
 * or `{ "connectorId": "<wired source id>" }` for one named source's
 * view. Requires the connector to declare `libraryRead` (a typed
 * `unsupported` report otherwise — there is no remote state to reconcile
 * against, never a fabricated comparison).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502; a connector read failure is
 * the report's own typed `connector-failed` answer (200 — the report is
 * the answer, and it honestly names the failure).
 */

import { isRecord } from "@wfx/domain";
import { reconcile } from "@wfx/actions";

import { getApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";

import { getActionSync } from "../sync-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  let connectorId: string | undefined;
  if (isRecord(body.value)) {
    const claimed = (body.value as { connectorId?: unknown }).connectorId;
    if (claimed !== undefined) {
      if (typeof claimed !== "string" || claimed.trim().length === 0) {
        return badRequest("connectorId: expected a non-empty string when present");
      }
      connectorId = claimed.trim();
    }
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("actions.reconcile.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    let userId: string;
    let locale = "en";
    let region: string | undefined;
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("actions.reconcile.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      userId = resolved.identity.ctx.userId;
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

    // The remote state to reconcile against: the named wired source's view
    // (its own connector routing through the fan-out) or the service
    // composite (the merged library, connectorId = the service binding).
    const lane = getActionSync(boot);
    const connector =
      connectorId === undefined
        ? boot.connector
        : (lane.registry.get(connectorId) ?? null);
    if (connector === null) {
      return Response.json(
        {
          error: "unknown-connector",
          detail: `connector '${connectorId}' is not wired to this service`,
        },
        { status: 404 },
      );
    }

    // REPORT-ONLY: the typed drift report. The outbox is untouched (the
    // reconcile function is pure with respect to it; test-enforced).
    const report = await reconcile(lane.outbox, connector, userId, {
      locale,
      ...(region !== undefined ? { region } : {}),
    });
    return Response.json(report);
  } catch (thrown) {
    logDegradation("actions.reconcile", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
