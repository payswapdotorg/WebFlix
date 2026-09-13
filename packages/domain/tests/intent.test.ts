import { describe, expect, it } from "bun:test";

import {
  COMPLETE_WEIGHT_BUMP,
  DEFAULT_INTENT_CONFIDENCE,
  DEFAULT_INTENT_WEIGHT,
  EXPLICIT_SIGNAL_WEIGHT_BUMP,
  INTENT_HALF_LIFE_MS,
  INTENT_OBJECTIVE_MAX_LENGTH,
  INTENT_SCOPES,
  IntentError,
  IntentGraph,
  clampPolicy,
  defaultPolicy,
  inferFromEvents,
  isIntentId,
  newEntertainmentItemId,
  newIntentId,
  validatePolicy,
  type EntertainmentEvent,
  type IntentId,
  type IntentRecordInput,
  type IntentScope,
  type RecommendationPolicy,
  type UserIntent,
} from "../src/index";

const T0 = Date.parse("2026-09-13T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const HOUR_MS = 60 * 60 * 1000;

interface TestEventOptions {
  userId?: string;
  itemId?: string;
  query?: string;
  occurredAt?: string;
  sessionId?: string;
}

function makeTestEvent(
  type: EntertainmentEvent["type"],
  options: TestEventOptions = {},
): EntertainmentEvent {
  const event: EntertainmentEvent = {
    userId: options.userId ?? "user-1",
    itemId: options.itemId ?? newEntertainmentItemId(),
    type,
    occurredAt: options.occurredAt ?? iso(T0),
    sessionId: options.sessionId ?? "sess-1",
  };
  if (options.query !== undefined) event.payload = { query: options.query };
  return event;
}

/** Runs fn expecting an IntentError; asserts kind and returns the error. */
function expectIntentError(kind: "invalid-input" | "not-found", fn: () => void): IntentError {
  try {
    fn();
  } catch (error) {
    const intentError = error as IntentError;
    expect(intentError).toBeInstanceOf(IntentError);
    expect(intentError.kind).toBe(kind);
    expect(intentError.details.length).toBeGreaterThan(0);
    return intentError;
  }
  throw new Error("expected an IntentError to be thrown");
}

describe("intent model", () => {
  it("mirrors the frozen five scopes exactly", () => {
    expect([...INTENT_SCOPES]).toEqual([
      "persistent",
      "temporary",
      "session",
      "momentary",
      "social",
    ]);
  });

  it("record() produces a fully-shaped, frozen IntentRecord with a canonical id", () => {
    const graph = new IntentGraph();
    const before = Date.now();
    const record = graph.record({
      userId: " user-1 ",
      scope: "temporary",
      objective: "  sci-fi series  ",
    });
    const after = Date.now();

    expect(isIntentId(record.id)).toBe(true);
    expect(record.userId).toBe("user-1");
    expect(record.scope).toBe("temporary");
    expect(record.objective).toBe("sci-fi series");
    expect(record.weight).toBe(DEFAULT_INTENT_WEIGHT);
    expect(record.confidence).toBe(DEFAULT_INTENT_CONFIDENCE);
    expect(record.provenance).toBe("explicit");
    expect(record.evidenceCount).toBe(1);
    expect("expiresAt" in record).toBe(false);
    expect(Object.isFrozen(record)).toBe(true);
    for (const stamp of [record.createdAt, record.updatedAt, record.lastReinforcedAt]) {
      const ms = Date.parse(stamp);
      expect(ms).toBeGreaterThanOrEqual(before);
      expect(ms).toBeLessThanOrEqual(after);
    }
    expect(graph.get(record.id)).toEqual(record);
  });

  it("snapshot excludes expired intents (expiresAt <= now counts as expired)", () => {
    const graph = new IntentGraph();
    graph.record({
      userId: "user-1",
      scope: "temporary",
      objective: "expiring soon",
      expiresAt: iso(T0 + HOUR_MS),
    });
    graph.record({ userId: "user-1", scope: "persistent", objective: "evergreen" });

    const beforeExpiry = graph.snapshot("user-1", T0);
    expect(beforeExpiry.userId).toBe("user-1");
    expect(beforeExpiry.takenAt).toBe(iso(T0));
    expect(beforeExpiry.active.map((r) => r.objective).sort()).toEqual([
      "evergreen",
      "expiring soon",
    ]);

    const atExpiry = graph.snapshot("user-1", T0 + HOUR_MS); // exactly at expiry: expired
    expect(atExpiry.active.map((r) => r.objective)).toEqual(["evergreen"]);
  });

  it("snapshot excludes momentary intents older than 1h (exactly 1h is still active)", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "momentary",
      objective: "avoid spoilers",
    });
    const anchor = Date.parse(record.lastReinforcedAt);

    const atBoundary = graph.snapshot("user-1", anchor + HOUR_MS);
    expect(atBoundary.active.map((r) => r.id)).toEqual([record.id]);

    const justPast = graph.snapshot("user-1", anchor + HOUR_MS + 1);
    expect(justPast.active).toEqual([]);
  });

  it("snapshot orders active intents heaviest-first", () => {
    const graph = new IntentGraph();
    graph.record({ userId: "user-1", scope: "persistent", objective: "light", weight: 0.2 });
    graph.record({ userId: "user-1", scope: "persistent", objective: "heavy", weight: 0.9 });
    const snapshot = graph.snapshot("user-1", Date.now());
    expect(snapshot.active.map((r) => r.objective)).toEqual(["heavy", "light"]);
  });
});

