/**
 * WFX-040 shared client-runtime tests (bun:test).
 *
 * The runtime façade golden flows PER PLATFORM (feed → playback → library →
 * action), the error-taxonomy passthrough, the resolver trace differences
 * per profile (web: native skipped with reason; desktop: native chosen when
 * the engine port is present), the background adaptation on mobile, the
 * engine capability-honesty gate, and determinism.
 */

import { describe, expect, it } from "bun:test";

import type { PlaybackMode } from "@wfx/domain";

import type { ConnectorPort, ExperienceContext, FixturePorts, Ports } from "@wfx/experience";
import { ExperienceError, makeFixturePorts } from "@wfx/experience";
import { stubEngine } from "@wfx/native-media";

import {
  createClientRuntime,
  type ClientRuntime,
} from "./runtime";
import {
  createDesktopPlatform,
  createMobilePlatform,
  createWebPlatform,
} from "./capabilities";

const ctx: ExperienceContext = {
  userId: "wfx-runtime-test-user",
  sessionId: "wfx-runtime-test-session",
  locale: "en",
};

function bootWeb(): { runtime: ClientRuntime; ports: FixturePorts } {
  const ports = makeFixturePorts();
  return { runtime: createClientRuntime(createWebPlatform(), ports), ports };
}

function bootDesktop(): { runtime: ClientRuntime; ports: FixturePorts } {
  const ports = makeFixturePorts();
  return {
    runtime: createClientRuntime(createDesktopPlatform(), ports, { engine: stubEngine() }),
    ports,
  };
}

function bootDesktopEngineless(): ClientRuntime {
  return createClientRuntime(createDesktopPlatform(), makeFixturePorts());
}

function bootMobile(
  inputs?: { networkClass: "wifi" | "cellular"; charging: boolean },
): { runtime: ClientRuntime; ports: FixturePorts } {
  const ports = makeFixturePorts();
  const runtime =
    inputs === undefined
      ? createClientRuntime(createMobilePlatform(), ports)
      : createClientRuntime(createMobilePlatform(), ports, { backgroundInputs: inputs });
  return { runtime, ports };
}

async function firstCard(runtime: ClientRuntime) {
  const page = await runtime.getFeed(ctx, "watch", "drift");
  const card = page.cards[0];
  if (card === undefined) throw new Error("golden fixture produced no watch cards");
  return card;
}
// ---------------------------------------------------------------------------
// Golden flows per platform
// ---------------------------------------------------------------------------

describe("WFX-040 runtime façade — golden flows per platform", () => {
  const platforms: readonly [string, () => { runtime: ClientRuntime; ports: FixturePorts }, PlaybackMode][] = [
    ["web", bootWeb, "embed"],
    ["desktop", bootDesktop, "native"],
    ["mobile", () => bootMobile({ networkClass: "wifi", charging: true }), "native"],
  ];

  for (const [label, boot, expectedMode] of platforms) {
    it(`${label}: feed → playback → library → action through the SAME façade`, async () => {
      const { runtime, ports } = boot();

      // Feed: typed data through the WFX-005 use-case.
      const page = await runtime.getFeed(ctx, "watch", "drift");
      expect(page.surface).toBe("watch");
      const card = await firstCard(runtime);
      expect(card.item.canonicalTitle).toBe("Asteroid Drift");

      // Playback: device-gated through WFX-025, then the WFX-005 session.
      const started = await runtime.startPlayback(ctx, {
        item: card.item,
        externalRef: card.realization.externalRef,
      });
      if (!started.ok) throw new Error(`${label} playback failed: ${started.reason}`);
      expect(started.mode).toBe(expectedMode);
      expect(started.value.realization.mode).toBe(expectedMode);
      expect(started.value.resumePositionMs).toBe(0);
      expect(started.value.id).toMatch(/^wfxpses_/);
      // One audit line per frozen playback mode.
      expect(started.precedenceTrace).toHaveLength(4);

      // Library: typed passthrough of the WFX-005 use-case.
      const library = await runtime.library(ctx);
      if (!library.ok) throw new Error(`${label} library failed: ${library.reason}`);
      expect(library.value.map((entry) => entry.title)).toContain("Asteroid Drift");

      // Actions: receipt + the mirrored frozen engagement event.
      const like = await runtime.actions(ctx, {
        type: "like",
        connectorId: card.realization.connectorId,
        externalRef: card.realization.externalRef,
        itemId: card.item.id,
      });
      if (!like.ok) throw new Error(`${label} action failed: ${like.reason}`);
      expect(like.value.status).toBe("confirmed");
      // The event vocabulary of the golden flow — identical on every platform.
      expect(ports.events.events.map((event) => event.type)).toEqual(["start", "like"]);
    });
  }

  it("the short surface feeds through the same façade (content-driven eligibility)", async () => {
    const { runtime } = bootWeb();
    const page = await runtime.getFeed(ctx, "short", "rain");
    expect(page.surface).toBe("short");
    // "rain" hits shorts + a horizontal doc; only the short-form qualify here.
    const titles = page.cards.map((card) => card.item.canonicalTitle);
    expect(titles).toContain("Neon Rain");
    expect(titles).not.toContain("Desert Rain Doc");
  });
});

