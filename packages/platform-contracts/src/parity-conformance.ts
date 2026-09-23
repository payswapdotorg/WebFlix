/**
 * @wfx/platform-contracts — THE R27 PARITY CONFORMANCE ENGINE (W1, the
 * reference-keeper lane: the lab's proof instrument).
 *
 * THE CHARTER (the lane packet): parse each app's stylesheet surface and
 * assert the CORPUS VALUES are the ACTIVE custom properties — the
 * canonical `--wfx-*` name mapping from `./parity-tokens.ts` — in BOTH
 * themes (dark `:root` + the light seam), plus the structural anatomy
 * markers that are CSS-derivable (topbar height, rail widths, chip
 * geometry, watch grid columns/gap, action-pill radius, scrollbar spec,
 * skeleton shells). Every failed check answers a DIFF message (expected
 * corpus value vs found) so W2/W3 can self-correct mechanically.
 *
 * THE STATUS MODE (conformance:status): the engine classifies each
 * surface —
 * - `"conformant"`  — the surface is parity-retargeted and every check
 *   passes (the merged lane's green state);
 * - `"drift"`       — parity-retargeted but checks FAILED (the
 *   self-correct signal: the diffs name every defect);
 * - `"pending"`     — the surface has NOT been retargeted yet (the
 *   pre-lane stylesheet still carries the legacy palette): the corpus
 *   contract is PRESENT but the app surface is PENDING its lane. This is
 *   the expected state of a surface whose parity lane has not merged;
 *   it is never silently green — the report carries the first diffs.
 *
 * WHAT THIS MODULE IS: a PURE engine — CSS text in, findings out. It
 * reads no filesystem and imports no app code; the shared test tree
 * (`tests/parity-conformance.test.ts`) wires the real surfaces (the
 * Web's `globals.css` + the Desktop's generated stylesheet) through it
 * and enforces the battery policy.
 *
 * WHAT THIS MODULE IS NOT: a CSS engine (a minimal parser sufficient for
 * the two apps' stylesheet shapes — rules, @media nesting, declarations,
 * var() resolution), a linter, or a style generator.
 */

import {
  PARITY_TOKENS,
  PARITY_TOKEN_NAMES,
  type ParityTokenName,
} from "./parity-tokens";

// ---------------------------------------------------------------------------
// The CSS parsing (minimal, sufficient for the apps' stylesheet shapes)
// ---------------------------------------------------------------------------

/** One parsed CSS rule: a selector, its declarations, its @media context. */
export interface ParityCssRule {
  /** The normalized selector text (e.g. `.wfx-topbar`, `:root`). */
  readonly selector: string;
  /** The rule's declarations (property → normalized value). */
  readonly declarations: Readonly<Record<string, string>>;
  /** The enclosing @media condition (raw, e.g. `(min-width: 1016px)`); null at top level. */
  readonly media: string | null;
}

/** Strip CSS comments. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Normalize a selector: collapse whitespace, trim. */
function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** Normalize a declaration property: trim, lowercase. */
function normalizeProperty(property: string): string {
  return property.trim().toLowerCase();
}

/** Normalize a declaration value: collapse whitespace, no spaces around commas or slashes, lowercase. */
export function normalizeCssValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*\/\s*/g, "/")
    .trim()
    .toLowerCase();
}

/** Parse the declarations of one rule body into a property → value map. */
function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const property = normalizeProperty(part.slice(0, colon));
    const value = part.slice(colon + 1).trim();
    if (property.length > 0 && value.length > 0) {
      declarations[property] = normalizeCssValue(value);
    }
  }
  return declarations;
}

/**
 * Parse a stylesheet into rules. Handles nested @media blocks
 * (recursively flattened with their condition); @keyframes inner blocks
 * parse as harmless never-queried rules. Comments are stripped first.
 */
export function parseParityCss(css: string): readonly ParityCssRule[] {
  const out: ParityCssRule[] = [];
  parseInto(stripComments(css), null, out);
  return out;
}

