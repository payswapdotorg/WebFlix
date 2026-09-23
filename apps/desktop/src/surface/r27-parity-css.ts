/**
 * @wfx/app-desktop — THE R27 PARITY STYLESHEET EMITTER (the Desktop
 * styling surface, W3's token overhaul).
 *
 * THE LAW: the Desktop webview's stylesheet is GENERATED from the token
 * contract (`./r27-parity-tokens.ts`), never hand-authored — every color
 * rides a `var(--wfx-*)` custom property the theme blocks emit, every
 * geometry/motion number interpolates from `R27_GEOMETRY`/`R27_MOTION`.
 * A value therefore exists exactly once (the single-encoding law); the
 * lead's webview build pipes `r27DesktopStylesheet()` into the frontend
 * dist, and the evidence harness bakes the same output into its captures
 * (the honest window-chrome mapping: the 1440×900 native window is the
 * corpus capture viewport; the OS title bar sits ABOVE this surface).
 *
 * GRAMMAR IDENTITY (the parity-between-apps law): the class grammar is
 * the same YouTube anatomy the Web lane renders (masthead → rail → chip
 * bar → card grid → search rows → measured two-column watch → chrome
 * overlay). Drift between the apps is a defect; both consume the sheet.
 *
 * WHAT THIS MODULE IS NOT: a CSS framework (no runtime deps — one string
 * emitter), a theme engine (the two theme blocks are the whole seam), or
 * component logic (the surfaces' view-models own structure; this owns
 * presentation).
 */

import {
  R27_GEOMETRY,
  R27_MOTION,
  R27_PARITY_TOKENS,
  R27_PARITY_TOKEN_NAMES,
  R27_TYPE_ROLE_NAMES,
  R27_TYPE_SCALE,
  type R27ThemeName,
} from "./r27-parity-tokens";

// ---------------------------------------------------------------------------
// The theme blocks (the custom properties — the token contract as CSS)
// ---------------------------------------------------------------------------

/**
 * Emit one theme's custom-property block. Dark lands on `:root` (the
 * DEFAULT product theme); light rides the `html[data-theme="light"]`
 * seam — the webview persists the choice and toggles the attribute.
 */
