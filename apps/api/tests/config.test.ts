/**
 * WFX-055A service boot-configuration tests (bun:test).
 *
 * Pins `resolveApiConfig` — the env law of the service lane (the twin of
 * the web host's WFX-050 config law): required variables, scheme
 * validation, the OAuth half-pair crime, THE FIXTURE LAW (WFX_DEV_FIXTURES
 * must not exist on the service in any mode), whitespace-only values read
 * as absent, and the CRON_SECRET passthrough.
 *
 * Determinism: the module reads ONLY its injected `env` argument — every
 * test passes an explicit record, never `process.env`. No clock, no
 * network, no randomness.
 */

import { describe, expect, it } from "bun:test";

import { ApiConfigError, resolveApiConfig } from "../src/host/config";

const VALID_ENV = {
  DATABASE_URL: "postgres://user:secret@ep-example.neon.tech/db?sslmode=require",
  APP_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
} as const;

describe("resolveApiConfig — the happy path", () => {
  it("resolves the required variables (trimmed) with no optional wiring", () => {
    const config = resolveApiConfig({ ...VALID_ENV });
    expect(config.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
    expect(config.encryptionKey).toBe(VALID_ENV.APP_ENCRYPTION_KEY);
    expect(config.youtube).toBeNull();
    expect(config.cronSecret).toBeNull();
  });

  it("reads its injected env only — an empty record is a missing-variable crime, not a process.env read", () => {
    let caught: unknown;
    try {
      resolveApiConfig({});
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ApiConfigError);
    expect((caught as ApiConfigError).missing).toContain("DATABASE_URL");
  });

  it("trims surrounding whitespace off values", () => {
    const config = resolveApiConfig({
      DATABASE_URL: `  ${VALID_ENV.DATABASE_URL}  `,
      APP_ENCRYPTION_KEY: ` ${VALID_ENV.APP_ENCRYPTION_KEY} `,
    });
    expect(config.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
    expect(config.encryptionKey).toBe(VALID_ENV.APP_ENCRYPTION_KEY);
  });
});

describe("resolveApiConfig — required-variable law (typed, loud, names both)", () => {
  function capture(env: Record<string, string | undefined>): ApiConfigError {
    try {
      resolveApiConfig(env);
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ApiConfigError);
      return thrown as ApiConfigError;
    }
    throw new Error("expected resolveApiConfig to throw");
  }

  it("missing DATABASE_URL is named", () => {
    const error = capture({ APP_ENCRYPTION_KEY: VALID_ENV.APP_ENCRYPTION_KEY });
    expect(error.name).toBe("ApiConfigError");
    expect(error.kind).toBe("api-config");
    expect(error.missing).toEqual(["DATABASE_URL"]);
    expect(error.invalid).toEqual([]);
    expect(error.detail).toContain("DATABASE_URL");
  });

  it("missing APP_ENCRYPTION_KEY is named", () => {
    const error = capture({ DATABASE_URL: VALID_ENV.DATABASE_URL });
    expect(error.missing).toEqual(["APP_ENCRYPTION_KEY"]);
    expect(error.detail).toContain("APP_ENCRYPTION_KEY");
  });

  it("missing BOTH required variables are named together (one round fixes everything)", () => {
    const error = capture({});
    expect(error.missing).toEqual(["DATABASE_URL", "APP_ENCRYPTION_KEY"]);
    expect(error.detail).toContain("DATABASE_URL");
    expect(error.detail).toContain("APP_ENCRYPTION_KEY");
  });

  it("whitespace-only required values are read as ABSENT (missing, not invalid)", () => {
    const error = capture({ DATABASE_URL: "   ", APP_ENCRYPTION_KEY: "\t \n" });
    expect(error.missing).toEqual(["DATABASE_URL", "APP_ENCRYPTION_KEY"]);
  });

  it("never echoes VALUES — error details carry variable NAMES only (the 052 env law)", () => {
    const error = capture({ APP_ENCRYPTION_KEY: VALID_ENV.APP_ENCRYPTION_KEY });
    expect(error.message).not.toContain("postgres://user:secret");
    expect(error.detail).not.toContain("postgres://user:secret");
  });
});

describe("resolveApiConfig — DATABASE_URL scheme law", () => {
  it("rejects a non-postgres scheme, naming DATABASE_URL as invalid", () => {
    let caught: unknown;
    try {
      resolveApiConfig({ ...VALID_ENV, DATABASE_URL: "mysql://user@host/db" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ApiConfigError);
    const error = caught as ApiConfigError;
    expect(error.missing).toEqual([]);
    expect(error.invalid).toEqual(["DATABASE_URL"]);
    expect(error.detail).toContain("postgres://");
  });

  it("accepts both postgres:// and postgresql:// schemes", () => {
    expect(
      resolveApiConfig({ ...VALID_ENV, DATABASE_URL: "postgresql://host/db" }).databaseUrl,
    ).toBe("postgresql://host/db");
  });
});

describe("resolveApiConfig — THE FIXTURE LAW (the service lane has no fixture mode)", () => {
  it("WFX_DEV_FIXTURES=1 is a typed configuration crime", () => {
    let caught: unknown;
    try {
      resolveApiConfig({ ...VALID_ENV, WFX_DEV_FIXTURES: "1" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ApiConfigError);
    const error = caught as ApiConfigError;
    expect(error.invalid).toEqual(["WFX_DEV_FIXTURES"]);
    expect(error.detail).toContain("WFX_DEV_FIXTURES");
  });

  it("ANY value is the crime — '0', 'false', and 'off' all refuse to boot", () => {
    for (const value of ["0", "false", "off"]) {
      let caught: unknown;
      try {
        resolveApiConfig({ ...VALID_ENV, WFX_DEV_FIXTURES: value });
      } catch (thrown) {
        caught = thrown;
      }
      expect(caught, `WFX_DEV_FIXTURES=${value}`).toBeInstanceOf(ApiConfigError);
      expect((caught as ApiConfigError).invalid).toEqual(["WFX_DEV_FIXTURES"]);
    }
  });

  it("a whitespace-only WFX_DEV_FIXTURES is read as absent (the uniform readVar law)", () => {
    const config = resolveApiConfig({ ...VALID_ENV, WFX_DEV_FIXTURES: "   " });
    expect(config.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
  });
});

describe("resolveApiConfig — the YouTube OAuth pair law", () => {
  it("YOUTUBE_CLIENT_ID without YOUTUBE_CLIENT_SECRET is a half-pair crime", () => {
    let caught: unknown;
    try {
      resolveApiConfig({ ...VALID_ENV, YOUTUBE_CLIENT_ID: "cid" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ApiConfigError);
    const error = caught as ApiConfigError;
    expect(error.invalid).toEqual(["YOUTUBE_CLIENT_SECRET"]);
    expect(error.detail).toContain("together");
  });

  it("YOUTUBE_CLIENT_SECRET without YOUTUBE_CLIENT_ID is a half-pair crime", () => {
    let caught: unknown;
    try {
      resolveApiConfig({ ...VALID_ENV, YOUTUBE_CLIENT_SECRET: "csecret" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ApiConfigError);
    expect((caught as ApiConfigError).invalid).toEqual(["YOUTUBE_CLIENT_ID"]);
  });

  it("an API key alone wires the secondary source without any OAuth client", () => {
    const config = resolveApiConfig({ ...VALID_ENV, YOUTUBE_API_KEY: "AIza-test-key" });
    expect(config.youtube).toEqual({ apiKey: "AIza-test-key" });
  });

  it("the complete trio wires api key + OAuth client together", () => {
    const config = resolveApiConfig({
      ...VALID_ENV,
      YOUTUBE_API_KEY: "AIza-test-key",
      YOUTUBE_CLIENT_ID: "cid",
      YOUTUBE_CLIENT_SECRET: "csecret",
    });
    expect(config.youtube).toEqual({
      apiKey: "AIza-test-key",
      clientId: "cid",
      clientSecret: "csecret",
    });
  });

  it("an OAuth pair without an API key wires the client alone", () => {
    const config = resolveApiConfig({
      ...VALID_ENV,
      YOUTUBE_CLIENT_ID: "cid",
      YOUTUBE_CLIENT_SECRET: "csecret",
    });
    expect(config.youtube).toEqual({ clientId: "cid", clientSecret: "csecret" });
  });
});

describe("resolveApiConfig — CRON_SECRET passthrough", () => {
  it("passes a set secret through (trimmed)", () => {
    const config = resolveApiConfig({ ...VALID_ENV, CRON_SECRET: "  cron-secret-1  " });
    expect(config.cronSecret).toBe("cron-secret-1");
  });

  it("unset means null (allowed outside production; the relay handler enforces the law)", () => {
    expect(resolveApiConfig({ ...VALID_ENV }).cronSecret).toBeNull();
  });

  it("whitespace-only means null (read as absent)", () => {
    expect(resolveApiConfig({ ...VALID_ENV, CRON_SECRET: "   " }).cronSecret).toBeNull();
  });
});

describe("resolveApiConfig — R03 YOUTUBE_REDIRECT_URI law", () => {
  it("the full OAuth triple carries the redirect URI through (the connect-flow wiring)", () => {
    const config = resolveApiConfig({
      ...VALID_ENV,
      YOUTUBE_CLIENT_ID: "cid",
      YOUTUBE_CLIENT_SECRET: "csecret",
      YOUTUBE_REDIRECT_URI: "https://api.webflix.example/sources/callback",
    });
    expect(config.youtube).toEqual({
      clientId: "cid",
      clientSecret: "csecret",
      redirectUri: "https://api.webflix.example/sources/callback",
    });
  });

  it("a pair WITHOUT the redirect URI still boots (rotation works; the connect flow is honestly unwired)", () => {
    const config = resolveApiConfig({
      ...VALID_ENV,
      YOUTUBE_CLIENT_ID: "cid",
      YOUTUBE_CLIENT_SECRET: "csecret",
    });
    expect(config.youtube).toEqual({ clientId: "cid", clientSecret: "csecret" });
  });

  it("a non-http(s) redirect URI is a typed config crime naming the variable", () => {
    let caught: unknown;
    try {
      resolveApiConfig({ ...VALID_ENV, YOUTUBE_REDIRECT_URI: "not-a-url" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(ApiConfigError);
    expect((caught as ApiConfigError).invalid).toEqual(["YOUTUBE_REDIRECT_URI"]);
  });

  it("a redirect URI alone (no OAuth pair) still wires the youtube env honestly", () => {
    const config = resolveApiConfig({
      ...VALID_ENV,
      YOUTUBE_REDIRECT_URI: "https://api.webflix.example/sources/callback",
    });
    expect(config.youtube).toEqual({
      redirectUri: "https://api.webflix.example/sources/callback",
    });
  });
});
