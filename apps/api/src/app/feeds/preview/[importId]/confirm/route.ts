/**
 * @wfx/app-api — `POST /feeds/preview/[importId]/confirm` (R20-H
 * transport contract).
 *
 * Promote one staged preview into idempotent feed records — the user
 * confirmed WHAT THEY SAW (the R20-C `FeedImportService.confirmFeedImport`
 * — confirm NEVER re-fetches; a continuously re-readable route lands
 * `live`, a one-time capture lands `snapshot`, never presented as live).
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs).
 *
 * Typed answers: 200 (the confirmed import row — status, sync state,
 * counts); 404 `not-found` (the import is unknown); 400 `invalid-input`
 * (a failed/reauthorization-required import never staged a preview to
 * confirm); 500/502 the boot laws.
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
    const degraded = feedBootFailure("feeds.preview.confirm.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.preview.confirm", request, boot);
    if (!resolved.ok) return resolved.response;

    const result = await boot.feedImports.feedService().confirmFeedImport(importId);
    if (!result.ok) return feedFailureResponse(result.error);
    return Response.json({ import: result.value });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.preview.confirm", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
