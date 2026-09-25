/**
 * R27-W1 — THE PARITY TOKEN CONTRACT PINNING TEST.
 *
 * THE LAW (docs/parity-lab/README.md — "the corpus is the contract"): the
 * canonical shared token contract mirrors the corpus sheet EXACTLY. This
 * test re-states every corpus value INDEPENDENTLY (hard-coded straight
 * from `docs/parity-lab/reference/design-tokens.md` + `watch-geometry.md`
 * + `app-shell.md` — the conformance expectations) and fails on any
 * drift, so a hand-edit of `parity-tokens.ts` can never silently diverge
 * from the corpus the lead captured.
 *
 * It also pins the contract's structural laws: the closed vocabularies,
 * the unique cssName mapping (one `--wfx-*` name per token — the
 * single-encoding law), both themes first-class, provenance preserved on
 * every row, and the JSON serialization round-tripping.
 */

import { describe, expect, it } from "bun:test";

import {
  PARITY_CHROME_CONTROLS,
  PARITY_FONT_STACK,
  PARITY_GEOMETRY,
  PARITY_KEYBOARD,
  PARITY_MOTION,
  PARITY_TOKENS,
  PARITY_TOKEN_NAMES,
  PARITY_THEMES,
  PARITY_TYPE_SCALE,
  PARITY_TYPE_ROLE_NAMES,
  paritySheet,
  paritySheetJson,
  parityTokenMappingTable,
  parityTokenValue,
  parityTypeStyle,
} from "../src/parity-tokens";

// ---------------------------------------------------------------------------
// The corpus sheet, restated independently (design-tokens.md verbatim)
// ---------------------------------------------------------------------------