export function r27ThemeBlock(theme: R27ThemeName): string {
  const selector = theme === "dark" ? ":root" : 'html[data-theme="light"]';
  const lines = R27_PARITY_TOKEN_NAMES.map((name) => {
    const spec = R27_PARITY_TOKENS[name];
    return `  ${spec.cssName}: ${spec.dark === spec.light || theme === "dark" ? spec.dark : spec.light};`;
  });
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/** The theme seam: dark on :root, light behind the data-theme attribute. */
export function r27ThemeBlocks(): string {
  return [
    "/* — The theme seam: dark default, light behind data-theme — */",
    r27ThemeBlock("dark"),
    "",
    r27ThemeBlock("light"),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The base layer (reset, scrollbar, focus, typography utilities)
// ---------------------------------------------------------------------------

/** The base layer: reset + body + the corpus scrollbar + focus rings. */
export function r27BaseLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — Base: the corpus body, scrollbar, focus law — */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  color-scheme: dark;
  scrollbar-color: var(--wfx-scrollbar-thumb) transparent;
}

html[data-theme="light"] {
  color-scheme: light;
}

/* The corpus skeleton CSS scrollbar geometry, verbatim. */
body::-webkit-scrollbar {
  width: ${g.scrollbarWidth}px;
}

body::-webkit-scrollbar-thumb {
  height: ${g.scrollbarThumbMinHeight}px;
  border-radius: ${g.scrollbarThumbRadius}px;
  border: ${g.scrollbarThumbBorder}px solid transparent;
  background-clip: content-box;
  background-color: var(--wfx-scrollbar-thumb);
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--wfx-bg);
  color: var(--wfx-text);
  font: 400 14px/20px ${'"Roboto", "Arial", sans-serif'};
  -webkit-font-smoothing: antialiased;
}

/* The keyboard-focus law: a 2px link-family ring on every interactive. */
:focus-visible {
  outline: ${R27_MOTION.focusRingWidth}px solid var(--wfx-focus);
  outline-offset: 2px;
  border-radius: 4px;
}

.wfx-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}`;
}

/** The typography utilities: one class per sheet role. */
export function r27TypeUtilities(): string {
  const blocks = R27_TYPE_ROLE_NAMES.map((role) => {
    const spec = R27_TYPE_SCALE[role];
    const clamp = spec.lineClamp === 2
      ? `\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;`
      : "";
    const colorProp = R27_PARITY_TOKENS[spec.color].cssName;
    return `.wfx-type-${spec.role} {
  margin: 0;
  font-size: ${spec.size}px;
  font-weight: ${spec.weight};
  line-height: ${spec.lineHeight}px;
  color: var(${colorProp});${clamp}
}`;
  });
  return `/* — The typography ladder (the sheet's roles) — */\n${blocks.join("\n")}`;
}

// ---------------------------------------------------------------------------
// The app shell (masthead + rail + main region)
// ---------------------------------------------------------------------------

/** The app shell: the 56px masthead + the 240/72 rail + the main region. */
export function r27ShellLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — The app shell: masthead 56, rail 240/72, main region — */
.wfx-app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--wfx-bg);
  color: var(--wfx-text);
}

.wfx-app__frame {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.wfx-topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 16px;
  height: ${g.topbarHeight}px;
  padding: 0 16px;
  background: var(--wfx-bg);
  border-bottom: 1px solid var(--wfx-border-hairline);
}

.wfx-topbar__guide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--wfx-text);
  cursor: pointer;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-topbar__guide:hover {
  background: var(--wfx-bg-hover);
}

.wfx-topbar__wordmark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--wfx-text);
  text-decoration: none;
}

.wfx-topbar__wordmark-mark {
  color: var(--wfx-accent);
}

.wfx-topbar__center {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 auto;
  justify-content: center;
}

.wfx-topbar__search {
  display: flex;
  align-items: center;
  width: min(640px, 100%);
  height: ${g.searchPillHeight}px;
  border: 1px solid var(--wfx-border);
  border-radius: ${g.searchPillRadius}px;
  background: var(--wfx-bg);
  overflow: hidden;
}

.wfx-topbar__search:focus-within {
  border-color: var(--wfx-focus);
}

.wfx-topbar__search input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--wfx-text);
  font: 400 16px/24px "Roboto", "Arial", sans-serif;
  outline: none;
}

.wfx-topbar__search input::placeholder {
  color: var(--wfx-text-faint);
}

.wfx-topbar__search-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${g.searchPillHeight}px;
  height: 100%;
  border: none;
  border-left: 1px solid var(--wfx-border);
  border-radius: 0 ${g.searchPillRadius}px ${g.searchPillRadius}px 0;
  background: var(--wfx-bg-raised);
  color: var(--wfx-text);
  cursor: pointer;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-topbar__search-submit:hover {
  background: var(--wfx-bg-hover);
}

.wfx-topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wfx-topbar__avatar {
  width: ${g.topbarAvatar}px;
  height: ${g.topbarAvatar}px;
  border-radius: 50%;
  background: var(--wfx-bg-raised);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--wfx-text-dim);
  font-size: 13px;
  font-weight: 500;
}

/* The rail: 240px labeled ≥1280; 72px icon tiles 792–1279. The Desktop
 * window's minWidth is 960 (the native shell's own floor), so the <792
 * bottom-nav grammar never renders on this surface (the honest
 * window-chrome mapping — recorded in DIVERGENCES). */
.wfx-rail {
  flex: 0 0 ${g.railWidthLabeled}px;
  width: ${g.railWidthLabeled}px;
  position: sticky;
  top: ${g.topbarHeight}px;
  align-self: flex-start;
  max-height: calc(100vh - ${g.topbarHeight}px);
  overflow-y: auto;
  padding: 8px 12px 24px;
}

.wfx-rail__item {
  display: flex;
  align-items: center;
  gap: 24px;
  height: ${g.railItemHeight}px;
  padding: 0 12px;
  border: none;
  border-radius: ${g.railItemRadius}px;
  background: transparent;
  color: var(--wfx-text);
  font: 400 14px/20px "Roboto", "Arial", sans-serif;
  cursor: pointer;
  text-decoration: none;
  width: 100%;
  text-align: left;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-rail__item:hover {
  background: var(--wfx-bg-hover);
}

.wfx-rail__item--active {
  background: var(--wfx-bg-raised);
  font-weight: 500;
}

.wfx-rail__item svg {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
}

.wfx-rail__heading {
  margin: 16px 12px 4px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--wfx-text);
}

.wfx-rail__divider {
  margin: 12px 0;
  border: none;
  border-top: 1px solid var(--wfx-border-hairline);
}

@media (min-width: ${g.bottomNavBreakpoint}px) and (max-width: ${g.railIconBreakpoint - 1}px) {
  .wfx-rail {
    flex-basis: ${g.railWidthIcon}px;
    width: ${g.railWidthIcon}px;
    padding: 8px 0 24px;
  }

  .wfx-rail__item {
    flex-direction: column;
    gap: 4px;
    height: 74px;
    padding: 0;
    justify-content: center;
    font-size: 14px;
    text-align: center;
  }

  .wfx-rail__heading,
  .wfx-rail__divider {
    display: none;
  }
}

.wfx-main {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 0 48px;
}

@media (min-width: ${g.bottomNavBreakpoint}px) and (max-width: ${g.railIconBreakpoint - 1}px) {
  .wfx-main {
    margin-left: ${g.railWidthIcon}px;
  }
}

@media (min-width: ${g.railIconBreakpoint}px) {
  .wfx-main {
    margin-left: ${g.railWidthLabeled}px;
  }
}`;
}

