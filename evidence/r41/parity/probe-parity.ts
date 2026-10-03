/**
 * WFX-R23R — the Web/API deployment-parity probe (matrix clause 4).
 *
 * Proves the deployed web host (https://webflix-steel.vercel.app) and the
 * deployed Experience API (https://webflix-api.vercel.app) AGREE:
 *
 *  1. HEALTH CONTRACTS byte-exact on both surfaces (status + body +
 *     sha256 digest + the response identity headers).
 *  2. BOOT TRANSPORT: the web host's service ports hit the Experience API
 *     — (a) the API's identity-header law (400 without, 200 with), and
 *     (b) the intelligence chain: the web host's /api/intelligence answer
 *     is the projection of the API's /experience/intelligence wire (the
 *     same meaningSearchAvailable:false truth on both hops).
 *  3. CONTENT ROUND TRIP: a real search served END-TO-END through the
 *     split runtime — the API's /experience/search?query=rain answer vs
 *     the web host's RENDERED /search?q=rain cards (browser-read href
 *     refs), asserting the identity agreement (same externalRefs, same
 *     order, same count).
 *
 * Usage: bun evidence/r41/parity/probe-parity.ts
 * Writes: evidence/r41/parity/parity-record.json (+ prints the verdict).
 *
 * Layering law honored: a USER of the two production surfaces (HTTP + the
 * agent-browser CLI for the rendered cards) — zero product imports.
 */

/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const WEB = "https://webflix-steel.vercel.app";
const API = "https://webflix-api.vercel.app";
const SESSION = `wfx-r23r-parity-${Date.now()}`;

const IDENTITY_HEADERS = {
  "x-wfx-user-id": "wfx-anonymous",
  "x-wfx-session-id": "wfx-r23r-parity-probe",
};

interface ResponseIdentity {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBytes: number;
  bodySha256: string;
  bodyText: string;
}

/** One request → its full response identity (selected headers + digest). */
async function probe(url: string, init?: RequestInit): Promise<ResponseIdentity> {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  const headerAllowList = [
    "content-type", "cache-control", "age", "server", "x-vercel-cache",
    "x-vercel-id", "x-matched-path", "strict-transport-security", "date",
  ];
  const headers: Record<string, string> = {};
  for (const name of headerAllowList) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return {
    url,
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyBytes: new TextEncoder().encode(bodyText).length,
    bodySha256: createHash("sha256").update(bodyText).digest("hex"),
    bodyText,
  };
}

/** Run one agent-browser CLI command (the card reader for the round trip). */
async function ab(args: string[]): Promise<string> {
  const proc = Bun.spawnSync(["agent-browser", ...args], {
    env: { ...process.env, AGENT_BROWSER_SESSION: SESSION },
    timeout: 90_000,
  });
  const out = proc.stdout.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`agent-browser ${args.join(" ")} failed (${proc.exitCode}): ${proc.stderr.toString().slice(0, 300)}`);
  }
  return out;
}