/** Canvas & surfaces + the composite pinned surfaces — verbatim. */
const SHEET_COLORS: Record<string, { dark: string; light: string }> = {
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

/** The cssName mapping (the `--wfx-*` grammar both apps adopted). */
const SHEET_CSS_NAMES: Record<string, string> = {
  "app-bg": "--wfx-bg",
  "raised-surface": "--wfx-bg-raised",
  "hover-surface": "--wfx-bg-hover",
  "divider": "--wfx-border",
  "hairline": "--wfx-border-hairline",
  "text-primary": "--wfx-text",
  "text-secondary": "--wfx-text-dim",
  "text-tertiary": "--wfx-text-faint",
  "link": "--wfx-link",
  "focus-ring": "--wfx-focus",
  "brand-red": "--wfx-accent",
  "cta-surface": "--wfx-cta-bg",
  "cta-ink": "--wfx-cta-fg",
  "pill-surface": "--wfx-pill-bg",
  "pill-ink": "--wfx-pill-fg",
  "skeleton": "--wfx-skeleton",
  "scrollbar-thumb": "--wfx-scrollbar-thumb",
  "toast-surface": "--wfx-toast-bg",
  "toast-ink": "--wfx-toast-fg",
  "chrome-scrim": "--wfx-chrome-scrim",
  "chrome-ink": "--wfx-chrome-fg",
  "stage-black": "--wfx-stage-black",
};

/** The typography ladder (design-tokens.md Typography, verbatim). */
const SHEET_TYPES: Record<
  string,
  { size: number; weight: number; lineHeight: number; lineClamp: 0 | 2; color: string }
> = {
  "body": { size: 14, weight: 400, lineHeight: 20, lineClamp: 0, color: "text-primary" },
  "watch-title": { size: 20, weight: 700, lineHeight: 28, lineClamp: 0, color: "text-primary" },
  "card-title": { size: 16, weight: 500, lineHeight: 22, lineClamp: 2, color: "text-primary" },
  "search-title": { size: 18, weight: 400, lineHeight: 26, lineClamp: 2, color: "text-primary" },
  "channel-row": { size: 14, weight: 400, lineHeight: 20, lineClamp: 0, color: "text-secondary" },
  "meta": { size: 12, weight: 400, lineHeight: 16, lineClamp: 0, color: "text-secondary" },
  "snippet": { size: 12, weight: 400, lineHeight: 18, lineClamp: 2, color: "text-secondary" },
  "pill": { size: 12, weight: 500, lineHeight: 16, lineClamp: 0, color: "pill-ink" },
  "badge": { size: 12, weight: 500, lineHeight: 16, lineClamp: 0, color: "text-secondary" },
  "button-label": { size: 14, weight: 500, lineHeight: 20, lineClamp: 0, color: "text-primary" },
  "section-heading": { size: 20, weight: 400, lineHeight: 28, lineClamp: 0, color: "text-primary" },
  "chip-label": { size: 14, weight: 500, lineHeight: 20, lineClamp: 0, color: "text-primary" },
  "rail-label": { size: 14, weight: 400, lineHeight: 20, lineClamp: 0, color: "text-primary" },
};

/** Geometry + motion (design-tokens.md Geometry/Motion + watch-geometry.md). */
const SHEET_GEOMETRY: Record<string, number> = {
  topbarHeight: 56,
  railWidthLabeled: 240,
  railWidthIcon: 72,
  railItemHeight: 48,
  railItemRadius: 10,
  railIconBreakpoint: 1280,
  bottomNavBreakpoint: 792,
  bottomNavHeight: 48,
  searchPillHeight: 40,
  searchPillRadius: 40,
  topbarAvatar: 32,
  chipHeight: 32,
  chipRadius: 8,
  chipRowPadding: 12,
  cardRadius: 12,
  gridGap: 16,
  gridCardTextGap: 4,
  searchThumbWidth: 360,
  searchThumbHeight: 202,
  searchGap: 16,
  watchPrimaryWidth: 1012,
  watchSecondaryWidth: 412,
  watchSecondaryX: 1028,
  watchColumnGap: 16,
  watchMargin: 16,
  watchMarginWide: 24,
  watchWideBreakpoint: 1600,
  watchPlayerWidth: 996,
  watchPlayerHeight: 560,
  watchPlayerX: 16,
  watchTopGap: 12,
  watchPlayerTextGap: 12,
  watchOwnerRowWidth: 274,
  watchActionsRowWidth: 690,
  watchSingleColumnBreakpoint: 1016,
  watchFullBleedBreakpoint: 1000,
  playerRadius: 12,
  playerControlBarHeight: 48,
  playerScrubTrackHeight: 3,
  playerScrubTrackHoverHeight: 5,
  playerScrubberDot: 12,
  actionPillHeight: 40,
  actionPillRadius: 20,
  watchAvatar: 40,
  descriptionPanelRadius: 12,
  relatedThumbWidth: 168,
  relatedThumbHeight: 94,
  relatedGap: 4,
  shortsChromeHeight: 96,
  shortsActionTarget: 48,
  shortsRadius: 12,
  scrollbarWidth: 16,
  scrollbarThumbRadius: 8,
  scrollbarThumbBorder: 4,
  scrollbarThumbMinHeight: 56,
  skeletonShellHeight: 20,
  skeletonShellRadius: 8,
  pillRadius: 4,
  pillPaddingX: 4,
  pillPaddingY: 3,
};

// ---------------------------------------------------------------------------
// The color/surface sheet
// ---------------------------------------------------------------------------

describe("R27-W1 parity token contract — the corpus color sheet", () => {
  it("carries every corpus Canvas & surfaces row, both themes, values verbatim", () => {
    for (const [name, expected] of Object.entries(SHEET_COLORS)) {
      const spec = PARITY_TOKENS[name as keyof typeof PARITY_TOKENS];
      expect(spec, `token ${name} must exist in the contract`).toBeDefined();
      expect<string>(spec.dark, `${name} dark`).toBe(expected.dark);
      expect<string>(spec.light, `${name} light`).toBe(expected.light);
    }
  });

  it("carries the canonical --wfx-* css-name mapping both apps consume", () => {
    for (const [name, cssName] of Object.entries(SHEET_CSS_NAMES)) {
      const spec = PARITY_TOKENS[name as keyof typeof PARITY_TOKENS];
      expect(spec, `token ${name} must exist`).toBeDefined();
      expect<string>(spec.cssName, `${name} cssName`).toBe(cssName);
    }
    // The mapping is ONE-TO-ONE (the single-encoding law: no two tokens
    // share a custom property, no token carries two names).
    const names = PARITY_TOKEN_NAMES.map((n) => PARITY_TOKENS[n].cssName);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.startsWith("--wfx-"))).toBe(true);
  });

  it("preserves provenance on every token (rendered/css/documented)", () => {
    for (const name of PARITY_TOKEN_NAMES) {
      const spec = PARITY_TOKENS[name];
      expect(spec.provenance.length, `${name} provenance`).toBeGreaterThan(0);
      for (const tag of spec.provenance) {
        expect(["rendered", "css", "documented"]).toContain(tag);
      }
      expect(spec.sheet, `${name} sheet trace`).toMatch(
        /(design-tokens|watch-geometry|app-shell|yt-watch-skeleton|search-card-grammar)/,
      );
    }
  });

  it("dark is the default theme and both themes resolve every token", () => {
    expect(PARITY_THEMES).toEqual(["dark", "light"]);
    for (const name of PARITY_TOKEN_NAMES) {
      expect(parityTokenValue(name)).toBe(PARITY_TOKENS[name].dark);
      expect(parityTokenValue(name, "dark")).toBe(PARITY_TOKENS[name].dark);
      expect(parityTokenValue(name, "light")).toBe(PARITY_TOKENS[name].light);
    }
  });

  it("the corpus pin: the operator-named core values (the lab brief)", () => {
    // The lane packet's own named values — restated a second time so a
    // typo in EITHER the sheet expectations above or the contract trips.
    expect(parityTokenValue("app-bg")).toBe("#0f0f0f");
    expect(parityTokenValue("text-primary")).toBe("#f1f1f1");
    expect(parityTokenValue("text-secondary")).toBe("#aaaaaa");
    expect(parityTokenValue("raised-surface")).toBe("#272727");
    expect(parityTokenValue("hover-surface")).toBe("rgba(255,255,255,0.1)");
    expect(parityTokenValue("pill-surface")).toBe("rgba(0,0,0,0.6)");
    expect(parityTokenValue("brand-red")).toBe("#f03");
    expect(parityTokenValue("link")).toBe("#3ea6ff");
    expect(parityTokenValue("app-bg", "light")).toBe("#ffffff");
    expect(parityTokenValue("text-primary", "light")).toBe("#0f0f0f");
    expect(parityTokenValue("text-secondary", "light")).toBe("#606060");
    expect(parityTokenValue("raised-surface", "light")).toBe("#f2f2f2");
  });
});

