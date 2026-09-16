/**
 * R08 — Desktop capability truth tests.
 *
 * The truthful Desktop bundle: `checkCapabilityTruth` passes with ZERO
 * issues; every declared level is backed by its port; the descriptor is
 * the desktop's own; torrent acquisition gates correctly (Desktop CAN,
 * Web honestly CANNOT — the frozen reference capability law).
 */

import { describe, expect, it } from "bun:test";

import { FixedClock } from "@wfx/client-runtime";
import { checkCapabilityTruth, supportsTorrentAcquisition } from "@wfx/platform-contracts";
import { makeWebCapabilities } from "@wfx/client-runtime";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import {
  assembleDesktopCapabilities,
  assertDesktopCapabilityTruth,
  DESKTOP_ADAPTER_ID,
  desktopCapabilityDescriptor,
} from "../src/platform/capabilities";
import { createNativeMediaBinding } from "../src/platform/native-media-binding";

const ENGINE_CONFIG = { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 1024 * 1024 };

function makeDesktopBundle() {
  const shell = new SimShell();
  const engine = createNativeMediaBinding({
    process: new SimEngineProcess(),
    config: ENGINE_CONFIG,
    clock: new FixedClock(0),
  });
  return { shell, engine, capabilities: assembleDesktopCapabilities(shell, engine) };
}

describe("R08 — desktop capability truth", () => {
  it("the truthful desktop bundle passes checkCapabilityTruth with zero issues", () => {
    const { capabilities } = makeDesktopBundle();
    expect(checkCapabilityTruth(capabilities)).toEqual([]);
  });

  it("the declaration is the full reference set, backed port-for-port", () => {
    const { capabilities } = makeDesktopBundle();
    expect(capabilities.platform).toBe("desktop");
    expect(capabilities.storage).toBe("filesystem");
    expect(capabilities.browserHost).toBe("contained");
    expect(capabilities.nativeMedia).toBe("native-service");
    expect(capabilities.backgroundWork).toBe("full");
    expect(capabilities.sharing).toBe(true);
    expect(capabilities.notifications).toBe(true);
    // Every optional port is PRESENT (presence agrees with the levels).
    expect(capabilities.ports.browserHost).not.toBeNull();
    expect(capabilities.ports.nativeMedia).not.toBeNull();
    expect(capabilities.ports.backgroundWork).not.toBeNull();
    expect(capabilities.ports.sharing).not.toBeNull();
    expect(capabilities.ports.notifications).not.toBeNull();
    expect(capabilities.ports.lifecycle).toBeDefined();
    expect(capabilities.ports.storage).toBeDefined();
  });

  it("the descriptor names the desktop platform and the adapter identity", () => {
    const descriptor = desktopCapabilityDescriptor();
    expect(descriptor.platform).toBe("desktop");
    expect(descriptor.adapterId).toBe(DESKTOP_ADAPTER_ID);
    expect(typeof descriptor.adapterVersion).toBe("string");
    // Honest limitation notes exist for the per-OS share-sheet truth, the
    // background-work recovery boundary, and the native-media boundary.
    expect(descriptor.limitations?.sharing).toBeDefined();
    expect(descriptor.limitations?.backgroundWork).toBeDefined();
    expect(descriptor.limitations?.nativeMedia).toBeDefined();
  });

  it("assertDesktopCapabilityTruth answers the torrent verdict (desktop CAN)", () => {
    const { capabilities } = makeDesktopBundle();
    expect(assertDesktopCapabilityTruth(capabilities)).toBe(true);
    expect(supportsTorrentAcquisition(capabilities)).toBe(true);
  });

  it("the web bundle honestly cannot torrent (the cross-adapter gate)", () => {
    const web = makeWebCapabilities();
    expect(supportsTorrentAcquisition(web)).toBe(false);
    expect(web.nativeMedia).toBe("none");
    expect(web.backgroundWork).toBe("none");
  });

  it("an incoherent bundle fails the boot truth-check with the issue named", () => {
    const { capabilities } = makeDesktopBundle();
    const lying = {
      ...capabilities,
      // Declared "none" while the port is provided — over-claiming, the
      // truth law's exact vocabulary.
      nativeMedia: "none",
    } as typeof capabilities;
    const issues = checkCapabilityTruth(lying);
    expect(issues.length).toBe(1);
    expect(issues[0]?.area).toBe("nativeMedia");
    expect(issues[0]?.detail).toContain("declared \"none\" but a NativeMediaPort is provided");
    expect(() => assertDesktopCapabilityTruth(lying)).toThrow(/truth law/);
  });

  it("a declared capability without its port is named too (under-providing)", () => {
    const { capabilities } = makeDesktopBundle();
    const hollow = {
      ...capabilities,
      ports: { ...capabilities.ports, backgroundWork: null },
    } as unknown as typeof capabilities;
    const issues = checkCapabilityTruth(hollow);
    expect(issues.length).toBe(1);
    expect(issues[0]?.area).toBe("backgroundWork");
    expect(issues[0]?.detail).toContain('declared "full" but no BackgroundWorkPort is provided');
  });
});
