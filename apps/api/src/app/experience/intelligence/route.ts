/**
 * @wfx/app-api — `GET /experience/intelligence` (R26-W4 — the wire
 * contract's service side).
 *
 * THE ONE WIRE CONTRACT (`@wfx/model-fabric`'s `read-transport.ts` —
 * served verbatim, never forked):
 *
 * | Read             | HTTP                                  | Query            |
 * |------------------|---------------------------------------|------------------|
 * | search-by-meaning| `GET {base}/experience/intelligence`  | `?q=<query>`     |
 * | item artifacts   | `GET {base}/experience/intelligence`  | `?item=<extRef>` |
 *
 * The 200 body is the JSON of `IntelligenceReadOutcome` —
 * `{ kind: "served", value }` or `{ kind: "not-served", reason, detail,
 * dependency, nextAction? }`. The web host's service transport
 * (`apps/web/src/host/intelligence-service-transport.ts`) validates
 * every answer against the frozen guards, so shape discipline is
 * mandatory: malformed payloads are REJECTED by the client, never
 * coerced (drift is never silently absorbed).
 *
 * Identity: THE ANONYMOUS BOUNDARY (R23-K) — these reads are LOW-COST
 * and serve ANONYMOUS viewers with typed states, never a login wall.
 * The wire contract's client (W1's service transport) sends no identity
 * headers (`accept: application/json` only), so this route requires
 * NONE — unlike the identity-carrying /experience routes the frozen
 * remote-ports client serves.
 *
 * Degradation law (052 classify + WFX-003): a LOUD boot failure answers
 * the typed 500; the degradation family (the store/DB down) answers the
 * honest typed NOT-SERVED outcome (HTTP 200 — the read's honest empty,
 * never a fabricated served answer) and is logged, never silent.
 */

import type {
  IntelligenceItemRead,
  IntelligenceReadOutcome,
  IntelligenceSearchRead,
} from "@wfx/model-fabric";

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import { badRequest, bootFailure, isLoudFailure, logDegradation } from "@api/host/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The query bound (the frozen contract has none; garbage stays bounded). */
const MAX_QUERY_LENGTH = 500;
/** The item-ref bound (mirrors the metadata route's ref bound). */
const MAX_ITEM_LENGTH = 512;

/**
 * The typed degradation answer: the transport cannot serve RIGHT NOW
 * (the store is unreachable — the Neon idle-sleep family). The honest
 * not-served `transport-unavailable` truth, never a fabricated served
 * answer, never a silent empty-presented-as-no-matches.
 */
function storeUnavailable(detail: string): IntelligenceReadOutcome<never> {
  return {
    kind: "not-served",
    reason: "transport-unavailable",
    detail,
    dependency:
      "the Experience API's derived-artifact store is temporarily unreachable — this is a transient degradation (the database layer), not a missing route; the read stays off honestly rather than approximated",
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q");
  const rawItem = url.searchParams.get("item");
  if (rawQuery !== null && rawItem !== null) {
    return badRequest("expected exactly one of ?q= | ?item= — both are present");
  }
  if (rawQuery === null && rawItem === null) {
    return badRequest("expected exactly one of ?q=<semantic query> | ?item=<externalRef>");
  }
  if (rawQuery !== null) {
    const query = rawQuery.trim();
    if (query.length === 0) {
      return badRequest("q: expected a non-empty semantic query");
    }
    if (rawQuery.length > MAX_QUERY_LENGTH) {
      return badRequest(`q: longer than ${MAX_QUERY_LENGTH} characters`);
    }
    return answer(async (boot) => {
      const outcome: IntelligenceReadOutcome<IntelligenceSearchRead> =
        await boot.intelligence.host.searchByMeaning(query);
      return outcome;
    });
  }
  const item = (rawItem as string).trim();
  if (item.length === 0) {
    return badRequest("item: expected a non-empty external reference");
  }
  if (item.length > MAX_ITEM_LENGTH) {
    return badRequest(`item: longer than ${MAX_ITEM_LENGTH} characters`);
  }
  return answer(async (boot) => {
    const outcome: IntelligenceReadOutcome<IntelligenceItemRead> =
      await boot.intelligence.host.itemArtifacts(item);
    return outcome;
  });
}

/** Boot + answer + the degradation mapping (the shared read path). */
async function answer(
  read: (boot: ApiBoot) => Promise<IntelligenceReadOutcome<unknown>>,
): Promise<Response> {
  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intelligence.boot", thrown);
    return Response.json(
      storeUnavailable(
        "The intelligence store could not be booted for this read (a transient degradation) — semantic and moment reads stay off honestly rather than approximated.",
      ),
    );
  }
  try {
    const outcome = await read(boot);
    return Response.json(outcome);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("intelligence", thrown);
    return Response.json(
      storeUnavailable(
        "The intelligence store is temporarily unreachable — semantic and moment reads stay off honestly rather than approximated.",
      ),
    );
  }
}
