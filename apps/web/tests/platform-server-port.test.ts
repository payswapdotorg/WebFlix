/**
 * R07 ServerPort tests (bun:test) — the typed-failure law, deterministically.
 *
 * Proves the R01 ratification over the REAL transport implementation:
 * every operation is fetch-mocked (no network) and every failure answers
 * the TYPED `ServerResult` — NEVER a degraded empty success:
 *
 * - fetch rejection (offline/DNS/abort) ⇒ `network`;
 * - 401/403 ⇒ `unauthorized`; 5xx/408/429 ⇒ `unavailable`;
 * - 404 ⇒ `unavailable` (the ratified law) — EXCEPT metadata 404, the one
 *   read whose type carries absence (⇒ `ok: true, value: null`);
 * - other 4xx / non-JSON 2xx / wrong-shaped payloads ⇒ `malformed`;
 * - `emitEvent` transport failures answer `ok: false` (the EVENT SINK
 *   LAW — the runtime keeps the event pending; a lost watch-state event
 *   is never a silent success);
 * - individually malformed entries inside a valid array are skipped
 *   (documented — a broken hit is never a card);
 * - identity rides as HEADERS (`x-wfx-user-id` / `x-wfx-session-id` /
 *   `x-wfx-locale` / `x-wfx-region`) — NEVER in URLs;
 * - the shorts composition applies the frozen short-form eligibility law
 *   over the frozen search transport.
 */

import { describe, expect, it } from "bun:test";

import { createWebServerPort, WEB_SERVER_SERVICE_ID } from "../src/platform/server-port";
import type { WebServerPortOptions } from "../src/platform/server-port";
import { withFetchStub } from "./fake-web";

const BASE = "https://experience.example";

function makePort(overrides: Partial<WebServerPortOptions> = {}) {
  return createWebServerPort({
    apiBase: new URL(BASE),
    context: {
      userId: "wfx-anonymous",
      sessionId: "wfx-session-1",
      locale: "en",
      region: "EU",
    },
    ...overrides,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SEARCH_HITS = [
  { connectorId: "conn-1", externalRef: "ref-1", title: "Neon Rain", canonicalType: "short", orientation: "vertical", durationMs: 45_000 },
  { connectorId: "conn-1", externalRef: "ref-2", title: "Deep Field Diary", canonicalType: "video", orientation: "horizontal", durationMs: 3_600_000 },
  { connectorId: "conn-1", externalRef: "", title: "Broken hit (no ref)" },
];

describe("R07 ServerPort — the typed failure mapping (never empty-success)", () => {
  it("a fetch rejection answers network (offline/DNS/abort)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.reject(new TypeError("fetch failed")),
      async () => port.search("rain"),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "network", detail: expect.stringContaining("did not complete") },
    });
  });

  it("401/403 answer unauthorized", async () => {
    for (const status of [401, 403]) {
      const port = makePort();
      const { result } = await withFetchStub(
        () => json({ error: "no" }, status),
        async () => port.search("rain"),
      );
      expect(result).toMatchObject({ ok: false, failure: { kind: "unauthorized" } });
    }
  });

  it("5xx/408/429 answer unavailable", async () => {
    for (const status of [500, 502, 503, 504, 408, 429]) {
      const port = makePort();
      const { result } = await withFetchStub(
        () => json({ error: "no" }, status),
        async () => port.search("rain"),
      );
      expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
    }
  });

  it("404 answers unavailable (the ratified law) — EXCEPT metadata 404, the honest absence", async () => {
    const searchPort = makePort();
    const { result: searchOutcome } = await withFetchStub(
      () => json({ error: "gone" }, 404),
      async () => searchPort.search("rain"),
    );
    expect(searchOutcome).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const metadataPort = makePort();
    const { result: metadataOutcome } = await withFetchStub(
      () => json({ error: "no such ref" }, 404),
      async () => metadataPort.metadata("ref-404"),
    );
    // The ONE read whose type carries absence: null, not a failure.
    expect(metadataOutcome).toEqual({ ok: true, value: null });
  });

  it("other 4xx answer malformed", async () => {
    for (const status of [400, 409, 422]) {
      const port = makePort();
      const { result } = await withFetchStub(
        () => json({ error: "bad" }, status),
        async () => port.search("rain"),
      );
      expect(result).toMatchObject({ ok: false, failure: { kind: "malformed" } });
    }
  });

  it("a 2xx non-JSON body answers malformed", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => new Response("<html>not json</html>", { status: 200 }),
      async () => port.search("rain"),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "malformed", detail: expect.stringContaining("non-JSON") },
    });
  });

  it("a 2xx wrong-shaped payload answers malformed (a non-array search body)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ hits: "nope" }),
      async () => port.search("rain"),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "malformed" } });
  });

  it("individually malformed entries are skipped — the rest survive (documented)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json(SEARCH_HITS),
      async () => port.search("rain"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(2); // the broken hit never becomes a card
    expect(result.value[0]!.externalRef).toBe("ref-1");
  });

  it("a successful search answers the hits verbatim", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json(SEARCH_HITS),
      async () => port.search("rain"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(2);
  });
});

