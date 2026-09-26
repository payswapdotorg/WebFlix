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
// R32 — the G4 rail's channel truths: the Subscriptions named-list constant
// (the frozen list name the REAL subscribe seam writes — the same the watch
// page's pill, the rail subscriptions, and the subscriptions feed use).
import { SUBSCRIPTIONS_LIST } from "@/components/player/subscription-list";

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
  /**
   * R32 — the G4 rail's channel identity truth: the sources model's own
   * display names (connectorId → displayName — the N29 seam the watch
   * page's channel row reads). Empty when the read fails (the connector
   * id stays the honest fallback identity — never a fabricated channel).
   */
  readonly sourceNames: Readonly<Record<string, string>>;
  /**
   * R32 — the G4 channel row's subscribed truth (the REAL subscribe
   * seam's state, read at boot through the same library folds every
   * subscribe surface reads): the STORED rows' source identities (the
   * durable cross-load key — `connectorId` + `externalRef`, the watch
   * page's own reload-durability law) + the local fold's canonical item
   * ids (the R30-A hydrate seam). The feed keeps the record current
   * with the pill's writes.
   */
  readonly subscriptions: {
    readonly sourceKeys: readonly { readonly connectorId: string; readonly externalRef: string }[];
    readonly itemIds: readonly string[];
  };
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
 *
 * R32 — the G4 rail's channel truths ride the same payload: the sources
 * model's display names (one refresh — the N29 seam) + the Subscriptions
 * named-list truth (the stored read by SOURCE identity + the local fold
 * after the R30-A hydrate — the watch page's dual law, never a second
 * source of library truth).
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
  // R32 — the channel identity truth: the sources model's own display
  // names (the N29 seam — the same read the watch page's channel row
  // performs). A failing read keeps the map empty: the connector id is
  // the honest fallback identity, never a fabricated channel name.
  const sourceNames: Record<string, string> = {};
  try {
    const sources = await host.runtime.sources.refresh();
    for (const source of sources.sources) {
      if (typeof source.displayName === "string" && source.displayName.trim().length > 0) {
        sourceNames[source.connectorId] = source.displayName;
      }
    }
  } catch {
    // The sources read failed: the connector id stays the identity.
  }
  // R32 — the subscribed truth (the watch page's dual law): the STORED
  // profile library joined by SOURCE identity (the durable cross-load
  // key — the reload-durability law) + the local fold's canonical ids
  // (the R30-A hydrate seam — memoized per engine, one server read).
  const subscriptionSourceKeys: { connectorId: string; externalRef: string }[] = [];
  try {
    const storedRead = await host.serverPort.readProfileLibrary();
    if (storedRead.ok) {
      for (const entry of storedRead.value) {
        const list = (entry.metadata as Record<string, unknown> | undefined)?.list;
        const listName = typeof list === "string" && list.length > 0 ? list : "Saved";
        if (listName === SUBSCRIPTIONS_LIST) {
          subscriptionSourceKeys.push({ connectorId: entry.connectorId, externalRef: entry.externalRef });
        }
      }
    }
  } catch {
    // The stored read failed: the local fold below answers (the same
    // degradation the watch page's read follows — never a fabricated
    // unsubscribed claim when the truth is unreadable).
  }
  await host.runtime.libraryOps.hydrate();
  const subscriptionItemIds = host.runtime.libraryOps
    .entries()
    .filter((entry) => entry.listName === SUBSCRIPTIONS_LIST)
    .map((entry) => entry.itemId);
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
    sourceNames,
    subscriptions: { sourceKeys: subscriptionSourceKeys, itemIds: subscriptionItemIds },
  };
}
