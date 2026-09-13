import { describe, expect, it } from "bun:test";

import { } from "../src/index";

describe("@wfx/experience baseline", () => {
  it("package loads", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeTypeOf("object");
  });
});