describe("intent store", () => {
  it("record() reinforces an existing (userId, scope, objective) instead of duplicating", () => {
    const graph = new IntentGraph();
    const first = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "stand-up comedy",
      weight: 0.4,
      confidence: 0.3,
    });
    const second = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "stand-up comedy",
      weight: 0.3,
      confidence: 0.2,
    });

    expect(second.id).toBe(first.id);
    const all = graph.list("user-1");
    expect(all.length).toBe(1);
    const record = all[0]!;
    expect(record.weight).toBeCloseTo(0.7);
    expect(record.confidence).toBeCloseTo(0.5);
    expect(record.evidenceCount).toBe(2);
    expect(record.provenance).toBe("explicit"); // origin provenance is never rewritten
    expect(Date.parse(record.lastReinforcedAt)).toBeGreaterThanOrEqual(
      Date.parse(first.lastReinforcedAt),
    );
    expect(Date.parse(record.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.createdAt));
  });

  it("treats scope as part of the intent identity", () => {
    const graph = new IntentGraph();
    const session = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "stand-up comedy",
    });
    const temporary = graph.record({
      userId: "user-1",
      scope: "temporary",
      objective: "stand-up comedy",
    });
    expect(temporary.id).not.toBe(session.id);
    expect(graph.list("user-1").length).toBe(2);
  });

  it("clamps reinforcement at weight/confidence 1", () => {
    const graph = new IntentGraph();
    graph.record({
      userId: "user-1",
      scope: "persistent",
      objective: "classics",
      weight: 0.9,
      confidence: 0.9,
    });
    const record = graph.record({
      userId: "user-1",
      scope: "persistent",
      objective: "classics",
      weight: 0.9,
      confidence: 0.9,
    });
    expect(record.weight).toBe(1);
    expect(record.confidence).toBe(1);
  });

  it("isolates users", () => {
    const graph = new IntentGraph();
    graph.record({ userId: "user-1", scope: "session", objective: "mine" });
    graph.record({ userId: "user-2", scope: "session", objective: "yours" });
    expect(graph.list("user-1").map((r) => r.objective)).toEqual(["mine"]);
    expect(graph.list("user-2").map((r) => r.objective)).toEqual(["yours"]);
    expect(graph.snapshot("user-2", Date.now()).active.map((r) => r.userId)).toEqual(["user-2"]);
  });

  it("decay halves momentary weight after 30 minutes (weights only, confidence untouched)", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "momentary",
      objective: "quick laughs",
      weight: 0.8,
      confidence: 0.7,
    });
    const anchor = Date.parse(record.lastReinforcedAt);
    const changed = graph.decay(anchor + INTENT_HALF_LIFE_MS.momentary!);
    expect(changed).toBe(1);
    const decayed = graph.get(record.id);
    expect(decayed?.weight).toBeCloseTo(0.4);
    expect(decayed?.confidence).toBe(0.7);
  });

  it("decay halves session weight after 8 hours", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "cooking shows",
      weight: 0.8,
    });
    const anchor = Date.parse(record.lastReinforcedAt);
    graph.decay(anchor + INTENT_HALF_LIFE_MS.session!);
    expect(graph.get(record.id)?.weight).toBeCloseTo(0.4);
  });

  it("decay halves temporary weight after 72 hours", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "temporary",
      objective: "space documentaries",
      weight: 0.8,
    });
    const anchor = Date.parse(record.lastReinforcedAt);
    graph.decay(anchor + INTENT_HALF_LIFE_MS.temporary!);
    expect(graph.get(record.id)?.weight).toBeCloseTo(0.4);
  });

  it("never decays persistent or social intents (immunity by law)", () => {
    const graph = new IntentGraph();
    const persistent = graph.record({
      userId: "user-1",
      scope: "persistent",
      objective: "film noir",
      weight: 0.8,
    });
    const social = graph.record({
      userId: "user-1",
      scope: "social",
      objective: "friend picks",
      weight: 0.7,
    });
    const changed = graph.decay(Date.now() + 10 * 365 * 24 * HOUR_MS);
    expect(changed).toBe(0);
    expect(graph.get(persistent.id)?.weight).toBe(0.8);
    expect(graph.get(social.id)?.weight).toBe(0.7);
  });

  it("decay is idempotent per instant and cannot restore weight (time-travel safe)", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "x",
      weight: 0.6,
    });
    const anchor = Date.parse(record.lastReinforcedAt);
    const weight = () => graph.get(record.id)?.weight ?? Number.NaN;

    graph.decay(anchor + INTENT_HALF_LIFE_MS.session!);
    const once = weight();
    expect(once).toBeCloseTo(0.3);

    graph.decay(anchor + INTENT_HALF_LIFE_MS.session!); // same instant: idempotent
    expect(weight()).toBeCloseTo(once);

    graph.decay(anchor); // earlier instant: decay never increases a weight
    expect(weight()).toBeCloseTo(once);
  });

  it("reinforcement resets the decay anchor", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "x",
      weight: 0.5,
    });
    const anchor = Date.parse(record.lastReinforcedAt);
    graph.decay(anchor + INTENT_HALF_LIFE_MS.session!);
    expect(graph.get(record.id)?.weight).toBeCloseTo(0.25);

    const reinforced = graph.record({
      userId: "user-1",
      scope: "session",
      objective: "x",
      weight: 0.15,
    });
    expect(reinforced.weight).toBeCloseTo(0.4);
    const newAnchor = Date.parse(reinforced.lastReinforcedAt);
    graph.decay(newAnchor + INTENT_HALF_LIFE_MS.session!);
    expect(graph.get(record.id)?.weight).toBeCloseTo(0.2);
  });

  it("expire marks an intent expired; snapshots drop it but get/list keep it", () => {
    const graph = new IntentGraph();
    const record = graph.record({
      userId: "user-1",
      scope: "temporary",
      objective: " documentaries ",
      weight: 0.5,
    });
    const expired = graph.expire(record.id, T0);
    expect(expired.id).toBe(record.id);
    expect(expired.objective).toBe("documentaries");
    expect(expired.expiresAt).toBe(iso(T0));
    expect(graph.get(record.id)?.expiresAt).toBe(iso(T0));
    expect(graph.list("user-1").length).toBe(1);
    expect(graph.snapshot("user-1", T0 + 1000).active).toEqual([]);

    const atWallClock = graph.expire(record.id);
    expect(atWallClock.expiresAt).toBeDefined();
    expect(Date.parse(atWallClock.expiresAt!)).toBeLessThanOrEqual(Date.now() + 5);
  });

  it("expire on an unknown id throws a typed not-found IntentError", () => {
    const graph = new IntentGraph();
    const error = expectIntentError("not-found", () => graph.expire(newIntentId()));
    expect(error.message).toContain("not-found");
  });

  it("record() throws typed invalid-input errors for every violated invariant", () => {
    const graph = new IntentGraph();
    const badInputs: IntentRecordInput[] = [
      null as unknown as IntentRecordInput,
      { userId: "", scope: "session", objective: "x" },
      { userId: "   ", scope: "session", objective: "x" },
      { userId: "u1", scope: "weekly" as unknown as IntentScope, objective: "x" },
      { userId: "u1", scope: "session", objective: "" },
      { userId: "u1", scope: "session", objective: "   " },
      { userId: "u1", scope: "session", objective: "x".repeat(INTENT_OBJECTIVE_MAX_LENGTH + 1) },
      { userId: "u1", scope: "session", objective: "x", weight: 1.5 },
      { userId: "u1", scope: "session", objective: "x", weight: -0.1 },
      { userId: "u1", scope: "session", objective: "x", confidence: 2 },
      { userId: "u1", scope: "session", objective: "x", expiresAt: "not-a-date" },
      {
        userId: "u1",
        scope: "session",
        objective: "x",
        provenance: "guessed" as unknown as UserIntent["provenance"],
      },
    ];
    for (const input of badInputs) {
      expect(() => graph.record(input)).toThrow(IntentError);
    }
  });

  it("record() aggregates multiple problems into the error details", () => {
    const graph = new IntentGraph();
    const error = expectIntentError("invalid-input", () =>
      graph.record({
        userId: "",
        scope: "nope" as unknown as IntentScope,
        objective: "",
        weight: 5,
      }),
    );
    expect(error.name).toBe("IntentError");
    expect(error.details.length).toBeGreaterThanOrEqual(4);
  });

  it("get/list/decay/snapshot reject malformed arguments with typed errors", () => {
    const graph = new IntentGraph();
    expectIntentError("invalid-input", () => graph.get("garbage" as unknown as IntentId));
    expect(graph.get(newIntentId())).toBeUndefined();
    expectIntentError("invalid-input", () => graph.list(""));
    expectIntentError("invalid-input", () => graph.decay(-1));
    expectIntentError("invalid-input", () => graph.decay(Number.NaN));
    expectIntentError("invalid-input", () => graph.snapshot("user-1", -1));
    expectIntentError("invalid-input", () => graph.snapshot("", T0));
  });
});

