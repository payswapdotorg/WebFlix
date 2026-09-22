"use client";

/**
 * @wfx/app-web — the provider EMBED STAGE (R26-W2): the embed rung's
 * contained iframe with the provider's own embed control contract bound.
 *
 * THE UNCHANGED CONTAINMENT LAW (R09): the provider's player runs inside
 * the SAME sandboxed, opaque-origin, cookie-isolated iframe as before —
 * `sandbox` without `allow-same-origin`, strict referrer policy, provider
 * page stays provider-owned. Nothing is injected into the frame and
 * nothing is inspected.
 *
 * THE R26-W2 ADDITION (client-side realization control): where the
 * provider's embed URL identifies a provider that DOCUMENTS an embed
 * control API (YouTube's iframe player), the iframe src carries the
 * provider's own `enablejsapi` parameter — the provider's switch for its
 * published embedder control channel — and this stage binds that channel
 * through {@link bindActiveEmbedSession}: the chrome's transport commands
 * reach the provider's own player, and the provider's own state
 * broadcasts become the only evidence that advances WebFlix's visible
 * phase (the first frame is REAL — provider-reported — never fabricated).
 * A provider without a live answer keeps the honest pre-R26 behavior
 * unchanged (the provider's in-frame controls are the real path; the
 * settings cluster discloses the truth).
 */

import { useEffect, useRef, type JSX } from "react";

import { bindActiveEmbedSession } from "@/components/player/embed-session-client";

/** The providers whose documented embed control API the stage binds. */
function providerFamilyOf(url: string): "youtube" | "unknown" {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isYouTubeHost =
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "www.youtube-nocookie.com";
    if (isYouTubeHost && parsed.pathname.startsWith("/embed/")) return "youtube";
  } catch {
    // A non-parsable URL never reaches this stage (the surface validates).
  }
  return "unknown";
}

/**
 * The presentation src: the provider's embed URL with the provider's own
 * embed-API parameter where the family documents one (the endpoint, the
 * video, and every provider parameter stay verbatim — the only addition
 * is the provider's published control switch).
 */
function presentationSrcOf(url: string): string {
  if (providerFamilyOf(url) !== "youtube") return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("enablejsapi")) return url;
    parsed.searchParams.set("enablejsapi", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The embed stage (the contained iframe + the provider control binding). */
export function EmbedStage({
  url,
  title,
  attestation,
  containedSurfaceId,
  itemId,
  playbackSessionId,
}: {
  /** The contained surface's URL (the engaged surface's, else the realization's). */
  readonly url: string;
  readonly title: string;
  /** The honest attestation truth ("official" | "unofficial" | null). */
  readonly attestation: string | null;
  /** The engaged contained-surface id (present iff the host opened one). */
  readonly containedSurfaceId: string | null;
  /** The canonical item id (the watch-state reports' binding). */
  readonly itemId: string;
  /** The page's playback session id (the reports' correlation). */
  readonly playbackSessionId: string;
}): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const provider = providerFamilyOf(url);
  const src = presentationSrcOf(url);

  // Bind the provider's embed control contract for this stage's life.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    if (provider !== "youtube") return; // no documented control channel — the honest pre-R26 path
    const bound = bindActiveEmbedSession({
      iframe: frame,
      provider,
      itemId,
      playbackSessionId,
    });
    return bound.unbind;
  }, [provider, itemId, playbackSessionId, url]);

  return (
    <div
      className="wfx-player__stage"
      data-wfx-player-mode="embed"
      data-wfx-embed-attestation={attestation ?? "none"}
      data-wfx-embed-control={provider === "youtube" ? "bound" : "unsupported-provider"}
      {...(containedSurfaceId !== null ? { "data-wfx-contained-surface": containedSurfaceId } : {})}
    >
      <iframe
        ref={frameRef}
        src={src}
        title={`Embedded playback: ${title}`}
        sandbox="allow-scripts allow-forms allow-popups allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        data-wfx-player-frame
      />
      <p className="wfx-player__trace" data-wfx-embed-note>
        {attestation === "official"
          ? "Official provider embed — the provider exposed this player for embedding, contained and cookie-isolated by WebFlix."
          : "Embedded playback contained in a cookie-isolated surface — the realization carries no provider official-embed attestation, named honestly; WebFlix never injects into or inspects the provider page, and binds only the provider's own published embed player controls."}
      </p>
    </div>
  );
}
