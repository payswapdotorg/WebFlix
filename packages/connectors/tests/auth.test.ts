import { describe, expect, it } from "bun:test";
import { inspect } from "node:util";

import {
  AuthFlowValidationError,
  AuthServiceConfigError,
  AuthSession,
  AuthStateError,
  ConnectorAuthService,
  ConnectorRegistry,
  VaultValidationError,
  canTransition,
  createInMemoryVault,
  defineAuthFlow,
  defineDescriptor,
  flowFor,
  isUsable,
  type AuthError,
  type AuthResult,
  type AuthSessionState,
  type SecretHandle,
  type SecretKind,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const SECRET = "very-secret-oauth-token-do-not-log";

const NONE_DESC = defineDescriptor({
  id: "auth-none-source",
  version: "1.0.0",
  displayName: "None Auth Source",
  capabilities: ["catalogSearch"],
  auth: "none",
});

const OAUTH_DESC = defineDescriptor({
  id: "auth-oauth-source",
  version: "1.0.0",
  displayName: "OAuth Source",
  capabilities: ["catalogSearch"],
  auth: "oauth",
});

const DEVICE_DESC = defineDescriptor({
  id: "auth-device-source",
  version: "1.0.0",
  displayName: "Device Source",
  capabilities: ["catalogSearch"],
  auth: "device",
});

const LOCAL_DESC = defineDescriptor({
  id: "auth-local-source",
  version: "1.0.0",
  displayName: "Local Source",
  capabilities: ["catalogSearch"],
  auth: "local",
});

const OAUTH_FLOW_INPUT = {
  kind: "oauth",
  authorizationUrlTemplate:
    "https://auth.example.com/authorize?client_id={clientId}&redirect_uri={redirectUri}",
  scopes: ["read", "write"],
  tokenRefresh: true,
};

const DEVICE_FLOW_INPUT = {
  kind: "device",
  verificationUrlTemplate: "https://example.com/device?user_code={userCode}",
  pollIntervalSeconds: 5,
};

const LOCAL_USERPASS_FLOW_INPUT = { kind: "local", method: "userpass" };

type Ctx = Parameters<ConnectorAuthService["beginAuth"]>[0];

function makeCtx(): Ctx {
  return { userId: "user-42", locale: "en-US" };
}

function makeRegistry(): ConnectorRegistry {
  return new ConnectorRegistry()
    .register(NONE_DESC)
    .register(OAUTH_DESC)
    .register(DEVICE_DESC)
    .register(LOCAL_DESC);
}

function makeClock(start = 1_700_000_000_000): {
  now(): number;
  advance(ms: number): void;
} {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

interface ServiceOverrides {
  flows?: Record<string, unknown>;
  sessionTtlMs?: number;
  pendingTtlMs?: number;
  vault?: ReturnType<typeof createInMemoryVault>;
  clock?: () => number;
}

function makeAuthService(overrides: ServiceOverrides = {}): ConnectorAuthService {
  const options: import("../src/index").ConnectorAuthServiceOptions = {
    registry: makeRegistry(),
    flows:
      overrides.flows ??
      ({
        "auth-oauth-source": OAUTH_FLOW_INPUT,
        "auth-device-source": DEVICE_FLOW_INPUT,
      } as Record<string, unknown>),
    clock: overrides.clock ?? (() => 1_700_000_000_000),
  };
  if (overrides.vault !== undefined) options.vault = overrides.vault;
  if (overrides.sessionTtlMs !== undefined) options.sessionTtlMs = overrides.sessionTtlMs;
  if (overrides.pendingTtlMs !== undefined) options.pendingTtlMs = overrides.pendingTtlMs;
  return new ConnectorAuthService(options);
}

function expectOk<T>(result: AuthResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`expected an ok result, got error: ${JSON.stringify(result.error)}`);
}

function expectErr<T>(result: AuthResult<T>): AuthError {
  if (result.ok) throw new Error("expected an error result, got ok");
  return result.error;
}

// ---------------------------------------------------------------------------
// Vault — store / retrieve / delete / list
// ---------------------------------------------------------------------------

describe("createInMemoryVault — store / retrieve / delete / list", () => {
  it("store → retrieve returns the exact secret", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    expect(vault.retrieve(handle)).toBe(SECRET);
  });

  it("handles round-trip many secrets across connectors and kinds", () => {
    const vault = createInMemoryVault();
    const a = vault.store("connector-a", "local-token", "token-a");
    const b = vault.store("connector-a", "local-userpass", "pair-b");
    const c = vault.store("connector-b", "device-token", "token-c");
    expect(vault.retrieve(a)).toBe("token-a");
    expect(vault.retrieve(b)).toBe("pair-b");
    expect(vault.retrieve(c)).toBe("token-c");
  });

  it("retrieve returns null for an unknown handle (never stored here)", () => {
    const vault = createInMemoryVault();
    const foreign: SecretHandle = {
      connectorId: "auth-oauth-source",
      kind: "oauth-token",
      ref: "0000000000000000",
    };
    expect(vault.retrieve(foreign)).toBe(null);
    expect(vault.delete(foreign)).toBe(false);
  });

  it("handles from one vault are not valid in another (per-vault key and refs)", () => {
    const vaultA = createInMemoryVault();
    const vaultB = createInMemoryVault();
    const handle = vaultA.store("auth-oauth-source", "oauth-token", SECRET);
    expect(vaultB.retrieve(handle)).toBe(null);
    expect(vaultB.delete(handle)).toBe(false);
    expect(vaultA.retrieve(handle)).toBe(SECRET);
  });

  it("retrieve cross-checks handle metadata: a tampered kind or connectorId misses", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    const tamperedKind: SecretHandle = {
      connectorId: handle.connectorId,
      kind: "device-token",
      ref: handle.ref,
    };
    const tamperedConnector: SecretHandle = {
      connectorId: "auth-device-source",
      kind: "oauth-token",
      ref: handle.ref,
    };
    expect(vault.retrieve(tamperedKind)).toBe(null);
    expect(vault.retrieve(tamperedConnector)).toBe(null);
  });

  it("delete removes the secret, returns true once, and is idempotent (false after)", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    expect(vault.delete(handle)).toBe(true);
    expect(vault.retrieve(handle)).toBe(null);
    expect(vault.delete(handle)).toBe(false);
  });

  it("list scopes to one connector and reflects deletions", () => {
    const vault = createInMemoryVault();
    const a = vault.store("connector-a", "local-token", "token-a");
    const b = vault.store("connector-a", "local-userpass", "pair-b");
    vault.store("connector-b", "device-token", "token-c");

    const forA = vault.list("connector-a");
    expect(forA.length).toBe(2);
    expect(forA).toContain(a);
    expect(forA).toContain(b);
    expect(vault.list("connector-b").length).toBe(1);

    vault.delete(a);
    const afterDelete = vault.list("connector-a");
    expect(afterDelete.length).toBe(1);
    expect(afterDelete).toContain(b);
  });

  it("storing the same (connector, kind) twice keeps both entries (rotation is service-level)", () => {
    const vault = createInMemoryVault();
    const first = vault.store("auth-oauth-source", "oauth-token", "old");
    const second = vault.store("auth-oauth-source", "oauth-token", "new");
    expect(first.ref).not.toBe(second.ref);
    expect(vault.retrieve(first)).toBe("old");
    expect(vault.retrieve(second)).toBe("new");
    expect(vault.list("auth-oauth-source").length).toBe(2);
  });

  it("malformed inputs throw VaultValidationError", () => {
    const vault = createInMemoryVault();
    expect(() => vault.store("", "local-token", "s")).toThrow(VaultValidationError);
    expect(() => vault.store("   ", "local-token", "s")).toThrow(VaultValidationError);
    expect(() =>
      vault.store("c", "bogus-kind" as unknown as SecretKind, "s"),
    ).toThrow(VaultValidationError);
    expect(() => vault.store("c", "local-token", "")).toThrow(VaultValidationError);
    expect(() => vault.retrieve({} as unknown as SecretHandle)).toThrow(
      VaultValidationError,
    );
    expect(() => vault.delete(null as unknown as SecretHandle)).toThrow(
      VaultValidationError,
    );
    expect(() => vault.list("")).toThrow(VaultValidationError);
  });

  it("handles are frozen", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(() => {
      (handle as unknown as { ref: string }).ref = "tamper";
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Vault — handle opacity (secrets never in toString / JSON / inspect)
// ---------------------------------------------------------------------------

describe("createInMemoryVault — secret opacity (toString / JSON / inspect)", () => {
  it("JSON.stringify(handle) shows only the non-secret fields", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    const asJson = JSON.stringify(handle);
    expect(asJson).not.toContain(SECRET);
    expect(JSON.parse(asJson)).toEqual({
      connectorId: "auth-oauth-source",
      kind: "oauth-token",
      ref: handle.ref,
    });
  });

  it("String(handle) / template interpolation never contain the secret", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    expect(String(handle)).not.toContain(SECRET);
    expect(`${handle}`).not.toContain(SECRET);
    expect(`${handle} done`).not.toContain(SECRET);
  });

  it("util.inspect(handle) shows only the non-secret fields", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);
    const rendered = inspect(handle, { depth: 5 });
    expect(rendered).not.toContain(SECRET);
    expect(rendered).toContain(handle.ref);
    expect(rendered).toContain("oauth-token");
  });

  it("JSON.stringify(vault) is opaque (no secret, no entries)", () => {
    const vault = createInMemoryVault();
    vault.store("auth-oauth-source", "oauth-token", SECRET);
    expect(JSON.stringify(vault)).not.toContain(SECRET);
    expect(JSON.stringify(vault)).toBe("{}");
  });

  it("util.inspect(vault) is opaque — only method names, never the secret or key", () => {
    const vault = createInMemoryVault();
    vault.store("auth-oauth-source", "oauth-token", SECRET);
    const rendered = inspect(vault, { depth: 5 });
    expect(rendered).not.toContain(SECRET);
    expect(rendered).toContain("store");
    expect(rendered).toContain("retrieve");
  });
});

