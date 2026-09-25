/**
 * @wfx/platform-contracts — THE R27 PARITY TOKEN CONTRACT (W1, the
 * reference-keeper lane: the corpus as the ONE canonical machine-readable
 * shared encoding).
 *
 * THE LAW (docs/parity-lab/README.md — "the corpus is the contract"):
 * every value in this module is the MIRROR of the lead's corpus —
 * `docs/parity-lab/reference/design-tokens.md` (THE token sheet), plus
 * the measured geometry of `watch-geometry.md`, the shell anatomy of
 * `app-shell.md`, and the card grammar of `search-card-grammar.json`,
 * all captured from live youtube.com on 2026-09-23. This module ENCODES
 * the corpus, never reinterprets it: each token carries its provenance
 * tags ([rendered] / [css] / [documented]) and the exact sheet row it
 * mirrors, so the lead's conformance pass can trace every value.
 *
 * THE SINGLE-ENCODING LAW (the lab's frozen law 5 + this lane's charter):
 * ONE canonical token module; BOTH apps (Web + Desktop) consume it. The
 * `cssName` of every token is the canonical `--wfx-*` custom property —
 * the SAME name grammar the apps' parity surfaces already adopted
 * (the Web's `apps/web/src/app/globals.css` and the Desktop's generated
 * `apps/desktop/src/surface/r27-parity-css.ts` theme blocks). Drift
 * between a surface and this contract is a conformance defect the
 * harness (see `./parity-conformance.ts` + `tests/parity-conformance.test.ts`)
 * reports as a DIFF.
 *
 * HONEST IDENTITY (the lab's frozen law 1): the contract carries WebFlix
 * naming (`--wfx-*`) and encodes YouTube's DESIGN LANGUAGE — tokens,
 * geometry, typography, interaction grammar — never its trade dress.
 *
 * CAPABILITY TRUTH (the lab's frozen law 2, carried from R26): the
 * player-chrome vocabulary below types WHICH controls are unconditional
 * and which are AVAILABILITY-GATED (next renders only when a queue
 * exists; captions only when a captions transport exists). Tokens carry
 * no capability truth themselves — surfaces own that — but the control
 * grammar records the gating honestly.
 *
 * WHAT THIS MODULE IS NOT: a theme engine (two themes, resolved by
 * name), a CSS emitter (apps own their stylesheets; this owns the VALUES
 * + the name mapping), or product policy.
 *
 * THEMES: dark is the DEFAULT product theme (YouTube's dark); light is
 * the second supported theme. Both are first-class in every table.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The two supported themes (dark is the product default). */
export type ParityTheme = "dark" | "light";

/** THE R27 themes, in frozen order (dark first — the default). */
export const PARITY_THEMES: readonly ParityTheme[] = ["dark", "light"] as const;

/** The corpus provenance vocabulary (the sheet's own tags). */
export type ParityProvenanceTag = "rendered" | "css" | "documented";

/**
 * One corpus token: the value per theme + the provenance tags + the sheet
 * row it mirrors + the canonical CSS custom property both apps carry.
 */
export interface ParityTokenSpec {
  /** The canonical `--wfx-*` custom property name (the name mapping). */
  readonly cssName: string;
  /** The DARK theme value (the default product theme). */
  readonly dark: string;
  /** The LIGHT theme value (the second supported theme). */
  readonly light: string;
  /** The sheet's provenance tags for this row. */
  readonly provenance: readonly ParityProvenanceTag[];
  /** The corpus sheet row this token mirrors (the conformance trace). */
  readonly sheet: string;
}

// ---------------------------------------------------------------------------
// THE COLOR/SURFACE TOKEN SHEET (Canvas & surfaces + the composite
// surfaces the sheet's other sections pin)
// ---------------------------------------------------------------------------

/**
 * THE color/surface token contract — every row of the corpus sheet's
 * "Canvas & surfaces" table plus the composite surfaces the sheet's
 * other sections pin (duration pill, scrollbar, skeleton, toast, focus
 * ring, CTA, player-chrome). Frozen: mutation is a conformance defect.
 */
export const PARITY_TOKENS = {
  /** App background — [rendered] `ytd-app` bg; [css] skeleton `html[dark] #0f0f0f`. */
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
    sheet: "design-tokens.md: Canvas & surfaces — subscribe-style primary channel action",
  },
  /** The Subscribe-style primary CTA ink. */
  "cta-ink": {
    cssName: "--wfx-cta-fg",
    dark: "#0f0f0f",
    light: "#ffffff",
    provenance: ["documented"],
    sheet: "design-tokens.md: Canvas & surfaces — subscribe-style primary channel action",
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
} as const satisfies Record<string, ParityTokenSpec>;

