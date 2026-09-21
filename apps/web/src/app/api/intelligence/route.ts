/**
 * @wfx/app-web — `GET /api/intelligence` (R23-F/G/H consumption): the
 * media-intelligence reads' typed transport bridge.
 *
 * - `?q=<query>` — search by meaning + moment search over the semantic
 *   index (the R23-H surfaces' read; every result carries its honest
 *   provenance — contributing models, never an authority);
 * - `?item=<externalRef>` — one item's intelligence view (transcript,
 *   chapters, moments, the discovery-feature availability truth, the
 *   provenance sentences, the legal-audio gate);
 * - `?liveAsr=<externalRef>` — the R23-G live-ASR route view (the
 *   legal-audio readiness gate + the routing decision over the CURRENT
 *   registration truth + the frozen R2T2 envelope).
 *
 * R23-K (the anonymous AI boundary): these are LOW-COST/LOCAL reads —
 * the route serves ANONYMOUS viewers with typed states (never a login
 * wall). In service mode the reads answer the honest unavailable state
 * (no transport-exposed intelligence data yet — never a fabricated
 * result).
 */

import { getWebRuntimeHost } from "@/host/web-host";
import {
  loadItemIntelligence,
  loadLiveAsrRoute,
  searchByMeaning,
} from "@/host/intelligence";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const item = url.searchParams.get("item");
  const liveAsr = url.searchParams.get("liveAsr");
  const host = await getWebRuntimeHost();

  if (query !== null && query.trim().length > 0) {
    const view = await searchByMeaning(host, query.trim());
    return Response.json({ mode: host.mode, kind: "semantic-search", view });
  }
  if (item !== null && item.length > 0) {
    const view = await loadItemIntelligence(host, item);
    return Response.json({ mode: host.mode, kind: "item-intelligence", view });
  }
  if (liveAsr !== null && liveAsr.length > 0) {
    const view = await loadLiveAsrRoute(host, liveAsr);
    return Response.json({ mode: host.mode, kind: "live-asr-route", view });
  }
  return Response.json(
    {
      error:
        "expected exactly one of ?q=<semantic query> | ?item=<externalRef> | ?liveAsr=<externalRef>",
    },
    { status: 400 },
  );
}
