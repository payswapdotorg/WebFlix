/**
 * WFX-040 desktop client smoke test (bun:test).
 *
 * Proves the REFERENCE full-power client boots the SAME shared runtime on
 * the Desktop capability profile, and that native-mode realizations are
 * SELECTABLE through the resolver's precedence trace WHEN the engine port is
 * present (the WFX-014 `stubEngine` fixture port) — and honestly rejected
 * when it is not.
 */

import { describe, expect, it } from "bun:test";

import { FIXTURE_CONNECTOR_ID, makeFixturePorts } from "@wfx/experience";

import { createClientRuntime, createDesktopPlatform } from "@wfx/app-web";

import { bootDesktopClient } from "../src/main";

const ctx = { userId: "wfx-desktop-smoke-user", sessionId: "wfx-desktop-smoke-session", locale: "en" };

async function firstWatchCard(runtime: ReturnType<typeof bootDesktopClient>["runtime"]) {
  const page = await runtime.getFeed(ctx, "watch", "drift");
  const card = page.cards[0];
  if (card === undefined) throw new Error("smoke fixture produced no watch cards");
  return card;
}

describe("@wfx/app-desktop smoke (WFX-040)", () => {
  it("the desktop client boots the shared runtime with an engine port bound", () => {
    const client = bootDesktopClient();
    expect(client.platform).toBe("desktop");
    expect(client.runtime.platform).toBe("desktop");
    // The reference full-power declaration stands: all four modes.
    expect(client.runtime.device.playbackModes).toEqual(["native", "embed", "browser", "external"]);
    // The engine port is present (the WFX-014 stub fixture — never production).
    expect(client.runtime.engine).toBeDefined();
    expect(typeof client.runtime.engine?.open).toBe("function");
  });

  it("native-mode realizations are selectable via the precedence trace when the engine port is present", async () => {
    const client = bootDesktopClient();
    const card = await firstWatchCard(client.runtime);

    const started = await client.runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`desktop playback failed: ${started.reason}`);

    // Full power: the frozen precedence's FIRST mode wins — native.
    expect(started.mode).toBe("native");
    expect(started.value.realization.mode).toBe("native");
    const nativeLine = started.precedenceTrace.find((line) => line.startsWith("native:"));
    expect(nativeLine).toBeDefined();
    expect(nativeLine).toContain("native: accepted");
    expect(nativeLine).toContain(FIXTURE_CONNECTOR_ID);
    // The lower-precedence modes are audited as skipped, never silently dropped.
    expect(started.precedenceTrace.find((line) => line.startsWith("embed:"))).toContain(
      "embed: skipped — precedence satisfied by 'native'",
    );
  });

  it("an engine-less desktop runtime honestly removes native from its effective device", async () => {
    const runtime = createClientRuntime(createDesktopPlatform(), makeFixturePorts());
    expect(runtime.engine).toBeUndefined();
    expect(runtime.device.playbackModes).toEqual(["embed", "browser", "external"]);

    const card = await firstWatchCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`engine-less desktop playback failed: ${started.reason}`);
    // No engine ⇒ no WebFlix-controlled media path ⇒ embed, with native
    // rejected BY CAPABILITY (recorded in the trace — no capability lies).
    expect(started.mode).toBe("embed");
    const nativeLine = started.precedenceTrace.find((line) => line.startsWith("native:"));
    expect(nativeLine).toContain("native: rejected — device cannot realize native playback");
  });
});
