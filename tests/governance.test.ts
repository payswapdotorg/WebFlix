import { describe, expect, it } from "bun:test";
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
    expect((doc.match(/```ts/g) ?? []).length).toBeGreaterThan(4);
  });
});
