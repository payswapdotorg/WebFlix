/**
 * WFX-057 install/update surface tests (bun:test).
 *
 * Drives the PURE logic the client islands bind to (pwa-logic.ts) plus the
 * island components' initial render through `renderToStaticMarkup` (the
 * repo's client-island test pattern — no jsdom):
 *
 * - the phase decision (`installSurfaceFor`): every honest branch — a REAL
 *   prompt offers, iOS gets the instruction sheet, everything else stays
 *   silent, standalone/dismissed/installed states hide the offer;
 * - display-mode detection with an INJECTED matchMedia;
 * - iOS UA-hint detection (incl. the iPadOS touch heuristic);
 * - dismissal memory with an injected storage (incl. failing storage:
 *   fails open, never silently kills the surface);
 * - event handling with REAL dispatched beforeinstallprompt/appinstalled
 *   events on an EventTarget (the same listeners the island attaches to
 *   the window);
 * - the service-worker registration law (production build + service mode
 *   only);
 * - the islands' SSR honesty: initial render is EMPTY (no offer until the
 *   client proves one), and the phase cards carry the a11y contract.
 *
 * Deterministic: fakes + pure functions. No network, no browser.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  INSTALL_DISMISSAL_KEY,
  attachInstallListeners,
  detectIOSUserAgent,
  installSurfaceFor,
  isStandaloneDisplay,
  readInstallDismissed,
  shouldRegisterServiceWorker,
  writeInstallDismissed,
  type MatchMediaLike,
  type StorageLike,
} from "../src/components/shell/pwa-logic";
import {
  InstallOfferCard,
  InstallPrompt,
  InstalledCard,
  IosInstructionsCard,
} from "../src/components/shell/InstallPrompt";
import { UpdatePrompt } from "../src/components/shell/UpdatePrompt";

/** A Map-backed localStorage fake. */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

/** A storage that THROWS (private mode / storage disabled). */
function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
}

/** A matchMedia fake that answers per query string. */
function fakeMatchMedia(answers: Record<string, boolean>): MatchMediaLike {
  return { matches: (query: string) => answers[query] === true };
}

describe("WFX-057 install phase decision (installSurfaceFor)", () => {
  it("offers ONLY when a real deferred prompt is stashed", () => {
    expect(
      installSurfaceFor({
        standalone: false,
        isIOS: false,
        promptAvailable: true,
        dismissed: false,
        installed: false,
      }),
    ).toBe("offer");
  });

  it("renders the honest instruction sheet ONLY on iOS without a prompt", () => {
    expect(
      installSurfaceFor({
        standalone: false,
        isIOS: true,
        promptAvailable: false,
        dismissed: false,
        installed: false,
      }),
    ).toBe("instructions");
    // A REAL prompt outranks the instruction sheet when one somehow exists.
    expect(
      installSurfaceFor({
        standalone: false,
        isIOS: true,
        promptAvailable: true,
        dismissed: false,
        installed: false,
      }),
    ).toBe("offer");
  });

  it("stays silent everywhere else — NO fake prompts", () => {
    // Desktop Safari / Firefox: no event, no iOS → nothing.
    expect(
      installSurfaceFor({
        standalone: false,
        isIOS: false,
        promptAvailable: false,
        dismissed: false,
        installed: false,
      }),
    ).toBe("idle");
  });

  it("hides the offer when running standalone (already an installed app)", () => {
    expect(
      installSurfaceFor({
        standalone: true,
        isIOS: true,
        promptAvailable: true,
        dismissed: false,
        installed: false,
      }),
    ).toBe("idle");
  });

  it("hides the offer after a remembered dismissal", () => {
    expect(
      installSurfaceFor({
        standalone: false,
        isIOS: true,
        promptAvailable: true,
        dismissed: true,
        installed: false,
      }),
    ).toBe("idle");
  });

  it("confirms on appinstalled (before hiding)", () => {
    expect(
      installSurfaceFor({
        standalone: false,
        isIOS: false,
        promptAvailable: false,
        dismissed: true,
        installed: true,
      }),
    ).toBe("installed");
  });
});

describe("WFX-057 display-mode detection (injected matchMedia)", () => {
  it("recognizes the standalone display mode", () => {
    expect(
      isStandaloneDisplay(fakeMatchMedia({ "(display-mode: standalone)": true }), undefined),
    ).toBe(true);
  });

  it("recognizes fullscreen and minimal-ui display modes", () => {
    expect(
      isStandaloneDisplay(fakeMatchMedia({ "(display-mode: fullscreen)": true }), undefined),
    ).toBe(true);
    expect(
      isStandaloneDisplay(fakeMatchMedia({ "(display-mode: minimal-ui)": true }), undefined),
    ).toBe(true);
  });

  it("browser display mode is NOT standalone", () => {
    expect(isStandaloneDisplay(fakeMatchMedia({}), undefined)).toBe(false);
  });

  it("honors iOS Safari's proprietary navigator.standalone", () => {
    // Older iOS does not implement the media query — the proprietary flag
    // is the signal.
    expect(isStandaloneDisplay(fakeMatchMedia({}), true)).toBe(true);
    expect(isStandaloneDisplay(fakeMatchMedia({}), false)).toBe(false);
  });
});

