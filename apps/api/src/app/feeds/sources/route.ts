/**
 * @wfx/app-api — `GET /feeds/sources` (R20-H transport contract).
 *
 * The BYOF choose-source step's truth: every connector wired in this
 * service's feed-import registry, with its documented feed capability
 * (the importable relationships, the honest absences with their reasons,
 * the continuous-sync truth) and the requesting user's CURRENT
 * authorization state derived from the durable connector-account store
 * (the R03 `deriveAuthState` law — a connected source is the truthful
 * presence of a live grant; an expired token is REPORTED not-connected,
 * never silently connected).
 *
 * Identity: session-scoped OR the anonymous transition (the frozen
 * `x-wfx-*` header law — the anonymous user's answer is the HONEST
 * not-connected option list, never a fabricated connection). Identity
 * travels as headers, never in URLs.
 *
 * Honesty law: an unprovisioned deployment (no YOUTUBE_* env) wires an
 * EMPTY registry — this route answers the honest empty list, never a
 * fixture fallback (frozen invariant 10).
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the 052
 * degradation family (DB down) answers the typed 502 — a source-list read
 * failure is an ERROR STATE for the BYOF panel, never a fake empty list
 * (the R01 typed-failure law).
 */

import { getApiBoot } from "@api/host/boot";
import { bootFailure } from "@api/host/http";
import { feedBootFailure, resolveFeedIdentity } from "@api/host/feed-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.sources", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.sources", request, boot);
    if (!resolved.ok) return resolved.response;
    const sources = await boot.feedImports.feedSourcesFor(resolved.identity.userId);
    return Response.json({ sources: [...sources] });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.sources.read", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
