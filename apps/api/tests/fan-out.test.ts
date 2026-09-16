/**
 * WFX-055A fan-out connector tests (bun:test).
 *
 * Pins `createFanOutConnector` — the app-level multi-source composition
 * behind the single `Ports.connector` seam — over HAND-WRITTEN fake
 * sources (ConnectorPort stubs) with an injected fake clock:
 *
 * - search merge determinism (SOURCE order, not completion order),
 *   first-wins dedupe by externalRef, and single-source degradation
 *   (a throwing source contributes nothing and is recorded in
 *   `lastDegradations`, never taking down the merge);
 * - metadata/resolve sequential probe order (primary first, fall-through
 *   on empty/throw);
 * - executeAction routing (exact source id / service-id probe order /
 *   unknown id failed receipt naming the wired sources / unsupported
 *   capability when the union lacks it);
 * - writeLibrary probe (first non-failed wins; all-failed carries every
 *   detail) and readLibrary merge/dedupe;
 * - the honest union descriptor (union of wired, canonical order, auth
 *   none, the service binding id).
 *
 * Determinism: FixedClock + hand-written stubs; the only delay is a fixed
 * timer that forces async COMPLETION order (never asserted against
 * wall-clock time). No network, no database.
 */

import { describe, expect, it } from "bun:test";

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { isUsableReceipt, type Clock, type ConnectorPort } from "@wfx/experience";

import {
  createFanOutConnector,
  EXPERIENCE_SERVICE_CONNECTOR_ID,
} from "../src/host/fan-out";

const CLOCK = { now: () => 1_800_000_000_000 } as Clock;
const CTX: ConnectorContext = { userId: "wfx-fanout-test-user", locale: "en" };

/** Fixed timer that forces a source to complete LATER than its peers. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything one fake source recorded (probe-order proofs). */
interface SourceCalls {
  search: string[];
  metadata: string[];
  resolve: string[];
  executeAction: UserAction[];
  readLibrary: number;
  writeLibrary: LibraryCommand[];
}

interface FakeSourceOptions {
  readonly id: string;
  readonly capabilities?: readonly Capability[];
  /** Applied inside search — forces slower completion. */
  readonly searchDelayMs?: number;
  readonly searchHits?: SearchResult[];
  readonly throwOnSearch?: Error;
  readonly metadataItem?: SourceItem | null;
  readonly throwOnMetadata?: Error;
  readonly realizations?: PlaybackRealization[];
  readonly actionReceipt?: ActionReceipt;
  readonly throwOnExecuteAction?: Error;
  readonly libraryEntries?: LibraryEntry[];
  readonly throwOnReadLibrary?: Error;
  readonly writeLibraryReceipt?: ActionReceipt;
  readonly throwOnWriteLibrary?: Error;
  /** Include the optional readLibrary/writeLibrary methods (default true). */
  readonly withLibrary?: boolean;
}

