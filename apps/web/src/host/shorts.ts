/**
 * @wfx/app-web — the shorts payload projection (R07).
 *
 * Projects the RUNTIME's shorts model (`runtime.shorts()` — canonical-
 * joined hits) into the frozen OS short-page shape the WFX-028 presenter
 * (`components/shorts/ShortsFeed`) consumes, with the session identity and
 * the RUNTIME's current attention-mode policy view (the runtime owns
 * policy; this projection never invents a second one).
 *
 * The frozen laws (unchanged): `buildShortCards`'s vertical-first
 * ordering, the presenter's replacement semantics, and the honest absence
 * of model scores (no model ran — the ranking OS is R05's lane; the
 * explanations carry the feed position, never a fabricated score).
 *
 * An error/empty shorts model projects to an EMPTY page (the honest empty
 * state downstream, never fabricated cards); the typed failure is carried
 * so the surface can render the error state.
 */

import type { RecommendationPolicy } from "@wfx/domain";
import { DEFAULT_PREFETCH_AHEAD, type ShortFeedCard, type ShortFeedPage } from "@wfx/experience";
import type { SearchHit } from "@wfx/client-runtime";

import type { WebRuntimeHost } from "./web-host";
import { SHORTS_SEED_QUERY } from "./view-models";

/** The serializable payload the shorts surface boots from. */
export interface ShortsBootPayload {
  /** The projected OS short page (canonical-joined, JSON-safe). */
  readonly page: ShortFeedPage;
  /** The runtime's current policy view, projected to the frozen policy shape. */
  readonly policy: RecommendationPolicy;
  /** The experience identity (events are stamped with it server-side). */
  readonly userId: string;
  readonly sessionId: string;
  /** The seed query the page was composed from (re-supply re-runs it). */
  readonly seedQuery: string;
  /** The default prefetch window (the presenter's documented default). */
  readonly prefetchAhead: number;
  /** The typed failure when the shorts read failed (the honest error state). */
  readonly loadError: { readonly kind: string; readonly detail: string } | null;
}

/** One hit projected into the frozen short-page card shape. */
function shortFeedCardOf(hit: SearchHit, index: number): ShortFeedCard {
  return {
    position: index,
    candidate: {
      itemId: hit.canonicalItemId,
      realization: {
        connectorId: hit.result.connectorId,
        externalRef: hit.result.externalRef,
        capabilities: [], // the runtime's search hits carry no capability claim — honest
        availability: "unknown",
      },
      features: {
        canonicalType: hit.result.canonicalType ?? "video",
        canonicalTitle: hit.result.title,
        ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
        ...(hit.result.orientation !== undefined ? { orientation: hit.result.orientation } : {}),
      },
    },
    modelScore: null, // no model ran — never a fabricated score
    confidence: null,
    explanations: [],
    dominantObjective: null,
    positionReasons: [`feed position ${index}`],
  };
}

/**
 * Project the runtime's shorts model into the OS page shape (the page the
 * presenter consumes). The frozen `buildShortCards` ordering law (vertical-
 * first, typed-tailed non-vertical items) applies inside the presenter,
 * which reads THIS page.
 */
export function projectShortsPage(
  userId: string,
  sessionId: string,
  hits: readonly SearchHit[],
): ShortFeedPage {
  return {
    surface: "short",
    userId,
    sessionId,
    cards: hits.map((hit, index) => shortFeedCardOf(hit, index)),
  };
}

/**
 * Load the shorts boot payload from the RUNTIME: the shorts model, the
 * session identity, and the runtime's policy view (balanced default until
 * the user changes it — R05's controls land later).
 */
export async function loadShortsPayload(host: WebRuntimeHost): Promise<ShortsBootPayload> {
  const model = await host.runtime.shorts({ query: SHORTS_SEED_QUERY });
  const policyView = host.runtime.intents.policy();
  const policy: RecommendationPolicy = {
    id: "wfx-web-session-current",
    userId: host.session.context.userId,
    objectives: [],
    exploration: policyView.exploration,
    novelty: policyView.novelty,
    socialInfluence: policyView.socialInfluence,
    attentionMode: policyView.attentionMode,
  };
  return {
    page: projectShortsPage(host.session.context.userId, host.session.context.sessionId, model.hits),
    policy,
    userId: host.session.context.userId,
    sessionId: host.session.context.sessionId,
    seedQuery: SHORTS_SEED_QUERY,
    prefetchAhead: DEFAULT_PREFETCH_AHEAD,
    loadError:
      model.status.state === "error"
        ? { kind: model.status.error?.kind ?? "unavailable", detail: model.status.error?.detail ?? "the shorts read failed" }
        : null,
  };
}