// ---------------------------------------------------------------------------
// The chip bar + the card grid (the browse/home grammar)
// ---------------------------------------------------------------------------

/** The chip bar + the responsive card grid + the card anatomy. */
export function r27FeedLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — The feed: chip bar + responsive grid + the card anatomy — */
.wfx-chips {
  position: sticky;
  top: ${g.topbarHeight}px;
  z-index: 40;
  display: flex;
  gap: 12px;
  padding: ${g.chipRowPadding}px ${g.chipRowPadding + 4}px;
  background: var(--wfx-bg);
  overflow-x: auto;
  scrollbar-width: none;
}

.wfx-chips::-webkit-scrollbar {
  display: none;
}

.wfx-chips__mask-left,
.wfx-chips__mask-right {
  position: sticky;
  flex: 0 0 32px;
  top: 0;
  height: ${g.chipHeight + 2 * g.chipRowPadding}px;
  pointer-events: none;
  z-index: 41;
  display: none;
}

.wfx-chip {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: ${g.chipHeight}px;
  padding: 0 12px;
  border: none;
  border-radius: ${g.chipRadius}px;
  background: var(--wfx-bg-hover);
  color: var(--wfx-text);
  font: 500 14px/20px "Roboto", "Arial", sans-serif;
  white-space: nowrap;
  cursor: pointer;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-chip:hover {
  background: var(--wfx-bg-raised);
}

.wfx-chip--active {
  background: var(--wfx-cta-bg);
  color: var(--wfx-cta-fg);
}

.wfx-chip--active:hover {
  background: var(--wfx-cta-bg);
}

.wfx-grid {
  display: grid;
  grid-template-columns: repeat(${g.gridColumns.base}, minmax(0, 1fr));
  gap: ${g.gridGap}px ${g.gridGap}px;
  padding: 8px ${g.chipRowPadding + 4}px 0;
}

@media (min-width: ${g.gridBreakpoints.two}px) {
  .wfx-grid {
    grid-template-columns: repeat(${g.gridColumns.min600}, minmax(0, 1fr));
  }
}

@media (min-width: ${g.gridBreakpoints.three}px) {
  .wfx-grid {
    grid-template-columns: repeat(${g.gridColumns.min1000}, minmax(0, 1fr));
  }
}

@media (min-width: ${g.gridBreakpoints.four}px) {
  .wfx-grid {
    grid-template-columns: repeat(${g.gridColumns.min1300}, minmax(0, 1fr));
  }
}

.wfx-card {
  display: flex;
  flex-direction: column;
  gap: ${g.gridCardTextGap}px;
  background: transparent;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.wfx-card__thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  width: 100%;
  border-radius: ${g.cardRadius}px;
  overflow: hidden;
  background: var(--wfx-skeleton);
}

.wfx-card__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wfx-card__pill {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  padding: ${g.pillPaddingY}px ${g.pillPaddingX}px;
  border-radius: ${g.pillRadius}px;
  background: var(--wfx-pill-bg);
  color: var(--wfx-pill-fg);
  font: 500 12px/16px "Roboto", "Arial", sans-serif;
}

.wfx-card__progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: rgba(255, 255, 255, 0.2);
}

