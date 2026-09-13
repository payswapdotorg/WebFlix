import { describe, expect, it } from "bun:test";

import {
  type ValidationResult,
  isIso8601,
  isRecord,
  newEntertainmentItemId,
  newEventId,
  newSourceRealizationId,
  previewValue,
  validateEntertainmentEvent,
  validateEntertainmentItem,
  validatePlaybackRealization,
  validateSourceRealization,
} from "../src/index";

function expectOk<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(`expected validation success, got: ${result.errors.join("; ")}`);
  return result.value;
}

function expectFail<T>(result: ValidationResult<T>): string[] {
  if (result.ok) throw new Error("expected validation failure, but the input passed");
  expect(result.errors.length).toBeGreaterThan(0);
  for (const message of result.errors) {
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  }
  return result.errors;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validItemInput = () => ({
  id: newEntertainmentItemId(),
  canonicalType: "movie" as const,
  canonicalTitle: "Koyaanisqatsi",
  durationMs: 5_280_000,
  orientation: "horizontal" as const,
});

const validEventInput = () => ({
  userId: "user-42",
  itemId: newEntertainmentItemId(),
  type: "progress" as const,
  occurredAt: "2026-09-13T10:30:00.000Z",
  sessionId: "session-7",
});

const validSourceRealizationInput = () => ({
  id: newSourceRealizationId(),
  entertainmentItemId: newEntertainmentItemId(),
  connectorId: "wfx-connector-demo",
  externalRef: "ext-ref-17",
  capabilities: ["metadata", "playEmbed"] as const,
  availability: "available" as const,
});

const validPlaybackRealizationInput = () => ({
  mode: "embed" as const,
  connectorId: "wfx-connector-demo",
  url: "https://example.invalid/embed/17",
  externalRef: "ext-ref-17",
  expiresAt: "2027-01-01T00:00:00.000Z",
  capabilities: ["player:iframe", "autoplay"],
});

// ---------------------------------------------------------------------------
// validateEntertainmentItem
// ---------------------------------------------------------------------------

describe("validateEntertainmentItem", () => {
  it("accepts a fully populated item and returns the same reference", () => {
    const input = validItemInput();
    const value = expectOk(validateEntertainmentItem(input));
    expect(value).toBe(input);
    expect(value.canonicalType).toBe("movie");
  });

  it("accepts a minimal item (id + canonicalType only)", () => {
    const value = expectOk(
      validateEntertainmentItem({ id: newEntertainmentItemId(), canonicalType: "post" }),
    );
    expect(value.canonicalType).toBe("post");
  });

  it("accepts unknown extra fields (forward compatibility)", () => {
    const value = expectOk(
      validateEntertainmentItem({ ...validItemInput(), futureField: { note: "ignored" } }),
    );
    expect(value.id).toBeTruthy();
  });

  it("rejects non-object input", () => {
    for (const bad of [null, undefined, 42, "movie", []]) {
      expectFail(validateEntertainmentItem(bad));
    }
  });

  it("reports every missing required field at once", () => {
    const errors = expectFail(validateEntertainmentItem({}));
    expect(errors.join(" ")).toContain("id");
    expect(errors.join(" ")).toContain("canonicalType");
    expect(errors.length).toBe(2);
  });

  it("rejects an id with the wrong prefix", () => {
    const errors = expectFail(
      validateEntertainmentItem({ id: newEventId(), canonicalType: "movie" }),
    );
    expect(errors.join(" ")).toContain("id");
  });

  it("rejects an unknown canonicalType (enum violation)", () => {
    const errors = expectFail(
      validateEntertainmentItem({ id: newEntertainmentItemId(), canonicalType: "film" }),
    );
    expect(errors.join(" ")).toContain("canonicalType");
  });

  it("rejects an unknown orientation (enum violation)", () => {
    const errors = expectFail(
      validateEntertainmentItem({ ...validItemInput(), orientation: "diagonal" }),
    );
    expect(errors.join(" ")).toContain("orientation");
  });

  it("rejects negative and non-number durationMs", () => {
    expectFail(validateEntertainmentItem({ ...validItemInput(), durationMs: -1 }));
    expectFail(validateEntertainmentItem({ ...validItemInput(), durationMs: "120000" }));
    expectFail(validateEntertainmentItem({ ...validItemInput(), durationMs: Number.NaN }));
  });

  it("rejects a non-string canonicalTitle", () => {
    expectFail(validateEntertainmentItem({ ...validItemInput(), canonicalTitle: 7 }));
  });
});

// ---------------------------------------------------------------------------
// validateEntertainmentEvent
// ---------------------------------------------------------------------------

describe("validateEntertainmentEvent", () => {
  it("accepts a fully populated event", () => {
    const input = {
      ...validEventInput(),
      sourceRealizationId: newSourceRealizationId(),
      payload: { positionMs: 1_200 },
    };
    const value = expectOk(validateEntertainmentEvent(input));
    expect(value.type).toBe("progress");
  });

  it("accepts a minimal event and offset timestamps", () => {
    expectOk(validateEntertainmentEvent(validEventInput()));
    expectOk(
      validateEntertainmentEvent({ ...validEventInput(), occurredAt: "2026-09-13T10:30:00+08:00" }),
    );
  });

  it("rejects non-object input", () => {
    for (const bad of [null, undefined, 42, "event", []]) {
      expectFail(validateEntertainmentEvent(bad));
    }
  });

  it("rejects a missing or empty userId", () => {
    const { userId: _userId, ...withoutUser } = validEventInput();
    const errors = expectFail(validateEntertainmentEvent(withoutUser));
    expect(errors.join(" ")).toContain("userId");
    expectFail(validateEntertainmentEvent({ ...validEventInput(), userId: "" }));
  });

  it("rejects an itemId that is not a canonical entertainment-item id", () => {
    const errors = expectFail(
      validateEntertainmentEvent({ ...validEventInput(), itemId: "raw-external-id" }),
    );
    expect(errors.join(" ")).toContain("itemId");
  });

  it("rejects an unknown event type (enum violation)", () => {
    const errors = expectFail(validateEntertainmentEvent({ ...validEventInput(), type: "play" }));
    expect(errors.join(" ")).toContain("type");
  });

  it("rejects malformed occurredAt values", () => {
    for (const occurredAt of [
      "yesterday",
      "2026-09-13", // date only
      "2026-09-13T10:30:00", // no timezone offset
      1_757_712_000_000,
      null,
    ]) {
      const errors = expectFail(validateEntertainmentEvent({ ...validEventInput(), occurredAt }));
      expect(errors.join(" ")).toContain("occurredAt");
    }
  });

  it("rejects an impossible calendar date", () => {
    expectFail(
      validateEntertainmentEvent({ ...validEventInput(), occurredAt: "2026-13-01T00:00:00Z" }),
    );
  });

  it("rejects a missing or empty sessionId", () => {
    const { sessionId: _sessionId, ...withoutSession } = validEventInput();
    expectFail(validateEntertainmentEvent(withoutSession));
    expectFail(validateEntertainmentEvent({ ...validEventInput(), sessionId: "" }));
  });

  it("rejects a non-canonical sourceRealizationId when present", () => {
    const errors = expectFail(
      validateEntertainmentEvent({ ...validEventInput(), sourceRealizationId: "sr-1" }),
    );
    expect(errors.join(" ")).toContain("sourceRealizationId");
  });

  it("rejects non-record payloads", () => {
    expectFail(validateEntertainmentEvent({ ...validEventInput(), payload: "x" }));
    expectFail(validateEntertainmentEvent({ ...validEventInput(), payload: [] }));
    expectFail(validateEntertainmentEvent({ ...validEventInput(), payload: 5 }));
  });

  it("accumulates multiple field errors", () => {
    const errors = expectFail(validateEntertainmentEvent({}));
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// validateSourceRealization
// ---------------------------------------------------------------------------

describe("validateSourceRealization", () => {
  it("accepts a fully populated realization", () => {
    const input = validSourceRealizationInput();
    const value = expectOk(validateSourceRealization(input));
    expect(value.availability).toBe("available");
  });

  it("accepts an empty capabilities list", () => {
    expectOk(validateSourceRealization({ ...validSourceRealizationInput(), capabilities: [] }));
  });

  it("rejects non-object input", () => {
    for (const bad of [null, undefined, 42, "realization", []]) {
      expectFail(validateSourceRealization(bad));
    }
  });

  it("rejects an id with the wrong prefix", () => {
    const errors = expectFail(
      validateSourceRealization({ ...validSourceRealizationInput(), id: newEntertainmentItemId() }),
    );
    expect(errors.join(" ")).toContain("id");
  });

  it("rejects a non-canonical entertainmentItemId", () => {
    const errors = expectFail(
      validateSourceRealization({ ...validSourceRealizationInput(), entertainmentItemId: "item-1" }),
    );
    expect(errors.join(" ")).toContain("entertainmentItemId");
  });

  it("rejects empty connectorId and externalRef", () => {
    expectFail(validateSourceRealization({ ...validSourceRealizationInput(), connectorId: "" }));
    expectFail(validateSourceRealization({ ...validSourceRealizationInput(), externalRef: "" }));
  });

  it("rejects capabilities that are not an array of Capability values", () => {
    expectFail(validateSourceRealization({ ...validSourceRealizationInput(), capabilities: "playEmbed" }));
    const unknownMember = expectFail(
      validateSourceRealization({ ...validSourceRealizationInput(), capabilities: ["telepathy"] }),
    );
    expect(unknownMember.join(" ")).toContain("capabilities");
    expectFail(
      validateSourceRealization({ ...validSourceRealizationInput(), capabilities: [42] }),
    );
    expectFail(
      validateSourceRealization({
        ...validSourceRealizationInput(),
        capabilities: ["playEmbed", null],
      }),
    );
  });

  it("rejects an unknown availability (enum violation)", () => {
    const errors = expectFail(
      validateSourceRealization({ ...validSourceRealizationInput(), availability: "maybe" }),
    );
    expect(errors.join(" ")).toContain("availability");
  });
});

// ---------------------------------------------------------------------------
// validatePlaybackRealization
// ---------------------------------------------------------------------------

describe("validatePlaybackRealization", () => {
  it("accepts a fully populated realization", () => {
    const input = validPlaybackRealizationInput();
    const value = expectOk(validatePlaybackRealization(input));
    expect(value.mode).toBe("embed");
  });

  it("accepts a minimal realization (mode, connectorId, capabilities)", () => {
    const value = expectOk(
      validatePlaybackRealization({ mode: "native", connectorId: "native-media", capabilities: [] }),
    );
    expect(value.mode).toBe("native");
  });

  it("rejects non-object input", () => {
    for (const bad of [null, undefined, 42, "realization", []]) {
      expectFail(validatePlaybackRealization(bad));
    }
  });

  it("rejects an unknown playback mode (enum violation)", () => {
    const errors = expectFail(
      validatePlaybackRealization({ ...validPlaybackRealizationInput(), mode: "cinema" }),
    );
    expect(errors.join(" ")).toContain("mode");
  });

  it("rejects a missing or empty connectorId", () => {
    const { connectorId: _connectorId, ...withoutConnector } = validPlaybackRealizationInput();
    expectFail(validatePlaybackRealization(withoutConnector));
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), connectorId: "" }));
  });

  it("rejects malformed optional url and externalRef values", () => {
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), url: 123 }));
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), url: "" }));
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), externalRef: "" }));
  });

  it("rejects malformed expiresAt values", () => {
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), expiresAt: "soon" }));
    expectFail(
      validatePlaybackRealization({ ...validPlaybackRealizationInput(), expiresAt: "2027-01-01" }),
    );
  });

  it("rejects capabilities that are not arrays of non-empty strings", () => {
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), capabilities: "h264" }));
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), capabilities: [42] }));
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), capabilities: [""] }));
    expectFail(validatePlaybackRealization({ ...validPlaybackRealizationInput(), capabilities: ["drm", null] }));
  });
});

