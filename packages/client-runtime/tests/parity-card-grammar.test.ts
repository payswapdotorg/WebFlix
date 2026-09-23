/**
 * R27-W1 — THE PARITY CARD VIEW-MODEL GRAMMAR TESTS.
 *
 * THE LAW: the shared card grammar renders the corpus anatomy exactly
 * (feed 16:9/12-radius/pill/2-line-16/500 title; search 360×202 + 18/400
 * title + snippet; related 168×94; shorts 9:16) and keeps the honesty
 * laws: real artwork or the typed placeholder (never fabricated), no
 * duration pill without a real duration, no fabricated meta counts,
 * dead chips omit, films are never presented as shorts.
 *
 * The interaction-policy vocabulary tests pin the corpus FEEL/OPERATE
 * laws: hover dwell ~500ms capability-gated, control reveal ~3s
 * idle/focus/paused truth, single-select chips with the honest default,
 * the rail active state.
 */

import { describe, expect, it } from "bun:test";

import type { ContentArtwork } from "@wfx/domain";

import {
  PARITY_FEED_CARD_GRAMMAR,
  PARITY_RELATED_CARD_GRAMMAR,
  PARITY_SEARCH_ROW_GRAMMAR,
  PARITY_SHORTS_CARD_GRAMMAR,
  PARITY_SKELETON_GRAMMAR,
  parityCardArtwork,
  parityChipsFromFacets,
  parityContinueWatchingCard,
  parityDurationLabel,
  parityFeedCard,
  parityFeedCardsFromModel,
  parityMetaLine,
  parityRelatedCard,
  paritySearchRowCard,
  parityShortsCardsFromModel,
  paritySkeletonGrid,
} from "../src/parity-card-grammar";
import {
  PARITY_INTERACTION_POLICY,
  resolveParityChipSelection,
  resolveParityControlReveal,
  resolveParityHoverPreview,
  resolveParityRailItemState,
} from "../src/interaction-policy";
import type { SearchHit, SearchModel } from "../src/models";
import { readySection } from "../src/models";

// ---------------------------------------------------------------------------
// Fixtures (honest shapes only — no production fixture masquerading)
// ---------------------------------------------------------------------------

function artwork(url: string): ContentArtwork {
  return {
    url,
    variant: "thumbnail",
    provenance: { kind: "source-artwork", connectorId: "conn-a" },
    aspectRatio: 16 / 9,
    fallback: {
      kind: "placeholder-monogram",
      detail: "The source carries no artwork for this item — the placeholder renders instead.",
    },
    source: { artworkServed: true, connectorId: "conn-a" },
    cache: { policy: "source-controlled", detail: "The source's own URL, the source's own policy." },
  } as unknown as ContentArtwork;
}

function hit(overrides: Partial<SearchHit["result"]> = {}, itemId = "wfxitm_1"): SearchHit {
  return {
    canonicalItemId: itemId,
    result: {
      connectorId: "conn-a",
      externalRef: "ext-1",
      title: "Spring — Blender Open Movie",
      ...overrides,
    },
  };
}

function model(hits: readonly SearchHit[]): SearchModel {
  return { query: "blender", status: readySection(), hits };
}

// ---------------------------------------------------------------------------
// The grammar descriptors (the corpus anatomy, from the token contract)
// ---------------------------------------------------------------------------

