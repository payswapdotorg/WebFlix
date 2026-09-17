/**
 * @wfx/app-api — `POST`/`GET /experience/feedback` (R05 transport
 * contract).
 *
 * The J15 control set as typed, per-profile, timestamped, REVERSIBLE
 * records — the wire shape the Recommendation OS's `feedback` stage
 * consumes (mapped from the persistence store's rows):
 *
 * - `POST` submits one control: `more-like-this`, `not-interested`,
 *   `dont-recommend-source`, `dont-recommend-creator`, `already-watched`
 *   (kind/target consistency enforced — item kinds need `wfxitm_` ids).
 *   Answers the stored record (201). Update-in-place per
 *   (profile, kind, target): re-submission refreshes, never duplicates.
 * - `GET` answers the profile's records, newest first — the control list
 *   the undo affordances (`DELETE /experience/feedback/:id`) key off.
 *   (GET is R05's minimal addition beyond the spec'd POST/DELETE surface:
 *   the reversibility law needs the ids discoverable after a reload —
 *   documented for the lead's ratification.)
 *
 * THE EVENT-SINK LAW: nothing here deletes or falsifies recorded viewing
 * events (R04's law) — `already-watched` is a recommendation control, not
 * a history edit.
 *
 * Identity law: the R02 pattern (Bearer session → the active profile;
 * anonymous → the header law + the effective-profile fallback). A
 * presented-but-malformed Authorization is a 401. Typed 400s name every
 * problem.
 */

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
  RecommendationControlsError,
  type FeedbackCommandInput,
  type FeedbackWireRecord,
} from "@api/host/recommendation-controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
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
    return Response.json([] as FeedbackWireRecord[]); // degrade law: read failure ⇒ empty
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("feedback.session", resolved.detail);
          return Response.json([] as FeedbackWireRecord[]); // degrade law
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const records = await boot.recommendation.listFeedback(resolved.identity.profileId);
      return Response.json([...records]);
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const records = await boot.recommendation.listFeedback(profileKey);
    return Response.json([...records]);
  } catch (thrown) {
    logDegradation("feedback", thrown);
    return Response.json([] as FeedbackWireRecord[]); // degrade law
  }
}

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  const command = body.value as FeedbackCommandInput;
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    return badRequest("feedback: expected a feedback command object");
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("feedback.boot", thrown);
    return Response.json(
      { error: "feedback-write-unavailable", detail: "the feedback store is unavailable right now" },
      { status: 503 },
    );
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("feedback.session", resolved.detail);
          return Response.json(
            { error: "feedback-write-unavailable", detail: resolved.detail },
            { status: 503 },
          );
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const record = await boot.recommendation.addFeedback({
        profileId: resolved.identity.profileId,
        userId: resolved.identity.ctx.userId,
        command,
      });
      return Response.json(record, { status: 201 });
    }

    // The anonymous transition — the effective-profile fallback.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.recommendation.anonymousProfileKey(anonymous.ctx.userId);
    const record = await boot.recommendation.addFeedback({
      profileId: profileKey,
      userId: anonymous.ctx.userId,
      command,
    });
    return Response.json(record, { status: 201 });
  } catch (thrown) {
    if (thrown instanceof RecommendationControlsError) {
      return Response.json(
        { error: "invalid-request", detail: thrown.problems.join("; ") },
        { status: 400 },
      );
    }
    logDegradation("feedback.write", thrown);
    return Response.json(
      { error: "feedback-write-unavailable", detail: "the feedback store is unavailable right now" },
      { status: 503 },
    );
  }
}
