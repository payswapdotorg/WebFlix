/**
 * @wfx/client-runtime — R02 profile-scoped runtime tests.
 *
 * The spec's acceptance points, at the runtime layer:
 * - `RuntimeContext.profileId` (the active profile): accepted when sane,
 *   typed `invalid-input` when garbage;
 * - the ServerPort doubles honor the profile-aware reads (scripting,
 *   defaults, typed failures, write logs);
 * - the LIBRARY READ MODEL hydrates profile-scoped server data:
 *   cross-device history + saves surface in the model, the session fold
 *   wins per item, and a failing server read is an ERROR section (never a
 *   fake empty one).
 */

import { describe, expect, it } from "bun:test";

import {
  FixedClock,
  InMemoryServerPort,
  LibraryEngine,
  CanonicalItemRegistry,
  WatchStateEngine,
  createRuntime,
  makeWebCapabilities,
  RuntimeError,
} from "../src/index";
import type { RuntimeContext } from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const CONTEXT: RuntimeContext = {
  userId: "user-1",
  sessionId: "sess-1",
  locale: "en",
  profileId: "wfxprof_00000000000000000000000001",
};

const ids = { next: () => "00000000000000000000000001" };

function setup() {
  const server = new InMemoryServerPort();
  const registry = new CanonicalItemRegistry(ids);
  const watch = new WatchStateEngine(server, CONTEXT, new FixedClock(T0), ids);
  const library = new LibraryEngine(server, registry, watch, new FixedClock(T0));
  const item = registry.register({
    connectorId: "test-source",
    externalRef: "ref-1",
    title: "Cozy Movie",
    canonicalType: "movie",
    durationMs: 100_000,
  });
  return { server, registry, watch, library, itemId: item.id };
}

// ---------------------------------------------------------------------------
// RuntimeContext.profileId — validation
// ---------------------------------------------------------------------------

describe("RuntimeContext.profileId (the active profile)", () => {
  function boot(context: RuntimeContext) {
    const platform = makeWebCapabilities();
    const server = new InMemoryServerPort();
    return createRuntime(platform, server, {
      context,
      clock: new FixedClock(T0),
      ids,
    });
  }

  it("boots with a profile id and keeps anonymous sessions bootable", () => {
    const withProfile = boot(CONTEXT);
    expect(withProfile.platform).toBe("web");
    const anonymous = boot({ userId: "user-1", sessionId: "sess-1", locale: "en" });
    expect(anonymous.platform).toBe("web");
  });

  it("refuses a garbage profile id with the typed invalid-input", () => {
    let caught: unknown;
    try {
      boot({
        userId: "user-1",
        sessionId: "sess-1",
        locale: "en",
        profileId: "",
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).kind).toBe("invalid-input");
    expect((caught as RuntimeError).message).toContain("profileId");
  });
});

// ---------------------------------------------------------------------------
// The profile-aware ServerPort doubles (the contract reference)
// ---------------------------------------------------------------------------

describe("InMemoryServerPort — the R02 profile-aware reads", () => {
  it("answers scripted history/library/intents/policy verbatim, empty/null defaults otherwise", async () => {
    const server = new InMemoryServerPort();
    server.scriptHistoryRead({
      ok: true,
      value: [
        {
          itemId: "wfxitm_00000000000000000000000009",
          positionMs: 5_000,
          completed: false,
          lastEventType: "progress",
          updatedAt: new Date(T0).toISOString(),
        },
      ],
    });
    const history = await server.readHistory();
    expect(history.ok).toBe(true);
    if (history.ok) expect(history.value.length).toBe(1);

    const unscriptedHistory = await server.readHistory();
    expect(unscriptedHistory.ok).toBe(true);
    if (unscriptedHistory.ok) expect(unscriptedHistory.value).toEqual([]);

    server.scriptProfileLibraryRead({
      ok: true,
      value: [{ connectorId: "test-source", externalRef: "ref-9", title: "Cross-Device Save" }],
    });
    const profileLibrary = await server.readProfileLibrary();
    expect(profileLibrary.ok).toBe(true);
    if (profileLibrary.ok) expect(profileLibrary.value.length).toBe(1);
    const unscriptedLibrary = await server.readProfileLibrary();
    expect(unscriptedLibrary.ok).toBe(true);
    if (unscriptedLibrary.ok) expect(unscriptedLibrary.value).toEqual([]);

    const policy = await server.readPolicy();
    expect(policy.ok).toBe(true);
    if (policy.ok) expect(policy.value).toBeNull();

    const intents = await server.readIntents();
    expect(intents.ok).toBe(true);
    if (intents.ok) expect(intents.value).toEqual([]);
  });

  it("carries typed failures through the profile-aware channel and logs writes", async () => {
    const server = new InMemoryServerPort();
    server.scriptHistoryRead({ ok: false, failure: { kind: "network", detail: "offline" } });
    const failed = await server.readHistory();
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.failure.kind).toBe("network");
      expect(failed.failure.detail).toBe("offline");
    }

    const intentCommand = { objective: "cozy-comedy-tonight", scope: "session" as const };
    const written = await server.writeIntent(intentCommand);
    expect(written.ok).toBe(true);
    expect(server.intentWrites).toEqual([intentCommand]);

    server.scriptIntentWrite({ ok: false, failure: { kind: "unauthorized", detail: "401" } });
    const rejected = await server.writeIntent(intentCommand);
    expect(rejected.ok).toBe(false);
    expect(server.intentWrites.length).toBe(2); // the attempt is logged either way

    const policyCommand = { attentionMode: "mindful" as const, exploration: 0.2 };
    const policyWritten = await server.writePolicy(policyCommand);
    expect(policyWritten.ok).toBe(true);
    expect(server.policyWrites).toEqual([policyCommand]);
  });
});

