/**
 * @wfx/model-fabric — WFX-032 BYOM adapter tests (Lane A — intelligence).
 *
 * Covers the packet's required cases:
 * - Redaction matrix: every privacy class × field — golden RedactionReports;
 *   no silent transformations; local-only untouched (deep-equal copy, zero
 *   transformations, the original never mutated).
 * - Output validation: well-formed, malformed (missing itemId, NaN score,
 *   non-array), tolerated-unknown-fields — typed results each.
 * - Policy enforcement: clamping bounds exact; empty model response ⇒ typed
 *   degraded (NOT zeros); explanation cap; confidence-0 default.
 * - Cost ceiling: over-budget ⇒ typed refusal, byom NEVER invoked (the
 *   counting fake proves it); exactly-at-budget allowed.
 * - Trace completeness: every stage present on the debug accessor (injected
 *   clock ⇒ exact latency/duration).
 * - Adapter failure: throwing byom ⇒ typed rejection; no substitution.
 * - Fabric registration: tasks + privacy + routing + cost through the MERGED
 *   fabric APIs; duplicate registration typed-refused.
 *
 * Plus: SHA-256 pinned against the official FIPS test vectors and
 * cross-checked against node:crypto; the adapter satisfies the OS model
 * contract (WFX-031 assertModelContract) and runs end-to-end through
 * `runRecommendation`.
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import type {
  EntertainmentCandidate,
  EntertainmentEvent,
  ModelPolicy,
  RecommendationContext,
  RecommendationPolicy,
  RecommendationScore,
  UserIntent,
} from "@wfx/domain";

import { runRecommendation } from "@wfx/recommendation";

import {
  assertModelContract,
  assertValidByomModel,
  BYOM_DEFAULT_PSEUDONYM_SALT,
  BYOM_DEGRADED_REASON,
  BYOM_ERROR_KINDS,
  BYOM_MAX_EXPLANATIONS,
  BYOM_PRIVACY_CLASSES,
  BYOM_SCORE_CEILING,
  BYOM_SCORE_FLOOR,
  BYOM_SUPPORTED_TASKS,
  byomProviderPrivacy,
  ByomError,
  ByomProviderError,
  checkCostCeiling,
  createByomAdapter,
  createByomProvider,
  describeByomError,
  DuplicateProviderError,
  enforcePolicy,
  InvalidByomModelError,
  InvalidByomPolicyError,
  isByomError,
  isByomPrivacyClass,
  makeScriptedByom,
  makeThrowingByom,
  makeWellBehavedByom,
  ModelFabric,
  ModelFabricRegistry,
  ModelRouter,
  pseudonymizeUserId,
  redactForPrivacy,
  registerByom,
  sha256Hex,
  validateByomOutput,
  WELL_BEHAVED_CONFIDENCE,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

/** Canonical-shaped hand-authored item id: wfxitm_ + 26-char ULID body. */
function cid(n: number): string {
  return `wfxitm_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`;
}

const USER = "wfx-test-user";
const OTHER_USER = "wfx-other-user";
const SESSION = "wfx-test-session";
const T_MINUS_1H = "2026-09-13T11:00:00.000Z";
const T_MINUS_30D = "2026-08-14T12:00:00.000Z";
/** Explicit redaction salt for golden pseudonyms. */
const SALT = "wfx-test-salt";
/** Golden pseudonym of USER under SALT (sha256(salt + NUL + user), 32 hex). */
const USER_PSEUDONYM = "wfxanon_4bfbc98e81eefc711a2eae4a0ed29883";
/** Golden pseudonym of OTHER_USER under SALT. */
const OTHER_USER_PSEUDONYM = pseudonymizeUserId(OTHER_USER, SALT);

/** A policy literal with a fixed deterministic id. */
function policy(over: Partial<RecommendationPolicy> = {}): RecommendationPolicy {
  return {
    id: "wfxpol_01ARZ3NDEKF1XT0P000000001",
    userId: USER,
    objectives: [],
    exploration: 0.2,
    novelty: 0.2,
    socialInfluence: 0.1,
    attentionMode: "balanced",
    ...over,
  };
}

/** An intent literal (userId overridable — intents may belong to other users). */
function intent(
  scope: UserIntent["scope"],
  objective: string,
  weight: number,
  confidence: number,
  n: number,
  userId: string = USER,
): UserIntent {
  return {
    id: `wfxint_01ARZ3NDEKF1XTVRE${String(n).padStart(9, "0")}`,
    userId,
    scope,
    objective,
    weight,
    confidence,
    provenance: "explicit",
  };
}

/** A hand-built flat candidate. */
function candidate(over: {
  itemId: string;
  title: string;
  matchText?: string;
  durationMs?: number;
  orientation?: string;
  publishedAt?: string;
}): EntertainmentCandidate {
  return {
    itemId: over.itemId,
    realization: {
      connectorId: "wfx-test-native",
      externalRef: `ref-${over.itemId.slice(-4)}`,
      capabilities: ["identity", "metadata", "playNative"],
      availability: "available",
    },
    features: {
      canonicalType: "video",
      canonicalTitle: over.title,
      matchText: over.matchText ?? `${over.title.toLowerCase()} video horizontal`,
      ...(over.durationMs !== undefined ? { durationMs: over.durationMs } : {}),
      ...(over.orientation !== undefined ? { orientation: over.orientation } : {}),
      ...(over.publishedAt !== undefined ? { publishedAt: over.publishedAt } : {}),
    },
  };
}

/** An event literal (payload optional). */
function event(
  itemId: string,
  type: EntertainmentEvent["type"],
  occurredAt: string,
  payload?: Record<string, unknown>,
): EntertainmentEvent {
  return {
    userId: USER,
    itemId,
    type,
    occurredAt,
    sessionId: SESSION,
    ...(payload !== undefined ? { payload } : {}),
  };
}

/** A context literal with defaults. */
function context(over: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    userId: USER,
    sessionId: SESSION,
    surface: "watch",
    intents: [],
    policy: policy(),
    recentEvents: [],
    candidatePool: [],
    ...over,
  };
}

/**
 * The rich redaction context: two intents (one belonging to ANOTHER user —
 * the OS validator does not cross-check intent owners), a policy, three
 * events (mixed payload shapes), two pool candidates. OS-valid.
 */
