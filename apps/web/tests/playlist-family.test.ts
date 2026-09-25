/**
 * R30-B — THE PLAYLIST FAMILY tests (bun:test).
 *
 * The corpus grammar for WebFlix's Library playlist sections
 * (docs/parity-lab/r30/lead-captures/CORPUS.md §6/§8/§9, every row
 * cited):
 *
 * - §6 THE RESUME-BAR GRAMMAR: the watched-progress red bar renders IN
 *   THE HISTORY ROW'S THUMB AREA (the N19[P] observed instance) from
 *   the stored watch truth — the same read the Library page performs.
 * - §8 THE PLAYLIST HEADER GRAMMAR: title · owner · "N videos" ·
 *   "Last updated on <date>" + the Play all + Shuffle pills (the real
 *   queue seam + the first entry's own player surface).
 * - §9 THE HONEST-UNAVAILABLE NOTICE: "N unavailable videos are
 *   hidden" — the entries whose source identity this process never
 *   joined hide behind the counted notice (the corpus's own pattern),
 *   never rendered as fabricated links.
 * - §9 THE SORT CHIPS: All · Videos · Shorts — the real types the
 *   list's entries carry (the ChipBar law: a chip never names a
 *   category the list cannot fill); the rows carry the type datum for
 *   the CSS filter seam.
 * - THE QUEUE SEAM: Play all's write path round-trips through the REAL
 *   queue route (POST /api/queue — the same typed store the player's
 *   up-next rail renders); Shuffle's order is a real shuffle of the
 *   exact same set.
 *
 * Determinism: fixture transport (the persona's library state starts
 * pristine), controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadLibraryView, loadSearchView } from "../src/host/view-models";
import { LibrarySurface } from "../src/components/library/LibrarySurface";
import { PlaylistControls, shuffled, type PlaylistTarget } from "../src/components/library/PlaylistControls";
import { POST as postLibrary } from "../src/app/api/library/route";
import { POST as postQueue, GET as getQueue } from "../src/app/api/queue/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers (the adapter-surfaces house style)
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

/** One fixture item's own fields (the shared shape). */
interface FixtureFields {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
}

/** Resolve one fixture item through the runtime's REAL search seam. */
async function fixtureItem(host: WebRuntimeHost, title: string): Promise<FixtureFields> {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`fixture item '${title}' not found`);
  return {
    itemId: hit.canonicalItemId,
    connectorId: hit.result.connectorId,
    externalRef: hit.result.externalRef,
    title: hit.result.title,
  };
}

/** Save one fixture item to a named playlist through the REAL write seam. */
async function saveToList(host: WebRuntimeHost, item: FixtureFields, listName: string): Promise<void> {
  const response = await post(postLibrary, {
    op: "save",
    itemId: item.itemId,
    title: item.title,
    connectorId: item.connectorId,
    externalRef: item.externalRef,
    listName,
  });
  const body = (await response.json()) as { ok?: boolean };
  if (body.ok !== true) throw new Error(`the playlist write failed: ${JSON.stringify(body)}`);
}

/** Render the library surface (the page's own composition). */
function renderLibrary(host: WebRuntimeHost, view: Awaited<ReturnType<typeof loadLibraryView>>): string {
  return renderToStaticMarkup(
    createElement(LibrarySurface, { view, session: host.session.state }),
  );
}

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// §6 — THE RESUME-BAR GRAMMAR (the history rows' red bar, the stored truth)
// ---------------------------------------------------------------------------

