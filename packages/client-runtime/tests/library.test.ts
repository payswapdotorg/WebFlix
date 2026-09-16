/**
 * @wfx/client-runtime — library semantics tests (R01).
 *
 * Canonical-keyed saves, honest sync states, watchlist vs history, and the
 * unknown-item law (no fake saves).
 */

import { describe, expect, it } from "bun:test";

import {
  FixedClock,
  InMemoryServerPort,
  LibraryEngine,
  CanonicalItemRegistry,
  WatchStateEngine,
  receiptToLibrarySync,
} from "../src/index";
import type { RuntimeContext } from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const CONTEXT: RuntimeContext = { userId: "user-1", sessionId: "sess-1", locale: "en" };

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

describe("canonical-keyed saves", () => {
  it("saves locally first (pending), then settles synced on a confirmed receipt", async () => {
    const { server, library, itemId } = setup();
    server.scriptLibraryWrite({
      ok: true,
      value: { status: "confirmed", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    const states: string[] = [];
    library.operations().subscribe((entries) => {
      states.push(entries[entries.length - 1]?.sync ?? "none");
    });
    const result = await library.operations().save({ itemId });
    expect(result.ok).toBe(true);
    // The subscribe stream saw pending then synced (local-first honesty).
    expect(states[0]).toBe("pending");
    expect(states[states.length - 1]).toBe("synced");
    const entry = library.operations().entries()[0];
    expect(entry?.itemId).toBe(itemId);
    expect(entry?.title).toBe("Cozy Movie");
    expect(entry?.listName).toBe("Saved"); // the default list
  });

  it("files saves under the requested list name", async () => {
    const { library, itemId } = setup();
    const result = await library.operations().save({ itemId, listName: "Watch with dad" });
    expect(result.ok).toBe(true);
    expect(library.operations().entries()[0]?.listName).toBe("Watch with dad");
  });

  it("UNKNOWN ITEMS CANNOT BE SAVED (typed not-found — no fake local-only save)", async () => {
    const { library } = setup();
    const result = await library.operations().save({
      itemId: "wfxitm_00000000000000000000000099",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("not-found");
      expect(result.detail).toContain("no known source realization");
    }
    expect(library.operations().entries()).toEqual([]);
  });

  it("a local-only receipt settles 'conflict' (recorded without external confirmation)", async () => {
    const { server, library, itemId } = setup();
    server.scriptLibraryWrite({
      ok: true,
      value: { status: "local-only", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    const result = await library.operations().save({ itemId });
    expect(result.ok).toBe(true);
    expect(library.operations().entries()[0]?.sync).toBe("conflict");
  });

  it("a transport failure settles the entry 'failed' and reports the typed kind", async () => {
    const { server, library, itemId } = setup();
    server.scriptLibraryWrite({ ok: false, failure: { kind: "unauthorized", detail: "401" } });
    const result = await library.operations().save({ itemId });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthorized");
    }
    // The local entry remains with the honest failed sync state.
    expect(library.operations().entries()[0]?.sync).toBe("failed");
    expect(library.operations().entries()[0]?.detail).toContain("401");
  });

  it("an unsupported receipt settles 'unsupported' — never rendered as success", async () => {
    const { server, library, itemId } = setup();
    server.scriptLibraryWrite({
      ok: true,
      value: { status: "unsupported", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    const result = await library.operations().save({ itemId });
    expect(result.ok).toBe(true);
    expect(library.operations().entries()[0]?.sync).toBe("unsupported");
  });
});

describe("removes (honest, never silent drops)", () => {
  it("removes a synced save end-to-end", async () => {
    const { library, itemId } = setup();
    await library.operations().save({ itemId });
    const result = await library.operations().remove(itemId);
    expect(result.ok).toBe(true);
    expect(library.operations().entries()).toEqual([]);
  });

  it("keeps the local entry when the remote remove settles unsupported", async () => {
    const { server, library, itemId } = setup();
    await library.operations().save({ itemId });
    server.scriptLibraryWrite({
      ok: true,
      value: { status: "unsupported", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    const result = await library.operations().remove(itemId);
    expect(result.ok).toBe(false);
    expect(library.operations().entries()[0]?.sync).toBe("unsupported");
  });

  it("removing an unsaved item answers the typed not-found", async () => {
    const { library } = setup();
    const result = await library.operations().remove("wfxitm_00000000000000000000000098");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-found");
  });
});

describe("the read model (watchlist + history, canonical-keyed)", () => {
  it("history entries are the watch-state fold joined to canonical titles", async () => {
    const { library, watch, itemId } = setup();
    await watch.apply({ kind: "progress", itemId, positionMs: 30_000 });
    const model = await library.read();
    expect(model.watchlist.status.state).toBe("ready");
    expect(model.watchlist.entries).toEqual([]);
    expect(model.history.status.state).toBe("ready");
    expect(model.history.entries).toHaveLength(1);
    expect(model.history.entries[0]?.itemId).toBe(itemId);
    expect(model.history.entries[0]?.title).toBe("Cozy Movie");
    expect(model.history.entries[0]?.watch.status).toBe("in-progress");
  });

  it("section inclusion filters the model", async () => {
    const { library, itemId } = setup();
    await library.operations().save({ itemId });
    const model = await library.read({ includeHistory: false });
    expect(model.watchlist.entries).toHaveLength(1);
    expect(model.history.entries).toEqual([]);
  });

  it("the receipt mapping covers every frozen status", () => {
    expect(receiptToLibrarySync({ status: "confirmed", occurredAt: "x" }).sync).toBe("synced");
    expect(receiptToLibrarySync({ status: "local-only", occurredAt: "x" }).sync).toBe("conflict");
    expect(receiptToLibrarySync({ status: "unsupported", occurredAt: "x" }).sync).toBe("unsupported");
    expect(receiptToLibrarySync({ status: "failed", occurredAt: "x" }).sync).toBe("failed");
  });
});
