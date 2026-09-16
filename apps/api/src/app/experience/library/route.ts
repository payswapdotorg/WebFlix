/**
 * @wfx/app-api — `GET` + `POST /experience/library` (WFX-055A transport
 * contract — BOTH methods in ONE file, the App Router convention; R02:
 * profile scoping).
 *
 * - `GET /experience/library` → `LibraryEntry[]` (JSON array; empty when
 *   the user saved nothing).
 * - `POST /experience/library` body `LibraryCommand` → `ActionReceipt`.
 *
 * R02 — THE SESSION UPGRADE (the anonymous transition preserved):
 * - With `Authorization: Bearer wfxsess_…`: the reads/writes are
 *   PROFILE-SCOPED to the session's active profile (`readLibraryForProfile`
 *   / `writeLibraryForProfile` on the fan-out — the WebFlix-owned service
 *   library; provider-side libraries are R03's authorization lane).
 * - Anonymous (`x-wfx-user-id` only): the EXACT pre-R02 behavior (the
 *   fan-out's merged connector-side read; the persistence layer resolves
 *   the default-profile fallback per store). R07 re-points the web app.
 *
 * Identity rides as headers (see `host/identity.ts`); a presented-but-
 * malformed Authorization is a 401; both channels present must agree.
 *
 * Typed 400s for garbage bodies; answers are filtered through the frozen
 * client's payload guard (`isUsableRemoteLibraryEntry` / `isUsableReceipt`),
 * so every 200 body passes the client's validators by construction.
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers
 * a typed 500; the degradation family (DB down) answers the honest typed
 * empty result on reads (`[]`) and a `failed` receipt on writes —
 * logged, never silent.
 */

import type { ActionReceipt, LibraryEntry } from "@wfx/domain";
import { describeThrown, isUsableReceipt } from "@wfx/experience";

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import { isUsableLibraryEntry } from "@api/host/contract-guards";
import {
  badRequest,
  bootFailure,
  degradedReceiptOccurredAt,
  isLoudFailure,
  logBoundaryDrop,
  logDegradation,
  readJsonBody,
  unauthorized,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import { parseLibraryCommand } from "@api/host/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stamp a receipt from the booted clock (never a hidden wall clock). */
function receiptOccurredAt(boot: ApiBoot): string {
  return new Date(boot.ports.clock.now()).toISOString();
}

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  // Anonymous requests keep the frozen header law verbatim (absent bearer).
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("library.boot", thrown);
    return Response.json([] as LibraryEntry[]); // degrade law: read failure ⇒ empty
  }

  try {
    let entries: readonly LibraryEntry[];
    if (bearer.kind === "present") {
      const resolved = await resolveScopedIdentity(request.headers, boot);
      if (!resolved.ok) {
        if (resolved.failure === "degraded") {
          logDegradation("library.session", resolved.detail);
          return Response.json([] as LibraryEntry[]); // degrade law
        }
        if (resolved.failure === "bad-request") return badRequest(resolved.detail);
        return unauthorized(resolved.detail);
      }
      if (resolved.identity.mode !== "session") {
        return unauthorized("authorization: a bearer session token is required");
      }
      entries = await boot.connector.readLibraryForProfile(resolved.identity.profileId);
    } else {
      // The anonymous transition — the exact pre-R02 fan-out read.
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      entries = await boot.connector.readLibrary(anonymous.ctx);
    }

    const usable: LibraryEntry[] = [];
    for (const entry of entries) {
      if (isUsableLibraryEntry(entry)) {
        usable.push(entry);
      } else {
        logBoundaryDrop("library", "a library entry failed the frozen transport guard");
      }
    }
    return Response.json(usable);
  } catch (thrown) {
    logDegradation("library", thrown);
    return Response.json([] as LibraryEntry[]);
  }
}

export async function POST(request: Request): Promise<Response> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  const parsed = parseLibraryCommand(body.value);
  if (!parsed.ok) return badRequest(parsed.problems.join("; "));

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("library.boot", thrown);
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
          logDegradation("library.session", resolved.detail);
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
      receipt = await boot.connector.writeLibraryForProfile(
        resolved.identity.ctx,
        resolved.identity.profileId,
        parsed.value,
      );
    } else {
      if (anonymous === null || !anonymous.ok) {
        return badRequest("x-wfx-user-id: required identity header is absent");
      }
      receipt = await boot.connector.writeLibrary(anonymous.ctx, parsed.value);
    }

    if (isUsableReceipt(receipt)) return Response.json(receipt);
    logDegradation("library", "the connector answered a malformed ActionReceipt");
    return Response.json({
      status: "failed",
      detail: "the connector answered a malformed ActionReceipt",
      occurredAt: receiptOccurredAt(boot),
    } satisfies ActionReceipt);
  } catch (thrown) {
    logDegradation("library", thrown);
    return Response.json({
      status: "failed",
      detail: describeThrown(thrown),
      occurredAt: receiptOccurredAt(boot),
    } satisfies ActionReceipt);
  }
}
