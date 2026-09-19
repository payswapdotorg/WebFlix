/**
 * R20-D BYOF surface + API-route law tests (bun:test).
 *
 * Proves the Web lane's BYOF product surface keeps every UI law through
 * the REAL components + view pipelines + route handlers (booted through
 * the R07 composition root in fixtures mode — the same tree the routes
 * serve, deterministic, no network):
 *
 * - MODE VISIBILITY: the imports mode renders the records with the
 *   source-order label; the WEBFLIX mode renders NO imported record rows
 *   (the mode-truth law) — only WebFlix's own discovery composition, with
 *   the distinction stated in plain language; the hybrid mode labels both
 *   sections distinctly;
 * - FRESHNESS SURFACE: the live and snapshot chips render WITH their
 *   label text (state is never communicated by color alone); the snapshot
 *   import's preview states the never-live truth;
 * - THE PREVIEW: the relationship summary (the imported follow/
 *   subscription summary), the source-order sample, and the snapshot/live
 *   note render for what the user confirms;
 * - AUTHORIZATION FAILURES: the expired source's fold renders the named
 *   error state with its recovery path (the Settings reconnect link) —
 *   never a silent empty state; the records are retained;
 * - UNDO/DISCONNECT SEMANTICS: the disconnected import renders its own
 *   named state + the "records kept" copy, and the EXPLICIT destructive
 *   delete-records action is SEPARATE (its own action vocabulary);
 * - THE ENTRIES: the Library's imported-feeds section and the Settings
 *   sources entry render (the frozen IA law — no new navigation);
 * - THE API ROUTE: the GET mode reads (the webflix mode's empty records
 *   truth), the POST action vocabulary, the typed failures with their
 *   status mapping, and the service-mode honest 503 (never a fake import).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadByofFeedView } from "../src/host/byof/view-models";
import { ByofFeedService } from "../src/host/byof/service";
import { driveReviseFixtureSource } from "../src/host/byof/fixture-state";
import { driveSourceAuthFixture, resetSourceAuthFixturesForTests } from "../src/host/source-auth-fixtures";
import { BringYourFeedSurface } from "../src/components/byof/BringYourFeedSurface";
import { ByofLibrarySection } from "../src/components/byof/ByofLibrarySection";
import { SettingsSurface } from "../src/components/settings/SettingsSurface";
import { GET as getFeed, POST as postFeed } from "../src/app/api/feed/route";
import { withEnv } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
  resetSourceAuthFixturesForTests();
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

/** Render the BYOF surface for one mode (the real view + component). */
async function renderByof(host: WebRuntimeHost, mode?: string): Promise<string> {
  const view = await loadByofFeedView(host, mode);
  return renderToStaticMarkup(createElement(BringYourFeedSurface, { view }));
}

