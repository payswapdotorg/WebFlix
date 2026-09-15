/**
 * WFX-050 remote service ports tests (bun:test).
 *
 * Proves the production transport against a STUBBED fetch: endpoint
 * mapping, identity headers, the WFX-003 degrade law for reads, failed
 * receipts for actions, the typed `HostTransportError` for the event sink,
 * payload guarding, and the canonical shape of generated ids.
 *
 * Deterministic: the fetch stub answers from fixtures; the clock and id
 * source are injected (fixed clock, sequential ids). No network.
 */

import { describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import { createRemotePorts, CryptoUlidGen, isUlidBody, REMOTE_CONNECTOR_ID } from "../src/host/remote-ports";

const ctx = {
  userId: "wfx-remote-test-user",
  sessionId: "wfx-remote-test-session",
  locale: "en-US",
  region: "US",
};

/** One recorded stub request. */
interface RecordedRequest {
  url: string;
  init: RequestInit;
}

/** A stub fetch that answers scripted responses per URL path. */
function stubFetch(
  script: Record<string, { status?: number; body: unknown } | { reject: string }>,
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init: init ?? {} });
    const path = new URL(url).pathname;
    const scripted = script[path];
    if (scripted === undefined) {
      return new Response(JSON.stringify({ error: `no script for ${path}` }), { status: 500 });
    }
    if ("reject" in scripted) {
      throw new Error(scripted.reject);
    }
    return new Response(JSON.stringify(scripted.body), { status: scripted.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function buildPorts(script: Record<string, { status?: number; body: unknown } | { reject: string }>) {
  const stub = stubFetch(script);
  const ports = createRemotePorts({
    apiBase: new URL("https://experience.example.com"),
    fetchImpl: stub.fetchImpl,
    clock: new FixedClock(1_800_000_000_000),
    ids: new SequentialIdGen(),
  });
  return { ports, requests: stub.requests };
}

describe("WFX-050 remote ports (split-runtime service consumption)", () => {
  it("search hits GET /experience/search?query=… with identity headers and parses results", async () => {
    const { ports, requests } = buildPorts({
      "/experience/search": {
        body: [
          {
            connectorId: "wfx-experience-service",
            externalRef: "yt:abc",
            title: "Service Hit",
            canonicalType: "video",
            durationMs: 600_000,
            orientation: "horizontal",
          },
          { garbage: true }, // malformed hit — dropped, never surfaced
        ],
      },
    });
    const hits = await ports.connector.search(ctx, "service hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Service Hit");
    const request = requests[0];
    expect(request).toBeDefined();
    const url = new URL(request?.url ?? "");
    expect(url.pathname).toBe("/experience/search");
    expect(url.searchParams.get("query")).toBe("service hit");
    const headers = new Headers(request?.init?.headers as HeadersInit | undefined);
    expect(headers.get("x-wfx-user-id")).toBe(ctx.userId);
    expect(headers.get("x-wfx-session-id")).toBe(ctx.sessionId);
    expect(headers.get("x-wfx-locale")).toBe(ctx.locale);
    expect(headers.get("x-wfx-region")).toBe(ctx.region);
  });

  it("read failures degrade to the empty answer (HTTP 500, network error, non-array)", async () => {
    const failing = buildPorts({ "/experience/search": { status: 500, body: { error: "boom" } } });
    await expect(failing.ports.connector.search(ctx, "q")).resolves.toEqual([]);

    const offline = buildPorts({ "/experience/search": { reject: "connection refused" } });
    await expect(offline.ports.connector.search(ctx, "q")).resolves.toEqual([]);

    const malformed = buildPorts({ "/experience/search": { body: { not: "an array" } } });
    await expect(malformed.ports.connector.search(ctx, "q")).resolves.toEqual([]);
  });

  it("metadata answers the item, null for null, and degrades on failure", async () => {
    const ok = buildPorts({
      "/experience/metadata": {
        body: {
          connectorId: REMOTE_CONNECTOR_ID,
          externalRef: "yt:abc",
          title: "Service Item",
          availability: "available",
          capabilities: ["playEmbed"],
        },
      },
    });
    const item = await ok.ports.connector.metadata(ctx, "yt:abc");
    expect(item?.title).toBe("Service Item");

    const absent = buildPorts({ "/experience/metadata": { body: null } });
    await expect(absent.ports.connector.metadata(ctx, "yt:gone")).resolves.toBeNull();

    const broken = buildPorts({ "/experience/metadata": { status: 503, body: {} } });
    await expect(broken.ports.connector.metadata(ctx, "yt:abc")).resolves.toBeNull();
  });

  it("resolve returns only realizations that pass the frozen validator", async () => {
    const { ports } = buildPorts({
      "/experience/resolve": {
        body: [
          {
            mode: "embed",
            connectorId: REMOTE_CONNECTOR_ID,
            externalRef: "yt:abc",
            url: "https://example.invalid/embed",
            capabilities: ["playEmbed"],
          },
          { mode: "nonsense", connectorId: REMOTE_CONNECTOR_ID }, // invalid — dropped
        ],
      },
    });
    const realizations = await ports.connector.resolve(ctx, "yt:abc");
    expect(realizations).toHaveLength(1);
    expect(realizations[0]?.mode).toBe("embed");
  });

  it("executeAction answers failed receipts with the transport detail — never fake success", async () => {
    const offline = buildPorts({ "/experience/actions": { reject: "network unreachable" } });
    const receipt = await offline.ports.connector.executeAction(ctx, {
      type: "like",
      connectorId: REMOTE_CONNECTOR_ID,
      externalRef: "yt:abc",
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("POST");
    expect(receipt.detail).toContain("network unreachable");
    expect(receipt.occurredAt).toBe(new Date(1_800_000_000_000).toISOString()); // injected clock

    const malformed = buildPorts({ "/experience/actions": { body: { status: "confirmed" } } });
    const badReceipt = await malformed.ports.connector.executeAction(ctx, {
      type: "like",
      connectorId: REMOTE_CONNECTOR_ID,
      externalRef: "yt:abc",
    });
    expect(badReceipt.status).toBe("failed"); // malformed receipt is never trusted
  });

  it("library reads parse valid entries and drop malformed ones; failures degrade to []", async () => {
    const ok = buildPorts({
      "/experience/library": {
        body: [
          {
            connectorId: REMOTE_CONNECTOR_ID,
            externalRef: "yt:abc",
            title: "Saved Thing",
            addedAt: "2026-09-13T00:00:00.000Z",
          },
          { connectorId: REMOTE_CONNECTOR_ID }, // missing required fields — dropped
        ],
      },
    });
    const entries = await ok.ports.connector.readLibrary?.(ctx) ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Saved Thing");

    const offline = buildPorts({ "/experience/library": { reject: "dns failure" } });
    await expect(offline.ports.connector.readLibrary?.(ctx) ?? []).resolves.toEqual([]);
  });

  it("the event sink THROWS the typed HostTransportError on transport failure — never silent", async () => {
    const { ports } = buildPorts({ "/experience/events": { status: 503, body: {} } });
    let thrown: unknown;
    try {
      await ports.events.emit({
        userId: ctx.userId,
        itemId: "wfxitm_00000000000000000000000001",
        type: "start",
        occurredAt: "2026-09-13T00:00:00.000Z",
        sessionId: ctx.sessionId,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("HostTransportError");
    expect((thrown as Error).message).toContain("events.emit");
    expect((thrown as Error).message).toContain("503");
  });

  it("the descriptor names the service, not a provider, and declares the transport surface", () => {
    const { ports } = buildPorts({});
    const descriptor = ports.connector.descriptor();
    expect(descriptor.id).toBe(REMOTE_CONNECTOR_ID);
    expect(descriptor.displayName).toContain("experience.example.com");
    expect(descriptor.capabilities).toContain("catalogSearch");
    expect(descriptor.auth).toBe("none");
  });

  it("the production id source mints canonical, unique ULID bodies", () => {
    const gen = new CryptoUlidGen();
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const body = gen.next();
      expect(isUlidBody(body)).toBeTrue();
      seen.add(body);
    }
    expect(seen.size).toBe(200);
  });

  it("the clock and ids are the INJECTED seams — no hidden sources", () => {
    const { ports } = buildPorts({});
    expect(ports.clock.now()).toBe(1_800_000_000_000); // the injected FixedClock
    expect(ports.ids.next()).toBe("00000000000000000000000000"); // the injected SequentialIdGen
  });
});
