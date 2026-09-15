/**
 * WFX-040 web client smoke test (bun:test), WFX-050 productionized.
 *
 * Proves the WEB shell boots the shared client runtime and that a feed
 * call returns TYPED data with browser-constrained realizations: native is
 * excluded by capability (the resolver rejects it with a recorded reason),
 * and the precedence trace carries that audit.
 *
 * WFX-050: ports are passed EXPLICITLY (the deterministic fixture bundle —
 * this is a test). The default-selection law (fixtures only behind
 * `WFX_DEV_FIXTURES=1`, otherwise the `WFX_API_BASE` service ports, else
 * a typed `HostConfigError`) is proven in `tests/host-boot.test.ts`.
 */

import { describe, expect, it } from "bun:test";

import { FIXTURE_CONNECTOR_ID, makeFixturePorts } from "@wfx/experience";

import { bootWebClient } from "../src/main";

const ctx = { userId: "wfx-web-smoke-user", sessionId: "wfx-web-smoke-session", locale: "en" };

describe("@wfx/app-web smoke (WFX-040)", () => {
  it("the web client boots the shared runtime on the web capability profile", () => {
    const client = bootWebClient({ ports: makeFixturePorts() });
    expect(client.platform).toBe("web");
    expect(client.runtime.platform).toBe("web");
    expect(client.runtime.profile.device.playbackModes).toEqual(["embed", "browser", "external"]);
    // Browser-constrained: no native media engine exists on this platform.
    expect(client.runtime.engine).toBeUndefined();
    // No contained in-app browser host on web — typed-absent, honestly.
    expect(client.profile.adapter.browser).toBeUndefined();
  });

  it("a feed call returns typed data through the same Experience API", async () => {
    const client = bootWebClient({ ports: makeFixturePorts() });
    const page = await client.runtime.getFeed(ctx, "watch", "drift");
    expect(page.surface).toBe("watch");
    const card = page.cards[0];
    expect(card).toBeDefined();
    expect(card?.item.canonicalTitle).toBe("Asteroid Drift");
    expect(card?.realization.connectorId).toBe(FIXTURE_CONNECTOR_ID);
    expect(card?.item.id).toMatch(/^wfxitm_[0-9A-Z]{26}$/);
  });

  it("playback resolves browser-constrained: native excluded by capability, trace recorded", async () => {
    const client = bootWebClient({ ports: makeFixturePorts() });
    const page = await client.runtime.getFeed(ctx, "watch", "drift");
    const card = page.cards[0];
    if (card === undefined) throw new Error("smoke fixture produced no watch cards");

    const started = await client.runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`web playback failed: ${started.reason}`);

    // The frozen precedence with a browser-constrained device: native is
    // rejected (undeclared — canPlay=false), embed wins.
    expect(started.mode).toBe("embed");
    expect(started.value.realization.mode).toBe("embed");
    const nativeLine = started.precedenceTrace.find((line) => line.startsWith("native:"));
    expect(nativeLine).toBeDefined();
    expect(nativeLine).toContain("native: rejected — device cannot realize native playback");
    expect(nativeLine).toContain("canPlay=false");
    // The remaining modes are audited too (accepted or skipped).
    expect(started.precedenceTrace.find((line) => line.startsWith("embed:"))).toContain(
      "embed: accepted",
    );
  });
});
