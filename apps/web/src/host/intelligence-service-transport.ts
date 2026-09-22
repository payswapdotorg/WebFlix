/**
 * @wfx/app-web — the SERVICE intelligence read transport (R26-W1).
 *
 * The service boot's {@link IntelligenceReadTransport} binding: the
 * REAL HTTP transport over the Experience API's intelligence route
 * (`GET {base}/experience/intelligence?q=|item=` — the frozen wire
 * contract `@wfx/model-fabric`'s `INTELLIGENCE_READ_ROUTE_PATH`). This
 * replaces the old `host.mode !== "fixtures" ⇒ honest empty` GATE with
 * a REAL service-mode path: the read is attempted over the live
 * transport and the OUTCOME carries the truth.
 *
 * THE HONEST DEPENDENCY (named, never approximated): the deployed
 * Experience API (byte-identical since R23-L) does not expose the
 * intelligence route yet — a 404/405 therefore answers the typed
 * `transport-unavailable` outcome naming the exact missing dependency
 * ("the Experience API transport does not expose
 * /experience/intelligence yet — the service-side route is the missing
 * dependency, escalated to the lead"). The day the API lane lands the
 * route, this transport serves it with ZERO host changes (the wire
 * vocabulary is ONE contract — `@wfx/model-fabric`).
 *
 * LAWS (the same family `auth-transport.ts` keeps):
 *
 * - TYPED OUTCOMES — every read answers `IntelligenceReadOutcome`; a
 *   network failure, a 5xx, a non-JSON body, or a wrong-shaped payload
 *   is the typed `transport-unavailable` truth (malformed payloads are
 *   REJECTED — never coerced into a served read), never a crash, never
 *   a fake empty result.
 * - NO FABRICATION — the transport NEVER fabricates artifacts, scores,
 *   or provenance from catalog metadata; only the API's validated
 *   served answers become served reads.
 * - DETERMINISM — no clock, no randomness; `fetch` is injectable
 *   (tests stub it and run offline).
 */

import {
  INTELLIGENCE_READ_ITEM_PARAM,
  INTELLIGENCE_READ_QUERY_PARAM,
  INTELLIGENCE_READ_ROUTE_PATH,
  isIntelligenceItemReadWire,
  isIntelligenceReadNotServedWire,
  isIntelligenceSearchReadWire,
} from "@wfx/model-fabric";
import type {
  IntelligenceItemRead,
  IntelligenceReadOutcome,
  IntelligenceReadTransport,
  IntelligenceSearchRead,
  IntelligenceTransportReadiness,
} from "@wfx/model-fabric";

// ---------------------------------------------------------------------------
// The honest sentences (one derivation source)
// ---------------------------------------------------------------------------

/**
 * THE DEPENDENCY SENTENCE — the escalation truth every
 * transport-unavailable outcome carries (the lead-owned dependency:
 * the service-side intelligence route + the derived-artifact store +
 * the derivation pipeline that feeds it).
 */
export const SERVICE_INTELLIGENCE_DEPENDENCY =
  "the Experience API transport does not expose /experience/intelligence yet — the service-side route (and the derived-artifact store + derivation pipeline behind it) is the missing production dependency, escalated to the lead" as const;

/** The not-served outcome for a missing route/failed transport. */
function transportUnavailable(detail: string): IntelligenceReadOutcome<never> {
  return {
    kind: "not-served",
    reason: "transport-unavailable",
    detail,
    dependency: SERVICE_INTELLIGENCE_DEPENDENCY,
    nextAction: {
      label: "Title search and the AI action tray still work",
      href: "/search",
      detail:
        "Search by title serves every item; per-title AI actions (transcription, translation) run through the AI tray on the item page.",
    },
  };
}

/** The honest transport identity. */
export const SERVICE_INTELLIGENCE_TRANSPORT_ID = "experience-api-http" as const;

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/** Options for the service transport (the injectable seams). */
export interface ServiceIntelligenceTransportOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /** The fetch implementation (default: the global `fetch`; tests inject a stub). */
  readonly fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds (default 8 000; `0` disables). */
  readonly timeoutMs?: number;
}

/** Build one request URL (the frozen wire vocabulary). */
function readUrl(apiBase: URL, params: URLSearchParams): URL {
  return new URL(
    `${apiBase.href}${INTELLIGENCE_READ_ROUTE_PATH}?${params.toString()}`,
  );
}

