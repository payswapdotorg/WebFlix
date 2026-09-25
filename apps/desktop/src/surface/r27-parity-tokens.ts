/**
 * @wfx/app-desktop — THE R27 PARITY TOKEN CONTRACT (W3's token overhaul,
 * the corpus sheet typed for the Desktop surface).
 *
 * THE LAW (docs/parity-lab/README.md — "the corpus is the contract"):
 * every value in this module is the MIRROR of
 * `docs/parity-lab/reference/design-tokens.md` (+ the geometry of
 * `watch-geometry.md` and `app-shell.md`), captured from live youtube.com
 * by the lead on 2026-09-23. Dark is the DEFAULT product theme (YouTube's
 * dark); light is the second supported theme. `R27_PARITY_TOKENS` is the
 * single Desktop encoding of the sheet: the webview stylesheet
 * (`./r27-parity-css.ts`) is GENERATED from it, and the surface
 * view-models reference the token NAMES — so a value exists exactly once
 * and W1's conformance harness can assert the mapping mechanically.
 *
 * THE SHARED-ENCODING NOTE (recorded for the lead's conformance pass):
 * W1's machine-readable token contract (`wfx/r27/shared`) had NOT landed
 * on the remote when this lane started (only `wfx/r27/web` exists). Per
 * the lane packet this module therefore mirrors the sheet values exactly
 * and tags every token with its provenance; when W1's contract lands, the
 * lead's conformance pass diffs this mirror against the shared encoding —
 * drift between apps is a defect, and this module is the Desktop side of
 * that assertion.
 *
 * HONEST WINDOW-CHROME MAPPING (the Desktop-specific geometry law): the
 * native shell opens a 1440×900 decorated window (`shell/tauri.conf.json`
 * — minWidth 960), so the DESKTOP viewport grammar maps 1:1 onto the
 * corpus capture viewport: the OS title bar is native chrome ABOVE the
 * app surface; the corpus's 56px masthead renders as the in-app topbar
 * below it. Everything inside the window follows the corpus geometry
 * verbatim (240px labeled rail ≥1280, 72px icon rail 792–1279, 16px page
 * margins at 1440 → 24px ≥1600, measured two-column watch layout).
 *
 * WHAT THIS MODULE IS NOT: a second design system (values come from the
 * sheet only), a theme engine (two themes, resolved by name — the webview
 * persists the choice), or product policy (tokens carry no capability
 * truth; surfaces own that).
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The two supported themes (dark is the product default). */
export type R27ThemeName = "dark" | "light";

/** THE R27 themes, in frozen order (dark first — the default). */
export const R27_THEMES: readonly R27ThemeName[] = ["dark", "light"] as const;

/** The corpus provenance vocabulary (the sheet's own tags). */
export type R27ProvenanceTag = "rendered" | "css" | "documented";

/**
 * One corpus token: the value per theme + the provenance tags + the sheet
 * row it mirrors + the CSS custom property the Desktop webview carries.
 */
export interface R27TokenSpec {
  /** The `--wfx-*` custom property name (grammar-identical with the Web). */
  readonly cssName: string;
  /** The DARK theme value (the default product theme). */
  readonly dark: string;
  /** The LIGHT theme value (the second supported theme). */
  readonly light: string;
  /** The sheet's provenance tags for this row. */
  readonly provenance: readonly R27ProvenanceTag[];
  /** The corpus sheet row this token mirrors (the conformance key). */
  readonly sheet: string;
}

// ---------------------------------------------------------------------------
// THE TOKEN SHEET (Canvas & surfaces + typography colors + chrome scrims)
// ---------------------------------------------------------------------------

/**
 * THE color/surface token contract — every row of the corpus sheet's
 * "Canvas & surfaces" table plus the composite surfaces the sheet's other
 * sections pin (duration pill, scrollbar, skeleton, toast, chrome scrim,
 * focus ring). Frozen: mutation is a conformance defect.
 */