describe("R27-W1 card grammar — the corpus descriptors", () => {
  it("the feed card grammar: 16:9 thumb, radius 12, the pill spec", () => {
    expect(PARITY_FEED_CARD_GRAMMAR.thumbAspectRatio).toBe("16 / 9");
    expect(PARITY_FEED_CARD_GRAMMAR.thumbRadius).toBe(12);
    expect(PARITY_FEED_CARD_GRAMMAR.titleRole).toBe("card-title");
    expect(PARITY_FEED_CARD_GRAMMAR.pillRole).toBe("pill");
    expect(PARITY_FEED_CARD_GRAMMAR.pillRadius).toBe(4);
    expect(PARITY_FEED_CARD_GRAMMAR.pillPadding).toBe("3px 4px");
  });

  it("the search row grammar: 360×202 thumb, 16 gap, 18/400 title + snippet", () => {
    expect(PARITY_SEARCH_ROW_GRAMMAR.thumbWidth).toBe(360);
    expect(PARITY_SEARCH_ROW_GRAMMAR.thumbHeight).toBe(202);
    expect(PARITY_SEARCH_ROW_GRAMMAR.gap).toBe(16);
    expect(PARITY_SEARCH_ROW_GRAMMAR.titleRole).toBe("search-title");
    expect(PARITY_SEARCH_ROW_GRAMMAR.snippetRole).toBe("snippet");
  });

  it("the related compact grammar: 168×94, 4 gap", () => {
    expect(PARITY_RELATED_CARD_GRAMMAR.thumbWidth).toBe(168);
    expect(PARITY_RELATED_CARD_GRAMMAR.thumbHeight).toBe(94);
    expect(PARITY_RELATED_CARD_GRAMMAR.gap).toBe(4);
  });

  it("the shorts grammar: 9:16, 48px action targets; skeleton 20px/8px", () => {
    expect(PARITY_SHORTS_CARD_GRAMMAR.thumbAspectRatio).toBe("9 / 16");
    expect(PARITY_SHORTS_CARD_GRAMMAR.actionTarget).toBe(48);
    expect(PARITY_SKELETON_GRAMMAR.shellHeight).toBe(20);
    expect(PARITY_SKELETON_GRAMMAR.shellRadius).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// The honesty laws
// ---------------------------------------------------------------------------

describe("R27-W1 card grammar — the honesty laws", () => {
  it("REAL ARTWORK IS LAW: the source image renders when carried", () => {
    const view = parityCardArtwork(artwork("https://img.example/hq720.jpg"), "Spring");
    expect(view.kind).toBe("image");
    if (view.kind === "image") {
      expect(view.url).toBe("https://img.example/hq720.jpg");
      expect(view.alt).toContain("Spring");
      expect(view.alt).toContain("conn-a");
      expect(view.aspectRatio).toBeCloseTo(16 / 9);
    }
  });

  it("absent artwork renders the typed placeholder — never a fabricated image", () => {
    const view = parityCardArtwork(null, "Coffee Run");
    expect(view.kind).toBe("monogram");
    if (view.kind === "monogram") {
      expect(view.initial).toBe("C");
      expect(view.note).toContain("no artwork");
    }
    const unresolvable = parityCardArtwork(
      { url: "not-a-url" } as unknown as ContentArtwork,
      "X",
    );
    expect(unresolvable.kind).toBe("monogram");
  });

  it("no duration ⇒ NO pill; a real duration formats as the corpus label", () => {
    expect(parityDurationLabel(undefined)).toBeNull();
    expect(parityDurationLabel(Number.NaN)).toBeNull();
    expect(parityDurationLabel(-5)).toBeNull();
    expect(parityDurationLabel(0)).toBe("0:00");
    expect(parityDurationLabel(465_000)).toBe("7:45");
    expect(parityDurationLabel(263_000)).toBe("4:23");
    expect(parityDurationLabel(61_023_000)).toBe("16:57:03");
  });

  it("meta lines carry ONLY honest facts, ' · '-joined; empty facts ⇒ empty line", () => {
    expect(parityMetaLine(["movie", "peer-licensed"])).toBe("movie · peer-licensed");
    expect(parityMetaLine(["  ", "movie", ""])).toBe("movie");
    expect(parityMetaLine([])).toBe("");
  });

  it("the feed card composes the anatomy honestly (no channel/meta fabrication)", () => {
    const card = parityFeedCard({
      itemId: "wfxitm_1",
      title: "Spring — Blender Open Movie",
      durationMs: 465_000,
      artwork: artwork("https://img.example/hq720.jpg"),
    });
    expect(card.kind).toBe("feed");
    expect(card.durationLabel).toBe("7:45");
    expect(card.channelLabel).toBeNull();
    expect(card.metaLine).toBe("");
    expect(card.watchedFraction).toBeNull();
    expect(card.badgeLabels).toEqual([]);
    expect(card.ariaLabel).toBe("Spring — Blender Open Movie — 7:45");
    expect(card.artwork.kind).toBe("image");
  });

  it("the search row carries the snippet + badges; related stays compact", () => {
    const row = paritySearchRowCard({
      itemId: "wfxitm_2",
      title: "CHARGE — Blender Open Movie",
      channelLabel: "Blender Studio",
      metaFacts:["movie", "4K"],
      snippet: "A robot in a desert.",
      durationMs: 263_000,
      artwork: null,
      badgeLabels: ["CC"],
    });
    expect(row.kind).toBe("search-row");
    expect(row.channelLabel).toBe("Blender Studio");
    expect(row.metaLine).toBe("movie · 4K");
    expect(row.snippet).toBe("A robot in a desert.");
    expect(row.badgeLabels).toEqual(["CC"]);
    expect(row.durationLabel).toBe("4:23");
    expect(row.artwork.kind).toBe("monogram");

    const related = parityRelatedCard({
      itemId: "wfxitm_3",
      title: "Sprite Fright",
      channelLabel: "Blender Studio",
      metaFacts: ["movie"],
    });
    expect(related.kind).toBe("related");
    expect(related.durationLabel).toBeNull();
    expect(related.metaLine).toBe("movie");
  });

  it("dead chips omit; live chips keep their honest counts", () => {
    const chips = parityChipsFromFacets([
      { id: "all", label: "All", count: 10 },
      { id: "movie", label: "Movies", count: 4 },
      { id: "short", label: "Shorts", count: 0 }, // dead — never renders
      { id: "series", label: "Series", count: -1 }, // dead — never renders
    ]);
    expect(chips.map((c) => c.id)).toEqual(["all", "movie"]);
    expect(chips[0]?.isDefault).toBe(true);
    expect(chips[1]?.isDefault).toBe(false);
  });

  it("FILMS ARE NEVER PRESENTED AS SHORTS: only short/vertical rows enter the rail", () => {
    const cards = parityShortsCardsFromModel(
      model([
        hit({ canonicalType: "movie", title: "A film" }, "wfxitm_f1"),
        hit({ canonicalType: "short", title: "A short" }, "wfxitm_s1"),
        hit({ canonicalType: "video", orientation: "vertical", title: "A vertical" }, "wfxitm_v1"),
      ]),
    );
    expect(cards.map((c) => c.itemId)).toEqual(["wfxitm_s1", "wfxitm_v1"]);
    expect(cards[0]?.kind).toBe("shorts");
  });

  it("the skeleton grid renders the corpus loading state", () => {
    const grid = paritySkeletonGrid(4);
    expect(grid.length).toBe(4);
    expect(grid.every((c) => c.kind === "skeleton" && c.lineCount === 2)).toBe(true);
    expect(paritySkeletonGrid(0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The runtime-model mappers (the real content model → the grammar)
// ---------------------------------------------------------------------------

describe("R27-W1 card grammar — the runtime-model mappers", () => {
  it("projects a search model's hits into feed cards, order preserved", () => {
    const cards = parityFeedCardsFromModel(
      model([
        hit({ title: "First" }, "wfxitm_a"),
        hit({ title: "Second", durationMs: 60_000 }, "wfxitm_b"),
      ]),
      {
        channelOf: (id) => (id === "wfxitm_a" ? "Blender Studio" : null),
      },
    );
    expect(cards.length).toBe(2);
    expect(cards[0]?.itemId).toBe("wfxitm_a");
    expect(cards[0]?.channelLabel).toBe("Blender Studio");
    expect(cards[1]?.channelLabel).toBeNull();
    expect(cards[1]?.durationLabel).toBe("1:00");
  });

  it("the hit's artwork resolution rides the domain contract (real img)", () => {
    const cards = parityFeedCardsFromModel(
      model([
        hit(
          {
            // The domain's own carrier grammar: the connector's
            // `thumbnailUrl` metadata entry (an absolute http(s) URL).
            metadata: { thumbnailUrl: "https://img.example/hq720.jpg" },
            orientation: "horizontal",
          },
          "wfxitm_art",
        ),
      ]),
    );
    expect(cards[0]?.artwork.kind).toBe("image");
  });

  it("continue-watching entries carry the watched red-edge fraction", () => {
    const card = parityContinueWatchingCard(
      {
        itemId: "wfxitm_cw",
        title: "Spring",
        positionMs: 232_500_000 / 2,
        completionRatio: 0.5,
        lastWatchedAt: "2026-09-23T00:00:00Z",
        status: "in-progress",
      },
      (id) => (id === "wfxitm_cw" ? "Spring" : id),
    );
    expect(card.watchedFraction).toBe(0.5);
    expect(card.title).toBe("Spring");
  });
});

// ---------------------------------------------------------------------------
// The interaction-policy vocabulary (the corpus FEEL/OPERATE laws)
// ---------------------------------------------------------------------------

describe("R27-W1 interaction policy — the parity vocabulary", () => {
  it("the frozen policy table: all six kinds, timed from PARITY_MOTION", () => {
    expect(PARITY_INTERACTION_POLICY.map((r) => r.kind)).toEqual([
      "hover-dwell",
      "chip-select",
      "rail-active",
      "control-reveal",
      "focus-ring",
      "toast-auto-dismiss",
    ]);
    const hover = PARITY_INTERACTION_POLICY.find((r) => r.kind === "hover-dwell");
    expect(hover?.timingMs).toBe(500);
    expect(hover?.capabilityGated).toBe(true); // capability truth, both directions
    const reveal = PARITY_INTERACTION_POLICY.find((r) => r.kind === "control-reveal");
    expect(reveal?.timingMs).toBe(3000);
    const chip = PARITY_INTERACTION_POLICY.find((r) => r.kind === "chip-select");
    expect(chip?.timingMs).toBe(150);
    expect(chip?.capabilityGated).toBe(false);
    const focus = PARITY_INTERACTION_POLICY.find((r) => r.kind === "focus-ring");
    expect(focus?.timingMs).toBeNull();
  });

  it("hover preview: capability truth gates BOTH directions + the 500ms dwell", () => {
    expect(
      resolveParityHoverPreview({ dwellMs: 10_000, previewAvailable: false }).disclose,
    ).toBe(false); // unavailable never renders as usable
    expect(
      resolveParityHoverPreview({ dwellMs: 499, previewAvailable: true }).disclose,
    ).toBe(false); // no early disclosure
    expect(
      resolveParityHoverPreview({ dwellMs: 500, previewAvailable: true }).disclose,
    ).toBe(true); // served renders as served
  });

  it("control reveal: visible when paused, focused, or active < 3s; faded on idle", () => {
    expect(
      resolveParityControlReveal({
        playbackActive: false,
        focusWithin: false,
        lastActivityMs: 0,
        nowMs: 100_000,
      }).chromeVisible,
    ).toBe(true); // paused — never fade
    expect(
      resolveParityControlReveal({
        playbackActive: true,
        focusWithin: true,
        lastActivityMs: 0,
        nowMs: 100_000,
      }).chromeVisible,
    ).toBe(true); // focus within — never fade
    expect(
      resolveParityControlReveal({
        playbackActive: true,
        focusWithin: false,
        lastActivityMs: 0,
        nowMs: 2_999,
      }).chromeVisible,
    ).toBe(true); // under the idle band
    expect(
      resolveParityControlReveal({
        playbackActive: true,
        focusWithin: false,
        lastActivityMs: 0,
        nowMs: 3_000,
      }).chromeVisible,
    ).toBe(false); // idle ≥ 3s while playing — fade
  });

  it("chip selection: single-select with the honest default fallback", () => {
    const chips = [
      { id: "all", isDefault: true },
      { id: "movie", isDefault: false },
    ];
    expect(resolveParityChipSelection(chips, "movie")).toEqual({
      selectedId: "movie",
      isDefault: false,
    });
    expect(resolveParityChipSelection(chips, null)).toEqual({
      selectedId: "all",
      isDefault: true,
    });
    expect(resolveParityChipSelection(chips, "nonexistent")).toEqual({
      selectedId: "all",
      isDefault: true,
    });
    expect(resolveParityChipSelection([], null)).toEqual({
      selectedId: "all",
      isDefault: true,
    });
  });

  it("rail active state: the active destination lifts, others rest", () => {
    expect(
      resolveParityRailItemState({ itemId: "home", activeDestinationId: "home" }).active,
    ).toBe(true);
    expect(
      resolveParityRailItemState({ itemId: "library", activeDestinationId: "home" }).active,
    ).toBe(false);
    expect(
      resolveParityRailItemState({ itemId: "home", activeDestinationId: null }).active,
    ).toBe(false);
  });
});
