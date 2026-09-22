/**
 * The R26-W2 ARTWORK VERIFICATION STUB — a LOCAL-ONLY Experience API double.
 *
 * PURPOSE: verify the web lane's real-artwork PRESENTATION end-to-end (the
 * `<img>` rendering, the typed fallback law) against the artwork contract's
 * EXACT transport shape: content rows carrying `metadata.thumbnailUrl` with
 * REAL provider thumbnail URLs (i.ytimg.com — the same URLs the YouTube
 * connector's own projection carries from the provider's API answer).
 *
 * HONESTY: this is a local verification harness for the presentation lane —
 * NEVER a production transport claim. The PRODUCTION transport carriage
 * (the deployed API's rows carrying thumbnailUrl) is Worker 1's named
 * dependency, escalated to the lead. The stub also proxies nothing and
 * invents no playback: resolve answers the same real YouTube embed/external
 * URLs the production catalog carries.
 */

import { createServer } from "node:http";

const PORT = 3199;

/** The catalog the stub serves (real public YouTube refs + REAL thumbnail URLs). */
interface StubItem {
  readonly ref: string;
  readonly title: string;
  readonly type: "video" | "short";
  readonly durationMs?: number;
  readonly orientation: "horizontal" | "vertical";
}

const CATALOG: readonly StubItem[] = [
  { ref: "5SRgdyUsuAg", title: "1,000 Years Of English Monarchy In 4 Hours", type: "video", durationMs: 16146000, orientation: "horizontal" },
  { ref: "3uyGhtARP4M", title: "1 HOUR Rainy Day in Airport — Cozy Lofi for Relax, Study & Sleep", type: "short", orientation: "vertical" },
  { ref: "DYFDc0dpc5g", title: "Inside the Wettest City on the Planet (Rains Every Day)", type: "video", durationMs: 2886000, orientation: "horizontal" },
  { ref: "jNQXAC9IVRw", title: "Me at the zoo", type: "video", durationMs: 19000, orientation: "horizontal" },
  { ref: "P3IIRiSTc3g", title: "The Complete History Of The Roman Empire In 4 Hours", type: "video", durationMs: 13997000, orientation: "horizontal" },
  { ref: "HOmzTwFuR0A", title: "Best thunder sound for sleep", type: "short", orientation: "vertical" },
];

/** The REAL provider thumbnail URL (the connector projection's own form). */
function thumbnailOf(ref: string): string {
  return `https://i.ytimg.com/vi/${ref}/hqdefault.jpg`;
}

/** The search row (the contract's carrier: metadata.thumbnailUrl). */
function searchRowOf(item: StubItem) {
  return {
    connectorId: "wfx-experience-service",
    externalRef: item.ref,
    title: item.title,
    canonicalType: item.type,
    orientation: item.orientation,
    ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
    metadata: { thumbnailUrl: thumbnailOf(item.ref) },
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const send = (status: number, body: unknown): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  if (request.method === "GET" && path === "/api/health") {
    return send(200, { ok: true, service: "wfx-artwork-stub", version: "0.1.0" });
  }

  if (request.method === "GET" && path === "/experience/search") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    const hits = CATALOG.filter((item) => {
      if (query.trim().length === 0) return false;
      // Literal containment (the production transport's own law) + the token law.
      if (item.title.toLowerCase().includes(query)) return true;
      const tokens = query.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
      const titleTokens = item.title.toLowerCase().split(/[^a-z0-9]+/);
      return tokens.every((token) => titleTokens.includes(token));
    });
    return send(200, hits.map(searchRowOf));
  }

  if (request.method === "GET" && path === "/experience/metadata") {
    const ref = url.searchParams.get("ref") ?? "";
    const item = CATALOG.find((entry) => entry.ref === ref);
    if (item === undefined) return send(200, null);
    return send(200, {
      connectorId: "wfx-experience-service",
      externalRef: item.ref,
      title: item.title,
      availability: "available",
      capabilities: ["playEmbed", "playExternal", "like", "save"],
      canonicalType: item.type,
      orientation: item.orientation,
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      metadata: { thumbnailUrl: thumbnailOf(item.ref) },
    });
  }

  if (request.method === "GET" && path === "/experience/resolve") {
    const ref = url.searchParams.get("ref") ?? "";
    const item = CATALOG.find((entry) => entry.ref === ref);
    if (item === undefined) return send(200, []);
    return send(200, [
      {
        url: `https://www.youtube.com/embed/${item.ref}`,
        mode: "embed",
        connectorId: "wfx-experience-service",
        externalRef: item.ref,
        capabilities: ["playEmbed"],
      },
      {
        url: `https://www.youtube.com/watch?v=${item.ref}`,
        mode: "external",
        connectorId: "wfx-experience-service",
        externalRef: item.ref,
        capabilities: ["playExternal"],
      },
    ]);
  }

  // The honest empty/ok defaults for the remaining frozen transport surface.
  if (request.method === "GET" && (path === "/experience/library" || path === "/experience/history")) {
    return send(200, []);
  }
  if (request.method === "GET" && (path === "/experience/intents" || path === "/experience/policy")) {
    return send(200, {});
  }
  if (request.method === "GET" && path.startsWith("/experience/feedback")) {
    return send(200, []);
  }
  if (request.method === "GET" && path === "/experience/intelligence") {
    // The honest typed unavailable (the real deployment's own gap).
    return send(404, { error: "not served by this transport" });
  }
  if (request.method === "POST" || request.method === "PUT" || request.method === "DELETE") {
    return send(200, { ok: true, status: "completed" });
  }

  return send(404, { error: "unknown route" });
});

server.listen(PORT, () => {
  console.log(`wfx-artwork-stub listening on http://localhost:${PORT}`);
});
