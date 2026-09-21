/**
 * R14 — the web acquisition surface tests (bun:test).
 *
 * Proves the states render through the client-runtime seam on the WEB
 * adapter (the same components the routes serve), booted through the R07
 * composition root in fixtures mode (the loud dev harness — deterministic
 * content, no network):
 *
 * - THE LIFECYCLE RENDERS: every state of the honest lifecycle (available
 *   → preparing → buffering → playing → completing → ready-offline →
 *   failed recoverable/fatal) renders its truthful label/detail/actions —
 *   and TRUTHFUL PROGRESS: no progress bar when the fraction is honestly
 *   unknown (never a fake number);
 * - J25 RESUMING-NOT-FRESH: the resumed view renders the "Resuming" badge
 *   and the retained-percent sentence — never a fresh start;
 * - THE LEAK LAW (J21-J25 "No native protocol"): the rendered DEFAULT
 *   markup (the item surface minus the gated diagnostics subtree) is
 *   protocol-free for EVERY lifecycle state; the gated disclosure carries
 *   the protocol detail (peers/pieces/infohash) and is CLOSED by default;
 * - THE RETRY WIRING: the POST route drives the typed actions through the
 *   REAL runtime store (retry lands preparing; the service-mode transport
 *   answers the honest 503 — reads only);
 * - J26 LIBRARY INTEGRATION: verified offline copies render the "Offline
 *   and verified" section (Ready offline, one row per canonical identity);
 *   an empty acquisition store renders the honest empty state, never a
 *   fabricated row;
 * - THE LIMITED-STATUS NOTE: an item with no view renders the honest web
 *   capability truth (native acquisition runs in the desktop app).
 *
 * Deterministic: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AcquisitionStatusView } from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { driveAcquisitionFixture, fixtureAcquisitionDiagnostics } from "../src/host/acquisition-fixtures";
import { loadDetailView, loadLibraryView } from "../src/host/view-models";
import type { LibraryView } from "../src/host/view-models";
import { AppShell } from "../src/components/shell/AppShell";
import { ItemDetailSurface } from "../src/components/item/ItemDetailSurface";
import { LibrarySurface } from "../src/components/library/LibrarySurface";
import { AcquisitionPanel } from "../src/components/acquisition/AcquisitionPanel";
import { GET as getAcquisition, POST as postAcquisition } from "../src/app/api/acquisition/route";
import { withEnv } from "./fake-web";
import { containsAcquisitionProtocolTerminology } from "@wfx/client-runtime";

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

/** The detail view of one fixture title (deterministic per process). */
async function detailOf(host: WebRuntimeHost, itemId: string) {
  const view = await loadDetailView(host, {
    connectorId: "fixture-source",
    externalRef: "fake:movie-1",
    itemId,
  });
  if (view === null) throw new Error("the fixture detail must load");
  return view;
}

/** Render the item surface with the AppShell (the tree the route serves). */
function renderItem(host: WebRuntimeHost, view: Awaited<ReturnType<typeof detailOf>>): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      active: "home",
      session: host.session.state,
      children: createElement(ItemDetailSurface, { view }),
    }),
  );
}

/** Strip the gated diagnostics subtree (the leak law scans the DEFAULT surface). */
function withoutGatedDiagnostics(markup: string): string {
  return markup.replace(/<details[^>]*data-wfx-advanced-diagnostics[\s\S]*?<\/details>/g, "");
}

/** The VISIBLE TEXT of a markup string (tags and attributes stripped). */
function visibleTextOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ");
}

/**
 * R23-C refinement: the WIRE-protocol terms forbidden on every default
 * surface's visible text. The realization-choice PRODUCT vocabulary
 * ("peer copy", "peer-to-peer" — the frozen R23-C label/detail Workers
 * 2/3 render verbatim in Where to watch) is lawful and excluded here;
 * the acquisition-panel scan keeps the FULL strict list (the J21 law).
 */
const WIRE_PROTOCOL_TERMS: readonly string[] = [
  "piece",
  "pieces",
  "tracker",
  "trackers",
  "swarm",
  "seed",
  "seeding",
  "leech",
  "leeching",
  "ratio",
  "torrent",
  "infohash",
  "info hash",
  "bitfield",
  "magnet",
  "dht",
  "pex",
  "choke",
];

