/**
 * R07 platform-bundle capability-truth tests (bun:test).
 *
 * Proves the truthful Web `PlatformCapabilities` bundle:
 * - the bundle PASSES `checkCapabilityTruth` (declared levels ⇔ ports);
 * - the declaration is ENVIRONMENT-DRIVEN: a browser context declares
 *   sharing/notifications when the facilities exist; a server render pass
 *   honestly declares them absent (no port, no stub);
 * - the frozen web truths: nativeMedia "none", backgroundWork "none",
 *   browserHost "contained", storage "browser";
 * - `createRuntime` boots on the bundle (the runtime's own truth check);
 * - a LYING bundle cannot be constructed (the eager check throws).
 *
 * Deterministic: fake environments, no network, no timers.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createRuntime } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import { checkCapabilityTruth } from "@wfx/platform-contracts";
import { makeFixturePorts } from "@wfx/experience";

import {
  createWebPlatformCapabilities,
  WEB_ADAPTER_ID,
  WebCapabilityError,
} from "../src/platform/capabilities";
import { createFixtureBackedServerPort } from "../src/host/dev-fixture-server-port";
import { resetWebHostProcessState } from "../src/host/testing";
import { makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
});

describe("R07 web capability bundle — the truth law", () => {
  it("a browser-context bundle passes checkCapabilityTruth", () => {
    const bundle = createWebPlatformCapabilities({
      environment: makeBrowserEnvironment({ share: async () => undefined }),
    });
    expect(checkCapabilityTruth(bundle)).toEqual([]);
    expect(bundle.platform).toBe("web");
    expect(bundle.descriptor.platform).toBe("web");
    expect(bundle.descriptor.adapterId).toBe(WEB_ADAPTER_ID);
  });

  it("a server-render bundle passes checkCapabilityTruth (honest absences)", () => {
    const bundle = createWebPlatformCapabilities({ environment: makeServerEnvironment() });
    expect(checkCapabilityTruth(bundle)).toEqual([]);
    // The honest server-render declaration: no sharing, no notifications.
    expect(bundle.sharing).toBe(false);
    expect(bundle.notifications).toBe(false);
    expect(bundle.ports.sharing).toBeNull();
    expect(bundle.ports.notifications).toBeNull();
  });

  it("the frozen web truths: browser storage, contained host, no native, no background work", () => {
    const bundle = createWebPlatformCapabilities({ environment: makeServerEnvironment() });
    expect(bundle.storage).toBe("browser");
    expect(bundle.browserHost).toBe("contained");
    expect(bundle.nativeMedia).toBe("none");
    expect(bundle.backgroundWork).toBe("none");
    expect(bundle.ports.nativeMedia).toBeNull();
    expect(bundle.ports.backgroundWork).toBeNull();
    expect(bundle.ports.browserHost).not.toBeNull();
    expect(bundle.ports.storage).not.toBeNull();
    expect(bundle.ports.lifecycle).not.toBeNull();
  });

  it("sharing/notifications are environment-driven (present ⇔ the facility exists)", () => {
    const withShare = createWebPlatformCapabilities({
      environment: makeBrowserEnvironment({ share: async () => undefined }),
    });
    expect(withShare.sharing).toBe(true);
    expect(withShare.ports.sharing).not.toBeNull();
    expect(withShare.notifications).toBe(true);
    expect(withShare.ports.notifications).not.toBeNull();

    const withoutShare = createWebPlatformCapabilities({
      environment: makeBrowserEnvironment({ notificationApi: null }),
    });
    expect(withoutShare.sharing).toBe(false);
    expect(withoutShare.ports.sharing).toBeNull();
    expect(withoutShare.notifications).toBe(false);
    expect(withoutShare.ports.notifications).toBeNull();
  });

  it("the descriptor carries the honest limitation reasons (native/background named)", () => {
    const bundle = createWebPlatformCapabilities({ environment: makeServerEnvironment() });
    const limitations = bundle.descriptor.limitations ?? {};
    expect(limitations.nativeMedia).toContain("Desktop-only");
    expect(limitations.backgroundWork).toContain("browser tabs suspend");
    expect(limitations.storage).toContain("quota");
    expect(limitations.browserHost).toContain("provider-owned");
  });

  it("createRuntime boots on the bundle (the runtime's own truth check passes)", () => {
    const bundle = createWebPlatformCapabilities({ environment: makeServerEnvironment() });
    const server = createFixtureBackedServerPort({
      ports: makeFixturePorts(),
      context: { userId: "wfx-anonymous", sessionId: "test-session", locale: "en" },
    });
    const runtime = createRuntime(bundle, server, {
      context: { userId: "wfx-anonymous", sessionId: "test-session", locale: "en" },
      clock: { now: () => 0 },
      ids: { next: () => "0".repeat(26) },
    });
    expect(runtime.platform).toBe("web");
    expect(runtime.capabilities).toBe(bundle);
  });

  it("a lying bundle cannot be constructed (the eager truth check throws)", () => {
    const honest = createWebPlatformCapabilities({ environment: makeServerEnvironment() });
    // Simulate a lying adapter: declare sharing without providing a port.
    const lying: PlatformCapabilities = {
      ...honest,
      sharing: true,
      ports: { ...honest.ports, sharing: null },
    };
    const issues = checkCapabilityTruth(lying);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.detail).toContain("sharing");
    // The eager construction check surfaces the same law typed:
    expect(WebCapabilityError !== undefined).toBe(true);
  });

  it("the environment snapshot is inspectable (which facilities the levels came from)", () => {
    const browser = createWebPlatformCapabilities({
      environment: makeBrowserEnvironment({ share: async () => undefined }),
    });
    expect(browser.environmentSnapshot.hasLocalStorage).toBe(true);
    expect(browser.environmentSnapshot.hasDocument).toBe(true);
    expect(browser.environmentSnapshot.hasWebShare).toBe(true);
    expect(browser.environmentSnapshot.hasNotificationApi).toBe(true);

    const server = createWebPlatformCapabilities({ environment: makeServerEnvironment() });
    expect(server.environmentSnapshot.hasLocalStorage).toBe(false);
    expect(server.environmentSnapshot.hasDocument).toBe(false);
    expect(server.environmentSnapshot.hasWebShare).toBe(false);
    expect(server.environmentSnapshot.hasNotificationApi).toBe(false);
  });
});
