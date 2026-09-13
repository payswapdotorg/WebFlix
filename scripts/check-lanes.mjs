#!/usr/bin/env node
/**
 * WebFlix lane boundary checker (WFX-001, lead-owned).
 *
 * Rule (docs/architecture/dependency-graph.md — "Workers communicate
 * through versioned interfaces and fixtures, not private imports"):
 *
 *   1. Cross-package imports must target the package PUBLIC entry point
 *      (`@wfx/<pkg>`), never a deep path (`@wfx/<pkg>/src/...`).
 *   2. Relative imports may never escape their own package directory.
 *
 * Lane file EDIT boundaries are additionally encoded in .github/CODEOWNERS.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACES = ["packages", "apps"];

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".git"]);
const tsFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) tsFiles.push(p);
  }
}
for (const ws of WORKSPACES) walk(join(root, ws));

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g;

let violations = 0;
for (const file of tsFiles) {
  const rel = relative(root, file);
  const pkgRoot = resolve(file, "../../"); // packages/<pkg>/ or apps/<app>/
  const pkgName = rel.split("/")[1];
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] ?? "";
    // deep workspace import: @wfx/<pkg>/anything
    if (/^@wfx\/[a-z-]+\/.+/.test(spec)) {
      console.error(`lane-check: DEEP import "${spec}" in ${rel} — use the public entry point "@wfx/${spec.split("/")[1]}"`);
      violations++;
      continue;
    }
    // relative escape
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      const relToPkgRoot = relative(pkgRoot, target);
      if (relToPkgRoot.startsWith("..")) {
        console.error(`lane-check: RELATIVE import "${spec}" in ${rel} escapes package "${pkgName}"`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`lane-check: ${violations} violation(s).`);
  process.exit(1);
}
console.log(`lane-check: OK — ${tsFiles.length} files, no cross-lane private imports.`);
