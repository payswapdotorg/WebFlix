/**
 * R26-W1 capability-truth tests (bun:test) — the production
 * capability-truth law over the REAL host bindings.
 *
 * THE GOLDEN RULE THIS FILE ENFORCES: internal fixture assertions are
 * engineering evidence, NEVER production acceptance evidence. Every
 * test here drives the REAL service-mode transport (a stubbed WIRE,
 * never a fixture row) or the REAL fixtures-boot transport, and asserts
 * the typed SERVED / NOT-SERVED truths the UI binds:
 *
 * - THE SERVICE TRANSPORT (ask #3): a 404 (the deployed Experience API
 *   has no /experience/intelligence route) answers the typed
 *   transport-unavailable truth naming the missing dependency — the
 *   HONEST not-served, never an approximation; a served 200 body
 *   becomes a served read (the wire guard validates); malformed
 *   payloads are REJECTED (never coerced).
 * - THE CAPABILITY REPORT (ask #1): every capability's truth derives
 *   from the live bindings — semantic search not-served on the service
 *   boot (the honest dependency), served (loudly badged) on the
 *   fixtures boot; the realtime bridge truth follows the boot gate; the
 *   artwork truth follows the content rows.
 * - THE REAL-ARTWORK WIRING (ask #2): a search hit carrying the
 *   connector's real `thumbnailUrl` flows into the card view (the URL
 *   verbatim, never replaced by generated artwork); a hit without
 *   artwork carries the honest absent field.
 * - THE PEER-REALIZATION CARRIAGE (ask #4): a content row declaring an
 *   authorized peer copy (the R23-C declaration under the well-known
 *   metadata key) flows into the Where-to-watch peer entry; an
 *   undeclared row answers the honest null.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { INTELLIGENCE_READ_ROUTE_PATH } from "@wfx/model-fabric";
import {
  capabilityMayRenderAsUsable,
  capabilityTruthOf,
  isCapabilityAvailabilityReport,
} from "@wfx/platform-contracts";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { intelligenceReadTransportOf } from "../src/host/intelligence";
import { searchByMeaning } from "../src/host/intelligence";
import { loadCapabilityAvailabilityReport } from "../src/host/capability-availability";
import { cardFromHit } from "../src/host/view-models";
import { joinedItemByExternalRef } from "../src/host/view-models";
import { torrentRealizationOf } from "../src/host/torrent-realizations";
import { withEnv, withFetchStub } from "./fake-web";
import type { SearchHit } from "@wfx/client-runtime";

beforeEach(() => {
  resetWebHostProcessState();
});

/** Boot the fixtures host under a controlled environment. */
async function bootFixtureHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** Boot the SERVICE host (a real WFX_API_BASE; reads run under a stubbed wire). */
async function bootServiceHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_API_BASE: "https://experience.example.test" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the service host did not boot");
  return host;
}

/** Run the service reads under the deterministic wire stub (the REAL transport path). */
async function withServiceWire<T>(
  respond: (url: string) => Response | Promise<Response>,
  body: () => Promise<T>,
): Promise<T> {
  const { result } = await withFetchStub(
    (call) => respond(call.url),
    body,
  );
  return result;
}

