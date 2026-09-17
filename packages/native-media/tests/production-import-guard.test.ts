/**
 * R10 — the production import guard (the stubEngine/simulation law).
 *
 * The remediation freeze: "No production fallback to fixtures or
 * `stubEngine()`" and the simulation stays TEST/DEV-only, exactly where it
 * is. This test enforces the separation LINT-VISIBLY: every PRODUCTION
 * module under `src/service-process/` (the real engine service) plus the
 * production gateway server must never import `fixtures.ts`,
 * `engine/simulation.ts`, or `gateway/test-server.ts` — the TEST/DEV-only
 * surfaces. A violation fails the suite (and would fail review).
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Every .ts file under a directory (recursive). */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...tsFilesUnder(path));
    } else if (entry.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

/** The forbidden TEST/DEV-only import specifiers (the freeze's law). */
const FORBIDDEN = [
  "../fixtures",
  "../../fixtures",
  "./fixtures",
  "../engine/simulation",
  "../../engine/simulation",
  "./engine/simulation",
  "../gateway/test-server",
  "../../gateway/test-server",
  "./gateway/test-server",
  "./test-server",
  "../simulation",
  "./simulation",
];

/**
 * Production surfaces that must stay pure of TEST/DEV code.
 *
 * SCOPE NOTE: `engine/adapter.ts` is deliberately NOT listed — it hosts
 * the lead-frozen WFX-014 TEST/DEV in-process pipe
 * (`createInProcessEngineProcess`, the simulation-backed pipe) alongside
 * the production adapter, exactly as merged and lead-audited at R08; the
 * freeze's law is that PRODUCTION PATHS never fall back to it, and the
 * R10 production path is `src/service-process/**` (guarded below) plus
 * the pure gateway server it builds on.
 */
const PRODUCTION_SURFACES: { label: string; files: string[] }[] = [
  {
    label: "src/service-process/** (the R10 production service)",
    files: tsFilesUnder(join(SRC, "service-process")),
  },
  {
    label: "src/gateway/server.ts (the production pure gateway)",
    files: [join(SRC, "gateway", "server.ts")],
  },
];

describe("R10 — the production import guard (no stubEngine/simulation in production)", () => {
  it("the production surfaces exist and are non-empty", () => {
    for (const surface of PRODUCTION_SURFACES) {
      expect(surface.files.length).toBeGreaterThan(0);
    }
  });

  it("no production module imports fixtures, the simulation, or the test server", () => {
    const violations: string[] = [];
    for (const surface of PRODUCTION_SURFACES) {
      for (const file of surface.files) {
        const source = readFileSync(file, "utf8");
        for (const forbidden of FORBIDDEN) {
          if (source.includes(`from "${forbidden}"`) || source.includes(`from '${forbidden}'`)) {
            violations.push(`${file}: imports "${forbidden}"`);
          }
        }
        // Deep-path escapes to the package's own TEST/DEV modules under any
        // relative form (e.g. "../engine/simulation.ts").
        if (/from\s+["'][^"']*\/(simulation|test-server|fixtures)(\.ts)?["']/.test(source)) {
          violations.push(`${file}: imports a TEST/DEV module by path`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the package entry never re-exports main.ts (the entry is spawn-only, never a library import)", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(index).not.toContain("service-process/main");
  });

  it("main.ts boots a service, never a simulation (the honest entry)", () => {
    const main = readFileSync(join(SRC, "service-process", "main.ts"), "utf8");
    expect(main).toContain("createEngineService");
    expect(main).not.toContain("simulation");
    expect(main).not.toContain("stubEngine");
  });
});
