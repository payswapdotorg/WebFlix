/**
 * @wfx/app-web — `POST /api/shorts-session` (R33-A): the shorts media
 * stage's playback-session mint.
 *
 * THE SESSION LAW (the watch surface's own seam, surveyed): the shorts
 * surface's plays record through the SAME session machinery the watch
 * surface uses — this route is the THIN server seam over
 * `host/shorts.ts`'s `resolveShortsPlaybackSession` (the player page's
 * media path in its minimal form: the embed realization lookup → the
 * runtime's own `resolvePlayback` → `controller.prepare()` → the playback
 * bridge's `recordPlaybackSession`). The stage mints the session at its
 * first provider-reported PLAYING evidence, then issues its runtime
 * commands through `POST /api/playback` and folds its watch-state reports
 * through `POST /api/events` exactly as the watch surface's chrome does —
 * resume truth and watch state stay coherent across surfaces.
 *
 * Honesty laws (the house style):
 * - shape-validated body (a malformed body answers the typed 400 — never
 *   a guess);
 * - a resolution that cannot complete answers the TYPED outcome with
 *   `ok: false` (200 — the same answer form /api/playback keeps), never a
 *   fabricated session id;
 * - anonymous-frictionless (no login wall — the R23 anonymous-playback
 *   boundary law: public playback never routes a viewer to a login).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";
import { resolveShortsPlaybackSession } from "@/host/shorts";

export const dynamic = "force-dynamic";

/**
 * `POST /api/shorts-session` `{ itemId, connectorId, externalRef }` —
 * mint the current shorts card's playback session through the same seam
 * the watch surface uses.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body: expected JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body: expected a JSON object" }, { status: 400 });
  }
  const input = body as { itemId?: unknown; connectorId?: unknown; externalRef?: unknown };
  if (
    typeof input.itemId !== "string" ||
    input.itemId.length === 0 ||
    typeof input.connectorId !== "string" ||
    input.connectorId.length === 0 ||
    typeof input.externalRef !== "string" ||
    input.externalRef.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          "expected { itemId: string, connectorId: string, externalRef: string } — the card's own realization identity",
      },
      { status: 400 },
    );
  }

  const host = await getWebRuntimeHost();
  const outcome = await resolveShortsPlaybackSession(host, {
    itemId: input.itemId,
    connectorId: input.connectorId,
    externalRef: input.externalRef,
  });
  return NextResponse.json(outcome, { status: 200 });
}
