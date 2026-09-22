"use client";

/**
 * @wfx/app-web — the ARTWORK FALLBACK controller (R26-W2, lane B).
 *
 * THE HONEST FALLBACK LAW (the real-artwork contract's own): a source
 * artwork URL that fails to load (the source moved it, the network
 * refused, the URL expired) must fall back to the typed placeholder —
 * never a dead box, never a broken-image glyph. The placeholder already
 * renders UNDER every real artwork image in the server HTML (zero client
 * JS on the happy path — the images are plain server-rendered `<img>`
 * elements); this ONE island installs a single capturing `error`
 * listener that marks any failed artwork image with
 * `data-wfx-artwork-failed`, and the stylesheet hides the failed image so
 * the placeholder beneath shows through. One island per surface — never
 * one client component per card.
 *
 * (Image `error` events do not bubble, but they DO propagate through the
 * capture phase — the standard delegated-fallback technique.)
 */

import { useEffect, type JSX } from "react";

/** The failed-artwork marker (the stylesheet hides these images). */
export const ARTWORK_FAILED_ATTRIBUTE = "data-wfx-artwork-failed";

/** The artwork image selector this controller governs. */
const ARTWORK_IMAGE_SELECTOR = "[data-wfx-artwork-img]";

/** The null-rendering fallback controller island (mount once per surface). */
export function ArtworkFallback(): JSX.Element {
  useEffect(() => {
    const onImageError = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.matches(ARTWORK_IMAGE_SELECTOR)) return;
      if (target.hasAttribute(ARTWORK_FAILED_ATTRIBUTE)) return;
      target.setAttribute(ARTWORK_FAILED_ATTRIBUTE, "true");
    };
    window.addEventListener("error", onImageError, true);
    return () => {
      window.removeEventListener("error", onImageError, true);
    };
  }, []);
  return <span data-wfx-artwork-fallback-controller aria-hidden="true" />;
}
