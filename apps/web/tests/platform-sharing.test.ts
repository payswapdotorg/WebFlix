/**
 * R07 platform sharing-port tests (bun:test).
 *
 * Proves the share honesty laws:
 * - `canShare` answers truthfully for one request (a titleless request is
 *   not shareable; canShare:true when the API accepts);
 * - `share` distinguishes the typed outcomes honestly: a resolved handoff
 *   ⇒ `shared`; the user DISMISSING the sheet (`AbortError`) ⇒
 *   `dismissed` (NOT a failure); any other rejection ⇒ `failed` with the
 *   detail;
 * - an environment without `navigator.share` never gets this port (the
 *   bundle declares the capability absent — covered in the capabilities
 *   tests); the defensive no-API path answers honestly.
 *
 * Deterministic: fake navigator.share, no OS.
 */

import { describe, expect, it } from "bun:test";

import { createWebSharingPort } from "../src/platform/sharing";
import { makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

const REQUEST = { title: "Neon Rain", url: "https://webflix.example/item/1" };

describe("R07 web sharing port — canShare truth", () => {
  it("a titled request is shareable when the API accepts it", async () => {
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({
        share: async () => undefined,
        canShare: () => true,
      }),
    });
    expect(await port.canShare(REQUEST)).toBe(true);
  });

  it("a titleless request is not shareable (the typed shape law)", async () => {
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({ share: async () => undefined }),
    });
    expect(await port.canShare({ url: "https://webflix.example" } as never)).toBe(false);
  });

  it("a browser that reports not-shareable answers false", async () => {
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({
        share: async () => undefined,
        canShare: () => false,
      }),
    });
    expect(await port.canShare(REQUEST)).toBe(false);
  });
});

describe("R07 web sharing port — the typed outcomes", () => {
  it("a resolved handoff answers shared", async () => {
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({ share: async () => undefined }),
    });
    expect(await port.share(REQUEST)).toEqual({ outcome: "shared" });
  });

  it("the user DISMISSING the sheet answers dismissed — not a failure", async () => {
    const abort = Object.assign(new Error("The user aborted the share"), { name: "AbortError" });
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({
        share: async () => {
          throw abort;
        },
      }),
    });
    expect(await port.share(REQUEST)).toEqual({ outcome: "dismissed" });
  });

  it("a broken channel answers failed with the honest detail", async () => {
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({
        share: async () => {
          throw new TypeError("share is not permitted");
        },
      }),
    });
    const outcome = await port.share(REQUEST);
    expect(outcome.outcome).toBe("failed");
    expect((outcome as { detail: string }).detail).toContain("share is not permitted");
  });

  it("an unshareable request answers failed (never a fake handoff)", async () => {
    const port = createWebSharingPort({
      environment: makeBrowserEnvironment({
        share: async () => undefined,
        canShare: () => false,
      }),
    });
    const outcome = await port.share(REQUEST);
    expect(outcome.outcome).toBe("failed");
    expect((outcome as { detail: string }).detail).toContain("not shareable");
  });
});

describe("R07 web sharing port — the honest no-API defensive path", () => {
  it("an environment without navigator.share answers honestly (never a fake handoff)", async () => {
    // Defensive path: the bundle never constructs this port without the
    // API, but if reached it must answer honestly.
    const port = createWebSharingPort({ environment: makeServerEnvironment() });
    expect(await port.canShare(REQUEST)).toBe(false);
    const outcome = await port.share(REQUEST);
    expect(outcome).toEqual({
      outcome: "failed",
      detail: expect.stringContaining("not available"),
    });
  });
});
