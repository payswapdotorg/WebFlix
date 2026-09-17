/**
 * R10 — the PRODUCTION range gateway tests.
 *
 * The loopback HTTP server over the REAL engine + REAL stored bytes:
 * `GET /media/<assetId>` with full Range/ETag/416 semantics, byte-exact
 * bodies against the real files, concurrent range reads, the LIVE asset
 * map (assets persisted after start become servable), and the loopback +
 * ephemeral-port policy (kernel-assigned port reported on the handle).
 * Loopback-only network on 127.0.0.1 — no external network, ever.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createRealEngine,
  type RealEngine,
} from "../src/service-process/engine";
import {
  startProductionGateway,
  type ProductionGatewayHandle,
} from "../src/service-process/gateway";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TMP_ROOT = join(import.meta.dir, "tmp-gateway-test");

interface Fixture {
  engine: RealEngine;
  gateway: ProductionGatewayHandle;
  media: { path: string; bytes: Uint8Array };
  assetId: string;
}

let fixtureCounter = 0;

/** A running gateway over a real engine, with ONE completed asset served. */
async function newGatewayFixture(): Promise<Fixture> {
  fixtureCounter += 1;
  const root = join(TMP_ROOT, `gw-${fixtureCounter}`);
  mkdirSync(root, { recursive: true });
  const mediaPath = join(root, `media-${fixtureCounter}.bin`);
  const bytes = new Uint8Array(8_000);
  for (let i = 0; i < 8_000; i += 1) {
    bytes[i] = (i * 17 + 11) % 251;
  }
  writeFileSync(mediaPath, bytes);

  const engine = createRealEngine({
    storeRoot: root,
    maxCacheBytes: 64 * 1024 * 1024,
    readChunkBytes: 1_000,
    nominalBitrateBps: 2_000_000,
    rebufferLeadMs: 0,
    // The gateway serves through LIVE sessions whose read-ahead must
    // progress (the deadline-aware pull waits for real reads).
    autoTick: true,
  });
  // Complete the asset through the real engine (background completion).
  const session = await engine.open({ localPath: mediaPath });
  await engine.resume(session.id);
  await engine.enterBackground(session.id);
  for (let i = 0; i < 12; i += 1) {
    await engine.pumpOnce(session.id);
  }
  if (engine.snapshot(session.id)?.state !== "complete") {
    throw new Error("fixture: the asset did not complete");
  }

  const gateway = startProductionGateway(engine, { port: 0 });
  return { engine, gateway, media: { path: mediaPath, bytes }, assetId: session.assetId };
}

let main: Fixture;

beforeAll(async () => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
  main = await newGatewayFixture();
});