// ---------------------------------------------------------------------------
// Vault — delete zeroes the stored buffer
// ---------------------------------------------------------------------------

describe("createInMemoryVault — delete zeroes the stored buffer", () => {
  it("delete zeroes the obfuscated bytes in place (verifiable via the diagnostics surface)", () => {
    const vault = createInMemoryVault();
    const handle = vault.store("auth-oauth-source", "oauth-token", SECRET);

    const bytes = vault.obfuscatedBytesFor(handle);
    if (bytes === null) throw new Error("expected stored (obfuscated) bytes");
    expect(bytes.length).toBe(new TextEncoder().encode(SECRET).length);
    // Obfuscated, not plaintext: not the all-zero buffer, and not the secret either.
    expect(bytes.some((byte) => byte !== 0)).toBe(true);

    expect(vault.delete(handle)).toBe(true);

    // The same buffer object, referenced before delete, now reads all zeros.
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect(vault.retrieve(handle)).toBe(null);
    expect(vault.obfuscatedBytesFor(handle)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// AuthSession — legal transitions
// ---------------------------------------------------------------------------

describe("AuthSession — legal transitions", () => {
  it("starts signedOut with no expiry and no failure reason", () => {
    const session = new AuthSession();
    expect(session.state()).toBe<AuthSessionState>("signedOut");
    expect(session.expiresAt()).toBeUndefined();
    expect(session.failureReason()).toBeUndefined();
  });

  it("runs the canonical chain signedOut → authorizing → signedIn", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    expect(session.state()).toBe<AuthSessionState>("authorizing");
    session.transition("signedIn", { expiresAt: 2_000 });
    expect(session.state()).toBe<AuthSessionState>("signedIn");
    expect(session.expiresAt()).toBe(2_000);
  });

  it("authorizing → signedOut (abandon) and authorizing → failed (handshake failed)", () => {
    const abandoned = new AuthSession();
    abandoned.transition("authorizing");
    abandoned.transition("signedOut");
    expect(abandoned.state()).toBe<AuthSessionState>("signedOut");

    const failed = new AuthSession();
    failed.transition("authorizing");
    failed.transition("failed", { failureReason: "user denied consent" });
    expect(failed.state()).toBe<AuthSessionState>("failed");
    expect(failed.failureReason()).toBe("user denied consent");
  });

  it("signedIn → signedOut (sign out), → failed (revoked), → authorizing (re-auth)", () => {
    const signedOut = new AuthSession();
    signedOut.transition("authorizing");
    signedOut.transition("signedIn");
    signedOut.transition("signedOut");
    expect(signedOut.state()).toBe<AuthSessionState>("signedOut");

    const revoked = new AuthSession();
    revoked.transition("authorizing");
    revoked.transition("signedIn");
    revoked.transition("failed", { failureReason: "token revoked" });
    expect(revoked.state()).toBe<AuthSessionState>("failed");

    const reauth = new AuthSession();
    reauth.transition("authorizing");
    reauth.transition("signedIn");
    reauth.transition("authorizing");
    expect(reauth.state()).toBe<AuthSessionState>("authorizing");
  });

  it("expired → signedOut and expired → authorizing (re-auth)", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: 100 });
    session.transition("expired");
    expect(session.state()).toBe<AuthSessionState>("expired");
    session.transition("authorizing");
    expect(session.state()).toBe<AuthSessionState>("authorizing");
    session.transition("signedIn");
    session.transition("expired");
    session.transition("signedOut");
    expect(session.state()).toBe<AuthSessionState>("signedOut");
  });

  it("failed → signedOut (reset) and failed → authorizing (retry)", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("failed", { failureReason: "boom" });
    session.transition("authorizing");
    expect(session.state()).toBe<AuthSessionState>("authorizing");
    session.transition("failed");
    session.transition("signedOut");
    expect(session.state()).toBe<AuthSessionState>("signedOut");
  });
});

