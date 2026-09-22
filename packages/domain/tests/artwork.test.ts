/**
 * @wfx/domain — the content ARTWORK contract tests (R26-W1, the
 * real-artwork law).
 *
 * Machine-checked:
 * - the extractor carries the connector's REAL source-authorized URL
 *   verbatim (with provenance naming the connector);
 * - absent/malformed artwork answers the honest fallback-only arm
 *   (NEVER a fabricated URL, NEVER a smuggled data:/relative path);
 * - the aspect ratio derives honestly from the orientation signal;
 * - THE LAW: generated artwork is an explicit fallback ONLY — it never
 *   replaces an available source thumbnail (the resolution kinds make
 *   replacement structurally impossible);
 * - the guards reject wrong-shaped claimed contracts.
 */

import { describe, expect, it } from "bun:test";

import {
  CONTENT_ARTWORK_METADATA_KEY,
  CONTENT_ARTWORK_PLACEHOLDER_FALLBACK,
  CONTENT_ARTWORK_SOURCE_CACHE_DETAIL,
  contentArtworkOf,
  isContentArtwork,
  isContentArtworkResolution,
  resolutionCarriesSourceArtwork,
  type ContentArtworkCarrier,
} from "../src/index";

/** A carrier builder (the shape both SearchResult and SourceItem satisfy). */
function carrier(overrides: Partial<ContentArtworkCarrier> = {}): ContentArtworkCarrier {
  return {
    connectorId: "youtube",
    externalRef: "vid-42",
    title: "Deep Field Diary",
    orientation: "horizontal",
    metadata: { [CONTENT_ARTWORK_METADATA_KEY]: "https://i.ytimg.com/vi/vid-42/maxresdefault.jpg" },
    ...overrides,
  };
}

