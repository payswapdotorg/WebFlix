/**
 * WFX-055A transport-contract handler tests (bun:test).
 *
 * Exercises EVERY route of the service — the 7 experience endpoints, the
 * health endpoint, and the relay — by importing their GET/POST functions
 * directly and constructing `Request` objects (no server, no network), over
 * the COMPLETE `ApiBoot` composition built by `tests/test-boot.ts` (the
 * real 0001..0007 migrations incl. the catalog seed, the real adapters,
 * FixedClock at 30s + SequentialIdGen).
 *
 * The boot-slot seam (`src/host/testing.ts`) installs the composition, so
 * the routes' `getApiBoot()` awaits resolve to the test boot:
 *
 * - HAPPY PATHS over the seeded PGlite catalog (search hits real rows;
 *   metadata and resolve answer the real seeded realizations; like receipts;
 *   the library add → read → remove round-trip; the events DURABILITY law —
 *   the event_outbox row EXISTS the moment the endpoint answers 200).
 * - TYPED 400s: absent/garbage identity, garbage JSON bodies, invalid
 *   bodies, bad params.
 * - DEGRADATION MAPPINGS with the DB killed (the PGlite client closed):
 *   reads ⇒ `[]`/`null` 200, write receipts ⇒ `failed`, events ⇒ 502 (a
 *   lost watch event is NEVER silent) — plus the failed-slot forms of the
 *   same law and the LOUD boot-failure 500s.
 * - THE BOOT LAW via the seam AND via a scrubbed process.env: config
 *   crimes are loud typed 500s naming the variables; WFX_DEV_FIXTURES is
 *   refused outright (the service lane has no fixture mode).
 * - THE RELAY ROUTE's CRON_SECRET bearer law (NODE_ENV always restored).
 *
 * Every 200 data body is additionally run through the MIRRORS of the frozen
 * client's payload guards (`src/host/contract-guards.ts` — verified
 * field-by-field against apps/web/src/host/remote-ports.ts in slice 3) —
 * pinning end-to-end that the service's answers pass the frozen client's
 * validators by construction.
 *
 * Determinism: FixedClock/SequentialIdGen everywhere (receipts stamp
 * 1970-01-01T00:00:30.000Z); the single wall-clock touch (degraded
 * receipts when BOOT itself failed) is asserted only as a shape. No
 * network, no real database. The event-post count stays far below the
 * opportunistic-drain every-10-events trigger, and the 30s clock is never
 * interval-due (60s), so no stray drain disturbs outbox assertions.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import type { ActionReceipt, LibraryEntry, SearchResult, SourceItem } from "@wfx/domain";
import { isUsableReceipt } from "@wfx/experience";
import { DataSourceUnavailable } from "@wfx/persistence";

import { GET as healthGET } from "../src/app/api/health/route";
import { GET as relayGET, POST as relayPOST } from "../src/app/api/relay/route";
import { POST as actionsPOST } from "../src/app/experience/actions/route";
import { POST as eventsPOST } from "../src/app/experience/events/route";
import { GET as libraryGET, POST as libraryPOST } from "../src/app/experience/library/route";
import { GET as metadataGET } from "../src/app/experience/metadata/route";
import { GET as resolveGET } from "../src/app/experience/resolve/route";
import { GET as searchGET } from "../src/app/experience/search/route";
import { ApiConfigError } from "../src/host/config";
import {
  isUsableLibraryEntry,
  isUsableRealization,
  isUsableSearchResult,
  isUsableSourceItem,
} from "../src/host/contract-guards";
import { EXPERIENCE_SERVICE_CONNECTOR_ID } from "../src/host/fan-out";
import { failApiBootForTests, resetApiBootForTests, setApiBootForTests } from "../src/host/testing";
import {
  createApiTestBoot,
  getRequest,
  identityHeaders,
  postRequest,
  readSeededRow,
  type ApiTestBoot,
  type SeededRow,
} from "./test-boot";
import { TEST_DATABASE_URL, TEST_ENCRYPTION_KEY_BASE64 } from "./test-db";

/** The FixedClock(30s) receipt stamp every confirmed receipt carries. */
const OCCURRED_AT = "1970-01-01T00:00:30.000Z";