// ---------------------------------------------------------------------------
// AuthSession — illegal transitions throw typed AuthStateError
// ---------------------------------------------------------------------------

describe("AuthSession — illegal transitions throw typed AuthStateError", () => {
  it("signedOut may only go to authorizing (never straight to signedIn/expired/failed)", () => {
    for (const to of ["signedIn", "expired", "failed", "signedOut"] as const) {
      const session = new AuthSession();
      expect(() => session.transition(to)).toThrow(AuthStateError);
      expect(session.state()).toBe<AuthSessionState>("signedOut");
    }
  });

  it("authorizing cannot self-transition or jump to expired", () => {
    for (const to of ["authorizing", "expired"] as const) {
      const session = new AuthSession();
      session.transition("authorizing");
      expect(() => session.transition(to)).toThrow(AuthStateError);
      expect(session.state()).toBe<AuthSessionState>("authorizing");
    }
  });

  it("no self-transitions from signedIn, expired, or failed", () => {
    const signedIn = new AuthSession();
    signedIn.transition("authorizing");
    signedIn.transition("signedIn");
    expect(() => signedIn.transition("signedIn")).toThrow(AuthStateError);

    const expired = new AuthSession();
    expired.transition("authorizing");
    expired.transition("signedIn", { expiresAt: 1 });
    expired.transition("expired");
    expect(() => expired.transition("expired")).toThrow(AuthStateError);

    const failed = new AuthSession();
    failed.transition("authorizing");
    failed.transition("failed");
    expect(() => failed.transition("failed")).toThrow(AuthStateError);
  });

  it("expired/failed may not jump straight to signedIn (re-auth must pass through authorizing)", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: 1 });
    session.transition("expired");
    expect(() => session.transition("signedIn")).toThrow(AuthStateError);

    const retry = new AuthSession();
    retry.transition("authorizing");
    retry.transition("failed");
    expect(() => retry.transition("signedIn")).toThrow(AuthStateError);
  });

  it("the typed error carries the from and to states", () => {
    const session = new AuthSession();
    try {
      session.transition("signedIn");
      throw new Error("expected AuthStateError");
    } catch (cause) {
      expect(cause).toBeInstanceOf(AuthStateError);
      const error = cause as AuthStateError;
      expect(error.from).toBe<AuthSessionState>("signedOut");
      expect(error.to).toBe<AuthSessionState>("signedIn");
      expect(error.name).toBe("AuthStateError");
    }
  });

  it("options are validated: expiresAt only entering signedIn, failureReason only entering failed", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    expect(() => session.transition("signedOut", { expiresAt: 5 })).toThrow(AuthStateError);
    expect(() =>
      session.transition("signedIn", { failureReason: "nope" } as never),
    ).toThrow(AuthStateError);

    const failing = new AuthSession();
    failing.transition("authorizing");
    expect(() => failing.transition("failed", { expiresAt: 5 })).toThrow(AuthStateError);
  });

  it("option shapes are validated (non-finite / negative expiresAt, empty failureReason)", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    expect(() => session.transition("signedIn", { expiresAt: -1 })).toThrow(AuthStateError);
    expect(() => session.transition("signedIn", { expiresAt: Number.NaN })).toThrow(
      AuthStateError,
    );

    const failing = new AuthSession();
    failing.transition("authorizing");
    expect(() => failing.transition("failed", { failureReason: "   " })).toThrow(
      AuthStateError,
    );
  });
});

