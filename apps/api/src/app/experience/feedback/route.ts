/**
 * @wfx/app-api — `GET`/`POST /experience/feedback` (R05 transport contract).
 *
 * The J15 control set as typed, PER-PROFILE, TIMESTAMPED, REVERSIBLE
 * records: `more-like-this`, `not-interested`, `dont-recommend-source`,
 * `dont-recommend-creator`, `already-watched` — each with an undo
 * (`DELETE /experience/feedback/:id`, the sibling route).
 *
 * - `POST` — body `{ kind, target, note? }`: the closed J15 vocabulary;
 *   the target is a canonical item id (`wfxitm_…`) for the item-targeted
 *   kinds, a connector id for `dont-recommend-source`, a creator id for
 *   `dont-recommend-creator`. Idempotent per (profile, kind, target) —
 *   re-submitting the same control answers the existing record.
 * - `GET` — the profile's controls, oldest first (the reversibility UX's
 *   read: you cannot undo what you cannot see). This GET is an R05
 *   addition beyond the two spec-named verbs, flagged for the lead.
 *
 * THE EVENT-SINK LAW (R04, preserved): feedback NEVER deletes or falsifies
 * recorded viewing events — `event_outbox` and `watch_history` are never
 * touched here; feedback shapes future candidate composition only.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502 (a controls read/write failure
 * is an ERROR STATE, never a fake empty controls list).
 */

import { isEntertainmentItemId, isRecord } from "@wfx/domain";

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
import {
  feedbackCommandProblems,
  type FeedbackCommandWire,
} from "@api/host/controls";
import { isRecommendationFeedbackKind } from "@wfx/recommendation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("feedback.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("feedback.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const records = await boot.controls.listFeedback(resolved.identity.profileId);
      return Response.json([...records]);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const records = await boot.controls.listFeedback(profileKey);
    return Response.json([...records]);
  } catch (thrown) {
    logDegradation("feedback.get", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  if (!isRecord(body.value)) {
    return badRequest("body: expected { kind, target, note? }");
  }
  const command = body.value as unknown as FeedbackCommandWire;
  const problems = [...feedbackCommandProblems(command)];
  // Per-kind target semantics: item-targeted kinds take a canonical
  // `wfxitm_` id; suppression kinds take the source/creator id verbatim.
  if (
    isRecommendationFeedbackKind(command.kind) &&
    command.kind !== "dont-recommend-source" &&
    command.kind !== "dont-recommend-creator" &&
    typeof command.target === "string" &&
    !isEntertainmentItemId(command.target)
  ) {
    problems.push(
      `target: expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body) for kind '${command.kind}', got ${JSON.stringify(command.target)}`,
    );
  }
  if (problems.length > 0) {
    return badRequest(problems.join("; "));
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("feedback.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("feedback.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const record = await boot.controls.addFeedback(
        resolved.identity.profileId,
        resolved.identity.ctx.userId,
        {
          kind: command.kind as Parameters<typeof boot.controls.addFeedback>[2]["kind"],
          target: command.target,
          ...(command.note !== undefined ? { note: command.note } : {}),
        },
      );
      return Response.json(record);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const record = await boot.controls.addFeedback(profileKey, anonymous.ctx.userId, {
      kind: command.kind as Parameters<typeof boot.controls.addFeedback>[2]["kind"],
      target: command.target,
      ...(command.note !== undefined ? { note: command.note } : {}),
    });
    return Response.json(record);
  } catch (thrown) {
    logDegradation("feedback.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
