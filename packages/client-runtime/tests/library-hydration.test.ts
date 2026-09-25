/**
 * @wfx/client-runtime — R30 reload-durability hydration tests.
 *
 * The R29 production sweep's ONE LOUD FINDING (DIVERGENCES.md #1): the
 * library WRITE path was real and durable server-side, but the watch
 * surface never hydrated it on a fresh load — the client runtime's
 * per-load watchlist map was empty, so a fresh-load unsubscribe answered
 * `not-found` ("not in the local watchlist") and the Subscribe pill
 * rendered idle against the stored truth.
 *
 * Acceptance points (the R30 seam):
 * - `hydrate()` seeds the local watchlist fold from the server's stored
 *   profile library (the same read the library read model merges), with
 *   the R04 canonical-id adoption for rows that carry one;
 * - the WRITE paths hydrate implicitly BEFORE consulting the fold, so a
 *   remove on a fresh engine FINDS the stored item (the fresh-load
 *   unsubscribe);
 * - local-first: a local entry wins over the server mirror (no
 *   duplicates, the local sync state kept);
 * - honest degradation: a failing server read seeds NOTHING (the local
 *   fold survives; a later call retries after the failure);
 * - the hydration is memoized: ONE server read per engine (successful),
 *   retried only after a failure.
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

describe("R30 — the reload-durability hydration", () => {
  it("hydrate() seeds the fold from the stored profile library (the R04 canonical-id adoption)", async () => {
    const { server, library } = setup();
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-stored",
          title: "Stored On The Service",
          addedAt: new Date(T0 - 60_000).toISOString(),
          metadata: {
            canonicalItemId: "wfxitm_00000000000000000000000041",
            list: "Subscriptions",
          },
        },
      ],
    });
    await library.operations().hydrate();
    const entries = library.operations().entries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.itemId).toBe("wfxitm_00000000000000000000000041");
    expect(entries[0]?.title).toBe("Stored On The Service");
    expect(entries[0]?.listName).toBe("Subscriptions");
    expect(entries[0]?.sync).toBe("synced"); // server-sourced: present at the source
  });

  it("THE FRESH-LOAD UNSUBSCRIBE: a remove on a fresh engine finds the STORED item (the sweep's divergence #1 closed)", async () => {
    const { server, library } = setup();
    // The stored truth (written by an EARLIER session — the fresh engine's
    // local fold starts empty, exactly like a fresh watch-page load).
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-stored",
          title: "Stored On The Service",
          metadata: {
            canonicalItemId: "wfxitm_00000000000000000000000041",
            list: "Subscriptions",
          },
        },
      ],
    });
    server.scriptLibraryWrite({
      ok: true,
      value: { status: "confirmed", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    // No hydrate() call: the write path hydrates IMPLICITLY (the caller
    // law is honored even when the caller forgets).
    const result = await library.operations().remove("wfxitm_00000000000000000000000041");
    expect(result.ok).toBe(true);
    // The fold is empty after the removal — the round trip closed.
    expect(library.operations().entries().length).toBe(0);
  });

  it("local-first: a local entry wins over the server mirror (no duplicates, the local sync state kept)", async () => {
    const { server, library, itemId } = (function () {
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
    await library.operations().save({ itemId, listName: "Subscriptions" });
    // The server mirrors the SAME source key (the cross-session view).
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-1",
          title: "Cozy Movie",
          metadata: { list: "Subscriptions" },
        },
      ],
    });
    await library.operations().hydrate();
    const entries = library.operations().entries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.itemId).toBe(itemId);
    expect(entries[0]?.sync).toBe("synced"); // the local save settled
  });

  it("honest degradation: a failing read seeds NOTHING; a later call retries", async () => {
    const { server, library } = setup();
    server.scriptProfileLibraryRead({
      ok: false,
      failure: { kind: "network", detail: "offline" },
    });
    await library.operations().hydrate();
    expect(library.operations().entries().length).toBe(0); // never a fabricated row
    // The failed attempt is NOT memoized: the retry consumes the next
    // answer (a successful read now seeds the fold).
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-after-outage",
          title: "Back Online",
          metadata: { list: "Subscriptions" },
        },
      ],
    });
    await library.operations().hydrate();
    const entries = library.operations().entries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.title).toBe("Back Online");
  });

  it("the hydration is memoized: ONE server read per engine (successful)", async () => {
    const { server, library } = setup();
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-first",
          title: "First Read",
          metadata: { list: "Subscriptions" },
        },
      ],
    });
    server.scriptProfileLibraryRead({
      ok: true,
      value: [
        {
          connectorId: "test-source",
          externalRef: "ref-second",
          title: "Second Read (must never be consumed)",
          metadata: { list: "Subscriptions" },
        },
      ],
    });
    await library.operations().hydrate();
    await library.operations().hydrate();
    const titles = library.operations().entries().map((entry) => entry.title);
    expect(titles).toEqual(["First Read"]);
  });

  it("an unsaved item still answers the typed refusal (never a fabricated removal)", async () => {
    const { server, library } = setup();
    // The stored truth does NOT contain this item.
    server.scriptProfileLibraryRead({ ok: true, value: [] });
    const result = await library.operations().remove("wfxitm_00000000000000000000000099");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("not-found");
      expect(result.detail).toContain("not in the local watchlist");
    }
  });
});