describe("intent inference", () => {
  it("search events infer a session-scoped intent from the trimmed query", () => {
    const updates = inferFromEvents(
      "user-1",
      [makeTestEvent("search", { query: "  cosmic documentaries  " })],
      T0,
    );
    expect(updates.length).toBe(1);
    const update = updates[0]!;
    expect(update.userId).toBe("user-1");
    expect(update.scope).toBe("session");
    expect(update.objective).toBe("cosmic documentaries");
    expect(update.provenance).toBe("inferred");
    expect(update.weight).toBe(EXPLICIT_SIGNAL_WEIGHT_BUMP);
    expect(update.signal).toBe("search");
    expect(update.inferredAt).toBe(iso(T0));

    const graph = new IntentGraph();
    graph.record(update); // updates are directly recordable
    const record = graph.list("user-1")[0]!;
    expect(record.provenance).toBe("inferred");
    expect(record.evidenceCount).toBe(1);
    expect(record.objective).toBe("cosmic documentaries");
  });

  it("search without a usable query falls back to the synthetic item objective", () => {
    const itemId = newEntertainmentItemId();
    const noQuery = inferFromEvents("user-1", [makeTestEvent("search", { itemId })], T0);
    expect(noQuery[0]?.objective).toBe(`item:${itemId}`);

    const blankQuery = inferFromEvents(
      "user-1",
      [makeTestEvent("search", { itemId, query: "   " })],
      T0,
    );
    expect(blankQuery[0]?.objective).toBe(`item:${itemId}`);

    const nonStringQuery = inferFromEvents(
      "user-1",
      [makeTestEvent("search", { itemId, query: 42 as unknown as string })],
      T0,
    );
    expect(nonStringQuery[0]?.objective).toBe(`item:${itemId}`);
  });

  it("caps long search queries to INTENT_OBJECTIVE_MAX_LENGTH (store never rejects them)", () => {
    const longQuery = "q".repeat(INTENT_OBJECTIVE_MAX_LENGTH + 50);
    const updates = inferFromEvents(
      "user-1",
      [makeTestEvent("search", { query: longQuery })],
      T0,
    );
    const objective = updates[0]?.objective ?? "";
    expect(objective.length).toBe(INTENT_OBJECTIVE_MAX_LENGTH);

    const graph = new IntentGraph();
    graph.record(updates[0]!);
    expect(graph.list("user-1")[0]?.objective).toBe(objective);
  });

  it("routes scope by signal: search → session, like/save/complete → temporary", () => {
    const updates = inferFromEvents(
      "user-1",
      [
        makeTestEvent("search", { query: "cooking shows" }),
        makeTestEvent("like", { itemId: newEntertainmentItemId() }),
        makeTestEvent("save", { itemId: newEntertainmentItemId() }),
        makeTestEvent("complete", { itemId: newEntertainmentItemId() }),
      ],
      T0,
    );
    expect(updates.map((u) => [u.signal, u.scope])).toEqual([
      ["search", "session"],
      ["like", "temporary"],
      ["save", "temporary"],
      ["complete", "temporary"],
    ]);
  });

  it("complete reinforces with LOWER weight than like (a watch is one signal, not an identity)", () => {
    const itemId = newEntertainmentItemId();
    const likeGraph = new IntentGraph();
    const completeGraph = new IntentGraph();
    for (const update of inferFromEvents("user-1", [makeTestEvent("like", { itemId })], T0)) {
      likeGraph.record(update);
    }
    for (const update of inferFromEvents("user-1", [makeTestEvent("complete", { itemId })], T0)) {
      completeGraph.record(update);
    }
    const liked = likeGraph.list("user-1")[0]!;
    const watched = completeGraph.list("user-1")[0]!;
    expect(liked.weight).toBe(EXPLICIT_SIGNAL_WEIGHT_BUMP);
    expect(watched.weight).toBe(COMPLETE_WEIGHT_BUMP);
    expect(watched.weight).toBeLessThan(liked.weight);
    expect(watched.objective).toBe(`item:${itemId}`);
  });

  it("ignores event types that are not intent evidence", () => {
    const nonEvidence = ["impression", "start", "progress", "skip", "dislike", "share"] as const;
    const events = nonEvidence.map((type) => makeTestEvent(type));
    expect(inferFromEvents("user-1", events, T0)).toEqual([]);
  });

  it("repeated signals on the same item accumulate as evidence in one record", () => {
    const itemId = newEntertainmentItemId();
    const graph = new IntentGraph();
    const events = [
      makeTestEvent("like", { itemId }),
      makeTestEvent("save", { itemId }),
      makeTestEvent("complete", { itemId }),
    ];
    const updates = inferFromEvents("user-1", events, T0);
    expect(updates.length).toBe(3);
    for (const update of updates) graph.record(update);

    const list = graph.list("user-1");
    expect(list.length).toBe(1);
    const record = list[0]!;
    expect(record.objective).toBe(`item:${itemId}`);
    expect(record.scope).toBe("temporary");
    expect(record.evidenceCount).toBe(3);
    expect(record.weight).toBeCloseTo(
      EXPLICIT_SIGNAL_WEIGHT_BUMP + EXPLICIT_SIGNAL_WEIGHT_BUMP + COMPLETE_WEIGHT_BUMP,
    );
    expect(record.provenance).toBe("inferred");
  });

  it("inference never removes or down-ranks existing intents (anti-tunnel-vision law)", () => {
    const graph = new IntentGraph();
    const seed = graph.record({
      userId: "user-1",
      scope: "persistent",
      objective: "film noir",
      weight: 0.9,
      confidence: 0.8,
    });
    const before = graph.snapshot("user-1", Date.now() + 1000);

    const itemId = newEntertainmentItemId();
    const updates = inferFromEvents(
      "user-1",
      [
        makeTestEvent("search", { query: "cooking shows" }),
        makeTestEvent("like", { itemId }),
        makeTestEvent("complete", { itemId }),
      ],
      T0,
    );
    expect(updates.length).toBe(3);
    for (const update of updates) graph.record(update);

    const after = graph.list("user-1");
    expect(after.length).toBe(before.active.length + 2); // ids only accumulate
    const noir = after.find((r) => r.id === seed.id);
    expect(noir?.weight).toBe(0.9); // never down-ranked
    expect(noir?.confidence).toBe(0.8);
    expect(noir?.evidenceCount).toBe(1);

    // A second inference round must not touch it either.
    for (const update of inferFromEvents(
      "user-1",
      [makeTestEvent("search", { query: "cooking shows" })],
      T0,
    )) {
      graph.record(update);
    }
    const noirStill = graph.list("user-1").find((r) => r.id === seed.id);
    expect(noirStill?.weight).toBe(0.9);

    const snapshot = graph.snapshot("user-1", Date.now() + 1000);
    expect(snapshot.active.some((r) => r.id === seed.id)).toBe(true);
  });

  it("rejects invalid events, foreign users, and bad arguments with typed errors", () => {
    expectIntentError("invalid-input", () =>
      inferFromEvents("   ", [makeTestEvent("search", { query: "x" })], T0),
    );
    expectIntentError("invalid-input", () =>
      inferFromEvents("user-1", [makeTestEvent("search", { userId: "user-2", query: "x" })], T0),
    );
    expectIntentError("invalid-input", () =>
      inferFromEvents("user-1", [makeTestEvent("search", { itemId: "not-an-id" })], T0),
    );
    expectIntentError("invalid-input", () =>
      inferFromEvents("user-1", "nope" as unknown as EntertainmentEvent[], T0),
    );
    expectIntentError("invalid-input", () => inferFromEvents("user-1", [], -1));

    const error = expectIntentError("invalid-input", () =>
      inferFromEvents("user-1", [{ bad: true } as unknown as EntertainmentEvent], T0),
    );
    expect(error.details[0]!.startsWith("events[0]:")).toBe(true);
  });
});

