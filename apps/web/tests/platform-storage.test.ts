/**
 * R07 platform storage-port tests (bun:test).
 *
 * Proves the StoragePort laws over the web backends:
 * - kv set/get/remove/keys round-trip through localStorage (namespaced);
 * - quota honesty: the adapter-enforced bound REJECTS with the typed
 *   `quota-exceeded` BEFORE mutation — never silent, never evicting;
 * - the browser's own QuotaExceededError surfaces typed (never swallowed);
 * - invalid keys are typed `invalid-key`; a tampered envelope is `corrupt`;
 * - the memory fallback (SSR boot) works and describes itself honestly;
 * - blobs: the bounded area rejects over-bound writes typed, never evicts;
 * - `quota()` reports real accounting (usage + the enforced bound).
 *
 * Deterministic: fake localStorage, no IndexedDB, no timers.
 */

import { describe, expect, it } from "bun:test";
import { isStorageError, StorageError } from "@wfx/platform-contracts";

import { createWebStoragePort } from "../src/platform/storage";
import type { WebEnvironment } from "../src/platform/environment";
import { FakeLocalStorage, makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

/** A minimal environment with ONLY localStorage (no document needed). */
function storageEnvironment(overrides?: { readonly localStorage?: FakeLocalStorage | null }): WebEnvironment {
  const environment = makeBrowserEnvironment({});
  return {
    ...environment,
    localStorage: overrides?.localStorage === null ? null : (overrides?.localStorage ?? environment.localStorage),
  };
}

describe("R07 web storage port — kv over localStorage", () => {
  it("set/get/remove/keys round-trip, namespaced away from foreign keys", async () => {
    const storage = new FakeLocalStorage();
    storage.setItem("foreign:key", "not-ours");
    const port = createWebStoragePort({ environment: storageEnvironment({ localStorage: storage }) });

    expect(await port.get("theme")).toBeNull(); // honest absence, never an error
    await port.set("theme", "dark");
    expect(await port.get("theme")).toBe("dark");
    expect(await port.keys()).toEqual(["theme"]); // foreign keys are not ours
    await port.remove("theme");
    expect(await port.get("theme")).toBeNull();
    await port.remove("theme"); // idempotent
    // The namespaced envelope is adapter-owned (never raw values).
    expect(storage.getItem("foreign:key")).toBe("not-ours");
  });

  it("the adapter-enforced bound rejects typed quota-exceeded BEFORE mutation", async () => {
    const port = createWebStoragePort({
      environment: storageEnvironment(),
      kvBytesBound: 100,
    });
    await port.set("small", "a".repeat(10));
    let thrown: unknown = null;
    try {
      await port.set("big", "b".repeat(200));
    } catch (error) {
      thrown = error;
    }
    expect(isStorageError(thrown)).toBe(true);
    const storageError = thrown as StorageError;
    expect(storageError.code).toBe("quota-exceeded");
    expect(storageError.operation).toBe("set");
    expect(storageError.message).toContain("never evicts");
    // The failed write did NOT mutate anything.
    expect(await port.get("big")).toBeNull();
    expect(await port.get("small")).toBe("a".repeat(10));
  });

  it("the browser's own QuotaExceededError surfaces typed (never swallowed)", async () => {
    const storage = new FakeLocalStorage();
    const port = createWebStoragePort({ environment: storageEnvironment({ localStorage: storage }) });
    storage.nextSetError = Object.assign(new Error("The quota has been exceeded"), {
      name: "QuotaExceededError",
    });
    let thrown: unknown = null;
    try {
      await port.set("doomed", "value");
    } catch (error) {
      thrown = error;
    }
    expect(isStorageError(thrown)).toBe(true);
    expect((thrown as StorageError).code).toBe("quota-exceeded");
  });

  it("empty and oversized keys are typed invalid-key", async () => {
    const port = createWebStoragePort({ environment: storageEnvironment() });
    await expect(port.get("")).rejects.toMatchObject({ code: "invalid-key" });
    await expect(port.set("", "x")).rejects.toMatchObject({ code: "invalid-key" });
    await expect(port.set("k".repeat(600), "x")).rejects.toMatchObject({ code: "invalid-key" });
  });

  it("a tampered (non-adapter) envelope is typed corrupt", async () => {
    const storage = new FakeLocalStorage();
    storage.setItem("wfx:kv:tampered", "raw-without-envelope");
    const port = createWebStoragePort({ environment: storageEnvironment({ localStorage: storage }) });
    await expect(port.get("tampered")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("quota() reports real accounting: usage + the enforced bound", async () => {
    const port = createWebStoragePort({
      environment: storageEnvironment(),
      kvBytesBound: 1000,
      blobBytesBound: 500,
    });
    await port.set("a", "aaaa"); // 8 bytes UTF-16 + key
    const quota = await port.quota();
    expect(quota.usageBytes).toBeGreaterThan(0);
    expect(quota.quotaBytes).toBe(1500);
  });

  it("describe() names the truthful backends and durability windows", async () => {
    const durable = createWebStoragePort({ environment: storageEnvironment() });
    expect(durable.describe().kv).toEqual({ backend: "localStorage", durability: "browser-sessions" });
    expect(durable.describe().blobs).toEqual({ backend: "memory", durability: "process-lifetime" });

    const ephemeral = createWebStoragePort({ environment: makeServerEnvironment() });
    expect(ephemeral.describe().kv).toEqual({ backend: "memory", durability: "process-lifetime" });
  });
});

describe("R07 web storage port — the memory fallback (SSR boot)", () => {
  it("kv works in-process and is honestly process-lifetime", async () => {
    const port = createWebStoragePort({ environment: makeServerEnvironment() });
    await port.set("session-note", "value");
    expect(await port.get("session-note")).toBe("value");
    expect(port.describe().kv.durability).toBe("process-lifetime");
  });
});

describe("R07 web storage port — blobs (bounded, never evicting)", () => {
  it("putBlob/getBlob/removeBlob round-trip", async () => {
    const port = createWebStoragePort({ environment: storageEnvironment() });
    const bytes = new Uint8Array([1, 2, 3]);
    await port.putBlob("thumb", bytes);
    const read = await port.getBlob("thumb");
    expect(read).not.toBeNull();
    expect([...(read as Uint8Array)]).toEqual([1, 2, 3]);
    await port.removeBlob("thumb");
    expect(await port.getBlob("thumb")).toBeNull();
  });

  it("an over-bound blob write rejects typed quota-exceeded — other blobs survive", async () => {
    const port = createWebStoragePort({
      environment: storageEnvironment(),
      blobBytesBound: 10,
    });
    await port.putBlob("small", new Uint8Array(4));
    let thrown: unknown = null;
    try {
      await port.putBlob("large", new Uint8Array(20));
    } catch (error) {
      thrown = error;
    }
    expect(isStorageError(thrown)).toBe(true);
    expect((thrown as StorageError).code).toBe("quota-exceeded");
    // The documented eviction policy: NEVER evict — the earlier blob survives.
    expect(await port.getBlob("small")).not.toBeNull();
  });

  it("removing blobs frees the budget (caller-managed lifetimes)", async () => {
    const port = createWebStoragePort({
      environment: storageEnvironment(),
      blobBytesBound: 10,
    });
    await port.putBlob("a", new Uint8Array(8));
    await port.removeBlob("a");
    await port.putBlob("b", new Uint8Array(8)); // fits now
    expect(await port.getBlob("b")).not.toBeNull();
  });

  it("invalid blob keys are typed invalid-key", async () => {
    const port = createWebStoragePort({ environment: storageEnvironment() });
    await expect(port.putBlob("", new Uint8Array(1))).rejects.toMatchObject({ code: "invalid-key" });
  });
});
