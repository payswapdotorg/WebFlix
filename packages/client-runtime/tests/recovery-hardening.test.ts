/**
 * @wfx/client-runtime — R17 failure/recovery hardening tests.
 *
 * THE EIGHT FAILURE CLASSES at the runtime seam, each with an INJECTED
 * failure and an asserted honest state (never a placeholder, never a fake
 * success):
 *
 * 1. EXPIRED CREDENTIALS — a classified `unauthorized` transport failure
 *    carries the NAMED expired-credential state and its re-auth recovery
 *    path; `sourceRecoveryAction` derives the typed reauthorize offer for
 *    an expired source (never silent, never fake-connected).
 * 2. UNAVAILABLE REALIZATIONS — the `unavailable` dead end NAMES the
 *    missing source (the intent's attribution when the source offers
 *    nothing; the candidates' own ids when their offers are unusable).
 * 3. NETWORK LOSS / 5. PEER STARVATION — the starved transfer facts fold
 *    into the view's honest starvation truth (measured numbers passed
 *    through verbatim, protocol-free, never a fabricated ETA).
 * 6. INTERRUPTED NATIVE SESSIONS — a paused interrupted session offers the
 *    EXPLICIT resume-or-clean-restart choice (both typed actions).
 */

import { describe, expect, it } from "bun:test";
import type { PlaybackRealization } from "@wfx/domain";

import {
  CREDENTIAL_FAILURE_SENTENCES,
  containsAcquisitionProtocolTerminology,
  createRuntime,
  FixedClock,
  InMemoryServerPort,
  mapAcquisitionStatus,
  makeWebCapabilities,
  RuntimeError,
  serverFailureError,
  sourceRecoveryAction,
  type AcquisitionFacts,
  type RuntimeSession,
  type SourceInfo,
  type CredentialFailure,
} from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const ITEM_A = "wfxitm_00000000000000000000000001";

function session(): RuntimeSession {
  return {
    context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
    clock: new FixedClock(T0),
    ids: { next: () => "00000000000000000000000001" },
  };
}

// ---------------------------------------------------------------------------
// 1. EXPIRED CREDENTIALS — the named state + the re-auth recovery path
// ---------------------------------------------------------------------------

describe("R17 — expired credentials (the named state, never a silent fallback)", () => {
  it("a classified unauthorized failure carries the named expired state and the re-authenticate recovery", () => {
    const error = serverFailureError("resolve", {
      kind: "unauthorized",
      detail: "the stored token was rejected",
      credential: { state: "expired", connectorId: "youtube" },
    });
    expect(error).toBeInstanceOf(RuntimeError);
    expect(error.kind).toBe("unauthorized");
    expect(error.retryable).toBe(false); // re-auth is the recovery, not retry
    expect(error.credential).toEqual({ state: "expired", connectorId: "youtube" });
    expect(error.recovery.action).toBe("re-authenticate");
    expect(error.recovery.detail).toContain(CREDENTIAL_FAILURE_SENTENCES.expired);
    expect(error.recovery.detail).toContain("youtube");
    // The message itself names the expired state (what a surface renders).
    expect(error.message).toContain("sign-in expired");
    expect(error.message).toContain("reconnect");
  });

  it("an unclassified unauthorized stays the honest generic (never a guessed state)", () => {
    const error = serverFailureError("resolve", { kind: "unauthorized", detail: "401" });
    expect(error.credential).toBeUndefined();
    expect(error.recovery.action).toBe("re-authenticate");
    expect(error.message).not.toContain("sign-in expired");
  });

  it("a non-unauthorized failure never carries a credential state", () => {
    const error = serverFailureError("resolve", {
      kind: "network",
      detail: "offline",
      // even if a buggy transport attaches one — the kind gate wins
      credential: { state: "expired" },
    });
    expect(error.kind).toBe("network");
    expect(error.credential).toBeUndefined();
  });

  it("the classified resolve failure surfaces through resolvePlayback verbatim", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    const credential: CredentialFailure = { state: "expired", connectorId: "test-source" };
    server.scriptResolve("ref-expired", {
      ok: false,
      failure: { kind: "unauthorized", detail: "the stored authorization expired", credential },
    });
    const runtime = createRuntime(web, server, session());
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-expired" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    const failure = thrown as RuntimeError;
    expect(failure.kind).toBe("unauthorized");
    expect(failure.credential).toEqual(credential);
    expect(failure.recovery.action).toBe("re-authenticate");
    expect(failure.recovery.detail).toContain("sign-in expired");
  });
});

