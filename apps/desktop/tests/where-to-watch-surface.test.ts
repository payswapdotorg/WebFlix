/**
 * R23-W3 — the R23-E Desktop torrent play surface tests (the Where-to-watch
 * grouping + the primary-play eligibility + the label law + the
 * protocol-free lifecycle + the progressive disclosure).
 *
 * THE LAW (the plan's R23-E): "Authorized peer copy" is a FIRST-CLASS way
 * to watch — listed in Where to watch, eligible for the primary play
 * decision, never "Offline copy", never hidden behind Settings or a
 * diagnostics panel.
 */

import { describe, expect, it } from "bun:test";

import { whereToWatchCopyStrings } from "../src/surface/where-to-watch-surface";
import { isLawfulTorrentPrimaryLabel, isStaleCompletionCopy } from "@wfx/client-runtime";
import {
  R23_ITEM,
  R23_ITEM_2,
  bootR23,
} from "./r23-harness";

/** The provider ways a connected source offers (the resolve answer shape). */
const PROVIDER_WAYS = [
  { mode: "embed" as const, connectorId: "youtube" },
  { mode: "external" as const, connectorId: "vimeo" },
];

describe("R23-W3 where-to-watch — the frozen grouping (WebFlix source → peer copy → other ways)", () => {
  it("renders the three frozen groups in the frozen order", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
    });
    expect(view.groups.map((group) => group.kind)).toEqual([
      "webflix-source",
      "authorized-peer-copy",
      "other-realizations",
    ]);
    expect(view.groups[0]?.label).toBe("WebFlix source");
    expect(view.groups[1]?.label).toBe("Authorized peer copy"); // the frozen R23-C vocabulary
    expect(view.groups[2]?.label).toBe("Other ways to watch");
  });

  it("the WebFlix-source group carries the platform's precedence answer (embed here)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
    });
    const source = view.groups[0]?.entries ?? [];
    expect(source).toHaveLength(1);
    expect(source[0]?.kind).toBe("webflix-source");
    expect(source[0]?.mode).toBe("embed"); // native > embed — no provider native way exists
    expect(source[0]?.usable).toBe(true);
    const others = view.groups[2]?.entries ?? [];
    expect(others.map((entry) => entry.mode)).toEqual(["external"]);
  });

  it("an empty source group renders honestly empty (the peer copy may still be the way)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [],
    });
    expect(view.groups[0]?.entries).toHaveLength(0);
    expect(view.groups[1]?.entries).toHaveLength(1); // the peer copy remains first-class
  });
});

describe("R23-W3 where-to-watch — the peer-copy entry (the first-class laws)", () => {
  it("the peer-copy entry carries the frozen label + the rung truth", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
    });
    const entry = view.groups[1]?.entries[0];
    expect(entry?.kind).toBe("authorized-peer-copy");
    expect(entry?.label).toBe("Authorized peer copy");
    expect(entry?.detail).toContain("plays like any other way of watching");
    expect(entry?.rung?.kind).toBe("satisfies-native-rung");
  });

  it("an item with NO peer copy renders NO peer-copy entry (never a fake one)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM_2, // no realization offered for this item
      providerRealizations: PROVIDER_WAYS,
    });
    expect(view.groups[1]?.entries).toHaveLength(0);
  });

  it("an UNAUTHORIZED copy renders the typed refusal (never offered as playback)", () => {
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? {
              itemId,
              title: "Family Archive",
              magnet: "magnet:?xt=urn:btih:x",
              provenance: { sourceId: "vault:family-media", basis: "not-lawful" },
              browserCapable: false,
            }
          : null,
    });
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [],
    });
    const entry = view.groups[1]?.entries[0];
    expect(entry?.rung?.kind).toBe("requires-authorization");
    expect(entry?.detail).toContain("not authorized");
    expect(view.primary.peerCopyEligible).toBe(false);
    expect(view.primary.action).toBe("nothing-yet"); // the honest state — no way to watch
  });
});

