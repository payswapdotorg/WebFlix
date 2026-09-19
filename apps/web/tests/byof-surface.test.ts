/**
 * R20-D — the BYOF web surface tests (bun:test).
 *
 * Proves the Bring Your Own Feed UI truth laws end-to-end through the REAL
 * shared composition — the REAL `FeedImportService` (@wfx/persistence,
 * R20-C) over PGlite with the REAL YouTube connector (@wfx/connectors,
 * R20-B) over its recorded fixtures — exactly the seams the fixtures-mode
 * dev boot wires (host/byof/byof-fixtures.ts). No re-implementation, no
 * fixture-only shortcut: the laws below hold against the same code the
 * running product serves.
 *
 * LAWS PINNED HERE (the R20 dispatch's truth laws, verbatim):
 *
 * - MODE VISIBILITY: source-native feed order is NEVER labeled as
 *   WebFlix-ranked content — the order sentence renders on every feed
 *   surface, and the WebFlix-mode separation is stated; `readFeed` in
 *   `webflix` mode is EMPTY (the shared mode-truth law, asserted through
 *   the real service).
 * - FRESHNESS SURFACE: the staged preview renders SNAPSHOT truth (never
 *   live); the confirmed continuous route lands Live with its synced
 *   sentence; a failed re-authorization renders its own named state with
 *   the recovery path — records retained, never deleted.
 * - UNDO/DISCONNECT SEMANTICS: disconnecting an import RETAINS every
 *   record (provenance survives — the feed region keeps rendering them);
 *   the WebFlix-local watchlist/history are untouched; deletion is a
 *   SEPARATE explicit action that ends the import's feed rendering.
 * - AUTHORIZATION FAILURES: an import attempt without the grant answers
 *   the TYPED unauthorized failure and lands its honest attempt trail —
 *   never a silent empty state; the recovery path is named.
 * - THE J33 FLOW: preview → confirm → feed appears; re-import is
 *   idempotent (no duplicate records — the import-key law); sync
 *   reconciles the changed source with the engine's honest counts.
 *
 * Determinism: PGlite + the fixtures' FixedClock/SequentialIdGen seams (the
 * byof-fixtures module's own law); the runtime is booted once per file and
 * `dev-reset` restores pristine rows before every test.
 */

import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getByofFixturesRuntime } from "../src/host/byof/byof-fixtures";
import type { ByofFixturesRuntime } from "../src/host/byof/byof-fixtures";
import {
  BYOF_DISCONNECTED_MARKER,
  byofSyncTruth,
  isByofUserDisconnect,
} from "../src/host/byof/byof-view";
import { loadByofPanelView, loadByofFeedView } from "../src/host/byof/byof-host";
import { ByofPanel } from "../src/components/byof/ByofPanel";
import { ByofFeedRegion } from "../src/components/byof/ByofFeedRegion";
import { LibrarySurface } from "../src/components/library/LibrarySurface";
import { GET as getByof, POST as postByof } from "../src/app/api/byof/route";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import { loadLibraryView } from "../src/host/view-models";
import { withEnv } from "./fake-web";

/** The ONE fixtures runtime this test file boots (pristine via dev-reset). */
let runtime: ByofFixturesRuntime;

beforeAll(async () => {
  runtime = await getByofFixturesRuntime();
});

