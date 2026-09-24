/**
 * @wfx/app-web — `GET /api/preview` (R28-B): the hover preview's honest
 * capability-truth read.
 *
 * THE PREVIEW TRUTH LAW (the R24 preview law, the R28 corpus form): a card
 * previews ONLY where the item's own realizations provide previewable
 * media THIS platform can contain — the provider's real embed URL from
 * the SAME frozen resolve path playback uses (`serverPort.resolve`, the
 * frozen `GET /experience/resolve?ref=` transport). Never a fabricated
 * preview, never a placeholder loop: where no embed realization exists
 * the answer is `previewable: false` with the honest reason, and the card
 * keeps its static artwork (the gated state YouTube's own bot-blocked
 * sessions render — the thumbnail never blanks).
 *
 * The read is anonymous-frictionless (no login wall — a capability read,
 * the same law /api/capabilities keeps) and lazily called: ONE read per
 * hovered card (the dwell gate keeps unhovered cards unread — the page
 * render never pays for previews that never open). Answers cache per
 * host boot (the resolve truth for one ref does not change within a
 * boot; the cache is a plain Map with a FIFO bound — never a lie, at
 * worst a stale-but-once-true answer after a provider-side change).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";

export const dynamic = "force-dynamic";

/** One cached resolve answer (the previewable truth for one ref). */
interface PreviewResolveAnswer {
  readonly previewable: boolean;
  readonly url?: string;
  readonly reason?: string;
}

/** The per-boot cache: ref → answer (FIFO-bounded, never a second fetch for the same card). */
const resolveCache = new Map<string, PreviewResolveAnswer>();
const RESOLVE_CACHE_MAX = 256;

function cacheAnswer(ref: string, answer: PreviewResolveAnswer): void {
  if (resolveCache.size >= RESOLVE_CACHE_MAX) {
    const oldest = resolveCache.keys().next().value;
    if (oldest !== undefined) resolveCache.delete(oldest);
  }
  resolveCache.set(ref, answer);
}

/**
 * `GET /api/preview?connectorId=&ref=` — the hovered card's previewable
 * truth. Shape-validated like every route the client islands call; a
 * missing/short ref answers the typed 400 (never a guess).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const connectorId = params.get("connectorId") ?? "";
  const ref = params.get("ref") ?? "";
  if (ref.trim().length === 0 || connectorId.trim().length === 0) {
    return NextResponse.json(
      {
        previewable: false,
        reason: "invalid-input: the preview read needs the card's connectorId and ref",
      },
      { status: 400 },
    );
  }

  const cached = resolveCache.get(ref);
  if (cached !== undefined) {
    return NextResponse.json({ ok: true, ...cached });
  }

  const host = await getWebRuntimeHost();
  let answer: PreviewResolveAnswer;
  try {
    const result = await host.serverPort.resolve(ref);
    if (!result.ok) {
      answer = {
        previewable: false,
        reason: `${result.failure.kind}: the source did not answer the resolve for this item`,
      };
    } else {
      // The frozen precedence for PREVIEWS: the first EMBED realization
      // the web platform can contain (embed renders everywhere; browser/
      // native realizations never preview — the hover preview is the
      // provider's own contained embed, nothing else).
      const embed = result.value.find(
        (realization) =>
          realization.mode === "embed" &&
          typeof realization.url === "string" &&
          realization.url.length > 0,
      );
      answer =
        embed !== undefined && typeof embed.url === "string" && embed.url.length > 0
          ? { previewable: true, url: embed.url }
          : {
              previewable: false,
              reason:
                "no-previewable-media: this source provides no embed realization for the item",
            };
    }
  } catch {
    answer = {
      previewable: false,
      reason: "network: the resolve transport failed for this item",
    };
  }
  cacheAnswer(ref, answer);
  return NextResponse.json({ ok: true, ...answer });
}
