/**
 * R30-A — the Subscribe reload-durability regression test (the
 * reload-durability probe as a test; the up-next-queue.test.ts house
 * style).
 *
 * THE R29 SWEEP'S ONE LOUD FINDING (evidence/r29-sweep/DIVERGENCES.md #1,
 * production-confirmed on webflix-steel.vercel.app): the Subscribe write
 * is REAL and durable server-side (POST /api/library → the stored truth),
 * and the Library page READS it — but a FRESH watch-page load rendered the
 * Subscribe pill idle (subscribeDurable.stateAfterReload: "idle") and a
 * fresh-load unsubscribe POST {op:"remove"} answered not-found ("not in
 * the local watchlist" — the client runtime's per-load map was empty).
 *
 * THE R30 LAW THIS TEST PINS: the watch surface's library truths hydrate
 * from the STORED library truth (the same server read the Library page's
 * read model performs), joined by the item's SOURCE identity — so:
 *   1. a fresh watch-page load renders the pill SUBSCRIBED when the
 *      stored truth says subscribed (never fabricated, never idle);
 *   2. the unsubscribe path works on a fresh load (the remove finds the
 *      stored item — the typed round trip closes);
 *   3. the Library list agrees at every step;
 *   4. the in-view round trip (subscribe → subscribed → unsubscribe →
 *      idle, one view) keeps working exactly as the sweep proved it;
 *   5. the watchlist store + the honest idle stay untouched (a plain
 *      watchlist save still lands in the Watchlist section; an item with
 *      NO stored truth renders idle — never a fabricated subscribed).
 *
 * THE RELOAD SIMULATION: the runtime's boot promise + the item join are
 * reset (a fresh process's runtime — the production-lambda case) while
 * the persona's file-backed service-side library SURVIVES (the stored
 * truth is the only cross-boot state; the library-fixtures.ts law). The
 * reactions store (localStorage, client-side) is not consulted by this
 * composition and is untouched by the seam.
 *
 * Determinism: fixture transport (the persona's library state starts
 * pristine), controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import { resetWebRuntimeHostForTests } from "../src/host/web-host";
import { resetItemJoinForTests } from "../src/host/view-models";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadPlayerViewShell, loadLibraryView } from "../src/host/view-models";
import { SUBSCRIPTIONS_LIST } from "../src/components/player/subscription-list";
import { POST as postLibrary } from "../src/app/api/library/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the up-next-queue.test.ts conventions)
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

/** Another fixture item (Static Bloom — the honest-idle control). */
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

/** The Subscribe write the ChannelRow pill sends (op + the item's full identity). */
async function subscribeThroughRoute(
  item: FixtureFields & { itemId: string },
): Promise<Response> {
  return post(postLibrary, {
    op: "save",
    itemId: item.itemId,
    title: item.title,
    connectorId: item.connectorId,
    externalRef: item.externalRef,
    listName: SUBSCRIPTIONS_LIST,
  });
}

/** The unsubscribe write the pill sends on a fresh load. */
async function unsubscribeThroughRoute(
  item: FixtureFields & { itemId: string },
): Promise<Response> {
  return post(postLibrary, {
    op: "remove",
    itemId: item.itemId,
    title: item.title,
    connectorId: item.connectorId,
    externalRef: item.externalRef,
    listName: SUBSCRIPTIONS_LIST,
  });
}

/** The shell input a watch-page render carries (the URL's own fields). */
function shellInput(item: FixtureFields & { itemId: string }) {
  return {
    itemId: item.itemId,
    connectorId: item.connectorId,
    externalRef: item.externalRef,
    title: item.title,
    canonicalType: item.canonicalType,
    ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
  };
}

/**
 * THE RELOAD: reset the runtime's process state (a fresh process's
 * runtime — the boot promise + the canonical/item joins) while the
 * persona's file-backed service-side library SURVIVES (the stored truth
 * is the cross-boot state; resetWebHostProcessState would delete it —
 * the granular resets are the reload's honest simulation).
 */
function simulateFreshProcess(): void {
  resetWebRuntimeHostForTests();
  resetItemJoinForTests();
}

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The reload-durability probe (the regression test)
// ---------------------------------------------------------------------------

