/**
 * @wfx/app-api — `GET /feeds/preview/[importId]` (R20-H transport
 * contract).
 *
 * Read one staged preview WITH its display columns (escalation 4): the
 * frozen preview shape (counts, freshness, method) plus the staged rows
 * in the CAPTURE'S OWN ORDER carrying title/externalRef — the display
 * truth the user confirms ("the user confirms WHAT THEY SAW"). The frozen
 * `FeedImportPreview.sample` carries identity + provenance only; the
 * staged rows' display truth is read from the SAME staging table the
 * store confirms from (the documented host-side SELECT — see
 * `host/feed-import.ts`).
 *
 * Only a preview-status import answers; anything else (unknown id, a
 * confirmed/failed import) is the honest typed 404 — the caller's UI
 * state, not an error it can fix.
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs). Degradation law: loud 500 / typed 502 (never a fabricated
 * preview).
 */

import { getApiBoot } from "@api/host/boot";
import { bootFailure } from "@api/host/http";
import { feedBootFailure, resolveFeedIdentity } from "@api/host/feed-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
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
    const degraded = feedBootFailure("feeds.preview.read.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.preview.read", request, boot);
    if (!resolved.ok) return resolved.response;
    const staged = await boot.feedImports.readStagedPreview(importId);
    if (staged === null) {
      return Response.json(
        {
          error: "not-found",
          detail: `feeds.preview: feed import '${importId}' is unknown or not a staged preview`,
          importId,
        },
        { status: 404 },
      );
    }
    return Response.json({ preview: staged });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.preview.read", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
