import { describe, expect, it } from "bun:test";

import {
  SCHEMA_VERSION,
  envelope,
  envelopeFromRaw,
  isEventId,
  isPlaybackSessionId,
  makeEvent,
  newEntertainmentItemId,
  newSourceRealizationId,
  type EventEnvelope,
} from "../src/index";

describe("event envelope", () => {
  it("exports SCHEMA_VERSION = 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  describe("makeEvent", () => {
    it("fills eventId, occurredAt, and sessionId when omitted", () => {
      const before = Date.now();
      const env = makeEvent({
        userId: "user-1",
        itemId: newEntertainmentItemId(),
        type: "start",
      });
      const after = Date.now();

      expect(isEventId(env.eventId)).toBe(true);
      expect(isPlaybackSessionId(env.event.sessionId)).toBe(true);
      expect(env.schemaVersion).toBe(SCHEMA_VERSION);

      const occurred = Date.parse(env.occurredAt);
      expect(Number.isNaN(occurred)).toBe(false);
      expect(occurred).toBeGreaterThanOrEqual(before);
      expect(occurred).toBeLessThanOrEqual(after);
      expect(env.event.occurredAt).toBe(env.occurredAt);
    });

    it("copies typed caller input into the frozen event", () => {
      const itemId = newEntertainmentItemId();
      const sourceRealizationId = newSourceRealizationId();
      const env = makeEvent({
        userId: "user-7",
        itemId,
        type: "progress",
        sourceRealizationId,
        payload: { positionMs: 42_000 },
      });

      expect(env.event.userId).toBe("user-7");
      expect(env.event.itemId).toBe(itemId);
      expect(env.event.type).toBe("progress");
      expect(env.event.sourceRealizationId).toBe(sourceRealizationId);
      expect(env.event.payload).toEqual({ positionMs: 42_000 });
    });

    it("omits optional event fields when not supplied", () => {
      const env = makeEvent({
        userId: "user-1",
        itemId: newEntertainmentItemId(),
        type: "impression",
      });
      expect("sourceRealizationId" in env.event).toBe(false);
      expect("payload" in env.event).toBe(false);
    });

    it("preserves a caller-supplied sessionId verbatim", () => {
      const env = makeEvent({
        userId: "user-1",
        itemId: newEntertainmentItemId(),
        type: "search",
        sessionId: "external-session-opaque",
      });
      expect(env.event.sessionId).toBe("external-session-opaque");
    });
  });

  describe("envelope", () => {
    it("wraps an existing event with a fresh canonical id and mirrored timestamp", () => {
      const event = {
        userId: "user-2",
        itemId: newEntertainmentItemId(),
        type: "complete" as const,
        occurredAt: "2026-09-13T10:30:00.000Z",
        sessionId: "session-9",
      };
      const first = envelope(event);
      const second = envelope(event);

      expect(first.schemaVersion).toBe(SCHEMA_VERSION);
      expect(first.occurredAt).toBe("2026-09-13T10:30:00.000Z");
      expect(first.event).toBe(event);
      expect(second.event).toBe(event);
      expect(isEventId(first.eventId)).toBe(true);
      expect(isEventId(second.eventId)).toBe(true);
      expect(first.eventId).not.toBe(second.eventId);
    });
  });

  describe("envelopeFromRaw", () => {
    const validEnvelope = (): EventEnvelope =>
      makeEvent({ userId: "user-3", itemId: newEntertainmentItemId(), type: "like" });

    it("accepts a well-formed envelope (round-trip)", () => {
      const env = validEnvelope();
      const parsed = envelopeFromRaw(env);
      if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.errors.join("; ")}`);
      expect(parsed.value).toEqual(env);
      expect(parsed.value.event).toBe(env.event);
    });

    it("accepts a hand-built envelope with a valid canonical event id", () => {
      const raw = {
        schemaVersion: 1,
        eventId: "wfxevt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        occurredAt: "2026-09-13T10:30:00.000Z",
        event: {
          userId: "user-4",
          itemId: newEntertainmentItemId(),
          type: "share",
          occurredAt: "2026-09-13T10:31:00.000Z",
          sessionId: "session-4",
        },
      };
      const parsed = envelopeFromRaw(raw);
      if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.errors.join("; ")}`);
      expect(parsed.value.event.type).toBe("share");
      // Widen the branded id to a plain string for value comparison.
      expect(parsed.value.eventId as string).toBe("wfxevt_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    });

    it("rejects non-object input", () => {
      const badInputs: unknown[] = [null, undefined, 42, "envelope", [], [1, 2]];
      for (const bad of badInputs) {
        const result = envelopeFromRaw(bad);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it("rejects a foreign schema version", () => {
      const env = validEnvelope();
      const versions: unknown[] = [0, 2, 99, "1", null];
      for (const schemaVersion of versions) {
        const result = envelopeFromRaw({ ...env, schemaVersion });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join(" ")).toContain("schemaVersion");
      }
    });

    it("rejects a missing schema version", () => {
      const env = validEnvelope();
      const { schemaVersion: _schemaVersion, ...rest } = env;
      const result = envelopeFromRaw(rest);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("schemaVersion");
    });

    it("rejects malformed event ids", () => {
      const env = validEnvelope();
      const badIds: unknown[] = [
        "wfxitm_01ARZ3NDEKTSV4RRFFQ69G5FAV", // wrong kind
        "wfxevt_bogus",
        123,
        undefined,
      ];
      for (const eventId of badIds) {
        const result = envelopeFromRaw({ ...env, eventId });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join(" ")).toContain("eventId");
      }
    });

    it("rejects malformed occurredAt stamps", () => {
      const env = validEnvelope();
      const badStamps: unknown[] = [
        "yesterday",
        "2026-09-13", // date only
        "2026-09-13T10:30:00", // no timezone offset
        123456,
        null,
      ];
      for (const occurredAt of badStamps) {
        const result = envelopeFromRaw({ ...env, occurredAt });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join(" ")).toContain("occurredAt");
      }
    });

    it("rejects an invalid inner event with field-level errors", () => {
      const env = validEnvelope();
      const result = envelopeFromRaw({ ...env, event: { ...env.event, type: "play" } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("event.type");
    });

    it("rejects when the inner event is missing entirely", () => {
      const env = validEnvelope();
      const { event: _event, ...rest } = env;
      const result = envelopeFromRaw(rest);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    });

    it("collects multiple problems in one failure report", () => {
      const result = envelopeFromRaw({ schemaVersion: 7, eventId: "nope", occurredAt: "nope" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });
});