.wfx-card__progress-fill {
  height: 100%;
  background: var(--wfx-accent);
  transition: width ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-card:hover .wfx-card__progress,
.wfx-card:focus-visible .wfx-card__progress {
  height: 4px;
}

.wfx-card__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}

.wfx-card__title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
  color: var(--wfx-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wfx-card__channel {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--wfx-text-dim);
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  transition: color ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-card__channel:hover {
  color: var(--wfx-text);
}

.wfx-card__meta {
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--wfx-text-dim);
}

.wfx-card__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--wfx-border);
  border-radius: 999px;
  font: 500 12px/16px "Roboto", "Arial", sans-serif";
  color: var(--wfx-text-dim);
  width: fit-content;
}

/* The feed skeleton: thumbnail shell + 20px text shells, radius 8. */
.wfx-skel-card {
  display: flex;
  flex-direction: column;
  gap: ${g.gridCardTextGap}px;
}

.wfx-skel-card__thumb {
  aspect-ratio: 16 / 9;
  border-radius: ${g.cardRadius}px;
  background: var(--wfx-skeleton);
}

.wfx-skel-card__line {
  height: ${g.skeletonShellHeight}px;
  border-radius: ${g.skeletonShellRadius}px;
  background: var(--wfx-skeleton);
}

.wfx-skel-card__line--meta {
  width: 60%;
}

.wfx-skel-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}`;
}

// ---------------------------------------------------------------------------
// The search surface (the row-card grammar)
// ---------------------------------------------------------------------------

/** The search page: the Filters header row + the result-row grammar. */
export function r27SearchLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — Search: the row-card grammar (360×202 left, meta column right) — */
.wfx-search {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px ${g.chipRowPadding + 4}px 48px;
  max-width: 1096px;
}

.wfx-search__header {
  display: flex;
  justify-content: flex-end;
}

.wfx-search__filters {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: ${g.chipHeight}px;
  padding: 0 12px;
  border: none;
  border-radius: ${g.chipRadius}px;
  background: var(--wfx-bg-hover);
  color: var(--wfx-text);
  font: 500 14px/20px "Roboto", "Arial", sans-serif;
  cursor: pointer;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-search__filters:hover {
  background: var(--wfx-bg-raised);
}

.wfx-search__results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wfx-srow {
  display: flex;
  gap: ${g.searchGap}px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.wfx-srow__thumb {
  position: relative;
  flex: 0 0 ${g.searchThumbWidth}px;
  width: ${g.searchThumbWidth}px;
  aspect-ratio: 16 / 9;
  border-radius: ${g.cardRadius}px;
  overflow: hidden;
  background: var(--wfx-skeleton);
}

.wfx-srow__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wfx-srow__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}

.wfx-srow__title {
  margin: 0;
  font-size: 18px;
  font-weight: 400;
  line-height: 26px;
  color: var(--wfx-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wfx-srow__channel {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--wfx-text-dim);
}

.wfx-srow__line {
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--wfx-text-dim);
}

.wfx-srow__snippet {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: var(--wfx-text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wfx-srow__badges {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

@media (max-width: ${g.gridBreakpoints.three}px) {
  .wfx-srow__thumb {
    flex-basis: 246px;
    width: 246px;
  }
}`;
}

