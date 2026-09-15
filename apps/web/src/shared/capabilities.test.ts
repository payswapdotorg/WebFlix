/**
 * WFX-040 shared capability-layer tests (bun:test).
 *
 * Capability profiles vs the domain `canPlay` contract (the compile-time
 * assertions live in `capabilities.ts`; these are the BEHAVIOR proofs),
 * the typed background-policy decisions, the storage/lifecycle fixture
 * ports, and the adapter provisioning per platform.
 */

import { describe, expect, it } from "bun:test";

import { canPlay } from "@wfx/domain";
import type { PlaybackMode } from "@wfx/domain";
import { ExperienceError, FixtureBrowserHost } from "@wfx/experience";

import {
  DESKTOP_STORAGE_QUOTA_BYTES,
  DesktopCapabilities,
  FixtureLifecyclePort,
  FixtureStoragePort,
  MobileCapabilities,
  MOBILE_STORAGE_QUOTA_BYTES,
  WebCapabilities,
  WEB_STORAGE_QUOTA_BYTES,
  assertValidPlatformProfile,
  createDesktopAdapter,
  createMobileAdapter,
  createWebAdapter,
  createWebPlatform,
  decideBackground,
} from "./capabilities";
import type { PlatformProfile } from "./capabilities";

const ALL_MODES: readonly PlaybackMode[] = ["native", "embed", "browser", "external"];

describe("WFX-040 capability profiles vs the domain canPlay contract", () => {
  it("the web profile is browser-constrained: native is honestly undeclared", () => {
    expect(WebCapabilities.platform).toBe("web");
    expect(canPlay(WebCapabilities.device, "native")).toBe(false);
    for (const mode of ["embed", "browser", "external"] as const) {
      expect(canPlay(WebCapabilities.device, mode)).toBe(true);
    }
  });

  it("the desktop profile is full power: every frozen mode is declared and playable", () => {
    expect(DesktopCapabilities.platform).toBe("desktop");
    for (const mode of ALL_MODES) {
      expect(canPlay(DesktopCapabilities.device, mode)).toBe(true);
    }
    expect(DesktopCapabilities.device.backgroundPlayback).toBe(true);
  });

  it("the mobile profile declares native media with OS-constrained background and reduced ceilings", () => {
    expect(MobileCapabilities.platform).toBe("mobile");
    for (const mode of ALL_MODES) {
      expect(canPlay(MobileCapabilities.device, mode)).toBe(true);
    }
    // Conservative static declaration; the typed policy is the adaptive layer.
    expect(MobileCapabilities.device.backgroundPlayback).toBe(false);
    // Reduced cache ceiling vs the other platforms.
    const mobileStorage = MobileCapabilities.device.storageBytes;
    const desktopStorage = DesktopCapabilities.device.storageBytes;
    if (mobileStorage === undefined || desktopStorage === undefined) {
      throw new Error("expected both fixture devices to declare storageBytes");
    }
    expect(mobileStorage).toBeLessThan(desktopStorage);
    expect(MOBILE_STORAGE_QUOTA_BYTES).toBeLessThan(WEB_STORAGE_QUOTA_BYTES);
    expect(MOBILE_STORAGE_QUOTA_BYTES).toBeLessThan(DESKTOP_STORAGE_QUOTA_BYTES);
  });

  it("profiles are frozen pure data (shared safely across runtimes)", () => {
    expect(Object.isFrozen(WebCapabilities)).toBe(true);
    expect(Object.isFrozen(DesktopCapabilities)).toBe(true);
    expect(Object.isFrozen(MobileCapabilities)).toBe(true);
  });

  it("platform builders bind FRESH adapters (no shared mutable state between runtimes)", () => {
    const first = createWebPlatform();
    const second = createWebPlatform();
    first.adapter.storage.set("shared-probe", "written-on-first");
    expect(second.adapter.storage.get("shared-probe")).toBeUndefined();
    // The immutable capability data is intentionally shared.
    expect(second.device).toBe(first.device);
  });
});

