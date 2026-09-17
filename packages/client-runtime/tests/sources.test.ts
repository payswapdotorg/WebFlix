/**
 * R03 — source-management runtime tests (bun:test).
 *
 * Pins the R03 ServerPort extension + the runtime's `sources()` read model:
 *
 * - `SourceInfo` shape guard (`isUsableSourceInfo`) accepts the truth
 *   shape and rejects the malformed ones (a broken entry is never source
 *   truth).
 * - `InMemoryServerPort.readSources` honors the port contract (scripted
 *   verbatim, honest empty default, typed failures through the result
 *   channel).
 * - `createRuntime().sources()`:
 *   - READY model with validated entries (the settings `sources` section's
 *     payload — R01's SettingsSection vocabulary);
 *   - the honest ERROR section on a failing read (never a fake empty list);
 *   - the honest `unavailable` ERROR section when the port does NOT
 *     implement the R03 member (the frozen R07/R08 adapter shape) — the
 *     documented optional-member law;
 *   - malformed entries are skipped, valid ones kept.
 * - The settings navigation payload consumes the vocabulary: the `sources`
 *   section navigates legally and the model answers for it.
 *
 * Determinism: FixedClock + SequentialIdGen; no network.
 */

import { describe, expect, it } from "bun:test";
import type { Capability } from "@wfx/domain";

import {
  createRuntime,
  FixedClock,
  InMemoryServerPort,
  isUsableSourceInfo,
  makeWebCapabilities,
  SETTINGS_SECTIONS,
  type SourceInfo,
} from "../src/index";
import type { ServerPort } from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");

/** All-false capability row except the named ones (the truth shape helper). */
function capabilityRow(declared: readonly Capability[]): Record<Capability, boolean> {
  const row = {
    identity: false,
    catalogSearch: false,
    metadata: false,
    playNative: false,
    playEmbed: false,
    playBrowser: false,
    playExternal: false,
    availability: false,
    libraryRead: false,
    libraryWrite: false,
    like: false,
    save: false,
    follow: false,
    comment: false,
    download: false,
    transform: false,
  } as Record<Capability, boolean>;
  for (const capability of declared) row[capability] = true;
  return row;
}

function makeSourceInfo(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    connectorId: "youtube",
    displayName: "YouTube",
    version: "0.1.0",
    authMode: "oauth",
    authState: "signedIn",
    usable: true,
    connected: true,
    capabilities: capabilityRow(["catalogSearch", "metadata", "playEmbed"]),
    authorizedAt: new Date(T0).toISOString(),
    lastStateChange: new Date(T0).toISOString(),
    expiresAt: null,
    notes: ["daily quota: 10,000 units (midnight Pacific reset)"],
    ...overrides,
  };
}

function makeRuntime(server: ServerPort) {
  return createRuntime(makeWebCapabilities(), server, {
    context: { userId: "wfx-r03-user", sessionId: "wfx-r03-session", locale: "en" },
    clock: new FixedClock(T0),
    ids: { next: () => "00000000000000000000000001" },
  });
}

describe("SourceInfo shape guard (the transport-boundary honesty filter)", () => {
  it("accepts the truth shape", () => {
    expect(isUsableSourceInfo(makeSourceInfo())).toBe(true);
    expect(isUsableSourceInfo(makeSourceInfo({ authState: "expired", usable: false }))).toBe(true);
    expect(
      isUsableSourceInfo(makeSourceInfo({ authorizedAt: null, connected: false })),
    ).toBe(true);
  });

  it("rejects malformed entries (never rendered as source truth)", () => {
    expect(isUsableSourceInfo(null)).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), connectorId: "" })).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), authState: "connected" })).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), authMode: "sso" })).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), usable: "yes" })).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), capabilities: null })).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), notes: "not-an-array" })).toBe(false);
    expect(isUsableSourceInfo({ ...makeSourceInfo(), authorizedAt: 42 })).toBe(false);
  });
});

