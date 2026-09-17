/**
 * @wfx/app-api — `GET`/`POST /experience/intents` (R05 transport contract).
 *
 * The ACTIVE profile's durable intent records — the lead-ratified HTTP
 * mapping BOTH adapters already implement (`GET+POST /experience/intents`;
 * the web adapter's `isUsableIntentRecord` guard IS the wire shape this
 * route must answer — `wfxint_` ids, bookkeeping columns included).
 *
 * - `GET` — the intent set with EXPIRED temporary intents FILTERED at read
 *   time (the R01 live-expiry law, now server-side: any record whose
 *   `expiresAt` is at or before the injected now leaves the active set).
 *   Bearer session → the active profile; anonymous → the R02
 *   default-profile fallback.
 * - `POST` — submit one `UserIntentCommand`. SCOPE TRUTH is enforced
 *   server-side exactly as the R01 runtime enforces it: `temporary`
 *   REQUIRES a future ISO expiry; every other violation is collected into
 *   ONE typed 400 naming every problem (the closed five-scope vocabulary,
 *   objective length, weight in (0,1], provenance vocabulary).
 *   ONE-OBJECTIVE-PER-SCOPE: re-submitting the same (scope, objective)
 *   UPDATES the record in place — deterministic, the canonical `wfxint_`
 *   id stable across merges, `evidenceCount` +1 (every submission is
 *   evidence), origin provenance never rewritten. Never a duplicate.
 *
 * REVERSIBILITY: `DELETE /experience/intents/:id` (the sibling route) is
 * the undo law — every control that shapes recommendations can be undone.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the
 * degradation family answers the typed 502 — a controls read/write failure
 * is an ERROR STATE (the adapters map 5xx → `unavailable`), never a fake
 * empty intent set (a fake `[]` would misrepresent the user's intents
 * during an outage).
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
import { intentCommandProblems, type UserIntentCommandWire } from "@api/host/controls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  // Anonymous requests keep the frozen header law verbatim (absent bearer).
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intents.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const intents = await boot.controls.readIntents(resolved.identity.profileId);
      return Response.json([...intents]);
    }
    // The anonymous transition — the persistence layer resolves the
    // default-profile fallback per store.
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const intents = await boot.controls.readIntents(profileKey);
    return Response.json([...intents]);
  } catch (thrown) {
    logDegradation("intents.get", thrown);
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
    return badRequest("body: expected a UserIntentCommand object");
  }
  const command = body.value as unknown as UserIntentCommandWire;

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intents.boot", thrown);
    return Response.json({ ok: false, detail: "service boot failed" }, { status: 502 });
  }

  // SCOPE TRUTH is checked against the boot's injected clock seam (the
  // deterministic seam tests control).
  const problems = [...intentCommandProblems(command, boot.ports.clock.now())];
  if (problems.length > 0) {
    return badRequest(problems.join("; "));
  }

  try {
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("intents.session", resolved.detail);
          return Response.json({ ok: false, detail: resolved.detail }, { status: 502 });
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      const record = await boot.controls.writeIntent(
        resolved.identity.profileId,
        resolved.identity.ctx.userId,
        command,
      );
      return Response.json(record);
    }
    if (anonymous === null || !anonymous.ok) {
      return badRequest("x-wfx-user-id: required identity header is absent");
    }
    const profileKey = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    const record = await boot.controls.writeIntent(
      profileKey,
      anonymous.ctx.userId,
      command,
    );
    return Response.json(record);
  } catch (thrown) {
    logDegradation("intents.post", thrown);
    return Response.json({ ok: false, detail: String(thrown) }, { status: 502 });
  }
}
