/**
 * @wfx/experience — in-app browser surface tests (WFX-026, Lane C).
 *
 * Coverage required by the dispatch packet:
 * - FSM: legal-path golden sequence; illegal transitions typed-rejected.
 * - Isolation: file / private-IP / non-allowlisted URLs -> typed refusals;
 *   allowlisted https -> ok (pure URL/IP parsing — no network).
 * - Provider handoff: outbound click OBSERVED + recorded, never blocked.
 * - Shell persistence across navigation (chrome state + resume heartbeat).
 * - Fixture host: scripted navigation sequence drives the FSM end-to-end.
 * - Cookie-isolation contract present in EVERY open() call options.
 */

import { describe, expect, it } from "bun:test";

import {
  BROWSER_SESSION_STATES,
  BROWSER_SESSION_TRANSITIONS,
  BrowserSurfaceSession,
  ExperienceError,
  FixedClock,
  assertBrowserSessionTransition,
  assertValidIsolationPolicy,
  assertValidIsolationPolicies,
  assertValidShellAction,
  canTransitionBrowserSession,
  createBrowserSurface,
  createFixtureBrowserHost,
  initialShellState,
  isolationVerdict,
  isPrivateNetworkHost,
  policyForConnector,
  reduceShellState,
  validateAgainstIsolationPolicy,
  type BrowserHost,
  type BrowserSessionState,
  type BrowserSurfaceTarget,
  type IsolationPolicy,
  type IsolationRefusalReason,
  type ProviderHandoffEvent,
  type ProviderIsolationPolicies,
  type ScriptedNavigation,
  type ShellAction,
  type SurfaceShellState,
} from "../src/index";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** The frozen-architecture fixture instant (same as the WFX-025 fixtures). */
const T0 = Date.parse("2026-09-13T00:00:00.000Z");

/** The provider connector under test and its origin allow-list. */
const PROVIDER_CONNECTOR_ID = "provider-fixture";

const PROVIDER_POLICY: IsolationPolicy = {
  allowedDomains: ["provider.example"],
  blockFileUrls: true,
  blockPrivateNetworks: true,
  restrictCookies: "isolate",
};

const POLICIES: ProviderIsolationPolicies = {
  [PROVIDER_CONNECTOR_ID]: PROVIDER_POLICY,
};

/** The canonical target: one browser-mode realization of one playback session. */
const TARGET: BrowserSurfaceTarget = {
  url: "https://provider.example/watch/movie-1",
  connectorId: PROVIDER_CONNECTOR_ID,
  playbackSessionId: "wfxpses_00000000000000000000000001",
};

/** A second canonical playback-session id (for the identity-switch rejection). */
const OTHER_SESSION_ID = "wfxpses_00000000000000000000000002";

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

/** Assert a typed refusal with a reason (the packet's "typed isolated-refused"). */
function expectRefused(url: string, reason: IsolationRefusalReason): void {
  const verdict = isolationVerdict(url, PROVIDER_CONNECTOR_ID, POLICIES);
  expect(verdict.ok).toBe(false);
  if (verdict.ok) return;
  expect(verdict.kind).toBe("isolated-refused");
  expect(verdict.reason).toBe(reason);
}

// ---------------------------------------------------------------------------
// The FSM — frozen transition table (pure)
// ---------------------------------------------------------------------------

describe("browser session FSM — the frozen transition table", () => {
  const EXPECTED: Record<BrowserSessionState, readonly BrowserSessionState[]> = {
    closed: ["opening"],
    opening: ["ready", "closed"],
    ready: ["navigating", "closed"],
    navigating: ["ready", "closed"],
  };

  it("the table itself is the frozen lifecycle (close legal from every non-closed state)", () => {
    expect(BROWSER_SESSION_TRANSITIONS).toEqual(EXPECTED);
  });

  it("every (from, to) pair agrees with the table", () => {
    for (const from of BROWSER_SESSION_STATES) {
      for (const to of BROWSER_SESSION_STATES) {
        const legal = EXPECTED[from].includes(to);
        expect(canTransitionBrowserSession(from, to)).toBe(legal);
        if (legal) {
          assertBrowserSessionTransition(from, to); // must not throw
        } else {
          const error = captureExperienceError(() =>
            assertBrowserSessionTransition(from, to),
          );
          expect(error.message).toContain("illegal browser surface session transition");
          expect(error.message).toContain(`'${from}' -> '${to}'`);
        }
      }
    }
  });

  it("rejects non-state inputs with the typed misuse error", () => {
    const error = captureExperienceError(() =>
      assertBrowserSessionTransition("ready", "exploded" as BrowserSessionState),
    );
    expect(error.message).toContain("expected one of");
  });
});

// ---------------------------------------------------------------------------
// The FSM — golden sequence + typed rejections (session level)
// ---------------------------------------------------------------------------