describe("R23-W3 where-to-watch — the PRIMARY play decision (the eligibility law)", () => {
  it("the default primary follows the frozen precedence (the WebFlix source's headline way)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
    });
    expect(view.primary.action).toBe("play-selected-way");
    expect(view.primary.selectedPeerCopy).toBe(false);
    expect(view.primary.peerCopyEligible).toBe(true); // ELIGIBLE — the R23-E law
    expect(view.primary.label).toContain("Plays inside WebFlix");
  });

  it("SELECTING the peer copy makes it THE way the primary action plays", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
      selectedPeerCopy: true,
    });
    expect(view.primary.action).toBe("play-selected-way");
    expect(view.primary.selectedPeerCopy).toBe(true);
    expect(view.primary.label).toBe("Play — Authorized peer copy");
    expect(view.primary.detail).toContain("before the copy completes");
  });

  it("with NO provider way, the peer copy IS the primary way (never hidden)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [],
    });
    expect(view.primary.selectedPeerCopy).toBe(true);
    expect(view.primary.label).toBe("Play — Authorized peer copy");
    expect(view.primary.action).toBe("play-selected-way");
  });

  it("playPeerCopy delegates to the binding (the J38 start)", async () => {
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === R23_ITEM
          ? {
              itemId,
              title: "Family Archive",
              torrentBytes: new Uint8Array([1, 2, 3]),
              provenance: { sourceId: "vault:family-media", basis: "user-owned" },
              browserCapable: false,
            }
          : null,
    });
    // Single playable file → the auto-selection starts the playback.
    boot.engine.torrentFiles = [
      { path: "feature.mkv", name: "feature.mkv", lengthBytes: 88_912, offsetBytes: 0 },
    ];
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind === "started") {
      expect(outcome.controller.state().mode).toBe("native");
    }
  });
});

describe("R23-W3 where-to-watch — the honesty laws (protocol-free + progressive disclosure + copy)", () => {
  it("the acquisition lifecycle rides along PROTOCOL-FREE (the R14 leak law)", async () => {
    const boot = bootR23();
    const started = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(started.kind).toBe("started");
    boot.acquisition.refreshAcquisition();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
    });
    expect(view.acquisition?.state).toBe("preparing");
    expect(view.acquisition?.label).toBe("Preparing");
    // The protocol-free law: no protocol diagnostics on the default surface
    // ("peer copy" is user vocabulary; peers-count/pieces are diagnostics).
    expect(view.acquisition?.detail).not.toMatch(/\bpieces?\b|\bpeers\b|\btrackers?\b|\binfohash\b/i);
  });

  it("the advanced diagnostics stay progressively disclosed (the flag, never the content)", async () => {
    const boot = bootR23();
    await boot.whereToWatch.playPeerCopy(R23_ITEM);
    boot.acquisition.refreshAcquisition();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [],
    });
    // The view carries ONLY the gated-availability flag; the protocol
    // vocabulary (pieces/peers-count/trackers/infohash) lives behind the
    // acquisition surface's gated projection. The frozen "peer copy"
    // label is USER vocabulary, not protocol diagnostics.
    expect(typeof view.diagnosticsAvailable).toBe("boolean");
    const copy = whereToWatchCopyStrings(view);
    for (const text of copy) {
      expect(text).not.toMatch(/\bpieces?\b|\bpeers\b|\btrackers?\b|\binfohash\b/i);
    }
  });

  it("the offline affordance is a SECONDARY note (never the sole conceptual entry)", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: [],
    });
    expect(view.offlineAffordanceNote).toContain("also");
    expect(view.offlineAffordanceNote).toContain("available offline");
    // The PRIMARY decision is a PLAY decision — not a download decision.
    expect(view.primary.action).toBe("play-selected-way");
    expect(view.primary.label.startsWith("Play")).toBe(true);
  });

  it("every projected copy string passes the stale-copy sweep + the label law", () => {
    const boot = bootR23();
    const view = boot.whereToWatch.whereToWatch({
      itemId: R23_ITEM,
      providerRealizations: PROVIDER_WAYS,
      selectedPeerCopy: true,
    });
    const copy = whereToWatchCopyStrings(view);
    expect(copy.length).toBeGreaterThan(10);
    for (const text of copy) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
    // The label law: the peer-copy primary label is lawful (never "Offline copy").
    const peerCopyLabel = view.groups[1]?.entries[0]?.label ?? "";
    expect(isLawfulTorrentPrimaryLabel(peerCopyLabel)).toBe(true);
    expect(peerCopyLabel).not.toBe("Offline copy");
  });
});
