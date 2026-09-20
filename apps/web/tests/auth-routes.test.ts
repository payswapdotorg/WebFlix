/**
 * R21-B auth-route tests (bun:test).
 *
 * Proves the REAL profile/session read/write path over the route
 * bridges (the handlers, no network — the service mode stubs fetch):
 *
 * - POST /api/auth/login: the fixtures-mode scripted persona signs in
 *   (the cookie is set; the body answers the session VIEW only — the
 *   token never reaches the client body); wrong credentials answer the
 *   SAME typed 401 (the anti-enumeration law);
 * - POST /api/auth/register: the fixture session (loudly a dev double);
 * - GET /api/auth/session: the honest signed-in/signed-out truth, with
 *   the typed reason when a stored token was rejected;
 * - POST /api/auth/logout: the cookie clears (even on transport
 *   failure — a stale cookie must not outlive the intent);
 * - PUT /api/auth/select-profile: the typed 404 for unknown profiles;
 * - the per-identity host map: an authenticated cookie binds the
 *   account's runtime (service mode over the stubbed /auth/me).
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { resetWebHostProcessState } from "../src/host/testing";
import {
  getWebRuntimeHost,
  getWebRuntimeHostForRequest,
} from "../src/host/web-host";
import { POST as postLogin } from "../src/app/api/auth/login/route";
import { POST as postRegister } from "../src/app/api/auth/register/route";
import { GET as getSession } from "../src/app/api/auth/session/route";
import { POST as postLogout } from "../src/app/api/auth/logout/route";
import { PUT as putSelectProfile } from "../src/app/api/auth/select-profile/route";
import {
  FIXTURE_AUTH_EMAIL,
  FIXTURE_AUTH_PASSWORD,
  FIXTURE_AUTH_TOKEN,
  driveFixtureLogin,
  driveFixtureLogout,
  resetFixtureAuthStateForTests,
} from "../src/host/auth-fixtures";
import { sessionTokenFromRequest } from "../src/host/session-cookie";
import { withEnv, withFetchStub } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
  resetFixtureAuthStateForTests();
});

function jsonRequest(path: string, method: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== undefined) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function cookieOf(response: Response): string | null {
  return response.headers.get("set-cookie");
}

describe("R21-B — POST /api/auth/login (fixtures mode: the scripted persona)", () => {
  it("the dev persona signs in: the cookie is set; the body carries the session VIEW only", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await postLogin(
        jsonRequest("/api/auth/login", "POST", {
          email: FIXTURE_AUTH_EMAIL,
          password: FIXTURE_AUTH_PASSWORD,
        }),
      );
      expect(response.status).toBe(200);
      expect(cookieOf(response)).toContain("wfx_session=");
      expect(cookieOf(response)).toContain(FIXTURE_AUTH_TOKEN);
      expect(cookieOf(response)?.toLowerCase()).toContain("httponly");
      const body = (await response.json()) as { session?: { user?: { id?: string } } };
      expect(body.session?.user?.id).toBe("wfxuser_devfixture");
      // The token NEVER reaches the response body (the cookie is the carrier).
      expect(JSON.stringify(body)).not.toContain(FIXTURE_AUTH_TOKEN);
    });
  });

  it("wrong credentials answer the SAME typed 401 (anti-enumeration)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      for (const credentials of [
        { email: "nobody@example.com", password: FIXTURE_AUTH_PASSWORD },
        { email: FIXTURE_AUTH_EMAIL, password: "wrong" },
      ]) {
        const response = await postLogin(
          jsonRequest("/api/auth/login", "POST", credentials),
        );
        expect(response.status).toBe(401);
        const body = (await response.json()) as { error?: string };
        expect(body.error).toBe("invalid-credentials");
      }
    });
  });

  it("a malformed body answers the typed 400", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await postLogin(jsonRequest("/api/auth/login", "POST", { email: "" }));
      expect(response.status).toBe(400);
    });
  });
});

describe("R21-B — GET /api/auth/session + the per-identity host (fixtures mode)", () => {
  it("no cookie answers the honest signed-out truth", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await getSession(jsonRequest("/api/auth/session", "GET"));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { signedIn?: boolean };
      expect(body.signedIn).toBe(false);
    });
  });

  it("the signed-in persona answers the session view; the request host binds the account", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
      const response = await getSession(
        jsonRequest("/api/auth/session", "GET", undefined, `wfx_session=${FIXTURE_AUTH_TOKEN}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        signedIn?: boolean;
        session?: { profiles?: unknown[]; activeProfileId?: string };
      };
      expect(body.signedIn).toBe(true);
      expect(body.session?.profiles).toHaveLength(2);
      expect(body.session?.activeProfileId).toBe("wfxprof_devprofile");

      // The per-identity host map: the SAME token binds the account's runtime.
      const host = await getWebRuntimeHostForRequest(FIXTURE_AUTH_TOKEN);
      expect(host.session.state.signedIn).toBe(true);
      expect(host.session.context.userId).toBe("wfxuser_devfixture");
      expect(host.session.context.profileId).toBe("wfxprof_devprofile");
    });
  });

  it("after sign-out the token degrades HONESTLY to the anonymous binding (never a fake profile)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
      driveFixtureLogout();
      const host = await getWebRuntimeHostForRequest(FIXTURE_AUTH_TOKEN);
      expect(host.session.state.signedIn).toBe(false);
      expect(host.session.context.userId).toBe("wfx-anonymous");
    });
  });

  it("no token answers the anonymous singleton (the R07 behavior, unchanged)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHostForRequest(undefined);
      expect(host.session.state.signedIn).toBe(false);
      expect(host.session.context.userId).toBe("wfx-anonymous");
    });
  });
});

describe("R21-B — PUT /api/auth/select-profile + POST /api/auth/logout (fixtures mode)", () => {
  it("profile switching is real: the active profile changes through the typed drive", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
      const response = await putSelectProfile(
        jsonRequest(
          "/api/auth/select-profile",
          "PUT",
          { profileId: "wfxprof_kidsprofile" },
          `wfx_session=${FIXTURE_AUTH_TOKEN}`,
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { session?: { activeProfileId?: string } };
      expect(body.session?.activeProfileId).toBe("wfxprof_kidsprofile");

      // The request host re-keys to the NEW identity:
      const host = await getWebRuntimeHostForRequest(FIXTURE_AUTH_TOKEN);
      expect(host.session.context.profileId).toBe("wfxprof_kidsprofile");
      expect(host.session.state.label).toBe("Kids profile");
    });
  });

  it("an unknown profile answers the typed 404 (never a silent no-op)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
      const response = await putSelectProfile(
        jsonRequest(
          "/api/auth/select-profile",
          "PUT",
          { profileId: "wfxprof_nope" },
          `wfx_session=${FIXTURE_AUTH_TOKEN}`,
        ),
      );
      expect(response.status).toBe(404);
    });
  });

  it("sign-out clears the cookie and resets the persona", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      driveFixtureLogin(FIXTURE_AUTH_EMAIL, FIXTURE_AUTH_PASSWORD);
      const response = await postLogout(
        jsonRequest("/api/auth/logout", "POST", {}, `wfx_session=${FIXTURE_AUTH_TOKEN}`),
      );
      expect(response.status).toBe(200);
      expect(cookieOf(response)).toContain("Max-Age=0");
      // The next session read is the honest signed-out truth:
      const sessionResponse = await getSession(
        jsonRequest("/api/auth/session", "GET", undefined, `wfx_session=${FIXTURE_AUTH_TOKEN}`),
      );
      const body = (await sessionResponse.json()) as { signedIn?: boolean };
      expect(body.signedIn).toBe(false);
    });
  });

  it("sign-out without a cookie is the honest idempotent answer", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await postLogout(jsonRequest("/api/auth/logout", "POST", {}));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { revoked?: boolean };
      expect(body.revoked).toBe(false);
    });
  });
});

describe("R21-B — POST /api/auth/register (fixtures mode: the loud dev double)", () => {
  it("register answers the fixture session (auto-logged-in, loudly dev)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const response = await postRegister(
        jsonRequest("/api/auth/register", "POST", {
          email: "anyone@example.com",
          password: "pw",
          displayName: "Anyone",
        }),
      );
      expect(response.status).toBe(200);
      expect(cookieOf(response)).toContain("wfx_session=");
      const body = (await response.json()) as { session?: { user?: { displayName?: string } } };
      expect(body.session?.user?.displayName).toContain("TEST FIXTURE");
    });
  });
});

describe("R21-B — the service mode (the REAL transport over the stubbed API)", () => {
  const ME_BODY = {
    user: {
      id: "wfxuser_1",
      email: "ada@example.com",
      displayName: "Ada",
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:00:00.000Z",
    },
    profiles: [
      {
        id: "wfxprof_main",
        userId: "wfxuser_1",
        displayName: "Main",
        avatarSeed: "main",
        isDefault: true,
        createdAt: "2026-09-18T12:00:00.000Z",
        updatedAt: "2026-09-18T12:00:00.000Z",
      },
    ],
    activeProfileId: "wfxprof_main",
  };

  it("login proxies the API and sets the cookie (the body answers the view only)", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      const { calls, respond } = await (async () => {
        const calls: unknown[] = [];
        return {
          calls,
          respond: (call: { url: string }) => {
            calls.push(call);
            return new Response(
              JSON.stringify({ token: "wfxsess_real123", ...ME_BODY }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          },
        };
      })();
      const { result } = await withFetchStub(
        respond,
        async () => {
          const response = await postLogin(
            jsonRequest("/api/auth/login", "POST", { email: "ada@example.com", password: "pw" }),
          );
          return { status: response.status, cookie: cookieOf(response), body: await response.json() };
        },
      );
      expect(result.status).toBe(200);
      expect(result.cookie).toContain("wfx_session=wfxsess_real123");
      expect(JSON.stringify(result.body)).not.toContain("wfxsess_real123");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it("the session read proxies /auth/me; a rejected token answers the typed 401 WITH its reason", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      const { result } = await withFetchStub(
        () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
        async () => {
          const response = await getSession(
            jsonRequest("/api/auth/session", "GET", undefined, "wfx_session=wfxsess_stale"),
          );
          return { status: response.status, body: await response.json() };
        },
      );
      expect(result.status).toBe(401);
      expect(result.body.signedIn).toBe(false);
      expect(result.body.reason).toBe("rejected");
    });
  });

  it("a valid token binds the identity's host through the REAL transport", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      const { result } = await withFetchStub(
        () => new Response(JSON.stringify(ME_BODY), { status: 200 }),
        async () => {
          const host = await getWebRuntimeHostForRequest("wfxsess_real123");
          return {
            signedIn: host.session.state.signedIn,
            userId: host.session.context.userId,
            profileId: host.session.context.profileId,
          };
        },
      );
      expect(result.signedIn).toBe(true);
      expect(result.userId).toBe("wfxuser_1");
      expect(result.profileId).toBe("wfxprof_main");
    });
  });

  it("an invalid token degrades to the anonymous singleton (never a fake profile)", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      const { result } = await withFetchStub(
        () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
        async () => {
          const host = await getWebRuntimeHostForRequest("wfxsess_stale");
          return { signedIn: host.session.state.signedIn, userId: host.session.context.userId };
        },
      );
      expect(result.signedIn).toBe(false);
      expect(result.userId).toBe("wfx-anonymous");
    });
  });

  it("logout clears the cookie EVEN when the transport call fails (the intent outlives the token)", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      const { result } = await withFetchStub(
        () => new Response(JSON.stringify({ error: "unavailable" }), { status: 502 }),
        async () => {
          const response = await postLogout(
            jsonRequest("/api/auth/logout", "POST", {}, "wfx_session=wfxsess_real123"),
          );
          return { status: response.status, cookie: cookieOf(response) };
        },
      );
      expect(result.status).toBe(502);
      expect(result.cookie).toContain("Max-Age=0");
    });
  });
});

describe("R21-B — the session cookie law", () => {
  it("the token reads from the Cookie header (never a URL, never a body)", async () => {
    const request = jsonRequest("/api/auth/session", "GET", undefined, "wfx_session=wfxsess_x");
    expect(sessionTokenFromRequest(request)).toBe("wfxsess_x");
    const bare = jsonRequest("/api/auth/session", "GET");
    expect(sessionTokenFromRequest(bare)).toBeNull();
    const other = jsonRequest("/api/auth/session", "GET", undefined, "other=1");
    expect(sessionTokenFromRequest(other)).toBeNull();
  });

  it("the boot mode is never touched by the auth routes' host reads (the 050 law holds)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHost();
      expect(host.mode).toBe("fixtures");
    });
  });
});
