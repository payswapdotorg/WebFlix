/**
 * WFX-054 — YouTube connector OAuth tests (authorization-code flow):
 * URL construction, token exchange, refresh rotation, typed expiry, and
 * every typed failure path. All through the scripted transport — no network.
 */

import { describe, expect, it } from "bun:test";

import {
  buildYouTubeAuthorizationUrl,
  exchangeYouTubeCode,
  FIXTURE_OAUTH_ERROR_INVALID_GRANT,
  FIXTURE_OAUTH_EXCHANGE_OK,
  FIXTURE_OAUTH_REFRESH_OK,
  createScriptedYouTubeTransport,
  fixtureBody,
  isYouTubeTokenExpired,
  refreshYouTubeToken,
  YOUTUBE_OAUTH_AUTHORIZATION_ENDPOINT,
  YOUTUBE_OAUTH_TOKEN_ENDPOINT,
  YOUTUBE_TOKEN_EXPIRY_MARGIN_MS,
  type YouTubeOAuthConfig,
} from "../src/index";

const CONFIG: YouTubeOAuthConfig = {
  clientId: "fixture-client-id.apps.googleusercontent.com",
  clientSecret: "fixture-client-secret",
  redirectUri: "https://app.example.dev/api/connectors/youtube/callback",
};

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);