beforeEach(async () => {
  // Pristine BYOF state per test: rows wiped, source back to its initial
  // phase, grant absent (the journey's own determinism drive).
  await runtime.drive("dev-reset");
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Connect the scripted source + stage + confirm one import (the J33 spine). */
async function importFeed(): Promise<string> {
  await runtime.drive("connect");
  const preview = await runtime.startPreview({ connectorId: "youtube" });
  if (!preview.ok) throw new Error(`preview failed: ${preview.failure.detail}`);
  const confirmed = await runtime.confirm(preview.value.importId);
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.failure.detail}`);
  return confirmed.value.importId;
}

/** Render the settings panel (the tree the settings route serves). */
async function renderPanel(): Promise<string> {
  const view = await loadByofPanelView("fixtures");
  return renderToStaticMarkup(createElement(ByofPanel, { view, mode: "fixtures" }));
}

/** Render the Library feed region (the tree the library route serves). */
async function renderFeed(): Promise<string> {
  const view = await loadByofFeedView("fixtures");
  return renderToStaticMarkup(createElement(ByofFeedRegion, { view }));
}

// ---------------------------------------------------------------------------
// The authorization-failure law (clear + actionable, never silent)
// ---------------------------------------------------------------------------

describe("R20-D BYOF — authorization failures are clear and actionable", () => {
  it("an import attempt without the grant answers the TYPED unauthorized failure", async () => {
    const attempt = await runtime.startPreview({ connectorId: "youtube" });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) throw new Error("unreachable");
    expect(attempt.failure.kind).toBe("unauthorized");
    expect(attempt.failure.detail).toContain("no valid credentials");
    expect(attempt.failure.syncState).toBe("reauthorization-required");
  });

  it("the failed attempt lands its honest audit trail — never a silent empty state", async () => {
    await runtime.startPreview({ connectorId: "youtube" });
    const view = await loadByofPanelView("fixtures");
    const attemptRow = view.imports.find(
      (entry) => entry.status === "reauthorization-required" && entry.itemCount === 0,
    );
    expect(attemptRow).toBeDefined();
    if (attemptRow === undefined) throw new Error("unreachable");
    expect(attemptRow.disconnectedByUser).toBe(false);
    expect(attemptRow.errorDetail).toContain("no valid credentials");
    const truth = byofSyncTruth({
      syncState: attemptRow.syncState,
      disconnectedByUser: false,
      ...(attemptRow.errorDetail !== undefined ? { errorDetail: attemptRow.errorDetail } : {}),
    });
    expect(truth.label).toBe("Authorization needed");
    expect(truth.detail).toContain("nothing is deleted by a failing sync");
  });

  it("the panel renders the failure trail + the not-connected truth + the connect path", async () => {
    await runtime.startPreview({ connectorId: "youtube" });
    const markup = await renderPanel();
    expect(markup).toContain("Bring your feed");
    expect(markup).toContain("Not connected");
    expect(markup).toContain("Authorization needed");
    expect(markup).toContain("never captured");
    // The connect affordance is the named recovery path.
    expect(markup).toContain("Connect YouTube");
  });

  it("the route answers the typed failure with its HTTP truth (401) and body", async () => {
    let host: Awaited<ReturnType<typeof getWebRuntimeHost>> | undefined;
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      host = await getWebRuntimeHost();
    });
    if (host === undefined) throw new Error("the fixture host did not boot");
    const response = await postByof(
      new Request("http://localhost/api/byof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview", connectorId: "youtube" }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean; failure: { kind: string; detail: string } };
    expect(body.ok).toBe(false);
    expect(body.failure.kind).toBe("unauthorized");
  });
});

// ---------------------------------------------------------------------------
// The J33 flow: preview → confirm → feed appears
// ---------------------------------------------------------------------------

describe("R20-D BYOF — the import flow (preview → confirm → feed appears)", () => {
  it("the staged preview carries the capture truth: counts, sample, snapshot freshness", async () => {
    await runtime.drive("connect");
    const preview = await runtime.startPreview({ connectorId: "youtube" });
    if (!preview.ok) throw new Error(preview.failure.detail);
    const view = await loadByofPanelView("fixtures", preview.value.importId);
    expect(view.preview).not.toBeNull();
    if (view.preview === null) throw new Error("unreachable");
    expect(view.preview.itemCount).toBe(7);
    expect(view.preview.relationshipCounts).toEqual({
      follow: 2,
      like: 2,
      watchlist: 1,
      playlist: 2,
    });
    // A capture is a SNAPSHOT — never presented as live.
    expect(view.preview.freshness).toBe("snapshot");
    expect(view.preview.continuousSync).toBe(true);
    // The sample is the capture's own order (source-native), with titles.
    expect(view.preview.sample.length).toBe(7);
    expect(view.preview.sample[0]!.title).toBe("Storm Chasers Lab");
    expect(view.preview.sample[0]!.relationship).toBe("follow");
  });

  it("the preview panel renders the mode law + the snapshot law in plain language", async () => {
    await runtime.drive("connect");
    const preview = await runtime.startPreview({ connectorId: "youtube" });
    if (!preview.ok) throw new Error(preview.failure.detail);
    const markup = await renderPanel();
    expect(markup).toContain("Preview your import from");
    expect(markup).toContain("Ready to bring in 7 items");
    expect(markup).toContain("not a WebFlix ranking");
    expect(markup).toContain("In YouTube&#x27;s own order");
    expect(markup).toContain("This capture is a snapshot of your feed as it stood");
    // The confirm + the not-now secondary actions (one primary action).
    expect(markup).toContain("Confirm import");
    expect(markup).toContain("Not now");
  });

  it("confirm promotes the preview and the feed APPEARS (the Library region)", async () => {
    const importId = await importFeed();
    const view = await loadByofFeedView("fixtures");
    expect(view.imports.length).toBe(1);
    const entry = view.imports[0]!;
    expect(entry.import.importId).toBe(importId);
    expect(entry.import.itemCount).toBe(7);
    // The continuous route lands LIVE after confirm (the shared law).
    expect(entry.import.syncState).toBe("live");
    expect(entry.import.disconnectedByUser).toBe(false);
    // The follow/subscription summary (the "Following" subset).
    expect(view.followingCount).toBe(2);
    expect(view.relationshipCounts).toEqual({
      follow: 2,
      like: 2,
      watchlist: 1,
      playlist: 2,
    });
    // The source-native groups, in the store's read order.
    expect(entry.groups.map((group) => group.relationship)).toEqual([
      "follow",
      "like",
      "playlist",
      "watchlist",
    ]);
  });

  it("re-import is idempotent — no duplicate records (the import-key law)", async () => {
    await importFeed();
    const preview = await runtime.startPreview({ connectorId: "youtube" });
    if (!preview.ok) throw new Error(preview.failure.detail);
    const confirmed = await runtime.confirm(preview.value.importId);
    if (!confirmed.ok) throw new Error(confirmed.failure.detail);
    const view = await loadByofFeedView("fixtures");
    // Two confirmed imports, but the SAME seven relationships (the unique
    // import key upserts the records — the second import now owns them).
    const records = view.imports.flatMap((entry) => entry.groups.flatMap((group) => group.records));
    expect(records.length).toBe(7);
    const keys = new Set(
      records.map((record) => `${record.relationship}:${record.externalRef}:${record.sourceRef ?? ""}`),
    );
    expect(keys.size).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// The mode-visibility law (source-native ≠ WebFlix-ranked)
// ---------------------------------------------------------------------------

describe("R20-D BYOF — the mode-visibility law", () => {
  it("the feed region visibly labels the source-native order — never a WebFlix ranking", async () => {
    await importFeed();
    const markup = await renderFeed();
    expect(markup).toContain("Source-native order — as YouTube lists it (not a WebFlix ranking)");
    expect(markup).toContain("data-wfx-byof-order-semantics=\"source-native\"");
    expect(markup).toContain("data-wfx-byof-mode=\"byof\"");
  });

  it("the WebFlix-mode separation is stated: recommendations stay their own thing", async () => {
    await importFeed();
    const markup = await renderFeed();
    expect(markup).toContain("WebFlix recommendations stay separate");
    expect(markup).toContain("never silently replaced by this imported feed");
  });

  it("the shared mode-truth law: readFeed('webflix') is EMPTY — imported records are never re-labeled", async () => {
    await importFeed();
    // Through the REAL shared service (the fixtures runtime's own handle):
    // the WebFlix feed mode never serves the imported source-native records.
    const webflixMode = await runtime.feedRecords("webflix");
    expect(webflixMode.length).toBe(0);
    // ...while the BYOF mode serves exactly what was imported, and the
    // Following subset carries the follow graph alone.
    const byofMode = await runtime.feedRecords("byof");
    expect(byofMode.length).toBe(7);
    const followingMode = await runtime.feedRecords("following");
    expect(followingMode.length).toBe(2);
    expect(followingMode.every((record) => record.relationship === "follow")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The freshness-surface law (snapshot is never live; states are honest)
// ---------------------------------------------------------------------------

describe("R20-D BYOF — the freshness surface", () => {
  it("the preview renders SNAPSHOT truth and never labels itself live", async () => {
    await runtime.drive("connect");
    const preview = await runtime.startPreview({ connectorId: "youtube" });
    if (!preview.ok) throw new Error(preview.failure.detail);
    const markup = await renderPanel();
    expect(markup).toContain("data-wfx-byof-freshness=\"snapshot\"");
    expect(markup).not.toContain("Live — kept current");
  });

  it("the confirmed continuous route lands Live with its synced sentence", async () => {
    await importFeed();
    const markup = await renderFeed();
    expect(markup).toContain("Live — kept current");
    expect(markup).toContain("data-wfx-byof-sync-state=\"live\"");
    expect(markup).toContain("last synced");
  });

  it("a failed re-authorization renders its named state — records retained", async () => {
    const importId = await importFeed();
    await runtime.drive("expire-auth");
    const sync = await runtime.sync(importId);
    expect(sync.ok).toBe(false);
    if (sync.ok) throw new Error("unreachable");
    expect(sync.failure.kind).toBe("unauthorized");
    expect(sync.failure.syncState).toBe("reauthorization-required");
    const view = await loadByofFeedView("fixtures");
    // The records SURVIVE the failing sync (the retention law).
    expect(view.imports.length).toBe(1);
    expect(view.imports[0]!.import.itemCount).toBe(7);
    expect(view.imports[0]!.import.syncState).toBe("reauthorization-required");
    expect(view.imports[0]!.import.disconnectedByUser).toBe(false);
    const markup = await renderFeed();
    expect(markup).toContain("Authorization needed");
    expect(markup).toContain("nothing is deleted by a failing sync");
    // The recovery path stays available: the sync action is offered (after
    // the user reconnects the source, THIS sync recovers the import — the
    // journey-found deadlock law: a reauthorization gap never hides its
    // own recovery action; while the grant is missing the sync answers
    // the typed unauthorized failure honestly).
    expect(markup).toContain("data-wfx-byof-action=\"sync\"");
  });

  it("the honest sync report: the changed source reconciles with the engine's own counts", async () => {
    const importId = await importFeed();
    await runtime.drive("advance-source");
    const sync = await runtime.sync(importId);
    if (!sync.ok) throw new Error(sync.failure.detail);
    // One new follow added, two follows re-ordered (updated), one like
    // removed at the source, four unchanged — the engine's honest diff.
    expect(sync.value).toEqual({
      importId,
      added: 1,
      updated: 2,
      removed: 1,
      kept: 4,
      syncState: "live",
    });
    const view = await loadByofFeedView("fixtures");
    expect(view.imports[0]!.import.itemCount).toBe(7);
    const titles = view.imports[0]!.groups
      .flatMap((group) => group.records)
      .map((record) => record.title);
    expect(titles).toContain("Aurora Nights");
    expect(titles).not.toContain("Desert Rain in 45 Seconds");
    expect(view.followingCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The undo/disconnect law (non-destructive; deletion is separate + explicit)
// ---------------------------------------------------------------------------

describe("R20-D BYOF — undo/disconnect semantics", () => {
  it("disconnecting RETAINS every record — provenance survives (the feed keeps rendering)", async () => {
    const importId = await importFeed();
    const disconnect = await runtime.disconnect(importId);
    if (!disconnect.ok) throw new Error(disconnect.failure.detail);
    const view = await loadByofFeedView("fixtures");
    expect(view.imports.length).toBe(1);
    const entry = view.imports[0]!;
    // Every record still renders with its provenance.
    expect(entry.import.itemCount).toBe(7);
    expect(entry.groups.flatMap((group) => group.records).length).toBe(7);
    // The disconnect fold is the documented user-disconnect truth.
    expect(entry.import.disconnectedByUser).toBe(true);
    expect(entry.import.errorDetail?.startsWith(BYOF_DISCONNECTED_MARKER)).toBe(true);
    expect(isByofUserDisconnect(entry.import.errorDetail)).toBe(true);
    const markup = await renderFeed();
    expect(markup).toContain("Disconnected — records retained");
    expect(markup).toContain("data-wfx-byof-disconnected=\"true\"");
    expect(markup).toContain("Deleting the imported records is a separate, explicit action");
  });

  it("the user disconnect renders DISTINCTLY from a transport-induced authorization gap", async () => {
    const importId = await importFeed();
    await runtime.drive("expire-auth");
    await runtime.sync(importId);
    const gapView = await loadByofFeedView("fixtures");
    expect(gapView.imports[0]!.import.disconnectedByUser).toBe(false);
    await runtime.drive("connect");
    const disconnect = await runtime.disconnect(importId);
    if (!disconnect.ok) throw new Error(disconnect.failure.detail);
    const disconnectedView = await loadByofFeedView("fixtures");
    expect(disconnectedView.imports[0]!.import.disconnectedByUser).toBe(true);
    // The two truths render their own labels (never conflated).
    const gapTruth = byofSyncTruth({ syncState: "reauthorization-required", disconnectedByUser: false });
    const disconnectedTruth = byofSyncTruth({ syncState: "reauthorization-required", disconnectedByUser: true });
    expect(gapTruth.label).toBe("Authorization needed");
    expect(disconnectedTruth.label).toBe("Disconnected — records retained");
  });

  it("the WebFlix-local watchlist/history are untouched by import AND disconnect", async () => {
    const importId = await importFeed();
    await runtime.disconnect(importId);
    // The full Library surface through the REAL web host: the BYOF region
    // renders, and the watchlist/history sections stay empty — the import
    // never wrote into them (the separation law, adapter-visible).
    let library: Awaited<ReturnType<typeof loadLibraryView>> | undefined;
    let byof: Awaited<ReturnType<typeof loadByofFeedView>> | undefined;
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHost();
      library = await loadLibraryView(host);
      byof = await loadByofFeedView(host.mode);
    });
    if (library === undefined || byof === undefined) throw new Error("the fixture host did not boot");
    expect(library.watchlist.status.state).toBe("ready");
    expect(library.watchlist.entries.length).toBe(0);
    expect(library.history.entries.length).toBe(0);
    expect(byof.imports.length).toBe(1);
    const markup = renderToStaticMarkup(
      createElement(LibrarySurface, { view: library, byof }),
    );
    expect(markup).toContain("Disconnected — records retained");
    expect(markup).toContain("Nothing saved yet");
    expect(markup).toContain("No watch history yet");
  });

  it("deletion is the SEPARATE explicit action — it removes the records and ends the feed", async () => {
    const importId = await importFeed();
    const removed = await runtime.deleteRecords(importId);
    if (!removed.ok) throw new Error(removed.failure.detail);
    expect(removed.value.removed).toBe(7);
    const view = await loadByofFeedView("fixtures");
    // The ended import stops rendering (its rows remain as the store's
    // audit trail); the honest empty state takes over.
    expect(view.imports.length).toBe(0);
    const markup = await renderFeed();
    expect(markup).toContain("No imported feeds yet");
    expect(markup).toContain("Bring your feed");
  });

  it("the delete action answers the route's typed channel (never a silent no-op)", async () => {
    const importId = await importFeed();
    let host: Awaited<ReturnType<typeof getWebRuntimeHost>> | undefined;
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      host = await getWebRuntimeHost();
    });
    if (host === undefined) throw new Error("the fixture host did not boot");
    const response = await postByof(
      new Request("http://localhost/api/byof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete-records", importId }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; removed: number };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// The service-mode transport truth (typed unavailable — never a fake)
// ---------------------------------------------------------------------------

describe("R20-D BYOF — the service-mode transport truth", () => {
  it("the panel and feed views answer the typed unavailable state", async () => {
    const panel = await loadByofPanelView("service");
    expect(panel.state).toBe("unavailable");
    expect(panel.detail).toContain("feed-import routes");
    expect(panel.sources.length).toBe(0);
    const feed = await loadByofFeedView("service");
    expect(feed.state).toBe("unavailable");
    expect(feed.imports.length).toBe(0);
    // The honest state renders as the calm state block — never a fake
    // source list, never a fabricated import.
    const panelMarkup = renderToStaticMarkup(
      createElement(ByofPanel, { view: panel, mode: "service" }),
    );
    expect(panelMarkup).toContain("Bring Your Own Feed isn&#x27;t served by this boot");
  });

  it("the route serves reads with the typed truth and refuses writes (503)", async () => {
    let host: Awaited<ReturnType<typeof getWebRuntimeHost>> | undefined;
    await withEnv({ WFX_API_BASE: "https://service.example" }, async () => {
      host = await getWebRuntimeHost();
    });
    if (host === undefined) throw new Error("the service host did not boot");
    expect(host.mode).toBe("service");
    const read = await getByof();
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { mode: string; state: string; detail: string };
    expect(readBody.mode).toBe("service");
    expect(readBody.state).toBe("unavailable");
    expect(readBody.detail).toContain("feed-import routes");
    const write = await postByof(
      new Request("http://localhost/api/byof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview", connectorId: "youtube" }),
      }),
    );
    expect(write.status).toBe(503);
    const writeBody = (await write.json()) as { ok: boolean; failure: { kind: string } };
    expect(writeBody.ok).toBe(false);
    expect(writeBody.failure.kind).toBe("unavailable");
  });

  it("the route rejects malformed actions with the typed 400 channel", async () => {
    let host: Awaited<ReturnType<typeof getWebRuntimeHost>> | undefined;
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      host = await getWebRuntimeHost();
    });
    if (host === undefined) throw new Error("the fixture host did not boot");
    const response = await postByof(
      new Request("http://localhost/api/byof", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "not-an-action" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; failure: { kind: string } };
    expect(body.failure.kind).toBe("invalid-input");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
