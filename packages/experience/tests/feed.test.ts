import { describe, expect, it } from "bun:test";
import type { SearchResult } from "@wfx/domain";

import {
  ExperienceError,
  SHORT_FORM_MAX_DURATION_MS,
  FIXTURE_CAPABILITIES,
  FIXTURE_CONNECTOR_ID,
  isShortFormCandidate,
  isWatchFormCandidate,
  makeFixturePorts,
  getFeed,
  type ConnectorPort,
  type ExperienceContext,
  type FeedPage,
  type Ports,
} from "../src/index";

const CTX: ExperienceContext = { userId: "user-1", sessionId: "sess-1", locale: "en", region: "EU" };

function expectSingleCard(page: FeedPage): NonNullable<FeedPage["cards"][number]> {
  expect(page.cards).toHaveLength(1);
  const card = page.cards[0];
  if (card === undefined) throw new Error("expected exactly one card");
  return card;
}

/** Build a Ports bundle around a custom connector (keeps fixture clock/ids/sink). */
function portsWithConnector(connector: ConnectorPort): Ports {
  const base = makeFixturePorts();
  return { connector, events: base.events, clock: base.clock, ids: base.ids };
}

describe("feed classification (content decides, never the source)", () => {
  it("short-form: vertical orientation, square orientation, 'short' type, bounded duration", () => {
    expect(isShortFormCandidate({ id: "wfxitm_00000000000000000000000000", canonicalType: "short" })).toBe(true);
    expect(
      isShortFormCandidate({ id: "wfxitm_00000000000000000000000000", canonicalType: "video", orientation: "vertical" }),
    ).toBe(true);
    expect(
      isShortFormCandidate({ id: "wfxitm_00000000000000000000000000", canonicalType: "video", orientation: "square" }),
    ).toBe(true);
    expect(
      isShortFormCandidate({
        id: "wfxitm_00000000000000000000000000",
        canonicalType: "video",
        durationMs: SHORT_FORM_MAX_DURATION_MS,
      }),
    ).toBe(true);
    expect(
      isShortFormCandidate({ id: "wfxitm_00000000000000000000000000", canonicalType: "movie" }),
    ).toBe(false); // long-form type, no orientation/duration
  });

  it("watch-form: long-form types, horizontal orientation, long duration", () => {
    for (const canonicalType of ["movie", "series", "episode", "audio"] as const) {
      expect(
        isWatchFormCandidate({ id: "wfxitm_00000000000000000000000000", canonicalType }),
      ).toBe(true);
    }
    expect(
      isWatchFormCandidate({
        id: "wfxitm_00000000000000000000000000",
        canonicalType: "video",
        orientation: "horizontal",
      }),
    ).toBe(true);
    expect(
      isWatchFormCandidate({
        id: "wfxitm_00000000000000000000000000",
        canonicalType: "video",
        durationMs: SHORT_FORM_MAX_DURATION_MS + 1,
      }),
    ).toBe(true);
    expect(
      isWatchFormCandidate({ id: "wfxitm_00000000000000000000000000", canonicalType: "short" }),
    ).toBe(false); // short type, no orientation/duration
  });

  it("an item can be eligible for both surfaces; the session context picks the feed", () => {
    const both = {
      id: "wfxitm_00000000000000000000000000",
      canonicalType: "video" as const,
      orientation: "horizontal" as const,
      durationMs: 60_000,
    };
    expect(isShortFormCandidate(both)).toBe(true);
    expect(isWatchFormCandidate(both)).toBe(true);
  });
});

