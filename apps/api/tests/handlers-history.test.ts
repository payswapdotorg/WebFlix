/**
 * @wfx/app-api — R04 history handlers tests (bun:test).
 *
 * Exercises the `/experience/history/**` routes by importing their GET/POST/
 * DELETE functions directly and constructing `Request` objects (no server,
 * no network), over the COMPLETE `ApiBoot` composition built by
 * `tests/test-boot.ts`.
 *
 * Acceptance points (the R04 spec §2/§3/§5):
 * - `GET /experience/history` ROUND-TRIP: newest-first, PROFILE-SCOPED under
 *   Bearer (another profile of the same account sees none of it), the exact
 *   frozen `ProfileHistoryEntry` wire shape (itemId, positionMs, completed,
 *   lastEventType, updatedAt); anonymous answers the honest default-profile
 *   fallback (the R02 law).
 * - `DELETE /experience/history/:itemId` — REMOVAL: the item leaves the
 *   history READ MODEL (and Continue Watching) while the underlying events
 *   STAY RECORDED (the event-sink law — the event_outbox is asserted
 *   unchanged); a RE-WATCH re-materializes it through the REAL relay fold
 *   (`runRelayDrain` with the removal store — the R04 re-materialization
 *   hook).
 * - `POST /experience/history/exclusions` + `DELETE .../exclusions/:itemId`
 *   — EXCLUSION (J32): the item never appears in history-derived surfaces
 *   while events stay recorded; an exclusion PERSISTS across re-watches
 *   (the user's explicit choice — unlike a removal); removing the exclusion
 *   re-includes the item.
 * - CONTINUE WATCHING (J12): in-progress (not completed) items with a
 *   resumable position, ordered by most-recent progress, capped
 *   (the Netflix-style shelf), exclusion-aware, removal-aware.
 *
 * Determinism: FixedClock(30s)/SequentialIdGen; no network, no real DB.
 * The event-post count stays far below the opportunistic-drain
 * every-10-events trigger, and the 30s clock is never interval-due (60s),
 * so no stray drain disturbs the outbox assertions — delivery is driven
 * EXPLICITLY through `runRelayDrain`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import { GET as historyGET } from "../src/app/experience/history/route";
import { DELETE as historyItemDELETE } from "../src/app/experience/history/[itemId]/route";
import { POST as exclusionPOST } from "../src/app/experience/history/exclusions/route";
import { DELETE as exclusionItemDELETE } from "../src/app/experience/history/exclusions/[itemId]/route";
import { POST as eventsPOST } from "../src/app/experience/events/route";
import { PUT as profilesPUT } from "../src/app/profiles/route";
import { PUT as profileSelectPUT } from "../src/app/profiles/[id]/select/route";
import { POST as registerPOST } from "../src/app/auth/register/route";
import { runRelayDrain } from "../src/host/relay";
import {
  createApiTestBoot,
  deleteRequest,
  getRequest,
  identityHeaders,
  postRequest,
  type ApiTestBoot,
} from "./test-boot";

/** Deterministic instants for the watch folds (far from the 30s boot clock). */
const T_A = "1970-01-01T00:20:30.000Z"; // items[0] first progress
const T_B = "1970-01-01T00:30:30.000Z"; // items[1] first progress
const T_R = "1970-01-01T00:35:30.000Z"; // items[0] re-watch after removal
const T_S = "1970-01-01T00:36:30.000Z"; // items[0] re-watch (idempotent test)
const T_C = "1970-01-01T00:40:30.000Z"; // items[1] re-watch under exclusion
const T_D = "1970-01-01T00:50:30.000Z"; // items[3] progress (later removed)
const T_E = "1970-01-01T01:00:30.000Z"; // items[4] complete
const T_F = "1970-01-01T01:10:30.000Z"; // items[5] zero-position start

interface AuthShape {
  token: string;
  user: { id: string; email: string; displayName: string };
  profiles: { id: string; displayName: string; isDefault: boolean }[];
  activeProfileId: string;
}

