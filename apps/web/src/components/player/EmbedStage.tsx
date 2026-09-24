"use client";

/**
 * @wfx/app-web — the provider EMBED STAGE (R26-W2): the embed rung's
 * contained iframe with the provider's own embed control contract bound.
 *
 * THE CONTAINMENT LAW (R09, the R26-W2 corrective refinement — verified
 * empirically on the real provider, classified honestly as an
 * iframe-security restriction): the provider's DOCUMENTED embed control
 * API (the postMessage channel the R26-W2 client binds) cannot function
 * in an OPAQUE-origin sandbox — the provider's player never answers the
 * listening handshake without `allow-same-origin` (reproduced: opaque
 * sandbox ⇒ 0 provider messages; `allow-same-origin` ⇒ the provider's
 * own `initialDelivery` with its full command interface). The two laws —
 * opaque-origin cookie isolation AND the provider's own control channel —
 * are mutually exclusive for the embed rung.
 *
 * The lawful combination this stage now keeps, per containment INTENT:
 *
 * - the CONTROL-BOUND embed (the YouTube family) loads from the provider's
 *   own PRIVACY-ENHANCED embed host (`www.youtube-nocookie.com` — the
 *   provider's documented cookie-free embed surface) with
 *   `sandbox="allow-scripts allow-same-origin ..."`: the provider's player
 *   keeps its own origin (the control channel answers), while the viewer's
 *   provider IDENTITY stays isolated — `youtube-nocookie.com` is a
 *   separate origin with a separate cookie jar, so the provider's page
 *   cannot see or attach the viewer's `youtube.com` session. Identity
 *   isolation is preserved by the provider's own domain separation
 *   (the provider's published privacy mechanism), not by breaking the
 *   provider's player.
 * - the NO-CONTROL embed (every other provider) keeps the strictest
 *   posture VERBATIM: the opaque-origin sandbox without
 *   `allow-same-origin`, exactly as before (nothing is bound, nothing
 *   needs the provider's origin).
 * - BOTH postures keep the invariant core of the frozen law: the provider
 *   page stays PROVIDER-OWNED — no script injection, no content
 *   inspection (the cross-origin boundary enforces it in both), strict
 *   referrer policy, and the BROWSER rung's contained surface
 *   (`platform/browser-host.ts`) keeps its opaque-origin sandbox law
 *   VERBATIM — this refinement is the EMBED rung's alone.
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

import { useEffect, useRef, useSyncExternalStore, type JSX } from "react";

import {
  bindActiveEmbedSession,
  getActiveEmbedControl,
  getActiveEmbedSessionController,
  idleEmbedControlSnapshot,
  subscribeActiveEmbedControl,
} from "@/components/player/embed-session-client";

/** The provider's own privacy-enhanced embed hosts (the cookie-free surface). */
const YOUTUBE_PRIVACY_EMBED_HOST = "www.youtube-nocookie.com";

/** The YouTube embed hosts the privacy host substitution covers. */
const YOUTUBE_EMBED_HOSTS: ReadonlySet<string> = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
]);

/** The providers whose documented embed control API the stage binds. */
function providerFamilyOf(url: string): "youtube" | "unknown" {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isYouTubeHost =
      YOUTUBE_EMBED_HOSTS.has(host) || host === YOUTUBE_PRIVACY_EMBED_HOST;
    if (isYouTubeHost && parsed.pathname.startsWith("/embed/")) return "youtube";
  } catch {
    // A non-parsable URL never reaches this stage (the surface validates).
  }
  return "unknown";
}

/**
 * The sandbox tokens of the CONTROL-BOUND embed: the provider's player
 * needs its own origin (`allow-same-origin`) for its documented embed
 * control channel to answer (the empirical iframe-security restriction
 * above); the viewer's provider identity stays isolated through the
 * provider's privacy-enhanced embed host (a separate origin + cookie
 * jar), so the provider page never sees the viewer's `youtube.com`
 * session. The no-control embed keeps the opaque-origin tokens VERBATIM.
 */
const CONTROL_BOUND_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation";

/** The opaque-origin tokens (the strictest posture — the no-control embed's). */
const OPAQUE_ORIGIN_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-presentation";