describe("R30-A — the Subscribe reload-durability (the watch page hydrates the stored library truth)", () => {
  it("subscribe → RELOAD → the pill renders the stored truth (subscribed); the Library agrees", async () => {
    // ── phase A: the subscribe write (the REAL route; the REAL stored truth) ──
    const hostA = await bootHost();
    const DIARY_A = await fixtureItem(hostA, DIARY_FIELDS);
    const saved = await subscribeThroughRoute(DIARY_A);
    const savedBody = (await saved.json()) as {
      ok: boolean;
      entry?: { itemId: string; listName: string; sync: string };
    };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.entry?.listName).toBe(SUBSCRIPTIONS_LIST);
    expect(savedBody.entry?.sync).toBe("synced");

    // The Library's stored truth (the read path that always existed).
    const libraryA = await loadLibraryView(hostA);
    const subsA = libraryA.playlists.lists.find((list) => list.name === SUBSCRIPTIONS_LIST);
    expect(subsA).toBeDefined();
    expect(subsA?.entries.map((entry) => entry.title)).toContain(DIARY_FIELDS.title);

    // ── THE RELOAD: a fresh process's runtime (the stored truth survives) ──
    simulateFreshProcess();
    const hostB = await bootHost();
    // The fresh load enters through the runtime's own browse (home's search
    // resolves the item — the card link's id is the fresh registry's id).
    const DIARY_B = await fixtureItem(hostB, DIARY_FIELDS);

    // (1) THE PILL RENDERS THE STORED TRUTH — subscribed on a fresh load
    // (the pre-R30 build answered idle: the per-load map was empty).
    const shellB = await loadPlayerViewShell(hostB, shellInput(DIARY_B));
    expect(shellB.subscribed).toBe(true);

    // The Watch-later pill's truth is the app's own any-list membership law
    // (`entries().some(entry => entry.itemId === itemId)` — the pre-R30
    // semantics): the item IS in the library (the Subscriptions row), so the
    // pill renders saved — CONSISTENTLY across the reload now (pre-R30 the
    // same view said true and the fresh load said false).
    expect(shellB.watchlistSaved).toBe(true);

    // (2) THE FRESH-LOAD UNSUBSCRIBE WORKS: the remove finds the stored item
    // (the pre-R30 build answered not-found — "not in the local watchlist").
    const removed = await unsubscribeThroughRoute(DIARY_B);
    const removedBody = (await removed.json()) as {
      ok: boolean;
      entry?: { itemId: string };
      kind?: string;
      detail?: string;
    };
    expect(removedBody.ok).toBe(true);

    // (3) THE LIBRARY AGREES at every step: the Subscriptions list is gone
    // (the store left clean — the sweep's cleanup law).
    const libraryB = await loadLibraryView(hostB);
    const subsB = libraryB.playlists.lists.find((list) => list.name === SUBSCRIPTIONS_LIST);
    expect(subsB).toBeUndefined();

    // ── the unsubscribe → RELOAD → the pill renders the stored truth (idle) ──
    simulateFreshProcess();
    const hostC = await bootHost();
    const DIARY_C = await fixtureItem(hostC, DIARY_FIELDS);
    const shellC = await loadPlayerViewShell(hostC, shellInput(DIARY_C));
    expect(shellC.subscribed).toBe(false);
  });

  it("the in-view round trip (subscribe → subscribed → unsubscribe → idle, ONE view) keeps working exactly as the sweep proved", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);

    // Fresh: idle (no stored truth — never a fabricated subscribed).
    const before = await loadPlayerViewShell(host, shellInput(DIARY));
    expect(before.subscribed).toBe(false);

    // Subscribe → the pill's state renders subscribed.
    await subscribeThroughRoute(DIARY);
    const afterSubscribe = await loadPlayerViewShell(host, shellInput(DIARY));
    expect(afterSubscribe.subscribed).toBe(true);

    // Unsubscribe → the pill's state renders idle; the Library is clean.
    const removed = await unsubscribeThroughRoute(DIARY);
    const removedBody = (await removed.json()) as { ok: boolean };
    expect(removedBody.ok).toBe(true);
    const afterUnsubscribe = await loadPlayerViewShell(host, shellInput(DIARY));
    expect(afterUnsubscribe.subscribed).toBe(false);
    const library = await loadLibraryView(host);
    expect(library.playlists.lists.find((list) => list.name === SUBSCRIPTIONS_LIST)).toBeUndefined();
  });

  it("the honest idle: an item with NO stored truth renders idle on a fresh load (never a fabricated subscribed)", async () => {
    const hostA = await bootHost();
    // Phase A subscribes ONE item (Deep Field Diary) — the stored truth.
    const DIARY_A = await fixtureItem(hostA, DIARY_FIELDS);
    await subscribeThroughRoute(DIARY_A);

    // The fresh load: Static Bloom was never subscribed — the pill is IDLE
    // (the stored-truth join never fabricates a subscription).
    simulateFreshProcess();
    const hostB = await bootHost();
    const BLOOM_B = await fixtureItem(hostB, BLOOM_FIELDS);
    const shellB = await loadPlayerViewShell(hostB, shellInput(BLOOM_B));
    expect(shellB.subscribed).toBe(false);
    expect(shellB.watchlistSaved).toBe(false);

    // Cleanup: remove phase A's stored truth (the store left clean).
    const DIARY_B = await fixtureItem(hostB, DIARY_FIELDS);
    const removed = await unsubscribeThroughRoute(DIARY_B);
    const removedBody = (await removed.json()) as { ok: boolean };
    expect(removedBody.ok).toBe(true);
  });

  it("the watchlist store stays untouched by the seam: a plain save still lands in the Watchlist section (never a playlist row)", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);
    const saved = await post(postLibrary, { op: "save", itemId: DIARY.itemId });
    const savedBody = (await saved.json()) as { ok: boolean; entry?: { listName: string } };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.entry?.listName).toBe("Saved");
    const library = await loadLibraryView(host);
    expect(library.playlists.lists.length).toBe(0);
    expect(library.watchlist.entries.map((entry) => entry.itemId)).toContain(DIARY.itemId);

    // The reload keeps the watchlist truth too (the same stored-library
    // hydration serves BOTH pills — one read, one law).
    simulateFreshProcess();
    const hostB = await bootHost();
    const DIARY_B = await fixtureItem(hostB, DIARY_FIELDS);
    const shellB = await loadPlayerViewShell(hostB, shellInput(DIARY_B));
    expect(shellB.watchlistSaved).toBe(true);
    expect(shellB.subscribed).toBe(false); // the Subscriptions truth is separate
  });
});
