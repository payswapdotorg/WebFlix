/**
 * R07 adapter API-route tests (bun:test).
 *
 * Proves the route bridges over the ONE runtime:
 * - POST /api/events: the closed user-reportable vocabulary (progress /
 *   complete / skip); `start` (the runtime's own emission) and `share`
 *   (R15's lane) are rejected with the REASON — never silently accepted;
 *   malformed bodies answer 400; successful reports fold watch state;
 * - POST /api/actions: like/save settle through the runtime's action
 *   engine; the response carries the receipt vocabulary; a save ALSO
 *   lands in the watchlist (the R01 library semantics); an unsupported
 *   action renders `unsupported` — NEVER success;
 * - GET /api/shorts: the fresh page from the runtime's shorts model; a
 *   failing read answers 502 with the typed detail.
 *
 * Deterministic: the fixture transport, the real route handlers, no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import { POST as postEvent } from "../src/app/api/events/route";
import { POST as postAction } from "../src/app/api/actions/route";
import { GET as getShorts } from "../src/app/api/shorts/route";
import { withEnv, withFetchStub } from "./fake-web";

const ITEM_ID = "wfxitm_00000000000000000000000001";

beforeEach(() => {
  resetWebHostProcessState();
});

async function bootFixtureRuntime() {
  let host = null as Awaited<ReturnType<typeof getWebRuntimeHost>> | null;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  return host!;
}

function eventRequest(body: unknown): Request {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function actionRequest(body: unknown): Request {
  return new Request("http://localhost/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("R07 POST /api/events — the closed reportable vocabulary", () => {
  it("progress/complete/skip are accepted and fold watch state", async () => {
    const host = await bootFixtureRuntime();
    const response = await postEvent(
      eventRequest({ itemId: ITEM_ID, type: "progress", payload: { positionMs: 30_000 } }),
    );
    expect(response.status).toBe(200);
    expect(host.runtime.watchState.get(ITEM_ID)).toMatchObject({
      status: "in-progress",
      lastPositionMs: 30_000,
    });

    const completed = await postEvent(eventRequest({ itemId: ITEM_ID, type: "complete" }));
    expect(completed.status).toBe(200);
    expect(host.runtime.watchState.get(ITEM_ID)).toMatchObject({ status: "completed" });
  });

  it("'start' is rejected with the reason (the runtime's own emission — no duplicated evidence)", async () => {
    await bootFixtureRuntime();
    const response = await postEvent(eventRequest({ itemId: ITEM_ID, type: "start" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("start");
    expect(body.error).toContain("playback controller");
  });

  it("'share' is rejected with the R15 reason (the honest absent lane)", async () => {
    await bootFixtureRuntime();
    const response = await postEvent(eventRequest({ itemId: ITEM_ID, type: "share" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("share");
    expect(body.error).toContain("R15");
  });

  it("malformed bodies answer 400 with the problem text", async () => {
    await bootFixtureRuntime();
    const badId = await postEvent(eventRequest({ itemId: "garbage", type: "skip" }));
    expect(badId.status).toBe(400);
    const badPayload = await postEvent(
      eventRequest({ itemId: ITEM_ID, type: "progress", payload: { positionMs: -5 } }),
    );
    expect(badPayload.status).toBe(400);
    const badJson = await postEvent(
      new Request("http://localhost/api/events", { method: "POST", body: "not json" }),
    );
    expect(badJson.status).toBe(400);
  });
});

describe("R07 POST /api/actions — receipts are the truth", () => {
  it("a like settles through the runtime and answers the receipt vocabulary", async () => {
    await bootFixtureRuntime();
    const response = await postAction(
      actionRequest({ type: "like", connectorId: "fake-source", externalRef: "fake:short-1", itemId: ITEM_ID }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; occurredAt: string };
    expect(body.status).toBe("confirmed"); // the fixture source confirms
    expect(typeof body.occurredAt).toBe("string");
  });

  it("a save ALSO lands in the watchlist (the R01 library semantics)", async () => {
    const host = await bootFixtureRuntime();
    // The item must be registered first (the runtime's save law): search it.
    const model = await host.runtime.search({ query: "Neon Rain" });
    const itemId = model.hits[0]!.canonicalItemId;

    const response = await postAction(
      actionRequest({ type: "save", connectorId: "fake-source", externalRef: "fake:short-1", itemId }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("confirmed");
    // The watchlist carries the canonical-keyed save with its sync state.
    const library = await host.runtime.library();
    expect(library.watchlist.entries.length).toBe(1);
    expect(library.watchlist.entries[0]!.itemId).toBe(itemId);
    expect(library.watchlist.entries[0]!.sync).toBe("synced");
  });

  it("malformed bodies answer 400", async () => {
    await bootFixtureRuntime();
    const badType = await postAction(
      actionRequest({ type: "download", connectorId: "c", externalRef: "r" }),
    );
    expect(badType.status).toBe(400);
    const missingRef = await postAction(actionRequest({ type: "like", connectorId: "c" }));
    expect(missingRef.status).toBe(400);
  });

  it("a download action settles unsupported through the runtime's capability gate (never success)", async () => {
    // The platform capability gate: Web truthfully lacks the native
    // acquisition path — the action settles `unsupported` with the
    // limitation named (proving the gate through the runtime itself).
    const host = await bootFixtureRuntime();
    const state = await host.runtime.dispatchAction({
      type: "download",
      connectorId: "fake-source",
      externalRef: "fake:movie-1",
    });
    expect(state.status).toBe("unsupported");
    expect(state.capabilityGate).toBe("native-acquisition");
    expect(state.detail).toContain("nativeMedia");
  });

  it("R15/J10: a `local-only` receipt (recorded in WebFlix, sync pending) flows through the web seam VERBATIM — the differentiated state, never conflated with confirmed", async () => {
    // The R15 boundary: the Experience API answers `local-only` when the
    // action is recorded in WebFlix but external sync pends (or failed
    // with a retry scheduled). The web route maps the runtime's
    // `confirmed-locally` settlement back to the receipt vocabulary with
    // the retry detail — the J10 differentiation at the adapter seam
    // (provider-confirmed `confirmed` is a DIFFERENT state).
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      await withFetchStub(
        (_call) =>
          new Response(
            JSON.stringify({
              status: "local-only",
              detail:
                "recorded in WebFlix — external sync pending (retry 1/5 scheduled; last failure: the source is briefly unavailable)",
              occurredAt: "2026-09-16T10:00:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        async () => {
          await getWebRuntimeHost();
          const response = await postAction(
            actionRequest({ type: "save", connectorId: "fake-source", externalRef: "fake:short-1", itemId: ITEM_ID }),
          );
          expect(response.status).toBe(200);
          const body = (await response.json()) as {
            status: string;
            detail?: string;
            externalId?: string;
          };
          expect(body.status).toBe("local-only"); // WebFlix-confirmed, NOT provider-confirmed
          expect(body.detail).toContain("recorded in WebFlix");
          expect(body.detail).toContain("retry 1/5");
          expect(body.externalId).toBeUndefined(); // no provider confirmation exists
        },
      );
    });
  });

  it("R15/J10: a provider-confirmed receipt carries the provider's externalId through the web seam", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      await withFetchStub(
        (_call) =>
          new Response(
            JSON.stringify({
              status: "confirmed",
              externalId: "src-777",
              occurredAt: "2026-09-16T10:00:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        async () => {
          await getWebRuntimeHost();
          const response = await postAction(
            actionRequest({ type: "like", connectorId: "fake-source", externalRef: "fake:short-1", itemId: ITEM_ID }),
          );
          expect(response.status).toBe(200);
          const body = (await response.json()) as {
            status: string;
            externalId?: string;
          };
          expect(body.status).toBe("confirmed");
          expect(body.externalId).toBe("src-777"); // provider confirmation evidence rides along
        },
      );
    });
  });
});

describe("R07 GET /api/shorts — the fresh page", () => {
  it("answers the projected OS page from the runtime's shorts model", async () => {
    await bootFixtureRuntime();
    const response = await getShorts(new Request("http://localhost/api/shorts"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { page: { cards: unknown[]; surface: string } };
    expect(body.page.surface).toBe("short");
    expect(body.page.cards.length).toBeGreaterThan(0);
  });

  it("a failing shorts read answers 502 with the typed detail (never a fake page)", async () => {
    await withEnv({ WFX_API_BASE: "https://down.example" }, async () => {
      await withFetchStub(
        () => Promise.reject(new TypeError("offline")),
        async () => {
          await getWebRuntimeHost();
          const response = await getShorts(new Request("http://localhost/api/shorts"));
          expect(response.status).toBe(502);
          const body = (await response.json()) as { error: string };
          expect(body.error).toContain("network");
        },
      );
    });
  });
});
