/**
 * R08 — the desktop ServerPort over the frozen WFX_API_BASE transport
 * (stubbed fetch; no network).
 *
 * The endpoint mapping, the identity-in-headers law (never in URLs), the
 * payload guards, and the R01 typed failure semantics: reads answer
 * `ok: false` with the typed kind (never silent empty answers); the event
 * sink answers its failure (the at-least-once law); malformed receipts
 * answer malformed failures.
 */

import { describe, expect, it } from "bun:test";

import type { EntertainmentEvent } from "@wfx/domain";

import { createDesktopServerPort, DESKTOP_SERVICE_CONNECTOR_ID } from "../src/platform/server-port";

const CONTEXT = {
  userId: "wfx-desktop-user",
  sessionId: "wfx-desktop-session",
  locale: "en",
  region: "EU",
};

const BASE = new URL("https://experience.webflix.invalid/api");

/** One captured request the stub fetch saw. */
interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** The scriptable stub fetch: deterministic, offline. */
class StubFetch {
  readonly requests: CapturedRequest[] = [];
  private scripted: { readonly match: (url: string) => boolean; readonly respond: () => Response | Promise<Response> }[] = [];

  script(match: (url: string) => boolean, respond: () => Response | Promise<Response>): void {
    this.scripted.push({ match, respond });
  }

  fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const headerEntries = Object.entries(((init?.headers ?? {}) as Record<string, string>));
    for (const [key, value] of headerEntries) headers[key] = value;
    this.requests.push({ method: init?.method ?? "GET", url, headers, body: init?.body as string | undefined });
    // The MOST RECENT matching script wins (tests re-script endpoints).
    for (let index = this.scripted.length - 1; index >= 0; index -= 1) {
      const entry = this.scripted[index]!;
      if (entry.match(url)) return Promise.resolve(entry.respond());
    }
    return Promise.reject(new TypeError("stub fetch: no scripted response (offline)"));
  };

  last(): CapturedRequest {
    const last = this.requests[this.requests.length - 1];
    if (last === undefined) throw new Error("stub fetch captured no requests");
    return last;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function searchHit(): Record<string, unknown> {
  return {
    connectorId: "wfx-experience-service",
    externalRef: "provider:42",
    title: "The Signal",
    canonicalType: "movie",
    durationMs: 5_400_000,
  };
}

function realization(mode: string): Record<string, unknown> {
  return { mode, connectorId: "wfx-experience-service", capabilities: ["playNative"] };
}

describe("R08 — the desktop server port (the frozen WFX_API_BASE mapping)", () => {
  it("search hits the frozen endpoint with the query; identity rides as headers, never in URLs", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/search"), () => jsonResponse([searchHit()]));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.search("signal");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
    const request = stub.last();
    expect(request.method).toBe("GET");
    expect(request.url).toBe("https://experience.webflix.invalid/api/experience/search?query=signal");
    // Identity in HEADERS, never in URLs:
    expect(request.url).not.toContain("wfx-desktop-user");
    expect(request.headers["x-wfx-user-id"]).toBe(CONTEXT.userId);
    expect(request.headers["x-wfx-session-id"]).toBe(CONTEXT.sessionId);
    expect(request.headers["x-wfx-locale"]).toBe("en");
    expect(request.headers["x-wfx-region"]).toBe("EU");
    expect(port.serviceId).toBe(`${DESKTOP_SERVICE_CONNECTOR_ID}@${BASE.origin}`);
  });

  it("the shorts operation maps to its endpoint (the provisional R07-ratification row)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/shorts"), () => jsonResponse([searchHit()]));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.shorts("vertical");
    expect(result.ok).toBe(true);
    expect(stub.last().url).toContain("/experience/shorts?query=vertical");
    const curated = await port.shorts();
    expect(curated.ok).toBe(true);
    expect(stub.last().url).toContain("/experience/shorts");
    expect(stub.last().url).not.toContain("query=");
  });

  it("metadata and resolve map to their frozen endpoints; null metadata is honest absence", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/metadata"), () => jsonResponse(null));
    stub.script((url) => url.includes("/experience/resolve"), () => jsonResponse([realization("native"), realization("browser")]));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const missing = await port.metadata("provider:missing");
    expect(missing).toEqual({ ok: true, value: null });
    const realizations = await port.resolve("provider:42");
    expect(realizations.ok).toBe(true);
    if (realizations.ok) {
      expect(realizations.value.map((entry) => entry.mode)).toEqual(["native", "browser"]);
    }
    expect(stub.last().url).toContain("/experience/resolve?ref=provider%3A42");
  });

  it("malformed elements are filtered, malformed envelopes answer the typed malformed failure", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/search"), () => jsonResponse([{ garbage: true }, searchHit()]));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.search("signal");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Garbage never becomes a card; the usable hit survives.
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.title).toBe("The Signal");
    }
    stub.script((url) => url.includes("/experience/search"), () => jsonResponse({ not: "an array" }));
    const envelope = await port.search("signal");
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.failure.kind).toBe("malformed");
      expect(envelope.failure.detail).toContain("non-array");
    }
  });

  it("a transport failure answers the typed network failure (never a silent empty answer)", async () => {
    const stub = new StubFetch(); // nothing scripted: fetch rejects (offline)
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.search("signal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("network");
      expect(result.failure.detail).toContain("did not complete");
    }
  });

  it("HTTP 401/403 answer unauthorized; HTTP 5xx answer unavailable", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/search"), () => jsonResponse({ error: "auth" }, 401));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const unauthorized = await port.search("signal");
    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) expect(unauthorized.failure.kind).toBe("unauthorized");

    stub.script((url) => url.includes("/experience/search"), () => jsonResponse({ error: "boom" }, 503));
    const unavailable = await port.search("signal");
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.failure.kind).toBe("unavailable");
  });

  it("a non-JSON body answers the typed malformed failure", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/search"), () => new Response("<html>not json</html>", { status: 200 }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.search("signal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed");
      expect(result.failure.detail).toContain("non-JSON");
    }
  });

  it("executeAction posts the action JSON and answers a usable receipt", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/actions"), () => jsonResponse({ status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.executeAction({
      actionId: "wfxact_00000000000000000000000001",
      kind: "like",
      itemId: "wfxitm_0000000000000000000000ABCD",
      occurredAt: "2026-09-16T00:00:00.000Z",
    } as never);
    expect(result.ok).toBe(true);
    const request = stub.last();
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.body).toContain("like");
  });

  it("a malformed receipt answers the typed malformed failure (never a fabricated success)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/actions"), () => jsonResponse({ status: "wat" }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.executeAction({ kind: "like" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed");
      expect(result.failure.detail).toContain("malformed ActionReceipt");
    }
  });

  it("library read/write map to their frozen endpoints", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/library"), () => {
      if (stub.last()?.method === "POST") return jsonResponse({ status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" });
      return jsonResponse([
        {
          connectorId: "wfx-experience-service",
          externalRef: "provider:42",
          title: "The Signal",
          addedAt: "2026-09-16T00:00:00.000Z",
        },
      ]);
    });
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const read = await port.readLibrary();
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toHaveLength(1);
    const write = await port.writeLibrary({ kind: "save", itemId: "wfxitm_0000000000000000000000ABCD", externalRef: "provider:42" } as never);
    expect(write.ok).toBe(true);
  });

  it("THE EVENT SINK LAW: a failed emit answers ok:false (the runtime keeps the event pending)", async () => {
    const stub = new StubFetch(); // nothing scripted: offline
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const event: EntertainmentEvent = {
      userId: CONTEXT.userId,
      itemId: "wfxitm_0000000000000000000000ABCD",
      type: "progress",
      occurredAt: "2026-09-16T00:00:00.000Z",
      sessionId: CONTEXT.sessionId,
      payload: { positionMs: 42_000 },
    };
    const result = await port.emitEvent(event);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("network");
    // And the successful path posts the event JSON with identity headers.
    stub.script((url) => url.includes("/experience/events"), () => jsonResponse({ accepted: true }));
    const accepted = await port.emitEvent(event);
    expect(accepted.ok).toBe(true);
    expect(stub.last().body).toContain("progress");
    expect(stub.last().headers["x-wfx-user-id"]).toBe(CONTEXT.userId);
  });

  // — the R02 profile extension (lead integration completion) —

  it("readProfileLibrary maps the SAME library endpoint (session profile scoping is server-side)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/library"), () =>
      jsonResponse([{ connectorId: "test-connector", externalRef: "ref-1", title: "A saved thing" }]),
    );
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readProfileLibrary();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
    expect(stub.last().url).toBe("https://experience.webflix.invalid/api/experience/library");
  });

  it("readHistory on a 404 answers typed unavailable — never a fake empty history", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/history"), () => new Response("Not Found", { status: 404 }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readHistory();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unavailable");
      expect(result.failure.detail).toContain("HTTP 404");
    }
  });

  it("readHistory filters malformed entries and keeps the honest ones (garbage never becomes history)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/history"), () =>
      jsonResponse([
        {
          itemId: "wfxitm_0000000000000000000000ABCD",
          positionMs: 61_000,
          completed: false,
          lastEventType: "progress",
          updatedAt: "2026-09-16T00:00:00.000Z",
        },
        { itemId: 42, positionMs: -1, completed: "yes" }, // garbage — filtered
      ]),
    );
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readHistory();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("readIntents guards the frozen intent shape (wfxint_ ids, finite dials)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/intents"), () =>
      jsonResponse([
        {
          id: "wfxint_01ARZ3NDEKF1XTVRE000000001",
          userId: CONTEXT.userId,
          scope: "persistent",
          objective: "cozy-comedy-tonight",
          weight: 1,
          confidence: 0.9,
          provenance: "explicit",
          createdAt: "2026-09-16T00:00:00.000Z",
          updatedAt: "2026-09-16T00:00:00.000Z",
          evidenceCount: 1,
        },
        { id: "not-an-intent", objective: "" }, // garbage — filtered
      ]),
    );
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readIntents();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("writeIntent posts the command JSON to the intents endpoint", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/intents"), () => jsonResponse({ accepted: true }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.writeIntent({
      objective: "cozy-comedy-tonight",
      scope: "persistent",
    });
    expect(result.ok).toBe(true);
    expect(stub.last().method).toBe("POST");
    expect(stub.last().body).toContain("cozy-comedy-tonight");
  });

  it("readPolicy answers null when unset; validates the frozen shape when present; 404 is typed unavailable", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/policy"), () => jsonResponse(null));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const unset = await port.readPolicy();
    expect(unset.ok).toBe(true);
    if (unset.ok) expect(unset.value).toBeNull();

    stub.script(
      (url) => url.includes("/experience/policy"),
      () =>
        jsonResponse({
          id: "wfxpol_01ARZ3NDEKF1XTVRE000000001",
          userId: CONTEXT.userId,
          objectives: [],
          exploration: 0.2,
          novelty: 0.3,
          socialInfluence: 0.1,
          attentionMode: "balanced",
        }),
    );
    const set = await port.readPolicy();
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.value?.attentionMode).toBe("balanced");

    stub.script((url) => url.includes("/experience/policy"), () => new Response("Not Found", { status: 404 }));
    const missing = await port.readPolicy();
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.failure.kind).toBe("unavailable");
  });

  it("writePolicy PUTs the command JSON to the policy endpoint", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/policy"), () => jsonResponse({ accepted: true }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.writePolicy({ attentionMode: "mindful" });
    expect(result.ok).toBe(true);
    expect(stub.last().method).toBe("PUT");
    expect(stub.last().body).toContain("mindful");
  });
});