describe("getFeed (WFX-005)", () => {
  it("splits one query across surfaces by CONTENT eligibility", async () => {
    const ports = makeFixturePorts();

    const watch = await getFeed(ports, CTX, { surface: "watch", query: "rain" });
    expect(watch.surface).toBe("watch");
    expect(watch.cards.map((card) => card.item.canonicalTitle)).toEqual(["Desert Rain Doc"]);

    const short = await getFeed(ports, CTX, { surface: "short", query: "rain" });
    expect(short.surface).toBe("short");
    expect(short.cards.map((card) => card.item.canonicalTitle)).toEqual(["Neon Rain", "Rain Check"]);
  });

  it("keeps the connector's search-result order (deterministic)", async () => {
    const ports = makeFixturePorts();
    const page = await getFeed(ports, CTX, { surface: "short", query: "rain" });
    // Catalog order: fake:short-1 (Neon Rain) precedes fake:short-3 (Rain Check).
    expect(page.cards.map((card) => card.realization.externalRef)).toEqual([
      "fake:short-1",
      "fake:short-3",
    ]);

    const again = await getFeed(makeFixturePorts(), CTX, { surface: "short", query: "rain" });
    expect(again.cards.map((card) => card.realization.externalRef)).toEqual([
      "fake:short-1",
      "fake:short-3",
    ]);
  });

  it("assembles a full card from search + metadata (capabilities preserved)", async () => {
    const ports = makeFixturePorts();
    const page = await getFeed(ports, CTX, { surface: "watch", query: "drift" });
    const card = expectSingleCard(page);

    expect(card.item.canonicalType).toBe("movie");
    expect(card.item.canonicalTitle).toBe("Asteroid Drift");
    expect(card.item.durationMs).toBe(7_200_000);
    expect(card.item.orientation).toBe("horizontal");
    expect(card.item.id).toMatch(/^wfxitm_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

    expect(card.realization.connectorId).toBe(FIXTURE_CONNECTOR_ID);
    expect(card.realization.externalRef).toBe("fake:movie-1");
    expect(card.realization.id).toMatch(/^wfxsrc_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(card.realization.entertainmentItemId).toBe(card.item.id);
    expect(card.realization.availability).toBe("available");
    // Per-item capabilities from metadata, within the declared capability truth.
    expect(card.realization.capabilities).toEqual([
      "playNative",
      "playEmbed",
      "playBrowser",
      "playExternal",
    ]);
  });

  it("falls back to connector-level capability truth when metadata is absent", async () => {
    const ports = makeFixturePorts();
    const page = await getFeed(ports, CTX, { surface: "watch", query: "bloom" });
    const card = expectSingleCard(page);

    expect(card.realization.availability).toBe("unknown");
    expect(card.realization.capabilities).toEqual([...FIXTURE_CAPABILITIES]);
  });

  it("mints canonical ids and keeps realization linkage per card", async () => {
    const ports = makeFixturePorts();
    const page = await getFeed(ports, CTX, { surface: "short", query: "rain" });
    expect(page.cards).toHaveLength(2);
    const seenIds = new Set<string>();
    for (const card of page.cards) {
      expect(seenIds.has(card.item.id)).toBe(false);
      seenIds.add(card.item.id);
      expect(card.realization.entertainmentItemId).toBe(card.item.id);
    }
  });

  it("produces an EMPTY page (never a fake card, never a thrown generic error) on no matches", async () => {
    const ports = makeFixturePorts();
    const page = await getFeed(ports, CTX, { surface: "watch", query: "zzz-nothing" });
    expect(page).toEqual({ surface: "watch", cards: [] });
  });

  it("produces an EMPTY page when search is unsupported (no catalogSearch capability)", async () => {
    const ports = makeFixturePorts({ capabilities: ["metadata", "playEmbed"] });
    const page = await getFeed(ports, CTX, { surface: "watch", query: "drift" });
    expect(page).toEqual({ surface: "watch", cards: [] });
  });

  it("produces an EMPTY page when the port's search rejects (plain-surface law)", async () => {
    const broken: ConnectorPort = {
      descriptor: () => makeFixturePorts().connector.descriptor(),
      search: () => Promise.reject(new Error("transport exploded")),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve({ status: "failed", occurredAt: "2026-09-13T00:00:00.000Z" }),
    };
    const page = await getFeed(portsWithConnector(broken), CTX, { surface: "short", query: "rain" });
    expect(page).toEqual({ surface: "short", cards: [] });
  });

  it("produces an EMPTY page when the port returns a non-array", async () => {
    const malformed: ConnectorPort = {
      descriptor: () => makeFixturePorts().connector.descriptor(),
      search: () => Promise.resolve("garbage" as unknown as SearchResult[]),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve({ status: "failed", occurredAt: "2026-09-13T00:00:00.000Z" }),
    };
    const page = await getFeed(portsWithConnector(malformed), CTX, { surface: "watch", query: "drift" });
    expect(page).toEqual({ surface: "watch", cards: [] });
  });

  it("skips malformed hits and foreign hits — no fabricated cards", async () => {
    const hits: SearchResult[] = [
      { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "", title: "No Ref" }, // malformed: empty ref
      { connectorId: "other-source", externalRef: "other:1", title: "Foreign" }, // foreign connector
      {
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        title: "Good Hit",
        canonicalType: "movie",
        durationMs: 7_200_000,
        orientation: "horizontal",
      },
    ];
    const connector: ConnectorPort = {
      descriptor: () => makeFixturePorts().connector.descriptor(),
      search: () => Promise.resolve(hits),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve({ status: "failed", occurredAt: "2026-09-13T00:00:00.000Z" }),
    };
    const page = await getFeed(portsWithConnector(connector), CTX, { surface: "watch", query: "x" });
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0]?.realization.externalRef).toBe("fake:movie-1");
  });

  it("drops hits without a canonical type — never fabricates a classification", async () => {
    const hits: SearchResult[] = [
      { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:untyped-1", title: "Untyped" },
    ];
    const connector: ConnectorPort = {
      descriptor: () => makeFixturePorts().connector.descriptor(),
      search: () => Promise.resolve(hits),
      metadata: () => Promise.resolve(null),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve({ status: "failed", occurredAt: "2026-09-13T00:00:00.000Z" }),
    };
    const page = await getFeed(portsWithConnector(connector), CTX, { surface: "watch", query: "x" });
    expect(page.cards).toEqual([]);
  });

  it("treats mismatched metadata as absent (card keeps connector-level truth)", async () => {
    const hits: SearchResult[] = [
      {
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:movie-1",
        title: "Asteroid Drift",
        canonicalType: "movie",
        durationMs: 7_200_000,
        orientation: "horizontal",
      },
    ];
    const connector: ConnectorPort = {
      descriptor: () => makeFixturePorts().connector.descriptor(),
      search: () => Promise.resolve(hits),
      metadata: (_ctx, ref) =>
        Promise.resolve(
          ref === "fake:movie-1"
            ? {
                // Metadata for a DIFFERENT ref — must not be spliced into the card.
                connectorId: FIXTURE_CONNECTOR_ID,
                externalRef: "fake:other-9",
                title: "Wrong Item",
                availability: "available",
                capabilities: ["playEmbed"],
              }
            : null,
        ),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve({ status: "failed", occurredAt: "2026-09-13T00:00:00.000Z" }),
    };
    const page = await getFeed(portsWithConnector(connector), CTX, { surface: "watch", query: "x" });
    const card = expectSingleCard(page);
    expect(card.item.canonicalTitle).toBe("Asteroid Drift"); // hit title, not the mismatched metadata
    expect(card.realization.availability).toBe("unknown"); // metadata treated as absent
  });

  it("intersects metadata capabilities with the declared capability truth", async () => {
    const hits: SearchResult[] = [
      {
        connectorId: FIXTURE_CONNECTOR_ID,
        externalRef: "fake:liar-1",
        title: "Liar Item",
        canonicalType: "movie",
      },
    ];
    const connector: ConnectorPort = {
      descriptor: () => makeFixturePorts().connector.descriptor(), // declares playEmbed etc., NOT download
      search: () => Promise.resolve(hits),
      metadata: () =>
        Promise.resolve({
          connectorId: FIXTURE_CONNECTOR_ID,
          externalRef: "fake:liar-1",
          title: "Liar Item",
          availability: "available",
          capabilities: ["playEmbed", "download", "not-a-capability"], // claims beyond the truth
        }),
      resolve: () => Promise.resolve([]),
      executeAction: () => Promise.resolve({ status: "failed", occurredAt: "2026-09-13T00:00:00.000Z" }),
    };
    const page = await getFeed(portsWithConnector(connector), CTX, { surface: "watch", query: "x" });
    const card = expectSingleCard(page);
    expect(card.realization.capabilities).toEqual(["playEmbed"]); // only declared, known caps survive
  });

  it("throws the typed ExperienceError for malformed caller input (never a generic error)", async () => {
    const ports = makeFixturePorts();
    await expect(getFeed(ports, CTX, { surface: "watch", query: "   " })).rejects.toBeInstanceOf(
      ExperienceError,
    );
    await expect(
      getFeed(ports, CTX, { surface: "weird" as unknown as "watch", query: "x" }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      getFeed(ports, { userId: "", sessionId: "s", locale: "en" }, { surface: "watch", query: "x" }),
    ).rejects.toBeInstanceOf(ExperienceError);
  });
});
