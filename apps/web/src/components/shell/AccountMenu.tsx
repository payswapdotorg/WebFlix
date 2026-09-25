"use client";

/**
 * @wfx/app-web — THE ACCOUNT MENU (R30-B, CORPUS §3 — the avatar
 * dropdown, docs/parity-lab/r30/lead-captures/CORPUS.md).
 *
 * THE CORPUS GRAMMAR (double-confirmed: run-1 + run-3 shots): the
 * header (channel avatar top-left, bold account name, handle, a "View
 * your channel" blue link) + the 14-row list with state-bearing labels,
 * top-right anchored, ~15-20% viewport width, tall. The captured rows
 * in exact order: Google Account / Switch account (right arrow) /
 * Sign out — divider — YouTube Studio / Purchases and memberships /
 * Your data in YouTube / Appearance: Device theme (right arrow) /
 * Display language: English (right arrow) / Restricted Mode: Off (right
 * arrow) / Location: Hong Kong (right arrow) / Keyboard shortcuts —
 * divider — Settings / Help / Send feedback.
 *
 * THE HONEST CONTENT LAW (the task's own frozen law): a row renders
 * ONLY where WebFlix's account model maps it to a REAL surface; every
 * unmapped row is named by the menu's own absence note (the gear's
 * pattern), never a dead imitation:
 *
 * - SWITCH ACCOUNT → REAL: the profiles list + the active selection +
 *   the REAL profile-switch write (`PUT /api/auth/select-profile` — the
 *   same seam the Settings surface's SessionControls performs; the
 *   typed failure renders verbatim, a success reloads from the
 *   server's honest next state);
 * - SIGN OUT → REAL: `POST /api/auth/logout` (the same seam, the same
 *   reload law);
 * - YOUR DATA (corpus row 6 "Your data in YouTube", the product name
 *   swapped per the identity law) → REAL: `/settings?section=general`
 *   (the session/data truth — the gear's own mapping);
 * - APPEARANCE: <state> → the REAL theme state, embedded in the label
 *   (the corpus cross-cutting law): "Device theme" with no stored
 *   choice (WebFlix's own boot law — the OS preference), "Dark theme"
 *   / "Light theme" when a choice is persisted. The THEME-PICKER
 *   SUBMENU ROWS stay CORPUS-PENDING (README's honest gap: never
 *   captured open — never built from memory; the row carries NO
 *   picker behind it);
 * - DISPLAY LANGUAGE: <state> → the session's REAL locale (the session
 *   context's law: env override, then navigator, then "en"), rendered
 *   as its own display name. No language picker exists (no language
 *   packs) — the row is a real STATE display, never a fake control;
 * - KEYBOARD SHORTCUTS → REAL: the shared key sheet (the player's own
 *   bound keys — the same sheet the gear opens);
 * - SETTINGS → REAL: `/settings`.
 * ABSENT (named in the absence note): Google Account (no
 * account-management surface beyond Settings), YouTube Studio,
 * Purchases and memberships, Restricted Mode (no content-restriction
 * engine — an "Off" state would fabricate an engine), Location (no
 * location signal — never a fabricated "Hong Kong"), Help, Send
 * feedback (the feedback fixtures are recommendation controls, not a
 * user-feedback transport), and the header's "View your channel" link
 * (no channel surface — content arrives through connected sources).
 *
 * The identity line: the corpus carries a handle ("@spartacus_payswap");
 * WebFlix's real identity datum is the account's EMAIL — rendered as
 * the honest stand-in (never a fabricated handle).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { ShortcutsSheetBody } from "@/components/shell/ShortcutsSheet";

/** The account menu's serialized input (the account-chrome view's own fields). */
export interface AccountMenuProps {
  /** The active profile's display name (the account's own truth). */
  readonly profileName: string;
  /** The account's email (the real identity line — the corpus handle slot's honest stand-in). */
  readonly identityEmail?: string;
  /** The account's profiles (the Switch account row's data). */
  readonly profiles: readonly { readonly id: string; readonly displayName: string }[];
  /** The session's active profile id. */
  readonly activeProfileId: string;
  /** The session's REAL locale code (the Display-language state label). */
  readonly locale: string;
}

