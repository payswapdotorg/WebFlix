import { describe, expect, it } from "bun:test";

import { DESKTOP_NATIVE, MODERN_WEB, canPlay, type DeviceCapabilities } from "../src/index";

const ALL_MODES = ["native", "embed", "browser", "external"] as const;

/** Full-capability baseline; override per case. */
function capabilities(overrides: Partial<DeviceCapabilities>): DeviceCapabilities {
  return {
    playbackModes: ["native", "embed", "browser", "external"],
    codecs: ["h264"],
    browser: true,
    backgroundPlayback: false,
    casting: false,
    ...overrides,
  };
}

describe("device capabilities", () => {
  describe("canPlay matrix", () => {
    it("returns true for every declared mode on a full-capability device", () => {
      const caps = capabilities({});
      for (const mode of ALL_MODES) expect(canPlay(caps, mode)).toBe(true);
    });

    it("returns false for modes the device does not declare", () => {
      const nativeOnly = capabilities({ playbackModes: ["native"] });
      expect(canPlay(nativeOnly, "native")).toBe(true);
      expect(canPlay(nativeOnly, "embed")).toBe(false);
      expect(canPlay(nativeOnly, "browser")).toBe(false);
      expect(canPlay(nativeOnly, "external")).toBe(false);
    });

    it("requires a browser surface for embed and browser modes", () => {
      const noBrowser = capabilities({ browser: false });
      expect(canPlay(noBrowser, "native")).toBe(true);
      expect(canPlay(noBrowser, "external")).toBe(true);
      expect(canPlay(noBrowser, "embed")).toBe(false);
      expect(canPlay(noBrowser, "browser")).toBe(false);
    });

    it("allows embed/browser when declared alongside a browser surface", () => {
      const webOnly = capabilities({ playbackModes: ["embed", "browser"] });
      expect(canPlay(webOnly, "embed")).toBe(true);
      expect(canPlay(webOnly, "browser")).toBe(true);
      expect(canPlay(webOnly, "native")).toBe(false);
      expect(canPlay(webOnly, "external")).toBe(false);
    });

    it("a declared browser mode without a browser surface is not playable", () => {
      const inconsistent = capabilities({ playbackModes: ["browser"], browser: false });
      expect(canPlay(inconsistent, "browser")).toBe(false);
    });

    it("external handoff depends only on the declaration", () => {
      const externalOnly = capabilities({
        playbackModes: ["external"],
        browser: false,
        backgroundPlayback: false,
        casting: false,
      });
      expect(canPlay(externalOnly, "external")).toBe(true);
      expect(canPlay(externalOnly, "native")).toBe(false);
    });
  });

  describe("presets (fixtures)", () => {
    it("MODERN_WEB and DESKTOP_NATIVE can realize all four playback modes", () => {
      for (const mode of ALL_MODES) {
        expect(canPlay(MODERN_WEB, mode)).toBe(true);
        expect(canPlay(DESKTOP_NATIVE, mode)).toBe(true);
      }
    });

    it("documented fixture contrasts hold", () => {
      expect(MODERN_WEB.browser).toBe(true);
      expect(MODERN_WEB.backgroundPlayback).toBe(false);
      expect(MODERN_WEB.casting).toBe(true);
      expect(MODERN_WEB.storageBytes ?? 0).toBeGreaterThan(0);

      expect(DESKTOP_NATIVE.browser).toBe(true);
      expect(DESKTOP_NATIVE.backgroundPlayback).toBe(true);
      expect(DESKTOP_NATIVE.casting).toBe(false);
      expect(DESKTOP_NATIVE.storageBytes ?? 0).toBeGreaterThan(0);
    });

    it("presets are frozen fixtures (immutable at runtime)", () => {
      const mutableWeb = MODERN_WEB as DeviceCapabilities;
      expect(() => {
        mutableWeb.browser = false;
      }).toThrow();
      const mutableDesktop = DESKTOP_NATIVE as DeviceCapabilities;
      expect(() => {
        mutableDesktop.casting = true;
      }).toThrow();
    });
  });
});