describe("WFX-057 iOS UA-hint detection", () => {
  it("matches iPhone / iPad / iPod user agents", () => {
    expect(
      detectIOSUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        5,
      ),
    ).toBe(true);
    expect(detectIOSUserAgent("Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X)", 5)).toBe(true);
  });

  it("matches iPadOS masquerading as Macintosh WITH touch points", () => {
    expect(
      detectIOSUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        5,
      ),
    ).toBe(true);
    // A real desktop Mac has no touch points.
    expect(
      detectIOSUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        0,
      ),
    ).toBe(false);
  });

  it("does not match Android or desktop browsers", () => {
    expect(
      detectIOSUserAgent(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36",
        5,
      ),
    ).toBe(false);
    expect(
      detectIOSUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        0,
      ),
    ).toBe(false);
  });
});

describe("WFX-057 dismissal memory (injected storage)", () => {
  it("round-trips an explicit dismissal under the versioned key", () => {
    const storage = memoryStorage();
    expect(readInstallDismissed(storage)).toBe(false);
    writeInstallDismissed(storage);
    expect(readInstallDismissed(storage)).toBe(true);
    // The honest key (not a fabricated boolean somewhere else):
    expect(storage.getItem(INSTALL_DISMISSAL_KEY)).toBe("1");
  });

  it("fails OPEN when storage throws (a hidden error never kills the surface)", () => {
    expect(readInstallDismissed(throwingStorage())).toBe(false);
    // And writing through a throwing storage does not throw.
    expect(() => writeInstallDismissed(throwingStorage())).not.toThrow();
  });
});

describe("WFX-057 install event handling (real dispatched events)", () => {
  it("beforeinstallprompt / appinstalled drive the handlers; detach stops them", () => {
    const target = new EventTarget();
    const seen: string[] = [];
    const detach = attachInstallListeners(target, {
      onBeforeInstallPrompt: () => {
        seen.push("beforeinstallprompt");
      },
      onAppInstalled: () => {
        seen.push("appinstalled");
      },
    });

    target.dispatchEvent(new Event("beforeinstallprompt"));
    target.dispatchEvent(new Event("appinstalled"));
    expect(seen).toEqual(["beforeinstallprompt", "appinstalled"]);

    detach();
    target.dispatchEvent(new Event("beforeinstallprompt"));
    target.dispatchEvent(new Event("appinstalled"));
    expect(seen).toEqual(["beforeinstallprompt", "appinstalled"]); // no more
  });
});

describe("WFX-057 service-worker registration law", () => {
  it("registers ONLY in a production build booted in service mode", () => {
    const yes = { enabled: true, serviceWorkerSupported: true, nodeEnv: "production" };
    expect(shouldRegisterServiceWorker(yes)).toBe(true);
    // Dev server (next dev): NODE_ENV is development — never register.
    expect(shouldRegisterServiceWorker({ ...yes, nodeEnv: "development" })).toBe(false);
    // Fixtures mode (the AppShell `enabled` signal false) — never register.
    expect(shouldRegisterServiceWorker({ ...yes, enabled: false })).toBe(false);
    // Browsers without service worker support — never register.
    expect(shouldRegisterServiceWorker({ ...yes, serviceWorkerSupported: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...yes, nodeEnv: undefined })).toBe(false);
  });
});

describe("WFX-057 island SSR honesty + phase cards", () => {
  it("InstallPrompt's initial (server) render is EMPTY — no offer until the client proves one", () => {
    const markup = renderToStaticMarkup(createElement(InstallPrompt));
    expect(markup).not.toContain("data-wfx-install-offer");
    expect(markup).not.toContain("data-wfx-install-ios");
    expect(markup).not.toContain("data-wfx-install-installed");
    expect(markup).not.toContain("Install WebFlix");
  });

  it("UpdatePrompt's initial (server) render is EMPTY", () => {
    const markup = renderToStaticMarkup(createElement(UpdatePrompt, { enabled: true }));
    expect(markup).not.toContain("data-wfx-update");
    expect(markup).not.toContain("Reload");
  });

  it("the offer card: real buttons, 44px system, dismissible, typed marker", () => {
    const markup = renderToStaticMarkup(
      createElement(InstallOfferCard, {
        onInstall: () => {},
        onDismiss: () => {},
      }),
    );
    expect(markup).toContain("data-wfx-install-offer");
    expect(markup).toContain("Install WebFlix");
    expect(markup).toContain('class="wfx-btn wfx-btn--primary wfx-btn--sm"');
    expect(markup).toContain("Not now");
    expect(markup).toContain("<button");
  });

  it("the iOS sheet: honest Share → Add to Home Screen steps, dismissible", () => {
    const markup = renderToStaticMarkup(createElement(IosInstructionsCard, { onDismiss: () => {} }));
    expect(markup).toContain("data-wfx-install-ios");
    expect(markup).toContain("Share");
    expect(markup).toContain("Add to Home Screen");
    expect(markup).toContain("Not now");
    expect(markup).toContain("<ol");
  });

  it("the installed confirmation card", () => {
    const markup = renderToStaticMarkup(createElement(InstalledCard));
    expect(markup).toContain("data-wfx-install-installed");
    expect(markup).toContain("WebFlix installed");
  });
});
