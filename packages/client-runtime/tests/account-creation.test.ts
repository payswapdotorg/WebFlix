/**
 * @wfx/client-runtime — R22-B account-creation journey tests.
 *
 * The F1 contract, at the shared seam:
 * - the typed register command + the shared validation (mirroring the
 *   SERVICE's own rules exactly — no invented client policy);
 * - the closed failure vocabulary, each with its recovery next action
 *   (`email-taken` ⇒ SIGN IN INSTEAD — the anti-loop law);
 * - the journey state machine over the EXISTING transport port: idle →
 *   creating → created (auto-login; profile selection stays DOWNSTREAM) /
 *   failed (typed);
 * - the secret law: the one-time token passes through the result ONCE;
 *   the model NEVER retains it (machine-checked);
 * - the session-view guard rejects password material (the privacy law).
 */

import { describe, expect, it } from "bun:test";

import {
  ACCOUNT_CREATION_FAILURE_KINDS,
  ACCOUNT_CREATION_NEXT_ACTION_VIEWS,
  ACCOUNT_CREATION_STATES,
  accountCreationFailure,
  assertAccountCreationModelSecretFree,
  createAccountCreationJourney,
  isAccountCreationFailureKind,
  isAccountCreationState,
  isUsableAccountSessionView,
  validateRegisterAccountCommand,
  type AccountRegistrationOutcome,
  type AccountRegistrationPort,
  type AccountSessionView,
  type IssuedAccountSession,
} from "../src/index";

const T0 = "2026-09-20T12:00:00.000Z";

/** A valid signed-in session view (the API's register answer shape). */
function sessionView(): AccountSessionView {
  return {
    user: {
      id: "wfxusr_01",
      email: "viewer@example.com",
      displayName: "viewer",
      createdAt: T0,
      updatedAt: T0,
    },
    profiles: [
      {
        id: "wfxprf_01",
        userId: "wfxusr_01",
        displayName: "Viewer",
        avatarSeed: "seed-1",
        isDefault: true,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    activeProfileId: "wfxprf_01",
  };
}

function issued(): IssuedAccountSession {
  return { token: "wfxsess_ONE_TIME_SECRET", session: sessionView() };
}

/** A port double (the EXISTING transport's typed seam — scripted, offline). */
function port(
  script: (command: { email: string; password: string; displayName?: string }) => Promise<AccountRegistrationOutcome>,
): AccountRegistrationPort & { calls: { email: string; password: string; displayName?: string }[] } {
  const calls: { email: string; password: string; displayName?: string }[] = [];
  return {
    calls,
    async register(command) {
      calls.push({ ...command });
      return script(command);
    },
  };
}

// ---------------------------------------------------------------------------
// The shared validation (mirrors the service's own rules)
// ---------------------------------------------------------------------------

describe("R22-B — the typed register command validation (the service's rules)", () => {
  it("accepts a valid command and normalizes it the way the service does", () => {
    const validation = validateRegisterAccountCommand({
      email: "  Viewer@Example.COM ",
      password: "a-long-enough-password",
      displayName: "  Viewer  ",
    });
    expect(validation).toEqual({
      ok: true,
      value: { email: "viewer@example.com", password: "a-long-enough-password", displayName: "Viewer" },
    });
  });

  it("accepts a valid command without a display name (the service defaults it)", () => {
    const validation = validateRegisterAccountCommand({
      email: "viewer@example.com",
      password: "a-long-enough-password",
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) expect("displayName" in validation.value).toBe(false);
  });

  it("rejects an invalid email with the typed per-field problem", () => {
    for (const email of ["not-an-email", "missing@tld", "a b@example.com", ""]) {
      const validation = validateRegisterAccountCommand({ email, password: "a-long-enough-password" });
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.problems[0]?.field).toBe("email");
      }
    }
  });

  it("rejects a too-short and a too-long password (the scrypt policy bounds)", () => {
    const short = validateRegisterAccountCommand({ email: "v@example.com", password: "short" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.problems[0]?.field).toBe("password");
    const long = validateRegisterAccountCommand({
      email: "v@example.com",
      password: "x".repeat(1_001),
    });
    expect(long.ok).toBe(false);
    const exact = validateRegisterAccountCommand({
      email: "v@example.com",
      password: "x".repeat(10),
    });
    expect(exact.ok).toBe(true);
  });

  it("rejects a blank or over-long display name with the typed problem", () => {
    const blank = validateRegisterAccountCommand({
      email: "v@example.com",
      password: "a-long-enough-password",
      displayName: "   ",
    });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.problems[0]?.field).toBe("displayName");
    const long = validateRegisterAccountCommand({
      email: "v@example.com",
      password: "a-long-enough-password",
      displayName: "x".repeat(129),
    });
    expect(long.ok).toBe(false);
  });

  it("collects EVERY problem (never one at a time)", () => {
    const validation = validateRegisterAccountCommand({ email: "nope", password: "short" });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.problems.map((problem) => problem.field)).toEqual(["email", "password"]);
    }
  });
});

