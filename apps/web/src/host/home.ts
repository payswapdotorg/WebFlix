/**
 * @wfx/app-web — the home surface data pipeline (WFX-050).
 *
 * The minimal-but-real home surface: boot the host, ask the shared
 * runtime for the watch feed, and project the frozen `FeedPage` into a
 * plain serializable view model for the React tree. NO feed logic is
 * reimplemented here — eligibility, card assembly, capability truth, and
 * id minting all live in the merged WFX-005 use-case; this module only
 * maps its output to view data.
 *
 * Stopgaps, visible and typed (owned by later productionization waves):
 * - The experience context is a fixed anonymous one — identity/session
 *   management is WFX-052's lane. It is a CONSTANT, not a hidden default:
 *   deterministic, auditable, and replaceable when auth lands.
 * - The home query is a fixed seed (`"rain"`) — the feed use-case is
 *   search-driven by frozen contract; the real home feed surface
 *   (source-neutral browse, recommendations) is WFX-051/055's lane.
 *
 * Honesty law: an empty or failed search is an EMPTY view (the frozen
 * plain-surface degrade law) — the surface shows "no content", never
 * fabricated cards and never a crash.
 */

import type { FeedCard } from "@wfx/experience";

import type { WebHost } from "./boot";

/**
 * The fixed anonymous experience context (identity is WFX-052's lane —
 * this constant is the visible, typed stopgap, never a hidden default).
 */
export const HOME_CONTEXT = {
  userId: "wfx-anonymous",
  sessionId: "wfx-web-host",
  locale: "en",
} as const;

/** The home feed surface (the long-form watch feed). */
export const HOME_SURFACE = "watch" as const;

/** The fixed seed query for the minimal home surface (see module doc). */
export const HOME_QUERY = "rain";

/** One projected feed card — plain data for the React tree. */
export interface HomeCardView {
  /** Canonical item id (`wfxitm_...`). */
  readonly itemId: string;
  /** Canonical title (fallback: the source's external ref, honestly). */
  readonly title: string;
  /** Canonical type (movie / series / video / ...). */
  readonly canonicalType: string;
  /** Duration in milliseconds when the source reported one. */
  readonly durationMs?: number;
  /** Source availability as the connector reported it. */
  readonly availability: string;
  /** The connector that sourced this card. */
  readonly connectorId: string;
  /** The connector-side external reference. */
  readonly externalRef: string;
}

/** The home surface view model — plain serializable data. */
export interface HomeView {
  /** The boot mode the host selected (fixtures / service). */
  readonly mode: "fixtures" | "service";
  /** The feed surface this view rendered. */
  readonly surface: "watch" | "short";
  /** The projected cards, in feed order. */
  readonly cards: readonly HomeCardView[];
}

/** Project one frozen feed card into the view shape. */
function projectCard(card: FeedCard): HomeCardView {
  return {
    itemId: card.item.id,
    title: card.item.canonicalTitle ?? card.realization.externalRef,
    canonicalType: card.item.canonicalType,
    ...(card.item.durationMs !== undefined ? { durationMs: card.item.durationMs } : {}),
    availability: card.realization.availability,
    connectorId: card.realization.connectorId,
    externalRef: card.realization.externalRef,
  };
}

/**
 * Load the home view through the shared runtime.
 *
 * Deterministic for a given host: the fixture mode is deterministic by
 * construction; the service mode returns whatever the configured service
 * answers (with the frozen degrade law — failures yield an empty page,
 * never fabricated cards).
 */
export async function loadHomeView(host: WebHost): Promise<HomeView> {
  const page = await host.client.runtime.getFeed(HOME_CONTEXT, HOME_SURFACE, HOME_QUERY);
  return {
    mode: host.mode,
    surface: page.surface,
    cards: page.cards.map(projectCard),
  };
}
