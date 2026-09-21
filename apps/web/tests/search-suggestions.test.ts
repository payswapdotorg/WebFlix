/**
 * R24-W2 — the search suggestions tests (bun:test).
 *
 * Proves the search-suggestions row's real backing over the
 * fixtures-boot composition: the source-neutral suggestion lanes under
 * the search box while typing — the TITLE completions from the
 * runtime's own search seam plus the MATCHES-BY-MEANING lane (the same
 * semantic search R23 wired, its honest unavailable state included) —
 * through the REAL /api/search/suggest route.
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { GET as getSuggest } from "../src/app/api/search/suggest/route";
import { withEnv } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** GET the suggestion route (the real handler, no network). */
async function suggest(query: string): Promise<{
  ok: boolean;
  suggestions: { kind: string; text: string; href: string }[];
  meaningAvailable?: boolean;
}> {
  const response = await getSuggest(
    new Request(`http://localhost/api/search/suggest?q=${encodeURIComponent(query)}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ReturnType<typeof suggest> extends Promise<infer T> ? T : never;
}

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The suggestion lanes
// ---------------------------------------------------------------------------

describe("R24-W2 — the search suggestion lanes (the real route)", () => {
  it("a partial title answers the title lane (the runtime's own search seam)", async () => {
    await bootHost();
    const body = await suggest("deep");
    expect(body.ok).toBe(true);
    expect(body.suggestions.length).toBeGreaterThan(0);
    const title = body.suggestions.find((entry) => entry.kind === "title");
    expect(title?.text).toBe("Deep Field Diary");
    expect(title?.href).toContain("/item?");
  });

  it("a meaning query answers the by-meaning lane (the same semantic search as the results surface)", async () => {
    await bootHost();
    const body = await suggest("telescopes and galaxies");
    const meaning = body.suggestions.find((entry) => entry.kind === "meaning");
    expect(meaning).toBeDefined();
    expect(meaning?.text).toBe("Deep Field Diary");
    expect(body.meaningAvailable).toBe(true);
  });

  it("the short queries answer the typed empty lane (the noise bound — never single-character noise)", async () => {
    await bootHost();
    const empty = await suggest("");
    expect(empty.suggestions).toEqual([]);
    const single = await suggest("d");
    expect(single.suggestions).toEqual([]);
  });

  it("the suggestion hrefs route through the item hub (the same navigation the cards use)", async () => {
    await bootHost();
    const body = await suggest("rain");
    for (const entry of body.suggestions) {
      expect(entry.href.startsWith("/item?")).toBe(true);
    }
  });
});
