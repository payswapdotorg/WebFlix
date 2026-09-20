/**
 * R22-H — the Desktop account session store tests (the OS-keychain
 * binding over the shell simulator).
 *
 * - store → restore round trips the session material (the token + the
 *   secret-free view + the savedAt truth) through the keychain area;
 * - the honest absent answer (nothing stored → anonymous, never a
 *   fabricated session);
 * - the corrupt truths (a stored payload that is not the session-payload
 *   shape; a smuggled extra field; the shell's own corrupt failure) each
 *   answer the typed failure with the sign-in-again recovery — surfaced,
 *   never silently treated as absent;
 * - the unsupported platform truth (no keychain service): every
 *   operation answers the typed verdict with the honest consequence
 *   (sign-in works; the session will not persist) — NEVER a silent
 *   downgrade to plaintext storage;
 * - clear is idempotent; set REPLACES (the single-session law);
 * - the payload guard rejects a session view carrying secret material.
 */

import { describe, expect, it } from "bun:test";

import { createShellAuthSessionStore } from "../src/platform/auth-session-store";
import { SimShell } from "./shell-simulator";
import { makeIssuedSession, makeSession, R22_T0 } from "./r22-fixtures";

function store(shell: SimShell) {
  return createShellAuthSessionStore({
    shell,
    now: () => new Date(R22_T0).toISOString(),
  });
}

describe("R22-H — the keychain round trip (the platform storage law)", () => {
  it("store → restore answers the signed-in state with the token + the view", async () => {
    const shell = new SimShell();
    const sessionStore = store(shell);
    const issued = makeIssuedSession();
    const stored = await sessionStore.store(issued);
    expect(stored.ok).toBe(true);
    const restored = await sessionStore.restore();
    expect(restored.ok).toBe(true);
    if (restored.ok && restored.value.state === "signed-in") {
      expect(restored.value.token).toBe(issued.token);
      expect(restored.value.session.activeProfileId).toBe("wfxprof_main");
      expect(restored.value.savedAt).toBe(new Date(R22_T0).toISOString());
    } else if (restored.ok) {
      throw new Error("expected the signed-in state");
    }
  });

  it("nothing stored → the honest anonymous answer", async () => {
    const shell = new SimShell();
    const restored = await store(shell).restore();
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.state).toBe("anonymous");
  });

  it("set REPLACES (the single-session law) and clear is idempotent", async () => {
    const shell = new SimShell();
    const sessionStore = store(shell);
    await sessionStore.store(makeIssuedSession());
    const kidsProfile = makeSession().profiles[0]!;
    const second = makeIssuedSession({
      token: "wfxsess_secondtoken00000000000000000",
      session: makeSession({
        profiles: [{ ...kidsProfile, id: "wfxprof_kids", displayName: "Kids", isDefault: false }],
        activeProfileId: "wfxprof_kids",
      }),
    });
    await sessionStore.store(second);
    const restored = await sessionStore.restore();
    if (restored.ok && restored.value.state === "signed-in") {
      expect(restored.value.token).toBe("wfxsess_secondtoken00000000000000000");
      expect(restored.value.session.activeProfileId).toBe("wfxprof_kids");
    } else {
      throw new Error("expected the replaced session");
    }
    const cleared = await sessionStore.clear();
    expect(cleared.ok).toBe(true);
    const afterClear = await sessionStore.restore();
    if (afterClear.ok) expect(afterClear.value.state).toBe("anonymous");
    const clearedAgain = await sessionStore.clear();
    expect(clearedAgain.ok).toBe(true);
  });
});

describe("R22-H — the corrupt truths (surfaced, never silently absent)", () => {
  it("the shell's corrupt failure answers the typed sign-in-again recovery", async () => {
    const shell = new SimShell();
    shell.keychainCorrupt = true;
    const restored = await store(shell).restore();
    expect(restored.ok).toBe(false);
    if (!restored.ok) {
      expect(restored.failure.kind).toBe("corrupt");
      expect(restored.failure.recovery.kind).toBe("sign-in-again");
    }
  });

  it("a stored payload that is not the session-payload shape is corrupt", async () => {
    const shell = new SimShell();
    await shell.authStoreSet({ payload: "not json at all", savedAt: new Date(R22_T0).toISOString() });
    const restored = await store(shell).restore();
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.failure.kind).toBe("corrupt");
  });

  it("a payload smuggling an extra field is corrupt (the shape law)", async () => {
    const shell = new SimShell();
    const payload = JSON.stringify({
      token: "wfxsess_r22testtoken0000000000000000",
      session: makeSession(),
      extra: "smuggled",
    });
    await shell.authStoreSet({ payload, savedAt: new Date(R22_T0).toISOString() });
    const restored = await store(shell).restore();
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.failure.kind).toBe("corrupt");
  });

  it("storing a session view carrying secret material is rejected (the boundary guard)", async () => {
    const shell = new SimShell();
    const smuggled = makeIssuedSession();
    (smuggled.session.user as unknown as Record<string, unknown>).password = "the-password";
    const stored = await store(shell).store(smuggled);
    expect(stored.ok).toBe(false);
    if (!stored.ok) expect(stored.failure.kind).toBe("corrupt");
    // Nothing was stored.
    const restored = await store(shell).restore();
    if (restored.ok) expect(restored.value.state).toBe("anonymous");
  });
});

describe("R22-H — the unsupported platform truth (never a plaintext fallback)", () => {
  it("a platform with no keychain service answers the typed verdict on every operation", async () => {
    const shell = new SimShell({ keychainPresent: false });
    const sessionStore = store(shell);
    const support = await sessionStore.support();
    expect(support.support.available).toBe(false);
    expect(support.consequence.kind).toBe("will-not-persist");
    const stored = await sessionStore.store(makeIssuedSession());
    expect(stored.ok).toBe(false);
    if (!stored.ok) {
      expect(stored.failure.kind).toBe("unsupported");
      expect(stored.failure.recovery.kind).toBe("session-will-not-persist");
    }
    const restored = await sessionStore.restore();
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.failure.kind).toBe("unsupported");
    const cleared = await sessionStore.clear();
    expect(cleared.ok).toBe(false);
    if (!cleared.ok) expect(cleared.failure.kind).toBe("unsupported");
  });

  it("the keychain-present platform answers the persists consequence", async () => {
    const shell = new SimShell();
    const support = await store(shell).support();
    expect(support.support.available).toBe(true);
    expect(support.consequence.kind).toBe("persists");
  });

  it("a keychain write failure answers the typed retry recovery (nothing saved)", async () => {
    const shell = new SimShell();
    shell.keychainWriteFailure = true;
    const stored = await store(shell).store(makeIssuedSession());
    expect(stored.ok).toBe(false);
    if (!stored.ok) {
      expect(stored.failure.kind).toBe("write-failed");
      expect(stored.failure.recovery.kind).toBe("retry-sign-in");
    }
    const restored = await store(shell).restore();
    if (restored.ok) expect(restored.value.state).toBe("anonymous");
  });
});