function richContext(): RecommendationContext {
  return context({
    intents: [
      intent("session", "sci-fi", 0.8, 0.9, 1),
      intent("persistent", "space opera", 0.6, 0.7, 2, OTHER_USER),
    ],
    recentEvents: [
      event(cid(3), "search", T_MINUS_1H, {
        query: "best sci-fi movies",
        positionMs: 42_000,
        voice: false,
        capturedAt: "2026-09-13T10:59:00.000Z",
        filter: { genre: "sci-fi" },
      }),
      event(cid(3), "complete", T_MINUS_1H),
      event(cid(4), "search", T_MINUS_1H, { query: "only free text here" }),
    ],
    candidatePool: [
      candidate({
        itemId: cid(1),
        title: "Dune Part Two",
        matchText: "dune part two sci-fi epic movie horizontal",
        publishedAt: T_MINUS_30D,
        durationMs: 9_960_000,
        orientation: "horizontal",
      }),
      candidate({
        itemId: cid(2),
        title: "Neon Horizon",
        matchText: "neon horizon sci-fi series vertical",
        publishedAt: T_MINUS_1H,
        durationMs: 45_000,
        orientation: "vertical",
      }),
    ],
  });
}

/** Deterministic fake clock: every call advances time by 5ms from 1000. */
function fakeClock(): () => number {
  let t = 1_000;
  return () => (t += 5);
}

/** The stable reason strings (golden-report pins). */
const REASON_PSEUDONYMIZED =
  "userId replaced with a deterministic salted-hash pseudonym (no reversible identifier)";
const REASON_PAYLOAD_ENTRY =
  "any-cloud payload minimization: entry dropped (free-text/unstructured value)";
const REASON_PAYLOAD_OMITTED =
  "any-cloud payload minimization: payload empty after minimization — field omitted";

/** Capture a promise's outcome without throwing (typed discrimination). */
async function capture<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

// ---------------------------------------------------------------------------
// The BYOM port — model validation
// ---------------------------------------------------------------------------

