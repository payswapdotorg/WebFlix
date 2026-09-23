/**
 * @wfx/app-web — the offline route (WFX-057).
 *
 * The HONEST offline state: "You're offline — WebFlix needs a connection
 * to load your feeds. Your watch progress is safe." + a retry button. It
 * follows the StateViews grammar (icon / title / detail / action) in the
 * shell's visual language, but it is deliberately SELF-CONTAINED:
 *
 * - NO experience host boot — no environment read, no ports, no canon, no
 *   watch-state. It renders with zero configuration (a poisoned env cannot
 *   break it; machine-tested in tests/offline-page.test.ts), which is why
 *   this is the ONE static route in an otherwise all-dynamic app (see
 *   DEPLOYMENT.md "Installable surfaces"): the service worker precaches
 *   this build-time-known response at install and serves it as the only
 *   offline answer for navigations (never a stale cached feed).
 * - NO external chunk dependency for the promise: the page carries its own
 *   inline critical CSS (the design-system tokens re-declared — cited per
 *   rule) and its own inline retry script, so it renders styled and the
 *   retry works even when the service worker serves it with ZERO network
 *   and ZERO warm caches. The global stylesheet still links when cached
 *   (progressive enhancement).
 * - The retry is `location.reload()` ON PURPOSE: the service worker serves
 *   this page as the FALLBACK for a navigation, so the URL bar still shows
 *   the ORIGINAL destination — reloading re-attempts that destination
 *   through the network-first strategy.
 */

import type { JSX } from "react";

/**
 * Critical inline styles (the design system's tokens, cited):
 * background #0f0f0f = --wfx-bg (the R27 corpus sheet);
 * borders rgba(255,255,255,0.2) = --wfx-border; text
 * #f1f1f1/#aaaaaa = --wfx-text/--wfx-text-dim; accent #f03 =
 * --wfx-accent; radius/geometry per --wfx-radius/--wfx-topbar-h; focus
 * ring #3ea6ff = --wfx-focus. Scoped to this page's own classes so the
 * (optional, possibly-uncached) global stylesheet never changes the
 * offline promise.
 */
const OFFLINE_STYLE = `
:root { color-scheme: dark; }
.wfx-offline, .wfx-offline *, .wfx-offline *::before, .wfx-offline *::after { box-sizing: border-box; }
.wfx-offline { min-height: 100vh; display: flex; flex-direction: column; background: #0f0f0f; color: #f1f1f1;
  font-family: Roboto, Arial, Helvetica, sans-serif;
  -webkit-font-smoothing: antialiased; }
.wfx-offline__bar { display: flex; align-items: center; gap: 0.625rem; height: 56px; padding: 0 1rem;
  border-bottom: 1px solid rgba(255,255,255,0.2); }
.wfx-offline__mark { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  border-radius: 0.375rem; background: #f03; color: #fff; flex: none; }
.wfx-offline__word { font-weight: 700; font-size: 1.25rem; letter-spacing: -0.02em; }
.wfx-offline__main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.wfx-offline__state { display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
  max-width: 52ch; padding: 3.5rem 1.5rem; text-align: center; border: 1px dashed rgba(255,255,255,0.28);
  border-radius: 0.75rem; color: #aaaaaa; }
.wfx-offline__state-icon { display: inline-flex; width: 48px; height: 48px; align-items: center; justify-content: center;
  border-radius: 50%; background: rgba(255, 0, 51, 0.14); color: #f03; }
.wfx-offline__state-title { margin: 0; font-size: 1.05rem; font-weight: 700; color: #f1f1f1; }
.wfx-offline__state-detail { margin: 0; font-size: 0.85rem; line-height: 1.5; }
.wfx-offline__retry { display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  margin-top: 0.5rem; padding: 0 1.25rem; font: inherit; font-size: 0.9rem; font-weight: 600;
  border-radius: 18px; border: none; cursor: pointer; }
.wfx-offline__retry { background: #f1f1f1; color: #0f0f0f; }
.wfx-offline__retry:hover { background: #d9d9d9; }
.wfx-offline__retry:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
.wfx-offline__noscript { margin: 0; font-size: 0.8rem; color: #aaaaaa; }
.wfx-offline__footer { padding: 1rem; border-top: 1px solid rgba(255,255,255,0.2); color: #717171; font-size: 0.8rem; }
.wfx-offline__footer p { margin: 0; }
`;

/** The self-contained retry wiring (no chunk fetch, works on a cold cache). */
const OFFLINE_RETRY_SCRIPT = `
(function () {
  var button = document.getElementById("wfx-offline-retry");
  if (button) {
    button.addEventListener("click", function () { location.reload(); });
  }
})();
`;

export default function OfflinePage(): JSX.Element {
  return (
    <div className="wfx-offline" data-wfx-offline>
      <style dangerouslySetInnerHTML={{ __html: OFFLINE_STYLE }} />
      <header className="wfx-offline__bar">
        <span className="wfx-offline__mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />
          </svg>
        </span>
        <span className="wfx-offline__word">WebFlix</span>
      </header>
      <main className="wfx-offline__main" id="wfx-main">
        <div className="wfx-offline__state" role="status" data-wfx-offline-state>
          <span className="wfx-offline__state-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 9.5a15 15 0 0 1 19 0" />
              <path d="M5.5 13a10.5 10.5 0 0 1 13 0" />
              <path d="M8.5 16.5a6 6 0 0 1 7 0" />
              <path d="m3 3 18 18" />
            </svg>
          </span>
          <p className="wfx-offline__state-title">You&apos;re offline</p>
          <p className="wfx-offline__state-detail">
            WebFlix needs a connection to load your feeds. Your watch progress is safe — everything
            you watched while online is already recorded.
          </p>
          <button className="wfx-offline__retry" type="button" id="wfx-offline-retry" data-wfx-offline-retry>
            Try again
          </button>
          <noscript>
            <p className="wfx-offline__noscript">
              JavaScript is off — use your browser&apos;s refresh to try again.
            </p>
          </noscript>
        </div>
      </main>
      <footer className="wfx-offline__footer">
        <p>
          WebFlix — Universal Entertainment OS, web host. Content arrives through connected
          sources; capability truth is always shown, never guessed.
        </p>
      </footer>
      <script dangerouslySetInnerHTML={{ __html: OFFLINE_RETRY_SCRIPT }} />
    </div>
  );
}
