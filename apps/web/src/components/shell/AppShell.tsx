/**
 * @wfx/app-web — the persistent app shell (R07; R27-W2 the YouTube
 * app-shell anatomy per docs/parity-lab/reference/app-shell.md).
 *
 * The chrome every surface renders inside — YouTube's masthead/rail/bottom
 * nav anatomy with WebFlix's honest surfaces:
 *
 * - TOPBAR 56px: hamburger (Guide — the GuideToggle island) + THE WEBFLIX
 *   WORDMARK (honest identity: our name, YouTube's placement/typography),
 *   the centered search pill (the SearchBox island), and the honest right
 *   cluster: create (＋) → the REAL BYOF entry (Settings → Sources), the
 *   SETTINGS GEAR (R29-B N24: the corpus multi-page menu — Your data /
 *   Appearance / Keyboard shortcuts / Settings, honestly wired), the
 *   corpus SIGN-IN PILL (R29-B N12: 40h r20 #065fd4 14/500 → the honest
 *   identity path), and the session avatar menu (the honest
 *   account/settings entry). NO bell (no notification transport — the
 *   DIVERGENCES law), NO mic (no voice-search transport).
 * - THE MINIPLAYER DOCK (R29-B N25): the persistent bottom-right
 *   floating player — mounted at the shell level so it survives every
 *   surface (renders nothing until a playback is docked).
 * - LEFT RAIL: the corpus groups — primary (Home · Shorts · Watch ·
 *   Library), divider, the "You" group (History · Offline · Settings —
 *   WebFlix's REAL surfaces; every unmapped YouTube destination is
 *   honestly absent, never a dead link), divider, the footnote. 240px
 *   labeled ≥1280 / 72px icon 792–1279 / drawer <1280 (the GuideToggle's
 *   overlay) / bottom nav <792 (4 items, 48px + safe-area).
 *
 * SESSION HONESTY (the R07 product-framing law, unchanged): the session
 * menu renders the honest signed-out/anonymous state from
 * `host/session.ts` — "Signed out — anonymous session", with the truth
 * about the session id's durability. Nothing pretends to be a profile.
 *
 * Server component: no client JS, no hooks — the session menu is a
 * `details`/`summary` disclosure; the GuideToggle + SettingsGear +
 * SearchBox are the small client islands. Accessibility laws: semantic
 * landmarks (header/nav/main/footer), a skip link, `aria-current="page"`
 * on the active nav entry, >=44px targets, visible focus rings
 * (globals.css), and labeled controls.
 */

import type { JSX, ReactNode } from "react";

import type { WebSessionState } from "@/host/session";
import type { AccountChromeView } from "@/host/account-chrome";
import { surfaceHref } from "@/app/routing";
import type { SurfaceId } from "@wfx/client-runtime";
import { Icon, type IconName } from "./Icon";
import { SearchBox } from "./SearchBox";
import { InstallPrompt } from "./InstallPrompt";
import { UpdatePrompt } from "./UpdatePrompt";
// R27-W2 — the guide (hamburger) island (the corpus masthead).
import { GuideToggle } from "./GuideToggle";
// R29-B (N24) — the SETTINGS GEAR island (the corpus multi-page menu:
// Your data / Appearance (the theme path — N15) / Keyboard shortcuts /
// Settings — replacing the abbreviated theme toggle button).
import { SettingsGear } from "./SettingsGear";
// R29-B (N25) — the persistent miniplayer dock island.
import { MiniplayerDock } from "./MiniplayerDock";
// R30-B (CORPUS §1/§2) — THE MASTHEAD NOTIFICATIONS BELL: the logged-in
// end cluster's bell button (40x40, the two-layer badge/title grammar
// bound to the real notification truth — the honest zero today).
import { MastheadBell } from "./MastheadBell";
// R30-B (CORPUS §3) — THE ACCOUNT MENU: the avatar dropdown's corpus
// 14-row grammar, mapped to WebFlix's real surfaces only.
import { AccountMenu } from "./AccountMenu";
// R30-B (CORPUS §4) — THE RAIL SUBSCRIPTIONS SECTION: the flat list of
// the REAL stored Subscriptions entries with the 24x24 avatars.
import { RailSubscriptions } from "./RailSubscriptions";
// R24-E — the play-intent recorder (the document-level listener that
// records the user's real play/switch clicks for the startup traces).
import { PlayIntentRecorder } from "./PlayIntentRecorder";
// R26-W2 — the artwork fallback controller (one island; every real
// artwork image on any surface falls back through it on load failure).
import { ArtworkFallback } from "@/components/cards/ArtworkFallback";
// R28-B — the hover preview singleton (the page's ONE preview overlay —
// the corpus `ytd-video-preview` grammar; the card triggers drive it).
import { HoverPreviewLayer } from "@/components/cards/HoverPreviewLayer";

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

