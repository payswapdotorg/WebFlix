/**
 * @wfx/app-api — `POST /feeds/imports/[importId]/disconnect` (R20-H
 * transport contract).
 *
 * Disconnect one import — the NON-DESTRUCTIVE undo (J33: "undo/disconnect
 * import without destructive library deletion"). The fold is W2's law
 * verbatim (ratified by the lead): the precondition is RECORD OWNERSHIP
 * (not the status label — a confirmed import keeps its disconnect path
 * through every durable state), the import's grant is marked missing BY
 * USER CHOICE (`reauthorization-required`) carrying the
 * `Import disconnected by the user` marker prefix, and the records are
 * RETAINED (`markSyncOutcome` never deletes — the survival law). The
 * marker prefix is what the adapters derive the distinct "Disconnected —
 * records retained" presentation from.
 *
 * NEVER the delete path: deleting imported records is the SEPARATE
 * explicit `delete-records` operation — never a side effect of a
 * disconnect.
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs).
 *
 * Typed answers: 200 `{ importId }`; 404 `not-found`; 400
 * `invalid-input` (a staged preview or failed attempt owns no records —
 * there is nothing to retain); 500/502 the boot laws.
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
    const degraded = feedBootFailure("feeds.imports.disconnect.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.imports.disconnect", request, boot);
    if (!resolved.ok) return resolved.response;

    const result = await boot.feedImports.disconnectImport(resolved.identity.profileId, importId);
    if (!result.ok) return feedFailureResponse(result.failure);
    return Response.json({ ok: true, importId: result.value.importId });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.imports.disconnect", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