describe("R30-B — §6 the resume-bar grammar (the history row's thumb, from the stored truth)", () => {
  it("a history entry with a partial position renders the red progress bar IN the thumb area", async () => {
    const host = await bootHost();
    // The real page flow: the search view joins the item, then the watch
    // state folds a partial position through the events route's seam.
    await loadSearchView(host, "Neon Rain", {});
    const item = await fixtureItem(host, "Neon Rain");
    const progress = await post(
      await import("../src/app/api/events/route").then((module) => module.POST),
      { itemId: item.itemId, type: "progress", payload: { positionMs: 20_000 } },
    );
    expect(progress.status).toBe(200);
    const view = await loadLibraryView(host);
    const historyEntry = view.history.entries.find((entry) => entry.itemId === item.itemId);
    expect(historyEntry).toBeDefined();
    expect(historyEntry!.positionMs).toBe(20_000);
    expect(historyEntry!.completionRatio).not.toBeNull();
    const markup = renderLibrary(host, view);
    // §6: the row renders with the progress grammar INSIDE the thumb
    // (the N19[P] observed instance — the red bar in the thumb area).
    expect(markup).toContain(`data-wfx-history-entry="${item.itemId}"`);
    expect(markup).toContain("data-wfx-progress");
    expect(markup).toContain("wfx-progress__fill");
    // The resume position (the corpus row's meta truth).
    expect(markup).toContain("Resume at");
  });
});

// ---------------------------------------------------------------------------
// §8 — THE PLAYLIST HEADER GRAMMAR (title · owner · count · updated · pills)
// ---------------------------------------------------------------------------

describe("R30-B — §8 the playlist header grammar (the corpus header panel, honestly backed)", () => {
  it("the header renders the owner line, the video count, 'Last updated on <date>', and the Play all + Shuffle pills", async () => {
    const host = await bootHost();
    // The real flow: the search view joins the items, then the saves
    // land in a named list ("Watch later" — the corpus §8 list).
    await loadSearchView(host, "Deep Field Diary", {});
    const diary = await fixtureItem(host, "Deep Field Diary");
    await saveToList(host, diary, "Watch later");
    const view = await loadLibraryView(host);
    const list = view.playlists.lists.find((candidate) => candidate.name === "Watch later");
    expect(list).toBeDefined();
    expect(list!.entries.length).toBe(1);
    const markup = renderLibrary(host, view);
    // §8: the title (the section's own h3).
    expect(markup).toContain('data-wfx-playlist-head="Watch later"');
    expect(markup).toContain("Watch later");
    // The owner line (the session's own honest identity — the corpus
    // account-name slot; WebFlix's anonymous truth named for what it is).
    expect(markup).toContain("data-wfx-playlist-meta");
    expect(markup).toContain("an anonymous session · 1 video");
    // "Last updated on <date>" (the corpus format from the save's real
    // timestamp — MMM D, YYYY).
    expect(markup).toMatch(/Last updated on (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+, \d{4}/);
    // §8: the two pills (the real queue seam + the first entry's player).
    expect(markup).toContain('data-wfx-playlist-playall="Watch later"');
    expect(markup).toContain("Play all");
    expect(markup).toContain('data-wfx-playlist-shuffle="Watch later"');
    expect(markup).toContain("Shuffle");
    // The joined row renders (the join learned through the search view).
    expect(markup).toContain(`data-wfx-watchlist-entry="${diary.itemId}"`);
  });

  it("the count line handles the plural honestly (the corpus 'N videos' grammar)", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const diary = await fixtureItem(host, "Deep Field Diary");
    await saveToList(host, diary, "Watch later");
    // A second item in the same list — joined too (both count; the
    // plural form's honest datum is the joinable set).
    await loadSearchView(host, "Neon Rain", {});
    const second = await fixtureItem(host, "Neon Rain");
    await saveToList(host, second, "Watch later");
    const view = await loadLibraryView(host);
    const markup = renderLibrary(host, view);
    expect(markup).toContain("2 videos");
    expect(markup).not.toContain("2 videos videos");
    // Both rows render (both joined).
    expect(markup).toContain(`data-wfx-watchlist-entry="${diary.itemId}"`);
    expect(markup).toContain(`data-wfx-watchlist-entry="${second.itemId}"`);
    expect(markup).not.toContain("data-wfx-playlist-unavailable");
  });
});

// ---------------------------------------------------------------------------
// §9 — THE HONEST-UNAVAILABLE NOTICE + THE SORT CHIPS
// ---------------------------------------------------------------------------

