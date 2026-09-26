/**
 * R31 §G1 — THE THEME-PICKER SUBMENU tests (bun:test).
 *
 * The corpus-pending picker, now captured (GAP-CORPUS.md §1,
 * docs/parity-lab/r30/gap-captures/20260926-052954: g1-2-theme-picker.jpg
 * [VLM-verified] + .html + g1-targeted-2.json the attempt of record — the
 * REAL-mouse law at the Appearance row's label center), proven against
 * WebFlix's REAL theme seam:
 *
 * - THE GRAMMAR MODULE (theme-picker-grammar.ts — the bell-grammar
 *   pattern): the captured 3 option rows in order; the stored-truth
 *   read/write laws (the `wfx-theme` key — "device" WRITES null: the
 *   stored choice is REMOVED, the boot law's OS-preference follow
 *   resumes; "dark"/"light" persist); the state-label mapping; the
 *   device row's live derivation (the before-paint script's own law).
 * - THE PICKER PANEL (AppearancePickerPanel — the sync presentational
 *   export, the gear's own provability pattern): the header
 *   "Appearance" + the BACK ARROW icon button; the subtext "Setting
 *   applies to this browser only"; exactly 3 rows in the captured
 *   order; the SELECTED row per the theme seam's stored truth carries
 *   the BARE-CHECKMARK marker in its left slot (the captured DOM's
 *   single check path "M19.793 5.793 8.5 17.086l-4.293-4.293a1 1 0
 *   10-1.414 1.414L8.5 19.914 21.207 7.207a1 1 0 10-1.414-1.414Z",
 *   no box outline — never a radio dot; ADJUDICATED 2026-09-26 by the
 *   lead's three-read re-verification: the captured DOM + a fresh
 *   full-page VLM read + a 3x-zoomed crop read); the captured state
 *   ("Use device theme" selected with no stored choice) + the persisted
 *   states.
 * - THE ROOT ROW (AccountMenuPanel): the Appearance row ACTIVATES the
 *   picker (a menuitem button carrying the state label + §3's own
 *   right-arrow grammar — the subpage join; the Display-language row
 *   stays a pure state display).
 *
 * Determinism: pure modules + SSR composition, no network.
 */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  appearanceStateLabel,
  deviceThemeDerived,
  storedThemeOfState,
  themeStateOfStored,
  THEME_PICKER_OPTIONS,
} from "../src/components/shell/theme-picker-grammar";
import {
  AccountMenuPanel,
  AppearancePickerPanel,
} from "../src/components/shell/AccountMenu";

// ---------------------------------------------------------------------------
// The grammar module — the captured option set + the stored-truth laws
// ---------------------------------------------------------------------------

describe("R31 §G1 the picker grammar module (GAP-CORPUS: exactly 3 option rows, in order)", () => {
  it("the captured option rows: exactly 3, in the captured order, with the captured labels", () => {
    expect(THEME_PICKER_OPTIONS).toEqual([
      { id: "device", label: "Use device theme" },
      { id: "dark", label: "Dark theme" },
      { id: "light", label: "Light theme" },
    ]);
  });

  it("the stored-truth READ: the wfx-theme key maps to the seam's state (anything else = the device law)", () => {
    // The persisted choices.
    expect(themeStateOfStored("dark")).toBe("dark");
    expect(themeStateOfStored("light")).toBe("light");
    // No stored choice — WebFlix's own boot law (the OS preference).
    expect(themeStateOfStored(null)).toBe("device");
    // A garbage value is the device law, never a guess.
    expect(themeStateOfStored("garbage")).toBe("device");
    expect(themeStateOfStored("")).toBe("device");
  });

  it("the stored-truth WRITE: device REMOVES the stored choice (null — the boot law resumes); dark/light persist", () => {
    // The corpus's own "Use device theme" semantics: selecting the device
    // row clears the persisted choice — the next boot follows the OS
    // preference again (never a third sentinel value the boot script
    // would have to know).
    expect(storedThemeOfState("device")).toBeNull();
    expect(storedThemeOfState("dark")).toBe("dark");
    expect(storedThemeOfState("light")).toBe("light");
  });

  it("the round trip: write → read through the one seam agrees for every choice", () => {
    for (const option of THEME_PICKER_OPTIONS) {
      const stored = storedThemeOfState(option.id);
      expect(themeStateOfStored(stored)).toBe(option.id);
    }
  });

  it("the device row's live derivation follows the boot law (prefers-color-scheme: light boots light, else dark)", () => {
    expect(deviceThemeDerived(true)).toBe("light");
    expect(deviceThemeDerived(false)).toBe("dark");
  });

  it("the state label mapping (the corpus cross-cutting law — the captured state is Device theme)", () => {
    expect(appearanceStateLabel("device")).toBe("Appearance: Device theme");
    expect(appearanceStateLabel("dark")).toBe("Appearance: Dark theme");
    expect(appearanceStateLabel("light")).toBe("Appearance: Light theme");
  });
});

