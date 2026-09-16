/**
 * R08 — NotificationPort over OS notifications (shell simulator).
 *
 * The truth law: delivery is NEVER fabricated — permission-denied before
 * grant, invalid-request for malformed notifications, delivered only
 * after a real OS handoff; hard-denied permission is honestly reported.
 */

import { describe, expect, it } from "bun:test";

import { createShellNotificationPort } from "../src/platform/notifications";
import { SimShell } from "./shell-simulator";

describe("R08 — desktop OS notifications", () => {
  it("permission starts ungranted and requestable", async () => {
    const notifications = createShellNotificationPort(new SimShell());
    const permission = await notifications.permission();
    expect(permission.granted).toBe(false);
    expect(permission.canRequest).toBe(true);
  });

  it("notify before permission answers permission-denied — never a fabricated delivery", async () => {
    const shell = new SimShell();
    const notifications = createShellNotificationPort(shell);
    const outcome = await notifications.notify({
      title: "Download complete",
      category: "acquisition",
    });
    expect(outcome).toEqual({
      delivered: false,
      reason: "permission-denied",
      detail: "the OS notification permission is not granted",
    });
    expect(shell.shownNotifications).toHaveLength(0);
  });

  it("requesting permission grants it; then notify delivers through the OS channel", async () => {
    const shell = new SimShell();
    const notifications = createShellNotificationPort(shell);
    const granted = await notifications.requestPermission();
    expect(granted).toEqual({ granted: true, canRequest: false });
    const outcome = await notifications.notify({
      title: "Ready offline",
      body: "Your acquisition finished in the background.",
      category: "acquisition",
      itemId: "wfxitm_0000000000000000000000ABCD",
    });
    expect(outcome).toEqual({ delivered: true });
    expect(shell.shownNotifications).toHaveLength(1);
    expect(shell.shownNotifications[0]?.title).toBe("Ready offline");
    expect(shell.shownNotifications[0]?.category).toBe("acquisition");
  });

  it("a malformed notification answers invalid-request without reaching the OS", async () => {
    const shell = new SimShell();
    const notifications = createShellNotificationPort(shell);
    await notifications.requestPermission();
    const outcome = await notifications.notify({ title: "   ", category: "general" });
    expect(outcome.delivered).toBe(false);
    if (!outcome.delivered) {
      expect(outcome.reason).toBe("invalid-request");
      expect(outcome.detail).toContain("notification.title");
    }
    expect(shell.shownNotifications).toHaveLength(0);
  });

  it("a hard-denied permission is honestly reported (canRequest false, with the reason)", async () => {
    const shell = new SimShell();
    shell.hardDenyPermission("the user denied notifications in System Settings");
    const notifications = createShellNotificationPort(shell);
    const permission = await notifications.permission();
    expect(permission.granted).toBe(false);
    expect(permission.canRequest).toBe(false);
    expect(permission.reason).toContain("denied");
    const afterRequest = await notifications.requestPermission();
    expect(afterRequest.granted).toBe(false);
    expect(afterRequest.canRequest).toBe(false);
  });
});
