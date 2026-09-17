/**
 * @wfx/connectors — typed auth flow descriptors (WFX-012, Lane B).
 *
 * The frozen `ConnectorDescriptor.auth` union (`none | oauth | device |
 * local`, see docs/architecture/contracts.md — Connector SDK) declares
 * WHICH handshake a connector uses; it does NOT carry the handshake's
 * parameters (endpoints, scopes, poll cadence). `AuthFlow` is the typed
 * descriptor for those parameters, discriminated by the same four kinds.
 *
 * Boundary law (docs/architecture/product-boundaries.md + this work item):
 * there are NO real OAuth/device implementations here — no network calls,
 * no token exchanges, no browser automation. Flows are DESCRIPTORS + typed
 * orchestration: the CALLER completes the external handshake and hands the
 * post-handshake secret to `ConnectorAuthService.completeAuth` (see
 * service.ts). URL templates therefore describe the shape of the URL the
 * CALLER must fill — this SDK never fetches them.
 *
 * Honesty rule: a bare descriptor declares only the auth MODE. For
 * `oauth`/`device`, endpoint details cannot be derived from the mode alone,
 * so `flowFor` refuses to fabricate them (typed `AuthFlowValidationError`)
 * and requires registered details. `none` and `local` derive complete
 * defaults: `{ kind: 'none' }` needs nothing, and local auth defaults to
 * the generic `token` method.
 */

import type { ConnectorDescriptor } from "@wfx/domain";

import { isAuthMode } from "../descriptor";

/**
 * A typed auth flow descriptor, one variant per frozen auth mode:
 * - `none`   — the connector needs no authentication.
 * - `oauth`  — the caller visits the authorization URL (template), grants
 *              the listed scopes, and completes the exchange; `tokenRefresh`
 *              records whether the provider supports refresh tokens.
 * - `device` — the caller visits the verification URL (template) to approve
 *              a code, then polls no faster than `pollIntervalSeconds`.
 * - `local`  — the caller collects the credential locally (a token, or a
 *              username+password pair) and hands it over directly.
 */
export type AuthFlow =
  | { readonly kind: "none" }
  | {
      /** Authorization endpoint template; must contain `{...}` placeholders. */
      readonly kind: "oauth";
      readonly authorizationUrlTemplate: string;
      readonly scopes: string[];
      readonly tokenRefresh: boolean;
    }
  | {
      /** Verification endpoint template; must contain `{...}` placeholders. */
      readonly kind: "device";
      readonly verificationUrlTemplate: string;
      readonly pollIntervalSeconds: number;
    }
  | {
      /** How the local credential is collected. */
      readonly kind: "local";
      readonly method: "token" | "userpass";
    };

/** The four flow kinds (mirrors the frozen descriptor auth union). */
export type AuthFlowKind = AuthFlow["kind"];

/** Runtime list of the flow kinds. */
export const AUTH_FLOW_KINDS: readonly AuthFlowKind[] = [
  "none",
  "oauth",
  "device",
  "local",
] as const;

/** Typed validation error for auth flow descriptors. */
export class AuthFlowValidationError extends Error {
  constructor(message: string) {
    super(`invalid auth flow: ${message}`);
    this.name = "AuthFlowValidationError";
  }
}

/**
 * A descriptor (or a registry capability-matrix row): everything needed to
 * derive a flow. Structurally satisfied by `ConnectorDescriptor` and by
 * `CapabilityMatrixRow`, so descriptor-only registrations work too.
 */
export type FlowDescriptor = Pick<ConnectorDescriptor, "id" | "auth">;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_TEMPLATE_LENGTH = 2048;
const MAX_SCOPES = 32;
const MAX_SCOPE_LENGTH = 128;
const MAX_POLL_INTERVAL_SECONDS = 3600;

