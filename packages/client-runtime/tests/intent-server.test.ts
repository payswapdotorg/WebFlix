/**
 * @wfx/client-runtime — R05 intent/policy server wiring tests.
 *
 * The R05 spec's runtime acceptance points:
 * - DURABLE WRITE-THROUGH: persistent/social/temporary submissions also
 *   reach `server.writeIntent`; session/momentary NEVER do (scope truth —
 *   they die at `endSession` and must not leak into the next session's
 *   server-backed read).
 * - WRITE-THROUGH FAILURE is never silent: the typed RuntimeError names
 *   what survived (the session view) and what did not.
 * - POLICY is durable-first: the view mirrors the durable policy — a failed
 *   write keeps the view unchanged (never a fabricated "saved" state).
 * - `refresh()` hydrates the durable intents (server = convergence point;
 *   session/momentary rows ignored) + the policy (null keeps the view —
 *   the honest empty); a failing read answers the ERROR model with the
 *   last synced views intact.
 * - `endSession` keeps its R01 truth: session/momentary cleared, durable
 *   intents survive locally.
 * - Temporary expiry is LIVE at read (the injected clock judges).
 */

import { describe, expect, it } from "bun:test";

import {
  FixedClock,
  InMemoryServerPort,
  createRuntime,
  makeWebCapabilities,
} from "../src/index";
import type { IntentId, IntentRecord, RecommendationPolicy } from "@wfx/domain";
import type { RuntimeContext } from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const CONTEXT: RuntimeContext = {
  userId: "user-1",
  sessionId: "sess-1",
  locale: "en",
  profileId: "wfxprof_00000000000000000000000001",
};

const ids = { next: () => "00000000000000000000000001" };

function runtime(server: InMemoryServerPort) {
  return createRuntime(makeWebCapabilities(), server, {
    context: CONTEXT,
    clock: new FixedClock(T0),
    ids,
  });
}

/** A full IntentRecord literal for scripting server reads. */
function intentRecord(over: Partial<IntentRecord>): IntentRecord {
  return {
    id: "wfxint_00000000000000000000000042" as IntentId,
    userId: "user-1",
    scope: "persistent",
    objective: "space documentaries",
    weight: 0.7,
    confidence: 0.9,
    provenance: "explicit",
    createdAt: "2026-09-15T12:00:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
    lastReinforcedAt: "2026-09-15T12:00:00.000Z",
    evidenceCount: 3,
    ...over,
  };
}

describe("R05 — durable intent write-through", () => {
  it("persistent/social/temporary submissions reach the server; session/momentary NEVER do", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);

    await rt.setIntent({ objective: "space documentaries", scope: "persistent" });
    await rt.setIntent({ objective: "friend taste", scope: "social" });
    await rt.setIntent({
      objective: "cozy-comedy-tonight",
      scope: "temporary",
      expiresAt: "2026-09-16T18:00:00.000Z",
    });
    await rt.setIntent({ objective: "surprise me", scope: "session" });
    await rt.setIntent({ objective: "quick laugh", scope: "momentary" });

    expect(server.intentWrites).toEqual([
      { objective: "space documentaries", scope: "persistent" },
      { objective: "friend taste", scope: "social" },
      { objective: "cozy-comedy-tonight", scope: "temporary", expiresAt: "2026-09-16T18:00:00.000Z" },
    ]); // session/momentary NEVER left the runtime
  });

  it("a failed durable write is NEVER silent: the typed error names what survived", async () => {
    const server = new InMemoryServerPort();
    server.scriptIntentWrite({ ok: false, failure: { kind: "network", detail: "offline" } });
    const rt = runtime(server);

    let caught: unknown;
    try {
      await rt.setIntent({ objective: "space documentaries", scope: "persistent" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toMatchObject({ kind: "network" });
    expect((caught as Error).message).toContain("active for this session");
    expect((caught as Error).message).toContain("NOT durably recorded");
    // The session view DID keep the intent (the honest split).
    expect(rt.intents.intents().map((intent) => intent.objective)).toContain("space documentaries");
  });

  it("invalid input throws BEFORE any server write (validation is local-first)", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);
    await expect(rt.setIntent({ objective: "x", scope: "temporary" })).rejects.toMatchObject({
      kind: "invalid-input",
    });
    expect(server.intentWrites).toEqual([]);
  });

  it("endSession clears session/momentary but keeps durable intents locally", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);

    await rt.setIntent({ objective: "space documentaries", scope: "persistent" });
    await rt.setIntent({ objective: "surprise me", scope: "session" });
    await rt.setIntent({ objective: "quick laugh", scope: "momentary" });

    rt.intents.endSession();
    const objectives = rt.intents.intents().map((intent) => intent.objective);
    expect(objectives).toContain("space documentaries"); // durable survives
    expect(objectives).not.toContain("surprise me");
    expect(objectives).not.toContain("quick laugh");
  });

  it("temporary expiry is LIVE at read (the injected clock judges)", async () => {
    const clock = new FixedClock(T0);
    const server = new InMemoryServerPort();
    const rt = createRuntime(makeWebCapabilities(), server, { context: CONTEXT, clock, ids });

    await rt.setIntent({
      objective: "cozy-comedy-tonight",
      scope: "temporary",
      expiresAt: "2026-09-16T13:00:00.000Z",
    });
    expect(rt.intents.intents().length).toBe(1);
    clock.advance(2 * 60 * 60_000); // past the expiry
    expect(rt.intents.intents().length).toBe(0); // gone from the active set
  });
});

