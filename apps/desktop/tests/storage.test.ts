/**
 * R08 — filesystem StoragePort contract tests (over the shell simulator).
 *
 * Layout, quota honesty (disk-truth), typed errors, absence semantics,
 * persistence-across-reopen, and the NEVER-silent-eviction law.
 */

import { describe, expect, it } from "bun:test";

import { isStorageError, StorageError } from "@wfx/platform-contracts";

import { SimShell } from "./shell-simulator";
import { createShellStoragePort } from "../src/platform/storage";

describe("R08 — desktop storage over the shell filesystem", () => {
  it("kv round-trips: absent answers null (honest absence), set is readable, remove is idempotent", async () => {
    const storage = createShellStoragePort(new SimShell());
    expect(await storage.get("missing")).toBeNull();
    await storage.set("ui/theme", "dark");
    expect(await storage.get("ui/theme")).toBe("dark");
    await storage.remove("ui/theme");
    expect(await storage.get("ui/theme")).toBeNull();
    await expect(storage.remove("ui/theme")).resolves.toBeUndefined();
  });

  it("kv and blobs are separate namespaces (the documented layout)", async () => {
    const storage = createShellStoragePort(new SimShell());
    await storage.set("x", "kv-value");
    await storage.putBlob("x", new Uint8Array([1, 2, 3]));
    expect(await storage.get("x")).toBe("kv-value");
    expect(await storage.getBlob("x")).toEqual(new Uint8Array([1, 2, 3]));
    await storage.remove("x");
    expect(await storage.get("x")).toBeNull();
    // The blob namespace was untouched by the kv removal.
    expect(await storage.getBlob("x")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("keys list with prefix filtering", async () => {
    const storage = createShellStoragePort(new SimShell());
    await storage.set("watch/state-a", "1");
    await storage.set("watch/state-b", "2");
    await storage.set("library/saved", "3");
    expect(await storage.keys()).toEqual(["library/saved", "watch/state-a", "watch/state-b"]);
    expect(await storage.keys("watch/")).toEqual(["watch/state-a", "watch/state-b"]);
  });

  it("quota is disk-truth: usage grows with writes, the bound is the volume's free space", async () => {
    const shell = new SimShell({ storageBoundBytes: 100 });
    const storage = createShellStoragePort(shell);
    const before = await storage.quota();
    expect(before.usageBytes).toBe(0);
    expect(before.quotaBytes).toBe(100);
    await storage.set("a", "x".repeat(40));
    await storage.putBlob("b", new Uint8Array(10));
    const after = await storage.quota();
    expect(after.usageBytes).toBe(50);
    expect(after.quotaBytes).toBe(100);
  });

  it("a write over the bound rejects with the typed quota-exceeded StorageError — never a silent drop, never eviction", async () => {
    const shell = new SimShell({ storageBoundBytes: 50 });
    const storage = createShellStoragePort(shell);
    await storage.set("small", "x".repeat(40));
    let thrown: unknown;
    try {
      await storage.set("big", "y".repeat(40));
    } catch (error) {
      thrown = error;
    }
    expect(isStorageError(thrown)).toBe(true);
    const storageError = thrown as StorageError;
    expect(storageError.code).toBe("quota-exceeded");
    expect(storageError.operation).toBe("set");
    expect(storageError.retryable).toBe(true);
    // The OTHER keys were not evicted to make room (the frozen law).
    expect(await storage.get("small")).toBe("x".repeat(40));
    // And the rejected write is not present.
    expect(await storage.get("big")).toBeNull();
  });

  it("blob writes over the bound reject the same typed way", async () => {
    const shell = new SimShell({ storageBoundBytes: 8 });
    const storage = createShellStoragePort(shell);
    const thrown = await storage.putBlob("media", new Uint8Array(16)).catch((error: unknown) => error);
    expect(isStorageError(thrown)).toBe(true);
    expect((thrown as StorageError).code).toBe("quota-exceeded");
    expect((thrown as StorageError).operation).toBe("putBlob");
  });

  it("an unusable key rejects with the typed invalid-key error", async () => {
    const storage = createShellStoragePort(new SimShell());
    const thrown = await storage.set("", "value").catch((error: unknown) => error);
    expect(isStorageError(thrown)).toBe(true);
    expect((thrown as StorageError).code).toBe("invalid-key");
    expect((thrown as StorageError).retryable).toBe(false);
  });

  it("a corrupted stored value surfaces as the typed corrupt error (never garbage data)", async () => {
    const shell = new SimShell();
    const storage = createShellStoragePort(shell);
    await storage.set("watch/state", "good");
    shell.corruptKey("watch/state");
    const thrown = await storage.get("watch/state").catch((error: unknown) => error);
    expect(isStorageError(thrown)).toBe(true);
    expect((thrown as StorageError).code).toBe("corrupt");
  });

  it("persistence honesty: a set that resolved is readable by a LATER port over the same filesystem", async () => {
    const shell = new SimShell();
    const first = createShellStoragePort(shell);
    await first.set("session/pending", "flushed");
    await first.putBlob("thumb/1", new Uint8Array([9, 9]));
    // A later session (a fresh port over the same shell filesystem).
    const second = createShellStoragePort(shell);
    expect(await second.get("session/pending")).toBe("flushed");
    expect(await second.getBlob("thumb/1")).toEqual(new Uint8Array([9, 9]));
    const quota = await second.quota();
    expect(quota.usageBytes).toBe("flushed".length + 2);
  });

  it("removing blobs frees quota (the caller-owned eviction path)", async () => {
    const shell = new SimShell({ storageBoundBytes: 64 });
    const storage = createShellStoragePort(shell);
    await storage.putBlob("cache/1", new Uint8Array(60));
    const blocked = await storage.putBlob("cache/2", new Uint8Array(10)).catch((error: unknown) => error);
    expect(isStorageError(blocked)).toBe(true);
    await storage.removeBlob("cache/1");
    await expect(storage.putBlob("cache/2", new Uint8Array(10))).resolves.toBeUndefined();
  });
});