let harness: ApiTestBoot;
let auth: AuthShape;
let bearer: Record<string, string>;
/** Six DISTINCT seeded items (deterministic ORDER BY i.id). */
let items: { itemId: string; externalRef: string }[] = [];

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);
  // Six distinct long-form items for the round-trip + Continue Watching.
  const rows = await harness.testDb.db.query<{ item_id: string; external_ref: string }>(
    `SELECT i.id AS item_id, r.external_ref
       FROM entertainment_items i
       JOIN source_realizations r ON r.entertainment_item_id = i.id
      WHERE i.canonical_type = 'video'
      ORDER BY i.id
      LIMIT 6`,
  );
  if (rows.length < 6) throw new Error("test setup: expected six seeded catalog rows");
  items = rows.map((row) => ({ itemId: row.item_id, externalRef: row.external_ref }));

  // Register a real account (auto-login): the Bearer session + default profile.
  const response = await registerPOST(
    postRequest("/auth/register", {
      email: "history-r04@example.com",
      password: "correct-horse-battery",
      displayName: "History R04",
    }),
  );
  expect(response.status).toBe(200);
  auth = (await response.json()) as AuthShape;
  bearer = { authorization: `Bearer ${auth.token}` };
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/** Build a PUT request with a JSON body (the profile-selection route). */
function putRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://api.test${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

/** Anonymous headers (the x-wfx-user-id the history route expects). */
function anonymousHeaders(): Record<string, string> {
  return identityHeaders();
}

/** The profile's history item ids (newest-first), via the Bearer read. */
async function historyItemIds(): Promise<string[]> {
  const response = await historyGET(getRequest("/experience/history", bearer));
  expect(response.status).toBe(200);
  const body = (await json(response)) as { itemId: string }[];
  return body.map((entry) => entry.itemId);
}

