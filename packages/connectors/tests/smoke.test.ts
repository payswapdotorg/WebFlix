import { describe, expect, it } from "bun:test";

import { } from "../src/index";

describe("@wfx/connectors baseline", () => {
  it("package loads", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeTypeOf("object");
  });
});
