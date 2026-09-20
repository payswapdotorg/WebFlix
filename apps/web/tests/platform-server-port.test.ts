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

// ---------------------------------------------------------------------------
// The R02 profile extension (lead integration — the same laws the desktop
// adapter's R02 integration ratified): 404→unavailable honesty while the
// /experience/{history,intents,policy} endpoints land with R04/R05; payload
// guards; PUT/POST bodies; the profile-scoped library read.
// ---------------------------------------------------------------------------

const PROFILE_HISTORY = [
  { itemId: "wfxitm_a", positionMs: 1200, completed: false, lastEventType: "play", updatedAt: "2026-09-17T00:00:00.000Z" },
  { itemId: "wfxitm_b", positionMs: 0, completed: true, lastEventType: null, updatedAt: "2026-09-16T00:00:00.000Z" },
  { itemId: "", positionMs: 5, completed: false, lastEventType: null, updatedAt: "2026-09-16T00:00:00.000Z" },
];

const INTENTS = [
  { id: "wfxint_1", userId: "wfx-u1", objective: "cozy-comedy-tonight", weight: 1, confidence: 0.8, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", evidenceCount: 2 },
  { id: "bad-id", userId: "wfx-u1", objective: "broken", weight: 1, confidence: 0.5, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", evidenceCount: 1 },
];

const POLICY = {
  id: "wfxpol_1",
  userId: "wfx-u1",
  objectives: [{ id: "wfxobj_1", weight: 1, direction: "maximize" }],
  exploration: 0.4,
  novelty: 0.6,
  socialInfluence: 0.2,
  attentionMode: "balanced",
};

describe("R07 ServerPort — the R02 profile extension (lead integration)", () => {
  it("history 404 answers unavailable — never a fake empty history (the honesty law)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json({}, 404)),
      async () => port.readHistory(),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "unavailable", detail: expect.stringContaining("HTTP 404") },
    });
  });

  it("readHistory filters malformed entries — the usable ones survive", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json(PROFILE_HISTORY)),
      async () => port.readHistory(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(2);
  });

  it("readProfileLibrary reads the SAME /experience/library endpoint (the profile-scoped twin)", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => Promise.resolve(json([{ connectorId: "c", externalRef: "r", title: "T" }])),
      async () => port.readProfileLibrary(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(1);
    expect(calls[0]?.url).toContain("/experience/library");
  });

  it("readIntents filters malformed records (the wfxint_ prefix law)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json(INTENTS)),
      async () => port.readIntents(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(1);
  });

  it("writeIntent POSTs the command as JSON to /experience/intents", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => Promise.resolve(json({}, 204)),
      async () => port.writeIntent({ objective: "learn-rust", scope: "session" }),
    );
    expect(result.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/experience/intents");
    expect(calls[0]?.body ?? "").toContain("learn-rust");
  });

  it("readPolicy: null answers ok-null (no policy configured — not a failure)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json(null)),
      async () => port.readPolicy(),
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it("readPolicy guards the shape — a garbage policy answers malformed", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json({ exploration: "high" })),
      async () => port.readPolicy(),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "malformed" } });
  });

  it("readPolicy accepts the usable shape verbatim", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json(POLICY)),
      async () => port.readPolicy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value !== null) expect(result.value.attentionMode).toBe("balanced");
  });

  it("writePolicy PUTs the command as JSON to /experience/policy", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => Promise.resolve(json({}, 204)),
      async () => port.writePolicy({ attentionMode: "mindful" }),
    );
    expect(result.ok).toBe(true);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/experience/policy");
    expect(calls[0]?.body ?? "").toContain("mindful");
  });

  it("policy 404 answers unavailable — the surfaces land with R05, never faked", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => Promise.resolve(json({}, 404)),
      async () => port.readPolicy(),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "unavailable", detail: expect.stringContaining("HTTP 404") },
    });
  });
});

// ---------------------------------------------------------------------------
// R21-B — the transport completion: sources + model-controls + bearer auth
// ---------------------------------------------------------------------------

