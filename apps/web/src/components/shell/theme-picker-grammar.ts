/**
 * @wfx/app-web — the theme picker's grammar module (R31, §G1 — the
 * bell-grammar.ts pattern: the pure laws, unit-provable).
 *
 * THE CORPUS LAW (GAP-CORPUS.md §1,
 * docs/parity-lab/r30/gap-captures/20260926-052954 — the picker
 * CAPTURED OPEN: g1-2-theme-picker.jpg [VLM-verified] + .html +
 * g1-targeted-2.json the attempt of record): the account menu's
 * Appearance row opens a SUB-PAGE of the same multi-page menu with
 * header "Appearance" + a back arrow icon (left), subtext "Setting
 * applies to this browser only", and EXACTLY 3 option rows in order:
 *
 * 1. "Use device theme"
 * 2. "Dark theme"
 * 3. "Light theme"
 *
 * …each 300x40 at the 40px vertical pitch; the row matching the theme
 * seam's STORED TRUTH carries a CHECKMARK ICON INSIDE A BOX to its left
 * (a check-in-box, NOT a radio dot — the corpus's explicit finding).
 *
 * THE TWO-LAYER TRUTH (the corpus's own finding: "the captured selected
 * state matches the account-menu row's own state label — the two-layer
 * truth: the menu row carries the STATE, the picker row carries the
 * CHECK"): the stored-truth read (`themeStateOfStored`) and the
 * stored-truth write (`storedThemeOfState`) are ONE seam — the same
 * `wfx-theme` localStorage key the boot law reads (no stored choice ⇒
 * the OS preference; "dark"/"light" when persisted). Selecting "Use
 * device theme" REMOVES the stored choice (the write law's null — the
 * boot law's device follow resumes); the live application derives from
 * the OS preference (`deviceThemeDerived` — the before-paint script's
 * own decision, never a second opinion).
 *
 * THE SUBTEXT'S TRUTH: "Setting applies to this browser only" — honestly
 * true of WebFlix's own persistence scope (localStorage is per-browser;
 * the setting is never a claim about the account).
 *
 * Pure module (no client/server directive — both sides import it).
 */

/** The theme seam's state vocabulary (the persisted choice or the device law). */
export type ThemeChoice = "device" | "dark" | "light";

/**
 * §G1 — the picker's three option rows, in the captured order
 * (GAP-CORPUS.md: "exactly 3 option rows, in order").
 */
export const THEME_PICKER_OPTIONS: readonly {
  readonly id: ThemeChoice;
  readonly label: string;
}[] = [
  { id: "device", label: "Use device theme" },
  { id: "dark", label: "Dark theme" },
  { id: "light", label: "Light theme" },
];

/**
 * The stored-truth READ: the `wfx-theme` key's value → the seam's state
 * ("dark"/"light" when persisted; anything else — absent, garbage — is
 * the device law, WebFlix's own boot default).
 */
export function themeStateOfStored(stored: string | null): ThemeChoice {
  return stored === "dark" || stored === "light" ? stored : "device";
}

/**
 * The stored-truth WRITE: the seam's state → what the `wfx-theme` key
 * must carry afterwards. "device" → NULL (the stored choice is REMOVED —
 * the boot law's OS-preference follow resumes on the next load; the
 * corpus's own "Use device theme" semantics, never a third sentinel
 * value the boot script would have to know).
 */
export function storedThemeOfState(state: ThemeChoice): string | null {
  return state === "device" ? null : state;
}

/**
 * The DEVICE row's live application: the OS preference → the applied
 * theme (the before-paint script's own derivation —
 * `prefers-color-scheme: light` boots light, anything else keeps dark).
 */
export function deviceThemeDerived(prefersLight: boolean): "dark" | "light" {
  return prefersLight ? "light" : "dark";
}

/**
 * The account-menu row's state label (the corpus cross-cutting law: the
 * current theme state embedded in the row label — "Appearance: Device
 * theme" is the corpus's own captured state).
 */
export function appearanceStateLabel(state: ThemeChoice): string {
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
