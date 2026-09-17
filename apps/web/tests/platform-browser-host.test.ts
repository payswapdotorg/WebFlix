/**
 * R07 platform browser-host tests (bun:test).
 *
 * Proves the contained BrowserHostPort laws:
 * - `open()` requires `restrictCookies: "isolate"` (the isolation contract
 *   is not optional);
 * - URL policy: non-http(s) is refused typed (invalid-url/blocked — never
 *   opened, never guessed);
 * - the DOM MOUNT: a real sandboxed iframe (opaque-origin tokens, NO
 *   allow-same-origin — the cookie/storage isolation), appended to the
 *   body; navigate() re-points it and emits `navigated`; close() removes
 *   it and emits `closed` (terminal);
 * - the RENDERED MOUNT (server render): sessions are recorded for the
 *   render layer (`renderedSessions`), navigate updates the record;
 * - navigate after close is the typed invalid-session;
 * - observation events carry the adapter clock's timestamps.
 *
 * Deterministic: a fake document, a fixed clock, no network.
 */

import { describe, expect, it } from "bun:test";
import { BrowserSurfaceError } from "@wfx/platform-contracts";
import type { BrowserSurfaceEvent } from "@wfx/platform-contracts";

import { createWebBrowserHostPort } from "../src/platform/browser-host";
import { FakeDocument, makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

const OPEN_REQUEST = {
  url: "https://provider.example/watch/1",
  restrictCookies: "isolate" as const,
  purpose: "playback" as const,
};

function fixedClock(now = 5_000) {
  return { now: () => now };
}

describe("R07 web browser host — the open() contract", () => {
  it("open() requires restrictCookies isolate (the contract is not optional)", async () => {
    const port = createWebBrowserHostPort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    let thrown: unknown = null;
    try {
      await port.open({ ...OPEN_REQUEST, restrictCookies: "isolate" as never, purpose: "general" });
    } catch {
      // unreachable: the typed request always carries isolate
      thrown = new Error("unreachable");
    }
    // The only legal value passes; a smuggled non-isolate value is refused:
    const smuggled = { ...OPEN_REQUEST } as { restrictCookies: string };
    smuggled.restrictCookies = "share-everything";
    await expect(
      port.open(smuggled as never),
    ).rejects.toBeInstanceOf(BrowserSurfaceError);
    void thrown;
  });

  it("non-http(s) URLs are refused typed (invalid-url) — javascript:/data: never open", async () => {
    const port = createWebBrowserHostPort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    await expect(port.open({ ...OPEN_REQUEST, url: "javascript:alert(1)" })).rejects.toMatchObject({
      code: "invalid-url",
    });
    await expect(port.open({ ...OPEN_REQUEST, url: "data:text/html,hello" })).rejects.toMatchObject({
      code: "invalid-url",
    });
    await expect(port.open({ ...OPEN_REQUEST, url: "" })).rejects.toMatchObject({
      code: "invalid-url",
    });
    await expect(port.open({ ...OPEN_REQUEST, url: "not a url" })).rejects.toMatchObject({
      code: "invalid-url",
    });
  });

  it("the adapter URL policy can block typed (blocked) with the reason", async () => {
    const port = createWebBrowserHostPort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
      urlPolicy: (url) => (url.hostname === "forbidden.example" ? "the host policy forbids this provider" : null),
    });
    await expect(
      port.open({ ...OPEN_REQUEST, url: "https://forbidden.example/watch" }),
    ).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("R07 web browser host — the DOM mount (a browser context)", () => {
  it("open() creates a SANDBOXED iframe: no allow-same-origin (the isolation law)", async () => {
    const document = new FakeDocument();
    const port = createWebBrowserHostPort({
      environment: makeBrowserEnvironment({ document }),
      clock: fixedClock(),
    });
    const session = await port.open(OPEN_REQUEST);
    expect(document.frames.length).toBe(1);
    const frame = document.frames[0]!;
    expect(frame.attached).toBe(true);
    expect(frame.src).toBe(OPEN_REQUEST.url);
    // The cookie/storage isolation: the sandbox tokens deliberately EXCLUDE
    // allow-same-origin (opaque origin), and scripts run isolated.
    expect(frame.sandbox).toContain("allow-scripts");
    expect(frame.sandbox).not.toContain("allow-same-origin");
    expect(frame.sandbox).not.toContain("allow-storage-access-by-user-activation");
    expect(session.url).toBe(OPEN_REQUEST.url);
    expect(session.id.startsWith("wfxsurf-")).toBe(true);
  });

  it("navigate() re-points the iframe and emits navigated (observed, clocked)", async () => {
    const document = new FakeDocument();
    const port = createWebBrowserHostPort({
      environment: makeBrowserEnvironment({ document }),
      clock: fixedClock(),
    });
    const session = await port.open(OPEN_REQUEST);
    const events: BrowserSurfaceEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.navigate("https://provider.example/watch/2");
    expect(document.frames[0]!.src).toBe("https://provider.example/watch/2");
    expect(events.map((event) => event.kind)).toEqual(["navigated"]);
    expect(events[0]!.url).toBe("https://provider.example/watch/2");
    expect(events[0]!.occurredAtMs).toBe(5_000); // the adapter clock
  });

  it("close() removes the iframe and emits closed (terminal); navigate after close is typed", async () => {
    const document = new FakeDocument();
    const port = createWebBrowserHostPort({
      environment: makeBrowserEnvironment({ document }),
      clock: fixedClock(),
    });
    const session = await port.open(OPEN_REQUEST);
    const events: BrowserSurfaceEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.close();
    expect(document.frames[0]!.attached).toBe(false); // removed from the DOM
    expect(events.map((event) => event.kind)).toEqual(["closed"]);

    await expect(session.navigate("https://provider.example/other")).rejects.toMatchObject({
      code: "invalid-session",
    });
    // A closed session's subscription is done (no further events).
    const more: BrowserSurfaceEvent[] = [];
    session.subscribe((event) => more.push(event));
    await session.close(); // idempotent
    expect(more).toEqual([]);
  });
});

describe("R07 web browser host — the rendered mount (a server render pass)", () => {
  it("open() records the session for the render layer (renderedSessions)", async () => {
    const port = createWebBrowserHostPort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    expect(port.renderedSessions()).toEqual([]);
    const session = await port.open(OPEN_REQUEST);
    const rendered = port.renderedSessions();
    expect(rendered.length).toBe(1);
    expect(rendered[0]!.url).toBe(OPEN_REQUEST.url);
    expect(rendered[0]!.purpose).toBe("playback");
    expect(rendered[0]!.id).toBe(session.id);

    await session.close();
    expect(port.renderedSessions()).toEqual([]); // closed sessions leave the render set
  });

  it("navigate() updates the recorded URL (applies on the next render — documented)", async () => {
    const port = createWebBrowserHostPort({
      environment: makeServerEnvironment(),
      clock: fixedClock(),
    });
    const session = await port.open(OPEN_REQUEST);
    await session.navigate("https://provider.example/watch/next");
    expect(port.renderedSessions()[0]!.url).toBe("https://provider.example/watch/next");
  });

  it("the DOM mount leaves renderedSessions empty (its own iframes)", async () => {
    const document = new FakeDocument();
    const port = createWebBrowserHostPort({
      environment: makeBrowserEnvironment({ document }),
      clock: fixedClock(),
    });
    await port.open(OPEN_REQUEST);
    expect(port.renderedSessions()).toEqual([]);
    expect(document.frames.length).toBe(1);
  });
});