/** One rail entry (a surface link + its corpus icon). */
interface RailEntry {
  readonly surface: SurfaceId;
  readonly label: string;
}

/** The PRIMARY group (the corpus order: Home · Shorts · the long-form browse · Library). */
const RAIL_PRIMARY: readonly RailEntry[] = [
  { surface: "home", label: "Home" },
  { surface: "shorts", label: "Shorts" },
  { surface: "watch", label: "Watch" },
  { surface: "library", label: "Library" },
];

/**
 * The "You" group (the corpus's You/library section, mapped to WebFlix's
 * REAL surfaces: History + Offline live in the Library routes; Settings
 * is the account/settings entry). R29-B (D8/N4) — THE HISTORY DEDUPE:
 * the group carries ONE History entry (the explicit link with its
 * Library?section=history href below); the duplicate top-level entry is
 * GONE. YouTube destinations WebFlix truthfully lacks (Subscriptions,
 * Playlists, Your videos, Explore, Premium…) are honestly ABSENT —
 * recorded in DIVERGENCES.
 */
const RAIL_YOU: readonly RailEntry[] = [
  { surface: "settings", label: "Settings" },
];

/** The bottom nav set (the corpus's 4 fixed items, honest mapping). */
const BOTTOMNAV: readonly RailEntry[] = [
  { surface: "home", label: "Home" },
  { surface: "shorts", label: "Shorts" },
  { surface: "watch", label: "Watch" },
  { surface: "library", label: "Library" },
];

/** The History entry's honest href (the Library's History section). */
const HISTORY_HREF = "/library?section=history";

/** The Offline entry's honest href (the real offline surface). */
const OFFLINE_HREF = "/offline";

/** The Playlists entry's honest href (the Library — where the playlists render). */
const PLAYLISTS_HREF = "/library";

