/**
 * WFX-040 parity invariant tests (bun:test).
 *
 * Machine-checks, pairwise across the THREE platforms (web / desktop /
 * mobile), that `assertParity` proves: identical API surfaces, identical
 * event vocabulary + deeply identical frozen events on identical fixtures,
 * and the identical typed error taxonomy — while the capability profiles
 * drive DIFFERENT resolver outcomes (the parity story: same calls, same
 * events, different honest capabilities).
 *
 * Includes a drift probe proving the helper actually CATCHES a drifted
 * surface (no vacuous green).
 */

import { describe, expect, it } from "bun:test";

import { makeFixturePorts } from "@wfx/experience";
import { stubEngine } from "@wfx/native-media";

import type { ClientRuntime } from "./runtime";
import { createClientRuntime } from "./runtime";
import { assertParity, REQUIRED_CLIENT_RUNTIME_SURFACE } from "./parity";
import { createDesktopPlatform, createMobilePlatform, createWebPlatform } from "./capabilities";

function bootWebRuntime(): ClientRuntime {
  return createClientRuntime(createWebPlatform(), makeFixturePorts());
}

function bootDesktopRuntime(): ClientRuntime {
  return createClientRuntime(createDesktopPlatform(), makeFixturePorts(), { engine: stubEngine() });
}

function bootMobileRuntime(): ClientRuntime {
  return createClientRuntime(createMobilePlatform(), makeFixturePorts(), {
    backgroundInputs: { networkClass: "cellular", charging: false },
  });
}

describe("WFX-040 parity invariant — three runtimes, same fixtures", () => {
  const pairs: readonly [string, () => ClientRuntime, () => ClientRuntime][] = [
    ["web ↔ desktop", bootWebRuntime, bootDesktopRuntime],
    ["web ↔ mobile", bootWebRuntime, bootMobileRuntime],
    ["desktop ↔ mobile", bootDesktopRuntime, bootMobileRuntime],
  ];

  for (const [label, bootA, bootB] of pairs) {
    it(`${label}: identical API surface, event vocabulary, and error taxonomy`, async () => {
      const report = await assertParity(bootA(), bootB());
      if (!report.ok) {
        throw new Error(`parity failed (${label}):\n- ${report.differences.join("\n- ")}`);
      }
      // The machine-checked core invariants, asserted explicitly:
      expect(report.surfaceA).toEqual(report.surfaceB);
      expect(report.surfaceA).toEqual([...REQUIRED_CLIENT_RUNTIME_SURFACE].sort());
      expect(report.eventVocabularyA).toEqual(["start", "like"]);
      expect(report.eventVocabularyB).toEqual(["start", "like"]);
      expect(report.errorReasonA).toBe("unresolvable");
      expect(report.errorReasonB).toBe("unresolvable");
    });
  }

  it("the capability profiles drive different resolver outcomes (parity is NOT uniformity)", async () => {
    // Web resolves the golden item to embed; desktop/mobile to native — on
    // IDENTICAL fixtures and events. Different capabilities, same API.
    const webVsDesktop = await assertParity(bootWebRuntime(), bootDesktopRuntime());
    expect(webVsDesktop.ok).toBe(true);
    expect(webVsDesktop.modeA).toBe("embed");
    expect(webVsDesktop.modeB).toBe("native");

    const webVsMobile = await assertParity(bootWebRuntime(), bootMobileRuntime());
    expect(webVsMobile.ok).toBe(true);
    expect(webVsMobile.modeA).toBe("embed");
    expect(webVsMobile.modeB).toBe("native");

    const desktopVsMobile = await assertParity(bootDesktopRuntime(), bootMobileRuntime());
    expect(desktopVsMobile.ok).toBe(true);
    expect(desktopVsMobile.modeA).toBe("native");
    expect(desktopVsMobile.modeB).toBe("native");
  });

  it("the helper CATCHES a drifted surface (no vacuous green)", async () => {
    const runtime = bootWebRuntime();
    // A drifted runtime: same ports, missing the `background` member.
    const drifted = { ...runtime } as Partial<ClientRuntime>;
    delete drifted.background;
    const report = await assertParity(drifted as ClientRuntime, bootWebRuntime());
    expect(report.ok).toBe(false);
    expect(
      report.differences.some((difference) => difference.includes("background")),
    ).toBe(true);
  });

  it("the helper reports runtimes not bound to fixture ports (never silently skipped)", async () => {
    const runtime = bootWebRuntime();
    const nonFixture = {
      ...runtime,
      ports: {
        connector: runtime.ports.connector,
        events: { emit: () => {} }, // NOT a RecordingEventSink
        clock: runtime.ports.clock,
        ids: runtime.ports.ids,
      },
    } as ClientRuntime;
    const report = await assertParity(nonFixture, bootWebRuntime());
    expect(report.ok).toBe(false);
    expect(
      report.differences.some((difference) =>
        difference.includes("not bound to fixture ports"),
      ),
    ).toBe(true);
  });

  it("a malformed context throws the typed misuse error", async () => {
    await expect(
      assertParity(bootWebRuntime(), bootWebRuntime(), {
        userId: "",
        sessionId: "s",
        locale: "en",
      }),
    ).rejects.toThrow();
  });
});