// ---------------------------------------------------------------------------
// The typography ladder
// ---------------------------------------------------------------------------

describe("R27-W1 parity token contract — the Roboto ladder", () => {
  it("carries every sheet role with size/weight/line-height/clamp/color verbatim", () => {
    for (const [role, expected] of Object.entries(SHEET_TYPES)) {
      const spec = PARITY_TYPE_SCALE[role as keyof typeof PARITY_TYPE_SCALE];
      expect(spec, `type role ${role} must exist`).toBeDefined();
      expect<number>(spec.size, `${role} size`).toBe(expected.size);
      expect<number>(spec.weight, `${role} weight`).toBe(expected.weight);
      expect<number>(spec.lineHeight, `${role} line-height`).toBe(expected.lineHeight);
      expect<number>(spec.lineClamp, `${role} clamp`).toBe(expected.lineClamp);
      expect<string>(spec.color, `${role} color token`).toBe(expected.color);
    }
    expect(PARITY_TYPE_ROLE_NAMES.length).toBe(13);
  });

  it("the exact font stack ([rendered]): Roboto, Arial, sans-serif", () => {
    expect(PARITY_FONT_STACK).toBe('"Roboto", "Arial", sans-serif');
  });

  it("resolves the composite type style per theme (font + metrics + color)", () => {
    const card = parityTypeStyle("card-title");
    expect(card).toEqual({
      font: '"Roboto", "Arial", sans-serif',
      size: 16,
      weight: 500,
      lineHeight: 22,
      lineClamp: 2,
      color: "#f1f1f1",
    });
    expect(parityTypeStyle("card-title", "light").color).toBe("#0f0f0f");
    expect(parityTypeStyle("search-title").size).toBe(18);
    expect(parityTypeStyle("watch-title").weight).toBe(700);
    expect(parityTypeStyle("pill").color).toBe("#ffffff");
  });
});