describe("intent policy", () => {
  it("defaultPolicy is balanced with 0.2/0.2/0.1, no objectives, and no session-extension cap", () => {
    const policy = defaultPolicy("user-1");
    expect(policy.userId).toBe("user-1");
    expect(policy.attentionMode).toBe("balanced");
    expect(policy.exploration).toBe(0.2);
    expect(policy.novelty).toBe(0.2);
    expect(policy.socialInfluence).toBe(0.1);
    expect(policy.objectives).toEqual([]);
    expect(typeof policy.id).toBe("string");
    expect(policy.id.length).toBeGreaterThan(0);
    expect("maxSessionExtensionMinutes" in policy).toBe(false);
    expect(validatePolicy(policy).ok).toBe(true);
  });

  it("defaultPolicy rejects an empty userId", () => {
    expectIntentError("invalid-input", () => defaultPolicy("   "));
  });

  it("validatePolicy accepts a well-formed policy and returns the same reference", () => {
    const input: RecommendationPolicy = {
      id: "wfxpol_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      userId: "user-1",
      objectives: [
        { id: "obj-1", weight: 0.6, direction: "maximize" },
        { id: "obj-2", weight: 0.2, direction: "minimize" },
      ],
      exploration: 0.2,
      novelty: 0.5,
      socialInfluence: 0,
      attentionMode: "immersive",
      maxSessionExtensionMinutes: 30,
    };
    const result = validatePolicy(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(input);
  });

  it("validatePolicy reports every problem on a garbage policy", () => {
    const result = validatePolicy({
      id: "   ",
      userId: "",
      objectives: "not-an-array",
      exploration: 1.5,
      novelty: -0.5,
      socialInfluence: Number.NaN,
      attentionMode: "aggressive",
      maxSessionExtensionMinutes: -5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(7);
      const joined = result.errors.join("\n");
      expect(joined).toContain("id:");
      expect(joined).toContain("userId:");
      expect(joined).toContain("objectives:");
      expect(joined).toContain("exploration:");
      expect(joined).toContain("novelty:");
      expect(joined).toContain("socialInfluence:");
      expect(joined).toContain("attentionMode:");
      expect(joined).toContain("maxSessionExtensionMinutes:");
    }
  });

  it("validatePolicy rejects malformed objectives (weight, direction, ids)", () => {
    const result = validatePolicy({
      id: "p1",
      userId: "user-1",
      objectives: [
        { id: "obj-1", weight: 1.5, direction: "maximize" },
        { id: "obj-1", weight: 0.5, direction: "sideways" },
        { id: "", weight: 0.5, direction: "minimize" },
      ],
      exploration: 0.2,
      novelty: 0.2,
      socialInfluence: 0.1,
      attentionMode: "balanced",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("objectives[0].weight"))).toBe(true);
      expect(result.errors.some((e) => e.includes("duplicate objective id"))).toBe(true);
      expect(result.errors.some((e) => e.includes("objectives[1].direction"))).toBe(true);
      expect(result.errors.some((e) => e.includes("objectives[2].id"))).toBe(true);
    }
  });

  it("validatePolicy rejects non-object input", () => {
    expect(validatePolicy(null).ok).toBe(false);
    expect(validatePolicy("policy").ok).toBe(false);
  });

  it("clampPolicy bounds the three dials into [0,1] and records every adjustment", () => {
    const base = defaultPolicy("user-1");
    const result = clampPolicy({ ...base, exploration: 1.5, novelty: -0.25, socialInfluence: 2 });
    expect(result.policy.exploration).toBe(1);
    expect(result.policy.novelty).toBe(0);
    expect(result.policy.socialInfluence).toBe(1);
    expect(result.adjustments.length).toBe(3);
    const joined = result.adjustments.join(" | ");
    expect(joined).toContain("exploration");
    expect(joined).toContain("novelty");
    expect(joined).toContain("socialInfluence");
    expect(validatePolicy(result.policy).ok).toBe(true);
    expect(result.policy).not.toBe(base);
  });

  it("clampPolicy clamps objective weights and negative session-extension caps", () => {
    const base = defaultPolicy("user-1");
    const objectives: RecommendationPolicy["objectives"] = [
      { id: "obj-1", weight: 1.7, direction: "maximize" },
      { id: "obj-2", weight: 0.5, direction: "minimize" },
    ];
    const result = clampPolicy({ ...base, objectives, maxSessionExtensionMinutes: -10 });
    expect(result.policy.objectives[0]?.weight).toBe(1);
    expect(result.policy.objectives[1]?.weight).toBe(0.5);
    expect(result.policy.maxSessionExtensionMinutes).toBe(0);
    expect(result.adjustments.join(" | ")).toContain("objectives[0].weight");
    expect(result.adjustments.join(" | ")).toContain("maxSessionExtensionMinutes");
  });

  it("clampPolicy leaves an already-legal policy untouched and returns an equal copy", () => {
    const base = defaultPolicy("user-1");
    const result = clampPolicy(base);
    expect(result.adjustments).toEqual([]);
    expect(result.policy).toEqual(base);
    expect(result.policy.objectives).not.toBe(base.objectives); // deep-copied
  });

  it("clampPolicy handles NaN and Infinity explicitly", () => {
    const base = defaultPolicy("user-1");
    const result = clampPolicy({
      ...base,
      exploration: Number.NaN,
      novelty: Number.POSITIVE_INFINITY,
      socialInfluence: Number.NEGATIVE_INFINITY,
    });
    expect(result.policy.exploration).toBe(0);
    expect(result.policy.novelty).toBe(1);
    expect(result.policy.socialInfluence).toBe(0);
    expect(result.adjustments.length).toBe(3);
  });
});
