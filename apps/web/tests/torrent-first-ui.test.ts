/**
 * R23-E torrent-first realization UI tests (bun:test).
 *
 * The FIRST-CLASS torrent realization on the Web surfaces (over the
 * booted fixture host, deterministic, no network):
 *
 * - THE ENTRY: Where to watch lists "Authorized peer copy" (the frozen
 *   R23-C vocabulary — machine-checked: never "Offline copy" as the
 *   primary entry label) in its own group, ordered after the WebFlix
 *   source group (the frozen grouping order).
 * - THE ELIGIBILITY: the peer copy is eligible for the PRIMARY play
 *   decision — the entry carries its "Play this way" path (the player
 *   route's realization preference), and a playable peer copy raises a
 *   no-provider-rung item's Play button to the peer-copy path (never
 *   "no playback capability").
 * - THE HONEST FALLBACK: an authorized but ordinary (WebRTC-incapable)
 *   swarm renders the honest Desktop next step (the capability truth
 *   distinguishing WebTorrent-capable from ordinary torrent) — the
 *   entry stays visible, never a dead unavailable.
 * - THE PLAYER STAGE: `&realization=torrent` renders the torrent stage
 *   (the browser rung: play-language primary copy, the lifecycle
 *   surface, the parity surfaces) with the acquisition lifecycle driving
 *   the honest states.
 * - THE PARITY SET: the same canonical identity, the same Where-to-watch
 *   switch row, the same AI tray, the same feedback controls — the
 *   first-class parity dimensions render on the peer-copy player.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isLawfulTorrentPrimaryLabel } from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadDetailView, loadPlayerView } from "../src/host/view-models";
import { driveAcquisitionFixture } from "../src/host/acquisition-fixtures";
import { ItemDetailSurface } from "../src/components/item/ItemDetailSurface";
import { PlayerSurface } from "../src/components/player/PlayerSurface";
import { AppShell } from "../src/components/shell/AppShell";
import { withEnv } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
});

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The item's joined identity through the runtime's search. */
async function itemByTitle(host: WebRuntimeHost, title: string) {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`no fixture hit for '${title}'`);
  return { itemId: hit.canonicalItemId, result: hit.result };
}

/** The full detail/player markup (the real component tree). */
function surfaceMarkup(
  host: WebRuntimeHost,
  children: ReturnType<typeof createElement>,
): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      session: host.session.state,
      children,
    }),
  );
}

// ---------------------------------------------------------------------------
// The vocabulary law (machine-checked)
// ---------------------------------------------------------------------------

