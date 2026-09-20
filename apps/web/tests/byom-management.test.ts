/**
 * R22-F — the BYOM management UX tests (bun:test).
 *
 * Proves the F8 closer: "BYOM is complete only when a user can
 * DISCOVER, CONFIGURE, VERIFY, and REMOVE a provider through normal
 * product surfaces, with secrets kept server-side." The panel + the
 * bind/unbind routes together form that normal management surface:
 *
 * - DISCOVER: the Settings → Model & AI section renders the BYOM
 *   management panel (the single primary "Add your model provider"
 *   action is visible — never API-only, never direct-URL-only);
 * - CONFIGURE: the add form carries the typed fields (providerId,
 *   endpointUrl, key) + the shared R22-C pre-flight validation (the
 *   SAME rules the service enforces);
 * - VERIFY: the per-entry task usability truth renders (capability +
 *   availability + the task's effective privacy class — never a
 *   fabricated "works");
 * - REMOVE: the per-entry REMOVE action POSTs to /api/model/byom/unbind
 *   (the existing runtime operation);
 * - SECRET-FREE: the provider key rides the request body ONCE, the
 *   transport seals it server-side, and the answer is the secret-free
 *   handle ONLY (the R22-C secret law's API-boundary twin).
 *
 * Deterministic: the fixture transport, the real route handlers, the
 * real R22-C `byomManagementView` derivation — no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { byomManagementView, byomBindCommandProblems } from "@wfx/client-runtime";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import {
  FIXTURE_AUTH_TOKEN,
  driveFixtureLogin,
  resetFixtureAuthStateForTests,
} from "../src/host/auth-fixtures";
import { ByomManagementPanel } from "../src/components/settings/ByomManagementPanel";
import { SettingsSurface } from "../src/components/settings/SettingsSurface";
import { POST as postBind } from "../src/app/api/model/byom/bind/route";
import { POST as postUnbind } from "../src/app/api/model/byom/unbind/route";
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

/** Build the BYOM management view from the runtime's current reads. */
async function byomView(host: WebRuntimeHost) {
  const providers = await host.runtime.modelControls.refreshProviders();
  const view = byomManagementView({ providers: providers.providers, status: providers.status });
  return { providers, view };
}

describe("R22-F — the ByomManagementPanel (the F8 closer)", () => {
  it("DISCOVER: renders the single primary Add action (the F8 management entry point)", () => {
    const view = byomManagementView({ providers: [] });
    const markup = renderToStaticMarkup(
      createElement(ByomManagementPanel, { view, authenticated: true }),
    );
    expect(markup).toContain('data-wfx-byom-management');
    expect(markup).toContain('data-wfx-byom-action="add"');
    expect(markup).toContain("Add your model provider");
    // The single primary action (no equal-weight button clusters).
    expect(markup).toContain("wfx-btn--primary");
  });

  it("VERIFY: the per-entry task usability truth renders (capability + availability + privacy — never a fabricated 'works')", async () => {
    const host = await bootHost();
    const { view } = await byomView(host);
    const markup = renderToStaticMarkup(
      createElement(ByomManagementPanel, { view, authenticated: true }),
    );
    // The first-party provider renders (the local-model context every
    // deployment has — unsupported is not undiscoverable).
    expect(markup).toContain('data-wfx-byom-first-party-list');
    expect(markup).toContain('data-wfx-byom-entry="wfx-first-party"');
    // The capabilities render as task chips with their usability truth.
    expect(markup).toContain('data-wfx-byom-task="recommendation"');
    expect(markup).toContain('data-wfx-byom-task-usable="true"');
  });

  it("the empty state names the honest truth (no BYOM provider added yet — never a stale 'arrives later')", () => {
    const view = byomManagementView({ providers: [] });
    const markup = renderToStaticMarkup(
      createElement(ByomManagementPanel, { view, authenticated: true }),
    );
    expect(markup).toContain('data-wfx-byom-empty');
    expect(markup).toContain("No model provider of your own is added yet");
    // The empty detail is a deployment truth, present tense — never a
    // stale "arrives later" claim.
    expect(markup).not.toMatch(/arriv\w+ later/i);
  });

  it("anonymous session: the Add action is disabled with the sign-in hint (never a fabricated binding)", () => {
    const view = byomManagementView({ providers: [] });
    const markup = renderToStaticMarkup(
      createElement(ByomManagementPanel, { view, authenticated: false }),
    );
    expect(markup).toContain('data-wfx-byom-authenticated="false"');
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain('data-wfx-byom-anonymous-note');
    expect(markup).toContain("Model providers belong to your account");
  });

  it("CONFIGURE: the R22-C shared pre-flight catches invalid-input before the round trip", () => {
    // Missing providerId.
    let problems = byomBindCommandProblems({
      providerId: "",
      endpointUrl: "https://example.test",
      key: "key-1",
    });
    expect(problems.some((p) => p.field === "providerId")).toBe(true);

    // Bad endpointUrl (not http(s)).
    problems = byomBindCommandProblems({
      providerId: "my-provider",
      endpointUrl: "ftp://example.test",
      key: "key-1",
    });
    expect(problems.some((p) => p.field === "endpointUrl")).toBe(true);

    // Empty key.
    problems = byomBindCommandProblems({
      providerId: "my-provider",
      endpointUrl: "https://example.test",
      key: "",
    });
    expect(problems.some((p) => p.field === "key")).toBe(true);

    // The happy path: no problems.
    problems = byomBindCommandProblems({
      providerId: "my-provider",
      endpointUrl: "https://example.test",
      key: "secret-key-1",
    });
    expect(problems.length).toBe(0);
  });
});

