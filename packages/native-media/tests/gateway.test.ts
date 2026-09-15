/**
 * @wfx/native-media — gateway module tests (WFX-015, Lane B).
 *
 * Covers, per the task packet:
 * 1. `parseRangeRequest` — every well-formed single-range shape (closed,
 *    open-ended, suffix, single-byte, case/whitespace tolerance), every
 *    malformed shape as TYPED errors carrying the exact offending header
 *    value (never a silent full-file fallback), multi-range as the typed
 *    unsupported scope cut, and the conditional header pass-throughs
 *    (If-None-Match / If-Modified-Since / deliberately-ignored If-Range).
 * 2. Byte helpers — contentRange / unsatisfiableContentRange / etagFor
 *    (deterministic FNV-1a) / validateRangeBounds.
 * 3. `buildRangeResponse` — golden headers for every 200/206/304/416
 *    verdict, including suffix/open/truncated resolutions and typed
 *    throws on malformed arguments.
 * 4. End-to-end through the REAL test HTTP server (Bun.serve + simulation
 *    engine): statuses, Content-Range, Accept-Ranges, ETags, and body
 *    bytes verified BYTE-EXACT against the deterministic synthetic
 *    pattern.
 * 5. Error semantics end-to-end: malformed range -> 416 typed body,
 *    multi-range -> typed unsupported, unknown path -> 404, non-GET ->
 *    405, engine read/stat failures -> 503 typed JSON bodies.
 * 6. Session semantics: one session per asset reused across requests,
 *    single-flight opens under concurrency, idle close after
 *    injected-clock advance (deterministic).
 * 7. Deadline-aware pull: slow-buffering asset + short deadline -> typed
 *    503 ENGINE_TIMEOUT with the `prioritize` hint observable BOTH in the
 *    engine trace and the JSON body; generous deadline -> the hint pulls
 *    the range in and the read succeeds; unknown piece geometry -> typed
 *    hintOmitted.
 * 8. Engine without the range-access extension (the merged WFX-014
 *    adapter) -> typed 503 UNSUPPORTED_SOURCE, never a fake 200.
 *
 * TIMING NOTE: like the WFX-014 engine tests, timing-sensitive cases use
 * saturated fixed points or wide (>=4x) deadline margins so timer jitter
 * can never flip an outcome.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  callsOf,
  contentRange,
  createEngineAdapter,
  createGatewayServer,
  createInProcessEngineProcess,
  createSimulationEngine,
  DEFAULT_TEST_ASSETS,
  ERROR_STATUS,
  etagFor,
  fnv1a32,
  ifNoneMatchMatches,
  NATIVE_MEDIA_ERROR_CODES,
  NativeMediaError,
  parseRangeRequest,
  buildRangeResponse,
  simulatedAssetSeed,
  simulatedByte,
  startTestGateway,
  unsatisfiableContentRange,
  validateRangeBounds,
  wrapRecordingEngine,
  type GatewayAsset,
  type GatewayHttpResponse,
  type GatewayMediaRequest,
  type GatewayResponse,
  type TestGatewayHandle,
  type TestGatewayOptions,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VIDEO_PATH = "/media/test-video.mp4";
const AUDIO_PATH = "/media/test-audio.opus";
const VIDEO_TOTAL = 10_000;

/** The running test servers, stopped after each test. */
const servers: TestGatewayHandle[] = [];

/** Engines/gateways owned by a test, disposed after each test. */
const disposables: { dispose(): void }[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) await server.stop();
  }
  while (disposables.length > 0) {
    const d = disposables.pop();
    if (d !== undefined) d.dispose();
  }
});

function startServer(options: TestGatewayOptions = {}): TestGatewayHandle {
  const handle = startTestGateway(0, options);
  servers.push(handle);
  return handle;
}

