/**
 * @wfx/connectors — YouTube credential storage (WFX-054, Lane B).
 *
 * The typed seam between the connector's OAuth token lifecycle and the
 * DURABLE credential storage the platform already owns: WFX-052's
 * `connector_accounts` (AES-256-GCM envelopes under APP_ENCRYPTION_KEY —
 * ciphertext + fresh IV + authTag + keyId; plaintext NEVER at rest, never
 * in env, never logged).
 *
 * Laws:
 * - ONE token set per (userId, connectorId="youtube") — the 052 UNIQUE
 *   constraint; a `store` ROTATES (replaces) the previous set atomically,
 *   so a refresh-token rotation (Google occasionally re-issues) can never
 *   leave a stale set behind.
 * - The serialized token set is sealed BY THE 052 STORE — this module only
 *   hands it a string. Load outcomes are typed: a key-mismatch (rotated
 *   APP_ENCRYPTION_KEY without re-seal) or a tampered envelope surfaces as
 *   `{ ok: false, reason: "store-error" }` naming the cause — never a
 *   silent null (which would read as "never connected").
 * - `YouTubeCredentialSource` is a NARROW structural interface: hosts may
 *   back it with anything (the in-memory source below for tests/dev; the
 *   persistence-backed adapter over the real database in production).
 */

import { isRecord } from "@wfx/domain";

import { YOUTUBE_CONNECTOR_ID } from "./descriptor";
import type { YouTubeTokenSet } from "./oauth";

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** Typed load outcome: `null` tokens = genuinely never connected. */
export type YouTubeCredentialLoad =
  | { ok: true; tokens: YouTubeTokenSet | null }
  | { ok: false; reason: "store-error"; detail: string };

/** The narrow credential seam the connector consumes. */
export interface YouTubeCredentialSource {
  /** Load the user's token set (null when the user never connected). */
  load(userId: string): Promise<YouTubeCredentialLoad>;
  /** Persist/rotate the user's token set (replaces any previous set). */
  store(userId: string, tokens: YouTubeTokenSet): Promise<void>;
  /** Delete the user's credentials (sign-out / revoked refresh token). */
  clear(userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Token-set serialization (the sealed payload)
// ---------------------------------------------------------------------------

/** The serialized envelope's format tag (forward-compat marker). */
export const YOUTUBE_TOKEN_ENVELOPE_VERSION = 1;

/**
 * Serialize a token set into the string the 052 store seals. JSON with a
 * version tag; exactOptionalPropertyTypes keeps `refreshToken` absent when
 * there is none (a materialized undefined would be dishonest).
 */
export function serializeYouTubeTokenSet(tokens: YouTubeTokenSet): string {
  const envelope =
    tokens.refreshToken === undefined
      ? {
          v: YOUTUBE_TOKEN_ENVELOPE_VERSION,
          accessToken: tokens.accessToken,
          tokenType: tokens.tokenType,
          scope: tokens.scope,
          expiresAtMs: tokens.expiresAtMs,
          obtainedAtMs: tokens.obtainedAtMs,
        }
      : {
          v: YOUTUBE_TOKEN_ENVELOPE_VERSION,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: tokens.tokenType,
          scope: tokens.scope,
          expiresAtMs: tokens.expiresAtMs,
          obtainedAtMs: tokens.obtainedAtMs,
        };
  return JSON.stringify(envelope);
}

/**
 * Parse a sealed-payload string back into a token set. Typed failure — a
 * malformed or foreign envelope is NEVER guessed into a token set.
 */
export function parseYouTubeTokenSet(payload: string): YouTubeCredentialLoad {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: "store-error", detail: "stored credential is not JSON" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "store-error", detail: "stored credential is not an object" };
  }
  if (parsed["v"] !== YOUTUBE_TOKEN_ENVELOPE_VERSION) {
    return {
      ok: false,
      reason: "store-error",
      detail: `stored credential has unknown format version '${String(parsed["v"])}'`,
    };
  }
  const accessToken = parsed["accessToken"];
  const expiresAtMs = parsed["expiresAtMs"];
  const obtainedAtMs = parsed["obtainedAtMs"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, reason: "store-error", detail: "stored credential has no access token" };
  }
  if (
    typeof expiresAtMs !== "number" ||
    !Number.isFinite(expiresAtMs) ||
    typeof obtainedAtMs !== "number" ||
    !Number.isFinite(obtainedAtMs)
  ) {
    return {
      ok: false,
      reason: "store-error",
      detail: "stored credential has non-numeric expiry timestamps",
    };
  }
  const refreshToken = parsed["refreshToken"];
  const scope = parsed["scope"];
  const tokenType = parsed["tokenType"];
  const tokens: YouTubeTokenSet =
    typeof refreshToken === "string" && refreshToken.length > 0
      ? {
          accessToken,
          refreshToken,
          tokenType: typeof tokenType === "string" ? tokenType : "Bearer",
          scope: typeof scope === "string" ? scope : "",
          expiresAtMs,
          obtainedAtMs,
        }
      : {
          accessToken,
          tokenType: typeof tokenType === "string" ? tokenType : "Bearer",
          scope: typeof scope === "string" ? scope : "",
          expiresAtMs,
          obtainedAtMs,
        };
  return { ok: true, tokens };
}

