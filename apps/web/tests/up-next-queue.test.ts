/**
 * R24-W2 — the session queue + the WebFlix-native watchlist save + the
 * share control + the Library playlists tests (bun:test).
 *
 * Proves the R24-C pairing rows' real backing over the fixtures-boot
 * composition:
 *
 * - THE SESSION QUEUE (the queue row): the session-scoped store's typed
 *   mutations (add idempotent-move-to-tail / remove / move / clear /
 *   autoplay) through the REAL /api/queue route, plus the honest
 *   refusals (unknown item, boundary moves);
 * - THE SAVE-QUEUE ACTION (the save-queue row): every queued item
 *   written through the runtime's OWN LibraryOperations.save with the
 *   list name — the per-item typed outcomes, the empty-queue refusal;
 * - THE WEBFLIX-NATIVE WATCHLIST SAVE (the watch-later row): the
 *   /api/library route writes the canonical-keyed entry REGARDLESS of
 *   provider capability (the fixture source declares no save — the
 *   audit's gap), the remove answers the typed truth, the Library
 *   reflects both sections;
 * - THE PLAYLISTS (the playlists row): the named lists render as their
 *   own Library section; the default watchlist list stays the Watchlist
 *   section (one write path, two honest sections);
 * - THE SHARE CONTROL (the share row): the canonical link renders on
 *   the player + the item hub with the source link where one exists.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadPlayerView, loadLibraryView, loadDetailView } from "../src/host/view-models";
import type { PlayerEnrichments, PlayerShellView, PlayerView } from "../src/host/view-models";
import { PlayerSurface } from "../src/components/player/PlayerSurface";

/**
 * The surface's render props from a composed view (the shell fields +
 * the RESOLVED enrichments — the composed render path: the sections
 * render inline, no suspension, no streaming).
 */
function playerSurfaceRenderProps(
  view: PlayerView,
): {
  view: PlayerShellView;
  enrichments: PlayerEnrichments;
} {
  return {
    view,
    enrichments: {
      aiTray: view.aiTray,
      intelligence: view.intelligence,
      liveAsr: view.liveAsr,
      realtime: view.realtime,
      related: view.related,
    },
  };
}
import { ItemDetailSurface } from "../src/components/item/ItemDetailSurface";
import { LibrarySurface } from "../src/components/library/LibrarySurface";
import { GET as getQueue, POST as postQueue } from "../src/app/api/queue/route";
import { POST as postLibrary } from "../src/app/api/library/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The long-form fixture item's own fields (Deep Field Diary — the browser rung). */
const DIARY_FIELDS = {
  connectorId: "fake-source",
  externalRef: "fake:video-1",
  title: "Deep Field Diary",
  canonicalType: "video",
  durationMs: 1_800_000,
} as const;

/** Another fixture item's own fields (Static Bloom — the queue's second entry). */
const BLOOM_FIELDS = {
  connectorId: "fake-source",
  externalRef: "fake:video-3",
  title: "Static Bloom",
  canonicalType: "video",
  durationMs: 600_000,
} as const;

/** One fixture item's own fields (the shared shape). */
interface FixtureFields {
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
}

/** Resolve one fixture item through the REAL runtime search seam (the
 * browse flow: the canonical id the runtime's own registry minted). */
async function fixtureItem(
  host: WebRuntimeHost,
  fields: FixtureFields,
): Promise<FixtureFields & { itemId: string }> {
  const model = await host.runtime.search({ query: fields.title });
  const hit = model.hits.find((entry) => entry.result.title === fields.title);
  if (hit === undefined) throw new Error(`fixture item '${fields.title}' not found`);
  return { ...fields, itemId: hit.canonicalItemId };
}

/** POST one JSON body to a route handler (the real handler, no network). */
async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}



beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The session queue (the store + the route)
// ---------------------------------------------------------------------------