describe("byom port — ByomModel validation", () => {
  it("accepts a well-formed fixture model (no throw)", () => {
    expect(() => assertValidByomModel(makeWellBehavedByom("byom-ok"))).not.toThrow();
  });

  it("rejects malformed models with field-level typed details", () => {
    const cases: Array<[unknown, string]> = [
      [null, "expected a ByomModel object"],
      [{}, "id: expected a non-empty string"],
      [{ id: "m" }, "version: expected a non-empty string"],
      [
        { id: "m", version: "1" },
        "privacyClass",
      ],
      [
        { id: "m", version: "1", privacyClass: "cloud" },
        "privacyClass: expected one of local-only | trusted-cloud | any-cloud",
      ],
      [
        { id: "m", version: "1", privacyClass: "local-only", costPerCall: -1 },
        "costPerCall: expected a finite non-negative number",
      ],
      [
        { id: "m", version: "1", privacyClass: "local-only", costPerCall: Number.NaN },
        "costPerCall: expected a finite non-negative number, got NaN",
      ],
      [
        { id: "m", version: "1", privacyClass: "local-only", costPerCall: 0 },
        "score: expected a function",
      ],
    ];
    for (const [model, needle] of cases) {
      let caught: unknown;
      try {
        assertValidByomModel(model);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvalidByomModelError);
      const typed = caught as InvalidByomModelError;
      expect(typed.name).toBe("InvalidByomModelError");
      expect(typed.details.length).toBeGreaterThan(0);
      expect(typed.details.join("; ")).toContain(needle);
    }
  });

  it("exposes the frozen privacy-class vocabulary with a runtime guard", () => {
    expect(BYOM_PRIVACY_CLASSES).toEqual(["local-only", "trusted-cloud", "any-cloud"]);
    expect(isByomPrivacyClass("trusted-cloud")).toBe(true);
    expect(isByomPrivacyClass("cloud")).toBe(false);
    expect(isByomPrivacyClass(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SHA-256 + pseudonymization
// ---------------------------------------------------------------------------

describe("redaction — SHA-256 + pseudonymization (pure)", () => {
  it("matches the official FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    );
  });

  it("matches node:crypto on multibyte and multi-block inputs", () => {
    const inputs = [
      `${SALT}\u0000${USER}`,
      "ünïcödé → 你好，世界 🎬",
      "x".repeat(1_000),
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
    ];
    for (const input of inputs) {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
    }
  });

  it("pseudonymizes deterministically: format, stability, salt and user sensitivity", () => {
    const pseudonym = pseudonymizeUserId(USER, SALT);
    expect(pseudonym).toMatch(/^wfxanon_[0-9a-f]{32}$/);
    expect(pseudonym).toBe(USER_PSEUDONYM); // golden
    expect(pseudonym).not.toBe(USER); // the identifier itself never appears
    // determinism: identical inputs ⇒ identical pseudonym
    expect(pseudonymizeUserId(USER, SALT)).toBe(pseudonym);
    // salt sensitivity
    expect(pseudonymizeUserId(USER, "another-salt")).not.toBe(pseudonym);
    // user sensitivity
    expect(pseudonymizeUserId(OTHER_USER, SALT)).not.toBe(pseudonym);
    // the default salt is a documented constant
    expect(pseudonymizeUserId(USER, BYOM_DEFAULT_PSEUDONYM_SALT)).toBe(
      "wfxanon_87df83775c6ec82885885e364824369a",
    );
  });
});

// ---------------------------------------------------------------------------
// Redaction matrix — golden reports
// ---------------------------------------------------------------------------

describe("redaction matrix (golden RedactionReports)", () => {
  it("local-only ⇒ full context untouched: deep-equal copy, ZERO transformations", () => {
    const rich = richContext();
    const result = redactForPrivacy(rich, "local-only", { salt: SALT });

    // content untouched — every field, verbatim (payloads included)
    expect(result.input).toEqual(rich);
    // ...but it IS a copy: the model never holds the caller's objects
    expect(result.input).not.toBe(rich);
    expect(result.input.candidatePool[0]).not.toBe(rich.candidatePool[0]);

    // golden report: privacyClass recorded, no transformation claimed
    expect(result.report).toEqual({ privacyClass: "local-only", transformations: [] });

    // mutating the copy never corrupts the original
    const features = result.input.candidatePool[0]!.features as Record<string, unknown>;
    features.matchText = "MUTATED";
    (result.input.recentEvents[0]!.payload as Record<string, unknown>).query = "MUTATED";
    expect(rich.candidatePool[0]!.features.matchText).toBe(
      "dune part two sci-fi epic movie horizontal",
    );
    expect(
      (rich.recentEvents[0]!.payload as Record<string, unknown>).query,
    ).toBe("best sci-fi movies");
  });

  it("trusted-cloud ⇒ every userId pseudonymized, session ids and payloads kept (golden)", () => {
    const rich = richContext();
    const result = redactForPrivacy(rich, "trusted-cloud", { salt: SALT });

    // every userId occurrence pseudonymized — the SAME pseudonym for the same
    // user (joinability preserved), a DIFFERENT one for the other user's intent
    expect(result.input.userId).toBe(USER_PSEUDONYM);
    expect(result.input.intents[0]!.userId).toBe(USER_PSEUDONYM);
    expect(result.input.intents[1]!.userId).toBe(OTHER_USER_PSEUDONYM);
    expect(result.input.intents[1]!.userId).not.toBe(USER_PSEUDONYM);
    expect(result.input.policy.userId).toBe(USER_PSEUDONYM);
    expect(result.input.recentEvents[0]!.userId).toBe(USER_PSEUDONYM);
    expect(result.input.recentEvents[1]!.userId).toBe(USER_PSEUDONYM);
    expect(result.input.recentEvents[2]!.userId).toBe(USER_PSEUDONYM);

    // session ids kept (the spec keeps them) — context AND events
    expect(result.input.sessionId).toBe(SESSION);
    for (const redactedEvent of result.input.recentEvents) {
      expect(redactedEvent.sessionId).toBe(SESSION);
    }

    // payloads kept VERBATIM (trusted cloud minimizes nothing)
    expect(result.input.recentEvents[0]!.payload).toEqual({
      query: "best sci-fi movies",
      positionMs: 42_000,
      voice: false,
      capturedAt: "2026-09-13T10:59:00.000Z",
      filter: { genre: "sci-fi" },
    });
    expect(result.input.recentEvents[1]!.payload).toBeUndefined();
    expect(result.input.recentEvents[2]!.payload).toEqual({ query: "only free text here" });

    // pool + surface verbatim
    expect(result.input.candidatePool).toEqual(rich.candidatePool);
    expect(result.input.surface).toBe("watch");

    // GOLDEN report: every transformation, exact paths, actions, reasons — auditable
    expect(result.report).toEqual({
      privacyClass: "trusted-cloud",
      transformations: [
        { field: "userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "intents[0].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "intents[1].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "policy.userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "recentEvents[0].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "recentEvents[1].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "recentEvents[2].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
      ],
    });
  });

  it("any-cloud ⇒ pseudonymized + event payloads minimized: types/timestamps kept, free text dropped (golden)", () => {
    const rich = richContext();
    const result = redactForPrivacy(rich, "any-cloud", { salt: SALT });

    // pseudonymization identical to trusted-cloud (same salt ⇒ same pseudonyms)
    expect(result.input.userId).toBe(USER_PSEUDONYM);
    expect(result.input.intents[1]!.userId).toBe(OTHER_USER_PSEUDONYM);
    expect(result.input.policy.userId).toBe(USER_PSEUDONYM);

    // event 0: structured entries kept (number, boolean, ISO timestamp string),
    // free text and nested structure dropped
    expect(result.input.recentEvents[0]!.payload).toEqual({
      positionMs: 42_000,
      voice: false,
      capturedAt: "2026-09-13T10:59:00.000Z",
    });
    // event 1 never had a payload
    expect(result.input.recentEvents[1]!.payload).toBeUndefined();
    // event 2: everything dropped ⇒ the payload FIELD is omitted entirely
    expect("payload" in result.input.recentEvents[2]!).toBe(false);

    // the event scaffolding is kept: types, timestamps, item/session ids
    expect(result.input.recentEvents[2]!.type).toBe("search");
    expect(result.input.recentEvents[2]!.occurredAt).toBe(T_MINUS_1H);
    expect(result.input.recentEvents[2]!.itemId).toBe(cid(4));
    expect(result.input.recentEvents[2]!.sessionId).toBe(SESSION);

    // GOLDEN report: pseudonymizations and payload drops in document order —
    // per event, the userId pseudonymization precedes that event's payload
    // drops; the whole-field omission recorded — nothing silent
    expect(result.report).toEqual({
      privacyClass: "any-cloud",
      transformations: [
        { field: "userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "intents[0].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "intents[1].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "policy.userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "recentEvents[0].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        {
          field: "recentEvents[0].payload.query",
          action: "dropped",
          reason: `${REASON_PAYLOAD_ENTRY} (value kind: string)`,
        },
        {
          field: "recentEvents[0].payload.filter",
          action: "dropped",
          reason: `${REASON_PAYLOAD_ENTRY} (value kind: object)`,
        },
        { field: "recentEvents[1].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        { field: "recentEvents[2].userId", action: "pseudonymized", reason: REASON_PSEUDONYMIZED },
        {
          field: "recentEvents[2].payload.query",
          action: "dropped",
          reason: `${REASON_PAYLOAD_ENTRY} (value kind: string)`,
        },
        { field: "recentEvents[2].payload", action: "dropped", reason: REASON_PAYLOAD_OMITTED },
      ],
    });
  });

  it("is pure and deterministic: identical inputs ⇒ identical input AND report", () => {
    for (const privacyClass of BYOM_PRIVACY_CLASSES) {
      const first = redactForPrivacy(richContext(), privacyClass, { salt: SALT });
      const second = redactForPrivacy(richContext(), privacyClass, { salt: SALT });
      expect(first.input).toEqual(second.input);
      expect(first.report).toEqual(second.report);
    }
  });

  it("never leaks a redacted value into the report (paths and reasons only)", () => {
    const anyCloud = redactForPrivacy(richContext(), "any-cloud", { salt: SALT });
    const serialized = JSON.stringify(anyCloud.report);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain("best sci-fi movies");
    expect(serialized).not.toContain("only free text");
    expect(serialized).not.toContain("sci-fi"); // the nested filter's content
  });

  it("fails loudly on an invalid privacy class (never a silent wrong redaction)", () => {
    expect(() => redactForPrivacy(richContext(), "cloud" as never, { salt: SALT })).toThrow(
      /privacyClass must be one of/,
    );
  });
});

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

describe("output validation — validateByomOutput (strict schema, typed results)", () => {
  it("accepts a well-formed array with typed value and empty report", () => {
    const raw = [
      { itemId: cid(1), score: 0.5, explanations: ["line"], confidence: 0.9 },
    ];
    const result = validateByomOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(raw);
      expect(result.report.unknownFields).toEqual([]);
    }
  });

  it("tolerates unknown fields but logs them in the report (never silent)", () => {
    const raw = [
      { itemId: cid(1), score: 0.5, explanations: [], confidence: 0.9, rank: 1, extra: "x" },
      { itemId: cid(2), score: 0.4, explanations: [], confidence: 0.8, z: null },
    ];
    const result = validateByomOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.unknownFields).toEqual([
        "scores[0].rank",
        "scores[0].extra",
        "scores[1].z",
      ]);
    }
  });

  it("rejects a non-array with a typed path error", () => {
    for (const raw of [{ scores: [] }, null, "nope", 42, undefined]) {
      const result = validateByomOutput(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toMatch(/^scores: expected an array of RecommendationScore/);
      }
    }
  });

  it("rejects a missing itemId with the field path", () => {
    const result = validateByomOutput([{ score: 0.5, explanations: [], confidence: 0.9 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/^scores\[0\]\.itemId: expected a non-empty string/);
    }
  });

  it("rejects a NaN score with a typed error naming NaN", () => {
    const result = validateByomOutput([
      { itemId: cid(1), score: Number.NaN, explanations: [], confidence: 0.9 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toBe("scores[0].score: expected a finite number, got NaN");
    }
  });

  it("rejects non-finite and out-of-range confidence with paths", () => {
    for (const confidence of [Number.POSITIVE_INFINITY, 1.5, -0.1]) {
      const result = validateByomOutput([
        { itemId: cid(1), score: 0.5, explanations: [], confidence },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toMatch(/^scores\[0\]\.confidence: expected a finite number in \[0, 1\]/);
      }
    }
  });

  it("rejects malformed explanations with a path", () => {
    for (const explanations of ["line", [1, 2], { 0: "line" }]) {
      const result = validateByomOutput([
        { itemId: cid(1), score: 0.5, explanations, confidence: 0.9 },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toMatch(/^scores\[0\]\.explanations: expected an array of strings/);
      }
    }
  });

  it("rejects a non-object entry with a path", () => {
    const result = validateByomOutput([42]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/^scores\[0\]: expected a RecommendationScore object/);
    }
  });

  it("rejects duplicate itemIds — the score interface is item-keyed", () => {
    const result = validateByomOutput([
      { itemId: cid(1), score: 0.5, explanations: [], confidence: 0.9 },
      { itemId: cid(1), score: 0.4, explanations: [], confidence: 0.8 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("duplicate score — exactly one score per item");
      expect(result.errors[0]).toContain(`scores[0]`);
    }
  });

  it("aggregates every problem into one typed result", () => {
    const result = validateByomOutput([
      { score: Number.NaN, confidence: 2 },
      "garbage",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
      expect(result.errors.join("\n")).toContain("scores[0].itemId");
      expect(result.errors.join("\n")).toContain("scores[0].score");
      expect(result.errors.join("\n")).toContain("scores[0].explanations");
      expect(result.errors.join("\n")).toContain("scores[0].confidence");
      expect(result.errors.join("\n")).toContain("scores[1]: expected a RecommendationScore object");
    }
  });

  it("logs tolerated unknown fields even when validation fails", () => {
    const result = validateByomOutput([
      { itemId: cid(1), score: Number.NaN, explanations: [], confidence: 0.9, rank: 3 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.unknownFields).toEqual(["scores[0].rank"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Policy enforcement
// ---------------------------------------------------------------------------

describe("policy enforcement — enforcePolicy (clamps, caps, degraded)", () => {
  const entry = (itemId: string, score: number, explanations = 0, confidence = 0.9) => ({
    itemId,
    score,
    explanations: Array.from({ length: explanations }, (_, i) => `line ${i + 1}`),
    confidence,
  });

  it("clamps scores to the exact default bounds [-1, 1], in-range values untouched", () => {
    const result = enforcePolicy([
      entry(cid(1), 42),
      entry(cid(2), -7),
      entry(cid(3), 0.3),
      entry(cid(4), -1), // exactly at the floor — not clamped
      entry(cid(5), 1), // exactly at the ceiling — not clamped
    ]);
    expect(result.verdict).toBe("ok");
    if (result.verdict === "ok") {
      expect(result.scores.map((s) => s.score)).toEqual([1, -1, 0.3, -1, 1]);
      // exact clamps recorded: from → to
      expect(result.report.clamps).toEqual([
        { itemId: cid(1), from: 42, to: BYOM_SCORE_CEILING },
        { itemId: cid(2), from: -7, to: BYOM_SCORE_FLOOR },
      ]);
      expect(result.report.explanationCaps).toEqual([]);
    }
    expect(BYOM_SCORE_FLOOR).toBe(-1);
    expect(BYOM_SCORE_CEILING).toBe(1);
  });

  it("honors custom clamp bounds from the policy", () => {
    const result = enforcePolicy([entry(cid(1), 42), entry(cid(2), -7)], {
      scoreFloor: 0,
      scoreCeiling: 10,
    });
    expect(result.verdict).toBe("ok");
    if (result.verdict === "ok") {
      expect(result.scores.map((s) => s.score)).toEqual([10, 0]);
      expect(result.report.clamps).toEqual([
        { itemId: cid(1), from: 42, to: 10 },
        { itemId: cid(2), from: -7, to: 0 },
      ]);
    }
  });

  it("caps explanation count at the default (5) and records every cap", () => {
    const result = enforcePolicy([entry(cid(1), 0.5, 10), entry(cid(2), 0.4, 5), entry(cid(3), 0.3, 2)]);
    expect(result.verdict).toBe("ok");
    if (result.verdict === "ok") {
      expect(result.scores[0]!.explanations).toEqual(["line 1", "line 2", "line 3", "line 4", "line 5"]);
      expect(result.scores[1]!.explanations).toHaveLength(5); // exactly at the cap — untouched
      expect(result.scores[2]!.explanations).toHaveLength(2); // under the cap — untouched
      expect(result.report.explanationCaps).toEqual([{ itemId: cid(1), from: 10, to: BYOM_MAX_EXPLANATIONS }]);
      expect(BYOM_MAX_EXPLANATIONS).toBe(5);
    }
  });

  it("honors a custom explanation cap", () => {
    const result = enforcePolicy([entry(cid(1), 0.5, 7)], { maxExplanations: 2 });
    expect(result.verdict).toBe("ok");
    if (result.verdict === "ok") {
      expect(result.scores[0]!.explanations).toEqual(["line 1", "line 2"]);
      expect(result.report.explanationCaps).toEqual([{ itemId: cid(1), from: 7, to: 2 }]);
    }
  });

  it("empty model response ⇒ typed degraded verdict with confidence 0 — NOT fabricated zeros", () => {
    const result = enforcePolicy([]);
    expect(result.verdict).toBe("degraded");
    if (result.verdict === "degraded") {
      expect(result.confidence).toBe(0); // the confidence-0 default marking
      expect(result.reason).toBe(BYOM_DEGRADED_REASON);
      expect(result.scores).toEqual([]); // literally no scores — never fake zeros
      expect(result.report).toEqual({ clamps: [], explanationCaps: [] });
    }
  });

  it("throws a typed InvalidByomPolicyError on malformed policies (never a silently-ignored knob)", () => {
    const cases: Array<[object, string]> = [
      [{ scoreFloor: 5, scoreCeiling: 1 }, "scoreFloor (5) must not exceed scoreCeiling (1)"],
      [{ maxExplanations: 0 }, "maxExplanations: expected a positive integer"],
      [{ maxExplanations: 1.5 }, "maxExplanations: expected a positive integer"],
      [{ maxCostPerOperation: -1 }, "maxCostPerOperation: expected a finite non-negative number"],
      [{ scoreFloor: Number.NaN }, "scoreFloor: expected a finite number when present, got NaN"],
    ];
    for (const [badPolicy, needle] of cases) {
      let caught: unknown;
      try {
        enforcePolicy([entry(cid(1), 0.5)], badPolicy);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvalidByomPolicyError);
      expect((caught as InvalidByomPolicyError).details.join("; ")).toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------
// Cost ceiling
// ---------------------------------------------------------------------------

describe("cost ceiling — checkCostCeiling (pre-invocation gate)", () => {
  const byom = { costPerCall: 0.25 };

  it("no ceiling configured ⇒ allowed (the fabric's absent-field semantics)", () => {
    const record = checkCostCeiling(byom, 1, {});
    expect(record).toEqual({ estimatedCalls: 1, costPerCall: 0.25, estimatedCost: 0.25, allowed: true });
    expect("maxCostPerOperation" in record).toBe(false); // honest absence
  });

  it("exactly at the ceiling ⇒ allowed (within budget)", () => {
    const record = checkCostCeiling(byom, 2, { maxCostPerOperation: 0.5 });
    expect(record.allowed).toBe(true);
    expect(record.estimatedCost).toBe(0.5);
    expect(record.maxCostPerOperation).toBe(0.5);
  });

  it("over budget ⇒ refused, with the full arithmetic recorded", () => {
    const record = checkCostCeiling(byom, 3, { maxCostPerOperation: 0.5 });
    expect(record).toEqual({
      estimatedCalls: 3,
      costPerCall: 0.25,
      estimatedCost: 0.75,
      maxCostPerOperation: 0.5,
      allowed: false,
    });
  });

  it("throws a typed error on a malformed ceiling", () => {
    expect(() => checkCostCeiling(byom, 1, { maxCostPerOperation: -3 })).toThrow(
      InvalidByomPolicyError,
    );
  });
});

// ---------------------------------------------------------------------------
// The adapter — happy path, trace, redaction end-to-end
// ---------------------------------------------------------------------------

describe("adapter — happy path (redact → cost check → invoke → validate → enforce)", () => {
  it("returns enforced scores; the byom sees the REDACTED input; scores stay clean", async () => {
    const byom = makeWellBehavedByom("byom-test-model", { privacyClass: "trusted-cloud" });
    const adapter = createByomAdapter(byom, { clock: fakeClock(), pseudonymSalt: SALT });

    const scores = await adapter.score(richContext());

    // the well-behaved fixture scored both distinct pool items
    expect(scores).toHaveLength(2);
    expect(scores.map((s) => s.itemId)).toEqual([cid(1), cid(2)]);
    expect(scores.map((s) => s.score)).toEqual([0.5, 0.45]);
    expect(scores.every((s) => s.confidence === WELL_BEHAVED_CONFIDENCE)).toBe(true);

    // the model was invoked EXACTLY once, with the redacted input
    expect(byom.calls).toHaveLength(1);
    const seen = byom.calls[0]!;
    expect(seen.userId).toBe(USER_PSEUDONYM); // pseudonymized for trusted-cloud
    expect(seen.sessionId).toBe(SESSION); // session ids kept
    expect(seen.candidatePool).toHaveLength(2); // features included
    expect(seen.recentEvents[0]!.payload).toEqual({
      query: "best sci-fi movies",
      positionMs: 42_000,
      voice: false,
      capturedAt: "2026-09-13T10:59:00.000Z",
      filter: { genre: "sci-fi" },
    }); // trusted-cloud keeps payloads verbatim

    // scores stay CLEAN: exactly the four frozen fields, no trace/debug pollution
    for (const score of scores) {
      expect(Object.keys(score).sort()).toEqual(["confidence", "explanations", "itemId", "score"]);
    }
    expect(JSON.stringify(scores)).not.toContain("trace");
    expect(JSON.stringify(scores)).not.toContain("redaction");
  });

  it("local-only byom sees the FULL context verbatim", async () => {
    const byom = makeWellBehavedByom("byom-local-model", { privacyClass: "local-only" });
    const adapter = createByomAdapter(byom, { clock: fakeClock(), pseudonymSalt: SALT });
    await adapter.score(richContext());
    expect(byom.calls[0]!.userId).toBe(USER); // untouched
    expect(byom.calls[0]!.intents[1]!.userId).toBe(OTHER_USER);
  });

  it("any-cloud byom sees minimized payloads", async () => {
    const byom = makeWellBehavedByom("byom-any-model", { privacyClass: "any-cloud" });
    const adapter = createByomAdapter(byom, { clock: fakeClock(), pseudonymSalt: SALT });
    await adapter.score(richContext());
    expect(byom.calls[0]!.userId).toBe(USER_PSEUDONYM);
    expect(byom.calls[0]!.recentEvents[0]!.payload).toEqual({
      positionMs: 42_000,
      voice: false,
      capturedAt: "2026-09-13T10:59:00.000Z",
    });
    expect("payload" in byom.calls[0]!.recentEvents[2]!).toBe(false);
  });

  it("is deterministic: identical ctx ⇒ byte-identical scores", async () => {
    const adapter = createByomAdapter(makeWellBehavedByom("byom-det"), { clock: fakeClock() });
    const first = await adapter.score(richContext());
    const second = await adapter.score(richContext());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("clamps and caps out-of-policy model output end-to-end, tolerating unknown fields", async () => {
    const scripted = makeScriptedByom("byom-wild", {
      responses: [
        [
          {
            itemId: cid(1),
            score: 42, // far above the ceiling
            explanations: Array.from({ length: 8 }, (_, i) => `reason ${i + 1}`),
            confidence: 0.9,
            rank: 7, // unknown field: tolerated, logged, preserved
          },
        ],
      ],
    });
    const adapter = createByomAdapter(scripted, { clock: fakeClock() });

    const scores = await adapter.score(richContext());
    expect(scores).toHaveLength(1);
    expect(scores[0]!.score).toBe(1); // clamped to the default ceiling
    expect(scores[0]!.explanations).toHaveLength(5); // capped at the default
    expect((scores[0] as unknown as Record<string, unknown>).rank).toBe(7); // tolerated

    const trace = adapter.debug.lastTrace()!;
    expect(trace.enforcement!.clamps).toEqual([{ itemId: cid(1), from: 42, to: 1 }]);
    expect(trace.enforcement!.explanationCaps).toEqual([{ itemId: cid(1), from: 8, to: 5 }]);
    expect(trace.validation!.unknownFields).toEqual(["scores[0].rank"]);
  });

  it("records EVERY stage on the debug accessor with exact injected-clock timings", async () => {
    const byom = makeWellBehavedByom("byom-traced", { privacyClass: "any-cloud", costPerCall: 0.25 });
    const adapter = createByomAdapter(byom, {
      clock: fakeClock(),
      pseudonymSalt: SALT,
      policy: { maxCostPerOperation: 1 },
    });

    expect(adapter.debug.lastTrace()).toBeNull(); // nothing before the first call
    expect(adapter.debug.invocationCount()).toBe(0);

    await adapter.score(richContext());

    expect(adapter.debug.invocationCount()).toBe(1);
    const trace = adapter.debug.lastTrace()!;
    expect(trace.invocationIndex).toBe(1);
    expect(trace.model).toEqual({
      id: "byom-traced",
      version: "1.0.0",
      privacyClass: "any-cloud",
    });
    // injected clock: entry 1005 → finish 1020 ⇒ duration 15; invoke 1010 → 1015 ⇒ latency 5
    expect(trace.startedAt).toBe("1970-01-01T00:00:01.005Z");
    expect(trace.durationMs).toBe(15);
    expect(trace.outcome).toBe("ok");

    // stage: redaction (the any-cloud golden report, verbatim in the trace)
    expect(trace.redaction!.privacyClass).toBe("any-cloud");
    expect(trace.redaction!.transformations.length).toBe(11);

    // stage: cost check (allowed, within the ceiling)
    expect(trace.costCheck).toEqual({
      estimatedCalls: 1,
      costPerCall: 0.25,
      estimatedCost: 0.25,
      maxCostPerOperation: 1,
      allowed: true,
    });

    // stage: invocation (it ran, latency from the clock)
    expect(trace.invocation).toEqual({ invoked: true, latencyMs: 5 });

    // stage: validation (ok, no unknown fields from the well-behaved fixture)
    expect(trace.validation).toEqual({ ok: true, errors: [], unknownFields: [] });

    // stage: enforcement (ok, nothing to clamp or cap)
    expect(trace.enforcement).toEqual({
      verdict: "ok",
      clamps: [],
      explanationCaps: [],
    });

    // a second invocation advances the counter and overwrites the last trace
    await adapter.score(richContext());
    expect(adapter.debug.invocationCount()).toBe(2);
    expect(adapter.debug.lastTrace()!.invocationIndex).toBe(2);
  });

  it("satisfies the OS model contract (WFX-031 assertModelContract) and runs the OS pipeline", async () => {
    const adapter = createByomAdapter(makeWellBehavedByom("byom-os-compatible"));

    // the merged WFX-031 contract probe: shape, output, determinism
    await assertModelContract(adapter);

    // end-to-end through the OS pipeline: the adapter is just a model
    const page = await runRecommendation(richContext(), { model: adapter });
    expect(page.cards).toHaveLength(2);
    expect(page.cards.map((card) => card.candidate.itemId)).toEqual([cid(1), cid(2)]);
    expect(page.cards.map((card) => card.modelScore)).toEqual([0.5, 0.45]);
    expect(page.trace.model).toEqual({ id: "byom-os-compatible", version: "1.0.0" });
  });
});

// ---------------------------------------------------------------------------
// The adapter — typed failures (no substitution, ever)
// ---------------------------------------------------------------------------

describe("adapter — typed failures", () => {
  it("malformed ctx ⇒ ByomError invalid-context with the OS validator's field paths; byom NEVER invoked", async () => {
    const byom = makeWellBehavedByom("byom-ctx");
    const adapter = createByomAdapter(byom, { clock: fakeClock() });

    const outcome = await capture(adapter.score(context({ candidatePool: "nope" as never })));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const error = outcome.error as ByomError;
      expect(isByomError(error)).toBe(true);
      expect(error.kind).toBe("invalid-context");
      expect(error.details.join("\n")).toContain("candidatePool: expected an array");
    }
    expect(byom.calls).toHaveLength(0); // never invoked on malformed input

    const trace = adapter.debug.lastTrace()!;
    expect(trace.outcome).toBe("invalid-context");
    expect(trace.redaction).toBeUndefined(); // redaction never ran
    expect(trace.invocation).toBeUndefined();
  });

  it("over budget ⇒ ByomError cost-refused BEFORE invocation — the counting fake proves it", async () => {
    const byom = makeWellBehavedByom("byom-expensive", { costPerCall: 10 });
    const adapter = createByomAdapter(byom, {
      clock: fakeClock(),
      policy: { maxCostPerOperation: 5 },
    });

    const outcome = await capture(adapter.score(richContext()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const error = outcome.error as ByomError;
      expect(isByomError(error)).toBe(true);
      expect(error.kind).toBe("cost-refused");
      expect(error.budget).toBe(5);
      expect(error.estimatedCost).toBe(10);
      expect(error.details[0]).toContain("exceeds the policy ceiling 5");
    }

    // THE proof: the model was NEVER invoked
    expect(byom.calls).toHaveLength(0);

    const trace = adapter.debug.lastTrace()!;
    expect(trace.outcome).toBe("cost-refused");
    expect(trace.costCheck!.allowed).toBe(false);
    expect(trace.invocation).toBeUndefined(); // no invocation stage — it never ran
    expect(trace.redaction!.privacyClass).toBe("local-only"); // redaction DID run first
    expect(trace.durationMs).toBe(5); // entry + finish only (2 clock calls)
  });

  it("estimated-calls multiplier participates in the estimate", async () => {
    const byom = makeWellBehavedByom("byom-batchy", { costPerCall: 2 });
    const adapter = createByomAdapter(byom, {
      clock: fakeClock(),
      estimatedCallsPerScore: 3, // 2 × 3 = 6 > 5
      policy: { maxCostPerOperation: 5 },
    });
    const outcome = await capture(adapter.score(richContext()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect((outcome.error as ByomError).estimatedCost).toBe(6);
    }
    expect(byom.calls).toHaveLength(0);
  });

  it("exactly at budget ⇒ allowed (within budget, not over)", async () => {
    const byom = makeWellBehavedByom("byom-exact", { costPerCall: 5 });
    const adapter = createByomAdapter(byom, {
      clock: fakeClock(),
      policy: { maxCostPerOperation: 5 },
    });
    const scores = await adapter.score(richContext());
    expect(scores).toHaveLength(2);
    expect(byom.calls).toHaveLength(1);
  });

  it("throwing byom (async rejection) ⇒ typed ByomError model-failure, no substitution", async () => {
    const byom = makeThrowingByom("byom-throwing", {
      failure: "reject",
      errorMessage: "the model exploded",
    });
    const adapter = createByomAdapter(byom, { clock: fakeClock() });

    const outcome = await capture(adapter.score(richContext()));
    expect(outcome.ok).toBe(false); // a REJECTION — the adapter never resolves fake scores
    if (!outcome.ok) {
      const error = outcome.error as ByomError;
      expect(isByomError(error)).toBe(true);
      expect(error.kind).toBe("model-failure");
      expect(error.details[0]).toContain("byom-throwing");
      expect(error.details[0]).toContain("the model exploded");
    }
    expect(byom.calls).toHaveLength(1); // it WAS invoked (and failed)

    const trace = adapter.debug.lastTrace()!;
    expect(trace.outcome).toBe("model-failure");
    expect(trace.invocation).toEqual({ invoked: true, latencyMs: 5 });
    expect(trace.validation).toBeUndefined(); // nothing to validate
  });

  it("throwing byom (synchronous throw) ⇒ same typed rejection", async () => {
    const byom = makeThrowingByom("byom-sync-throwing", { failure: "sync-throw" });
    const adapter = createByomAdapter(byom, { clock: fakeClock() });

    const outcome = await capture(adapter.score(richContext()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect((outcome.error as ByomError).kind).toBe("model-failure");
    }
  });

  it("malformed output ⇒ ByomError invalid-output with typed paths", async () => {
    const cases: Array<[unknown, string]> = [
      [[{ score: 0.5, explanations: [], confidence: 0.9 }], "scores[0].itemId"],
      [[{ itemId: cid(1), score: Number.NaN, explanations: [], confidence: 0.9 }], "got NaN"],
      [{ scores: [] }, "scores: expected an array of RecommendationScore"],
    ];
    for (const [rawResponse, needle] of cases) {
      const byom = makeScriptedByom("byom-malformed", { responses: [rawResponse] });
      const adapter = createByomAdapter(byom, { clock: fakeClock() });
      const outcome = await capture(adapter.score(richContext()));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        const error = outcome.error as ByomError;
        expect(error.kind).toBe("invalid-output");
        expect(error.details.join("\n")).toContain(needle);
      }
      const trace = adapter.debug.lastTrace()!;
      expect(trace.outcome).toBe("invalid-output");
      expect(trace.validation!.ok).toBe(false);
      expect(trace.enforcement).toBeUndefined(); // enforcement never ran
    }
  });

  it("empty model response ⇒ typed degraded verdict (confidence 0), NOT fake zeros", async () => {
    const byom = makeScriptedByom("byom-empty", { responses: [[]] }); // valid schema, zero scores
    const adapter = createByomAdapter(byom, { clock: fakeClock() });

    const outcome = await capture(adapter.score(richContext()));
    expect(outcome.ok).toBe(false); // the OS sees a typed rejection, not silent emptiness
    if (!outcome.ok) {
      const error = outcome.error as ByomError;
      expect(isByomError(error)).toBe(true);
      expect(error.kind).toBe("degraded");
      expect(error.confidence).toBe(0); // the confidence-0 marking
      expect(error.details[0]).toContain(BYOM_DEGRADED_REASON);
      expect(error.details[0]).toContain("no scores fabricated");
    }

    const trace = adapter.debug.lastTrace()!;
    expect(trace.outcome).toBe("degraded");
    expect(trace.validation).toEqual({ ok: true, errors: [], unknownFields: [] }); // [] IS valid
    expect(trace.enforcement!.verdict).toBe("degraded");
    expect(trace.enforcement!.degradedReason).toBe(BYOM_DEGRADED_REASON);
  });

  it("construction validates the byom model and the options (typed, fail fast)", () => {
    expect(() => createByomAdapter({ id: "bad" } as never)).toThrow(InvalidByomModelError);
    const good = makeWellBehavedByom("byom-good");
    expect(() => createByomAdapter(good, { policy: { maxExplanations: 0 } })).toThrow(
      InvalidByomPolicyError,
    );
    expect(() => createByomAdapter(good, { estimatedCallsPerScore: 0 })).toThrow(
      /estimatedCallsPerScore must be a positive integer/,
    );
  });

  it("exposes the closed error vocabulary with guards and honest descriptions", () => {
    expect(BYOM_ERROR_KINDS).toEqual([
      "invalid-context",
      "cost-refused",
      "invalid-output",
      "degraded",
      "model-failure",
    ]);
    const error = new ByomError("degraded", ["empty"], { confidence: 0 });
    expect(isByomError(error)).toBe(true);
    expect(isByomError(new Error("plain"))).toBe(false);
    expect(isByomError(null)).toBe(false);
    expect(describeByomError(error)).toContain("degraded");
    expect(describeByomError(error)).toContain("no scores were fabricated");
    for (const kind of BYOM_ERROR_KINDS) {
      expect(describeByomError(new ByomError(kind, ["x"]))).toContain(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// The fabric wrapper — provider, registration, routing + cost via MERGED APIs
// ---------------------------------------------------------------------------

describe("fabric — BYOM provider, registration, routing (merged APIs)", () => {
  it("maps every privacy class to the fabric provider privacy", () => {
    expect(byomProviderPrivacy("local-only")).toBe("local");
    expect(byomProviderPrivacy("trusted-cloud")).toBe("cloud");
    expect(byomProviderPrivacy("any-cloud")).toBe("cloud");
  });

  it("registers under BOTH tasks with the derived privacy, via the merged registry API", () => {
    const registry = new ModelFabricRegistry();
    const provider = registerByom(registry, makeWellBehavedByom("byom-fabric-model", {
      privacyClass: "any-cloud",
      costPerCall: 0.25,
    }));

    expect(provider.id).toBe("byom-fabric-model");
    expect(provider.privacy).toBe("cloud");
    expect(provider.capabilities).toEqual([...BYOM_SUPPORTED_TASKS]);
    expect(BYOM_SUPPORTED_TASKS).toEqual(["recommendation", "ranking"]);
    // declared costs: per-call for served tasks, honest absence elsewhere
    expect(provider.costPerOperation("recommendation")).toBe(0.25);
    expect(provider.costPerOperation("ranking")).toBe(0.25);
    expect(provider.costPerOperation("summary")).toBeUndefined();

    // the merged describe() matrix carries the registration
    const description = registry.describe();
    expect(description.providers).toContainEqual({
      id: "byom-fabric-model",
      privacy: "cloud",
      capabilities: ["recommendation", "ranking"],
    });
    expect(description.byTask.recommendation).toContain("byom-fabric-model");
    expect(description.byTask.ranking).toContain("byom-fabric-model");
  });

  it("duplicate registration ⇒ the merged registry's typed refusal", () => {
    const registry = new ModelFabricRegistry();
    registerByom(registry, makeWellBehavedByom("byom-dup"));
    expect(() => registerByom(registry, makeWellBehavedByom("byom-dup"))).toThrow(
      DuplicateProviderError,
    );
    expect(registry.size()).toBe(1); // the first registration stands
  });

  it("invokes through the MERGED gateway: routing, envelope, cost, trace", async () => {
    const registry = new ModelFabricRegistry();
    const byom = makeWellBehavedByom("byom-routed", {
      privacyClass: "any-cloud",
      costPerCall: 0.25,
    });
    registerByom(registry, byom);
    const fabric = new ModelFabric(registry);

    const modelPolicy: ModelPolicy = {
      task: "recommendation",
      preferredProvider: "byom-routed",
      fallbackProviders: [],
      privacy: "any-cloud",
    };
    const result = await fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      richContext(),
      modelPolicy,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((score) => score.itemId)).toEqual([cid(1), cid(2)]);
      expect(result.trace.providerId).toBe("byom-routed");
      expect(result.trace.cost).toBe(0.25); // declared cost accounted by the MERGED gateway
    }
    // the adapter's redaction ran inside the fabric invocation
    expect(byom.calls).toHaveLength(1);
    expect(byom.calls[0]!.userId).toBe(pseudonymizeUserId(USER, BYOM_DEFAULT_PSEUDONYM_SALT));

    // the ranking task routes the same way (caller intent, same math)
    const ranking = await fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "ranking",
      richContext(),
      { ...modelPolicy, task: "ranking" },
    );
    expect(ranking.ok).toBe(true);
  });

  it("local-only model policies never route to a CLOUD byom (merged router privacy filter)", () => {
    const registry = new ModelFabricRegistry();
    registerByom(registry, makeWellBehavedByom("byom-cloud-a", { privacyClass: "any-cloud" }));
    registerByom(registry, makeWellBehavedByom("byom-local-a", { privacyClass: "local-only" }));
    const router = new ModelRouter(registry);

    // preferred cloud + local fallback: ONLY the local provider survives the plan
    const plan = router.route("recommendation", {
      task: "recommendation",
      preferredProvider: "byom-cloud-a",
      fallbackProviders: ["byom-local-a"],
      privacy: "local-only",
    });
    expect(plan.entries.map((entry) => entry.providerId)).toEqual(["byom-local-a"]);

    // preferred cloud + NO fallback: the plan is empty — the gateway will
    // answer the typed no-provider error
    const emptyPlan = router.route("recommendation", {
      task: "recommendation",
      preferredProvider: "byom-cloud-a",
      fallbackProviders: [],
      privacy: "local-only",
    });
    expect(emptyPlan.entries).toHaveLength(0);

    const fabric = new ModelFabric(registry);
    const refused = fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      richContext(),
      {
        task: "recommendation",
        preferredProvider: "byom-cloud-a",
        fallbackProviders: [],
        privacy: "local-only",
      },
    );
    return refused.then((result) => {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("no-provider");
      }
    });
  });

  it("the merged router excludes an over-ceiling byom on declared cost", async () => {
    const registry = new ModelFabricRegistry();
    registerByom(registry, makeWellBehavedByom("byom-pricey", { costPerCall: 0.25 }));

    const router = new ModelRouter(registry);
    const plan = router.route("recommendation", {
      task: "recommendation",
      preferredProvider: "byom-pricey",
      fallbackProviders: [],
      privacy: "any-cloud",
      maxCostPerOperation: 0.1, // below the declared per-call cost
    });
    expect(plan.entries).toHaveLength(0); // excluded by the MERGED cost filter

    const fabric = new ModelFabric(registry);
    const result = await fabric.invoke<RecommendationContext, RecommendationScore[]>(
      "recommendation",
      richContext(),
      {
        task: "recommendation",
        preferredProvider: "byom-pricey",
        fallbackProviders: [],
        privacy: "any-cloud",
        maxCostPerOperation: 0.1,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("no-provider");
    }
  });

  it("unsupported task ⇒ typed ByomProviderError naming the supported set", async () => {
    const provider = createByomProvider(makeWellBehavedByom("byom-tasks"));
    const outcome = await capture(
      provider.invoke<unknown, unknown>("summary", richContext()),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const error = outcome.error as ByomProviderError;
      expect(error).toBeInstanceOf(ByomProviderError);
      expect(error.kind).toBe("unsupported-task");
      expect(error.details[0]).toContain("task 'summary' is not served");
      expect(error.details[0]).toContain("recommendation, ranking");
    }
  });

  it("the provider's adapter failures propagate as typed rejections (no substitution)", async () => {
    const provider = createByomProvider(makeScriptedByom("byom-fabric-empty", { responses: [[]] }));
    const outcome = await capture(
      provider.invoke<RecommendationContext, RecommendationScore[]>("recommendation", richContext()),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect((outcome.error as ByomError).kind).toBe("degraded");
    }
  });
});
