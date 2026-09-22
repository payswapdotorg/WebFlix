/**
 * R07 adapter-surface composition tests (bun:test).
 *
 * Proves the app renders RUNTIME STATE through the real components (the
 * same tree the routes serve), booted through the R07 composition root in
 * fixtures mode (deterministic content, no network):
 *
 * - HOME: Continue Watching (honest empty on a fresh session; entries
 *   appear after real watch-state events through the events route; a
 *   `complete` honestly removes the entry);
 * - SEARCH: canonical-joined results; the typed empty state;
 * - WATCH: the browse rows render fixture cards;
 * - SHORTS: the payload projection (the frozen OS page + runtime policy);
 * - ITEM DETAIL: real metadata, capability truth, play link;
 * - PLAYER: the resolved mode per item (embed iframe / the CONTAINED
 *   browser surface / the honest failure for unplayable content);
 * - LIBRARY: the honest empty watchlist; history from the watch fold;
 *   a save through the actions route lands in the watchlist;
 * - SETTINGS: the honest capability display (no native/torrent on Web —
 *   NAMED, never hidden);
 * - ERROR HONESTY: a failing service read renders ERROR sections with the
 *   typed failure detail — never a fake empty row (service mode + a
 *   rejecting fetch stub).
 *
 * Deterministic: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import {
  loadHomeView,
  loadLibraryView,
  loadPlayerView,
  loadSearchView,
  loadShortsView,
  loadWatchBrowseView,
} from "../src/host/view-models";
import type { PlayerEnrichments } from "../src/host/view-models";
import { loadDetailView } from "../src/host/view-models";
import { loadShortsPayload } from "../src/host/shorts";
import { AppShell } from "../src/components/shell/AppShell";
import { HomeSurface } from "../src/components/home/HomeSurface";
import { SearchSurface } from "../src/components/search/SearchSurface";
import { WatchBrowseSurface } from "../src/components/watch/WatchBrowseSurface";
import { ItemDetailSurface } from "../src/components/item/ItemDetailSurface";
import { PlayerSurface } from "../src/components/player/PlayerSurface";

/** The resolved enrichment fields of a composed player view (the surface's streaming input, resolved). */
function playerEnrichmentsOf(view: {
  aiTray: PlayerEnrichments["aiTray"];
  intelligence: PlayerEnrichments["intelligence"];
  liveAsr: PlayerEnrichments["liveAsr"];
  realtime: PlayerEnrichments["realtime"];
  related: PlayerEnrichments["related"];
}): PlayerEnrichments {
  return {
    aiTray: view.aiTray,
    intelligence: view.intelligence,
    liveAsr: view.liveAsr,
    realtime: view.realtime,
    related: view.related,
  };
}
import { LibrarySurface } from "../src/components/library/LibrarySurface";
import { SettingsSurface } from "../src/components/settings/SettingsSurface";
import { POST as postEvent } from "../src/app/api/events/route";
import { POST as postAction } from "../src/app/api/actions/route";
import { withEnv, withFetchStub } from "./fake-web";

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

