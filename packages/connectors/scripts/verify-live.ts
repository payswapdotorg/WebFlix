/* eslint-disable no-console */
/**
 * WFX-054 — LIVE YouTube verification (run with `bun` when the YOUTUBE_*
 * environment variables are provisioned; NEVER part of `bun test` — it
 * performs real network calls against Google's documented endpoints).
 *
 * Steps (PASS/FAIL/SKIPPED printed per step; SKIPPED never fails the run):
 *  1. env contract    — which YOUTUBE_* variables are present (names only,
 *                       values are NEVER printed)
 *  2. authorize URL   — buildYouTubeAuthorizationUrl over the real client
 *                       config (no network — proves the wiring parses)
 *  3. token exchange  — a REAL token-endpoint attempt with a deliberately
 *                       invalid authorization code: a headless script cannot
 *                       provide interactive user consent, so the honest
 *                       expectation is the TYPED `exchange-rejected` with
 *                       reason `invalid_grant` (the OAuth client itself
 *                       authenticated; only the code was refused). Any other
 *                       outcome (invalid_client, transport, malformed) is a
 *                       FAIL naming the mis-provisioning.
 *  4. search.list     — a real search through the CONNECTOR's typed surface
 *                       (API-key auth; 100 quota units)
 *  5. metadata        — a real videos.list projection of the first search
 *                       result (1 quota unit; embeddability truth included)
 *
 * Without credentials every step prints
 *   "SKIPPED: YOUTUBE_* not provisioned"
 * and the script exits 0 — honest absence, never a fabricated result.
 *
 * Usage: source the operator env, then
 *   cd packages/connectors && bun scripts/verify-live.ts
 */

import {
  buildYouTubeAuthorizationUrl,
  createFetchYouTubeTransport,
  createInMemoryYouTubeCredentialSource,
  createYouTubeConnector,
  exchangeYouTubeCode,
} from "../src/index";

interface StepResult {
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "SKIPPED";
  readonly detail: string;
}

const results: StepResult[] = [];

function report(name: string, status: StepResult["status"], detail: string): void {
  results.push({ name, status, detail });
  console.log(`${status}  ${name}${detail.length > 0 ? ` — ${detail}` : ""}`);
}

/** Read one variable; trims and treats empty as absent. Values never printed. */
function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim();
}

/** The live clock seam (a live script reads real time). */
const liveClock = { now: () => Date.now() };

