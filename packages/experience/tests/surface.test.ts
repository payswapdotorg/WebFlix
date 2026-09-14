/**
 * @wfx/experience — Media Surface resolver tests (WFX-025, Lane C).
 *
 * Coverage required by the dispatch packet:
 * - precedence: native beats embed beats browser beats external when all available
 * - each fallback step when the preferred mode is missing/unavailable/expired
 * - device gating: native skipped when `canPlay` false
 * - permission gating: browser/external restrictions honored
 * - unresolvable: zero realizations ⇒ typed reasons for every mode
 * - expired realization exclusion
 * - session builder golden paths + validation errors
 * - matrix consistency vs the resolver (no contradictions)
 */

import { describe, expect, it } from "bun:test";
import type { DeviceCapabilities } from "@wfx/domain";
import {
  canPlay,
  validateEntertainmentItem,
  validatePlaybackRealization,
} from "@wfx/domain";

import {
  ExperienceError,
  FixedClock,
  PLAYBACK_MODE_PRECEDENCE,
  SURFACE_DEVICE_PROFILES,
  SURFACE_DESKTOP_FULL_DEVICE,
  SURFACE_KIOSK_BROWSER_ONLY_DEVICE,
  SURFACE_MATRIX_PROBES,
  SURFACE_MOBILE_RESTRICTED_DEVICE,
  SURFACE_NOW,
  SURFACE_PERMISSIONS_ALL_RESTRICTED,
  SURFACE_PERMISSIONS_BROWSER_BLOCKED,
  SURFACE_PERMISSIONS_PERMISSIVE,
  SURFACE_PERMISSIONS_WITH_HINTS,
  SURFACE_REALIZATION_ALL_MODES,
  SURFACE_REALIZATION_ALL_MODES_REVERSED,
  SURFACE_REALIZATION_BROWSER,
  SURFACE_REALIZATION_BROWSER_UNAVAILABLE,
  SURFACE_REALIZATION_EMBED,
  SURFACE_REALIZATION_EMBED_UNKNOWN,
  SURFACE_ITEMS,
  SURFACE_REALIZATION_EXTERNAL,
  SURFACE_REALIZATION_NATIVE,
  SURFACE_REALIZATION_NATIVE_EXPIRED,
  SURFACE_REALIZATION_NATIVE_EXPIRING_AT_NOW,
  SURFACE_REALIZATION_NATIVE_HEVC,
  SURFACE_REALIZATION_NATIVE_UNAVAILABLE,
  SURFACE_REALIZATION_NATIVE_UNDECODABLE,
  SURFACE_REQUEST_ALL_MODES_DESKTOP,
  SURFACE_TV_NATIVE_DEVICE,
  SURFACE_VALID_UNTIL,
  buildPlaybackSession,
  capabilityMatrix,
  resolveSurface,
  surfacePermissionAllows,
  type SurfaceMatrixDecision,
  type SurfacePermissions,
  type SurfaceRealization,
  type SurfaceRequest,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RequestOverrides {
  item?: SurfaceRequest["item"];
  realizations?: readonly SurfaceRealization[];
  device?: SurfaceRequest["device"];
  permissions?: SurfaceRequest["permissions"];
  now?: string;
}

/** Deterministic request builder: desktop-full + permissive + all modes by default. */
function makeRequest(overrides: RequestOverrides = {}): SurfaceRequest {
  return {
    item: overrides.item ?? SURFACE_REQUEST_ALL_MODES_DESKTOP.item,
    realizations:
      overrides.realizations ?? SURFACE_REALIZATION_ALL_MODES.map((r) => ({ ...r })),
    device: overrides.device ?? SURFACE_DESKTOP_FULL_DEVICE,
    permissions: overrides.permissions ?? SURFACE_PERMISSIONS_PERMISSIVE,
    now: overrides.now ?? SURFACE_NOW,
  };
}

/** Run an action that must throw an `ExperienceError`; return it for detail assertions. */
function captureExperienceError(action: () => unknown): ExperienceError {
  try {
    action();
  } catch (thrown) {
    if (thrown instanceof ExperienceError) return thrown;
    throw new Error(`expected ExperienceError, got ${String(thrown)}`);
  }
  throw new Error("expected the call to throw an ExperienceError");
}

const VALID_SESSION_ID = "wfxpses_00000000000000000000000001";

// ---------------------------------------------------------------------------
// Fixtures sanity (deterministic, frozen-contract shaped)
// ---------------------------------------------------------------------------

describe("surface fixtures — sanity", () => {
  it("items cover every canonical type and pass the WFX-002 validator", () => {
    expect(SURFACE_ITEMS).toHaveLength(7);
    const types = SURFACE_ITEMS.map((item) => item.canonicalType);
    expect(types).toEqual(["movie", "series", "episode", "video", "short", "post", "audio"]);
    for (const item of SURFACE_ITEMS) {
      const check = validateEntertainmentItem(item);
      expect(check.ok).toBe(true);
    }
    expect(new Set(SURFACE_ITEMS.map((item) => item.id)).size).toBe(7); // distinct canonical ids
  });

  it("base realizations in all four modes pass the WFX-002 validator", () => {
    for (const realization of SURFACE_REALIZATION_ALL_MODES) {
      expect(validatePlaybackRealization(realization).ok).toBe(true);
    }
    const modes = SURFACE_REALIZATION_ALL_MODES.map((r) => r.mode);
    expect(modes).toEqual(["native", "embed", "browser", "external"]);
  });

  it("permission sets express the documented restriction semantics", () => {
    const empty: SurfacePermissions = {};
    for (const flag of ["nativePermitted", "browserAllowed", "externalAllowed"] as const) {
      expect(surfacePermissionAllows(empty, flag)).toBe(true); // defaults true
      expect(surfacePermissionAllows(SURFACE_PERMISSIONS_PERMISSIVE, flag)).toBe(true);
    }
    expect(surfacePermissionAllows(SURFACE_PERMISSIONS_BROWSER_BLOCKED, "browserAllowed")).toBe(false);
    expect(surfacePermissionAllows(SURFACE_PERMISSIONS_BROWSER_BLOCKED, "nativePermitted")).toBe(true);
    expect(surfacePermissionAllows(SURFACE_PERMISSIONS_BROWSER_BLOCKED, "externalAllowed")).toBe(true);
    for (const flag of ["nativePermitted", "browserAllowed", "externalAllowed"] as const) {
      expect(surfacePermissionAllows(SURFACE_PERMISSIONS_ALL_RESTRICTED, flag)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Frozen precedence
// ---------------------------------------------------------------------------

describe("resolveSurface — frozen precedence (native > embed > browser > external)", () => {
  it("picks native when all four modes are available (desktop-full)", () => {
    const resolution = resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
    expect(resolution.chosen).toEqual(SURFACE_REALIZATION_NATIVE);
    expect(resolution.itemId).toBe(SURFACE_REQUEST_ALL_MODES_DESKTOP.item.id);
  });

  it("is independent of the caller's array order", () => {
    const resolution = resolveSurface(makeRequest({ realizations: SURFACE_REALIZATION_ALL_MODES_REVERSED }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
  });

  it("emits exactly one auditable trace line per mode, in precedence order", () => {
    const resolution = resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.precedenceTrace).toEqual([
      "native: accepted — realization #0 from connector 'surface-fixture-source'",
      "embed: skipped — precedence satisfied by 'native'",
      "browser: skipped — precedence satisfied by 'native'",
      "external: skipped — precedence satisfied by 'native'",
    ]);
  });

  it("falls back to embed when native is missing", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_EMBED, SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
    expect(resolution.precedenceTrace[0]).toBe("native: rejected — no native realization present");
  });

  it("falls back to browser when native and embed are missing", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("browser");
  });

  it("falls back to external when only external remains", () => {
    const resolution = resolveSurface(makeRequest({ realizations: [SURFACE_REALIZATION_EXTERNAL] }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("external");
    expect(resolution.chosen).toEqual(SURFACE_REALIZATION_EXTERNAL);
  });

  it("within one mode, the FIRST candidate passing every gate wins", () => {
    // #0 demands vvc (undecodable everywhere), #1 is clean → #1 wins.
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_NATIVE_UNDECODABLE, SURFACE_REALIZATION_NATIVE] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.chosen).toEqual(SURFACE_REALIZATION_NATIVE);
    expect(resolution.precedenceTrace[0]).toBe(
      "native: accepted — realization #1 from connector 'surface-fixture-source'",
    );
  });

  it("within one mode, two viable candidates resolve to the first by array order", () => {
    const second: SurfaceRealization = { ...SURFACE_REALIZATION_NATIVE, externalRef: "surface:movie-1-alt" };
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_NATIVE, second] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.chosen.externalRef).toBe("surface:movie-1");
  });

  it("is deterministic: the same request yields the identical resolution", () => {
    expect(resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP)).toEqual(
      resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP),
    );
  });
});

// ---------------------------------------------------------------------------
// Fallback on non-availability
// ---------------------------------------------------------------------------

describe("resolveSurface — availability gating", () => {
  it("skips an unavailable native realization (falls to embed)", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_NATIVE_UNAVAILABLE, SURFACE_REALIZATION_EMBED] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
    expect(resolution.precedenceTrace[0]).toBe(
      "native: rejected — no viable native realization (excluded: #0 availability 'unavailable')",
    );
  });

  it("excludes an embed realization claiming unknown availability", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_EMBED_UNKNOWN, SURFACE_REALIZATION_BROWSER] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("browser");
    expect(resolution.precedenceTrace[1]).toBe(
      "embed: rejected — no viable embed realization (excluded: #0 availability 'unknown')",
    );
  });

  it("excludes a browser realization claiming unavailable availability", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_BROWSER_UNAVAILABLE, SURFACE_REALIZATION_EXTERNAL] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("external");
  });

  it("degrades a malformed availability claim to unknown (never trusted, never fabricated)", () => {
    // Deliberate untyped-caller defense probe: a malformed availability claim.
    const malformed = { ...SURFACE_REALIZATION_NATIVE, availability: "maybe" } as unknown as SurfaceRealization;
    const resolution = resolveSurface(makeRequest({ realizations: [malformed, SURFACE_REALIZATION_EMBED] }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
    expect(resolution.precedenceTrace[0]).toContain("malformed availability claim");
  });

  it("a missing availability claim passes (frozen resolve() surface carries none)", () => {
    // All base fixtures omit `availability` — the canonical request resolves native.
    const resolution = resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
  });
});