describe("R05 — policy write-through (durable-first)", () => {
  it("setRecommendationPolicy writes through the server, then updates the view", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);

    await rt.setRecommendationPolicy({ attentionMode: "mindful", exploration: 0.8 });
    expect(server.policyWrites).toEqual([{ attentionMode: "mindful", exploration: 0.8 }]);
    const view = rt.intents.policy();
    expect(view.attentionMode).toBe("mindful");
    expect(view.exploration).toBe(0.8);
  });

  it("a failed policy write keeps the view UNCHANGED (never a fabricated saved state)", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);
    await rt.setRecommendationPolicy({ attentionMode: "immersive" });

    server.scriptPolicyWrite({ ok: false, failure: { kind: "unauthorized", detail: "401" } });
    await expect(
      rt.setRecommendationPolicy({ attentionMode: "mindful", exploration: 0.9 }),
    ).rejects.toMatchObject({ kind: "unauthorized" });
    // The view still mirrors the LAST SUCCESSFUL durable write.
    expect(rt.intents.policy().attentionMode).toBe("immersive");
    expect(rt.intents.policy().exploration).toBe(0.5);
  });

  it("invalid policy input throws BEFORE any server write", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);
    await expect(
      rt.setRecommendationPolicy({ attentionMode: "chaotic" as never }),
    ).rejects.toMatchObject({ kind: "invalid-input" });
    expect(server.policyWrites).toEqual([]);
  });
});

describe("R05 — refresh() (the cross-device hydration)", () => {
  it("hydrates durable server intents + the policy; session/momentary rows are ignored", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);

    // A local session intent that must SURVIVE the refresh (session truth).
    await rt.setIntent({ objective: "surprise me", scope: "session" });

    server.scriptIntentsRead({
      ok: true,
      value: [
        intentRecord({ scope: "persistent", objective: "space documentaries", weight: 0.9 }),
        intentRecord({ id: "wfxint_00000000000000000000000043" as IntentId, scope: "social", objective: "friend taste", weight: 0.4 }),
        // A session-scope server row (some other API client's write) — the
        // runtime IGNORES it: session truth never crosses sessions.
        intentRecord({ id: "wfxint_00000000000000000000000044" as IntentId, scope: "session", objective: "leaky-session-row" }),
      ],
    });
    server.scriptPolicyRead({
      ok: true,
      value: {
        id: "wfxpol_00000000000000000000000001",
        userId: "user-1",
        objectives: [],
        exploration: 0.75,
        novelty: 0.25,
        socialInfluence: 0.1,
        attentionMode: "immersive",
      } satisfies RecommendationPolicy,
    });

    const model = await rt.intents.refresh();
    expect(model.status.state).toBe("ready");

    const objectives = rt.intents.intents().map((intent) => intent.objective);
    expect(objectives).toContain("space documentaries"); // hydrated
    expect(objectives).toContain("friend taste"); // hydrated
    expect(objectives).toContain("surprise me"); // local session truth kept
    expect(objectives).not.toContain("leaky-session-row"); // scope truth

    const view = rt.intents.policy();
    expect(view.attentionMode).toBe("immersive");
    expect(view.exploration).toBe(0.75);
    expect(view.novelty).toBe(0.25);
  });

  it("an unset server policy (null) keeps the current view — the honest empty", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);
    await rt.setRecommendationPolicy({ attentionMode: "mindful", exploration: 0.6 });

    // The scripted null policy read (the server's honest empty).
    server.scriptPolicyRead({ ok: true, value: null });

    const model = await rt.intents.refresh();
    expect(model.status.state).toBe("ready");
    expect(rt.intents.policy().attentionMode).toBe("mindful"); // unchanged
    expect(rt.intents.policy().exploration).toBe(0.6);
  });

  it("a failing read answers the ERROR model — the last synced views stay visible", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);
    await rt.setIntent({ objective: "space documentaries", scope: "persistent" });
    const before = rt.intents.intents().length;

    server.scriptIntentsRead({ ok: false, failure: { kind: "network", detail: "offline" } });
    const model = await rt.intents.refresh();
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("network");
    expect(model.status.error?.detail).toBe("offline");
    // Never a fake wipe: the views are intact.
    expect(rt.intents.intents().length).toBe(before);
    expect(rt.intents.intents().map((intent) => intent.objective)).toContain("space documentaries");
  });

  it("the server is the convergence point: a hydrated durable record replaces its local twin", async () => {
    const server = new InMemoryServerPort();
    const rt = runtime(server);

    await rt.setIntent({ objective: "space documentaries", scope: "persistent", weight: 0.2 });
    server.scriptIntentsRead({
      ok: true,
      value: [intentRecord({ scope: "persistent", objective: "space documentaries", weight: 0.95 })],
    });
    await rt.intents.refresh();
    const hydrated = rt.intents.intents().find(
      (intent) => intent.objective === "space documentaries",
    );
    expect(hydrated?.weight).toBe(0.95); // the server won
    expect(hydrated?.id).toBe("wfxint_00000000000000000000000042");
  });
});