function parseInto(
  css: string,
  media: string | null,
  out: ParityCssRule[],
): void {
  let prelude = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      const selector = normalizeSelector(prelude);
      // Find the matching close brace (depth-aware).
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        const c = css[j];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      if (selector.startsWith("@media")) {
        const condition = selector.replace(/^@media\s*/i, "").trim();
        parseInto(
          body,
          media === null ? condition : `${media} and ${condition}`,
          out,
        );
      } else if (selector.length > 0 && !selector.startsWith("@")) {
        out.push({
          selector,
          declarations: parseDeclarations(body),
          media,
        });
      }
      i = j;
      prelude = "";
      continue;
    }
    if (ch === "}") {
      prelude = "";
      i++;
      continue;
    }
    prelude += ch;
    i++;
  }
}

/**
 * Resolve `var(--x[, fallback])` references in a declaration value
 * against a property table (the surface's own theme block). Bounded
 * (guard against cycles); unresolvable vars keep the fallback or the
 * literal text (so the diff stays truthful).
 */
export function resolveCssVars(
  value: string,
  properties: Readonly<Record<string, string>>,
): string {
  let out = value;
  let guard = 0;
  while (out.includes("var(") && guard < 10) {
    const next = out.replace(
      /var\(([^),]+)(?:,([^()]*))?\)/g,
      (_match: string, name: string, fallback: string) => {
        const resolved = properties[String(name).trim()];
        if (resolved !== undefined) return resolved;
        return fallback !== undefined ? fallback.trim() : "var-unresolved";
      },
    );
    if (next === out) break;
    out = next;
    guard++;
  }
  return out;
}

/** Find the first rule matching a selector (and optionally a media substring). */
export function findParityRule(
  rules: readonly ParityCssRule[],
  selector: string,
  mediaContains?: string,
): ParityCssRule | undefined {
  const wanted = normalizeSelector(selector);
  return rules.find(
    (rule) =>
      rule.selector === wanted &&
      (mediaContains === undefined ||
        (rule.media ?? "").includes(mediaContains)),
  );
}

/** The column component of a `gap` shorthand ("24px 16px" → "16px"). */
export function gapComponentOf(
  value: string,
  which: "row" | "column",
): string {
  const parts = value.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return value;
  if (parts.length === 1) return parts[0] ?? value;
  return which === "row" ? (parts[0] ?? value) : (parts[1] ?? parts[0] ?? value);
}

// ---------------------------------------------------------------------------
// The surface descriptors (what each app's surface must prove)
// ---------------------------------------------------------------------------

/** One structural anatomy check, expressed against CSS-derivable markers. */
export interface ParityStructuralCheckSpec {
  readonly id: string;
  readonly description: string;
  /** The exact selector to find (e.g. `.wfx-topbar`, `:root`). */
  readonly selector: string;
  /** A substring the enclosing @media condition must contain (e.g. `"1016px"`). */
  readonly mediaContains?: string;
  /** The declaration property (e.g. `height`, `grid-template-columns`, `--wfx-topbar-h`). */
  readonly property: string;
  /** The expected normalized value (corpus). */
  readonly expected: string;
  /** When true, the FOUND value must CONTAIN `expected` (for composite values). */
  readonly expectedContains?: boolean;
  /** For `gap` shorthands: compare only the row/column component. */
  readonly gapComponent?: "row" | "column";
  /** Resolve var() references in the FOUND value against the surface's :root first. */
  readonly resolveVars?: boolean;
}

/** One app's parity surface: the tokens it must carry + the structural checks. */
export interface ParitySurfaceDescriptor {
  readonly id: "web" | "desktop";
  readonly label: string;
  /** Canonical token names this surface MUST carry as active custom properties. */
  readonly requiredTokens: readonly ParityTokenName[];
  readonly structuralChecks: readonly ParityStructuralCheckSpec[];
}

