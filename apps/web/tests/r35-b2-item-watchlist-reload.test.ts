/**
 * R35 — the B2 regression test (the item hub's watchlist truth on a fresh
 * instance; the subscribe-reload-durability.test.ts house style).
 *
 * THE R34-A LEDGER'S B2 ROW: after a successful Save-to-Watchlist (the
 * control answered "Saved to your Watchlist."; the Library page lists the
 * row), the item hub on RELOAD still offered "Save to Watchlist"
 * (`data-wfx-watchlist-saved="false"`). The Library page's read (the
 * service store) saw the write; the item page's read did not — the item
 * hub's `watchlistSaved` folded only the PER-INSTANCE runtime state,
 * which on the service-mode boot (every page render a cold runtime) is
 * empty while the STORED truth carries the write.
 *
 * THE R35 LAW THIS TEST PINS: the item hub's `loadDetailView` reads the
 * STORED library (the same `readProfileLibrary` read the Library page's
 * read model performs), joined by the item's SOURCE identity
 * (connectorId + externalRef — the durable key), BEFORE the per-instance
 * fold is consulted. So a fresh load renders the pill SAVED when the
 * stored truth says saved; an item with NO stored truth stays honestly
 * unsaved (never fabricated); the fresh-instance remove keeps working
 * (the R30 law this read now shares its seam with).
 *
 * THE RELOAD SIMULATION (the R30 harness law): the runtime's boot promise
 * + the item join are reset (a fresh process's runtime) while the
 * persona's file-backed service-side library SURVIVES (the stored truth
 * is the only cross-boot state). This is the service-mode split's honest
 * in-harness reproduction — the defect the ledger recorded as
 * "cannot reproduce on the single-instance dev boot".
 *
 * Fails on main (the fold-only read answers false post-reload); passes
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
import { loadDetailView, loadLibraryView } from "../src/host/view-models";
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

/** Another fixture item (Static Bloom — the honest-unsaved control). */
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

/** The item hub's deep-link input (the item page's own fields). */
function detailInput(item: FixtureFields & { itemId: string }) {
  return {
    itemId: item.itemId,
    connectorId: item.connectorId,
    externalRef: item.externalRef,
  };
}

/**
 * THE RELOAD: reset the runtime's process state (a fresh process's
 * runtime — the boot promise + the canonical/item joins) while the
 * persona's file-backed service-side library SURVIVES (the stored truth
 * is the cross-boot state; resetWebHostProcessState would delete it).
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

describe("R35 (B2) — the item hub's watchlist truth on a fresh instance (the stored read before the fold)", () => {
  it("save → RELOAD → the item hub's watchlistSaved folds the STORED truth (saved), the Library agrees, the fresh remove works", async () => {
    // ── phase A: the Save-to-Watchlist write (the ledger's J40 step08b
    //    flow — the control's own answer is the saved truth) ──
    const hostA = await bootHost();
    const DIARY_A = await fixtureItem(hostA, DIARY_FIELDS);
    const saved = await post(postLibrary, {
      op: "save",
      itemId: DIARY_A.itemId,
      title: DIARY_A.title,
      connectorId: DIARY_A.connectorId,
      externalRef: DIARY_A.externalRef,
    });
    const savedBody = (await saved.json()) as { ok: boolean; entry?: { listName: string } };
    expect(savedBody.ok).toBe(true);
    expect(savedBody.entry?.listName).toBe("Saved"); // the default watchlist list

    // The Library's read sees the write (the ledger's step11 truth — the
    // read path that always worked; both boots).
    const libraryA = await loadLibraryView(hostA);
    expect(libraryA.watchlist.entries.map((entry) => entry.itemId)).toContain(DIARY_A.itemId);

    // ── THE RELOAD: a fresh process's runtime (the stored truth survives) ──
    simulateFreshProcess();
    const hostB = await bootHost();
    // The fresh load enters through the runtime's own browse (the card
    // link's id is the fresh registry's id).
    const DIARY_B = await fixtureItem(hostB, DIARY_FIELDS);

    // (1) THE B2 DEFECT ITSELF: on main the item hub's read folded only
    // the per-instance runtime state — EMPTY on the fresh process — so
    // the pill answered "Save to Watchlist" (saved=false) after a
    // successful save + reload. R35: the stored library read, joined by
    // the item's SOURCE identity, wins when it answers.
    const detailB = await loadDetailView(hostB, detailInput(DIARY_B));
    expect(detailB).not.toBeNull();
    expect(detailB!.watchlistSaved).toBe(true); // ← FAILS ON MAIN
    expect(detailB!.title).toBe(DIARY_FIELDS.title);

    // (2) THE LIBRARY AGREES on the fresh instance too (the read path
    // that always worked — now both pages agree, one stored truth).
    const libraryB = await loadLibraryView(hostB);
    expect(libraryB.watchlist.entries.map((entry) => entry.itemId)).toContain(DIARY_B.itemId);

    // (3) THE HONEST NEGATIVE: an item with NO stored truth stays
    // unsaved on the fresh load (the stored-truth join never fabricates).
    const BLOOM_B = await fixtureItem(hostB, BLOOM_FIELDS);
    const bloomDetail = await loadDetailView(hostB, detailInput(BLOOM_B));
    expect(bloomDetail).not.toBeNull();
    expect(bloomDetail!.watchlistSaved).toBe(false);

    // (4) THE FRESH-INSTANCE REMOVE WORKS (the R30 law's shared seam):
    // the remove finds the stored row (never "not in the local watchlist").
    const removed = await post(postLibrary, {
      op: "remove",
      itemId: DIARY_B.itemId,
      title: DIARY_B.title,
      connectorId: DIARY_B.connectorId,
      externalRef: DIARY_B.externalRef,
    });
    const removedBody = (await removed.json()) as { ok: boolean };
    expect(removedBody.ok).toBe(true);

    // The store left clean (the sweep's cleanup law).
    simulateFreshProcess();
    const hostC = await bootHost();
    const DIARY_C = await fixtureItem(hostC, DIARY_FIELDS);
    const detailC = await loadDetailView(hostC, detailInput(DIARY_C));
    expect(detailC).not.toBeNull();
    expect(detailC!.watchlistSaved).toBe(false); // the remove is durable too
  });

  it("the same-instance round trip keeps working (save → saved → remove → unsaved, ONE view)", async () => {
    const host = await bootHost();
    const DIARY = await fixtureItem(host, DIARY_FIELDS);

    const before = await loadDetailView(host, detailInput(DIARY));
    expect(before!.watchlistSaved).toBe(false); // never a fabricated saved

    const saved = await post(postLibrary, {
      op: "save",
      itemId: DIARY.itemId,
      title: DIARY.title,
      connectorId: DIARY.connectorId,
      externalRef: DIARY.externalRef,
    });
    expect(((await saved.json()) as { ok: boolean }).ok).toBe(true);

    const afterSave = await loadDetailView(host, detailInput(DIARY));
    expect(afterSave!.watchlistSaved).toBe(true);

    const removed = await post(postLibrary, {
      op: "remove",
      itemId: DIARY.itemId,
      title: DIARY.title,
      connectorId: DIARY.connectorId,
      externalRef: DIARY.externalRef,
    });
    expect(((await removed.json()) as { ok: boolean }).ok).toBe(true);
    const afterRemove = await loadDetailView(host, detailInput(DIARY));
    expect(afterRemove!.watchlistSaved).toBe(false);
  });
});