/** The color/surface token names (the closed vocabulary). */
export type ParityTokenName = keyof typeof PARITY_TOKENS;

/** Every token name, in the sheet's frozen order. */
export const PARITY_TOKEN_NAMES: readonly ParityTokenName[] = Object.keys(
  PARITY_TOKENS,
) as readonly ParityTokenName[];

// ---------------------------------------------------------------------------
// The typography ladder (the sheet's roles, the exact Roboto stack)
// ---------------------------------------------------------------------------

/**
 * The exact font stack ([rendered]): `"Roboto", "Arial", sans-serif`.
 * The sheet's own fallback-chain note: `Roboto, Arial, Helvetica,
 * sans-serif` with the system fallback chain — the parity target is
 * Roboto rendering where available (the no-new-runtime-deps law).
 */
export const PARITY_FONT_STACK = '"Roboto", "Arial", sans-serif' as const;

/** The sheet's long fallback chain note, verbatim. */
export const PARITY_FONT_STACK_FALLBACK_NOTE =
  "Roboto, Arial, Helvetica, sans-serif with the system fallback chain — the parity target is Roboto rendering where available." as const;

/** One typography role on the sheet's ladder. */
export interface ParityTypeSpec {
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
  readonly color: ParityTokenName;
  readonly provenance: readonly ParityProvenanceTag[];
  readonly sheet: string;
}

/** THE typography ladder — the sheet's Typography table, frozen. */
export const PARITY_TYPE_SCALE = {
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
} as const satisfies Record<string, ParityTypeSpec>;

/** The typography role names (the closed ladder). */
export type ParityTypeRoleName = keyof typeof PARITY_TYPE_SCALE;

/** Every typography role, in the sheet's frozen order. */
export const PARITY_TYPE_ROLE_NAMES: readonly ParityTypeRoleName[] = Object.keys(
  PARITY_TYPE_SCALE,
) as readonly ParityTypeRoleName[];

// ---------------------------------------------------------------------------
// THE GEOMETRY CONTRACT (the sheet's measured values + watch-geometry.md)
// ---------------------------------------------------------------------------

/** One geometry value with its provenance + the corpus row it mirrors. */
export interface ParityGeometrySpec {
  readonly value: number;
  readonly unit: "px" | "ratio" | "count";
  readonly provenance: readonly ParityProvenanceTag[];
  readonly sheet: string;
}

/**
 * THE geometry contract — every measured/documented number of the sheet's
 * Geometry table plus `watch-geometry.md`'s measured rects and
 * `app-shell.md`'s shell anatomy. Frozen.
 */