describe("browser session FSM — golden sequence", () => {
  it("closed -> opening -> ready -> navigating -> ready -> ... -> closed", () => {
    const session = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    expect(session.state).toBe("closed");
    expect(session.stateHistory).toEqual(["closed"]);

    session.beginOpen(TARGET);
    expect(session.state).toBe("opening");
    expect(session.targetUrl).toBe(TARGET.url);
    expect(session.providerHost).toBe("provider.example");
    expect(session.identity).toEqual({
      playbackSessionId: TARGET.playbackSessionId,
      connectorId: TARGET.connectorId,
    });

    session.completeOpen({ id: "host-1", url: TARGET.url });
    expect(session.state).toBe("ready");
    expect(session.handleId).toBe("host-1");
    expect(session.currentUrl).toBe(TARGET.url);

    session.observeNavigation("https://provider.example/watch/movie-1?resume=1");
    expect(session.state).toBe("navigating");
    session.settleNavigation();
    expect(session.state).toBe("ready");

    session.observeNavigation("https://provider.example/watch/movie-1/ep2");
    session.settleNavigation();
    expect(session.state).toBe("ready");

    session.close();
    expect(session.state).toBe("closed");

    // The exact golden sequence — the `navigating` phase is observable in history.
    expect(session.stateHistory).toEqual([
      "closed",
      "opening",
      "ready",
      "navigating",
      "ready",
      "navigating",
      "ready",
      "closed",
    ]);
    // Every consecutive pair of the history is a legal transition.
    const history = session.stateHistory;
    for (let index = 0; index + 1 < history.length; index += 1) {
      const from = history[index];
      const to = history[index + 1];
      if (from === undefined || to === undefined) continue;
      expect(canTransitionBrowserSession(from, to)).toBe(true);
    }
    // The trail records the open, both navigations, and the close.
    expect(session.trail.map((entry) => entry.kind)).toEqual([
      "opened",
      "navigation",
      "navigation",
      "closed",
    ]);
  });

  it("close is legal from opening, ready, AND navigating", () => {
    // from opening
    const a = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    a.beginOpen(TARGET);
    a.close();
    expect(a.state).toBe("closed");

    // from ready
    const b = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    b.beginOpen(TARGET);
    b.completeOpen({ id: "h", url: TARGET.url });
    b.close();
    expect(b.state).toBe("closed");

    // from navigating (user dismisses the surface mid-navigation)
    const c = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    c.beginOpen(TARGET);
    c.completeOpen({ id: "h", url: TARGET.url });
    c.observeNavigation("https://provider.example/next");
    expect(c.state).toBe("navigating");
    c.close();
    expect(c.state).toBe("closed");
  });

  it("a failing host open aborts back to closed and records the reason", () => {
    const session = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    session.beginOpen(TARGET);
    session.abortOpen("Error: webview unavailable");
    expect(session.state).toBe("closed");
    expect(session.trail).toHaveLength(1);
    expect(session.trail[0]).toEqual({
      kind: "open-aborted",
      url: TARGET.url,
      reason: "Error: webview unavailable",
      occurredAt: new Date(T0).toISOString(),
    });
  });

  it("a re-open persists the identity (same playback session)", () => {
    const session = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h1", url: TARGET.url });
    session.close();
    session.beginOpen(TARGET); // same identity — legal
    session.completeOpen({ id: "h2", url: TARGET.url });
    expect(session.state).toBe("ready");
    expect(session.trail.map((entry) => entry.kind)).toEqual([
      "opened",
      "closed",
      "opened",
    ]);
  });
});

describe("browser session FSM — illegal transitions are typed-rejected", () => {
  it("rejects every illegal method call with the typed ExperienceError", () => {
    const session = new BrowserSurfaceSession({ clock: new FixedClock(T0) });

    // from closed
    let error = captureExperienceError(() => session.settleNavigation());
    expect(error.message).toContain("settleNavigation: session is 'closed'");
    error = captureExperienceError(() => session.observeNavigation("https://provider.example/x"));
    expect(error.message).toContain("observeNavigation: session is 'closed'");
    error = captureExperienceError(() => session.completeOpen({ id: "h", url: TARGET.url }));
    expect(error.message).toContain("completeOpen: session is 'closed'");
    error = captureExperienceError(() => session.close());
    expect(error.message).toContain("close: session is already 'closed'");
    error = captureExperienceError(() => session.abortOpen("nope"));
    expect(error.message).toContain("abortOpen: session is 'closed'");

    // legal open first, then from ready
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });
    error = captureExperienceError(() => session.beginOpen(TARGET));
    expect(error.message).toContain("beginOpen: session is 'ready'");
    error = captureExperienceError(() => session.settleNavigation());
    expect(error.message).toContain("settleNavigation: session is 'ready'");
    error = captureExperienceError(() => session.abortOpen("nope"));
    expect(error.message).toContain("abortOpen: session is 'ready'");

    // from opening
    session.close();
    session.beginOpen(TARGET);
    error = captureExperienceError(() => session.observeNavigation("https://provider.example/x"));
    expect(error.message).toContain("observeNavigation: session is 'opening'");
    error = captureExperienceError(() => session.settleNavigation());
    expect(error.message).toContain("settleNavigation: session is 'opening'");

    // from navigating
    session.completeOpen({ id: "h2", url: TARGET.url });
    session.observeNavigation("https://provider.example/x");
    error = captureExperienceError(() => session.observeNavigation("https://provider.example/y"));
    expect(error.message).toContain("observeNavigation: session is 'navigating'");
    error = captureExperienceError(() => session.beginOpen(TARGET));
    expect(error.message).toContain("beginOpen: session is 'navigating'");
  });

  it("a malformed navigation is rejected and leaves the session in ready (validate before mutate)", () => {
    const session = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });
    const error = captureExperienceError(() => session.observeNavigation("not a url"));
    expect(error.message).toContain("host contract violation");
    expect(session.state).toBe("ready"); // untouched
    session.observeNavigation("https://provider.example/fine"); // still works
    session.settleNavigation();
    expect(session.state).toBe("ready");
  });

  it("rejects malformed targets, handles, constructor deps, and identity switches", () => {
    const clock = new FixedClock(T0);

    let error = captureExperienceError(() => new BrowserSurfaceSession({ clock: {} as never }));
    expect(error.message).toContain("deps.clock");

    error = captureExperienceError(() =>
      new BrowserSurfaceSession({
        clock,
        onProviderHandoff: "not-a-function" as unknown as () => void,
      }),
    );
    expect(error.message).toContain("deps.onProviderHandoff");

    const session = new BrowserSurfaceSession({ clock });
    error = captureExperienceError(() =>
      session.beginOpen({ ...TARGET, playbackSessionId: "not-a-canonical-id" }),
    );
    expect(error.message).toContain("target.playbackSessionId");
    error = captureExperienceError(() =>
      session.beginOpen({ ...TARGET, connectorId: "  " }),
    );
    expect(error.message).toContain("target.connectorId");
    error = captureExperienceError(() =>
      session.beginOpen({ ...TARGET, url: "file:///etc/passwd" }),
    );
    expect(error.message).toContain("target.url");

    session.beginOpen(TARGET);
    error = captureExperienceError(() =>
      session.completeOpen({ id: "", url: TARGET.url } as unknown as never),
    );
    expect(error.message).toContain("completeOpen.handle");
    session.completeOpen({ id: "h", url: TARGET.url });
    session.close();

    // identity persistence: a different playback session is a different surface
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h2", url: TARGET.url });
    session.close();
    error = captureExperienceError(() =>
      session.beginOpen({ ...TARGET, playbackSessionId: OTHER_SESSION_ID }),
    );
    expect(error.message).toContain("cannot switch playback sessions");
    error = captureExperienceError(() =>
      session.beginOpen({ ...TARGET, connectorId: "other-connector" }),
    );
    expect(error.message).toContain("cannot switch connectors");
  });
});

