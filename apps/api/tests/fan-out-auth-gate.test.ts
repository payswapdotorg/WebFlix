/**
 * R03 — fan-out auth-gate tests (bun:test).
 *
 * Pins the AUTH-STATE-AWARE querying (R03 §4) over hand-written fake
 * sources + a scriptable gate (no database, no network):
 *
 * - a SIGNEDOUT source is SKIPPED with an honest per-source note
 *   (`lastSourceSkips`) — never an error, never silently queried (the call
 *   log proves it);
 * - an EXPIRED source surfaces `expired` — the skip note names the expiry
 *   (the J28 journey seed);
 * - a SIGNEDIN source is queried normally;
 * - a source ABSENT from the gate's map is queried ungated (its own typed
 *   degradation covers it);
 * - a gate FAILURE degrades to ungated operation with a degradation note
 *   (never an outage);
 * - actions routed to a gated-out source answer the honest FAILED receipt
 *   naming the auth state;
 * - WITHOUT a gate the fan-out behaves exactly as before (the baseline
 *   regression check).
 *
 * Determinism: FixedClock + hand-written fakes; no network.
 */

import { describe, expect, it } from "bun:test";

import type {
  ActionReceipt,
  ConnectorContext,
  PlaybackRealization,
  SearchResult,
  SourceItem,
} from "@wfx/domain";
import type { Clock, ConnectorPort } from "@wfx/experience";

import {
  createFanOutConnector,
  type FanOutAuthGate,
  type FanOutSourceAuthState,
} from "../src/host/fan-out";

const CLOCK = { now: () => 1_800_000_000_000 } as Clock;
const CTX: ConnectorContext = { userId: "wfx-r03-gate-user", locale: "en" };