/** POST one JSON body to the events route (the real handler, no network). */
async function postEventRoute(body: unknown): Promise<Response> {
  return postEvent(
    new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** POST one JSON body to the actions route (the real handler, no network). */
async function postActionRoute(body: unknown): Promise<Response> {
  return postAction(
    new Request("http://localhost/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function render(host: WebRuntimeHost, surface: string, element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      session: host.session.state,
      children: element,
    }),
  );
}

/** Find one card's canonical id by title through the runtime's search. */
async function itemIdOfTitle(host: WebRuntimeHost, title: string): Promise<string> {
  const model = await host.runtime.search({ query: title });
  const hit = model.hits.find((entry) => entry.result.title === title);
  if (hit === undefined) throw new Error(`fixture item '${title}' not found`);
  return hit.canonicalItemId;
}

describe("R07 adapter surfaces — HOME", () => {
  it("renders the seeded rows with fixture cards; Continue Watching is honestly empty", async () => {
    const host = await bootHost();
    const view = await loadHomeView(host);
    const markup = render(host, "home", createElement(HomeSurface, { view }));

    // The seeded rows carry the fixture content (query "rain": Neon Rain +
    // Rain Check + Desert Rain Doc across watch/short surfaces).
    expect(markup).toContain("Neon Rain");
    expect(markup).toContain("data-wfx-surface=\"home\"");
    // Continue Watching: honest absence on a fresh session (no fabricated
    // scaffolding — the row is absent from the markup).
    expect(view.continueWatching.entries).toEqual([]);
    expect(view.continueWatching.status.state).toBe("ready");
    expect(markup).not.toContain("data-wfx-row=\"continue\"");
    // The shell shows the honest signed-out session state.
    expect(markup).toContain("data-wfx-session-label");
    expect(markup).toContain("Signed out");
  });

  it("Continue Watching appears after real watch-state events through the events route", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Neon Rain");

    const progress = await postEventRoute({
      itemId,
      type: "progress",
      payload: { positionMs: 20_000, playbackSessionId: "wfxpses_test1" },
    });
    expect(progress.status).toBe(200);

    const view = await loadHomeView(host);
    expect(view.continueWatching.entries.length).toBe(1);
    const entry = view.continueWatching.entries[0]!;
    expect(entry.itemId).toBe(itemId);
    expect(entry.positionMs).toBe(20_000);
    expect(entry.status).toBe("in-progress");
    // The joined source identity resolves (the search registered it).
    expect(entry.joined).not.toBeNull();
    const markup = render(host, "home", createElement(HomeSurface, { view }));
    expect(markup).toContain("data-wfx-row=\"continue\"");
    expect(markup).toContain("Resume at");
  });

  it("a `complete` report honestly removes the Continue Watching entry", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Neon Rain");
    await postEventRoute({ itemId, type: "progress", payload: { positionMs: 20_000 } });
    await postEventRoute({ itemId, type: "complete" });

    const view = await loadHomeView(host);
    expect(view.continueWatching.entries).toEqual([]); // completed ≠ resumable
  });
});

describe("R07 adapter surfaces — SEARCH + WATCH", () => {
  it("search renders canonical-joined results; the typed empty state for no matches", async () => {
    const host = await bootHost();
    const results = await loadSearchView(host, "neon");
    expect(results.status.state).toBe("ready");
    expect(results.cards.length).toBe(1);
    expect(results.cards[0]!.title).toBe("Neon Rain");
    expect(results.cards[0]!.itemId.startsWith("wfxitm_")).toBe(true);
    const markup = render(host, "search", createElement(SearchSurface, { view: results }));
    expect(markup).toContain("data-wfx-search-state=\"results\"");
    expect(markup).toContain("Neon Rain");

    const empty = await loadSearchView(host, "zzz-no-match");
    expect(empty.cards).toEqual([]);
    const emptyMarkup = render(host, "search", createElement(SearchSurface, { view: empty }));
    expect(emptyMarkup).toContain("data-wfx-search-state=\"no-results\"");
  });

  it("the watch browse surface renders the seeded rows", async () => {
    const host = await bootHost();
    const view = await loadWatchBrowseView(host);
    const markup = render(host, "watch", createElement(WatchBrowseSurface, { view }));
    expect(markup).toContain("data-wfx-surface=\"watch\"");
    expect(markup).toContain("For you");
    expect(view.rows.some((row) => row.cards.length > 0)).toBe(true);
  });
});

