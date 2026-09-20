/**
 * @wfx/app-api — `GET /feeds/records?mode=webflix|following|byof|hybrid`
 * (R20-H transport contract).
 *
 * The imported feed records under one frozen read mode — the mode-truth
 * law's read surface: `webflix` is ALWAYS EMPTY (imported source-native
 * records are never re-labeled as WebFlix-ranked content — the shared
 * law, served honestly here, not filtered client-side); `following` is
 * the follow/subscription subset; `byof`/`hybrid` return the
 * source-native order (the store's own read order — order is DATA with
 * provenance, never a WebFlix rank).
 *
 * Identity: session-scoped OR the anonymous transition (headers, never
 * URLs — the profile is resolved server-side, never in the query).
 *
 * Typed answers: 200 (the records — `PersistedFeedRecord` shapes, plain
 * and serializable); 400 `invalid-request` (a missing or unknown mode);
 * 500/502 the boot laws.
 */

import { getApiBoot } from "@api/host/boot";
import { bootFailure } from "@api/host/http";
import { feedBootFailure, resolveFeedIdentity } from "@api/host/feed-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The closed mode vocabulary (the frozen `FeedPort.readFeed` modes). */
const READ_MODES: ReadonlySet<string> = new Set(["webflix", "following", "byof", "hybrid"]);

export async function GET(request: Request): Promise<Response> {
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode === null || !READ_MODES.has(mode)) {
    return Response.json(
      {
        error: "invalid-request",
        detail: `mode: expected one of ${[...READ_MODES].join(" | ")} (the frozen feed read modes), got '${mode ?? "absent"}'`,
      },
      { status: 400 },
    );
  }

  let boot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.records.boot", thrown);
    return degraded ?? bootFailure(thrown);
  }

  try {
    const resolved = await resolveFeedIdentity("feeds.records", request, boot);
    if (!resolved.ok) return resolved.response;
    const records = await boot.feedImports.readFeed(
      resolved.identity.profileId,
      mode as "webflix" | "following" | "byof" | "hybrid",
    );
    return Response.json({ records: [...records] });
  } catch (thrown) {
    const degraded = feedBootFailure("feeds.records.read", thrown);
    return degraded ?? bootFailure(thrown);
  }
}
