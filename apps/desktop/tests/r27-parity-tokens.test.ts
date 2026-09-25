/**
 * R27-W3 — THE TOKEN CONTRACT PINNING TEST (the conformance mirror).
 *
 * THE LAW (docs/parity-lab/README.md — "the corpus is the contract"): the
 * Desktop token surface mirrors the corpus sheet exactly. This test
 * re-states every sheet value INDEPENDENTLY (hard-coded expectations —
 * the mirror of the mirror) and fails on any drift, so a hand-edit of
 * `r27-parity-tokens.ts` can never silently diverge from the corpus.
 *
 * It also pins the generated stylesheet's contract behavior:
 * - dark is the DEFAULT theme (`:root`), light rides the data-theme seam;
 * - every color in the emitted CSS rides a `var(--wfx-*)` custom property
 *   (the single-encoding law — the stylesheet carries no literal theme
 *   colors);
 * - the corpus geometry appears verbatim (56/240/72/412/16/12/40/20/168×94…).
 */

import { describe, expect, it } from "bun:test";

import {
  R27_FONT_STACK,
  R27_GEOMETRY,
  R27_MOTION,
  R27_PARITY_TOKENS,
  R27_THEMES,
  R27_TYPE_SCALE,
  r27TokenMappingTable,
  r27TokenValue,
  r27TypeStyle,
} from "../src/surface/r27-parity-tokens";
import {
  r27DesktopStylesheet,
  r27ThemeBlock,
} from "../src/surface/r27-parity-css";

// ---------------------------------------------------------------------------
// The sheet, restated independently (the conformance expectations)
// ---------------------------------------------------------------------------

/** The corpus sheet's Canvas & surfaces rows, verbatim. */
const SHEET_EXPECTATIONS: Record<string, { dark: string; light: string }> = {
  "app-bg": { dark: "#0f0f0f", light: "#ffffff" },
  "raised-surface": { dark: "#272727", light: "#f2f2f2" },
  "hover-surface": { dark: "rgba(255,255,255,0.1)", light: "rgba(0,0,0,0.05)" },
  "divider": { dark: "rgba(255,255,255,0.2)", light: "rgba(0,0,0,0.1)" },
  "hairline": { dark: "hsla(0,100%,100%,.08)", light: "hsl(0,0%,93.3%)" },
  "text-primary": { dark: "#f1f1f1", light: "#0f0f0f" },
  "text-secondary": { dark: "#aaaaaa", light: "#606060" },
  "text-tertiary": { dark: "#717171", light: "#909090" },
  "link": { dark: "#3ea6ff", light: "#065fd4" },
  "focus-ring": { dark: "#3ea6ff", light: "#065fd4" },
  "brand-red": { dark: "#f03", light: "#f03" },
  "cta-surface": { dark: "#f1f1f1", light: "#0f0f0f" },
  "cta-ink": { dark: "#0f0f0f", light: "#ffffff" },
  // R29 lead ruling: the R28 corpus (A@298fa55) supersedes R27 — 0.8 -> 0.6.
  "pill-surface": { dark: "rgba(0,0,0,0.6)", light: "rgba(0,0,0,0.6)" },
  "pill-ink": { dark: "#ffffff", light: "#ffffff" },
  "skeleton": { dark: "hsl(0, 0%, 16%)", light: "hsl(0, 0%, 89%)" },
  "scrollbar-thumb": { dark: "hsl(0, 0%, 67%)", light: "hsl(0, 0%, 76%)" },
  "toast-surface": { dark: "#f1f1f1", light: "#0f0f0f" },
  "toast-ink": { dark: "#0f0f0f", light: "#f1f1f1" },
  "chrome-scrim": { dark: "rgba(0,0,0,0.74)", light: "rgba(0,0,0,0.74)" },
  "chrome-ink": { dark: "#ffffff", light: "#ffffff" },
  "stage-black": { dark: "#000000", light: "#000000" },
};

