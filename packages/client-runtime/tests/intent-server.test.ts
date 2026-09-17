/**
 * @wfx/client-runtime — R05 intent/policy server wiring tests.
 *
 * The ServerPort seam stays FROZEN; these tests pin the NEW backing:
 * - WRITE-THROUGH: `setIntent`/`setRecommendationPolicy` write the durable
 *   scopes (persistent/temporary/social) through `writeIntent`/`writePolicy`;
 *   session/momentary intents NEVER reach the server (the R01 endSession
 *   law — they die with the session).
 * - TYPED FAILURES: a failing server write throws the mapped `RuntimeError`
 *   (never a silent success); the local session set keeps the intent for
 *   THIS session (documented honesty).
 * - HYDRATION: `hydrate()` seeds the local view from the server's durable
 *   records — expired filtered, session/momentary skipped, LOCAL entries
 *   win per (scope, objective), and the server policy seeds the local view
 *   while the user has not changed it locally.
 * - SCOPE TRUTH preserved: `endSession()` still clears session/momentary
 *   locally; temporary expires at `expiresAt` (live filtering).
 */

import { describe, expect, it } from "bun:test";

import type { IntentId, IntentRecord, RecommendationPolicy } from "@wfx/domain";

import {
  FixedClock,
  InMemoryServerPort,
  IntentStore,
  RuntimeError,
  createRuntime,
  makeWebCapabilities,
} from "../src/index";
import type { RuntimeContext } from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const CONTEXT: RuntimeContext = {
  userId: "user-1",
  sessionId: "sess-1",
  locale: "en",
  profileId: "wfxprof_00000000000000000000000001",
};

const ids = { next: () => "00000000000000000000000001" };

function boot() {
  const clock = new FixedClock(T0);
  const server = new InMemoryServerPort();
  const store = new IntentStore(clock, ids, server);
  return { clock, server, store };
}

