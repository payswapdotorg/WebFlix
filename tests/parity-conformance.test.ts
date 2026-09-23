/**
 * R27-W1 — THE PARITY CONFORMANCE HARNESS (the lab's proof instrument).
 *
 * THE CHARTER (the lane packet): parse each app's stylesheet surface and
 * assert the CORPUS VALUES are the ACTIVE custom properties — the
 * canonical `--wfx-*` name mapping from `@wfx/platform-contracts`'s
 * token contract — in BOTH themes, plus the CSS-derivable structural
 * anatomy (topbar height, rail widths, chip geometry, watch grid
 * columns/gap, action-pill radius, scrollbar spec, skeleton shells).
 * Failed checks answer DIFF messages so W2/W3 self-correct mechanically.
 *
 * THE BATTERY POLICY (the harness runs green on every lawful wave state):
 *
 * - THE CONTRACT is asserted in full (the canonical module mirrors the
 *   corpus; the engine's parser resolves var()/media/gap correctly);
 * - THE DESKTOP surface (W3's generated stylesheet, MERGED on main) is
 *   asserted STRICT — it must be CONFORMANT, and its app-side token
 *   mirror must equal the canonical contract value-for-value (the
 *   no-forked-tokens law);
 * - THE WEB surface is asserted with the wave-state truth: it must be
 *   either CONFORMANT (the W2 lane retargeted it) or SURFACES-PENDING
 *   (the pre-parity stylesheet — the truthful classification, never a
 *   silent green). A retargeted-but-drifted web surface FAILS here with
 *   the diffs — the self-correct signal;
 * - THE STRICT PATH IS PROVEN with synthetic surfaces (a generated
 *   conformant stylesheet passes; single-token and watch-gap drifts
 *   fail with exactly the expected DIFFs) — the harness is never a
 *   rubber stamp.
 *
 * conformance:status — running this file renders the full status report
 * (contract-present vs surface state, every DIFF) to the test output.
 *
 * NOTE ON THE DESKTOP IMPORT: the harness reads the REAL surfaces — the
 * Web's stylesheet FILE and the Desktop's stylesheet EMITTER (the
 * generated CSS is the desktop surface; the relative import is the
 * honest way to parse it, per the lead's charter to "parse each app's
 * stylesheet surface"). It imports no app logic and mutates nothing.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// The canonical contract + the conformance engine (relative imports: the
// shared test tree resolves workspace packages through their sources —
// the same honest read the package-local tests use).
import {
  PARITY_TOKENS,
  PARITY_TOKEN_NAMES,
  PARITY_GEOMETRY,
  PARITY_MOTION,
  PARITY_TYPE_SCALE,
  parityTokenMappingTable,
} from "../packages/platform-contracts/src/parity-tokens";
import {
  DESKTOP_PARITY_SURFACE,
  WEB_PARITY_SURFACE,
  evaluateParitySurfaceConformance,
  gapComponentOf,
  normalizeCssValue,
  parseParityCss,
  renderParityConformanceReport,
  resolveCssVars,
} from "../packages/platform-contracts/src/parity-conformance";

// The Desktop's REAL stylesheet surface (the generated CSS — W3's lane,
// merged on main). Public-entry re-export; imported at the surface
// module because that IS the surface the harness parses.
import { r27DesktopStylesheet } from "../apps/desktop/src/surface/r27-parity-css";
import {
  R27_GEOMETRY,
  R27_MOTION,
  R27_PARITY_TOKENS,
  R27_TYPE_SCALE,
} from "../apps/desktop/src/surface/r27-parity-tokens";

// ---------------------------------------------------------------------------
// The real surfaces
// ---------------------------------------------------------------------------

/** The Web's stylesheet surface (the file the W2 lane retargets). */
const WEB_CSS = readFileSync("apps/web/src/app/globals.css", "utf8");
/** The Desktop's stylesheet surface (the generated webview CSS). */
const DESKTOP_CSS = r27DesktopStylesheet();

const desktopConformance = evaluateParitySurfaceConformance(
  DESKTOP_CSS,
  DESKTOP_PARITY_SURFACE,
);
const webConformance = evaluateParitySurfaceConformance(
  WEB_CSS,
  WEB_PARITY_SURFACE,
);

// ---------------------------------------------------------------------------
// The engine's own correctness (the harness is never a rubber stamp)
// ---------------------------------------------------------------------------

