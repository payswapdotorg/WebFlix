import { describe, expect, it } from "bun:test";

import {
  contentRangeHeaderValue,
  describeRange,
  makeRangeResponse,
  NativeMediaError,
  parseRangeHeader,
  resolveRange,
  satisfiable,
} from "../src/index";

const TOTAL = 1000;

function req(startByte: number, endByte?: number) {
  return endByte === undefined
    ? { sessionId: "s1", startByte }
    : { sessionId: "s1", startByte, endByte };
}

describe("parseRangeHeader — the three standard forms", () => {
  it("parses bytes=a-b (closed interval)", () => {
    expect(parseRangeHeader("bytes=0-499")).toEqual({ startByte: 0, endByte: 499 });
    expect(parseRangeHeader("bytes=500-999")).toEqual({ startByte: 500, endByte: 999 });
  });

  it("parses bytes=a- (open-ended: through end of media)", () => {
    expect(parseRangeHeader("bytes=0-")).toEqual({ startByte: 0 });
    expect(parseRangeHeader("bytes=500-")).toEqual({ startByte: 500 });
    expect(parseRangeHeader("bytes=500-")?.endByte).toBeUndefined();
  });

  it("parses bytes=-n (suffix: last n bytes), encoded as negative startByte", () => {
    expect(parseRangeHeader("bytes=-500")).toEqual({ startByte: -500 });
    expect(parseRangeHeader("bytes=-1")).toEqual({ startByte: -1 });
    expect(parseRangeHeader("bytes=-500")?.endByte).toBeUndefined();
  });

  it("tolerates surrounding and inner whitespace and case-insensitive unit", () => {
    expect(parseRangeHeader("  bytes=0-99  ")).toEqual({ startByte: 0, endByte: 99 });
    expect(parseRangeHeader("bytes= 0 - 99 ")).toEqual({ startByte: 0, endByte: 99 });
    expect(parseRangeHeader("BYTES=0-99")).toEqual({ startByte: 0, endByte: 99 });
    expect(parseRangeHeader("Bytes=-99")).toEqual({ startByte: -99 });
  });
});

describe("parseRangeHeader — malformed input is null, never a guess", () => {
  it("rejects empty, wrong-unit, and garbage headers", () => {
    expect(parseRangeHeader("")).toBeNull();
    expect(parseRangeHeader("bytes=")).toBeNull();
    expect(parseRangeHeader("chars=0-99")).toBeNull();
    expect(parseRangeHeader("0-499")).toBeNull();
    expect(parseRangeHeader("bytes 0-99")).toBeNull();
    expect(parseRangeHeader("abc")).toBeNull();
  });

  it("rejects the degenerate 'bytes=-' form", () => {
    expect(parseRangeHeader("bytes=-")).toBeNull();
  });

  it("rejects suffix length 0 (bytes=-0)", () => {
    expect(parseRangeHeader("bytes=-0")).toBeNull();
  });

  it("rejects reversed intervals (bytes=10-5)", () => {
    expect(parseRangeHeader("bytes=10-5")).toBeNull();
  });

  it("rejects non-integer and non-numeric components", () => {
    expect(parseRangeHeader("bytes=a-b")).toBeNull();
    expect(parseRangeHeader("bytes=1.5-9")).toBeNull();
    expect(parseRangeHeader("bytes=1-2.5")).toBeNull();
    expect(parseRangeHeader("bytes=-2.5")).toBeNull();
    expect(parseRangeHeader("bytes=--")).toBeNull();
  });

  it("rejects multi-range headers (single-range contract only)", () => {
    expect(parseRangeHeader("bytes=0-1,5-9")).toBeNull();
  });

  it("rejects integers beyond the safe range", () => {
    expect(parseRangeHeader("bytes=99999999999999999999-")).toBeNull();
    expect(parseRangeHeader("bytes=-99999999999999999999")).toBeNull();
  });
});

