/**
 * @wfx/app-api — `POST /feeds/imports/[importId]/delete-records` (R20-H
 * transport contract).
 *
 * DELETE one import's imported records — the EXPLICIT user-deletion path
 * ONLY. This is the ONLY operation in the whole feed surface that removes
 * imported records (the shared service's own deletion: `feed_records`
 * only — the separation law pins every other table out of reach; the
 * WebFlix-local watchlist/history/library were never touched by the
 * import and are structurally unreachable here). It is never the
 * disconnect path, and it never fires as a side effect of another intent.
 *
 * THE TWO-STEP-ARMED DESTRUCTIVE LAW: the client arms this action behind
 * an explicit confirmation step (the "Really delete N imported records"
 * arm the Web surface ships — the arm is the UI law, ratified with the
 * fold); the route is the single explicit destructive endpoint that arm
 * releases. The honest answer states exactly how many records were
 * removed.
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs).
 *
 * Typed answers: 200 `{ removed }`; 404 `not-found`; 500/502 the boot
 * laws.
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
    const degraded = feedBootFailure("feeds.imports.delete.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.imports.delete", request, boot);
    if (!resolved.ok) return resolved.response;

    const result = await boot.feedImports.deleteImportRecords(
      resolved.identity.profileId,
      importId,
    );
    if (!result.ok) return feedFailureResponse(result.failure);
    return Response.json({ ok: true, removed: result.value.removed });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.imports.delete", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