describe("R24-W2 — the session queue (the session-scoped ordering store)", () => {
  it("add places entries at the tail; a duplicate add MOVES to the tail (one entry per canonical item)", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const BLOOM = await fixtureItem(host, BLOOM_FIELDS);
    const first = await post(postQueue, { action: "add", entry: DIARY });
    expect(first.status).toBe(200);
    const second = await post(postQueue, { action: "add", entry: BLOOM });
    const secondBody = (await second.json()) as { ok: boolean; state?: { entries: { itemId: string }[] } };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.state?.entries.map((entry) => entry.itemId)).toEqual([DIARY.itemId, BLOOM.itemId]);
    // The duplicate add moves Deep Field Diary to the tail.
    const again = await post(postQueue, { action: "add", entry: DIARY });
    const againBody = (await again.json()) as { state?: { entries: { itemId: string }[] } };
    expect(againBody.state?.entries.map((entry) => entry.itemId)).toEqual([BLOOM.itemId, DIARY.itemId]);
  });

  it("remove/move answer the typed refusals (unknown item, boundary moves)", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const unknown = await post(postQueue, { action: "remove", itemId: "wfxitm_nope" });
    const unknownBody = (await unknown.json()) as { ok: boolean; kind?: string };
    expect(unknownBody.ok).toBe(false);
    expect(unknownBody.kind).toBe("not-found");

    await post(postQueue, { action: "add", entry: DIARY });
    const boundary = await post(postQueue, { action: "move", itemId: DIARY.itemId, direction: "up" });
    const boundaryBody = (await boundary.json()) as { ok: boolean; kind?: string };
    expect(boundaryBody.ok).toBe(false);
    expect(boundaryBody.kind).toBe("invalid-input");
  });

  it("move reorders; clear empties; autoplay toggles — all through the typed route", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const BLOOM = await fixtureItem(host, BLOOM_FIELDS);
    await post(postQueue, { action: "add", entry: DIARY });
    await post(postQueue, { action: "add", entry: BLOOM });
    const moved = await post(postQueue, { action: "move", itemId: BLOOM.itemId, direction: "up" });
    const movedBody = (await moved.json()) as { state?: { entries: { itemId: string }[] } };
    expect(movedBody.state?.entries.map((entry) => entry.itemId)).toEqual([BLOOM.itemId, DIARY.itemId]);

    const autoplay = await post(postQueue, { action: "autoplay", enabled: false });
    const autoplayBody = (await autoplay.json()) as { state?: { autoplay: boolean } };
    expect(autoplayBody.state?.autoplay).toBe(false);

    const cleared = await post(postQueue, { action: "clear" });
    const clearedBody = (await cleared.json()) as { state?: { entries: unknown[] } };
    expect(clearedBody.state?.entries.length).toBe(0);
  });

  it("GET answers the store's honest snapshot; malformed actions answer 400s", async () => {
    await bootHost();
    const snapshot = await getQueue();
    const body = (await snapshot.json()) as { ok: boolean; entries: unknown[]; autoplay: boolean };
    expect(body.ok).toBe(true);
    expect(body.entries.length).toBe(0);
    expect(body.autoplay).toBe(true);

    const bad = await post(postQueue, { action: "rewind" });
    expect(bad.status).toBe(400);
  });

  it("the player renders the queue's initial state on the Up-next rail", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const BLOOM = await fixtureItem(host, BLOOM_FIELDS);
    await post(postQueue, { action: "add", entry: DIARY });
    await post(postQueue, { action: "add", entry: BLOOM });
    const view = await loadPlayerView(host, BLOOM);
    const markup = renderToStaticMarkup(createElement(PlayerSurface, playerSurfaceRenderProps(view)));
    // The queue head is the up-next card; the queue list renders below it.
    expect(markup).toContain("data-wfx-up-next-card");
    expect(markup).toContain("From your queue");
    expect(markup).toContain(`data-wfx-queue-item="${DIARY.itemId}"`);
  });
});

// ---------------------------------------------------------------------------
// The save-queue action (the durable playlist write)
// ---------------------------------------------------------------------------

describe("R24-W2 — the save-queue action writes the playlist through the runtime's library seam", () => {
  it("every queued item lands in the named list (the per-item typed outcomes)", async () => {
    const host = await bootHost();
    // The real flow: browsing resolves + registers the canonical items
    // (the queue composes the runtime's own identity — never a second registry).
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const BLOOM = await fixtureItem(host, BLOOM_FIELDS);
    await post(postQueue, { action: "add", entry: DIARY });
    await post(postQueue, { action: "add", entry: BLOOM });
    const saved = await post(postQueue, { action: "save-playlist", listName: "Evening watch" });
    const savedBody = (await saved.json()) as { ok: boolean; listName?: string; saved?: number };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.listName).toBe("Evening watch");
    expect(savedBody.saved).toBe(2);

    // The Library renders the playlist section with the named list.
    const library = await loadLibraryView(host);
    const markup = renderToStaticMarkup(createElement(LibrarySurface, { view: library }));
    expect(markup).toContain("data-wfx-library-playlists");
    expect(markup).toContain('data-wfx-library-playlist="Evening watch"');
    expect(markup).toContain("Deep Field Diary");
    expect(markup).toContain("Static Bloom");
  });

  it("the empty queue answers the typed refusal (never a fabricated empty playlist)", async () => {
    await bootHost();
    const saved = await post(postQueue, { action: "save-playlist" });
    const body = (await saved.json()) as { ok: boolean; kind?: string };
    expect(body.ok).toBe(false);
    expect(body.kind).toBe("not-found");
  });

  it("the default queue name is 'Queue' when none is provided", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    await post(postQueue, { action: "add", entry: DIARY });
    const saved = await post(postQueue, { action: "save-playlist" });
    const body = (await saved.json()) as { listName?: string };
    expect(body.listName).toBe("Queue");
    const library = await loadLibraryView(host);
    expect(library.playlists.lists.map((list) => list.name)).toContain("Queue");
  });
});

