/**
 * R38-B — THE STUDIO VIEW LOADERS LANE TESTS (the server-side
 * composition over R36's read surfaces — studio-views.ts).
 *
 * Proves the COMPOSITION LAW over the REAL fixtures-boot composition
 * (the same machinery the battery runs):
 *
 * - THE CHANNEL RESOLUTION: the default channel is the catalog's first
 *   source addressed by its OWN derived handle (the pure href law);
 *   `?channel=<handle>` selects; a handle no source owns answers the
 *   typed not-found view (never a guessed channel);
 * - THE PUBLISHED SET: the items are the channel's REAL catalog items
 *   (the discovery-derived feed — the same `loadChannelView` the
 *   channel page renders: 6 long-form + 3 shorts on the fixtures
 *   boot, the R36 split's own counts);
 * - THE IDENTITY PROJECTION: R36's derivation carried verbatim (the
 *   display name, the monogram, the banner/description absence notes,
 *   the stable handle);
 * - THE ITEM FINDER: the details editor's resolution finds the
 *   channel's own item by canonical id and refuses a foreign id
 *   (never a fabricated edit target);
 * - THE ANALYTICS TRUTHS: the library saves read the runtime's own
 *   library seam (a save through the runtime's own write lands in the
 *   per-item saves; a fresh library answers the typed-empty set).
 *
 * Determinism: the fixture host under a controlled environment
 * (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../testing";
import { getWebRuntimeHost } from "../web-host";
import type { WebRuntimeHost } from "../web-host";
import {
  findStudioItem,
  loadStudioAnalyticsTruths,
  resolveStudioChannel,
} from "./studio-views";

/**
 * Run an async body with a controlled env, restoring the real one after
 * (the fake-web.ts law, inlined — the lane checker's depth rule keeps a
 * colocated src test from importing the tests/ helper).
 */
async function withEnv(overrides: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const env = process.env as unknown as Record<string, string | undefined>;
  const names = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV", "WFX_LOCALE"];
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, env[name]);
  try {
    for (const name of names) delete env[name];
    for (const [name, value] of Object.entries(overrides)) env[name] = value;
    await body();
  } finally {
    for (const name of names) {
      const value = saved.get(name);
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
}

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

beforeEach(() => {
  resetWebHostProcessState();
});

describe("R38-B studio views — the channel resolution (the honest binding)", () => {
  it("resolves the catalog's first source as the default channel (by its own derived handle)", async () => {
    const host = await bootHost();
    const resolution = await resolveStudioChannel(host, {});
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.view.identity.connectorId).toBe("fake-source");
    expect(resolution.view.identity.handle).toBe("fake-source");
    expect(resolution.view.identity.displayName).toBe(
      "Fake Source (TEST FIXTURE — never production)",
    );
  });

  it("selects the channel by handle and answers the typed not-found for an unknown handle", async () => {
    const host = await bootHost();
    const selected = await resolveStudioChannel(host, { channel: "fake-source" });
    expect(selected.ok).toBe(true);
    const missing = await resolveStudioChannel(host, { channel: "no-such-channel" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.view.handle).toBe("no-such-channel");
    expect(missing.view.mode).toBe("fixtures");
  });
});

describe("R38-B studio views — the published set (the same feed the channel page renders)", () => {
  it("carries the channel's real catalog items with the R36 split's own counts", async () => {
    const host = await bootHost();
    const resolution = await resolveStudioChannel(host, {});
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const view = resolution.view;
    expect(view.items.length).toBe(9);
    expect(view.stats.videoCount).toBe(6);
    expect(view.stats.shortsCount).toBe(3);
    expect(view.items.filter((item) => item.isShort).length).toBe(3);
    // Every item carries the source's own identity (never a fabricated row).
    for (const item of view.items) {
      expect(item.connectorId).toBe("fake-source");
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.itemId.startsWith("wfxitm_")).toBe(true);
    }
    // The fixtures catalog declares no publish dates or view counts — the
    // honest absences (J44's own law).
    expect(view.items.every((item) => item.publishedAt === null)).toBe(true);
    expect(view.items.every((item) => item.viewCount === null)).toBe(true);
  });

  it("projects R36's derived identity verbatim (the monogram, the absences, the stable handle)", async () => {
    const host = await bootHost();
    const resolution = await resolveStudioChannel(host, {});
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const identity = resolution.view.identity;
    expect(identity.avatarMark).toBe("F");
    expect(identity.banner.state).toBe("absent");
    expect(identity.banner.note).toContain("does not fabricate");
    expect(identity.descriptionDeclared).toBe(false);
    expect(identity.description).toContain("declares no channel description");
  });
});

describe("R38-B studio views — the item finder (the editor's resolution)", () => {
  it("finds the channel's own item by canonical id and refuses a foreign id", async () => {
    const host = await bootHost();
    const resolution = await resolveStudioChannel(host, {});
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const view = resolution.view;
    const first = view.items[0]!;
    expect(findStudioItem(view, first.itemId)?.title).toBe(first.title);
    expect(findStudioItem(view, "wfxitm_00000000000000000000zzzz")).toBeNull();
  });
});

describe("R38-B studio views — the analytics server truths (the library seam)", () => {
  it("reads the saves through the runtime's own library (a real save lands; a fresh library is the typed-empty set)", async () => {
    const host = await bootHost();
    const loaded = await loadStudioAnalyticsTruths(host, {});
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { channel, saves } = loaded.truths;
    expect(channel.items.length).toBe(9);
    // The fresh session's library carries no saves for the channel's
    // items — the typed-empty set (never a fabricated save).
    expect(Object.keys(saves).length).toBe(0);

    // A REAL save through the runtime's own library seam lands in the
    // per-item saves (the same seam the Library and the channel
    // playlists read).
    const target = channel.items[0]!;
    await host.runtime.libraryOps.hydrate();
    const saved = await host.runtime.libraryOps.save({ itemId: target.itemId });
    expect(saved.ok).toBe(true);
    const reloaded = await loadStudioAnalyticsTruths(host, {});
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    const savedLists = reloaded.truths.saves[target.itemId];
    expect(savedLists).toBeDefined();
    expect(savedLists!.listNames).toContain("Saved");
  });
});
