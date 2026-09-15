/**
 * WFX-051 action surface composition tests (bun:test).
 *
 * Proves like/save honesty end to end — the packet's acceptance criterion
 * "actions reflect honest failure":
 *
 * - a confirmed like flows through the action use-case (receipt verbatim,
 *   connector-side state recorded, engagement event mirrored to the sink);
 * - an UNDECLARED capability answers the typed `unsupported` receipt —
 *   never a fake success, never a thrown crash;
 * - a port that VIOLATES the plain surface (throws) is caught and typed
 *   as `port-failed` — honest failure, never a crash;
 * - the REAL /api/actions route handler: malformed bodies answer 400 with
 *   the problem; valid bodies answer the receipt verbatim;
 * - the REAL /api/events route handler: the closed user-reportable
 *   vocabulary (progress/complete/skip/share) is enforced — a client
 *   re-sending "start" or fabricating "like" is rejected with the reason;
 * - the ActionButtons island renders the typed-absent note when the
 *   capability is missing (never a greyed-out lie).
 *
 * Deterministic: fixture ports, controlled env, foreign item ids where
 * watch-state pollution must be avoided. No network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConnectorPort, Ports } from "@wfx/experience";
import { makeFixturePorts } from "@wfx/experience";

import { ActionButtons } from "../src/components/player/ActionButtons";
import { bootWebClient } from "../src/main";
import { canonicalItemId } from "../src/host/canon";
import { withWatchStateRecording } from "../src/host/watch-state";
import { resetExperienceHostProcessState } from "../src/host/testing";
import { runAction } from "../src/host/views";
import { POST as postAction } from "../src/app/api/actions/route";
import { POST as postEvent } from "../src/app/api/events/route";

// Hermeticity law (WFX-CI-FIX): the /api/events route test records events
// into the process-lifetime watch-state buffer and every like joins canon
// ids; bun:test's file→process grouping varies with the machine, so every
// test resets the host process state first — this file must neither read
// other files' leftovers nor leave any for whichever file runs next in the
// same process.
beforeEach(() => {
  resetExperienceHostProcessState();
});

/** Run an async `body` with a controlled environment, restoring the real one after. */
async function withEnv(overrides: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const names = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV"];
  const saved = new Map<string, string | undefined>();
  for (const name of names) saved.set(name, process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
    await body();
  } finally {
    for (const name of names) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** POST one JSON body to a route handler (the real module, no network). */
async function postJson(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<Response> {
  return handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** A connector that THROWS on executeAction (a port violating the plain surface). */
class ThrowingActionConnector {
  descriptor() {
    return {
      id: "throwing-source",
      version: "0.1.0",
      displayName: ThrowingActionConnector.name,
      capabilities: ["catalogSearch", "metadata", "like", "save"],
      auth: "none" as const,
    };
  }
  async search(): Promise<never[]> {
    return [];
  }
  async metadata(): Promise<null> {
    return null;
  }
  async resolve(): Promise<never[]> {
    return [];
  }
  async executeAction(): Promise<never> {
    throw new Error("connector exploded");
  }
}

describe("WFX-051 action surface (honest failure, receipts as truth)", () => {
  it("a confirmed like: receipt verbatim, connector state recorded, engagement event mirrored", async () => {
    const fixturePorts = makeFixturePorts();
    const host = {
      mode: "fixtures" as const,
      client: bootWebClient({ ports: withWatchStateRecording(fixturePorts) }),
    };
    const itemId = canonicalItemId({ connectorId: "fake-source", externalRef: "fake:video-3" });

    const result = await runAction(host, {
      type: "like",
      connectorId: "fake-source",
      externalRef: "fake:video-3",
      itemId,
    });
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.receipt.status).toBe("confirmed");
    expect(result.receipt.externalId).toBe("fake-act-000001");
    // The connector-side state was actually written.
    expect(fixturePorts.connector.recordedLikes()).toEqual(["fake:video-3"]);
    // The confirmed action is MIRRORED as the frozen engagement event
    // (through the WRAPPED sink — the recording wrapper forwards verbatim).
    expect(fixturePorts.events.events.map((event) => event.type)).toContain("like");
    expect(fixturePorts.events.events.at(-1)?.itemId).toBe(itemId);
  });

  it("an undeclared capability answers the typed unsupported result — never a fake success", async () => {
    const fixturePorts = makeFixturePorts({
      capabilities: ["catalogSearch", "metadata", "playEmbed"],
    });
    const host = {
      mode: "fixtures" as const,
      client: bootWebClient({ ports: withWatchStateRecording(fixturePorts) }),
    };
    // The use-case's capability pre-check: the action never even reaches
    // the port — the caller gets the typed, actionable unsupported result.
    const result = await runAction(host, {
      type: "like",
      connectorId: "fake-source",
      externalRef: "fake:video-3",
      itemId: canonicalItemId({ connectorId: "fake-source", externalRef: "fake:video-3" }),
    });
    expect(result.ok).toBeFalse();
    if (result.ok) return;
    expect(result.error).toContain("unsupported");
    expect(result.error).toContain("like");
    // Nothing was mirrored and nothing was recorded — the honest absence.
    expect(fixturePorts.events.events).toEqual([]);
    expect(fixturePorts.connector.recordedLikes()).toEqual([]);
  });

  it("a throwing port is caught and typed as port-failed — honest failure, never a crash", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      ...base,
      connector: new ThrowingActionConnector() as unknown as ConnectorPort,
    };
    const host = { mode: "fixtures" as const, client: bootWebClient({ ports }) };
    const result = await runAction(host, {
      type: "like",
      connectorId: "throwing-source",
      externalRef: "fake:video-3",
      itemId: canonicalItemId({ connectorId: "fake-source", externalRef: "fake:video-3" }),
    });
    expect(result.ok).toBeFalse();
    if (result.ok) return;
    expect(result.error).toContain("port-failed");
    expect(result.error).toContain("connector exploded");
  });

  it("the /api/actions route: valid bodies answer the receipt verbatim; malformed bodies answer 400", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const itemId = canonicalItemId({ connectorId: "fake-source", externalRef: "fake:video-3" });

      // Valid like → the frozen ActionReceipt, verbatim.
      const ok = await postJson(postAction, "/api/actions", {
        type: "like",
        connectorId: "fake-source",
        externalRef: "fake:video-3",
        itemId,
      });
      expect(ok.status).toBe(200);
      const receipt = (await ok.json()) as { status?: string; externalId?: string };
      expect(receipt.status).toBe("confirmed");

      // Missing itemId (the mirror needs canonical identity) → 400.
      const noItem = await postJson(postAction, "/api/actions", {
        type: "like",
        connectorId: "fake-source",
        externalRef: "fake:video-3",
      });
      expect(noItem.status).toBe(400);

      // Out-of-vocabulary type → 400.
      const badType = await postJson(postAction, "/api/actions", {
        type: "delete-everything",
        connectorId: "fake-source",
        externalRef: "fake:video-3",
        itemId,
      });
      expect(badType.status).toBe(400);

      // Not JSON at all → 400.
      const notJson = await postJson(postAction, "/api/actions", "this is not json");
      expect(notJson.status).toBe(400);
    });
  });

  it("the /api/events route: the closed user-reportable vocabulary is enforced", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      // A foreign (non-catalog) canonical id: the fold records it, but it
      // never joins a continue row (no card carries it) — safe for the
      // shared per-process watch-state buffer.
      const foreignItemId = `wfxitm_${"A1B2C".padStart(26, "0")}`;

      // progress with a position is accepted.
      const progress = await postJson(postEvent, "/api/events", {
        itemId: foreignItemId,
        type: "progress",
        payload: { positionMs: 30_000 },
      });
      expect(progress.status).toBe(200);
      const progressBody = (await progress.json()) as { ok?: boolean };
      expect(progressBody.ok).toBeTrue();

      // "start" is the playback use-case's event — a client re-sending it
      // would duplicate watch evidence. Rejected with the reason.
      const start = await postJson(postEvent, "/api/events", {
        itemId: foreignItemId,
        type: "start",
      });
      expect(start.status).toBe(400);
      const startBody = (await start.json()) as { error?: string };
      expect(startBody.error).toContain("'start' is emitted by the playback use-case");

      // "like" is mirrored by the action use-case when the source confirms —
      // a client cannot fabricate engagement. Rejected with the reason.
      const like = await postJson(postEvent, "/api/events", {
        itemId: foreignItemId,
        type: "like",
      });
      expect(like.status).toBe(400);
      const likeBody = (await like.json()) as { error?: string };
      expect(likeBody.error).toContain("'like'/'save' are mirrored by the action use-case");

      // A malformed item id → 400 naming the canonical grammar.
      const badId = await postJson(postEvent, "/api/events", {
        itemId: "not-a-canonical-id",
        type: "skip",
      });
      expect(badId.status).toBe(400);

      // A malformed payload position → 400.
      const badPayload = await postJson(postEvent, "/api/events", {
        itemId: foreignItemId,
        type: "progress",
        payload: { positionMs: -5 },
      });
      expect(badPayload.status).toBe(400);
    });
  });

  it("ActionButtons: absent capabilities render the typed-absent note, never a greyed-out lie", () => {
    const markup = renderToStaticMarkup(
      createElement(ActionButtons, { like: null, save: null }),
    );
    expect(markup).toContain("data-wfx-action-absent=\"like\"");
    expect(markup).toContain("Like: not available on this source");
    expect(markup).toContain("data-wfx-action-absent=\"save\"");
    expect(markup).not.toContain("data-wfx-action=\"like\"");

    // With capabilities present, the controls render in their idle state.
    const active = renderToStaticMarkup(
      createElement(ActionButtons, {
        like: {
          type: "like",
          connectorId: "fake-source",
          externalRef: "fake:video-3",
          itemId: "wfxitm_00000000000000000000000009",
        },
        save: null,
      }),
    );
    expect(active).toContain("data-wfx-action=\"like\"");
    expect(active).toContain("aria-pressed=\"false\"");
    expect(active).not.toContain("data-wfx-action=\"save\"");
  });
});
