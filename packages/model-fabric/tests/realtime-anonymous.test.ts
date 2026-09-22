/**
 * @wfx/model-fabric — R25-J anonymous realtime translation tests.
 *
 * THE ACCOUNTLESS LAWS (extending R23's accountless-public-viewing
 * law to the realtime lane):
 * - the anonymous realtime translation session (currently playable
 *   public media) needs NO login — accountless BY DEFINITION;
 * - login is the honest prerequisite ONLY for the durable things:
 *   preferred translation language, translated-language voice
 *   settings, saved translated artifacts, synchronized subtitle
 *   preferences, cross-device translation history;
 * - THE NO-LOGIN-WALL LAW: mayRequireLoginForRealtimeCapability is
 *   true only for durable capabilities;
 * - the readiness gate answers TYPED refusals (never a login
 *   redirect, never a capture workaround).
 */

import { describe, expect, it } from "bun:test";

import {
  REALTIME_ANONYMOUS_CAPABILITY_IDS,
  REALTIME_CAPABILITY_AUTH_CLASSES,
  anonymousRealtimeSessionReadiness,
  isAnonymousRealtimeSessionAccountless,
  isRealtimeAnonymousCapabilityId,
  isRealtimeCapabilityAuthClass,
  mayRequireLoginForRealtimeCapability,
  realtimeCapabilityAuthClass,
} from "../src/index";

// ---------------------------------------------------------------------------
// The capability vocabulary (exactly the plan's R25-J lists)
// ---------------------------------------------------------------------------

describe("R25-J — the capability vocabulary", () => {
  it("contains the accountless session + the five durable capabilities, exactly", () => {
    expect([...REALTIME_ANONYMOUS_CAPABILITY_IDS]).toEqual([
      "anonymous-realtime-translation-session",
      "durable-translation-language-preference",
      "durable-translated-voice-settings",
      "saved-translated-artifacts",
      "synchronized-subtitle-preferences",
      "cross-device-translation-history",
    ]);
    expect(REALTIME_ANONYMOUS_CAPABILITY_IDS.length).toBe(6);
  });

  it("membership guards accept members and reject drift", () => {
    expect(isRealtimeAnonymousCapabilityId("anonymous-realtime-translation-session")).toBe(true);
    expect(isRealtimeAnonymousCapabilityId("realtime-translation")).toBe(false);
    expect(isRealtimeCapabilityAuthClass("anonymous")).toBe(true);
    expect(isRealtimeCapabilityAuthClass("provider-authorized")).toBe(false); // not an R25-J class
  });
});

// ---------------------------------------------------------------------------
// The auth-class mapping (the golden table)
// ---------------------------------------------------------------------------

describe("R25-J — the capability auth classes", () => {
  it("THE SESSION IS ANONYMOUS — no WebFlix account for the non-durable session", () => {
    expect(realtimeCapabilityAuthClass("anonymous-realtime-translation-session")).toBe(
      "anonymous",
    );
  });

  it("every durable capability honestly requires the account", () => {
    const durable = [
      "durable-translation-language-preference",
      "durable-translated-voice-settings",
      "saved-translated-artifacts",
      "synchronized-subtitle-preferences",
      "cross-device-translation-history",
    ] as const;
    for (const capability of durable) {
      expect(realtimeCapabilityAuthClass(capability)).toBe("webflix-account");
    }
  });

  it("the mapping covers every capability (totality)", () => {
    for (const capability of REALTIME_ANONYMOUS_CAPABILITY_IDS) {
      expect(REALTIME_CAPABILITY_AUTH_CLASSES).toContain(realtimeCapabilityAuthClass(capability));
    }
  });
});

// ---------------------------------------------------------------------------
// The no-login-wall law
// ---------------------------------------------------------------------------

describe("R25-J — the no-login-wall law", () => {
  it("login is required ONLY for durable capabilities — never for the session itself", () => {
    expect(mayRequireLoginForRealtimeCapability("anonymous-realtime-translation-session")).toBe(
      false,
    );
    for (const capability of REALTIME_ANONYMOUS_CAPABILITY_IDS) {
      const requires = mayRequireLoginForRealtimeCapability(capability);
      expect(requires).toBe(realtimeCapabilityAuthClass(capability) === "webflix-account");
    }
  });

  it("isAnonymousRealtimeSessionAccountless is total and always true", () => {
    expect(isAnonymousRealtimeSessionAccountless()).toBe(true);
    expect(isAnonymousRealtimeSessionAccountless()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The readiness gate (typed refusals, never a login wall)
// ---------------------------------------------------------------------------

describe("R25-J — the anonymous readiness gate", () => {
  it("ready when the media is currently playable public media AND the audio is lawfully available", () => {
    const readiness = anonymousRealtimeSessionReadiness({
      currentlyPlayablePublicMedia: true,
      audioStreamLegallyAvailable: true,
    });
    expect(readiness.kind).toBe("ready");
    if (readiness.kind === "ready") {
      expect(readiness.detail).toContain("no WebFlix account is needed");
    }
  });

  it("not-currently-playable-public-media → the typed refusal (NOT a login redirect)", () => {
    const readiness = anonymousRealtimeSessionReadiness({
      currentlyPlayablePublicMedia: false,
      audioStreamLegallyAvailable: true,
    });
    expect(readiness.kind).toBe("not-currently-playable-public-media");
    if (readiness.kind === "not-currently-playable-public-media") {
      expect(readiness.detail).toContain("currently playable public media");
      expect(readiness.detail.toLowerCase()).not.toContain("sign in");
    }
  });

  it("audio-not-legally-available → the typed refusal (no bypass, by design)", () => {
    const readiness = anonymousRealtimeSessionReadiness({
      currentlyPlayablePublicMedia: true,
      audioStreamLegallyAvailable: false,
    });
    expect(readiness.kind).toBe("audio-not-legally-available");
    if (readiness.kind === "audio-not-legally-available") {
      expect(readiness.detail).toContain("no bypass");
    }
  });

  it("both preconditions missing reports the media-state refusal first (deterministic order)", () => {
    const readiness = anonymousRealtimeSessionReadiness({
      currentlyPlayablePublicMedia: false,
      audioStreamLegallyAvailable: false,
    });
    expect(readiness.kind).toBe("not-currently-playable-public-media");
  });
});
