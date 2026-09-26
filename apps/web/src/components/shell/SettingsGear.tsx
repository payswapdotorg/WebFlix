"use client";

/**
 * @wfx/app-web — THE SETTINGS GEAR (R29-B, N24 — the corpus
 * FEATURE-INVENTORY.md masthead gear anatomy, honestly wired).
 *
 * THE CORPUS CHROME: the masthead's settings gear opens the multi-page
 * menu — Your data / Appearance (Light↔Dark) / Display language /
 * Restricted Mode / Location / Keyboard shortcuts / Settings / Help /
 * Send feedback — with subpages behind the rows (Appearance: the
 * Dark/Light rows; the shortcuts sheet).
 *
 * THE HONEST CONTENT LAW (the frozen law, both directions): a row
 * renders ONLY when a real surface backs it —
 * - YOUR DATA → the Settings▸General surface (WebFlix's session/data
 *   truth: the capability table + the session durability disclosure);
 * - APPEARANCE → the theme seam's own subpage (Dark/Light rows — the
 *   R28-B seam: `data-theme` + the persisted `wfx-theme` choice + the
 *   theme-color meta kept in sync — the N15 corpus path, replacing the
 *   abbreviated toggle button);
 * - KEYBOARD SHORTCUTS → the real transport key sheet (the player's
 *   own grammar — every listed key is really bound on the player
 *   surface);
 * - SETTINGS → the settings surface itself.
 * The corpus's other rows (DISPLAY LANGUAGE / RESTRICTED MODE /
 * LOCATION / HELP / SEND FEEDBACK) have NO real backing on this host —
 * no language packs, no content-restriction engine, no location
 * signal, no help surface, no feedback transport — they are honestly
 * ABSENT, named by the menu's own absence note, never a dead
 * imitation.
 *
 * The popup adopts the corpus paper-menu anatomy (the raised surface,
 * r12, the corpus dialog shadow — the share panel's own family).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
// R30-B — the shared real key sheet (the extraction: the gear's own rows
// + rendering, verbatim — the account menu's Keyboard-shortcuts row and
// the gear's subpage now open the ONE truth).
import { ShortcutsSheetBody } from "@/components/shell/ShortcutsSheet";

/** The theme vocabulary (the seam's own). */
type Theme = "dark" | "light";

/** Apply a theme choice through the ONE seam (dataset + storage + meta). */
function applyTheme(next: Theme): void {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("wfx-theme", next);
  } catch {
    // The persistence seam is unavailable (private mode) — the choice
    // still applies for this view; the default returns next load.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.setAttribute("content", next === "light" ? "#ffffff" : "#0f0f0f");
}

/** Read the CURRENT theme from the document (the seam's truth, never a guess). */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The gear menu: the corpus multi-page popup (level 1 + the Appearance and Shortcuts subpages). */
export function SettingsGear(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"root" | "appearance" | "shortcuts">("root");
  const [theme, setTheme] = useState<Theme>("dark");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Sync with the seam's applied choice whenever the menu opens.
  useEffect(() => {
    if (open) {
      setTheme(currentTheme());
      setPage("root");
    }
  }, [open]);

  // Close on Escape (the keyboard path) + outside click (the pointer path).
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

  const chooseTheme = useCallback((next: Theme): void => {
    applyTheme(next);
    setTheme(next);
  }, []);

  return (
    <div className="wfx-gear" ref={rootRef} data-wfx-gear={open ? "open" : "closed"}>
      <button
        type="button"
        className="wfx-topbar__guide"
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings"
        title="Settings"
        data-wfx-gear-button
      >
        <Icon name="settings" size={22} />
      </button>
      {open ? (
        <div className="wfx-gear__panel" role="menu" aria-label="Settings menu" data-wfx-gear-panel>
          {page === "root" ? (
            <>
              <a className="wfx-gear__row" role="menuitem" href="/settings?section=general" data-wfx-gear-item="your-data">
                Your data
              </a>
              <button
                type="button"
                className="wfx-gear__row"
                role="menuitem"
                onClick={() => {
                  setPage("appearance");
                }}
                data-wfx-gear-item="appearance"
              >
                <span>Appearance</span>
                <span className="wfx-gear__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                type="button"
                className="wfx-gear__row"
                role="menuitem"
                onClick={() => {
                  setPage("shortcuts");
                }}
                data-wfx-gear-item="shortcuts"
              >
                <span>Keyboard shortcuts</span>
                <span className="wfx-gear__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <a className="wfx-gear__row" role="menuitem" href="/settings" data-wfx-gear-item="settings">
                Settings
              </a>
              {/* The honest-absence note (the frozen law: no dead
                  imitations of the corpus's other rows — this host
                  carries no language packs, content restrictions,
                  location signal, help surface, or feedback transport
                  to wire them to). */}
              <p className="wfx-gear__absence" data-wfx-gear-absent>
                Display language, Restricted Mode, Location, Help, and Send feedback stay absent —
                this host carries no language packs, content restrictions, location signal, help
                surface, or feedback transport to wire them to.
              </p>
            </>
          ) : null}
          {page === "appearance" ? (
            <>
              <div className="wfx-gear__subhead">
                <button
                  type="button"
                  className="wfx-gear__back"
                  aria-label="Back"
                  onClick={() => {
                    setPage("root");
                  }}
                  data-wfx-gear-back
                >
                  ‹
                </button>
                <span>Appearance</span>
              </div>
              <button
                type="button"
                className={`wfx-gear__row${theme === "dark" ? " wfx-gear__row--active" : ""}`}
                role="menuitemradio"
                aria-checked={theme === "dark"}
                onClick={() => {
                  chooseTheme("dark");
                }}
                data-wfx-appearance="dark"
              >
                <span>Dark theme</span>
                {theme === "dark" ? <Icon name="check" size={18} /> : null}
              </button>
              <button
                type="button"
                className={`wfx-gear__row${theme === "light" ? " wfx-gear__row--active" : ""}`}
                role="menuitemradio"
                aria-checked={theme === "light"}
                onClick={() => {
                  chooseTheme("light");
                }}
                data-wfx-appearance="light"
              >
                <span>Light theme</span>
                {theme === "light" ? <Icon name="check" size={18} /> : null}
              </button>
              <p className="wfx-gear__absence">
                The choice applies app-wide and persists on this device — with no stored choice the
                boot follows your operating system&apos;s preference.
              </p>
            </>
          ) : null}
          {page === "shortcuts" ? (
            <>
              <div className="wfx-gear__subhead">
                <button
                  type="button"
                  className="wfx-gear__back"
                  aria-label="Back"
                  onClick={() => {
                    setPage("root");
                  }}
                  data-wfx-gear-back
                >
                  ‹
                </button>
                <span>Keyboard shortcuts</span>
              </div>
              <ShortcutsSheetBody />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