describe("satisfiable — predicate against a media size", () => {
  it("accepts in-bounds intervals, open and closed", () => {
    expect(satisfiable(req(0, 499), TOTAL)).toBe(true);
    expect(satisfiable(req(0, 999), TOTAL)).toBe(true);
    expect(satisfiable(req(999, 999), TOTAL)).toBe(true);
    expect(satisfiable(req(500), TOTAL)).toBe(true);
  });

  it("accepts an interval that extends past the end (it truncates, per RFC 9110)", () => {
    expect(satisfiable(req(500, 5000), TOTAL)).toBe(true);
    expect(satisfiable(req(0, 4294967296), TOTAL)).toBe(true);
  });

  it("accepts suffixes, including ones longer than the media (whole content)", () => {
    expect(satisfiable(req(-500), TOTAL)).toBe(true);
    expect(satisfiable(req(-1000), TOTAL)).toBe(true);
    expect(satisfiable(req(-5000), TOTAL)).toBe(true);
  });

  it("rejects a start byte at or beyond the media size", () => {
    expect(satisfiable(req(1000), TOTAL)).toBe(false);
    expect(satisfiable(req(1000, 1000), TOTAL)).toBe(false);
    expect(satisfiable(req(2000), TOTAL)).toBe(false);
  });

  it("rejects zero-byte, negative, and non-integer media sizes", () => {
    expect(satisfiable(req(0), 0)).toBe(false);
    expect(satisfiable(req(0), -1)).toBe(false);
    expect(satisfiable(req(0), 10.5)).toBe(false);
    expect(satisfiable(req(0), Number.NaN)).toBe(false);
  });

  it("rejects malformed requests (total predicate, never throws)", () => {
    expect(satisfiable({ startByte: 0 } as never, TOTAL)).toBe(false); // missing sessionId
    expect(satisfiable({ sessionId: "", startByte: 0 } as never, TOTAL)).toBe(false);
    expect(satisfiable({ sessionId: "s", startByte: 1.5 } as never, TOTAL)).toBe(false);
    expect(satisfiable({ sessionId: "s", startByte: 5, endByte: 2 } as never, TOTAL)).toBe(false);
    expect(satisfiable({ sessionId: "s", startByte: -5, endByte: 9 } as never, TOTAL)).toBe(false);
    expect(satisfiable(null as never, TOTAL)).toBe(false);
  });
});

describe("resolveRange — concrete intervals", () => {
  it("resolves closed intervals and truncates the end to the media size", () => {
    expect(resolveRange(req(0, 499), TOTAL)).toEqual({ startByte: 0, endByte: 499 });
    expect(resolveRange(req(500, 5000), TOTAL)).toEqual({ startByte: 500, endByte: 999 });
  });

  it("resolves open-ended requests to the last byte", () => {
    expect(resolveRange(req(500), TOTAL)).toEqual({ startByte: 500, endByte: 999 });
    expect(resolveRange(req(0), TOTAL)).toEqual({ startByte: 0, endByte: 999 });
  });

  it("resolves suffixes: last N bytes, or the whole media when N >= size", () => {
    expect(resolveRange(req(-500), TOTAL)).toEqual({ startByte: 500, endByte: 999 });
    expect(resolveRange(req(-1), TOTAL)).toEqual({ startByte: 999, endByte: 999 });
    expect(resolveRange(req(-1000), TOTAL)).toEqual({ startByte: 0, endByte: 999 });
    expect(resolveRange(req(-5000), TOTAL)).toEqual({ startByte: 0, endByte: 999 });
  });

  it("answers null for malformed or unsatisfiable requests", () => {
    expect(resolveRange(req(2000), TOTAL)).toBeNull();
    expect(resolveRange(req(0), 0)).toBeNull();
    expect(resolveRange({ sessionId: "s", startByte: 1.5 } as never, TOTAL)).toBeNull();
  });
});

describe("describeRange — canonical rendering", () => {
  it("renders closed, open, and suffix forms", () => {
    expect(describeRange(req(100, 199))).toBe("bytes=100-199");
    expect(describeRange(req(100))).toBe("bytes=100-");
    expect(describeRange(req(-500))).toBe("bytes=-500");
  });
});