describe("R27-W3 the token contract (the corpus sheet, typed)", () => {
  it("mirrors EVERY sheet row's dark and light values exactly", () => {
    for (const [name, expected] of Object.entries(SHEET_EXPECTATIONS)) {
      const spec = R27_PARITY_TOKENS[name as keyof typeof R27_PARITY_TOKENS];
      expect(spec, `token ${name} exists`).toBeDefined();
      expect(spec.dark as string, `token ${name} dark`).toBe(expected.dark);
      expect(spec.light as string, `token ${name} light`).toBe(expected.light);
    }
    // And the converse: no token escapes the mirror.
    expect(Object.keys(R27_PARITY_TOKENS)).toEqual(Object.keys(SHEET_EXPECTATIONS));
  });

  it("every token carries its custom-property name + provenance + sheet row", () => {
    for (const row of r27TokenMappingTable()) {
      expect(row.cssName.startsWith("--wfx-")).toBe(true);
      expect(row.provenance.length).toBeGreaterThan(0);
      for (const tag of row.provenance) {
        expect(["rendered", "css", "documented"]).toContain(tag);
      }
      expect(row.sheet.length).toBeGreaterThan(0);
    }
  });

  it("resolves by theme, dark DEFAULT (the resolver is the only read path)", () => {
    expect(R27_THEMES).toEqual(["dark", "light"]);
    expect(r27TokenValue("app-bg")).toBe("#0f0f0f");
    expect(r27TokenValue("app-bg", "dark")).toBe("#0f0f0f");
    expect(r27TokenValue("app-bg", "light")).toBe("#ffffff");
    expect(() => r27TokenValue("not-a-token" as never)).toThrow();
  });

  it("is frozen — mutation attempts fail (the immutable-sheet law)", () => {
    expect(() => {
      (R27_PARITY_TOKENS as unknown as Record<string, unknown>)["app-bg"] = {};
    }).toThrow();
    expect(() => {
      (R27_GEOMETRY as { topbarHeight: number }).topbarHeight = 0;
    }).toThrow();
    expect(Object.isFrozen(R27_MOTION)).toBe(true);
    expect(Object.isFrozen(R27_TYPE_SCALE["watch-title"])).toBe(true);
  });

  it("the typography ladder mirrors the sheet's roles", () => {
    expect(R27_TYPE_SCALE["body"].size).toBe(14);
    expect(R27_TYPE_SCALE["body"].weight).toBe(400);
    expect(R27_TYPE_SCALE["body"].lineHeight).toBe(20);
    expect(R27_TYPE_SCALE["watch-title"]).toMatchObject({
      size: 20, weight: 700, lineHeight: 28, color: "text-primary",
    });
    expect(R27_TYPE_SCALE["card-title"]).toMatchObject({
      size: 16, weight: 500, lineHeight: 22, lineClamp: 2,
    });
    expect(R27_TYPE_SCALE["search-title"]).toMatchObject({
      size: 18, weight: 400, lineHeight: 26, lineClamp: 2,
    });
    expect(R27_TYPE_SCALE["meta"]).toMatchObject({ size: 12, weight: 400 });
    expect(R27_TYPE_SCALE["snippet"]).toMatchObject({
      size: 12, lineHeight: 18, lineClamp: 2,
    });
    expect(R27_TYPE_SCALE["pill"]).toMatchObject({
      size: 12, weight: 500, color: "pill-ink",
    });
    expect(R27_TYPE_SCALE["button-label"]).toMatchObject({ size: 14, weight: 500 });
    expect(R27_TYPE_SCALE["section-heading"]).toMatchObject({ size: 20, weight: 400 });
    expect(R27_TYPE_SCALE["chip-label"]).toMatchObject({ size: 14, weight: 500 });
    expect(R27_TYPE_SCALE["rail-label"]).toMatchObject({ size: 14, weight: 400 });
    expect(R27_FONT_STACK).toBe('"Roboto", "Arial", sans-serif');
  });

  it("r27TypeStyle composes the role with the theme's color", () => {
    const dark = r27TypeStyle("watch-title");
    expect(dark.font).toBe(R27_FONT_STACK);
    expect(dark.color).toBe("#f1f1f1");
    const light = r27TypeStyle("watch-title", "light");
    expect(light.color).toBe("#0f0f0f");
  });

  it("the geometry contract mirrors the measured/documented values", () => {
    expect(R27_GEOMETRY.topbarHeight).toBe(56);
    expect(R27_GEOMETRY.railWidthLabeled).toBe(240);
    expect(R27_GEOMETRY.railWidthIcon).toBe(72);
    expect(R27_GEOMETRY.bottomNavHeight).toBe(48);
    expect(R27_GEOMETRY.chipHeight).toBe(32);
    expect(R27_GEOMETRY.cardRadius).toBe(12);
    expect(R27_GEOMETRY.gridGap).toBe(16);
    expect(R27_GEOMETRY.gridColumns).toEqual({ min1300: 4, min1000: 3, min600: 2, base: 1 });
    expect(R27_GEOMETRY.searchThumbWidth).toBe(360);
    expect(R27_GEOMETRY.searchThumbHeight).toBe(202);
    expect(R27_GEOMETRY.watchSecondaryWidth).toBe(412);
    expect(R27_GEOMETRY.watchColumnGap).toBe(16);
    expect(R27_GEOMETRY.watchMargin).toBe(16);
    expect(R27_GEOMETRY.watchMarginWide).toBe(24);
    expect(R27_GEOMETRY.watchWideBreakpoint).toBe(1600);
    expect(R27_GEOMETRY.watchPlayerWidth).toBe(996);
    expect(R27_GEOMETRY.watchPlayerHeight).toBe(560);
    expect(R27_GEOMETRY.playerRadius).toBe(12);
    expect(R27_GEOMETRY.playerControlBarHeight).toBe(48);
    expect(R27_GEOMETRY.playerScrubberDot).toBe(12);
    expect(R27_GEOMETRY.actionPillHeight).toBe(40);
    expect(R27_GEOMETRY.actionPillRadius).toBe(20);
    expect(R27_GEOMETRY.watchAvatar).toBe(40);
    expect(R27_GEOMETRY.descriptionPanelRadius).toBe(12);
    expect(R27_GEOMETRY.relatedThumbWidth).toBe(168);
    expect(R27_GEOMETRY.relatedThumbHeight).toBe(94);
    expect(R27_GEOMETRY.relatedGap).toBe(4);
    expect(R27_GEOMETRY.scrollbarWidth).toBe(16);
    expect(R27_GEOMETRY.scrollbarThumbRadius).toBe(8);
    expect(R27_GEOMETRY.scrollbarThumbBorder).toBe(4);
    expect(R27_GEOMETRY.scrollbarThumbMinHeight).toBe(56);
    expect(R27_GEOMETRY.skeletonShellHeight).toBe(20);
    expect(R27_GEOMETRY.skeletonShellRadius).toBe(8);
    expect(R27_GEOMETRY.pillRadius).toBe(4);
  });

  it("the motion contract pins the sheet's band values", () => {
    expect(R27_MOTION.transitionMs).toBeGreaterThanOrEqual(120);
    expect(R27_MOTION.transitionMs).toBeLessThanOrEqual(200);
    expect(R27_MOTION.hoverDwellMs).toBe(500);
    expect(R27_MOTION.idleFadeMs).toBeLessThanOrEqual(3000);
    expect(R27_MOTION.idleFadeMs).toBeGreaterThanOrEqual(2000);
    expect(R27_MOTION.chromeFadeMs).toBe(300);
    expect(R27_MOTION.focusRingWidth).toBe(2);
    expect(R27_MOTION.toastMs).toBe(4000);
  });
});

