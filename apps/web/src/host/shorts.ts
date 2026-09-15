/**
 * @wfx/app-web — the Short Feed page projection (WFX-051).
 *
 * The frozen Short Feed model (WFX-028) consumes the ALREADY-COMPOSED OS
 * short page — the `ShortFeedPage` structural mirror of the WFX-021
 * `FeedPage` (candidate-based). The host owns this projection (the
 * documented wiring contract in packages/experience/src/short/react.ts):
 * the WFX-005 feed use-case's output (`FeedCard`s) is projected into the
 * OS page shape, with the HOST-SUPPLIED canonical items joined by id
 * (the identity join of `host/canon.ts`, authoritative over candidate
 * projections — the WFX-027 item-index law).
 *
 * No ranking, ordering, or eligibility logic lives here: the frozen
 * `buildShortCards` (vertical-first ordering, typed-tailed non-vertical
 * items) and the presenter (`createShortFeedPresenter`) do all of it.
 *
 * The payload for the client is plain JSON (the page + the session's
 * fixed policy + identity), so the client component rebuilds the stack
 * through the SAME frozen presenter the server used — one law, two runtimes.
 */

import { DEFAULT_PREFETCH_AHEAD, type FeedCard, type ShortFeedPage } from "@wfx/experience";

import type { ExperienceHost } from "./experience";
import { EXPERIENCE_CONTEXT, SESSION_POLICY, SHORTS_QUERY } from "./experience";
import { joinFeedCards } from "./canon";

/** The serializable payload the shorts surface boots from. */
export interface ShortsBootPayload {
  /** The projected OS short page (joined identities, JSON-safe). */
  readonly page: ShortFeedPage;
  /** The fixed session policy (typed stopgap — see host/experience.ts). */
  readonly policy: typeof SESSION_POLICY;
  /** The experience identity (events are stamped with it server-side). */
  readonly userId: string;
  readonly sessionId: string;
  /** The seed query the page was composed from (re-supply re-runs it). */
  readonly seedQuery: string;
  /** The default prefetch window (the presenter's documented default). */
  readonly prefetchAhead: number;
}

/**
 * Project joined feed cards into the OS short page shape. Features carry
 * the documented candidate feature keys (`canonicalType`, `canonicalTitle`,
 * `durationMs`, `orientation`) — never invented ones. Model scores are
 * absent (null) because no model ran: the shell composes from the feed
 * use-case, and the ranking OS (WFX-055) owns scoring. Honesty over
 * decoration.
 */
export function projectShortsPage(cards: readonly FeedCard[]): ShortFeedPage {
  return {
    surface: "short",
    userId: EXPERIENCE_CONTEXT.userId,
    sessionId: EXPERIENCE_CONTEXT.sessionId,
    cards: cards.map((card, index) => ({
      position: index,
      candidate: {
        itemId: card.item.id,
        realization: {
          connectorId: card.realization.connectorId,
          externalRef: card.realization.externalRef,
          capabilities: [...card.realization.capabilities],
          availability: card.realization.availability,
        },
        features: shortFeatures(card),
      },
      modelScore: null,
      confidence: null,
      explanations: [],
      dominantObjective: null,
      positionReasons: [`feed position ${index}`],
    })),
  };
}

/** The documented feature keys, verbatim from the item (never invented). */
function shortFeatures(card: FeedCard): Record<string, number | string | boolean> {
  const features: Record<string, number | string | boolean> = {
    canonicalType: card.item.canonicalType,
  };
  if (card.item.canonicalTitle !== undefined) features.canonicalTitle = card.item.canonicalTitle;
  if (card.item.durationMs !== undefined) features.durationMs = card.item.durationMs;
  if (card.item.orientation !== undefined) features.orientation = card.item.orientation;
  return features;
}

/**
 * Load the shorts boot payload: the short-surface feed (frozen short-form
 * eligibility decides what enters — this projection never re-filters) and
 * the session constants. An empty/failed feed is an EMPTY page — the
 * honest empty state downstream, never fabricated cards.
 */
export async function loadShortsPayload(host: ExperienceHost): Promise<ShortsBootPayload> {
  const page = await host.client.runtime.getFeed(EXPERIENCE_CONTEXT, "short", SHORTS_QUERY);
  const joined = joinFeedCards(page.cards);
  return {
    page: projectShortsPage(joined),
    policy: SESSION_POLICY,
    userId: EXPERIENCE_CONTEXT.userId,
    sessionId: EXPERIENCE_CONTEXT.sessionId,
    seedQuery: SHORTS_QUERY,
    prefetchAhead: DEFAULT_PREFETCH_AHEAD,
  };
}