async function main(): Promise<void> {
  const record: Record<string, unknown> = {
    probe: "WFX-R23R Web/API deployment parity",
    web: WEB,
    api: API,
    capturedAt: new Date().toISOString(),
    checks: [] as Array<Record<string, unknown>>,
  };
  const checks = record.checks as Array<Record<string, unknown>>;

  // -- Check 1: the health contracts, byte-exact on both --------------------
  const webHealth = await probe(`${WEB}/api/health`);
  const apiHealth = await probe(`${API}/api/health`);
  const webContract = `{"ok":true,"service":"webflix-web","version":"0.1.0"}`;
  const apiContract = `{"ok":true,"service":"webflix-api","version":"0.1.0"}`;
  checks.push({
    id: "health-web",
    verdict: webHealth.status === 200 && webHealth.bodyText === webContract ? "PASS" : "FAIL",
    expected: webContract,
    identity: webHealth,
  });
  checks.push({
    id: "health-api",
    verdict: apiHealth.status === 200 && apiHealth.bodyText === apiContract ? "PASS" : "FAIL",
    expected: apiContract,
    identity: apiHealth,
  });

  // -- Check 2a: the API's identity-header law (the boot transport's seam) --
  const apiSearchNoIdentity = await probe(`${API}/experience/search?query=rain`);
  checks.push({
    id: "api-identity-header-law",
    verdict: apiSearchNoIdentity.status === 400 && apiSearchNoIdentity.bodyText.includes("x-wfx-user-id") ? "PASS" : "FAIL",
    expected: "HTTP 400 naming the absent x-wfx-user-id identity header",
    identity: { ...apiSearchNoIdentity, bodyText: apiSearchNoIdentity.bodyText.slice(0, 400) },
  });

  // -- Check 2b: the intelligence chain through the split runtime ----------
  const webIntelligence = await probe(`${WEB}/api/intelligence?q=a%20space%20documentary%20about%20telescopes%20and%20galaxies`);
  const apiIntelligence = await probe(`${API}/experience/intelligence?q=a%20space%20documentary%20about%20telescopes%20and%20galaxies`);
  let webView: { mode?: string; view?: { meaningSearchAvailable?: boolean; meaning?: unknown[]; moments?: unknown[] } } = {};
  let apiValue: { meaningSearchAvailable?: boolean; meaning?: unknown[]; moments?: unknown[] } = {};
  try { webView = JSON.parse(webIntelligence.bodyText); } catch { /* recorded verbatim */ }
  try { apiValue = JSON.parse(apiIntelligence.bodyText).value ?? {}; } catch { /* recorded verbatim */ }
  const chainAgrees =
    webIntelligence.status === 200 &&
    apiIntelligence.status === 200 &&
    webView.mode === "service" &&
    webView.view?.meaningSearchAvailable === false &&
    apiValue.meaningSearchAvailable === false &&
    (webView.view?.meaning?.length ?? -1) === (apiValue.meaning?.length ?? -2) &&
    (webView.view?.moments?.length ?? -1) === (apiValue.moments?.length ?? -2);
  checks.push({
    id: "intelligence-chain",
    verdict: chainAgrees ? "PASS" : "FAIL",
    expected: "web /api/intelligence projects the API /experience/intelligence wire (both meaningSearchAvailable:false, same empty meaning/moments)",
    webIdentity: { ...webIntelligence, bodyText: webIntelligence.bodyText.slice(0, 400) },
    apiIdentity: { ...apiIntelligence, bodyText: apiIntelligence.bodyText.slice(0, 400) },
  });

  // -- Check 3: the real content round trip through the split runtime ------
  const QUERY = "rain";
  const apiSearch = await probe(
    `${API}/experience/search?query=${encodeURIComponent(QUERY)}`,
    { headers: { ...IDENTITY_HEADERS, accept: "application/json" } },
  );
  let apiRefs: string[] = [];
  let apiTitles: string[] = [];
  try {
    const entries = JSON.parse(apiSearch.bodyText) as Array<{ externalRef: string; title: string }>;
    apiRefs = entries.map((entry) => entry.externalRef);
    apiTitles = entries.map((entry) => entry.title);
  } catch { /* recorded verbatim */ }

  // The web host's RENDERED cards for the same query (the browser read).
  await ab(["open", `${WEB}/search?q=${encodeURIComponent(QUERY)}`]);
  await ab(["wait", "--load", "networkidle"]).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const cardsJson = await ab([
    "eval",
    `(() => { const cards = [...document.querySelectorAll('a[data-wfx-card]')]; return JSON.stringify({ mode: document.querySelector('[data-wfx-mode]')?.getAttribute('data-wfx-mode') ?? null, cardCount: cards.length, refs: cards.map((c) => new URL(c.href, location.origin).searchParams.get('ref')), titles: cards.map((c) => (c.getAttribute('aria-label') ?? '').slice(0, 80)) }); })()`,
  ]);
  const webCards = JSON.parse(JSON.parse(cardsJson.trim())) as {
    mode: string | null; cardCount: number; refs: (string | null)[]; titles: string[];
  };
  await ab(["screenshot", "evidence/r41/parity/parity-web-search-render.png"]).catch(() => undefined);
  await ab(["close"]).catch(() => undefined);

  const webRefs = webCards.refs.filter((ref): ref is string => ref !== null);
  const overlap = webRefs.filter((ref) => apiRefs.includes(ref));
  const sameOrder = overlap.length === webRefs.length && webRefs.length === apiRefs.length
    && webRefs.every((ref, index) => apiRefs[index] === ref);
  checks.push({
    id: "search-round-trip",
    verdict: apiSearch.status === 200 && webCards.mode === "service" && sameOrder && webRefs.length > 0 ? "PASS" : "FAIL",
    expected: "the web host's rendered /search cards are the API's /experience/search answer (same refs, same order, non-zero)",
    apiIdentity: { ...apiSearch, bodyText: `<${apiSearch.bodyBytes} bytes, ${apiRefs.length} items>` },
    apiRefs,
    apiTitles: apiTitles.slice(0, 6),
    webRender: webCards,
    agreement: { webCardCount: webCards.cardCount, apiItemCount: apiRefs.length, overlapCount: overlap.length, sameOrder },
  });

  const failed = checks.filter((check) => check.verdict !== "PASS").map((check) => check.id);
  record.verdict = failed.length === 0 ? "PASS" : `FAIL: ${failed.join(", ")}`;

  writeFileSync("evidence/r41/parity/parity-record.json", `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({
    verdict: record.verdict,
    checks: checks.map((check) => ({ id: check.id, verdict: check.verdict })),
  }, null, 2));
}

await main();
