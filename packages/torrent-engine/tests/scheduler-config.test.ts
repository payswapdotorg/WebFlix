/**
 * R12 — the playback scheduler config surface (pure validation tests).
 *
 * "plain typed config with validation, no hidden magic": defaults are the
 * exported constants, partial configs fall back honestly, malformed
 * values are typed rejections — never silently coerced.
 */

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_PLAYBACK_SCHEDULER_CONFIG,
  validatePlaybackSchedulerConfig,
} from "../src/scheduler/config";

describe("R12 — the playback scheduler config surface", () => {
  it("the defaults are the documented three knobs", () => {
    expect(DEFAULT_PLAYBACK_SCHEDULER_CONFIG).toEqual({
      startupTargetSeconds: 8,
      steadyRunwaySeconds: 30,
      seekBurstPieces: 8,
    });
  });

  it("undefined answers the pure defaults (a fresh copy)", () => {
    const result = validatePlaybackSchedulerConfig(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(DEFAULT_PLAYBACK_SCHEDULER_CONFIG);
    expect(result.value).not.toBe(DEFAULT_PLAYBACK_SCHEDULER_CONFIG); // a copy
  });

  it("a partial config falls back to validated defaults for omitted fields", () => {
    const result = validatePlaybackSchedulerConfig({ seekBurstPieces: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startupTargetSeconds).toBe(8);
    expect(result.value.steadyRunwaySeconds).toBe(30);
    expect(result.value.seekBurstPieces).toBe(3);
  });

  it("a complete config round-trips its values", () => {
    const result = validatePlaybackSchedulerConfig({
      startupTargetSeconds: 2.5,
      steadyRunwaySeconds: 120,
      seekBurstPieces: 16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      startupTargetSeconds: 2.5,
      steadyRunwaySeconds: 120,
      seekBurstPieces: 16,
    });
  });

  it("startupTargetSeconds must be finite > 0 (typed rejections, no coercion)", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validatePlaybackSchedulerConfig({ startupTargetSeconds: bad });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.detail).toContain("startupTargetSeconds");
    }
    const stringResult = validatePlaybackSchedulerConfig({
      startupTargetSeconds: "8" as unknown as number,
    });
    expect(stringResult.ok).toBe(false);
  });

  it("steadyRunwaySeconds must be finite > 0 (typed rejections)", () => {
    for (const bad of [0, -0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const result = validatePlaybackSchedulerConfig({ steadyRunwaySeconds: bad });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.detail).toContain("steadyRunwaySeconds");
    }
  });

  it("seekBurstPieces must be a safe integer >= 1 (typed rejections)", () => {
    for (const bad of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validatePlaybackSchedulerConfig({ seekBurstPieces: bad });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.detail).toContain("seekBurstPieces");
    }
  });

  it("a non-object config is a typed rejection (total for garbage)", () => {
    for (const bad of [null, 42, "fast", true]) {
      const result = validatePlaybackSchedulerConfig(bad as never);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
    }
  });
});
