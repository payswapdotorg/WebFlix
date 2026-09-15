/**
 * WFX-050 health endpoint tests (bun:test).
 *
 * Exercises the REAL route module (`src/app/api/health/route.ts`) — the
 * same handler `next start` serves — by calling its `GET` export
 * directly: route handlers are plain functions. Proves the WFX-056
 * deployment-verification contract end to end: `200` with
 * `{ ok: true, service: "webflix-web", version }`, where `version` is
 * the package version (the single source of truth this test pins).
 *
 * Deterministic: the handler is a pure constant answer — no environment,
 * no network, no clock.
 */

import { describe, expect, it } from "bun:test";

import { GET } from "../src/app/api/health/route";
import { WEB_HOST_SERVICE, WEB_HOST_VERSION } from "../src/host/version";

describe("WFX-050 health endpoint (GET /api/health)", () => {
  it("answers the deployment-verification contract: ok / service / version", async () => {
    const response = GET();
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      service: WEB_HOST_SERVICE,
      version: WEB_HOST_VERSION,
    });
    expect(body.service).toBe("webflix-web");
  });

  it("reports the package version — the route and package.json cannot drift", async () => {
    const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      version: string;
    };
    const body = (await GET().json()) as Record<string, unknown>;
    expect(body.version).toBe(pkg.version);
  });

  it("is deterministic: two calls answer byte-identical JSON", async () => {
    const first = await GET().json();
    const second = await GET().json();
    expect(first).toEqual(second);
  });
});
