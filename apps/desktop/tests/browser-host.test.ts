/**
 * R08 — the native BrowserHost (contained webview surface) tests.
 *
 * Open/navigate/close + observation, the mandatory cookie isolation
 * (per-surface jars, never shared), typed surface failures, and the
 * security boundary (navigation observed, never steered).
 */

import { describe, expect, it } from "bun:test";

import { BrowserSurfaceError } from "@wfx/platform-contracts";

import { SimShell } from "./shell-simulator";
import { createShellBrowserHostPort } from "../src/platform/browser-host";

describe("R08 — the desktop contained browser host", () => {
  it("opens a surface at the provider URL and observes navigation (never steers)", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    const surface = await host.open({
      url: "https://provider.example/watch/1",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    const observed: { kind: string; url: string | undefined }[] = [];
    surface.subscribe((event) => observed.push({ kind: event.kind, url: event.url }));
    await surface.navigate("https://provider.example/watch/1/next");
    expect(observed).toEqual([
      { kind: "navigated", url: "https://provider.example/watch/1/next" },
    ]);
    await surface.close();
    expect(observed[observed.length - 1]?.kind).toBe("closed");
  });

  it("the cookie-isolation contract is not optional: non-isolate requests are refused before the shell", async () => {
    const host = createShellBrowserHostPort(new SimShell());
    const nonIsolated = {
      url: "https://provider.example/",
      restrictCookies: "shared",
      purpose: "general",
    } as unknown as Parameters<typeof host.open>[0];
    const thrown = await host.open(nonIsolated).catch((error: unknown) => error);
    expect(thrown instanceof BrowserSurfaceError).toBe(true);
    expect((thrown as BrowserSurfaceError).code).toBe("invalid-session");
    expect((thrown as BrowserSurfaceError).detail).toContain("cookie-isolation contract is not optional");
  });

  it("each surface session has its OWN cookie jar — provider cookies never cross sessions", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    const first = await host.open({
      url: "https://provider.example/a",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    const second = await host.open({
      url: "https://provider.example/b",
      restrictCookies: "isolate",
      purpose: "authorization",
    });
    await first.navigate("https://provider.example/a/deep");
    await second.navigate("https://provider.example/b/deep");
    const firstJar = shell.surfaceCookieJar(first.id);
    const secondJar = shell.surfaceCookieJar(second.id);
    expect(firstJar?.get("provider.example")).toBeDefined();
    expect(secondJar?.get("provider.example")).toBeDefined();
    // Isolation: the two jars hold DIFFERENT entries (never shared state).
    expect(firstJar?.get("provider.example")).not.toBe(secondJar?.get("provider.example"));
  });

  it("a non-http(s) URL rejects with the typed invalid-url error", async () => {
    const host = createShellBrowserHostPort(new SimShell());
    const thrown = await host
      .open({ url: "file:///etc/passwd", restrictCookies: "isolate", purpose: "general" })
      .catch((error: unknown) => error);
    expect(thrown instanceof BrowserSurfaceError).toBe(true);
    expect((thrown as BrowserSurfaceError).code).toBe("invalid-url");
  });

  it("the shell's own policy refusal surfaces as the typed blocked error with the reason", async () => {
    const shell = new SimShell();
    shell.blockedUrlPattern = /forbidden\.example/;
    const host = createShellBrowserHostPort(shell);
    const thrown = await host
      .open({ url: "https://forbidden.example/x", restrictCookies: "isolate", purpose: "general" })
      .catch((error: unknown) => error);
    expect(thrown instanceof BrowserSurfaceError).toBe(true);
    expect((thrown as BrowserSurfaceError).code).toBe("blocked");
    expect((thrown as BrowserSurfaceError).detail).toContain("policy refuses");
  });

  it("navigating a closed surface rejects with the typed invalid-session error", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    const surface = await host.open({
      url: "https://provider.example/",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    await surface.close();
    const thrown = await surface.navigate("https://provider.example/late").catch((error: unknown) => error);
    expect(thrown instanceof BrowserSurfaceError).toBe(true);
    expect((thrown as BrowserSurfaceError).code).toBe("invalid-session");
  });

  it("closing twice is a no-op (surface events stop at the first close)", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    const surface = await host.open({
      url: "https://provider.example/",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    const events: string[] = [];
    surface.subscribe((event) => events.push(event.kind));
    await surface.close();
    await surface.close();
    expect(events).toEqual(["closed"]);
  });

  it("surface events stop after unsubscribe", async () => {
    const shell = new SimShell();
    const host = createShellBrowserHostPort(shell);
    const surface = await host.open({
      url: "https://provider.example/",
      restrictCookies: "isolate",
      purpose: "playback",
    });
    const events: string[] = [];
    const unsubscribe = surface.subscribe((event) => events.push(event.kind));
    await surface.navigate("https://provider.example/one");
    unsubscribe();
    await surface.navigate("https://provider.example/two");
    expect(events).toEqual(["navigated"]);
  });
});