// ---------------------------------------------------------------------------
// AuthSession — expiry via expiresAt + refresh(now)
// ---------------------------------------------------------------------------

describe("AuthSession — expiry (expiresAt + refresh(now))", () => {
  it("auto-expires exactly at expiresAt and stays signedIn before it", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: 1_000 });
    expect(session.refresh(999)).toBe<AuthSessionState>("signedIn");
    expect(session.refresh(1_000)).toBe<AuthSessionState>("expired");
    expect(session.expiresAt()).toBeUndefined();
  });

  it("refresh is idempotent once expired", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: 1_000 });
    session.refresh(2_000);
    expect(session.refresh(3_000)).toBe<AuthSessionState>("expired");
    expect(session.refresh(4_000)).toBe<AuthSessionState>("expired");
  });

  it("a sign-in without expiresAt never expires", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn");
    expect(session.refresh(Number.MAX_SAFE_INTEGER)).toBe<AuthSessionState>("signedIn");
  });

  it("state extras reset on every transition (re-sign-in without expiry clears the old one)", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: 1_000 });
    session.transition("signedOut");
    expect(session.expiresAt()).toBeUndefined();
    session.transition("authorizing");
    session.transition("signedIn");
    expect(session.expiresAt()).toBeUndefined();
    expect(session.refresh(1_000_000)).toBe<AuthSessionState>("signedIn");
  });

  it("isUsable() on the session refreshes first, then checks signedIn", () => {
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: 1_000 });
    expect(session.isUsable(500)).toBe(true);
    expect(session.isUsable(1_500)).toBe(false);
    expect(session.state()).toBe<AuthSessionState>("expired");
  });
});

// ---------------------------------------------------------------------------
// isUsable / canTransition — pure helpers
// ---------------------------------------------------------------------------