describe("R22-F — POST /api/model/byom/bind (the typed transport + the secret law)", () => {
  it("anonymous session: the bind answers the typed 401 with the sign-in-again recovery (never a fabricated binding)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await postBind(
        new Request("http://localhost/api/model/byom/bind", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId: "my-provider",
            endpointUrl: "https://example.test",
            key: "secret-key-1",
          }),
        }),
      );
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error?: string; recovery?: { label?: string } };
      expect(body.error).toBe("unauthorized");
      expect(body.recovery?.label).toBe("Sign in again");
      // The key NEVER reaches the response body (the secret law's
      // API-boundary twin — the answer is the typed failure + recovery,
      // never the key material).
      const bodyText = JSON.stringify(body);
      expect(bodyText).not.toContain("secret-key-1");
    });
  });

  it("authenticated session: the bind answers the secret-free handle ONLY (the key never reaches the response body)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      const response = await postBind(
        new Request("http://localhost/api/model/byom/bind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({
            providerId: "my-provider",
            endpointUrl: "https://example.test",
            key: "secret-key-1",
          }),
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { handle?: { id?: string; keyId?: string } };
      expect(body.handle?.id).toBeDefined();
      expect(body.handle?.keyId).toBeDefined();
      // The SECRET-FREE handle: the key never reaches the response body.
      const bodyText = JSON.stringify(body);
      expect(bodyText).not.toContain("secret-key-1");
      expect(bodyText).not.toContain("\"key\":");
    });
  });

  it("invalid-input: the bind answers the typed 400 with the per-field problems + the fix-and-retry recovery", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      const response = await postBind(
        new Request("http://localhost/api/model/byom/bind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({
            providerId: "",
            endpointUrl: "not-a-url",
            key: "",
          }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error?: string;
        problems?: readonly { field?: string }[];
        recovery?: { label?: string; kind?: string };
      };
      expect(body.error).toBe("invalid-input");
      expect(body.problems?.some((p) => p.field === "providerId")).toBe(true);
      expect(body.problems?.some((p) => p.field === "endpointUrl")).toBe(true);
      expect(body.problems?.some((p) => p.field === "key")).toBe(true);
      expect(body.recovery?.kind).toBe("fix-and-retry");
    });
  });
});

