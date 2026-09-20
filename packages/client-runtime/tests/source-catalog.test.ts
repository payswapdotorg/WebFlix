/**
 * @wfx/client-runtime — R22-A first-connect source-catalog tests.
 *
 * The F2 dead-end-killer contract, at the shared seam:
 * - the SEVEN distinguishable truths: catalog membership (supported
 *   connector) + the per-entry state union (not-connected / connecting /
 *   connected / authorization-expired / failed / unsupported in the
 *   current platform or boot);
 * - every entry exposes the REAL connector identifier + the TYPED action
 *   required to start connection (+ the connection method in USER
 *   vocabulary — never raw provider protocol details);
 * - the anonymous sign-in prerequisite (never an empty dead end);
 * - the honest unsupported truth with a recovery next step (unsupported is
 *   not undiscoverable);
 * - in-model degradation (an error status keeps entries visible);
 * - the R22-A `SourceInfo.connectable` extension validates structurally.
 */

import { describe, expect, it } from "bun:test";

import type { Capability } from "@wfx/domain";

import {
  assertValidSourceInfo,
  isUsableSourceInfo,
  RuntimeError,
  SOURCE_CATALOG_ENTRY_STATES,
  SOURCE_CATALOG_STATE_DETAILS,
  SOURCE_CATALOG_STATE_LABELS,
  SOURCE_CATALOG_TONES,
  SOURCE_CONNECT_METHOD_KINDS,
  SOURCE_CONNECT_METHOD_VIEWS,
  connectMethodOf,
  sourceCatalogView,
  type ModelSectionStatus,
  type SourceCatalogEntry,
  type SourceInfo,
} from "../src/index";

const T0 = Date.parse("2026-09-20T12:00:00.000Z");

const ALL_CAPABILITIES: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

function capabilities(declared: readonly Capability[]): Record<Capability, boolean> {
  const record = {} as Record<Capability, boolean>;
  for (const capability of ALL_CAPABILITIES) {
    record[capability] = declared.includes(capability);
  }
  return record;
}

/** A valid observed /sources row (the R03 shape + the R22-A extension). */
function makeSource(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    connectorId: "youtube",
    displayName: "YouTube",
    version: "1.2.0",
    authMode: "oauth",
    capabilities: capabilities([
      "catalogSearch",
      "metadata",
      "playEmbed",
      "playExternal",
      "like",
      "save",
      "libraryRead",
      "libraryWrite",
      "follow",
    ]),
    authState: "signedOut",
    requiresAuthorization: true,
    connected: false,
    accountId: null,
    authorizedAt: null,
    lastStateChange: null,
    expiresAt: null,
    availabilityNotes: [],
    lastChecked: new Date(T0).toISOString(),
    ...overrides,
  };
}

const ERROR_STATUS: ModelSectionStatus = {
  state: "error",
  error: { kind: "network", detail: "GET /sources did not complete" },
};

// ---------------------------------------------------------------------------
// The seven truths
// ---------------------------------------------------------------------------