// ---------------------------------------------------------------------------
// Isolation policy — pure URL/IP validation (no network)
// ---------------------------------------------------------------------------

describe("isolation policy — allowlisted web URLs pass", () => {
  it("accepts the allowlisted https realization URL", () => {
    const verdict = isolationVerdict(TARGET.url, PROVIDER_CONNECTOR_ID, POLICIES);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.host).toBe("provider.example");
    expect(verdict.policy).toEqual(PROVIDER_POLICY);
  });

  it("accepts subdomains of an allowlisted domain (label-boundary suffix)", () => {
    expect(isolationVerdict("https://watch.provider.example/1", PROVIDER_CONNECTOR_ID, POLICIES).ok).toBe(true);
    expect(isolationVerdict("https://PROVIDER.example:8443/watch", PROVIDER_CONNECTOR_ID, POLICIES).ok).toBe(true);
  });
});

describe("isolation policy — typed refusals (file / private networks / domains)", () => {
  it("rejects file:// URLs with the typed file-url-blocked reason", () => {
    expectRefused("file:///etc/passwd", "file-url-blocked");
    expectRefused("file://localhost/etc/hosts", "file-url-blocked");
  });

  it("rejects private/loopback IPv4 literals — the pure SSRF guard", () => {
    expectRefused("http://127.0.0.1/x", "private-network-blocked");
    expectRefused("http://127.0.0.1:9000/x", "private-network-blocked");
    expectRefused("http://10.0.0.1/", "private-network-blocked");
    expectRefused("http://172.16.0.9/", "private-network-blocked");
    expectRefused("http://172.31.255.255/", "private-network-blocked");
    expectRefused("http://192.168.1.1/", "private-network-blocked");
    expectRefused("http://169.254.169.254/latest/meta-data", "private-network-blocked");
    expectRefused("http://0.0.0.0/", "private-network-blocked");
    expectRefused("http://100.64.0.1/", "private-network-blocked");
    expectRefused("http://240.0.0.1/", "private-network-blocked");
    // WHATWG-normalized exotic spellings of loopback — still blocked
    expectRefused("http://2130706433/", "private-network-blocked");
    expectRefused("http://0x7f.1/", "private-network-blocked");
    expectRefused("http://0177.0.0.1/", "private-network-blocked");
    expectRefused("http://127.1/", "private-network-blocked");
  });

  it("rejects private/loopback IPv6 literals, including embedded-IPv4 forms", () => {
    expectRefused("http://[::1]/x", "private-network-blocked");
    expectRefused("http://[::]/x", "private-network-blocked");
    expectRefused("http://[fe80::1]/x", "private-network-blocked");
    expectRefused("http://[fc00::1]/x", "private-network-blocked");
    expectRefused("http://[fd12::1]/x", "private-network-blocked");
    expectRefused("http://[ff02::1]/x", "private-network-blocked");
    expectRefused("http://[2001:db8::1]/x", "private-network-blocked");
    expectRefused("http://[::ffff:127.0.0.1]/x", "private-network-blocked");
    expectRefused("http://[::ffff:7f00:1]/x", "private-network-blocked");
    expectRefused("http://[64:ff9b::127.0.0.1]/x", "private-network-blocked");
    expectRefused("http://[2002:7f00:1::]/x", "private-network-blocked");
  });

  it("rejects localhost by name (spec-reserved loopback, no DNS needed)", () => {
    expectRefused("http://localhost:3000/x", "private-network-blocked");
    expectRefused("http://app.localhost/x", "private-network-blocked");
  });

  it("172.32.0.1 is PUBLIC (outside 172.16/12) — refused by the allow-list instead", () => {
    expectRefused("http://172.32.0.1/", "domain-not-allowed");
  });

  it("rejects non-allowlisted domains with the typed domain-not-allowed reason", () => {
    expectRefused("https://other.example/watch/1", "domain-not-allowed");
    expectRefused("https://evilprovider.example/", "domain-not-allowed"); // suffix, NOT label boundary
    expectRefused("https://provider.example.evil.com/", "domain-not-allowed");
    expectRefused("http://8.8.8.8/", "domain-not-allowed"); // public IP literal, not allow-listed
  });

  it("rejects non-web schemes and malformed URLs with typed reasons", () => {
    expectRefused("ftp://provider.example/", "unsupported-scheme");
    expectRefused("javascript:alert(1)", "unsupported-scheme");
    expectRefused("not a url", "malformed-url");
    expectRefused("", "malformed-url");
  });

  it("refuses connectors without a policy entry — fail closed", () => {
    const verdict = isolationVerdict("https://provider.example/", "unknown-connector", POLICIES);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("no-policy");
    expect(verdict.detail).toContain("fail-closed");
  });

  it("the SSRF guard fires BEFORE the allow-list (private literals never open)", () => {
    // even a (mis)configured allow-list naming the private literal loses to the law
    const tricky: ProviderIsolationPolicies = {
      tricky: {
        allowedDomains: ["192.168.0.5"],
        blockFileUrls: true,
        blockPrivateNetworks: true,
        restrictCookies: "isolate",
      },
    };
    const verdict = isolationVerdict("https://192.168.0.5/x", "tricky", tricky);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("private-network-blocked");
  });

  it("isPrivateNetworkHost is a pure literal check (public hosts false, no DNS)", () => {
    expect(isPrivateNetworkHost("8.8.8.8")).toBe(false);
    expect(isPrivateNetworkHost("1.1.1.1")).toBe(false);
    expect(isPrivateNetworkHost("2606:4700::1111")).toBe(false);
    expect(isPrivateNetworkHost("provider.example")).toBe(false);
    expect(isPrivateNetworkHost("172.20.1.5")).toBe(true);
    expect(isPrivateNetworkHost("::1")).toBe(true);
    expect(isPrivateNetworkHost("")).toBe(false);
  });
});