export const R27_PARITY_TOKENS = {
  /** App background — `ytd-app` bg; skeleton `html[dark] #0f0f0f`. */
  "app-bg": {
    cssName: "--wfx-bg",
    dark: "#0f0f0f",
    light: "#ffffff",
    provenance: ["rendered", "css"],
    sheet: "design-tokens.md: Canvas & surfaces — app background",
  },
  /** Raised surface (chips row, description panel, menus). */
  "raised-surface": {
    cssName: "--wfx-bg-raised",
    dark: "#272727",
    light: "#f2f2f2",
    provenance: ["documented", "rendered"],
    sheet: "design-tokens.md: Canvas & surfaces — raised surface",
  },
  /** Hover surface (action button bg, chip hover). */
  "hover-surface": {
    cssName: "--wfx-bg-hover",
    dark: "rgba(255,255,255,0.1)",
    light: "rgba(0,0,0,0.05)",
    provenance: ["documented", "rendered"],
    sheet: "design-tokens.md: Canvas & surfaces — hover surface",
  },
  /** Divider / border. */
  "divider": {
    cssName: "--wfx-border",
    dark: "rgba(255,255,255,0.2)",
    light: "rgba(0,0,0,0.1)",
    provenance: ["css", "documented"],
    sheet: "design-tokens.md: Canvas & surfaces — divider / border",
  },
  /** The hairline divider (the skeleton CSS's light-border-bottom). */
  "hairline": {
    cssName: "--wfx-border-hairline",
    dark: "hsla(0,100%,100%,.08)",
    light: "hsl(0,0%,93.3%)",
    provenance: ["css"],
    sheet: "yt-watch-skeleton.css: skeleton-light-border-bottom",
  },
  /** Primary text. */
  "text-primary": {
    cssName: "--wfx-text",
    dark: "#f1f1f1",
    light: "#0f0f0f",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Canvas & surfaces — primary text",
  },
  /** Secondary text (meta). */
  "text-secondary": {
    cssName: "--wfx-text-dim",
    dark: "#aaaaaa",
    light: "#606060",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Canvas & surfaces — secondary text",
  },
  /** Tertiary/disabled text. */
  "text-tertiary": {
    cssName: "--wfx-text-faint",
    dark: "#717171",
    light: "#909090",
    provenance: ["documented"],
    sheet: "design-tokens.md: Canvas & surfaces — tertiary/disabled text",
  },
  /** Link / interactive accent. */
  "link": {
    cssName: "--wfx-link",
    dark: "#3ea6ff",
    light: "#065fd4",
    provenance: ["documented"],
    sheet: "design-tokens.md: Canvas & surfaces — link / interactive accent",
  },
  /** Focus ring color (the link family — the sheet's keyboard-focus ring). */
  "focus-ring": {
    cssName: "--wfx-focus",
    dark: "#3ea6ff",
    light: "#065fd4",
    provenance: ["documented"],
    sheet: "design-tokens.md: Motion & states — focus ring",
  },
  /** Brand/progress red (progress bar, scrubber). */
  "brand-red": {
    cssName: "--wfx-accent",
    dark: "#f03",
    light: "#f03",
    provenance: ["documented"],
    sheet: "design-tokens.md: Canvas & surfaces — brand/progress red",
  },
  /** The Subscribe-style primary CTA surface (white-on-dark pill). */
  "cta-surface": {
    cssName: "--wfx-cta-bg",
    dark: "#f1f1f1",
    light: "#0f0f0f",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography/Geometry — subscribe-style primary channel action",
  },
  /** The Subscribe-style primary CTA ink. */
  "cta-ink": {
    cssName: "--wfx-cta-fg",
    dark: "#0f0f0f",
    light: "#ffffff",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography/Geometry — subscribe-style primary channel action",
  },
  /** Duration-pill surface (`rgba(0,0,0,0.6)` in both themes — the R28 corpus A@298fa55 supersedes R27's 0.8). */
  "pill-surface": {
    cssName: "--wfx-pill-bg",
    dark: "rgba(0,0,0,0.6)",
    light: "rgba(0,0,0,0.6)",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — duration pill",
  },
  /** Duration-pill ink (`#fff` on `rgba(0,0,0,0.6)`). */
  "pill-ink": {
    cssName: "--wfx-pill-fg",
    dark: "#ffffff",
    light: "#ffffff",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — duration pill",
  },
  /** Skeleton text-shell bg (the corpus skeleton CSS). */
  "skeleton": {
    cssName: "--wfx-skeleton",
    dark: "hsl(0, 0%, 16%)",
    light: "hsl(0, 0%, 89%)",
    provenance: ["css"],
    sheet: "yt-watch-skeleton.css: skeleton-bg-color",
  },
  /** Scrollbar thumb (dark from the skeleton CSS; light the documented pair). */
  "scrollbar-thumb": {
    cssName: "--wfx-scrollbar-thumb",
    dark: "hsl(0, 0%, 67%)",
    light: "hsl(0, 0%, 76%)",
    provenance: ["css", "documented"],
    sheet: "design-tokens.md: Geometry — scrollbar (dark [css]; light the sheet's documented pair)",
  },
  /** Snackbar/toast surface (INVERTED per theme). */
  "toast-surface": {
    cssName: "--wfx-toast-bg",
    dark: "#f1f1f1",
    light: "#0f0f0f",
    provenance: ["documented"],
    sheet: "design-tokens.md: Canvas & surfaces — snackbar/toast surface",
  },
  /** Snackbar/toast ink (inverted per theme). */
  "toast-ink": {
    cssName: "--wfx-toast-fg",
    dark: "#0f0f0f",
    light: "#f1f1f1",
    provenance: ["documented"],
    sheet: "design-tokens.md: Canvas & surfaces — snackbar/toast surface",
  },
  /** The player chrome's bottom scrim (the control-bar gradient's color). */
  "chrome-scrim": {
    cssName: "--wfx-chrome-scrim",
    dark: "rgba(0,0,0,0.74)",
    light: "rgba(0,0,0,0.74)",
    provenance: ["documented"],
    sheet: "watch-geometry.md: The player stage — gradient scrims on reveal",
  },
  /** The player chrome's control ink (white on scrim, both themes). */
  "chrome-ink": {
    cssName: "--wfx-chrome-fg",
    dark: "#ffffff",
    light: "#ffffff",
    provenance: ["documented"],
    sheet: "watch-geometry.md: The player stage — chrome control color",
  },
  /** The player stage's letterbox black (both themes). */
  "stage-black": {
    cssName: "--wfx-stage-black",
    dark: "#000000",
    light: "#000000",
    provenance: ["documented"],
    sheet: "watch-geometry.md: The player stage — black letterbox",
  },
} as const satisfies Record<string, R27TokenSpec>;

