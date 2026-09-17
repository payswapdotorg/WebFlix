/**
 * @wfx/app-web — the shorts page route (R07): GET /api/shorts.
 *
 * Supplies the Short Feed's re-rank loop with a FRESH page from the ONE
 * runtime: the shorts model (`runtime.shorts`) projected into the OS short
 * page shape (`host/shorts.ts` — the same projection the initial page
 * used). The client presenter applies the frozen replacement policy to it
 * (`planReplacement` — beyond-cursor only, prefetch window kept); this
 * route carries no ranking logic of its own.
 *
 * An erroring shorts read answers 502 with the typed failure detail — the
 * client surfaces it honestly (never a fabricated empty page).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";
import { loadShortsPayload } from "@/host/shorts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const host = await getWebRuntimeHost();
  try {
    const payload = await loadShortsPayload(host);
    if (payload.loadError !== null) {
      // The typed failure — the client renders the honest error state.
      return NextResponse.json(
        { error: `the short feed failed to load (${payload.loadError.kind}): ${payload.loadError.detail}` },
        { status: 502 },
      );
    }
    // The page only — identity/policy already live in the boot payload.
    return NextResponse.json({ page: payload.page }, { status: 200 });
  } catch (thrown) {
    return NextResponse.json(
      {
        error:
          thrown instanceof Error
            ? `the short feed failed to load: ${thrown.message}`
            : "the short feed failed to load",
      },
      { status: 502 },
    );
  }
}