/** A recording fake source (the fan-out test pattern, trimmed to need). */
function makeRecordingSource(id: string): ConnectorPort & { readonly calls: string[] } {
  const calls: string[] = [];
  const connector: ConnectorPort = {
    descriptor: () => ({
      id,
      version: "1.0.0",
      displayName: `Gate ${id}`,
      capabilities: ["catalogSearch", "metadata", "like", "libraryRead", "libraryWrite"],
      auth: "oauth",
    }),
    async search(_ctx, query) {
      calls.push(`search:${query}`);
      return [
        {
          connectorId: id,
          externalRef: `${id}:1`,
          title: `${id} hit`,
          canonicalType: "video",
        },
      ] satisfies SearchResult[];
    },
    async metadata(_ctx, ref) {
      calls.push(`metadata:${ref}`);
      return {
        connectorId: id,
        externalRef: ref,
        title: `${id} item`,
        availability: "available",
        capabilities: [],
      } satisfies SourceItem;
    },
    async resolve(_ctx, ref) {
      calls.push(`resolve:${ref}`);
      return [
        {
          mode: "external",
          connectorId: id,
          url: "https://provider.example/watch",
          externalRef: ref,
          capabilities: ["playExternal"],
        },
      ] satisfies PlaybackRealization[];
    },
    async executeAction(_ctx, action) {
      calls.push(`action:${action.type}`);
      return { status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" } satisfies ActionReceipt;
    },
  };
  return Object.assign(connector, { calls });
}

function gateRow(
  connectorId: string,
  session: FanOutSourceAuthState["session"],
  usable: boolean,
  detail?: string,
): [string, FanOutSourceAuthState] {
  return [
    connectorId,
    {
      connectorId,
      session,
      usable,
      ...(detail !== undefined ? { detail } : {}),
    },
  ];
}

/** A scriptable gate (deterministic, no store) + its call counter. */
function makeGate(
  entries: readonly (readonly [string, FanOutSourceAuthState])[],
  failure?: Error,
): { gate: FanOutAuthGate; callCount(): number } {
  let calls = 0;
  const gate: FanOutAuthGate = async () => {
    calls += 1;
    if (failure !== undefined) throw failure;
    return new Map(entries);
  };
  return { gate, callCount: () => calls };
}

describe("fan-out auth gate (R03)", () => {
  it("skips a signedOut source with an honest note — never queried, never an error", async () => {
    const primary = makeRecordingSource("primary");
    const signedOut = makeRecordingSource("signed-out");
    const gateKit = makeGate([
      gateRow("primary", "signedIn", true),
      gateRow("signed-out", "signedOut", false),
    ]);
    const fanOut = createFanOutConnector({
      sources: [primary, signedOut],
      clock: CLOCK,
      authGate: gateKit.gate,
    });

    const hits = await fanOut.search(CTX, "query");
    // The primary answered; the signed-out source contributed NOTHING.
    expect(hits.length).toBe(1);
    expect(hits[0]?.externalRef).toBe("primary:1");
    expect(signedOut.calls).toEqual([]); // never queried
    expect(primary.calls).toEqual(["search:query"]);

    // The honest per-source note lives in the SKIP diary, not the
    // degradation diary (a skip is a state, not a failure).
    const skips = fanOut.lastSourceSkips();
    expect(skips.get("signed-out")).toContain("signed out");
    expect(fanOut.lastDegradations().has("signed-out")).toBe(false);
  });

  it("surfaces EXPIRED sources (the J28 journey seed) — the note names the expiry", async () => {
    const expired = makeRecordingSource("expired-src");
    const gateKit = makeGate([
      gateRow("expired-src", "expired", false, "the stored authorization expired at 2026-09-16T13:00:00.000Z"),
    ]);
    const fanOut = createFanOutConnector({ sources: [expired], clock: CLOCK, authGate: gateKit.gate });

    const hits = await fanOut.search(CTX, "query");
    expect(hits).toEqual([]);
    expect(expired.calls).toEqual([]);
    const note = fanOut.lastSourceSkips().get("expired-src") ?? "";
    expect(note).toContain("expired");
    expect(note).toContain("2026-09-16T13:00:00.000Z");
    expect(note).toContain("reauthorize");
  });

  it("queries a signedIn source normally; an absent-from-gate source is queried ungated", async () => {
    const signedIn = makeRecordingSource("signed-in");
    const ungated = makeRecordingSource("ungated");
    const gateKit = makeGate([gateRow("signed-in", "signedIn", true)]);
    const fanOut = createFanOutConnector({
      sources: [signedIn, ungated],
      clock: CLOCK,
      authGate: gateKit.gate,
    });

    const hits = await fanOut.search(CTX, "query");
    expect(hits.length).toBe(2); // both answered
    expect(signedIn.calls).toEqual(["search:query"]);
    expect(ungated.calls).toEqual(["search:query"]);
    expect(fanOut.lastSourceSkips().size).toBe(0);
  });

  it("skips gated-out sources in metadata/resolve probes (a skip is not an answer)", async () => {
    const primary = makeRecordingSource("primary");
    const gatedOut = makeRecordingSource("gated-out");
    const gateKit = makeGate([gateRow("gated-out", "authorizing", false)]);
    const fanOut = createFanOutConnector({
      sources: [gatedOut, primary],
      clock: CLOCK,
      authGate: gateKit.gate,
    });

    const item = await fanOut.metadata(CTX, "ref-1");
    expect(item?.connectorId).toBe("wfx-experience-service");
    expect(item?.externalRef).toBe("ref-1");
    expect(gatedOut.calls).toEqual([]); // skipped, not probed
    expect(primary.calls).toEqual(["metadata:ref-1"]);

    const realizations = await fanOut.resolve(CTX, "ref-1");
    expect(realizations.length).toBe(1);
    expect(gatedOut.calls).toEqual([]);
    expect(primary.calls).toContain("resolve:ref-1");
  });

  it("answers the honest FAILED receipt for an action routed to a gated-out source", async () => {
    const source = makeRecordingSource("expired-action");
    const gateKit = makeGate([gateRow("expired-action", "expired", false, "expired at 2026-09-16T13:00:00.000Z")]);
    const fanOut = createFanOutConnector({ sources: [source], clock: CLOCK, authGate: gateKit.gate });

    const receipt = await fanOut.executeAction(CTX, {
      type: "like",
      connectorId: "expired-action",
      externalRef: "ref-1",
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.detail).toContain("expired-action");
    expect(receipt.detail).toContain("expired");
    expect(source.calls).toEqual([]); // never executed
    expect(fanOut.lastSourceSkips().get("expired-action")).toContain("executeAction");
  });

  it("degrades a gate FAILURE to ungated operation (a degradation note, never an outage)", async () => {
    const source = makeRecordingSource("gate-fail-src");
    const gateKit = makeGate([], new Error("the auth store is unreachable"));
    const fanOut = createFanOutConnector({ sources: [source], clock: CLOCK, authGate: gateKit.gate });

    const hits = await fanOut.search(CTX, "query");
    expect(hits.length).toBe(1); // queried ungated
    expect(source.calls).toEqual(["search:query"]);
    const degradations = fanOut.lastDegradations();
    expect(degradations.get("auth-gate")).toContain("auth gate failed");
  });

  it("skips gated-out sources in library reads/writes (the merged answers stay honest)", async () => {
    const primary = makeRecordingSource("primary");
    const gatedOut = makeRecordingSource("gated-out");
    const gateKit = makeGate([gateRow("gated-out", "failed", false, "the refresh token was revoked")]);
    const fanOut = createFanOutConnector({
      sources: [primary, gatedOut],
      clock: CLOCK,
      authGate: gateKit.gate,
    });

    const entries = await fanOut.readLibrary(CTX);
    expect(entries.length).toBe(0); // neither implements readLibrary
    const note = fanOut.lastSourceSkips().get("gated-out") ?? "";
    expect(note).toContain("readLibrary");
    expect(note).toContain("failed");

    const writeReceipt = await fanOut.writeLibrary(CTX, { op: "add", externalRef: "ref-1" });
    expect(writeReceipt.status).toBe("failed");
    expect(writeReceipt.detail).toContain("gated-out");
    expect(gatedOut.calls).toEqual([]); // never touched
  });

  it("behaves EXACTLY as before without a gate (the baseline regression check)", async () => {
    const source = makeRecordingSource("ungated-baseline");
    const fanOut = createFanOutConnector({ sources: [source], clock: CLOCK });

    const hits = await fanOut.search(CTX, "query");
    expect(hits.length).toBe(1);
    expect(source.calls).toEqual(["search:query"]);
    expect(fanOut.lastSourceSkips().size).toBe(0);
    expect(fanOut.lastDegradations().size).toBe(0);
  });
});
