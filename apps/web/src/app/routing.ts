/**
 * @wfx/app-web — navigation-state ⇄ route mapping (R07).
 *
 * The runtime OWNS navigation and presentation state (the frozen layering
 * law — `@wfx/client-runtime` navigation.ts). This module is the ADAPTER'S
 * mapping between the runtime's `NavigationState` machine and the Next.js
 * routes this app serves: every product surface of the state machine gets
 * a real route, and every route maps back to its typed state. NO
 * navigation logic lives here — the transition table, payload validation,
 * and back-stack semantics are the runtime's; this is the honest
 * state ⇄ URL translation layer.
 *
 * ROUTE TABLE (every `SurfaceId` — the completeness law):
 *
 * | Surface   | Route                    | State payload                  |
 * |-----------|--------------------------|--------------------------------|
 * | home      | `/`                      | —                              |
 * | watch     | `/watch`                 | —                              |
 * | shorts    | `/shorts`                | —                              |
 * | search    | `/search?q=<query>`      | `query` (non-empty, trimmed)   |
 * | item      | `/item?...`              | `itemId` (canonical `wfxitm_`) |
 * | library   | `/library?section=<s>`   | `section?` (watchlist/history) |
 * | settings  | `/settings?section=<s>`  | `section?` (sources/model/general) |
 *
 * The `item` route additionally carries the ADAPTER data the detail/player
 * surfaces need (connector, ref, title, type, duration) — the runtime
 * state payload is the `id` (validated canonical); the rest is the source
 * identity the adapter joins (see `host/web-host.ts`'s canonical seam).
 *
 * DEEP-LINK LAW: `syncNavigationToRoute` RESETS the runtime's navigation
 * to the route's state (a deep link has no fabricated past — the runtime's
 * own law 5). An INVALID route payload (a non-canonical id, an empty
 * query) is answered with the typed invalid result and the navigation
 * stays on `home` — the surface then renders the honest error state,
 * never a guessed one.
 */

import type { ClientRuntime } from "@wfx/client-runtime";
import type {
  LibrarySection,
  NavigationState,
  SettingsSection,
  SurfaceId,
} from "@wfx/client-runtime";
import { isEntertainmentItemId } from "@wfx/domain";

import { canonicalIdFor } from "@/host/web-host";
import {
  SURFACE_ROUTES,
  itemDetailHref,
  playerHref,
  type ItemRouteTarget,
} from "@/app/href";

// R28-B — the PURE href builders now live in `@/app/href` (importable from
// client components; this adapter module pulls the web-host seam and its
// node:fs dev bridge, which client chunking contexts refuse). The routing
// adapter re-exports them unchanged for its existing importers.
export { SURFACE_ROUTES, itemDetailHref, playerHref };
export type { ItemRouteTarget };

/** The reverse lookup: route path → surface id. */
const ROUTE_SURFACES: Readonly<Record<string, SurfaceId>> = {
  "/": "home",
  "/watch": "watch",
  "/shorts": "shorts",
  "/search": "search",
  "/item": "item",
  "/library": "library",
  "/settings": "settings",
};

// ---------------------------------------------------------------------------
// State → URL
// ---------------------------------------------------------------------------

/**
 * The base href of one SURFACE (the un-parameterized route). The shell's
 * navigation consumes this; parameterized links go through the href
 * builders below.
 */
export function surfaceHref(surface: SurfaceId): string {
  switch (surface) {
    case "home":
    case "watch":
    case "shorts":
    case "search":
    case "item":
    case "library":
    case "settings":
      return SURFACE_ROUTES[surface];
  }
}

/** The href of one navigation state (the route table, parameterized). */
export function navigationStateToHref(state: NavigationState): string {
  switch (state.surface) {
    case "home":
      return SURFACE_ROUTES.home;
    case "watch":
      return SURFACE_ROUTES.watch;
    case "shorts":
      return SURFACE_ROUTES.shorts;
    case "search":
      return `${SURFACE_ROUTES.search}?q=${encodeURIComponent(state.query)}`;
    case "item": {
      const params = new URLSearchParams({ id: state.itemId });
      return `${SURFACE_ROUTES.item}?${params.toString()}`;
    }
    case "library":
      return state.section === undefined
        ? SURFACE_ROUTES.library
        : `${SURFACE_ROUTES.library}?section=${state.section}`;
    case "settings":
      return state.section === undefined
        ? SURFACE_ROUTES.settings
        : `${SURFACE_ROUTES.settings}?section=${state.section}`;
  }
}

// ---------------------------------------------------------------------------
// URL → state (typed, honest — an invalid payload is named, never guessed)
// ---------------------------------------------------------------------------