describe("R30-B — §9 the honest-unavailable notice + the sort chips", () => {
  it("entries without a joined source identity hide behind the counted notice (never fabricated links)", async () => {
    const host = await bootHost();
    // The saves land WITHOUT any view loader running first — the join
    // map never learned these items (the honest per-process truth).
    const diary = await fixtureItem(host, "Deep Field Diary");
    const second = await fixtureItem(host, "Signal Fade");
    await saveToList(host, diary, "Watch later");
    await saveToList(host, second, "Watch later");
    const view = await loadLibraryView(host);
    // The view's own truth: the entries exist but carry no join.
    const list = view.playlists.lists.find((candidate) => candidate.name === "Watch later")!;
    expect(list.entries.length).toBe(2);
    expect(list.entries.every((entry) => entry.joined === null)).toBe(true);
    const markup = renderLibrary(host, view);
    // §9: the counted notice — the corpus's own pattern ("6 unavailable
    // videos are hidden" — the captured line's grammar, plural-honest).
    expect(markup).toContain('data-wfx-playlist-unavailable="2"');
    expect(markup).toContain("2 unavailable videos are hidden");
    // The PLAYLIST section's rows are HIDDEN (never rendered as
    // fabricated links). NOTE: the default Watchlist section keeps its
    // own honest rendering of every save (the R24-W2 law: one write
    // path, two honest sections — the seam law keeps it untouched);
    // the hiding is the PLAYLIST family's own corpus pattern.
    const playlistSection = markup.slice(
      markup.indexOf('data-wfx-playlist-head="Watch later"'),
      markup.indexOf('aria-label="History"'),
    );
    expect(playlistSection).not.toContain("data-wfx-watchlist-entry");
    // The header still names the count truthfully (0 playable — the
    // hidden ones are named by the notice, not the count line).
    expect(markup).toContain("0 videos");
    // The pills still render but honestly refuse on click (the island's
    // empty-set outcome — the markup proof is the pills' presence with
    // the real disabled grammar left to the click truth).
    expect(markup).toContain('data-wfx-playlist-playall="Watch later"');
  });

  it("the sort chips: All + the REAL types the list carries (Videos + Shorts when both exist)", async () => {
    const host = await bootHost();
    // A list carrying one VIDEO and one SHORT (the corpus chip row's
    // real backing: the entries' own canonical types).
    await loadSearchView(host, "Deep Field Diary", {});
    await loadSearchView(host, "Neon Rain", {});
    const diary = await fixtureItem(host, "Deep Field Diary");
    const rain = await fixtureItem(host, "Neon Rain");
    await saveToList(host, diary, "Mixed list");
    await saveToList(host, rain, "Mixed list");
    const view = await loadLibraryView(host);
    const markup = renderLibrary(host, view);
    // §9: the chip row — All (selected) + Videos + Shorts.
    expect(markup).toContain('data-wfx-playlist-chip="all"');
    expect(markup).toContain(">All<");
    expect(markup).toContain('data-wfx-playlist-chip="video"');
    expect(markup).toContain(">Videos<");
    expect(markup).toContain('data-wfx-playlist-chip="short"');
    expect(markup).toContain(">Shorts<");
    // The rows carry the type datum (the CSS filter seam's target).
    expect(markup).toContain(`data-wfx-playlist-type="video"`);
    expect(markup).toContain(`data-wfx-playlist-type="short"`);
    // The "All" chip starts selected (the corpus row's captured state).
    expect(markup).toContain('aria-selected="true"');
  });

  it("a chip never names a category the list cannot fill (the ChipBar law)", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    const diary = await fixtureItem(host, "Deep Field Diary");
    await saveToList(host, diary, "Videos only");
    const view = await loadLibraryView(host);
    const markup = renderLibrary(host, view);
    // Videos chip renders (the list carries a video); the Shorts chip
    // does NOT (no short in the list — never a decorative chip).
    expect(markup).toContain('data-wfx-playlist-chip="video"');
    expect(markup).not.toContain('data-wfx-playlist-chip="short"');
  });
});

