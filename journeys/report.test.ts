/**
 * @wfx/journeys — unit tests: the manifest/report layer + the harness
 * laws (R16).
 *
 * Pure: manifest construction, summary rendering, the green/red
 * decision, the catalog's integrity (unique ids, catalog order, every
 * journey ci-flagged), and the LAYERING LAW over the journeys tree (no
 * @wfx imports, no relative escapes out of journeys/) — the law the
 * lane checker enforces for packages/apps, enforced HERE for the
 * harness tree.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  MANIFEST_SCHEMA,
  buildManifest,
  renderSummary,
  runIsGreen,
  type JourneyResult,
  type LimitationRecord,
} from "./lib/report";
import { WEB_JOURNEYS, JOURNEY_LIMITATIONS } from "./web/index";

/** One minimal journey result. */
function resultOf(id: string, status: JourneyResult["status"], over: Partial<JourneyResult> = {}): JourneyResult {
  return {
    id,
    title: `journey ${id}`,
    status,
    reason: status === "not-run" ? "requires the service-mode boot" : null,
    failure: null,
    assertions: [],
    artifacts: [],
    pageErrors: [],
    durationMs: 10,
    ...over,
  };
}

const ENV = {
  mode: "web-fixtures" as const,
  webUrl: "http://localhost:3101",
  ci: false,
  startedAt: "2026-09-18T12:00:00.000Z",
  finishedAt: "2026-09-18T12:01:00.000Z",
  determinism: ["reset acquisition drive state"],
};

const LIMITATIONS: readonly LimitationRecord[] = [
  {
    journeyId: "J28",
    kind: "local-only",
    note: "the auth flows are service-side",
    procedure: "LOCAL-ONLY: boot the service mode",
  },
];

describe("journeys/lib/report — the manifest", () => {
  it("builds the stable schema with exact summary numbers", () => {
    const manifest = buildManifest({
      commit: "abc123",
      branch: "wfx/r16/journey-automation",
      environment: ENV,
      journeys: [resultOf("J01", "pass"), resultOf("J02", "fail", { failure: "assertion failed" }), resultOf("J28", "not-run")],
      limitations: LIMITATIONS,
    });
    expect(manifest.schema).toBe(MANIFEST_SCHEMA);
    expect(manifest.summary).toEqual({ total: 3, encoded: 2, passed: 1, failed: 1, notRun: 1 });
    expect(manifest.journeys).toHaveLength(3);
    expect(manifest.limitations).toHaveLength(1);
  });

  it("the green/red decision is exactly 'no executed journey failed'", () => {
    const green = buildManifest({
      commit: "a",
      branch: "b",
      environment: ENV,
      journeys: [resultOf("J01", "pass"), resultOf("J28", "not-run")],
      limitations: LIMITATIONS,
    });
    expect(runIsGreen(green)).toBe(true);

    const red = buildManifest({
      commit: "a",
      branch: "b",
      environment: ENV,
      journeys: [resultOf("J01", "pass"), resultOf("J02", "fail")],
      limitations: [],
    });
    expect(runIsGreen(red)).toBe(false);
  });

  it("a not-run journey is ALWAYS accompanied by a reason (never a silent skip)", () => {
    const manifest = buildManifest({
      commit: "a",
      branch: "b",
      environment: ENV,
      journeys: [resultOf("J28", "not-run")],
      limitations: LIMITATIONS,
    });
    const notRun = manifest.journeys[0];
    expect(typeof notRun?.reason).toBe("string");
    expect((notRun?.reason ?? "").length).toBeGreaterThan(0);
    expect(manifest.limitations.some((limitation) => limitation.journeyId === notRun?.id)).toBe(true);
  });

  it("the summary renders the journey table + the explicit limitations section", () => {
    const summary = renderSummary(
      buildManifest({
        commit: "abc123",
        branch: "wfx/r16/journey-automation",
        environment: ENV,
        journeys: [resultOf("J01", "pass"), resultOf("J02", "fail", { failure: "assertion failed" }), resultOf("J28", "not-run")],
        limitations: LIMITATIONS,
      }),
    );
    expect(summary).toContain("1 passed · 1 failed · 1 not-run (listed with procedures) · 3 total");
    expect(summary).toContain("| J01 | journey J01 | PASS |");
    expect(summary).toContain("| J02 | journey J02 | **FAIL** |");
    expect(summary).toContain("Explicit limitations (never silent skips)");
    expect(summary).toContain("- **J28** (local-only)");
    expect(summary).toContain("## Failures");
  });
});

