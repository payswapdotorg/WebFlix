/**
 * @wfx/client-runtime — R03 source-management runtime tests.
 *
 * The spec's acceptance points, at the runtime layer:
 * - the InMemoryServerPort double honors `readSources` (scripting, the
 *   honest-empty default, typed failures);
 * - the source-state store REFRESH: ready models carry the server truth,
 *   failing reads are ERROR models that keep the last observed sources
 *   (never a fake empty list), and a port without the R03 read answers the
 *   honest `unavailable` model (the frozen-adapter transition, documented
 *   for the lead's ratification);
 * - OBSERVE: the adapter's post-flow reports (connect → signedIn,
 *   disconnect → signedOut) upsert, notify subscribers, and are validated
 *   (garbage throws the typed RuntimeError — never a guessed source);
 * - the SETTINGS/SETTINGS-SOURCES navigation consumes the surface: the
 *   section vocabulary (sources | model | general) stays R01's, and the
 *   runtime exposes the source truth that section renders;
 * - `createRuntime` wires `runtime.sources` (the shared surface every
 *   adapter renders).
 */

import { describe, expect, it } from "bun:test";

import type { Capability } from "@wfx/domain";

import {
  FixedClock,
  InMemoryServerPort,
  createRuntime,
  createSourceStateStore,
  makeWebCapabilities,
  RuntimeError,
  SETTINGS_SECTIONS,
  assertValidSourceInfo,
  type RuntimeContext,
  type ServerFailure,
  type ServerPort,
  type SourceInfo,
} from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const CONTEXT: RuntimeContext = { userId: "user-1", sessionId: "sess-1", locale: "en" };
const ids = { next: () => "00000000000000000000000001" };

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