// ---------------------------------------------------------------------------
// The WebFlix-native watchlist save (the audit's gap closed)
// ---------------------------------------------------------------------------

describe("R24-W2 — the WebFlix-native watchlist save (independent of provider capability)", () => {
  it("the save writes the canonical entry on a source with NO save capability (the audit's gap)", async () => {
    const host = await bootHost();
    // The fixture source declares no 'save' capability — the audit found
    // NO WebFlix-native save existed. The library route closes it.
    // (The search seam resolves the runtime's own canonical id.)
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const detail = await loadDetailView(host, {
      connectorId: DIARY.connectorId,
      externalRef: DIARY.externalRef,
      itemId: DIARY.itemId,
    });
    expect(detail?.capabilities.includes("save")).toBe(false);

    const saved = await post(postLibrary, { op: "save", itemId: DIARY.itemId });
    const savedBody = (await saved.json()) as {
      ok: boolean;
      entry?: { itemId: string; title: string; listName: string; sync: string };
    };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.entry?.itemId).toBe(DIARY.itemId);
    expect(savedBody.entry?.title).toBe(DIARY.title);
    expect(savedBody.entry?.listName).toBe("Saved");

    // The Library's Watchlist section reflects the write.
    const library = await loadLibraryView(host);
    expect(library.watchlist.entries.map((entry) => entry.itemId)).toContain(DIARY.itemId);
  });

  it("the named-list save lands in the playlists section (the same one write path)", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const saved = await post(postLibrary, { op: "save", itemId: DIARY.itemId, listName: "Watch again" });
    const body = (await saved.json()) as { ok: boolean; entry?: { listName: string } };
    expect(body.ok).toBe(true);
    expect(body.entry?.listName).toBe("Watch again");
    const library = await loadLibraryView(host);
    expect(library.playlists.lists.map((list) => list.name)).toContain("Watch again");
  });

  it("remove answers the runtime's typed refusal for an unsaved item", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const removed = await post(postLibrary, { op: "remove", itemId: DIARY.itemId });
    const body = (await removed.json()) as { ok: boolean; kind?: string };
    expect(body.ok).toBe(false);
    expect(body.kind).toBe("not-found");
  });

  it("malformed bodies answer the typed 400s", async () => {
    await bootHost();
    const badOp = await post(postLibrary, { op: "like", itemId: "x" });
    expect(badOp.status).toBe(400);
    const noItem = await post(postLibrary, { op: "save" });
    expect(noItem.status).toBe(400);
  });

  it("the player + the item hub render the watchlist save + the share control", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const playerView = await loadPlayerView(host, DIARY);
    const playerMarkup = renderToStaticMarkup(createElement(PlayerSurface, playerSurfaceRenderProps(playerView)));
    expect(playerMarkup).toContain("data-wfx-watchlist-save");
    expect(playerMarkup).toContain("data-wfx-watchlist-toggle");
    expect(playerMarkup).toContain("data-wfx-share");
    expect(playerMarkup).toContain("data-wfx-share-copy");

    const detail = await loadDetailView(host, {
      connectorId: DIARY.connectorId,
      externalRef: DIARY.externalRef,
      itemId: DIARY.itemId,
    });
    expect(detail).not.toBeNull();
    const detailMarkup = renderToStaticMarkup(
      createElement(ItemDetailSurface, { view: detail! }),
    );
    expect(detailMarkup).toContain("data-wfx-watchlist-save");
    expect(detailMarkup).toContain("data-wfx-share");
    expect(detailMarkup).toContain("data-wfx-queue-add");
    expect(detailMarkup).toContain("data-wfx-item-source");
  });
});

// ---------------------------------------------------------------------------
// The Library playlists section (the honest projection)
// ---------------------------------------------------------------------------

describe("R24-W2 — the Library's playlists section (the named lists projection)", () => {
  it("an empty library renders the playlists empty state honestly", async () => {
    const host = await bootHost();
    const library = await loadLibraryView(host);
    const markup = renderToStaticMarkup(createElement(LibrarySurface, { view: library }));
    expect(markup).toContain("data-wfx-library-playlists");
    expect(markup).toContain("No playlists yet");
  });

  it("the default watchlist list stays the Watchlist section (never a playlist row)", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    await post(postLibrary, { op: "save", itemId: DIARY.itemId });
    const library = await loadLibraryView(host);
    expect(library.playlists.lists.length).toBe(0);
    expect(library.watchlist.entries.length).toBe(1);
  });
});