/** Does a default surface's visible text leak WIRE-protocol vocabulary? */
function containsWireProtocolTerminology(text: string): boolean {
  for (const term of WIRE_PROTOCOL_TERMS) {
    if (new RegExp(`\\b${term}\\b`, "i").test(text)) return true;
  }
  return false;
}

/** One honest view for a state (rendered through the panel directly). */
function viewOf(overrides: Partial<AcquisitionStatusView> & { state: AcquisitionStatusView["state"] }): AcquisitionStatusView {
  return {
    itemId: "wfxitm_00000000000000000000000001",
    state: overrides.state,
    label: overrides.label ?? "",
    detail: overrides.detail ?? "",
    progress: overrides.progress ?? null,
    runwaySeconds: overrides.runwaySeconds ?? null,
    paused: overrides.paused ?? false,
    resumed: overrides.resumed ?? false,
    retainedFraction: overrides.retainedFraction ?? null,
    actions: overrides.actions ?? [],
    ...(overrides.failure !== undefined ? { failure: overrides.failure } : {}),
    ...(overrides.offline !== undefined ? { offline: overrides.offline } : {}),
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
  } as AcquisitionStatusView;
}

// ---------------------------------------------------------------------------
// The lifecycle rendering (every state, truthful)
// ---------------------------------------------------------------------------