// ---------------------------------------------------------------------------
// The watch surface (the measured two-column anatomy)
// ---------------------------------------------------------------------------

/** The watch page: two-column layout, h1, owner/actions, description. */
export function r27WatchLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — Watch: the measured two-column anatomy (primary + 412 secondary) — */
.wfx-watch {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px ${g.watchColumnGap}px;
  padding: 0 ${g.watchMargin}px 48px;
}

@media (min-width: ${g.watchSingleColumnBreakpoint}px) {
  .wfx-watch {
    grid-template-columns: minmax(0, 1fr) ${g.watchSecondaryWidth}px;
  }
}

@media (min-width: ${g.watchWideBreakpoint}px) {
  .wfx-watch {
    padding: 0 ${g.watchMarginWide}px 48px;
  }
}

.wfx-watch__primary {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wfx-watch__stage {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: ${g.playerRadius}px;
  overflow: hidden;
  background: var(--wfx-stage-black); /* the corpus player letterbox */
}

.wfx-watch__title {
  margin: ${g.watchPlayerTextGap}px 0 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 28px;
  color: var(--wfx-text);
}

.wfx-watch__info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 12px 0 0;
  flex-wrap: wrap;
}

.wfx-watch__owner {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.wfx-watch__avatar {
  width: ${g.watchAvatar}px;
  height: ${g.watchAvatar}px;
  border-radius: 50%;
  background: var(--wfx-bg-raised);
  color: var(--wfx-text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 500;
  flex: 0 0 auto;
}

.wfx-watch__owner-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--wfx-text);
  margin: 0;
}

.wfx-watch__owner-meta {
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--wfx-text-dim);
  margin: 0;
}

.wfx-watch__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.wfx-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: ${g.actionPillHeight}px;
  padding: 0 16px;
  border: none;
  border-radius: ${g.actionPillRadius}px;
  background: var(--wfx-bg-hover);
  color: var(--wfx-text);
  font: 500 14px/20px "Roboto", "Arial", sans-serif;
  white-space: nowrap;
  cursor: pointer;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-pill:hover {
  background: var(--wfx-bg-raised);
}

/* The segmented like/dislike grammar (20 0 0 20 + 0 20 20 0). */
.wfx-pill-group {
  display: inline-flex;
}

.wfx-pill-group .wfx-pill {
  border-radius: 0;
}

.wfx-pill-group .wfx-pill:first-child {
  border-radius: ${g.actionPillRadius}px 0 0 ${g.actionPillRadius}px;
  border-right: 1px solid var(--wfx-border-hairline);
}

.wfx-pill-group .wfx-pill:last-child {
  border-radius: 0 ${g.actionPillRadius}px ${g.actionPillRadius}px 0;
}

/* The description panel: raised surface, radius 12, 14/20, expander. */
.wfx-watch__desc {
  margin: 12px 0 0;
  padding: 12px 16px;
  border-radius: ${g.descriptionPanelRadius}px;
  background: var(--wfx-bg-raised);
  color: var(--wfx-text);
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  border: none;
  text-align: left;
}

.wfx-watch__desc-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wfx-watch__desc-more {
  display: inline-block;
  margin-top: 4px;
  font-weight: 500;
}

