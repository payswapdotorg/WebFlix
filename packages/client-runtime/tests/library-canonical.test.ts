/**
 * @wfx/client-runtime — R04 server-id adoption tests.
 *
 * Acceptance points:
 * - SERVER-PROVIDED CANONICAL IDS WIN: when the server's library/history
 *   answers carry canonical item ids (`ProfileHistoryEntry.itemId` directly;
 *   `LibraryEntry.metadata.canonicalItemId` on library rows), the registry
 *   ADOPTS them (durable, cross-session). The locally-minted id reconciles
 *   to the server id.
 * - THE LOCAL-FIRST FOLD STAYS INTACT: local saves render immediately; the
 *   server merge reconciles ids on the next read.
 * - TITLE LAW: when a real title is already registered (e.g. from a search
 *   hit), the registry KEEPS it — the history fold's placeholder (the
 *   itemId itself) never overwrites a real title.
 */

import { describe, expect, it } from "bun:test";

import {
  CanonicalItemRegistry,
  FixedClock,
  InMemoryServerPort,
  LibraryEngine,
  WatchStateEngine,
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
  return { server, registry, watch, library };
}

describe("R04 — durable server-sourced canonical ids", () => {
  it("registry.reconcileBySourceKey ADOPTS the server id over the locally-minted id", () => {
    const { registry } = setup();
    // Local registration mints an id.
    const local = registry.register({
      connectorId: "test-source",
      externalRef: "ref-1",
      title: "Cozy Movie",
    });
    const localId = local.id;
    expect(registry.has(localId)).toBe(true);

    // The server later returns the canonical id for the same source key.
    // (This is the cross-device case — the server's library/history rows
    // carry the durable canonical id, and the registry reconciles.)
    const serverId = "wfxitm_00000000000000000000000007";
    const reconciled = registry.reconcileBySourceKey(
      "test-source",
      "ref-1",
      serverId,
      "Cozy Movie",
    );
    expect(reconciled.id).toBe(serverId);
    // The locally-minted id is REMOVED from the byItemId view.
    expect(registry.has(localId)).toBe(false);
    expect(registry.has(serverId)).toBe(true);
    // The source-keyed view now resolves to the server id.
    const looked = registry.get(serverId);
    expect(looked?.connectorId).toBe("test-source");
    expect(looked?.externalRef).toBe("ref-1");
  });

  it("registry.registerCanonical ADOPTS the server id with the itemId as the placeholder title", () => {
    const { registry } = setup();
    const serverId = "wfxitm_00000000000000000000000009";
    const item = registry.registerCanonical(serverId, serverId);
    expect(item.id).toBe(serverId);
    expect(item.canonicalTitle).toBe(serverId); // honest placeholder
    expect(registry.has(serverId)).toBe(true);
  });

  it("TITLE LAW: registerCanonical does NOT overwrite a real title from a search hit", () => {
    const serverId = "wfxitm_00000000000000000000000011";
    // First register the item via reconcileBySourceKey (which uses the
    // server id) with a REAL title.
    const reg = new CanonicalItemRegistry(ids);
    reg.reconcileBySourceKey("test-source", "ref-11", serverId, "Asteroid Drift");
    // The title is "Asteroid Drift".
    expect(reg.get(serverId)?.title).toBe("Asteroid Drift");
    // The history fold calls registerCanonical(serverId, serverId) — the
    // placeholder must NOT overwrite the real title.
    reg.registerCanonical(serverId, serverId);
    expect(reg.get(serverId)?.title).toBe("Asteroid Drift"); // unchanged
  });

  it("the library read model ADOPTS server-sourced canonical ids for history entries", async () => {
    const { server, library } = setup();
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
    const model = await library.read();
    expect(model.history.entries.length).toBe(1);
    expect(model.history.entries[0]?.itemId).toBe("wfxitm_00000000000000000000000021");
    // The registry ADOPTED the server-sourced id (durable, cross-session).
    expect(library["registry"].has("wfxitm_00000000000000000000000021")).toBe(true);
  });

  it("the library read model ADOPTS server-sourced canonical ids for watchlist entries (via metadata.canonicalItemId)", async () => {
    const { server, library } = setup();
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-remote",
          title: "Saved On Another Device",
          metadata: {
            canonicalItemId: "wfxitm_00000000000000000000000031",
            list: "Watch with dad",
          },
        },
      ],
    });
    const model = await library.read();
    expect(model.watchlist.entries.length).toBe(1);
    expect(model.watchlist.entries[0]?.itemId).toBe(
      "wfxitm_00000000000000000000000031",
    );
    expect(model.watchlist.entries[0]?.title).toBe("Saved On Another Device");
    expect(model.watchlist.entries[0]?.listName).toBe("Watch with dad");
    expect(model.watchlist.entries[0]?.sync).toBe("synced");
  });

  it("THE LOCAL-FIRST FOLD: local saves render immediately; the server merge reconciles", async () => {
    const { server, library, registry, itemId } = (function () {
      const s = setup();
      const item = s.registry.register({
        connectorId: "test-source",
        externalRef: "ref-1",
        title: "Cozy Movie",
      });
      return { ...s, itemId: item.id };
    })();
    server.scriptLibraryWrite({
      ok: true,
      value: { status: "confirmed", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    // Local save renders immediately (pending → synced).
    const result = await library.operations().save({ itemId });
    expect(result.ok).toBe(true);
    expect(library.operations().entries().length).toBe(1);
    expect(library.operations().entries()[0]?.sync).toBe("synced");

    // The server's library read returns the SAME item — the local-first
    // fold does NOT duplicate it.
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-1",
          title: "Cozy Movie",
          metadata: { canonicalItemId: itemId },
        },
      ],
    });
    const model = await library.read();
    expect(model.watchlist.entries.length).toBe(1);
    expect(model.watchlist.entries[0]?.itemId).toBe(itemId);
    expect(model.watchlist.entries[0]?.sync).toBe("synced");
    // The registry reconciled the server id to the local id (they match
    // because the local id IS the server id in this test).
    expect(registry.has(itemId)).toBe(true);
  });
});
