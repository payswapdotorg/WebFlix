/**
 * R05 — recommendation-controls handler tests (bun:test, PGlite harness).
 *
 * Exercises the `/experience/{policy,intents,feedback}/**` routes by
 * importing their GET/POST/PUT/DELETE functions directly (no server, no
 * network) over the COMPLETE `ApiBoot` composition.
 *
 * Acceptance points (the R05 spec §1 + §5):
 * - POLICY: GET/PUT round-trip; the HONEST null for an unset profile (never
 *   a fabricated default); typed 400s naming EVERY problem; typed 401 for
 *   malformed bearers; merge semantics (stable id, preserved dials).
 * - INTENTS: submit/list/delete round-trip; SCOPE TRUTH 400s (temporary
 *   requires a FUTURE ISO expiry — missing and past both named);
 *   one-objective-per-scope UPDATE-in-place (stable id, evidenceCount +1,
 *   never a duplicate); LIVE EXPIRY filtered at read time (clock advanced).
 * - FEEDBACK: the J15 control set as typed records; idempotent re-submit;
 *   DELETE = the undo law; the event_outbox UNTOUCHED (the R04 event-sink
 *   law — feedback never falsifies recorded viewing events).
 * - PROFILE ISOLATION: two accounts — and two profiles within one account —
 *   never see each other's controls.
 *
 * Determinism: FixedClock(30s)/SequentialIdGen; no network.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import { POST as registerPOST } from "../src/app/auth/register/route";
import { POST as loginPOST } from "../src/app/auth/login/route";
import { GET as policyGET, PUT as policyPUT } from "../src/app/experience/policy/route";
import { GET as intentsGET, POST as intentsPOST } from "../src/app/experience/intents/route";
import { DELETE as intentDELETE } from "../src/app/experience/intents/[id]/route";
import { GET as feedbackGET, POST as feedbackPOST } from "../src/app/experience/feedback/route";
import { DELETE as feedbackDELETE } from "../src/app/experience/feedback/[id]/route";
import { PUT as profilesPUT } from "../src/app/profiles/route";
import { PUT as selectPUT } from "../src/app/profiles/[id]/select/route";
import {
  createApiTestBoot,
  deleteRequest,
  getRequest,
  identityHeaders,
  postRequest,
  putRequest,
  readSeededRow,
  type ApiTestBoot,
} from "./test-boot";

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/** The auth channel for one session token. */
function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

interface AuthShape {
  token: string;
  user: { id: string; email: string };
  profiles: { id: string; displayName: string; isDefault: boolean }[];
  activeProfileId: string;
}

let harness: ApiTestBoot;
let seeded: { itemId: string; externalRef: string; title: string };
let tokenA: string;
let userAId: string;
let tokenB: string;

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);
  seeded = await readSeededRow(harness.testDb.db);

  const registerA = await registerPOST(
    postRequest("/auth/register", {
      email: "controls-a@example.com",
      password: "correct-horse-battery",
      displayName: "Controls A",
    }),
  );
  expect(registerA.status).toBe(200);
  const a = (await json(registerA)) as AuthShape;
  tokenA = a.token;
  userAId = a.user.id;

  const registerB = await registerPOST(
    postRequest("/auth/register", {
      email: "controls-b@example.com",
      password: "correct-horse-staple",
      displayName: "Controls B",
    }),
  );
  expect(registerB.status).toBe(200);
  const b = (await json(registerB)) as AuthShape;
  tokenB = b.token;
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

// ---------------------------------------------------------------------------
// /experience/policy
// ---------------------------------------------------------------------------

