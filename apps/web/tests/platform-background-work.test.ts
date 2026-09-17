/**
 * R07 platform background-work honesty tests (bun:test).
 *
 * Proves the honest `backgroundWork: "none"` law:
 * - the web bundle declares NONE and provides NO port (the truth law);
 * - `webBackgroundWorkUnsupported` answers the typed `unsupported-kind`
 *   with the limitation NAMED — never a silent drop, never a fake
 *   acceptance;
 * - the honest reason is user-facing (the settings surface renders it).
 *
 * Deterministic: pure functions, no OS, no timers.
 */

import { describe, expect, it } from "bun:test";

import {
  describeWebBackgroundWork,
  WEB_BACKGROUND_WORK_LIMITATION,
  webBackgroundWorkUnsupported,
} from "../src/platform/background-work";
import { createWebPlatformCapabilities } from "../src/platform/capabilities";
import { makeBrowserEnvironment } from "./fake-web";

const SAMPLE_TASK = {
  taskId: "wfx-task-1",
  kind: "acquisition" as const,
  label: "Acquire an authorized asset",
};

describe("R07 web background work — the honest none", () => {
  it("the bundle declares backgroundWork none and provides no port", () => {
    const bundle = createWebPlatformCapabilities({ environment: makeBrowserEnvironment({}) });
    expect(bundle.backgroundWork).toBe("none");
    expect(bundle.ports.backgroundWork).toBeNull();
  });

  it("a schedule request answers the typed unsupported-kind with the limitation named", () => {
    const outcome = webBackgroundWorkUnsupported(SAMPLE_TASK);
    if (outcome.accepted) throw new Error("the honest answer never accepts");
    expect(outcome.reason).toBe("unsupported-kind");
    expect(outcome.detail).toContain("wfx-task-1");
    expect(outcome.detail).toContain("NOT scheduled");
    expect(outcome.detail).toContain("browser tabs suspend");
  });

  it("the honest reason is stable and user-facing", () => {
    expect(describeWebBackgroundWork()).toBe(WEB_BACKGROUND_WORK_LIMITATION);
    expect(WEB_BACKGROUND_WORK_LIMITATION).toContain("Desktop-only");
    expect(WEB_BACKGROUND_WORK_LIMITATION.length).toBeGreaterThan(20);
  });
});