// ---------------------------------------------------------------------------
// In-memory source (tests / single-session dev runtimes)
// ---------------------------------------------------------------------------

/**
 * A deterministic in-memory credential source — the test/dev default.
 * `snapshot` exposes the stored set for assertions; like the SDK's
 * in-memory vault, this is NOT durable storage (production uses the
 * persistence-backed adapter below).
 */
export function createInMemoryYouTubeCredentialSource(): YouTubeCredentialSource & {
  snapshot(userId: string): YouTubeTokenSet | null;
} {
  const byUser = new Map<string, YouTubeTokenSet>();
  return {
    async load(userId: string): Promise<YouTubeCredentialLoad> {
      return { ok: true, tokens: byUser.get(userId) ?? null };
    },
    async store(userId: string, tokens: YouTubeTokenSet): Promise<void> {
      byUser.set(userId, tokens);
    },
    async clear(userId: string): Promise<void> {
      byUser.delete(userId);
    },
    snapshot(userId: string): YouTubeTokenSet | null {
      return byUser.get(userId) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence-backed source (the production adapter over WFX-052)
// ---------------------------------------------------------------------------

/**
 * The narrow slice of WFX-052's `PostgresConnectorAccountStore` this
 * adapter consumes — a structural seam (the real class satisfies it; tests
 * may back it with a fake) that keeps the @wfx/persistence import
 * type-only until instantiation.
 */
export type YouTubeAccountStore = Pick<
  import("@wfx/persistence").PostgresConnectorAccountStore,
  "saveAccount" | "loadAccount" | "deleteAccount"
>;

/**
 * The production credential source: an adapter over WFX-052's
 * `PostgresConnectorAccountStore` (public entry of @wfx/persistence).
 *
 * - `store` → `saveAccount` (kind "oauth-token", authState "signedIn") —
 *   the 052 store seals the serialized set with AES-256-GCM and upserts on
 *   (userId, connectorId), so a rotation replaces atomically.
 * - `load` → `loadAccount`: not-found → `{ tokens: null }` (never
 *   connected); key-mismatch / decrypt-failed → typed `store-error` naming
 *   the cause (an APP_ENCRYPTION_KEY rotation without re-authorization,
 *   or a tampered envelope — both need operator attention, not silence).
 * - `clear` → `deleteAccount` (sign-out / revoked refresh token).
 *
 * The `@wfx/persistence` dependency direction is the one WFX-052 froze its
 * vocabulary mirroring for: the connector layer depends ON persistence for
 * durable accounts (never the reverse — that would close a cycle).
 */
export class PersistenceYouTubeCredentialSource implements YouTubeCredentialSource {
  private readonly accountStore: YouTubeAccountStore;

  constructor(accountStore: YouTubeAccountStore) {
    this.accountStore = accountStore;
  }

  async load(userId: string): Promise<YouTubeCredentialLoad> {
    let result;
    try {
      result = await this.accountStore.loadAccount(userId, YOUTUBE_CONNECTOR_ID);
    } catch (thrown) {
      return {
        ok: false,
        reason: "store-error",
        detail: `connector account store failed: ${
          thrown instanceof Error ? thrown.message : String(thrown)
        }`,
      };
    }
    if (!result.ok) {
      if (result.reason === "not-found") return { ok: true, tokens: null };
      return {
        ok: false,
        reason: "store-error",
        detail:
          result.reason === "key-mismatch"
            ? "credential key mismatch: APP_ENCRYPTION_KEY was rotated without re-authorizing the YouTube connection — re-authorization required"
            : `credential envelope failed to open: ${result.detail}`,
      };
    }
    return parseYouTubeTokenSet(result.account.secret);
  }

  async store(userId: string, tokens: YouTubeTokenSet): Promise<void> {
    await this.accountStore.saveAccount({
      userId,
      connectorId: YOUTUBE_CONNECTOR_ID,
      kind: "oauth-token",
      authState: "signedIn",
      secret: serializeYouTubeTokenSet(tokens),
      metadata: {
        connector: YOUTUBE_CONNECTOR_ID,
        tokenType: tokens.tokenType,
        scope: tokens.scope,
        expiresAtMs: tokens.expiresAtMs,
      },
    });
  }

  async clear(userId: string): Promise<void> {
    await this.accountStore.deleteAccount(userId, YOUTUBE_CONNECTOR_ID);
  }
}