describe("isUsable / canTransition — pure helpers", () => {
  it("isUsable is true only for signedIn", () => {
    for (const state of [
      "signedOut",
      "authorizing",
      "signedIn",
      "expired",
      "failed",
    ] as const) {
      expect(isUsable(state)).toBe(state === "signedIn");
    }
  });

  it("canTransition mirrors the FSM table", () => {
    expect(canTransition("signedOut", "authorizing")).toBe(true);
    expect(canTransition("authorizing", "signedIn")).toBe(true);
    expect(canTransition("authorizing", "failed")).toBe(true);
    expect(canTransition("signedIn", "expired")).toBe(true);
    expect(canTransition("signedIn", "authorizing")).toBe(true);
    expect(canTransition("expired", "authorizing")).toBe(true);
    expect(canTransition("failed", "authorizing")).toBe(true);

    expect(canTransition("signedOut", "signedIn")).toBe(false);
    expect(canTransition("authorizing", "expired")).toBe(false);
    expect(canTransition("expired", "signedIn")).toBe(false);
    expect(canTransition("failed", "signedIn")).toBe(false);
    expect(canTransition("signedIn", "signedIn")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defineAuthFlow — validation
// ---------------------------------------------------------------------------

describe("defineAuthFlow — shape and template validation", () => {
  it("accepts and freezes each valid kind", () => {
    const none = defineAuthFlow({ kind: "none" });
    expect(none).toEqual({ kind: "none" });
    expect(Object.isFrozen(none)).toBe(true);

    const oauth = defineAuthFlow(OAUTH_FLOW_INPUT);
    expect(oauth.kind).toBe("oauth");
    if (oauth.kind !== "oauth") throw new Error("expected oauth");
    expect(oauth.authorizationUrlTemplate).toBe(
      "https://auth.example.com/authorize?client_id={clientId}&redirect_uri={redirectUri}",
    );
    expect(oauth.scopes).toEqual(["read", "write"]);
    expect(oauth.tokenRefresh).toBe(true);
    expect(Object.isFrozen(oauth)).toBe(true);
    expect(Object.isFrozen(oauth.scopes)).toBe(true);

    const device = defineAuthFlow(DEVICE_FLOW_INPUT);
    expect(device.kind).toBe("device");
    if (device.kind !== "device") throw new Error("expected device");
    expect(device.verificationUrlTemplate).toBe(
      "https://example.com/device?user_code={userCode}",
    );
    expect(device.pollIntervalSeconds).toBe(5);

    for (const method of ["token", "userpass"] as const) {
      const local = defineAuthFlow({ kind: "local", method });
      expect(local).toEqual({ kind: "local", method });
    }
  });

  it("rejects non-objects and unknown kinds", () => {
    expect(() => defineAuthFlow(null)).toThrow(AuthFlowValidationError);
    expect(() => defineAuthFlow("oauth")).toThrow(AuthFlowValidationError);
    expect(() => defineAuthFlow({ kind: "saml" })).toThrow(AuthFlowValidationError);
    expect(() => defineAuthFlow({})).toThrow(AuthFlowValidationError);
  });

  it("rejects unknown extra fields per kind (catches typos)", () => {
    expect(() => defineAuthFlow({ kind: "none", method: "token" })).toThrow(
      AuthFlowValidationError,
    );
    expect(() =>
      defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: "https://x.example/auth?client={clientId}",
        scopes: [],
        tokenRefresh: false,
        authorizatonUrlTemplate: "typo",
      }),
    ).toThrow(AuthFlowValidationError);
    expect(() =>
      defineAuthFlow({ kind: "local", method: "token", scopes: [] }),
    ).toThrow(AuthFlowValidationError);
  });

  it("oauth: the authorization template must contain {...} placeholders", () => {
    expect(() =>
      defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: "https://auth.example.com/authorize",
        scopes: [],
        tokenRefresh: false,
      }),
    ).toThrow(AuthFlowValidationError);
  });

  it("oauth: unbalanced or empty-brace templates are rejected", () => {
    for (const template of [
      "https://x.example/auth?client={clientId",
      "https://x.example/auth?client=clientId}",
      "https://x.example/auth?client={}",
      "https://x.example/auth?client={{clientId}}",
    ]) {
      expect(() =>
        defineAuthFlow({
          kind: "oauth",
          authorizationUrlTemplate: template,
          scopes: [],
          tokenRefresh: false,
        }),
      ).toThrow(AuthFlowValidationError);
    }
  });

  it("oauth: scopes must be unique non-empty strings", () => {
    expect(() =>
      defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: "https://x.example/auth?client={clientId}",
        scopes: "read",
        tokenRefresh: false,
      }),
    ).toThrow(AuthFlowValidationError);
    expect(() =>
      defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: "https://x.example/auth?client={clientId}",
        scopes: ["read", "read"],
        tokenRefresh: false,
      }),
    ).toThrow(AuthFlowValidationError);
    expect(() =>
      defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: "https://x.example/auth?client={clientId}",
        scopes: ["read", ""],
        tokenRefresh: false,
      }),
    ).toThrow(AuthFlowValidationError);
  });

  it("oauth: tokenRefresh must be a boolean", () => {
    expect(() =>
      defineAuthFlow({
        kind: "oauth",
        authorizationUrlTemplate: "https://x.example/auth?client={clientId}",
        scopes: [],
        tokenRefresh: "yes",
      }),
    ).toThrow(AuthFlowValidationError);
  });

  it("device: the verification template must contain {...} placeholders", () => {
    expect(() =>
      defineAuthFlow({
        kind: "device",
        verificationUrlTemplate: "https://example.com/device",
        pollIntervalSeconds: 5,
      }),
    ).toThrow(AuthFlowValidationError);
  });

  it("device: pollIntervalSeconds must be an integer in [1, 3600]", () => {
    for (const bad of [0, -5, 2.5, "5", 3601]) {
      expect(() =>
        defineAuthFlow({
          kind: "device",
          verificationUrlTemplate: "https://example.com/device?code={code}",
          pollIntervalSeconds: bad,
        }),
      ).toThrow(AuthFlowValidationError);
    }
  });

  it("local: method must be token or userpass", () => {
    expect(() => defineAuthFlow({ kind: "local", method: "password" })).toThrow(
      AuthFlowValidationError,
    );
    expect(() => defineAuthFlow({ kind: "local", method: "TOKEN" })).toThrow(
      AuthFlowValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// flowFor — derivation per descriptor.auth kind
// ---------------------------------------------------------------------------

describe("flowFor — derivation per descriptor.auth kind", () => {
  it("none derives { kind: 'none' }", () => {
    expect(flowFor(NONE_DESC)).toEqual({ kind: "none" });
  });

  it("local derives the default token method without details", () => {
    expect(flowFor(LOCAL_DESC)).toEqual({ kind: "local", method: "token" });
  });

  it("oauth/device without details refuse to fabricate endpoints (typed throw)", () => {
    expect(() => flowFor(OAUTH_DESC)).toThrow(AuthFlowValidationError);
    expect(() => flowFor(OAUTH_DESC)).toThrow(/authorization endpoint/);
    expect(() => flowFor(DEVICE_DESC)).toThrow(AuthFlowValidationError);
    expect(() => flowFor(DEVICE_DESC)).toThrow(/verification endpoint/);
  });

  it("registered details produce the validated, kind-matched flow", () => {
    const oauth = flowFor(OAUTH_DESC, OAUTH_FLOW_INPUT);
    expect(oauth.kind).toBe("oauth");
    if (oauth.kind !== "oauth") throw new Error("expected oauth");
    expect(oauth.scopes).toEqual(["read", "write"]);
    expect(oauth.tokenRefresh).toBe(true);

    const device = flowFor(DEVICE_DESC, DEVICE_FLOW_INPUT);
    expect(device.kind).toBe("device");

    const local = flowFor(LOCAL_DESC, LOCAL_USERPASS_FLOW_INPUT);
    expect(local).toEqual({ kind: "local", method: "userpass" });
  });

  it("details whose kind mismatches the descriptor auth mode are rejected", () => {
    expect(() => flowFor(OAUTH_DESC, DEVICE_FLOW_INPUT)).toThrow(AuthFlowValidationError);
    expect(() => flowFor(LOCAL_DESC, OAUTH_FLOW_INPUT)).toThrow(AuthFlowValidationError);
    expect(() => flowFor(NONE_DESC, LOCAL_USERPASS_FLOW_INPUT)).toThrow(
      AuthFlowValidationError,
    );
  });

  it("invalid details surface the template validation errors", () => {
    expect(() =>
      flowFor(OAUTH_DESC, {
        kind: "oauth",
        authorizationUrlTemplate: "https://x.example/auth",
        scopes: [],
        tokenRefresh: false,
      }),
    ).toThrow(AuthFlowValidationError);
  });

  it("malformed descriptors are rejected", () => {
    expect(() => flowFor(null as unknown as Parameters<typeof flowFor>[0])).toThrow(
      AuthFlowValidationError,
    );
    expect(() =>
      flowFor({ id: "x", auth: "saml" } as unknown as Parameters<typeof flowFor>[0]),
    ).toThrow(AuthFlowValidationError);
  });
});

// ---------------------------------------------------------------------------
// ConnectorAuthService — begin / complete per flow kind
// ---------------------------------------------------------------------------

describe("ConnectorAuthService — begin/complete per flow kind", () => {
  it("oauth happy path: flow + pendingAuthId, complete signs in and stores an oauth-token", () => {
    const vault = createInMemoryVault();
    const clock = makeClock();
    const service = makeAuthService({ vault, clock: clock.now });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expect(begun.flow.kind).toBe("oauth");
    if (begun.flow.kind !== "oauth") throw new Error("expected oauth flow");
    expect(begun.flow.authorizationUrlTemplate).toBe(
      "https://auth.example.com/authorize?client_id={clientId}&redirect_uri={redirectUri}",
    );
    expect(begun.flow.scopes).toEqual(["read", "write"]);
    expect(begun.flow.tokenRefresh).toBe(true);
    expect(begun.pendingAuthId).toHaveLength(32);
    expect(begun.userId).toBe("user-42");
    expect(begun.expiresAt).toBe(clock.now() + 600_000);

    const completed = expectOk(service.completeAuth(begun.pendingAuthId, SECRET));
    expect(completed.connectorId).toBe("auth-oauth-source");
    expect(completed.flowKind).toBe("oauth");
    expect(completed.session).toBe<AuthSessionState>("signedIn");

    const handles = vault.list("auth-oauth-source");
    expect(handles.length).toBe(1);
    const handle = handles[0];
    if (handle === undefined) throw new Error("expected a stored handle");
    expect(handle.kind).toBe("oauth-token");
    expect(handle.connectorId).toBe("auth-oauth-source");
    expect(vault.retrieve(handle)).toBe(SECRET);
    expect(completed.handle.ref).toBe(handle.ref);

    const status = expectOk(service.authState("auth-oauth-source"));
    expect(status.session).toBe<AuthSessionState>("signedIn");
    expect(status.usable).toBe(true);
    expect(status.authMode).toBe("oauth");
  });

  it("device happy path: complete stores a device-token", () => {
    const vault = createInMemoryVault();
    const service = makeAuthService({ vault });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-device-source"));
    expect(begun.flow.kind).toBe("device");
    if (begun.flow.kind !== "device") throw new Error("expected device flow");
    expect(begun.flow.verificationUrlTemplate).toBe(
      "https://example.com/device?user_code={userCode}",
    );
    expect(begun.flow.pollIntervalSeconds).toBe(5);

    const completed = expectOk(service.completeAuth(begun.pendingAuthId, "device-token-value"));
    expect(completed.flowKind).toBe("device");

    const handles = vault.list("auth-device-source");
    expect(handles.length).toBe(1);
    const handle = handles[0];
    if (handle === undefined) throw new Error("expected a stored handle");
    expect(handle.kind).toBe("device-token");
    expect(vault.retrieve(handle)).toBe("device-token-value");
  });

  it("local happy path: derives the default token flow and stores a local-token", () => {
    const vault = createInMemoryVault();
    const service = makeAuthService({ flows: {}, vault });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expect(begun.flow).toEqual({ kind: "local", method: "token" });

    const completed = expectOk(service.completeAuth(begun.pendingAuthId, "local-api-token"));
    expect(completed.flowKind).toBe("local");
    expect(completed.session).toBe<AuthSessionState>("signedIn");

    const handles = vault.list("auth-local-source");
    expect(handles.length).toBe(1);
    const handle = handles[0];
    if (handle === undefined) throw new Error("expected a stored handle");
    expect(handle.kind).toBe("local-token");
    expect(vault.retrieve(handle)).toBe("local-api-token");
  });

  it("local userpass happy path: registered details drive the flow and the stored kind", () => {
    const vault = createInMemoryVault();
    const service = makeAuthService({
      flows: { "auth-local-source": LOCAL_USERPASS_FLOW_INPUT },
      vault,
    });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expect(begun.flow).toEqual({ kind: "local", method: "userpass" });

    expectOk(service.completeAuth(begun.pendingAuthId, "encoded-userpass"));
    const handles = vault.list("auth-local-source");
    const handle = handles[0];
    if (handle === undefined) throw new Error("expected a stored handle");
    expect(handle.kind).toBe("local-userpass");
  });

  it("none flow: begin returns the none flow; completing it is the typed wrong-flow error", () => {
    const service = makeAuthService({});

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-none-source"));
    expect(begun.flow).toEqual({ kind: "none" });
    expect(begun.pendingAuthId.length).toBeGreaterThan(0);

    const error = expectErr(service.completeAuth(begun.pendingAuthId, "anything"));
    expect(error.kind).toBe("wrong-flow");
    if (error.kind === "wrong-flow") {
      expect(error.flowKind).toBe("none");
      expect(error.pendingAuthId).toBe(begun.pendingAuthId);
      expect(error.detail).toContain("none");
    }
  });

  it("none flow: no credential lifecycle runs — the session stays signedOut", () => {
    const service = makeAuthService({});
    expectOk(service.beginAuth(makeCtx(), "auth-none-source"));
    const status = expectOk(service.authState("auth-none-source"));
    expect(status.session).toBe<AuthSessionState>("signedOut");
    // None-auth connectors are usable without any auth at all.
    expect(status.usable).toBe(true);
  });

  it("the session reports 'authorizing' while a completable pending is in flight", () => {
    const service = makeAuthService({});
    expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    const status = expectOk(service.authState("auth-local-source"));
    expect(status.session).toBe<AuthSessionState>("authorizing");
    expect(status.usable).toBe(false);
  });

  it("a new begin supersedes the previous pending for the connector", () => {
    const service = makeAuthService({});
    const first = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    const second = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expect(first.pendingAuthId).not.toBe(second.pendingAuthId);

    const superseded = expectErr(service.completeAuth(first.pendingAuthId, "s"));
    expect(superseded.kind).toBe("unknown-pending");

    expectOk(service.completeAuth(second.pendingAuthId, "the-secret"));
    const status = expectOk(service.authState("auth-local-source"));
    expect(status.session).toBe<AuthSessionState>("signedIn");
  });

  it("credential rotation: re-auth replaces the stored secret of the same kind", () => {
    const vault = createInMemoryVault();
    const service = makeAuthService({ vault });

    const first = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expectOk(service.completeAuth(first.pendingAuthId, "secret-one"));

    const second = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expectOk(service.completeAuth(second.pendingAuthId, "secret-two"));

    const handles = vault.list("auth-oauth-source");
    expect(handles.length).toBe(1);
    const handle = handles[0];
    if (handle === undefined) throw new Error("expected a stored handle");
    expect(vault.retrieve(handle)).toBe("secret-two");
  });

  it("double completion of the same pending is an unknown-pending (evicted on success)", () => {
    const service = makeAuthService({});
    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expectOk(service.completeAuth(begun.pendingAuthId, "s"));
    const error = expectErr(service.completeAuth(begun.pendingAuthId, "s"));
    expect(error.kind).toBe("unknown-pending");
  });
});

// ---------------------------------------------------------------------------
// ConnectorAuthService — typed failures
// ---------------------------------------------------------------------------

describe("ConnectorAuthService — typed failures (unknown connector / pending, expired, wrong-flow, flow-missing, invalid input)", () => {
  it("unknown connector is a typed error on beginAuth, signOut, and authState", () => {
    const service = makeAuthService({});
    expect(expectErr(service.beginAuth(makeCtx(), "nope-source")).kind).toBe(
      "unknown-connector",
    );
    expect(expectErr(service.signOut("nope-source")).kind).toBe("unknown-connector");
    expect(expectErr(service.authState("nope-source")).kind).toBe("unknown-connector");
  });

  it("unknown pending is a typed error for a bogus pendingAuthId", () => {
    const service = makeAuthService({});
    expect(expectErr(service.completeAuth("bogus", "s")).kind).toBe("unknown-pending");
  });

  it("flow-missing: beginAuth on oauth/device connectors without registered details", () => {
    const service = makeAuthService({ flows: {} });
    const oauthError = expectErr(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expect(oauthError.kind).toBe("flow-missing");
    if (oauthError.kind === "flow-missing") {
      expect(oauthError.authMode).toBe("oauth");
      expect(oauthError.connectorId).toBe("auth-oauth-source");
    }
    const deviceError = expectErr(service.beginAuth(makeCtx(), "auth-device-source"));
    expect(deviceError.kind).toBe("flow-missing");
    if (deviceError.kind === "flow-missing") {
      expect(deviceError.authMode).toBe("device");
    }
  });

  it("expired pending: completing after the pending TTL yields expired-pending, then unknown-pending", () => {
    const clock = makeClock();
    const service = makeAuthService({ clock: clock.now, pendingTtlMs: 1_000 });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    clock.advance(1_001);

    const expired = expectErr(service.completeAuth(begun.pendingAuthId, "s"));
    expect(expired.kind).toBe("expired-pending");
    if (expired.kind === "expired-pending") {
      expect(expired.pendingAuthId).toBe(begun.pendingAuthId);
      expect(expired.expiredAt).toBe(begun.expiresAt);
    }
    // The expired pending was evicted on detection.
    expect(expectErr(service.completeAuth(begun.pendingAuthId, "s")).kind).toBe(
      "unknown-pending",
    );
  });

  it("invalid ctx / ids / secret are typed invalid-input errors", () => {
    const service = makeAuthService({});
    expect(
      expectErr(service.beginAuth(null as unknown as Ctx, "auth-none-source")).kind,
    ).toBe("invalid-input");
    expect(
      expectErr(service.beginAuth({ userId: "", locale: "en-US" }, "auth-none-source"))
        .kind,
    ).toBe("invalid-input");
    expect(
      expectErr(service.beginAuth({ userId: "u", locale: "en-US", region: 7 } as unknown as Ctx, "auth-none-source")).kind,
    ).toBe("invalid-input");
    expect(expectErr(service.beginAuth(makeCtx(), "")).kind).toBe("invalid-input");
    expect(expectErr(service.completeAuth("", "s")).kind).toBe("invalid-input");
    expect(expectErr(service.completeAuth("   ", "s")).kind).toBe("invalid-input");

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expect(expectErr(service.completeAuth(begun.pendingAuthId, "")).kind).toBe(
      "invalid-input",
    );
  });

  it("wiring mismatch (flow details that do not match the descriptor auth) throws at beginAuth", () => {
    const service = makeAuthService({
      flows: { "auth-oauth-source": DEVICE_FLOW_INPUT },
    });
    expect(() => service.beginAuth(makeCtx(), "auth-oauth-source")).toThrow(
      AuthFlowValidationError,
    );
  });

  it("constructor validates its configuration with typed errors", () => {
    expect(() => new ConnectorAuthService({ registry: makeRegistry() })).not.toThrow();
    expect(
      () => new ConnectorAuthService({ registry: makeRegistry(), sessionTtlMs: 0 }),
    ).toThrow(AuthServiceConfigError);
    expect(
      () => new ConnectorAuthService({ registry: makeRegistry(), sessionTtlMs: 1.5 }),
    ).toThrow(AuthServiceConfigError);
    expect(
      () =>
        new ConnectorAuthService({
          registry: makeRegistry(),
          pendingTtlMs: -1,
        }),
    ).toThrow(AuthServiceConfigError);
    expect(
      () =>
        new ConnectorAuthService({
          registry: null as unknown as ConnectorRegistry,
        }),
    ).toThrow(AuthServiceConfigError);
    expect(
      () =>
        new ConnectorAuthService({
          registry: makeRegistry(),
          clock: "not-a-function" as unknown as () => number,
        }),
    ).toThrow(AuthServiceConfigError);
  });

  it("constructor rejects malformed flow details, naming the connector", () => {
    expect(() =>
      makeAuthService({
        flows: {
          "auth-oauth-source": {
            kind: "oauth",
            authorizationUrlTemplate: "https://no-placeholder.example/authorize",
            scopes: [],
            tokenRefresh: false,
          },
        },
      }),
    ).toThrow(AuthFlowValidationError);
    expect(() =>
      makeAuthService({
        flows: {
          "auth-oauth-source": {
            kind: "oauth",
            authorizationUrlTemplate: "https://no-placeholder.example/authorize",
            scopes: [],
            tokenRefresh: false,
          },
        },
      }),
    ).toThrow(/auth-oauth-source/);
  });
});

// ---------------------------------------------------------------------------
// ConnectorAuthService — signOut clears both vault and session
// ---------------------------------------------------------------------------

describe("ConnectorAuthService — signOut clears both", () => {
  it("signOut deletes every stored credential and resets the session to signedOut", () => {
    const vault = createInMemoryVault();
    const service = makeAuthService({ vault });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expectOk(service.completeAuth(begun.pendingAuthId, SECRET));
    expect(vault.list("auth-oauth-source").length).toBe(1);

    const signedOut = expectOk(service.signOut("auth-oauth-source"));
    expect(signedOut.connectorId).toBe("auth-oauth-source");
    expect(signedOut.session).toBe<AuthSessionState>("signedOut");
    expect(signedOut.secretsDeleted).toBe(1);

    expect(vault.list("auth-oauth-source").length).toBe(0);
    const status = expectOk(service.authState("auth-oauth-source"));
    expect(status.session).toBe<AuthSessionState>("signedOut");
    expect(status.usable).toBe(false);
  });

  it("signOut is idempotent: never-authed connectors succeed and delete nothing", () => {
    const service = makeAuthService({});
    const result = expectOk(service.signOut("auth-none-source"));
    expect(result.secretsDeleted).toBe(0);
    expect(result.session).toBe<AuthSessionState>("signedOut");
  });

  it("signOut evicts live pendings (later completion is unknown-pending)", () => {
    const service = makeAuthService({});
    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expectOk(service.signOut("auth-local-source"));
    expect(expectErr(service.completeAuth(begun.pendingAuthId, "s")).kind).toBe(
      "unknown-pending",
    );
  });

  it("signOut deletes all credential kinds for the connector, not just the current one", () => {
    const vault = createInMemoryVault();
    vault.store("auth-device-source", "device-token", "one");
    vault.store("auth-device-source", "local-token", "two");

    const service = makeAuthService({ vault });
    const result = expectOk(service.signOut("auth-device-source"));
    expect(result.secretsDeleted).toBe(2);
    expect(vault.list("auth-device-source").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ConnectorAuthService — session TTL, expiry, re-auth
// ---------------------------------------------------------------------------

describe("ConnectorAuthService — session TTL and re-auth", () => {
  it("authState auto-expires a signedIn session once sessionTtlMs elapses", () => {
    const clock = makeClock();
    const service = makeAuthService({ clock: clock.now, sessionTtlMs: 5_000 });

    const begun = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    const completed = expectOk(service.completeAuth(begun.pendingAuthId, "tok"));
    expect(completed.expiresAt).toBe(clock.now() + 5_000);

    clock.advance(4_999);
    expect(expectOk(service.authState("auth-local-source")).session).toBe<AuthSessionState>(
      "signedIn",
    );

    clock.advance(2);
    const status = expectOk(service.authState("auth-local-source"));
    expect(status.session).toBe<AuthSessionState>("expired");
    expect(status.usable).toBe(false);
    if (status.expiresAt !== undefined && completed.expiresAt !== undefined) {
      expect(status.expiresAt).toBe(completed.expiresAt);
    }
  });

  it("re-auth from expired works: begin → complete → signedIn again", () => {
    const clock = makeClock();
    const service = makeAuthService({ clock: clock.now, sessionTtlMs: 1_000 });

    const first = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expectOk(service.completeAuth(first.pendingAuthId, "old"));
    clock.advance(1_500);
    expect(expectOk(service.authState("auth-local-source")).session).toBe<AuthSessionState>(
      "expired",
    );

    const second = expectOk(service.beginAuth(makeCtx(), "auth-local-source"));
    expectOk(service.completeAuth(second.pendingAuthId, "new"));
    const status = expectOk(service.authState("auth-local-source"));
    expect(status.session).toBe<AuthSessionState>("signedIn");
    expect(status.usable).toBe(true);
  });

  it("re-auth while signedIn is legal (credential refresh)", () => {
    const service = makeAuthService({});
    const first = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expectOk(service.completeAuth(first.pendingAuthId, "old-credential"));

    const second = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    const midStatus = expectOk(service.authState("auth-oauth-source"));
    expect(midStatus.session).toBe<AuthSessionState>("authorizing");
    expect(midStatus.usable).toBe(false);

    expectOk(service.completeAuth(second.pendingAuthId, "new-credential"));
    expect(expectOk(service.authState("auth-oauth-source")).session).toBe<AuthSessionState>(
      "signedIn",
    );
  });

  it("descriptor-only registry rows work (auth before any instance is wired)", () => {
    const service = makeAuthService({});
    const begun = expectOk(service.beginAuth(makeCtx(), "auth-oauth-source"));
    expectOk(service.completeAuth(begun.pendingAuthId, SECRET));
    expect(expectOk(service.authState("auth-oauth-source")).usable).toBe(true);
  });
});