export const PARITY_GEOMETRY = {
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
  /** Bottom nav height <792 ([documented], + safe-area). */
  bottomNavHeight: 48,
  /** Search pill height/radius (app-shell.md center cluster, 40px full pill). */
  searchPillHeight: 40,
  /** The search pill's full radius (radius 40 = height). */
  searchPillRadius: 40,
  /** Topbar avatar diameter (app-shell.md right cluster). */
  topbarAvatar: 32,

  /* — Chip bar (app-shell.md home feed; [rendered] chip h=32) — */
  /** Chip height. */
  chipHeight: 32,
  /** Chip radius ([documented] topic chips radius 8px). */
  chipRadius: 8,
  /** The chip row's padding (~12px). */
  chipRowPadding: 12,

  /* — Card grid (design-tokens.md Geometry — home grid card) — */
  /** Card thumbnail radius (2025 YouTube rounded cards). */
  cardRadius: 12,
  /** Card grid gap (16px×16px). */
  gridGap: 16,
  /** The vertical gap between thumbnail and the text block (4px). */
  gridCardTextGap: 4,
  /** Grid columns: 4 ≥1300 / 3 ≥1000 / 2 ≥600 / 1 <600. */
  gridColumns: { min1300: 4, min1000: 3, min600: 2, base: 1 },
  /** The grid breakpoints, ascending. */
  gridBreakpoints: { two: 600, three: 1000, four: 1300 },

  /* — Search card (search-card-grammar.json + design-tokens.md) — */
  /** Search result thumbnail width (the left 16:9 thumb). */
  searchThumbWidth: 360,
  /** Search result thumbnail height. */
  searchThumbHeight: 202,
  /** The search row's thumb→meta gap. */
  searchGap: 16,

  /* — Watch layout (watch-geometry.md, [rendered] measured @1440) — */
  /** The PRIMARY column's measured rect width (player 996 + the 16px intra-column gap to the secondary). */
  watchPrimaryWidth: 1012,
  /** Secondary (related) column width, fixed. */
  watchSecondaryWidth: 412,
  /** The measured secondary column x-offset @1440. */
  watchSecondaryX: 1028,
  /** The two-column gap (x=1028 − (16+996)). */
  watchColumnGap: 16,
  /** Page margin at 1440. */
  watchMargin: 16,
  /** Page margin at ≥1600. */
  watchMarginWide: 24,
  /** The wide-margin breakpoint. */
  watchWideBreakpoint: 1600,
  /** The player rect inside primary @1440 (x=16 y=68, 16:9 + 12px control bar). */
  watchPlayerWidth: 996,
  /** The player rect's height @1440. */
  watchPlayerHeight: 560,
  /** The player rect's x-offset @1440 (the page margin). */
  watchPlayerX: 16,
  /** The measured gap between the topbar and the player (y=68 − 56). */
  watchTopGap: 12,
  /** The measured gap between the player bottom (y=628) and the title block (y=640). */
  watchPlayerTextGap: 12,
  /** The owner row's measured width (avatar + name; watch-geometry.md). */
  watchOwnerRowWidth: 274,
  /** The actions row's measured width (right-aligned pills). */
  watchActionsRowWidth: 690,
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
  /** Related compact card thumbnail height. */
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
  /** Scrollbar track width. */
  scrollbarWidth: 16,
  /** Scrollbar thumb radius. */
  scrollbarThumbRadius: 8,
  /** Scrollbar thumb transparent border. */
  scrollbarThumbBorder: 4,
  /** Scrollbar thumb minimum height. */
  scrollbarThumbMinHeight: 56,

  /* — Skeleton (yt-watch-skeleton.css, [css]) — */
  /** Skeleton text-shell height. */
  skeletonShellHeight: 20,
  /** Skeleton text-shell radius. */
  skeletonShellRadius: 8,

  /* — Duration pill (design-tokens.md Typography) — */
  /** Duration pill radius. */
  pillRadius: 4,
  /** Duration pill horizontal padding. */
  pillPaddingX: 4,
  /** Duration pill vertical padding. */
  pillPaddingY: 3,
} as const;

/**
 * The provenance record for every geometry value (the traceability table —
 * same keys as `PARITY_GEOMETRY`, each mapped to its corpus row).
 */
export const PARITY_GEOMETRY_PROVENANCE: Readonly<
  Record<keyof typeof PARITY_GEOMETRY, readonly ParityProvenanceTag[]>
> = {
  topbarHeight: ["rendered"],
  railWidthLabeled: ["rendered"],
  railWidthIcon: ["documented"],
  railItemHeight: ["documented"],
  railItemRadius: ["documented"],
  railIconBreakpoint: ["documented"],
  bottomNavBreakpoint: ["documented"],
  bottomNavHeight: ["documented"],
  searchPillHeight: ["rendered", "documented"],
  searchPillRadius: ["documented"],
  topbarAvatar: ["rendered"],
  chipHeight: ["rendered"],
  chipRadius: ["documented"],
  chipRowPadding: ["rendered", "documented"],
  cardRadius: ["documented"],
  gridGap: ["documented"],
  gridCardTextGap: ["documented"],
  gridColumns: ["documented"],
  gridBreakpoints: ["documented"],
  searchThumbWidth: ["rendered"],
  searchThumbHeight: ["rendered"],
  searchGap: ["rendered"],
  watchPrimaryWidth: ["rendered"],
  watchSecondaryWidth: ["rendered"],
  watchSecondaryX: ["rendered"],
  watchColumnGap: ["rendered"],
  watchMargin: ["rendered"],
  watchMarginWide: ["rendered"],
  watchWideBreakpoint: ["documented"],
  watchPlayerWidth: ["rendered"],
  watchPlayerHeight: ["rendered"],
  watchPlayerX: ["rendered"],
  watchTopGap: ["rendered"],
  watchPlayerTextGap: ["rendered"],
  watchOwnerRowWidth: ["rendered"],
  watchActionsRowWidth: ["rendered"],
  watchSingleColumnBreakpoint: ["documented"],
  watchFullBleedBreakpoint: ["documented"],
  playerRadius: ["documented"],
  playerControlBarHeight: ["documented"],
  playerScrubTrackHeight: ["documented"],
  playerScrubTrackHoverHeight: ["documented"],
  playerScrubberDot: ["documented"],
  actionPillHeight: ["rendered"],
  actionPillRadius: ["rendered"],
  watchAvatar: ["rendered"],
  descriptionPanelRadius: ["rendered"],
  relatedThumbWidth: ["documented"],
  relatedThumbHeight: ["documented"],
  relatedGap: ["documented"],
  shortsChromeHeight: ["documented"],
  shortsActionTarget: ["documented"],
  shortsRadius: ["documented"],
  scrollbarWidth: ["css"],
  scrollbarThumbRadius: ["css"],
  scrollbarThumbBorder: ["css"],
  scrollbarThumbMinHeight: ["css"],
  skeletonShellHeight: ["css"],
  skeletonShellRadius: ["css"],
  pillRadius: ["rendered"],
  pillPaddingX: ["rendered"],
  pillPaddingY: ["rendered"],
} as const;