describe("R27-W1 conformance engine — the parser", () => {
  it("parses rules, @media nesting, and declarations", () => {
    const rules = parseParityCss(`
      /* comment */
      :root { --wfx-bg: #0f0f0f; height: 56px; }
      @media (min-width: 1016px) {
        .wfx-watch { grid-template-columns: minmax(0, 1fr) 412px; gap: 24px 16px; }
      }
      .wfx-chip { height: 32px; border-radius: 8px }
    `);
    expect(rules.length).toBe(3);
    const root = rules.find((r) => r.selector === ":root");
    expect(root?.media).toBeNull();
    expect(root?.declarations["--wfx-bg"]).toBe("#0f0f0f");
    const watch = rules.find((r) => r.selector === ".wfx-watch");
    expect(watch?.media).toContain("1016px");
    expect(watch?.declarations["grid-template-columns"]).toBe("minmax(0,1fr) 412px");
    expect(watch?.declarations.gap).toBe("24px 16px");
  });

  it("normalizes values (whitespace, commas, slashes, case) for stable diffs", () => {
    expect(normalizeCssValue("RGBA(255, 255, 255, 0.1)")).toBe("rgba(255,255,255,0.1)");
    expect(normalizeCssValue("16 / 9")).toBe("16/9");
    expect(normalizeCssValue("  4px   solid   transparent ")).toBe("4px solid transparent");
  });

  it("resolves var() references against the surface's own :root", () => {
    const resolved = resolveCssVars("var(--wfx-radius)", {
      "--wfx-radius": "12px",
    });
    expect(resolved).toBe("12px");
    expect(
      resolveCssVars("var(--missing, 8px)", { "--wfx-radius": "12px" }),
    ).toBe("8px");
  });

  it("extracts the gap shorthand's row/column components", () => {
    expect(gapComponentOf("24px 16px", "column")).toBe("16px");
    expect(gapComponentOf("24px 16px", "row")).toBe("24px");
    expect(gapComponentOf("16px", "column")).toBe("16px");
  });
});

// ---------------------------------------------------------------------------
// The synthetic strict-path proof (a retargeted surface MUST conform or fail)
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic CONFORMANT web-surface stylesheet FROM THE
 * CONTRACT itself (the corpus values + the descriptor's structural
 * checks) — then drift exactly one thing at a time to prove the strict
 * path catches it. Declarations merge per (selector, media) pair, the
 * way a real stylesheet carries them.
 */
function syntheticWebCss(overrides?: {
  readonly driftToken?: { readonly name: string; readonly value: string };
  readonly watchGap?: string;
}): string {
  // — the :root block: the required tokens + the :root structural props —
  const rootProps = new Map<string, string>();
  for (const name of WEB_PARITY_SURFACE.requiredTokens) {
    const spec = PARITY_TOKENS[name];
    rootProps.set(
      spec.cssName,
      overrides?.driftToken?.name === name ? overrides.driftToken.value : spec.dark,
    );
  }
  const lightProps = new Map<string, string>();
  for (const name of WEB_PARITY_SURFACE.requiredTokens) {
    const spec = PARITY_TOKENS[name];
    lightProps.set(spec.cssName, spec.light);
  }
  // — the structural rules, merged per (media, selector) —
  const blocks = new Map<string, Map<string, string>>();
  for (const check of WEB_PARITY_SURFACE.structuralChecks) {
    const value =
      check.property === "gap" && check.id === "watch-column-gap" && overrides?.watchGap !== undefined
        ? overrides.watchGap
        : check.expected;
    if (check.selector === ":root") {
      rootProps.set(check.property, value);
      continue;
    }
    const key = `${check.mediaContains ?? ""}|${check.selector}`;
    const props = blocks.get(key) ?? new Map<string, string>();
    props.set(check.property, value);
    blocks.set(key, props);
  }
  const renderProps = (props: Map<string, string>): string =>
    [...props.entries()].map(([p, v]) => `  ${p}: ${v};`).join("\n");
  const ruleTexts: string[] = [];
  for (const [key, props] of blocks) {
    const separator = key.indexOf("|");
    const media = key.slice(0, separator);
    const selector = key.slice(separator + 1);
    const rule = `${selector} {\n${renderProps(props)}\n}`;
    ruleTexts.push(
      media.length === 0 ? rule : `@media (min-width: ${media}) {\n${rule}\n}`,
    );
  }
  return [
    `:root {\n${renderProps(rootProps)}\n}`,
    `html[data-theme="light"] {\n${renderProps(lightProps)}\n}`,
    ...ruleTexts,
  ].join("\n");
}

