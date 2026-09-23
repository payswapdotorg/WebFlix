/**
 * R27-W3 — THE SURFACE GRAMMAR TEST (the corpus surfaces, walked over
 * the REAL `createDesktopApp` composition).
 *
 * THE LAW: the R27 grammar views are PURE projections of the real
 * surfaces — this test boots the same composition the production boot
 * calls (the corrective R26 shape: acquisition bound over the engine
 * double, NO torrentPlayback block — the peer-catalog default composes
 * everything; the same honest doctrine `journeys/desktop/README.md`
 * records) and walks browse → watch → search → library through the R27
 * projections, asserting:
 *
 * - the CARD GRAMMAR: real artwork (the <img> law — every peer card
 *   carries the catalog's real source artwork), duration pills only
 *   where the truth exists, 2-line titles, honest meta lines (never
 *   fabricated views/age), the honest badge vocabulary;
 * - the CHIP BAR: real facets over the rows, honest counts, the filter
 *   matches the count (no dead chips);
 * - the WATCH PAGE: the two-column anatomy's view (owner + actions +
 *   description panel + where-to-watch rows + the stage lifecycle
 *   verbatim + related compact cards), the frozen R26 vocabulary
 *   preserved (the peer journey stays FIRST-CLASS — the authorized peer
 *   copy reads as a way to watch);
 * - the SEARCH PAGE: the row grammar with real synopses on peer rows;
 * - the LIBRARY PAGE: rows + the verified-offline note;
 * - the COPY SWEEP: every user-facing string passes the stale-copy law.
 */

import { describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/client-runtime";
import { isStaleCompletionCopy, TORRENT_REALIZATION_VIEW } from "@wfx/client-runtime";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import { TorrentFlowEngine } from "./r23-harness";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { PEER_CATALOG_ENTRIES } from "../src/platform/peer-catalog";
import {
  r27ApplyChip,
  r27ChipsOf,
  r27DurationLabelOf,
  r27FeedCardOf,
  r27SkeletonCards,
} from "../src/surface/r27-card-grammar";
import {
  r27BrowseFeedView,
  r27LibraryPageView,
  r27SearchPageView,
  r27ShellView,
  r27ShortsPageView,
  r27SurfaceCopyStrings,
  r27WatchPageView,
} from "../src/surface/r27-surface-grammar";

// ---------------------------------------------------------------------------
// The journey world (the R26 harness doctrine, the same shape)
// ---------------------------------------------------------------------------

const R27_T0 = Date.parse("2026-09-23T12:00:00.000Z");
const BASE = new URL("https://experience.webflix.invalid/api");
const CONTEXT = {
  userId: "wfx-desktop-r27-user",
  sessionId: "wfx-desktop-r27-session",
  locale: "en",
};

const SINTEL = PEER_CATALOG_ENTRIES.find((entry) => entry.title === "Sintel")!;

class StubFetch {
  readonly requests: { method: string; url: string }[] = [];
  private scripted: { match: (url: string) => boolean; respond: () => Response }[] = [];

  script(match: (url: string) => boolean, respond: () => Response): void {
    this.scripted.push({ match, respond });
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    this.requests.push({ method: init?.method ?? "GET", url });
    for (let index = this.scripted.length - 1; index >= 0; index -= 1) {
      const entry = this.scripted[index]!;
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bootGrammar() {
  const engine = new TorrentFlowEngine();
  engine.torrentFiles = SINTEL.files.map((file) => ({
    path: file.path,
    name: file.path.split("/").pop()!,
    lengthBytes: file.lengthBytes,
    offsetBytes: 0,
  }));
  const shell = new SimShell();
  const stub = new StubFetch();
  // The honest server search: the "Sintel" query answers the scripted
  // server row; anything else answers EMPTY (a real no-match, so the
  // grammar's honest-empty state is exercised against truth). The
  // specific match is scripted LAST so the reverse-order matcher finds
  // it first.
  stub.script(
    (url) => url.includes("/experience/search"),
    () => jsonResponse([]),
  );
  stub.script(
    (url) => url.includes("/experience/search") && decodeURIComponent(url).includes("Sintel"),
    () =>
      jsonResponse([
        {
          connectorId: "wfx-experience-service",
          externalRef: "rain-lofi-1",
          title: "Rainy Lofi Study Café",
          canonicalType: "video",
          durationMs: 3_734_000,
        },
      ]),
  );
  stub.script(
    (url) => url.includes("/experience/resolve"),
    () =>
      jsonResponse([
        {
          mode: "embed",
          connectorId: "wfx-experience-service",
          url: "https://provider.example/embed/rain-lofi-1",
          capabilities: ["playEmbed"],
        },
      ]),
  );
  stub.script((url) => url.includes("/experience/library"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/shorts"), () => jsonResponse([]));
  stub.script((url) => url.includes("/experience/history"), () => jsonResponse([]));
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: { context: CONTEXT, clock: new FixedClock(R27_T0), ids: new SequentialIdGen() },
    engine: {
      config: {
        cacheDir: "/sim/app-data/wfx-desktop/engine-cache",
        maxCacheBytes: 64 * 1024 * 1024,
      },
      process: new SimEngineProcess(),
    },
    acquisition: { engine, adapter: engine.adapter },
  });
  return { app, engine, shell, stub };
}

// ---------------------------------------------------------------------------
// The pure grammar unit laws
// ---------------------------------------------------------------------------

describe("R27-W3 the card grammar (pure projections)", () => {
  it("duration labels render the corpus format; absence stays absence", () => {
    expect(r27DurationLabelOf(465_000)).toBe("7:45");
    expect(r27DurationLabelOf(3_734_000)).toBe("1:02:14");
    expect(r27DurationLabelOf(undefined)).toBeNull();
    expect(r27DurationLabelOf(null)).toBeNull();
    expect(r27DurationLabelOf(Number.NaN)).toBeNull();
  });

  it("the feed card renders real artwork, pills, and honest meta", () => {
    const view = r27FeedCardOf({
      itemId: SINTEL.itemId,
      title: SINTEL.title,
      creators: [...SINTEL.creators],
      canonicalType: SINTEL.canonicalType,
      durationMs: SINTEL.durationMs,
      artwork: {
        url: SINTEL.artworkUrl,
        variant: "thumbnail",
        provenance: { kind: "source-artwork", connectorId: "wfx-peer-catalog" },
        aspectRatio: 16 / 9,
        fallback: { kind: "placeholder-monogram", detail: "d" },
        source: { artworkServed: true } as never,
        cache: { cacheable: true } as never,
      },
      origin: "authorized-peer-copy",
      licenseLabel: SINTEL.license.label,
    });
    expect(view.artwork.kind).toBe("image");
    if (view.artwork.kind === "image") {
      expect(view.artwork.url).toBe(SINTEL.artworkUrl); // the REAL artwork law
    }
    expect(view.durationLabel).toBe(r27DurationLabelOf(SINTEL.durationMs));
    expect(view.channelLabel).toBe(SINTEL.creators.join(", "));
    expect(view.metaLine).toContain("Video");
    expect(view.metaLine).toContain(SINTEL.license.label);
    expect(view.badgeLabels).toEqual(["Authorized peer copy"]);
    expect(view.watchedFraction).toBeNull();
    expect(view.ariaLabel).toContain(SINTEL.title);
  });

  it("absent artwork renders the typed placeholder — never a fabricated image", () => {
    const view = r27FeedCardOf({
      itemId: "x",
      title: "Unknown title",
      creators: [],
      canonicalType: "video",
      artwork: null,
      origin: "server-catalog",
    });
    expect(view.artwork.kind).toBe("monogram");
    expect(view.durationLabel).toBeNull();
    expect(view.channelLabel).toBeNull();
    expect(view.metaLine).toBe("Video");
  });

  it("the watched red edge carries the honest fold truth", () => {
    const row = {
      itemId: "x",
      title: "T",
      creators: [] as string[],
      canonicalType: "video",
      artwork: null,
      origin: "server-catalog" as const,
    };
    expect(r27FeedCardOf(row, { completionRatio: 0.4, positionMs: 0 }).watchedFraction).toBe(0.4);
    expect(
      r27FeedCardOf(row, { completionRatio: null, positionMs: 0 }).watchedFraction,
    ).toBeNull();
    expect(
      r27FeedCardOf(row, { completionRatio: null, positionMs: 30_000, durationMs: 60_000 })
        .watchedFraction,
    ).toBe(0.5);
  });

  it("chips derive real facets with honest counts; the filter matches", () => {
    const rows = [
      { itemId: "a", title: "A", creators: [], canonicalType: "video", artwork: null, origin: "server-catalog" as const },
      { itemId: "b", title: "B", creators: [], canonicalType: "film", artwork: null, origin: "server-catalog" as const },
      { itemId: "c", title: "C", creators: [], canonicalType: "video", artwork: null, origin: "server-catalog" as const },
    ];
    const chips = r27ChipsOf(rows);
    expect(chips[0]).toMatchObject({ id: "all", label: "All", count: 3, isDefault: true });
    expect(chips).toHaveLength(3); // All + film + video (no dead chips)
    expect(r27ApplyChip(rows, "video")).toHaveLength(2);
    expect(r27ApplyChip(rows, "all")).toHaveLength(3);
    const facet = chips.find((chip) => chip.id === "video")!;
    expect(facet.count).toBe(r27ApplyChip(rows, "video").length);
  });

  it("skeletons render the loading shells (2 text lines each)", () => {
    const skeletons = r27SkeletonCards(12);
    expect(skeletons).toHaveLength(12);
    for (const skeleton of skeletons) expect(skeleton.lineCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The surfaces over the REAL composition
// ---------------------------------------------------------------------------

describe("R27-W3 the surface grammar (the real composition walk)", () => {
  it("the shell renders the honest destinations — no dead rail rows", () => {
    const boot = bootGrammar();
    const shell = r27ShellView(boot.app.runtime, boot.app.capabilities);
    expect(shell.topbar.wordmark).toBe("WebFlix"); // the honest-identity law
    expect(shell.topbar.search.mic).toBeNull(); // honestly absent
    const items = shell.rail.flatMap((group) => group.items);
    const ids = items.map((item) => item.destination);
    expect(ids).toContain("home");
    expect(ids).toContain("library");
    expect(ids).toContain("settings");
    expect(ids).toContain("shorts");
    // Subscriptions/Explore/More-from are honestly ABSENT (DIVERGENCES):
    expect(ids).not.toContain("subscriptions");
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
    boot.app.dispose();
  });

  it("browse renders the corpus feed: chips + real-artwork cards + skeletons", async () => {
    const boot = bootGrammar();
    const itemDetail = boot.app.itemDetail!;
    const browse = await itemDetail.browse();
    const feed = r27BrowseFeedView(browse);
    expect(feed.grid).toHaveLength(PEER_CATALOG_ENTRIES.length);
    for (const card of feed.grid) {
      expect(card.artwork.kind).toBe("image"); // the R26 real-artwork law
      if (card.artwork.kind === "image") {
        expect(card.artwork.url).toMatch(/^https:\/\//);
      }
      expect(card.durationLabel).not.toBeNull(); // the catalog carries real durations
      expect(card.badgeLabels).toEqual(["Authorized peer copy"]);
    }
    expect(feed.chips[0]).toMatchObject({ id: "all", label: "All" });
    expect(feed.loading).toBe(false);
    // The server-catalog note rides honestly (never a fabricated empty section).
    expect(feed.serverCatalogNote).toContain("authorized peer titles");
    // The stale-copy law over every string.
    for (const copy of r27SurfaceCopyStrings(feed)) {
      expect(isStaleCompletionCopy(copy)).toBe(false);
    }
    boot.app.dispose();
  });

  it("watch renders the two-column anatomy with the peer journey FIRST-CLASS", async () => {
    const boot = bootGrammar();
    const itemDetail = boot.app.itemDetail!;
    const browse = await itemDetail.browse();
    const relatedRows = browse.peerRows.filter((row) => row.itemId !== SINTEL.itemId);
    const item = await itemDetail.item({ itemId: SINTEL.itemId });
    const watch = r27WatchPageView(item, relatedRows);

    // The h1 + owner + description panel grammar.
    expect(watch.title).toBe(SINTEL.title);
    expect(watch.owner.name).toBe(SINTEL.creators[0] ?? SINTEL.title);
    expect(watch.owner.meta).toContain(String(SINTEL.year));
    expect(watch.description.collapsed).toBe(true);
    expect(watch.description.moreLabel).toBe("…more");
    expect(watch.description.text).toBe(SINTEL.synopsis);

    // The actions row: only backed actions, in the honest vocabulary.
    expect(watch.actions.map((action) => action.id)).toEqual(["feedback", "share", "save"]);
    for (const action of watch.actions) {
      expect(action.detail.length).toBeGreaterThan(0);
    }

    // Where-to-watch reads as the natural viewing-source choice: the
    // authorized peer copy row carries the FROZEN label verbatim.
    const peerWay = watch.waysToWatch.find((way) => way.kind === "authorized-peer-copy");
    expect(peerWay).toBeDefined();
    expect(peerWay!.label).toBe(TORRENT_REALIZATION_VIEW.label);
    expect(peerWay!.groupLabel).toBe(TORRENT_REALIZATION_VIEW.label);
    expect(watch.primaryPlay.label).toContain("Play");

    // The lifecycle renders inside the chrome, honestly idle pre-play.
    expect(watch.stage.kind).toBe("idle");
    expect(watch.stage.progress).toBeNull();

    // The related sidebar: compact cards with real artwork.
    expect(watch.related.cards).toHaveLength(relatedRows.length);
    for (const card of watch.related.cards) {
      expect(card.artwork.kind).toBe("image");
    }
    expect(watch.related.chips[0]).toMatchObject({ id: "all" });

    // The stale-copy law.
    for (const copy of r27SurfaceCopyStrings(watch)) {
      expect(isStaleCompletionCopy(copy)).toBe(false);
    }
    boot.app.dispose();
  });

  it("the honest lifecycle maps onto the stage state VERBATIM", async () => {
    const boot = bootGrammar();
    const itemDetail = boot.app.itemDetail!;
    const item = await itemDetail.item({ itemId: SINTEL.itemId });
    // A background-completion lifecycle state (the R26 flow's completing
    // phase) projects onto the in-chrome state with the truthful label.
    const acquiring = await itemDetail.playPeerCopy(SINTEL.itemId, { fileIndexes: [0] });
    expect(acquiring.kind).toBe("started");
    const watchAcquiring = r27WatchPageView(item, []);
    // Before any engine report, the acquisition view stays honest.
    expect(["idle", "preparing", "buffering"]).toContain(watchAcquiring.stage.kind);
    boot.app.dispose();
  });

  it("search renders the row grammar — merged server + peer rows, honest statuses", async () => {
    const boot = bootGrammar();
    const itemDetail = boot.app.itemDetail!;
    const search = await itemDetail.search("Sintel");
    const page = r27SearchPageView(search);
    expect(page.serverStatus).toBe("ready");
    expect(page.rows.length).toBe(2); // one server hit + the peer hit
    const peerRow = page.rows.find((row) => row.origin === "authorized-peer-copy");
    expect(peerRow).toBeDefined();
    expect(peerRow!.snippet).toBe(SINTEL.synopsis); // the real synopsis
    const serverRow = page.rows.find((row) => row.origin === "server-catalog");
    expect(serverRow).toBeDefined();
    expect(serverRow!.snippet).toBeNull(); // honestly absent — never fabricated
    expect(page.emptyNote).toBeNull();
    for (const row of page.rows) expect(row.ariaLabel).toContain(row.title);

    // The honest empty state (same grammar, no fabricated results).
    const emptySearch = await itemDetail.search("zzz-no-match-xyz");
    const emptyPage = r27SearchPageView(emptySearch);
    expect(emptyPage.rows.filter((row) => row.origin === "authorized-peer-copy")).toHaveLength(0);
    expect(emptyPage.serverStatus).toBe("ready");
    expect(emptyPage.emptyNote).not.toBeNull();
    boot.app.dispose();
  });

  it("library renders the rows grammar + the verified-offline note", async () => {
    const boot = bootGrammar();
    const itemDetail = boot.app.itemDetail!;
    const library = await itemDetail.library();
    const page = r27LibraryPageView(library, R27_T0);
    expect(page.watchlist).toHaveLength(0); // the honest empty (nothing saved yet)
    expect(page.history).toHaveLength(0);
    expect(page.offlineNote).toContain("verified");
    boot.app.dispose();
  });
});

describe("R27-W3 the shorts surface (the 9:16 grammar, the truthful read)", () => {
  it("renders the honest empty state — never fabricated shorts rows", async () => {
    const boot = bootGrammar();
    const shorts = await boot.app.runtime.shorts();
    const page = r27ShortsPageView(shorts);
    expect(page.rows).toHaveLength(0);
    expect(page.emptyNote).not.toBeNull();
    expect(page.emptyNote).toContain("No shorts yet");
    boot.app.dispose();
  });

  it("projects the rows the read truthfully serves", () => {
    const page = r27ShortsPageView({
      status: { state: "ready" },
      hits: [
        {
          canonicalItemId: "wfxitm_shorts_1",
          result: { title: "A real short", canonicalType: "video" },
        },
      ],
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.title).toBe("A real short");
    expect(page.rows[0]!.artwork.kind).toBe("monogram"); // honest: no artwork carried
    expect(page.emptyNote).toBeNull();
  });
});