describe("the content artwork contract (R26-W1)", () => {
  describe("the real-artwork extraction", () => {
    it("carries the connector's source-authorized URL verbatim with honest provenance", () => {
      const resolution = contentArtworkOf(carrier());
      expect(resolution.kind).toBe("source-artwork");
      if (resolution.kind !== "source-artwork") return;
      const artwork = resolution.artwork;
      expect(artwork.url).toBe("https://i.ytimg.com/vi/vid-42/maxresdefault.jpg");
      expect(artwork.variant).toBe("thumbnail");
      expect(artwork.provenance.kind).toBe("source-artwork");
      expect(artwork.provenance.connectorId).toBe("youtube");
      expect(artwork.provenance.sourceRef).toBe("vid-42");
      expect(artwork.source).toEqual({ artworkServed: true, connectorId: "youtube" });
      expect(artwork.cache.origin).toBe("source");
      expect(artwork.cache.detail).toBe(CONTENT_ARTWORK_SOURCE_CACHE_DETAIL);
      expect(artwork.fallback.kind).toBe("placeholder-monogram");
    });

    it("derives the aspect ratio from the orientation signal (and honestly omits it on unknown)", () => {
      expect(contentArtworkOf(carrier({ orientation: "horizontal" })).kind).toBe("source-artwork");
      const horizontal = contentArtworkOf(carrier({ orientation: "horizontal" }));
      if (horizontal.kind === "source-artwork") {
        expect(horizontal.artwork.aspectRatio).toBeCloseTo(16 / 9, 10);
      }
      const vertical = contentArtworkOf(carrier({ orientation: "vertical" }));
      if (vertical.kind === "source-artwork") {
        expect(vertical.artwork.aspectRatio).toBeCloseTo(9 / 16, 10);
      }
      const square = contentArtworkOf(carrier({ orientation: "square" }));
      if (square.kind === "source-artwork") {
        expect(square.artwork.aspectRatio).toBe(1);
      }
      const unknown = contentArtworkOf(carrier({ orientation: "unknown" }));
      if (unknown.kind === "source-artwork") {
        expect(unknown.artwork.aspectRatio).toBeUndefined();
      }
    });

    it("answers the honest fallback-only arm when the row carries no artwork key", () => {
      const resolution = contentArtworkOf(
        carrier({ metadata: { topics: ["space"] } }),
      );
      expect(resolution.kind).toBe("fallback-only");
      if (resolution.kind !== "fallback-only") return;
      expect(resolution.fallback.kind).toBe("placeholder-monogram");
      expect(resolution.reason).toContain("no artwork");
      expect(resolution.connectorId).toBe("youtube");
    });

    it("REJECTS malformed artwork entries to the honest fallback — never a smuggled URL", () => {
      for (const bad of [
        "data:image/png;base64,AAAA",
        "javascript:alert(1)",
        "/relative/path.jpg",
        "ftp://example.com/art.jpg",
        "",
        42,
        true,
        { url: "https://example.com/nested" },
      ]) {
        const resolution = contentArtworkOf(carrier({ metadata: { thumbnailUrl: bad } }));
        expect(resolution.kind).toBe("fallback-only");
        if (resolution.kind !== "fallback-only") return;
        // Every non-http(s) entry lands in the honest fallback arm —
        // never a smuggled URL, never the source-artwork arm.
        expect(resolution.fallback.kind).toBe("placeholder-monogram");
      }
      // The null entry (an explicitly absent value) is the honest
      // "no artwork" branch — also the fallback arm, also honest.
      const nullResolution = contentArtworkOf(carrier({ metadata: { thumbnailUrl: null } }));
      expect(nullResolution.kind).toBe("fallback-only");
      if (nullResolution.kind === "fallback-only") {
        expect(nullResolution.reason).toContain("no artwork");
      }
    });

    it("treats an absent metadata bag as the honest fallback", () => {
      const { metadata: _absent, ...rest } = carrier();
      const resolution = contentArtworkOf(rest);
      expect(resolution.kind).toBe("fallback-only");
    });
  });

  describe("THE REAL-ARTWORK LAW (generated never replaces source)", () => {
    it("the fallback law kinds are explicit (placeholder-monogram / generated-fallback — both FALLBACK-only truth)", () => {
      expect(CONTENT_ARTWORK_PLACEHOLDER_FALLBACK.kind).toBe("placeholder-monogram");
      // A generated fallback is a FALLBACK field of a source-artwork
      // contract or a fallback-only resolution — it can never BE the
      // artwork arm (the types make replacement impossible).
      const fallbackOnly = contentArtworkOf(carrier({ metadata: {} }));
      expect(fallbackOnly.kind).toBe("fallback-only");
      expect(resolutionCarriesSourceArtwork(fallbackOnly)).toBe(false);
    });

    it("the render law: only the source-artwork arm carries a real source URL", () => {
      expect(resolutionCarriesSourceArtwork(contentArtworkOf(carrier()))).toBe(true);
      expect(resolutionCarriesSourceArtwork(contentArtworkOf(carrier({ metadata: {} })))).toBe(
        false,
      );
    });
  });

  describe("the contract guards", () => {
    it("accepts a truthful contract and rejects wrong-shaped claims", () => {
      const good = contentArtworkOf(carrier());
      expect(good.kind).toBe("source-artwork");
      if (good.kind !== "source-artwork") return;
      expect(isContentArtwork(good.artwork)).toBe(true);
      expect(isContentArtwork({ url: "not-a-url", variant: "thumbnail" })).toBe(false);
      expect(
        isContentArtwork({
          ...good.artwork,
          provenance: { kind: "webflix-artwork" },
        }),
      ).toBe(false);
      expect(isContentArtwork({ ...good.artwork, aspectRatio: -1 })).toBe(false);
      expect(isContentArtwork({ ...good.artwork, aspectRatio: Number.NaN })).toBe(false);
      expect(isContentArtwork({ ...good.artwork, source: { artworkServed: false, connectorId: "x" } })).toBe(false);
      expect(isContentArtwork({ ...good.artwork, cache: { origin: "webflix-proxy" } })).toBe(false);
    });

    it("guards the resolution union (both arms, shape-strict)", () => {
      const source = contentArtworkOf(carrier());
      const fallback = contentArtworkOf(carrier({ metadata: {} }));
      expect(isContentArtworkResolution(source)).toBe(true);
      expect(isContentArtworkResolution(fallback)).toBe(true);
      expect(isContentArtworkResolution({ kind: "source-artwork", artwork: "nope" })).toBe(false);
      expect(
        isContentArtworkResolution({
          kind: "fallback-only",
          fallback: { kind: "placeholder-monogram", detail: "d" },
          reason: "r",
          connectorId: "c",
        }),
      ).toBe(true);
      expect(
        isContentArtworkResolution({
          kind: "fallback-only",
          fallback: { kind: "generated-fallback", detail: "d" },
          reason: "r",
        }),
      ).toBe(false);
      expect(isContentArtworkResolution(null)).toBe(false);
      expect(isContentArtworkResolution("x")).toBe(false);
    });
  });
});
