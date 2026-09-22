/**
 * @wfx/app-web — the REAL ARTWORK image markup (R26-W2, lane B).
 *
 * The server-rendered `<img>` over the typed placeholder fallback: the
 * source-authorized artwork URL (the connector's own thumbnail projection
 * through Worker 1's `ContentArtwork` contract) renders verbatim — the
 * source's own URL, the source's own cache policy, `loading="lazy"` so a
 * hundred-card discovery page never blocks on artwork, and a strict
 * referrer policy. The placeholder ALWAYS renders beneath (the server
 * HTML carries both): a URL that fails to load is hidden by the
 * ArtworkFallback controller and the placeholder shows through — the
 * honest fallback law, never a dead box, never a generated image
 * replacing an available source thumbnail.
 *
 * Server component: plain markup, zero client JS on the happy path.
 */

import type { JSX } from "react";

import type { ArtworkView } from "@/host/view-models";

/** The shared artwork image attributes (the honest loading discipline). */
const ARTWORK_IMG_ATTRS = {
  loading: "lazy",
  decoding: "async",
  referrerPolicy: "strict-origin-when-cross-origin" as const,
} as const;

/**
 * The artwork image: renders `null` when no real artwork exists (the
 * placeholder is the caller's own layer — this component never renders
 * one itself, so each surface keeps its own fallback grammar).
 * `alt=""` inside link contexts (the link's own label carries the title —
 * the image is decorative there); pass `alt` for standalone contexts
 * (the item detail's artwork, the hero).
 */
export function ArtworkImage({
  artwork,
  className,
  alt = "",
  eager = false,
}: {
  readonly artwork: ArtworkView;
  readonly className: string;
  /** The accessibility label (standalone contexts; empty inside links). */
  readonly alt?: string;
  /** Eager loading for above-the-fold artwork (the hero, the detail stage). */
  readonly eager?: boolean;
}): JSX.Element {
  return (
    <img
      className={className}
      src={artwork.url}
      alt={alt}
      {...(eager ? { loading: "eager" } : {})}
      decoding={ARTWORK_IMG_ATTRS.decoding}
      referrerPolicy={ARTWORK_IMG_ATTRS.referrerPolicy}
      data-wfx-artwork-img
      data-wfx-artwork-source={artwork.connectorId}
    />
  );
}
