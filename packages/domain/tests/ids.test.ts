import { describe, expect, it } from "bun:test";

import {
  ENTERTAINMENT_ITEM_ID_PREFIX,
  EVENT_ID_PREFIX,
  INTENT_ID_PREFIX,
  PLAYBACK_SESSION_ID_PREFIX,
  SOURCE_REALIZATION_ID_PREFIX,
  generateUlid,
  isEntertainmentItemId,
  isEventId,
  isIntentId,
  isPlaybackSessionId,
  isSourceRealizationId,
  newEntertainmentItemId,
  newEventId,
  newIntentId,
  newPlaybackSessionId,
  newSourceRealizationId,
  ulidTimestamp,
} from "../src/index";

/** Independent format check (not the module's own guard): strict ULID body. */
const ULID_BODY_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

describe("canonical IDs", () => {
  describe("factories", () => {
    it("emit the correct prefix with a 26-char Crockford ULID body", () => {
      const cases: Array<[string, () => string]> = [
        [ENTERTAINMENT_ITEM_ID_PREFIX, newEntertainmentItemId],
        [SOURCE_REALIZATION_ID_PREFIX, newSourceRealizationId],
        [EVENT_ID_PREFIX, newEventId],
        [PLAYBACK_SESSION_ID_PREFIX, newPlaybackSessionId],
        [INTENT_ID_PREFIX, newIntentId],
      ];
      for (const [prefix, factory] of cases) {
        const id = factory();
        expect(id.startsWith(prefix)).toBe(true);
        const body = id.slice(prefix.length);
        expect(body).toHaveLength(26);
        expect(body).toMatch(ULID_BODY_RE);
      }
    });

    it("default-time ULIDs embed a timestamp close to now", () => {
      const before = Date.now();
      const ulid = generateUlid();
      const after = Date.now();
      const decoded = ulidTimestamp(ulid);
      if (decoded === null) throw new Error("expected a decodable ULID");
      expect(decoded).toBeGreaterThanOrEqual(before);
      expect(decoded).toBeLessThanOrEqual(after);
    });

    it("produce unique ids across many draws", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 2000; i += 1) ids.add(newEventId());
      expect(ids.size).toBe(2000);
    });
  });

  describe("generateUlid", () => {
    it("encodes the requested timestamp exactly (round-trip)", () => {
      for (const time of [0, 1, 1_757_712_000_000, 2 ** 48 - 1]) {
        const ulid = generateUlid(time);
        expect(ulidTimestamp(ulid)).toBe(time);
      }
    });

    it("sorts chronologically across different times", () => {
      const t0 = 1_757_712_000_000;
      const a = generateUlid(t0);
      const b = generateUlid(t0 + 1);
      const c = generateUlid(t0 + 86_400_000);
      expect(a < b).toBe(true);
      expect(b < c).toBe(true);
    });

    it("is strictly monotonic within the same millisecond", () => {
      const t = 1_757_712_000_000;
      const first = generateUlid(t);
      const second = generateUlid(t);
      const third = generateUlid(t);
      expect(first < second).toBe(true);
      expect(second < third).toBe(true);
    });

    it("rejects out-of-range or non-finite times with a RangeError", () => {
      expect(() => generateUlid(-1)).toThrow(RangeError);
      expect(() => generateUlid(Number.NaN)).toThrow(RangeError);
      expect(() => generateUlid(Number.POSITIVE_INFINITY)).toThrow(RangeError);
      expect(() => generateUlid(2 ** 48)).toThrow(RangeError);
    });
  });

  describe("guards", () => {
    it("accept generated ids of their own kind", () => {
      expect(isEntertainmentItemId(newEntertainmentItemId())).toBe(true);
      expect(isSourceRealizationId(newSourceRealizationId())).toBe(true);
      expect(isEventId(newEventId())).toBe(true);
      expect(isPlaybackSessionId(newPlaybackSessionId())).toBe(true);
      expect(isIntentId(newIntentId())).toBe(true);
    });

    it("accept a known-good hand-written ULID under the right prefix", () => {
      expect(isEventId("wfxevt_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
    });

    it("reject ids of a different kind", () => {
      const id = newEntertainmentItemId();
      expect(isSourceRealizationId(id)).toBe(false);
      expect(isEventId(id)).toBe(false);
      expect(isPlaybackSessionId(id)).toBe(false);
      expect(isIntentId(id)).toBe(false);
      expect(isEntertainmentItemId(newEventId())).toBe(false);
    });

    it("reject non-string values", () => {
      const badValues: unknown[] = [
        null,
        undefined,
        42,
        true,
        {},
        ["wfxitm_01ARZ3NDEKTSV4RRFFQ69G5FAV"],
      ];
      for (const bad of badValues) {
        expect(isEntertainmentItemId(bad)).toBe(false);
        expect(isEventId(bad)).toBe(false);
      }
    });

    it("reject missing, short, long, and lowercased bodies", () => {
      expect(isEntertainmentItemId("wfxitm_")).toBe(false); // no body
      expect(isEntertainmentItemId("wfxitm_01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false); // 25 chars
      expect(isEntertainmentItemId("wfxitm_01ARZ3NDEKTSV4RRFFQ69G5FAVX")).toBe(false); // 27 chars
      expect(isEntertainmentItemId("wfxitm_01arz3ndektsv4rrffq69g5fav")).toBe(false); // lowercase
    });

    it("reject non-Crockford alphabet characters (I, L, O, U)", () => {
      expect(isEventId(`wfxevt_0${"I".repeat(25)}`)).toBe(false);
      expect(isEventId(`wfxevt_0${"L".repeat(25)}`)).toBe(false);
      expect(isEventId(`wfxevt_0${"O".repeat(25)}`)).toBe(false);
      expect(isEventId(`wfxevt_0${"U".repeat(25)}`)).toBe(false);
    });

    it("reject bodies whose timestamp exceeds the 48-bit ULID bound", () => {
      expect(isEventId(`wfxevt_${"8".repeat(26)}`)).toBe(false);
      expect(isEventId(`wfxevt_${"Z".repeat(26)}`)).toBe(false);
    });
  });

  describe("ulidTimestamp", () => {
    it("decodes prefixed ids and bare ULIDs", () => {
      const t = 1_757_712_000_000;
      const ulid = generateUlid(t);
      expect(ulidTimestamp(`${PLAYBACK_SESSION_ID_PREFIX}${ulid}`)).toBe(t);
      expect(ulidTimestamp(ulid)).toBe(t);
    });

    it("returns null for malformed input", () => {
      expect(ulidTimestamp("")).toBeNull();
      expect(ulidTimestamp("wfxitm_")).toBeNull();
      expect(ulidTimestamp("wfxevt_01arz3ndektsv4rrffq69g5fav")).toBeNull();
      expect(ulidTimestamp("wfxevt_01ARZ3NDEKTSV4RRFFQ69G5FAVX")).toBeNull();
      expect(ulidTimestamp("not-an-id")).toBeNull();
    });
  });
});