/** Deterministic seeded fixtures (verified rows of migration 0007). */
const MONARCHY_REF = "5SRgdyUsuAg"; // "1,000 Years Of English Monarchy In 4 Hours"
const ZOO_REF = "jNQXAC9IVRw"; // "Me at the zoo" (jawed)
const RAIN_BOMBS_REF = "oH_pVgW5fEw"; // "Rain Bombs | Full Documentary | NOVA | PBS"

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/**
 * Write one process.env variable through a writable view — next's global
 * types declare NODE_ENV readonly (Next inlines it at build time in real
 * builds), but the relay route reads it at RUNTIME, so these tests must
 * steer it dynamically.
 */
function setEnvVar(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

let harness: ApiTestBoot;
let seeded: SeededRow;

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);
  seeded = await readSeededRow(harness.testDb.db);
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

// ---------------------------------------------------------------------------
// GET /api/health — the 056 deployment-verification convention
// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  it("answers 200 {ok, service, version} without touching the boot", async () => {
    const response = await healthGET();
    expect(response.status).toBe(200);
    const body = (await json(response)) as { ok: boolean; service: string; version: string };
    expect(body).toEqual({ ok: true, service: "webflix-api", version: "0.1.0" });
  });
});

// ---------------------------------------------------------------------------
// The 7 transport endpoints — happy paths over the seeded catalog
// ---------------------------------------------------------------------------

