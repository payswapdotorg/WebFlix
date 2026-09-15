/**
 * @wfx/app-web — the persistent app shell (WFX-051).
 *
 * The YouTube-like chrome every surface renders inside: a sticky top bar
 * (logo, search, avatar menu), a left navigation rail on desktop, a bottom
 * navigation bar on mobile, a skip-to-content link, and the footer with
 * the honest mode badge (fixtures/service — capability truth at the app
 * level). Server component: no client JS, no hooks — the avatar menu is a
 * `details`/`summary` disclosure and the search box is a plain `form`
 * (progressive enhancement; both are keyboard-operable for free).
 *
 * Accessibility laws (the packet's quality bar): semantic landmarks
 * (header/nav/main/footer), a skip link, `aria-current="page"` on the
 * active nav entry, 44px minimum targets, visible focus rings
 * (globals.css), and labeled controls.
 *
 * WFX-057: the PWA client islands mount here — the smallest surface
 * change that gives every booted page the install affordance + the
 * visible service-worker update flow (the same server-renders-client-
 * island pattern the shorts/actions surfaces use). Service mode only:
 * fixtures mode is dev-only content and never a PWA surface.
 */

import type { JSX, ReactNode } from "react";

import { Icon } from "./Icon";
import { InstallPrompt } from "./InstallPrompt";
import { UpdatePrompt } from "./UpdatePrompt";

/** One shell navigation entry. */
export interface NavEntry {
  readonly href: string;
  readonly label: string;
  readonly icon: "home" | "search" | "shorts" | "film";
}

/** The shell navigation (stable order; `active` marks `aria-current`). */
export const SHELL_NAV: readonly NavEntry[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/watch", label: "Watch", icon: "film" },
  { href: "/shorts", label: "Shorts", icon: "shorts" },
  { href: "/search", label: "Search", icon: "search" },
];

/** The boot mode badge text (capability honesty, visible chrome). */
function modeBadge(mode: "fixtures" | "service"): { text: string; className: string } {
  return mode === "fixtures"
    ? { text: "dev fixtures", className: "wfx-mode-badge wfx-mode-badge--fixtures" }
    : { text: "live service", className: "wfx-mode-badge wfx-mode-badge--service" };
}

/** Render the persistent shell around one page's content. */
export function AppShell({
  mode,
  active,
  mainClass,
  children,
}: {
  /** The boot mode (badge honesty). */
  readonly mode: "fixtures" | "service";
  /** The nav href that is current (aria-current), if any. */
  readonly active?: string;
  /** Extra classes for the main region (e.g. `"wfx-main--flush"` for the full-screen short feed). */
  readonly mainClass?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const badge = modeBadge(mode);
  return (
    <div className="wfx-shell" data-wfx-mode={mode}>
      <a className="wfx-skip-link" href="#wfx-main">
        Skip to content
      </a>
      <header className="wfx-topbar">
        <div className="wfx-topbar__side">
          <a className="wfx-logo" href="/" aria-label="WebFlix home">
            <span className="wfx-logo__mark">
              <Icon name="play" size={16} />
            </span>
            <span className="wfx-logo__word">WebFlix</span>
          </a>
          <span className={badge.className} data-wfx-mode-badge title="How this host booted (environment law)">
            {badge.text}
          </span>
        </div>
        <div className="wfx-topbar__center">
          <form className="wfx-search" action="/search" method="get" role="search">
            <input
              className="wfx-search__input"
              type="search"
              name="q"
              placeholder="Search your entertainment"
              aria-label="Search your entertainment"
              autoComplete="off"
            />
            <button className="wfx-search__submit" type="submit" aria-label="Search">
              <Icon name="search" size={18} />
            </button>
          </form>
        </div>
        <div className="wfx-topbar__side">
          <details className="wfx-avatar-menu">
            <summary className="wfx-avatar-menu__summary" aria-label="Account menu">
              <span className="wfx-avatar-menu__chip" aria-hidden="true">
                W
              </span>
              <span>Guest</span>
            </summary>
            <div className="wfx-avatar-menu__panel">
              <p>
                Anonymous session — the fixed 050 identity stopgap. Sign-in arrives with the auth
                lane (WFX-052 service).
              </p>
              <span className={badge.className}>{badge.text}</span>
            </div>
          </details>
        </div>
      </header>
      <div className="wfx-body">
        <nav className="wfx-rail" aria-label="Primary">
          {SHELL_NAV.map((entry) => (
            <a
              key={entry.href}
              className="wfx-navlink"
              href={entry.href}
              {...(active === entry.href ? { "aria-current": "page" as const } : {})}
            >
              <span className="wfx-navlink__icon">
                <Icon name={entry.icon} />
              </span>
              <span>{entry.label}</span>
            </a>
          ))}
        </nav>
        <main className={`wfx-main${mainClass !== undefined ? ` ${mainClass}` : ""}`} id="wfx-main">
          {children}
        </main>
      </div>
      <nav className="wfx-bottomnav" aria-label="Primary mobile">
        {SHELL_NAV.map((entry) => (
          <a
            key={entry.href}
            className="wfx-navlink"
            href={entry.href}
            {...(active === entry.href ? { "aria-current": "page" as const } : {})}
          >
            <span className="wfx-navlink__icon">
              <Icon name={entry.icon} size={22} />
            </span>
            <span>{entry.label}</span>
          </a>
        ))}
      </nav>
      <footer className="wfx-footer">
        <p style={{ margin: 0 }}>
          WebFlix — Universal Entertainment OS, web host. Content arrives through connected
          sources; capability truth is always shown, never guessed.
        </p>
      </footer>
      {mode === "service" ? (
        <>
          <UpdatePrompt enabled />
          <InstallPrompt />
        </>
      ) : null}
    </div>
  );
}