// ---------------------------------------------------------------------------
// Resolver trace differences per profile
// ---------------------------------------------------------------------------

describe("WFX-040 resolver trace differences per profile", () => {
  it("web: native is skipped with a recorded capability reason; embed wins", async () => {
    const { runtime } = bootWeb();
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`web playback failed: ${started.reason}`);
    expect(started.mode).toBe("embed");
    const nativeLine = started.precedenceTrace.find((line) => line.startsWith("native:"));
    expect(nativeLine).toBe(
      "native: rejected — device cannot realize native playback (canPlay=false; device declares [embed, browser, external]; browser surface: yes)",
    );
  });

  it("desktop: native is chosen when the engine port is present", async () => {
    const { runtime } = bootDesktop();
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`desktop playback failed: ${started.reason}`);
    expect(started.mode).toBe("native");
    expect(started.precedenceTrace.find((line) => line.startsWith("native:"))).toContain(
      "native: accepted",
    );
  });

  it("desktop WITHOUT an engine: native is honestly removed from the effective device", async () => {
    const runtime = bootDesktopEngineless();
    expect(runtime.engine).toBeUndefined();
    expect(runtime.profile.device.playbackModes).toContain("native");
    expect(runtime.device.playbackModes).not.toContain("native");
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    if (!started.ok) throw new Error(`engine-less desktop playback failed: ${started.reason}`);
    expect(started.mode).toBe("embed");
    expect(started.precedenceTrace.find((line) => line.startsWith("native:"))).toContain(
      "native: rejected — device cannot realize native playback",
    );
  });

  it("a caller-chosen native realization is capability-gated on web (no silent pass)", async () => {
    const { runtime } = bootWeb();
    const card = await firstCard(runtime);
    const nativeRealization = {
      mode: "native" as const,
      connectorId: card.realization.connectorId,
      externalRef: card.realization.externalRef,
      capabilities: ["playNative"],
    };
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      realization: nativeRealization,
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.reason).toBe("unresolvable");
      expect(started.detail).toContain("device cannot realize native playback");
    }
    // The same chosen realization plays on desktop (engine present).
    const { runtime: desktop } = bootDesktop();
    const desktopStarted = await desktop.startPlayback(ctx, {
      item: card.item,
      realization: nativeRealization,
    });
    if (!desktopStarted.ok) throw new Error(`desktop chosen-realization failed: ${desktopStarted.reason}`);
    expect(desktopStarted.mode).toBe("native");
  });

  it("surface() is pure and deterministic on identical inputs (injected clock only)", async () => {
    const { runtime } = bootWeb();
    const card = await firstCard(runtime);
    const realizations = await runtime.ports.connector.resolve(ctx, card.realization.externalRef);
    const first = runtime.surface({ item: card.item, realizations });
    const second = runtime.surface({ item: card.item, realizations });
    expect(first).toEqual(second);
    if (first.ok) {
      expect(first.mode).toBe("embed");
      expect(first.precedenceTrace).toHaveLength(4);
    }
  });
});