describe("R22-A — the seven distinguishable catalog truths", () => {
  it("catalog membership === observed rows (supported connectors, never fabricated)", () => {
    const view = sourceCatalogView({
      sources: [makeSource(), makeSource({ connectorId: "webflix-catalog", displayName: "WebFlix Catalog", authMode: "none" })],
      authenticated: true,
    });
    expect(view.entries.map((entry) => entry.connectorId).sort()).toEqual([
      "webflix-catalog",
      "youtube",
    ]);
    // The stable sort: by connectorId (adapters diff safely).
    expect(view.entries.map((entry) => entry.connectorId)).toEqual([
      "webflix-catalog",
      "youtube",
    ]);
  });

  it("derives every auth-state truth to its typed catalog state (total mapping)", () => {
    const cases: readonly [SourceInfo["authState"], SourceCatalogEntry["state"]][] = [
      ["signedOut", "not-connected"],
      ["authorizing", "connecting"],
      ["signedIn", "connected"],
      ["expired", "authorization-expired"],
      ["failed", "failed"],
    ];
    for (const [authState, expected] of cases) {
      const view = sourceCatalogView({
        sources: [makeSource({ authState })],
        authenticated: true,
      });
      expect(view.entries[0]?.state).toBe(expected);
      expect(view.entries[0]?.stateLabel).toBe(SOURCE_CATALOG_STATE_LABELS[expected]);
      expect(view.entries[0]?.stateDetail).toBe(SOURCE_CATALOG_STATE_DETAILS[expected]);
    }
  });

  it("an expired authorization is the NAMED expired state — never connected, never silently signed-out", () => {
    const view = sourceCatalogView({
      sources: [makeSource({ authState: "expired", expiresAt: new Date(T0 - 1_000).toISOString() })],
      authenticated: true,
    });
    const entry = view.entries[0]!;
    expect(entry.state).toBe("authorization-expired");
    expect(entry.stateLabel).toBe("Sign-in expired");
    expect(entry.tone).toBe("attention");
    expect(entry.action.kind).toBe("reauthorize");
    expect(entry.action.label).toBe("Reconnect");
  });

  it("boot-unsupported (connectable: false) is its own state with the honest reason + recovery next step", () => {
    const view = sourceCatalogView({
      sources: [makeSource({ connectable: false })],
      authenticated: true,
    });
    const entry = view.entries[0]!;
    expect(entry.state).toBe("unsupported");
    expect(entry.unsupportedDetail).toBe(
      "This deployment hasn't provisioned this source's sign-in flow yet.",
    );
    expect(entry.recoveryHint).toContain("operator");
    expect(entry.action.kind).toBe("none");
    expect(entry.tone).toBe("neutral");
  });

  it("platform-unsupported (the adapter truth map) is the same typed state with the adapter's sentence", () => {
    const view = sourceCatalogView({
      sources: [makeSource({ connectorId: "desktop-only-source" })],
      authenticated: true,
      unsupportedOnPlatform: new Map([
        ["desktop-only-source", "This source connects only in the WebFlix Desktop app."],
      ]),
    });
    const entry = view.entries[0]!;
    expect(entry.state).toBe("unsupported");
    expect(entry.unsupportedDetail).toBe(
      "This source connects only in the WebFlix Desktop app.",
    );
    expect(entry.recoveryHint).toContain("Desktop");
  });

  it("the state vocabulary is exactly the frozen six + membership is the seventh truth", () => {
    expect(SOURCE_CATALOG_ENTRY_STATES).toEqual([
      "not-connected",
      "connecting",
      "connected",
      "authorization-expired",
      "failed",
      "unsupported",
    ]);
    // Membership is not a per-entry enum value: an entry EXISTS iff its row
    // was observed (tested above) — the module doc's frozen law.
    expect(SOURCE_CATALOG_TONES).toEqual({
      "not-connected": "neutral",
      connecting: "attention",
      connected: "positive",
      "authorization-expired": "attention",
      failed: "negative",
      unsupported: "neutral",
    });
  });
});

// ---------------------------------------------------------------------------
// The typed action + the connection method (user vocabulary)
// ---------------------------------------------------------------------------

describe("R22-A — the typed connect action + user-vocabulary method", () => {
  it("every entry exposes the real connector id + a typed action per state", () => {
    const cases: readonly [SourceInfo["authState"], SourceCatalogEntry["action"]["kind"], string][] = [
      ["signedOut", "connect", "Connect"],
      ["authorizing", "none", ""],
      ["signedIn", "disconnect", "Disconnect"],
      ["expired", "reauthorize", "Reconnect"],
      ["failed", "reauthorize", "Try connecting again"],
    ];
    for (const [authState, kind, label] of cases) {
      const view = sourceCatalogView({
        sources: [makeSource({ authState })],
        authenticated: true,
      });
      const entry = view.entries[0]!;
      expect(entry.connectorId).toBe("youtube");
      expect(entry.action.kind).toBe(kind);
      expect(entry.action.label).toBe(label);
      expect(entry.action.detail.length).toBeGreaterThan(0);
    }
  });

  it("a no-sign-in (authMode: none) source offers the real 'Use this source' connect action", () => {
    const view = sourceCatalogView({
      sources: [makeSource({ authMode: "none", requiresAuthorization: false })],
      authenticated: true,
    });
    const entry = view.entries[0]!;
    expect(entry.state).toBe("not-connected");
    expect(entry.method.method).toBe("no-signin");
    expect(entry.action).toEqual({
      kind: "connect",
      label: "Use this source",
      detail: "This source needs no sign-in — it works right away.",
    });
  });

  it("the connection method is derived from authMode in USER vocabulary — never raw protocol detail", () => {
    expect(connectMethodOf("oauth").method).toBe("provider-signin");
    expect(connectMethodOf("device").method).toBe("device-code");
    expect(connectMethodOf("local").method).toBe("access-key");
    expect(connectMethodOf("none").method).toBe("no-signin");
    for (const kind of SOURCE_CONNECT_METHOD_KINDS) {
      const view = SOURCE_CONNECT_METHOD_VIEWS[kind];
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.detail.length).toBeGreaterThan(0);
      // The raw protocol vocabulary never appears as primary UX words.
      expect(/oauth|client[- ]?id|scope|redirect|token|endpoint|bearer/i.test(view.label)).toBe(false);
    }
  });

  it("the method label/detail vocabulary never leaks protocol jargon", () => {
    const view = sourceCatalogView({
      sources: [
        makeSource(),
        makeSource({ connectorId: "device-source", authMode: "device" }),
        makeSource({ connectorId: "local-source", authMode: "local" }),
        makeSource({ connectorId: "open-source", authMode: "none" }),
      ],
      authenticated: true,
    });
    for (const entry of view.entries) {
      expect(/oauth|client[- ]?id|scope|redirect|token|endpoint|bearer|protocol/i.test(entry.method.label)).toBe(false);
      expect(/oauth|client[- ]?id|scope|redirect|token|endpoint|bearer|protocol/i.test(entry.method.detail)).toBe(false);
      expect(/oauth|client[- ]?id|scope|redirect|endpoint|bearer|protocol/i.test(entry.stateLabel)).toBe(false);
    }
  });

  it("carries the capability-truth summary the choice rests on", () => {
    const view = sourceCatalogView({ sources: [makeSource()], authenticated: true });
    const highlights = view.entries[0]!.capabilityHighlights;
    expect(highlights.declared).toContain("playEmbed");
    expect(highlights.declared).not.toContain("playNative");
    expect(highlights.absent).toContain("playNative");
    // The observed row stays attached (the deeper truth behind the choice).
    expect(view.entries[0]!.source.connectorId).toBe("youtube");
  });
});