function makeFakeSource(options: FakeSourceOptions): ConnectorPort & { readonly calls: SourceCalls } {
  const calls: SourceCalls = {
    search: [],
    metadata: [],
    resolve: [],
    executeAction: [],
    readLibrary: 0,
    writeLibrary: [],
  };
  const capabilities = options.capabilities ?? [
    "catalogSearch",
    "metadata",
    "playEmbed",
    "libraryRead",
    "libraryWrite",
    "like",
    "save",
  ];
  const connector: ConnectorPort = {
    descriptor: () => ({
      id: options.id,
      version: "1.0.0",
      displayName: `Fake ${options.id}`,
      capabilities: [...capabilities],
      auth: "none",
    }),
    async search(_ctx, query) {
      calls.search.push(query);
      if (options.searchDelayMs !== undefined) await delay(options.searchDelayMs);
      if (options.throwOnSearch !== undefined) throw options.throwOnSearch;
      return [...(options.searchHits ?? [])];
    },
    async metadata(_ctx, ref) {
      calls.metadata.push(ref);
      if (options.throwOnMetadata !== undefined) throw options.throwOnMetadata;
      return options.metadataItem ?? null;
    },
    async resolve(_ctx, ref) {
      calls.resolve.push(ref);
      return [...(options.realizations ?? [])];
    },
    async executeAction(_ctx, action) {
      calls.executeAction.push(action);
      if (options.throwOnExecuteAction !== undefined) throw options.throwOnExecuteAction;
      return options.actionReceipt ?? { status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" };
    },
  };
  if (options.withLibrary !== false) {
    connector.readLibrary = async () => {
      calls.readLibrary += 1;
      if (options.throwOnReadLibrary !== undefined) throw options.throwOnReadLibrary;
      return [...(options.libraryEntries ?? [])];
    };
    connector.writeLibrary = async (_ctx, command) => {
      calls.writeLibrary.push(command);
      if (options.throwOnWriteLibrary !== undefined) throw options.throwOnWriteLibrary;
      return (
        options.writeLibraryReceipt ?? {
          status: "confirmed",
          occurredAt: "2026-09-16T00:00:00.000Z",
        }
      );
    };
  }
  return Object.assign(connector, { calls });
}

function hit(externalRef: string, title: string): SearchResult {
  return { connectorId: "unused-source-id", externalRef, title };
}

function entry(externalRef: string, title: string): LibraryEntry {
  return { connectorId: "unused-source-id", externalRef, title };
}

function realization(externalRef: string): PlaybackRealization {
  return {
    mode: "embed",
    connectorId: "unused-source-id",
    url: `https://example.com/embed/${externalRef}`,
    externalRef,
    capabilities: ["playEmbed"],
  };
}

describe("createFanOutConnector — construction + the honest union descriptor", () => {
  it("refuses an empty source list loudly (the primary is always wired)", () => {
    let caught: unknown;
    try {
      createFanOutConnector({ sources: [], clock: CLOCK });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("at least one source");
  });

  it("declares the UNION of wired capabilities in canonical order, as the service binding, auth none", () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      capabilities: ["catalogSearch", "metadata", "playEmbed", "libraryRead", "libraryWrite", "like", "save"],
    });
    const secondary = makeFakeSource({
      id: "youtube",
      capabilities: ["catalogSearch", "playExternal", "comment", "metadata"],
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK, version: "9.9.9" });

    const descriptor = fanOut.descriptor();
    expect(descriptor.id).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);
    expect(descriptor.id).toBe("wfx-experience-service");
    expect(descriptor.version).toBe("9.9.9");
    expect(descriptor.auth).toBe("none");
    expect(descriptor.displayName).toContain("webflix-catalog");
    expect(descriptor.displayName).toContain("youtube");
    // Canonical order: exactly the union, no duplicates, nothing undeclared.
    expect(descriptor.capabilities).toEqual([
      "catalogSearch",
      "metadata",
      "playEmbed",
      "playExternal",
      "libraryRead",
      "libraryWrite",
      "like",
      "save",
      "comment",
    ]);
    // A capability NO wired source declares is never in the union.
    expect(descriptor.capabilities).not.toContain("follow");
    expect(descriptor.capabilities).not.toContain("download");
    expect(descriptor.capabilities).not.toContain("transform");
    expect(fanOut.sourceIds).toEqual(["webflix-catalog", "youtube"]);
  });
});

describe("fan-out search — merge laws", () => {
  it("merges in SOURCE order, not completion order (the slower primary still comes first)", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      searchDelayMs: 25, // completes AFTER the secondary
      searchHits: [hit("cat:primary", "Primary Hit")],
    });
    const secondary = makeFakeSource({
      id: "youtube",
      searchHits: [hit("yt:secondary", "Secondary Hit")],
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const merged = await fanOut.search(CTX, "q");
    expect(merged.map((value) => value.title)).toEqual(["Primary Hit", "Secondary Hit"]);
    // Every answer is rewritten to the service binding id.
    for (const value of merged) {
      expect(value.connectorId).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);
    }
  });

  it("dedupes by externalRef, first-wins in probe order, and skips hits without a usable ref", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      searchHits: [hit("shared-ref", "Primary Version"), hit("cat:only-primary", "Primary Only")],
    });
    const secondary = makeFakeSource({
      id: "youtube",
      searchHits: [
        hit("shared-ref", "Secondary Version"),
        { title: "No Ref At All" } as unknown as SearchResult,
        hit("yt:only-secondary", "Secondary Only"),
      ],
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const merged = await fanOut.search(CTX, "q");
    expect(merged.map((value) => [value.externalRef, value.title])).toEqual([
      ["shared-ref", "Primary Version"],
      ["cat:only-primary", "Primary Only"],
      ["yt:only-secondary", "Secondary Only"],
    ]);
  });

  it("a THROWING source contributes nothing, is recorded in lastDegradations, and never takes down the merge", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog", searchHits: [hit("cat:x", "X")] });
    const secondary = makeFakeSource({
      id: "youtube",
      throwOnSearch: new Error("youtube exploded"),
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const merged = await fanOut.search(CTX, "q");
    expect(merged.map((value) => value.title)).toEqual(["X"]);

    const degradations = fanOut.lastDegradations();
    expect(degradations.get("youtube")).toContain("search");
    expect(degradations.get("youtube")).toContain("youtube exploded");
    expect(degradations.has("webflix-catalog")).toBe(false);
  });

  it("a blank query answers [] without probing any source", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const fanOut = createFanOutConnector({ sources: [primary], clock: CLOCK });
    expect(await fanOut.search(CTX, "   ")).toEqual([]);
    expect(primary.calls.search).toEqual([]);
  });
});

