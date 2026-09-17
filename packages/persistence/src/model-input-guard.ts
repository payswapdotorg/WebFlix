/**
 * @wfx/persistence — the model-input credential guard (R03).
 *
 * THE LAW (docs/architecture/webflix-remediation-architecture.md — AI media
 * transformation): "Provider credentials never enter model prompts. Model
 * privacy policy is enforced at the runtime boundary."
 *
 * This module is the PERSISTENCE-side enforcement point of that law. Any
 * payload a lane feeds to a model provider (the model-fabric prompt
 * builders, the recommendation lanes' feature assembly, …) can be pushed
 * through {@link assertModelInputFreeOfCredentialMaterial} and the guard
 * fails LOUDLY — the typed {@link CredentialMaterialError} — the moment it
 * sees credential-shaped material, instead of letting a secret ride into a
 * provider prompt.
 *
 * What counts as credential material (deliberately a CLOSED, key-based
 * vocabulary — value-shape sniffing is unreliable and false negatives are
 * the enemy):
 *
 * - the secret-bearing field names of this package's own account envelope:
 *   `secret`, `ciphertext`, `authTag`, `auth_tag`, `iv` (the AES-256-GCM
 *   envelope parts), and the OAuth token field names
 *   (`accessToken`, `access_token`, `refreshToken`, `refresh_token`);
 * - the provider-client secret names (`clientSecret`, `client_secret`) and
 *   the classic credential names (`password`, `passwd`, `api_key`,
 *   `apiKey`, `token` — `token` is included because an unqualified field
 *   with that name is credential-shaped by convention);
 * - an `OpenedConnectorAccount` anywhere in the structure (detected by its
 *   `secret` field — covered by the key list above).
 *
 * The guard is BOUNDED (max depth, max visited nodes) and cycle-safe: a
 * pathological payload fails typed rather than hanging or stack-overflowing.
 * It inspects enumerable OWN properties of plain objects and arrays;
 * `Map`/`Set`/class instances contribute only their own enumerable
 * properties (a `Map`'s entries are not walked — payloads fed to models are
 * JSON-shaped by construction; a non-JSON payload is rejected by the
 * provider transport long before the guard's blind spot matters).
 *
 * Enforcement pairing (see connector-accounts.ts):
 * - `connector_accounts.metadata` and the pending-authorization `metadata`
 *   are REJECTED at write time when they contain any of these fields — the
 *   columns are the store's client-visible surface, so secret-shaped
 *   material can never land there in the first place (defense in depth).
 * - the SAFE ACCOUNT VIEW (`ConnectorAccountSafeView`) is the only account
 *   projection non-connector lanes may consume — it structurally has no
 *   secret field and is branded so an `OpenedConnectorAccount` cannot be
 *   assigned where a safe view is expected (compile-time law), and this
 *   guard backs it at runtime.
 *
 * Determinism: pure structural walk, no clock, no randomness, no I/O.
 */

/** Typed error — credential-shaped material reached a model-input payload. */
export class CredentialMaterialError extends Error {
  /** The offending field name that tripped the guard. */
  public readonly field: string;
  /** Where in the payload the offender sat (a `a.b[2].c` path). */
  public readonly path: string;
  /** The label the caller handed the guard (which payload was being built). */
  public readonly label: string;

  constructor(label: string, field: string, path: string) {
    super(
      `credential material reached a model input (${label}): field '${field}' at '${path}' — ` +
        "provider credentials never enter model prompts (the runtime privacy law); " +
        "build model inputs from ConnectorAccountSafeView, never from opened accounts",
    );
    this.name = "CredentialMaterialError";
    this.field = field;
    this.path = path;
    this.label = label;
  }
}

/**
 * The closed, credential-shaped field-name vocabulary (lower-camel and
 * snake forms both). A field with one of these names is credential
 * material REGARDLESS of its value — the guard never guesses by shape.
 */
export const CREDENTIAL_FIELD_NAMES: readonly string[] = [
  "secret",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "clientsecret",
  "client_secret",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "token",
  "ciphertext",
  "authtag",
  "auth_tag",
  "iv",
] as const;

const CREDENTIAL_FIELDS = new Set<string>(CREDENTIAL_FIELD_NAMES);

/** Max structural depth the guard walks (JSON payloads are far shallower). */
const MAX_DEPTH = 8;

/** Max nodes visited — a pathological payload fails typed, never hangs. */
const MAX_NODES = 4_096;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Assert that `value` carries NO credential-shaped material, recursively.
 *
 * @param value  the payload about to feed a model provider.
 * @param label  what the caller was building (names the lane in the error).
 * @throws CredentialMaterialError naming the offending field + path.
 */
export function assertModelInputFreeOfCredentialMaterial(
  value: unknown,
  label: string,
): void {
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new TypeError("assertModelInputFreeOfCredentialMaterial: label must be a non-empty string");
  }
  walk(value, label, "$", 0, new Set<unknown>());
}

function walk(
  value: unknown,
  label: string,
  path: string,
  depth: number,
  seen: Set<unknown>,
): void {
  if (depth > MAX_DEPTH) {
    throw new CredentialMaterialError(label, "(depth)", `${path} (deeper than ${MAX_DEPTH} levels)`);
  }
  if (value === null || typeof value !== "object") {
    // Primitives are named by their KEYS, checked below — a bare string
    // value is not credential material by itself.
    return;
  }
  if (seen.has(value)) {
    return; // cycle — already visited
  }
  if (seen.size >= MAX_NODES) {
    throw new CredentialMaterialError(label, "(size)", `${path} (more than ${MAX_NODES} nodes)`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      walk(value[index], label, `${path}[${index}]`, depth + 1, seen);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const lowered = key.toLowerCase();
      if (CREDENTIAL_FIELDS.has(lowered)) {
        throw new CredentialMaterialError(label, key, `${path}.${key}`);
      }
      walk(value[key], label, `${path}.${key}`, depth + 1, seen);
    }
  }
  // Non-plain objects (class instances, Map, Set, …): walk their own
  // enumerable properties only (documented blind spot — model payloads are
  // JSON-shaped; anything else fails at the provider transport).
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (CREDENTIAL_FIELDS.has(lowered)) {
      throw new CredentialMaterialError(label, key, `${path}.${key}`);
    }
    walk((value as Record<string, unknown>)[key], label, `${path}.${key}`, depth + 1, seen);
  }
}