/** One search-params bag (the Next.js route input shape). */
export type RouteParams = Record<string, string | string[] | undefined>;

/** The typed outcome of deriving a navigation state from a route. */
export type RouteDerivation =
  | { readonly ok: true; readonly state: NavigationState }
  | { readonly ok: false; readonly reason: string };

/** Read one param (first value when repeated). */
function firstParam(params: RouteParams, name: string): string {
  const raw = params[name];
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

/**
 * Derive the navigation state a route asks for. The payload laws are the
 * runtime's own (`navigation.ts`): search needs a non-empty trimmed query,
 * item needs a canonical `wfxitm_` id, sections must be members of their
 * vocabularies. An invalid payload is the typed invalid result — the
 * caller renders the honest error state and syncs to home.
 */
export function deriveNavigationState(pathname: string, params: RouteParams): RouteDerivation {
  const surface = ROUTE_SURFACES[pathname];
  if (surface === undefined) {
    // Not a product-surface route (the player route is the adapter's
    // playback surface — a presentation route, not a navigation state;
    // the runtime's playback session owns it).
    if (pathname === "/player" || pathname === "/offline") {
      return { ok: false, reason: "presentation-route" };
    }
    return { ok: false, reason: `unknown route '${pathname}'` };
  }
  switch (surface) {
    case "home":
    case "watch":
    case "shorts":
      return { ok: true, state: { surface } };
    case "search": {
      const query = firstParam(params, "q").trim();
      if (query.length === 0) {
        return { ok: false, reason: "search requires a non-empty query (the empty state is the search box itself)" };
      }
      return { ok: true, state: { surface: "search", query } };
    }
    case "item": {
      const id = firstParam(params, "id");
      const connector = firstParam(params, "connector");
      const ref = firstParam(params, "ref");
      // The route carries the canonical id when linked from a surface that
      // knows it; a deep link without one is joined through the per-process
      // canonical seam (host/web-host.ts — the documented R04 stopgap).
      let itemId = id;
      if (itemId.length === 0 && connector.length > 0 && ref.length > 0) {
        itemId = canonicalIdFor(connector, ref);
      }
      if (!isEntertainmentItemId(itemId)) {
        return {
          ok: false,
          reason: `item requires a canonical wfxitm_ item id (got '${itemId.slice(0, 40)}')`,
        };
      }
      return { ok: true, state: { surface: "item", itemId } };
    }
    case "library": {
      const section = firstParam(params, "section");
      if (section.length === 0) return { ok: true, state: { surface: "library" } };
      if (section !== "watchlist" && section !== "history") {
        return { ok: false, reason: `library section must be watchlist | history (got '${section}')` };
      }
      return { ok: true, state: { surface: "library", section: section as LibrarySection } };
    }
    case "settings": {
      const section = firstParam(params, "section");
      if (section.length === 0) return { ok: true, state: { surface: "settings" } };
      if (section !== "sources" && section !== "model" && section !== "general") {
        return {
          ok: false,
          reason: `settings section must be sources | model | general (got '${section}')`,
        };
      }
      return { ok: true, state: { surface: "settings", section: section as SettingsSection } };
    }
  }
}

/**
 * Sync the runtime's navigation to the current route (the deep-link law:
 * `reset()` replaces everything with the route's state — no fabricated
 * past). An invalid derivation resets to home and answers the typed
 * failure so the surface can render the honest error state.
 */
export function syncNavigationToRoute(
  runtime: ClientRuntime,
  pathname: string,
  params: RouteParams,
): { readonly state: NavigationState; readonly invalidReason: string | null } {
  const derivation = deriveNavigationState(pathname, params);
  if (!derivation.ok) {
    if (derivation.reason === "presentation-route") {
      // The player/offline routes are presentation surfaces; the runtime's
      // navigation holds the state the user came from.
      return { state: runtime.navigation.current(), invalidReason: null };
    }
    runtime.navigation.reset({ surface: "home" });
    return { state: runtime.navigation.current(), invalidReason: derivation.reason };
  }
  runtime.navigation.reset(derivation.state);
  return { state: runtime.navigation.current(), invalidReason: null };
}

/** The nav href of every surface (the shell's navigation; stable order). */
export const SHELL_SURFACE_NAV: readonly { readonly surface: SurfaceId; readonly label: string }[] = [
  { surface: "home", label: "Home" },
  { surface: "watch", label: "Watch" },
  { surface: "shorts", label: "Shorts" },
  { surface: "search", label: "Search" },
  { surface: "library", label: "Library" },
  { surface: "settings", label: "Settings" },
];
