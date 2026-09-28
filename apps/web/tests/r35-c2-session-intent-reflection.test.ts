/**
 * R35 — the C2 regression test (the session intent's page reflection on a
 * fresh instance; the discovery-surface.test.ts house style).
 *
 * THE R34-A LEDGER'S C2 ROW: POST `/api/personalize` `{kind:"intent"}`
 * answered 200 and the route's own GET read both intents back, but the
 * watch page's SSR discovery bundle rendered NO INTENT MARK
 * (`markInDom:false`) — the per-instance read (the same serverless class
 * as B2: the POST that wrote the intent ran on one instance; the page
 * render's cold runtime never saw it).
 *
 * THE R35 LAW THIS TEST PINS:
 *   1. the intent write's response carries the SESSION-INTENT COOKIE
 *      (`wfx_session_intent` — the web adapter's session-scoped carrier;
 *      the IntentStore law keeps session scopes OUT of the server's
 *      durable records, so the cookie is the carrier the pages can read
 *      on any instance);
 *   2. a FRESH instance's discovery bundle — the watch page's SSR read —
 *      reflects the carried session intent (the mark renders);
 *   3. a fresh instance's GET reads the carried truth back (the same
 *      cookie, the same merge law);
 *   4. the honest negative: without the carrier, the fresh fold answers
 *      EMPTY (never a fabricated mark);
 *   5. clear-intent empties the carrier with the fold (one truth, both
 *      stores).
 *
 * DELIBERATELY NO lane-new imports (the file must LOAD on main so the
 * defect assertion itself fails — not an import error): the cookie's
 * payload is parsed inline; the carried objectives pass through the
 * main-existing entry points (`/api/personalize`'s handlers +
 * `loadDiscoveryBundle`) exactly as the pages call them.
 *
 * Fails on main (the fresh bundle ignores the carried intents — the
 * options never existed — and the POST sets no carrier cookie); passes
 * on wfx/r35/readpath.
 *
 * Determinism: fixture transport (the persona's intents read honest
 * empty — readIntents answers []), controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import { resetWebRuntimeHostForTests } from "../src/host/web-host";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadDiscoveryBundle } from "../src/host/discoverability";
import { GET as getPersonalize, POST as postPersonalize } from "../src/app/api/personalize/route";
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

/** POST one JSON body to a route handler (the real handler, no network). */
async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://localhost/api/personalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** GET the personalize route with an optional Cookie header (no network). */
async function getWithCookie(cookie: string | null): Promise<Response> {
  return getPersonalize(
    new Request("http://localhost/api/personalize", {
      method: "GET",
      ...(cookie !== null ? { headers: { cookie } } : {}),
    }),
  );
}

/**
 * The carried objectives off a `wfx_session_intent` Set-Cookie value —
 * the same guarded parse the lane's cookie law performs, INLINED here so
 * this file imports nothing that does not exist on main (the test's own
 * data is well-formed; the structural guard itself is exercised through
 * the REAL route below).
 */
function carriedObjectivesOfSetCookie(setCookie: string | null): readonly string[] {
  if (setCookie === null) return [];
  const match = /^wfx_session_intent=([^;]*)/.exec(setCookie);
  if (match === null || (match[1] ?? "").length === 0) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1] ?? "")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * THE RELOAD: reset the runtime's process state (a fresh process's
 * runtime — the service-mode split's honest in-harness reproduction: the
 * POST's instance is gone; only its durable writes survive).
 */
function simulateFreshProcess(): void {
  resetWebRuntimeHostForTests();
}

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The regression probe
// ---------------------------------------------------------------------------