/** The closed error classes mapped to the typed outcome (never thrown). */
async function fetchOutcome(
  url: URL,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<
  { ok: true; body: unknown } | { ok: false; detail: string; routeAbsent: boolean }
> {
  let response: Response;
  try {
    response = await fetchImpl(url.href, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (thrown) {
    const reason = thrown instanceof Error ? thrown.name : "network";
    return {
      ok: false,
      routeAbsent: false,
      detail: `The intelligence transport could not reach the Experience API (${reason}) — semantic and moment reads stay off honestly rather than approximated.`,
    };
  }
  if (response.status === 404 || response.status === 405) {
    return {
      ok: false,
      routeAbsent: true,
      detail:
        "Semantic intelligence is not served by this transport yet — the Experience API deployment has no /experience/intelligence route. It stays off honestly rather than approximated.",
    };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      routeAbsent: false,
      detail: `The Experience API failed serving the intelligence read (HTTP ${response.status}) — the read stays off honestly rather than approximated.`,
    };
  }
  if (response.status >= 400) {
    return {
      ok: false,
      routeAbsent: false,
      detail: `The intelligence read was rejected by the Experience API (HTTP ${response.status}).`,
    };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      routeAbsent: false,
      detail:
        "The Experience API answered the intelligence read with a non-JSON payload — rejected, never coerced into a served read.",
    };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return {
      ok: false,
      routeAbsent: false,
      detail:
        "The Experience API answered the intelligence read with a malformed JSON body — rejected, never coerced into a served read.",
    };
  }
}

/**
 * The service-boot intelligence read transport: the REAL HTTP binding
 * over the Experience API's intelligence route. Answers the typed
 * served/not-served outcome on every path — including the honest
 * `transport-unavailable` truth while the service-side route is the
 * escalated missing dependency.
 */
export function createServiceIntelligenceReadTransport(
  options: ServiceIntelligenceTransportOptions,
): IntelligenceReadTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const readiness: IntelligenceTransportReadiness = {
    kind: "not-serving",
    transport: SERVICE_INTELLIGENCE_TRANSPORT_ID,
    detail:
      "The Experience API does not expose the intelligence route on this deployment — semantic search, moment retrieval, and multimodal intelligence stay off honestly rather than approximated.",
    dependency: SERVICE_INTELLIGENCE_DEPENDENCY,
  };

  /**
   * The per-boot ROUTE-ABSENT memo (the same per-process truth law the
   * realtime bridge state keeps): once a hard 404/405 observes the route
   * absent on THIS transport instance, later reads answer the same
   * typed outcome without re-probing — no clock, no TTL, honest for the
   * instance's lifetime (a deploy cycles the process; the truth
   * re-derives on the next boot). Transient failures (network/5xx) are
   * NEVER memoized — only the structural absence is.
   */
  let routeAbsentDetail: string | null = null;

  const read = async <T>(
    params: URLSearchParams,
    guard: (body: unknown) => body is T,
    scope: string,
  ): Promise<IntelligenceReadOutcome<T>> => {
    if (routeAbsentDetail !== null) {
      return transportUnavailable(routeAbsentDetail);
    }
    const outcome = await fetchOutcome(
      readUrl(options.apiBase, params),
      fetchImpl,
      timeoutMs,
    );
    if (!outcome.ok) {
      if (outcome.routeAbsent) routeAbsentDetail = outcome.detail;
      return transportUnavailable(outcome.detail);
    }
    const body = (outcome.body as Record<string, unknown> | null) ?? {};
    if (isIntelligenceReadNotServedWire(body)) {
      // The service's OWN typed not-served answer rides verbatim.
      return {
        kind: "not-served",
        reason: body.reason,
        detail: body.detail,
        dependency: body.dependency,
        ...(body.nextAction !== undefined ? { nextAction: body.nextAction } : {}),
      };
    }
    if (body.kind !== "served" || !guard((body as Record<string, unknown>).value)) {
      return transportUnavailable(
        `The Experience API's ${scope} answer failed the frozen intelligence-read guard — rejected, never coerced into a served read.`,
      );
    }
    return { kind: "served", value: (body as { value: T }).value };
  };

  return {
    transportId: SERVICE_INTELLIGENCE_TRANSPORT_ID,
    readiness: () => readiness,
    searchByMeaning: (query) =>
      read<IntelligenceSearchRead>(
        new URLSearchParams({ [INTELLIGENCE_READ_QUERY_PARAM]: query }),
        isIntelligenceSearchReadWire,
        "search-by-meaning",
      ),
    itemArtifacts: (externalRef) =>
      read<IntelligenceItemRead>(
        new URLSearchParams({ [INTELLIGENCE_READ_ITEM_PARAM]: externalRef }),
        isIntelligenceItemReadWire,
        "item-artifacts",
      ),
  };
}
