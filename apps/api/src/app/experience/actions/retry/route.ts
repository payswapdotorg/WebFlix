/**
 * @wfx/app-api — `POST /experience/actions/retry` (R17 recovery hardening).
 *
 * The IDEMPOTENT RETRY of a terminally `failed` external action sync: the
 * operator's explicit resolution of a named failure (the reconcile route's
 * header names this as R17's consumer). THE NO-DOUBLE-FIRE LAW: the retry
 * re-queues the SAME outbox record (same idempotency key — the provider's
 * dedupe key), never a second record, so a retried sync can never
 * double-fire at the source.
 *
 * Body: `{ recordId: string }` (the `wfxout_…` id from sync-state).
 *
 * - Bearer session → the session user's records; anonymous → the
 *   `x-wfx-user-id` header identity (a request may not retry another
 *   identity's records — 403, typed).
 * - Only a record whose status is EXACTLY `failed` can be retried (409
 *   otherwise — the closed state machine's own law).
 * - After re-queuing, ONE bounded dispatch tick runs immediately (the
 *   opportunistic-sync pattern, but synchronous so the caller sees the
 *   honest outcome), and the answer is the record's next state — never a
 *   fabricated success.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502, never a fake retry success.
 */

import { getApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";

import { getActionSync, syncStateViewOf } from "../sync-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("actions.retry.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  const body: unknown = await request.json().catch(() => null);
  const recordId =
    typeof body === "object" && body !== null
      ? (body as { recordId?: unknown }).recordId
      : undefined;
  if (typeof recordId !== "string" || recordId.trim().length === 0) {
    return badRequest("expected { recordId: string } (the wfxout_… id from sync-state)");
  }

  try {
    let userId: string;
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("actions.retry.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      userId = resolved.identity.ctx.userId;
    } else {
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      userId = anonymous.ctx.userId;
    }

    const lane = getActionSync(boot);
    const record = await lane.outbox.get(recordId);
    if (record === undefined) {
      return Response.json(
        { ok: false, error: "not-found", detail: `retry: no outbox record '${recordId}' exists` },
        { status: 404 },
      );
    }
    if (record.userId !== userId) {
      return Response.json(
        { ok: false, error: "forbidden", detail: "retry: this record belongs to another identity" },
        { status: 403 },
      );
    }
    if (record.status !== "failed") {
      return Response.json(
        {
          ok: false,
          error: "not-retryable",
          detail: `retry: the record's status is '${record.status}' — only a terminally 'failed' record can be retried`,
          record: syncStateViewOf(record),
        },
        { status: 409 },
      );
    }

    // The idempotent re-queue: SAME record, SAME idempotency key, fresh
    // attempt budget (the no-double-fire law is the key, not a new row).
    const requeued = await lane.outbox.retryFailed(recordId, lane.clock.now());
    // ONE bounded dispatch tick so the caller sees the honest outcome of
    // the retried attempt (delivered / pending-retry / failed again —
    // never a fabricated success; the tick's own report is the truth).
    const report = await lane.dispatcher.tick();
    const after = (await lane.outbox.get(recordId)) ?? requeued;
    return Response.json({
      ok: true,
      record: syncStateViewOf(after),
      tick: { dueCount: report.dueCount, outcomes: report.outcomes.length },
    });
  } catch (thrown) {
    logDegradation("actions.retry.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
