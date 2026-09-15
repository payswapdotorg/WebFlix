/**
 * @wfx/app-web — the shorts page route (WFX-051): GET /api/shorts.
 *
 * Supplies the Short Feed's re-rank loop with a FRESH projected OS short
 * page: the short-surface feed through the 050 host boot law, joined
 * identities, projected into the OS page shape (`host/shorts.ts` — the same
 * projection the initial page used). The client presenter applies the
 * frozen replacement policy to it (`planReplacement` — beyond-cursor only,
 * prefetch window kept); this route carries no ranking logic of its own.
 *
 * Deterministic per process in fixtures mode (the same seed answers the
 * same page — the re-rank then honestly replaces nothing, with typed
 * reasons carried to the UI).
 */

import { NextResponse } from "next/server";

import { bootExperienceHost } from "@/host/experience";
import { loadShortsPayload } from "@/host/shorts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const host = bootExperienceHost();
  try {
    const payload = await loadShortsPayload(host);
    // The page only — identity/policy already live in the booted client.
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
