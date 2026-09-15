/**
 * WFX-057 offline page tests (bun:test).
 *
 * Proves the offline route's TWO laws:
 *
 * 1. NO BOOT: the page renders with a poisoned environment — the same
 *    environment that makes a booted page fail loudly (service boot with
 *    a malformed WFX_API_BASE) leaves this page standing, because it
 *    never reads the environment, never boots the experience host, never
 *    touches ports. It is the one page the service worker can serve with
 *    zero network.
 * 2. SELF-CONTAINED: the markup carries its own inline critical styles
 *    and its own inline retry wiring (location.reload on click) — no
 *    external chunk is required for the promise to hold on a cold cache.
 *
 * Plus the honest copy (the packet's exact state text) and the
 * StateViews grammar (icon / title / detail / action).
 *
 * Deterministic: renderToStaticMarkup + controlled env. No network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import OfflinePage from "../src/app/offline/page";

/** Render the offline page under a poisoned environment (restored after). */
function renderOfflineUnderPoisonedEnv(): string {
  const names = ["WFX_DEV_FIXTURES", "WFX_API_BASE"];
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    // The combination that makes a booted page fail LOUDLY (the 050 boot
    // law): service boot with a malformed WFX_API_BASE — every booted
    // page would throw the typed HostConfigError naming the variable.
    process.env.WFX_API_BASE = "not a url at all";
    return renderToStaticMarkup(createElement(OfflinePage));
  } finally {
    for (const name of names) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("WFX-057 offline page (no boot, honest state)", () => {
  it("renders the honest offline copy with a retry affordance (StateViews grammar)", () => {
    const markup = renderOfflineUnderPoisonedEnv();
    expect(markup).toContain("data-wfx-offline");
    expect(markup).toContain("You&#x27;re offline");
    expect(markup).toContain("needs a connection to load your feeds");
    expect(markup).toContain("Your watch progress is safe");
    // The StateViews grammar: icon + title + detail + action.
    expect(markup).toContain("data-wfx-offline-state");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("data-wfx-offline-retry");
    expect(markup).toContain("Try again");
  });

  it("boots NO experience host — a poisoned environment cannot break it", () => {
    // The same env that throws HostConfigError on every booted page (the
    // machine-tested 050 law) leaves this page standing: it renders at all.
    expect(() => renderOfflineUnderPoisonedEnv()).not.toThrow();
  });

  it("is self-contained: inline critical styles + inline retry script (cold-cache safe)", () => {
    const markup = renderOfflineUnderPoisonedEnv();
    // The page carries its own styles (the design tokens re-declared) so
    // zero-network + zero-warm-caches still renders the identity.
    expect(markup).toContain("<style>");
    expect(markup).toContain("#0b0a10"); // --wfx-bg
    expect(markup).toContain("#f43f5e"); // --wfx-accent
    // The retry wiring is inline — no chunk fetch required.
    expect(markup).toContain("<script>");
    expect(markup).toContain('getElementById("wfx-offline-retry")');
    expect(markup).toContain("location.reload()");
  });

  it("renders the shell identity honestly (mark + wordmark + footer truth)", () => {
    const markup = renderOfflineUnderPoisonedEnv();
    expect(markup).toContain("WebFlix");
    expect(markup).toContain("capability truth is always shown, never guessed");
    // No mode badge — this page never booted, so there is no boot mode to
    // disclose (honest absence, not a fabricated one).
    expect(markup).not.toContain("data-wfx-mode-badge");
  });
});