describe("isolation policy — malformed policies are typed caller misuse", () => {
  it("rejects policies with wrong literal fields, bad domains, and bad maps", () => {
    let error = captureExperienceError(() =>
      assertValidIsolationPolicy(
        { ...PROVIDER_POLICY, blockFileUrls: false as unknown as true },
        "policy",
      ),
    );
    expect(error.message).toContain("blockFileUrls");

    error = captureExperienceError(() =>
      assertValidIsolationPolicy(
        { ...PROVIDER_POLICY, restrictCookies: "shared" as unknown as "isolate" },
        "policy",
      ),
    );
    expect(error.message).toContain("restrictCookies");

    for (const bad of ["https://provider.example", ".provider.example", "provider..example", "provider.example/", "-provider.example", ""]) {
      error = captureExperienceError(() =>
        assertValidIsolationPolicy({ ...PROVIDER_POLICY, allowedDomains: [bad] }, "policy"),
      );
      expect(error.message).toContain("allowedDomains");
    }

    error = captureExperienceError(() =>
      assertValidIsolationPolicies({ "": PROVIDER_POLICY }),
    );
    expect(error.message).toContain("connector ids must be non-empty");
  });

  it("looks up per-connector policies and validates through the direct entry point", () => {
    expect(policyForConnector(PROVIDER_CONNECTOR_ID, POLICIES)).toEqual(PROVIDER_POLICY);
    expect(policyForConnector("missing", POLICIES)).toBeUndefined();

    const verdict = validateAgainstIsolationPolicy("https://provider.example/x", PROVIDER_POLICY);
    expect(verdict.ok).toBe(true);

    const error = captureExperienceError(() =>
      validateAgainstIsolationPolicy("https://provider.example/x", { ...PROVIDER_POLICY, allowedDomains: "nope" as unknown as string[] }),
    );
    expect(error.message).toContain("allowedDomains");
  });
});

// ---------------------------------------------------------------------------
// Provider handoff — OBSERVED + recorded, NEVER blocked
// ---------------------------------------------------------------------------

