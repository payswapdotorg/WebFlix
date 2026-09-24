/**
 * @wfx/app-web — the PURE href builders (R28-B).
 *
 * The href grammar (`/item`, `/player` parameterized URLs) as PURE
 * functions with ZERO host imports — importable from CLIENT components
 * (the routing adapter re-exports these; `@/app/routing` itself pulls
 * the web-host seam and its node:fs dev bridge, which the client chunking
 * context refuses — the honest split: the URL grammar is pure, the
 * state-derivation is the adapter's).
 */

import type { SurfaceId } from "@wfx/client-runtime";

/** The route path of every product surface (the completeness law). */
export const SURFACE_ROUTES: Readonly<Record<SurfaceId, string>> = {
  home: "/",
  watch: "/watch",
  shorts: "/shorts",
  search: "/search",
  item: "/item",
  library: "/library",
  settings: "/settings",
};

/**
 * The adapter data an item link carries alongside the canonical id: the
 * source identity the detail/player surfaces need (a `CardView` satisfies
 * this structurally).
 */
export interface ItemRouteTarget {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
}

/** The detail-page href for one item target (state + adapter source data). */
export function itemDetailHref(target: ItemRouteTarget): string {
  const params = new URLSearchParams({
    id: target.itemId,
    connector: target.connectorId,
    ref: target.externalRef,
    title: target.title,
    type: target.canonicalType,
  });
  if (target.durationMs !== undefined) params.set("duration", String(target.durationMs));
  return `${SURFACE_ROUTES.item}?${params.toString()}`;
}

/** The player-page href for one item target (optionally with resume). */
export function playerHref(target: ItemRouteTarget, resumePositionMs?: number): string {
  const params = new URLSearchParams({
    id: target.itemId,
    connector: target.connectorId,
    ref: target.externalRef,
    title: target.title,
    type: target.canonicalType,
  });
  if (target.durationMs !== undefined) params.set("duration", String(target.durationMs));
  if (resumePositionMs !== undefined && resumePositionMs > 0) {
    params.set("resume", String(resumePositionMs));
  }
  return `/player?${params.toString()}`;
}