/**
 * The DESKTOP surface descriptor — the generated webview stylesheet
 * (`apps/desktop/src/surface/r27-parity-css.ts`, W3's token overhaul,
 * merged): every canonical token active in both theme blocks + the full
 * structural anatomy.
 */
export const DESKTOP_PARITY_SURFACE: ParitySurfaceDescriptor = {
  id: "desktop",
  label: "Desktop (the generated webview stylesheet)",
  requiredTokens: PARITY_TOKEN_NAMES,
  structuralChecks: [
    { id: "topbar-height", description: "the 56px masthead", selector: ".wfx-topbar", property: "height", expected: "56px" },
    { id: "rail-labeled-width", description: "the 240px labeled rail", selector: ".wfx-rail", property: "width", expected: "240px" },
    { id: "rail-icon-width", description: "the 72px icon rail (792–1279)", selector: ".wfx-rail", property: "width", expected: "72px", mediaContains: "792px" },
    { id: "rail-item-height", description: "the 48px rail row", selector: ".wfx-rail__item", property: "height", expected: "48px" },
    { id: "rail-item-radius", description: "the 10px rail hover radius", selector: ".wfx-rail__item", property: "border-radius", expected: "10px" },
    { id: "chip-height", description: "the 32px chip", selector: ".wfx-chip", property: "height", expected: "32px" },
    { id: "chip-radius", description: "the 8px chip radius", selector: ".wfx-chip", property: "border-radius", expected: "8px" },
    { id: "grid-gap-column", description: "the 16px card-grid column gap", selector: ".wfx-grid", property: "gap", expected: "16px", gapComponent: "column" },
    { id: "grid-gap-row", description: "the 16px card-grid row gap", selector: ".wfx-grid", property: "gap", expected: "16px", gapComponent: "row" },
    { id: "grid-columns-1", description: "the 1-column base grid", selector: ".wfx-grid", property: "grid-template-columns", expected: "repeat(1,", expectedContains: true },
    { id: "grid-columns-2", description: "the 2-column grid ≥600", selector: ".wfx-grid", property: "grid-template-columns", expected: "repeat(2,", expectedContains: true, mediaContains: "600px" },
    { id: "grid-columns-3", description: "the 3-column grid ≥1000", selector: ".wfx-grid", property: "grid-template-columns", expected: "repeat(3,", expectedContains: true, mediaContains: "1000px" },
    { id: "grid-columns-4", description: "the 4-column grid ≥1300", selector: ".wfx-grid", property: "grid-template-columns", expected: "repeat(4,", expectedContains: true, mediaContains: "1300px" },
    { id: "card-thumb-ratio", description: "the 16:9 feed thumbnail", selector: ".wfx-card__thumb", property: "aspect-ratio", expected: "16/9" },
    { id: "card-thumb-radius", description: "the 12px card radius", selector: ".wfx-card__thumb", property: "border-radius", expected: "12px" },
    { id: "card-title-size", description: "the 16px card title", selector: ".wfx-card__title", property: "font-size", expected: "16px" },
    { id: "card-title-weight", description: "the 500 card title weight", selector: ".wfx-card__title", property: "font-weight", expected: "500" },
    { id: "card-title-line-height", description: "the 22px card title line-height", selector: ".wfx-card__title", property: "line-height", expected: "22px" },
    { id: "pill-padding", description: "the duration pill 3px 4px padding", selector: ".wfx-card__pill", property: "padding", expected: "3px 4px" },
    { id: "pill-radius", description: "the duration pill 4px radius", selector: ".wfx-card__pill", property: "border-radius", expected: "4px" },
    { id: "skeleton-line-height", description: "the 20px skeleton shell", selector: ".wfx-skel-card__line", property: "height", expected: "20px" },
    { id: "skeleton-line-radius", description: "the 8px skeleton shell radius", selector: ".wfx-skel-card__line", property: "border-radius", expected: "8px" },
    { id: "search-thumb-width", description: "the 360px search thumbnail", selector: ".wfx-srow__thumb", property: "width", expected: "360px" },
    { id: "search-thumb-ratio", description: "the 16:9 search thumbnail", selector: ".wfx-srow__thumb", property: "aspect-ratio", expected: "16/9" },
    { id: "search-title-size", description: "the 18px search title", selector: ".wfx-srow__title", property: "font-size", expected: "18px" },
    { id: "search-title-weight", description: "the 400 search title weight", selector: ".wfx-srow__title", property: "font-weight", expected: "400" },
    { id: "search-row-gap", description: "the 16px search row gap", selector: ".wfx-srow", property: "gap", expected: "16px", gapComponent: "column" },
    { id: "watch-two-column", description: "the measured two-column watch grid (secondary 412px)", selector: ".wfx-watch", property: "grid-template-columns", expected: "412px", expectedContains: true, mediaContains: "1016px" },
    { id: "watch-column-gap", description: "the 16px watch column gap", selector: ".wfx-watch", property: "gap", expected: "16px", gapComponent: "column" },
    { id: "watch-margin-1440", description: "the 16px page margin at 1440", selector: ".wfx-watch", property: "padding", expected: "16px", expectedContains: true },
    { id: "watch-margin-wide", description: "the 24px page margin ≥1600", selector: ".wfx-watch", property: "padding", expected: "24px", expectedContains: true, mediaContains: "1600px" },
    { id: "stage-ratio", description: "the 16:9 player stage", selector: ".wfx-watch__stage", property: "aspect-ratio", expected: "16/9" },
    { id: "stage-radius", description: "the 12px player radius", selector: ".wfx-watch__stage", property: "border-radius", expected: "12px" },
    { id: "action-pill-height", description: "the 40px action pill", selector: ".wfx-pill", property: "height", expected: "40px" },
    { id: "action-pill-radius", description: "the 20px action pill radius", selector: ".wfx-pill", property: "border-radius", expected: "20px" },
    { id: "watch-avatar", description: "the 40px watch avatar", selector: ".wfx-watch__avatar", property: "width", expected: "40px" },
    { id: "desc-panel-radius", description: "the 12px description panel radius", selector: ".wfx-watch__desc", property: "border-radius", expected: "12px" },
    { id: "related-gap", description: "the 4px related compact gap", selector: ".wfx-rcard", property: "gap", expected: "4px", gapComponent: "column" },
    { id: "related-thumb-width", description: "the 168px related thumbnail", selector: ".wfx-rcard__thumb", property: "width", expected: "168px" },
    { id: "shorts-ratio", description: "the 9:16 shorts stage", selector: ".wfx-shorts__stage", property: "aspect-ratio", expected: "9/16" },
    { id: "scrollbar-width", description: "the 16px scrollbar track", selector: "body::-webkit-scrollbar", property: "width", expected: "16px" },
    { id: "scrollbar-thumb-radius", description: "the 8px scrollbar thumb radius", selector: "body::-webkit-scrollbar-thumb", property: "border-radius", expected: "8px" },
    { id: "scrollbar-thumb-border", description: "the 4px transparent thumb border", selector: "body::-webkit-scrollbar-thumb", property: "border", expected: "4px solid transparent" },
    { id: "scrollbar-thumb-min-height", description: "the 56px thumb min height", selector: "body::-webkit-scrollbar-thumb", property: "height", expected: "56px" },
  ],
};

