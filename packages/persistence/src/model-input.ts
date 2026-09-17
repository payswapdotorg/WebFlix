/**
 * @wfx/persistence — the model-input privacy law, ENFORCED (R03).
 *
 * The frozen architecture's absolute law (docs/architecture/
 * webflix-remediation-architecture.md, §AI media transformation):
 *
 *     "Provider credentials never enter model prompts. Model privacy
 *      policy is enforced at the runtime boundary."
 *
 * This module is the persistence-side enforcement point for every lane that
 * feeds model providers (the model-fabric / recommendation lanes):
 *
 * 1. STRUCTURAL — `ModelSafeSourceSummary` is the ONLY account projection
 *    those lanes may consume, and it is structurally incapable of carrying
 *    credential material: its field set is closed and secret-free by
 *    construction (`toModelSafeSourceSummaries` builds it from
 *    `ConnectorAccountRecord`, which itself never contains the secret —
 *    only `loadAccount` can produce a secret, and it exists exclusively for
 *    the CONNECTOR runtime lane: token refresh + provider calls).
 * 2. TYPE-LEVEL — `AssertNoCredentialMaterial<T>` is a compile-time guard:
 *    assigning it against any type whose keys include a credential field
 *    (secret, ciphertext, iv, authTag, accessToken, refreshToken, …) is a
 *    TYPE ERROR. The enforcement test pins it against
 *    `ModelSafeSourceSummary` (and its negative: a leaky shape fails to
 *    compile by exclusion — asserted via the runtime mirror below).
 * 3. RUNTIME — `assertNoCredentialMaterial(value)` deep-scans any value an
 *    API/persistence path is about to hand toward a model lane (or out of a
 *    source-management read) and throws the typed, LOUD
 *    `CredentialMaterialLeakError` the moment a banned key appears — a
 *    programmer error on the caller's side, never a silent pass-through.
 *
 * The guard is deliberately over-approximate: it flags the KEY NAMES of
 * credential material wherever they appear (nested objects, arrays, maps),
 * because a key named `accessToken` in a model input is a bug regardless of
 * the value behind it.
 */

import type { ConnectorAccountRecord, ConnectorAuthState } from "./connector-accounts";
import { PersistenceError } from "./errors";

// ---------------------------------------------------------------------------
// The structurally secret-free projection
// ---------------------------------------------------------------------------

/**
 * The model-input-safe summary of one connected source account. FIELD SET
 * IS CLOSED AND SECRET-FREE BY CONSTRUCTION — see the module doc. Adding a
 * field here is a review-visible contract change; adding a credential field
 * is a violation the type-level guard (below) and the enforcement test
 * both catch.
 */
export interface ModelSafeSourceSummary {
  /** Whose connection this is (model lanes key personalization by user). */
  readonly userId: string;
  /** The connector the account binds (never a provider credential). */
  readonly connectorId: string;
  /** The durable authorization state (signedOut | authorizing | signedIn | expired | failed). */
  readonly authState: ConnectorAuthState;
  /** Whether a connected account exists. */
  readonly connected: boolean;
  /** When the current authorization was granted (null before the first sign-in). */
  readonly authorizedAt: string | null;
  /** When the authorization state last changed. */
  readonly lastStateChange: string | null;
  /** Per-account quota/health notes (operator-visible diagnostics, never secrets). */
  readonly availabilityNotes: readonly string[];
}

/**
 * Project account records into the model-safe summaries. Pure; the input
 * records never contain secrets (the store's read surface guarantees it),
 * and the output CANNOT represent one.
 */
export function toModelSafeSourceSummaries(
  records: readonly ConnectorAccountRecord[],
): readonly ModelSafeSourceSummary[] {
  return records.map((record) => ({
    userId: record.userId,
    connectorId: record.connectorId,
    authState: record.authState,
    connected: true,
    authorizedAt: record.authorizedAt,
    lastStateChange: record.lastStateChange,
    availabilityNotes: record.availabilityNotes ?? [],
  }));
}

// ---------------------------------------------------------------------------
// The type-level guard
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of credential-material FIELD NAMES this law bans
 * from model inputs — the secret itself, the sealed envelope's parts, and
 * the OAuth token fields providers issue. `password` is included: a future
 * local-userpass connector must never leak its material either.
 */
export type CredentialMaterialField =
  | "secret"
  | "ciphertext"
  | "iv"
  | "authTag"
  | "auth_tag"
  | "accessToken"
  | "access_token"
  | "refreshToken"
  | "refresh_token"
  | "password"
  | "clientSecret"
  | "client_secret"
  | "apiKey"
  | "api_key";