// ---------------------------------------------------------------------------
// Shared untrusted-input helpers
// ---------------------------------------------------------------------------

describe("untrusted-input helpers", () => {
  it("isIso8601 accepts UTC and offset forms, rejects ambiguous or impossible values", () => {
    expect(isIso8601("2026-09-13T10:30:00Z")).toBe(true);
    expect(isIso8601("2026-09-13T10:30:00.123Z")).toBe(true);
    expect(isIso8601("2026-09-13T10:30:00+08:00")).toBe(true);
    expect(isIso8601("2026-09-13")).toBe(false);
    expect(isIso8601("2026-09-13T10:30:00")).toBe(false);
    expect(isIso8601("2026-13-01T00:00:00Z")).toBe(false);
    expect(isIso8601("2026-09-13T25:00:00Z")).toBe(false);
    expect(isIso8601(123)).toBe(false);
    expect(isIso8601(null)).toBe(false);
  });

  it("isRecord narrows plain objects and rejects null, arrays, and primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("record")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it("previewValue truncates long values and survives circular structures", () => {
    const long = previewValue("x".repeat(200));
    expect(long.length).toBe(80);
    expect(long.endsWith("...")).toBe(true);
    expect(previewValue(undefined)).toBe("undefined");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof previewValue(circular)).toBe("string");
  });
});
