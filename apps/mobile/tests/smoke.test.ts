/**
 * WFX-040 mobile client smoke test (bun:test).
 *
 * Proves the OS-constrained client boots the SAME shared runtime on the
 * Mobile capability profile and that background completion decisions
 * ADAPT to the injected OS inputs: under the wifi-only + charging-required
 * fixture constraints, a cellular / not-charging report surfaces the
 * typed PAUSE decision — and a wifi + charging report surfaces continue.
 */

import { describe, expect, it } from "bun:test";

import { FixtureLifecyclePort } from "@wfx/app-web";

import { bootMobileClient } from "../src/main";

const ctx = { userId: "wfx-mobile-smoke-user", sessionId: "wfx-mobile-smoke-session", locale: "en" };

describe("@wfx/app-mobile smoke (WFX-040)", () => {
  it("the mobile client boots the shared runtime on the mobile capability profile", () => {
    const client = bootMobileClient({ backgroundInputs: { networkClass: "wifi", charging: true } });
    expect(client.platform).toBe("mobile");
    expect(client.runtime.platform).toBe("mobile");
    // Native media via OS platform facilities: native IS declared, and the
    // desktop engine port is absent (typed — mobile never binds it).
    expect(client.runtime.profile.device.playbackModes).toContain("native");
    expect(client.runtime.engine).toBeUndefined();
    // Reduced cache ceiling, honestly recorded.
    expect(client.profile.adapter.storage.set("probe", "x").ok).toBe(true);
  });

  it("background completion adapts: wifi-only constraints + cellular fixture ⇒ typed pause decision surfaced", () => {
    const client = bootMobileClient({
      backgroundInputs: { networkClass: "cellular", charging: false },
    });

    // The runtime-level decision (the SAME call on every platform).
    const decision = client.runtime.background();
    expect(decision.action).toBe("pause");
    expect(decision.reason).toContain("cellular");
    expect(decision.reason).toContain("wifi");

    // The lifecycle wiring: an OS background transition SURFACES the typed
    // decision through the client (the platform lifecycle seam).
    const lifecycle = client.profile.adapter.lifecycle as FixtureLifecyclePort;
    expect(client.backgroundDecisions()).toHaveLength(0);
    lifecycle.emit("background");
    const surfaced = client.backgroundDecisions()[0];
    expect(surfaced).toBeDefined();
    expect(surfaced?.action).toBe("pause");
    expect(surfaced?.reason).toContain("cellular");
  });

  it("background completion adapts: wifi + charging inputs ⇒ continue", () => {
    const client = bootMobileClient({
      backgroundInputs: { networkClass: "wifi", charging: true },
    });
    const decision = client.runtime.background();
    expect(decision.action).toBe("continue");
    expect(decision.reason).toContain("wifi");

    const lifecycle = client.profile.adapter.lifecycle as FixtureLifecyclePort;
    lifecycle.emit("background");
    expect(client.backgroundDecisions()[0]?.action).toBe("continue");
  });

  it("charging-required constraints pause a wifi + not-charging device", () => {
    const client = bootMobileClient({
      backgroundInputs: { networkClass: "wifi", charging: false },
    });
    const decision = client.runtime.background();
    expect(decision.action).toBe("pause");
    expect(decision.reason).toContain("charging");
  });

  it("the same Experience API drives playback on mobile (native via OS facilities)", async () => {
    const client = bootMobileClient({
      backgroundInputs: { networkClass: "wifi", charging: true },
    });
    const page = await client.runtime.getFeed(ctx, "watch", "drift");
    const card = page.cards[0];
    if (card === undefined) throw new Error("smoke fixture produced no watch cards");
    const started = await client.runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`mobile playback failed: ${started.reason}`);
    // Mobile declares native and its fixture item carries no codec demands —
    // the frozen precedence picks native (backed by OS platform players).
    expect(started.mode).toBe("native");
  });
});