// ---------------------------------------------------------------------------
// THE QUEUE SEAM (Play all / Shuffle — the real write path)
// ---------------------------------------------------------------------------

describe("R30-B — the Play all / Shuffle queue seam (the real typed store)", () => {
  /** The joinable targets of one saved list (the island's own input shape). */
  async function targetsOf(host: WebRuntimeHost, listName: string): Promise<PlaylistTarget[]> {
    const view = await loadLibraryView(host);
    const list = view.playlists.lists.find((candidate) => candidate.name === listName);
    if (list === undefined) throw new Error(`list '${listName}' not found`);
    return list.entries
      .filter((entry) => entry.joined !== null)
      .map((entry) => ({
        itemId: entry.itemId,
        connectorId: entry.joined!.connectorId,
        externalRef: entry.joined!.externalRef,
        title: entry.title,
        canonicalType: entry.joined!.canonicalType,
        ...(entry.joined!.durationMs !== undefined ? { durationMs: entry.joined!.durationMs } : {}),
      }));
  }

  it("Play all seeds the REAL queue with the joinable entries (the POST /api/queue round trip)", async () => {
    const host = await bootHost();
    await loadSearchView(host, "Deep Field Diary", {});
    await loadSearchView(host, "Neon Rain", {});
    const diary = await fixtureItem(host, "Deep Field Diary");
    const rain = await fixtureItem(host, "Neon Rain");
    await saveToList(host, diary, "Watch later");
    await saveToList(host, rain, "Watch later");
    const targets = await targetsOf(host, "Watch later");
    expect(targets.length).toBe(2);
    // The island's own write path: one typed POST per entry (the same
    // bodies the click handler posts).
    for (const target of targets) {
      const response = await post(postQueue, { action: "add", entry: target });
      expect(response.status).toBe(200);
    }
    // The queue's honest snapshot: the entries landed (the same store
    // the player's up-next rail renders).
    const snapshot = await (getQueue as () => Promise<Response>)();
    const body = (await snapshot.json()) as { entries?: { itemId: string }[] };
    expect(body.entries?.map((entry) => entry.itemId).sort()).toEqual(
      [diary.itemId, rain.itemId].sort(),
    );
  });

  it("Shuffle's order is a real shuffle of the EXACT same set", async () => {
    const targets: PlaylistTarget[] = [
      { itemId: "wfxitm_a", connectorId: "c", externalRef: "r1", title: "One", canonicalType: "video" },
      { itemId: "wfxitm_b", connectorId: "c", externalRef: "r2", title: "Two", canonicalType: "video" },
      { itemId: "wfxitm_c", connectorId: "c", externalRef: "r3", title: "Three", canonicalType: "short" },
      { itemId: "wfxitm_d", connectorId: "c", externalRef: "r4", title: "Four", canonicalType: "video" },
    ];
    const order = shuffled(targets);
    // The set is exact (no loss, no duplication, no fabrication).
    expect([...order].sort((a, b) => a.itemId.localeCompare(b.itemId))).toEqual(
      [...targets].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    );
    // The input is untouched (a copy — never an in-place mutation of the
    // playlist's own array).
    expect(targets.map((target) => target.itemId)).toEqual(["wfxitm_a", "wfxitm_b", "wfxitm_c", "wfxitm_d"]);
    // The controls' own markup: the pills render over the targets.
    const markup = renderToStaticMarkup(
      createElement(PlaylistControls, {
        listName: "Watch later",
        targets,
        chips: [
          { label: "Videos", value: "video" },
          { label: "Shorts", value: "short" },
        ],
      }),
    );
    expect(markup).toContain('data-wfx-playlist-playall="Watch later"');
    expect(markup).toContain('data-wfx-playlist-shuffle="Watch later"');
    expect(markup).toContain('data-wfx-playlist-chip="all"');
  });
});
