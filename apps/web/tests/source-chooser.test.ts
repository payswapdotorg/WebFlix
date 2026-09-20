/**
 * R22-D — the first-connect source-chooser tests (bun:test).
 *
 * Proves the F2 dead-end killer: "Connect a source" may never terminate
 * by returning the user to the same empty state. The chooser:
 * - renders the typed prerequisite for an ANONYMOUS session (the
 *   sign-in-or-create-account affordance — never a fabricated catalog);
 * - renders every wired connector for an AUTHENTICATED session with
 *   its honest state truth + typed action (connect / reauthorize /
 *   disconnect);
 * - the source catalog route answers the SAME shared source state the
 *   Settings page renders (the convergence law);
 * - the SettingsSurface empty state now carries the chooser (no
 *   dead-end CTA loop).
 *
 * Deterministic: the fixture transport, the real route handlers, the
 * real R22-A `sourceCatalogView` derivation — no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { sourceCatalogView, readySection } from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost, getWebRuntimeHostForRequest } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import {
  FIXTURE_AUTH_TOKEN,
  driveFixtureLogin,
  resetFixtureAuthStateForTests,
} from "../src/host/auth-fixtures";
import {
  FIXTURE_SOURCE_CONNECTOR_ID,
  driveSourceAuthFixture,
  fixtureSourceInfoOf,
} from "../src/host/source-auth-fixtures";
import { SourceChooser } from "../src/components/settings/SourceChooser";
import { SettingsSurface } from "../src/components/settings/SettingsSurface";
import { GET as getSourcesCatalog } from "../src/app/api/sources/catalog/route";
import { withEnv } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
  resetFixtureAuthStateForTests();
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

describe("R22-D — GET /api/sources/catalog (the chooser data)", () => {
  it("an anonymous session carries the sign-in prerequisite (the chooser renders the prerequisite, never an empty dead end)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      // No cookie: the honest anonymous truth. The catalog carries the
      // sign-in prerequisite — the chooser renders it (never an empty
      // dead end, never a fabricated catalog of entries the user could
      // connect without an account).
      const request = new Request("http://localhost/api/sources/catalog", { method: "GET" });
      const response = await getSourcesCatalog(request);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        catalog: ReturnType<typeof sourceCatalogView>;
      };
      expect(body.catalog.prerequisite).not.toBeNull();
      expect(body.catalog.prerequisite?.kind).toBe("sign-in");
      expect(body.catalog.prerequisite?.label).toContain("Sign in or create an account");
    });
  });

  it("an authenticated session carries the wired connector with its honest state truth + typed action", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      // Sign the fixture persona in (the cookie's token resolves to
      // the authenticated host — the catalog honors the session truth).
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      const request = new Request("http://localhost/api/sources/catalog", {
        method: "GET",
        headers: { cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}` },
      });
      const response = await getSourcesCatalog(request);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        catalog: ReturnType<typeof sourceCatalogView>;
      };
      expect(body.catalog.prerequisite).toBeNull();
      expect(body.catalog.entries.length).toBeGreaterThan(0);
      const fixtureEntry = body.catalog.entries.find(
        (entry) => entry.connectorId === FIXTURE_SOURCE_CONNECTOR_ID,
      );
      expect(fixtureEntry).toBeDefined();
      expect(fixtureEntry?.state).toBe("connected");
      expect(fixtureEntry?.action.kind).toBe("disconnect");
    });
  });

  it("the catalog state truth follows the scripted source-auth lifecycle (signedIn → expired → signedOut)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      const host = await getWebRuntimeHostForRequest(FIXTURE_AUTH_TOKEN);
      expect(host.session.state.signedIn).toBe(true);

      // signedIn (the pristine state): connected, the disconnect action.
      let model = await host.runtime.sources.refresh();
      let view = sourceCatalogView({
        sources: model.sources,
        authenticated: true,
        status: model.status,
      });
      let entry = view.entries.find((e) => e.connectorId === FIXTURE_SOURCE_CONNECTOR_ID);
      expect(entry?.state).toBe("connected");
      expect(entry?.action.kind).toBe("disconnect");

      // Expire: the named expired state, the reauthorize action.
      driveSourceAuthFixture({ action: "expire" });
      model = await host.runtime.sources.refresh();
      view = sourceCatalogView({
        sources: model.sources,
        authenticated: true,
        status: model.status,
      });
      entry = view.entries.find((e) => e.connectorId === FIXTURE_SOURCE_CONNECTOR_ID);
      expect(entry?.state).toBe("authorization-expired");
      expect(entry?.action.kind).toBe("reauthorize");

      // Disconnect: the not-connected state, the connect action.
      driveSourceAuthFixture({ action: "disconnect" });
      model = await host.runtime.sources.refresh();
      view = sourceCatalogView({
        sources: model.sources,
        authenticated: true,
        status: model.status,
      });
      entry = view.entries.find((e) => e.connectorId === FIXTURE_SOURCE_CONNECTOR_ID);
      expect(entry?.state).toBe("not-connected");
      expect(entry?.action.kind).toBe("connect");
    });
  });
});

describe("R22-D — the SourceChooser island (the F2 dead-end killer)", () => {
  it("renders the prerequisite for an anonymous session (never an empty dead end)", () => {
    const view = sourceCatalogView({
      sources: [],
      authenticated: false,
    });
    const markup = renderToStaticMarkup(
      createElement(SourceChooser, { mode: "fixtures", initialCatalog: view }),
    );
    expect(markup).toContain("data-wfx-source-chooser-prerequisite");
    expect(markup).toContain("Sign in or create an account");
    expect(markup).toContain("data-wfx-source-chooser-signin");
    // The prerequisite block has a primary action (not a dead-end CTA).
    expect(markup).toContain("wfx-btn--primary");
  });

  it("renders the wired connector with its typed action for an authenticated session", () => {
    // Use the fixture's own SourceInfo builder (the same shape the
    // runtime's sources read observes — never an invented capability).
    const view = sourceCatalogView({
      sources: [fixtureSourceInfoOf("signedOut")],
      authenticated: true,
    });
    const markup = renderToStaticMarkup(
      createElement(SourceChooser, { mode: "fixtures", initialCatalog: view }),
    );
    expect(markup).toContain("data-wfx-source-chooser-entry");
    expect(markup).toContain(`data-wfx-source-chooser-entry="${FIXTURE_SOURCE_CONNECTOR_ID}"`);
    expect(markup).toContain('data-wfx-source-chooser-state="not-connected"');
    // The connect action control renders (the typed action button).
    expect(markup).toContain('data-wfx-source-action="connect"');
  });

  it("renders the honest empty-catalog detail when no connector is wired (a deployment truth, never 'arrives later')", () => {
    const view = sourceCatalogView({
      sources: [],
      authenticated: true,
    });
    const markup = renderToStaticMarkup(
      createElement(SourceChooser, { mode: "service", initialCatalog: view }),
    );
    expect(markup).toContain("data-wfx-source-chooser-empty");
    expect(markup).toContain("No connectors are available");
    // The empty detail is a deployment truth — present tense, never a
    // stale "arrives later" claim.
    expect(markup).toContain("available in this deployment yet");
  });
});

describe("R22-D — the SettingsSurface no-longer-dead-ends (the convergence law)", () => {
  it("the empty Sources state renders the chooser inline (the CTA scrolls to the chooser; no loop)", async () => {
    const host = await bootHost();
    // Construct an honest empty sources model (the deployment truth:
    // no connectors wired). The empty state fires and now carries the
    // chooser INLINE — the CTA scrolls to the chooser rather than
    // looping to the same empty state.
    const emptySources = {
      sources: [],
      status: readySection(),
    };
    const markup = renderToStaticMarkup(
      createElement(SettingsSurface, {
        capabilities: host.capabilities,
        session: host.session.state,
        mode: host.mode,
        section: "sources",
        sources: emptySources,
      }),
    );
    expect(markup).toContain("data-wfx-sources-empty");
    expect(markup).toContain('href="#wfx-source-chooser"');
    expect(markup).toContain('data-wfx-source-chooser');
    expect(markup).toContain('id="wfx-source-chooser"');
  });

  it("the Sources section renders the chooser BELOW the connected sources too (add another source)", async () => {
    const host = await bootHost();
    // The fixture source is signed-in by default — the sources list
    // renders the connected card. The chooser renders BELOW it (a
    // connected user can still add another source).
    const sources = await host.runtime.sources.refresh();
    const markup = renderToStaticMarkup(
      createElement(SettingsSurface, {
        capabilities: host.capabilities,
        session: host.session.state,
        mode: host.mode,
        section: "sources",
        sources,
      }),
    );
    expect(markup).toContain("data-wfx-sources-list");
    expect(markup).toContain('data-wfx-source-chooser');
  });
});