// ---------------------------------------------------------------------------
// THE MOTION + STATES CONTRACT (design-tokens.md Motion & states)
// ---------------------------------------------------------------------------

/** THE motion + states contract — frozen. */
export const PARITY_MOTION = {
  /** Default transition (the 120–200ms band; 150 pinned — both apps' value). */
  transitionMs: 150,
  /** The transition's easing. */
  transitionEasing: "ease" as const,
  /** Card hover dwell before preview disclosure (~500ms). */
  hoverDwellMs: 500,
  /** Player controls idle fade (2–3s band; 3s pinned). */
  idleFadeMs: 3000,
  /** The chrome fade transition duration (the 120–300ms band's top). */
  chromeFadeMs: 300,
  /** Focus ring width (2px outline, link-family color). */
  focusRingWidth: 2,
  /** Toast auto-dismiss (~4s). */
  toastMs: 4000,
} as const;

/** The default transition value as a CSS shorthand string. */
export const PARITY_TRANSITION_CSS = "150ms ease" as const;

// ---------------------------------------------------------------------------
// THE PLAYER-CHROME CONTROL + KEYBOARD GRAMMAR (OPERATE reference)
// ---------------------------------------------------------------------------

/** How a chrome control's presence is decided (the capability-truth law). */
export type ParityControlAvailability =
  /** Always rendered in the bar (play/pause, volume, time, spacer). */
  | "always"
  /** Renders only when the truth it needs exists (a queued next item). */
  | "when-queued"
  /** Renders only when the platform capability exists (captions transport). */
  | "capability-gated"
  /** WebFlix's own capability rows, progressively disclosed in the popup. */
  | "wfx-capability-row";

/** One control in the corpus's bottom-bar order (left → right). */
export interface ParityChromeControlSpec {
  readonly id: string;
  readonly label: string;
  readonly availability: ParityControlAvailability;
  /** The corpus's own description of the control. */
  readonly detail: string;
  readonly sheet: string;
}

/**
 * THE player-chrome control grammar — the corpus's left→right order:
 * play/pause (· next/up-next when queued), volume (hover slider), time
 * `0:00 / 7:45`, spacer, cc/captions, settings gear (two-level popup:
 * speed, quality, + WebFlix's honest capability rows), miniplayer,
 * theater, fullscreen.
 */