// ---------------------------------------------------------------------------
// The profile-scoped library/history read models (the R02 merge)
// ---------------------------------------------------------------------------

describe("the library read model hydrates profile-scoped server data", () => {
  it("server history entries surface in the history section (cross-device)", async () => {
    const { server, library } = setup();
    server.scriptHistoryRead({
      ok: true,
      value: [
        {
          itemId: "wfxitm_00000000000000000000000007",
          positionMs: 42_000,
          completed: false,
          lastEventType: "progress",
          updatedAt: new Date(T0 - 60_000).toISOString(),
        },
        {
          itemId: "wfxitm_00000000000000000000000008",
          positionMs: 9_999,
          completed: true,
          lastEventType: "complete",
          updatedAt: new Date(T0 - 120_000).toISOString(),
        },
      ],
    });
    const model = await library.read();
    expect(model.history.status.state).toBe("ready");
    expect(model.history.entries.length).toBe(2);
    const first = model.history.entries[0];
    expect(first?.itemId).toBe("wfxitm_00000000000000000000000007");
    expect(first?.watch.lastPositionMs).toBe(42_000);
    expect(first?.watch.status).toBe("in-progress");
    expect(first?.watch.completionRatio).toBeNull();
    const second = model.history.entries[1];
    expect(second?.watch.status).toBe("completed");
    expect(second?.watch.completionRatio).toBe(1);
    // Honest titles: unregistered server items keep their id (never a
    // fabricated name).
    expect(second?.title).toBe("wfxitm_00000000000000000000000008");
  });

  it("the session fold WINS per item; server entries only fill the gaps", async () => {
    const { server, library, watch, itemId } = setup();
    await watch.apply({ kind: "progress", itemId, positionMs: 30_000 });
    server.scriptHistoryRead({
      ok: true,
      value: [
        {
          itemId, // the SAME item the session just watched
          positionMs: 1_000, // a STALE server position
          completed: true,
          lastEventType: "complete",
          updatedAt: new Date(T0 - 3_600_000).toISOString(),
        },
        {
          itemId: "wfxitm_00000000000000000000000011",
          positionMs: 5_000,
          completed: false,
          lastEventType: "progress",
          updatedAt: new Date(T0 + 60_000).toISOString(),
        },
      ],
    });
    const model = await library.read();
    expect(model.history.entries.length).toBe(2);
    const sessionEntry = model.history.entries.find((entry) => entry.itemId === itemId);
    expect(sessionEntry?.watch.lastPositionMs).toBe(30_000); // session evidence
    expect(sessionEntry?.watch.status).toBe("in-progress");
    const serverEntry = model.history.entries.find(
      (entry) => entry.itemId === "wfxitm_00000000000000000000000011",
    );
    expect(serverEntry?.watch.lastPositionMs).toBe(5_000);
    // Most recently watched first (deterministic order; equal timestamps
    // fall back to itemId ascending).
    expect(model.history.entries[0]?.itemId).toBe("wfxitm_00000000000000000000000011");
  });

  it("server profile-library saves surface in the watchlist (cross-device)", async () => {
    const { server, library } = setup();
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-remote",
          title: "Saved On Another Device",
          addedAt: new Date(T0 - 86_400_000).toISOString(),
          metadata: { list: "Watch with dad" },
        },
      ],
    });
    const model = await library.read();
    expect(model.watchlist.status.state).toBe("ready");
    expect(model.watchlist.entries.length).toBe(1);
    const entry = model.watchlist.entries[0];
    expect(entry?.title).toBe("Saved On Another Device");
    expect(entry?.listName).toBe("Watch with dad");
    expect(entry?.sync).toBe("synced");
  });

  it("local watchlist entries are NOT duplicated by server mirrors", async () => {
    const { server, library, itemId } = setup();
    await library.operations().save({ itemId });
    // The server mirrors the SAME source key the local save wrote through.
    server.scriptProfileLibraryRead({
      ok: true,
      value: [{ connectorId: "test-source", externalRef: "ref-1", title: "Cozy Movie" }],
    });
    const model = await library.read();
    expect(model.watchlist.entries.length).toBe(1);
    expect(model.watchlist.entries[0]?.itemId).toBe(itemId);
    expect(model.watchlist.entries[0]?.sync).toBe("synced"); // the local save settled
  });

  it("a failing profile-scoped read is an ERROR section, never a fake empty one", async () => {
    const { server, library, watch, itemId } = setup();
    await watch.apply({ kind: "progress", itemId, positionMs: 30_000 });
    server.scriptHistoryRead({ ok: false, failure: { kind: "network", detail: "offline" } });
    server.scriptProfileLibraryRead({
      ok: false,
      failure: { kind: "unavailable", detail: "503" },
    });
    const model = await library.read();
    expect(model.history.status.state).toBe("error");
    expect(model.history.status.errorDetail).toContain("network");
    // The session fold still renders (local truth survives the outage).
    expect(model.history.entries.length).toBe(1);
    expect(model.watchlist.status.state).toBe("error");
    expect(model.watchlist.status.errorDetail).toContain("unavailable");
  });

  it("section inclusion skips the corresponding server reads", async () => {
    const { server, library } = setup();
    const model = await library.read({ includeHistory: false });
    expect(model.history.status.state).toBe("ready");
    expect(model.history.entries).toEqual([]);
    // readHistory was never consulted (unscripted would answer empty —
    // assert via a scripted FAILURE that must NOT surface).
    server.scriptHistoryRead({ ok: false, failure: { kind: "network", detail: "offline" } });
    const model2 = await library.read({ includeHistory: false });
    expect(model2.history.status.state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// The full runtime boots and reads profile-scoped models end-to-end
// ---------------------------------------------------------------------------

describe("createRuntime — profile-scoped read models end-to-end", () => {
  it("library() hydrates the profile-scoped sections through the injected port", async () => {
    const platform = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptHistoryRead({
      ok: true,
      value: [
        {
          itemId: "wfxitm_00000000000000000000000021",
          positionMs: 7_777,
          completed: false,
          lastEventType: "progress",
          updatedAt: new Date(T0).toISOString(),
        },
      ],
    });
    const runtime = createRuntime(platform, server, {
      context: CONTEXT,
      clock: new FixedClock(T0),
      ids,
    });
    const model = await runtime.library();
    expect(model.history.status.state).toBe("ready");
    expect(model.history.entries.length).toBe(1);
    expect(model.history.entries[0]?.itemId).toBe("wfxitm_00000000000000000000000021");
    expect(model.history.entries[0]?.watch.lastPositionMs).toBe(7_777);
    expect(model.watchlist.status.state).toBe("ready");
    expect(model.watchlist.entries).toEqual([]);
  });
});