// ---------------------------------------------------------------------------
// Fallback on expiry
// ---------------------------------------------------------------------------

describe("resolveSurface — expiry gating", () => {
  it("excludes an expired native realization with a recorded reason", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_NATIVE_EXPIRED, SURFACE_REALIZATION_EMBED] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
    expect(resolution.precedenceTrace[0]).toBe(
      "native: rejected — no viable native realization (excluded: #0 expired at 2026-09-12T23:59:59.999Z)",
    );
  });

  it("treats a realization expiring exactly at `now` as expired (safe-side boundary)", () => {
    const resolution = resolveSurface(
      makeRequest({ realizations: [SURFACE_REALIZATION_NATIVE_EXPIRING_AT_NOW, SURFACE_REALIZATION_EMBED] }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
    expect(resolution.precedenceTrace[0]).toContain("expired at 2026-09-13T00:00:00.000Z");
  });

  it("keeps a realization whose expiry is in the future", () => {
    const fresh: SurfaceRealization = { ...SURFACE_REALIZATION_NATIVE, expiresAt: SURFACE_VALID_UNTIL };
    const resolution = resolveSurface(makeRequest({ realizations: [fresh, SURFACE_REALIZATION_EMBED] }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
  });

  it("every fallback step works when the preferred mode is expired", () => {
    const expiredEmbed: SurfaceRealization = {
      ...SURFACE_REALIZATION_EMBED,
      expiresAt: "2026-09-12T23:59:59.999Z",
    };
    const expiredBrowser: SurfaceRealization = {
      ...SURFACE_REALIZATION_BROWSER,
      expiresAt: "2026-09-12T23:59:59.999Z",
    };
    const toEmbed = resolveSurface(
      makeRequest({
        realizations: [SURFACE_REALIZATION_NATIVE_EXPIRED, SURFACE_REALIZATION_EMBED, SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(toEmbed.ok && toEmbed.mode).toBe("embed");

    const toBrowser = resolveSurface(
      makeRequest({
        realizations: [SURFACE_REALIZATION_NATIVE_EXPIRED, expiredEmbed, SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(toBrowser.ok && toBrowser.mode).toBe("browser");

    const toExternal = resolveSurface(
      makeRequest({
        realizations: [SURFACE_REALIZATION_NATIVE_EXPIRED, expiredEmbed, expiredBrowser, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(toExternal.ok && toExternal.mode).toBe("external");
  });

  it("an expired-only request is unresolvable with the expiry reason recorded", () => {
    const resolution = resolveSurface(makeRequest({ realizations: [SURFACE_REALIZATION_NATIVE_EXPIRED] }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.kind).toBe("unresolvable");
    expect(resolution.reasons.join("\n")).toContain(
      "realization #0 (native, connector 'surface-fixture-source'): expired at 2026-09-12T23:59:59.999Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Device gating (WFX-002 canPlay)
// ---------------------------------------------------------------------------

describe("resolveSurface — device gating", () => {
  it("native is skipped when the device cannot play it (canPlay=false)", () => {
    // kiosk declares only browser mode.
    const resolution = resolveSurface(
      makeRequest({ device: SURFACE_KIOSK_BROWSER_ONLY_DEVICE, realizations: [SURFACE_REALIZATION_NATIVE] }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reasons.join("\n")).toContain(
      "native: rejected — device cannot realize native playback (canPlay=false; device declares [browser]; browser surface: yes)",
    );
  });

  it("a TV without a web surface rejects embed and browser, keeps external handoff", () => {
    const resolution = resolveSurface(
      makeRequest({
        device: SURFACE_TV_NATIVE_DEVICE,
        realizations: [SURFACE_REALIZATION_EMBED, SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("external");
    const trace = resolution.precedenceTrace.join("\n");
    expect(trace).toContain("embed: rejected — device cannot realize embed playback");
    expect(trace).toContain("browser: rejected — device cannot realize browser playback");
  });

  it("a TV with a viable native realization picks native", () => {
    const resolution = resolveSurface(makeRequest({ device: SURFACE_TV_NATIVE_DEVICE }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
  });

  it("a browser-only kiosk falls through embed (device) to browser", () => {
    const resolution = resolveSurface(
      makeRequest({
        device: SURFACE_KIOSK_BROWSER_ONLY_DEVICE,
        realizations: [SURFACE_REALIZATION_EMBED, SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("browser");
    expect(resolution.precedenceTrace.join("\n")).toContain(
      "embed: rejected — device cannot realize embed playback (canPlay=false; device declares [browser]; browser surface: yes)",
    );
  });

  it("mobile-restricted: declared-but-undecodable native falls to embed (codec gate)", () => {
    const resolution = resolveSurface(
      makeRequest({
        device: SURFACE_MOBILE_RESTRICTED_DEVICE,
        realizations: [SURFACE_REALIZATION_NATIVE_HEVC, SURFACE_REALIZATION_EMBED],
      }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
    expect(resolution.precedenceTrace[0]).toBe(
      "native: rejected — no decodable native realization (#0: demands [hevc] not decodable by device codecs [h264, vp9, aac, opus])",
    );
  });

  it("mobile-restricted: a demand-free native realization is chosen (declaration alone suffices)", () => {
    const resolution = resolveSurface(
      makeRequest({
        device: SURFACE_MOBILE_RESTRICTED_DEVICE,
        realizations: [SURFACE_REALIZATION_NATIVE, SURFACE_REALIZATION_EMBED],
      }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
  });

  it("media demands gate native only — an embed with demands is unaffected", () => {
    const demanding: SurfaceRealization = { ...SURFACE_REALIZATION_EMBED, capabilities: ["playEmbed", "vvc"] };
    const resolution = resolveSurface(makeRequest({ realizations: [demanding] }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("embed");
  });
});

// ---------------------------------------------------------------------------
// Permission gating
// ---------------------------------------------------------------------------

describe("resolveSurface — permission gating", () => {
  it("empty permissions default to allowed (native wins)", () => {
    const resolution = resolveSurface(makeRequest({ permissions: {} }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native");
  });

  it("browser-blocked permissions are honored (falls to external)", () => {
    const resolution = resolveSurface(
      makeRequest({
        permissions: SURFACE_PERMISSIONS_BROWSER_BLOCKED,
        realizations: [SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("external");
    expect(resolution.precedenceTrace[2]).toBe(
      "browser: rejected — browser playback not allowed (browserAllowed=false)",
    );
  });

  it("external restriction is honored (unresolvable when external is the only mode)", () => {
    const resolution = resolveSurface(
      makeRequest({
        permissions: { nativePermitted: true, browserAllowed: false, externalAllowed: false },
        realizations: [SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reasons.join("\n")).toContain(
      "external: rejected — external handoff not allowed (externalAllowed=false)",
    );
  });

  it("all-restricted permissions block browser and external simultaneously", () => {
    const resolution = resolveSurface(
      makeRequest({
        permissions: SURFACE_PERMISSIONS_ALL_RESTRICTED,
        realizations: [SURFACE_REALIZATION_BROWSER, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    const joined = resolution.reasons.join("\n");
    expect(joined).toContain("browser: rejected — browser playback not allowed (browserAllowed=false)");
    expect(joined).toContain("external: rejected — external handoff not allowed (externalAllowed=false)");
  });

  it("nativePermitted=false models the authorized-media boundary (falls to external)", () => {
    const resolution = resolveSurface(
      makeRequest({
        permissions: { nativePermitted: false },
        realizations: [SURFACE_REALIZATION_NATIVE, SURFACE_REALIZATION_EXTERNAL],
      }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("external");
    expect(resolution.precedenceTrace[0]).toBe(
      "native: rejected — native playback not permitted (nativePermitted=false)",
    );
  });

  it("provider hints are advisory only — frozen precedence still decides", () => {
    const resolution = resolveSurface(
      makeRequest({ permissions: SURFACE_PERMISSIONS_WITH_HINTS }),
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.mode).toBe("native"); // hint preferred embed — ignored for the decision
    expect(resolution.precedenceTrace).toHaveLength(5);
    expect(resolution.precedenceTrace[4]).toBe(
      "hint: provider prefers 'embed' — advisory only, frozen precedence decides",
    );
  });
});

// ---------------------------------------------------------------------------
// Unresolvable — typed dead ends with ALL reasons
// ---------------------------------------------------------------------------

describe("resolveSurface — unresolvable", () => {
  it("zero realizations yields typed reasons for every mode", () => {
    const resolution = resolveSurface(makeRequest({ realizations: [] }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.kind).toBe("unresolvable");
    const joined = resolution.reasons.join("\n");
    for (const mode of PLAYBACK_MODE_PRECEDENCE) {
      expect(joined).toContain(`${mode}: rejected — no ${mode} realization present`);
    }
    expect(joined).toContain("unresolvable: no playback mode could be realized for item 'wfxitm_00000000000000000000000001'");
  });

  it("an invalid-shape realization is excluded with a reason (never adopted, never repaired)", () => {
    const broken: SurfaceRealization = { mode: "external", connectorId: "", capabilities: [] };
    const resolution = resolveSurface(makeRequest({ realizations: [broken] }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    const joined = resolution.reasons.join("\n");
    expect(joined).toContain("realization #0: invalid shape");
    expect(joined).toContain("external: rejected — no viable external realization (excluded: #0 invalid shape)");
  });

  it("mixed exclusions are ALL recorded (expired + unavailable + every mode rejection)", () => {
    const resolution = resolveSurface(
      makeRequest({
        realizations: [SURFACE_REALIZATION_NATIVE_EXPIRED, SURFACE_REALIZATION_EMBED_UNKNOWN, SURFACE_REALIZATION_BROWSER_UNAVAILABLE],
      }),
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    const joined = resolution.reasons.join("\n");
    expect(joined).toContain("expired at 2026-09-12T23:59:59.999Z");
    expect(joined).toContain("availability 'unknown'");
    expect(joined).toContain("availability 'unavailable'");
    expect(joined).toContain("external: rejected — no external realization present");
  });
});

// ---------------------------------------------------------------------------
// Request validation — typed misuse channel
// ---------------------------------------------------------------------------

describe("resolveSurface — request validation (ExperienceError on misuse)", () => {
  it("rejects a non-object request", () => {
    const error = captureExperienceError(() =>
      resolveSurface(null as unknown as SurfaceRequest),
    );
    expect(error.details).toContain("request: expected a SurfaceRequest object");
  });

  it("rejects a malformed item (canonical id required)", () => {
    const error = captureExperienceError(() =>
      resolveSurface(makeRequest({ item: { id: "nope", canonicalType: "movie" } })),
    );
    expect(error.details.join("\n")).toContain("request.item:");
  });

  it("rejects a non-array realizations field", () => {
    const error = captureExperienceError(() =>
      resolveSurface(makeRequest({ realizations: "nope" as unknown as readonly SurfaceRealization[] })),
    );
    expect(error.details.join("\n")).toContain("request.realizations:");
  });

  it("rejects a device with a bogus declared mode", () => {
    const bogusDevice = {
      playbackModes: ["native", "bogus"],
      codecs: ["h264"],
      browser: true,
      backgroundPlayback: false,
      casting: false,
    } as unknown as DeviceCapabilities;
    const error = captureExperienceError(() => resolveSurface(makeRequest({ device: bogusDevice })));
    expect(error.details.join("\n")).toContain("request.device.playbackModes:");
  });

  it("rejects non-boolean permission flags", () => {
    const bogusPermissions = { nativePermitted: "yes" } as unknown as SurfacePermissions;
    const error = captureExperienceError(() =>
      resolveSurface(makeRequest({ permissions: bogusPermissions })),
    );
    expect(error.details.join("\n")).toContain("request.permissions.nativePermitted:");
  });

  it("rejects a non-ISO now", () => {
    const error = captureExperienceError(() => resolveSurface(makeRequest({ now: "yesterday" })));
    expect(error.details.join("\n")).toContain("request.now:");
  });

  it("aggregates every problem into one typed throw", () => {
    const error = captureExperienceError(() =>
      resolveSurface(
        makeRequest({ item: { id: "nope", canonicalType: "movie" }, now: "whenever" }),
      ),
    );
    expect(error.details.length).toBeGreaterThanOrEqual(2);
    expect(error.details.join("\n")).toContain("request.item:");
    expect(error.details.join("\n")).toContain("request.now:");
  });
});

// ---------------------------------------------------------------------------
// Session builder — golden paths + validation errors
// ---------------------------------------------------------------------------

describe("buildPlaybackSession — golden paths", () => {
  it("builds the frozen PlaybackSession from a real resolution", () => {
    const resolution = resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const session = buildPlaybackSession(
      resolution,
      "user-1",
      VALID_SESSION_ID,
      42_000,
      new FixedClock(), // default start = the fixture instant (2026-09-13T00:00:00.000Z)
    );
    expect(session).toEqual({
      id: VALID_SESSION_ID,
      userId: "user-1",
      itemId: SURFACE_REQUEST_ALL_MODES_DESKTOP.item.id,
      realization: SURFACE_REALIZATION_NATIVE,
      resumePositionMs: 42_000,
      createdAt: SURFACE_NOW,
    });
    expect(validatePlaybackRealization(session.realization).ok).toBe(true);
  });

  it("takes createdAt from the injected clock only (no hidden Date.now)", () => {
    const resolution = resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);
    if (!resolution.ok) return;
    const clock = new FixedClock();
    clock.advance(90_000);
    const session = buildPlaybackSession(resolution, "user-1", VALID_SESSION_ID, 0, clock);
    expect(session.createdAt).toBe("2026-09-13T00:01:30.000Z");
  });

  it("defaults nothing — resume position 0 is explicit caller input", () => {
    const resolution = resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);
    if (!resolution.ok) return;
    const session = buildPlaybackSession(resolution, "user-1", VALID_SESSION_ID, 0, new FixedClock());
    expect(session.resumePositionMs).toBe(0);
  });
});

describe("buildPlaybackSession — validation errors (typed)", () => {
  const okResolution = () => resolveSurface(SURFACE_REQUEST_ALL_MODES_DESKTOP);

  it("rejects an unresolvable resolution with its reasons surfaced verbatim", () => {
    const unresolvable = resolveSurface(makeRequest({ realizations: [] }));
    const error = captureExperienceError(() =>
      buildPlaybackSession(unresolvable, "user-1", VALID_SESSION_ID, 0, new FixedClock()),
    );
    const joined = error.details.join("\n");
    expect(joined).toContain("resolution: unresolvable — a playback session cannot be built from a failed surface resolution");
    expect(joined).toContain("native: rejected — no native realization present");
  });

  it("rejects a non-object resolution", () => {
    const error = captureExperienceError(() =>
      buildPlaybackSession(null as unknown as ReturnType<typeof okResolution>, "user-1", VALID_SESSION_ID, 0, new FixedClock()),
    );
    expect(error.details).toContain("resolution: expected a SurfaceResolution object");
  });

  it("rejects a non-canonical session id", () => {
    const resolution = okResolution();
    if (!resolution.ok) return;
    for (const badId of ["", "nope", "wfxitm_00000000000000000000000001", "wfxpses_short"]) {
      const error = captureExperienceError(() =>
        buildPlaybackSession(resolution, "user-1", badId, 0, new FixedClock()),
      );
      expect(error.details.join("\n")).toContain("sessionId:");
    }
  });

  it("rejects an empty userId", () => {
    const resolution = okResolution();
    if (!resolution.ok) return;
    const error = captureExperienceError(() =>
      buildPlaybackSession(resolution, "  ", VALID_SESSION_ID, 0, new FixedClock()),
    );
    expect(error.details.join("\n")).toContain("userId:");
  });

  it("rejects a negative or non-finite resumePositionMs", () => {
    const resolution = okResolution();
    if (!resolution.ok) return;
    for (const bad of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const error = captureExperienceError(() =>
        buildPlaybackSession(resolution, "user-1", VALID_SESSION_ID, bad, new FixedClock()),
      );
      expect(error.details.join("\n")).toContain("resumePositionMs:");
    }
  });

  it("rejects a resolution whose mode contradicts the chosen realization", () => {
    const resolution = okResolution();
    if (!resolution.ok) return;
    const forged = { ...resolution, mode: "native" as const, chosen: SURFACE_REALIZATION_EMBED };
    const error = captureExperienceError(() =>
      buildPlaybackSession(forged, "user-1", VALID_SESSION_ID, 0, new FixedClock()),
    );
    expect(error.details.join("\n")).toContain("resolution.mode: 'native' does not match the chosen realization's mode 'embed'");
  });

  it("rejects a broken clock (NaN / out-of-range / throwing)", () => {
    const resolution = okResolution();
    if (!resolution.ok) return;
    const nanClock = { now: () => Number.NaN };
    const error = captureExperienceError(() =>
      buildPlaybackSession(resolution, "user-1", VALID_SESSION_ID, 0, nanClock),
    );
    expect(error.details.join("\n")).toContain("clock.now():");

    const rangeClock = { now: () => Number.MAX_VALUE };
    const rangeError = captureExperienceError(() =>
      buildPlaybackSession(resolution, "user-1", VALID_SESSION_ID, 0, rangeClock),
    );
    expect(rangeError.details.join("\n")).toContain("clock.now():");

    const throwingClock = {
      now: () => {
        throw new Error("clock exploded");
      },
    };
    const throwError = captureExperienceError(() =>
      buildPlaybackSession(resolution, "user-1", VALID_SESSION_ID, 0, throwingClock),
    );
    expect(throwError.details.join("\n")).toContain("clock.now(): threw");
  });

  it("aggregates multiple problems into one typed throw", () => {
    const resolution = okResolution();
    if (!resolution.ok) return;
    const error = captureExperienceError(() =>
      buildPlaybackSession(resolution, "", "nope", -5, new FixedClock()),
    );
    expect(error.details.length).toBe(3); // userId + sessionId + resumePositionMs
  });
});

// ---------------------------------------------------------------------------
// Capability matrix — pure data, consistent with the resolver
// ---------------------------------------------------------------------------

describe("capabilityMatrix — pure data", () => {
  const rows = capabilityMatrix();

  it("has 16 rows: 4 profiles × 4 modes in deterministic order", () => {
    expect(rows).toHaveLength(16);
    expect(rows.map((row) => `${row.profile}:${row.mode}`)).toEqual([
      "tv-native:native", "tv-native:embed", "tv-native:browser", "tv-native:external",
      "desktop-full:native", "desktop-full:embed", "desktop-full:browser", "desktop-full:external",
      "mobile-restricted:native", "mobile-restricted:embed", "mobile-restricted:browser", "mobile-restricted:external",
      "kiosk-browser-only:native", "kiosk-browser-only:embed", "kiosk-browser-only:browser", "kiosk-browser-only:external",
    ]);
  });

  it("is pure — two calls return deeply equal rows", () => {
    expect(capabilityMatrix()).toEqual(capabilityMatrix());
  });

  it("deviceSupports agrees with WFX-002 canPlay for every row", () => {
    for (const row of rows) {
      const profile = SURFACE_DEVICE_PROFILES.find((entry) => entry.id === row.profile);
      expect(profile).toBeDefined();
      if (profile === undefined) continue;
      expect(row.deviceSupports).toBe(canPlay(profile.device, row.mode));
    }
  });

  it("carries the expected decisions for every (profile × mode) pair", () => {
    const expected: Readonly<Record<string, SurfaceMatrixDecision>> = {
      "tv-native:native": "chosen",
      "tv-native:embed": "rejected-device",
      "tv-native:browser": "rejected-device",
      "tv-native:external": "chosen",
      "desktop-full:native": "chosen",
      "desktop-full:embed": "chosen",
      "desktop-full:browser": "chosen",
      "desktop-full:external": "chosen",
      "mobile-restricted:native": "rejected-codecs",
      "mobile-restricted:embed": "chosen",
      "mobile-restricted:browser": "chosen",
      "mobile-restricted:external": "chosen",
      "kiosk-browser-only:native": "rejected-device",
      "kiosk-browser-only:embed": "rejected-device",
      "kiosk-browser-only:browser": "chosen",
      "kiosk-browser-only:external": "rejected-device",
    };
    for (const row of rows) {
      const key = `${row.profile}:${row.mode}`;
      const expectedDecision = expected[key];
      expect(expectedDecision).toBeDefined();
      if (expectedDecision === undefined) continue;
      expect(row.decision).toBe(expectedDecision);
    }
  });
});

describe("capabilityMatrix — consistency vs the resolver (no contradictions)", () => {
  const rows = capabilityMatrix();

  it("the resolver reproduces every matrix row for the canonical probe", () => {
    for (const row of rows) {
      const profile = SURFACE_DEVICE_PROFILES.find((entry) => entry.id === row.profile);
      expect(profile).toBeDefined();
      if (profile === undefined) continue;

      const request: SurfaceRequest = {
        item: SURFACE_REQUEST_ALL_MODES_DESKTOP.item,
        realizations: [{ ...SURFACE_MATRIX_PROBES[row.mode] }],
        device: profile.device,
        permissions: SURFACE_PERMISSIONS_PERMISSIVE,
        now: SURFACE_NOW,
      };
      const resolution = resolveSurface(request);

      if (row.decision === "chosen") {
        expect(resolution.ok).toBe(true);
        if (!resolution.ok) return;
        expect(resolution.mode).toBe(row.mode);
        expect(resolution.chosen).toEqual(SURFACE_MATRIX_PROBES[row.mode]);
        expect(resolution.precedenceTrace.join("\n")).toContain(`${row.mode}: accepted`);
      } else {
        expect(resolution.ok).toBe(false);
        if (resolution.ok) return;
        expect(resolution.kind).toBe("unresolvable");
        const joined = resolution.reasons.join("\n");
        if (row.decision === "rejected-device") {
          expect(joined).toContain(`${row.mode}: rejected — device cannot realize ${row.mode} playback`);
        } else {
          expect(joined).toContain(`${row.mode}: rejected — no decodable native realization`);
          expect(joined).toContain("not decodable by device codecs");
        }
      }
    }
  });
});