describe("makeRangeResponse — builder with typed failures", () => {
  const content = {
    totalBytes: TOTAL,
    contentType: "video/mp4",
    data: new Uint8Array(500),
  };

  it("builds a full response for a closed interval", () => {
    const resp = makeRangeResponse(req(0, 499), content);
    expect(resp).toEqual({
      sessionId: "s1",
      startByte: 0,
      endByte: 499,
      totalBytes: TOTAL,
      contentType: "video/mp4",
      data: content.data,
    });
  });

  it("resolves open-ended requests to the end of the media", () => {
    const data = new Uint8Array(500);
    const resp = makeRangeResponse(req(500), { ...content, data });
    expect(resp.startByte).toBe(500);
    expect(resp.endByte).toBe(999);
    expect(resp.data).toBe(data); // passed through by reference
  });

  it("resolves suffix requests against the media size", () => {
    const data = new Uint8Array(500);
    const resp = makeRangeResponse(req(-500), { ...content, data });
    expect(resp.startByte).toBe(500);
    expect(resp.endByte).toBe(999);
  });

  it("truncates an interval that extends past the media size", () => {
    const data = new Uint8Array(500);
    const resp = makeRangeResponse(req(500, 5000), { ...content, data });
    expect(resp.startByte).toBe(500);
    expect(resp.endByte).toBe(999);
  });

  it("throws RANGE_NOT_SATISFIABLE (with sessionId) for out-of-bounds starts", () => {
    try {
      makeRangeResponse(req(2000), { ...content, data: new Uint8Array(0) });
      throw new Error("expected RANGE_NOT_SATISFIABLE");
    } catch (e) {
      const nme = e as NativeMediaError;
      expect(nme).toBeInstanceOf(NativeMediaError);
      expect(nme.code).toBe("RANGE_NOT_SATISFIABLE");
      expect(nme.sessionId).toBe("s1");
      expect(nme.retryable).toBe(false);
    }
  });

  it("throws INVALID_INPUT when data length does not match the resolved span", () => {
    try {
      makeRangeResponse(req(0, 499), { ...content, data: new Uint8Array(10) });
      throw new Error("expected INVALID_INPUT");
    } catch (e) {
      const nme = e as NativeMediaError;
      expect(nme.code).toBe("INVALID_INPUT");
      expect(nme.detail).toContain("span");
    }
  });

  it("throws INVALID_INPUT for malformed content (size, type, data)", () => {
    const cases: Array<{ totalBytes: number; contentType: string; data: Uint8Array }> = [
      { totalBytes: 0, contentType: "video/mp4", data: new Uint8Array(1000) },
      { totalBytes: -5, contentType: "video/mp4", data: new Uint8Array(1000) },
      { totalBytes: 10.5, contentType: "video/mp4", data: new Uint8Array(1000) },
      { totalBytes: TOTAL, contentType: "", data: new Uint8Array(1000) },
      { totalBytes: TOTAL, contentType: "   ", data: new Uint8Array(1000) },
    ];
    for (const c of cases) {
      expect(() => makeRangeResponse(req(0), c)).toThrow(NativeMediaError);
    }
    expect(() =>
      makeRangeResponse(req(0), { totalBytes: TOTAL, contentType: "video/mp4", data: undefined as never }),
    ).toThrow(NativeMediaError);
    expect(() => makeRangeResponse(req(0), null as never)).toThrow(NativeMediaError);
  });

  it("throws INVALID_INPUT for a malformed request", () => {
    expect(() => makeRangeResponse({ sessionId: "", startByte: 0 } as never, content)).toThrow(
      NativeMediaError,
    );
    expect(() => makeRangeResponse(null as never, content)).toThrow(NativeMediaError);
  });
});

describe("contentRangeHeaderValue — HTTP serialization", () => {
  it("renders 'bytes start-end/total'", () => {
    const resp = {
      sessionId: "s1",
      startByte: 0,
      endByte: 499,
      totalBytes: 1000,
      contentType: "video/mp4",
      data: new Uint8Array(500),
    };
    expect(contentRangeHeaderValue(resp)).toBe("bytes 0-499/1000");
  });

  it("renders suffix-resolved responses correctly", () => {
    const resp = makeRangeResponse(req(-250), {
      totalBytes: TOTAL,
      contentType: "video/mp4",
      data: new Uint8Array(250),
    });
    expect(contentRangeHeaderValue(resp)).toBe("bytes 750-999/1000");
  });

  it("throws INVALID_INPUT for malformed responses — never fabricates a header", () => {
    const good = {
      sessionId: "s1",
      startByte: 0,
      endByte: 499,
      totalBytes: 1000,
      contentType: "video/mp4",
      data: new Uint8Array(500),
    };
    const bad = (patch: Record<string, unknown>) => ({ ...good, ...patch });
    expect(() => contentRangeHeaderValue(bad({ sessionId: "" }))).toThrow(NativeMediaError);
    expect(() => contentRangeHeaderValue(bad({ startByte: -1 }))).toThrow(NativeMediaError);
    expect(() => contentRangeHeaderValue(bad({ endByte: 500, startByte: 600 }))).toThrow(NativeMediaError);
    expect(() => contentRangeHeaderValue(bad({ totalBytes: 499 }))).toThrow(NativeMediaError); // totalBytes <= endByte
    expect(() => contentRangeHeaderValue(bad({ contentType: "" }))).toThrow(NativeMediaError);
    expect(() => contentRangeHeaderValue(bad({ data: "nope" }))).toThrow(NativeMediaError);
    expect(() => contentRangeHeaderValue(null as never)).toThrow(NativeMediaError);
  });
});