afterAll(async () => {
  await main.gateway.stop();
  main.engine.dispose();
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R10 — the production range gateway", () => {
  it("binds the LOOPBACK on a kernel-assigned ephemeral port (reported on the handle)", () => {
    expect(main.gateway.hostname).toBe("127.0.0.1");
    expect(main.gateway.port).toBeGreaterThan(0);
    expect(main.gateway.baseUrl).toBe(`http://127.0.0.1:${main.gateway.port}`);
    expect(main.gateway.assetUrl(main.assetId)).toBe(`/media/${main.assetId}`);
  });

  it("GET full asset: 200, byte-exact REAL body, Content-Length, ETag, Accept-Ranges", async () => {
    const response = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("8000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    const etag = response.headers.get("etag");
    expect(etag).toMatch(/^"wfx-[0-9a-f]{8}"$/);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(main.media.bytes));
  });

  it("closed Range: 206 + Content-Range + the byte-exact REAL slice", async () => {
    const response = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { Range: "bytes=100-199" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-199/8000");
    expect(response.headers.get("content-length")).toBe("100");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(main.media.bytes.slice(100, 200)));
  });

  it("open Range (a-) and suffix (-n) forms resolve against the real size", async () => {
    const open = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { Range: "bytes=7900-" },
    });
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe("bytes 7900-7999/8000");
    const openBody = new Uint8Array(await open.arrayBuffer());
    expect(Array.from(openBody)).toEqual(Array.from(main.media.bytes.slice(7_900)));

    const suffix = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { Range: "bytes=-500" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7500-7999/8000");
    const suffixBody = new Uint8Array(await suffix.arrayBuffer());
    expect(Array.from(suffixBody)).toEqual(Array.from(main.media.bytes.slice(7_500)));
  });

  it("If-None-Match with the served ETag answers 304 (no body)", async () => {
    const first = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`);
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();
    const revalidated = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { "If-None-Match": etag! },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
  });

  it("an unsatisfiable Range answers 416 with Content-Range: bytes */8000", async () => {
    const response = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { Range: "bytes=8000-8999" },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */8000");
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("RANGE_NOT_SATISFIABLE");
  });

  it("malformed and multi-range headers are TYPED 416s (never a silent full-file 200)", async () => {
    const malformed = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { Range: "bytes=abc" },
    });
    expect(malformed.status).toBe(416);
    const malformedBody = (await malformed.json()) as { error: { code: string; header: string } };
    expect(malformedBody.error.code).toBe("INVALID_RANGE_HEADER");
    expect(malformedBody.error.header).toBe("bytes=abc");

    const multi = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      headers: { Range: "bytes=0-1,5-9" },
    });
    expect(multi.status).toBe(416);
    const multiBody = (await multi.json()) as { error: { code: string } };
    expect(multiBody.error.code).toBe("MULTI_RANGE_UNSUPPORTED");
  });

  it("unknown assets answer the typed 404; non-GET answers 405 with Allow", async () => {
    const missing = await fetch(`${main.gateway.baseUrl}/media/asset-none`);
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error: { code: string } };
    expect(missingBody.error.code).toBe("NOT_FOUND");

    const post = await fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
      method: "POST",
    });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
  });

  it("CONCURRENT range reads: parallel fetches all byte-exact", async () => {
    const spans: [number, number][] = [
      [0, 999],
      [1_000, 1_999],
      [4_000, 4_499],
      [7_000, 7_999],
      [3_333, 3_333],
    ];
    const responses = await Promise.all(
      spans.map(([start, end]) =>
        fetch(`${main.gateway.baseUrl}/media/${main.assetId}`, {
          headers: { Range: `bytes=${start}-${end}` },
        }),
      ),
    );
    for (let i = 0; i < spans.length; i += 1) {
      const [start, end] = spans[i]!;
      const response = responses[i]!;
      expect(response.status).toBe(206);
      const body = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(body)).toEqual(
        Array.from(main.media.bytes.slice(start, end + 1)),
      );
    }
  });

  it("the LIVE asset map: an asset persisted AFTER start becomes servable immediately", async () => {
    const fixture = await newGatewayFixture();
    try {
      // A brand-new asset completes (background) after the gateway started.
      const secondMedia = join(fixture.engine.store.root, "second.bin");
      const secondBytes = new Uint8Array(4_000);
      for (let i = 0; i < 4_000; i += 1) {
        secondBytes[i] = (i * 3 + 1) % 251;
      }
      writeFileSync(secondMedia, secondBytes);
      const session = await fixture.engine.open({ localPath: secondMedia });
      await fixture.engine.resume(session.id);
      await fixture.engine.enterBackground(session.id);
      for (let i = 0; i < 12; i += 1) {
        await fixture.engine.pumpOnce(session.id);
      }
      expect(fixture.engine.snapshot(session.id)?.state).toBe("complete");

      // The service host's completion path adds it to the LIVE map; the
      // test performs the same refresh the host does (the map is shared).
      const stored = fixture.engine.store.statAsset(session.assetId);
      expect(stored).not.toBeNull();
      fixture.gateway.assets.set(`/media/${session.assetId}`, {
        source: { localPath: fixture.engine.store.contentPath(session.assetId) },
        pieceCount: 4,
      });

      const response = await fetch(
        `${fixture.gateway.baseUrl}/media/${session.assetId}`,
        { headers: { Range: "bytes=0-49" } },
      );
      expect(response.status).toBe(206);
      const body = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(body)).toEqual(Array.from(secondBytes.slice(0, 50)));
    } finally {
      await fixture.gateway.stop();
      fixture.engine.dispose();
    }
  });

  it("a configured port that cannot be bound fails startup honestly", async () => {
    // Occupy a port with the main gateway's listener, then ask for it.
    const busy = main.gateway.port;
    let threw = false;
    try {
      startProductionGateway(main.engine, { port: busy });
    } catch (e) {
      threw = true;
      expect((e as { code?: string }).code).toBe("IO_ERROR");
    }
    expect(threw).toBe(true);
  });

  it("stop() is idempotent and closes the listener", async () => {
    const fixture = await newGatewayFixture();
    const url = `${fixture.gateway.baseUrl}/media/${fixture.assetId}`;
    const before = await fetch(url);
    expect(before.status).toBe(200);
    await fixture.gateway.stop();
    await fixture.gateway.stop(); // idempotent
    await expect(fetch(url)).rejects.toThrow();
    fixture.engine.dispose();
  });
});