/* The related sidebar: chips row + compact cards (168×94, 4px gap). */
.wfx-watch__secondary {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.wfx-related__chips {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  overflow-x: auto;
  scrollbar-width: none;
  list-style: none;
}

.wfx-related__chips::-webkit-scrollbar {
  display: none;
}

.wfx-related-chip {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: var(--wfx-bg-hover);
  color: var(--wfx-text);
  font: 500 14px/20px "Roboto", "Arial", sans-serif;
  white-space: nowrap;
  cursor: pointer;
}

.wfx-related-chip--active {
  background: var(--wfx-cta-bg);
  color: var(--wfx-cta-fg);
}

.wfx-related {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wfx-rcard {
  display: flex;
  gap: ${g.relatedGap}px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.wfx-rcard__thumb {
  position: relative;
  flex: 0 0 ${g.relatedThumbWidth}px;
  width: ${g.relatedThumbWidth}px;
  aspect-ratio: 16 / 9;
  border-radius: ${g.descriptionPanelRadius}px;
  overflow: hidden;
  background: var(--wfx-skeleton);
}

.wfx-rcard__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wfx-rcard__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wfx-rcard__title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--wfx-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wfx-rcard__channel {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--wfx-text-dim);
}

.wfx-rcard__meta-line {
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--wfx-text-dim);
}`;
}

// ---------------------------------------------------------------------------
// The player chrome (the control grammar, overlaying the stage bottom)
// ---------------------------------------------------------------------------

/** The player chrome: scrub + bar + the two-level settings popup. */
export function r27ChromeLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — The player chrome: the control bar anatomy, overlay bottom — */
.wfx-chrome {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: linear-gradient(to top, var(--wfx-chrome-scrim), rgba(0, 0, 0, 0));
  color: var(--wfx-chrome-fg);
  transition: opacity ${R27_MOTION.chromeFadeMs}ms ease;
}

.wfx-chrome[data-wfx-chrome-idle="true"] {
  opacity: 0;
  pointer-events: none;
}

.wfx-chrome[data-wfx-chrome-idle="true"]:focus-within {
  opacity: 1;
  pointer-events: auto;
}

.wfx-chrome__scrub {
  display: flex;
  align-items: center;
  padding: 0 12px;
  height: 20px;
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
}

.wfx-chrome__track {
  position: relative;
  flex: 1 1 auto;
  height: ${g.playerScrubTrackHeight}px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  transition: height ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-chrome__scrub:hover .wfx-chrome__track,
.wfx-chrome__scrub:focus-visible .wfx-chrome__track {
  height: ${g.playerScrubTrackHoverHeight}px;
}

.wfx-chrome__buffered {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.4);
}

.wfx-chrome__played {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 999px;
  background: var(--wfx-accent);
}

.wfx-chrome__dot {
  position: absolute;
  top: 50%;
  width: ${g.playerScrubberDot}px;
  height: ${g.playerScrubberDot}px;
  border-radius: 50%;
  background: var(--wfx-accent);
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-chrome__scrub:hover .wfx-chrome__dot,
.wfx-chrome__scrub:focus-visible .wfx-chrome__dot {
  opacity: 1;
}

.wfx-chrome__readout {
  flex: 0 0 auto;
  margin-left: 12px;
  font: 500 12px/16px "Roboto", "Arial", sans-serif;
  color: var(--wfx-chrome-fg);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.wfx-chrome__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0;
  height: ${g.playerControlBarHeight}px;
  padding: 0 8px;
}

.wfx-chrome__cluster {
  display: flex;
  align-items: center;
  gap: 0;
}

.wfx-chrome__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--wfx-chrome-fg);
  cursor: pointer;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-chrome__btn:hover {
  background: var(--wfx-bg-hover);
}

.wfx-chrome__btn svg {
  width: 24px;
  height: 24px;
}

/* The two-level settings popup (back-arrow navigation). */
.wfx-cmenu {
  position: absolute;
  right: 12px;
  bottom: ${g.playerControlBarHeight + 8}px;
  z-index: 20;
  min-width: 256px;
  max-height: 60%;
  overflow-y: auto;
  padding: 8px 0;
  border-radius: ${g.descriptionPanelRadius}px;
  background: var(--wfx-bg-raised);
  color: var(--wfx-text);
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.5);
}

.wfx-cmenu__head {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--wfx-border-hairline);
  font: 500 14px/20px "Roboto", "Arial", sans-serif;
  color: var(--wfx-text);
}

.wfx-cmenu__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--wfx-text);
  cursor: pointer;
}

.wfx-cmenu__back:hover {
  background: var(--wfx-bg-hover);
}

.wfx-cmenu__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--wfx-text);
  font: 400 14px/20px "Roboto", "Arial", sans-serif;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.wfx-cmenu__row:hover {
  background: var(--wfx-bg-hover);
}

.wfx-cmenu__row--active {
  color: var(--wfx-text);
  font-weight: 500;
}

.wfx-cmenu__check {
  color: var(--wfx-text);
  width: 20px;
  display: inline-flex;
  justify-content: center;
}`;
}

