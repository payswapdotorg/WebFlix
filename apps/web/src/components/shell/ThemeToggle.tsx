"use client";

/**
 * @wfx/app-web — the theme seam's toggle (R27-W2).
 *
 * The honest dark/light control: YouTube's own appearance setting, in
 * WebFlix's grammar. The toggle flips `data-theme` on the document root
 * (the only seam globals.css reads — `html[data-theme="light"]` overrides
 * the dark-default tokens) and persists the choice to localStorage
 * (`wfx-theme`), where the layout's before-paint script picks it up on
 * the next load (no flash). Default stays DARK (the corpus law: YouTube's
 * dark is the product default). 40px target, visible focus ring, the
 * current theme's own icon + label.
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The theme vocabulary (the seam's own). */
type Theme = "dark" | "light";

/** Read the CURRENT theme from the document (the seam's truth, never a guess). */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The theme toggle island (renders in the topbar's right cluster). */
export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync with the before-paint script's applied choice at mount (the
  // server render stays dark — the default; the island catches up).
  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = useCallback((): void => {
    const next: Theme = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wfx-theme", next);
    } catch {
      // The persistence seam is unavailable (private mode) — the toggle
      // still applies for this view; the default returns next load.
    }
    setTheme(next);
  }, []);

  const light = theme === "light";
  return (
    <button
      type="button"
      className="wfx-topbar__guide"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={light}
      data-wfx-theme-toggle={theme}
      title={light ? "Appearance: light" : "Appearance: dark"}
    >
      <Icon name={light ? "moon" : "sun"} size={22} />
    </button>
  );
}
