/**
 * R35 — the B3 regression test (the Library's playlist-row source
 * realization on a fresh instance; the subscribe-reload-durability.test.ts
 * house style).
 *
 * THE R34-A LEDGER'S B3 ROW: the playlist write landed and was visible
 * ("Parity Walk" in the Library's Playlists section) but the section
 * answered "1 unavailable video is hidden" — the Library read could not
 * resolve the item's source realization in its own instance. The write's
 * own control answered honestly; the READ-SIDE resolution was the gap
 * (the same read-path class as B2: a fresh process's item join map never
 * ran the searches that teach it, so a row the source still serves hid
 * behind the §9 unavailable notice — the notice the LibrarySurface
 * derives from `entries.filter((entry) => entry.joined === null)`).
 *
 * THE R35 LAW THIS TEST PINS: when any watchlist/history entry is
 * unresolved, the Library read resolves the STORED rows' source
 * realizations through the runtime's OWN search seam (the `/api/library`
 * bridge law — matched by the source key, so the join lands under the
 * entry's own canonical id) and re-joins. A row the source still serves
 * renders JOINED (no §9 hide); the write keeps landing visible on every
 * boot; the fresh-instance remove keeps working (the R30 law's seam).
 *
 * Fails on main (the fresh join map is empty → the playlist row's
 * `joined` is null → the "1 unavailable video is hidden" notice); passes
 * on wfx/r35/readpath.
 *
 * Determinism: fixture transport (the persona's library starts pristine
 * via resetWebHostProcessState), controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import { resetWebRuntimeHostForTests } from "../src/host/web-host";
import { resetItemJoinForTests } from "../src/host/view-models";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadLibraryView } from "../src/host/view-models";
import { POST as postLibrary } from "../src/app/api/library/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the subscribe-reload-durability.test.ts conventions)
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

/** The ledger's own playlist name (the J40 step11 flow's list). */
const PARITY_WALK = "Parity Walk";

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

/** The save-to-playlist write the item hub's save control sends. */
async function saveToPlaylist(item: FixtureFields & { itemId: string }): Promise<Response> {
  return post(postLibrary, {
    op: "save",
    itemId: item.itemId,
    title: item.title,
    connectorId: item.connectorId,
    externalRef: item.externalRef,
    listName: PARITY_WALK,
  });
}

/**
 * THE RELOAD: reset the runtime's process state (a fresh process's
 * runtime — the boot promise + the canonical/item joins) while the
 * persona's file-backed service-side library SURVIVES (the stored truth
 * is the cross-boot state).
 */
function simulateFreshProcess(): void {
  resetWebRuntimeHostForTests();
  resetItemJoinForTests();
}

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The regression probe
// ---------------------------------------------------------------------------

describe("R35 (B3) — the Library resolves a stored playlist row's source realization on a fresh instance", () => {
  it("save-to-playlist → RELOAD → the row renders JOINED (no '1 unavailable video is hidden'); the write stays visible on every boot", async () => {
    // ── phase A: the save-to-playlist write (the ledger's J40 step11
    //    flow — the write's own control answered honestly) ──
    const hostA = await bootHost();
    const DIARY_A = await fixtureItem(hostA, DIARY_FIELDS);
    const saved = await saveToPlaylist(DIARY_A);
    const savedBody = (await saved.json()) as { ok: boolean; entry?: { listName: string } };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.entry?.listName).toBe(PARITY_WALK);

    // The same-instance Library lists the playlist JOINED (the join map
    // was taught by the write's own resolution — always worked).
    const libraryA = await loadLibraryView(hostA);
    const listA = libraryA.playlists.lists.find((list) => list.name === PARITY_WALK);
    expect(listA).toBeDefined();
    expect(listA!.entries).toHaveLength(1);
    expect(listA!.entries[0]!.joined).not.toBeNull();

    // ── THE RELOAD: a fresh process's runtime — NOTE: no search runs
    //    before the Library read (the fresh join map must stay empty to
    //    reproduce the service-mode truth: each page render a cold
    //    runtime that never ran the write's searches) ──
    simulateFreshProcess();
    const hostB = await bootHost();

    // (1) THE WRITE STAYS VISIBLE (the ledger's "the playlist write lands
    //     and is visible" — the stored read lists the row on every boot).
    const libraryB = await loadLibraryView(hostB);
    const listB = libraryB.playlists.lists.find((list) => list.name === PARITY_WALK);
    expect(listB).toBeDefined();
    expect(listB!.entries).toHaveLength(1);
    expect(listB!.entries[0]!.title).toBe(DIARY_FIELDS.title);

    // (2) THE B3 DEFECT ITSELF: on main the fresh instance's join map
    //     never resolved the row — `joined` was null and the section
    //     answered "1 unavailable video is hidden" — while the source
    //     still serves the item. R35: the stored rows' source
    //     realizations resolve through the runtime's own search seam and
    //     the row re-joins.
    expect(listB!.entries[0]!.joined).not.toBeNull(); // ← FAILS ON MAIN
    expect(listB!.entries[0]!.joined!.title).toBe(DIARY_FIELDS.title);
    // The §9 notice's own count source: zero unresolved entries in the
    // list (the "N unavailable videos are hidden" grammar never fires).
    expect(listB!.entries.every((entry) => entry.joined !== null)).toBe(true);

    // (3) THE FRESH-INSTANCE REMOVE WORKS (the R30 law's shared seam):
    //     the remove finds the stored row — the row's own itemId is the
    //     fresh read model's id (the idempotent source-key law).
    const removed = await post(postLibrary, {
      op: "remove",
      itemId: listB!.entries[0]!.itemId,
      title: DIARY_FIELDS.title,
      connectorId: DIARY_FIELDS.connectorId,
      externalRef: DIARY_FIELDS.externalRef,
      listName: PARITY_WALK,
    });
    expect(((await removed.json()) as { ok: boolean }).ok).toBe(true);

    // (4) THE STORE LEFT CLEAN (the sweep's cleanup law): a fresh load
    //     lists no playlist — the remove is durable too.
    simulateFreshProcess();
    const hostC = await bootHost();
    const libraryC = await loadLibraryView(hostC);
    expect(libraryC.playlists.lists.find((list) => list.name === PARITY_WALK)).toBeUndefined();
  });
});
