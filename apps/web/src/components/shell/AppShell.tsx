/**
 * @wfx/app-web — the persistent app shell (R07).
 *
 * The chrome every surface renders inside: a sticky top bar (logo, search,
 * the honest SESSION menu), the left navigation rail on desktop, the bottom
 * navigation bar on mobile, a skip-to-content link, and the footer. The
 * navigation mirrors the RUNTIME's surface vocabulary (home / watch /
 * shorts / search / library / settings — every `SurfaceId` has a route;
 * the mapping lives in `app/routing.ts`).
 *
 * SESSION HONESTY (the R07 product-framing law): the app is the WEB
 * ADAPTER of the Universal Entertainment OS — there is no Guest-only
 * framing. The session menu renders the honest signed-out/anonymous state
 * from `host/session.ts` (the R02 seam): "Signed out — anonymous session",
 * with the truth about the session id's durability. Nothing pretends to be
 * a profile.
 *
 * Server component: no client JS, no hooks — the session menu is a
 * `details`/`summary` disclosure and the search box is a plain `form`
 * (progressive enhancement; both are keyboard-operable for free).
 *
 * Accessibility laws: semantic landmarks (header/nav/main/footer), a skip
 * link, `aria-current="page"` on the active nav entry, 44px minimum
 * targets, visible focus rings (globals.css), and labeled controls.
 */

import type { JSX, ReactNode } from "react";

import type { WebSessionState } from "@/host/session";
import { surfaceHref, SHELL_SURFACE_NAV } from "@/app/routing";
import type { SurfaceId } from "@wfx/client-runtime";
import { Icon, type IconName } from "./Icon";
import { SearchBox } from "./SearchBox";
import { InstallPrompt } from "./InstallPrompt";
import { UpdatePrompt } from "./UpdatePrompt";
// R24-E — the play-intent recorder (the document-level listener that
// records the user's real play/switch clicks for the startup traces).
import { PlayIntentRecorder } from "./PlayIntentRecorder";
// R26-W2 — the artwork fallback controller (one island; every real
// artwork image on any surface falls back through it on load failure).
import { ArtworkFallback } from "@/components/cards/ArtworkFallback";

/** One shell navigation icon per surface (item surfaces are not in the shell nav). */
const SURFACE_ICONS: Readonly<Record<SurfaceId, IconName>> = {
  home: "home",
  watch: "film",
  shorts: "shorts",
  search: "search",
  item: "film",
  library: "library",
  settings: "settings",
};

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
  session,
  mainClass,
  children,
}: {
  /** The boot mode (badge honesty). */
  readonly mode: "fixtures" | "service";
  /** The ACTIVE surface id (aria-current), when the route is a surface route. */
  readonly active?: SurfaceId;
  /** The honest session state (the R02 seam's view). */
  readonly session: WebSessionState;
  /** Extra classes for the main region (e.g. the full-screen short feed). */
  readonly mainClass?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const badge = modeBadge(mode);
  const activeHref = active !== undefined ? surfaceHref(active) : undefined;
  return (
    <div className="wfx-shell" data-wfx-mode={mode}>
      <a className="wfx-skip-link" href="#wfx-main">
        Skip to content
      </a>
      {/* R26-W2 — the artwork fallback controller (ONE island for every
          surface's real source artwork: a failed artwork URL falls back to
          the typed placeholder that always renders beneath it). */}
      <ArtworkFallback />
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
          {/* R24-W2 — the search box with its suggestion island (the
              R24-C search-suggestions row: the title + by-meaning lanes
              under the box while typing — a hint, never a required step). */}
          <SearchBox />
        </div>
        <div className="wfx-topbar__side">
          <details className="wfx-avatar-menu">
            <summary className="wfx-avatar-menu__summary" aria-label="Session menu">
              <span className="wfx-avatar-menu__chip" aria-hidden="true">
                W
              </span>
              <span data-wfx-session-label>{session.label}</span>
            </summary>
            <div className="wfx-avatar-menu__panel">
              <p data-wfx-session-state>{session.description}</p>
              <p data-wfx-session-durability>
                Session stability:{" "}
                {session.sessionDurability === "browser-sessions"
                  ? "kept across browser sessions on this device"
                  : "kept for this server process (browser storage is not available)"}
              </p>
              <div className="wfx-avatar-menu__actions" data-wfx-session-actions>
                <a className="wfx-btn wfx-btn--sm" href="/settings?section=general" data-wfx-session-signin>
                  Sign in / Create a profile
                </a>
                <a className="wfx-disc__link" href="/settings?section=general" data-wfx-session-profile>
                  Profile &amp; identity settings
                </a>
              </div>
              <span className={badge.className}>{badge.text}</span>
            </div>
          </details>
        </div>
      </header>
      <div className="wfx-body">
        <nav className="wfx-rail" aria-label="Primary">
          {SHELL_SURFACE_NAV.map((entry) => {
            const href = surfaceHref(entry.surface);
            return (
              <a
                key={entry.surface}
                className="wfx-navlink"
                href={href}
                {...(activeHref === href ? { "aria-current": "page" as const } : {})}
              >
                <span className="wfx-navlink__icon">
                  <Icon name={SURFACE_ICONS[entry.surface]} />
                </span>
                <span>{entry.label}</span>
              </a>
            );
          })}
        </nav>
        <main className={`wfx-main${mainClass !== undefined ? ` ${mainClass}` : ""}`} id="wfx-main">
          {children}
          {/* R24-E — the play-intent recorder: the real play actions on
              every surface feed the startup telemetry (renders nothing). */}
          <PlayIntentRecorder />
        </main>
      </div>
      <nav className="wfx-bottomnav" aria-label="Primary mobile">
        {SHELL_SURFACE_NAV.map((entry) => {
          const href = surfaceHref(entry.surface);
          return (
            <a
              key={entry.surface}
              className="wfx-navlink"
              href={href}
              {...(activeHref === href ? { "aria-current": "page" as const } : {})}
            >
              <span className="wfx-navlink__icon">
                <Icon name={SURFACE_ICONS[entry.surface]} size={22} />
              </span>
              <span>{entry.label}</span>
            </a>
          );
        })}
      </nav>
      <footer className="wfx-footer">
        <p style={{ margin: 0 }}>
          WebFlix — the Universal Entertainment OS, web adapter. Content arrives through connected
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
