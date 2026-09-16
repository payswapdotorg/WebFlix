/**
 * @wfx/app-api — `GET /experience/metadata` (WFX-055A transport contract).
 *
 * `?ref=<ref>` → `SourceItem | null` (JSON null on unknown ref).
 * Identity rides as headers (see `host/identity.ts`).
 *
 * The answer is filtered through the frozen client's payload guard, so
 * the 200 body passes `isUsableRemoteSourceItem` by construction (an
 * item that fails the guard degrades to the honest `null` + a log line,
 * exactly what the client would do with it).
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers
 * a typed 500; the degradation family (DB down) answers the honest typed
 * EMPTY result (`null`, HTTP 200) and is logged, never silent.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import { isUsableSourceItem } from "@api/host/contract-guards";
import { badRequest, bootFailure, isLoudFailure, logBoundaryDrop, logDegradation } from "@api/host/http";
import { readConnectorContext } from "@api/host/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The ref bound (the frozen contract has none; garbage stays bounded). */
const MAX_REF_LENGTH = 512;

export async function GET(request: Request): Promise<Response> {
  const identity = readConnectorContext(request.headers);
  if (!identity.ok) return badRequest(identity.detail);

  const ref = new URL(request.url).searchParams.get("ref");
  if (ref === null) {
    return badRequest("ref: the required ?ref= parameter is absent");
  }
  if (ref.trim().length === 0) {
    return badRequest("ref: expected a non-empty external reference");
  }
  if (ref.length > MAX_REF_LENGTH) {
    return badRequest(`ref: longer than ${MAX_REF_LENGTH} characters`);
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("metadata.boot", thrown);
    return Response.json(null); // degrade law: metadata failure ⇒ no metadata
  }

  try {
    const item = await boot.connector.metadata(identity.ctx, ref);
    if (item === null) return Response.json(null);
    if (!isUsableSourceItem(item)) {
      logBoundaryDrop("metadata", "the item failed the frozen transport guard");
      return Response.json(null);
    }
    return Response.json(item);
  } catch (thrown) {
    logDegradation("metadata", thrown);
    return Response.json(null);
  }
}