describe("WFX-040 typed background policy decisions", () => {
  it("the web 'never' policy pauses with its recorded reason", () => {
    const policy = WebCapabilities.background;
    if (policy.kind !== "never") throw new Error("expected the web 'never' background policy");
    const decision = decideBackground(policy);
    expect(decision.action).toBe("pause");
    expect(decision.reason).toBe(policy.reason);
  });

  it("the desktop 'always' policy continues (background completion)", () => {
    const policy = DesktopCapabilities.background;
    if (policy.kind !== "always") throw new Error("expected the desktop 'always' background policy");
    const decision = decideBackground(policy);
    expect(decision.action).toBe("continue");
    expect(decision.reason).toBe(policy.reason);
  });

  it("the mobile os-constrained policy honors wifi + charging inputs ⇒ continue", () => {
    const decision = decideBackground(MobileCapabilities.background, {
      networkClass: "wifi",
      charging: true,
    });
    expect(decision.action).toBe("continue");
    expect(decision.reason).toContain("wifi");
    expect(decision.reason).toContain("charging");
  });

  it("the mobile os-constrained policy pauses on cellular (wifi-only constraints)", () => {
    const decision = decideBackground(MobileCapabilities.background, {
      networkClass: "cellular",
      charging: true,
    });
    expect(decision.action).toBe("pause");
    expect(decision.reason).toContain("cellular");
    expect(decision.reason).toContain("wifi");
  });

  it("the mobile os-constrained policy pauses when charging is required but absent", () => {
    const decision = decideBackground(MobileCapabilities.background, {
      networkClass: "wifi",
      charging: false,
    });
    expect(decision.action).toBe("pause");
    expect(decision.reason).toContain("charging");
  });

  it("an os-constrained policy without injected inputs pauses safe-side (conditions unproven)", () => {
    const decision = decideBackground(MobileCapabilities.background);
    expect(decision.action).toBe("pause");
    expect(decision.reason).toContain("safe-side pause");
  });

  it("decisions are deterministic: same policy + inputs ⇒ same decision text", () => {
    const inputs = { networkClass: "cellular" as const, charging: false };
    const first = decideBackground(MobileCapabilities.background, inputs);
    const second = decideBackground(MobileCapabilities.background, inputs);
    expect(first).toEqual(second);
  });
});

describe("WFX-040 fixture storage port", () => {
  it("round-trips values inside its namespace and lists keys", () => {
    const storage = new FixtureStoragePort("wfx:test:", 1024);
    expect(storage.get("theme")).toBeUndefined();
    expect(storage.set("theme", "dark").ok).toBe(true);
    expect(storage.get("theme")).toBe("dark");
    expect(storage.keys()).toEqual(["theme"]);
    storage.remove("theme");
    expect(storage.get("theme")).toBeUndefined();
    expect(storage.keys()).toEqual([]);
  });

  it("surfaces a typed quota-exceeded failure (never a fake success)", () => {
    const storage = new FixtureStoragePort("wfx:test:", 16);
    expect(storage.set("a", "0123456789").ok).toBe(true);
    const result = storage.set("b", "0123456789");
    if (!result.ok) {
      expect(result.reason).toBe("quota-exceeded");
      expect(result.limitBytes).toBe(16);
      expect(result.requiredBytes).toBeGreaterThan(16);
    } else {
      throw new Error("expected the second write to exceed the 16-byte fixture quota");
    }
    // The failed write stored nothing.
    expect(storage.get("b")).toBeUndefined();
  });

  it("rejects malformed keys and values with the typed misuse error", () => {
    const storage = new FixtureStoragePort("wfx:test:", 16);
    expect(() => storage.get("")).toThrow(ExperienceError);
    expect(() => storage.set("", "x")).toThrow(ExperienceError);
    expect(() => storage.set("k", 42 as unknown as string)).toThrow(ExperienceError);
  });
  it("malformed constructor arguments throw the typed misuse error", () => {
    expect(() => new FixtureStoragePort("", 16)).toThrow(ExperienceError);
    expect(() => new FixtureStoragePort("wfx:test:", 0)).toThrow(ExperienceError);
  });
});

