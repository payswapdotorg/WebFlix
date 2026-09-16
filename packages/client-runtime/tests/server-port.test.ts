/**
 * @wfx/client-runtime — port contract tests via the test doubles (R01).
 *
 * The InMemoryServerPort honors the ServerPort contract (scripting,
 * defaults, the emit log + failure injection), and the in-memory platform
 * port doubles honor THEIR contracts (storage quota honesty, browser
 * cookie isolation, notification permission truth, sharing outcomes,
 * background work tracking, lifecycle hooks). These are the port contract
 * tests the remediation spec requires — the doubles are the reference
 * implementations of the contracts.
 */

import { describe, expect, it } from "bun:test";
import { isStorageError } from "@wfx/platform-contracts";

import { NativeMediaPortError } from "@wfx/platform-contracts";

import {
  FixedClock,
  InMemoryBackgroundWorkPort,
  InMemoryBrowserHostPort,
  InMemoryLifecyclePort,
  InMemoryNativeMediaPort,
  InMemoryNotificationPort,
  InMemoryServerPort,
  InMemorySharingPort,
  InMemoryStoragePort,
  SequentialIdGen,
} from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");

describe("InMemoryServerPort (the ServerPort contract)", () => {
  it("answers scripted results verbatim", async () => {
    const server = new InMemoryServerPort();
    server.scriptSearch("cozy", {
      ok: true,
      value: [{ connectorId: "test-source", externalRef: "ref-1", title: "Cozy Movie" }],
    });
    const result = await server.search("cozy");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
    const scripted = await server.search("unscripted");
    expect(scripted.ok).toBe(true); // honest empty default
    if (scripted.ok) expect(scripted.value).toEqual([]);
  });

  it("carries typed failures through the result channel", async () => {
    const server = new InMemoryServerPort();
    server.scriptSearch("broken", { ok: false, failure: { kind: "network", detail: "offline" } });
    const result = await server.search("broken");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("network");
      expect(result.failure.detail).toBe("offline");
    }
  });

  it("emits events to the log and honors queued emit failures", async () => {
    const server = new InMemoryServerPort();
    server.failNextEmits({ kind: "unavailable", detail: "503" });
    const failed = await server.emitEvent({
      userId: "user-1",
      itemId: "wfxitm_00000000000000000000000001",
      type: "progress",
      occurredAt: new Date(T0).toISOString(),
      sessionId: "sess-1",
    });
    expect(failed.ok).toBe(false);
    expect(server.emittedEvents).toHaveLength(0);
    const ok = await server.emitEvent({
      userId: "user-1",
      itemId: "wfxitm_00000000000000000000000001",
      type: "progress",
      occurredAt: new Date(T0).toISOString(),
      sessionId: "sess-1",
    });
    expect(ok.ok).toBe(true);
    expect(server.emittedEvents).toHaveLength(1);
  });

  it("shorts accept an optional query and default honestly", async () => {
    const server = new InMemoryServerPort();
    server.scriptShorts("", { ok: true, value: [] });
    const result = await server.shorts();
    expect(result.ok).toBe(true);
  });

  it("the SequentialIdGen double mints valid canonical ULID bodies", () => {
    const ids = new SequentialIdGen();
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const id = ids.next();
      expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("the FixedClock double advances deterministically", () => {
    const clock = new FixedClock(T0);
    expect(clock.now()).toBe(T0);
    clock.advance(1_000);
    expect(clock.now()).toBe(T0 + 1_000);
    clock.set(T0 + 5_000);
    expect(clock.now()).toBe(T0 + 5_000);
  });
});

describe("InMemoryStoragePort (the StoragePort contract)", () => {
  it("round-trips key-value and blob data; missing keys are null (honest absence)", async () => {
    const storage = new InMemoryStoragePort();
    await storage.set("a", "1");
    expect(await storage.get("a")).toBe("1");
    expect(await storage.get("missing")).toBeNull();
    await storage.putBlob("b", new Uint8Array([1, 2, 3]));
    expect(await storage.getBlob("b")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.getBlob("missing")).toBeNull();
    expect(await storage.keys()).toEqual(["a"]);
    expect(await storage.keys("b")).toEqual([]);
  });

  it("quota-exceeded is TYPED and never silent", async () => {
    const storage = new InMemoryStoragePort(10);
    await expect(storage.set("a", "1234567890")).resolves.toBeUndefined();
    await expect(storage.set("b", "123456")).rejects.toMatchObject({ code: "quota-exceeded" });
    const quota = await storage.quota();
    expect(quota.quotaBytes).toBe(10);
    expect(quota.usageBytes).toBe(10);
  });

  it("empty keys are invalid (typed), and isStorageError guards rejections", async () => {
    const storage = new InMemoryStoragePort();
    let thrown: unknown;
    try {
      await storage.set("", "x");
    } catch (error) {
      thrown = error;
    }
    expect(isStorageError(thrown)).toBe(true);
    if (isStorageError(thrown)) expect(thrown.code).toBe("invalid-key");
  });
});

describe("InMemoryBrowserHostPort (the BrowserHostPort contract)", () => {
  it("records opens with the cookie-isolation contract; navigations are observed", async () => {
    const host = new InMemoryBrowserHostPort();
    const surface = await host.open({
      url: "https://provider.example/watch",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    expect(host.opens).toHaveLength(1);
    expect(host.opens[0]?.url).toBe("https://provider.example/watch");
    const seen: string[] = [];
    surface.subscribe((event) => {
      if (event.kind === "navigated") seen.push(event.url ?? "");
    });
    await surface.navigate("https://provider.example/next");
    expect(seen).toEqual(["https://provider.example/next"]);
    await surface.close();
  });
});

describe("InMemoryNativeMediaPort (the NativeMediaPort contract)", () => {
  it("opens sessions, serves range reads, and reports truthful snapshots", async () => {
    const port = new InMemoryNativeMediaPort();
    const session = await port.open({ localPath: "/media/authorized.mkv" });
    expect(session.state).toBe("resolving");
    const inspected = await port.inspect(session.id);
    expect(inspected.id).toBe(session.id);
    const range = await port.readRange(session.id, { offset: 0, length: 16 });
    expect(range).toHaveLength(16);
    await port.close(session.id);
    let thrown: unknown;
    try {
      await port.inspect(session.id);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeMediaPortError);
    expect((thrown as NativeMediaPortError).code).toBe("unknown-session");
  });

  it("unknown sessions answer the typed unknown-session failure", async () => {
    const port = new InMemoryNativeMediaPort();
    let thrown: unknown;
    try {
      await port.pause("nope");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NativeMediaPortError);
    expect((thrown as NativeMediaPortError).code).toBe("unknown-session");
  });
});

describe("InMemoryNotificationPort (the NotificationPort contract)", () => {
  it("delivery is permission-gated and honestly reported", async () => {
    const port = new InMemoryNotificationPort();
    const denied = await port.notify({ title: "Done", category: "acquisition" });
    expect(denied.delivered).toBe(false);
    if (!denied.delivered) expect(denied.reason).toBe("permission-denied");
    await port.requestPermission();
    const granted = await port.notify({ title: "Done", category: "acquisition" });
    expect(granted.delivered).toBe(true);
    expect(port.notifications).toHaveLength(1);
  });
});

describe("InMemoryBackgroundWorkPort (the BackgroundWorkPort contract)", () => {
  it("schedules, tracks, and reports task statuses; empty ids are rejected", async () => {
    const port = new InMemoryBackgroundWorkPort();
    const rejected = await port.schedule({ taskId: "", kind: "sync", label: "broken" });
    expect(rejected.accepted).toBe(false);
    const accepted = await port.schedule({
      taskId: "task-1",
      kind: "acquisition",
      label: "Authorized download",
    });
    expect(accepted.accepted).toBe(true);
    expect((await port.status("task-1"))?.state).toBe("scheduled");
    const seen: string[] = [];
    port.subscribe((status) => seen.push(`${status.taskId}:${status.state}`));
    port.publish({ taskId: "task-1", kind: "acquisition", state: "running", progress: 0.5, updatedAtMs: T0 });
    expect(seen).toEqual(["task-1:running"]);
    expect((await port.list())).toHaveLength(1);
    expect(await port.cancel("task-1")).toBe(true);
    expect(await port.status("task-1")).toBeNull();
  });
});

describe("InMemorySharingPort (the SharingPort contract)", () => {
  it("distinguishes shared/dismissed/failed honestly", async () => {
    const port = new InMemorySharingPort();
    port.nextOutcome = { outcome: "dismissed" };
    expect(await port.share({ title: "Watch this" })).toEqual({ outcome: "dismissed" });
    port.nextOutcome = { outcome: "shared" };
    expect(await port.share({ title: "Watch this" })).toEqual({ outcome: "shared" });
    port.nextOutcome = { outcome: "failed", detail: "no share target" };
    const failed = await port.share({ title: "Watch this" });
    expect(failed.outcome).toBe("failed");
    expect(port.requests).toHaveLength(3);
    expect(await port.canShare({ title: "x" })).toBe(true);
  });
});

describe("InMemoryLifecyclePort (the LifecyclePort contract)", () => {
  it("phase + events agree; hooks fire; async shutdown hooks are awaited", async () => {
    const port = new InMemoryLifecyclePort();
    expect(port.phase()).toBe("initializing");
    const events: string[] = [];
    port.subscribe((event) => events.push(event.kind));
    let flushed = false;
    port.hook("shutdown", async () => {
      await Promise.resolve();
      flushed = true;
    });
    await port.emit("ready", T0);
    expect(port.phase()).toBe("active");
    await port.emit("background", T0 + 1);
    expect(port.phase()).toBe("background");
    await port.emit("resume", T0 + 2);
    expect(port.phase()).toBe("active");
    await port.emit("shutdown", T0 + 3);
    expect(port.phase()).toBe("shutdown");
    expect(events).toEqual(["ready", "background", "resume", "shutdown"]);
    expect(flushed).toBe(true); // the double AWAITED the async hook
  });
});
