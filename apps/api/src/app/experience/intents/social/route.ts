/**
 * @wfx/app-api — `GET`/`POST /experience/intents/social` (R15 transport
 * contract; the social-intent family within privacy boundaries).
 *
 * The share/follow/recommend-to intent family, captured through the R05
 * `/experience/intents` patterns (profile-scoped identity, typed 400s
 * naming every problem, one-objective-per-scope update-in-place with a
 * stable `wfxint_` id, reversibility through the sibling
 * `DELETE /experience/intents/:id`).
 *
 * THE PRIVACY BOUNDARY (the architecture's privacy law, doubled for
 * social-intent data):
 * - LOCAL STORAGE ONLY: a social intent is a `UserIntent` with the frozen
 *   `social` scope stored in the profile-scoped intent store — the same
 *   local-first persistence every intent uses. This route NEVER touches
 *   the action-sync lane, and the sync lane NEVER reads the intent store
 *   (structurally separated; test-enforced).
 * - EXPLICIT USER ACTION GATES ANY OUTBOUND USE: no intent-derived signal
 *   leaves the boundary implicitly — outbound egress happens ONLY as an
 *   explicit user action dispatched through POST /experience/actions (the
 *   outbox records it first). Capturing a "share" intent performs ZERO
 *   outbound work.
 * - NO SECRETS IN LOGS/URLS: nothing here logs or echoes beyond the
 *   caller's own record; the objective is composed deterministically from
 *   the validated family + target (bounded lengths).
 *
 * Wire shape:
 * - `POST` body: `{ family: "share" | "follow" | "recommend-to",
 *    target?: string, note?: string, weight?, expiresAt? }` → the stored
 *    `IntentRecord` (objective composed as `<family>` or `<family> <target>`).
 * - `GET` → the profile's social-family intent records (the closed family
 *   prefix match on the objective), expired ones filtered at read time.
 */

import { isRecord } from "@wfx/domain";

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
import type { IntentRecord } from "@wfx/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The closed social-intent family vocabulary (R15). */
export const SOCIAL_INTENT_FAMILIES: readonly string[] = [
  "share",
  "follow",
  "recommend-to",
];

/** Max lengths (the feedback-controls convention: target 200, note 500). */
const TARGET_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 500;

/** Parse the family + target + note out of an untrusted body. */
function socialIntentProblems(
  body: unknown,
): { ok: true; family: string; target?: string; note?: string } | { ok: false; problems: string[] } {
  if (!isRecord(body)) {
    return { ok: false, problems: ["body: expected { family, target?, note? }"] };
  }
  const problems: string[] = [];
  const family = body.family;
  if (typeof family !== "string" || !SOCIAL_INTENT_FAMILIES.includes(family)) {
    problems.push(
      `family: expected one of ${SOCIAL_INTENT_FAMILIES.join(" | ")}, got '${String(family)}'`,
    );
  }
  let target: string | undefined;
  if (body.target !== undefined) {
    if (typeof body.target !== "string" || body.target.trim().length === 0) {
      problems.push("target: expected a non-empty string when present");
    } else if (body.target.length > TARGET_MAX_LENGTH) {
      problems.push(`target: expected at most ${TARGET_MAX_LENGTH} characters`);
    } else {
      target = body.target.trim();
    }
  }
  let note: string | undefined;
  if (body.note !== undefined) {
    if (typeof body.note !== "string" || body.note.length > NOTE_MAX_LENGTH) {
      problems.push(`note: expected a string of at most ${NOTE_MAX_LENGTH} characters when present`);
    } else {
      note = body.note;
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, family: family as string, ...(target !== undefined ? { target } : {}), ...(note !== undefined ? { note } : {}) };
}

/** Compose the deterministic objective: `<family>` or `<family> <target>`. */
function objectiveOf(family: string, target?: string): string {
  return target === undefined ? family : `${family} ${target}`;
}

/** Is this stored social-scope record one of the R15 family? */
function isFamilyRecord(record: IntentRecord): boolean {
  if (record.scope !== "social") return false;
  const firstWord = record.objective.split(" ")[0] ?? "";
  return (SOCIAL_INTENT_FAMILIES as readonly string[]).includes(firstWord);
}

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
    logDegradation("intents.social.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.social.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const intents = await boot.controls.readIntents(resolved.identity.profileId);
      return Response.json([...intents.filter(isFamilyRecord)]);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const intents = await boot.controls.readIntents(profileKey);
    return Response.json([...intents.filter(isFamilyRecord)]);
  } catch (thrown) {
    logDegradation("intents.social.get", thrown);
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
  const parsed = socialIntentProblems(body.value);
  if (!parsed.ok) return badRequest(parsed.problems.join("; "));

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intents.social.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.social.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const record = await writeSocialIntent(
        boot,
        resolved.identity.profileId,
        resolved.identity.ctx.userId,
        parsed.family,
        parsed.target,
      );
      return Response.json(record);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const record = await writeSocialIntent(
      boot,
      profileKey,
      anonymous.ctx.userId,
      parsed.family,
      parsed.target,
    );
    return Response.json(record);
  } catch (thrown) {
    logDegradation("intents.social.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}

/**
 * Write one social intent through the R05 controls host (the same
 * one-objective-per-scope law, stable id, evidence counting, origin
 * provenance). LOCAL-ONLY: nothing here performs or triggers any outbound
 * work — the explicit user action (POST /experience/actions) is the only
 * gate through which outbound use ever happens.
 */
async function writeSocialIntent(
  boot: Awaited<ReturnType<typeof getApiBoot>>,
  profileId: string,
  userId: string,
  family: string,
  target?: string,
): Promise<IntentRecord> {
  return boot.controls.writeIntent(profileId, userId, {
    objective: objectiveOf(family, target),
    scope: "social",
    provenance: "explicit",
  });
}
