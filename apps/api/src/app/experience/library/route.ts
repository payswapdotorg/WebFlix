/**
 * @wfx/app-api — `GET` + `POST /experience/library` (WFX-055A transport
 * contract — BOTH methods in ONE file, the App Router convention).
 *
 * - `GET /experience/library` → `LibraryEntry[]` (JSON array; empty when
 *   the user saved nothing).
 * - `POST /experience/library` body `LibraryCommand` → `ActionReceipt`.
 *
 * Identity rides as headers (see `host/identity.ts`).
 *
 * Typed 400s for garbage bodies; answers are filtered through the frozen
 * client's payload guard (`isUsableRemoteLibraryEntry` /
 * `isUsableReceipt`), so every 200 body passes the client's validators
 * by construction.
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
} from "@api/host/http";
import { readConnectorContext } from "@api/host/identity";
import { parseLibraryCommand } from "@api/host/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stamp a receipt from the booted clock (never a hidden wall clock). */
function receiptOccurredAt(boot: ApiBoot): string {
  return new Date(boot.ports.clock.now()).toISOString();
}

export async function GET(request: Request): Promise<Response> {
  const identity = readConnectorContext(request.headers);
  if (!identity.ok) return badRequest(identity.detail);

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("library.boot", thrown);
    return Response.json([] as LibraryEntry[]); // degrade law: read failure ⇒ empty
  }

  try {
    const entries = await boot.connector.readLibrary(identity.ctx);
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
  const identity = readConnectorContext(request.headers);
  if (!identity.ok) return badRequest(identity.detail);

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
    const receipt = await boot.connector.writeLibrary(identity.ctx, parsed.value);
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