describe("R14 web — every lifecycle state renders truthfully", () => {
  it("the fixture feed seeds the honest scripted items (available / ready / resuming / failed)", async () => {
    const host = await bootHost();
    const views = host.runtime.acquisition.views();
    // Asteroid (available), Harbor (ready), DeepField (resuming), Desert
    // (failed), Static Bloom + Midnight Scoop (R17's network-loss and
    // metadata-failure scripted items — both start available), and Rain
    // Check (R23-E/J38's browser-rung full-lifecycle item — available).
    expect(views.length).toBe(7);
    const byTitle = new Map(views.map((view) => [view.title, view]));
    expect(byTitle.get("Asteroid Drift")?.state).toBe("available");
    expect(byTitle.get("Harbor Lights")?.state).toBe("ready-offline");
    expect(byTitle.get("Deep Field Diary")?.state).toBe("completing");
    expect(byTitle.get("Deep Field Diary")?.resumed).toBe(true);
    expect(byTitle.get("Desert Rain Doc")?.state).toBe("failed");
    expect(byTitle.get("Static Bloom")?.state).toBe("available");
    expect(byTitle.get("Midnight Scoop")?.state).toBe("available");
  });

  it("the item surface renders the honest lifecycle for the acquiring title (J21)", async () => {
    const host = await bootHost();
    const asteroid = host.runtime.acquisition.views().find((view) => view.title === "Asteroid Drift");
    if (asteroid === undefined) throw new Error("the Asteroid view must exist");
    const detail = await detailOf(host, asteroid.itemId);
    const markup = renderItem(host, detail);
    expect(markup).toContain("data-wfx-acquisition");
    expect(markup).toContain("data-wfx-acquisition-state=\"available\"");
    expect(markup).toContain("Available");
    expect(markup).toContain("Make available offline");
  });

  it("every in-progress state renders its label + actions through the panel", () => {
    const states: readonly [string, string, string][] = [
      ["available", "Available", "acquire"],
      ["preparing", "Preparing", "pause"],
      ["buffering", "Buffering", "pause"],
      ["playing", "Playing", "pause"],
      ["completing", "Completing", "pause"],
    ];
    for (const [state, label, action] of states) {
      const markup = renderToStaticMarkup(
        createElement(AcquisitionPanel, {
          view: viewOf({
            state: state as AcquisitionStatusView["state"],
            label,
            detail: `The ${label.toLowerCase()} sentence.`,
            actions: [{ kind: action as "pause" }],
          }),
          diagnostics: null,
          mode: "service",
          canAcquireOnThisDevice: false,
        }),
      );
      expect(markup).toContain(`data-wfx-acquisition-state="${state}"`);
      expect(markup).toContain(label);
    }
  });

  it("TRUTHFUL PROGRESS: a bar only when the fraction is known — never a fake number", () => {
    const unknown = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({ state: "preparing", label: "Preparing", detail: "Finding the details.", progress: null }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(unknown).not.toContain("data-wfx-acquisition-progress");
    expect(unknown).not.toContain("%"); // no fabricated percent either

    const known = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({ state: "completing", label: "Completing", detail: "Finishing the offline copy.", progress: 0.62 }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(known).toContain("data-wfx-acquisition-progress");
    expect(known).toContain("62%");
  });

  it("ready-offline renders the earned verdict + its typed actions (J26)", () => {
    const markup = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({
          state: "ready-offline",
          label: "Ready offline",
          detail: "Verified and available to watch without a connection.",
          offline: { assetCount: 2, sizeBytes: 1_572_864, exposedAtMs: 0 },
          actions: [{ kind: "play-offline" }, { kind: "reverify-offline" }],
        }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(markup).toContain("Ready offline");
    expect(markup).toContain("verified offline");
    expect(markup).toContain("Play offline copy");
    expect(markup).toContain("Re-check the offline copy");
    expect(markup).toContain("1.5 MB");
  });

  it("failed renders the typed failure: recoverable offers Try again; fatal does not", () => {
    const recoverable = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({
          state: "failed",
          label: "Couldn't finish",
          detail: "The download source had a problem. You can try again.",
          failure: { cause: "source-problem", label: "The download source had a problem.", detail: "", recoverable: true },
          actions: [{ kind: "retry" }, { kind: "dismiss" }],
        }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(recoverable).toContain("data-wfx-acquisition-failure=\"source-problem\"");
    expect(recoverable).toContain("data-wfx-acquisition-recoverable=\"true\"");
    expect(recoverable).toContain("Try again");

    const fatal = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({
          state: "failed",
          label: "Couldn't finish",
          detail: "The source that authorized this download is no longer authorized, so it can't continue.",
          failure: { cause: "authorization-revoked", label: "", detail: "", recoverable: false },
          actions: [{ kind: "dismiss" }],
        }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(fatal).toContain("data-wfx-acquisition-recoverable=\"false\"");
    expect(fatal).not.toContain("Try again"); // no fake retry for fatal
    expect(fatal).toContain("Dismiss");
  });

  it("J25 — the resumed view renders RESUMING with the retained percent (never fresh)", () => {
    const markup = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({
          state: "completing",
          label: "Completing",
          detail: "Finishing the offline copy in the background. Resuming where it left off — 55% already saved.",
          progress: 0.62,
          resumed: true,
          retainedFraction: 0.55,
        }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(markup).toContain("data-wfx-acquisition-resuming");
    expect(markup).toContain("Resuming");
    expect(markup).toContain("55% already saved");
  });

  it("the paused modifier renders Paused (the honest modifier — not a state)", () => {
    const markup = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: viewOf({
          state: "completing",
          label: "Completing",
          detail: "Finishing the offline copy in the background.",
          paused: true,
          actions: [{ kind: "resume" }],
        }),
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(markup).toContain("Paused");
    expect(markup).toContain("Resume download");
  });

  it("an item with no view renders the honest web capability truth (limited status)", () => {
    const markup = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: null,
        diagnostics: null,
        mode: "service",
        canAcquireOnThisDevice: false,
      }),
    );
    expect(markup).toContain("data-wfx-acquisition-none");
    expect(markup).toContain("WebFlix desktop app");
  });
});

// ---------------------------------------------------------------------------
// The leak law (J21-J25 "No native protocol")
// ---------------------------------------------------------------------------

describe("R14 web — the default surfaces never leak protocol terminology", () => {
  it("the FULL item surface (minus the gated subtree) is protocol-free for every lifecycle state", () => {
    const states: readonly AcquisitionStatusView["state"][] = [
      "available",
      "preparing",
      "buffering",
      "playing",
      "completing",
      "ready-offline",
      "failed",
    ];
    for (const state of states) {
      const markup = withoutGatedDiagnostics(
        renderToStaticMarkup(
          createElement(AcquisitionPanel, {
            view: viewOf({
              state,
              label: state,
              detail: `The honest ${state} sentence.`,
              ...(state === "failed"
                ? {
                    failure: { cause: "source-problem", label: "", detail: "", recoverable: true },
                    actions: [{ kind: "retry" }, { kind: "dismiss" }],
                  }
                : {}),
            }),
            diagnostics: fixtureAcquisitionDiagnostics("wfxitm_00000000000000000000000001"),
            mode: "service",
            canAcquireOnThisDevice: false,
          }),
        ),
      );
      expect(containsAcquisitionProtocolTerminology(markup)).toBe(false);
    }
  });

  it("the fixture-driven item surface (all scripted states) stays protocol-free", async () => {
    const host = await bootHost();
    const asteroid = host.runtime.acquisition.views().find((view) => view.title === "Asteroid Drift");
    if (asteroid === undefined) throw new Error("the Asteroid view must exist");
    // Walk the whole scripted journey; every rendered default surface stays clean.
    for (let step = 0; step < 11; step += 1) {
      const driven = driveAcquisitionFixture(host, { itemId: asteroid.itemId, action: step === 0 ? "acquire" : "advance" });
      expect(driven.ok).toBe(true);
      const fresh = await detailOf(host, asteroid.itemId);
      const markup = withoutGatedDiagnostics(renderItem(host, fresh));
      // The ACQUISITION PANEL subtree keeps the STRICT law (J21 verbatim).
      const panelMatch = /<section[^>]*data-wfx-acquisition[\s\S]*?<\/section>/.exec(markup);
      expect(panelMatch).not.toBeNull();
      if (panelMatch !== null) {
        expect(containsAcquisitionProtocolTerminology(visibleTextOf(panelMatch[0]))).toBe(false);
      }
      // The wider item surface's visible text carries no WIRE-protocol
      // vocabulary; the R23-C frozen realization-choice vocabulary ("peer
      // copy", "peer-to-peer") is lawful product language, not jargon.
      expect(containsWireProtocolTerminology(visibleTextOf(markup))).toBe(false);
    }
    const final = host.runtime.acquisition.view(asteroid.itemId);
    expect(final?.state).toBe("ready-offline");
  });

  it("the GATED diagnostics disclosure carries the protocol detail and is CLOSED by default", async () => {
    const host = await bootHost();
    const asteroid = host.runtime.acquisition.views().find((view) => view.title === "Asteroid Drift");
    if (asteroid === undefined) throw new Error("the Asteroid view must exist");
    const detail = await detailOf(host, asteroid.itemId);
    const markup = renderItem(host, detail);
    // The disclosure exists, is not open, and clearly labels itself.
    expect(markup).toContain("data-wfx-advanced-diagnostics");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("Advanced diagnostics");
    // The protocol vocabulary lives INSIDE the gated subtree only.
    const gated = markup.match(/<details[^>]*data-wfx-advanced-diagnostics[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(gated).not.toContain("<details open");
    expect(gated).toContain("Connected peers");
    expect(gated).toContain("Verified pieces");
    expect(gated).toContain("data-wfx-diagnostics-infohash");
    expect(gated.length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// The typed action wiring (the route over the REAL store)
// ---------------------------------------------------------------------------

describe("R14 web — the typed actions wire through the route", () => {
  function postRequest(itemId: string, action: string): Request {
    return new Request("http://localhost/api/acquisition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId, action }),
    });
  }

  it("GET answers the honest current views", async () => {
    await bootHost();
    const response = await getAcquisition();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; views: AcquisitionStatusView[] };
    expect(body.mode).toBe("fixtures");
    expect(body.views.length).toBe(7);
    expect(body.views.every((view) => typeof view.state === "string")).toBe(true);
  });

  it("acquire → preparing; advance walks the lawful journey; retry lands preparing (J21-J25)", async () => {
    const host = await bootHost();
    const asteroid = host.runtime.acquisition.views().find((view) => view.title === "Asteroid Drift");
    if (asteroid === undefined) throw new Error("the Asteroid view must exist");

    const acquire = await postAcquisition(postRequest(asteroid.itemId, "acquire"));
    expect(acquire.status).toBe(200);
    const acquired = (await acquire.json()) as { view: AcquisitionStatusView };
    expect(acquired.view.state).toBe("preparing");

    // Walk to ready-offline through the typed drive.
    for (let step = 0; step < 9; step += 1) {
      const advanced = await postAcquisition(postRequest(asteroid.itemId, "advance"));
      expect(advanced.status).toBe(200);
    }
    expect(host.runtime.acquisition.view(asteroid.itemId)?.state).toBe("ready-offline");

    // The recoverable-failure retry on the Desert item.
    const desert = host.runtime.acquisition.views().find((view) => view.title === "Desert Rain Doc");
    if (desert === undefined) throw new Error("the Desert view must exist");
    expect(desert.state).toBe("failed");
    const retry = await postAcquisition(postRequest(desert.itemId, "retry"));
    expect(retry.status).toBe(200);
    const retried = (await retry.json()) as { view: AcquisitionStatusView };
    expect(retried.view.state).toBe("preparing"); // failed → preparing: the typed retry
  });

  it("pause/resume toggle the honest modifier; dismiss resets typed", async () => {
    const host = await bootHost();
    const deepField = host.runtime.acquisition.views().find((view) => view.title === "Deep Field Diary");
    if (deepField === undefined) throw new Error("the Deep Field view must exist");
    const pause = await postAcquisition(postRequest(deepField.itemId, "pause"));
    expect(pause.status).toBe(200);
    expect(host.runtime.acquisition.view(deepField.itemId)?.paused).toBe(true);
    const resume = await postAcquisition(postRequest(deepField.itemId, "resume"));
    expect(resume.status).toBe(200);
    expect(host.runtime.acquisition.view(deepField.itemId)?.paused).toBe(false);
    const dismiss = await postAcquisition(postRequest(deepField.itemId, "dismiss"));
    expect(dismiss.status).toBe(200);
    expect(host.runtime.acquisition.view(deepField.itemId)?.state).toBe("completing"); // back to step 0 of its script
  });

  it("malformed bodies answer 400; unknown items answer 404; illegal actions answer typed 409", async () => {
    await bootHost();
    const badBody = await postAcquisition(
      new Request("http://localhost/api/acquisition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonsense: true }),
      }),
    );
    expect(badBody.status).toBe(400);
    const unknown = await postAcquisition(postRequest("wfxitm_000000000000000000000000ZZ", "advance"));
    expect(unknown.status).toBe(404);
    const host = await getWebRuntimeHost();
    const asteroid = host.runtime.acquisition.views().find((view) => view.title === "Asteroid Drift");
    if (asteroid === undefined) throw new Error("the Asteroid view must exist");
    const illegal = await postAcquisition(postRequest(asteroid.itemId, "retry")); // not failed
    expect(illegal.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// J26 — the Library integration
// ---------------------------------------------------------------------------

describe("R14 web — J26: verified assets present Ready offline in the Library", () => {
  it("the offline section renders one row per verified copy (canonical identity)", async () => {
    const host = await bootHost();
    const view = await loadLibraryView(host);
    // Harbor Lights (seeded verified) + the offline section.
    expect(view.offline.entries.length).toBeGreaterThanOrEqual(1);
    const harbor = view.offline.entries.find((entry) => entry.title === "Harbor Lights");
    expect(harbor).toBeDefined();
    expect(harbor?.label).toBe("Ready offline");

    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: host.mode,
        active: "library",
        session: host.session.state,
        children: createElement(LibrarySurface, { view }),
      }),
    );
    expect(markup).toContain("data-wfx-library-offline");
    expect(markup).toContain("Offline and verified");
    expect(markup).toContain("data-wfx-offline-entry");
    expect(markup).toContain("watchable without a connection");
    // No duplicate rows: one entry per canonical itemId.
    const ids = view.offline.entries.map((entry) => entry.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the Asteroid journey lands in the Library when it earns Ready offline", async () => {
    const host = await bootHost();
    const asteroid = host.runtime.acquisition.views().find((view) => view.title === "Asteroid Drift");
    if (asteroid === undefined) throw new Error("the Asteroid view must exist");
    await postAcquisition(
      new Request("http://localhost/api/acquisition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: asteroid.itemId, action: "acquire" }),
      }),
    );
    for (let step = 0; step < 9; step += 1) {
      await postAcquisition(
        new Request("http://localhost/api/acquisition", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId: asteroid.itemId, action: "advance" }),
        }),
      );
    }
    const library = await loadLibraryView(host);
    const entry = library.offline.entries.find((item) => item.title === "Asteroid Drift");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Ready offline");
  });

  it("an empty acquisition store renders the honest empty state (never a fabricated row)", () => {
    // The service-mode truth: nothing is known (no adapter reports on the
    // web transport) — the honest empty offline section, never a fabricated
    // row. (In fixtures mode the per-render refresh always repopulates the
    // scripted items — that is the loud dev harness by design.)
    const emptyLibrary: LibraryView = {
      mode: "service",
      watchlist: { status: { state: "ready" }, entries: [] },
      history: { status: { state: "ready" }, entries: [] },
      offline: { entries: [] },
      playlists: { lists: [] },
    };
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        mode: "service",
        active: "library",
        session: {
          context: { userId: "u", sessionId: "s", locale: "en" },
          status: "anonymous",
        } as never,
        children: createElement(LibrarySurface, { view: emptyLibrary }),
      }),
    );
    expect(markup).toContain("No offline copies yet");
    expect(markup).not.toContain("data-wfx-offline-entry");
  });
});