describe("R27-W1 conformance engine — the strict path (synthetic proof)", () => {
  it("a contract-generated surface is CONFORMANT (the harness can pass)", () => {
    const result = evaluateParitySurfaceConformance(
      syntheticWebCss(),
      WEB_PARITY_SURFACE,
    );
    expect(result.retargeted).toBe(true);
    expect(result.status).toBe("conformant");
    expect(result.ok).toBe(true);
  });

  it("ONE drifted token value fails with exactly that DIFF", () => {
    const result = evaluateParitySurfaceConformance(
      syntheticWebCss({ driftToken: { name: "app-bg", value: "#0b0a10" } }),
      WEB_PARITY_SURFACE,
    );
    expect(result.status).toBe("drift");
    expect(result.tokenFindings.map((f) => f.check)).toContain("token:app-bg:dark");
    expect(result.tokenFindings.find((f) => f.check === "token:app-bg:dark")?.diff)
      .toContain("expected #0f0f0f");
  });

  it("the watch column-gap drift fails with the 16px DIFF (the W2 self-correct case)", () => {
    const result = evaluateParitySurfaceConformance(
      syntheticWebCss({ watchGap: "24px" }),
      WEB_PARITY_SURFACE,
    );
    expect(result.status).toBe("drift");
    const gap = result.structuralFindings.find(
      (f) => f.check === "structure:watch-column-gap",
    );
    expect(gap?.expected).toBe("16px");
    expect(gap?.found).toBe("24px");
  });

  it("a pre-parity surface classifies SURFACES-PENDING (never silently green)", () => {
    const result = evaluateParitySurfaceConformance(
      ":root { --wfx-bg: #0b0a10; --wfx-text: #ececf1; }",
      WEB_PARITY_SURFACE,
    );
    expect(result.retargeted).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.tokenFindings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The DESKTOP surface (merged on main — the strict gate)
// ---------------------------------------------------------------------------

describe("R27-W1 conformance — the Desktop surface (W3, merged)", () => {
  it("every canonical token is ACTIVE in both themes with the corpus values", () => {
    expect(desktopConformance.tokenFindings).toEqual([]);
  });

  it("the structural anatomy conforms (shell, grid, watch, chrome, scrollbar, skeleton)", () => {
    expect(desktopConformance.structuralFindings).toEqual([]);
  });

  it("STATUS: conformant (the merged lane's green state)", () => {
    expect(desktopConformance.retargeted).toBe(true);
    expect(desktopConformance.status).toBe("conformant");
    expect(desktopConformance.ok).toBe(true);
  });

  it("the app-side token mirror EQUALS the canonical contract (the no-forked-tokens law)", () => {
    // Every mirror token must exist canonically with identical
    // dark/light/cssName — drift between the apps is a defect.
    for (const [name, mirror] of Object.entries(R27_PARITY_TOKENS)) {
      const canonical = PARITY_TOKENS[name as keyof typeof PARITY_TOKENS];
      expect(canonical, `mirror token ${name} must exist canonically`).toBeDefined();
      expect(mirror.dark).toBe(canonical.dark);
      expect(mirror.light).toBe(canonical.light);
      expect(mirror.cssName).toBe(canonical.cssName);
    }
    // The mirror carries the full canonical vocabulary (no app-side drop).
    expect(Object.keys(R27_PARITY_TOKENS).length).toBe(PARITY_TOKEN_NAMES.length);
    // The geometry + motion + type mirrors match value-for-value.
    for (const [key, mirrorValue] of Object.entries(R27_GEOMETRY)) {
      if (typeof mirrorValue === "number") {
        expect(PARITY_GEOMETRY[key as keyof typeof PARITY_GEOMETRY]).toBe(mirrorValue);
      }
    }
    for (const key of Object.keys(R27_MOTION)) {
      expect((PARITY_MOTION as Record<string, unknown>)[key]).toBe(
        (R27_MOTION as Record<string, unknown>)[key],
      );
    }
    for (const [role, mirror] of Object.entries(R27_TYPE_SCALE)) {
      const canonical = PARITY_TYPE_SCALE[role as keyof typeof PARITY_TYPE_SCALE];
      expect(canonical, `mirror type role ${role}`).toBeDefined();
      expect(mirror.size).toBe(canonical.size);
      expect(mirror.weight).toBe(canonical.weight);
      expect(mirror.lineHeight).toBe(canonical.lineHeight);
      expect(mirror.lineClamp).toBe(canonical.lineClamp);
      expect(mirror.color).toBe(canonical.color);
    }
  });
});

// ---------------------------------------------------------------------------
// The WEB surface (the wave-state truth)
// ---------------------------------------------------------------------------

describe("R27-W1 conformance — the Web surface (the wave-state truth)", () => {
  it(
    "is CONFORMANT (the W2 lane landed) or SURFACES-PENDING (pre-parity) — never a silent green",
    () => {
      expect(
        ["conformant", "pending"],
        `web status must be conformant or pending (found: ${webConformance.status})`,
      ).toContain(webConformance.status);
      if (webConformance.status === "pending") {
        // The truthful classification: the pre-parity stylesheet is
        // detected as NOT retargeted, and the first diffs name the real
        // legacy values (the corpus values the W2 lane must adopt).
        expect(webConformance.retargeted).toBe(false);
        const bg = webConformance.tokenFindings.find(
          (f) => f.check === "token:app-bg:dark",
        );
        expect(bg).toBeDefined();
        expect(bg?.expected).toBe("#0f0f0f");
        expect(bg?.diff).toContain("--wfx-bg");
      } else {
        expect(webConformance.ok).toBe(true);
        expect(webConformance.tokenFindings).toEqual([]);
        expect(webConformance.structuralFindings).toEqual([]);
      }
    },
  );

  it("the required-token set is the corpus core the retargeted web carries", () => {
    expect(WEB_PARITY_SURFACE.requiredTokens).toEqual([
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
    ]);
  });
});

// ---------------------------------------------------------------------------
// conformance:status (the report mode — run `bun test tests/parity-conformance.test.ts`)
// ---------------------------------------------------------------------------

describe("conformance:status — the report", () => {
  const report = renderParityConformanceReport([
    desktopConformance,
    webConformance,
  ]);

  it("carries the contract-present line + one section per surface", () => {
    expect(report).toContain("R27 parity conformance:status");
    expect(report).toContain("contract: PRESENT");
    expect(report).toContain("[desktop]");
    expect(report).toContain("[web]");
    expect(report).toContain(desktopConformance.status === "conformant" ? "CONFORMANT" : desktopConformance.status);
  });

  it("distinguishes contract-present from surfaces-pending in the wave state", () => {
    if (webConformance.status === "pending") {
      expect(report).toContain("SURFACES-PENDING");
      expect(report).toContain("surfaces pending their parity lanes (contract present)");
    } else {
      expect(report).toContain("BOTH surfaces conformant");
    }
  });

  it("prints the full report to the test output (the runnable status mode)", () => {
    console.log(`\n${report}\n`);
    expect(report.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The contract's own projection (the conformance key both apps consume)
// ---------------------------------------------------------------------------

describe("R27-W1 conformance — the contract's mapping table", () => {
  it("projects every canonical token with cssName + both themes + provenance", () => {
    const table = parityTokenMappingTable();
    expect(table.length).toBe(PARITY_TOKEN_NAMES.length);
    for (const row of table) {
      const spec = PARITY_TOKENS[row.name];
      expect(row.cssName).toBe(spec.cssName);
      expect(row.dark).toBe(spec.dark);
      expect(row.light).toBe(spec.light);
      expect(row.provenance.length).toBeGreaterThan(0);
    }
  });

  it("the harness surfaces and the contract agree on the watch anatomy @1440", () => {
    // The corpus's measured two-column: secondary 412 + column gap 16 +
    // margin 16 (+ player 996 inside the 1012 primary) — every surface
    // descriptor asserts these same numbers.
    expect(PARITY_GEOMETRY.watchSecondaryWidth).toBe(412);
    expect(PARITY_GEOMETRY.watchColumnGap).toBe(16);
    expect(PARITY_GEOMETRY.watchPrimaryWidth).toBe(1012);
    const watchChecks = [
      ...DESKTOP_PARITY_SURFACE.structuralChecks,
      ...WEB_PARITY_SURFACE.structuralChecks,
    ].filter((c) => c.id === "watch-two-column");
    expect(watchChecks.length).toBe(2);
    for (const check of watchChecks) expect(check.expected).toBe("412px");
  });
});