/** Render one rail group's links (the labeled/icon forms answer in CSS). */
function RailLinks({
  entries,
  activeHref,
}: {
  readonly entries: readonly RailEntry[];
  readonly activeHref: string | undefined;
}): JSX.Element {
  return (
    <>
      {entries.map((entry) => {
        const href = surfaceHref(entry.surface);
        return (
          <a
            key={`${entry.surface}-${entry.label}`}
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
    </>
  );
}

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
  account,
  mainClass,
  guide = "default",
  children,
}: {
  /** The boot mode (badge honesty). */
  readonly mode: "fixtures" | "service";
  /** The ACTIVE surface id (aria-current), when the route is a surface route. */
  readonly active?: SurfaceId;
  /** The honest session state (the R02 seam's view). */
  readonly session: WebSessionState;
  /**
   * R30-B — the ACCOUNT CHROME view (the request's sign-in truth + the
   * rail subscriptions + the notification truth). When present AND
   * signed in, the masthead's end cluster renders the corpus LOGGED-IN
   * grammar (Create + gear + the notifications bell + the account-menu
   * avatar squircle; the sign-in pill is the LOGGED-OUT variant — CORPUS
   * §1's end cluster has no pill) and the rail carries the corpus
   * Subscriptions section (§4). Absent (or signed out): the current
   * R29-verified chrome, byte-identical — the pages that have not
   * adopted the seam keep their exact shell.
   */
  readonly account?: AccountChromeView;
  /** Extra classes for the main region (e.g. the full-screen short feed). */
  readonly mainClass?: string;
  /**
   * R29-B — the route's guide law: "default" renders the standard rail
   * (240px labeled ≥1280); "hidden" is the WATCH-page truth (the corpus
   * watch anatomy: the rail stays CLOSED on the watch surface — the
   * content spans the viewport; the hamburger opens the overlay drawer
   * at any width, YouTube's own watch behavior).
   */
  readonly guide?: "default" | "hidden";
  readonly children: ReactNode;
}): JSX.Element {
  const badge = modeBadge(mode);
  const activeHref = active !== undefined ? surfaceHref(active) : undefined;
  // R30-B — the corpus logged-in state: the account chrome view's sign-in
  // truth (the request's own answer — never the page's host guess).
  const signedIn = account?.session.signedIn === true;
  const accountSession = account?.session;
  return (
    <div className="wfx-shell" data-wfx-mode={mode} data-wfx-shell-guide={guide}>
      <a className="wfx-skip-link" href="#wfx-main">
        Skip to content
      </a>
      {/* R26-W2 — the artwork fallback controller (ONE island for every
          surface's real source artwork: a failed artwork URL falls back to
          the typed placeholder that always renders beneath it). */}
      <ArtworkFallback />
      {/* R28-B — the hover preview singleton layer (renders nothing until
          a card's dwell opens it; the element persists for reuse). */}
      <HoverPreviewLayer />
      <header className="wfx-topbar">
        <div className="wfx-topbar__side wfx-topbar__side--left">
          <GuideToggle />
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
        <div className="wfx-topbar__side wfx-topbar__side--right">
          {/* The honest create affordance: ＋ → the REAL BYOF entry
              (Settings → Sources — where the bring-your-own-feed flow
              lives). Never a dead upload imitation. */}
          <a
            className="wfx-topbar__guide"
            href="/settings?section=sources"
            aria-label="Add a feed (bring your own feed)"
            title="Bring your own feed — Settings, Sources"
            data-wfx-byof-entry
          >
            <Icon name="plus" size={22} />
          </a>
          {/* R29-B (N24) — THE SETTINGS GEAR: the corpus multi-page menu
              (Your data / Appearance › Dark-Light rows / Keyboard
              shortcuts › the real key sheet / Settings) — the theme's
              own corpus path lives inside (N15). R30-B: the gear stays in
              the signed-in cluster too (WebFlix's own verified surface —
              the corpus logged-in end cluster carries no gear; the
              divergence ledger records the keep). */}
          <SettingsGear />
          {signedIn ? (
            <>
              {/* R30-B (CORPUS §1) — THE NOTIFICATIONS BELL: the logged-in
                  end cluster's bell button (40x40) with the two-layer
                  badge/title grammar (bell-grammar.ts) bound to the REAL
                  notification truth — the honest zero (no notification
                  source on this host), so no badge paints and the title
                  stays un-prefixed (never a fabricated "9+"). */}
              <MastheadBell truth={account!.notifications} />
              {/* R30-B (CORPUS §1+§3) — THE AVATAR: the squircle-chip
                  account-menu trigger (the corpus rendered the avatar as
                  a squircle, not a circle) opening the corpus 14-row
                  account menu over WebFlix's real surfaces. */}
              <AccountMenu
                profileName={
                  accountSession?.profileName !== undefined && accountSession.profileName.length > 0
                    ? accountSession.profileName
                    : "Signed in"
                }
                {...(accountSession?.account?.email !== undefined
                  ? { identityEmail: accountSession.account.email }
                  : {})}
                profiles={accountSession?.account?.profiles ?? []}
                activeProfileId={accountSession?.account?.activeProfileId ?? ""}
                locale={account?.locale ?? "en"}
              />
            </>
          ) : (
            <>
              {/* R29-B (N12) — THE SIGN-IN PILL (the corpus anatomy: 40px
                  height, r20, #065fd4, 14px/500, border 1px rgba(0,0,0,0.2),
                  the person mark + "Sign in") wired to the REAL identity
                  path (Settings▸General — where the session truth + the
                  sign-in/profile controls live). The LOGGED-OUT variant —
                  CORPUS §1's logged-in end cluster replaces it with the
                  bell + avatar above. */}
              <a
                className="wfx-signin"
                href="/settings?section=general"
                data-wfx-signin
                title="Sign in — bring your history, watchlist, and profiles across devices"
              >
                <Icon name="person" size={22} />
                <span>Sign in</span>
              </a>
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
            </>
          )}
        </div>
      </header>
      <div className="wfx-body">
        <nav className="wfx-rail" aria-label="Primary">
          {/* The scrim the drawer state paints (click-through close —
              the GuideToggle island owns the state; the scrim is the
              honest way out for pointer users). */}
          <div className="wfx-rail__scrim" data-wfx-rail-scrim aria-hidden="true" />
          <div className="wfx-rail__inner">
            <div className="wfx-rail__group">
              <RailLinks entries={RAIL_PRIMARY} activeHref={activeHref} />
            </div>
            <div className="wfx-rail__divider" />
            {/* R30-B (CORPUS §4) — THE SUBSCRIPTIONS SECTION: the flat list
                of the REAL stored Subscriptions entries (the same library
                truth the Library page renders — the R30-A hydrate seam's
                fold), the 24x24 monogram avatars (the corpus-measured
                avatar grammar — this host's sources carry no channel
                photos), the entries 204x40 (the CSS seam), each row its
                own real player destination. Rendered only in the
                signed-in chrome (the corpus logged-in rail); the
                signed-out rail stays the current R29-verified state. */}
            {signedIn ? <RailSubscriptions entries={account!.railSubscriptions} /> : null}
            <div className="wfx-rail__divider" />
            <div className="wfx-rail__group">
              <h3 className="wfx-rail__heading">You</h3>
              <a className="wfx-navlink" href={HISTORY_HREF}>
                <span className="wfx-navlink__icon">
                  <Icon name="history" />
                </span>
                <span>History</span>
              </a>
              {/* R30-B (CORPUS §4 — the You group's Playlists row): the
                  corpus taxonomy's You section carries Playlists after
                  History; WebFlix's real destination is the Library page
                  (where the playlists section renders — the named lists
                  live there; no separate playlists route exists). */}
              <a className="wfx-navlink" href={PLAYLISTS_HREF}>
                <span className="wfx-navlink__icon">
                  <Icon name="library" />
                </span>
                <span>Playlists</span>
              </a>
              <a className="wfx-navlink" href={OFFLINE_HREF}>
                <span className="wfx-navlink__icon">
                  <Icon name="offline" />
                </span>
                <span>Offline</span>
              </a>
              <RailLinks entries={RAIL_YOU} activeHref={activeHref} />
            </div>
            <div className="wfx-rail__divider" />
            {/* R29-B (N13) — THE RAIL SIGN-IN PROMO (the corpus open-guide
                grammar: "Sign in to like videos, comment, and subscribe."
                + the pill) — wired to the REAL identity path, exactly the
                corpus's logged-out rail truth; never a dead promo. R30-B:
                the LOGGED-IN rail carries no promo (the corpus taxonomy);
                the signed-out rail keeps it byte-identical. */}
            {signedIn ? null : (
              <div className="wfx-rail__promo" data-wfx-rail-signin>
                <p>Sign in to like videos, comment, and subscribe.</p>
                <a
                  className="wfx-signin wfx-signin--rail"
                  href="/settings?section=general"
                  data-wfx-rail-signin-link
                >
                  <Icon name="person" size={20} />
                  <span>Sign in</span>
                </a>
              </div>
            )}
            <div className="wfx-rail__divider" />
            {/* R28-B — the install affordance lives in the rail now (the
                N28 fix: no in-page floating install chrome; the REAL
                deferred prompt stays one disclosure away, quiet-first).
                Service mode only, exactly as the WFX-057 law keeps it. */}
            {mode === "service" ? <InstallPrompt /> : null}
            <p className="wfx-rail__footnote">
              WebFlix — the Universal Entertainment OS, web adapter. Content arrives through
              connected sources; capability truth is always shown, never guessed.
            </p>
          </div>
        </nav>
        <main className={`wfx-main${mainClass !== undefined ? ` ${mainClass}` : ""}`} id="wfx-main">
          {children}
          {/* R24-E — the play-intent recorder: the real play actions on
              every surface feed the startup telemetry (renders nothing). */}
          <PlayIntentRecorder />
        </main>
      </div>
      <nav className="wfx-bottomnav" aria-label="Primary mobile">
        {BOTTOMNAV.map((entry) => {
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
        </>
      ) : null}
      {/* R29-B (N25) — the miniplayer dock (renders nothing until a
          playback is docked; persists across every surface). */}
      <MiniplayerDock />
    </div>
  );
}
