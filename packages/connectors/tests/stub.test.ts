import { describe, expect, it } from "bun:test";

import type { ConnectorContext } from "@wfx/domain";

import {
  isErr,
  isOk,
  isUnsupported,
  LifecycleError,
  makeStubConnector,
  STUB_CAPABILITIES,
  STUB_CONNECTOR_ID,
  STUB_DEFAULT_METADATA,
  STUB_DEFAULT_REALIZATIONS,
  STUB_DEFAULT_SEARCH_RESULTS,
  StubTestConnector,
  type ConnectorError,
  type ConnectorResult,
} from "../src/index";

const CTX: ConnectorContext = { userId: "user-1", locale: "en-US" };

function unwrapOk<T>(result: ConnectorResult<T>): T {
  if (isOk(result)) return result.value;
  throw new Error(`expected ok result, received error '${result.error.kind}'`);
}

function unwrapErr<T>(result: ConnectorResult<T>): ConnectorError {
  if (isErr(result)) return result.error;
  throw new Error("expected err result, received ok");
}

function asUnsupported(error: ConnectorError) {
  if (!isUnsupported(error)) {
    throw new Error(`expected unsupported error, got '${error.kind}'`);
  }
  return error;
}

describe("makeStubConnector — fixture identity", () => {
  it("is branded as a test fixture and never a production source", () => {
    const stub = makeStubConnector();
    expect(stub.id).toBe("stub-test");
    expect(STUB_CONNECTOR_ID).toBe("stub-test");
    expect(stub.isTestFixture).toBe(true);
    expect(StubTestConnector.isTestFixture).toBe(true);
    expect(stub.descriptor().displayName).toContain("TEST FIXTURE");
  });

  it("declares the intentionally limited capability set", () => {
    const stub = makeStubConnector();
    expect([...stub.descriptor().capabilities]).toEqual([...STUB_CAPABILITIES]);
    // Explicitly NOT declared — that is the fixture's purpose:
    for (const cap of [
      "identity",
      "playNative",
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
    ] as const) {
      expect(stub.hasCapability(cap)).toBe(false);
    }
  });

  it("is returned in the registered state (caller drives the lifecycle)", () => {
    expect(makeStubConnector().state()).toBe("registered");
  });
});

describe("makeStubConnector — end-to-end (canned results + typed unsupported)", () => {
  it("search returns the canned results after a real initialize()", async () => {
    const stub = makeStubConnector();
    await stub.initialize();

    const result = await stub.searchResult(CTX, "anything");
    const value = unwrapOk(result);
    expect(value).toEqual([...STUB_DEFAULT_SEARCH_RESULTS]);
    expect(value).toHaveLength(2);
    expect(value[0]?.connectorId).toBe("stub-test");
  });

  it("search overrides replace the canned results", async () => {
    const custom = [{ connectorId: "stub-test", externalRef: "stub:9", title: "Custom" }];
    const stub = makeStubConnector({ searchResults: custom });
    await stub.initialize();
    expect(unwrapOk(await stub.searchResult(CTX, "q"))).toEqual(custom);
  });

  it("metadata returns the canned item for known refs and null for unknown", async () => {
    const stub = makeStubConnector();
    await stub.initialize();

    expect(unwrapOk(await stub.metadataResult(CTX, "stub:1"))).toEqual(STUB_DEFAULT_METADATA);
    expect(unwrapOk(await stub.metadataResult(CTX, "stub:404"))).toBeNull();
  });

  it("metadata overrides can model explicit not-found with null", async () => {
    const stub = makeStubConnector({ metadataByRef: { "stub:1": null } });
    await stub.initialize();
    expect(unwrapOk(await stub.metadataResult(CTX, "stub:1"))).toBeNull();
  });

  it("resolve returns the canned embed realization (playEmbed is declared)", async () => {
    const stub = makeStubConnector();
    await stub.initialize();
    const value = unwrapOk(await stub.resolveResult(CTX, "stub:1"));
    expect(value).toEqual([...STUB_DEFAULT_REALIZATIONS]);
    expect(value[0]?.mode).toBe("embed");
  });

  it("every undeclared operation returns typed unsupported — never a throw", async () => {
    const stub = makeStubConnector();
    await stub.initialize();

    // executeAction: no action capability declared
    const like = asUnsupported(
      unwrapErr(
        await stub.executeActionResult(CTX, {
          type: "like",
          connectorId: "stub-test",
          externalRef: "stub:1",
        }),
      ),
    );
    expect(like.capability).toBe("like");

    // readLibrary: undeclared
    const read = asUnsupported(unwrapErr(await stub.readLibraryResult(CTX)));
    expect(read.capability).toBe("libraryRead");

    // writeLibrary: undeclared
    const write = asUnsupported(
      unwrapErr(await stub.writeLibraryResult(CTX, { op: "add", externalRef: "stub:1" })),
    );
    expect(write.capability).toBe("libraryWrite");
  });

  it("plain frozen surface also serves the canned data", async () => {
    const stub = makeStubConnector();
    await stub.initialize();
    expect(await stub.search(CTX, "q")).toEqual([...STUB_DEFAULT_SEARCH_RESULTS]);
    expect(await stub.metadata(CTX, "stub:1")).toEqual(STUB_DEFAULT_METADATA);
    expect(await stub.metadata(CTX, "nope")).toBeNull();
    expect(await stub.resolve(CTX, "stub:1")).toEqual([...STUB_DEFAULT_REALIZATIONS]);
    // unsupported through the plain surface: receipt + lastError
    const receipt = await stub.executeAction(CTX, {
      type: "save",
      connectorId: "stub-test",
      externalRef: "stub:1",
    });
    expect(receipt.status).toBe("unsupported");
    expect(stub.lastError()?.kind).toBe("unsupported");
    expect(await stub.readLibrary(CTX)).toEqual([]);
  });

  it("lifecycle honesty: operations refuse before initialize and after dispose", async () => {
    const fresh = makeStubConnector();
    let thrown: unknown;
    try {
      await fresh.searchResult(CTX, "q");
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(LifecycleError);

    await fresh.initialize();
    await fresh.dispose();
    thrown = undefined;
    try {
      await fresh.searchResult(CTX, "q");
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(LifecycleError);
  });
});