describe("provider handoff — observed and recorded, never blocked", () => {
  it("same-host navigations stay in-surface (no handoff)", () => {
    const observed: ProviderHandoffEvent[] = [];
    const session = new BrowserSurfaceSession({
      clock: new FixedClock(T0),
      onProviderHandoff: (event) => observed.push(event),
    });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });

    session.observeNavigation("https://provider.example/watch/movie-1?resume=1");
    session.settleNavigation();

    expect(observed).toHaveLength(0);
    expect(session.handoffs).toHaveLength(0);
    expect(session.currentUrl).toBe("https://provider.example/watch/movie-1?resume=1");
    expect(session.trail).toHaveLength(2); // opened + navigation
    const navigation = session.trail[1];
    expect(navigation).toBeDefined();
    expect(navigation?.kind).toBe("navigation");
    if (navigation?.kind === "navigation") {
      expect(navigation.providerHandoff).toBe(false);
    }
  });

  it("an off-provider-host click is observed, recorded, and NEVER blocks the session", () => {
    const observed: ProviderHandoffEvent[] = [];
    const clock = new FixedClock(T0);
    const session = new BrowserSurfaceSession({
      clock,
      onProviderHandoff: (event) => observed.push(event),
    });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });
    clock.advance(5);

    session.observeNavigation("https://full.provider.example/premiere"); // the outbound click
    expect(session.state).toBe("navigating"); // the surface keeps going
    session.settleNavigation();

    // OBSERVED: the typed event reached the observer with the outbound URL
    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual({
      kind: "provider-handoff",
      playbackSessionId: TARGET.playbackSessionId,
      connectorId: TARGET.connectorId,
      fromUrl: TARGET.url,
      toUrl: "https://full.provider.example/premiere",
      toHost: "full.provider.example",
      occurredAt: new Date(T0 + 5).toISOString(),
    });
    // RECORDED: on the handoff list and flagged on the trail
    expect(session.handoffs).toEqual(observed);
    const navigation = session.trail[1];
    expect(navigation?.kind).toBe("navigation");
    if (navigation?.kind === "navigation") {
      expect(navigation.providerHandoff).toBe(true);
    }
    // NEVER BLOCKED: the session completed the navigation and continued
    expect(session.state).toBe("ready");
    expect(session.currentUrl).toBe("https://full.provider.example/premiere");

    // and the next in-surface navigation is still ordinary
    session.observeNavigation("https://provider.example/watch/movie-1");
    session.settleNavigation();
    expect(session.state).toBe("ready");
    expect(session.handoffs).toHaveLength(1); // no new handoff
  });
});

// ---------------------------------------------------------------------------
// The persistent shell — survives navigation (chrome + resume heartbeat)
// ---------------------------------------------------------------------------

describe("persistent shell — survives navigation", () => {
  it("chrome state and resume heartbeat persist across navigations", () => {
    const clock = new FixedClock(T0);
    const session = new BrowserSurfaceSession({ clock });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });
    expect(session.shell).toEqual(initialShellState(T0));

    session.applyShell({ kind: "minimize" });
    clock.advance(1);
    session.heartbeat(61_234);
    expect(session.shell.chrome).toBe("compact");
    expect(session.shell.heartbeat).toEqual({ resumePositionMs: 61_234, atMs: T0 + 1 });

    for (const url of [
      "https://provider.example/watch/movie-1?resume=1",
      "https://provider.example/watch/movie-1/ep2",
      "https://full.provider.example/premiere", // a handoff does NOT reset the shelf either
    ]) {
      session.observeNavigation(url);
      session.settleNavigation();
      expect(session.shell.chrome).toBe("compact");
      expect(session.shell.heartbeat.resumePositionMs).toBe(61_234);
    }
  });

  it("the shelf outlives the session close — readable for resume, still reducible", () => {
    const clock = new FixedClock(T0);
    const session = new BrowserSurfaceSession({ clock });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });
    session.applyShell({ kind: "back-to-feed" });
    session.heartbeat(120_000);
    session.close();
    expect(session.state).toBe("closed");

    expect(session.shell.chrome).toBe("hidden");
    expect(session.shell.heartbeat.resumePositionMs).toBe(120_000); // the resume payload
    session.heartbeat(125_000); // the shelf is still the app's to update
    expect(session.shell.heartbeat.resumePositionMs).toBe(125_000);
  });

  it("a closed shell is terminal: no further actions, no re-open", () => {
    const session = new BrowserSurfaceSession({ clock: new FixedClock(T0) });
    session.beginOpen(TARGET);
    session.completeOpen({ id: "h", url: TARGET.url });
    session.applyShell({ kind: "close" });
    expect(session.shell.closed).toBe(true);

    let error = captureExperienceError(() => session.applyShell({ kind: "minimize" }));
    expect(error.message).toContain("shell is closed");

    session.close();
    error = captureExperienceError(() => session.beginOpen(TARGET));
    expect(error.message).toContain("shell is closed");
  });
});

describe("shell reducer — pure state + typed commands", () => {
  it("initial state is expanded chrome with a zero heartbeat", () => {
    expect(initialShellState(T0)).toEqual({
      chrome: "expanded",
      heartbeat: { resumePositionMs: 0, atMs: T0 },
      closed: false,
    });
  });

  it("the typed commands do exactly what they say", () => {
    const start = initialShellState(T0);
    expect(reduceShellState(start, { kind: "minimize" }).chrome).toBe("compact");
    expect(reduceShellState(start, { kind: "back-to-feed" }).chrome).toBe("hidden");
    expect(reduceShellState(start, { kind: "set-chrome", chrome: "compact" }).chrome).toBe("compact");

    const beaten = reduceShellState(start, { kind: "heartbeat", resumePositionMs: 9_000, atMs: T0 + 2 });
    expect(beaten.heartbeat).toEqual({ resumePositionMs: 9_000, atMs: T0 + 2 });

    const closed = reduceShellState(beaten, { kind: "close" });
    expect(closed.closed).toBe(true);
    expect(closed.heartbeat).toEqual({ resumePositionMs: 9_000, atMs: T0 + 2 }); // kept for resume
  });

  it("invalid actions are typed caller misuse, never silent passes", () => {
    const start = initialShellState(T0);
    let error = captureExperienceError(() =>
      reduceShellState(start, { kind: "heartbeat", resumePositionMs: -1, atMs: T0 }),
    );
    expect(error.message).toContain("resumePositionMs");

    error = captureExperienceError(() =>
      reduceShellState(start, { kind: "set-chrome", chrome: "gigantic" as never }),
    );
    expect(error.message).toContain("action.chrome");

    error = captureExperienceError(() =>
      reduceShellState(start, { kind: "nope" } as unknown as ShellAction),
    );
    expect(error.message).toContain("action.kind");

    error = captureExperienceError(() => assertValidShellAction("nope" as unknown as ShellAction));
    expect(error.message).toContain("expected a ShellAction");
  });
});