// ---------------------------------------------------------------------------
// The typed failure vocabulary + recovery
// ---------------------------------------------------------------------------

describe("R22-B — the closed failure vocabulary with recovery next actions", () => {
  it("is exactly the frozen five kinds", () => {
    expect(ACCOUNT_CREATION_FAILURE_KINDS).toEqual([
      "invalid-input",
      "email-taken",
      "network",
      "unavailable",
      "malformed",
    ]);
    for (const kind of ACCOUNT_CREATION_FAILURE_KINDS) {
      expect(isAccountCreationFailureKind(kind)).toBe(true);
    }
    expect(isAccountCreationFailureKind("email-available")).toBe(false);
  });

  it("email-taken answers SIGN IN INSTEAD (the anti-loop law)", () => {
    const failure = accountCreationFailure("email-taken", "an account with this email already exists");
    expect(failure.recovery.kind).toBe("sign-in-instead");
    expect(failure.recovery.label).toBe("Sign in instead");
  });

  it("transport failures answer RETRY; validation answers FIX-AND-RETRY", () => {
    expect(accountCreationFailure("network", "offline").recovery.kind).toBe("retry");
    expect(accountCreationFailure("unavailable", "503").recovery.kind).toBe("retry");
    expect(accountCreationFailure("malformed", "garbage").recovery.kind).toBe("retry");
    expect(accountCreationFailure("invalid-input", "bad email").recovery.kind).toBe("fix-and-retry");
  });

  it("every recovery carries honest user vocabulary (no jargon)", () => {
    for (const kind of ACCOUNT_CREATION_FAILURE_KINDS) {
      const failure = accountCreationFailure(kind, "detail");
      expect(failure.recovery.label.length).toBeGreaterThan(0);
      expect(failure.recovery.detail.length).toBeGreaterThan(0);
      expect(/http|4\d\d|5\d\d|transport|token|scrypt/i.test(failure.recovery.label)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The journey state machine (over the EXISTING transport port)
// ---------------------------------------------------------------------------

describe("R22-B — the account-creation journey state machine", () => {
  it("starts idle with the provide-details next action", () => {
    const journey = createAccountCreationJourney(port(async () => ({ ok: true, value: issued() })));
    const model = journey.model();
    expect(model.state).toBe("idle");
    expect(model.nextAction.kind).toBe("provide-details");
    expect(model.nextAction.label).toBe("Create your account");
    expect(ACCOUNT_CREATION_STATES).toEqual(["idle", "creating", "created", "failed"]);
    expect(isAccountCreationState("creating")).toBe(true);
  });

  it("a successful create lands CREATED with the auto-logged-in session view; profile selection stays downstream", async () => {
    const journey = createAccountCreationJourney(port(async () => ({ ok: true, value: issued() })));
    const result = await journey.create({
      email: "viewer@example.com",
      password: "a-long-enough-password",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The one-time issuance passes through ONCE...
      expect(result.issued.token).toBe("wfxsess_ONE_TIME_SECRET");
      expect(result.issued.session.user.email).toBe("viewer@example.com");
    }
    const model = journey.model();
    expect(model.state).toBe("created");
    expect(model.session?.profiles).toHaveLength(1);
    expect(model.session?.activeProfileId).toBe("wfxprf_01");
    // ...and the NEXT ACTION names the downstream profile choice.
    expect(model.nextAction.kind).toBe("choose-profile");
    expect(model.nextAction.label).toBe("Choose your profile");
  });

  it("email-taken fails honestly with the sign-in-instead next action (no register loop)", async () => {
    const journey = createAccountCreationJourney(
      port(async () => ({
        ok: false,
        failure: accountCreationFailure("email-taken", "an account with this email already exists"),
      })),
    );
    const result = await journey.create({ email: "taken@example.com", password: "a-long-enough-password" });
    expect(result.ok).toBe(false);
    const model = journey.model();
    expect(model.state).toBe("failed");
    expect(model.failure?.kind).toBe("email-taken");
    expect(model.nextAction.kind).toBe("sign-in-instead");
  });

  it("an invalid command fails client-side with the per-field problems — the port is NOT called", async () => {
    const double = port(async () => ({ ok: true, value: issued() }));
    const journey = createAccountCreationJourney(double);
    const result = await journey.create({ email: "nope", password: "short" });
    expect(result.ok).toBe(false);
    expect(double.calls).toHaveLength(0);
    const model = journey.model();
    expect(model.state).toBe("failed");
    expect(model.failure?.kind).toBe("invalid-input");
    expect(model.problems?.map((problem) => problem.field)).toEqual(["email", "password"]);
    expect(model.nextAction.kind).toBe("fix-and-retry");
  });

  it("a transport failure is an honest failed model with retry", async () => {
    const journey = createAccountCreationJourney(
      port(async () => ({
        ok: false,
        failure: accountCreationFailure("network", "POST /auth/register did not complete"),
      })),
    );
    await journey.create({ email: "v@example.com", password: "a-long-enough-password" });
    const model = journey.model();
    expect(model.state).toBe("failed");
    expect(model.failure?.kind).toBe("network");
    expect(model.nextAction.kind).toBe("retry");
  });

  it("a duplicate submit while creating answers the in-flight model without a second port call", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const double = port(async () => {
      await gate;
      return { ok: true, value: issued() };
    });
    const journey = createAccountCreationJourney(double);
    const first = journey.create({ email: "v@example.com", password: "a-long-enough-password" });
    const inFlight = journey.model();
    expect(inFlight.state).toBe("creating");
    expect(inFlight.nextAction.kind).toBe("wait");
    const duplicate = await journey.create({
      email: "v@example.com",
      password: "a-long-enough-password",
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.model.state).toBe("creating");
    release();
    const settled = await first;
    expect(settled.ok).toBe(true);
    expect(double.calls).toHaveLength(1);
  });

  it("reset() returns the journey to idle (start over / dismiss the failure)", async () => {
    const journey = createAccountCreationJourney(
      port(async () => ({
        ok: false,
        failure: accountCreationFailure("email-taken", "an account with this email already exists"),
      })),
    );
    await journey.create({ email: "taken@example.com", password: "a-long-enough-password" });
    expect(journey.model().state).toBe("failed");
    const model = journey.reset();
    expect(model.state).toBe("idle");
    expect(model.nextAction.kind).toBe("provide-details");
    expect(journey.model().failure).toBeUndefined();
  });

  it("the sent command is the NORMALIZED one (the service's own normalization)", async () => {
    const double = port(async () => ({ ok: true, value: issued() }));
    const journey = createAccountCreationJourney(double);
    await journey.create({
      email: "  Viewer@Example.COM ",
      password: "a-long-enough-password",
      displayName: "  Viewer  ",
    });
    expect(double.calls[0]).toEqual({
      email: "viewer@example.com",
      password: "a-long-enough-password",
      displayName: "Viewer",
    });
  });
});

// ---------------------------------------------------------------------------
// The secret law + the session-view guard
// ---------------------------------------------------------------------------

describe("R22-B — the secret law + the session-view guard", () => {
  it("the model NEVER retains the one-time token or the password (machine-checked)", async () => {
    const journey = createAccountCreationJourney(port(async () => ({ ok: true, value: issued() })));
    const result = await journey.create({
      email: "viewer@example.com",
      password: "THE_PASSWORD_SECRET",
    });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(journey.model());
    expect(serialized.includes("wfxsess_ONE_TIME_SECRET")).toBe(false);
    expect(serialized.includes("THE_PASSWORD_SECRET")).toBe(false);
    expect(() => assertAccountCreationModelSecretFree(journey.model())).not.toThrow();
  });

  it("assertAccountCreationModelSecretFree throws on secret material (the machine check)", () => {
    const poisoned = {
      state: "created" as const,
      session: { ...sessionView(), token: "wfxsess_LEAKED" },
      nextAction: ACCOUNT_CREATION_NEXT_ACTION_VIEWS["choose-profile"],
    };
    expect(() => assertAccountCreationModelSecretFree(poisoned as never)).toThrow(/token/);
  });

  it("isUsableAccountSessionView accepts the real shape and rejects password material", () => {
    expect(isUsableAccountSessionView(sessionView())).toBe(true);
    const withHash = {
      ...sessionView(),
      user: { ...sessionView().user, passwordHash: "scrypt$..." },
    };
    expect(isUsableAccountSessionView(withHash)).toBe(false);
    const noProfiles = { ...sessionView(), profiles: [] };
    expect(isUsableAccountSessionView(noProfiles)).toBe(false);
    const orphanActive = { ...sessionView(), activeProfileId: "wfxprf_missing" };
    expect(isUsableAccountSessionView(orphanActive)).toBe(false);
  });
});
