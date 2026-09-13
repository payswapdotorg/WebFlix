import { describe, expect, it } from "bun:test";

import { } from "../src/index";

describe("@wfx/app-web baseline", () => {
  it("app package loads", async () => {
    const mod = await import("../src/index");
    expect(mod).toBeTypeOf("object");
  });
});
