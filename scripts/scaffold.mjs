#!/usr/bin/env node
/** One-time skeleton generator for WFX-001 (idempotent). */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const write = (rel, content) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  if (!existsSync(p)) writeFileSync(p, content);
  console.log(`wrote ${rel}`);
};

const pkgs = ["domain", "connectors", "native-media", "experience", "recommendation", "model-fabric"];
for (const pkg of pkgs) {
  write(`packages/${pkg}/package.json`, JSON.stringify({
    name: `@wfx/${pkg}`, version: "0.1.0", type: "module",
    main: "src/index.ts", types: "src/index.ts",
  }, null, 2) + "\n");
  write(`packages/${pkg}/tsconfig.json`, JSON.stringify({
    extends: "../../tsconfig.base.json", include: ["src", "tests"],
  }, null, 2) + "\n");
  write(`packages/${pkg}/src/index.ts`,
    `// @wfx/${pkg} — implementation governed by docs/plans/2026-09-13-webflix-implementation-plan.md\n`);
  write(`packages/${pkg}/tests/smoke.test.ts`,
    `import { describe, expect, it } from "bun:test";\n\nimport { } from "../src/index";\n\ndescribe("@wfx/${pkg} baseline", () => {\n  it("package loads", async () => {\n    const mod = await import("../src/index");\n    expect(mod).toBeTypeOf("object");\n  });\n});\n`);
}

const apps = ["web", "desktop", "mobile"];
for (const app of apps) {
  write(`apps/${app}/package.json`, JSON.stringify({
    name: `@wfx/app-${app}`, version: "0.1.0", type: "module",
    main: "src/index.ts", types: "src/index.ts",
  }, null, 2) + "\n");
  write(`apps/${app}/tsconfig.json`, JSON.stringify({
    extends: "../../tsconfig.base.json", include: ["src", "tests"],
  }, null, 2) + "\n");
  write(`apps/${app}/src/index.ts`, `// @wfx/app-${app} — Lane C client surface\n`);
  write(`apps/${app}/tests/smoke.test.ts`,
    `import { describe, expect, it } from "bun:test";\n\nimport { } from "../src/index";\n\ndescribe("@wfx/app-${app} baseline", () => {\n  it("app package loads", async () => {\n    const mod = await import("../src/index");\n    expect(mod).toBeTypeOf("object");\n  });\n});\n`);
}

// Root test that asserts governance invariants (WFX-001 acceptance).
write("tests/governance.test.ts", `import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";

describe("WFX-001 governance baseline", () => {
  it("frozen architecture docs exist", () => {
    for (const doc of [
      "docs/architecture/webflix-frozen-architecture.md",
      "docs/architecture/contracts.md",
      "docs/architecture/product-boundaries.md",
      "docs/architecture/dependency-graph.md",
      "docs/plans/2026-09-13-webflix-implementation-plan.md",
      "docs/work-items/index.md",
    ]) {
      expect(existsSync(doc)).toBe(true);
    }
  });

  it("CI workflow present", () => {
    expect(existsSync(".github/workflows/ci.yml")).toBe(true);
  });

  it("lane ownership recorded", () => {
    expect(existsSync(".github/CODEOWNERS")).toBe(true);
  });

  it("contracts.md contains ts blocks", () => {
    const doc = readFileSync("docs/architecture/contracts.md", "utf8");
    expect((doc.match(/\`\`\`ts/g) ?? []).length).toBeGreaterThan(4);
  });
});
`);
console.log("skeleton generation complete");
