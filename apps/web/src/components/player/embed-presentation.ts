/**
 * @wfx/app-web — the provider embed presentation law (R28-B extraction).
 *
 * THE EMBED PRESENTATION GRAMMAR both embed surfaces share — the player
 * page's EmbedStage (R26-W2) and the R28-B hover preview singleton. The
 * law stays ONE law wherever a provider embed mounts:
 *
 * - the CONTROL-BOUND family (YouTube) serves from the provider's own
 *   PRIVACY-ENHANCED embed host (`www.youtube-nocookie.com` — the
 *   provider's documented cookie-free surface; a separate origin and
 *   cookie jar, so the provider's page never sees the viewer's
 *   youtube.com session);
 * - the provider's own `enablejsapi` parameter rides the src wherever
 *   the provider documents an embed control API (the sanctioned
 *   postMessage channel — never script injection, never inspection);
 * - every other provider keeps the strictest OPAQUE-ORIGIN posture.
 *
 * R28-B — ONE-CLICK/ONE-HOVER PLAY: the family's src additionally carries
 * the provider's own documented `autoplay=1&mute=1` pair (muted autoplay
 * is the one autoplay browsers permit without a same-document gesture;
 * the preview mounts on the pointer's dwell — the hover IS the gesture
 * context YouTube's own preview uses, and the sound stays honestly OFF
 * until the unmute affordance).
 */

/** The provider's own privacy-enhanced embed hosts (the cookie-free surface). */
export const YOUTUBE_PRIVACY_EMBED_HOST = "www.youtube-nocookie.com";

/** The YouTube embed hosts the privacy host substitution covers. */
export const YOUTUBE_EMBED_HOSTS: ReadonlySet<string> = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
]);

/**
 * The providers whose documented embed control API a stage binds. A URL
 * outside these families keeps the opaque-origin posture (nothing is
 * bound, nothing needs the provider's origin).
 */
export function providerFamilyOf(url: string): "youtube" | "unknown" {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isYouTubeHost = YOUTUBE_EMBED_HOSTS.has(host) || host === YOUTUBE_PRIVACY_EMBED_HOST;
    if (isYouTubeHost && parsed.pathname.startsWith("/embed/")) return "youtube";
  } catch {
    // A non-parsable URL never reaches an embed stage (the surface validates).
  }
  return "unknown";
}

/**
 * The CONTROL-BOUND embed's sandbox tokens (the provider's player needs
 * its own origin for its documented control channel — the empirically
 * verified iframe-security restriction; identity isolation is preserved
 * by the privacy-host domain separation, not by breaking the player).
 */
export const CONTROL_BOUND_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation";

/** The opaque-origin tokens (the strictest posture — the no-control embed's). */
export const OPAQUE_ORIGIN_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-presentation";

/**
 * The presentation src: the provider's embed URL with the provider's own
 * embed-API parameter, served from the provider's own privacy-enhanced
 * host where the control channel binds. The additions are the provider's
 * own documented embed mechanisms (the privacy host, the control switch,
 * the muted-autoplay pair) — the video id, the path, and every provider
 * parameter stay verbatim.
 */
export function presentationSrcOf(url: string): string {
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