export const PARITY_CHROME_CONTROLS: readonly ParityChromeControlSpec[] = [
  {
    id: "play-pause",
    label: "Play/Pause",
    availability: "always",
    detail: "Leftmost control; toggles playback.",
    sheet: "design-tokens.md: Player chrome anatomy",
  },
  {
    id: "next",
    label: "Next",
    availability: "when-queued",
    detail: "Next/up-next — renders only when a queue head exists.",
    sheet: "design-tokens.md: Player chrome anatomy — next/up-next when queued",
  },
  {
    id: "volume",
    label: "Volume",
    availability: "always",
    detail: "Volume with a hover slider.",
    sheet: "design-tokens.md: Player chrome anatomy — volume (hover slider)",
  },
  {
    id: "time",
    label: "Time",
    availability: "always",
    detail: "The time readout `cur / dur` (e.g. 0:00 / 7:45).",
    sheet: "design-tokens.md: Player chrome anatomy — time",
  },
  {
    id: "spacer",
    label: "Spacer",
    availability: "always",
    detail: "The flexible spacer between time and the right cluster.",
    sheet: "design-tokens.md: Player chrome anatomy — spacer",
  },
  {
    id: "captions",
    label: "Captions",
    availability: "capability-gated",
    detail: "cc/captions toggle — only when a captions transport truthfully exists.",
    sheet: "design-tokens.md: Player chrome anatomy — cc/captions toggle",
  },
  {
    id: "settings",
    label: "Settings",
    availability: "always",
    detail:
      "Settings gear — two-level popup menu with back-arrow navigation (speed, quality, …); WebFlix's honest capability rows (Translate, Transcript, AI, Where to watch) live here, progressively disclosed, capability-truth-gated.",
    sheet: "design-tokens.md: Player chrome anatomy — settings gear (popup menu: speed, quality, etc.)",
  },
  {
    id: "miniplayer",
    label: "Miniplayer",
    availability: "always",
    detail: "The miniplayer mode toggle.",
    sheet: "design-tokens.md: Player chrome anatomy — miniplayer",
  },
  {
    id: "theater",
    label: "Theater",
    availability: "always",
    detail: "Theater mode toggle (the `t` key's target).",
    sheet: "design-tokens.md: Player chrome anatomy — theater",
  },
  {
    id: "fullscreen",
    label: "Fullscreen",
    availability: "always",
    detail: "Fullscreen toggle; double-click on the stage fullscreens.",
    sheet: "design-tokens.md: Player chrome anatomy — fullscreen",
  },
] as const;

/** The typed player keyboard action (the corpus's keyboard grammar). */
export interface ParityKeyboardActionSpec {
  readonly keys: readonly string[];
  readonly action: string;
  /** The action's parameter (±seconds, percent, …) when one applies. */
  readonly param: number | null;
  readonly sheet: string;
}

/**
 * THE player keyboard grammar — `space`/`k` play-pause · `j`/`l` ∓10s ·
 * `←`/`→` ∓5s · `↑`/`↓` volume · `f` fullscreen · `t` theater · `m`
 * mute · `c` captions (capability-gated) · `0–9` seek-to-percent.
 */
