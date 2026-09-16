/**
 * @wfx/app-api — `GET /experience/search` (WFX-055A transport contract).
 *
 * `?query=<q>` → `SearchResult[]` (JSON array; empty array on no hits).
 * Identity rides as headers (see `host/identity.ts`).
 *
 * Answers are filtered through the frozen client's payload guard
 * (`host/contract-guards.ts`) so every element of the 200 body passes
 * `isUsableRemoteSearchResult` by construction.
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure (config
 * crime / bad deploy) answers a typed 500; the degradation family (DB
 * down — e.g. the Neon idle sleep) answers the honest typed EMPTY result
 * (`[]`, HTTP 200) and is logged, never silent.
 */

import type { SearchResult } from "@wfx/domain";

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import { isUsableSearchResult } from "@api/host/contract-guards";
import { badRequest, bootFailure, isLoudFailure, logBoundaryDrop, logDegradation } from "@api/host/http";
import { readConnectorContext } from "@api/host/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The query bound (the frozen contract has none; garbage stays bounded). */
const MAX_QUERY_LENGTH = 500;

export async function GET(request: Request): Promise<Response> {
  const identity = readConnectorContext(request.headers);
  if (!identity.ok) return badRequest(identity.detail);

  const rawQuery = new URL(request.url).searchParams.get("query");
  if (rawQuery === null) {
    return badRequest("query: the required ?query= parameter is absent");
  }
  if (rawQuery.trim().length === 0) {
    return badRequest("query: expected a non-empty search query");
  }
  if (rawQuery.length > MAX_QUERY_LENGTH) {
    return badRequest(`query: longer than ${MAX_QUERY_LENGTH} characters`);
  }

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("search.boot", thrown);
    return Response.json([] as SearchResult[]); // degrade law: DB down ⇒ no hits
  }

  try {
    const hits = await boot.connector.search(identity.ctx, rawQuery.trim());
    const usable: SearchResult[] = [];
    for (const hit of hits) {
      if (isUsableSearchResult(hit)) {
        usable.push(hit);
      } else {
        logBoundaryDrop("search", "a search hit failed the frozen transport guard");
      }
    }
    return Response.json(usable);
  } catch (thrown) {
    // The fan-out already guards per source; this is the outer belt.
    logDegradation("search", thrown);
    return Response.json([] as SearchResult[]);
  }
}