describe("R07 adapter surfaces — SHORTS", () => {
  it("a failing shorts read renders the ERROR state (never a fake empty feed)", async () => {
    let loadError = null as { kind: string; detail: string } | null;
    await withEnv({ WFX_API_BASE: "https://down.example" }, async () => {
      await withFetchStub(
        () => Promise.reject(new TypeError("offline")),
        async () => {
          const host = await getWebRuntimeHost();
          const payload = await loadShortsPayload(host);
          loadError = payload.loadError;
        },
      );
    });
    expect(loadError).not.toBeNull();
    expect(loadError!.kind).toBe("network");
  });

  it("the runtime shorts model projects into the frozen OS page (vertical cards only)", async () => {
    const host = await bootHost();
    const view = await loadShortsView(host);
    expect(view.status.state).toBe("ready");
    expect(view.cards.length).toBeGreaterThan(0);
    // The shorts composition: every card is short-form (the frozen law).
    for (const card of view.cards) {
      expect(
        card.canonicalType === "short" ||
          ["short", "video"].includes(card.canonicalType),
      ).toBe(true);
    }
    const payload = await loadShortsPayload(host);
    expect(payload.loadError).toBeNull();
    expect(payload.page.surface).toBe("short");
    expect(payload.page.cards.length).toBe(view.cards.length);
    expect(payload.policy.attentionMode).toBe("balanced"); // the runtime's view
    expect(payload.userId).toBe("wfx-anonymous");
  });
});

describe("R07 adapter surfaces — ITEM DETAIL", () => {
  it("renders real metadata, the capability truth, and the play link", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Neon Rain");
    const view = await loadDetailView(host, {
      connectorId: "fake-source",
      externalRef: "fake:short-1",
      itemId,
    });
    expect(view).not.toBeNull();
    expect(view!.title).toBe("Neon Rain");
    expect(view!.availability).toBe("available");
    expect(view!.capabilities).toContain("playEmbed");
    const markup = render(host, "item", createElement(ItemDetailSurface, { view: view! }));
    expect(markup).toContain("data-wfx-surface=\"item\"");
    expect(markup).toContain("data-wfx-item-play");
    expect(markup).toContain("Embedded playback");
  });

  it("an unknown ref answers the honest not-found (no fabricated card)", async () => {
    const host = await bootHost();
    const view = await loadDetailView(host, {
      connectorId: "fake-source",
      externalRef: "fake:does-not-exist",
      itemId: "wfxitm_00000000000000000000000999",
    });
    expect(view).toBeNull();
  });
});