describe("GET/PUT /experience/policy", () => {
  it("answers the HONEST null for a fresh profile (never a fabricated default)", async () => {
    const response = await policyGET(getRequest("/experience/policy", bearer(tokenA)));
    expect(response.status).toBe(200);
    expect(await json(response)).toBeNull();
  });

  it("anonymous requests keep the default-profile fallback (honest null first)", async () => {
    const response = await policyGET(getRequest("/experience/policy", identityHeaders()));
    expect(response.status).toBe(200);
    expect(await json(response)).toBeNull();
  });

  it("PUT then GET round-trips the frozen RecommendationPolicy shape", async () => {
    const put = await policyPUT(
      putRequest(
        "/experience/policy",
        { attentionMode: "mindful", exploration: 0.7, novelty: 0.4, socialInfluence: 0.1 },
        bearer(tokenA),
      ),
    );
    expect(put.status).toBe(200);
    const policy = (await json(put)) as {
      id: string;
      userId: string;
      objectives: unknown[];
      exploration: number;
      novelty: number;
      socialInfluence: number;
      attentionMode: string;
    };
    expect(policy.id.startsWith("wfxpol_")).toBe(true);
    expect(policy.userId).toBe(userAId);
    expect(policy.objectives).toEqual([]);
    expect(policy.exploration).toBe(0.7);
    expect(policy.novelty).toBe(0.4);
    expect(policy.socialInfluence).toBe(0.1);
    expect(policy.attentionMode).toBe("mindful");

    const get = await policyGET(getRequest("/experience/policy", bearer(tokenA)));
    expect(get.status).toBe(200);
    const reread = (await json(get)) as typeof policy;
    expect(reread.id).toBe(policy.id); // stable id
    expect(reread.attentionMode).toBe("mindful");
    expect(reread.exploration).toBe(0.7);
  });

  it("a second PUT MERGES: mode changes, unmentioned dials keep their stored values", async () => {
    const put = await policyPUT(
      putRequest("/experience/policy", { attentionMode: "immersive" }, bearer(tokenA)),
    );
    expect(put.status).toBe(200);
    const policy = (await json(put)) as { exploration: number; attentionMode: string };
    expect(policy.attentionMode).toBe("immersive");
    expect(policy.exploration).toBe(0.7); // preserved — not reset to the default
  });

  it("rejects a malformed command with ONE typed 400 naming EVERY problem", async () => {
    const put = await policyPUT(
      putRequest(
        "/experience/policy",
        { attentionMode: "chaotic", exploration: 1.5, novelty: -1, socialInfluence: "high" },
        bearer(tokenA),
      ),
    );
    expect(put.status).toBe(400);
    const body = (await json(put)) as { detail: string };
    expect(body.detail).toContain("attentionMode");
    expect(body.detail).toContain("exploration");
    expect(body.detail).toContain("novelty");
    expect(body.detail).toContain("socialInfluence");
  });

  it("rejects a non-JSON body with a typed 400", async () => {
    const put = await policyPUT(
      putRequest("/experience/policy", "{not-json", bearer(tokenA)),
    );
    expect(put.status).toBe(400);
  });

  it("a malformed Authorization answers the typed 401", async () => {
    const get = await policyGET(
      getRequest("/experience/policy", { authorization: "Basic chaos" }),
    );
    expect(get.status).toBe(401);
    const put = await policyPUT(
      putRequest("/experience/policy", { attentionMode: "balanced" }, {
        authorization: "Bearer not-a-canonical-token",
      }),
    );
    expect(put.status).toBe(401);
  });

  it("the anonymous transition round-trips (the x-wfx-user-id pseudo bucket)", async () => {
    const put = await policyPUT(
      putRequest("/experience/policy", { attentionMode: "custom", exploration: 0.9 }, identityHeaders()),
    );
    expect(put.status).toBe(200);
    const get = await policyGET(getRequest("/experience/policy", identityHeaders()));
    const policy = (await json(get)) as { attentionMode: string; exploration: number };
    expect(policy.attentionMode).toBe("custom");
    expect(policy.exploration).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// /experience/intents
// ---------------------------------------------------------------------------

describe("GET/POST/DELETE /experience/intents", () => {
  it("submits an intent and lists it back (the frozen IntentRecord wire shape)", async () => {
    const post = await intentsPOST(
      postRequest(
        "/experience/intents",
        { objective: "cozy comedies tonight", scope: "persistent", weight: 0.8 },
        bearer(tokenA),
      ),
    );
    expect(post.status).toBe(200);
    const record = (await json(post)) as {
      id: string;
      userId: string;
      scope: string;
      objective: string;
      weight: number;
      confidence: number;
      provenance: string;
      evidenceCount: number;
      createdAt: string;
      updatedAt: string;
    };
    expect(record.id.startsWith("wfxint_")).toBe(true);
    expect(record.userId).toBe(userAId);
    expect(record.scope).toBe("persistent");
    expect(record.objective).toBe("cozy comedies tonight");
    expect(record.weight).toBe(0.8);
    expect(record.confidence).toBe(1); // explicit submission is certain
    expect(record.provenance).toBe("explicit");
    expect(record.evidenceCount).toBe(1);

    const list = await intentsGET(getRequest("/experience/intents", bearer(tokenA)));
    expect(list.status).toBe(200);
    const records = (await json(list)) as { id: string }[];
    expect(records.some((entry) => entry.id === record.id)).toBe(true);
  });

  it("SCOPE TRUTH: temporary without an expiry is a typed 400 naming the law", async () => {
    const post = await intentsPOST(
      postRequest("/experience/intents", { objective: "explore sci-fi", scope: "temporary" }, bearer(tokenA)),
    );
    expect(post.status).toBe(400);
    const body = (await json(post)) as { detail: string };
    expect(body.detail).toContain("expiresAt");
    expect(body.detail).toContain("REQUIRED for scope 'temporary'");
  });

  it("SCOPE TRUTH: a past expiry is rejected (the future law), and every problem is named at once", async () => {
    // The harness clock sits at epoch+30s — an expiry BEFORE that is past.
    const post = await intentsPOST(
      postRequest(
        "/experience/intents",
        { objective: "", scope: "temporary", expiresAt: "1969-12-31T23:59:59.000Z", weight: 5, provenance: "guessed" },
        bearer(tokenA),
      ),
    );
    expect(post.status).toBe(400);
    const body = (await json(post)) as { detail: string };
    expect(body.detail).toContain("objective");
    expect(body.detail).toContain("already past");
    expect(body.detail).toContain("weight");
    expect(body.detail).toContain("provenance");
  });

  it("SCOPE TRUTH: an unknown scope is a typed 400", async () => {
    const post = await intentsPOST(
      postRequest("/experience/intents", { objective: "x", scope: "eternal" }, bearer(tokenA)),
    );
    expect(post.status).toBe(400);
    const body = (await json(post)) as { detail: string };
    expect(body.detail).toContain("scope");
  });

  it("ONE OBJECTIVE PER SCOPE: re-submitting updates in place — stable id, evidenceCount +1, no duplicate", async () => {
    const first = await intentsPOST(
      postRequest("/experience/intents", { objective: "learn chess", scope: "persistent" }, bearer(tokenA)),
    );
    const firstRecord = (await json(first)) as { id: string; evidenceCount: number };
    const second = await intentsPOST(
      postRequest("/experience/intents", { objective: "learn chess", scope: "persistent", weight: 0.6 }, bearer(tokenA)),
    );
    const secondRecord = (await json(second)) as {
      id: string;
      weight: number;
      evidenceCount: number;
    };
    expect(secondRecord.id).toBe(firstRecord.id); // the canonical id stays
    expect(secondRecord.evidenceCount).toBe(2); // every submission is evidence
    expect(secondRecord.weight).toBe(0.6); // the R01 update law
    const list = await intentsGET(getRequest("/experience/intents", bearer(tokenA)));
    const matches = ((await json(list)) as { objective: string; scope: string }[]).filter(
      (entry) => entry.scope === "persistent" && entry.objective === "learn chess",
    );
    expect(matches.length).toBe(1); // never a duplicate
  });

  it("LIVE EXPIRY: an expired temporary intent leaves the read set when the clock passes it", async () => {
    const expiresAt = new Date(harness.clock.now() + 60_000).toISOString();
    const post = await intentsPOST(
      postRequest(
        "/experience/intents",
        { objective: "documentaries this evening", scope: "temporary", expiresAt },
        bearer(tokenA),
      ),
    );
    expect(post.status).toBe(200);
    const record = (await json(post)) as { id: string };
    let list = await intentsGET(getRequest("/experience/intents", bearer(tokenA)));
    expect(((await json(list)) as { id: string }[]).some((entry) => entry.id === record.id)).toBe(true);

    // The clock passes the expiry — the read filters it (the R01 law,
    // server-side).
    harness.clock.advance(120_000);
    list = await intentsGET(getRequest("/experience/intents", bearer(tokenA)));
    expect(((await json(list)) as { id: string }[]).some((entry) => entry.id === record.id)).toBe(false);
  });

  it("DELETE is the undo law: the intent is gone; a foreign profile sees the honest 404", async () => {
    const post = await intentsPOST(
      postRequest("/experience/intents", { objective: "delete me", scope: "session" }, bearer(tokenA)),
    );
    const record = (await json(post)) as { id: string };
    const remove = await intentDELETE(
      deleteRequest(`/experience/intents/${record.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(remove.status).toBe(200);

    // A second intent, which profile B must NOT be able to delete.
    const post2 = await intentsPOST(
      postRequest("/experience/intents", { objective: "private to A", scope: "persistent" }, bearer(tokenA)),
    );
    const record2 = (await json(post2)) as { id: string };
    const foreign = await intentDELETE(
      deleteRequest(`/experience/intents/${record2.id}`, bearer(tokenB)),
      { params: Promise.resolve({ id: record2.id }) },
    );
    expect(foreign.status).toBe(404);

    // A malformed id is a typed 400.
    const malformed = await intentDELETE(
      deleteRequest("/experience/intents/not-an-intent-id", bearer(tokenA)),
      { params: Promise.resolve({ id: "not-an-intent-id" }) },
    );
    expect(malformed.status).toBe(400);
  });

  it("a malformed Authorization answers the typed 401", async () => {
    const get = await intentsGET(
      getRequest("/experience/intents", { authorization: "Bearer nope" }),
    );
    expect(get.status).toBe(401);
  });

  it("the anonymous transition round-trips (the pseudo bucket)", async () => {
    const post = await intentsPOST(
      postRequest("/experience/intents", { objective: "anonymous exploration", scope: "persistent" }, identityHeaders()),
    );
    expect(post.status).toBe(200);
    const list = await intentsGET(getRequest("/experience/intents", identityHeaders()));
    const records = (await json(list)) as { objective: string }[];
    expect(records.some((entry) => entry.objective === "anonymous exploration")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /experience/feedback
// ---------------------------------------------------------------------------

describe("GET/POST/DELETE /experience/feedback", () => {
  it("records every J15 control kind as a typed, timestamped, reversible record", async () => {
    for (const kind of [
      "more-like-this",
      "not-interested",
      "already-watched",
    ] as const) {
      const post = await feedbackPOST(
        postRequest("/experience/feedback", { kind, target: seeded.itemId }, bearer(tokenA)),
      );
      expect(post.status).toBe(200);
      const record = (await json(post)) as { id: string; kind: string; target: string; createdAt: string };
      expect(record.id.startsWith("wfxfb_")).toBe(true);
      expect(record.kind).toBe(kind);
      expect(record.target).toBe(seeded.itemId);
      expect(record.createdAt).toBe(new Date(harness.clock.now()).toISOString());
    }
    const sourcePost = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "dont-recommend-source", target: "youtube" }, bearer(tokenA)),
    );
    expect(sourcePost.status).toBe(200);
    const creatorPost = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "dont-recommend-creator", target: "wfxcreator_x", note: "too loud" }, bearer(tokenA)),
    );
    expect(creatorPost.status).toBe(200);
    const withNote = (await json(creatorPost)) as { note?: string };
    expect(withNote.note).toBe("too loud");

    const list = await feedbackGET(getRequest("/experience/feedback", bearer(tokenA)));
    const records = (await json(list)) as { kind: string }[];
    expect(records.length).toBe(5);
  });

  it("re-submitting the same control is IDEMPOTENT (the same record answers)", async () => {
    const first = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "not-interested", target: seeded.itemId }, bearer(tokenB)),
    );
    const firstRecord = (await json(first)) as { id: string; createdAt: string };
    const second = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "not-interested", target: seeded.itemId }, bearer(tokenB)),
    );
    const secondRecord = (await json(second)) as { id: string; createdAt: string };
    expect(secondRecord.id).toBe(firstRecord.id);
    expect(secondRecord.createdAt).toBe(firstRecord.createdAt);
    const list = await feedbackGET(getRequest("/experience/feedback", bearer(tokenB)));
    expect(((await json(list)) as unknown[]).length).toBe(1);
  });

  it("DELETE is the undo law: the control is GONE and the event_outbox is UNTOUCHED (the event-sink law)", async () => {
    const outboxBefore = await harness.testDb.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_outbox`,
    );
    const post = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "already-watched", target: seeded.itemId }, bearer(tokenB)),
    );
    const record = (await json(post)) as { id: string };
    const remove = await feedbackDELETE(
      deleteRequest(`/experience/feedback/${record.id}`, bearer(tokenB)),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(remove.status).toBe(200);
    const list = await feedbackGET(getRequest("/experience/feedback", bearer(tokenB)));
    const remaining = (await json(list)) as { id: string; kind: string }[];
    // The deleted control is GONE (B keeps only its own earlier control —
    // a different kind on the same item).
    expect(remaining.some((entry) => entry.id === record.id)).toBe(false);
    expect(remaining.every((entry) => entry.kind !== "already-watched")).toBe(true);
    const again = await feedbackDELETE(
      deleteRequest(`/experience/feedback/${record.id}`, bearer(tokenB)),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(again.status).toBe(404);

    const outboxAfter = await harness.testDb.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM event_outbox`,
    );
    expect(outboxAfter[0]!.count).toBe(outboxBefore[0]!.count); // audit truth intact
  });

  it("typed 400s: the closed vocabulary + per-kind target semantics + note length", async () => {
    const badKind = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "ban-everything", target: "x" }, bearer(tokenA)),
    );
    expect(badKind.status).toBe(400);
    expect(((await json(badKind)) as { detail: string }).detail).toContain("kind");

    const badTarget = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "not-interested", target: "youtube" }, bearer(tokenA)),
    );
    expect(badTarget.status).toBe(400);
    expect(((await json(badTarget)) as { detail: string }).detail).toContain("wfxitm_");

    const badNote = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "not-interested", target: seeded.itemId, note: "x".repeat(501) }, bearer(tokenA)),
    );
    expect(badNote.status).toBe(400);
    expect(((await json(badNote)) as { detail: string }).detail).toContain("note");
  });

  it("a malformed id answers the typed 400; a malformed Authorization answers the typed 401", async () => {
    const malformed = await feedbackDELETE(
      deleteRequest("/experience/feedback/nope", bearer(tokenA)),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(malformed.status).toBe(400);
    const unauthorized = await feedbackGET(
      getRequest("/experience/feedback", { authorization: "Bearer nope" }),
    );
    expect(unauthorized.status).toBe(401);
  });

  it("the anonymous transition round-trips", async () => {
    const post = await feedbackPOST(
      postRequest("/experience/feedback", { kind: "not-interested", target: seeded.itemId }, identityHeaders()),
    );
    expect(post.status).toBe(200);
    const list = await feedbackGET(getRequest("/experience/feedback", identityHeaders()));
    expect(((await json(list)) as unknown[]).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PROFILE ISOLATION — two accounts, and two profiles within one account
// ---------------------------------------------------------------------------

describe("profile isolation — two profiles never see each other's controls", () => {
  it("policy: A's policy is invisible to B (B still reads the honest null)", async () => {
    const put = await policyPUT(
      putRequest("/experience/policy", { attentionMode: "immersive" }, bearer(tokenA)),
    );
    expect(put.status).toBe(200);
    const getB = await policyGET(getRequest("/experience/policy", bearer(tokenB)));
    expect(getB.status).toBe(200);
    expect(await json(getB)).toBeNull();
  });

  it("intents: A's intents are invisible to B; B's delete is the honest 404", async () => {
    const post = await intentsPOST(
      postRequest("/experience/intents", { objective: "a private objective", scope: "persistent" }, bearer(tokenA)),
    );
    const record = (await json(post)) as { id: string };
    const listB = await intentsGET(getRequest("/experience/intents", bearer(tokenB)));
    const bRecords = (await json(listB)) as { id: string }[];
    expect(bRecords.some((entry) => entry.id === record.id)).toBe(false);
    const deleteB = await intentDELETE(
      deleteRequest(`/experience/intents/${record.id}`, bearer(tokenB)),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(deleteB.status).toBe(404);
  });

  it("feedback: A's controls are invisible to B", async () => {
    await feedbackPOST(
      postRequest("/experience/feedback", { kind: "not-interested", target: seeded.itemId }, bearer(tokenA)),
    );
    const listB = await feedbackGET(getRequest("/experience/feedback", bearer(tokenB)));
    // B's set holds only B's own idempotent control from the earlier test.
    const bRecords = (await json(listB)) as { kind: string; target: string }[];
    expect(bRecords.every((entry) => entry.target === seeded.itemId)).toBe(true);
    expect(bRecords.length).toBe(1); // B's own not-interested only
  });

  it("TWO PROFILES WITHIN ONE ACCOUNT are isolated buckets", async () => {
    // Create + select a second profile for user A.
    const create = await profilesPUT(
      postRequest("/profiles", { displayName: "Kids" }, bearer(tokenA)),
    );
    expect(create.status).toBe(200);
    const kidsId = ((await json(create)) as { profile: { id: string } }).profile.id;
    const select = await selectPUT(
      postRequest(`/profiles/${kidsId}/select`, {}, bearer(tokenA)),
      { params: Promise.resolve({ id: kidsId }) },
    );
    expect(select.status).toBe(200);

    // The Kids profile starts EMPTY (policy null, no intents, no feedback) —
    // the Main profile's controls never leak.
    const policy = await policyGET(getRequest("/experience/policy", bearer(tokenA)));
    expect(await json(policy)).toBeNull();
    const intents = await intentsGET(getRequest("/experience/intents", bearer(tokenA)));
    expect(await json(intents)).toEqual([]);
    const feedback = await feedbackGET(getRequest("/experience/feedback", bearer(tokenA)));
    expect(await json(feedback)).toEqual([]);

    // A control written under Kids does not leak back to Main (user B reads
    // their own; Main's read happens through a fresh default-profile
    // session — the register route gave user B exactly that shape).
    const post = await intentsPOST(
      postRequest("/experience/intents", { objective: "cartoons only", scope: "persistent" }, bearer(tokenA)),
    );
    expect(post.status).toBe(200);
    const kidsRecord = (await json(post)) as { id: string };
    // Main profile's session (a fresh login resolves the default profile).
    const freshLogin = await loginPOST(
      postRequest("/auth/login", {
        email: "controls-a@example.com",
        password: "correct-horse-battery",
      }),
    );
    const freshToken = ((await json(freshLogin)) as AuthShape).token;
    const mainIntents = await intentsGET(getRequest("/experience/intents", { authorization: `Bearer ${freshToken}` }));
    const mainRecords = (await json(mainIntents)) as { id: string }[];
    expect(mainRecords.some((entry) => entry.id === kidsRecord.id)).toBe(false);
  });
});
