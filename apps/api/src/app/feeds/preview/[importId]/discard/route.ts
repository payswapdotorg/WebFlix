/**
 * @wfx/app-api — `POST /feeds/preview/[importId]/discard` (R20-H
 * transport contract — escalation 4).
 *
 * Discard one staged preview: the presentation lifecycle of a capture
 * the user chose NOT to import. A preview row owns NO feed records
 * (records exist solely after confirm — the store's law), so the discard
 * deletes the staged rows + their import transaction and NOTHING else
 * (the one documented host-side table DELETE — see `host/feed-import.ts`;
 * it never touches `feed_records` or any non-BYOF table).
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs).
 *
 * Typed answers: 200 `{ importId }`; 404 `not-found` (the import is
 * unknown); 400 `invalid-input` (only a staged PREVIEW can be discarded —
 * a confirmed import's records are kept until the explicit
 * delete-records path); 500/502 the boot laws.
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
    const degraded = feedBootFailure("feeds.preview.discard.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.preview.discard", request, boot);
    if (!resolved.ok) return resolved.response;

    const result = await boot.feedImports.discardPreview(importId);
    if (!result.ok) return feedFailureResponse(result.failure);
    return Response.json({ ok: true, importId: result.value.importId });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.preview.discard", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