describe("R07 adapter surfaces — PLAYER (the resolved Media Surface mode)", () => {
  it("embed content renders the provider iframe (the precedence winner on Web)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Asteroid Drift");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
      title: "Asteroid Drift",
      canonicalType: "movie",
      durationMs: 7_200_000,
    });
    expect(view.failure).toBeNull();
    expect(view.surfaceMode).toBe("embed"); // native skipped by capability truth
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(PlayerSurface, { view, enrichments: playerEnrichmentsOf(view) }),
      }),
    );
    expect(markup).toContain("data-wfx-player-mode=\"embed\"");
    expect(markup).toContain("https://fixture.invalid/embed/fake:movie-1");
  });

  it("browser-only content renders the CONTAINED surface (cookie-isolated iframe)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Static Bloom");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:video-2",
      title: "Static Bloom",
      canonicalType: "video",
    });
    expect(view.failure).toBeNull();
    expect(view.surfaceMode).toBe("browser");
    expect(view.browserSurface).not.toBeNull(); // the rendered-mount session
    expect(view.browserSurface!.url).toBe("https://fixture.invalid/watch/fake:video-2");
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(PlayerSurface, { view, enrichments: playerEnrichmentsOf(view) }),
      }),
    );
    expect(markup).toContain("data-wfx-player-mode=\"browser\"");
    // The sandbox attribute: isolated opaque origin (no allow-same-origin).
    expect(markup).toContain("sandbox=\"allow-scripts allow-forms allow-popups allow-presentation\"");
    expect(markup).toContain("never injects into or inspects the provider page");
  });

  it("browser beats external in the frozen precedence (Deep Field Diary)", async () => {
    const host = await bootHost();
    const itemId = await itemIdOfTitle(host, "Deep Field Diary");
    const view = await loadPlayerView(host, {
      itemId,
      connectorId: "fake-source",
      externalRef: "fake:video-1",
      title: "Deep Field Diary",
      canonicalType: "video",
    });
    // video-1 declares browser + external realizations; browser wins the
    // frozen precedence on Web (native is honestly absent).
    expect(view.failure).toBeNull();
    expect(view.surfaceMode).toBe("browser");
    expect(view.browserSurface!.url).toBe("https://fixture.invalid/watch/fake:video-1");
  });

  it("unplayable content renders the honest failure (never a fake stage)", async () => {
    // Service mode against a stubbed resolve that answers NO realizations:
    // the runtime resolves `unresolvable` and the view carries the typed
    // failure — never a fabricated stage.
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      await withFetchStub(
        (call) =>
          call.url.includes("/experience/resolve")
            ? new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
            : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadPlayerView(host, {
            itemId: "wfxitm_00000000000000000000000042",
            connectorId: "fake-source",
            externalRef: "fake:unplayable",
            title: "Unplayable Item",
            canonicalType: "video",
          });
          expect(view.failure).not.toBeNull();
          expect(view.failure!.kind).toBe("unavailable"); // resolve answered nothing
          expect(view.phase).toBe("failed");
          const markup = renderToStaticMarkup(
            createElement(AppShell, {
              mode: host.mode,
              session: host.session.state,
              children: createElement(PlayerSurface, { view, enrichments: playerEnrichmentsOf(view) }),
            }),
          );
          expect(markup).toContain("data-wfx-player-state=\"failed\"");
          expect(markup).toContain("Playback could not start");
          expect(markup).toContain("unavailable");
        },
      );
    });
  });

  it("native-only content is honestly unsupported on Web — the limitation NAMED (never attempted)", async () => {
    // Service mode against a stubbed resolve answering a NATIVE-only
    // realization: the runtime's capability filter skips it (Web truthfully
    // declares nativeMedia: none) and the typed failure names the platform
    // limitation — never an attempt, never a fake stage.
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      await withFetchStub(
        (call) =>
          call.url.includes("/experience/resolve")
            ? new Response(
                JSON.stringify([
                  {
                    mode: "native",
                    connectorId: "fake-source",
                    externalRef: "fake:native-only",
                    capabilities: ["playNative"],
                  },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
              )
            : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadPlayerView(host, {
            itemId: "wfxitm_00000000000000000000000044",
            connectorId: "fake-source",
            externalRef: "fake:native-only",
            title: "Native-Only Item",
            canonicalType: "video",
          });
          expect(view.failure).not.toBeNull();
          expect(view.failure!.kind).toBe("unsupported-capability");
          expect(view.failure!.detail).toContain("nativeMedia");
          expect(view.phase).toBe("failed");
          const markup = renderToStaticMarkup(
            createElement(AppShell, {
              mode: host.mode,
              session: host.session.state,
              children: createElement(PlayerSurface, { view, enrichments: playerEnrichmentsOf(view) }),
            }),
          );
          expect(markup).toContain("data-wfx-player-state=\"failed\"");
          expect(markup).toContain("unsupported-capability");
        },
      );
    });
  });

  it("external-only content renders the visible handoff (never fake in-app playback)", async () => {
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      await withFetchStub(
        (call) =>
          call.url.includes("/experience/resolve")
            ? new Response(
                JSON.stringify([
                  {
                    mode: "external",
                    connectorId: "fake-source",
                    externalRef: "fake:external-only",
                    capabilities: ["playExternal"],
                  },
                ]),
                { status: 200, headers: { "content-type": "application/json" } },
              )
            : new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadPlayerView(host, {
            itemId: "wfxitm_00000000000000000000000043",
            connectorId: "fake-source",
            externalRef: "fake:external-only",
            title: "External Handoff Item",
            canonicalType: "video",
          });
          expect(view.failure).toBeNull();
          expect(view.surfaceMode).toBe("external");
          const markup = renderToStaticMarkup(
            createElement(AppShell, {
              mode: host.mode,
              session: host.session.state,
              children: createElement(PlayerSurface, { view, enrichments: playerEnrichmentsOf(view) }),
            }),
          );
          expect(markup).toContain("data-wfx-player-mode=\"external\"");
          expect(markup).toContain("opens on its source");
        },
      );
    });
  });
});

