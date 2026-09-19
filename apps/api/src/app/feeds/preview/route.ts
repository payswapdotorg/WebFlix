/**
 * @wfx/app-api — `POST /feeds/preview` (R20-H transport contract).
 *
 * Stage one feed import preview: capture the user's feed through the
 * REAL authorized connector (the R20-C `FeedImportService.previewFeedImport`
 * — connector capture → canonical identity resolution → preview staging)
 * and answer the staged preview WITH its display columns (the
 * escalation-4 read: title/externalRef — the user confirms WHAT THEY
 * SAW).
 *
 * Body: `{ connectorId, method?, relationships?, sourceRef?, artifact? }`
 * — the capture request. `artifact` is the user-supplied export/file
 * artifact, base64-encoded (required by the `official-export`/`user-file`
 * methods; the API route answers the typed `unsupported` verdict when the
 * connector honestly cannot serve those methods).
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs). The capture is stamped with the request's own locale/region
 * context.
 *
 * Typed answers: 200 (the staged preview); 400 garbage body / typed
 * `invalid-input`; 401 `unauthorized` (the grant is missing — the honest
 * failure lands its audit row and the body names the recovery path);
 * 404 `unknown-connector` (not wired in this deployment); 409
 * `unsupported` (capability truth); 502 `transport`/`provider`; 500/502
 * the boot laws.
 */

import { getApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  feedFailureResponse,
  readJsonBody,
} from "@api/host/http";
import { feedBootFailure, resolveFeedIdentity } from "@api/host/feed-request";
import { parseFeedPreviewBody } from "@api/host/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.preview.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);
  const parsed = parseFeedPreviewBody(body.value);
  if (!parsed.ok) {
    return Response.json(
      { error: "invalid-request", detail: parsed.problems.join("; ") },
      { status: 400 },
    );
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.preview", request, boot);
    if (!resolved.ok) return resolved.response;

    const result = await boot.feedImports.feedService().previewFeedImport({
      userId: resolved.identity.userId,
      profileId: resolved.identity.profileId,
      ctx: resolved.identity.ctx,
      connectorId: parsed.value.connectorId,
      ...(parsed.value.method !== undefined ? { method: parsed.value.method } : {}),
      ...(parsed.value.relationships !== undefined
        ? { relationships: parsed.value.relationships }
        : {}),
      ...(parsed.value.sourceRef !== undefined ? { sourceRef: parsed.value.sourceRef } : {}),
      ...(parsed.value.artifact !== undefined ? { artifact: parsed.value.artifact } : {}),
    });
    if (!result.ok) {
      return feedFailureResponse(result.error);
    }

    // The staged preview WITH display columns (escalation 4) — the same
    // answer `GET /feeds/preview/:importId` serves, so the client renders
    // exactly what was staged in one round trip.
    const staged = await boot.feedImports.readStagedPreview(result.value.importId);
    if (staged === null) {
      // The service staged the preview but the read-back failed — the
      // honest provider verdict (never a fabricated preview).
      return Response.json(
        {
          error: "provider",
          detail: `previewFeedImport: the staged preview '${result.value.importId}' could not be read back`,
        },
        { status: 502 },
      );
    }
    return Response.json({ preview: staged });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.preview.post", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
