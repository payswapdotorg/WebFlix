/**
 * R17 — the web adapter's failure/recovery hardening tests (bun:test).
 *
 * THE EIGHT FAILURE CLASSES at the WEB seam, each with an INJECTED failure
 * and an asserted honest state (never a placeholder, never a fake success):
 *
 * 1. EXPIRED CREDENTIALS — the scripted source-auth lifecycle: the named
 *    expired state (its own chip + note + typed reauthorize action), the
 *    typed unauthorized reads carrying the classified credential, and the
 *    reauthorize recovery.
 * 2. UNAVAILABLE REALIZATIONS — the player's typed failure names the
 *    missing source (the honest dead end, never an invented realization).
 * 4. TORRENT METADATA FAILURE — the scripted `details-not-found` UX state
 *    with its retry (the web mirror of the engine's `metadata-failed`).
 * 5./3. PEER STARVATION + NETWORK LOSS — the starved session's honest
 *    waiting badge + measured numbers + truthful frozen progress; the
 *    interrupted session's explicit resume-or-clean-restart choice; the
 *    clean restart landing FRESH.
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
  driveSourceAuthFixture,
  fixtureSourceInfoOf,
  fixtureSourceReadFailure,
  readFixtureSourceAuthState,
} from "../src/host/source-auth-fixtures";
import { driveAcquisitionFixture } from "../src/host/acquisition-fixtures";
import { loadPlayerView } from "../src/host/view-models";
import { AppShell } from "../src/components/shell/AppShell";
import { SettingsSurface } from "../src/components/settings/SettingsSurface";
import { AcquisitionPanel } from "../src/components/acquisition/AcquisitionPanel";
import { GET as getSources, POST as postSources } from "../src/app/api/sources/route";
import { withEnv } from "./fake-web";

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

/** Render the settings sources section (the tree the route serves). */
function renderSources(host: WebRuntimeHost, authState: "signedIn" | "expired"): string {
  return renderToStaticMarkup(
    createElement(AppShell, {
      mode: host.mode,
      active: "settings",
      session: host.session.state,
      children: createElement(SettingsSurface, {
        capabilities: host.capabilities,
        session: host.session.state,
        mode: host.mode,
        section: "sources",
        sources: {
          status: { state: "ready" },
          sources: [fixtureSourceInfoOf(authState)],
        },
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// 1. EXPIRED CREDENTIALS — the scripted source-auth lifecycle
// ---------------------------------------------------------------------------

describe("R17 web — expired credentials (the named state + the re-auth path)", () => {
  it("the scripted source starts signed in and reads work (the healthy truth)", async () => {
    const host = await bootHost();
    expect(readFixtureSourceAuthState()).toBe("signedIn");
    expect(fixtureSourceReadFailure()).toBeNull();

    const model = await host.runtime.sources.refresh();
    expect(model.status.state).toBe("ready");
    expect(model.sources).toHaveLength(1);
    expect(model.sources[0]?.authState).toBe("signedIn");
    expect(model.sources[0]?.connected).toBe(true);
  });

  it("the dev expiry drives the NAMED expired state: its own chip, note, past expiry — never a silent fallback", async () => {
    const host = await bootHost();
    const result = driveSourceAuthFixture({ action: "expire" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.authState).toBe("expired");
    expect(result.source.connected).toBe(false); // NOT fake-connected
    expect(result.source.expiresAt !== null && Date.parse(result.source.expiresAt) < Date.now()).toBe(true);
    expect(result.source.availabilityNotes.join(" ")).toContain("The stored authorization expired");

    const model = await host.runtime.sources.refresh();
    expect(model.sources[0]?.authState).toBe("expired");
  });

  it("an EXPIRED source's reads answer the TYPED unauthorized failure with the classified credential (never a silent fallback, never a fake success)", async () => {
    await bootHost();
    driveSourceAuthFixture({ action: "expire" });
    const refusal = fixtureSourceReadFailure();
    expect(refusal).not.toBeNull();
    expect(refusal!.kind).toBe("unauthorized");
    expect(refusal!.credential).toEqual({ state: "expired", connectorId: "fake-source" });

    // The player's typed failure names the expired credential + recovery.
    const host = await bootHost();
    const view = await loadPlayerView(host, {
      itemId: "wfxitm_00000000000000000000000001",
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
      title: "Asteroid Drift",
      canonicalType: "movie",
    });
    expect(view.phase).toBe("failed");
    expect(view.failure).not.toBeNull();
    expect(view.failure!.kind).toBe("unauthorized");
    expect(view.failure!.detail).toContain("sign-in expired");
    expect(view.failure!.detail).toContain("reconnect the source");
  });

  it("the reauthorize recovery restores the signed-in state and the reads", async () => {
    await bootHost();
    driveSourceAuthFixture({ action: "expire" });
    const recovered = driveSourceAuthFixture({ action: "reauthorize" });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.source.authState).toBe("signedIn");
    expect(fixtureSourceReadFailure()).toBeNull();
  });

  it("the settings sources surface renders the expired card with its named chip, note, and reauthorize action", async () => {
    const host = await bootHost();
    const markup = renderSources(host, "expired");
    expect(markup).toContain("data-wfx-source-auth-state=\"expired\"");
    expect(markup).toContain("data-wfx-source-expired=\"true\"");
    expect(markup).toContain("Sign-in expired");
    expect(markup).toContain("The stored sign-in expired");
    expect(markup).toContain("data-wfx-source-action=\"reauthorize\"");
  });

  it("the /api/sources route drives the lifecycle and observes the post-flow state through the runtime", async () => {
    await bootHost();

    const get = await getSources(new Request("http://localhost/api/sources"));
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { mode: string; sources: { authState: string }[] };
    expect(getBody.mode).toBe("fixtures");
    expect(getBody.sources[0]?.authState).toBe("signedIn");

    const expire = await postSources(
      new Request("http://localhost/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectorId: "fake-source", action: "expire" }),
      }),
    );
    expect(expire.status).toBe(200);
    const expireBody = (await expire.json()) as { source: { authState: string } };
    expect(expireBody.source.authState).toBe("expired");

    const recover = await postSources(
      new Request("http://localhost/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectorId: "fake-source", action: "reauthorize" }),
      }),
    );
    expect(recover.status).toBe(200);
    const recoverBody = (await recover.json()) as { source: { authState: string } };
    expect(recoverBody.source.authState).toBe("signedIn");

    // The closed action vocabulary answers the typed 400 for garbage.
    const bad = await postSources(
      new Request("http://localhost/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectorId: "fake-source", action: "nope" }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 2. UNAVAILABLE REALIZATIONS — the dead end names the missing source
// ---------------------------------------------------------------------------

describe("R17 web — unavailable realizations (the dead end names the missing source)", () => {
  it("the player's typed failure names the source that offers no realization", async () => {
    const host = await bootHost();
    const view = await loadPlayerView(host, {
      itemId: "wfxitm_00000000000000000000000002",
      connectorId: "fake-source",
      externalRef: "fake:unknown-item",
      title: "Nothing Here",
      canonicalType: "video",
    });
    expect(view.phase).toBe("failed");
    expect(view.failure).not.toBeNull();
    expect(view.failure!.kind).toBe("unavailable");
    expect(view.failure!.detail).toContain("no valid playback realization");
    expect(view.failure!.detail).toContain("fake-source");
  });
});

// ---------------------------------------------------------------------------
// 4. TORRENT METADATA FAILURE — the named UX state with its retry
// ---------------------------------------------------------------------------

describe("R17 web — the metadata-failure UX (details-not-found, typed, retryable)", () => {
  it("the scripted metadata failure renders the named cause + recoverable retry, and the retry lands preparing", async () => {
    const host = await bootHost();
    const midnight = host.runtime.acquisition.views().find((view) => view.title === "Midnight Scoop");
    if (midnight === undefined) throw new Error("the Midnight Scoop view must exist");

    // Advance to the metadata failure: available → preparing → the
    // details-not-found failure (two scripted steps).
    driveAcquisitionFixture(host, { itemId: midnight.itemId, action: "advance" });
    const failed = driveAcquisitionFixture(host, { itemId: midnight.itemId, action: "advance" });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const failedView = host.runtime.acquisition.view(midnight.itemId);
    expect(failedView?.state).toBe("failed");
    expect(failedView?.failure?.cause).toBe("details-not-found");
    expect(failedView?.failure?.recoverable).toBe(true);
    expect(failedView?.failure?.label).toContain("details for this title could not be found");

    // The retry lands preparing (the honest restart of the lookup).
    const retried = driveAcquisitionFixture(host, { itemId: midnight.itemId, action: "retry" });
    expect(retried.ok).toBe(true);
    expect(host.runtime.acquisition.view(midnight.itemId)?.state).toBe("preparing");
  });
});

// ---------------------------------------------------------------------------
// 3./5. NETWORK LOSS + PEER STARVATION — the measured waiting truth + the explicit choice
// ---------------------------------------------------------------------------

describe("R17 web — network loss + peer starvation (the honest session surface)", () => {
  it("the starved session renders the waiting badge, the measured numbers, and the truthful frozen progress", async () => {
    const host = await bootHost();
    const bloom = host.runtime.acquisition.views().find((view) => view.title === "Static Bloom");
    if (bloom === undefined) throw new Error("the Static Bloom view must exist");
    // Advance to the starved step (0 → 1 preparing → 2 transferring → 3 starved).
    driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    const starved = driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    expect(starved.ok).toBe(true);

    const view = host.runtime.acquisition.view(bloom.itemId);
    expect(view?.state).toBe("completing"); // the lifecycle stays truthful
    expect(view?.starved).toEqual({ stalledMs: 92_000, bytesPerSecond: 0, sourcesConnected: 0 });
    expect(view?.progress).toBe(0.35); // the MEASURED fraction — never a fake bar
    expect(view?.detail).toContain("Nothing has arrived for 92s");
    expect(view?.detail).toContain("0 B/s measured from 0 connected sources");

    // The panel renders the waiting badge + the starvation marker.
    const markup = renderToStaticMarkup(
      createElement(AcquisitionPanel, {
        view: view ?? null,
        diagnostics: null,
        mode: host.mode,
        canAcquireOnThisDevice: false,
      }),
    );
    expect(markup).toContain("data-wfx-acquisition-starved=\"true\"");
    expect(markup).toContain("Waiting for the download source");
  });

  it("the interrupted session offers the EXPLICIT resume-or-clean-restart choice, and restart lands FRESH", async () => {
    const host = await bootHost();
    const bloom = host.runtime.acquisition.views().find((view) => view.title === "Static Bloom");
    if (bloom === undefined) throw new Error("the Static Bloom view must exist");
    // 0 → 1 → 2 → 3 (starved) → 4 (the paused interrupted session).
    driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    const interrupted = driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "advance" });
    expect(interrupted.ok).toBe(true);

    const view = host.runtime.acquisition.view(bloom.itemId);
    expect(view?.paused).toBe(true);
    expect(view?.resumed).toBe(true);
    expect(view?.retainedFraction).toBe(0.35);
    const kinds = view?.actions.map((action) => action.kind);
    expect(kinds).toContain("resume");
    expect(kinds).toContain("restart");

    // The clean restart: a FRESH attempt — no resume proof, no retained
    // progress (never a false continuation).
    const restarted = driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "restart" });
    expect(restarted.ok).toBe(true);
    const fresh = host.runtime.acquisition.view(bloom.itemId);
    expect(fresh?.state).toBe("preparing");
    expect(fresh?.resumed).toBe(false);
    expect(fresh?.retainedFraction).toBeNull();
    expect(fresh?.detail).not.toContain("Resuming where it left off");
  });

  it("restart refuses a NON-interrupted session (the typed 409 — never a silent reset)", async () => {
    const host = await bootHost();
    const bloom = host.runtime.acquisition.views().find((view) => view.title === "Static Bloom");
    if (bloom === undefined) throw new Error("the Static Bloom view must exist");
    const refused = driveAcquisitionFixture(host, { itemId: bloom.itemId, action: "restart" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.status).toBe(409);
    expect(refused.error).toContain("interrupted session");
  });
});