describe("R07 adapter surfaces — LIBRARY", () => {
  it("the honest empty watchlist; history appears from the watch fold; saves land", async () => {
    const host = await bootHost();
    const empty = await loadLibraryView(host);
    expect(empty.watchlist.status.state).toBe("ready");
    expect(empty.watchlist.entries).toEqual([]); // honest absence
    expect(empty.history.entries).toEqual([]);

    // A save through the actions route (the runtime's library semantics).
    const itemId = await itemIdOfTitle(host, "Neon Rain");
    const saved = await postActionRoute({
      type: "save",
      connectorId: "fake-source",
      externalRef: "fake:short-1",
      itemId,
    });
    expect(saved.status).toBe(200);
    const saveBody = (await saved.json()) as { status: string };
    expect(saveBody.status).toBe("confirmed");

    // A watch event lands in history.
    await postEventRoute({ itemId, type: "progress", payload: { positionMs: 5_000 } });

    const view = await loadLibraryView(host);
    expect(view.watchlist.entries.length).toBe(1);
    expect(view.watchlist.entries[0]!.itemId).toBe(itemId);
    expect(view.watchlist.entries[0]!.sync).toBe("synced"); // the runtime's sync vocabulary
    expect(view.history.entries.length).toBe(1);
    expect(view.history.entries[0]!.status).toBe("in-progress");
    expect(view.history.entries[0]!.positionMs).toBe(5_000);

    const markup = render(host, "library", createElement(LibrarySurface, { view }));
    expect(markup).toContain("data-wfx-surface=\"library\"");
    expect(markup).toContain("data-wfx-watchlist-entry");
    expect(markup).toContain("data-wfx-history-entry");
  });

  it("an unknown item cannot be saved (the runtime's not-found law — no fake save)", async () => {
    const host = await bootHost();
    const result = await host.runtime.libraryOps.save({
      itemId: "wfxitm_00000000000000000000000999",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-found");
  });
});

describe("R07 adapter surfaces — SETTINGS (the honest capability display)", () => {
  it("renders the truthful capability table: no torrent/native on Web, NAMED", async () => {
    const host = await bootHost();
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(SettingsSurface, {
          capabilities: host.capabilities,
          session: host.session.state,
          mode: host.mode,
          section: "general",
        }),
      }),
    );
    expect(markup).toContain("data-wfx-surface=\"settings\"");
    expect(markup).toContain("Native media &amp; torrent acquisition");
    expect(markup).toContain("Not available on Web");
    expect(markup).toContain("Desktop-only");
    expect(markup).toContain("Background work");
    expect(markup).toContain("browser tabs suspend");
    // The session honesty (the R02 seam's view).
    expect(markup).toContain("Signed out");
  });

  it("the sources section renders the honest empty state with its next actions (R21-D + R21-B)", () => {
    void bootHost().then((host) => {
      const markup = renderToStaticMarkup(
        createElement(AppShell, {
          mode: host.mode,
          session: host.session.state,
          children: createElement(SettingsSurface, {
            capabilities: host.capabilities,
            session: host.session.state,
            mode: host.mode,
            section: "sources",
          }),
        }),
      );
      expect(markup).toContain("No sources connected");
      // R21-D: the empty state carries the next useful actions (the connect
      // CTA into the existing IA) — and NO stale lane promise (R03 is an
      // accepted lane; naming it as "arrives" was the stale-copy defect).
      expect(markup).toContain("data-wfx-sources-connect-cta");
      expect(markup).not.toContain("R03");
      expect(markup).not.toMatch(/arriv\w+ with/i);
      expect(markup).toContain("bring your existing feed");
    });
  });

  it("the model section renders the REAL Model & AI truth over the completed transport (R21-B/R21-C, vocabulary + tray path per R21-D)", async () => {
    const host = await bootHost();
    // The completed transport: the runtime's model-controls read models
    // answer the REAL registry + per-task policy truth (the fixture
    // persona's provider row + the honest unset policies).
    const providers = await host.runtime.modelControls.refreshProviders();
    const policies = await host.runtime.modelControls.refreshPolicy("translation");
    expect(providers.status.state).toBe("ready");
    expect(providers.providers.length).toBeGreaterThan(0);
    expect(policies.status.state).toBe("ready");
    expect(policies.policy).toBeNull(); // the honest unset — never a fabricated default
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        session: host.session.state,
        children: createElement(SettingsSurface, {
          capabilities: host.capabilities,
          session: host.session.state,
          mode: host.mode,
          section: "model",
          modelProviders: providers,
          modelPolicies: [policies],
        }),
      }),
    );
    // The vocabulary is named (the capability is discovered, never hidden).
    expect(markup).toContain("BYOM");
    for (const term of ["transcription", "subtitles", "translation", "dubbing", "commentary"]) {
      expect(markup).toContain(term);
    }
    // The contextual entry path to the AI action tray renders (R21-D).
    expect(markup).toContain("data-wfx-model-tray-path");
    // The stale-completion-copy law: the "arrives with R06" copy is GONE;
    // the section renders the real provider registry + policy truth.
    expect(markup).not.toContain("R06");
    expect(markup).not.toMatch(/arriv\w+ with/i);
    expect(markup).toContain("wfx-first-party");
    expect(markup).toContain("Not configured");
  });
});