describe("journeys — the encoded catalog's integrity", () => {
  it("every journey id is unique and in catalog order", () => {
    const ids = WEB_JOURNEYS.map((journey) => journey.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    expect(ids).toEqual(sorted);
  });

  it("the encoded set is J01–J34 + J36–J43 (41 journeys — R17 encoded J28 over the scripted source-auth feed; R20-E encoded J33 over the real BYOF composition; R21-F encoded J34 over the discoverability walk; R22-G encoded J36 over the completion sweep; R23-W2 encoded J37 anonymous viewing, J38 first-class torrent web-side, and J39 multimodal intelligence; R24-W2 encoded J40 the viewer-parity walk and J41 the playback-startup benchmark; R25-W2 encoded J43 the realtime-translation walk over the real WebFlix bridge; J35 is the lead's live-production sweep, never encoded; J42 is the WebFlix extension-parity journey the lead owns)", () => {
    const ids = new Set(WEB_JOURNEYS.map((journey) => journey.id));
    for (let number = 1; number <= 34; number += 1) {
      expect(ids.has(`J${String(number).padStart(2, "0")}`)).toBe(true);
    }
    expect(ids.has("J36")).toBe(true);
    expect(ids.has("J37")).toBe(true);
    expect(ids.has("J38")).toBe(true);
    expect(ids.has("J39")).toBe(true);
    expect(ids.has("J40")).toBe(true);
    expect(ids.has("J41")).toBe(true);
    expect(ids.has("J43")).toBe(true);
    expect(ids.has("J35")).toBe(false);
    expect(ids.has("J42")).toBe(false);
    expect(WEB_JOURNEYS).toHaveLength(41);
  });

  it("every encoded journey is ci-feasible (the CI set is the whole encoded set)", () => {
    expect(WEB_JOURNEYS.every((journey) => journey.ci)).toBe(true);
  });

  it("every journey binds a doc anchor and has a run function (an encoded journey is executable)", () => {
    for (const journey of WEB_JOURNEYS) {
      expect(journey.doc.length).toBeGreaterThan(0);
      expect(typeof journey.run).toBe("function");
    }
  });

  it("the J28 not-run + every reach limit is declared with a procedure (the honesty law)", () => {
    expect(JOURNEY_LIMITATIONS.some((limitation) => limitation.journeyId === "J28")).toBe(true);
    for (const limitation of JOURNEY_LIMITATIONS) {
      expect(limitation.note.length).toBeGreaterThan(0);
      expect(limitation.procedure.length).toBeGreaterThan(0);
    }
    // Every desktop-procedure entry points at the desktop procedure doc.
    for (const limitation of JOURNEY_LIMITATIONS.filter((entry) => entry.kind === "desktop-procedure")) {
      expect(limitation.procedure).toContain("journeys/desktop/README.md");
    }
  });
});

describe("journeys — the layering law over the harness tree", () => {
  /** Collect the .ts files under journeys/ (excluding node_modules). */
  function journeySources(): string[] {
    const root = join(import.meta.dir);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".tsbuildinfo") continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
          files.push(path);
        }
      }
    };
    walk(root);
    return files;
  }

  it("imports NOTHING from any @wfx package (the harness consumes the product as a user)", () => {
    for (const file of journeySources()) {
      const source = readFileSync(file, "utf8");
      const matches = source.match(/["']@wfx\/[^"']+["']/g) ?? [];
      if (matches.length > 0) {
        throw new Error(`layering law: ${relative(import.meta.dir, file)} imports workspace packages: ${matches.join(", ")}`);
      }
    }
  });

  it("no relative import escapes the journeys/ tree", () => {
    for (const file of journeySources()) {
      const source = readFileSync(file, "utf8");
      const imports = source.match(/from\s+["'](\.[^"']+)["']/g) ?? [];
      for (const specifier of imports) {
        const path = specifier.match(/["'](\.[^"']+)["']/)?.[1] ?? "";
        const resolved = join(file, "..", path);
        const rel = relative(import.meta.dir, resolved);
        if (rel.startsWith("..")) {
          throw new Error(`layering law: ${relative(import.meta.dir, file)} escapes journeys/ via ${path}`);
        }
      }
    }
  });

  it("journeys/ contains no test-only seam imports from the product's testing modules", () => {
    // The forbidden tokens are composed from fragments so THIS test file
    // does not itself match (the guard must scan, not self-trigger).
    const seams = [`host${"/"}testing`, `reset${"Web"}HostProcessState`];
    for (const file of journeySources()) {
      if (file === import.meta.path) continue; // the guard itself names the tokens
      const source = readFileSync(file, "utf8");
      for (const seam of seams) {
        expect(source.includes(seam)).toBe(false);
      }
    }
  });
});