/** A valid SourceInfo fixture (the server's /sources row shape). */
function makeSource(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    connectorId: "youtube",
    displayName: "YouTube",
    version: "1.2.0",
    authMode: "oauth",
    capabilities: capabilities(["catalogSearch", "metadata", "playEmbed", "playExternal", "like", "save", "libraryRead", "libraryWrite"]),
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

// ---------------------------------------------------------------------------
// The ServerPort double — readSources
// ---------------------------------------------------------------------------

describe("InMemoryServerPort — the R03 readSources double", () => {
  it("answers the honest empty list by default (nothing scripted)", async () => {
    const server = new InMemoryServerPort();
    const result = await server.readSources();
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("answers scripted sources and scripted failures", async () => {
    const server = new InMemoryServerPort();
    const source = makeSource();
    server.scriptSourcesRead({ ok: true, value: [source] });
    expect(await server.readSources()).toEqual({ ok: true, value: [source] });

    const failure: ServerFailure = { kind: "unauthorized", detail: "session required" };
    server.scriptSourcesRead({ ok: false, failure });
    expect(await server.readSources()).toEqual({ ok: false, failure });
  });
});

// ---------------------------------------------------------------------------
// The source-state store
// ---------------------------------------------------------------------------

describe("createSourceStateStore — refresh (the server truth)", () => {
  it("a ready refresh carries the server's source truth and updates the observed list", async () => {
    const server = new InMemoryServerPort();
    const store = createSourceStateStore(server);

    const before = store.list();
    expect(before).toEqual([]); // empty before the first refresh — honest

    server.scriptSourcesRead({
      ok: true,
      value: [makeSource({ connectorId: "youtube" }), makeSource({ connectorId: "webflix-catalog", displayName: "WebFlix Catalog", authMode: "none", requiresAuthorization: false })],
    });
    const model = await store.refresh();
    expect(model.status).toEqual({ state: "ready" });
    expect(model.sources.map((s) => s.connectorId)).toEqual(["webflix-catalog", "youtube"]); // sorted, stable
    expect(store.list().map((s) => s.connectorId)).toEqual(["webflix-catalog", "youtube"]);
  });

  it("a failing read is an ERROR model that KEEPS the last observed sources — never a fake empty", async () => {
    const server = new InMemoryServerPort();
    const store = createSourceStateStore(server);

    server.scriptSourcesRead({ ok: true, value: [makeSource({ authState: "signedIn", connected: true })] });
    await store.refresh();
    expect(store.list()).toHaveLength(1);

    server.scriptSourcesRead({
      ok: false,
      failure: { kind: "network", detail: "the service is unreachable" },
    });
    const model = await store.refresh();
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("network");
    expect(model.status.error?.detail).toBe("the service is unreachable");
    // the last observed truth stays visible for the adapter to render
    expect(model.sources).toHaveLength(1);
    expect(model.sources[0]?.authState).toBe("signedIn");
    expect(store.list()).toHaveLength(1);
  });

  it("a port WITHOUT the R03 read answers the honest unavailable model", async () => {
    // The frozen R07/R08 adapters do not implement readSources yet (the
    // documented transition — see server-port.ts's ratification note).
    const portWithoutR03 = {} as ServerPort;
    const store = createSourceStateStore(portWithoutR03);
    const model = await store.refresh();
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("unavailable");
    expect(model.status.error?.detail).toContain("readSources");
    expect(model.sources).toEqual([]);
  });

  it("malformed server rows are skipped (a broken row is never a source card)", async () => {
    const server = new InMemoryServerPort();
    const store = createSourceStateStore(server);
    server.scriptSourcesRead({
      ok: true,
      value: [
        makeSource(),
        { connectorId: "broken" } as unknown as SourceInfo, // structurally invalid
      ],
    });
    const model = await store.refresh();
    expect(model.status).toEqual({ state: "ready" });
    expect(model.sources.map((s) => s.connectorId)).toEqual(["youtube"]);
  });
});

describe("createSourceStateStore — observe (the post-flow transitions)", () => {
  it("an observed connect transitions that source to signedIn and notifies subscribers", () => {
    const server = new InMemoryServerPort();
    const store = createSourceStateStore(server);

    const events: SourceInfo[][] = [];
    store.subscribe((sources) => events.push([...sources]));

    store.observe(makeSource({ authState: "authorizing", connected: false }));
    expect(store.list()[0]?.authState).toBe("authorizing");

    store.observe(
      makeSource({
        authState: "signedIn",
        connected: true,
        accountId: "wfxacct_00000000000000000000000001",
        authorizedAt: new Date(T0).toISOString(),
        lastStateChange: new Date(T0).toISOString(),
      }),
    );
    const final = store.list();
    expect(final).toHaveLength(1); // upsert, not append
    expect(final[0]?.authState).toBe("signedIn");
    expect(final[0]?.connected).toBe(true);

    // a disconnect observation lands the same way
    store.observe(
      makeSource({ authState: "signedOut", connected: false, accountId: null, authorizedAt: null }),
    );
    expect(store.list()[0]?.authState).toBe("signedOut");

    expect(events).toHaveLength(3); // one notification per observation
    expect(events[2]?.[0]?.authState).toBe("signedOut");
  });

  it("unsubscribe stops notifications", () => {
    const server = new InMemoryServerPort();
    const store = createSourceStateStore(server);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.observe(makeSource());
    unsubscribe();
    store.observe(makeSource({ authState: "signedIn", connected: true }));
    expect(notified).toBe(1);
  });

  it("garbage observations throw the typed RuntimeError — never a guessed source", () => {
    const server = new InMemoryServerPort();
    const store = createSourceStateStore(server);

    expect(() => store.observe(null as unknown as SourceInfo)).toThrow(RuntimeError);
    expect(() =>
      store.observe(makeSource({ authState: "somewhere" as SourceInfo["authState"] })),
    ).toThrow(RuntimeError);
    expect(() =>
      store.observe(makeSource({ capabilities: { catalogSearch: "yes" } as unknown as Record<Capability, boolean> })),
    ).toThrow(RuntimeError);
    expect(() => store.observe(makeSource({ lastChecked: "yesterday" }))).toThrow(RuntimeError);
    // nothing from the garbage landed
    expect(store.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assertValidSourceInfo (the structural law)
// ---------------------------------------------------------------------------

describe("assertValidSourceInfo (structural validation)", () => {
  it("accepts the full truthful shape (every capability explicit)", () => {
    expect(() => assertValidSourceInfo(makeSource())).not.toThrow();
    expect(() =>
      assertValidSourceInfo(makeSource({ authMode: "none", requiresAuthorization: false, capabilities: capabilities([]) })),
    ).not.toThrow();
  });

  it("rejects a capability record with a missing truth flag (truth is never guessed)", () => {
    const partial = { ...makeSource() };
    const broken = { ...partial.capabilities } as Partial<Record<Capability, boolean>>;
    delete broken["playBrowser"];
    expect(() =>
      assertValidSourceInfo({ ...partial, capabilities: broken as Record<Capability, boolean> }),
    ).toThrow(RuntimeError);
  });
});

// ---------------------------------------------------------------------------
// The runtime wiring + the settings/sources navigation payload
// ---------------------------------------------------------------------------

describe("createRuntime — the sources surface + the settings navigation", () => {
  function boot(server: ServerPort) {
    return createRuntime(makeWebCapabilities(), server, {
      context: CONTEXT,
      clock: new FixedClock(T0),
      ids,
    });
  }

  it("runtime.sources is wired and refreshes through the port", async () => {
    const server = new InMemoryServerPort();
    const runtime = boot(server);
    expect(runtime.sources.list()).toEqual([]);

    server.scriptSourcesRead({
      ok: true,
      value: [makeSource({ authState: "expired", connected: true, expiresAt: new Date(T0).toISOString(), availabilityNotes: ["the stored authorization expired — reauthorization required"] })],
    });
    const model = await runtime.sources.refresh();
    expect(model.status).toEqual({ state: "ready" });
    expect(model.sources[0]?.authState).toBe("expired");
    expect(model.sources[0]?.availabilityNotes).toEqual([
      "the stored authorization expired — reauthorization required",
    ]);
    expect(runtime.sources.list()[0]?.authState).toBe("expired");
  });

  it("the settings navigation vocabulary keeps R01's sections and lands on sources truth", async () => {
    const server = new InMemoryServerPort();
    const runtime = boot(server);

    // R01's vocabulary: sources | model | general (the R03 surface rides it)
    expect(SETTINGS_SECTIONS).toEqual(["sources", "model", "general"]);

    // Navigating to the settings/sources section is the product surface
    // whose payload IS the source truth the runtime exposes.
    const landed = runtime.navigation.navigate({ surface: "settings", section: "sources" });
    expect(landed.ok).toBe(true);
    if (landed.ok) {
      expect(landed.state).toEqual({ surface: "settings", section: "sources" });
    }

    // the settings section's data payload: the runtime's source model
    server.scriptSourcesRead({
      ok: true,
      value: [makeSource({ authState: "signedIn", connected: true })],
    });
    expect(runtime.sources.list()).toEqual([]); // not refreshed yet — honest
    const model = await runtime.sources.refresh();
    expect(model.sources).toHaveLength(1);
    expect(runtime.sources.list()[0]?.connected).toBe(true);

    // an invalid settings section is still R01's typed invalid-target
    const invalid = runtime.navigation.navigate({
      surface: "settings",
      section: "privacy" as never,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toBe("invalid-target");
  });

  it("observed post-flow transitions ride the shared runtime surface", () => {
    const server = new InMemoryServerPort();
    const runtime = boot(server);

    runtime.sources.observe(makeSource({ authState: "authorizing" }));
    runtime.sources.observe(makeSource({ authState: "signedIn", connected: true }));
    expect(runtime.sources.list()[0]?.authState).toBe("signedIn");
  });
});
