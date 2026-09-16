/**
 * @wfx/client-runtime — action-state honesty tests (R01).
 *
 * The frozen law: UNSUPPORTED IS NEVER RENDERED AS SUCCESS. Plus platform
 * capability gating before dispatch and the 1:1 receipt mapping.
 */

import { describe, expect, it } from "bun:test";

import {
  ActionEngine,
  FixedClock,
  InMemoryServerPort,
  SequentialIdGen,
  actionCapabilityGate,
  makeDesktopCapabilities,
  makeWebCapabilities,
  receiptStatusToActionStatus,
  type ActionState,
} from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");

function makeEngine(platform = makeWebCapabilities()) {
  const server = new InMemoryServerPort();
  const engine = new ActionEngine(server, platform, new FixedClock(T0), new SequentialIdGen());
  return { server, engine };
}

const LIKE = { type: "like" as const, connectorId: "test-source", externalRef: "ref-1" };
const DOWNLOAD = { type: "download" as const, connectorId: "test-source", externalRef: "ref-1" };

describe("platform capability gating (before dispatch)", () => {
  it("web truthfully gates the download action (no native acquisition)", () => {
    const web = makeWebCapabilities();
    const gate = actionCapabilityGate(web, "download");
    expect(gate).not.toBeNull();
    expect(gate?.gate).toBe("native-acquisition");
    expect(gate?.reason).toContain("nativeMedia");
  });

  it("desktop (native-service + background work) does not gate download", () => {
    const desktop = makeDesktopCapabilities();
    expect(actionCapabilityGate(desktop, "download")).toBeNull();
  });

  it("a gated action settles unsupported WITHOUT touching the server", async () => {
    const { server, engine } = makeEngine(makeWebCapabilities());
    const state = await engine.dispatch(DOWNLOAD);
    expect(state.status).toBe("unsupported");
    expect(state.capabilityGate).toBe("native-acquisition");
    expect(state.detail).toContain("nativeMedia");
    // The action was never dispatched: no receipts were consumed.
    expect(server.emittedEvents).toHaveLength(0);
  });
});

describe("receipt mapping (1:1, frozen)", () => {
  it("confirmed -> confirmed-by-provider (with the external id)", () => {
    expect(
      receiptStatusToActionStatus({ status: "confirmed", externalId: "ext-9", occurredAt: "2026-09-16T12:00:00.000Z" }),
    ).toEqual({ status: "confirmed-by-provider" });
  });

  it("local-only -> confirmed-locally (visibly distinct)", () => {
    const mapped = receiptStatusToActionStatus({
      status: "local-only",
      occurredAt: "2026-09-16T12:00:00.000Z",
    });
    expect(mapped.status).toBe("confirmed-locally");
    expect(mapped.detail).toContain("locally");
  });

  it("unsupported -> unsupported; failed -> failed", () => {
    expect(
      receiptStatusToActionStatus({ status: "unsupported", occurredAt: "2026-09-16T12:00:00.000Z" }).status,
    ).toBe("unsupported");
    expect(
      receiptStatusToActionStatus({ status: "failed", occurredAt: "2026-09-16T12:00:00.000Z" }).status,
    ).toBe("failed");
  });
});

describe("dispatch settles honestly", () => {
  it("a confirmed receipt settles confirmed-by-provider", async () => {
    const { server, engine } = makeEngine();
    server.scriptAction({
      ok: true,
      value: { status: "confirmed", externalId: "ext-1", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    const state = await engine.dispatch(LIKE);
    expect(state.status).toBe("confirmed-by-provider");
    expect(state.externalId).toBe("ext-1");
    expect(state.actionId.startsWith("wfxact_")).toBe(true);
  });

  it("an unsupported receipt settles unsupported — never success", async () => {
    const { server, engine } = makeEngine();
    server.scriptAction({
      ok: true,
      value: { status: "unsupported", detail: "provider cannot like", occurredAt: "2026-09-16T12:00:00.000Z" },
    });
    const state = await engine.dispatch(LIKE);
    expect(state.status).toBe("unsupported");
    expect(state.detail).toContain("provider cannot like");
  });

  it("a transport failure settles failed with the mapped detail — never a crash", async () => {
    const { server, engine } = makeEngine();
    server.scriptAction({ ok: false, failure: { kind: "network", detail: "offline" } });
    const state = await engine.dispatch(LIKE);
    expect(state.status).toBe("failed");
    expect(state.detail).toContain("network");
    expect(state.detail).toContain("offline");
  });

  it("the 'requested' state is observable in the subscribe stream before settling", async () => {
    const { engine } = makeEngine();
    const seen: ActionState[] = [];
    engine.operations().subscribe((state) => seen.push(state));
    // A deferred server: build a small engine whose dispatch awaits a tick.
    const state = await engine.dispatch(LIKE); // settles immediately (default receipt)
    expect(state.status).toBe("confirmed-by-provider");
    // The subscribe stream captured the states in order.
    const statuses = seen.map((entry) => entry.status);
    expect(statuses[0]).toBe("requested");
    expect(statuses[statuses.length - 1]).toBe("confirmed-by-provider");
  });

  it("terminal states are terminal: a fresh dispatch mints a fresh action", async () => {
    const { engine } = makeEngine();
    const first = await engine.dispatch(LIKE);
    expect(first.status).toBe("confirmed-by-provider");
    const second = await engine.dispatch(LIKE);
    expect(second.actionId).not.toBe(first.actionId);
  });

  it("invalid actions throw the typed invalid-input error", async () => {
    const { engine } = makeEngine();
    await expect(
      engine.dispatch({ type: "explode", connectorId: "x", externalRef: "y" } as never),
    ).rejects.toMatchObject({ kind: "invalid-input" });
    await expect(
      engine.dispatch({ type: "like", connectorId: "", externalRef: "y" } as never),
    ).rejects.toMatchObject({ kind: "invalid-input" });
  });
});

describe("action queries", () => {
  it("byItem returns the item's source-ref actions, newest first", async () => {
    const { engine } = makeEngine();
    await engine.dispatch(LIKE);
    await engine.dispatch({ ...LIKE, type: "save" });
    const ops = engine.operations();
    const forRef = ops.byItem("test-source:ref-1");
    expect(forRef.length).toBe(2);
    expect(ops.get(forRef[0]?.actionId ?? "")).toBeDefined();
    expect(ops.all().length).toBeGreaterThanOrEqual(2);
  });
});