// ---------------------------------------------------------------------------
// R21-B — the desktop transport completion (sources + model controls)
// ---------------------------------------------------------------------------

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

const MODEL_POLICY = {
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

describe("R21-B — the desktop transport completion (sources + model controls)", () => {
  it("readSources maps GET /sources and unwraps the { authenticated, sources } envelope", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/sources"), () => jsonResponse({ authenticated: true, sources: [SOURCE_ROW] }));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readSources?.();
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.connectorId).toBe("conn-1");
    }
    const request = stub.last();
    expect(request.url).toContain("/sources");
    // Malformed rows are skipped (garbage never becomes a source card):
    stub.script((url) => url.includes("/sources"), () => jsonResponse({ authenticated: true, sources: [{ junk: true }, SOURCE_ROW] }));
    const port2 = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result2 = await port2.readSources?.();
    expect(result2).toMatchObject({ ok: true });
    if (result2?.ok) expect(result2.value).toHaveLength(1);
  });

  it("a 5xx sources read answers the typed unavailable (an ERROR state, never a fake empty list)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/sources"), () => jsonResponse({ ok: false }, 502));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readSources?.();
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("readModelPolicy GETs ?task=; the honest null stays null; malformed answers typed", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/model-policy"), () => jsonResponse(MODEL_POLICY));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readModelPolicy?.("translation");
    expect(result).toMatchObject({ ok: true });
    if (result?.ok) expect(result.value?.privacy).toBe("local-only");
    expect(stub.last().url).toContain("/experience/model-policy?task=translation");

    stub.script((url) => url.includes("/experience/model-policy"), () => jsonResponse(null));
    const port2 = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const nullResult = await port2.readModelPolicy?.("translation");
    expect(nullResult).toMatchObject({ ok: true, value: null });

    stub.script((url) => url.includes("/experience/model-policy"), () => jsonResponse({ task: "bogus" }));
    const port3 = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const malformed = await port3.readModelPolicy?.("translation");
    expect(malformed).toMatchObject({ ok: false, failure: { kind: "malformed" } });
  });

  it("writeModelPolicy PUTs the command; readModelProviders answers guarded rows", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/model-policy"), () => jsonResponse({}, 204));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const write = await port.writeModelPolicy?.({
      task: "translation",
      fallbackProviders: ["wfx-first-party"],
      privacy: "local-only",
    });
    expect(write?.ok).toBe(true);
    expect(stub.last().method).toBe("PUT");

    stub.script((url) => url.includes("/experience/model-providers"), () => jsonResponse([{ junk: true }, PROVIDER_ROW]));
    const providers = await port.readModelProviders?.();
    expect(providers).toMatchObject({ ok: true });
    if (providers?.ok) expect(providers.value).toHaveLength(1);
  });

  it("bindByomProvider PUTs the provider-addressed route; unbind DELETEs (204 = ok)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/model-providers/byom/openai-compatible"), () => jsonResponse(BYOM_HANDLE));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const bind = await port.bindByomProvider?.({
      providerId: "openai-compatible",
      endpointUrl: "https://models.example/v1",
      key: "secret-key",
    });
    expect(bind).toMatchObject({ ok: true });
    if (bind?.ok) {
      expect(JSON.stringify(bind.value)).not.toContain("secret-key"); // the handle is secret-free
    }
    const bindRequest = stub.last();
    expect(bindRequest.method).toBe("PUT");
    expect(bindRequest.url).toContain("/experience/model-providers/byom/openai-compatible");
    expect(bindRequest.body ?? "").toContain("secret-key"); // the key rides the request (sealed server-side)

    stub.script((url) => url.includes("/experience/model-providers/byom/openai-compatible"), () => new Response(null, { status: 204 }));
    const unbind = await port.unbindByomProvider?.("openai-compatible");
    expect(unbind?.ok).toBe(true);
    expect(stub.last().method).toBe("DELETE");
  });

  it("the transform lifecycle maps typed (submit POST, read envelope GET, cancel POST, clear DELETE)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.endsWith("/experience/transforms"), () => jsonResponse(OPERATION));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const submitted = await port.submitTransform?.({ kind: "translation", input: { ref: "r" } });
    expect(submitted).toMatchObject({ ok: true, value: { state: "queued" } });
    expect(stub.last().method).toBe("POST");

    stub.script((url) => url.includes("/experience/transforms/"), () => jsonResponse({ operation: OPERATION, history: [] }));
    const read = await port.readTransform?.("wfxtx_00000000000000000000000001");
    expect(read).toMatchObject({ ok: true });
    if (read?.ok) expect(read.value.id).toBe("wfxtx_00000000000000000000000001");

    stub.script((url) => url.includes("/cancel"), () => jsonResponse({ ...OPERATION, state: "cancelled" }));
    const cancelled = await port.cancelTransform?.("wfxtx_00000000000000000000000001");
    expect(cancelled).toMatchObject({ ok: true, value: { state: "cancelled" } });
    expect(stub.last().method).toBe("POST");
    expect(stub.last().url).toContain("/cancel");

    stub.script((url) => url.includes("/experience/transforms/"), () => jsonResponse({ ...OPERATION, state: "succeeded", resultRef: null }));
    const cleared = await port.clearTransformResult?.("wfxtx_00000000000000000000000001");
    expect(cleared).toMatchObject({ ok: true });
    expect(stub.last().method).toBe("DELETE");
  });

  it("a 404 transform read answers the typed unavailable (the honest miss)", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.includes("/experience/transforms/"), () => jsonResponse({ error: "not-found" }, 404));
    const port = createDesktopServerPort({ apiBase: BASE, context: CONTEXT, fetchImpl: stub.fetch });
    const result = await port.readTransform?.("wfxtx_missing");
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });
});