describe("R17 — sourceRecoveryAction (the typed re-auth offer per auth state)", () => {
  const base: SourceInfo = {
    connectorId: "youtube",
    displayName: "YouTube",
    version: "1.2.0",
    authMode: "oauth",
    capabilities: {
      identity: false, catalogSearch: true, metadata: true, playNative: false, playEmbed: true,
      playBrowser: false, playExternal: true, availability: true, libraryRead: true,
      libraryWrite: true, like: true, save: true, follow: false, comment: false,
      download: false, transform: false, feedImport: false,
    },
    authState: "signedIn",
    requiresAuthorization: true,
    connected: true,
    accountId: "wfxacct_01",
    authorizedAt: new Date(T0 - 3_600_000).toISOString(),
    lastStateChange: null,
    expiresAt: null,
    availabilityNotes: [],
    lastChecked: new Date(T0).toISOString(),
  };

  it("an EXPIRED source offers reauthorize with the named expired sentence", () => {
    const action = sourceRecoveryAction({ ...base, authState: "expired", connected: false, expiresAt: new Date(T0 - 1).toISOString() });
    expect(action.kind).toBe("reauthorize");
    expect(action.label).toBe("Reconnect");
    expect(action.detail).toContain("expired");
    expect(action.detail).toContain("reconnect");
  });

  it("a FAILED source offers reauthorize (try again); a signed-out source offers connect", () => {
    expect(sourceRecoveryAction({ ...base, authState: "failed", connected: false }).kind).toBe("reauthorize");
    const connect = sourceRecoveryAction({ ...base, authState: "signedOut", connected: false, accountId: null });
    expect(connect.kind).toBe("connect");
    expect(connect.detail).toContain("not connected");
  });

  it("a signed-in source offers disconnect; authorizing and no-auth sources offer none", () => {
    expect(sourceRecoveryAction({ ...base }).kind).toBe("disconnect");
    expect(sourceRecoveryAction({ ...base, authState: "authorizing" }).kind).toBe("none");
    expect(sourceRecoveryAction({ ...base, authMode: "none", authState: "signedOut", requiresAuthorization: false }).kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 2. UNAVAILABLE REALIZATIONS — the dead end names the missing source
// ---------------------------------------------------------------------------

describe("R17 — unavailable realizations (the dead end names the missing source)", () => {
  it("an empty resolve names the attributed source (never a source-less 'item unavailable')", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-none", { ok: true, value: [] });
    const runtime = createRuntime(web, server, session());
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({
        itemId: ITEM_A,
        externalRef: "ref-none",
        connectorId: "test-source",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    const failure = thrown as RuntimeError;
    expect(failure.kind).toBe("unavailable");
    expect(failure.message).toContain("no valid playback realization");
    expect(failure.message).toContain("source 'test-source' offers no playback realization");
  });

  it("unusable candidates name the sources that offered them (the candidates' own ids)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    // Realizations whose shape is invalid (no connectorId/empty) — the
    // runtime refuses to adopt them and names who offered nothing usable.
    const broken = { mode: "embed", connectorId: "test-source", capabilities: [], url: "" } as PlaybackRealization;
    server.scriptResolve("ref-broken", { ok: true, value: [broken] });
    const runtime = createRuntime(web, server, session());
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-broken" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).kind).toBe("unavailable");
    expect((thrown as RuntimeError).message).toContain("test-source");
  });

  it("without any attribution the dead end stays honest (no source named, none invented)", async () => {
    const web = makeWebCapabilities();
    const server = new InMemoryServerPort();
    server.scriptResolve("ref-anon", { ok: true, value: [] });
    const runtime = createRuntime(web, server, session());
    let thrown: unknown;
    try {
      await runtime.resolvePlayback({ itemId: ITEM_A, externalRef: "ref-anon" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as RuntimeError).message).toContain("no source offers a playback realization");
  });
});

// ---------------------------------------------------------------------------
// 3./5. NETWORK LOSS + PEER STARVATION — the measured starvation truth
// ---------------------------------------------------------------------------

describe("R17 — starved transfers (the honest waiting state, measured)", () => {
  const starvedFacts: AcquisitionFacts = {
    itemId: ITEM_A,
    title: "Glacier Watch",
    transfer: {
      phase: "transferring",
      paused: false,
      progressFraction: 0.35,
      starved: { stalledMs: 92_000, bytesPerSecond: 0, sourcesConnected: 0 },
    },
  };

  it("the view carries the measured starvation truth verbatim (pass-through, never fabricated)", () => {
    const view = mapAcquisitionStatus(starvedFacts);
    expect(view.state).toBe("completing"); // the lifecycle stays truthful
    expect(view.starved).toEqual({ stalledMs: 92_000, bytesPerSecond: 0, sourcesConnected: 0 });
    expect(view.detail).toContain("Nothing has arrived for 92s");
    expect(view.detail).toContain("0 B/s measured from 0 connected sources");
    expect(view.detail).toContain("Waiting for the download to continue");
  });

  it("the starvation sentence is protocol-free (the leak guard holds)", () => {
    const view = mapAcquisitionStatus(starvedFacts);
    expect(containsAcquisitionProtocolTerminology(view.detail)).toBe(false);
  });

  it("the progress bar stays the MEASURED fraction — never a fake moving bar", () => {
    const view = mapAcquisitionStatus(starvedFacts);
    expect(view.progress).toBe(0.35); // exactly what was measured — nothing extrapolated
  });

  it("a healthy transfer carries no starvation marker (absent = not measured)", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM_A,
      transfer: { phase: "transferring", paused: false, progressFraction: 0.4 },
    });
    expect(view.starved).toBeUndefined();
    expect(view.detail).not.toContain("Nothing has arrived");
  });

  it("malformed starvation facts throw the typed invalid-input (never guessed)", () => {
    expect(() =>
      mapAcquisitionStatus({
        itemId: ITEM_A,
        transfer: {
          phase: "transferring",
          paused: false,
          progressFraction: 0.4,
          starved: { stalledMs: -1, bytesPerSecond: 0, sourcesConnected: 0 },
        },
      }),
    ).toThrow(RuntimeError);
  });
});

// ---------------------------------------------------------------------------
// 6. INTERRUPTED NATIVE SESSIONS — the explicit resume-or-clean-restart choice
// ---------------------------------------------------------------------------

describe("R17 — interrupted sessions (resume-or-clean-restart, explicit)", () => {
  it("a PAUSED interrupted session offers BOTH resume and restart (the explicit choice)", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM_A,
      title: "Deep Field Diary",
      transfer: {
        phase: "transferring",
        paused: true,
        progressFraction: 0.35,
        resumed: { retainedFraction: 0.35, pieceMapReused: true },
      },
    });
    expect(view.paused).toBe(true);
    expect(view.resumed).toBe(true);
    expect(view.retainedFraction).toBe(0.35);
    const kinds = view.actions.map((action) => action.kind);
    expect(kinds).toContain("resume");
    expect(kinds).toContain("restart");
  });

  it("the interrupted session's detail SAYS WHICH: resuming with the retained progress", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM_A,
      transfer: {
        phase: "transferring",
        paused: true,
        progressFraction: 0.35,
        resumed: { retainedFraction: 0.35, pieceMapReused: true },
      },
    });
    expect(view.detail).toContain("Resuming where it left off");
    expect(view.detail).toContain("35% already saved");
  });

  it("a paused NON-interrupted session offers resume only (no restart to offer — nothing was interrupted)", () => {
    const view = mapAcquisitionStatus({
      itemId: ITEM_A,
      transfer: { phase: "transferring", paused: true, progressFraction: 0.5 },
    });
    const kinds = view.actions.map((action) => action.kind);
    expect(kinds).toEqual(["resume"]);
  });
});