// ---------------------------------------------------------------------------
// The shorts surface (9:16 + action rail)
// ---------------------------------------------------------------------------

/** The shorts stage: full-bleed vertical + the right action rail. */
export function r27ShortsLayer(): string {
  const g = R27_GEOMETRY;
  return `/* — Shorts: the 9:16 stage + the action rail — */
.wfx-shorts {
  position: relative;
  height: calc(100vh - ${g.topbarHeight}px);
  min-height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--wfx-bg);
  overflow: hidden;
}

.wfx-shorts__stage {
  position: relative;
  aspect-ratio: 9 / 16;
  height: min(100%, calc(100vh - ${g.topbarHeight + g.shortsChromeHeight}px));
  max-width: min(100vw - ${g.shortsActionTarget * 2}px, calc((100vh - ${g.topbarHeight + g.shortsChromeHeight}px) * 9 / 16));
  border-radius: ${g.shortsRadius}px;
  overflow: hidden;
  background: var(--wfx-stage-black);
}

.wfx-shorts__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wfx-shorts__rail {
  position: absolute;
  right: max(24px, calc(50% - ((100vh - ${g.topbarHeight + g.shortsChromeHeight}px) * 9 / 32) - ${g.shortsActionTarget * 2}px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wfx-shorts__action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--wfx-text);
  cursor: pointer;
  min-width: ${g.shortsActionTarget}px;
  min-height: ${g.shortsActionTarget}px;
  padding: 0;
}

.wfx-shorts__action svg {
  width: 24px;
  height: 24px;
}

.wfx-shorts__count {
  font: 500 12px/16px "Roboto", "Arial", sans-serif;
  color: var(--wfx-text);
}

.wfx-shorts__overlay {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--wfx-chrome-fg);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.wfx-shorts__title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
}

.wfx-shorts__channel {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}`;
}

// ---------------------------------------------------------------------------
// The honest WebFlix blocks, styled INTO the grammar
// ---------------------------------------------------------------------------

/**
 * The WebFlix-first-class surfaces rendered inside the YouTube grammar:
 * Where-to-watch (a viewing-source choice), the acquisition lifecycle
 * states inside the player chrome, library/queue rows, and the toast.
 */