describe("WFX-040 fixture lifecycle port", () => {
  it("delivers pumped events to listeners in registration order and records them", () => {
    const lifecycle = new FixtureLifecyclePort();
    const calls: string[] = [];
    lifecycle.on("background", () => calls.push("background-1"));
    lifecycle.on("background", () => calls.push("background-2"));
    lifecycle.on("foreground", () => calls.push("foreground-1"));

    lifecycle.emit("background");
    expect(calls).toEqual(["background-1", "background-2"]);
    lifecycle.emit("foreground");
    expect(calls).toEqual(["background-1", "background-2", "foreground-1"]);
    expect(lifecycle.recordedEvents()).toEqual(["background", "foreground"]);
  });

  it("rejects malformed events and listeners with the typed misuse error", () => {
    const lifecycle = new FixtureLifecyclePort();
    expect(() =>
      lifecycle.on("suspended" as unknown as "background", () => {})).toThrow(ExperienceError);
    expect(() =>
      lifecycle.on("background", undefined as unknown as () => void)).toThrow(ExperienceError);
    expect(() => lifecycle.emit("suspended" as unknown as "background")).toThrow(ExperienceError);
  });
});

describe("WFX-040 platform adapters (typed seams, honest provisioning)", () => {
  it("the web adapter has no contained browser host (the host page renders provider surfaces)", () => {
    const adapter = createWebAdapter();
    expect(adapter.browser).toBeUndefined();
    expect(adapter.storage).toBeInstanceOf(FixtureStoragePort);
    expect(adapter.lifecycle).toBeInstanceOf(FixtureLifecyclePort);
  });

  it("the desktop and mobile adapters provide a WFX-026 BrowserHost honoring the cookie-isolation contract", () => {
    for (const adapter of [createDesktopAdapter(), createMobileAdapter()]) {
      const host = adapter.browser;
      if (host === undefined) throw new Error("expected a contained browser host");
      expect(host).toBeInstanceOf(FixtureBrowserHost);
      // The WFX-026 contract: every open is cookie-isolated.
      const handle = host.open("https://fixture.invalid/watch/probe", {
        restrictCookies: "isolate",
      });
      expect(handle.url).toBe("https://fixture.invalid/watch/probe");
      expect(() =>
        host.open("https://fixture.invalid/watch/probe", {
          restrictCookies: "no" as unknown as "isolate",
        }),
      ).toThrow(ExperienceError);
    }
  });
});

describe("WFX-040 platform profile validation (the misuse channel)", () => {
  it("accepts the three built profiles", () => {
    expect(() => assertValidPlatformProfile(createWebPlatform())).not.toThrow();
    expect(() =>
      assertValidPlatformProfile({ ...WebCapabilities, adapter: createWebAdapter() }),
    ).not.toThrow();
  });

  it("rejects a malformed device with EVERY problem collected", () => {
    const broken = {
      platform: "web",
      device: { playbackModes: ["native", "hologram"], codecs: [""], browser: "yes" },
      background: { kind: "never", reason: "r" },
      adapter: createWebAdapter(),
    } as unknown as PlatformProfile;
    try {
      assertValidPlatformProfile(broken);
      throw new Error("expected the malformed profile to throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ExperienceError);
      const error = thrown as ExperienceError;
      expect(error.details.some((detail) => detail.includes("playbackModes"))).toBe(true);
      expect(error.details.some((detail) => detail.includes("codecs"))).toBe(true);
      expect(error.details.some((detail) => detail.includes("browser"))).toBe(true);
    }
  });

  it("rejects a malformed background policy and a broken adapter", () => {
    const badBackground = {
      platform: "web",
      device: WebCapabilities.device,
      background: { kind: "sometimes" },
      adapter: createWebAdapter(),
    } as unknown as PlatformProfile;
    expect(() => assertValidPlatformProfile(badBackground)).toThrow(ExperienceError);

    const badAdapter = {
      platform: "web",
      device: WebCapabilities.device,
      background: WebCapabilities.background,
      adapter: { storage: null, lifecycle: undefined },
    } as unknown as PlatformProfile;
    expect(() => assertValidPlatformProfile(badAdapter)).toThrow(ExperienceError);
  });
});