describe("R27-W3 the generated stylesheet (the single encoding)", () => {
  it("dark rides :root (the DEFAULT); light rides the data-theme seam", () => {
    const dark = r27ThemeBlock("dark");
    expect(dark.startsWith(":root {")).toBe(true);
    expect(dark).toContain("--wfx-bg: #0f0f0f;");
    expect(dark).toContain("--wfx-accent: #f03;");
    const light = r27ThemeBlock("light");
    expect(light.startsWith('html[data-theme="light"] {')).toBe(true);
    expect(light).toContain("--wfx-bg: #ffffff;");
  });

  it("emits every token's custom property in both themes", () => {
    const css = r27DesktopStylesheet();
    for (const row of r27TokenMappingTable()) {
      expect(css).toContain(`${row.cssName}:`);
    }
    expect(css).toContain("html[data-theme=\"light\"]");
  });

  it("carries the corpus geometry verbatim (the grammar's skeleton)", () => {
    const css = r27DesktopStylesheet();
    expect(css).toContain("height: 56px"); // masthead
    expect(css).toContain("240px"); // labeled rail
    expect(css).toContain("flex-basis: 72px"); // icon rail
    expect(css).toContain("height: 32px"); // chips
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("minmax(0, 1fr) 412px"); // the watch two-column
    expect(css).toContain("flex: 0 0 360px"); // search thumb
    expect(css).toContain("flex: 0 0 168px"); // related compact
    expect(css).toContain("border-radius: 12px");
    expect(css).toContain("border-radius: 20px"); // action pills
    expect(css).toContain("height: 40px"); // action pill height
    expect(css).toContain("height: 48px"); // control bar
    expect(css).toContain("width: 12px"); // scrubber dot
    expect(css).toContain("width: 16px"); // scrollbar
  });

  it("emits no hand-authored theme colors — every color rides a var()", () => {
    const css = r27DesktopStylesheet();
    // Strip the two theme blocks (the sanctioned literal values) and the
    // fixed-black letterbox/scrim whites documented in watch-geometry.
    const stripped = css
      .replace(/:root \{[\s\S]*?\n\}/, "")
      .replace(/html\[data-theme="light"\] \{[\s\S]*?\n\}/, "");
    const hexLiterals = stripped.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    expect(
      hexLiterals,
      `theme colors must ride custom properties (found: ${hexLiterals.join(", ")})`,
    ).toEqual([]);
  });

  it("grammar-identity classes exist for every corpus surface", () => {
    const css = r27DesktopStylesheet();
    for (const cls of [
      "wfx-topbar", "wfx-rail", "wfx-chip", "wfx-grid", "wfx-card",
      "wfx-srow", "wfx-watch", "wfx-chrome", "wfx-cmenu", "wfx-shorts",
      "wfx-rcard", "wfx-w2w", "wfx-lifecycle", "wfx-toast", "wfx-skel-card",
    ]) {
      expect(css).toContain(`.${cls}`);
    }
  });
});
