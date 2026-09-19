/**
 * @wfx/app-api — `GET /feeds/imports` (R20-H transport contract).
 *
 * The import trail: every feed import of the requesting identity's
 * profile, newest first (the store's own read order) — the honest
 * attempt trail including failed attempts and reauthorization gaps, each
 * row carrying its durable truth (status, sync state, method, scope,
 * counts, error detail).
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs). The rows are the shared store's own `PersistedFeedImport`
 * shapes — plain, serializable, no secrets (the feed tables never carry
 * credential material; the connector's credentials live in the
 * envelope-encrypted connector-account store).
 *
 * Degradation law: loud 500 / typed 502 — an import-trail read failure is
 * an ERROR STATE, never a fabricated empty trail (the R01 typed-failure
 * law the BYOF surface inherits).
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
    const degraded = feedBootFailure("feeds.imports.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.imports", request, boot);
    if (!resolved.ok) return resolved.response;
    const imports = await boot.feedImports.listImports(resolved.identity.profileId);
    return Response.json({ imports: [...imports] });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.imports.read", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