/** A search hit carrying the connector's real thumbnail. */
function hitWithArtwork(overrides: Partial<SearchHit["result"]> = {}): SearchHit {
  return {
    canonicalItemId: "wfxitm_00000000000000000000001",
    result: {
      connectorId: "youtube",
      externalRef: "vid-77",
      title: "Telescope Nights",
      canonicalType: "video",
      orientation: "horizontal",
      metadata: {
        rank: 1,
        thumbnailUrl: "https://i.ytimg.com/vi/vid-77/hqdefault.jpg",
      },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// The service transport (the real service-mode path — ask #3)
// ---------------------------------------------------------------------------

describe("the service intelligence transport (R26-W1)", () => {
  it("answers the typed transport-unavailable truth when the route is absent (the honest 404)", async () => {
    const host = await bootServiceHost();
    const view = await withServiceWire(
      (url) =>
        url.includes(INTELLIGENCE_READ_ROUTE_PATH)
          ? new Response("not found", { status: 404 })
          : Response.json([]),
      () => searchByMeaning(host, "a documentary about telescopes"),
    );
    expect(view.status).toBe("unavailable");
    expect(view.detail).toContain("not served by this transport");
    expect(view.detail).toContain("/experience/intelligence");
    expect(view.meaning).toHaveLength(0);
    expect(view.moments).toHaveLength(0);
    expect(view.meaningSearchAvailable).toBe(false);
  });

  it("answers the typed transport-unavailable truth on a network failure (never a fake empty result)", async () => {
    const host = await bootServiceHost();
    const view = await withServiceWire(
      () => {
        throw new Error("network down");
      },
      () => searchByMeaning(host, "telescopes"),
    );
    expect(view.status).toBe("unavailable");
    expect(view.detail).toContain("could not reach");
  });

  it("serves a truthful 200 body as a served read (the wire guard validates)", async () => {
    const servedSearch = {
      kind: "served",
      value: {
        meaning: [
          {
            itemId: "wfxitm_00000000000000000000002",
            connectorId: "youtube",
            externalRef: "vid-9",
            title: "Telescope Nights",
            matchedText: "telescopes photograph distant galaxies",
            score: 0.72,
          },
        ],
        moments: [
          {
            itemId: "wfxitm_00000000000000000000002",
            connectorId: "youtube",
            externalRef: "vid-9",
            title: "Telescope Nights",
            startMs: 41_000,
            endMs: 58_000,
            description: "the first image resolves",
            matchedText: null,
            score: 0.81,
          },
        ],
        provenance: [
          {
            stage: "text-embeddings",
            modelId: "open-model:bge-m3",
            modelRevision: "research-2026-09-20",
            confidence: 0.91,
            producedAt: "2026-09-18T12:00:00.000Z",
          },
        ],
        meaningSearchAvailable: true,
      },
    };
    const host = await bootServiceHost();
    const view = await withServiceWire(
      (url) =>
        url.includes(`${INTELLIGENCE_READ_ROUTE_PATH}?q=`)
          ? Response.json(servedSearch)
          : Response.json([]),
      () => searchByMeaning(host, "a documentary about telescopes"),
    );
    expect(view.status).toBe("ready");
    expect(view.meaning).toHaveLength(1);
    expect(view.meaning[0]?.matchedText).toContain("telescopes");
    expect(view.moments[0]?.startMs).toBe(41_000);
    expect(view.provenance[0]?.modelId).toBe("open-model:bge-m3");
    expect(view.meaningSearchAvailable).toBe(true);
  });

  it("REJECTS a malformed served body (never coerced into a served read)", async () => {
    const host = await bootServiceHost();
    const view = await withServiceWire(
      (url) =>
        url.includes(`${INTELLIGENCE_READ_ROUTE_PATH}?q=`)
          ? Response.json({ kind: "served", value: { nonsense: true } })
          : Response.json([]),
      () => searchByMeaning(host, "telescopes"),
    );
    expect(view.status).toBe("unavailable");
    expect(view.detail).toContain("failed the frozen intelligence-read guard");
  });

  it("carries the service's OWN typed not-served answer verbatim", async () => {
    const host = await bootServiceHost();
    const view = await withServiceWire(
      (url) =>
        url.includes(`${INTELLIGENCE_READ_ROUTE_PATH}?q=`)
          ? Response.json({
              kind: "not-served",
              reason: "no-derived-artifacts",
              detail: "no items have derived intelligence yet",
              dependency: "the derivation pipeline has not run",
            })
          : Response.json([]),
      () => searchByMeaning(host, "telescopes"),
    );
    expect(view.status).toBe("unavailable");
    expect(view.detail).toBe("no items have derived intelligence yet");
  });

  it("the transport's readiness names the missing dependency honestly", async () => {
    const host = await bootServiceHost();
    const readiness = await withServiceWire(
      (url) =>
        url.includes(INTELLIGENCE_READ_ROUTE_PATH)
          ? new Response("not found", { status: 404 })
          : Response.json([]),
      () => Promise.resolve(intelligenceReadTransportOf(host).readiness()),
    );
    expect(readiness.kind).toBe("not-serving");
    if (readiness.kind === "not-serving") {
      expect(readiness.dependency).toContain("the Experience API transport does not expose");
      expect(readiness.dependency).toContain("escalated to the lead");
    }
  });
});

// ---------------------------------------------------------------------------
// The capability report (ask #1 — the UI-bindable truth)
// ---------------------------------------------------------------------------

describe("the capability-availability report (R26-W1)", () => {
  it("the SERVICE boot: semantic/moment/multimodal honestly not-served with the named dependency + next action", async () => {
    const host = await bootServiceHost();
    const report = await withServiceWire(
      (url) =>
        url.includes(INTELLIGENCE_READ_ROUTE_PATH)
          ? new Response("not found", { status: 404 })
          : Response.json([]),
      () => loadCapabilityAvailabilityReport(host),
    );
    expect(isCapabilityAvailabilityReport(report)).toBe(true);
    for (const capability of [
      "semantic-search",
      "moment-retrieval",
      "multimodal-intelligence",
    ] as const) {
      const truth = capabilityTruthOf(report, capability);
      expect(truth?.kind).toBe("not-served");
      if (truth?.kind === "not-served") {
        expect(truth.detail).toContain("does not expose the intelligence route");
        expect(truth.detail).toContain("stay off honestly");
        expect(truth.nextAction?.label).toContain("Search by title");
      }
      // THE RENDER LAW: not-served NEVER renders as usable.
      expect(capabilityMayRenderAsUsable(report, capability)).toBe(false);
    }
    // The realtime bridge is honestly not serving on a service boot
    // without the bridge gate (the default test environment).
    const bridge = capabilityTruthOf(report, "realtime-bridge");
    expect(bridge?.kind).toBe("not-served");
    expect(capabilityMayRenderAsUsable(report, "realtime-bridge")).toBe(false);
    // The realization availability + artwork truths.
    const realization = capabilityTruthOf(report, "realization-availability");
    expect(realization?.kind).toBe("served");
    expect(realization?.detail).toContain("Desktop app's native peer path");
    const artwork = capabilityTruthOf(report, "artwork");
    expect(artwork?.kind).toBe("served");
  });

  it("the FIXTURES boot: the intelligence lane serves (loudly badged) and artwork is honestly not-served (the dev catalog carries none)", async () => {
    const host = await bootFixtureHost();
    const report = await loadCapabilityAvailabilityReport(host);
    const semantic = capabilityTruthOf(report, "semantic-search");
    expect(semantic?.kind).toBe("served");
    if (semantic?.kind === "served") {
      expect(semantic.transport).toBe("dev-fixture-index");
      expect(semantic.detail).toContain("fixture");
    }
    expect(capabilityMayRenderAsUsable(report, "semantic-search")).toBe(true);
    const artwork = capabilityTruthOf(report, "artwork");
    expect(artwork?.kind).toBe("not-served");
    if (artwork?.kind === "not-served") {
      expect(artwork.detail).toContain("dev fixture catalog carries no source artwork");
    }
    expect(capabilityMayRenderAsUsable(report, "artwork")).toBe(false);
  });

  it("every report row's truth is structurally guarded (the report fold rejects drift)", async () => {
    const host = await bootFixtureHost();
    const report = await loadCapabilityAvailabilityReport(host);
    expect(report.entries.length).toBe(6);
    for (const entry of report.entries) {
      expect(typeof entry.truth.transport).toBe("string");
      expect(entry.truth.detail.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The real-artwork host wiring (ask #2)
// ---------------------------------------------------------------------------

describe("the real-artwork wiring (R26-W1)", () => {
  it("a hit carrying the connector's real thumbnail flows into the card view verbatim", () => {
    const card = cardFromHit(hitWithArtwork());
    expect(card.artwork).toBeDefined();
    expect(card.artwork?.url).toBe("https://i.ytimg.com/vi/vid-77/hqdefault.jpg");
    expect(card.artwork?.aspectRatio).toBeCloseTo(16 / 9, 10);
    expect(card.artwork?.connectorId).toBe("youtube");
    expect(card.artwork?.altText).toContain("Telescope Nights");
    expect(card.artwork?.fallbackDetail).toContain("placeholder");
  });

  it("a hit WITHOUT artwork carries the honest absent field (never a fabricated URL)", () => {
    const card = cardFromHit(
      hitWithArtwork({ metadata: { rank: 1 } }),
    );
    expect(card.artwork).toBeUndefined();
  });

  it("a malformed artwork entry (a non-http URL) is rejected to the honest absent field", () => {
    const card = cardFromHit(
      hitWithArtwork({ metadata: { rank: 1, thumbnailUrl: "javascript:alert(1)" } }),
    );
    expect(card.artwork).toBeUndefined();
  });

  it("the join learns the artwork (the continue-watching surfaces render from it)", () => {
    cardFromHit(hitWithArtwork());
    const joined = joinedItemByExternalRef("youtube", "vid-77");
    expect(joined?.artwork?.url).toBe("https://i.ytimg.com/vi/vid-77/hqdefault.jpg");
  });
});

// ---------------------------------------------------------------------------
// The peer-realization carriage (ask #4)
// ---------------------------------------------------------------------------

describe("the peer-realization carriage (R26-W1)", () => {
  it("a content row declaring an authorized peer copy flows into the Where-to-watch peer entry", async () => {
    const host = await bootFixtureHost();
    // The service-mode read consults the learned join; learn a row with
    // a declaration (the well-known metadata key, the R23-C shape).
    const declared = hitWithArtwork({
      connectorId: "youtube",
      externalRef: "vid-peer",
      metadata: {
        rank: 1,
        torrentRealization: {
          transport: "torrent",
          authorized: true,
          browserCapable: true,
          accessClass: "public",
        },
      },
    });
    cardFromHit(declared);
    // The service boot reads the SAME learned join — but this test's
    // host is the fixtures boot (which reads the fixture feed). Force
    // the service-side path through the join by consulting the join
    // directly (the carriage law): the declared row's peer realization.
    const joined = joinedItemByExternalRef("youtube", "vid-peer");
    expect(joined?.peerRealization).toBeDefined();
    expect(joined?.peerRealization?.authorized).toBe(true);
    // The fixtures-boot read answers the fixture feed's own truth.
    const fixturePeer = torrentRealizationOf(host, "fake:video-1");
    expect(fixturePeer).not.toBeNull();
    if (fixturePeer !== null) {
      expect(fixturePeer.label).toContain("Authorized peer copy");
    }
  });

  it("an undeclared row answers the honest null (the entry never renders without a declaration)", async () => {
    const host = await bootFixtureHost();
    cardFromHit(hitWithArtwork());
    const undeclared = torrentRealizationOf(host, "vid-77", "youtube");
    // On the fixtures boot the fixture feed declares nothing for vid-77.
    expect(undeclared).toBeNull();
  });
});