/** A durable intent record as the server answers it. */
function serverIntent(over: Partial<IntentRecord>): IntentRecord {
  return {
    id: "wfxint_00000000000000000000000009" as IntentId,
    userId: "user-1",
    scope: "persistent",
    objective: "space documentaries",
    weight: 0.7,
    confidence: 0.9,
    provenance: "explicit",
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-16T09:00:00.000Z",
    lastReinforcedAt: "2026-09-16T09:00:00.000Z",
    evidenceCount: 3,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Write-through
// ---------------------------------------------------------------------------

describe("R05 — setIntent write-through (durable scopes persist server-side)", () => {
  it("a persistent intent is written through to the server", async () => {
    const { server, store } = boot();
    await store.syncIntent({ objective: "cozy comedies", scope: "persistent", weight: 0.8 });
    expect(server.intentWrites).toEqual([
      { objective: "cozy comedies", scope: "persistent", weight: 0.8 },
    ]);
  });

  it("temporary and social intents are durable too; session/momentary NEVER reach the server", async () => {
    const { server, store } = boot();
    await store.syncIntent({
      objective: "sci-fi weekend",
      scope: "temporary",
      expiresAt: "2026-09-18T12:00:00.000Z",
    });
    await store.syncIntent({ objective: "friend taste", scope: "social" });
    await store.syncIntent({ objective: "quick laughs", scope: "session" });
    await store.syncIntent({ objective: "right now", scope: "momentary" });
    expect(server.intentWrites.length).toBe(2); // temporary + social only
    expect(server.intentWrites.map((command) => command.scope)).toEqual(["temporary", "social"]);
    // The local session set still carries ALL four (R01 laws unchanged).
    expect(store.active().length).toBe(4);
  });

  it("a typed server failure throws the mapped RuntimeError; the local set keeps the intent for THIS session", async () => {
    const { server, store } = boot();
    server.scriptIntentWrite({ ok: false, failure: { kind: "network", detail: "offline" } });
    let caught: unknown;
    try {
      await store.syncIntent({ objective: "durable but offline", scope: "persistent" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).kind).toBe("network");
    // The local session set kept it — honest partial state, never a silent
    // success and never a silent loss.
    expect(store.active().some((intent) => intent.objective === "durable but offline")).toBe(true);
  });

  it("setRecommendationPolicy writes through; failure throws the mapped error", async () => {
    const { server, store } = boot();
    await store.syncPolicy({ attentionMode: "mindful", exploration: 0.6 });
    expect(server.policyWrites).toEqual([{ attentionMode: "mindful", exploration: 0.6 }]);
    expect(store.operations().policy().attentionMode).toBe("mindful");

    server.scriptPolicyWrite({ ok: false, failure: { kind: "unauthorized", detail: "401" } });
    await expect(store.syncPolicy({ attentionMode: "immersive" })).rejects.toMatchObject({
      kind: "unauthorized",
    });
    // The local view kept the change for THIS session.
    expect(store.operations().policy().attentionMode).toBe("immersive");
  });
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

describe("R05 — hydrate (cross-device continuity through the frozen seam)", () => {
  it("seeds the local view from the server's durable records; the server policy seeds the view", async () => {
    const { server, store } = boot();
    const policy: RecommendationPolicy = {
      id: "wfxpol_00000000000000000000000001",
      userId: "user-1",
      objectives: [],
      exploration: 0.3,
      novelty: 0.25,
      socialInfluence: 0.05,
      attentionMode: "immersive",
    };
    server.scriptIntentsRead({
      ok: true,
      value: [
        serverIntent({}),
        serverIntent({
          id: "wfxint_00000000000000000000000010" as IntentId,
          scope: "social",
          objective: "friend taste",
        }),
      ],
    });
    server.scriptPolicyRead({ ok: true, value: policy });

    await store.hydrate();
    const active = store.active();
    expect(active.length).toBe(2);
    const seeded = active.find((intent) => intent.objective === "space documentaries");
    expect(seeded?.id).toBe("wfxint_00000000000000000000000009");
    expect(seeded?.weight).toBe(0.7);
    expect(seeded?.scope).toBe("persistent");
    const view = store.operations().policy();
    expect(view.attentionMode).toBe("immersive");
    expect(view.exploration).toBe(0.3);
    expect(view.novelty).toBe(0.25);
    expect(view.socialInfluence).toBe(0.05);
  });

  it("EXPIRED records never hydrate (the live-expiry law, hydration-side)", async () => {
    const { clock, server, store } = boot();
    clock.advance(60_000); // now past the 12:00 expiry below
    server.scriptIntentsRead({
      ok: true,
      value: [
        serverIntent({
          scope: "temporary",
          objective: "tonight only",
          expiresAt: "2026-09-16T12:00:00.000Z", // at/before now — dead
        }),
        serverIntent({
          id: "wfxint_00000000000000000000000011" as IntentId,
          scope: "temporary",
          objective: "this weekend",
          expiresAt: "2026-09-20T12:00:00.000Z", // still live
        }),
      ],
    });
    await store.hydrate();
    expect(store.active().map((intent) => intent.objective)).toEqual(["this weekend"]);
  });

  it("session/momentary records never hydrate (per-session by construction)", async () => {
    const { server, store } = boot();
    server.scriptIntentsRead({
      ok: true,
      value: [
        serverIntent({ scope: "session", objective: "stale session intent" }),
        serverIntent({ scope: "momentary", objective: "stale momentary intent" }),
      ],
    });
    await store.hydrate();
    expect(store.active()).toEqual([]);
  });

  it("LOCAL entries win per (scope, objective) — the session's own submissions are fresher", async () => {
    const { server, store } = boot();
    store.set({ objective: "cozy comedies", scope: "persistent", weight: 0.9 });
    server.scriptIntentsRead({
      ok: true,
      value: [
        serverIntent({ objective: "cozy comedies", weight: 0.1 }),
        serverIntent({ id: "wfxint_00000000000000000000000012" as IntentId, objective: "other interest" }),
      ],
    });
    await store.hydrate();
    const cozy = store.active().find((intent) => intent.objective === "cozy comedies");
    expect(cozy?.weight).toBe(0.9); // the local (fresher) submission
    expect(store.active().length).toBe(2); // the server-only objective seeded
  });

  it("the server policy does NOT clobber a local change (the dirty flag)", async () => {
    const { server, store } = boot();
    store.setPolicy({ attentionMode: "mindful" });
    server.scriptPolicyRead({
      ok: true,
      value: {
        id: "wfxpol_00000000000000000000000001",
        userId: "user-1",
        objectives: [],
        exploration: 0.3,
        novelty: 0.25,
        socialInfluence: 0.05,
        attentionMode: "immersive",
      },
    });
    await store.hydrate();
    expect(store.operations().policy().attentionMode).toBe("mindful");
  });

  it("a failing read throws the mapped RuntimeError (never a silent empty hydration)", async () => {
    const { server, store } = boot();
    server.scriptIntentsRead({ ok: false, failure: { kind: "unavailable", detail: "503" } });
    await expect(store.hydrate()).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("a null policy hydrates cleanly (the honest unset — no fabricated default)", async () => {
    const { server, store } = boot();
    server.scriptIntentsRead({ ok: true, value: [] });
    await store.hydrate();
    expect(store.operations().policy().attentionMode).toBe("balanced"); // the constructor default
  });
});

// ---------------------------------------------------------------------------
// Scope truth preserved end-to-end (through the runtime)
// ---------------------------------------------------------------------------

describe("R05 — the runtime surface keeps the R01 laws with the new backing", () => {
  function bootRuntime(server: InMemoryServerPort) {
    return createRuntime(makeWebCapabilities(), server, {
      context: CONTEXT,
      clock: new FixedClock(T0),
      ids,
    });
  }

  it("setIntent writes durable scopes through; endSession clears session/momentary locally only", async () => {
    const server = new InMemoryServerPort();
    const runtime = bootRuntime(server);
    await runtime.setIntent({ objective: "durable taste", scope: "persistent" });
    await runtime.setIntent({ objective: "tonight", scope: "session" });
    expect(server.intentWrites.length).toBe(1); // only the durable scope
    expect(runtime.intents.intents().length).toBe(2);

    runtime.intents.endSession();
    const remaining = runtime.intents.intents();
    expect(remaining.map((intent) => intent.objective)).toEqual(["durable taste"]);
    // The server was never polluted with the session-scoped intent, and the
    // durable record survives server-side (cross-session continuity).
    expect(server.intentWrites.map((command) => command.scope)).toEqual(["persistent"]);
  });

  it("setRecommendationPolicy writes through the runtime; the policy view answers locally", async () => {
    const server = new InMemoryServerPort();
    const runtime = bootRuntime(server);
    await runtime.setRecommendationPolicy({ attentionMode: "mindful", exploration: 0.8 });
    expect(server.policyWrites).toEqual([{ attentionMode: "mindful", exploration: 0.8 }]);
    expect(runtime.intents.policy().attentionMode).toBe("mindful");
    expect(runtime.intents.policy().exploration).toBe(0.8);
  });

  it("the hydrate operation is exposed on the runtime's intents surface", async () => {
    const server = new InMemoryServerPort();
    const runtime = bootRuntime(server);
    server.scriptIntentsRead({
      ok: true,
      value: [serverIntent({ objective: "cross-device taste" })],
    });
    await runtime.intents.hydrate();
    expect(
      runtime.intents.intents().some((intent) => intent.objective === "cross-device taste"),
    ).toBe(true);
  });
});
