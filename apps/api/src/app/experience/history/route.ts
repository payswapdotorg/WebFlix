/**
 * @wfx/app-api — `GET /experience/history` (R04 transport contract).
 *
 * The profile's viewing history, newest-first, profile-scoped under Bearer;
 * anonymous answers the honest default-profile fallback (the R02 law). The
 * answer is `ProfileHistoryEntry[]` — the FROZEN shape the runtime's
 * `readHistory()` ServerPort member consumes (R02-extended) + the
 * `library.read()` history section folds.
 *
 * EVENT-DERIVED (the event-sink law): the recorded events in `event_outbox`
 * are the immutable truth; this endpoint answers their PROJECTION
 * (`watch_history` rows), filtered by the profile's removals/exclusions.
 * The events themselves are NEVER touched by this read.
 *
 * Identity law: Bearer session → profile-scoped read; anonymous → the
 * pre-R02 anonymous transition (the persistence layer resolves the
 * default-profile fallback per store). A presented-but-malformed
 * Authorization is a 401.
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers a
 * typed 500; the degradation family (DB down) answers the honest typed
 * empty array (`[]`) — never a fake history, never a silent 5xx.
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
import type { ProfileHistoryEntry } from "@api/host/history";

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
    logDegradation("history.boot", thrown);
    return Response.json([] as ProfileHistoryEntry[]); // degrade law: read failure ⇒ empty
  }

  try {
    let entries: readonly ProfileHistoryEntry[];
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("history.session", resolved.detail);
          return Response.json([] as ProfileHistoryEntry[]); // degrade law
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      entries = await boot.history.readHistory(resolved.identity.profileId);
    } else {
      // The anonymous transition — the persistence layer resolves the
      // default-profile fallback per store.
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      // Anonymous: resolve the effective profile key via the watch store
      // (the legacy pseudo bucket — no removal/exclusion filtering applies
      // because there's no profile-scoped removal/exclusion row).
      const profileKey = await boot.history.watchStore().effectiveProfileKey(anonymous.ctx.userId);
      entries = await boot.history.readHistory(profileKey);
    }
    return Response.json([...entries]);
  } catch (thrown) {
    logDegradation("history", thrown);
    return Response.json([] as ProfileHistoryEntry[]);
  }
}