describe("fan-out metadata / resolve — sequential probe order", () => {
  it("metadata: the primary's answer wins and the secondary is never probed", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      metadataItem: {
        connectorId: "webflix-catalog",
        externalRef: "cat:x",
        title: "From Primary",
        availability: "available",
        capabilities: ["playEmbed"],
      },
    });
    const secondary = makeFakeSource({ id: "youtube", metadataItem: { connectorId: "youtube", externalRef: "cat:x", title: "From Secondary", availability: "available", capabilities: [] } });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const item = await fanOut.metadata(CTX, "cat:x");
    expect(item?.title).toBe("From Primary");
    expect(item?.connectorId).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);
    expect(secondary.calls.metadata).toEqual([]);
  });

  it("metadata: a null primary falls through to the secondary; all-null answers null", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog", metadataItem: null });
    const secondary = makeFakeSource({
      id: "youtube",
      metadataItem: { connectorId: "youtube", externalRef: "yt:x", title: "From Secondary", availability: "unknown", capabilities: [] },
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const item = await fanOut.metadata(CTX, "yt:x");
    expect(item?.title).toBe("From Secondary");
    expect(item?.connectorId).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);

    const none = makeFakeSource({ id: "solo" });
    const soloFanOut = createFanOutConnector({ sources: [none], clock: CLOCK });
    expect(await soloFanOut.metadata(CTX, "anything")).toBeNull();
  });

  it("metadata: a THROWING primary degrades to null for that source and the probe continues", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog", throwOnMetadata: new Error("primary down") });
    const secondary = makeFakeSource({
      id: "youtube",
      metadataItem: { connectorId: "youtube", externalRef: "yt:x", title: "Secondary Answer", availability: "available", capabilities: [] },
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const item = await fanOut.metadata(CTX, "yt:x");
    expect(item?.title).toBe("Secondary Answer");
    expect(fanOut.lastDegradations().get("webflix-catalog")).toContain("primary down");
  });

  it("resolve: an empty primary falls through to the secondary's realizations; a non-empty primary wins alone", async () => {
    const emptyPrimary = makeFakeSource({ id: "webflix-catalog", realizations: [] });
    const secondary = makeFakeSource({ id: "youtube", realizations: [realization("yt:x")] });
    const fallThrough = createFanOutConnector({ sources: [emptyPrimary, secondary], clock: CLOCK });

    const fromSecondary = await fallThrough.resolve(CTX, "yt:x");
    expect(fromSecondary).toHaveLength(1);
    expect(fromSecondary[0]?.connectorId).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);
    expect(fromSecondary[0]?.url).toBe("https://example.com/embed/yt:x");

    const fullPrimary = makeFakeSource({ id: "webflix-catalog", realizations: [realization("cat:x")] });
    const unprobedSecondary = makeFakeSource({ id: "youtube", realizations: [realization("yt:x")] });
    const primaryWins = createFanOutConnector({ sources: [fullPrimary, unprobedSecondary], clock: CLOCK });
    const fromPrimary = await primaryWins.resolve(CTX, "cat:x");
    expect(fromPrimary.map((value) => value.externalRef)).toEqual(["cat:x"]);
    expect(unprobedSecondary.calls.resolve).toEqual([]);
  });
});

