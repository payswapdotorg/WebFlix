/**
 * R03 — pending-authorization + template tests (bun:test).
 *
 * Pins the SDK refinements the R03 source-management flows need:
 *
 * - `beginAuth(ctx, connectorId, { state })` threads the caller-minted
 *   OPAQUE OAuth state onto the pending (`PendingAuthInfo.state`) — the
 *   token a host keys its durable pending-authorizations by. Garbage state
 *   answers the typed `invalid-input`; absent options keep the EXACT
 *   pre-R03 behavior (no `state` field).
 * - `fillFlowTemplate` materializes a flow's URL template — every
 *   placeholder must have a parameter (typed failure otherwise — never a
 *   fabricated URL), values are percent-encoded.
 * - The stub AUTH fixtures (`stub-oauth` / `stub-device` / `stub-local`)
 *   are valid `BaseConnector` instances with the expected auth modes and
 *   flow details, and are visibly branded TEST FIXTURES.
 *
 * Determinism: injected clock; no network.
 */

import { describe, expect, it } from "bun:test";

import {
  AuthFlowValidationError,
  ConnectorAuthService,
  ConnectorRegistry,
  fillFlowTemplate,
  makeStubAuthConnector,
  STUB_DEVICE_CONNECTOR_ID,
  STUB_LOCAL_CONNECTOR_ID,
  STUB_OAUTH_AUTHORIZATION_URL_TEMPLATE,
  STUB_OAUTH_CONNECTOR_ID,
  stubAuthFlowDetails,
} from "../src/index";

const CTX = { userId: "wfx-r03-sdk-test-user", locale: "en" };

function makeService(): ConnectorAuthService {
  const registry = new ConnectorRegistry();
  registry.register(makeStubAuthConnector("oauth"));
  registry.register(makeStubAuthConnector("device"));
  registry.register(makeStubAuthConnector("local"));
  return new ConnectorAuthService({
    registry,
    flows: {
      [STUB_OAUTH_CONNECTOR_ID]: stubAuthFlowDetails("oauth"),
      [STUB_DEVICE_CONNECTOR_ID]: stubAuthFlowDetails("device"),
      [STUB_LOCAL_CONNECTOR_ID]: stubAuthFlowDetails("local"),
    },
    clock: () => 1_800_000_000_000,
  });
}

describe("beginAuth pending-authorization state threading (R03)", () => {
  it("echoes the caller-minted state on the pending", () => {
    const service = makeService();
    const begun = service.beginAuth(CTX, STUB_OAUTH_CONNECTOR_ID, {
      state: "st-r03-sdk-echo",
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.value.state).toBe("st-r03-sdk-echo");
    expect(begun.value.flow.kind).toBe("oauth");
    // The state completes like any pending: same pendingAuthId channel.
    const completed = service.completeAuth(begun.value.pendingAuthId, "stub-secret");
    expect(completed.ok).toBe(true);
  });

  it("keeps the EXACT pre-R03 behavior when no options are supplied", () => {
    const service = makeService();
    const begun = service.beginAuth(CTX, STUB_LOCAL_CONNECTOR_ID);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect("state" in begun.value).toBe(false);
    expect(begun.value.flow).toEqual({ kind: "local", method: "token" });
  });

  it("answers typed invalid-input for garbage state tokens", () => {
    const service = makeService();
    const empty = service.beginAuth(CTX, STUB_OAUTH_CONNECTOR_ID, { state: "" });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.kind).toBe("invalid-input");

    const controls = service.beginAuth(CTX, STUB_OAUTH_CONNECTOR_ID, {
      state: "bad\nstate",
    });
    expect(controls.ok).toBe(false);
    if (controls.ok) return;
    expect(controls.error.kind).toBe("invalid-input");

    const tooLong = service.beginAuth(CTX, STUB_OAUTH_CONNECTOR_ID, {
      state: "x".repeat(257),
    });
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.error.kind).toBe("invalid-input");
  });

  it("device flows carry the state too (the pending key is flow-agnostic)", () => {
    const service = makeService();
    const begun = service.beginAuth(CTX, STUB_DEVICE_CONNECTOR_ID, {
      state: "st-r03-sdk-device",
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.value.state).toBe("st-r03-sdk-device");
    expect(begun.value.flow.kind).toBe("device");
  });
});

describe("fillFlowTemplate (R03)", () => {
  it("fills every placeholder with percent-encoded values", () => {
    const url = fillFlowTemplate(STUB_OAUTH_AUTHORIZATION_URL_TEMPLATE, {
      clientId: "stub-client",
      redirectUri: "https://api.example/sources/callback",
      state: "st r03/sdk",
    });
    expect(url).toBe(
      "https://stub.example/oauth/authorize?client_id=stub-client" +
        "&response_type=code" +
        "&redirect_uri=https%3A%2F%2Fapi.example%2Fsources%2Fcallback" +
        "&state=st%20r03%2Fsdk",
    );
  });

  it("refuses to fabricate a URL when a placeholder has no parameter", () => {
    expect(() =>
      fillFlowTemplate(STUB_OAUTH_AUTHORIZATION_URL_TEMPLATE, {
        clientId: "stub-client",
        // redirectUri + state missing
      }),
    ).toThrow(AuthFlowValidationError);
    let message = "";
    try {
      fillFlowTemplate("https://x.example/a?b={b}", {});
    } catch (thrown) {
      message = thrown instanceof Error ? thrown.message : String(thrown);
    }
    expect(message).toContain("b");
  });
});

describe("stub auth fixtures (R03)", () => {
  it("are valid connectors with the expected auth modes and test branding", () => {
    for (const kind of ["oauth", "device", "local"] as const) {
      const connector = makeStubAuthConnector(kind);
      const descriptor = connector.descriptor();
      expect(descriptor.auth).toBe(kind);
      expect(connector.isTestFixture).toBe(true);
      const flow = stubAuthFlowDetails(kind);
      expect(flow.kind).toBe(kind);
      if (flow.kind === "oauth") {
        expect(flow.authorizationUrlTemplate).toContain("stub.example");
      }
    }
  });
});