/**
 * The WEB surface descriptor — `apps/web/src/app/globals.css` after the
 * W2 parity retarget: the tokens the Web carries as active custom
 * properties (its core corpus set) + the structural anatomy its classes
 * expose. Surface-scoped tokens the Web does not declare (pill/toast/
 * chrome/chrome-ink/stage-black custom properties) are REPORTED, not
 * failed — the Web renders those anatomies with literal values today;
 * adopting the canonical names is the follow-up convergence.
 */
export const WEB_PARITY_SURFACE: ParitySurfaceDescriptor = {
  id: "web",
  label: "Web (apps/web/src/app/globals.css)",
  requiredTokens: [
    "app-bg",
    "raised-surface",
    "hover-surface",
    "divider",
    "text-primary",
    "text-secondary",
    "text-tertiary",
    "link",
    "focus-ring",
    "brand-red",
    "cta-surface",
    "cta-ink",
    "skeleton",
  ],
  structuralChecks: [
    { id: "topbar-height", description: "the 56px masthead (custom property)", selector: ":root", property: "--wfx-topbar-h", expected: "56px" },
    { id: "rail-labeled-width", description: "the 240px labeled rail (custom property)", selector: ":root", property: "--wfx-rail-w-wide", expected: "240px" },
    { id: "rail-icon-width", description: "the 72px icon rail (custom property)", selector: ":root", property: "--wfx-rail-w", expected: "72px" },
    { id: "bottomnav-height", description: "the 48px bottom nav (custom property)", selector: ":root", property: "--wfx-bottomnav-h", expected: "48px" },
    { id: "card-radius", description: "the 12px card radius (custom property)", selector: ":root", property: "--wfx-radius", expected: "12px" },
    { id: "radius-sm", description: "the 8px small radius (custom property)", selector: ":root", property: "--wfx-radius-sm", expected: "8px" },
    { id: "radius-xs", description: "the 4px pill radius (custom property)", selector: ":root", property: "--wfx-radius-xs", expected: "4px" },
    { id: "transition", description: "the 150ms ease default transition", selector: ":root", property: "--wfx-transition", expected: "150ms ease" },
    { id: "chip-height", description: "the 32px chip", selector: ".wfx-chip", property: "height", expected: "32px" },
    { id: "chip-radius", description: "the 8px chip radius", selector: ".wfx-chip", property: "border-radius", expected: "8px" },
    { id: "grid-columns-1", description: "the 1-column base grid", selector: ".wfx-row__scroller", property: "grid-template-columns", expected: "repeat(1,", expectedContains: true },
    { id: "grid-columns-2", description: "the 2-column grid ≥600", selector: ".wfx-row__scroller", property: "grid-template-columns", expected: "repeat(2,", expectedContains: true, mediaContains: "600px" },
    { id: "grid-columns-3", description: "the 3-column grid ≥1000", selector: ".wfx-row__scroller", property: "grid-template-columns", expected: "repeat(3,", expectedContains: true, mediaContains: "1000px" },
    { id: "grid-columns-4", description: "the 4-column grid ≥1300", selector: ".wfx-row__scroller", property: "grid-template-columns", expected: "repeat(4,", expectedContains: true, mediaContains: "1300px" },
    { id: "grid-gap", description: "the 16px card-grid gap", selector: ".wfx-row__scroller", property: "gap", expected: "16px", gapComponent: "column" },
    { id: "card-thumb-ratio", description: "the 16:9 feed thumbnail", selector: ".wfx-card__thumb", property: "aspect-ratio", expected: "16/9" },
    { id: "card-thumb-radius", description: "the 12px card radius (var-resolved)", selector: ".wfx-card__thumb", property: "border-radius", expected: "12px", resolveVars: true },
    { id: "card-title-size", description: "the 16px card title", selector: ".wfx-card__title", property: "font-size", expected: "16px" },
    { id: "card-title-weight", description: "the 500 card title weight", selector: ".wfx-card__title", property: "font-weight", expected: "500" },
    { id: "card-title-line-height", description: "the 22px card title line-height", selector: ".wfx-card__title", property: "line-height", expected: "22px" },
    { id: "pill-padding", description: "the badge/pill 3px 4px padding", selector: ".wfx-badge", property: "padding", expected: "3px 4px" },
    { id: "pill-radius", description: "the badge/pill 4px radius (var-resolved)", selector: ".wfx-badge", property: "border-radius", expected: "4px", resolveVars: true },
    { id: "skeleton-line-height", description: "the 20px skeleton shell", selector: ".wfx-skeleton-card__line", property: "height", expected: "20px" },
    { id: "skeleton-line-radius", description: "the 8px skeleton shell radius (var-resolved)", selector: ".wfx-skeleton-card__line", property: "border-radius", expected: "8px", resolveVars: true },
    { id: "skeleton-thumb-ratio", description: "the 16:9 skeleton thumbnail", selector: ".wfx-skeleton-card__thumb", property: "aspect-ratio", expected: "16/9" },
    { id: "watch-two-column", description: "the measured two-column watch grid (secondary 412px)", selector: ".wfx-player__layout", property: "grid-template-columns", expected: "412px", expectedContains: true, mediaContains: "1016px" },
    { id: "watch-column-gap", description: "the 16px watch column gap (the corpus's measured gap)", selector: ".wfx-player__layout", property: "gap", expected: "16px", gapComponent: "column", mediaContains: "1016px" },
    { id: "stage-radius", description: "the 12px player stage radius (var-resolved)", selector: ".wfx-player__stagewrap", property: "border-radius", expected: "12px", resolveVars: true },
    { id: "scrollbar-width", description: "the 16px scrollbar track", selector: "body::-webkit-scrollbar", property: "width", expected: "16px" },
    { id: "scrollbar-thumb-radius", description: "the 8px scrollbar thumb radius", selector: "body::-webkit-scrollbar-thumb", property: "border-radius", expected: "8px" },
    { id: "scrollbar-thumb-border", description: "the 4px transparent thumb border", selector: "body::-webkit-scrollbar-thumb", property: "border", expected: "4px solid transparent" },
    { id: "scrollbar-thumb-min-height", description: "the 56px thumb min height", selector: "body::-webkit-scrollbar-thumb", property: "height", expected: "56px" },
  ],
};