export function r27WebflixLayer(): string {
  const g = R27_GEOMETRY;
  const sectionHeading = R27_TYPE_SCALE["section-heading"];
  return `/* — The WebFlix-first-class blocks, in the corpus grammar — */
/* Where-to-watch: the viewing-source groups (panel + rows + pills). */
.wfx-w2w {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 0;
  padding: 16px;
  border-radius: ${g.descriptionPanelRadius}px;
  background: var(--wfx-bg-raised);
}

.wfx-w2w__heading {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
  color: var(--wfx-text);
}

.wfx-w2w__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wfx-w2w__group-label {
  margin: 8px 0 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--wfx-text);
}

.wfx-w2w__group-detail {
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--wfx-text-dim);
}

.wfx-w2w__way {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: ${g.actionPillRadius}px;
  background: transparent;
  color: var(--wfx-text);
  font: 400 14px/20px "Roboto", "Arial", sans-serif;
  cursor: pointer;
  text-align: left;
  transition: background ${R27_MOTION.transitionMs}ms ${R27_MOTION.transitionEasing};
}

.wfx-w2w__way:hover {
  background: var(--wfx-bg-hover);
}

.wfx-w2w__way--selected {
  border-color: var(--wfx-link);
}

.wfx-w2w__way-label {
  font-weight: 500;
}

.wfx-w2w__way-detail {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--wfx-text-dim);
}

.wfx-w2w__way-state {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: var(--wfx-text-dim);
  white-space: nowrap;
}

/* The acquisition lifecycle inside the player chrome (the honest states). */
.wfx-lifecycle {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  background: rgba(0, 0, 0, 0.54);
  color: var(--wfx-chrome-fg);
  text-align: center;
}

.wfx-lifecycle__label {
  margin: 0;
  font: 500 16px/22px "Roboto", "Arial", sans-serif;
}

.wfx-lifecycle__detail {
  margin: 0;
  max-width: 48ch;
  font: 400 14px/20px "Roboto", "Arial", sans-serif;
  color: rgba(255, 255, 255, 0.85);
}

.wfx-lifecycle__meter {
  width: min(320px, 70%);
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  overflow: hidden;
}

.wfx-lifecycle__meter-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--wfx-accent);
  transition: width ${R27_MOTION.chromeFadeMs}ms ease;
}

/* The library/queue rows + panels. */
.wfx-library {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 ${g.chipRowPadding + 4}px 48px;
}

.wfx-library__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wfx-library__heading {
  margin: 0;
  font-size: ${sectionHeading.size}px;
  font-weight: ${sectionHeading.weight};
  line-height: ${sectionHeading.lineHeight}px;
  color: var(--wfx-text);
}

.wfx-library__rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.wfx-library__row {
  display: flex;
  gap: ${g.relatedGap + 4}px;
  padding: 12px;
  border-radius: ${g.descriptionPanelRadius}px;
  background: var(--wfx-bg-raised);
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.wfx-library__row-thumb {
  position: relative;
  flex: 0 0 ${g.relatedThumbWidth}px;
  width: ${g.relatedThumbWidth}px;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: var(--wfx-skeleton);
}

.wfx-library__row-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* The settings panels (the same panel anatomy). */
.wfx-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 ${g.chipRowPadding + 4}px 48px;
  max-width: 864px;
}

.wfx-settings__panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: ${g.descriptionPanelRadius}px;
  background: var(--wfx-bg-raised);
}

.wfx-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
}

.wfx-settings__row-label {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--wfx-text);
}

.wfx-settings__row-detail {
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--wfx-text-dim);
}

/* The toast (bottom-left inverted pill, ~4s). */
.wfx-toast {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-radius: 8px;
  background: var(--wfx-toast-bg);
  color: var(--wfx-toast-fg);
  font: 400 14px/20px "Roboto", "Arial", sans-serif;
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.4);
}`;
}

// ---------------------------------------------------------------------------
// THE STYLESHEET (the single emission the webview consumes)
// ---------------------------------------------------------------------------

/**
 * THE Desktop webview parity stylesheet — the theme seam + every grammar
 * layer, emitted from the token contract. This one string is the styling
 * surface: the lead's frontend dist build writes it into the webview, and
 * the evidence capture harness bakes the identical output.
 */
export function r27DesktopStylesheet(): string {
  return [
    "/* WebFlix Desktop — the R27 parity stylesheet (GENERATED from",
    "   apps/desktop/src/surface/r27-parity-tokens.ts; corpus sheet",
    "   docs/parity-lab/reference/design-tokens.md — do not hand-edit",
    "   values here; the token contract is the single encoding). */",
    "",
    r27ThemeBlocks(),
    "",
    r27BaseLayer(),
    "",
    r27TypeUtilities(),
    "",
    r27ShellLayer(),
    "",
    r27FeedLayer(),
    "",
    r27SearchLayer(),
    "",
    r27WatchLayer(),
    "",
    r27ChromeLayer(),
    "",
    r27ShortsLayer(),
    "",
    r27WebflixLayer(),
    "",
  ].join("\n");
}
