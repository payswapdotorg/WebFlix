import { describe, expect, it } from "bun:test";

import type { ConnectorDescriptor } from "@wfx/domain";

import {
  AUTH_MODES,
  CAPABILITIES,
  defineDescriptor,
  DescriptorValidationError,
  isAuthMode,
  isCapability,
} from "../src/index";

const VALID = {
  id: "archive-org",
  version: "1.2.3",
  displayName: "Internet Archive",
  capabilities: ["catalogSearch", "metadata"],
  auth: "none",
} as const;

describe("CAPABILITIES truth constant", () => {
  it("contains exactly the 16 frozen capabilities", () => {
    expect(CAPABILITIES).toHaveLength(16);
    expect(CAPABILITIES).toContain("identity");
    expect(CAPABILITIES).toContain("catalogSearch");
    expect(CAPABILITIES).toContain("metadata");
    expect(CAPABILITIES).toContain("playNative");
    expect(CAPABILITIES).toContain("playEmbed");
    expect(CAPABILITIES).toContain("playBrowser");
    expect(CAPABILITIES).toContain("playExternal");
    expect(CAPABILITIES).toContain("availability");
    expect(CAPABILITIES).toContain("libraryRead");
    expect(CAPABILITIES).toContain("libraryWrite");
    expect(CAPABILITIES).toContain("like");
    expect(CAPABILITIES).toContain("save");
    expect(CAPABILITIES).toContain("follow");
    expect(CAPABILITIES).toContain("comment");
    expect(CAPABILITIES).toContain("download");
    expect(CAPABILITIES).toContain("transform");
  });

  it("isCapability / isAuthMode do runtime membership checks", () => {
    expect(isCapability("metadata")).toBe(true);
    expect(isCapability("teleport")).toBe(false);
    expect(isCapability(42)).toBe(false);
    expect(isCapability(null)).toBe(false);
    expect(isAuthMode("oauth")).toBe(true);
    expect(isAuthMode("basic")).toBe(false);
    expect(AUTH_MODES).toEqual(["none", "oauth", "device", "local"]);
  });
});

describe("defineDescriptor — valid input", () => {
  it("validates, trims displayName, and deep-freezes", () => {
    const descriptor = defineDescriptor({
      ...VALID,
      displayName: "  Internet Archive  ",
    });
    expect(descriptor).toEqual({
      id: "archive-org",
      version: "1.2.3",
      displayName: "Internet Archive",
      capabilities: ["catalogSearch", "metadata"],
      auth: "none",
    } satisfies ConnectorDescriptor);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
  });

  it("accepts semver with prerelease and build tags", () => {
    const descriptor = defineDescriptor({
      ...VALID,
      version: "0.1.0-beta.1+build.7",
    });
    expect(descriptor.version).toBe("0.1.0-beta.1+build.7");
  });

  it("accepts an empty capability list (honest, not invalid)", () => {
    const descriptor = defineDescriptor({ ...VALID, capabilities: [] });
    expect(descriptor.capabilities).toEqual([]);
  });
});

describe("defineDescriptor — rejects invalid ids", () => {
  const badIds: unknown[] = [
    "Netflix", // uppercase
    "net_flix", // underscore
    "net flix", // space
    "-netflix", // leading hyphen
    "netflix-", // trailing hyphen
    "netflix--double", // double hyphen
    "netflix.io", // dot
    "", // empty
    42, // not a string
    null,
  ];
  for (const id of badIds) {
    it(`rejects id ${JSON.stringify(id)}`, () => {
      expect(() => defineDescriptor({ ...VALID, id })).toThrow(DescriptorValidationError);
    });
  }
});

describe("defineDescriptor — rejects invalid versions", () => {
  const badVersions: unknown[] = [
    "1",
    "1.2",
    "v1.2.3",
    "1.2.3.4",
    "1.2.3-", // dangling prerelease
    "",
    "latest",
    1.2,
  ];
  for (const version of badVersions) {
    it(`rejects version ${JSON.stringify(version)}`, () => {
      expect(() => defineDescriptor({ ...VALID, version })).toThrow(DescriptorValidationError);
    });
  }
});

describe("defineDescriptor — rejects invalid display names", () => {
  it("rejects missing / empty / whitespace / non-string / overlong", () => {
    const bad: unknown[] = [undefined, "", "   ", 42, "x".repeat(129)];
    for (const displayName of bad) {
      const input = { ...VALID } as Record<string, unknown>;
      if (displayName === undefined) delete input.displayName;
      else input.displayName = displayName;
      expect(() => defineDescriptor(input)).toThrow(DescriptorValidationError);
    }
  });
});

describe("defineDescriptor — rejects invalid capabilities", () => {
  it("rejects non-array", () => {
    expect(() => defineDescriptor({ ...VALID, capabilities: "metadata" })).toThrow(
      DescriptorValidationError,
    );
  });

  it("rejects unknown capability values", () => {
    expect(() =>
      defineDescriptor({ ...VALID, capabilities: ["metadata", "teleport"] }),
    ).toThrow(/teleport/);
  });

  it("rejects non-string members", () => {
    expect(() => defineDescriptor({ ...VALID, capabilities: [5] })).toThrow(
      DescriptorValidationError,
    );
  });

  it("rejects duplicates", () => {
    expect(() =>
      defineDescriptor({ ...VALID, capabilities: ["metadata", "metadata"] }),
    ).toThrow(/duplicate/);
  });
});

describe("defineDescriptor — rejects structural problems", () => {
  it("rejects bad auth modes", () => {
    expect(() => defineDescriptor({ ...VALID, auth: "basic" })).toThrow(/auth/);
  });

  it("rejects missing required fields", () => {
    for (const field of ["id", "version", "displayName", "capabilities", "auth"]) {
      const input = { ...VALID } as Record<string, unknown>;
      delete input[field];
      expect(() => defineDescriptor(input)).toThrow(DescriptorValidationError);
    }
  });

  it("rejects unknown extra keys (typo guard)", () => {
    expect(() => defineDescriptor({ ...VALID, capabilites: ["like"] })).toThrow(/capabilites/);
  });

  it("rejects non-objects", () => {
    for (const input of [null, undefined, "string", 42, true, ["array"]]) {
      expect(() => defineDescriptor(input)).toThrow(DescriptorValidationError);
    }
  });

  it("rejects objects carrying a descriptor() method (pass instances to the registry)", () => {
    const sneaky = { ...VALID, descriptor: () => VALID };
    expect(() => defineDescriptor(sneaky)).toThrow(DescriptorValidationError);
  });

  it("error message is prefixed and typed", () => {
    try {
      defineDescriptor({ ...VALID, id: "BAD" });
      throw new Error("expected DescriptorValidationError");
    } catch (caught) {
      expect(caught).toBeInstanceOf(DescriptorValidationError);
      expect((caught as DescriptorValidationError).message).toContain("invalid connector descriptor");
      expect((caught as DescriptorValidationError).name).toBe("DescriptorValidationError");
    }
  });
});
