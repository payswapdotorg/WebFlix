/**
 * @wfx/app-web — the auth transport tests (R21-B).
 *
 * The identity/session read/write path's transport laws, fetch-stubbed
 * (no network): every operation answers the TYPED `AuthResult`; the
 * token rides the Authorization header ONLY (never a URL); the
 * anti-enumeration 401 maps to `invalid-credentials`; register's 409
 * maps to `email-taken`; malformed payloads answer `malformed` (never
 * identity data); the user view NEVER carries password material.
 */

import { describe, expect, it } from "bun:test";

import {
  authLogin,
  authLogout,
  authReadSession,
  authRegister,
  authSelectProfile,
} from "../src/host/auth-transport";
import { withFetchStub } from "./fake-web";

const BASE = new URL("https://experience.example");

const USER = {
  id: "wfxuser_1",
  email: "ada@example.com",
  displayName: "Ada",
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};
const PROFILES = [
  {
    id: "wfxprof_main",
    userId: "wfxuser_1",
    displayName: "Main",
    avatarSeed: "main",
    isDefault: true,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  },
];
const SESSION_VIEW = {
  user: USER,
  profiles: PROFILES,
  activeProfileId: "wfxprof_main",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("R21-B auth transport — login/register (the write path)", () => {
  it("login POSTs credentials and answers the issued session (token + view)", async () => {
    const { calls, result } = await withFetchStub(
      () => json({ token: "wfxsess_token123", ...SESSION_VIEW }),
      async () => authLogin({ apiBase: BASE }, { email: "ada@example.com", password: "pw" }),
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/auth/login");
    expect(calls[0]?.body ?? "").toContain("ada@example.com");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.token).toBe("wfxsess_token123");
      expect(result.value.session.user.id).toBe("wfxuser_1");
    }
  });

  it("the anti-enumeration 401 answers invalid-credentials (unknown email == wrong password)", async () => {
    for (const credentials of [
      { email: "unknown@example.com", password: "pw" },
      { email: "ada@example.com", password: "wrong" },
    ]) {
      const { result } = await withFetchStub(
        () => json({ error: "invalid-credentials" }, 401),
        async () => authLogin({ apiBase: BASE }, credentials),
      );
      expect(result).toMatchObject({ ok: false, failure: { kind: "invalid-credentials" } });
    }
  });

  it("register POSTs the body; 409 answers email-taken (the unique constraint's truth)", async () => {
    const { calls, result } = await withFetchStub(
      () => json({ token: "wfxsess_token123", ...SESSION_VIEW }),
      async () =>
        authRegister({ apiBase: BASE }, { email: "ada@example.com", password: "pw", displayName: "Ada" }),
    );
    expect(calls[0]?.url).toContain("/auth/register");
    expect(result.ok).toBe(true);

    const { result: taken } = await withFetchStub(
      () => json({ error: "email-taken" }, 409),
      async () => authRegister({ apiBase: BASE }, { email: "ada@example.com", password: "pw" }),
    );
    expect(taken).toMatchObject({ ok: false, failure: { kind: "email-taken" } });
  });

  it("invalid caller input answers the typed invalid-input failure", async () => {
    const { result } = await withFetchStub(
      () => json({}),
      async () => authLogin({ apiBase: BASE }, { email: "", password: "" }),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "invalid-input" } });
  });
});

describe("R21-B auth transport — readSession (the continuity probe)", () => {
  it("GETs /auth/me with the Authorization header ONLY (the token never rides a URL)", async () => {
    const { calls, result } = await withFetchStub(
      () => json(SESSION_VIEW),
      async () => authReadSession({ apiBase: BASE }, "wfxsess_token123"),
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/auth/me");
    expect(calls[0]?.url).not.toContain("wfxsess_token123");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer wfxsess_token123");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.activeProfileId).toBe("wfxprof_main");
      expect(result.value.profiles).toHaveLength(1);
    }
  });

  it("a rejected token answers the typed unauthorized (the honest degradation input)", async () => {
    const { result } = await withFetchStub(
      () => json({ error: "unauthorized" }, 401),
      async () => authReadSession({ apiBase: BASE }, "wfxsess_stale"),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unauthorized" } });
  });

  it("a service-down 502 answers unavailable (never a fake signed-out)", async () => {
    const { result } = await withFetchStub(
      () => json({ ok: false }, 502),
      async () => authReadSession({ apiBase: BASE }, "wfxsess_token123"),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("a payload carrying password material is malformed — never identity data", async () => {
    const { result } = await withFetchStub(
      () => json({ ...SESSION_VIEW, user: { ...USER, passwordHash: "nope" } }),
      async () => authReadSession({ apiBase: BASE }, "wfxsess_token123"),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "malformed" } });
  });

  it("a fetch rejection answers network (offline truth)", async () => {
    const { result } = await withFetchStub(
      () => Promise.reject(new TypeError("fetch failed")),
      async () => authReadSession({ apiBase: BASE }, "wfxsess_token123"),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "network" } });
  });
});

describe("R21-B auth transport — logout / selectProfile", () => {
  it("logout POSTs with the token; the revoked truth answers", async () => {
    const { calls, result } = await withFetchStub(
      () => json({ ok: true, revoked: true }),
      async () => authLogout({ apiBase: BASE }, "wfxsess_token123"),
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/auth/logout");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer wfxsess_token123");
    expect(result).toMatchObject({ ok: true, value: { revoked: true } });
  });

  it("selectProfile PUTs the profile route with the token", async () => {
    const { calls, result } = await withFetchStub(
      () => json({ ...SESSION_VIEW, activeProfileId: "wfxprof_kids" }),
      async () => authSelectProfile({ apiBase: BASE }, "wfxsess_token123", "wfxprof_kids"),
    );
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/profiles/wfxprof_kids/select");
    expect(calls[0]?.headers["authorization"]).toBe("Bearer wfxsess_token123");
    expect(result).toMatchObject({ ok: true });
  });

  it("a foreign/unknown profile's 404 answers not-found (never a silent no-op)", async () => {
    const { result } = await withFetchStub(
      () => json({ error: "not-found" }, 404),
      async () => authSelectProfile({ apiBase: BASE }, "wfxsess_token123", "wfxprof_other"),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: "not-found" } });
  });
});