describe("fan-out executeAction — routing laws", () => {
  it("an exact source-id match routes to that source ALONE, with the action rewritten to its own id", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const secondary = makeFakeSource({ id: "youtube" });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const receipt = await fanOut.executeAction(CTX, {
      type: "like",
      connectorId: "youtube",
      externalRef: "yt:x",
    });
    expect(receipt.status).toBe("confirmed");
    expect(secondary.calls.executeAction).toHaveLength(1);
    expect(secondary.calls.executeAction[0]?.connectorId).toBe("youtube");
    expect(primary.calls.executeAction).toEqual([]);
  });

  it("the service binding id probes in wiring order — the primary answers and the secondary is never probed", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const secondary = makeFakeSource({ id: "youtube" });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const receipt = await fanOut.executeAction(CTX, {
      type: "like",
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: "cat:x",
    });
    expect(receipt.status).toBe("confirmed");
    // The SDK law: the probed source sees ITS OWN id, not the service id.
    expect(primary.calls.executeAction[0]?.connectorId).toBe("webflix-catalog");
    expect(secondary.calls.executeAction).toEqual([]);
  });

  it("the service binding id — a failed primary receipt falls through to the secondary", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      actionReceipt: { status: "failed", detail: "primary could not", occurredAt: "2026-09-16T00:00:00.000Z" },
    });
    const secondary = makeFakeSource({ id: "youtube" });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const receipt = await fanOut.executeAction(CTX, {
      type: "like",
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: "yt:x",
    });
    expect(receipt.status).toBe("confirmed");
    expect(fanOut.lastDegradations().get("webflix-catalog")).toContain("primary could not");
  });

  it("an unknown connector id answers a failed receipt naming the wired sources, probing nobody", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const secondary = makeFakeSource({ id: "youtube" });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const receipt = await fanOut.executeAction(CTX, {
      type: "like",
      connectorId: "someone-else",
      externalRef: "x",
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("someone-else");
    expect(receipt.detail).toContain("webflix-catalog");
    expect(receipt.detail).toContain("youtube");
    expect(isUsableReceipt(receipt)).toBe(true);
    expect(primary.calls.executeAction).toEqual([]);
    expect(secondary.calls.executeAction).toEqual([]);
  });

  it("a capability nobody wires is answered unsupported (the union's capability truth)", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const fanOut = createFanOutConnector({ sources: [primary], clock: CLOCK });

    const receipt = await fanOut.executeAction(CTX, {
      type: "follow",
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: "cat:x",
    });
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toContain("follow");
    expect(receipt.detail).toContain("webflix-catalog");
    expect(primary.calls.executeAction).toEqual([]);
  });

  it("a throwing source degrades to a failed receipt naming it; the merge survives", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      throwOnExecuteAction: new Error("primary action channel down"),
    });
    const secondary = makeFakeSource({
      id: "youtube",
      actionReceipt: { status: "failed", detail: "youtube unauthorized", occurredAt: "2026-09-16T00:00:00.000Z" },
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const receipt = await fanOut.executeAction(CTX, {
      type: "like",
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: "cat:x",
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("primary action channel down");
    expect(receipt.detail).toContain("youtube unauthorized");
    expect(isUsableReceipt(receipt)).toBe(true);
    expect(fanOut.lastDegradations().get("webflix-catalog")).toContain("primary action channel down");
  });

  it("malformed actions answer failed receipts without probing any source", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const fanOut = createFanOutConnector({ sources: [primary], clock: CLOCK });
    const malformed: unknown[] = [
      "not-an-object",
      null,
      { type: "like" }, // no connectorId, no externalRef
      { type: "sideways", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: "x" },
      { type: "like", connectorId: "", externalRef: "x" },
      { type: "like", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: "" },
    ];
    for (const action of malformed) {
      const receipt = await fanOut.executeAction(CTX, action as UserAction);
      expect(receipt.status, `malformed: ${JSON.stringify(action)}`).toBe("failed");
      expect(isUsableReceipt(receipt)).toBe(true);
    }
    expect(primary.calls.executeAction).toEqual([]);
  });
});