describe("R23-E — the frozen vocabulary (never merely 'Offline copy')", () => {
  it("'Authorized peer copy' is the lawful primary label; 'Offline copy' is not", () => {
    expect(isLawfulTorrentPrimaryLabel("Authorized peer copy")).toBe(true);
    expect(isLawfulTorrentPrimaryLabel("Offline copy")).toBe(false);
    expect(isLawfulTorrentPrimaryLabel("Download")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The Where-to-watch entry (the first-class realization)
// ---------------------------------------------------------------------------

describe("R23-E — the Where-to-watch entry (browser-capable peer copy)", () => {
  it("Asteroid Drift lists the authorized peer copy with its play path, after the WebFlix source group", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Asteroid Drift");
    const view = await loadDetailView(host, {
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      itemId,
    });
    if (view === null) throw new Error("the detail view did not load");
    // The entry exists, is the frozen label, and is playable here.
    expect(view.whereToWatch.peerCopy).not.toBeNull();
    const peerCopy = view.whereToWatch.peerCopy!;
    expect(peerCopy.label).toBe("Authorized peer copy");
    expect(peerCopy.usable).toBe(true);
    expect(peerCopy.switchHref).toContain("realization=torrent");
    const markup = surfaceMarkup(host, createElement(ItemDetailSurface, { view }));
    // The frozen grouping order: the WebFlix source group BEFORE the
    // authorized-peer-copy group (R23-C's frozen order).
    const sourceGroup = markup.indexOf('data-wfx-wheretowatch-group="webflix-source"');
    const peerGroup = markup.indexOf('data-wfx-wheretowatch-group="authorized-peer-copy"');
    expect(sourceGroup).toBeGreaterThanOrEqual(0);
    expect(peerGroup).toBeGreaterThan(sourceGroup);
    // The entry renders with the play path (the primary play decision).
    expect(markup).toContain('data-wfx-watch-option="authorized-peer-copy"');
    expect(markup).toContain('data-wfx-watch-switch="authorized-peer-copy"');
  });

  it("Desert Rain Doc (an ordinary swarm) renders the honest Desktop next step — visible, never dead", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Desert Rain Doc");
    const view = await loadDetailView(host, {
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      itemId,
    });
    if (view === null) throw new Error("the detail view did not load");
    const peerCopy = view.whereToWatch.peerCopy!;
    expect(peerCopy.usable).toBe(false);
    expect(peerCopy.unusableReason).toContain("Desktop app's native player");
    expect(peerCopy.switchHref).toBeUndefined();
    const markup = surfaceMarkup(host, createElement(ItemDetailSurface, { view }));
    // The entry stays visible with its honest reason (the capability
    // truth distinguishing WebTorrent-capable from ordinary torrent).
    expect(markup).toContain('data-wfx-watch-option="authorized-peer-copy"');
    expect(markup).toContain('data-wfx-watch-usable="false"');
  });

  it("an item with no authorized copy renders NO peer-copy entry (the honest absence)", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Neon Rain");
    const view = await loadDetailView(host, {
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      itemId,
    });
    if (view === null) throw new Error("the detail view did not load");
    expect(view.whereToWatch.peerCopy).toBeNull();
    const markup = surfaceMarkup(host, createElement(ItemDetailSurface, { view }));
    expect(markup).not.toContain('data-wfx-watch-option="authorized-peer-copy"');
  });
});

// ---------------------------------------------------------------------------
// The primary play decision eligibility
// ---------------------------------------------------------------------------

describe("R23-E — the peer copy is eligible for the primary play decision", () => {
  it("a playable peer copy raises the primary Play target when no provider rung is usable (constructed view)", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Asteroid Drift");
    const view = await loadDetailView(host, {
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      itemId,
    });
    if (view === null) throw new Error("the detail view did not load");
    // The no-provider-rung construction: the same view with the provider
    // capabilities stripped — the peer copy becomes the primary play.
    const stripped = {
      ...view,
      capabilities: view.capabilities.filter((capability) => !capability.startsWith("play")),
    };
    const markup = surfaceMarkup(host, createElement(ItemDetailSurface, { view: stripped }));
    expect(markup).toContain('data-wfx-item-play-realization="authorized-peer-copy"');
    expect(markup).toContain('data-wfx-item-play');
    expect(markup).not.toContain("declares no playback capability");
  });
});

// ---------------------------------------------------------------------------
// The player stage (the browser rung)
// ---------------------------------------------------------------------------

describe("R23-E — the player's torrent stage (the browser rung)", () => {
  it("&realization=torrent renders the peer-copy stage with play language + the lifecycle surface", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Asteroid Drift");
    // Start the acquisition (the lifecycle drives the stage honestly).
    const driven = driveAcquisitionFixture(host, { itemId, action: "acquire" });
    expect(driven.ok).toBe(true);
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      title: result.title,
      canonicalType: "video",
      preferredRealization: "torrent",
    });
    expect(view.torrent).not.toBeNull();
    expect(view.torrent?.rungKind).toBe("satisfies-browser-rung");
    expect(view.torrent?.label).toBe("Authorized peer copy");
    const markup = surfaceMarkup(host, createElement(PlayerSurface, { view }));
    expect(markup).toContain('data-wfx-player-mode="torrent"');
    // The play-language primary copy (the design language: another way
    // to watch, not a download workflow).
    expect(markup).toContain("plays like any other way of watching");
    // The parity surfaces render (the same canonical identity).
    expect(markup).toContain('data-wfx-where-to-watch');
    expect(markup).toContain('data-wfx-ai-tray');
    // The lifecycle surface (the same acquisition vocabulary).
    expect(markup).toContain('data-wfx-acquisition');
    // The watch-state start applied (the telemetry parity).
    const watch = host.runtime.watchState.get(itemId);
    expect(watch).not.toBeNull();
  });

  it("the ordinary-swarm item answers the honest Desktop next step in the player (never a fake stage)", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Desert Rain Doc");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      title: result.title,
      canonicalType: "video",
      preferredRealization: "torrent",
    });
    expect(view.torrent?.rungKind).toBe("desktop-next-step");
    expect(view.torrent?.desktopNextStep?.label).toBe("Play this in the Desktop app");
    const markup = surfaceMarkup(host, createElement(PlayerSurface, { view }));
    expect(markup).toContain('data-wfx-player-mode="torrent-desktop-next-step"');
    expect(markup).toContain("Play this in the Desktop app");
    // The same canonical item stays presented (the back-to-details path).
    expect(markup).toContain('data-wfx-torrent-back-to-details');
  });

  it("an unknown peer copy (no declaration) answers the typed not-found, never a fabricated stage", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Neon Rain");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      title: result.title,
      canonicalType: "video",
      preferredRealization: "torrent",
    });
    expect(view.torrent).toBeNull();
    expect(view.failure?.kind).toBe("not-found");
    expect(view.failure?.detail).toContain("no authorized peer copy is known");
    // The recovery: the Where-to-watch row still renders.
    const markup = surfaceMarkup(host, createElement(PlayerSurface, { view }));
    expect(markup).toContain('data-wfx-where-to-watch');
  });

  it("the acquisition lifecycle drives the stage states (buffering -> playing with truthful runway)", async () => {
    const host = await bootHost();
    const { itemId, result } = await itemByTitle(host, "Asteroid Drift");
    // Walk to the playing step (acquire + 4 advances — the same script
    // the J21-J26 chain walks: locating, choosing, transferring, the
    // playback-starting buffering, then PLAYING with its runway).
    driveAcquisitionFixture(host, { itemId, action: "acquire" });
    for (let step = 0; step < 4; step += 1) {
      driveAcquisitionFixture(host, { itemId, action: "advance" });
    }
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: result.connectorId,
      externalRef: result.externalRef,
      title: result.title,
      canonicalType: "video",
      preferredRealization: "torrent",
    });
    expect(view.torrent?.acquisition.view?.state).toBe("playing");
    const markup = surfaceMarkup(host, createElement(PlayerSurface, { view }));
    expect(markup).toContain('data-wfx-acquisition-state="playing"');
    expect(markup).toContain("buffered ahead");
  });
});
