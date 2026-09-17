/**
 * R07 platform notification-port tests (bun:test).
 *
 * Proves the notification honesty laws:
 * - `permission()` reports the truthful state (default ⇒ canRequest);
 * - a hard `denied` cannot be re-asked (canRequest false, reason honest);
 * - `requestPermission()` asks the real prompt and answers what the
 *   browser reports (never assumes a grant; a throwing prompt answers the
 *   CURRENT state);
 * - `notify()` NEVER fabricates delivery: denied ⇒ `permission-denied`;
 *   a malformed request ⇒ `invalid-request`; a construction failure ⇒
 *   `unavailable`; only a real handoff ⇒ `delivered`.
 *
 * Deterministic: a fake Notification API, no prompts, no OS.
 */

import { describe, expect, it } from "bun:test";

import { createWebNotificationPort } from "../src/platform/notifications";
import { FakeNotificationApi, makeBrowserEnvironment } from "./fake-web";

function portWith(api: FakeNotificationApi) {
  return {
    port: createWebNotificationPort({ environment: makeBrowserEnvironment({ notificationApi: api }) }),
    api,
  };
}

describe("R07 web notification port — permission truth", () => {
  it("the default state is honestly not-granted but askable", async () => {
    const { port } = portWith(new FakeNotificationApi());
    const permission = await port.permission();
    expect(permission.granted).toBe(false);
    expect(permission.canRequest).toBe(true);
    expect(permission.reason).toContain("not been asked");
  });

  it("a denied permission cannot be re-asked (the honest reading)", async () => {
    const api = new FakeNotificationApi();
    api.permission = "denied";
    const { port } = portWith(api);
    const permission = await port.permission();
    expect(permission.granted).toBe(false);
    expect(permission.canRequest).toBe(false);
    expect(permission.reason).toContain("denied");
  });

  it("requestPermission asks the real prompt and answers what the browser reports", async () => {
    const api = new FakeNotificationApi();
    api.nextRequestPermission = "granted";
    const { port } = portWith(api);
    const granted = await port.requestPermission();
    expect(granted.granted).toBe(true);

    api.permission = "default";
    api.nextRequestPermission = "denied";
    const denied = await port.requestPermission();
    expect(denied.granted).toBe(false);
    expect(denied.canRequest).toBe(false);
  });

  it("a throwing prompt answers the CURRENT state — never an assumed grant", async () => {
    const api = new FakeNotificationApi();
    api.nextRequestPermission = new Error("no user gesture");
    const { port } = portWith(api);
    const permission = await port.requestPermission();
    expect(permission.granted).toBe(false);
    expect(permission.reason).toContain("could not be shown");
  });
});

describe("R07 web notification port — delivery honesty (never fabricated)", () => {
  it("a denied permission answers permission-denied — no notification constructed", async () => {
    const api = new FakeNotificationApi();
    api.permission = "denied";
    const { port } = portWith(api);
    const outcome = await port.notify({ title: "Done", category: "acquisition" });
    expect(outcome).toEqual({
      delivered: false,
      reason: "permission-denied",
      detail: expect.stringContaining("denied"),
    });
    expect(api.constructed).toEqual([]);
  });

  it("a granted permission delivers through ONE real construction", async () => {
    const api = new FakeNotificationApi();
    api.permission = "granted";
    const { port } = portWith(api);
    const outcome = await port.notify({
      title: "Ready offline",
      body: "Your download completed.",
      category: "acquisition",
      itemId: "wfxitm_00000000000000000000000001",
    });
    expect(outcome).toEqual({ delivered: true });
    expect(api.constructed.length).toBe(1);
    expect(api.constructed[0]!.title).toBe("Ready offline");
    expect(api.constructed[0]!.body).toBe("Your download completed.");
    expect(api.constructed[0]!.tag).toContain("wfxitm_");
  });

  it("a malformed request answers invalid-request", async () => {
    const api = new FakeNotificationApi();
    api.permission = "granted";
    const { port } = portWith(api);
    const outcome = await port.notify({ title: "  ", category: "general" });
    expect(outcome).toEqual({
      delivered: false,
      reason: "invalid-request",
      detail: expect.stringContaining("title"),
    });
    expect(api.constructed).toEqual([]);
  });

  it("a construction failure answers unavailable — never a fake delivered", async () => {
    const api = new FakeNotificationApi();
    api.permission = "granted";
    api.nextConstructorError = new Error("notifications disabled by the OS");
    const { port } = portWith(api);
    const outcome = await port.notify({ title: "Hello", category: "general" });
    expect(outcome).toEqual({
      delivered: false,
      reason: "unavailable",
      detail: expect.stringContaining("could not be constructed"),
    });
  });
});