describe("R21-B — the sources read (GET /sources envelope)", () => {
  const SOURCE_ROW = {
    connectorId: "conn-1",
    displayName: "One Source",
    version: "1.0.0",
    authMode: "oauth",
    capabilities: {
      identity: false, catalogSearch: true, metadata: true, playNative: false,
      playEmbed: true, playBrowser: true, playExternal: true, availability: true,
      libraryRead: false, libraryWrite: false, like: false, save: false,
      follow: false, comment: false, download: false, transform: false,
    },
    authState: "signedIn",
    requiresAuthorization: true,
    connected: true,
    accountId: "acct-1",
    authorizedAt: "2026-09-18T12:00:00.000Z",
    lastStateChange: "2026-09-18T12:00:00.000Z",
    expiresAt: null,
    availabilityNotes: [],
    lastChecked: "2026-09-18T12:00:00.000Z",
  };

  it("reads GET /sources, unwraps the { authenticated, sources } envelope", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => json({ authenticated: true, sources: [SOURCE_ROW] }),
      async () => port.readSources?.(),
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/sources");
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.connectorId).toBe("conn-1");
    }
  });

  it("the anonymous envelope answers the honest empty list (never a fabricated source)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ authenticated: false, sources: [] }),
      async () => port.readSources?.(),
    );
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.value).toHaveLength(0);
  });

  it("a malformed envelope answers the typed malformed failure; malformed rows are skipped", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ authenticated: true, sources: "nope" }),
      async () => port.readSources?.(),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "malformed", detail: expect.stringContaining("sources") },
    });

    const port2 = makePort();
    const { result: result2 } = await withFetchStub(
      () => json({ authenticated: true, sources: [{ garbage: true }, SOURCE_ROW] }),
      async () => port2.readSources?.(),
    );
    expect(result2).toMatchObject({ ok: true });
    if (result2?.ok) expect(result2.value).toHaveLength(1);
  });

  it("a 5xx sources read answers unavailable (an ERROR state, never a fake empty list)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ ok: false }, 502),
      async () => port.readSources?.(),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });
});

