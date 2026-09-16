/**
 * @wfx/client-runtime — intent submission + attention-mode tests (R01).
 *
 * Scope truth (temporary requires a future expiry), one-objective-per-scope,
 * live expiry filtering, session clearing, and attention-mode validation.
 */

import { describe, expect, it } from "bun:test";

import { FixedClock, IntentStore, RuntimeError } from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const T1 = Date.parse("2026-09-16T14:00:00.000Z");

const ids = { next: () => "00000000000000000000000001" };

function store(clock = new FixedClock(T0)) {
  return new IntentStore(clock, ids);
}

describe("scope truth (validation)", () => {
  it("records a persistent intent with the frozen vocabulary", () => {
    const intents = store();
    const recorded = intents.set({ objective: "learn-cooking", scope: "persistent", weight: 2 });
    expect(recorded.scope).toBe("persistent");
    expect(recorded.objective).toBe("learn-cooking");
    expect(recorded.weight).toBe(2);
    expect(recorded.provenance).toBe("explicit");
    expect(recorded.id.startsWith("wfxint_")).toBe(true);
  });

  it("temporary scope REQUIRES a future expiresAt", () => {
    const intents = store();
    expect(() => intents.set({ objective: "cozy-tonight", scope: "temporary" })).toThrow(
      /expiresAt: REQUIRED for scope 'temporary'/,
    );
    expect(() =>
      intents.set({ objective: "cozy-tonight", scope: "temporary", expiresAt: "2020-01-01T00:00:00.000Z" }),
    ).toThrow(/already past/);
    expect(() =>
      intents.set({ objective: "cozy-tonight", scope: "temporary", expiresAt: "not-a-date" }),
    ).toThrow(/ISO 8601/);
    const ok = intents.set({
      objective: "cozy-tonight",
      scope: "temporary",
      expiresAt: new Date(T1).toISOString(),
    });
    expect(ok.expiresAt).toBe(new Date(T1).toISOString());
  });

  it("rejects malformed objectives/scopes/weights with the typed error", () => {
    const intents = store();
    expect(() => intents.set({ objective: "  ", scope: "session" })).toThrow(RuntimeError);
    expect(() =>
      intents.set({ objective: "x", scope: "forever" as never }),
    ).toThrow(/scope: expected one of/);
    expect(() =>
      intents.set({ objective: "x", scope: "persistent", weight: -1 }),
    ).toThrow(/weight/);
    expect(() =>
      intents.set({ objective: "x", scope: "persistent", provenance: "guessed" as never }),
    ).toThrow(/provenance/);
  });
});

describe("one objective per scope (law 2)", () => {
  it("re-submitting the same objective UPDATES it (same id, new weight)", () => {
    const intents = store();
    const first = intents.set({ objective: "cozy-tonight", scope: "persistent", weight: 1 });
    const second = intents.set({ objective: "cozy-tonight", scope: "persistent", weight: 3 });
    expect(second.id).toBe(first.id);
    expect(second.weight).toBe(3);
    expect(intents.active()).toHaveLength(1);
  });

  it("the same objective in a DIFFERENT scope is a distinct intent", () => {
    const intents = store();
    intents.set({ objective: "cozy-tonight", scope: "persistent" });
    intents.set({ objective: "cozy-tonight", scope: "session" });
    expect(intents.active()).toHaveLength(2);
  });
});

describe("live expiry (law 3)", () => {
  it("expired temporary intents leave the active set as the clock advances", () => {
    const clock = new FixedClock(T0);
    const intents = store(clock);
    intents.set({
      objective: "cozy-tonight",
      scope: "temporary",
      expiresAt: new Date(T1).toISOString(),
    });
    expect(intents.active()).toHaveLength(1);
    clock.set(T1 + 1);
    expect(intents.active()).toHaveLength(0);
  });
});

describe("session clearing (law 1)", () => {
  it("endSession clears session+momentary intents; persistent/temporary stay", () => {
    const intents = store();
    intents.set({ objective: "a", scope: "session" });
    intents.set({ objective: "b", scope: "momentary" });
    intents.set({ objective: "c", scope: "persistent" });
    intents.set({ objective: "d", scope: "temporary", expiresAt: new Date(T1).toISOString() });
    intents.operations().endSession();
    const scopes = intents.active().map((intent) => intent.scope);
    expect(scopes).toContain("persistent");
    expect(scopes).toContain("temporary");
    expect(scopes).not.toContain("session");
    expect(scopes).not.toContain("momentary");
  });
});

describe("attention-mode submission", () => {
  it("defaults to balanced and updates on validated commands", () => {
    const intents = store();
    expect(intents.operations().policy().attentionMode).toBe("balanced");
    intents.setPolicy({ attentionMode: "immersive" });
    expect(intents.operations().policy().attentionMode).toBe("immersive");
    intents.setPolicy({ attentionMode: "mindful", exploration: 0.2, novelty: 0.1 });
    const policy = intents.operations().policy();
    expect(policy.attentionMode).toBe("mindful");
    expect(policy.exploration).toBe(0.2);
    expect(policy.novelty).toBe(0.1);
  });

  it("rejects unknown modes and out-of-range dials with the typed error", () => {
    const intents = store();
    expect(() => intents.setPolicy({ attentionMode: "chaotic" as never })).toThrow(/attentionMode/);
    expect(() =>
      intents.setPolicy({ attentionMode: "custom", exploration: 7 }),
    ).toThrow(/exploration/);
  });
});
