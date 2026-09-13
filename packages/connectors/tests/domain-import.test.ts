import { describe, expect, it } from "bun:test";

// Import-check for WFX-003: the frozen domain types MUST resolve through the
// PUBLIC entry point `@wfx/domain` (deep imports are rejected by lane-check).
// These imports only compile when the public entry resolves under tsc; the
// dynamic import asserts the module also resolves at runtime for bun.
import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  ConnectorDescriptor,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceConnector,
  SourceItem,
  UserAction,
} from "@wfx/domain";

describe("@wfx/domain public entry (WFX-003 import check)", () => {
  it("module resolves at runtime", async () => {
    const mod = await import("@wfx/domain");
    expect(mod).toBeTypeOf("object");
  });

  it("frozen Connector SDK types compile through the public entry", () => {
    const capability: Capability = "metadata";
    const descriptor: ConnectorDescriptor = {
      id: "import-check",
      version: "1.0.0",
      displayName: "Import Check",
      capabilities: [capability],
      auth: "none",
    };
    const ctx: ConnectorContext = { userId: "u1", locale: "en", region: "EU" };

    // Structurally exercise every Connector SDK type from the frozen contract.
    const search: SearchResult = { connectorId: "import-check", externalRef: "r:1", title: "T" };
    const item: SourceItem = {
      connectorId: "import-check",
      externalRef: "r:1",
      title: "T",
      availability: "available",
      capabilities: [capability],
    };
    const realization: PlaybackRealization = {
      mode: "embed",
      connectorId: "import-check",
      capabilities: ["playEmbed"],
    };
    const action: UserAction = { type: "like", connectorId: "import-check", externalRef: "r:1" };
    const receipt: ActionReceipt = { status: "confirmed", occurredAt: "2026-09-13T00:00:00.000Z" };
    const entry: LibraryEntry = { connectorId: "import-check", externalRef: "r:1", title: "T" };
    const command: LibraryCommand = { op: "add", externalRef: "r:1" };

    const connector: Pick<SourceConnector, "descriptor"> = { descriptor: () => descriptor };
    expect(connector.descriptor()).toEqual(descriptor);
    expect(ctx.userId).toBe("u1");
    expect([search, item, realization, action, receipt, entry, command]).toHaveLength(7);
  });
});