// ---------------------------------------------------------------------------
// Error taxonomy passthrough (typed)
// ---------------------------------------------------------------------------

describe("WFX-040 runtime error taxonomy passthrough", () => {
  it("an unknown external ref ⇒ typed unresolvable", async () => {
    const { runtime } = bootWeb();
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: "wfx-runtime-missing",
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.reason).toBe("unresolvable");
      expect(started.detail).toContain("wfx-runtime-missing");
    }
  });

  it("a connector without play capabilities ⇒ typed unsupported", async () => {
    const ports = makeFixturePorts({ capabilities: ["catalogSearch", "metadata", "libraryRead"] });
    const runtime = createClientRuntime(createWebPlatform(), ports);
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.reason).toBe("unsupported");
      if (started.reason === "unsupported") {
        expect(started.capability).toBe("playNative");
        expect(started.detail).toContain(
          "declares none of playNative | playEmbed | playBrowser | playExternal",
        );
      }
    }
  });

  it("a port whose resolve rejects ⇒ typed port-failed", async () => {
    const base = makeFixturePorts();
    const broken: ConnectorPort = {
      descriptor: () => base.connector.descriptor(),
      search: (c, q) => base.connector.search(c, q),
      metadata: (c, r) => base.connector.metadata(c, r),
      resolve: async () => {
        throw new Error("fixture: resolve exploded");
      },
      executeAction: (c, a) => base.connector.executeAction(c, a),
    };
    const ports: Ports = { ...base, connector: broken };
    const runtime = createClientRuntime(createWebPlatform(), ports);
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.reason).toBe("port-failed");
      if (started.reason === "port-failed") {
        expect(started.operation).toBe("resolve");
        expect(started.detail).toContain("fixture: resolve exploded");
      }
    }
  });

  it("a port whose resolve returns a non-array ⇒ typed unresolvable", async () => {
    const base = makeFixturePorts();
    const broken: ConnectorPort = {
      descriptor: () => base.connector.descriptor(),
      search: (c, q) => base.connector.search(c, q),
      metadata: (c, r) => base.connector.metadata(c, r),
      resolve: async () => "not-an-array" as unknown as never[],
      executeAction: (c, a) => base.connector.executeAction(c, a),
    };
    const ports: Ports = { ...base, connector: broken };
    const runtime = createClientRuntime(createWebPlatform(), ports);
    const card = await firstCard(runtime);
    const started = await runtime.startPlayback(ctx, {
      item: card.item,
      externalRef: card.realization.externalRef,
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.reason).toBe("unresolvable");
      expect(started.detail).toContain("expected an array of PlaybackRealization");
    }
  });

  it("caller misuse throws the typed ExperienceError (never a generic crash)", async () => {
    const { runtime } = bootWeb();
    const card = await firstCard(runtime);
    // Neither a chosen realization nor an external ref.
    await expect(
      runtime.startPlayback(ctx, { item: card.item }),
    ).rejects.toBeInstanceOf(ExperienceError);
    // Malformed item.
    await expect(
      runtime.startPlayback(ctx, { item: null as never, externalRef: "fake:movie-1" }),
    ).rejects.toBeInstanceOf(ExperienceError);
    // Malformed ctx.
    await expect(
      runtime.startPlayback(
        { userId: "", sessionId: "s", locale: "en" },
        { item: card.item, externalRef: "fake:movie-1" },
      ),
    ).rejects.toBeInstanceOf(ExperienceError);
    // Malformed resume position.
    await expect(
      runtime.startPlayback(ctx, {
        item: card.item,
        externalRef: "fake:movie-1",
        resumePositionMs: -5,
      }),
    ).rejects.toBeInstanceOf(ExperienceError);
    // Malformed surface input container.
    expect(() => runtime.surface(null as never)).toThrow(ExperienceError);
  });
});

