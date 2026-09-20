/**
 * @wfx/app-web — the feed-mode API route (R21-D).
 *
 * The bridge the Home / Watch / Shorts feed-mode control calls: the
 * R21-A store (`runtime.feedMode`) is the ONE owner of the presentation
 * state; this route is its typed transport.
 *
 * - `GET /api/feed-mode` → the current mode + the adapter-reported
 *   availability truth (re-derived from the real imported-feed data on
 *   every read — never a cached guess).
 * - `POST /api/feed-mode` `{ mode }` → the typed set. A non-vocabulary
 *   mode answers 400 (the store throws the typed invalid-input); an
 *   UNAVAILABLE mode answers 409 with the store's typed failure — the
 *   honest detail + the recovery hint (never a silent success, never a
 *   silent no-op — the R21-A law this surface binds to).
 */

import { NextResponse } from "next/server";

import { isFeedMode, isRuntimeError } from "@wfx/client-runtime";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";
import { loadFeedModeView } from "@/host/discoverability";

export const dynamic = "force-dynamic";

/**
 * R22-G fix: the route resolves the REQUEST-SCOPED host (the session law
 * the R22-D/F routes follow). Before, `getWebRuntimeHost()` wrote the
 * ANONYMOUS singleton's store — an authenticated session's feed-mode set
 * landed in the wrong host and the page (which resolves the identity's
 * host) never observed the change.
 */
async function hostFor(request: Request) {
  return getWebRuntimeHostForRequest(sessionTokenFromRequest(request) ?? undefined);
}

export async function GET(request: Request): Promise<NextResponse> {
  const host = await hostFor(request);
  const view = await loadFeedModeView(host);
  return NextResponse.json({
    mode: view.mode,
    options: view.options,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body: expected JSON" }, { status: 400 });
  }
  const mode =
    typeof body === "object" && body !== null
      ? (body as { mode?: unknown }).mode
      : undefined;
  if (typeof mode !== "string" || !isFeedMode(mode)) {
    return NextResponse.json(
      { error: "mode: expected one of foryou | following | byof | hybrid" },
      { status: 400 },
    );
  }

  const host = await hostFor(request);
  // The availability truth is re-derived before the set (the adapter's
  // honest report — a stale truth never blocks or admits a mode).
  await loadFeedModeView(host);
  try {
    const result = host.runtime.feedMode.set(mode);
    if (!result.ok) {
      // The typed refusal with the recovery hint — the surface renders
      // the next action; the mode is never silently selected.
      return NextResponse.json(
        {
          error: result.failure.detail,
          failure: {
            kind: result.failure.kind,
            mode: result.failure.mode,
            recoveryHint: result.failure.recoveryHint,
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ mode: result.mode });
  } catch (thrown) {
    if (isRuntimeError(thrown)) {
      return NextResponse.json({ error: thrown.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: thrown instanceof Error ? thrown.message : String(thrown) },
      { status: 500 },
    );
  }
}