// ---------------------------------------------------------------------------
// The fixture host — deterministic scripted navigations
// ---------------------------------------------------------------------------

describe("fixture browser host — the deterministic scripted seam", () => {
  it("assigns deterministic handle ids and records every open", () => {
    const host = createFixtureBrowserHost();
    const first = host.open("https://provider.example/a", { restrictCookies: "isolate" });
    const second = host.open("https://provider.example/b", { restrictCookies: "isolate" });
    expect(first.id).toBe("fixture-browser-1");
    expect(second.id).toBe("fixture-browser-2");
    expect(first.url).toBe("https://provider.example/a");
    expect(host.recordedOpens).toEqual([
      { url: "https://provider.example/a", options: { restrictCookies: "isolate" } },
      { url: "https://provider.example/b", options: { restrictCookies: "isolate" } },
    ]);
  });

  it("ENFORCES the cookie-isolation contract on every open (typed rejection otherwise)", () => {
    const host = createFixtureBrowserHost();
    const error = captureExperienceError(() =>
      host.open("https://provider.example/a", {} as unknown as never),
    );
    expect(error.message).toContain("restrictCookies");
    expect(error.message).toContain("not optional");
    expect(host.recordedOpens).toHaveLength(0);
  });

  it("delivers scripted navigations in strict order, to all listeners in registration order", () => {
    const script: readonly ScriptedNavigation[] = [
      { handleId: "fixture-browser-1", url: "https://provider.example/one" },
      { handleId: "fixture-browser-2", url: "https://provider.example/two" },
      { handleId: "fixture-browser-1", url: "https://provider.example/three" },
    ];
    const host = createFixtureBrowserHost(script);
    const seen: string[] = [];
    const first = host.open("https://provider.example/start", { restrictCookies: "isolate" });
    host.onNavigation(first, (navigation) => seen.push(`a:${navigation.url}`));
    host.onNavigation(first, (navigation) => seen.push(`b:${navigation.url}`));

    expect(host.deliverNextNavigation()?.url).toBe("https://provider.example/one");
    expect(seen).toEqual(["a:https://provider.example/one", "b:https://provider.example/one"]);

    // the second entry targets a handle that was never opened
    const error = captureExperienceError(() => host.deliverNextNavigation());
    expect(error.message).toContain("not an open fixture session");

    host.open("https://provider.example/second", { restrictCookies: "isolate" }); // fixture-browser-2
    expect(host.deliverNextNavigation()?.url).toBe("https://provider.example/two");
    expect(host.deliverNextNavigation()?.url).toBe("https://provider.example/three");
    expect(host.deliverNextNavigation()).toBeUndefined(); // script exhausted — clean no-op
  });

  it("close is exactly-once and stops navigation delivery", () => {
    const host = createFixtureBrowserHost([
      { handleId: "fixture-browser-1", url: "https://provider.example/late" },
    ]);
    const handle = host.open("https://provider.example/start", { restrictCookies: "isolate" });
    expect(host.isHandleOpen("fixture-browser-1")).toBe(true);
    host.close(handle);
    expect(host.isHandleOpen("fixture-browser-1")).toBe(false);
    expect(host.isHandleClosed("fixture-browser-1")).toBe(true);

    let error = captureExperienceError(() => host.close(handle));
    expect(error.message).toContain("not an open fixture session");
    error = captureExperienceError(() => host.deliverNextNavigation());
    expect(error.message).toContain("not an open fixture session");

    error = captureExperienceError(() =>
      host.onNavigation(handle, () => {}),
    );
    expect(error.message).toContain("not an open fixture session");
  });

  it("rejects malformed construction scripts and open arguments (typed)", () => {
    let error = captureExperienceError(() =>
      createFixtureBrowserHost([{ handleId: "", url: "https://x.example/" } as unknown as ScriptedNavigation]),
    );
    expect(error.message).toContain("handleId");
    error = captureExperienceError(() =>
      createFixtureBrowserHost([{ handleId: "h", url: 42 as unknown as string } as unknown as ScriptedNavigation]),
    );
    expect(error.message).toContain("url");
    error = captureExperienceError(() =>
      createFixtureBrowserHost("nope" as unknown as readonly ScriptedNavigation[]),
    );
    expect(error.message).toContain("navigationScript");
    error = captureExperienceError(() =>
      createFixtureBrowserHost().open("", { restrictCookies: "isolate" }),
    );
    expect(error.message).toContain("open.url");
  });
});

// ---------------------------------------------------------------------------
// The controller — isolation-first open flow (typed results)
// ---------------------------------------------------------------------------