// ---------------------------------------------------------------------------
// The anonymous prerequisite (the F2 dead-end killer for signed-out users)
// ---------------------------------------------------------------------------

describe("R22-A — the anonymous sign-in prerequisite", () => {
  it("an anonymous session carries the typed sign-in prerequisite — never an empty dead end", () => {
    const view = sourceCatalogView({ sources: [], authenticated: false });
    expect(view.prerequisite).not.toBeNull();
    expect(view.prerequisite?.kind).toBe("sign-in");
    expect(view.prerequisite?.label).toBe("Sign in or create an account");
    expect(view.prerequisite?.detail).toContain("account");
    expect(view.entries).toEqual([]);
    expect(view.catalogEmptyDetail).toBeNull();
  });

  it("an authenticated session carries NO prerequisite", () => {
    const view = sourceCatalogView({ sources: [makeSource()], authenticated: true });
    expect(view.prerequisite).toBeNull();
  });

  it("the honest empty catalog (signed in, ready, zero wired rows) names the deployment truth", () => {
    const view = sourceCatalogView({ sources: [], authenticated: true });
    expect(view.entries).toEqual([]);
    expect(view.catalogEmptyDetail).toBe(
      "No connectors are available in this deployment yet — the catalog is empty because no source is wired.",
    );
  });
});

// ---------------------------------------------------------------------------
// In-model degradation + the connectable structural validation
// ---------------------------------------------------------------------------

describe("R22-A — in-model degradation + the connectable extension", () => {
  it("an error status keeps the entries visible (never a fake empty catalog)", () => {
    const view = sourceCatalogView({
      sources: [makeSource()],
      authenticated: true,
      status: ERROR_STATUS,
    });
    expect(view.status).toEqual(ERROR_STATUS);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.state).toBe("not-connected");
  });

  it("an error status with zero rows does not claim the empty-catalog deployment truth", () => {
    const view = sourceCatalogView({ sources: [], authenticated: true, status: ERROR_STATUS });
    expect(view.catalogEmptyDetail).toBeNull();
  });

  it("connectable rows pass the structural validation; a non-boolean connectable is rejected", () => {
    expect(() => assertValidSourceInfo(makeSource({ connectable: true }))).not.toThrow();
    expect(() => assertValidSourceInfo(makeSource({ connectable: false }))).not.toThrow();
    expect(isUsableSourceInfo(makeSource({ connectable: true }))).toBe(true);
    const poisoned = { ...makeSource(), connectable: "yes" } as unknown as SourceInfo;
    expect(() => assertValidSourceInfo(poisoned)).toThrow(RuntimeError);
    expect(isUsableSourceInfo(poisoned)).toBe(false);
  });

  it("an absent connectable leaves the entry connectable-truth-unknown (offered honestly, never guessed unsupported)", () => {
    const row = makeSource();
    expect(row.connectable).toBeUndefined();
    const view = sourceCatalogView({ sources: [row], authenticated: true });
    expect(view.entries[0]?.state).toBe("not-connected");
    expect(view.entries[0]?.action.kind).toBe("connect");
  });
});