/** The theme state vocabulary (the seam's own — the persisted choice or the device law). */
type ThemeState = "device" | "dark" | "light";

/** Read the theme seam's CURRENT state (the gear's own law, never a guess). */
function currentThemeState(): ThemeState {
  if (typeof localStorage === "undefined") return "device";
  try {
    const stored = localStorage.getItem("wfx-theme");
    return stored === "dark" || stored === "light" ? stored : "device";
  } catch {
    return "device";
  }
}

/** The Appearance row's state label (the corpus cross-cutting law: the state embedded in the label). */
function appearanceStateLabel(state: ThemeState): string {
  switch (state) {
    case "dark":
      return "Appearance: Dark theme";
    case "light":
      return "Appearance: Light theme";
    case "device":
      // The corpus's own captured state — WebFlix's default boot law (no
      // stored choice follows the OS preference).
      return "Appearance: Device theme";
  }
}

/** The Display-language row's state label (the real locale's own display name). */
export function displayLanguageLabel(locale: string): string {
  const code = locale.trim().split("-")[0] ?? "en";
  if (code.length === 0) return "Display language: en";
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    const name = names.of(code);
    if (name !== undefined && name.length > 0 && name.toLowerCase() !== code.toLowerCase()) {
      return `Display language: ${name}`;
    }
  } catch {
    // No Intl.DisplayNames in this context — the code itself is the honest label.
  }
  return `Display language: ${code}`;
}