// ---------------------------------------------------------------------------
// The picker panel — the captured sub-page grammar
// ---------------------------------------------------------------------------

describe("R31 §G1 the picker panel (the captured sub-page: header + back arrow + subtext + 3 rows)", () => {
  function pickerOf(themeState: "device" | "dark" | "light"): string {
    return renderToStaticMarkup(
      createElement(AppearancePickerPanel, {
        themeState,
        onSelect: () => {},
        onBack: () => {},
      }),
    );
  }

  it("the header: 'Appearance' + the BACK ARROW icon button (aria-label='Back')", () => {
    const markup = pickerOf("device");
    expect(markup).toContain("data-wfx-theme-picker");
    expect(markup).toContain("data-wfx-theme-picker-head");
    expect(markup).toContain("Appearance");
    // The back button: the corpus's own control (the captured
    // ytd-simple-menu-header-renderer's back button, aria-label="Back").
    expect(markup).toContain('aria-label="Back"');
    expect(markup).toContain("data-wfx-theme-picker-back");
    // The back arrow is an ICON (the captured arrow-left glyph — the
    // svg rides the button, not a text chevron).
    expect(markup).toContain("data-wfx-theme-picker-back");
    const backButton = markup.slice(
      markup.indexOf("data-wfx-theme-picker-back"),
      markup.indexOf("</button>", markup.indexOf("data-wfx-theme-picker-back")),
    );
    expect(backButton).toContain("<svg");
  });

  it("the subtext: 'Setting applies to this browser only' (verbatim — the captured line)", () => {
    const markup = pickerOf("device");
    expect(markup).toContain("data-wfx-theme-picker-subtext");
    expect(markup).toContain("Setting applies to this browser only");
  });

  it("exactly 3 option rows, in the captured order, with the captured labels", () => {
    const markup = pickerOf("device");
    // Exactly 3 option rows render.
    const optionRows = markup.match(/data-wfx-theme-option="/g) ?? [];
    expect(optionRows.length).toBe(3);
    // The captured order: Use device theme → Dark theme → Light theme.
    const deviceAt = markup.indexOf('data-wfx-theme-option="device"');
    const darkAt = markup.indexOf('data-wfx-theme-option="dark"');
    const lightAt = markup.indexOf('data-wfx-theme-option="light"');
    expect(deviceAt).toBeGreaterThan(-1);
    expect(darkAt).toBeGreaterThan(deviceAt);
    expect(lightAt).toBeGreaterThan(darkAt);
    expect(markup).toContain("Use device theme");
    expect(markup).toContain("Dark theme");
    expect(markup).toContain("Light theme");
  });

  it("the captured selected state: no stored choice = 'Use device theme' selected, the bare checkmark to its left", () => {
    const markup = pickerOf("device");
    // The selected row: the captured state (the account runs the device
    // theme — no stored choice).
    expect(markup).toContain('data-wfx-theme-option="device" data-wfx-theme-selected="true"');
    expect(markup).toContain('aria-checked="true"');
    // Exactly ONE selected row (the other two are unchecked).
    const selected = markup.match(/data-wfx-theme-selected="true"/g) ?? [];
    expect(selected.length).toBe(1);
    const unchecked = markup.match(/aria-checked="false"/g) ?? [];
    expect(unchecked.length).toBe(2);
    // The BARE-CHECKMARK marker — ADJUDICATED 2026-09-26 (the lead's
    // three-read re-verification): the captured DOM's selected-row
    // content-icon carries a SINGLE check path ("M19.793 5.793 8.5
    // 17.086l-4.293-4.293a1 1 0 10-1.414 1.414L8.5 19.914 21.207 7.207
    // a1 1 0 10-1.414-1.414Z"), no rect anywhere in the 83KB picker
    // HTML, + a fresh full-page VLM read ("a bare checkmark with NO
    // surrounding box") + a 3x-zoomed crop read ("two distinct
    // strokes, no border/outline") — the corpus's original
    // "check-in-box" prose was the capture-time over-interpretation;
    // THE CAPTURE IS THE CONTRACT. The reserved 24px mark slot renders
    // on EVERY row (the captured label alignment); only the selected
    // row paints in it.
    const markSlots = markup.match(/class="wfx-picker__mark"/g) ?? [];
    expect(markSlots.length).toBe(3);
    expect(markup).toContain('d="m4.5 12.5 5 5 10-11"');
    expect(markup).not.toContain("<rect");
    // NEVER a radio dot: no circle glyph in the picker.
    expect(markup).not.toContain("<circle");
  });

  it("the persisted states: the stored truth selects Dark/Light (the two-layer truth — the row's CHECK follows the seam's state)", () => {
    for (const state of ["dark", "light"] as const) {
      const markup = pickerOf(state);
      expect(markup).toContain(`data-wfx-theme-option="${state}" data-wfx-theme-selected="true"`);
      const selected = markup.match(/data-wfx-theme-selected="true"/g) ?? [];
      expect(selected.length).toBe(1);
      // The bare checkmark paints on the persisted row too (no box
      // outline — the adjudicated capture grammar).
      expect(markup).toContain('d="m4.5 12.5 5 5 10-11"');
      expect(markup).not.toContain("<rect");
    }
  });
});

// ---------------------------------------------------------------------------
// The root panel — the Appearance row's activation (the seam join)
// ---------------------------------------------------------------------------

describe("R31 §G1 the root panel's Appearance row (the picker joins the existing row — no menu redesign)", () => {
  const baseProps = {
    profileName: "Dev profile",
    identityEmail: "dev@webflix.local",
    locale: "en",
    themeState: "device" as const,
    onOpenSwitch: () => {},
    onOpenAppearance: () => {},
    onOpenShortcuts: () => {},
    onSignOut: () => {},
  };

  it("the row keeps its state-bearing label (the corpus cross-cutting law) and gains the subpage activation", () => {
    const markup = renderToStaticMarkup(createElement(AccountMenuPanel, baseProps));
    // The row's identity is unchanged (R30-B's own datum).
    expect(markup).toContain('data-wfx-account-item="appearance"');
    expect(markup).toContain("Appearance: Device theme");
    // R31 §G1 — the row is now the picker's ACTIVATION: a menuitem
    // button carrying the state label + §3's own right-arrow grammar
    // (the captured "Appearance: Device theme (right arrow)" row).
    expect(markup).toContain("data-wfx-appearance-row");
    const rowStart = markup.indexOf("data-wfx-appearance-row");
    const rowButton = markup.lastIndexOf("<button", rowStart);
    expect(rowButton).toBeGreaterThan(-1);
    expect(markup.slice(rowButton, rowStart + 40)).toContain("menuitem");
    // The right-arrow chevron (the Switch-account row's own grammar —
    // the arrowRight glyph's path, the icon name is not serialized).
    const rowEnd = markup.indexOf("</button>", rowStart);
    expect(markup.slice(rowStart, rowEnd)).toContain("wfx-account__chevron");
    expect(markup.slice(rowStart, rowEnd)).toContain('d="M4 12h16m0 0-6-6m6 6-6 6"');
  });

  it("the row's state label follows the persisted seam (Dark/Light when a choice is stored)", () => {
    for (const state of ["dark", "light"] as const) {
      const markup = renderToStaticMarkup(
        createElement(AccountMenuPanel, { ...baseProps, themeState: state }),
      );
      expect(markup).toContain(`Appearance: ${state === "dark" ? "Dark" : "Light"} theme`);
    }
  });

  it("the Display-language row stays a pure STATE display (the seam law: only the Appearance row gains a picker)", () => {
    const markup = renderToStaticMarkup(createElement(AccountMenuPanel, baseProps));
    // The language row keeps its R30-B form (a state <p>, never a control).
    const langAt = markup.indexOf('data-wfx-account-item="language"');
    expect(langAt).toBeGreaterThan(-1);
    expect(markup.slice(langAt - 120, langAt)).toContain("wfx-account__row--state");
    expect(markup).not.toContain("data-wfx-language-row");
  });
});