describe("fan-out library — read merge + write probe", () => {
  it("readLibrary merges, dedupes first-wins, rewrites ids, and survives a throwing source", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      libraryEntries: [entry("shared", "Primary Copy"), entry("cat:a", "A")],
    });
    const secondary = makeFakeSource({
      id: "youtube",
      libraryEntries: [entry("shared", "Secondary Copy"), entry("yt:b", "B")],
    });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });
    const merged = await fanOut.readLibrary(CTX);
    expect(merged.map((value) => [value.externalRef, value.title])).toEqual([
      ["shared", "Primary Copy"],
      ["cat:a", "A"],
      ["yt:b", "B"],
    ]);
    for (const value of merged) {
      expect(value.connectorId).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);
    }

    const throwing = makeFakeSource({
      id: "youtube",
      libraryEntries: [entry("yt:c", "C")],
      throwOnReadLibrary: new Error("library read blew up"),
    });
    const surviving = makeFakeSource({ id: "webflix-catalog", libraryEntries: [entry("cat:a", "A")] });
    const degraded = createFanOutConnector({ sources: [surviving, throwing], clock: CLOCK });
    expect((await degraded.readLibrary(CTX)).map((value) => value.externalRef)).toEqual(["cat:a"]);
    expect(degraded.lastDegradations().get("youtube")).toContain("library read blew up");
  });

  it("readLibrary: a source without the method contributes empty (absent ⇒ empty)", async () => {
    const noLibrary = makeFakeSource({ id: "bare", withLibrary: false });
    const fanOut = createFanOutConnector({ sources: [noLibrary], clock: CLOCK });
    expect(await fanOut.readLibrary(CTX)).toEqual([]);
  });

  it("writeLibrary: the first non-failed receipt wins and later sources are never probed", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const secondary = makeFakeSource({ id: "youtube" });
    const fanOut = createFanOutConnector({ sources: [primary, secondary], clock: CLOCK });

    const receipt = await fanOut.writeLibrary(CTX, { op: "add", externalRef: "cat:x" });
    expect(receipt.status).toBe("confirmed");
    expect(primary.calls.writeLibrary).toHaveLength(1);
    expect(secondary.calls.writeLibrary).toEqual([]);
  });

  it("writeLibrary: when every source fails, one honest failed receipt carries EVERY detail", async () => {
    const primary = makeFakeSource({
      id: "webflix-catalog",
      writeLibraryReceipt: { status: "failed", detail: "primary write rejected", occurredAt: "2026-09-16T00:00:00.000Z" },
    });
    const secondary = makeFakeSource({
      id: "youtube",
      throwOnWriteLibrary: new Error("youtube write channel exploded"),
    });
    const bare = makeFakeSource({ id: "bare", withLibrary: false });
    const fanOut = createFanOutConnector({ sources: [primary, secondary, bare], clock: CLOCK });

    const receipt = await fanOut.writeLibrary(CTX, { op: "add", externalRef: "cat:x" });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("primary write rejected");
    expect(receipt.detail).toContain("youtube write channel exploded");
    expect(receipt.detail).toContain("writeLibrary not implemented");
    expect(isUsableReceipt(receipt)).toBe(true);
    expect(fanOut.lastDegradations().get("webflix-catalog")).toContain("primary write rejected");
    expect(fanOut.lastDegradations().get("youtube")).toContain("youtube write channel exploded");
  });

  it("writeLibrary: malformed commands answer failed receipts", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const fanOut = createFanOutConnector({ sources: [primary], clock: CLOCK });
    for (const command of [{ op: "rename", externalRef: "x" }, { op: "add" }, "garbage"]) {
      const receipt = await fanOut.writeLibrary(CTX, command as LibraryCommand);
      expect(receipt.status, `command: ${JSON.stringify(command)}`).toBe("failed");
    }
    expect(primary.calls.writeLibrary).toEqual([]);
  });

  it("writeLibrary: unsupported when no wired source declares libraryWrite", async () => {
    const primary = makeFakeSource({ id: "webflix-catalog", capabilities: ["catalogSearch", "metadata"] });
    const fanOut = createFanOutConnector({ sources: [primary], clock: CLOCK });
    const receipt = await fanOut.writeLibrary(CTX, { op: "add", externalRef: "x" });
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toContain("libraryWrite");
  });
});

describe("fan-out — the diagnostics surface", () => {
  it("lastDegradations returns a snapshot (empty map = everything healthy)", () => {
    const primary = makeFakeSource({ id: "webflix-catalog" });
    const fanOut = createFanOutConnector({ sources: [primary], clock: CLOCK });
    expect(fanOut.lastDegradations().size).toBe(0);
  });
});