/** Runtime mirror of {@link CredentialMaterialField} (the scanning set). */
export const CREDENTIAL_MATERIAL_FIELDS: readonly CredentialMaterialField[] = [
  "secret",
  "ciphertext",
  "iv",
  "authTag",
  "auth_tag",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "password",
  "clientSecret",
  "client_secret",
  "apiKey",
  "api_key",
];

const BANNED_KEYS: ReadonlySet<string> = new Set(CREDENTIAL_MATERIAL_FIELDS);

/**
 * Compile-time assertion that `T`'s key set contains NO credential-material
 * field. Resolves to `true` when clean; resolves to the error object
 * (failing assignment sites with a readable message) when a banned key is
 * present — including OPTIONAL keys (`secret?: string` is still a leak).
 */
export type AssertNoCredentialMaterial<T> =
  Extract<keyof T, CredentialMaterialField> extends never
    ? true
    : { error: "credential-material field present — model inputs must be structurally secret-free"; field: Extract<keyof T, CredentialMaterialField> };

// ---------------------------------------------------------------------------
// The runtime guard
// ---------------------------------------------------------------------------

/**
 * Typed, LOUD failure thrown by {@link assertNoCredentialMaterial}: a value
 * headed for a model lane (or out of a source-management read) carries a
 * credential-material field name. This is a programmer error — never
 * caught-and-degraded, never silent.
 */
export class CredentialMaterialLeakError extends PersistenceError {
  /** The banned field name found. */
  readonly field: string;
  /** Where in the value it was found (a JSON-path-ish trace). */
  readonly path: string;

  constructor(field: string, path: string) {
    super(
      "credential-leak",
      `model-input privacy violation: credential-material field '${field}' found at '${path}' — ` +
        "provider credentials never enter model prompts (the frozen architecture's privacy law)",
      { operation: "modelInput.assertNoCredentialMaterial" },
    );
    this.name = "CredentialMaterialLeakError";
    this.field = field;
    this.path = path;
  }
}

/** The typed scan outcome (operational form of the guard — for lanes that answer, not throw). */
export type CredentialMaterialScan =
  | { readonly ok: true }
  | { readonly ok: false; readonly field: string; readonly path: string };

/**
 * Pure scan: does `value` contain a banned credential-material field name
 * anywhere (nested objects, arrays, Maps)? Non-throwing twin of
 * {@link assertNoCredentialMaterial}.
 */
export function scanForCredentialMaterial(
  value: unknown,
  path = "$",
  seen: ReadonlySet<unknown> = new Set(),
): CredentialMaterialScan {
  if (value === null || typeof value !== "object") return { ok: true };
  if (seen.has(value)) return { ok: true }; // cycles are not leaks
  const nextSeen = new Set(seen);
  nextSeen.add(value);

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = scanForCredentialMaterial(entry, `${path}[${index}]`, nextSeen);
      if (!found.ok) return found;
    }
    return { ok: true };
  }

  if (value instanceof Map) {
    for (const [key, entry] of value.entries()) {
      // A banned STRING key is the same leak as an object field named for
      // credential material — Map keys are field names in disguise.
      if (typeof key === "string" && BANNED_KEYS.has(key)) {
        return { ok: false, field: key, path: `${path}<key:${key}>` };
      }
      const keyFound = scanForCredentialMaterial(key, `${path}<key>`, nextSeen);
      if (!keyFound.ok) return keyFound;
      const found = scanForCredentialMaterial(entry, `${path}.${String(key)}`, nextSeen);
      if (!found.ok) return found;
    }
    return { ok: true };
  }

  if (value instanceof Set) {
    for (const entry of value.values()) {
      const found = scanForCredentialMaterial(entry, `${path}<set>`, nextSeen);
      if (!found.ok) return found;
    }
    return { ok: true };
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (BANNED_KEYS.has(key)) {
      return { ok: false, field: key, path: `${path}.${key}` };
    }
    const found = scanForCredentialMaterial(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      nextSeen,
    );
    if (!found.ok) return found;
  }
  return { ok: true };
}

/**
 * The enforcing guard: throws the typed {@link CredentialMaterialLeakError}
 * when `value` carries a credential-material field name anywhere. Call this
 * at the boundary where persistence/API data flows toward model providers
 * (or out of source-management reads — defense in depth). Values (not just
 * keys) are never inspected — the guard never reads the secret it refuses.
 */
export function assertNoCredentialMaterial(value: unknown, label = "model input"): void {
  const scan = scanForCredentialMaterial(value);
  if (!scan.ok) {
    throw new CredentialMaterialLeakError(scan.field, scan.path);
  }
  void label; // the typed error names the law; the label is documentation
}