/** Count the user's event_outbox rows (the audit truth). */
async function outboxCount(): Promise<number> {
  const rows = await harness.testDb.db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM event_outbox WHERE user_id = $1`,
    [auth.user.id],
  );
  return rows[0]?.count ?? 0;
}

/** Record one watch observation into the projection (explicit profile + time). */
async function record(
  itemId: string,
  input: { eventType: "start" | "progress" | "complete"; positionMs: number; occurredAt: string },
): Promise<void> {
  const defaultProfile = auth.profiles[0];
  await harness.boot.history.watchStore().record({
    userId: auth.user.id,
    ...(defaultProfile !== undefined ? { profileId: defaultProfile.id } : {}),
    itemId,
    eventType: input.eventType,
    positionMs: input.positionMs,
    completed: input.eventType === "complete",
    sessionId: "wfxsess_history_r04",
    occurredAt: input.occurredAt,
  });
}

/** Post one watch event through the REAL events endpoint (Bearer), then drain. */
async function rewatch(
  itemId: string,
  input: { positionMs: number; occurredAt: string },
): Promise<void> {
  const response = await eventsPOST(
    postRequest(
      "/experience/events",
      {
        userId: auth.user.id,
        itemId,
        type: "progress",
        occurredAt: input.occurredAt,
        sessionId: "wfxsess_history_r04",
        payload: { positionMs: input.positionMs },
      },
      bearer,
    ),
  );
  expect(response.status).toBe(200);
  const result = await runRelayDrain(
    harness.boot.persistence.db,
    harness.boot.ports.clock,
    50,
    harness.boot.profiles,
    harness.boot.history.removalStore(),
  );
  expect(result.drain.failed).toBe(0);
}

// ---------------------------------------------------------------------------
// The Bearer round-trip (newest-first, profile-scoped, the frozen shape)
// ---------------------------------------------------------------------------

describe("GET /experience/history — the Bearer round-trip", () => {
  it("answers the profile's history NEWEST-FIRST with the exact frozen ProfileHistoryEntry shape", async () => {
    // Two watch events at distinct, deterministic instants (A older, B newer).
    await record(items[0]!.itemId, { eventType: "progress", positionMs: 30_000, occurredAt: T_A });
    await record(items[1]!.itemId, { eventType: "progress", positionMs: 60_000, occurredAt: T_B });

    const response = await historyGET(getRequest("/experience/history", bearer));
    expect(response.status).toBe(200);
    const body = (await json(response)) as Record<string, unknown>[];
    expect(body.map((entry) => entry.itemId)).toEqual([
      items[1]!.itemId, // newest first (T_B)
      items[0]!.itemId, // then T_A
    ]);
    // The EXACT frozen wire shape — nothing more, nothing less.
    expect(Object.keys(body[0] ?? {}).sort()).toEqual(
      ["completed", "itemId", "lastEventType", "positionMs", "updatedAt"].sort(),
    );
    const newest = body[0] as {
      positionMs: number;
      completed: boolean;
      lastEventType: string | null;
      updatedAt: string;
    };
    expect(newest.positionMs).toBe(60_000);
    expect(newest.completed).toBe(false);
    expect(newest.lastEventType).toBe("progress");
    expect(newest.updatedAt).toBe(T_B);
  });

  it("is PROFILE-SCOPED: another profile of the same account sees none of it", async () => {
    // Create a second profile and select it for this session.
    const created = await profilesPUT(
      postRequest("/profiles", { displayName: "Second Profile" }, bearer),
    );
    expect(created.status).toBe(200);
    const createdBody = (await json(created)) as { profile: { id: string } };
    const secondProfileId = createdBody.profile.id;

    const selected = await profileSelectPUT(
      putRequest(`/profiles/${secondProfileId}/select`, bearer),
      { params: Promise.resolve({ id: secondProfileId }) },
    );
    expect(selected.status).toBe(200);

    // The second profile's history is HONESTLY empty — profile A's rows
    // never leak to profile B (the R02 law, re-pinned for R04).
    const response = await historyGET(getRequest("/experience/history", bearer));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual([]);

    // Select the default profile back for the rest of the file.
    const back = await profileSelectPUT(
      putRequest(`/profiles/${auth.profiles[0]?.id}/select`, bearer),
      { params: Promise.resolve({ id: auth.profiles[0]?.id ?? "" }) },
    );
    expect(back.status).toBe(200);
    // The default profile's history is back (both items).
    expect((await historyItemIds()).length).toBe(2);
  });

  it("rejects a garbage bearer with a typed 401", async () => {
    const response = await historyGET(
      getRequest("/experience/history", { authorization: "Bearer wfxsess_not-a-real-token" }),
    );
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Removal — the event-sink law + re-materialization on re-watch
// ---------------------------------------------------------------------------

describe("DELETE /experience/history/:itemId — removal (the event-sink law)", () => {
  it("rejects a malformed itemId with a typed 400", async () => {
    const response = await historyItemDELETE(
      deleteRequest("/experience/history/not-a-valid-id", anonymousHeaders()),
      { params: Promise.resolve({ itemId: "not-a-valid-id" }) },
    );
    expect(response.status).toBe(400);
  });

  it("removes the item from the READ MODEL; the event store stays UNCHANGED; a re-watch re-materializes it", async () => {
    const itemId = items[0]!.itemId;
    // The item is currently in history (recorded at T_A).
    expect(await historyItemIds()).toContain(itemId);

    const outboxBefore = await outboxCount();

    // DELETE /experience/history/:itemId — removal (Bearer, profile-scoped).
    const response = await historyItemDELETE(
      deleteRequest(`/experience/history/${itemId}`, bearer),
      { params: Promise.resolve({ itemId }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as { ok: boolean; itemId: string };
    expect(body.ok).toBe(true);
    expect(body.itemId).toBe(itemId);

    // The item LEFT the read model (the other item stays).
    expect(await historyItemIds()).not.toContain(itemId);
    expect(await historyItemIds()).toContain(items[1]!.itemId);

    // THE EVENT-SINK LAW: the recorded events are the immutable truth —
    // the outbox is unchanged by the removal.
    expect(await outboxCount()).toBe(outboxBefore);

    // A RE-WATCH re-materializes it: a new watch event through the real
    // events endpoint + the relay drain (the fold clears the removal row).
    await rewatch(itemId, { positionMs: 90_000, occurredAt: T_R });
    const ids = await historyItemIds();
    expect(ids).toContain(itemId);
    expect(ids[0]).toBe(itemId); // newest-first: the re-watch (T_R) is most recent

    // The outbox GREW by exactly the re-watch event (recorded, never falsified).
    expect(await outboxCount()).toBe(outboxBefore + 1);
  });

  it("is IDEMPOTENT: removing an already-removed item answers 200 and changes nothing", async () => {
    const itemId = items[0]!.itemId;
    const outboxBefore = await outboxCount();
    const first = await historyItemDELETE(
      deleteRequest(`/experience/history/${itemId}`, bearer),
      { params: Promise.resolve({ itemId }) },
    );
    expect(first.status).toBe(200);
    const second = await historyItemDELETE(
      deleteRequest(`/experience/history/${itemId}`, bearer),
      { params: Promise.resolve({ itemId }) },
    );
    expect(second.status).toBe(200);
    expect(await outboxCount()).toBe(outboxBefore);
    // Re-materialize for the tests that follow.
    await rewatch(itemId, { positionMs: 95_000, occurredAt: T_S });
    expect(await historyItemIds()).toContain(itemId);
  });
});

// ---------------------------------------------------------------------------
// Exclusion (J32) — history-derived surfaces, events stay recorded
// ---------------------------------------------------------------------------

describe("POST /experience/history/exclusions — exclusion (J32)", () => {
  it("rejects a body without itemId with a typed 400", async () => {
    const response = await exclusionPOST(
      postRequest("/experience/history/exclusions", {}, anonymousHeaders()),
    );
    expect(response.status).toBe(400);
  });

  it("hides the item from history while events stay recorded; PERSISTS across re-watches; DELETE re-includes", async () => {
    const itemId = items[1]!.itemId;
    expect(await historyItemIds()).toContain(itemId);

    const outboxBefore = await outboxCount();

    // Exclude the item (Bearer, profile-scoped).
    const excludeResponse = await exclusionPOST(
      postRequest("/experience/history/exclusions", { itemId }, bearer),
    );
    expect(excludeResponse.status).toBe(200);
    const excluded = (await json(excludeResponse)) as { ok: boolean; itemId: string };
    expect(excluded.ok).toBe(true);
    expect(excluded.itemId).toBe(itemId);

    // The item no longer appears in the history READ MODEL.
    expect(await historyItemIds()).not.toContain(itemId);

    // THE EVENT-SINK LAW: the events stay recorded — the outbox is unchanged.
    expect(await outboxCount()).toBe(outboxBefore);

    // A RE-WATCH does NOT clear an exclusion (the user's explicit choice
    // persists — unlike a removal, which re-materializes on re-watch).
    await rewatch(itemId, { positionMs: 120_000, occurredAt: T_C });
    expect(await historyItemIds()).not.toContain(itemId);
    expect(await outboxCount()).toBe(outboxBefore + 1); // the event WAS recorded

    // Removing the exclusion re-includes the item (the projection row and
    // the re-watch event were there all along — only the filter lifts).
    const removeResponse = await exclusionItemDELETE(
      deleteRequest(`/experience/history/exclusions/${itemId}`, bearer),
      { params: Promise.resolve({ itemId }) },
    );
    expect(removeResponse.status).toBe(200);
    const removed = (await json(removeResponse)) as {
      ok: boolean;
      itemId: string;
      removed: boolean;
    };
    expect(removed.removed).toBe(true);
    const ids = await historyItemIds();
    expect(ids).toContain(itemId);
    expect(ids[0]).toBe(itemId); // the re-watch (T_C) is the most recent

    // Removing a NONEXISTENT exclusion is the idempotent 200 (removed=false).
    const again = await exclusionItemDELETE(
      deleteRequest(`/experience/history/exclusions/${itemId}`, bearer),
      { params: Promise.resolve({ itemId }) },
    );
    expect(again.status).toBe(200);
    const againBody = (await json(again)) as { removed: boolean };
    expect(againBody.removed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Continue Watching (J12) — the shelf shape
// ---------------------------------------------------------------------------

describe("Continue Watching (J12) — the shelf shape", () => {
  it("in-progress items with a resumable position, most-recent first, capped, exclusion- and removal-aware", async () => {
    const profileId = auth.profiles[0]?.id ?? "";
    // Seed the shelf candidates (deterministic recency):
    //   items[0] in-progress  95_000 @ T_S (already recorded)
    //   items[1] in-progress 120_000 @ T_C (already recorded)
    //   items[2] in-progress  10_000 @ T_C -> EXCLUDED below
    //   items[3] in-progress  15_000 @ T_D -> REMOVED below
    //   items[4] completed     5_000 @ T_E -> not in-progress
    //   items[5] started, position 0 @ T_F -> not resumable (no position yet)
    await record(items[2]!.itemId, { eventType: "progress", positionMs: 10_000, occurredAt: T_C });
    await record(items[3]!.itemId, { eventType: "progress", positionMs: 15_000, occurredAt: T_D });
    await record(items[4]!.itemId, { eventType: "complete", positionMs: 5_000, occurredAt: T_E });
    await record(items[5]!.itemId, { eventType: "start", positionMs: 0, occurredAt: T_F });

    // Exclude items[2]; remove items[3] from history.
    const excludeResponse = await exclusionPOST(
      postRequest("/experience/history/exclusions", { itemId: items[2]!.itemId }, bearer),
    );
    expect(excludeResponse.status).toBe(200);
    const removeResponse = await historyItemDELETE(
      deleteRequest(`/experience/history/${items[3]!.itemId}`, bearer),
      { params: Promise.resolve({ itemId: items[3]!.itemId }) },
    );
    expect(removeResponse.status).toBe(200);

    // THE SHELF: only in-progress, resumable, non-excluded, non-removed
    // items — most-recent progress first.
    const shelf = await harness.boot.history.readContinueWatching(profileId, 10);
    expect(shelf.map((entry) => entry.itemId)).toEqual([
      items[1]!.itemId, // 120_000 @ T_C — most recent
      items[0]!.itemId, // 95_000 @ T_S
    ]);
    expect(shelf[0]?.positionMs).toBe(120_000);
    expect(shelf[0]?.completed).toBe(false);

    // CAPPED (the Netflix-style shelf): a limit of 1 answers only the head.
    const capped = await harness.boot.history.readContinueWatching(profileId, 1);
    expect(capped.map((entry) => entry.itemId)).toEqual([items[1]!.itemId]);

    // Exclusion-aware + removal-aware + completion-aware + resumability-aware
    // — every one of the four filtered shapes is absent.
    const shelfIds = shelf.map((entry) => entry.itemId);
    expect(shelfIds).not.toContain(items[2]!.itemId); // excluded
    expect(shelfIds).not.toContain(items[3]!.itemId); // removed
    expect(shelfIds).not.toContain(items[4]!.itemId); // completed
    expect(shelfIds).not.toContain(items[5]!.itemId); // started, no position yet
  });
});

// ---------------------------------------------------------------------------
// The anonymous transition (the R02 law, preserved)
// ---------------------------------------------------------------------------

describe("GET /experience/history — the anonymous fallback", () => {
  it("answers 200 with the honest empty array when no history exists", async () => {
    const response = await historyGET(getRequest("/experience/history", anonymousHeaders()));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  it("rejects a missing x-wfx-user-id with a typed 400", async () => {
    const response = await historyGET(getRequest("/experience/history", {}));
    expect(response.status).toBe(400);
  });
});