/** One typed account write outcome (the SessionControls' own vocabulary). */
interface AccountWriteOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * THE PANEL CONTENT (§3) — exported as the sync presentational root
 * page so the row grammar is unit-provable (the island's open state +
 * subpages stay the browser-level truth, the gear's own pattern).
 */
export function AccountMenuPanel({
  profileName,
  identityEmail,
  locale,
  themeState,
  onOpenSwitch,
  onOpenShortcuts,
  onSignOut,
}: {
  /** The active profile's display name (the header's bold name). */
  readonly profileName: string;
  /** The account's email (the identity line — the corpus handle slot's honest stand-in). */
  readonly identityEmail?: string;
  /** The session's REAL locale code (the Display-language state label). */
  readonly locale: string;
  /** The theme state label's datum (the island syncs it on open — the gear's law). */
  readonly themeState: ThemeState;
  /** Open the Switch-account subpage (the island wires it). */
  readonly onOpenSwitch: () => void;
  /** Open the Keyboard-shortcuts subpage (the island wires it). */
  readonly onOpenShortcuts: () => void;
  /** Perform the Sign-out write (the island wires the REAL logout seam). */
  readonly onSignOut: () => void;
}): JSX.Element {
  const monogram = profileName.length > 0 ? profileName[0]!.toUpperCase() : "W";
  return (
    <div className="wfx-account" role="menu" aria-label="Account menu" data-wfx-account-panel>
      {/* THE HEADER (§3): the avatar + the bold name + the identity line.
          "View your channel" is honestly ABSENT (no channel surface) —
          named in the absence note below, never a dead link. */}
      <div className="wfx-account__head" data-wfx-account-head>
        <span className="wfx-account__avatar" aria-hidden="true">
          {monogram}
        </span>
        <p className="wfx-account__name" data-wfx-account-name>
          {profileName}
        </p>
        {identityEmail !== undefined ? (
          <p className="wfx-account__identity" data-wfx-account-identity>
            {identityEmail}
          </p>
        ) : null}
      </div>
      {/* Row 2 — SWITCH ACCOUNT (right arrow): the REAL profiles seam. */}
      <button
        type="button"
        className="wfx-account__row"
        role="menuitem"
        onClick={onOpenSwitch}
        data-wfx-account-item="switch-account"
      >
        <span>Switch account</span>
        <span className="wfx-account__chevron" aria-hidden="true">
          <Icon name="arrowRight" size={18} />
        </span>
      </button>
      {/* Row 3 — SIGN OUT: the REAL logout write (the island wires it). */}
      <button
        type="button"
        className="wfx-account__row"
        role="menuitem"
        onClick={onSignOut}
        data-wfx-account-item="sign-out"
      >
        Sign out
      </button>
      <div className="wfx-account__divider" />
      {/* Row 6 — YOUR DATA (the corpus "Your data in YouTube", the product
          name swapped per the identity law): the REAL session/data surface. */}
      <a
        className="wfx-account__row"
        role="menuitem"
        href="/settings?section=general"
        data-wfx-account-item="your-data"
      >
        Your data in WebFlix
      </a>
      {/* Row 7 — APPEARANCE: <state> (the corpus cross-cutting law: the
          state embedded in the label). A real STATE row — the
          theme-picker submenu stays CORPUS-PENDING (never captured
          open), so NO picker renders behind this row. */}
      <p className="wfx-account__row wfx-account__row--state" data-wfx-account-item="appearance">
        {appearanceStateLabel(themeState)}
      </p>
      {/* Row 8 — DISPLAY LANGUAGE: <state>: the session's REAL locale. A
          real STATE row — no language packs exist, so no picker renders. */}
      <p className="wfx-account__row wfx-account__row--state" data-wfx-account-item="language">
        {displayLanguageLabel(locale)}
      </p>
      {/* Row 11 — KEYBOARD SHORTCUTS: the REAL shared key sheet. */}
      <button
        type="button"
        className="wfx-account__row"
        role="menuitem"
        onClick={onOpenShortcuts}
        data-wfx-account-item="shortcuts"
      >
        Keyboard shortcuts
      </button>
      <div className="wfx-account__divider" />
      {/* Row 12 — SETTINGS: the REAL settings surface. */}
      <a className="wfx-account__row" role="menuitem" href="/settings" data-wfx-account-item="settings">
        Settings
      </a>
      {/* The honest-absence note (the frozen law: no dead imitations —
          this host carries no account-management page, no studio, no
          purchases, no restriction engine, no location signal, no help
          surface, no user-feedback transport, and no channel surface). */}
      <p className="wfx-account__absence" data-wfx-account-absent>
        Google Account, YouTube Studio, Purchases and memberships, Restricted Mode, Location, Help,
        and Send feedback stay absent — this host carries no account-management page, studio,
        purchases, content-restriction engine, location signal, help surface, or feedback
        transport to wire them to. No channel surface exists, so View your channel is absent too.
      </p>
    </div>
  );
}

/** The account menu island: the avatar trigger + the corpus panel + the real writes. */
export function AccountMenu(props: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"root" | "switch" | "shortcuts">("root");
  const [themeState, setThemeState] = useState<ThemeState>("device");
  const [outcome, setOutcome] = useState<AccountWriteOutcome | null>(null);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Sync with the theme seam's real state whenever the menu opens (the
  // gear's own law — never a guessed label).
  useEffect(() => {
    if (open) {
      setThemeState(currentThemeState());
      setPage("root");
      setOutcome(null);
    }
  }, [open]);

  // Close on Escape + outside click (the gear's own law).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        setPage("root");
      }
    };
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setPage("root");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  /** One account write through the REAL seams (the SessionControls' law: a
   * success reloads from the server's honest next state; a typed failure
   * renders verbatim — never a fake success). */
  const write = useCallback(
    async (path: string, method: "PUT" | "POST", body: unknown, label: string): Promise<void> => {
      setPending(true);
      try {
        const response = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          // The reload law (the SessionControls' own): the session cookie
          // is the carrier — the page re-renders from the server's honest
          // next state, never an optimistic swap.
          window.location.reload();
          return;
        }
        const result = (await response.json().catch(() => null)) as { detail?: string } | null;
        setOutcome({
          ok: false,
          detail: `${label} was refused${result?.detail !== undefined ? `: ${result.detail}` : ""} — nothing was changed.`,
        });
      } catch {
        setOutcome({
          ok: false,
          detail: `${label} could not reach the host — nothing was written.`,
        });
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const monogram = props.profileName.length > 0 ? props.profileName[0]!.toUpperCase() : "W";
  return (
    <div className="wfx-accountroot" ref={rootRef} data-wfx-account={open ? "open" : "closed"}>
      {/* THE TRIGGER (§1): the avatar button — the squircle chip (the
          corpus's rendered avatar shape, not a circle; the radius is not
          corpus-measured, the squircle grammar is). WebFlix's honest
          avatar: the monogram (the sources carry no account photo). The
          44px touch floor is WebFlix's own frozen a11y law (the corpus
          measured the YouTube button at 54x34 — recorded as divergence). */}
      <button
        type="button"
        className="wfx-account__trigger"
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu — signed in as ${props.profileName}`}
        title={`Account menu — ${props.profileName}`}
        data-wfx-account-trigger
      >
        <span className="wfx-account__triggeravatar" aria-hidden="true">
          {monogram}
        </span>
      </button>
      {open ? (
        <div className="wfx-account__panel">
          {page === "root" ? (
            <AccountMenuPanel
              profileName={props.profileName}
              {...(props.identityEmail !== undefined ? { identityEmail: props.identityEmail } : {})}
              locale={props.locale}
              themeState={themeState}
              onOpenSwitch={() => {
                setPage("switch");
              }}
              onOpenShortcuts={() => {
                setPage("shortcuts");
              }}
              onSignOut={() => {
                void write("/api/auth/logout", "POST", {}, "Signing out");
              }}
            />
          ) : null}
          {page === "switch" ? (
            <div className="wfx-account" role="menu" aria-label="Switch account" data-wfx-account-switch>
              <div className="wfx-account__subhead">
                <button
                  type="button"
                  className="wfx-gear__back"
                  aria-label="Back"
                  onClick={() => {
                    setPage("root");
                  }}
                  data-wfx-account-back
                >
                  ‹
                </button>
                <span>Switch account</span>
              </div>
              {/* The REAL profiles (the corpus's account list): the active
                  profile is marked; switching performs the REAL write. */}
              {props.profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className={`wfx-account__row${profile.id === props.activeProfileId ? " wfx-account__row--active" : ""}`}
                  role="menuitemradio"
                  aria-checked={profile.id === props.activeProfileId}
                  disabled={pending || profile.id === props.activeProfileId}
                  data-wfx-account-profile={profile.id}
                  onClick={() => {
                    void write(
                      "/api/auth/select-profile",
                      "PUT",
                      { profileId: profile.id },
                      `Switching to ${profile.displayName}`,
                    );
                  }}
                >
                  <span>{profile.displayName}</span>
                  {profile.id === props.activeProfileId ? (
                    <span className="wfx-account__watching" data-wfx-account-watching>
                      watching
                    </span>
                  ) : null}
                </button>
              ))}
              <p className="wfx-account__absence">
                Switching reloads from the server&apos;s honest next state — the session cookie is
                the carrier.
              </p>
            </div>
          ) : null}
          {page === "shortcuts" ? (
            <div className="wfx-account" data-wfx-account-shortcuts>
              <div className="wfx-account__subhead">
                <button
                  type="button"
                  className="wfx-gear__back"
                  aria-label="Back"
                  onClick={() => {
                    setPage("root");
                  }}
                  data-wfx-account-back
                >
                  ‹
                </button>
                <span>Keyboard shortcuts</span>
              </div>
              <ShortcutsSheetBody />
            </div>
          ) : null}
          {/* The typed write outcome (verbatim, never a fake success). */}
          {outcome !== null ? (
            <p className="wfx-account__outcome" role="alert" data-wfx-account-outcome>
              {outcome.detail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