/** The color/surface token names (the closed vocabulary). */
export type R27ParityTokenName = keyof typeof R27_PARITY_TOKENS;

/** Every token name, in the sheet's frozen order. */
export const R27_PARITY_TOKEN_NAMES: readonly R27ParityTokenName[] =
  Object.keys(R27_PARITY_TOKENS) as readonly R27ParityTokenName[];

// ---------------------------------------------------------------------------
// The typography scale (the sheet's roles, Roboto stack)
// ---------------------------------------------------------------------------

/** The exact font stack ([rendered]): Roboto, Arial, sans-serif. */
export const R27_FONT_STACK =
  '"Roboto", "Arial", sans-serif' as const;

/** The sheet's own long fallback chain note (no-new-runtime-deps law). */
export const R27_FONT_STACK_FALLBACK_NOTE =
  "Roboto, Arial, Helvetica, sans-serif with the system fallback chain — the parity target is Roboto rendering where available." as const;

/** One typography role on the sheet's ladder. */
export interface R27TypeSpec {
  /** The role's stable name (the CSS utility's suffix). */
  readonly role: string;
  /** Font size (px). */
  readonly size: number;
  /** Font weight. */
  readonly weight: number;
  /** Line height (px). */
  readonly lineHeight: number;
  /** The 2-line clamp flag (the sheet's card/search/snippet clamps). */
  readonly lineClamp: 0 | 2;
  /** The color token the role renders in. */
  readonly color: R27ParityTokenName;
  readonly provenance: readonly R27ProvenanceTag[];
  readonly sheet: string;
}

