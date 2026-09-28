/**
 * R37 — THE LIVE VIEW MODEL tests (the pure derivations the /live rail
 * and the watch live mode render over — the href grammar + the viewer-
 * count slot's typed states; the designation law itself is proven at
 * the connector layer, and the surfaces' composition is proven by the
 * J45/J46 journeys — these tests pin the view-layer derivations).
 */

import { describe, expect, it } from "bun:test";

import { liveWatchHref } from "@/components/live/live-views";

describe("R37 liveWatchHref — the /watch live-mode destination grammar", () => {
  it("builds the content-destination href with the /item param grammar", () => {
    expect(
      liveWatchHref({
        connectorId: "fake-source",
        externalRef: "fake:live-1",
        title: "Signal Bloom — the fixture live broadcast",
        canonicalType: "video",
      }),
    ).toBe(
      "/watch?connector=fake-source&ref=fake%3Alive-1&title=Signal+Bloom+%E2%80%94+the+fixture+live+broadcast&type=video",
    );
  });

  it("encodes the ref (the colon is a query value, never a separator)", () => {
    const href = liveWatchHref({
      connectorId: "any-source",
      externalRef: "a:b&c=d",
      title: "T",
      canonicalType: "video",
    });
    expect(href).toContain("ref=a%3Ab%26c%3Dd");
    expect(href.startsWith("/watch?connector=any-source&")).toBe(true);
    expect(href.endsWith("&type=video")).toBe(true);
  });
});