describe("buildYouTubeAuthorizationUrl (the consent redirect)", () => {
  it("builds the documented Google authorization URL with every parameter", () => {
    const result = buildYouTubeAuthorizationUrl(CONFIG, { state: "csrf-token-123" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const url = new URL(result.value);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("csrf-token-123");
  });

  it("passes through login_hint and prompt overrides, URL-encoding values", () => {
    const result = buildYouTubeAuthorizationUrl(CONFIG, {
      state: "s",
      prompt: "select_account",
      loginHint: "user@example.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const url = new URL(result.value);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
    // The email @ and dots survive verbatim through proper percent-encoding.
    expect(result.value).toContain(encodeURIComponent("user@example.com"));
  });

  it("overrides scopes when provided (still space-joined, encoded)", () => {
    const result = buildYouTubeAuthorizationUrl(CONFIG, {
      state: "s",
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(new URL(result.value).searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.readonly",
    );
  });

  it("returns typed invalid-config for every malformed configuration (never a fabricated URL)", () => {
    for (const bad of [
      { ...CONFIG, clientId: "" },
      { ...CONFIG, clientId: "   " },
      { ...CONFIG, clientSecret: "" },
      { ...CONFIG, redirectUri: "" },
      { ...CONFIG, redirectUri: "not-a-url" },
    ]) {
      const result = buildYouTubeAuthorizationUrl(bad, { state: "s" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe("invalid-config");
    }
    const noState = buildYouTubeAuthorizationUrl(CONFIG, { state: "" });
    expect(noState.ok).toBe(false);
    if (noState.ok) throw new Error("unreachable");
    expect(noState.error.kind).toBe("invalid-config");
    expect(noState.error.detail).toContain("state");
    const emptyScopes = buildYouTubeAuthorizationUrl(CONFIG, {
      state: "s",
      scopes: [],
    });
    expect(emptyScopes.ok).toBe(false);
  });

  it("names YOUTUBE_* env variables in the config error details", () => {
    const noId = buildYouTubeAuthorizationUrl(
      { clientId: "", clientSecret: "s", redirectUri: "https://r.example/cb" },
      { state: "s" },
    );
    expect(noId.ok).toBe(false);
    if (noId.ok) throw new Error("unreachable");
    expect(noId.error.detail).toContain("YOUTUBE_CLIENT_ID");

    const noSecret = buildYouTubeAuthorizationUrl(
      { clientId: "c", clientSecret: "", redirectUri: "https://r.example/cb" },
      { state: "s" },
    );
    expect(noSecret.ok).toBe(false);
    if (noSecret.ok) throw new Error("unreachable");
    expect(noSecret.error.detail).toContain("YOUTUBE_CLIENT_SECRET");

    const noRedirect = buildYouTubeAuthorizationUrl(
      { clientId: "c", clientSecret: "s", redirectUri: "" },
      { state: "s" },
    );
    expect(noRedirect.ok).toBe(false);
    if (noRedirect.ok) throw new Error("unreachable");
    expect(noRedirect.error.detail).toContain("YOUTUBE_REDIRECT_URI");
  });
});

describe("exchangeYouTubeCode (code → tokens)", () => {
  it("exchanges a code for a typed token set with ABSOLUTE expiry", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([
      { method: "POST", url: YOUTUBE_OAUTH_TOKEN_ENDPOINT, status: 200, body: FIXTURE_OAUTH_EXCHANGE_OK },
    ]);
    const result = await exchangeYouTubeCode(CONFIG, transport, "fixture-auth-code", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe("fixture-access-token-1");
    expect(result.value.refreshToken).toBe("fixture-refresh-token-1");
    expect(result.value.tokenType).toBe("Bearer");
    expect(result.value.scope).toContain("youtube.readonly");
    // Absolute expiry = now + expires_in seconds.
    expect(result.value.expiresAtMs).toBe(NOW + 3600 * 1000);
    expect(result.value.obtainedAtMs).toBe(NOW);

    // The request: form-encoded grant with every documented field.
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) throw new Error("unreachable");
    expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(request.body ?? "");
    expect(form.get("code")).toBe("fixture-auth-code");
    expect(form.get("client_id")).toBe(CONFIG.clientId);
    expect(form.get("client_secret")).toBe(CONFIG.clientSecret);
    expect(form.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(form.get("grant_type")).toBe("authorization_code");
  });

  it("rejects an empty code typed (invalid-config) before any network call", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([]);
    const result = await exchangeYouTubeCode(CONFIG, transport, "  ", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("invalid-config");
    expect(requests).toHaveLength(0);
  });

  it("maps a rejected code to typed exchange-rejected carrying the OAuth error code", async () => {
    const { transport } = createScriptedYouTubeTransport([
      {
        method: "POST",
        url: YOUTUBE_OAUTH_TOKEN_ENDPOINT,
        status: 400,
        body: FIXTURE_OAUTH_ERROR_INVALID_GRANT,
      },
    ]);
    const result = await exchangeYouTubeCode(CONFIG, transport, "already-redeemed", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("exchange-rejected");
    if (result.error.kind !== "exchange-rejected") throw new Error("unreachable");
    expect(result.error.reason).toBe("invalid_grant");
    expect(result.error.detail.length).toBeGreaterThan(0);
  });

  it("maps a token-endpoint 503 to typed transport (retryable later)", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { method: "POST", url: YOUTUBE_OAUTH_TOKEN_ENDPOINT, status: 503, body: "backend error" },
    ]);
    const result = await exchangeYouTubeCode(CONFIG, transport, "code", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("transport");
  });

  it("maps a network refusal to typed transport (no HTTP exchange at all)", async () => {
    const transport = {
      request(): Promise<never> {
        return Promise.reject(new Error("connection refused"));
      },
    };
    const result = await exchangeYouTubeCode(CONFIG, transport, "code", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("transport");
    expect(result.error.detail).toContain("connection refused");
  });

  it("rejects a 2xx body that is not a documented token payload (malformed-response)", async () => {
    for (const body of ["not json", "{}", '{"access_token":"","expires_in":3600}', '{"access_token":"x","expires_in":0}']) {
      const { transport } = createScriptedYouTubeTransport([
        { method: "POST", url: YOUTUBE_OAUTH_TOKEN_ENDPOINT, status: 200, body },
      ]);
      const result = await exchangeYouTubeCode(CONFIG, transport, "code", NOW);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe("malformed-response");
    }
  });

  it("omits refreshToken honestly when Google does not issue one", async () => {
    const noRefresh = { ...FIXTURE_OAUTH_EXCHANGE_OK } as Record<string, unknown>;
    delete noRefresh["refresh_token"];
    const { transport } = createScriptedYouTubeTransport([
      { method: "POST", url: YOUTUBE_OAUTH_TOKEN_ENDPOINT, status: 200, body: noRefresh },
    ]);
    const result = await exchangeYouTubeCode(CONFIG, transport, "code", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect("refreshToken" in result.value).toBe(false);
  });
});

describe("refreshYouTubeToken (rotation)", () => {
  it("refreshes with grant_type=refresh_token and honors a new refresh token", async () => {
    const rotated = {
      ...FIXTURE_OAUTH_REFRESH_OK,
      refresh_token: "fixture-refresh-token-ROTATED",
    };
    const { transport, requests } = createScriptedYouTubeTransport([
      { method: "POST", url: YOUTUBE_OAUTH_TOKEN_ENDPOINT, status: 200, body: rotated },
    ]);
    const result = await refreshYouTubeToken(
      { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret },
      transport,
      "fixture-refresh-token-1",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.accessToken).toBe("fixture-access-token-2");
    expect(result.value.refreshToken).toBe("fixture-refresh-token-ROTATED");

    const form = new URLSearchParams(requests[0]?.body ?? "");
    expect(form.get("refresh_token")).toBe("fixture-refresh-token-1");
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("client_id")).toBe(CONFIG.clientId);
  });

  it("returns no refreshToken when Google (typically) does not re-issue one", async () => {
    const { transport } = createScriptedYouTubeTransport([
      { method: "POST", url: YOUTUBE_OAUTH_TOKEN_ENDPOINT, status: 200, body: FIXTURE_OAUTH_REFRESH_OK },
    ]);
    const result = await refreshYouTubeToken(
      { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret },
      transport,
      "fixture-refresh-token-1",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect("refreshToken" in result.value).toBe(false);
  });

  it("maps an invalid_grant refresh to typed refresh-rejected (revoked/expired)", async () => {
    const { transport } = createScriptedYouTubeTransport([
      {
        method: "POST",
        url: YOUTUBE_OAUTH_TOKEN_ENDPOINT,
        status: 400,
        body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      },
    ]);
    const result = await refreshYouTubeToken(
      { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret },
      transport,
      "dead-refresh-token",
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("refresh-rejected");
    if (result.error.kind !== "refresh-rejected") throw new Error("unreachable");
    expect(result.error.reason).toBe("invalid_grant");
  });

  it("validates config and refresh token typed before any network call", async () => {
    const { transport, requests } = createScriptedYouTubeTransport([]);
    const badConfig = await refreshYouTubeToken(
      { clientId: "", clientSecret: "s" },
      transport,
      "r",
      NOW,
    );
    expect(badConfig.ok).toBe(false);
    if (badConfig.ok) throw new Error("unreachable");
    expect(badConfig.error.kind).toBe("invalid-config");
    const badToken = await refreshYouTubeToken(
      { clientId: "c", clientSecret: "s" },
      transport,
      " ",
      NOW,
    );
    expect(badToken.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("isYouTubeTokenExpired (typed expiry)", () => {
  const tokens = {
    accessToken: "a",
    tokenType: "Bearer",
    scope: "s",
    expiresAtMs: NOW + 3600 * 1000,
    obtainedAtMs: NOW,
  };

  it("is fresh well before expiry and expired after it", () => {
    expect(isYouTubeTokenExpired(tokens, NOW)).toBe(false);
    expect(isYouTubeTokenExpired(tokens, NOW + 3600 * 1000 + 1)).toBe(true);
  });

  it("applies the safety margin: a token within the margin counts as expired", () => {
    const withinMargin = NOW + 3600 * 1000 - YOUTUBE_TOKEN_EXPIRY_MARGIN_MS;
    expect(isYouTubeTokenExpired(tokens, withinMargin)).toBe(true);
    const justOutside = withinMargin - 1;
    expect(isYouTubeTokenExpired(tokens, justOutside)).toBe(false);
  });

  it("supports a custom margin (including zero)", () => {
    expect(isYouTubeTokenExpired(tokens, NOW + 3600 * 1000 - 1, 0)).toBe(false);
    expect(isYouTubeTokenExpired(tokens, NOW + 3600 * 1000, 0)).toBe(true);
  });
});

describe("documented endpoints are the frozen constants", () => {
  it("authorization + token endpoints match Google's documented URLs", () => {
    expect(YOUTUBE_OAUTH_AUTHORIZATION_ENDPOINT).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(YOUTUBE_OAUTH_TOKEN_ENDPOINT).toBe("https://oauth2.googleapis.com/token");
    // fixtureBody is exercised throughout; keep it referenced for clarity.
    expect(fixtureBody(FIXTURE_OAUTH_EXCHANGE_OK)).toContain("fixture-access-token-1");
    expect(fixtureBody(FIXTURE_OAUTH_REFRESH_OK)).toContain("fixture-access-token-2");
  });
});