/** THE typography ladder — the sheet's Typography table, frozen. */
export const R27_TYPE_SCALE = {
  "body": {
    role: "body",
    size: 14,
    weight: 400,
    lineHeight: 20,
    lineClamp: 0,
    color: "text-primary",
    provenance: ["rendered", "documented"],
    sheet: "design-tokens.md: Typography — body base",
  },
  "watch-title": {
    role: "watch-title",
    size: 20,
    weight: 700,
    lineHeight: 28,
    lineClamp: 0,
    color: "text-primary",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — page/watch title (h1)",
  },
  "card-title": {
    role: "card-title",
    size: 16,
    weight: 500,
    lineHeight: 22,
    lineClamp: 2,
    color: "text-primary",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography — card title (feed)",
  },
  "search-title": {
    role: "search-title",
    size: 18,
    weight: 400,
    lineHeight: 26,
    lineClamp: 2,
    color: "text-primary",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — search result title",
  },
  "channel-row": {
    role: "channel-row",
    size: 14,
    weight: 400,
    lineHeight: 20,
    lineClamp: 0,
    color: "text-secondary",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography — channel/creator row",
  },
  "meta": {
    role: "meta",
    size: 12,
    weight: 400,
    lineHeight: 16,
    lineClamp: 0,
    color: "text-secondary",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — meta line (views · date)",
  },
  "snippet": {
    role: "snippet",
    size: 12,
    weight: 400,
    lineHeight: 18,
    lineClamp: 2,
    color: "text-secondary",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — description snippet",
  },
  "pill": {
    role: "pill",
    size: 12,
    weight: 500,
    lineHeight: 16,
    lineClamp: 0,
    color: "pill-ink",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — duration pill",
  },
  "badge": {
    role: "badge",
    size: 12,
    weight: 500,
    lineHeight: 16,
    lineClamp: 0,
    color: "text-secondary",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — badge text (CC/subtitles)",
  },
  "button-label": {
    role: "button-label",
    size: 14,
    weight: 500,
    lineHeight: 20,
    lineClamp: 0,
    color: "text-primary",
    provenance: ["rendered"],
    sheet: "design-tokens.md: Typography — button label",
  },
  "section-heading": {
    role: "section-heading",
    size: 20,
    weight: 400,
    lineHeight: 28,
    lineClamp: 0,
    color: "text-primary",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography — section heading",
  },
  "chip-label": {
    role: "chip-label",
    size: 14,
    weight: 500,
    lineHeight: 20,
    lineClamp: 0,
    color: "text-primary",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography — chip label",
  },
  "rail-label": {
    role: "rail-label",
    size: 14,
    weight: 400,
    lineHeight: 20,
    lineClamp: 0,
    color: "text-primary",
    provenance: ["documented"],
    sheet: "design-tokens.md: Typography — rail nav label",
  },
} as const satisfies Record<string, R27TypeSpec>;

/** The typography role names (the closed ladder). */
export type R27TypeRoleName = keyof typeof R27_TYPE_SCALE;

/** Every typography role, in the sheet's frozen order. */
export const R27_TYPE_ROLE_NAMES: readonly R27TypeRoleName[] =
  Object.keys(R27_TYPE_SCALE) as readonly R27TypeRoleName[];

// ---------------------------------------------------------------------------
// The geometry + motion contract (the sheet's measured values)
// ---------------------------------------------------------------------------