// ---------------------------------------------------------------------------
// The evaluation (CSS in → findings out)
// ---------------------------------------------------------------------------

/** One conformance finding — a DIFF the surface must self-correct. */
export interface ParityConformanceFinding {
  /** The check id (e.g. `token:app-bg:dark`, `structure:chip-height`). */
  readonly check: string;
  /** The corpus expectation. */
  readonly expected: string;
  /** What the surface actually carries (`<missing>` / `<rule not found>` when absent). */
  readonly found: string;
  /** The human DIFF message (self-correct instruction). */
  readonly diff: string;
}

/** One surface's conformance status. */
export interface ParitySurfaceConformance {
  readonly id: "web" | "desktop";
  readonly label: string;
  /** `conformant` (retargeted + all checks pass) · `drift` (retargeted, findings exist) · `pending` (not yet retargeted — the pre-lane stylesheet). */
  readonly status: "conformant" | "drift" | "pending";
  /** Whether the surface has been parity-retargeted at all. */
  readonly retargeted: boolean;
  readonly tokenFindings: readonly ParityConformanceFinding[];
  readonly structuralFindings: readonly ParityConformanceFinding[];
  /** Canonical tokens the surface does NOT declare (surface-scoped — informational). */
  readonly undeclaredTokens: readonly ParityTokenName[];
  /** True iff status is `conformant`. */
  readonly ok: boolean;
}