async function main(): Promise<number> {
  const clientId = env("YOUTUBE_CLIENT_ID");
  const clientSecret = env("YOUTUBE_CLIENT_SECRET");
  const redirectUri = env("YOUTUBE_REDIRECT_URI");
  const apiKey = env("YOUTUBE_API_KEY");

  const oauthConfigured =
    clientId !== undefined && clientSecret !== undefined && redirectUri !== undefined;
  const anyConfigured = oauthConfigured || apiKey !== undefined;

  // ── 1. env contract ─────────────────────────────────────────────────────
  if (!anyConfigured) {
    report(
      "env contract (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REDIRECT_URI / YOUTUBE_API_KEY)",
      "SKIPPED",
      "YOUTUBE_* not provisioned — no YouTube credentials are set in this environment",
    );
  } else {
    const present = [
      clientId !== undefined ? "YOUTUBE_CLIENT_ID" : null,
      clientSecret !== undefined ? "YOUTUBE_CLIENT_SECRET" : null,
      redirectUri !== undefined ? "YOUTUBE_REDIRECT_URI" : null,
      apiKey !== undefined ? "YOUTUBE_API_KEY" : null,
    ].filter((name): name is string => name !== null);
    report(
      "env contract (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REDIRECT_URI / YOUTUBE_API_KEY)",
      "PASS",
      `present: ${present.join(", ")} (names only; values never printed)`,
    );
  }

  const skipAll = (reason = "YOUTUBE_* not provisioned") => {
    report("authorization URL construction (Google consent redirect)", "SKIPPED", reason);
    report("token exchange attempt (real POST to oauth2.googleapis.com/token)", "SKIPPED", reason);
    report("search.list through the connector (100 quota units)", "SKIPPED", reason);
    report("metadata projection through the connector (videos.list, 1 unit)", "SKIPPED", reason);
  };

  if (!anyConfigured) {
    skipAll();
    return 0;
  }

  // ── 2. authorization URL construction ───────────────────────────────────
  if (!oauthConfigured) {
    report(
      "authorization URL construction (Google consent redirect)",
      "SKIPPED",
      "YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REDIRECT_URI not all provisioned",
    );
  } else {
    const url = buildYouTubeAuthorizationUrl(
      { clientId: clientId ?? "", clientSecret: clientSecret ?? "", redirectUri: redirectUri ?? "" },
      { state: "wfx054-verify-live-csrf-state" },
    );
    if (!url.ok) {
      report(
        "authorization URL construction (Google consent redirect)",
        "FAIL",
        `typed invalid-config: ${url.error.detail}`,
      );
    } else {
      const parsed = new URL(url.value);
      const ok =
        parsed.origin === "https://accounts.google.com" &&
        parsed.pathname === "/o/oauth2/v2/auth" &&
        parsed.searchParams.get("response_type") === "code" &&
        parsed.searchParams.get("access_type") === "offline";
      report(
        "authorization URL construction (Google consent redirect)",
        ok ? "PASS" : "FAIL",
        ok ? "documented parameters present (response_type=code, access_type=offline, scopes, state)" : url.value,
      );
    }
  }

  // ── 3. token exchange attempt (typed, real) ─────────────────────────────
  let exchangeVerified = false;
  if (!oauthConfigured) {
    report(
      "token exchange attempt (real POST to oauth2.googleapis.com/token)",
      "SKIPPED",
      "YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REDIRECT_URI not all provisioned",
    );
  } else {
    // A headless script cannot complete interactive consent, so the honest
    // live probe is a real exchange of a deliberately invalid code: the
    // documented outcome is HTTP 400 invalid_grant (the client authenticated,
    // the code was refused) — surfaced as our typed exchange-rejected.
    const transport = createFetchYouTubeTransport({ timeoutMs: 15_000 });
    const attempt = await exchangeYouTubeCode(
      { clientId: clientId ?? "", clientSecret: clientSecret ?? "", redirectUri: redirectUri ?? "" },
      transport,
      "wfx054-verify-live-deliberately-invalid-code",
      liveClock.now(),
    );
    if (!attempt.ok && attempt.error.kind === "exchange-rejected") {
      const reason = attempt.error.reason ?? "(none)";
      if (reason === "invalid_grant") {
        exchangeVerified = true;
        report(
          "token exchange attempt (real POST to oauth2.googleapis.com/token)",
          "PASS",
          "real typed exchange-rejected (invalid_grant): the OAuth client authenticated with Google's token endpoint — a full exchange additionally requires interactive user consent (host callback wiring)",
        );
      } else {
        report(
          "token exchange attempt (real POST to oauth2.googleapis.com/token)",
          "FAIL",
          `typed exchange-rejected with reason '${reason}': ${attempt.error.detail}`,
        );
      }
    } else if (!attempt.ok) {
      report(
        "token exchange attempt (real POST to oauth2.googleapis.com/token)",
        "FAIL",
        `typed ${attempt.error.kind}: ${attempt.error.detail}`,
      );
    } else {
      // A junk code must never yield tokens — that would be a contract break.
      report(
        "token exchange attempt (real POST to oauth2.googleapis.com/token)",
        "FAIL",
        "an invalid authorization code unexpectedly exchanged for tokens",
      );
    }
  }

  // ── 4. + 5. real API calls through the connector ─────────────────────────
  if (apiKey === undefined) {
    report(
      "search.list through the connector (100 quota units)",
      "SKIPPED",
      "YOUTUBE_API_KEY not provisioned (public-data calls need the key or a user OAuth token)",
    );
    report(
      "metadata projection through the connector (videos.list, 1 unit)",
      "SKIPPED",
      "YOUTUBE_API_KEY not provisioned (public-data calls need the key or a user OAuth token)",
    );
  } else {
    const connector = createYouTubeConnector({
      transport: createFetchYouTubeTransport({ timeoutMs: 15_000 }),
      credentialSource: createInMemoryYouTubeCredentialSource(),
      clock: liveClock,
      apiKey,
    });
    await connector.initialize();
    const ctx = { userId: "wfx054-verify-live", locale: "en" };

    // 4. search.list — 100 quota units.
    let firstRef: string | undefined;
    try {
      const search = await connector.searchResult(ctx, "webflix");
      if (search.ok && search.value.length > 0) {
        firstRef = search.value[0]?.externalRef;
        report(
          "search.list through the connector (100 quota units)",
          "PASS",
          `real search returned ${search.value.length} result(s); first: ${search.value[0]?.title}`,
        );
      } else if (search.ok) {
        report(
          "search.list through the connector (100 quota units)",
          "PASS",
          "real search completed with 0 results (honest empty page)",
        );
      } else {
        report(
          "search.list through the connector (100 quota units)",
          "FAIL",
          `typed ${search.error.kind}: ${"detail" in search.error ? search.error.detail : ""}`,
        );
      }
    } catch (thrown) {
      report(
        "search.list through the connector (100 quota units)",
        "FAIL",
        `${(thrown as Error).name}: ${(thrown as Error).message}`,
      );
    }

    // 5. metadata — 1 quota unit on the first search hit.
    if (firstRef === undefined) {
      report(
        "metadata projection through the connector (videos.list, 1 unit)",
        "SKIPPED",
        "no search result available to project",
      );
    } else {
      try {
        const metadata = await connector.metadataResult(ctx, firstRef);
        if (metadata.ok && metadata.value !== null) {
          const item = metadata.value;
          report(
            "metadata projection through the connector (videos.list, 1 unit)",
            "PASS",
            `projected '${item.title}' (durationMs=${item.durationMs ?? "n/a"}, availability=${item.availability}, embeddable=${String(item.metadata?.["embeddable"])})`,
          );
        } else if (metadata.ok) {
          report(
            "metadata projection through the connector (videos.list, 1 unit)",
            "FAIL",
            "videos.list returned no item for a search hit (unexpected)",
          );
        } else {
          report(
            "metadata projection through the connector (videos.list, 1 unit)",
            "FAIL",
            `typed ${metadata.error.kind}: ${"detail" in metadata.error ? metadata.error.detail : ""}`,
          );
        }
      } catch (thrown) {
        report(
          "metadata projection through the connector (videos.list, 1 unit)",
          "FAIL",
          `${(thrown as Error).name}: ${(thrown as Error).message}`,
        );
      }
    }
    await connector.dispose();
  }

  void exchangeVerified; // reported above; kept for readability of the flow
  const failed = results.filter((result) => result.status === "FAIL").length;
  const passed = results.filter((result) => result.status === "PASS").length;
  const skipped = results.filter((result) => result.status === "SKIPPED").length;
  console.log(
    `\nWFX-054 live verification: ${passed} PASS, ${skipped} SKIPPED, ${failed} FAIL.`,
  );
  return failed > 0 ? 1 : 0;
}

const exit = await main();
process.exit(exit);