export const PARITY_KEYBOARD: readonly ParityKeyboardActionSpec[] = [
  { keys: [" ", "k"], action: "play-pause", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard" },
  { keys: ["j"], action: "seek-back", param: 10, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (j ∓10s)" },
  { keys: ["l"], action: "seek-forward", param: 10, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (l +10s)" },
  { keys: ["ArrowLeft"], action: "seek-back", param: 5, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (← ∓5s)" },
  { keys: ["ArrowRight"], action: "seek-forward", param: 5, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (→ +5s)" },
  { keys: ["ArrowUp"], action: "volume-up", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (↑ volume)" },
  { keys: ["ArrowDown"], action: "volume-down", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (↓ volume)" },
  { keys: ["f"], action: "fullscreen", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (f fullscreen)" },
  { keys: ["t"], action: "theater", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (t theater)" },
  { keys: ["m"], action: "mute", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (m mute)" },
  { keys: ["c"], action: "captions", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (c captions)" },
  { keys: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], action: "seek-to-percent", param: null, sheet: "design-tokens.md: Player chrome anatomy — Keyboard (0–9 seek-to-percent)" },
] as const;

/** The touch grammar (the corpus's touch anatomy). */
export const PARITY_TOUCH = {
  /** Double-tap zones seek ±10s on touch. */
  doubleTapSeekSeconds: 10,
  /** Double-click on the stage fullscreens. */
  doubleClickFullscreen: true,
  /** Hover on the scrub track previews (hover-scrub). */
  hoverScrubPreview: true,
} as const;

// ---------------------------------------------------------------------------
// The resolvers (the single lookup path every consumer uses)
// ---------------------------------------------------------------------------

/**
 * Resolve one token's value for a theme. The ONLY sanctioned read path —
 * surfaces and conformance checks both go through here.
 */
export function parityTokenValue(
  name: ParityTokenName,
  theme: ParityTheme = "dark",
): string {
  const spec = PARITY_TOKENS[name];
  if (spec === undefined) {
    throw new Error(`parityTokenValue: unknown parity token '${String(name)}'`);
  }
  return theme === "dark" ? spec.dark : spec.light;
}

/**
 * Resolve one typography role for a theme (the composite: font stack +
 * size/weight/line-height + clamp + the color token's value).
 */
export function parityTypeStyle(
  role: ParityTypeRoleName,
  theme: ParityTheme = "dark",
): {
  readonly font: string;
  readonly size: number;
  readonly weight: number;
  readonly lineHeight: number;
  readonly lineClamp: 0 | 2;
  readonly color: string;
} {
  const spec = PARITY_TYPE_SCALE[role];
  if (spec === undefined) {
    throw new Error(`parityTypeStyle: unknown type role '${String(role)}'`);
  }
  return {
    font: PARITY_FONT_STACK,
    size: spec.size,
    weight: spec.weight,
    lineHeight: spec.lineHeight,
    lineClamp: spec.lineClamp,
    color: parityTokenValue(spec.color, theme),
  };
}

/**
 * THE CONFORMANCE KEY (the machine-checkable mapping). Every token name →
 * its canonical custom property + both themes' values + provenance, in
 * the frozen order. The conformance harness asserts each app's stylesheet
 * against this projection; the evidence reports render it as the token
 * mapping table.
 */
export function parityTokenMappingTable(): readonly {
  readonly name: ParityTokenName;
  readonly cssName: string;
  readonly dark: string;
  readonly light: string;
  readonly provenance: readonly ParityProvenanceTag[];
  readonly sheet: string;
}[] {
  return PARITY_TOKEN_NAMES.map((name) => {
    const spec = PARITY_TOKENS[name];
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

// ---------------------------------------------------------------------------
// The JSON serialization (the sheet, machine-readable)
// ---------------------------------------------------------------------------

/** The machine-readable parity sheet (the JSON serialization's shape). */
export interface ParitySheetJson {
  readonly contract: "webflix-parity-sheet";
  readonly version: "r27";
  readonly themes: readonly ParityTheme[];
  readonly fontStack: string;
  readonly fontStackFallbackNote: string;
  readonly tokens: readonly {
    readonly name: ParityTokenName;
    readonly cssName: string;
    readonly dark: string;
    readonly light: string;
    readonly provenance: readonly ParityProvenanceTag[];
    readonly sheet: string;
  }[];
  readonly typeScale: readonly {
    readonly role: string;
    readonly size: number;
    readonly weight: number;
    readonly lineHeight: number;
    readonly lineClamp: 0 | 2;
    readonly color: ParityTokenName;
    readonly provenance: readonly ParityProvenanceTag[];
    readonly sheet: string;
  }[];
  readonly geometry: Readonly<
    Record<string, number | Readonly<Record<string, number>>>
  >;
  readonly geometryProvenance: Readonly<
    Record<string, readonly ParityProvenanceTag[]>
  >;
  readonly motion: Readonly<Record<string, number | string>>;
  readonly chromeControls: readonly ParityChromeControlSpec[];
  readonly keyboard: readonly ParityKeyboardActionSpec[];
  readonly touch: Readonly<Record<string, number | boolean>>;
}

/** The parity sheet as a plain object (the JSON serialization's source). */
export function paritySheet(): ParitySheetJson {
  return {
    contract: "webflix-parity-sheet",
    version: "r27",
    themes: PARITY_THEMES,
    fontStack: PARITY_FONT_STACK,
    fontStackFallbackNote: PARITY_FONT_STACK_FALLBACK_NOTE,
    tokens: parityTokenMappingTable(),
    typeScale: PARITY_TYPE_ROLE_NAMES.map((role) => {
      const spec = PARITY_TYPE_SCALE[role];
      return {
        role: spec.role,
        size: spec.size,
        weight: spec.weight,
        lineHeight: spec.lineHeight,
        lineClamp: spec.lineClamp,
        color: spec.color,
        provenance: spec.provenance,
        sheet: spec.sheet,
      };
    }),
    geometry: PARITY_GEOMETRY,
    geometryProvenance: PARITY_GEOMETRY_PROVENANCE,
    motion: PARITY_MOTION,
    chromeControls: PARITY_CHROME_CONTROLS,
    keyboard: PARITY_KEYBOARD,
    touch: PARITY_TOUCH,
  };
}

/** The parity sheet serialized as JSON (machine-readable, stable key order). */
export function paritySheetJson(): string {
  return JSON.stringify(paritySheet(), null, 2);
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

deepFreeze(PARITY_TOKENS);
deepFreeze(PARITY_TYPE_SCALE);
deepFreeze(PARITY_GEOMETRY);
deepFreeze(PARITY_GEOMETRY_PROVENANCE);
deepFreeze(PARITY_MOTION);
deepFreeze(PARITY_CHROME_CONTROLS);
deepFreeze(PARITY_KEYBOARD);
deepFreeze(PARITY_TOUCH);
Object.freeze(PARITY_THEMES);
Object.freeze(PARITY_TOKEN_NAMES);
Object.freeze(PARITY_TYPE_ROLE_NAMES);