/** Import a feed through the real service (the test's setup path). */
async function importFeed(
  host: WebRuntimeHost,
  method: "api" | "official-export" = "api",
): Promise<string> {
  const svc = new ByofFeedService(host.mode);
  const preview = await svc.previewFeedImport({ connectorId: "fake-source", method });
  if (!preview.ok) throw new Error(`preview failed: ${preview.error.detail}`);
  const confirmed = await svc.confirmFeedImport(preview.value.importId);
  if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.error.detail}`);
  return preview.value.importId;
}

/** POST one JSON body to the feed route (the real handler, no network). */
async function postFeedRoute(body: unknown): Promise<Response> {
  return postFeed(
    new Request("http://localhost/api/feed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("R20-D the wizard surface (choose → preview → confirm)", () => {
  it("the chooser renders the wired source + its method truth + the mode tabs", async () => {
    const host = await bootHost();
    const html = await renderByof(host);
    expect(html).toContain("data-wfx-byof-chooser");
    expect(html).toContain("data-wfx-byof-source=\"fake-source\"");
    expect(html).toContain("data-wfx-byof-method=\"api\"");
    expect(html).toContain("data-wfx-byof-method=\"official-export\"");
    expect(html).toContain("Authorized connection");
    expect(html).toContain("Official export file");
    // The mode selector (the frozen product-mode vocabulary).
    for (const tab of ["byof", "following", "webflix", "hybrid"]) {
      expect(html).toContain(`data-wfx-byof-mode-tab="${tab}"`);
    }
    // No stale "arrives later" copy: the surface describes what it does.
    expect(html).not.toContain("arrives with");
    expect(html).not.toContain("coming soon");
  });

  it("the staged preview renders the relationship summary, the source-order sample, and the freshness truth", async () => {
    const host = await bootHost();
    const svc = new ByofFeedService(host.mode);
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(preview.ok).toBe(true);
    const html = await renderByof(host);
    expect(html).toContain("data-wfx-byof-preview");
    expect(html).toContain("Ready to import");
    // The imported follow/subscription summary (the counts).
    expect(html).toContain("Channels followed:");
    expect(html).toContain("Subscriptions:");
    expect(html).toContain("Playlist items:");
    expect(html).toContain("Liked items:");
    // The sample rows render the captured titles in source order.
    expect(html).toContain("Astro Field Notes");
    expect(html).toContain("Deep Field Diary");
    // THE ORDER TRUTH (the first UI law).
    expect(html).toContain("WebFlix does not rank this list");
    // The freshness truth of the continuous route.
    expect(html).toContain("keep this feed current");
  });

  it("the export preview states the one-time snapshot truth (never presented as live)", async () => {
    const host = await bootHost();
    const svc = new ByofFeedService(host.mode);
    const preview = await svc.previewFeedImport({ connectorId: "fake-source", method: "official-export" });
    expect(preview.ok).toBe(true);
    const html = await renderByof(host);
    expect(html).toContain("one-time snapshot");
    expect(html).toContain("never be shown as live");
  });
});

describe("R20-D mode visibility (the J33 law: source-native vs WebFlix)", () => {
  it("the imports mode renders the records in source-native order with the order-truth label", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "byof");
    expect(html).toContain('data-wfx-byof-mode="byof"');
    expect(html).toContain('data-wfx-byof-order-truth');
    expect(html).toContain("exactly as your source lists it");
    // The records render with their provenance (captured stamps).
    expect((html.match(/data-wfx-byof-record=/g) ?? []).length).toBe(12);
    expect(html).toContain("Astro Field Notes");
    expect(html).toContain("Neon Rain");
  });

  it("the WEBFLIX mode renders NO imported records — only WebFlix's own discovery, with the distinction stated", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "webflix");
    expect(html).toContain('data-wfx-byof-mode="webflix"');
    // THE MODE-TRUTH LAW: no imported record row renders under the WebFlix label.
    expect(html).not.toContain("data-wfx-byof-record=");
    // None of the imported titles render in the WebFlix mode's records
    // (the discovery cards are WebFlix's own composition).
    expect(html).not.toContain("Astro Field Notes");
    expect(html).not.toContain("Harbor Studies");
    // The explicit distinction copy (visible, not just state).
    expect(html).toContain("WebFlix never re-ranks your imported feed");
    expect(html).toContain("keep their source order");
    // WebFlix's own discovery composition renders (the honest seeded rows).
    expect(html).toContain("data-wfx-byof-discovery");
    expect(html).toContain("data-wfx-card=");
  });

  it("the following mode renders the follow-graph subset in source order", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "following");
    expect(html).toContain('data-wfx-byof-mode="following"');
    expect((html.match(/data-wfx-byof-record=/g) ?? []).length).toBe(4);
    expect(html).toContain("Astro Field Notes");
    expect(html).toContain("Harbor Studies Premium");
    expect(html).not.toContain("Deep Field Diary"); // a playlist item — not the follow graph
  });

  it("the hybrid mode labels the source-native section and the WebFlix-ranked section distinctly", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "hybrid");
    expect(html).toContain('data-wfx-byof-mode="hybrid"');
    expect(html).toContain('data-wfx-byof-hybrid-source-heading');
    expect(html).toContain("From your source (source order)");
    expect(html).toContain('data-wfx-byof-hybrid-discovery-heading');
    expect(html).toContain("WebFlix picks (WebFlix-ranked)");
    // Both sections carry content.
    expect(html).toContain("data-wfx-byof-record=");
    expect(html).toContain("data-wfx-byof-discovery");
  });

  it("the deferred follow targets render their not-an-item marker (the WFX-054 truth)", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "byof");
    expect(html).toContain("data-wfx-byof-record-deferred");
    expect(html).toContain("Channel — not a WebFlix item");
  });
});

describe("R20-D freshness surface (the live/snapshot truth — first-class UI)", () => {
  it("the continuous import renders its LIVE chip with the label text", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "byof");
    expect(html).toContain('data-wfx-byof-freshness="live"');
    expect(html).toContain("Live — kept current while connected");
  });

  it("the one-time export import renders its SNAPSHOT chip with the label text", async () => {
    const host = await bootHost();
    await importFeed(host, "official-export");
    const html = await renderByof(host, "byof");
    expect(html).toContain('data-wfx-byof-freshness="snapshot"');
    expect(html).toContain("Snapshot — imported as of a moment in time");
  });

  it("the needs-reconnect import renders its freshness truth with the recovery path", async () => {
    const host = await bootHost();
    await importFeed(host);
    driveSourceAuthFixture({ action: "expire" });
    const svc = new ByofFeedService(host.mode);
    const failed = await svc.syncFeedImport((await svc.listImports())[0]!.id);
    expect(failed.ok).toBe(false);
    const html = await renderByof(host, "byof");
    expect(html).toContain('data-wfx-byof-freshness="reauthorization-required"');
    // The label text (matched around the escaped apostrophe).
    expect(html).toContain("Needs reconnect — the source");
    expect(html).toContain("authorization expired");
    // The retry path: the needs-reconnect import still offers its sync
    // (the recovery retry after the source is reconnected).
    expect(html).toContain('data-wfx-byof-action="sync"');
  });
});

describe("R20-D authorization failures (clear, actionable — never a silent empty state)", () => {
  it("the expired source's capture failure renders the named error state with the Settings recovery link", async () => {
    const host = await bootHost();
    driveSourceAuthFixture({ action: "expire" });
    const svc = new ByofFeedService(host.mode);
    const failed = await svc.previewFeedImport({ connectorId: "fake-source", method: "api" });
    expect(failed.ok).toBe(false);
    const html = await renderByof(host);
    expect(html).toContain("data-wfx-byof-auth-failure");
    expect(html).toContain("Your feed import needs the source reconnected");
    expect(html).toContain("expired");
    // The actionable recovery path (the Settings sources reconnect flow).
    expect(html).toContain("data-wfx-byof-recovery-link");
    expect(html).toContain("Reconnect the source in Settings");
    // The retained-records promise is stated (the survival law).
    expect(html).toContain("Your imported items are kept");
  });

  it("an unauthorized sync's import row renders the honest error detail", async () => {
    const host = await bootHost();
    const importId = await importFeed(host);
    driveSourceAuthFixture({ action: "expire" });
    const svc = new ByofFeedService(host.mode);
    await svc.syncFeedImport(importId);
    const html = await renderByof(host, "byof");
    expect(html).toContain("data-wfx-byof-import-error");
    expect(html).toContain("expired");
    // THE SURVIVAL LAW: the records still render through the failure.
    expect((html.match(/data-wfx-byof-record=/g) ?? []).length).toBe(12);
  });
});

describe("R20-D undo/disconnect semantics (non-destructive; deletion separate)", () => {
  it("the disconnected import renders its named state + the records-kept copy", async () => {
    const host = await bootHost();
    const importId = await importFeed(host);
    const svc = new ByofFeedService(host.mode);
    const disconnected = await svc.disconnectImport(importId);
    expect(disconnected.ok).toBe(true);
    const html = await renderByof(host, "byof");
    expect(html).toContain('data-wfx-byof-import-status="disconnected"');
    expect(html).toContain("Import disconnected — records kept");
    // THE SURVIVAL LAW: the records render after the disconnect.
    expect((html.match(/data-wfx-byof-record=/g) ?? []).length).toBe(12);
  });

  it("the EXPLICIT destructive delete-records action is SEPARATE from disconnect (its own vocabulary + confirm)", async () => {
    const host = await bootHost();
    await importFeed(host);
    const html = await renderByof(host, "byof");
    // Both actions render — separately labeled.
    expect(html).toContain('data-wfx-byof-action="disconnect"');
    expect(html).toContain('data-wfx-byof-action="delete-records"');
    // The disconnect's copy states the non-destructive truth.
    expect(html).toContain("Disconnect import (keeps your items)");
    expect(html).toContain("Delete imported records");
  });

  it("the sync report renders the honest reconciliation counts after a source change", async () => {
    const host = await bootHost();
    const importId = await importFeed(host);
    driveReviseFixtureSource();
    const svc = new ByofFeedService(host.mode);
    const sync = await svc.syncFeedImport(importId);
    expect(sync.ok).toBe(true);
    const html = await renderByof(host, "byof");
    expect(html).toContain("data-wfx-byof-sync-report");
    expect(html).toContain("Last sync: 2 added");
    expect(html).toContain("removed");
  });
});

describe("R20-D the entries (the frozen IA law: Library/Settings context)", () => {
  it("the Library renders its imported-feeds section + the entry link", async () => {
    const host = await bootHost();
    const svc = new ByofFeedService(host.mode);
    const imports = await svc.listImports();
    const html = renderToStaticMarkup(createElement(ByofLibrarySection, { imports }));
    expect(html).toContain("data-wfx-library-byof");
    expect(html).toContain("data-wfx-byof-entry-link");
    expect(html).toContain("Bring your feed");
    expect(html).toContain("own order");
  });

  it("the Library section renders the import summaries with freshness when feeds exist", async () => {
    const host = await bootHost();
    await importFeed(host);
    const svc = new ByofFeedService(host.mode);
    const imports = await svc.listImports();
    const html = renderToStaticMarkup(createElement(ByofLibrarySection, { imports }));
    expect(html).toContain("data-wfx-library-byof-imports");
    expect(html).toContain('data-wfx-byof-freshness="live"');
    expect(html).toContain("12 imported items");
  });

  it("the Settings sources section renders the BYOF entry", async () => {
    const host = await bootHost();
    const sources = await host.runtime.sources.refresh();
    const html = renderToStaticMarkup(
      createElement(SettingsSurface, {
        capabilities: host.capabilities,
        session: host.session.state,
        mode: host.mode,
        section: "sources",
        sources,
      }),
    );
    expect(html).toContain("data-wfx-settings-byof-entry");
    expect(html).toContain("data-wfx-byof-entry-link");
    expect(html).toContain("Bring your feed");
  });
});

describe("R20-D the feed API route (the typed transport surface)", () => {
  it("GET serves the mode's records (the webflix mode answers the EMPTY records truth)", async () => {
    const host = await bootHost();
    await importFeed(host);
    const byof = await getFeed(new Request("http://localhost/api/feed?mode=byof"));
    expect(byof.status).toBe(200);
    const byofBody = (await byof.json()) as { records: unknown[]; imports: unknown[] };
    expect(byofBody.records.length).toBe(12);
    expect(byofBody.imports.length).toBe(1);

    const webflix = await getFeed(new Request("http://localhost/api/feed?mode=webflix"));
    const webflixBody = (await webflix.json()) as { records: unknown[] };
    expect(webflixBody.records.length).toBe(0); // THE MODE-TRUTH LAW
  });

  it("GET refuses an unknown mode with 400", async () => {
    await bootHost();
    const response = await getFeed(new Request("http://localhost/api/feed?mode=ranked"));
    expect(response.status).toBe(400);
  });

  it("POST drives the wizard: preview → confirm → the feed records", async () => {
    await bootHost();
    const preview = await postFeedRoute({ action: "preview", connectorId: "fake-source", method: "api" });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      preview: { importId: string; itemCount: number; relationshipCounts: Record<string, number> };
    };
    expect(previewBody.preview.itemCount).toBe(12);
    expect(previewBody.preview.relationshipCounts.follow).toBe(3);

    const confirm = await postFeedRoute({ action: "confirm", importId: previewBody.preview.importId });
    expect(confirm.status).toBe(200);

    const feed = await getFeed(new Request("http://localhost/api/feed?mode=byof"));
    const feedBody = (await feed.json()) as { records: unknown[] };
    expect(feedBody.records.length).toBe(12);
  });

  it("POST refuses malformed bodies and unknown actions with 400", async () => {
    await bootHost();
    const noAction = await postFeedRoute({ connectorId: "fake-source" });
    expect(noAction.status).toBe(400);
    const unknown = await postFeedRoute({ action: "explode" });
    expect(unknown.status).toBe(400);
    const noImport = await postFeedRoute({ action: "confirm" });
    expect(noImport.status).toBe(400);
  });

  it("POST answers the typed failures with their status mapping (not-found 404, unsupported 409)", async () => {
    await bootHost();
    const missing = await postFeedRoute({ action: "confirm", importId: "wfxfeedimp_999999999999" });
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as { kind: string; detail: string };
    expect(body.kind).toBe("not-found");

    // A one-time artifact's sync: the typed unsupported verdict (409).
    const preview = await postFeedRoute({ action: "preview", connectorId: "fake-source", method: "official-export" });
    const { preview: staged } = (await preview.json()) as { preview: { importId: string } };
    await postFeedRoute({ action: "confirm", importId: staged.importId });
    const sync = await postFeedRoute({ action: "sync", importId: staged.importId });
    expect(sync.status).toBe(409);
    const syncBody = (await sync.json()) as { kind: string; detail: string };
    expect(syncBody.kind).toBe("unsupported");
    expect(syncBody.detail).toContain("one-time");
  });

  it("the expired source's preview answers the typed unauthorized failure (409) with the recovery detail", async () => {
    await bootHost();
    driveSourceAuthFixture({ action: "expire" });
    const failed = await postFeedRoute({ action: "preview", connectorId: "fake-source", method: "api" });
    expect(failed.status).toBe(409);
    const body = (await failed.json()) as { kind: string; detail: string; importId: string; syncState: string };
    expect(body.kind).toBe("unauthorized");
    expect(body.detail).toContain("expired");
    expect(body.detail).toContain("Settings");
    expect(body.syncState).toBe("reauthorization-required");
  });

  it("service mode answers the honest 503 for the action verbs (never a fake import)", async () => {
    let host: WebRuntimeHost | undefined;
    await withEnv({ WFX_API_BASE: "http://localhost:9/v1" }, async () => {
      host = await getWebRuntimeHost();
    });
    if (host === undefined) throw new Error("the service host did not boot");
    expect(host.mode).toBe("service");
    const preview = await postFeedRoute({ action: "preview", connectorId: "fake-source", method: "api" });
    expect(preview.status).toBe(503);
    const body = (await preview.json()) as { kind: string; detail: string };
    expect(body.kind).toBe("unavailable");
    expect(body.detail).toContain("not wired");
    // Reads stay honest.
    const feed = await getFeed(new Request("http://localhost/api/feed?mode=byof"));
    expect(feed.status).toBe(200);
    const feedBody = (await feed.json()) as { records: unknown[] };
    expect(feedBody.records.length).toBe(0);
  });

  it("the dev revise-source drive answers 503 in service mode (fixtures-only, the drive law)", async () => {
    let host: WebRuntimeHost | undefined;
    await withEnv({ WFX_API_BASE: "http://localhost:9/v1" }, async () => {
      host = await getWebRuntimeHost();
    });
    if (host === undefined) throw new Error("the service host did not boot");
    const revise = await postFeedRoute({ action: "revise-source" });
    expect(revise.status).toBe(503);
  });
});