describe("R07 ServerPort — the shorts composition (frozen law, frozen transport)", () => {
  it("shorts filters the search transport through the frozen short-form eligibility", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json(SEARCH_HITS),
      async () => port.shorts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Neon Rain is vertical (short-form); Deep Field Diary is a 1-hour
    // horizontal video (long-form); the broken hit is skipped.
    expect(result.value.length).toBe(1);
    expect(result.value[0]!.title).toBe("Neon Rain");
  });

  it("shorts failures are typed (never a fake empty feed)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ error: "down" }, 503),
      async () => port.shorts(),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });
});

describe("R07 ServerPort — identity rides as headers, never in URLs", () => {
  it("every request carries the x-wfx-* identity headers", async () => {
    const port = makePort();
    const { calls } = await withFetchStub(
      () => json([]),
      async () => {
        await port.search("rain");
        await port.readLibrary();
      },
    );
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call.headers["x-wfx-user-id"]).toBe("wfx-anonymous");
      expect(call.headers["x-wfx-session-id"]).toBe("wfx-session-1");
      expect(call.headers["x-wfx-locale"]).toBe("en");
      expect(call.headers["x-wfx-region"]).toBe("EU");
      expect(call.url).not.toContain("wfx-anonymous");
      expect(call.url).not.toContain("wfx-session-1");
    }
  });

  it("the endpoint table matches the frozen transport (paths + methods + bodies)", async () => {
    const port = makePort();
    const { calls } = await withFetchStub(
      () => json([]),
      async () => {
        await port.search("rain");
        await port.metadata("ref-1");
        await port.resolve("ref-1");
        await port.readLibrary();
        await port.executeAction({ type: "like", connectorId: "c", externalRef: "r" });
        await port.writeLibrary({ op: "add", externalRef: "r" });
        await port.emitEvent({
          userId: "wfx-anonymous",
          itemId: "wfxitm_00000000000000000000000001",
          type: "start",
          occurredAt: "2026-01-01T00:00:00.000Z",
          sessionId: "wfx-session-1",
        });
      },
    );
    const byPath = (fragment: string) => calls.find((call) => call.url.includes(fragment));
    expect(byPath("/experience/search?query=rain")?.method).toBe("GET");
    expect(byPath("/experience/metadata?ref=ref-1")?.method).toBe("GET");
    expect(byPath("/experience/resolve?ref=ref-1")?.method).toBe("GET");
    expect(byPath("/experience/library")?.method).toBe("GET");
    expect(calls.filter((call) => call.url.endsWith("/experience/actions")).length).toBe(1);
    expect(calls.filter((call) => call.url.endsWith("/experience/events")).length).toBe(1);
    const libraryWrite = calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/experience/library"),
    );
    expect(libraryWrite).toBeDefined();
    expect(libraryWrite!.body).toContain('"op":"add"');
  });
});

describe("R07 ServerPort — the action/event honesty laws", () => {
  it("a transport failure on executeAction answers ok:false (the runtime settles failed — never success)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.reject(new TypeError("offline")),
      async () => port.executeAction({ type: "like", connectorId: "c", externalRef: "r" }),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "network" } });
  });

  it("a malformed ActionReceipt answers ok:false malformed (never a fabricated receipt)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ status: "confirmed", occurredAt: "not-a-date" }),
      async () => port.executeAction({ type: "like", connectorId: "c", externalRef: "r" }),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "malformed" } });
  });

  it("emitEvent transport failures answer ok:false — the EVENT SINK LAW", async () => {
    const port = makePort();
    const event = {
      userId: "wfx-anonymous",
      itemId: "wfxitm_00000000000000000000000001",
      type: "progress" as const,
      occurredAt: "2026-01-01T00:00:00.000Z",
      sessionId: "wfx-session-1",
      payload: { positionMs: 1_000 },
    };
    const { result } = await withFetchStub(
      () => json({ error: "down" }, 503),
      async () => port.emitEvent(event),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("a successful emitEvent answers ok:true void", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ ok: true }),
      async () =>
        port.emitEvent({
          userId: "wfx-anonymous",
          itemId: "wfxitm_00000000000000000000000001",
          type: "complete",
          occurredAt: "2026-01-01T00:00:00.000Z",
          sessionId: "wfx-session-1",
        }),
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("a metadata 200 with a usable SourceItem answers it; a malformed one is typed", async () => {
    const good = makePort();
    const { result: goodOutcome } = await withFetchStub(
      () =>
        json({
          connectorId: "conn-1",
          externalRef: "ref-1",
          title: "Neon Rain",
          availability: "available",
          capabilities: ["playEmbed"],
        }),
      async () => good.metadata("ref-1"),
    );
    expect(goodOutcome.ok).toBe(true);
    if (goodOutcome.ok) expect(goodOutcome.value?.title).toBe("Neon Rain");

    const bad = makePort();
    const { result: badOutcome } = await withFetchStub(
      () => json({ connectorId: "conn-1", externalRef: "ref-1", title: "No availability field" }),
      async () => bad.metadata("ref-1"),
    );
    expect(badOutcome).toMatchObject({ ok: false, failure: { kind: "malformed" } });
  });

  it("the serviceId is the stable binding identity", () => {
    expect(makePort().serviceId).toBe(WEB_SERVER_SERVICE_ID);
    expect(WEB_SERVER_SERVICE_ID).toBe("wfx-experience-service");
  });
});