describe("R21-B — the model-controls transport (model-policy, providers, byom, transforms)", () => {
  const POLICY = {
    task: "translation",
    fallbackProviders: ["wfx-first-party"],
    privacy: "local-only",
  };
  const PROVIDER_ROW = {
    id: "wfx-first-party",
    privacy: "local",
    capabilities: ["translation", "summary"],
    byomBound: false,
    costs: { translation: 0 },
    availability: "available",
  };
  const BYOM_HANDLE = {
    id: "binding-1",
    providerId: "openai-compatible",
    endpointUrl: "https://models.example/v1",
    keyId: "key_1",
    metadata: null,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  };
  const OPERATION = {
    id: "wfxtx_00000000000000000000000001",
    kind: "translation",
    targetRef: "conn-1:ref-1",
    options: {},
    state: "queued",
    progress: null,
    resultRef: null,
    errorDetail: null,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  };

  it("readModelPolicy GETs ?task= and answers the policy; the honest null stays null", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => json(POLICY),
      async () => port.readModelPolicy?.("translation"),
    );
    expect(calls[0]?.url).toContain("/experience/model-policy?task=translation");
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.value?.privacy).toBe("local-only");

    const port2 = makePort();
    const { result: result2 } = await withFetchStub(
      () => json(null),
      async () => port2.readModelPolicy?.("translation"),
    );
    expect(result2).toMatchObject({ ok: true, value: null });
  });

  it("writeModelPolicy PUTs the command JSON", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => json({}, 204),
      async () =>
        port.writeModelPolicy?.({
          task: "translation",
          fallbackProviders: ["wfx-first-party"],
          privacy: "local-only",
        }),
    );
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/experience/model-policy");
    expect(calls[0]?.body ?? "").toContain("translation");
    expect(result?.ok).toBe(true);
  });

  it("a malformed model policy answers the typed malformed failure (never fake data)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ task: "not-a-task", fallbackProviders: [], privacy: "nope" }),
      async () => port.readModelPolicy?.("translation"),
    );
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "malformed", detail: expect.stringContaining("ModelPolicy") },
    });
  });

  it("readModelProviders answers the registry rows; malformed rows are skipped", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json([{ junk: true }, PROVIDER_ROW]),
      async () => port.readModelProviders?.(),
    );
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.id).toBe("wfx-first-party");
    }
  });

  it("bindByomProvider PUTs to the provider-addressed byom route; the handle is secret-free", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => json(BYOM_HANDLE),
      async () =>
        port.bindByomProvider?.({
          providerId: "openai-compatible",
          endpointUrl: "https://models.example/v1",
          key: "secret-key",
        }),
    );
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/experience/model-providers/byom/openai-compatible");
    expect(calls[0]?.body ?? "").toContain("secret-key"); // the key rides the request body (sealed server-side)
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) {
      expect(JSON.stringify(result.value)).not.toContain("secret-key"); // NEVER in the answer
    }
  });

  it("unbindByomProvider DELETEs the provider route; 204 answers ok", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => new Response(null, { status: 204 }),
      async () => port.unbindByomProvider?.("openai-compatible"),
    );
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/experience/model-providers/byom/openai-compatible");
    expect(result?.ok).toBe(true);
  });

  it("submitTransform POSTs the command; the queued operation answers with its typed state", async () => {
    const port = makePort();
    const { calls, result } = await withFetchStub(
      () => json(OPERATION),
      async () => port.submitTransform?.({ kind: "translation", input: { ref: "conn-1:ref-1" } }),
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/experience/transforms");
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.value.state).toBe("queued");
  });

  it("readTransform unwraps the { operation, history } envelope; 404 answers unavailable", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ operation: OPERATION, history: [] }),
      async () => port.readTransform?.("wfxtx_00000000000000000000000001"),
    );
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.value.id).toBe("wfxtx_00000000000000000000000001");

    const port2 = makePort();
    const { result: result2 } = await withFetchStub(
      () => json({ error: "not-found" }, 404),
      async () => port2.readTransform?.("wfxtx_00000000000000000000000001"),
    );
    expect(result2).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("cancelTransform POSTs to the cancel route; clearTransformResult DELETEs the operation", async () => {
    const port = makePort();
    const cancelled = { ...OPERATION, state: "cancelled" as const };
    const { calls, result } = await withFetchStub(
      () => json(cancelled),
      async () => port.cancelTransform?.("wfxtx_00000000000000000000000001"),
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/experience/transforms/wfxtx_00000000000000000000000001/cancel");
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.value.state).toBe("cancelled");

    const cleared = { ...OPERATION, state: "succeeded" as const, resultRef: null };
    const { calls: calls2, result: result2 } = await withFetchStub(
      () => json(cleared),
      async () => port.clearTransformResult?.("wfxtx_00000000000000000000000001"),
    );
    expect(calls2[0]?.method).toBe("DELETE");
    expect(calls2[0]?.url).toContain("/experience/transforms/wfxtx_00000000000000000000000001");
    expect(result2).toMatchObject({ ok: true });
  });

  it("every model-controls failure maps to the typed kinds (unauthorized on 401, unavailable on 502)", async () => {
    const port = makePort();
    const { result } = await withFetchStub(
      () => json({ error: "invalid-credentials" }, 401),
      async () => port.readModelProviders?.(),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unauthorized" } });

    const port2 = makePort();
    const { result: result2 } = await withFetchStub(
      () => json({ ok: false }, 502),
      async () => port2.submitTransform?.({ kind: "translation", input: {} }),
    );
    expect(result2).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });
});

describe("R21-B — the authenticated session's bearer channel", () => {
  it("an authToken option stamps Authorization: Bearer on every request", async () => {
    const port = makePort({ authToken: "wfxsess_token123" });
    const { calls } = await withFetchStub(
      () => json([]),
      async () => port.search("rain"),
    );
    expect(calls[0]?.headers["authorization"]).toBe("Bearer wfxsess_token123");
    // Identity still rides the frozen headers (never in URLs).
    expect(calls[0]?.url).not.toContain("wfxsess_token123");
    expect(calls[0]?.headers["x-wfx-user-id"]).toBe("wfx-anonymous");
  });

  it("an empty/whitespace authToken sends NO authorization header (the honest anonymous channel)", async () => {
    const port = makePort({ authToken: "   " });
    const { calls } = await withFetchStub(
      () => json([]),
      async () => port.search("rain"),
    );
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
  });
});
