import { describe, expect, it } from "bun:test";

import type {
  ActionReceipt,
  ConnectorContext,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";

import {
  BaseConnector,
  errResult,
  isErr,
  isOk,
  isTransport,
  isUnsupported,
  LifecycleError,
  okResult,
  transport,
  type AsyncConnectorResultInput,
  type ConnectorError,
  type ConnectorResult,
} from "../src/index";

const CTX: ConnectorContext = { userId: "user-1", locale: "en-US" };

const RECEIPT: ActionReceipt = {
  status: "confirmed",
  externalId: "ext-1",
  occurredAt: "2026-09-13T00:00:00.000Z",
};

function likeAction(connectorId: string): UserAction {
  return { type: "like", connectorId, externalRef: "ref:1" };
}

/** Unwrap an ok result (fails the test loudly if it is an error). */
function unwrapOk<T>(result: ConnectorResult<T>): T {
  if (isOk(result)) return result.value;
  throw new Error(`expected ok result, received error '${result.error.kind}'`);
}

/** Unwrap an err result (fails the test loudly if it is a success). */
function unwrapErr<T>(result: ConnectorResult<T>): ConnectorError {
  if (isErr(result)) return result.error;
  throw new Error("expected err result, received ok");
}

/** Narrow to the unsupported variant, failing loudly otherwise. */
function asUnsupported(error: ConnectorError) {
  if (!isUnsupported(error)) {
    throw new Error(`expected unsupported error, got '${error.kind}'`);
  }
  return error;
}

/** Behavior knobs so one probe class covers every hook shape. */
interface ProbeBehaviors {
  search?: (query: string) => AsyncConnectorResultInput<SearchResult[]>;
  metadata?: (ref: string) => AsyncConnectorResultInput<SourceItem | null>;
  resolve?: () => AsyncConnectorResultInput<PlaybackRealization[]>;
  executeAction?: (action: UserAction) => AsyncConnectorResultInput<ActionReceipt>;
  readLibrary?: () => AsyncConnectorResultInput<LibraryEntry[]>;
  writeLibrary?: (command: LibraryCommand) => AsyncConnectorResultInput<ActionReceipt>;
}

/**
 * Minimal concrete connector for exercising BaseConnector. TEST FIXTURE.
 */
class ProbeConnector extends BaseConnector {
  constructor(
    descriptorInput: unknown,
    private readonly behaviors: ProbeBehaviors = {},
  ) {
    super(descriptorInput);
  }

  protected override onSearch(_ctx: ConnectorContext, query: string) {
    return this.behaviors.search?.(query) ?? [];
  }

  protected override onMetadata(_ctx: ConnectorContext, ref: string) {
    return this.behaviors.metadata?.(ref) ?? null;
  }

  protected override onResolve() {
    return this.behaviors.resolve?.() ?? [];
  }

  protected override onExecuteAction(_ctx: ConnectorContext, action: UserAction) {
    return this.behaviors.executeAction?.(action) ?? RECEIPT;
  }

  protected override onReadLibrary(ctx: ConnectorContext) {
    // No behavior configured → fall through to the BaseConnector default
    // (typed unsupported), so the default path stays testable.
    return this.behaviors.readLibrary ? this.behaviors.readLibrary() : super.onReadLibrary(ctx);
  }

  protected override onWriteLibrary(ctx: ConnectorContext, command: LibraryCommand) {
    return this.behaviors.writeLibrary
      ? this.behaviors.writeLibrary(command)
      : super.onWriteLibrary(ctx, command);
  }
}

async function expectLifecycleThrow(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (caught) {
    thrown = caught;
  }
  expect(thrown).toBeInstanceOf(LifecycleError);
}

describe("BaseConnector — construction & identity", () => {
  it("validates the descriptor strictly at construction", () => {
    expect(() => new ProbeConnector({ id: "BAD", version: "1.0.0" })).toThrow();
  });

  it("exposes descriptor(), id, and hasCapability", () => {
    const probe = new ProbeConnector({
      id: "probe-a",
      version: "1.0.0",
      displayName: "Probe A",
      capabilities: ["catalogSearch", "metadata", "playEmbed", "like", "libraryRead"],
      auth: "none",
    });
    expect(probe.id).toBe("probe-a");
    expect(probe.descriptor().displayName).toBe("Probe A");
    expect(Object.isFrozen(probe.descriptor())).toBe(true);
    expect(probe.hasCapability("like")).toBe(true);
    expect(probe.hasCapability("save")).toBe(false);
    expect(probe.state()).toBe("registered");
  });
});

describe("BaseConnector — requireCapability enforcement (unsupported, never a throw)", () => {
  // Declares ONLY catalogSearch: every other op must answer typed unsupported.
  const probe = new ProbeConnector({
    id: "search-only",
    version: "1.0.0",
    displayName: "Search Only",
    capabilities: ["catalogSearch"],
    auth: "none",
  });

  it("declared capability (search) succeeds after initialize", async () => {
    await probe.initialize();
    const result = await probe.searchResult(CTX, "query");
    expect(unwrapOk(result)).toEqual([]);
  });

  it("undeclared metadata returns typed unsupported — NOT a throw", async () => {
    const result = await probe.metadataResult(CTX, "ref:1");
    const error = asUnsupported(unwrapErr(result));
    expect(error.capability).toBe("metadata");
    expect(error.detail).toContain("search-only");
  });

  it("undeclared play capabilities make resolve unsupported with the full play set in detail", async () => {
    const result = await probe.resolveResult(CTX, "ref:1");
    const error = asUnsupported(unwrapErr(result));
    expect(["playNative", "playEmbed", "playBrowser", "playExternal"]).toContain(
      error.capability,
    );
    expect(error.detail).toContain("playNative");
    expect(error.detail).toContain("playExternal");
  });

  it("undeclared action capability returns typed unsupported for that action", async () => {
    const result = await probe.executeActionResult(CTX, likeAction("search-only"));
    const error = asUnsupported(unwrapErr(result));
    expect(error.capability).toBe("like");
  });

  it("undeclared libraryRead / libraryWrite return typed unsupported", async () => {
    const read = asUnsupported(unwrapErr(await probe.readLibraryResult(CTX)));
    expect(read.capability).toBe("libraryRead");

    const write = asUnsupported(
      unwrapErr(await probe.writeLibraryResult(CTX, { op: "add", externalRef: "ref:1" })),
    );
    expect(write.capability).toBe("libraryWrite");
  });

  it("declared-but-unimplemented optional hooks also answer unsupported honestly", async () => {
    // Declares libraryRead + libraryWrite but provides NO hook overrides.
    const declaresOnly = new ProbeConnector({
      id: "declares-only",
      version: "1.0.0",
      displayName: "Declares Only",
      capabilities: ["libraryRead", "libraryWrite"],
      auth: "none",
    });
    await declaresOnly.initialize();
    const read = asUnsupported(unwrapErr(await declaresOnly.readLibraryResult(CTX)));
    expect(read.detail).toContain("no onReadLibrary implementation");
    const write = asUnsupported(
      unwrapErr(
        await declaresOnly.writeLibraryResult(CTX, { op: "add", externalRef: "r" }),
      ),
    );
    expect(write.detail).toContain("no onWriteLibrary implementation");
  });
});

describe("BaseConnector — lifecycle enforcement on operations", () => {
  const probe = new ProbeConnector({
    id: "probe-b",
    version: "1.0.0",
    displayName: "Probe B",
    capabilities: ["catalogSearch"],
    auth: "none",
  });

  it("operations before initialize throw typed LifecycleError", async () => {
    await expectLifecycleThrow(probe.searchResult(CTX, "q"));
  });

  it("operations after dispose throw typed LifecycleError", async () => {
    await probe.initialize();
    await probe.dispose();
    await expectLifecycleThrow(probe.searchResult(CTX, "q"));
  });

  it("double initialize throws; the state stays coherent", async () => {
    const other = new ProbeConnector({
      id: "probe-c",
      version: "1.0.0",
      displayName: "Probe C",
      capabilities: ["catalogSearch"],
      auth: "none",
    });
    await other.initialize();
    await expectLifecycleThrow(other.initialize());
    expect(other.state()).toBe("initialized");
  });

  it("a failing onInitialize marks the connector failed and rethrows", async () => {
    class FailingInit extends ProbeConnector {
      protected override onInitialize(): void {
        throw new Error("boot failure");
      }
    }
    const failing = new FailingInit({
      id: "probe-d",
      version: "1.0.0",
      displayName: "Probe D",
      capabilities: ["catalogSearch"],
      auth: "none",
    });
    let thrown: unknown;
    try {
      await failing.initialize();
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("boot failure");
    expect(failing.state()).toBe("failed");
    expect(failing.lifecycle.failureReason()).toContain("boot failure");
    // failed is terminal: operations refuse to run
    await expectLifecycleThrow(failing.searchResult(CTX, "q"));
  });
});

describe("BaseConnector — input validation (invalid-input results)", () => {
  const probe = new ProbeConnector({
    id: "probe-e",
    version: "1.0.0",
    displayName: "Probe E",
    capabilities: ["catalogSearch", "metadata", "playEmbed", "like", "libraryWrite"],
    auth: "none",
  });

  it("rejects malformed contexts", async () => {
    const badContexts: unknown[] = [
      null,
      "string",
      {},
      { userId: "", locale: "en" },
      { userId: "u" },
      { userId: "u", locale: "en", region: 5 },
    ];
    await probe.initialize();
    for (const bad of badContexts) {
      const result = await probe.searchResult(bad as ConnectorContext, "q");
      expect(unwrapErr(result).kind).toBe("invalid-input");
    }
  });

  it("rejects empty or non-string queries", async () => {
    for (const query of ["", "   "]) {
      const result = await probe.searchResult(CTX, query);
      const error = unwrapErr(result);
      if (error.kind !== "invalid-input") {
        throw new Error(`expected invalid-input, got '${error.kind}'`);
      }
      expect(error.detail).toContain("query");
    }
  });

  it("rejects empty refs for metadata/resolve", async () => {
    for (const empty of ["", "  "]) {
      expect(unwrapErr(await probe.metadataResult(CTX, empty)).kind).toBe("invalid-input");
      expect(unwrapErr(await probe.resolveResult(CTX, empty)).kind).toBe("invalid-input");
    }
  });

  it("rejects malformed actions", async () => {
    const badActions: unknown[] = [
      null,
      {},
      { type: "explode", connectorId: "probe-e", externalRef: "r" },
      { type: "like", connectorId: "probe-e" },
      { type: "like", externalRef: "r" },
      { type: "like", connectorId: "other-connector", externalRef: "r" },
      { type: "like", connectorId: "probe-e", externalRef: "r", payload: "not-an-object" },
    ];
    for (const bad of badActions) {
      const result = await probe.executeActionResult(CTX, bad as UserAction);
      expect(unwrapErr(result).kind).toBe("invalid-input");
    }
  });

  it("rejects malformed library commands", async () => {
    const badCommands: unknown[] = [
      null,
      {},
      { op: "upsert", externalRef: "r" },
      { op: "add" },
      { op: "add", externalRef: "r", title: 5 },
    ];
    for (const bad of badCommands) {
      const result = await probe.writeLibraryResult(CTX, bad as LibraryCommand);
      expect(unwrapErr(result).kind).toBe("invalid-input");
    }
  });
});

describe("BaseConnector — asyncResult normalization through the hooks", () => {
  function makeProbe(behaviors: ProbeBehaviors, id = "probe-f"): ProbeConnector {
    return new ProbeConnector(
      {
        id,
        version: "1.0.0",
        displayName: "Probe F",
        capabilities: ["catalogSearch", "metadata", "playEmbed", "like"],
        auth: "none",
      },
      behaviors,
    );
  }

  it("plain values become ok results", async () => {
    const probe = makeProbe({ executeAction: () => RECEIPT });
    await probe.initialize();
    expect(await probe.executeActionResult(CTX, likeAction("probe-f"))).toEqual(
      okResult(RECEIPT),
    );
  });

  it("promised plain values become ok results", async () => {
    const probe = makeProbe({
      executeAction: () => Promise.resolve(RECEIPT),
    });
    await probe.initialize();
    const result = await probe.executeActionResult(CTX, likeAction("probe-f"));
    expect(unwrapOk(result)).toBe(RECEIPT);
  });

  it("bare ConnectorErrors become err results", async () => {
    const error: ConnectorError = { kind: "unauthorized", connectorId: "probe-f" };
    const probe = makeProbe({ executeAction: () => error });
    await probe.initialize();
    expect(await probe.executeActionResult(CTX, likeAction("probe-f"))).toEqual(
      errResult(error),
    );
  });

  it("ConnectorResults pass through unchanged (both branches)", async () => {
    const okProbe = makeProbe({ executeAction: () => okResult(RECEIPT) });
    await okProbe.initialize();
    expect(await okProbe.executeActionResult(CTX, likeAction("probe-f"))).toEqual(
      okResult(RECEIPT),
    );

    const transportError = transport("probe-f", "upstream 503");
    const errProbe = makeProbe({ executeAction: () => errResult(transportError) });
    await errProbe.initialize();
    expect(await errProbe.executeActionResult(CTX, likeAction("probe-f"))).toEqual(
      errResult(transportError),
    );
  });

  it("malformed ok:false results are reported as invalid-input (never fake success)", async () => {
    const probe = makeProbe({
      executeAction: () => ({ ok: false }) as unknown as ConnectorResult<ActionReceipt>,
    });
    await probe.initialize();
    const result = await probe.executeActionResult(CTX, likeAction("probe-f"));
    const error = unwrapErr(result);
    if (error.kind !== "invalid-input") {
      throw new Error(`expected invalid-input, got '${error.kind}'`);
    }
    expect(error.detail).toContain("malformed");
  });

  it("a throwing hook is wrapped as a typed transport error, not re-thrown", async () => {
    const probe = makeProbe({
      executeAction: () => {
        throw new Error("implementation bug");
      },
    });
    await probe.initialize();
    const result = await probe.executeActionResult(CTX, likeAction("probe-f"));
    const error = unwrapErr(result);
    if (!isTransport(error)) throw new Error(`expected transport, got '${error.kind}'`);
    expect(error.detail).toContain("implementation bug");
    expect(error.connectorId).toBe("probe-f");
  });

  it("a rejecting hook promise is wrapped as a typed transport error", async () => {
    const probe = makeProbe({
      search: () => Promise.reject(new Error("async bug")),
    });
    await probe.initialize();
    const result = await probe.searchResult(CTX, "q");
    expect(unwrapErr(result).kind).toBe("transport");
  });
});

describe("BaseConnector — plain frozen-contract surface", () => {
  const probe = new ProbeConnector(
    {
      id: "probe-g",
      version: "1.0.0",
      displayName: "Probe G",
      capabilities: ["catalogSearch", "metadata", "playEmbed", "like"],
      auth: "none",
    },
    {
      search: () => [{ connectorId: "probe-g", externalRef: "r:1", title: "Hit" }],
      metadata: (ref) =>
        ref === "r:1"
          ? {
              connectorId: "probe-g",
              externalRef: "r:1",
              title: "Hit",
              availability: "available",
              capabilities: ["playEmbed"],
            }
          : null,
      resolve: () => [
        { mode: "embed", connectorId: "probe-g", capabilities: ["playEmbed"] },
      ],
      executeAction: () => RECEIPT,
    },
  );

  it("plain methods match the frozen SourceConnector signatures", async () => {
    await probe.initialize();
    expect(await probe.search(CTX, "q")).toEqual([
      { connectorId: "probe-g", externalRef: "r:1", title: "Hit" },
    ]);
    expect((await probe.metadata(CTX, "r:1"))?.title).toBe("Hit");
    expect(await probe.metadata(CTX, "missing")).toBeNull();
    expect(await probe.resolve(CTX, "r:1")).toHaveLength(1);
    expect(await probe.executeAction(CTX, likeAction("probe-g"))).toEqual(RECEIPT);
  });

  it("degrades unsupported errors to the documented plain values and records lastError", async () => {
    const searchOnly = new ProbeConnector(
      {
        id: "probe-h",
        version: "1.0.0",
        displayName: "Probe H",
        capabilities: ["catalogSearch"],
        auth: "none",
      },
      { search: () => [{ connectorId: "probe-h", externalRef: "r:1", title: "Hit" }] },
    );
    await searchOnly.initialize();

    expect(await searchOnly.metadata(CTX, "r:1")).toBeNull(); // degraded
    expect(searchOnly.lastError()?.kind).toBe("unsupported");
    expect(await searchOnly.readLibrary(CTX)).toEqual([]); // degraded
    expect(searchOnly.lastError()?.kind).toBe("unsupported");

    const saveReceipt = await searchOnly.executeAction(CTX, {
      type: "save",
      connectorId: "probe-h",
      externalRef: "r:1",
    });
    expect(saveReceipt.status).toBe("unsupported"); // honest receipt
    expect(saveReceipt.detail).toContain("save");
    expect(saveReceipt.occurredAt).toBeTruthy();

    // A successful op clears the diagnostic channel.
    await searchOnly.search(CTX, "q");
    expect(searchOnly.lastError()).toBeNull();
  });

  it("degrades transport errors to failed receipts with the detail preserved", async () => {
    const broken = new ProbeConnector(
      {
        id: "broken-1",
        version: "1.0.0",
        displayName: "Broken",
        capabilities: ["like"],
        auth: "none",
      },
      { executeAction: () => transport("broken-1", "upstream 503") },
    );
    await broken.initialize();
    const receipt = await broken.executeAction(CTX, likeAction("broken-1"));
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("upstream 503");
    expect(broken.lastError()?.kind).toBe("transport");
  });
});