describe("R22-F — POST /api/model/byom/unbind (the REMOVE step + the no-fabricated-success law)", () => {
  it("REMOVE: an authenticated unbind of a bound provider answers the honest empty ok", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      // Bind first (the precondition for removal).
      await postBind(
        new Request("http://localhost/api/model/byom/bind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({
            providerId: "removable-provider",
            endpointUrl: "https://example.test",
            key: "secret-key-1",
          }),
        }),
      );
      // Now unbind.
      const response = await postUnbind(
        new Request("http://localhost/api/model/byom/unbind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({ providerId: "removable-provider" }),
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);
    });
  });

  it("anonymous session: the unbind answers the typed 401 with the sign-in-again recovery (never a fabricated removal)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await postUnbind(
        new Request("http://localhost/api/model/byom/unbind", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providerId: "any-provider" }),
        }),
      );
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error?: string; recovery?: { label?: string } };
      expect(body.error).toBe("unauthorized");
      expect(body.recovery?.label).toBe("Sign in again");
    });
  });

  it("missing providerId: the unbind answers the typed 400 with the fix-and-retry recovery", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      const response = await postUnbind(
        new Request("http://localhost/api/model/byom/unbind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({ providerId: "" }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string; recovery?: { kind?: string } };
      expect(body.error).toBe("invalid-input");
      expect(body.recovery?.kind).toBe("fix-and-retry");
    });
  });
});

describe("R22-F — the SettingsSurface Model section integration (the discoverable entry point)", () => {
  it("the Model & AI section renders the BYOM management panel (the F8 closer — discoverable from the normal product path)", async () => {
    const host = await bootHost();
    // Load the model section's data (the same shape the page produces —
    // both the providers registry AND every task's policy).
    const MODEL_TASKS = [
      "recommendation",
      "ranking",
      "summary",
      "translation",
      "transcription",
      "speechToText",
      "textToSpeech",
      "dubbing",
      "commentary",
    ] as const;
    const [providers, ...policies] = await Promise.all([
      host.runtime.modelControls.refreshProviders(),
      ...MODEL_TASKS.map((task) => host.runtime.modelControls.refreshPolicy(task)),
    ]);
    const markup = renderToStaticMarkup(
      createElement(SettingsSurface, {
        capabilities: host.capabilities,
        session: host.session.state,
        mode: host.mode,
        section: "model",
        modelProviders: providers,
        modelPolicies: policies,
      }),
    );
    expect(markup).toContain('data-wfx-settings-model');
    expect(markup).toContain('data-wfx-byom-management');
    expect(markup).toContain('data-wfx-byom-action="add"');
    expect(markup).toContain("Add your model provider");
  });
});

describe("R22-G — the BYOM add→observe→remove round trip (the found-and-fixed defect)", () => {
  it("a successful bind lands the bound provider in the REGISTRY READ (the panel can observe what the route accepted — the J36 fix)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHost();
      driveFixtureLogin("dev@webflix.local", "dev-password-1");
      // Bind through the REAL route (the same transport the panel uses).
      const response = await postBind(
        new Request("http://localhost/api/model/byom/bind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({
            providerId: "round-trip-provider",
            endpointUrl: "https://example.test/v1",
            key: "secret-key-1",
            capabilities: ["summary", "translation"],
          }),
        }),
      );
      expect(response.status).toBe(200);

      // THE DEFECT this test pins: before the R22-G fix, the fixture port's
      // readModelProviders answered ONLY the first-party row — the provider
      // the bind route had just accepted NEVER rendered (the add→observe
      // round trip was broken in the fixtures boot; the J36 evidence walk
      // found it). The registry read must now answer the bound row too.
      const before = await host.runtime.modelControls.refreshProviders();
      const boundRow = before.providers.find(
        (row) => row.id === "round-trip-provider" && row.byomBound === true,
      );
      expect(boundRow).toBeDefined();
      expect(boundRow?.privacy).toBe("cloud");
      expect(boundRow?.capabilities).toEqual(["summary", "translation"]);
      expect(boundRow?.availability).toBe("available");

      // The management VIEW renders the bound entry with its REMOVE action
      // (the panel's own derivation over the registry read).
      const view = byomManagementView({ providers: before.providers, status: before.status });
      const entry = view.bound.find((row) => row.providerId === "round-trip-provider");
      expect(entry).toBeDefined();
      expect(entry?.action.kind).toBe("remove");

      // REMOVE: the unbind through the REAL route, then the registry read
      // answers the provider GONE (the honest removal — never a stale row).
      const unbind = await postUnbind(
        new Request("http://localhost/api/model/byom/unbind", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `wfx_session=${FIXTURE_AUTH_TOKEN}`,
          },
          body: JSON.stringify({ providerId: "round-trip-provider" }),
        }),
      );
      expect(unbind.status).toBe(200);
      const after = await host.runtime.modelControls.refreshProviders();
      expect(after.providers.some((row) => row.id === "round-trip-provider")).toBe(false);
    });
  });
});