/** THE geometry + motion numbers, straight off the sheet. Frozen. */
export const R27_GEOMETRY = {
  /* — Shell (app-shell.md + design-tokens.md Geometry) — */
  /** Masthead height ([rendered] masthead rect). */
  topbarHeight: 56,
  /** Labeled rail width ≥1280 ([rendered] guide rect). */
  railWidthLabeled: 240,
  /** Icon-only rail width 792–1279 ([documented]). */
  railWidthIcon: 72,
  /** Rail item row height (app-shell.md item anatomy). */
  railItemHeight: 48,
  /** Rail item hover radius (app-shell.md item anatomy). */
  railItemRadius: 10,
  /** The labeled→icon rail breakpoint (app-shell.md). */
  railIconBreakpoint: 1280,
  /** The icon-rail→bottom-nav breakpoint (app-shell.md). */
  bottomNavBreakpoint: 792,
  /** Bottom nav height <792 ([documented]). */
  bottomNavHeight: 48,
  /** Search pill height/radius (app-shell.md center cluster). */
  searchPillHeight: 40,
  /** The search pill's full radius. */
  searchPillRadius: 40,
  /** Topbar avatar diameter (app-shell.md right cluster). */
  topbarAvatar: 32,

  /* — Chip bar (app-shell.md home feed) — */
  /** Chip height ([rendered] chip h=32). */
  chipHeight: 32,
  /** Chip radius ([documented] topic chips radius 8px). */
  chipRadius: 8,
  /** The chip row's horizontal padding. */
  chipRowPadding: 12,

  /* — Card grid (design-tokens.md Geometry — home grid card) — */
  /** Card thumbnail radius (2025 YouTube rounded cards). */
  cardRadius: 12,
  /** Card grid gap (16px×16px). */
  gridGap: 16,
  /** The vertical gap between thumbnail and the text block. */
  gridCardTextGap: 4,
  /** Grid columns: 4 ≥1300 / 3 ≥1000 / 2 ≥600 / 1 <600. */
  gridColumns: { min1300: 4, min1000: 3, min600: 2, base: 1 } as const,
  /** The grid breakpoints, ascending. */
  gridBreakpoints: { two: 600, three: 1000, four: 1300 } as const,

  /* — Search card (search-card-grammar.json + design-tokens.md) — */
  /** Search result thumbnail width. */
  searchThumbWidth: 360,
  /** Search result thumbnail height. */
  searchThumbHeight: 202,
  /** The search row's thumb→meta gap. */
  searchGap: 16,

  /* — Watch layout (watch-geometry.md, [rendered] measured @1440) — */
  /** Secondary (related) column width, fixed. */
  watchSecondaryWidth: 412,
  /** The two-column gap (x=1028 − (16+996)). */
  watchColumnGap: 16,
  /** Page margin at 1440. */
  watchMargin: 16,
  /** Page margin at ≥1600. */
  watchMarginWide: 24,
  /** The wide-margin breakpoint. */
  watchWideBreakpoint: 1600,
  /** The player rect inside primary @1440 (16:9). */
  watchPlayerWidth: 996,
  /** The player rect's height @1440. */
  watchPlayerHeight: 560,
  /** The measured gap between the player bottom and the title block. */
  watchPlayerTextGap: 12,
  /** The single-column breakpoint (secondary drops below). */
  watchSingleColumnBreakpoint: 1016,
  /** The full-bleed player breakpoint. */
  watchFullBleedBreakpoint: 1000,

  /* — Watch anatomy (design-tokens.md Geometry) — */
  /** Player stage radius (2025 rounded player). */
  playerRadius: 12,
  /** The control bar height (48–49 [documented]; 48 pinned). */
  playerControlBarHeight: 48,
  /** The scrub track height at rest. */
  playerScrubTrackHeight: 3,
  /** The scrub track height on hover (the 4–5px band; 5 pinned). */
  playerScrubTrackHoverHeight: 5,
  /** The white scrubber dot ([documented] 12px). */
  playerScrubberDot: 12,
  /** Action pill height ([rendered] 40px buttons). */
  actionPillHeight: 40,
  /** Action pill radius (radius 20px). */
  actionPillRadius: 20,
  /** Watch channel avatar ([rendered] 40×40). */
  watchAvatar: 40,
  /** Description panel radius (rounded-12 surface panel). */
  descriptionPanelRadius: 12,
  /** Related compact card thumbnail (168×94). */
  relatedThumbWidth: 168,
  relatedThumbHeight: 94,
  /** Related compact card thumb→meta gap. */
  relatedGap: 4,

  /* — Shorts (app-shell.md shorts surface) — */
  /** The shorts stage's chrome reserve (100dvh − 96px). */
  shortsChromeHeight: 96,
  /** The shorts action-rail target size. */
  shortsActionTarget: 48,
  /** The shorts card thumbnail radius. */
  shortsRadius: 12,

  /* — Scrollbar (yt-watch-skeleton.css, [css]) — */
  scrollbarWidth: 16,
  scrollbarThumbRadius: 8,
  scrollbarThumbBorder: 4,
  scrollbarThumbMinHeight: 56,

  /* — Skeleton (yt-watch-skeleton.css, [css]) — */
  skeletonShellHeight: 20,
  skeletonShellRadius: 8,

  /* — Duration pill (design-tokens.md Typography) — */
  pillRadius: 4,
  pillPaddingX: 4,
  pillPaddingY: 3,
} as const;