// ---------------------------------------------------------------------------
// Engine binding rules (capability honesty)
// ---------------------------------------------------------------------------

describe("WFX-040 engine binding rules", () => {
  it("binding the engine port on the web platform is rejected (browser-constrained)", () => {
    expect(() =>
      createClientRuntime(createWebPlatform(), makeFixturePorts(), { engine: stubEngine() }),
    ).toThrow(ExperienceError);
  });

  it("binding the engine port on mobile is rejected (OS platform media facilities)", () => {
    expect(() =>
      createClientRuntime(createMobilePlatform(), makeFixturePorts(), { engine: stubEngine() }),
    ).toThrow(ExperienceError);
  });

  it("malformed runtime inputs are rejected with the typed misuse error", () => {
    expect(() => createClientRuntime(null as never, makeFixturePorts())).toThrow(ExperienceError);
    expect(() =>
      createClientRuntime(createWebPlatform(), null as never),
    ).toThrow(ExperienceError);
    expect(() =>
      createClientRuntime(createWebPlatform(), makeFixturePorts(), {
        backgroundInputs: { networkClass: "ethernet", charging: true } as never,
      }),
    ).toThrow(ExperienceError);
  });
});

// ---------------------------------------------------------------------------
// Background adaptation through the runtime (mobile focus)
// ---------------------------------------------------------------------------

describe("WFX-040 runtime background decisions", () => {
  it("web pauses (browsers suspend background video)", () => {
    const decision = bootWeb().runtime.background();
    expect(decision.action).toBe("pause");
    expect(decision.reason).toContain("browsers suspend background video playback");
  });

  it("desktop continues (the reference full-power client)", () => {
    expect(bootDesktop().runtime.background().action).toBe("continue");
  });

  it("mobile adapts to the injected OS inputs (cellular ⇒ pause, wifi+charging ⇒ continue)", () => {
    expect(bootMobile({ networkClass: "cellular", charging: false }).runtime.background().action).toBe("pause");
    expect(bootMobile({ networkClass: "cellular", charging: true }).runtime.background().action).toBe("pause");
    expect(bootMobile({ networkClass: "wifi", charging: false }).runtime.background().action).toBe("pause");
    expect(bootMobile({ networkClass: "wifi", charging: true }).runtime.background().action).toBe("continue");
  });

  it("mobile without injected inputs pauses safe-side", () => {
    expect(bootMobile().runtime.background().action).toBe("pause");
  });
});

// ---------------------------------------------------------------------------
// Determinism (no randomness, no hidden state)
// ---------------------------------------------------------------------------

describe("WFX-040 runtime determinism", () => {
  it("two identically-built runtimes driven identically agree everywhere", async () => {
    const first = bootWeb();
    const second = bootWeb();
    const pageA = await first.runtime.getFeed(ctx, "watch", "drift");
    const pageB = await second.runtime.getFeed(ctx, "watch", "drift");
    expect(pageA).toEqual(pageB);

    const cardA = pageA.cards[0];
    const cardB = pageB.cards[0];
    if (cardA === undefined || cardB === undefined) throw new Error("fixture produced no cards");
    const startA = await first.runtime.startPlayback(ctx, { item: cardA.item, externalRef: cardA.realization.externalRef });
    const startB = await second.runtime.startPlayback(ctx, { item: cardB.item, externalRef: cardB.realization.externalRef });
    expect(startA).toEqual(startB);
    // The event streams are identical too (same fixtures, same call sequence).
    expect(first.ports.events.events).toEqual(second.ports.events.events);
  });
});