/** The dark-theme block selector (the default product theme). */
const DARK_SELECTOR = ":root";
/** The light-theme seam selector (the second supported theme). */
const LIGHT_SELECTOR = 'html[data-theme="light"]';

/** Merge every top-level rule with the given selector into one property table. */
function themePropsOf(
  rules: readonly ParityCssRule[],
  selector: string,
): Record<string, string> {
  const props: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selector === selector && rule.media === null) {
      Object.assign(props, rule.declarations);
    }
  }
  return props;
}

/**
 * Evaluate one surface's conformance (PURE). The classification:
 *
 * - retargeted = the `:root` canvas carries the corpus dark `#0f0f0f`,
 *   OR the surface already declares most of the canonical `--wfx-*`
 *   vocabulary (a retargeted surface with a drifted value must classify
 *   as retargeted — drift, never a silent pending);
 * - a retargeted surface with zero findings is `conformant`;
 * - a retargeted surface with findings is `drift` (self-correct);
 * - a non-retargeted surface is `pending` (its lane has not landed) —
 *   the findings still carry the first diffs for the lane to fix.
 */
export function evaluateParitySurfaceConformance(
  css: string,
  descriptor: ParitySurfaceDescriptor,
): ParitySurfaceConformance {
  const rules = parseParityCss(css);
  const darkProps = themePropsOf(rules, DARK_SELECTOR);
  const lightProps = themePropsOf(rules, LIGHT_SELECTOR);

  // — the retargeted detection —
  const corpusBg = normalizeCssValue(PARITY_TOKENS["app-bg"].dark);
  const declaredCanonical = PARITY_TOKEN_NAMES.filter(
    (name) => darkProps[PARITY_TOKENS[name].cssName] !== undefined,
  );
  const retargeted =
    darkProps["--wfx-bg"] === corpusBg || declaredCanonical.length >= 12;

  const tokenFindings: ParityConformanceFinding[] = [];
  const undeclaredTokens: ParityTokenName[] = [];

  // — the light seam must exist (both themes are first-class) —
  if (Object.keys(lightProps).length === 0) {
    tokenFindings.push({
      check: "theme:light-seam",
      expected: `a ${LIGHT_SELECTOR} block carrying the light theme`,
      found: "<missing>",
      diff: `theme:light-seam — the light theme seam (${LIGHT_SELECTOR}) is MISSING; the corpus light values must be active custom properties too`,
    });
  }

  // — every canonical token: declared values must equal the corpus —
  for (const name of PARITY_TOKEN_NAMES) {
    const spec = PARITY_TOKENS[name];
    const required = descriptor.requiredTokens.includes(name);

    const darkDeclared = darkProps[spec.cssName];
    if (darkDeclared === undefined) {
      if (required) {
        tokenFindings.push({
          check: `token:${name}:dark`,
          expected: spec.dark,
          found: "<missing>",
          diff: `token:${name}:dark — ${spec.cssName} is MISSING from :root; declare the corpus value ${spec.dark} (${spec.sheet})`,
        });
      } else {
        undeclaredTokens.push(name);
      }
    } else if (darkDeclared !== normalizeCssValue(spec.dark)) {
      tokenFindings.push({
        check: `token:${name}:dark`,
        expected: spec.dark,
        found: darkDeclared,
        diff: `token:${name}:dark — ${spec.cssName}: expected ${spec.dark} (the corpus value — ${spec.sheet}), found ${darkDeclared}`,
      });
    }

    const lightDeclared = lightProps[spec.cssName];
    // The light theme's ACTIVE value follows the CSS cascade: the light
    // seam's declaration, falling back to the :root (dark) declaration —
    // a same-value token may lawfully ride the cascade.
    const lightActive = lightDeclared ?? darkDeclared;
    if (lightActive === undefined) {
      if (required && Object.keys(lightProps).length > 0) {
        tokenFindings.push({
          check: `token:${name}:light`,
          expected: spec.light,
          found: "<missing>",
          diff: `token:${name}:light — ${spec.cssName} is MISSING from BOTH the ${LIGHT_SELECTOR} seam and :root; declare the corpus light value ${spec.light} (${spec.sheet})`,
        });
      } else if (!required && darkDeclared !== undefined) {
        // declared on :root only, same value serves both themes — fine.
      }
    } else if (lightActive !== normalizeCssValue(spec.light)) {
      tokenFindings.push({
        check: `token:${name}:light`,
        expected: spec.light,
        found: lightActive,
        diff: `token:${name}:light — ${spec.cssName}: the ACTIVE light-theme value must be ${spec.light} (the corpus light value — ${spec.sheet}); found ${lightActive}${lightDeclared === undefined ? " (cascaded from :root — the light seam must override it)" : ""}`,
      });
    }
  }

  // — the structural anatomy checks —
  const structuralFindings: ParityConformanceFinding[] = [];
  for (const check of descriptor.structuralChecks) {
    const rule = findParityRule(rules, check.selector, check.mediaContains);
    if (rule === undefined) {
      structuralFindings.push({
        check: `structure:${check.id}`,
        expected: check.expected,
        found: "<rule not found>",
        diff: `structure:${check.id} — the rule \`${check.selector}\`${
          check.mediaContains === undefined ? "" : ` (in @media containing "${check.mediaContains}")`
        } was not found on this surface (${check.description})`,
      });
      continue;
    }
    const raw = rule.declarations[check.property];
    if (raw === undefined) {
      structuralFindings.push({
        check: `structure:${check.id}`,
        expected: check.expected,
        found: "<missing>",
        diff: `structure:${check.id} — \`${check.selector}\` carries no \`${check.property}\` declaration (expected ${check.expected} — ${check.description})`,
      });
      continue;
    }
    let found = raw;
    if (check.resolveVars === true) found = resolveCssVars(found, darkProps);
    if (check.gapComponent !== undefined) {
      found = gapComponentOf(found, check.gapComponent);
    }
    const pass = check.expectedContains === true
      ? found.includes(normalizeCssValue(check.expected))
      : found === normalizeCssValue(check.expected);
    if (!pass) {
      structuralFindings.push({
        check: `structure:${check.id}`,
        expected: check.expected,
        found,
        diff: `structure:${check.id} — \`${check.selector}\` ${check.property}: expected ${check.expected} (the corpus — ${check.description}), found ${found}`,
      });
    }
  }

  const findings = [...tokenFindings, ...structuralFindings];
  const status: ParitySurfaceConformance["status"] = !retargeted
    ? "pending"
    : findings.length === 0
      ? "conformant"
      : "drift";

  return {
    id: descriptor.id,
    label: descriptor.label,
    status,
    retargeted,
    tokenFindings,
    structuralFindings,
    undeclaredTokens,
    ok: status === "conformant",
  };
}