const OAUTH_KEYS = ["kind", "authorizationUrlTemplate", "scopes", "tokenRefresh"];
const DEVICE_KEYS = ["kind", "verificationUrlTemplate", "pollIntervalSeconds"];
const LOCAL_KEYS = ["kind", "method"];

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function reject(message: string): never {
  throw new AuthFlowValidationError(message);
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  kind: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      reject(
        `unknown field '${key}' for flow kind '${kind}' (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

/**
 * Validate a URL template: non-empty, at most 2048 chars, contains at least
 * one well-formed `{placeholder}`, and no stray/unbalanced braces once the
 * placeholders are removed.
 */
function validateTemplate(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    reject(`'${field}' must be a non-empty string`);
  }
  if (value.length > MAX_TEMPLATE_LENGTH) {
    reject(`'${field}' must be at most ${MAX_TEMPLATE_LENGTH} characters`);
  }
  if (!/\{[^{}]+\}/.test(value)) {
    reject(
      `'${field}' must contain at least one '{...}' placeholder, e.g. 'https://provider.example/authorize?client_id={clientId}'`,
    );
  }
  const stripped = value.replace(/\{[^{}]+\}/g, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    reject(
      `'${field}' has unbalanced braces — placeholders must be well-formed '{name}' segments`,
    );
  }
  return value;
}

function validateScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    reject("'scopes' must be an array of strings");
  }
  if (value.length > MAX_SCOPES) {
    reject(`'scopes' must contain at most ${MAX_SCOPES} entries`);
  }
  const seen = new Set<string>();
  for (const scope of value) {
    if (typeof scope !== "string" || scope.trim().length === 0) {
      reject(`'scopes' contains '${String(scope)}' which is not a non-empty string`);
    }
    if (scope.length > MAX_SCOPE_LENGTH) {
      reject(`scope '${scope}' exceeds ${MAX_SCOPE_LENGTH} characters`);
    }
    if (seen.has(scope)) {
      reject(`'scopes' contains duplicate '${scope}'`);
    }
    seen.add(scope);
  }
  return [...value];
}

function validatePollIntervalSeconds(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_POLL_INTERVAL_SECONDS
  ) {
    reject(
      `'pollIntervalSeconds' must be an integer between 1 and ${MAX_POLL_INTERVAL_SECONDS} (seconds), got '${String(value)}'`,
    );
  }
  return value;
}

/**
 * Strict runtime validation + normalization of an auth flow descriptor
 * (the flows counterpart of `defineDescriptor`).
 *
 * Rules per kind:
 * - `none` — no fields beyond `kind`.
 * - `oauth` — `authorizationUrlTemplate` (template-validated),
 *   `scopes` (unique non-empty strings; an empty list is legal — a provider
 *   that grants nothing is honest, not invalid), `tokenRefresh` (boolean).
 * - `device` — `verificationUrlTemplate` (template-validated),
 *   `pollIntervalSeconds` (integer 1..3600 seconds).
 * - `local` — `method` is `token` or `userpass`.
 * - No unknown extra keys (catches typos like `authorizatonUrlTemplate`).
 *
 * @throws AuthFlowValidationError on the first rule violation.
 * @returns a validated, deep-frozen `AuthFlow`.
 */
export function defineAuthFlow(input: unknown): AuthFlow {
  if (!isPlainObject(input)) {
    reject(`expected a plain object, got ${input === null ? "null" : typeof input}`);
  }
  if (typeof input.kind !== "string") {
    reject(`'kind' must be one of ${AUTH_FLOW_KINDS.join(" | ")}`);
  }

  switch (input.kind) {
    case "none": {
      rejectUnknownKeys(input, ["kind"], "none");
      const flow: AuthFlow = { kind: "none" };
      return Object.freeze(flow);
    }
    case "oauth": {
      rejectUnknownKeys(input, OAUTH_KEYS, "oauth");
      const authorizationUrlTemplate = validateTemplate(
        "authorizationUrlTemplate",
        input.authorizationUrlTemplate,
      );
      const scopes = validateScopes(input.scopes);
      if (typeof input.tokenRefresh !== "boolean") {
        reject(`'tokenRefresh' must be a boolean, got '${String(input.tokenRefresh)}'`);
      }
      const flow: AuthFlow = {
        kind: "oauth",
        authorizationUrlTemplate,
        scopes: Object.freeze(scopes) as string[],
        tokenRefresh: input.tokenRefresh,
      };
      return Object.freeze(flow);
    }
    case "device": {
      rejectUnknownKeys(input, DEVICE_KEYS, "device");
      const verificationUrlTemplate = validateTemplate(
        "verificationUrlTemplate",
        input.verificationUrlTemplate,
      );
      const pollIntervalSeconds = validatePollIntervalSeconds(
        input.pollIntervalSeconds,
      );
      const flow: AuthFlow = {
        kind: "device",
        verificationUrlTemplate,
        pollIntervalSeconds,
      };
      return Object.freeze(flow);
    }
    case "local": {
      rejectUnknownKeys(input, LOCAL_KEYS, "local");
      if (input.method !== "token" && input.method !== "userpass") {
        reject(`'method' must be 'token' or 'userpass', got '${String(input.method)}'`);
      }
      const flow: AuthFlow = { kind: "local", method: input.method };
      return Object.freeze(flow);
    }
    default:
      reject(`'kind' must be one of ${AUTH_FLOW_KINDS.join(" | ")}, got '${input.kind}'`);
  }
}

// ---------------------------------------------------------------------------
// Template materialization (R03)
// ---------------------------------------------------------------------------

/**
 * R03 — fill a URL template's `{placeholder}` segments with the caller's
 * parameters (each value percent-encoded), the generic twin of a provider's
 * dedicated URL builder. Every placeholder present in the template MUST have
 * a parameter; a missing parameter is the typed `AuthFlowValidationError`
 * — this helper NEVER fabricates a URL with an unfilled or defaulted
 * placeholder.
 */
export function fillFlowTemplate(
  template: string,
  params: Readonly<Record<string, string>>,
): string {
  if (typeof template !== "string" || template.length === 0) {
    throw new AuthFlowValidationError("'template' must be a non-empty string");
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new AuthFlowValidationError("'params' must be a record of placeholder values");
  }
  return template.replace(/\{([^{}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    const value = params[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new AuthFlowValidationError(
        `template placeholder '{${rawName}}' has no parameter value — the URL cannot be fabricated`,
      );
    }
    return encodeURIComponent(value);
  });
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the auth flow for a descriptor.
 *
 * With `details` (recommended for `oauth`/`device`): the details are
 * validated via `defineAuthFlow` — including the `{...}` template shape —
 * and their kind must match the descriptor's `auth` mode.
 *
 * Without `details`:
 * - `auth: "none"` → `{ kind: "none" }` (fully determined).
 * - `auth: "local"` → `{ kind: "local", method: "token" }` (the generic
 *   default: local auth accepts a caller-supplied token).
 * - `auth: "oauth"` / `auth: "device"` → `AuthFlowValidationError`: the
 *   authorization/verification endpoint cannot be derived from the auth
 *   mode alone, and this SDK refuses to fabricate one.
 *
 * @throws AuthFlowValidationError on mismatched or invalid details, or when
 *         oauth/device details are missing.
 */
export function flowFor(descriptor: FlowDescriptor, details?: unknown): AuthFlow {
  if (!isPlainObject(descriptor)) {
    reject("expected a descriptor-shaped object with 'id' and 'auth'");
  }
  if (typeof descriptor.id !== "string" || descriptor.id.trim().length === 0) {
    reject("'descriptor.id' must be a non-empty string");
  }
  if (!isAuthMode(descriptor.auth)) {
    reject(
      `'descriptor.auth' must be one of none | oauth | device | local, got '${String(descriptor.auth)}'`,
    );
  }

  if (details === undefined) {
    switch (descriptor.auth) {
      case "none":
        return defineAuthFlow({ kind: "none" });
      case "local":
        return defineAuthFlow({ kind: "local", method: "token" });
      case "oauth":
        reject(
          `descriptor '${descriptor.id}' declares auth 'oauth' but no flow details are registered — the authorization endpoint cannot be derived from the auth mode alone; register flow details instead of fabricating an endpoint`,
        );
      case "device":
        reject(
          `descriptor '${descriptor.id}' declares auth 'device' but no flow details are registered — the verification endpoint cannot be derived from the auth mode alone; register flow details instead of fabricating an endpoint`,
        );
    }
  }

  const flow = defineAuthFlow(details);
  if (flow.kind !== descriptor.auth) {
    reject(
      `flow kind '${flow.kind}' does not match descriptor '${descriptor.id}' auth mode '${descriptor.auth}'`,
    );
  }
  return flow;
}