describe("R35 (C2) — the session intent reflects on a FRESH instance's page read (the SSR discovery bundle)", () => {
  it("POST intent → RELOAD → the fresh discovery bundle carries the intent (the mark's truth); the carrier cookie + the fresh GET agree", async () => {
    const objective = "slow documentaries about deep space";

    // ── phase A: the intent write (the ledger's J42 step06 flow — the
    //    POST answered 200; the SAME-instance read-back worked) ──
    const hostA = await bootHost();
    const posted = await post(postPersonalize, { kind: "intent", objective });
    expect(posted.status).toBe(200);
    const bodyA = (await posted.json()) as { intents?: { objective: string }[] };
    expect(bodyA.intents?.map((intent) => intent.objective)).toContain(objective); // same-instance — works on main too

    // ── THE RELOAD: a fresh process's runtime (the POST's instance is
    //    gone — the service-mode split) ──
    simulateFreshProcess();
    const hostB = await bootHost();

    // (1) THE C2 DEFECT ITSELF: on main the fresh instance's discovery
    //     bundle rendered NO INTENT MARK — the per-instance fold was
    //     empty and the carried objectives had no path into the read.
    //     R35: the bundle's personalize read merges the request-carried
    //     session objectives (the cookie) — the watch page's SSR mark
    //     renders on ANY instance.
    const bundle = await loadDiscoveryBundle(hostB, { requestCarriedIntents: [objective] });
    expect(bundle.personalize.intents.map((intent) => intent.objective)).toContain(objective); // ← FAILS ON MAIN

    // (2) THE CARRIER: the POST's response sets the session-intent cookie
    //     carrying the objective (the lane's carrier law — the pages'
    //     request-scoped read feeds exactly this payload).
    const setCookie = posted.headers.get("set-cookie");
    expect(setCookie).toContain("wfx_session_intent="); // ← lane law (main sets no carrier)
    const carried = carriedObjectivesOfSetCookie(setCookie);
    expect(carried).toContain(objective);

    // (3) THE FRESH GET READS THE CARRIED TRUTH (the same cookie rides
    //     the request; the route's answer composes it — the read-back
    //     that on main only worked SAME-instance).
    const read = await getWithCookie(setCookie);
    expect(read.status).toBe(200);
    const bodyB = (await read.json()) as { intents?: { objective: string }[] };
    expect(bodyB.intents?.map((intent) => intent.objective)).toContain(objective);

    // (4) THE HONEST NEGATIVE: without the carrier, the fresh fold
    //     answers EMPTY (the fixtures transport's own honest empty read —
    //     never a fabricated mark).
    const bare = await loadDiscoveryBundle(hostB);
    expect(bare.personalize.intents.some((intent) => intent.objective === objective)).toBe(false);
    const tampered = await getWithCookie("wfx_session_intent=not-json");
    const tamperedBody = (await tampered.json()) as { intents?: { objective: string }[] };
    expect(tamperedBody.intents?.some((intent) => intent.objective === objective)).toBe(false);
  });

  it("clear-intent empties the carrier with the fold (one truth, both stores)", async () => {
    await bootHost();
    const objective = "loud action tonight";
    const posted = await post(postPersonalize, { kind: "intent", objective });
    expect(posted.status).toBe(200);
    const carriedAfterWrite = carriedObjectivesOfSetCookie(posted.headers.get("set-cookie"));
    expect(carriedAfterWrite).toContain(objective);

    // The clear: the runtime's own end-session law + the carrier emptied.
    const cleared = await post(postPersonalize, { kind: "clear-intent" });
    expect(cleared.status).toBe(200);
    const setCookie = cleared.headers.get("set-cookie");
    expect(setCookie).toContain("wfx_session_intent=;");
    expect(setCookie).toContain("Max-Age=0");
    expect(carriedObjectivesOfSetCookie(setCookie)).toHaveLength(0);

    // The cleared state survives the reload: a fresh instance carrying
    // the POST-CLEAR (emptied) carrier renders no mark — the clear is
    // the truth on ANY instance (never a resurrected objective).
    simulateFreshProcess();
    const hostB = await bootHost();
    const postClearCarried = carriedObjectivesOfSetCookie(setCookie);
    expect(postClearCarried).toHaveLength(0);
    const bundle = await loadDiscoveryBundle(hostB, { requestCarriedIntents: postClearCarried });
    expect(bundle.personalize.intents.length).toBe(0);
  });
});
