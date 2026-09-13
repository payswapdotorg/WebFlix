/**
 * @wfx/connectors — connector descriptors and capability truth (WFX-003).
 *
 * A `ConnectorDescriptor` is a connector's identity card: a stable kebab-case
 * id, a semver version, a display name, the exact set of capabilities the
 * connector actually implements, and its auth mode. Descriptors are the
 * source of truth for the registry's capability matrix — UI availability
 * must be derived from them, never guessed (docs/architecture/
 * product-boundaries.md: "Connectors must declare actual capabilities").
 *
 * The runtime `CAPABILITIES` constant is defined HERE from the frozen
 * contract's `Capability` type (packages/domain/src/contracts/frozen.ts is
 * generated and type-only). A compile-time exhaustiveness assertion keeps
 * the constant in sync with the frozen union.
 */

import type { Capability, ConnectorDescriptor } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Capability truth
// ---------------------------------------------------------------------------

/**
 * The closed set of capabilities from the frozen Connector SDK contract.
 * Order mirrors the frozen union; membership is the ONLY runtime truth for
 * "what can this connector do".
 */
export const CAPABILITIES: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
] as const;

// Compile-time exhaustiveness check: if the frozen Capability union gains or
// loses a member without CAPABILITIES following, this type errors out.
type AssertCapabilitiesExhaustive = Exclude<
  Capability,
  (typeof CAPABILITIES)[number]
> extends never
  ? true
  : { error: "CAPABILITIES is out of sync with the frozen Capability union" };
const _assertCapabilitiesExhaustive: AssertCapabilitiesExhaustive = true;

/** Auth modes accepted by the frozen descriptor contract. */
export type AuthMode = ConnectorDescriptor["auth"];

/** Runtime list of the auth modes from the frozen contract. */
export const AUTH_MODES: readonly AuthMode[] = [
  "none",
  "oauth",
  "device",
  "local",
] as const;

/** Runtime membership check against the frozen capability union. */
export function isCapability(x: unknown): x is Capability {
  return typeof x === "string" && CAPABILITIES.includes(x as Capability);
}

/** Runtime membership check against the frozen auth union. */
export function isAuthMode(x: unknown): x is AuthMode {
  return typeof x === "string" && AUTH_MODES.includes(x as AuthMode);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Thrown when a descriptor does not satisfy the strict descriptor rules. */
export class DescriptorValidationError extends Error {
  constructor(message: string) {
    super(`invalid connector descriptor: ${message}`);
    this.name = "DescriptorValidationError";
  }
}

const KEBAB_CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DESCRIPTOR_KEYS = new Set([
  "id",
  "version",
  "displayName",
  "capabilities",
  "auth",
]);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function reject(message: string): never {
  throw new DescriptorValidationError(message);
}

/**
 * Strict runtime validation + normalization of a connector descriptor.
 *
 * Rules:
 * - `id` — non-empty kebab-case (`[a-z0-9]` groups joined by single hyphens),
 *   at most 64 chars, and STABLE: the returned descriptor is deep-frozen so
 *   the id can never drift after registration.
 * - `version` — semver `MAJOR.MINOR.PATCH` with optional prerelease/build
 *   tags (loose semver, as used by the npm ecosystem).
 * - `displayName` — non-empty trimmed string, at most 128 chars.
 * - `capabilities` — array of unique members of the frozen `Capability`
 *   union. Duplicates and unknown values are rejected. An EMPTY list is
 *   legal: a connector that declares nothing answers `unsupported` to
 *   everything, which is honest, not invalid.
 * - `auth` — one of `none | oauth | device | local`.
 * - No unknown extra keys (catches typos like `capabilites`).
 *
 * @throws DescriptorValidationError on the first rule violation.
 * @returns a validated, deep-frozen `ConnectorDescriptor`.
 */
export function defineDescriptor(input: unknown): ConnectorDescriptor {
  if (typeof input === "function" || typeof (input as { descriptor?: unknown })?.descriptor === "function") {
    reject("expected a descriptor object, got something with a descriptor() method (pass the connector instance to the registry instead)");
  }
  if (!isRecord(input)) {
    reject(`expected a plain object, got ${input === null ? "null" : typeof input}`);
  }

  for (const key of Object.keys(input)) {
    if (!DESCRIPTOR_KEYS.has(key)) {
      reject(`unknown field '${key}' (allowed: ${[...DESCRIPTOR_KEYS].join(", ")})`);
    }
  }

  const { id, version, displayName, capabilities, auth } = input;

  if (typeof id !== "string") reject("'id' must be a string");
  if (id.length === 0) reject("'id' must not be empty");
  if (id.length > MAX_ID_LENGTH) reject(`'id' must be at most ${MAX_ID_LENGTH} characters`);
  if (!KEBAB_CASE_ID.test(id)) {
    reject("'id' must be kebab-case: lowercase alphanumeric groups joined by single hyphens (e.g. 'archive-org')");
  }

  if (typeof version !== "string") reject("'version' must be a string");
  if (!SEMVER.test(version)) {
    reject("'version' must be semver (MAJOR.MINOR.PATCH, optional -prerelease / +build), e.g. '1.4.0'");
  }

  if (typeof displayName !== "string") reject("'displayName' must be a string");
  const trimmedName = displayName.trim();
  if (trimmedName.length === 0) reject("'displayName' must not be empty or whitespace");
  if (trimmedName.length > 128) reject("'displayName' must be at most 128 characters (after trim)");

  if (!Array.isArray(capabilities)) reject("'capabilities' must be an array");
  const seen = new Set<string>();
  for (const cap of capabilities) {
    if (!isCapability(cap)) {
      reject(`'capabilities' contains '${String(cap)}' which is not a member of the frozen Capability union`);
    }
    if (seen.has(cap)) {
      reject(`'capabilities' contains duplicate '${cap}'`);
    }
    seen.add(cap);
  }

  if (!isAuthMode(auth)) {
    reject(`'auth' must be one of ${AUTH_MODES.join(" | ")}, got '${String(auth)}'`);
  }

  const descriptor: ConnectorDescriptor = {
    id,
    version,
    displayName: trimmedName,
    capabilities: Object.freeze([...capabilities]) as Capability[],
    auth,
  };
  return Object.freeze(descriptor);
}
