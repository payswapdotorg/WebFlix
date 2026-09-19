/**
 * @wfx/app-api — `POST /feeds/imports/[importId]/sync` (R20-H transport
 * contract).
 *
 * Incrementally synchronize one confirmed import — the R20-C
 * `FeedImportService.syncFeedImport` reconciliation composition:
 * re-capture through the connector, diff against the import's OWN scope
 * (the remove-safety law), apply idempotently, fold the honest state
 * machine. The answer carries the import's new truth AND the
 * reconciliation report (the server's own honest per-item counts —
 * added/updated/removed/kept — never a fabricated summary).
 *
 * Failure truth (typed, end to end): `unauthorized` → the import lands
 * `reauthorization-required`, records RETAINED (the survival law), the
 * 401 body names the recovery path; `transport`/`provider` → `stale`
 * with records / `degraded` without; a one-time route → the typed
 * `unsupported` verdict (409 — re-import through a fresh preview, never
 * a fake refresh); an unconfirmed preview → the typed `invalid-input`
 * refusal (nothing is imported yet).
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs).
 */

import { getApiBoot } from "@api/host/boot";
import { bootFailure, feedFailureResponse } from "@api/host/http";
import { feedBootFailure, resolveFeedIdentity } from "@api/host/feed-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ importId: string }> },
): Promise<Response> {
  const { importId } = await context.params;
  if (importId.trim().length === 0) {
    return Response.json(
      { error: "invalid-request", detail: "importId: expected a non-empty feed-import id" },
      { status: 400 },
    );
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.imports.sync.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.imports.sync", request, boot);
    if (!resolved.ok) return resolved.response;

    const result = await boot.feedImports.feedService().syncFeedImport(importId);
    if (!result.ok) return feedFailureResponse(result.error);
    return Response.json({ import: result.value.import, report: result.value.report });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.imports.sync", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