function get(
  handle: TestGatewayHandle,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${handle.baseUrl}${path}`, { headers });
}

/** The deterministic synthetic bytes of `[start, end]` for a test asset. */
function expectedBytes(path: string, start: number, end: number): Uint8Array {
  const seed = simulatedAssetSeed(path);
  const out = new Uint8Array(end - start + 1);
  for (let i = start; i <= end; i += 1) {
    out[i - start] = simulatedByte(seed, i);
  }
  return out;
}

/** Byte-exact comparison with a first-mismatch report. */
function expectByteExact(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  let mismatches = 0;
  let firstIndex = -1;
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      mismatches += 1;
      if (firstIndex < 0) firstIndex = i;
    }
  }
  if (mismatches > 0) {
    expect(
      `byte-exact mismatch: ${mismatches}/${expected.length} bytes differ; first at ${firstIndex} (got ${String(actual[firstIndex])}, want ${String(expected[firstIndex])})`,
    ).toBe("no mismatch");
  }
}

async function bodyBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** Parse a header record into a media request for builder tests. */
function mediaRequest(
  range: string | undefined,
  extra: Record<string, string> = {},
): GatewayMediaRequest {
  const headers: Record<string, string> = { ...extra };
  if (range !== undefined) headers.range = range;
  const parsed = parseRangeRequest(headers);
  if (!parsed.ok) {
    throw new Error(`test fixture: unexpected parse failure: ${parsed.error.message}`);
  }
  return { ...parsed.request, sessionId: "session-1" };
}

function build(
  range: string | undefined,
  extra: Record<string, string> = {},
  asset: GatewayAsset = VIDEO_ASSET,
): GatewayResponse {
  return buildRangeResponse(asset, mediaRequest(range, extra));
}

const VIDEO_ASSET: GatewayAsset = {
  assetId: "asset-001",
  version: "1",
  totalBytes: VIDEO_TOTAL,
  contentType: "video/mp4",
};

/** Narrow a typed error of the given code; fails the test otherwise. */
async function expectNativeThrow(
  fn: () => unknown,
  code: (typeof NATIVE_MEDIA_ERROR_CODES)[number],
): Promise<NativeMediaError> {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(NativeMediaError);
    const nme = e as NativeMediaError;
    expect(nme.code).toBe(code);
    return nme;
  }
  throw new Error(`expected a typed NativeMediaError (${code}), got success`);
}

// ---------------------------------------------------------------------------
// 1. Byte helpers
// ---------------------------------------------------------------------------

describe("gateway bytes helpers", () => {
  it("contentRange renders the served-interval form", () => {
    expect(contentRange(0, 1023, 10_000)).toBe("bytes 0-1023/10000");
    expect(contentRange(9_500, 9_999, 10_000)).toBe("bytes 9500-9999/10000");
    expect(contentRange(0, 0, 1)).toBe("bytes 0-0/1");
  });

  it("contentRange throws typed INVALID_INPUT for malformed intervals", () => {
    expect(() => contentRange(10, 5, 100)).toThrow(NativeMediaError);
    expect(() => contentRange(0, 100, 100)).toThrow(); // end >= total
    expect(() => contentRange(-1, 5, 100)).toThrow();
    expect(() => contentRange(0.5, 5, 100)).toThrow();
  });

  it("unsatisfiableContentRange renders the 416 form", () => {
    expect(unsatisfiableContentRange(10_000)).toBe("bytes */10000");
    expect(() => unsatisfiableContentRange(0)).toThrow(NativeMediaError);
    expect(() => unsatisfiableContentRange(Number.NaN)).toThrow();
  });

  it("etagFor is deterministic, version-sensitive, and strongly quoted", () => {
    const a = etagFor("asset-001", "1");
    expect(a).toBe(etagFor("asset-001", "1"));
    expect(a).toMatch(/^"wfx-[0-9a-f]{8}"$/);
    expect(etagFor("asset-001", "2")).not.toBe(a);
    expect(etagFor("asset-002", "1")).not.toBe(a);
    expect(() => etagFor("", "1")).toThrow(NativeMediaError);
    expect(() => etagFor("a", "")).toThrow(NativeMediaError);
  });

  it("fnv1a32 matches the FNV-1a reference vectors", () => {
    // 32-bit FNV-1a: offset basis 2166136261, prime 16777619.
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("validateRangeBounds accepts exactly concrete satisfiable intervals", () => {
    expect(validateRangeBounds(0, 0, 1)).toBe(true);
    expect(validateRangeBounds(0, 999, 1_000)).toBe(true);
    expect(validateRangeBounds(1, 0, 100)).toBe(false); // reversed
    expect(validateRangeBounds(-1, 5, 100)).toBe(false);
    expect(validateRangeBounds(0, 100, 100)).toBe(false); // end >= total
    expect(validateRangeBounds(0, 99, 0)).toBe(false); // empty media
    expect(validateRangeBounds(0.5, 1, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. parseRangeRequest — well-formed shapes
// ---------------------------------------------------------------------------

describe("parseRangeRequest — well-formed single ranges", () => {
  const cases: readonly (readonly [string, number, number | undefined])[] = [
    ["bytes=0-1023", 0, 1023],
    ["bytes=500-", 500, undefined],
    ["bytes=-500", -500, undefined],
    ["bytes=0-0", 0, 0],
    ["BYTES=0-10", 0, 10],
    ["Bytes = 0 - 10", 0, 10],
    ["  bytes=7-9  ", 7, 9],
    ["bytes=100-199", 100, 199],
  ];

  for (const [header, start, end] of cases) {
    it(`parses '${header}'`, () => {
      const result = parseRangeRequest({ range: header });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.request.selection).toEqual(
        end === undefined ? { kind: "range", start } : { kind: "range", start, end },
      );
    });
  }

  it("no Range header selects the full asset", () => {
    const result = parseRangeRequest({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.selection).toEqual({ kind: "full" });
    expect(result.request.ifNoneMatch).toBeUndefined();
    expect(result.request.ifModifiedSince).toBeUndefined();
    expect(result.request.ignoredIfRange).toBeUndefined();
  });

  it("header lookup is case-insensitive on both sides", () => {
    const result = parseRangeRequest({ RaNgE: "bytes=2-4" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.selection).toEqual({ kind: "range", start: 2, end: 4 });
  });
});

// ---------------------------------------------------------------------------
// 3. parseRangeRequest — malformed shapes (typed errors, exact header)
// ---------------------------------------------------------------------------

describe("parseRangeRequest — malformed ranges are typed errors", () => {
  const malformed: readonly string[] = [
    "bytes=abc",
    "bytes=10-5",
    "bytes=-0",
    "bytes=-",
    "bytes=",
    "bytes",
    "items=0-10",
    "bytes=0-1e3",
    "bytes=0-99999999999999999999",
    "bytes=-99999999999999999999",
  ];

  for (const header of malformed) {
    it(`rejects '${header}' with reason malformed + the exact header value`, () => {
      const result = parseRangeRequest({ range: header });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected typed failure");
      expect(result.error.reason).toBe("malformed");
      expect(result.error.header).toBe(header);
      expect(result.error.message).toContain(header);
    });
  }

  it("preserves the exact offending value including whitespace", () => {
    const result = parseRangeRequest({ range: "  bytes=abc  " });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected typed failure");
    expect(result.error.header).toBe("  bytes=abc  ");
  });

  it("a malformed Range NEVER silently selects the full asset", () => {
    for (const header of malformed) {
      const result = parseRangeRequest({ range: header });
      expect(result.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. parseRangeRequest — multi-range scope cut (typed unsupported)
// ---------------------------------------------------------------------------

describe("parseRangeRequest — multi-range is a typed scope cut", () => {
  const multi: readonly string[] = [
    "bytes=0-1,5-9",
    "bytes=0-99, 100-199",
    "bytes=0-1,bytes=5-9",
    "bytes=0-1,",
  ];

  for (const header of multi) {
    it(`rejects '${header}' with reason unsupported`, () => {
      const result = parseRangeRequest({ range: header });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected typed failure");
      expect(result.error.reason).toBe("unsupported");
      expect(result.error.header).toBe(header);
      expect(result.error.message).toContain("single");
    });
  }
});

// ---------------------------------------------------------------------------
// 5. parseRangeRequest — conditional headers
// ---------------------------------------------------------------------------

describe("parseRangeRequest — conditional header pass-through", () => {
  it("parses a single strong If-None-Match tag", () => {
    const result = parseRangeRequest({ "if-none-match": '"wfx-00112233"' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ifNoneMatch).toEqual({
      wildcard: false,
      etags: ['"wfx-00112233"'],
    });
  });

  it("parses the wildcard If-None-Match", () => {
    const result = parseRangeRequest({ "if-none-match": "*" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ifNoneMatch?.wildcard).toBe(true);
  });

  it("parses an If-None-Match list, stripping weak markers", () => {
    const result = parseRangeRequest({
      "if-none-match": '"wfx-a", W/"wfx-b" , "wfx-c"',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ifNoneMatch).toEqual({
      wildcard: false,
      etags: ['"wfx-a"', '"wfx-b"', '"wfx-c"'],
    });
  });

  it("an empty/garbage If-None-Match is simply absent", () => {
    const result = parseRangeRequest({ "if-none-match": "  " });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ifNoneMatch).toBeUndefined();
  });

  it("parses a valid If-Modified-Since HTTP date to epoch ms", () => {
    const result = parseRangeRequest({
      "if-modified-since": "Sun, 06 Nov 1994 08:49:37 GMT",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ifModifiedSince).toBe(784_111_777_000);
  });

  it("an unparseable If-Modified-Since is absent (ignored, per HTTP)", () => {
    const result = parseRangeRequest({ "if-modified-since": "not a date" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ifModifiedSince).toBeUndefined();
  });

  it("If-Range is typed as ignored while the Range selection stands", () => {
    const result = parseRangeRequest({
      range: "bytes=10-19",
      "if-range": '"wfx-deadbeef"',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.request.ignoredIfRange).toBe('"wfx-deadbeef"');
    expect(result.request.selection).toEqual({ kind: "range", start: 10, end: 19 });
  });

  it("ifNoneMatchMatches: wildcard and weak comparison", () => {
    const inm = { wildcard: false, etags: ['"wfx-a"', '"wfx-b"'] };
    expect(ifNoneMatchMatches(inm, '"wfx-a"')).toBe(true);
    expect(ifNoneMatchMatches(inm, '"wfx-c"')).toBe(false);
    expect(ifNoneMatchMatches({ wildcard: true, etags: [] }, '"anything"')).toBe(true);
    // The parser strips W/ for weak comparison; matching is exact after that.
    const weak = { wildcard: false, etags: ['"wfx-a"'] };
    expect(ifNoneMatchMatches(weak, '"wfx-a"')).toBe(true);
    expect(ifNoneMatchMatches(weak, "wfx-a")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Closed error-status table
// ---------------------------------------------------------------------------

describe("ERROR_STATUS — the closed taxonomy mapping", () => {
  it("NOT_FOUND -> 404, RANGE_NOT_SATISFIABLE -> 416, all engine failures -> 503", () => {
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.RANGE_NOT_SATISFIABLE).toBe(416);
    for (const code of NATIVE_MEDIA_ERROR_CODES) {
      if (code === "NOT_FOUND" || code === "RANGE_NOT_SATISFIABLE") continue;
      expect(ERROR_STATUS[code]).toBe(503);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. buildRangeResponse — golden verdicts
// ---------------------------------------------------------------------------

describe("buildRangeResponse — success verdicts", () => {
  it("full request -> 200 with golden headers and a whole-asset descriptor", () => {
    const verdict = build(undefined);
    if (verdict.status !== 200) throw new Error(`expected 200, got ${verdict.status}`);
    expect(verdict.headers).toEqual({
      "Content-Type": "video/mp4",
      "Content-Length": "10000",
      "Accept-Ranges": "bytes",
      ETag: etagFor("asset-001", "1"),
    });
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 0, length: 10_000 });
  });

  it("closed range -> 206 with Content-Range and exact span", () => {
    const verdict = build("bytes=0-1023");
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 0-1023/10000");
    expect(verdict.headers["Content-Length"]).toBe("1024");
    expect(verdict.headers["Accept-Ranges"]).toBe("bytes");
    expect(verdict.headers["Content-Type"]).toBe("video/mp4");
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 0, length: 1024 });
  });

  it("open range bytes=0- -> 206 spanning the whole asset", () => {
    const verdict = build("bytes=0-");
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 0-9999/10000");
    expect(verdict.headers["Content-Length"]).toBe("10000");
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 0, length: 10_000 });
  });

  it("suffix range bytes=-500 -> the last 500 bytes", () => {
    const verdict = build("bytes=-500");
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 9500-9999/10000");
    expect(verdict.headers["Content-Length"]).toBe("500");
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 9500, length: 500 });
  });

  it("a suffix longer than the media resolves to the whole media", () => {
    const verdict = build("bytes=-999999");
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 0-9999/10000");
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 0, length: 10_000 });
  });

  it("an end byte past EOF truncates to the media size", () => {
    const verdict = build("bytes=500-99999999");
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 500-9999/10000");
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 500, length: 9500 });
  });

  it("a single-byte range bytes=0-0 works", () => {
    const verdict = build("bytes=0-0");
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 0-0/10000");
    expect(verdict.body).toEqual({ assetId: "asset-001", offset: 0, length: 1 });
  });

  it("If-Range present is ignored: the range verdict stands", () => {
    const verdict = build("bytes=10-19", { "if-range": '"wfx-deadbeef"' });
    if (verdict.status !== 206) throw new Error(`expected 206, got ${verdict.status}`);
    expect(verdict.headers["Content-Range"]).toBe("bytes 10-19/10000");
  });
});

describe("buildRangeResponse — 304 verdicts", () => {
  it("a matching If-None-Match yields 304 with the ETag and no body", () => {
    const verdict = build(undefined, { "if-none-match": etagFor("asset-001", "1") });
    if (verdict.status !== 304) throw new Error(`expected 304, got ${verdict.status}`);
    expect(verdict.headers).toEqual({ ETag: etagFor("asset-001", "1") });
    expect("body" in verdict && verdict.body !== undefined).toBe(false);
  });

  it("the wildcard If-None-Match yields 304 even with a Range", () => {
    const verdict = build("bytes=0-99", { "if-none-match": "*" });
    if (verdict.status !== 304) throw new Error(`expected 304, got ${verdict.status}`);
  });

  it("a weak If-None-Match tag matches (weak comparison)", () => {
    const verdict = build(undefined, { "if-none-match": `W/${etagFor("asset-001", "1")}` });
    if (verdict.status !== 304) throw new Error(`expected 304, got ${verdict.status}`);
  });

  it("a non-matching If-None-Match falls through to the normal verdict", () => {
    const verdict = build(undefined, { "if-none-match": '"wfx-other"' });
    if (verdict.status !== 200) throw new Error(`expected 200, got ${verdict.status}`);
  });

  it("a listed If-None-Match containing the tag matches", () => {
    const verdict = build(undefined, {
      "if-none-match": `"wfx-other", ${etagFor("asset-001", "1")}`,
    });
    if (verdict.status !== 304) throw new Error(`expected 304, got ${verdict.status}`);
  });
});

describe("buildRangeResponse — 416 verdicts and typed throws", () => {
  it("a range starting at/after EOF -> 416 with Content-Range bytes *\\/total", () => {
    for (const header of ["bytes=10000-", "bytes=10000-10001", "bytes=20000-20001"]) {
      const verdict = build(header);
      if (verdict.status !== 416) {
        throw new Error(`expected 416 for '${header}', got ${verdict.status}`);
      }
      expect(verdict.headers["Content-Range"]).toBe("bytes */10000");
      expect(verdict.headers["Accept-Ranges"]).toBe("bytes");
      expect(verdict.detail).toContain("not satisfiable");
      expect("body" in verdict).toBe(false);
    }
  });

  it("a malformed asset throws a typed INVALID_INPUT (never fabricates)", async () => {
    await expectNativeThrow(
      () => buildRangeResponse({ ...VIDEO_ASSET, totalBytes: 0 }, mediaRequest("bytes=0-9")),
      "INVALID_INPUT",
    );
    await expectNativeThrow(
      () =>
        buildRangeResponse({ ...VIDEO_ASSET, contentType: " " }, mediaRequest("bytes=0-9")),
      "INVALID_INPUT",
    );
    await expectNativeThrow(
      () => buildRangeResponse({ ...VIDEO_ASSET, assetId: "" }, mediaRequest("bytes=0-9")),
      "INVALID_INPUT",
    );
  });

  it("a garbage selection throws a typed INVALID_INPUT", async () => {
    await expectNativeThrow(
      () =>
        buildRangeResponse(
          VIDEO_ASSET,
          { sessionId: "session-1", selection: { kind: "range", start: -5, end: 10 } },
        ),
      "INVALID_INPUT",
    );
  });
});

// ---------------------------------------------------------------------------
// 8. End-to-end through the REAL test server — statuses + byte-exact bodies
// ---------------------------------------------------------------------------

describe("gateway e2e — happy paths are byte-exact", () => {
  it("full GET -> 200, golden headers, byte-exact full body", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("10000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    const etag = response.headers.get("etag");
    expect(etag).toMatch(/^"wfx-[0-9a-f]{8}"$/);
    expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 0, 9_999));
  });

  it("closed range GET -> 206 with Content-Range and byte-exact body", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=100-299" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-299/10000");
    expect(response.headers.get("content-length")).toBe("200");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 100, 299));
  });

  it("open range bytes=0- -> 206 spanning the whole asset", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=0-" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-9999/10000");
    expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 0, 9_999));
  });

  it("suffix range bytes=-500 -> the last 500 bytes, byte-exact", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=-500" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 9500-9999/10000");
    expect(response.headers.get("content-length")).toBe("500");
    expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 9_500, 9_999));
  });

  it("a suffix longer than the media -> the whole media (206)", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=-999999" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-9999/10000");
    expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 0, 9_999));
  });

  it("an end byte past EOF truncates (206, not an error)", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=9000-99999999" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 9000-9999/10000");
    expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 9_000, 9_999));
  });

  it("a second asset serves independently with its own content type", async () => {
    const server = startServer();
    const response = await get(server, AUDIO_PATH, { range: "bytes=0-99" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/opus");
    expect(response.headers.get("content-range")).toBe("bytes 0-99/4096");
    expectByteExact(await bodyBytes(response), expectedBytes(AUDIO_PATH, 0, 99));
  });

  it("ETags are stable across requests and distinct across assets", async () => {
    const server = startServer();
    const first = await get(server, VIDEO_PATH, { range: "bytes=0-0" });
    const second = await get(server, VIDEO_PATH, { range: "bytes=1-1" });
    const audio = await get(server, AUDIO_PATH, { range: "bytes=0-0" });
    expect(first.headers.get("etag")).toBe(second.headers.get("etag"));
    expect(first.headers.get("etag")).not.toBe(audio.headers.get("etag"));
  });
});

// ---------------------------------------------------------------------------
// 9. E2E — conditional requests
// ---------------------------------------------------------------------------

describe("gateway e2e — conditional requests", () => {
  it("If-None-Match matching the served ETag -> 304 with no body", async () => {
    const server = startServer();
    const first = await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();
    const revalidated = await get(server, VIDEO_PATH, {
      range: "bytes=0-99",
      "if-none-match": etag ?? "",
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("etag")).toBe(etag);
    expect((await bodyBytes(revalidated)).length).toBe(0);
  });

  it("wildcard If-None-Match -> 304", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { "if-none-match": "*" });
    expect(response.status).toBe(304);
  });

  it("a non-matching If-None-Match serves normally", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, {
      range: "bytes=0-99",
      "if-none-match": '"wfx-other"',
    });
    expect(response.status).toBe(206);
  });

  it("If-Range is ignored: the range is applied anyway", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, {
      range: "bytes=0-99",
      "if-range": '"wfx-deadbeef"',
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-99/10000");
  });
});

// ---------------------------------------------------------------------------
// 10. E2E — typed error semantics
// ---------------------------------------------------------------------------

describe("gateway e2e — typed error semantics", () => {
  it("a range beyond EOF -> 416 + Content-Range bytes *\\/total + typed JSON body", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=10000-" });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string; retryable: boolean; sessionId: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("RANGE_NOT_SATISFIABLE");
    expect(body.error.message).toContain("not satisfiable");
    expect(body.error.retryable).toBe(false);
    expect(body.error.sessionId).toMatch(/^sim-session-/);
  });

  const malformedRanges: readonly string[] = ["bytes=abc", "bytes=10-5", "bytes=-0", "bytes=-"];
  for (const header of malformedRanges) {
    it(`malformed range '${header}' -> 416 with the exact header value typed in the body`, async () => {
      const server = startServer();
      const response = await get(server, VIDEO_PATH, { range: header });
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10000");
      const body = (await response.json()) as {
        ok: boolean;
        error: { code: string; header: string; reason: string; message: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("INVALID_RANGE_HEADER");
      expect(body.error.header).toBe(header);
      expect(body.error.reason).toBe("malformed");
      expect(body.error.message).toContain(header);
    });
  }

  it("multi-range -> typed 416 MULTI_RANGE_UNSUPPORTED with the exact header", async () => {
    const server = startServer();
    const response = await get(server, VIDEO_PATH, { range: "bytes=0-1,5-9" });
    expect(response.status).toBe(416);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; header: string; reason: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MULTI_RANGE_UNSUPPORTED");
    expect(body.error.header).toBe("bytes=0-1,5-9");
    expect(body.error.reason).toBe("unsupported");
    expect(body.error.message).toContain("single");
  });

  it("an unknown path -> 404 with a typed NOT_FOUND body", async () => {
    const server = startServer();
    const response = await get(server, "/media/does-not-exist.mkv");
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string; retryable: boolean };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("/media/does-not-exist.mkv");
    expect(body.error.retryable).toBe(false);
  });

  it("non-GET methods -> typed 405 with Allow: GET", async () => {
    const server = startServer();
    // HEAD carries no readable body by definition — assert status + Allow.
    const head = await fetch(`${server.baseUrl}${VIDEO_PATH}`, { method: "HEAD" });
    expect(head.status).toBe(405);
    expect(head.headers.get("allow")).toBe("GET");
    // POST carries a body: assert the typed JSON error envelope.
    const post = await fetch(`${server.baseUrl}${VIDEO_PATH}`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    const body = (await post.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(body.error.message).toContain("POST");
  });

  it("a duplicate Range header line combines into the typed multi-range cut", async () => {
    const server = startServer();
    const response = await fetch(`${server.baseUrl}${VIDEO_PATH}`, {
      headers: [["range", "bytes=0-1"], ["range", "bytes=5-9"]],
    });
    expect(response.status).toBe(416);
    const body = (await response.json()) as {
      error: { code: string; reason: string };
    };
    expect(body.error.code).toBe("MULTI_RANGE_UNSUPPORTED");
    expect(body.error.reason).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
// 11. E2E — session semantics: reuse, single-flight, one per asset
// ---------------------------------------------------------------------------

describe("gateway e2e — session semantics", () => {
  it("one session per asset, reused across requests", async () => {
    const server = startServer();
    await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    await get(server, VIDEO_PATH, { range: "bytes=100-199" });
    await get(server, VIDEO_PATH, { range: "bytes=-100" });
    expect(callsOf(server.engine.trace, "open").length).toBe(1);
    expect(server.gateway.sessionCount()).toBe(1);
  });

  it("distinct assets hold distinct sessions", async () => {
    const server = startServer();
    await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    await get(server, AUDIO_PATH, { range: "bytes=0-99" });
    expect(callsOf(server.engine.trace, "open").length).toBe(2);
    expect(server.gateway.sessionCount()).toBe(2);
  });

  it("concurrent requests for one asset share a single open (single-flight)", async () => {
    const server = startServer();
    const requests = Array.from({ length: 5 }, () =>
      get(server, VIDEO_PATH, { range: "bytes=0-99" }),
    );
    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status).toBe(206);
    }
    expect(callsOf(server.engine.trace, "open").length).toBe(1);
    expect(server.gateway.sessionCount()).toBe(1);
    for (const response of responses) {
      expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 0, 99));
    }
  });
});

// ---------------------------------------------------------------------------
// 12. E2E — engine failures map to typed 503 bodies
// ---------------------------------------------------------------------------

describe("gateway e2e — engine failures -> typed 503 JSON bodies", () => {
  it("a failing readRange surfaces as 503 INTERNAL (non-retryable, immediate)", async () => {
    const server = startServer();
    // Prime the session + full download so the failure is the read itself.
    await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    server.engine.failReads = new Error("disk on fire");
    const response = await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string; retryable: boolean; sessionId: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toContain("disk on fire");
    expect(body.error.retryable).toBe(false);
    expect(body.error.sessionId).toMatch(/^sim-session-/);

    // Recovery after clearing the hook: the SAME session keeps serving.
    server.engine.failReads = undefined;
    const recovered = await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    expect(recovered.status).toBe(206);
    expect(callsOf(server.engine.trace, "open").length).toBe(1);
  });

  it("a failing statMedia surfaces as 503 INTERNAL", async () => {
    const server = startServer();
    server.engine.failStats = new Error("stat explosion");
    const response = await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toContain("stat explosion");
  });
});

// ---------------------------------------------------------------------------
// 13. Deadline-aware pull
// ---------------------------------------------------------------------------

describe("gateway e2e — deadline-aware pull", () => {
  it(
    "slow buffering + short deadline -> typed 503 ENGINE_TIMEOUT with the prioritize hint in the body AND the engine trace",
    async () => {
      // 1 byte/ms: a 5-piece span (5000 bytes) needs ~5s of cumulative
      // download budget; the read deadline is 100ms — a 50x margin, so
      // timer jitter can never flip the outcome.
      const server = startServer({
        simulation: { bytesPerSecond: 1_000, tickMs: 5 },
        gateway: { readDeadlineMs: 100, pollIntervalMs: 20 },
      });
      const response = await get(server, VIDEO_PATH, { range: "bytes=0-4999" });
      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        ok: boolean;
        error: {
          code: string;
          message: string;
          retryable: boolean;
          prioritizeHint: { piece: number; deadlineMs: number }[];
        };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("ENGINE_TIMEOUT");
      expect(body.error.retryable).toBe(true);
      expect(body.error.message).toContain("0-4999");
      // The hint covers exactly the requested range's pieces (0..4).
      expect(body.error.prioritizeHint.length).toBe(5);
      expect(body.error.prioritizeHint.map((entry) => entry.piece)).toEqual([0, 1, 2, 3, 4]);
      for (const entry of body.error.prioritizeHint) {
        expect(entry.deadlineMs).toBeGreaterThan(0);
        expect(entry.deadlineMs).toBeLessThanOrEqual(100);
      }

      // The same hint is observable in the engine trace.
      const prioritizes = callsOf(server.engine.trace, "prioritize");
      expect(prioritizes.length).toBe(1);
      const deadlines = prioritizes[0]?.args[1] as { piece: number; deadlineMs: number }[];
      expect(deadlines.map((entry) => entry.piece)).toEqual([0, 1, 2, 3, 4]);
      // The pull genuinely retried before the deadline expired.
      expect(callsOf(server.engine.trace, "readRange").length).toBeGreaterThanOrEqual(2);
    },
  );

  it(
    "a generous deadline lets the hint pull the range in -> 206 byte-exact",
    async () => {
      // 10 bytes/ms: the hinted piece 9 (~1000 bytes) lands in ~100ms,
      // comfortably inside the 400ms deadline — and WITHOUT the hint it
      // would be the last piece (~1000ms) and would miss the deadline.
      const server = startServer({
        simulation: { bytesPerSecond: 10_000, tickMs: 5 },
        gateway: { readDeadlineMs: 400, pollIntervalMs: 20 },
      });
      const response = await get(server, VIDEO_PATH, { range: "bytes=9000-9999" });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 9000-9999/10000");
      expectByteExact(await bodyBytes(response), expectedBytes(VIDEO_PATH, 9_000, 9_999));
      // The pull path was exercised (a hint was sent).
      expect(callsOf(server.engine.trace, "prioritize").length).toBe(1);
    },
  );

  it(
    "unknown piece geometry -> the pull still waits but types hintOmitted (no prioritize sent)",
    async () => {
      // Direct transport-agnostic handle call (proves transport-agnosticism
      // and the no-geometry path without HTTP glue).
      const simulation = createSimulationEngine({
        assets: {
          "/media/no-geometry.bin": {
            totalBytes: 8_000,
            durationMs: 60_000,
            pieceCount: 8,
            contentType: "application/octet-stream",
          },
        },
        bytesPerSecond: 1_000,
        tickMs: 5,
      });
      disposables.push(simulation);
      const engine = wrapRecordingEngine(simulation);
      const gateway = createGatewayServer(engine, {
        assets: {
          "/media/no-geometry.bin": { source: { localPath: "/media/no-geometry.bin" } },
        },
        readDeadlineMs: 60,
        pollIntervalMs: 20,
      });
      const response: GatewayHttpResponse = await gateway.handle({
        method: "GET",
        path: "/media/no-geometry.bin",
        headers: { range: "bytes=4000-4099" },
      });
      expect(response.status).toBe(503);
      const body = JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array())) as {
        ok: boolean;
        error: { code: string; hintOmitted?: boolean; prioritizeHint?: unknown };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("ENGINE_TIMEOUT");
      expect(body.error.hintOmitted).toBe(true);
      expect(body.error.prioritizeHint).toBeUndefined();
      expect(callsOf(engine.trace, "prioritize").length).toBe(0);
      await gateway.dispose();
    },
  );
});

// ---------------------------------------------------------------------------
// 14. Idle session close (injected clock — deterministic)
// ---------------------------------------------------------------------------

describe("gateway e2e — idle session close after injected-clock advance", () => {
  it("closes exactly after idleTimeoutMs and reopens on the next request", async () => {
    let now = 0;
    const server = startServer({
      gateway: {
        clock: () => now,
        idleTimeoutMs: 1_000,
        readDeadlineMs: 2_000,
        pollIntervalMs: 25,
      },
    });

    // Open + use the session at t=0 (the pull loop handles the first read).
    const first = await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    expect(first.status).toBe(206);
    expect(server.gateway.sessionCount()).toBe(1);
    const openSource = callsOf(server.engine.trace, "open")[0]?.args[0] as
      | { localPath?: string }
      | undefined;
    expect(openSource?.localPath).toBe(VIDEO_PATH);

    // Not yet idle at t=500: the sweep closes nothing.
    now = 500;
    const early = await server.gateway.sweepIdleSessions();
    expect(early.closed.length).toBe(0);
    expect(early.failures.length).toBe(0);
    expect(server.gateway.sessionCount()).toBe(1);

    // Idle at t=1500: the sweep closes the session through the engine.
    now = 1_500;
    const swept = await server.gateway.sweepIdleSessions();
    expect(swept.closed.length).toBe(1);
    expect(swept.failures.length).toBe(0);
    expect(server.gateway.sessionCount()).toBe(0);
    expect(callsOf(server.engine.trace, "close").length).toBe(1);

    // The next request transparently re-opens a fresh session.
    const reopened = await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    expect(reopened.status).toBe(206);
    expect(server.gateway.sessionCount()).toBe(1);
    expect(callsOf(server.engine.trace, "open").length).toBe(2);
    expectByteExact(await bodyBytes(reopened), expectedBytes(VIDEO_PATH, 0, 99));
  });

  it("lazy per-request sweep also closes idle sessions", async () => {
    let now = 0;
    const server = startServer({
      gateway: { clock: () => now, idleTimeoutMs: 1_000, readDeadlineMs: 2_000 },
    });
    await get(server, VIDEO_PATH, { range: "bytes=0-99" });
    expect(server.gateway.sessionCount()).toBe(1);

    // Advance the injected clock and hit a DIFFERENT asset: the lazy sweep
    // at the start of that request closes the idle video session first.
    now = 5_000;
    const other = await get(server, AUDIO_PATH, { range: "bytes=0-99" });
    expect(other.status).toBe(206);
    expect(server.gateway.sessionCount()).toBe(1); // audio only
    expect(callsOf(server.engine.trace, "close").length).toBe(1);
    expect(callsOf(server.engine.trace, "open").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 15. Engine without range access (the merged WFX-014 adapter)
// ---------------------------------------------------------------------------

describe("gateway — engine without the range-access extension", () => {
  it("answers every request with a typed 503 UNSUPPORTED_SOURCE (no fake 200)", async () => {
    const process = createInProcessEngineProcess({
      simulation: {
        assets: {
          "/media/wired.mp4": {
            totalBytes: 8_000,
            durationMs: 60_000,
            pieceCount: 8,
            contentType: "video/mp4",
          },
        },
      },
    });
    const adapter = createEngineAdapter(process, {
      cacheDir: "/tmp/wfx-gateway-test-cache",
      maxCacheBytes: 1_000_000,
    });
    disposables.push(adapter);
    const gateway = createGatewayServer(adapter, {
      assets: { "/media/wired.mp4": { source: { localPath: "/media/wired.mp4" } } },
    });
    const response = await gateway.handle({
      method: "GET",
      path: "/media/wired.mp4",
      headers: { range: "bytes=0-99" },
    });
    expect(response.status).toBe(503);
    const body = JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array())) as {
      ok: boolean;
      error: { code: string; message: string; retryable: boolean };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNSUPPORTED_SOURCE");
    expect(body.error.message).toContain("range-access extension");
    expect(body.error.retryable).toBe(false);
    // The typed unsupported path is answered BEFORE any session is opened
    // against the non-range engine (nothing could ever be read).
    expect(gateway.sessionCount()).toBe(0);
    await gateway.dispose();
  });
});

// ---------------------------------------------------------------------------
// 16. Default test fixtures sanity
// ---------------------------------------------------------------------------

describe("test server fixtures", () => {
  it("the default asset set is deterministic and non-trivial", () => {
    expect(DEFAULT_TEST_ASSETS.length).toBe(2);
    for (const asset of DEFAULT_TEST_ASSETS) {
      expect(asset.totalBytes).toBeGreaterThan(0);
      expect(asset.pieceCount).toBeGreaterThan(0);
      expect(asset.pieceCount).toBeLessThanOrEqual(asset.totalBytes);
      expect(asset.contentType).toContain("/");
    }
  });
});