describe("createBrowserSurface — the open flow", () => {
  it("opens an allowlisted target and reports the governing policy", () => {
    const host = createFixtureBrowserHost();
    const surface = createBrowserSurface({ host, isolation: POLICIES, clock: new FixedClock(T0) });
    const opened = surface.open(TARGET);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.handle.id).toBe("fixture-browser-1");
    expect(opened.host).toBe("provider.example");
    expect(opened.policy).toEqual(PROVIDER_POLICY);
    expect(surface.state).toBe("ready");
    expect(surface.session.identity).toEqual({
      playbackSessionId: TARGET.playbackSessionId,
      connectorId: TARGET.connectorId,
    });
  });

  it("isolation FIRST: a refused URL never reaches the host", () => {
    const host = createFixtureBrowserHost();
    const surface = createBrowserSurface({ host, isolation: POLICIES, clock: new FixedClock(T0) });
    const refused = surface.open({ ...TARGET, url: "https://evil.example/watch" });
    expect(refused.ok).toBe(false);
    if (refused.ok || refused.kind !== "isolated-refused") return;
    expect(refused.reason).toBe("domain-not-allowed");
    expect(surface.state).toBe("closed");
    expect(host.recordedOpens).toHaveLength(0); // the host was NEVER called
  });

  it("a throwing host open is a typed host-open-failed, session aborted to closed", () => {
    const throwingHost: BrowserHost = {
      open: () => {
        throw new Error("webview unavailable");
      },
      close: () => {},
      onNavigation: () => {},
    };
    const surface = createBrowserSurface({
      host: throwingHost,
      isolation: POLICIES,
      clock: new FixedClock(T0),
    });
    const failed = surface.open(TARGET);
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.kind).toBe("host-open-failed");
    expect(failed.detail).toContain("webview unavailable");
    expect(surface.state).toBe("closed");
    expect(surface.trail.map((entry) => entry.kind)).toEqual(["open-aborted"]);
  });

  it("caller misuse is typed: double open, close when closed, malformed deps", () => {
    const host = createFixtureBrowserHost();
    const surface = createBrowserSurface({ host, isolation: POLICIES, clock: new FixedClock(T0) });
    surface.open(TARGET);
    let error = captureExperienceError(() => surface.open(TARGET));
    expect(error.message).toContain("close it before opening again");
    surface.close();
    error = captureExperienceError(() => surface.close());
    expect(error.message).toContain("already 'closed'");

    error = captureExperienceError(() =>
      createBrowserSurface({ host: {} as unknown as BrowserHost, isolation: POLICIES, clock: new FixedClock(T0) }),
    );
    expect(error.message).toContain("deps.host");

    error = captureExperienceError(() =>
      createBrowserSurface({ host, isolation: POLICIES, clock: "nope" as unknown as never }),
    );
    expect(error.message).toContain("deps.clock");

    error = captureExperienceError(() =>
      createBrowserSurface({
        host,
        isolation: { bad: { ...PROVIDER_POLICY, allowedDomains: ["not a domain"] } },
        clock: new FixedClock(T0),
      }),
    );
    expect(error.message).toContain("allowedDomains");
  });

  it("a closed shell refuses further opens (terminal shelf, new surface required)", () => {
    const host = createFixtureBrowserHost();
    const surface = createBrowserSurface({ host, isolation: POLICIES, clock: new FixedClock(T0) });
    surface.open(TARGET);
    surface.shell({ kind: "close" });
    surface.close();
    const error = captureExperienceError(() => surface.open(TARGET));
    expect(error.message).toContain("shell is closed");
  });

  it("evaluate is a typed optional capability — unsupported when the host lacks it", async () => {
    // the fixture host does not implement evaluate — capability truth
    const fixtureSurface = createBrowserSurface({
      host: createFixtureBrowserHost(),
      isolation: POLICIES,
      clock: new FixedClock(T0),
    });
    // no open session yet: the async precondition rejects with the typed error
    try {
      await fixtureSurface.evaluate("1+1");
      throw new Error("expected evaluate to reject before open()");
    } catch (thrown) {
      if (!(thrown instanceof ExperienceError)) {
        throw new Error(`expected ExperienceError, got ${String(thrown)}`);
      }
      expect(thrown.message).toContain("no open browser session");
    }

    fixtureSurface.open(TARGET);
    const unsupported = await fixtureSurface.evaluate("1+1");
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) return;
    expect(unsupported.kind).toBe("unsupported");
    expect(unsupported.detail).toContain("does not provide script evaluation");

    // a host that DOES provide evaluate gets the typed success path
    const inner = createFixtureBrowserHost();
    const evalHost: BrowserHost = {
      open: (url, options) => inner.open(url, options),
      close: (handle) => inner.close(handle),
      onNavigation: (handle, cb) => inner.onNavigation(handle, cb),
      evaluate: async (_handle, script) => `evaluated:${script}`,
    };
    const surface = createBrowserSurface({
      host: evalHost,
      isolation: POLICIES,
      clock: new FixedClock(T0),
    });
    surface.open(TARGET);
    const evaluated = await surface.evaluate("1+1");
    expect(evaluated).toEqual({ ok: true, value: "evaluated:1+1" });
  });
});

// ---------------------------------------------------------------------------
// The controller — scripted navigation drives the FSM end-to-end
// ---------------------------------------------------------------------------