/** THE motion + states contract (design-tokens.md Motion & states). */
export const R27_MOTION = {
  /** Default transition (the 120–200ms band; 150 pinned — the Web's value). */
  transitionMs: 150,
  /** The transition's easing. */
  transitionEasing: "ease" as const,
  /** Card hover dwell before preview disclosure. */
  hoverDwellMs: 500,
  /** Player controls idle fade (2–3s band; 3s pinned). */
  idleFadeMs: 3000,
  /** The chrome fade transition duration. */
  chromeFadeMs: 300,
  /** Focus ring width. */
  focusRingWidth: 2,
  /** Toast auto-dismiss. */
  toastMs: 4000,
} as const;

/** The default transition value as a CSS shorthand string. */
export const R27_TRANSITION_CSS = "150ms ease" as const;

// ---------------------------------------------------------------------------
// The resolvers (the single lookup path every consumer uses)
// ---------------------------------------------------------------------------

/**
 * Resolve one token's value for a theme. The ONLY sanctioned read path —
 * surfaces and the stylesheet emitter both go through here, so a theme
 * flip is one call, never a forked table.
 */
export function r27TokenValue(
  name: R27ParityTokenName,
  theme: R27ThemeName = "dark",
): string {
  const spec = R27_PARITY_TOKENS[name];
  if (spec === undefined) {
    throw new Error(`r27TokenValue: unknown parity token '${String(name)}'`);
  }
  return theme === "dark" ? spec.dark : spec.light;
}

/**
 * Resolve one typography role for a theme (the composite: font stack +
 * size/weight/line-height + the color token's value). The CSS utility
 * emitters and the surface view-models consume the same answer.
 */
export function r27TypeStyle(
  role: R27TypeRoleName,
  theme: R27ThemeName = "dark",
): {
  readonly font: string;
  readonly size: number;
  readonly weight: number;
  readonly lineHeight: number;
  readonly lineClamp: 0 | 2;
  readonly color: string;
} {
  const spec = R27_TYPE_SCALE[role];
  if (spec === undefined) {
    throw new Error(`r27TypeStyle: unknown type role '${String(role)}'`);
  }
  return {
    font: R27_FONT_STACK,
    size: spec.size,
    weight: spec.weight,
    lineHeight: spec.lineHeight,
    lineClamp: spec.lineClamp,
    color: r27TokenValue(spec.color, theme),
  };
}

// ---------------------------------------------------------------------------
// The freeze (the contract is immutable at runtime)
// ---------------------------------------------------------------------------

/** Deep-freeze helper (the frozen-sheet law). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

deepFreeze(R27_PARITY_TOKENS);
deepFreeze(R27_TYPE_SCALE);
deepFreeze(R27_GEOMETRY);
deepFreeze(R27_MOTION);
Object.freeze(R27_THEMES);
Object.freeze(R27_PARITY_TOKEN_NAMES);
Object.freeze(R27_TYPE_ROLE_NAMES);

/**
 * THE CONFORMANCE KEY (the machine-checkable mapping). Every token name →
 * its custom property + both themes' values, in the frozen order. W1's
 * harness (when it lands) and the lane's own pinning test both assert
 * against this projection; the evidence report renders it as the token
 * mapping table.
 */
export function r27TokenMappingTable(): readonly {
  readonly name: R27ParityTokenName;
  readonly cssName: string;
  readonly dark: string;
  readonly light: string;
  readonly provenance: readonly R27ProvenanceTag[];
  readonly sheet: string;
}[] {
  return R27_PARITY_TOKEN_NAMES.map((name) => {
    const spec = R27_PARITY_TOKENS[name];
    return {
      name,
      cssName: spec.cssName,
      dark: spec.dark,
      light: spec.light,
      provenance: spec.provenance,
      sheet: spec.sheet,
    };
  });
}