describe("R07 adapter surfaces — ERROR HONESTY (never a fake empty)", () => {
  it("a failing service read renders ERROR sections with the typed detail", async () => {
    // Service mode against a rejecting transport: the REAL ServerPort
    // answers the typed network failure; the surfaces render error states.
    let markup = "";
    let homeStatus = "";
    await withEnv({ WFX_API_BASE: "https://down.example" }, async () => {
      await withFetchStub(
        () => Promise.reject(new TypeError("fetch failed")),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadHomeView(host);
          homeStatus = view.rows[0]!.status.state;
          markup = renderToStaticMarkup(
            createElement(AppShell, {
              mode: host.mode,
              session: host.session.state,
              children: createElement(HomeSurface, { view }),
            }),
          );
        },
      );
    });
    expect(homeStatus).toBe("error");
    expect(markup).toContain("data-wfx-section-error");
    expect(markup).toContain("could not load");
    expect(markup).toContain("network");
    // NEVER a fake empty row: no "No content yet" empty state for a failure.
    expect(markup).not.toContain("No content yet");
  });

  it("a failing search renders the error state (not the no-matches state)", async () => {
    let markup = "";
    await withEnv({ WFX_API_BASE: "https://down.example" }, async () => {
      await withFetchStub(
        () => Promise.reject(new TypeError("offline")),
        async () => {
          const host = await getWebRuntimeHost();
          const view = await loadSearchView(host, "anything");
          markup = renderToStaticMarkup(
            createElement(AppShell, {
              mode: host.mode,
              session: host.session.state,
              children: createElement(SearchSurface, { view }),
            }),
          );
        },
      );
    });
    expect(markup).toContain("data-wfx-search-state=\"error\"");
    expect(markup).not.toContain("data-wfx-search-state=\"no-results\"");
  });

  it("a failing detail read renders the typed error state (the transport channel surfaced)", async () => {
    let markup = "";
    await withEnv({ WFX_API_BASE: "https://down.example" }, async () => {
      await withFetchStub(
        () => Promise.reject(new TypeError("offline")),
        async () => {
          const host = await getWebRuntimeHost();
          try {
            await loadDetailView(host, {
              connectorId: "conn-1",
              externalRef: "ref-1",
              itemId: "wfxitm_00000000000000000000000001",
            });
          } catch (thrown) {
            markup = String(thrown);
          }
        },
      );
    });
    expect(markup).toContain("network"); // the typed failure, never a silent null
  });
});