// ---------------------------------------------------------------------------
// Geometry + motion
// ---------------------------------------------------------------------------

describe("R27-W1 parity token contract — the measured geometry", () => {
  it("carries every corpus geometry value verbatim", () => {
    for (const [key, expected] of Object.entries(SHEET_GEOMETRY)) {
      const actual = (PARITY_GEOMETRY as Record<string, unknown>)[key];
      expect(actual, `geometry ${key}`).toBe(expected);
    }
  });

  it("the responsive grid grammar: 4/3/2/1 columns at 1300/1000/600", () => {
    expect(PARITY_GEOMETRY.gridColumns).toEqual({
      min1300: 4,
      min1000: 3,
      min600: 2,
      base: 1,
    });
    expect(PARITY_GEOMETRY.gridBreakpoints).toEqual({ two: 600, three: 1000, four: 1300 });
  });

  it("the watch two-column anatomy @1440: 1012 primary + 412 secondary + 16 gap", () => {
    expect(PARITY_GEOMETRY.watchPrimaryWidth).toBe(1012);
    expect(PARITY_GEOMETRY.watchSecondaryWidth).toBe(412);
    expect(PARITY_GEOMETRY.watchColumnGap).toBe(16);
    expect(PARITY_GEOMETRY.watchMargin).toBe(16);
    expect(PARITY_GEOMETRY.watchPlayerWidth).toBe(996);
    expect(PARITY_GEOMETRY.watchPlayerHeight).toBe(560);
    expect(PARITY_GEOMETRY.watchSecondaryX).toBe(1028);
    expect(PARITY_GEOMETRY.watchSingleColumnBreakpoint).toBe(1016);
  });

  it("the shell anatomy: 56 topbar, 240/72 rail, 32 chip, 40/20 pills, 48 bottom nav", () => {
    expect(PARITY_GEOMETRY.topbarHeight).toBe(56);
    expect(PARITY_GEOMETRY.railWidthLabeled).toBe(240);
    expect(PARITY_GEOMETRY.railWidthIcon).toBe(72);
    expect(PARITY_GEOMETRY.chipHeight).toBe(32);
    expect(PARITY_GEOMETRY.actionPillHeight).toBe(40);
    expect(PARITY_GEOMETRY.actionPillRadius).toBe(20);
    expect(PARITY_GEOMETRY.bottomNavHeight).toBe(48);
  });

  it("the scrollbar + skeleton spec (the corpus skeleton CSS, verbatim)", () => {
    expect(PARITY_GEOMETRY.scrollbarWidth).toBe(16);
    expect(PARITY_GEOMETRY.scrollbarThumbRadius).toBe(8);
    expect(PARITY_GEOMETRY.scrollbarThumbBorder).toBe(4);
    expect(PARITY_GEOMETRY.scrollbarThumbMinHeight).toBe(56);
    expect(PARITY_GEOMETRY.skeletonShellHeight).toBe(20);
    expect(PARITY_GEOMETRY.skeletonShellRadius).toBe(8);
  });

  it("motion stays inside the corpus band (120–300ms ease; ~3s idle reveal)", () => {
    expect(PARITY_MOTION.transitionMs).toBeGreaterThanOrEqual(120);
    expect(PARITY_MOTION.transitionMs).toBeLessThanOrEqual(300);
    expect(PARITY_MOTION.transitionEasing).toBe("ease");
    expect(PARITY_MOTION.idleFadeMs).toBe(3000);
    expect(PARITY_MOTION.hoverDwellMs).toBe(500);
    expect(PARITY_MOTION.focusRingWidth).toBe(2);
    expect(PARITY_MOTION.toastMs).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// The player-chrome control + keyboard grammar
// ---------------------------------------------------------------------------

describe("R27-W1 parity token contract — the player-chrome OPERATE grammar", () => {
  it("the control order is the corpus's left→right anatomy", () => {
    expect(PARITY_CHROME_CONTROLS.map((c) => c.id)).toEqual([
      "play-pause",
      "next",
      "volume",
      "time",
      "spacer",
      "captions",
      "settings",
      "miniplayer",
      "theater",
      "fullscreen",
    ]);
  });

  it("capability truth is encoded: next renders only when queued; captions gated", () => {
    const next = PARITY_CHROME_CONTROLS.find((c) => c.id === "next");
    expect(next?.availability).toBe("when-queued");
    const captions = PARITY_CHROME_CONTROLS.find((c) => c.id === "captions");
    expect(captions?.availability).toBe("capability-gated");
    // The settings popup is where WebFlix's honest capability rows live.
    const settings = PARITY_CHROME_CONTROLS.find((c) => c.id === "settings");
    expect(settings?.detail).toContain("capability-truth-gated");
  });

  it("the keyboard grammar: space/k, j/l ±10s, arrows ±5s + volume, f, t, m, c, 0–9", () => {
    const byKeys = (key: string) => PARITY_KEYBOARD.find((k) => k.keys.includes(key));
    expect(byKeys(" ")?.action).toBe("play-pause");
    expect(byKeys("k")?.action).toBe("play-pause");
    expect(byKeys("j")?.action).toBe("seek-back");
    expect(byKeys("j")?.param).toBe(10); // j: −10s
    expect(byKeys("l")?.action).toBe("seek-forward");
    expect(byKeys("l")?.param).toBe(10); // l: +10s
    expect(byKeys("ArrowLeft")?.action).toBe("seek-back");
    expect(byKeys("ArrowLeft")?.param).toBe(5); // ←: −5s
    expect(byKeys("ArrowRight")?.action).toBe("seek-forward");
    expect(byKeys("ArrowRight")?.param).toBe(5); // →: +5s
    expect(byKeys("ArrowUp")?.action).toBe("volume-up");
    expect(byKeys("ArrowDown")?.action).toBe("volume-down");
    expect(byKeys("f")?.action).toBe("fullscreen");
    expect(byKeys("t")?.action).toBe("theater");
    expect(byKeys("m")?.action).toBe("mute");
    expect(byKeys("c")?.action).toBe("captions");
    expect(byKeys("5")?.action).toBe("seek-to-percent");
    expect(byKeys("9")?.action).toBe("seek-to-percent");
    expect(byKeys("0")?.keys).toEqual([
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The serialization + the freeze
// ---------------------------------------------------------------------------

describe("R27-W1 parity token contract — the machine-readable surface", () => {
  it("the mapping table projects every token with its cssName + both themes", () => {
    const table = parityTokenMappingTable();
    expect(table.length).toBe(PARITY_TOKEN_NAMES.length);
    expect(table.length).toBe(22);
    for (const row of table) {
      expect(row.dark).toBe(PARITY_TOKENS[row.name].dark);
      expect(row.light).toBe(PARITY_TOKENS[row.name].light);
      expect(row.cssName).toBe(PARITY_TOKENS[row.name].cssName);
    }
  });

  it("the JSON serialization round-trips the whole sheet", () => {
    const json = paritySheetJson();
    const parsed = JSON.parse(json) as ReturnType<typeof paritySheet>;
    expect(parsed.contract).toBe("webflix-parity-sheet");
    expect(parsed.version).toBe("r27");
    expect(parsed.tokens.length).toBe(22);
    expect(parsed.typeScale.length).toBe(13);
    expect(parsed.tokens[0]).toEqual({
      name: "app-bg",
      cssName: "--wfx-bg",
      dark: "#0f0f0f",
      light: "#ffffff",
      provenance: ["rendered", "css"],
      sheet: "design-tokens.md: Canvas & surfaces — app background",
    });
    // geometry + keyboard survive the trip
    expect(parsed.geometry.topbarHeight).toBe(56);
    expect(parsed.keyboard.length).toBe(PARITY_KEYBOARD.length);
    expect(parsed.chromeControls.length).toBe(10);
  });

  it("the contract is frozen (mutation is a conformance defect)", () => {
    expect(() => {
      (
        PARITY_TOKENS as unknown as Record<string, { dark: string }>
      )["app-bg"]!.dark = "#ff0000";
    }).toThrow();
    expect(() => {
      (PARITY_GEOMETRY as unknown as Record<string, number>).topbarHeight = 0;
    }).toThrow();
    expect(() => {
      (PARITY_MOTION as unknown as Record<string, number>).idleFadeMs = 0;
    }).toThrow();
  });
});