/**
 * The presentation src: the provider's embed URL with the provider's own
 * embed-API parameter where the family documents one, served from the
 * provider's own privacy-enhanced embed host where the control channel
 * binds (the provider's published cookie-free surface for the SAME embed
 * — the video id, the path, and every provider parameter stay verbatim;
 * the additions are the provider's own documented embed mechanisms:
 * the privacy host and the published control switch).
 *
 * R28-B — ONE-CLICK PLAY: the YouTube family's src additionally carries
 * the provider's own documented `autoplay=1&mute=1` pair (muted autoplay
 * is the one autoplay every browser permits without a same-document user
 * gesture — the card click IS the gesture, but the navigation consumes
 * the activation, so unmuted autoplay would be blocked and the video
 * would sit paused: exactly the operator's "click 3 times" complaint).
 * The stage's UNMUTE AFFORDANCE (below) restores the sound with one click
 * through the provider's own control channel — the click-to-play path is
 * ONE click, and the sound is one more, honestly.
 */
function presentationSrcOf(url: string): string {
  if (providerFamilyOf(url) !== "youtube") return url;
  try {
    const parsed = new URL(url);
    if (YOUTUBE_EMBED_HOSTS.has(parsed.hostname.toLowerCase())) {
      parsed.hostname = YOUTUBE_PRIVACY_EMBED_HOST;
    }
    if (!parsed.searchParams.has("enablejsapi")) {
      parsed.searchParams.set("enablejsapi", "1");
    }
    if (!parsed.searchParams.has("autoplay")) {
      parsed.searchParams.set("autoplay", "1");
      parsed.searchParams.set("mute", "1");
    }
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
  const controlBound = provider === "youtube";
  // R28-B — the provider-reported mute truth drives the unmute affordance.
  const embedControl = useSyncExternalStore(
    subscribeActiveEmbedControl,
    getActiveEmbedControl,
    idleEmbedControlSnapshot,
  );

  // Bind the provider's embed control contract for this stage's life.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    if (!controlBound) return; // no documented control channel — the honest pre-R26 path
    const bound = bindActiveEmbedSession({
      iframe: frame,
      provider,
      itemId,
      playbackSessionId,
    });
    return bound.unbind;
  }, [controlBound, provider, itemId, playbackSessionId, url]);

  return (
    <div
      className="wfx-player__stage"
      data-wfx-player-mode="embed"
      data-wfx-embed-attestation={attestation ?? "none"}
      data-wfx-embed-control={controlBound ? "bound" : "unsupported-provider"}
      data-wfx-embed-containment={controlBound ? "privacy-host" : "opaque-origin"}
      {...(containedSurfaceId !== null ? { "data-wfx-contained-surface": containedSurfaceId } : {})}
    >
      <iframe
        ref={frameRef}
        src={src}
        title={`Embedded playback: ${title}`}
        sandbox={controlBound ? CONTROL_BOUND_SANDBOX : OPAQUE_ORIGIN_SANDBOX}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        data-wfx-player-frame
      />
      {controlBound && embedControl.muted === true ? (
        <button
          type="button"
          className="wfx-player__unmute"
          data-wfx-player-unmute
          onClick={() => {
            getActiveEmbedSessionController()?.setMuted(false);
          }}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
            <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
            <path d="m16 9.5 5 5m0-5-5 5" />
          </svg>
          Sound off — tap to unmute
        </button>
      ) : null}
      <p className="wfx-player__trace" data-wfx-embed-note>
        {attestation === "official"
          ? controlBound
            ? "Official provider embed on the provider's own privacy-enhanced host — the provider's player keeps its own controls, which WebFlix's player binds with the provider's published embed API; your provider sign-in stays invisible to this surface, and WebFlix never injects into or inspects the provider page."
            : "Official provider embed — the provider exposed this player for embedding, contained and cookie-isolated by WebFlix."
          : "Embedded playback in a contained surface — the realization carries no provider official-embed attestation, named honestly; WebFlix never injects into or inspects the provider page, and binds only the provider's own published embed player controls."}
      </p>
    </div>
  );
}