describe("GET /experience/search — happy paths over the seeded catalog", () => {
  it("hits real seeded rows, every hit passing the frozen client's guard", async () => {
    const response = await searchGET(
      getRequest("/experience/search?query=rain", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const hits = (await json(response)) as SearchResult[];
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(5);
    for (const hit of hits) {
      expect(isUsableSearchResult(hit), `hit: ${JSON.stringify(hit)}`).toBe(true);
      // The fan-out rewrites every answer to the service binding id.
      expect(hit.connectorId).toBe(EXPERIENCE_SERVICE_CONNECTOR_ID);
    }
    const rainBombs = hits.find((hit) => hit.externalRef === RAIN_BOMBS_REF);
    expect(rainBombs?.title).toBe("Rain Bombs | Full Documentary | NOVA | PBS");
    expect(rainBombs?.canonicalType).toBe("video");
    expect(rainBombs?.durationMs).toBe(3_234_000);
    expect(rainBombs?.orientation).toBe("horizontal");
  });

  it("a narrow query answers exactly the matching seeded row (deterministic)", async () => {
    const response = await searchGET(getRequest("/experience/search?query=zoo", identityHeaders()));
    const hits = (await json(response)) as SearchResult[];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: ZOO_REF,
      title: "Me at the zoo",
      canonicalType: "video",
      durationMs: 19_000,
      orientation: "horizontal",
    });
  });

  it("identical requests answer identical bodies (the merge is deterministic)", async () => {
    const first = await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    const second = await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    expect(await first.text()).toBe(await second.text());
  });

  it("no hits answers the honest EMPTY array (200, never 404)", async () => {
    const response = await searchGET(
      getRequest("/experience/search?query=zzzz-no-such-title-zzzz", identityHeaders()),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual([]);
  });
});

describe("GET /experience/metadata — happy paths", () => {
  it("answers the real seeded item, passing the frozen client's guard", async () => {
    const response = await metadataGET(
      getRequest(`/experience/metadata?ref=${MONARCHY_REF}`, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const item = (await json(response)) as SourceItem;
    expect(isUsableSourceItem(item)).toBe(true);
    expect(item).toMatchObject({
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: MONARCHY_REF,
      title: "1,000 Years Of English Monarchy In 4 Hours",
      canonicalType: "video",
      durationMs: 16_146_000,
      orientation: "horizontal",
      availability: "available",
    });
    expect(item.capabilities).toEqual(["playEmbed", "playExternal", "like", "save"]);
  });

  it("an unknown ref answers the honest null (200)", async () => {
    const response = await metadataGET(
      getRequest("/experience/metadata?ref=zzzznotarealref", identityHeaders()),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toBeNull();
  });
});

describe("GET /experience/resolve — happy paths", () => {
  it("answers the REAL embed + watch realizations of the seeded row", async () => {
    const response = await resolveGET(
      getRequest(`/experience/resolve?ref=${MONARCHY_REF}`, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const realizations = (await json(response)) as unknown[];
    expect(realizations).toHaveLength(2);
    for (const candidate of realizations) {
      expect(isUsableRealization(candidate), `candidate: ${JSON.stringify(candidate)}`).toBe(true);
      expect((candidate as { connectorId: string }).connectorId).toBe(
        EXPERIENCE_SERVICE_CONNECTOR_ID,
      );
    }
    const embed = realizations.find((r) => (r as { mode: string }).mode === "embed");
    const external = realizations.find((r) => (r as { mode: string }).mode === "external");
    expect((embed as { url: string }).url).toBe(`https://www.youtube.com/embed/${MONARCHY_REF}`);
    expect((external as { url: string }).url).toBe(
      `https://www.youtube.com/watch?v=${MONARCHY_REF}`,
    );
  });

  it("an unknown ref answers the honest empty array (200)", async () => {
    const response = await resolveGET(
      getRequest("/experience/resolve?ref=zzzznotarealref", identityHeaders()),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual([]);
  });
});

describe("POST /experience/actions — happy paths", () => {
  it("a like on a seeded ref answers a confirmed receipt stamped by the injected clock", async () => {
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: ZOO_REF },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(200);
    const receipt = (await json(response)) as ActionReceipt;
    expect(isUsableReceipt(receipt)).toBe(true);
    expect(receipt.status).toBe("confirmed");
    expect(receipt.occurredAt).toBe(OCCURRED_AT);
    // The action's durable local record: the outbox carries the like event.
    const rows = await harness.testDb.db.query<{ event_type: string }>(
      `SELECT event_type FROM event_outbox WHERE user_id = $1 AND event_type = 'like'`,
      ["wfx-api-test-user"],
    );
    expect(rows).toHaveLength(1);
  });

  it("a well-formed but UNROUTABLE action is an honest failed receipt (200, never a crash)", async () => {
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: "someone-else", externalRef: ZOO_REF },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(200);
    const receipt = (await json(response)) as ActionReceipt;
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("someone-else");
    expect(isUsableReceipt(receipt)).toBe(true);
  });
});

describe("POST|GET /experience/library — the add → read → remove round-trip", () => {
  it("reads empty, adds, reads back, removes, reads empty again", async () => {
    const empty = await libraryGET(getRequest("/experience/library", identityHeaders()));
    expect(empty.status).toBe(200);
    expect(await json(empty)).toEqual([]);

    const add = await libraryPOST(
      postRequest(
        "/experience/library",
        { op: "add", externalRef: ZOO_REF, title: "Me at the zoo (saved)" },
        identityHeaders(),
      ),
    );
    expect(add.status).toBe(200);
    const addReceipt = (await json(add)) as ActionReceipt;
    expect(isUsableReceipt(addReceipt)).toBe(true);
    expect(addReceipt.status).toBe("confirmed");

    const reading = await libraryGET(getRequest("/experience/library", identityHeaders()));
    const entries = (await json(reading)) as LibraryEntry[];
    expect(entries).toHaveLength(1);
    for (const entry of entries) {
      expect(isUsableLibraryEntry(entry), `entry: ${JSON.stringify(entry)}`).toBe(true);
    }
    expect(entries[0]).toMatchObject({
      connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
      externalRef: ZOO_REF,
      title: "Me at the zoo (saved)",
      addedAt: OCCURRED_AT,
    });

    const remove = await libraryPOST(
      postRequest(
        "/experience/library",
        { op: "remove", externalRef: ZOO_REF },
        identityHeaders(),
      ),
    );
    expect(remove.status).toBe(200);
    expect(((await json(remove)) as ActionReceipt).status).toBe("confirmed");

    const emptied = await libraryGET(getRequest("/experience/library", identityHeaders()));
    expect(await json(emptied)).toEqual([]);

    // Removing an absent entry is an honest failed receipt, not a crash.
    const again = await libraryPOST(
      postRequest("/experience/library", { op: "remove", externalRef: ZOO_REF }, identityHeaders()),
    );
    const againReceipt = (await json(again)) as ActionReceipt;
    expect(againReceipt.status).toBe("failed");
    expect(againReceipt.detail).toContain("not present");
  });
});

describe("POST /experience/events — the durability law", () => {
  it("answers {ok:true} and the event_outbox row EXISTS (durable the moment 2xx)", async () => {
    const event = {
      userId: "wfx-api-test-user",
      itemId: seeded.itemId,
      type: "start",
      occurredAt: "2026-09-16T10:00:00.000Z",
      sessionId: "wfxpses_00000000000000000000000009",
      payload: { positionMs: 1_000 },
    };
    const response = await eventsPOST(
      postRequest("/experience/events", event, {
        "x-wfx-user-id": "wfx-api-test-user",
        "x-wfx-session-id": "wfxpses_00000000000000000000000009",
      }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });

    const rows = await harness.testDb.db.query<{
      id: string;
      status: string;
      event_type: string;
      envelope: { event: { type: string; itemId: string; payload?: { positionMs?: number } } };
    }>(
      `SELECT id, status, event_type, envelope FROM event_outbox
        WHERE user_id = $1 AND event_type = 'start'`,
      ["wfx-api-test-user"],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error("no outbox row");
    expect(row.id.startsWith("wfxevt_")).toBe(true);
    expect(row.status).toBe("pending"); // durable, awaiting relay delivery
    expect(row.envelope.event.type).toBe("start");
    expect(row.envelope.event.itemId).toBe(seeded.itemId);
    expect(row.envelope.event.payload?.positionMs).toBe(1_000);
  });
});

// ---------------------------------------------------------------------------
// Typed 400s — the garbage channel (validated BEFORE any boot work)
// ---------------------------------------------------------------------------

describe("typed 400s — absent or garbage identity", () => {
  it("absent x-wfx-user-id is a 400 naming the header, on every endpoint", async () => {
    const cases: readonly [string, Promise<Response>][] = [
      ["search", searchGET(getRequest("/experience/search?query=rain"))],
      ["metadata", metadataGET(getRequest(`/experience/metadata?ref=${MONARCHY_REF}`))],
      ["resolve", resolveGET(getRequest(`/experience/resolve?ref=${MONARCHY_REF}`))],
      [
        "actions",
        actionsPOST(
          postRequest("/experience/actions", {
            type: "like",
            connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
            externalRef: ZOO_REF,
          }),
        ),
      ],
      ["library GET", libraryGET(getRequest("/experience/library"))],
      [
        "library POST",
        libraryPOST(postRequest("/experience/library", { op: "add", externalRef: ZOO_REF })),
      ],
      [
        "events",
        eventsPOST(
          postRequest("/experience/events", {
            userId: "u",
            itemId: seeded.itemId,
            type: "start",
            occurredAt: "2026-09-16T10:00:00.000Z",
            sessionId: "s",
          }),
        ),
      ],
    ];
    for (const [name, call] of cases) {
      const response = await call;
      expect(response.status, name).toBe(400);
      const body = (await json(response)) as { error: string; detail: string };
      expect(body.error).toBe("invalid-request");
      expect(body.detail).toContain("x-wfx-user-id");
    }
  });

  it("garbage x-wfx-user-id (whitespace-only / control chars) is a 400", async () => {
    for (const value of ["   ", "bad\u0007id"]) {
      const response = await searchGET(
        getRequest("/experience/search?query=rain", { "x-wfx-user-id": value }),
      );
      expect(response.status, `value: ${JSON.stringify(value)}`).toBe(400);
      const body = (await json(response)) as { detail: string };
      expect(body.detail).toContain("x-wfx-user-id");
    }
  });

  it("garbage optional identity headers (session / locale / region) are 400s", async () => {
    for (const headers of [
      { "x-wfx-user-id": "u", "x-wfx-session-id": "sess\u0001" },
      { "x-wfx-user-id": "u", "x-wfx-locale": "en US" },
      { "x-wfx-user-id": "u", "x-wfx-region": "U S" },
    ]) {
      const response = await searchGET(getRequest("/experience/search?query=rain", headers));
      expect(response.status, `headers: ${JSON.stringify(headers)}`).toBe(400);
    }
  });
});

describe("typed 400s — bad params", () => {
  it("search: absent / empty / over-length query", async () => {
    for (const [name, url] of [
      ["absent", "/experience/search"],
      ["empty", "/experience/search?query=%20%20%20"],
      ["over-length", `/experience/search?query=${"x".repeat(501)}`],
    ] as const) {
      const response = await searchGET(getRequest(url, identityHeaders()));
      expect(response.status, name).toBe(400);
      const body = (await json(response)) as { detail: string };
      expect(body.detail).toContain("query");
    }
  });

  it("metadata + resolve: absent / empty ref", async () => {
    for (const [name, call] of [
      ["metadata absent", metadataGET(getRequest("/experience/metadata", identityHeaders()))],
      ["metadata empty", metadataGET(getRequest("/experience/metadata?ref=%20", identityHeaders()))],
      ["resolve absent", resolveGET(getRequest("/experience/resolve", identityHeaders()))],
      ["resolve empty", resolveGET(getRequest("/experience/resolve?ref=%20", identityHeaders()))],
    ] as const) {
      const response = await call;
      expect(response.status, name).toBe(400);
      const body = (await json(response)) as { detail: string };
      expect(body.detail).toContain("ref");
    }
  });
});

describe("typed 400s — garbage POST bodies", () => {
  it("actions: non-JSON, empty, non-object, and field failures are 400s naming fields", async () => {
    const cases: readonly [string, unknown][] = [
      ["not JSON", "{definitely not json"],
      ["empty body", ""],
      ["a JSON array", [1, 2, 3]],
      ["missing type", { connectorId: "c", externalRef: "r" }],
      ["bad type", { type: "subscribe", connectorId: "c", externalRef: "r" }],
      ["blank connectorId", { type: "like", connectorId: "  ", externalRef: "r" }],
      ["blank externalRef", { type: "like", connectorId: "c", externalRef: "\t" }],
      ["payload not an object", { type: "like", connectorId: "c", externalRef: "r", payload: "x" }],
    ];
    for (const [name, body] of cases) {
      const response = await actionsPOST(
        postRequest("/experience/actions", body, identityHeaders()),
      );
      expect(response.status, name).toBe(400);
      const parsed = (await json(response)) as { detail: string };
      expect(parsed.detail.length).toBeGreaterThan(0);
    }
    // The one-answer-names-every-problem law.
    const multi = await actionsPOST(
      postRequest("/experience/actions", { type: "subscribe" }, identityHeaders()),
    );
    const detail = ((await json(multi)) as { detail: string }).detail;
    expect(detail).toContain("action.type");
    expect(detail).toContain("action.connectorId");
    expect(detail).toContain("action.externalRef");
  });

  it("library POST: non-JSON and field failures are 400s naming fields", async () => {
    for (const [name, body] of [
      ["not JSON", "{nope"],
      ["bad op", { op: "rename", externalRef: "r" }],
      ["missing externalRef", { op: "add" }],
      ["title not a string", { op: "add", externalRef: "r", title: 5 }],
    ] as const) {
      const response = await libraryPOST(
        postRequest("/experience/library", body, identityHeaders()),
      );
      expect(response.status, name).toBe(400);
    }
  });

  it("events: non-JSON, malformed events, and identity mismatches are 400s", async () => {
    const validEvent = {
      userId: "wfx-api-test-user",
      itemId: seeded.itemId,
      type: "progress",
      occurredAt: "2026-09-16T10:00:00.000Z",
      sessionId: "wfxpses_00000000000000000000000009",
    };
    const identity = {
      "x-wfx-user-id": "wfx-api-test-user",
      "x-wfx-session-id": "wfxpses_00000000000000000000000009",
    };
    const cases: readonly [string, unknown, Record<string, string>][] = [
      ["not JSON", "{nope", identity],
      ["bad itemId", { ...validEvent, itemId: "not-a-canonical-id" }, identity],
      ["bad type", { ...validEvent, type: "explode" }, identity],
      ["bad occurredAt", { ...validEvent, occurredAt: "yesterday" }, identity],
      [
        "userId mismatch",
        { ...validEvent, userId: "someone-else" },
        { "x-wfx-user-id": "wfx-api-test-user" },
      ],
      [
        "sessionId mismatch",
        validEvent,
        { "x-wfx-user-id": "wfx-api-test-user", "x-wfx-session-id": "a-different-session" },
      ],
    ];
    for (const [name, body, headers] of cases) {
      const response = await eventsPOST(postRequest("/experience/events", body, headers));
      expect(response.status, name).toBe(400);
      const parsed = (await json(response)) as { detail: string };
      expect(parsed.detail.length).toBeGreaterThan(0);
    }
    // No outbox row was written by any of the garbage.
    const rows = await harness.testDb.db.query<{ id: string }>(
      `SELECT id FROM event_outbox WHERE user_id = $1 AND event_type = 'progress'`,
      ["wfx-api-test-user"],
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Degradation mappings — the DB is down (PGlite client closed)
// ---------------------------------------------------------------------------

describe("degradation mappings — the DB is killed (reads []/null, receipts failed, events 502)", () => {
  let dead: ApiTestBoot;

  beforeAll(async () => {
    dead = await createApiTestBoot();
    await dead.testDb.close(); // kill the database under a booted composition
    setApiBootForTests(dead.boot);
  });
  afterAll(() => {
    setApiBootForTests(harness.boot); // restore the healthy composition
  });

  it("reads degrade to the honest typed empty answers (200, never 5xx)", async () => {
    const search = await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    expect(search.status).toBe(200);
    expect(await json(search)).toEqual([]);

    const metadata = await metadataGET(
      getRequest(`/experience/metadata?ref=${MONARCHY_REF}`, identityHeaders()),
    );
    expect(metadata.status).toBe(200);
    expect(await json(metadata)).toBeNull();

    const resolve = await resolveGET(
      getRequest(`/experience/resolve?ref=${MONARCHY_REF}`, identityHeaders()),
    );
    expect(resolve.status).toBe(200);
    expect(await json(resolve)).toEqual([]);

    const library = await libraryGET(getRequest("/experience/library", identityHeaders()));
    expect(library.status).toBe(200);
    expect(await json(library)).toEqual([]);
  });

  it("the degradation is DIAGNOSABLE — the fan-out records the source failure", async () => {
    await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    const degradations = dead.boot.connector.lastDegradations();
    expect(degradations.get("webflix-catalog")).toContain("search");
  });

  it("write receipts degrade to failed (200, the client's own transport shape)", async () => {
    const actions = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: ZOO_REF },
        identityHeaders(),
      ),
    );
    expect(actions.status).toBe(200);
    const receipt = (await json(actions)) as ActionReceipt;
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("webflix-catalog");
    expect(isUsableReceipt(receipt)).toBe(true);

    const library = await libraryPOST(
      postRequest(
        "/experience/library",
        { op: "add", externalRef: ZOO_REF, title: "t" },
        identityHeaders(),
      ),
    );
    expect(library.status).toBe(200);
    const libraryReceipt = (await json(library)) as ActionReceipt;
    expect(libraryReceipt.status).toBe("failed");
    expect(isUsableReceipt(libraryReceipt)).toBe(true);
  });

  it("events answer 502 — a lost watch event is NEVER a silent success", async () => {
    const response = await eventsPOST(
      postRequest(
        "/experience/events",
        {
          userId: "wfx-api-test-user",
          itemId: seeded.itemId,
          type: "start",
          occurredAt: "2026-09-16T10:00:00.000Z",
          sessionId: "wfxpses_00000000000000000000000009",
        },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(502);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("event-sink-unavailable");
    expect(body.detail.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The boot law via the seam — loud config crimes vs the degradation family
// ---------------------------------------------------------------------------

describe("the boot-failure classification (failApiBootForTests)", () => {
  afterEach(() => {
    setApiBootForTests(harness.boot);
  });

  it("a LOUD config crime answers the typed 500 boot-failed on every route", async () => {
    failApiBootForTests(
      new ApiConfigError(
        "missing required service environment variables: DATABASE_URL, APP_ENCRYPTION_KEY. " +
          "The Experience API boots the real persistence layer; there is no fixture fallback " +
          "in the service lane",
        ["DATABASE_URL", "APP_ENCRYPTION_KEY"],
      ),
    );
    const calls: readonly [string, Promise<Response>][] = [
      ["search", searchGET(getRequest("/experience/search?query=rain", identityHeaders()))],
      [
        "metadata",
        metadataGET(getRequest(`/experience/metadata?ref=${MONARCHY_REF}`, identityHeaders())),
      ],
      [
        "resolve",
        resolveGET(getRequest(`/experience/resolve?ref=${MONARCHY_REF}`, identityHeaders())),
      ],
      [
        "actions",
        actionsPOST(
          postRequest(
            "/experience/actions",
            { type: "like", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: ZOO_REF },
            identityHeaders(),
          ),
        ),
      ],
      ["library GET", libraryGET(getRequest("/experience/library", identityHeaders()))],
      [
        "library POST",
        libraryPOST(
          postRequest("/experience/library", { op: "add", externalRef: ZOO_REF }, identityHeaders()),
        ),
      ],
      [
        "events",
        eventsPOST(
          postRequest(
            "/experience/events",
            {
              userId: "wfx-api-test-user",
              itemId: seeded.itemId,
              type: "start",
              occurredAt: "2026-09-16T10:00:00.000Z",
              sessionId: "wfxpses_00000000000000000000000009",
            },
            identityHeaders(),
          ),
        ),
      ],
    ];
    for (const [name, call] of calls) {
      const response = await call;
      expect(response.status, name).toBe(500);
      const body = (await json(response)) as { error: string; detail: string };
      expect(body.error).toBe("boot-failed");
      // Loud AND actionable: the typed detail names the offending variables.
      expect(body.detail).toContain("DATABASE_URL");
      expect(body.detail).toContain("APP_ENCRYPTION_KEY");
    }
  });

  it("the 052 DEGRADATION family answers honest degraded answers (the WFX-003 law)", async () => {
    failApiBootForTests(new DataSourceUnavailable("neon compute is suspended (test seam)"));
    const search = await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    expect(search.status).toBe(200);
    expect(await json(search)).toEqual([]);

    const metadata = await metadataGET(
      getRequest(`/experience/metadata?ref=${MONARCHY_REF}`, identityHeaders()),
    );
    expect(metadata.status).toBe(200);
    expect(await json(metadata)).toBeNull();

    const resolve = await resolveGET(
      getRequest(`/experience/resolve?ref=${MONARCHY_REF}`, identityHeaders()),
    );
    expect(resolve.status).toBe(200);
    expect(await json(resolve)).toEqual([]);

    const library = await libraryGET(getRequest("/experience/library", identityHeaders()));
    expect(library.status).toBe(200);
    expect(await json(library)).toEqual([]);

    const actions = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: ZOO_REF },
        identityHeaders(),
      ),
    );
    expect(actions.status).toBe(200);
    const receipt = (await json(actions)) as ActionReceipt;
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("service boot failed");
    expect(isUsableReceipt(receipt)).toBe(true);

    const events = await eventsPOST(
      postRequest(
        "/experience/events",
        {
          userId: "wfx-api-test-user",
          itemId: seeded.itemId,
          type: "start",
          occurredAt: "2026-09-16T10:00:00.000Z",
          sessionId: "wfxpses_00000000000000000000000009",
        },
        identityHeaders(),
      ),
    );
    expect(events.status).toBe(502);
    expect(((await json(events)) as { error: string }).error).toBe("event-sink-unavailable");
  });
});

// ---------------------------------------------------------------------------
// The NATURAL boot law — a scrubbed process.env boots loudly, never fakely
// ---------------------------------------------------------------------------

describe("the natural boot env law (reset slot, scrubbed process.env)", () => {
  const KEYS = ["DATABASE_URL", "APP_ENCRYPTION_KEY", "WFX_DEV_FIXTURES"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of KEYS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    setApiBootForTests(harness.boot);
  });

  it("missing required variables answer the typed 500 boot-failed naming them", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.WFX_DEV_FIXTURES;
    resetApiBootForTests();

    const response = await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    expect(response.status).toBe(500);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("boot-failed");
    expect(body.detail).toContain("DATABASE_URL");
    expect(body.detail).toContain("APP_ENCRYPTION_KEY");

    const events = await eventsPOST(
      postRequest(
        "/experience/events",
        {
          userId: "wfx-api-test-user",
          itemId: seeded.itemId,
          type: "start",
          occurredAt: "2026-09-16T10:00:00.000Z",
          sessionId: "wfxpses_00000000000000000000000009",
        },
        identityHeaders(),
      ),
    );
    expect(events.status).toBe(500);
    expect(((await json(events)) as { error: string }).error).toBe("boot-failed");
  });

  it("WFX_DEV_FIXTURES is refused — the service lane has NO fixture mode", async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY_BASE64;
    process.env.WFX_DEV_FIXTURES = "1";
    resetApiBootForTests();

    const response = await searchGET(getRequest("/experience/search?query=rain", identityHeaders()));
    expect(response.status).toBe(500);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("boot-failed");
    expect(body.detail).toContain("WFX_DEV_FIXTURES");
    expect(body.detail).toContain("NO fixture mode");
  });
});

// ---------------------------------------------------------------------------
// The relay route — the CRON_SECRET bearer law + the drain
// ---------------------------------------------------------------------------

describe("the relay route — CRON_SECRET bearer law + the real drain", () => {
  const CRON_SECRET_VALUE = "wfx-test-cron-secret-0123456789abcdef";
  const bearer = { authorization: `Bearer ${CRON_SECRET_VALUE}` };
  const ENV_KEYS = ["DATABASE_URL", "APP_ENCRYPTION_KEY", "CRON_SECRET", "NODE_ENV"] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(() => {
    // The relay route resolves its config from process.env (never connects —
    // only the law is consulted before the slot's boot drains).
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY_BASE64;
    process.env.CRON_SECRET = CRON_SECRET_VALUE;
    setEnvVar("NODE_ENV", "test");
  });
  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else setEnvVar(key, value);
    }
  });
  afterEach(() => {
    process.env.CRON_SECRET = CRON_SECRET_VALUE;
    setEnvVar("NODE_ENV", "test");
    setApiBootForTests(harness.boot);
  });

  it("set + matching bearer DRAINS (GET — the Vercel cron method)", async () => {
    const response = await relayGET(getRequest("/api/relay", bearer));
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      ok: boolean;
      requeued: number;
      claimed: number;
      delivered: number;
      rescheduled: number;
      failed: number;
    };
    expect(body.ok).toBe(true);
    // The ledger: this file enqueued exactly three outbox rows before this
    // point — the like action's 'like' event, the library add's 'save'
    // event, and the events endpoint's 'start' event. All were pending at
    // the 30s clock, all due, all delivered.
    expect(body.requeued).toBe(0);
    expect(body.claimed).toBe(3);
    expect(body.delivered).toBe(3);
    expect(body.rescheduled).toBe(0);
    expect(body.failed).toBe(0);

    // The real downstream: the start event folded into watch_history.
    const rows = await harness.testDb.db.query<{
      position_ms: unknown;
      completed: boolean;
      last_event_type: string;
    }>(
      `SELECT position_ms, completed, last_event_type FROM watch_history
        WHERE user_id = $1 AND item_id = $2`,
      ["wfx-api-test-user", seeded.itemId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error("no watch_history row");
    expect(Number(row.position_ms)).toBe(1_000);
    expect(row.completed).toBe(false);
    expect(row.last_event_type).toBe("start");
  });

  it("set + wrong or missing bearer ⇒ typed 401 (the relay never drifts open)", async () => {
    const wrong = await relayGET(
      getRequest("/api/relay", { authorization: "Bearer definitely-not-the-secret" }),
    );
    expect(wrong.status).toBe(401);
    expect(((await json(wrong)) as { error: string }).error).toBe("unauthorized");

    const missing = await relayGET(getRequest("/api/relay"));
    expect(missing.status).toBe(401);
    expect(((await json(missing)) as { error: string }).error).toBe("unauthorized");

    const wrongPost = await relayPOST(
      postRequest("/api/relay", "", { authorization: "Bearer nope" }),
    );
    expect(wrongPost.status).toBe(401);
  });

  it("POST under the same law (manual / operator tooling)", async () => {
    const response = await relayPOST(postRequest("/api/relay", "", bearer));
    expect(response.status).toBe(200);
    const body = (await json(response)) as { ok: boolean; claimed: number };
    expect(body.ok).toBe(true);
    expect(body.claimed).toBe(0); // everything already delivered
  });

  it("unset + NODE_ENV=production ⇒ typed 500 relay-unconfigured", async () => {
    delete process.env.CRON_SECRET;
    setEnvVar("NODE_ENV", "production");
    const response = await relayGET(getRequest("/api/relay", bearer));
    expect(response.status).toBe(500);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("relay-unconfigured");
    expect(body.detail).toContain("CRON_SECRET");
  });

  it("unset outside production ⇒ allowed (documented local draining)", async () => {
    delete process.env.CRON_SECRET;
    setEnvVar("NODE_ENV", "test");
    const response = await relayGET(getRequest("/api/relay"));
    expect(response.status).toBe(200);
    expect(((await json(response)) as { ok: boolean }).ok).toBe(true);
  });

  it("degraded boot ⇒ 502 relay-failed (honest, never fabricated)", async () => {
    failApiBootForTests(new DataSourceUnavailable("neon compute is suspended (test seam)"));
    const response = await relayGET(getRequest("/api/relay", bearer));
    expect(response.status).toBe(502);
    expect(((await json(response)) as { error: string }).error).toBe("relay-failed");
  });

  it("loud boot failure ⇒ typed 500 boot-failed", async () => {
    failApiBootForTests(
      new ApiConfigError("missing required service environment variables: DATABASE_URL", [
        "DATABASE_URL",
      ]),
    );
    const response = await relayGET(getRequest("/api/relay", bearer));
    expect(response.status).toBe(500);
    expect(((await json(response)) as { error: string }).error).toBe("boot-failed");
  });
});
