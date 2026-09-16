/**
 * @wfx/app-api — `GET /experience/resolve` (WFX-055A transport contract).
 *
 * `?ref=<ref>` → `PlaybackRealization[]` (JSON array; empty on unknown
 * ref). Identity rides as headers (see `host/identity.ts`).
 *
 * Answers are filtered through the frozen `validatePlaybackRealization`
 * (the exact function the client applies), so every element of the 200
 * body passes the client's guard by construction.
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers
 * a typed 500; the degradation family (DB down) answers the honest typed
 * EMPTY result (`[]`, HTTP 200) and is logged, never silent.
 */

import type { PlaybackRealization } from "@wfx/domain";

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import { isUsableRealization } from "@api/host/contract-guards";
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
    logDegradation("resolve.boot", thrown);
    return Response.json([] as PlaybackRealization[]); // degrade law: no candidates
  }

  try {
    const realizations = await boot.connector.resolve(identity.ctx, ref);
    const usable: PlaybackRealization[] = [];
    for (const candidate of realizations) {
      if (isUsableRealization(candidate)) {
        usable.push(candidate);
      } else {
        logBoundaryDrop("resolve", "a playback realization failed the frozen transport guard");
      }
    }
    return Response.json(usable);
  } catch (thrown) {
    logDegradation("resolve", thrown);
    return Response.json([] as PlaybackRealization[]);
  }
}