describe("createBrowserSurface — the scripted end-to-end", () => {
  it("the fixture host script drives the FSM, handoffs, and the shelf", () => {
    const clock = new FixedClock(T0);
    const script: readonly ScriptedNavigation[] = [
      { handleId: "fixture-browser-1", url: "https://provider.example/watch/movie-1?resume=1" },
      { handleId: "fixture-browser-1", url: "https://full.provider.example/premiere" }, // handoff
      { handleId: "fixture-browser-1", url: "https://provider.example/watch/movie-1" }, // back in-surface
    ];
    const host = createFixtureBrowserHost(script);
    const handoffs: ProviderHandoffEvent[] = [];
    const surface = createBrowserSurface({
      host,
      isolation: POLICIES,
      clock,
      onProviderHandoff: (event) => handoffs.push(event),
    });

    // open
    const opened = surface.open(TARGET);
    expect(opened.ok).toBe(true);
    expect(surface.state).toBe("ready");
    expect(surface.session.stateHistory).toEqual(["closed", "opening", "ready"]);

    // shelf mutations BEFORE navigating
    surface.shell({ kind: "minimize" });
    clock.advance(1);
    surface.heartbeat(61_234);
    expect(surface.shellState).toEqual({
      chrome: "compact",
      heartbeat: { resumePositionMs: 61_234, atMs: T0 + 1 },
      closed: false,
    });

    // scripted navigation 1 — in-surface
    expect(host.deliverNextNavigation()?.url).toBe("https://provider.example/watch/movie-1?resume=1");
    expect(surface.state).toBe("ready"); // observed -> navigating -> ready, all inside the event
    expect(surface.session.currentUrl).toBe("https://provider.example/watch/movie-1?resume=1");
    expect(handoffs).toHaveLength(0);
    expect(surface.shellState.chrome).toBe("compact"); // the shelf SURVIVED
    expect(surface.shellState.heartbeat.resumePositionMs).toBe(61_234);

    // scripted navigation 2 — the provider handoff: observed + recorded, never blocked
    clock.advance(1);
    expect(host.deliverNextNavigation()?.url).toBe("https://full.provider.example/premiere");
    expect(surface.state).toBe("ready"); // NEVER blocked
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toEqual({
      kind: "provider-handoff",
      playbackSessionId: TARGET.playbackSessionId,
      connectorId: TARGET.connectorId,
      fromUrl: "https://provider.example/watch/movie-1?resume=1",
      toUrl: "https://full.provider.example/premiere",
      toHost: "full.provider.example",
      occurredAt: new Date(T0 + 2).toISOString(),
    });
    expect(surface.session.currentUrl).toBe("https://full.provider.example/premiere");

    // scripted navigation 3 — back in-surface, no new handoff
    expect(host.deliverNextNavigation()?.url).toBe("https://provider.example/watch/movie-1");
    expect(surface.state).toBe("ready");
    expect(handoffs).toHaveLength(1);

    // the golden state history through three navigations
    expect(surface.session.stateHistory).toEqual([
      "closed",
      "opening",
      "ready",
      "navigating",
      "ready",
      "navigating",
      "ready",
      "navigating",
      "ready",
    ]);
    // the trail: opened + 3 navigations (the handoff flagged)
    expect(surface.trail.map((entry) => entry.kind)).toEqual([
      "opened",
      "navigation",
      "navigation",
      "navigation",
    ]);
    const flagged = surface.trail.filter(
      (entry) => entry.kind === "navigation" && entry.providerHandoff,
    );
    expect(flagged).toHaveLength(1);

    // close: host first, FSM second — and the script can no longer deliver
    surface.close();
    expect(surface.state).toBe("closed");
    expect(host.isHandleClosed("fixture-browser-1")).toBe(true);
    expect(host.isHandleOpen("fixture-browser-1")).toBe(false);

    // re-open (same identity): a NEW host handle, the SAME persistent shelf
    const reopened = surface.open(TARGET);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.handle.id).toBe("fixture-browser-2");
    expect(surface.state).toBe("ready");
    expect(surface.shellState.chrome).toBe("compact");
    expect(surface.shellState.heartbeat.resumePositionMs).toBe(61_234); // resume data survived

    // the cookie-isolation contract is present in EVERY open() call options
    expect(host.recordedOpens).toHaveLength(2);
    for (const call of host.recordedOpens) {
      expect(call.options.restrictCookies).toBe("isolate");
      expect(call.options).toEqual({ restrictCookies: "isolate" });
    }

    // the script is exhausted
    expect(host.deliverNextNavigation()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The controller — surface snapshot typing (compile-time law, exercised once)
// ---------------------------------------------------------------------------

describe("createBrowserSurface — snapshot invariants", () => {
  it("exposes the session, shelf, trail, and handoffs read-only views", () => {
    const surface = createBrowserSurface({
      host: createFixtureBrowserHost(),
      isolation: POLICIES,
      clock: new FixedClock(T0),
    });
    const shellBefore: SurfaceShellState = surface.shellState;
    expect(shellBefore.closed).toBe(false);
    surface.open(TARGET);
    surface.shell({ kind: "back-to-feed" });
    surface.heartbeat(42);
    expect(surface.shellState.chrome).toBe("hidden");
    expect(surface.trail.length).toBeGreaterThanOrEqual(1);
    expect(surface.handoffs).toHaveLength(0);
    expect(surface.session).toBe(surface.session); // one stable session per controller
  });
});