// ---------------------------------------------------------------------------
// The conformance:status report (the mode the lead/W2/W3 run)
// ---------------------------------------------------------------------------

/** Render the conformance:status report for the evaluated surfaces. */
export function renderParityConformanceReport(
  surfaces: readonly ParitySurfaceConformance[],
): string {
  const lines: string[] = [];
  lines.push("=== R27 parity conformance:status ===");
  lines.push(
    `contract: PRESENT — @wfx/platform-contracts/parity-tokens (the canonical corpus encoding: ${String(PARITY_TOKEN_NAMES.length)} tokens, provenance preserved)`,
  );
  for (const surface of surfaces) {
    const total = surface.tokenFindings.length + surface.structuralFindings.length;
    lines.push("");
    lines.push(
      `[${surface.id}] ${surface.label} — STATUS: ${
        surface.status === "conformant"
          ? "CONFORMANT (contract-present + surface-conformant)"
          : surface.status === "drift"
            ? "DRIFT (retargeted but non-conformant — self-correct from the diffs)"
            : "SURFACES-PENDING (the pre-parity stylesheet — the corpus contract is present; this app's parity lane retargets the surface)"
      }`,
    );
    if (surface.status === "conformant") {
      lines.push("  all corpus token + structural checks pass (dark + light).");
    }
    if (surface.status !== "conformant" && total === 0) {
      lines.push("  (no findings)");
    }
    for (const finding of [...surface.tokenFindings, ...surface.structuralFindings]) {
      lines.push(`  DIFF ${finding.diff}`);
    }
    if (surface.undeclaredTokens.length > 0) {
      lines.push(
        `  surface-scoped (informational, not failed): ${surface.undeclaredTokens.join(", ")} not declared as custom properties on this surface`,
      );
    }
  }
  lines.push("");
  lines.push(
    surfaces.every((s) => s.ok)
      ? "wave state: BOTH surfaces conformant."
      : surfaces.some((s) => s.status === "drift")
        ? "wave state: DRIFT present — fix forward from the diffs above."
        : "wave state: surfaces pending their parity lanes (contract present).",
  );
  return lines.join("\n");
}