describe("InMemoryServerPort.readSources (the port contract double)", () => {
  it("answers scripted results verbatim; unscripted reads answer the honest empty default", async () => {
    const server = new InMemoryServerPort();
    server.scriptSourcesRead({ ok: true, value: [makeSourceInfo()] });
    const scripted = await server.readSources();
    expect(scripted.ok).toBe(true);
    if (scripted.ok) expect(scripted.value).toHaveLength(1);
    expect(scripted.ok && scripted.value[0]?.connectorId).toBe("youtube");

    const unscripted = await server.readSources();
    expect(unscripted.ok).toBe(true);
    if (unscripted.ok) expect(unscripted.value).toEqual([]);
  });

  it("carries typed failures through the result channel", async () => {
    const server = new InMemoryServerPort();
    server.scriptSourcesRead({
      ok: false,
      failure: { kind: "unauthorized", detail: "a bearer session is required" },
    });
    const result = await server.readSources();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unauthorized");
      expect(result.failure.detail).toBe("a bearer session is required");
    }
  });
});

describe("runtime.sources() (the R03 read model)", () => {
  it("answers the READY model with validated entries — the settings sources section payload", async () => {
    const server = new InMemoryServerPort();
    const youtube = makeSourceInfo();
    const catalog = makeSourceInfo({
      connectorId: "webflix-catalog",
      displayName: "WebFlix Catalog",
      authMode: "none",
      authState: "signedOut",
      usable: true,
      connected: false,
      authorizedAt: null,
      lastStateChange: null,
      notes: [],
    });
    server.scriptSourcesRead({ ok: true, value: [youtube, catalog] });

    const runtime = makeRuntime(server);
    const model = await runtime.sources();
    expect(model.status.state).toBe("ready");
    expect(model.sources).toHaveLength(2);
    expect(model.sources[0]?.authState).toBe("signedIn");
    expect(model.sources[0]?.capabilities.catalogSearch).toBe(true);
    expect(model.sources[0]?.capabilities.playNative).toBe(false);
    expect(model.sources[1]?.authMode).toBe("none");
    expect(model.sources[1]?.usable).toBe(true);

    // The settings navigation payload: the `sources` section is a legal
    // R01 vocabulary member and navigates legally to the surface that
    // renders this model.
    expect(SETTINGS_SECTIONS).toContain("sources");
    const nav = runtime.navigation;
    expect(nav.navigate({ surface: "settings", section: "sources" }).ok).toBe(true);
    expect(nav.current()).toEqual({ surface: "settings", section: "sources" });
  });

  it("answers the honest ERROR section on a failing read (never a fake empty list)", async () => {
    const server = new InMemoryServerPort();
    server.scriptSourcesRead({
      ok: false,
      failure: { kind: "network", detail: "offline" },
    });
    const model = await makeRuntime(server).sources();
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("network");
    expect(model.status.error?.detail).toBe("offline");
    expect(model.sources).toEqual([]);
  });

  it("answers the typed unavailable ERROR section when the port has NO readSources member (the frozen adapter shape)", async () => {
    // A port shaped exactly like the frozen R07/R08 adapters: every R01+R02
    // member, NO R03 member. The runtime must degrade this honestly.
    const full = new InMemoryServerPort();
    const withoutR03: ServerPort = {
      serviceId: full.serviceId,
      search: (q) => full.search(q),
      shorts: (q) => full.shorts(q),
      metadata: (r) => full.metadata(r),
      resolve: (r) => full.resolve(r),
      executeAction: (a) => full.executeAction(a),
      readLibrary: () => full.readLibrary(),
      writeLibrary: (c) => full.writeLibrary(c),
      emitEvent: (e) => full.emitEvent(e),
      readHistory: () => full.readHistory(),
      readProfileLibrary: () => full.readProfileLibrary(),
      readIntents: () => full.readIntents(),
      writeIntent: (i) => full.writeIntent(i),
      readPolicy: () => full.readPolicy(),
      writePolicy: (p) => full.writePolicy(p),
    };
    expect(withoutR03.readSources).toBeUndefined(); // the frozen shape

    const model = await makeRuntime(withoutR03).sources();
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("unavailable");
    expect(model.status.error?.detail).toContain("readSources");
    expect(model.sources).toEqual([]);
  });

  it("skips malformed entries and keeps the valid ones (the search-hit law)", async () => {
    const server = new InMemoryServerPort();
    server.scriptSourcesRead({
      ok: true,
      value: [
        makeSourceInfo(),
        { connectorId: "broken", displayName: 42 } as unknown as SourceInfo,
      ],
    });
    const model = await makeRuntime(server).sources();
    expect(model.status.state).toBe("ready");
    expect(model.sources).toHaveLength(1);
    expect(model.sources[0]?.connectorId).toBe("youtube");
  });
});
